import { NextRequest, NextResponse } from 'next/server';
import { apiError, ApiErrorCode } from '@/lib/apiErrors';
import {
  writeChunk,
  CHUNK_SIZE_BYTES,
  ChunkTooLargeError,
  TotalSizeExceededError,
} from '@/lib/chunkedUploadStore';
import { getClientIp, createRateLimiter } from '@/lib/uploadRateLimit';
import { getSessionWallet } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * POST /api/ipfs/upload/chunk
 *
 * Uploads one chunk of an in-progress session (multipart form:
 * `sessionId`, `chunkIndex`, `chunk`). Idempotent per index — re-uploading
 * the same chunk after a retry just overwrites it — so the client's
 * per-chunk retry loop (lib/ipfs.ts's uploadToIPFSChunked) doesn't need to
 * coordinate anything beyond "did this request succeed."
 *
 * A single upload legitimately issues many small requests here, so this
 * route's rate limit is much higher than the whole-file upload route's.
 *
 * Issue #1294: enforces per-chunk and total size limits so a client can't
 * declare 1 MB at /init and stream gigabytes through here:
 *  - Content-Length is checked *before* `req.formData()` buffers the body,
 *    so oversized requests are rejected without reading them fully.
 *  - After parsing, the chunk's byte length is checked against the expected
 *    size for that index (CHUNK_SIZE_BYTES for non-final chunks with a
 *    small multipart tolerance; smaller allowed for the final chunk) via
 *    writeChunk's own per-chunk + running-total checks.
 */
const checkRateLimit = createRateLimiter(600, 60 * 1000);

/**
 * Multipart framing overhead allowance when pre-checking Content-Length
 * before parsing: boundaries, part headers and field values for
 * sessionId/chunkIndex. The check is intentionally coarse — the authoritative
 * per-chunk byte check happens after parsing in writeChunk().
 */
const MULTIPART_OVERHEAD_TOLERANCE_BYTES = 64 * 1024;

export async function POST(req: NextRequest) {
  const wallet = getSessionWallet(req);
  const ip = getClientIp(req);
  const key = wallet ? `wallet:${wallet}` : ip;
  const rl = checkRateLimit(key);
  if (rl.limited) {
    const retryAfter = rl.retryAfterSec ?? 60;
    return apiError(
      ApiErrorCode.RATE_LIMITED,
      429,
      'Too many requests',
      undefined,
      { headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  // Reject obviously-huge bodies before Next buffers the whole multipart
  // payload into memory via formData(). A legitimate chunk request carries
  // at most one CHUNK_SIZE_BYTES chunk plus multipart framing for the
  // sessionId/chunkIndex fields, so anything beyond that (+ tolerance) is
  // rejected up front; the authoritative per-index check still happens in
  // writeChunk() after parsing.
  const contentLengthRaw = req.headers.get('content-length');
  if (contentLengthRaw !== null) {
    const contentLength = Number(contentLengthRaw);
    if (
      Number.isFinite(contentLength) &&
      contentLength > CHUNK_SIZE_BYTES + MULTIPART_OVERHEAD_TOLERANCE_BYTES
    ) {
      return NextResponse.json(
        { error: `Chunk exceeds the ${CHUNK_SIZE_BYTES}-byte limit` },
        { status: 413 },
      );
    }
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError(ApiErrorCode.INVALID_REQUEST, 400, 'Invalid form data');
  }

  const sessionId = form.get('sessionId');
  const chunkIndexRaw = form.get('chunkIndex');
  const chunk = form.get('chunk');

  if (typeof sessionId !== 'string' || !sessionId) {
    return apiError(ApiErrorCode.INVALID_REQUEST, 400, 'sessionId is required');
  }
  if (typeof chunkIndexRaw !== 'string' || !/^\d+$/.test(chunkIndexRaw)) {
    return apiError(
      ApiErrorCode.INVALID_REQUEST,
      400,
      'chunkIndex must be a non-negative integer',
    );
  }
  if (!(chunk instanceof Blob)) {
    return apiError(ApiErrorCode.INVALID_REQUEST, 400, 'chunk is required');
  }

  const chunkIndex = Number(chunkIndexRaw);
  // Cheap pre-check from the Blob's declared size before copying bytes.
  if (chunk.size > CHUNK_SIZE_BYTES + MULTIPART_OVERHEAD_TOLERANCE_BYTES) {
    return NextResponse.json(
      { error: `Chunk exceeds the ${CHUNK_SIZE_BYTES}-byte limit` },
      { status: 413 },
    );
  }
  const buffer = Buffer.from(await chunk.arrayBuffer());

  try {
    const status = await writeChunk(sessionId, chunkIndex, buffer);
    return NextResponse.json(status);
  } catch (err) {
    if (err instanceof ChunkTooLargeError) {
      return NextResponse.json({ error: err.message }, { status: 413 });
    }
    if (err instanceof TotalSizeExceededError) {
      return NextResponse.json({ error: err.message }, { status: 413 });
    }
    // An out-of-range index is a validation error, not a missing session.
    if (err instanceof Error && err.message === 'Chunk index out of range') {
      return apiError(
        ApiErrorCode.CHUNK_INDEX_OUT_OF_RANGE,
        400,
        'Chunk index out of range',
      );
    }
    const message =
      err instanceof Error ? err.message : 'Failed to write chunk';
    if (!/not found or expired/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return apiError(
      ApiErrorCode.UPLOAD_SESSION_NOT_FOUND,
      404,
      'Upload session not found or expired',
    );
  }
}
