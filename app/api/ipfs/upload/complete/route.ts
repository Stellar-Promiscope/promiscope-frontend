import { NextRequest, NextResponse } from 'next/server';
import { apiError, ApiErrorCode } from '@/lib/apiErrors';
import axios from 'axios';
import {
  assembleFile,
  cleanupSession,
  getSessionStatus,
} from '@/lib/chunkedUploadStore';
import { hasValidMagicBytes, bufToHex } from '@/lib/fileSignature';
import { getClientIp, createRateLimiter } from '@/lib/uploadRateLimit';
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
 */
const checkRateLimit = createRateLimiter(20, 60 * 1000);

const ALLOWED_MIME_PREFIXES = ['image/', 'video/'];

export async function POST(req: NextRequest) {
  const log = createRequestLogger(req);
  const ip = getClientIp(req);
  const rl = checkRateLimit(ip);
  if (rl.limited) {
    const retryAfter = rl.retryAfterSec ?? 60;
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { sessionId } = (body ?? {}) as Record<string, unknown>;
  if (typeof sessionId !== 'string' || !sessionId) {
    return NextResponse.json(
      { error: 'sessionId is required' },
      { status: 400 },
    );
  }

  let assembled;
  try {
    assembled = await assembleFile(sessionId);
  } catch (err) {
    log.warn('Failed to assemble upload', {
      sessionId,
      reason: err instanceof Error ? err.message : String(err),
    });
    const session = await getSessionStatus(sessionId).catch(() => null);
    if (session) {
      const received = session.receivedChunks.length;
      const total = session.totalChunks;
      return apiError(
        ApiErrorCode.UPLOAD_INCOMPLETE,
        400,
        `Incomplete upload: received ${received}/${total} chunks`,
        { received, total },
      );
    }
    return apiError(
      ApiErrorCode.UPLOAD_SESSION_NOT_FOUND,
      400,
      'Upload session not found or expired',
    );
  }

  const { buffer, filename, fileType } = assembled;

  const mimeAllowed = ALLOWED_MIME_PREFIXES.some((prefix) =>
    fileType.toLowerCase().startsWith(prefix),
  );
  if (!mimeAllowed) {
    await cleanupSession(sessionId);
    return NextResponse.json(
      {
        error: `File type "${fileType}" is not allowed. Only image/* and video/* files are accepted.`,
      },
      { status: 400 },
    );
  }

  const header = new Uint8Array(buffer.subarray(0, 12));
  if (!hasValidMagicBytes(header)) {
    await cleanupSession(sessionId);
    log.warn('Rejected spoofed MIME type', {
      type: fileType,
      ip,
      header: bufToHex(header),
    });
    return NextResponse.json(
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
      type: fileType,
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
    return NextResponse.json(
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
    return NextResponse.json(
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
  return NextResponse.json({ cid });
}
