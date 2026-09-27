import { privateJson } from '@/lib/httpResponses';
import { NextRequest } from 'next/server';
import axios from 'axios';
import {
  assembleFile,
  cleanupSession,
  isSessionOwner,
} from '@/lib/chunkedUploadStore';
import { getSessionWallet } from '@/lib/session';
import {
  detectFileType,
  isDeclaredTypeCompatible,
  bufToHex,
} from '@/lib/fileSignature';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { createRequestLogger } from '@/lib/logger';
import {
  verifyUploadedContent,
  UploadVerificationError,
} from '@/lib/uploadVerification';

export const runtime = 'nodejs';

/**
 * POST /api/ipfs/upload/complete
 *
 * Assembles every chunk of a session into one file, validates it exactly
 * like the whole-file route does (MIME + magic bytes — deferred here since
 * the signature only lives in the first chunk's leading bytes), then makes
 * the same single `pinFileToIPFS` call app/api/ipfs/upload's POST does.
 * Chunking only changes the browser<->this-app leg; Pinata still receives
 * one complete file in one request.
 *
 * Issue #1294: assembleFile() also asserts the assembled byte length equals
 * the declared fileSize — a mismatch (bytes stored out-of-band or under an
 * older unenforced write path) returns 400 here, and assembleFile() already
 * deleted the poisoned session so it can't be retried into another giant
 * buffering attempt.
 */
const RATE_LIMIT = { limit: 20, windowMs: 60 * 1000 };

const ALLOWED_MIME_PREFIXES = ['image/', 'video/'];

export async function POST(req: NextRequest) {
  const log = createRequestLogger(req);
  const ip = getClientIp(req);
  const rl = await checkRateLimit(`ipfs-upload-complete:${ip}`, RATE_LIMIT);
  if (rl.limited) {
    const retryAfter = rl.retryAfterSec ?? 60;
    return privateJson(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return privateJson({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { sessionId } = (body ?? {}) as Record<string, unknown>;
  if (typeof sessionId !== 'string' || !sessionId) {
    return privateJson({ error: 'sessionId is required' }, { status: 400 });
  }

  if (!(await isSessionOwner(sessionId, getSessionWallet(req)))) {
    // 404 rather than 403 so a foreign caller can't probe session existence.
    return privateJson(
      { error: 'Upload session not found or expired' },
      { status: 404 },
    );
  }

  let assembled;
  try {
    assembled = await assembleFile(sessionId);
  } catch (err) {
    return privateJson(
      {
        error: err instanceof Error ? err.message : 'Failed to assemble upload',
      },
      { status: 400 },
    );
  }

  const { buffer, filename, fileType } = assembled;

  const mimeAllowed = ALLOWED_MIME_PREFIXES.some((prefix) =>
    fileType.toLowerCase().startsWith(prefix),
  );
  if (!mimeAllowed) {
    await cleanupSession(sessionId);
    return privateJson(
      {
        error: `File type "${fileType}" is not allowed. Only image/* and video/* files are accepted.`,
      },
      { status: 400 },
    );
  }

  const header = new Uint8Array(buffer.subarray(0, 12));
  // Detected family must match the declared prefix (issue #1329).
  const detected = detectFileType(header);
  if (!detected || !isDeclaredTypeCompatible(fileType, detected)) {
    await cleanupSession(sessionId);
    log.warn('Rejected spoofed MIME type', {
      type: fileType,
      detected: detected?.mime ?? null,
      ip,
      header: bufToHex(header),
    });
    return privateJson(
      {
        error:
          'File content does not match its declared type. Upload rejected.',
      },
      { status: 400 },
    );
  }

  let cid: string;
  try {
    const pinataForm = new FormData();
    // Uint8Array copy sidesteps a @types/node-vs-DOM-lib generic mismatch
    // (Buffer's ArrayBufferLike vs BlobPart's concrete ArrayBuffer).
    const file = new File([new Uint8Array(buffer)], filename, {
      type: detected.mime,
    });
    pinataForm.append('file', file);

    const { data } = await axios.post(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      pinataForm,
      {
        headers: {
          pinata_api_key: process.env.PINATA_API_KEY!,
          pinata_secret_api_key: process.env.PINATA_SECRET!,
        },
      },
    );
    cid = data.IpfsHash;
  } catch (err) {
    // Deliberately don't clean up the session here: the assembled chunks are
    // still valid, so a client retrying /complete after a transient Pinata
    // failure shouldn't have to re-upload every chunk.
    log.error('Pinata upload failed', {
      ip,
      reason: err instanceof Error ? err.message : String(err),
    });
    return privateJson(
      { error: 'Failed to upload file to IPFS' },
      { status: 502 },
    );
  }

  // Post-upload integrity verification (issue #699): re-fetch the CID from
  // the gateway and confirm it matches the assembled bytes we just pinned,
  // before telling the caller the upload succeeded. See
  // lib/uploadVerification.ts for why this checks gateway-retrievable bytes
  // rather than recomputing the CID itself.
  try {
    await verifyUploadedContent(cid, buffer);
  } catch (err) {
    // Same reasoning as a Pinata failure above: the assembled chunks are
    // still valid (the content is unchanged), so preserve the session
    // instead of forcing a full re-upload on retry.
    log.error('Upload verification failed', {
      ip,
      cid,
      reason: err instanceof Error ? err.message : String(err),
    });
    return privateJson(
      {
        error:
          err instanceof UploadVerificationError
            ? err.message
            : 'Upload verification failed. Please try again.',
      },
      { status: 502 },
    );
  }

  await cleanupSession(sessionId);
  return privateJson({ cid });
}
