import { NextRequest, NextResponse } from 'next/server';
import { apiError, ApiErrorCode } from '@/lib/apiErrors';
import { writeChunk } from '@/lib/chunkedUploadStore';
import { getClientIp, createRateLimiter } from '@/lib/uploadRateLimit';

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
 */
const checkRateLimit = createRateLimiter(600, 60 * 1000);

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(ip);
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
  const buffer = Buffer.from(await chunk.arrayBuffer());

  try {
    const status = await writeChunk(sessionId, chunkIndex, buffer);
    return NextResponse.json(status);
  } catch (err) {
    // An out-of-range index is a validation error, not a missing session.
    if (err instanceof Error && err.message === 'Chunk index out of range') {
      return apiError(
        ApiErrorCode.CHUNK_INDEX_OUT_OF_RANGE,
        400,
        'Chunk index out of range',
      );
    }
    return apiError(
      ApiErrorCode.UPLOAD_SESSION_NOT_FOUND,
      404,
      'Upload session not found or expired',
    );
  }
}
