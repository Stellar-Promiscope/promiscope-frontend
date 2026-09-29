import { NextRequest } from 'next/server';
import { initSession } from '@/lib/chunkedUploadStore';
import { getSessionWallet } from '@/lib/session';
import { getClientIp, createRateLimiter } from '@/lib/uploadRateLimit';
import { privateJson } from '@/lib/httpResponses';
import { createRequestLogger } from '@/lib/logger';
import {
  getPinataCredentials,
  getMissingPinataEnvVars,
  PINATA_NOT_CONFIGURED_ERROR,
} from '@/lib/pinataConfig';

export const runtime = 'nodejs';

/**
 * POST /api/ipfs/upload/init
 *
 * Starts a chunked/resumable upload session. Body: JSON
 * `{ filename, fileType, fileSize, totalChunks }`. Returns `{ sessionId }`.
 *
 * Validates size/type up front (mirroring app/api/ipfs/upload's checks) so
 * an obviously-invalid upload is rejected before the client spends any
 * bandwidth on chunks. The magic-byte check is deferred to /complete, since
 * only the first chunk carries the file's leading bytes.
 */
const checkRateLimit = createRateLimiter(20, 60 * 1000);

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ['image/', 'video/'];
/** Chunks smaller than this would multiply request count for no benefit. */
const MIN_CHUNK_SIZE_BYTES = 64 * 1024;
const MAX_CHUNKS = 5000;

export async function POST(req: NextRequest) {
  const log = createRequestLogger(req);
  if (!getPinataCredentials()) {
    log.error('Pinata credentials missing; IPFS uploads disabled', {
      missing: getMissingPinataEnvVars().join(', '),
    });
    return privateJson(
      { error: PINATA_NOT_CONFIGURED_ERROR },
      { status: 503 },
    );
  }
  const wallet = getSessionWallet(req);
  const ip = getClientIp(req);
  const key = wallet ? `wallet:${wallet}` : ip;
  const rl = checkRateLimit(key);
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

  const { filename, fileType, fileSize, totalChunks } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof filename !== 'string' || !filename.trim()) {
    return privateJson({ error: 'filename is required' }, { status: 400 });
  }

  if (
    typeof fileType !== 'string' ||
    !ALLOWED_MIME_PREFIXES.some((prefix) =>
      fileType.toLowerCase().startsWith(prefix),
    )
  ) {
    return privateJson(
      {
        error: `File type "${fileType}" is not allowed. Only image/* and video/* files are accepted.`,
      },
      { status: 400 },
    );
  }

  if (
    typeof fileSize !== 'number' ||
    !Number.isFinite(fileSize) ||
    fileSize <= 0
  ) {
    return privateJson(
      { error: 'fileSize must be a positive number' },
      { status: 400 },
    );
  }

  if (fileSize > MAX_FILE_SIZE_BYTES) {
    return privateJson(
      {
        error: `File exceeds the 100 MB size limit (received ${(fileSize / 1024 / 1024).toFixed(1)} MB)`,
      },
      { status: 400 },
    );
  }

  if (
    typeof totalChunks !== 'number' ||
    !Number.isInteger(totalChunks) ||
    totalChunks <= 0
  ) {
    return privateJson(
      { error: 'totalChunks must be a positive integer' },
      { status: 400 },
    );
  }

  if (totalChunks > MAX_CHUNKS) {
    return privateJson(
      { error: 'totalChunks is unreasonably high' },
      { status: 400 },
    );
  }

  if (totalChunks > 1 && fileSize / totalChunks < MIN_CHUNK_SIZE_BYTES) {
    return privateJson(
      { error: 'Chunk count too high for the given file size' },
      { status: 400 },
    );
  }

  const { sessionId } = await initSession({
    filename,
    fileType,
    fileSize,
    totalChunks,
    ownerWallet: wallet,
  });
  return privateJson({ sessionId }, { status: 201 });
}
