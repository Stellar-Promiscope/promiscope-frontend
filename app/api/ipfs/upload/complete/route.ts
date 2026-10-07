import { NextRequest, NextResponse } from 'next/server';
import { apiError, ApiErrorCode } from '@/lib/apiErrors';
import { privateJson } from '@/lib/httpResponses';
import {
  prepareStreamedAssembly,
  cleanupSession,
  getSessionStatus,
  isSessionOwner,
} from '@/lib/chunkedUploadStore';
import {
  buildStreamingMultipartBody,
  streamFileBytes,
} from '@/lib/streamingMultipart';
import {
  detectFileType,
  isDeclaredTypeCompatible,
  bufToHex,
} from '@/lib/fileSignature';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { getSessionWallet } from '@/lib/session';
import { createRequestLogger } from '@/lib/logger';
import { withOutboundSpan, withRouteTelemetry } from '@/lib/telemetry';
import {
  getPinataCredentials,
  getMissingPinataEnvVars,
  PINATA_NOT_CONFIGURED_ERROR,
} from '@/lib/pinataConfig';
import {
  verifyUploadedDigest,
  UploadVerificationError,
} from '@/lib/uploadVerification';

export const runtime = 'nodejs';

/**
 * POST /api/ipfs/upload/complete
 *
 * Streams every chunk of a session to Pinata as one multipart file upload
 * without ever concatenating the file into memory (issue #1295):
 *
 *  1. `prepareStreamedAssembly()` validates the session, asserts stored
 *     bytes === declared fileSize from SQLite aggregates, and precomputes
 *     the sha256 over one-at-a-time chunk reads.
 *  2. MIME + magic-byte gates run on the streamed header *before* any byte
 *     is pinned.
 *  3. The multipart body streams boundary headers, then each chunk in
 *     order, then the closing boundary — Pinata still receives exactly one
 *     complete file in one `pinFileToIPFS` request.
 *  4. Integrity verification compares the assembly digest against a
 *     streamed hash of the gateway response (issue #699, streamed).
 *
 * The session is cleaned up only after Pinata + verification succeed (or
 * on 400-class validation failures); Pinata/verification failures preserve
 * it so a retry skips re-uploading chunks.
 */
const RATE_LIMIT = { limit: 20, windowMs: 60 * 1000 };

const ALLOWED_MIME_PREFIXES = ['image/', 'video/'];

async function postCompleteUpload(req: NextRequest) {
  const log = createRequestLogger(req);
  const pinata = getPinataCredentials();
  if (!pinata) {
    log.error('Pinata credentials missing; IPFS uploads disabled', {
      missing: getMissingPinataEnvVars().join(', '),
    });
    return NextResponse.json(
      { error: PINATA_NOT_CONFIGURED_ERROR },
      { status: 503 },
    );
  }
  const wallet = getSessionWallet(req);
  const ip = getClientIp(req);
  const key = wallet ? `wallet:${wallet}` : ip;
  const rl = await checkRateLimit(`ipfs-upload-complete:${key}`, RATE_LIMIT);
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

  let assembly;
  try {
    assembly = await prepareStreamedAssembly(sessionId);
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

  const { filename, fileType } = assembly;

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

  // Magic-byte gate on the streamed header — before any byte is pinned.
  const header = new Uint8Array(assembly.header);
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
  const pinStartedAt = Date.now();
  try {
    cid = await withOutboundSpan(
      'pinata.pinFileToIPFS',
      { dependency: 'pinata', operation: 'pinFileToIPFS' },
      () => pinStreamedFileToIPFS(assembly),
    );
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
      { status: upstreamStatus(err) === 504 ? 504 : 502 },
    );
  }

  // Post-upload integrity verification (issue #699, streamed for #1295):
  // compare the assembly digest against a streamed hash of the gateway
  // response — never buffering either side. See lib/uploadVerification.ts
  // for why this checks gateway-retrievable bytes rather than recomputing
  // the CID itself.
  try {
    const gatewayOverride = (globalThis as unknown as Record<string, unknown>)
      .__gatewayStreamForTests as
      | (() => AsyncIterable<Uint8Array | Buffer>)
      | undefined;
    await withOutboundSpan(
      'ipfs.upload.verify',
      { dependency: 'ipfs-gateway', operation: 'verify-upload' },
      () => verifyUploadedDigest(cid, assembly.sha256, gatewayOverride),
    );
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

/**
 * Streams one multipart file part to Pinata's `pinFileToIPFS` and returns
 * the resulting `IpfsHash`. Uses global fetch with `duplex: 'half'` so the
 * request body is the lazily-pulled chunk stream — axios would buffer the
 * whole body before sending.
 *
 * Exported for tests: `__pinStreamedFileToIPFSForTests` overrides the
 * network hop (drain the stream + return a canned CID) while still proving
 * the route streamed the exact file bytes.
 */
export async function pinStreamedFileToIPFS(assembly: {
  filename: string;
  fileType: string;
  totalBytes: number;
  chunks: () => Generator<Buffer, void, void>;
}): Promise<string> {
  const override = (globalThis as unknown as Record<string, unknown>)
    .__pinStreamedFileToIPFSForTests as
    | ((assembly: {
        filename: string;
        fileType: string;
        totalBytes: number;
        chunks: () => Generator<Buffer, void, void>;
      }) => Promise<string>)
    | undefined;
  if (override) return override(assembly);

  const boundary = `----promiscope-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const { stream, contentLength, contentType } = buildStreamingMultipartBody(
    boundary,
    assembly.filename,
    assembly.fileType,
    assembly.totalBytes,
    assembly.chunks,
  );
  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(contentLength),
      pinata_api_key: process.env.PINATA_API_KEY ?? '',
      pinata_secret_api_key: process.env.PINATA_SECRET ?? '',
    },
    body: stream as unknown as BodyInit,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  if (!res.ok) {
    throw new Error(`Pinata upload failed with status ${res.status}`);
  }
  const data = (await res.json()) as { IpfsHash?: string };
  if (!data.IpfsHash) {
    throw new Error('Pinata response missing IpfsHash');
  }
  return data.IpfsHash;
}

/** Test helper: drains the streamed file bytes (no framing) into memory. */
export async function collectStreamedFileBytes(
  chunks: () => Generator<Buffer, void, void>,
): Promise<Buffer> {
  const pieces: Uint8Array[] = [];
  for await (const piece of streamFileBytes(chunks)) {
    pieces.push(piece);
  }
  return Buffer.concat(pieces);
}
export const POST = withRouteTelemetry(
  postCompleteUpload,
  '/api/ipfs/upload/complete',
);
