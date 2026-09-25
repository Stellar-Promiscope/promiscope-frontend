import axios from 'axios';
import { IPFS_FALLBACK_GATEWAYS } from './ipfsGateways';

const PRIMARY_GATEWAY =
  process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? 'https://gateway.pinata.cloud/ipfs';

/**
 * Default ordered list of fallback IPFS gateways used when the primary gateway
 * returns a 4xx or 5xx response or times out.
 *
 * Exported so consumers and test suites can reference or override the list.
 */
export const DEFAULT_IPFS_FALLBACKS: string[] = [...IPFS_FALLBACK_GATEWAYS];

/** Timeout per gateway attempt in milliseconds. */
const ATTEMPT_TIMEOUT_MS = 8_000;

/**
 * Upload a file to IPFS via the internal API route in a single request.
 * Prefer {@link uploadToIPFSChunked} for large files (e.g. highlight-reel
 * videos) on unreliable connections — a dropped connection here means
 * starting over from byte zero.
 *
 * @param file - The file to upload.
 * @returns The IPFS CID string assigned by the pinning service.
 */
export async function uploadToIPFS(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);

  const { data } = await axios.post('/api/ipfs/upload', form);
  return data.cid as string;
}

// ── Chunked / resumable upload ──────────────────────────────────────────────
//
// Splits a file into fixed-size chunks and uploads them one at a time
// against app/api/ipfs/upload/{init,chunk,complete} — tuned for the
// low-bandwidth, high-latency mobile connections this product targets
// (issue #664). Each chunk is retried independently with exponential
// backoff before the whole upload gives up, and a failure after exhausting
// retries throws a {@link ChunkedUploadError} carrying enough state
// (`sessionId`, `uploadedChunks`) for a caller to resume from the last
// successfully received chunk rather than restarting the whole file.

/** 1 MB — small enough to complete (or fail) quickly on a weak connection. */
export const CHUNK_SIZE_BYTES = 1 * 1024 * 1024;

/** Per-chunk retry attempts before the upload surfaces as resumable-but-failed. */
const MAX_CHUNK_RETRIES = 4;

/** Base delay for exponential backoff between chunk retries. */
const RETRY_BASE_DELAY_MS = 500;

/**
 * Thrown when a chunk fails after exhausting retries. Carries the session
 * state needed to resume: pass `sessionId` back into
 * {@link uploadToIPFSChunked}'s `resumeSessionId` option to continue from
 * the next unsent chunk instead of re-uploading the whole file.
 */
export class ChunkedUploadError extends Error {
  sessionId: string;
  uploadedChunks: number;
  totalChunks: number;
  retryAfterSec?: number;

  constructor(
    message: string,
    sessionId: string,
    uploadedChunks: number,
    totalChunks: number,
    retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'ChunkedUploadError';
    this.sessionId = sessionId;
    this.uploadedChunks = uploadedChunks;
    this.totalChunks = totalChunks;
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * `uploading` covers the byte-transfer of chunks to our server, which has
 * real, granular progress. `processing` covers the server assembling the
 * chunks and pinning the result to IPFS/Pinata via `/complete` — a single
 * request with no sub-progress, so it's surfaced as a distinct phase rather
 * than a progress percentage that would otherwise appear stuck at 100%.
 */
export type ChunkedUploadPhase = 'uploading' | 'processing';

export interface ChunkedUploadOptions {
  /** Called after each chunk is confirmed uploaded, with overall progress in [0, 1]. */
  onProgress?: (fraction: number) => void;
  /** Called when the upload transitions between phases. */
  onPhaseChange?: (phase: ChunkedUploadPhase) => void;
  /**
   * Resume a previously started (and since-failed) session instead of
   * calling /init again — skips straight to uploading whatever chunks the
   * server doesn't already have.
   */
  resumeSessionId?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadChunkWithRetry(
  sessionId: string,
  chunkIndex: number,
  blob: Blob,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_CHUNK_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
    try {
      const form = new FormData();
      form.set('sessionId', sessionId);
      form.set('chunkIndex', String(chunkIndex));
      form.set('chunk', blob);
      await axios.post('/api/ipfs/upload/chunk', form);
      return;
    } catch (err) {
      lastErr = err;
      // If this is a 429 response, extract retryAfterSec and throw immediately
      // rather than retrying (retries won't help against a rate limit)
      if (axios.isAxiosError(err) && err.response?.status === 429) {
        const retryAfter = (err.response?.headers as any)?.['retry-after'];
        const retryAfterSec = retryAfter ? parseInt(retryAfter, 10) : undefined;
        throw new ChunkedUploadError(
          'Upload rate limited. Please wait and try again.',
          sessionId,
          chunkIndex,
          0, // totalChunks not known at this point
          retryAfterSec,
        );
      }
      // Other 4xx responses (bad chunk index, unknown/expired session) won't
      // succeed on retry — surface them immediately.
      if (
        axios.isAxiosError(err) &&
        err.response &&
        err.response.status >= 400 &&
        err.response.status < 500
      ) {
        throw err;
      }
    }
  }
  throw lastErr;
}

/**
 * Fetches which chunk indices a session has already received — used both
 * internally (resuming from a `resumeSessionId`) and by callers that want
 * to inspect progress independently.
 */
export async function getChunkedUploadStatus(
  sessionId: string,
): Promise<{ receivedChunks: number[]; totalChunks: number }> {
  const { data } = await axios.get('/api/ipfs/upload/status', {
    params: { sessionId },
  });
  return data;
}

/**
 * Uploads a file in fixed-size chunks that can resume after a mid-transfer
 * failure instead of restarting from byte zero.
 *
 * @param file - The file to upload.
 * @param options - Progress callback and/or a session id to resume.
 * @returns The IPFS CID string assigned by the pinning service.
 * @throws {ChunkedUploadError} When a chunk fails after exhausting retries —
 *   catch this and pass `err.sessionId` as `resumeSessionId` on retry.
 */
export async function uploadToIPFSChunked(
  file: File,
  options: ChunkedUploadOptions = {},
): Promise<string> {
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE_BYTES));

  options.onPhaseChange?.('uploading');

  let sessionId = options.resumeSessionId;
  let startChunk = 0;

  if (sessionId) {
    const status = await getChunkedUploadStatus(sessionId);
    startChunk = status.receivedChunks.length;
  } else {
    try {
      const { data } = await axios.post('/api/ipfs/upload/init', {
        filename: file.name,
        fileType: file.type,
        fileSize: file.size,
        totalChunks,
      });
      sessionId = data.sessionId as string;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 429) {
        const retryAfter = (err.response?.headers as any)?.['retry-after'];
        const retryAfterSec = retryAfter ? parseInt(retryAfter, 10) : undefined;
        throw new ChunkedUploadError(
          'Upload rate limited. Please wait and try again.',
          '',
          0,
          totalChunks,
          retryAfterSec,
        );
      }
      throw err;
    }
  }

  options.onProgress?.(startChunk / totalChunks);

  for (let i = startChunk; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE_BYTES;
    const end = Math.min(start + CHUNK_SIZE_BYTES, file.size);
    const chunkBlob = file.slice(start, end);

    try {
      await uploadChunkWithRetry(sessionId, i, chunkBlob);
    } catch {
      throw new ChunkedUploadError(
        'Upload interrupted. You can resume from where it left off.',
        sessionId,
        i,
        totalChunks,
      );
    }
    options.onProgress?.((i + 1) / totalChunks);
  }

  options.onPhaseChange?.('processing');
  try {
    const { data } = await axios.post('/api/ipfs/upload/complete', {
      sessionId,
    });
    return data.cid as string;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 429) {
      const retryAfter = (err.response?.headers as any)?.['retry-after'];
      const retryAfterSec = retryAfter ? parseInt(retryAfter, 10) : undefined;
      throw new ChunkedUploadError(
        'Upload rate limited. Please wait and try again.',
        sessionId,
        totalChunks,
        totalChunks,
        retryAfterSec,
      );
    }
    throw err;
  }
}

/**
 * Resolve a full URL for an IPFS CID, with automatic gateway fallback.
 *
 * Tries the primary gateway first (`NEXT_PUBLIC_IPFS_GATEWAY`). If the request
 * returns a 4xx or 5xx status, or times out after 8 seconds, it retries with
 * each gateway in `fallbacks` (defaults to {@link DEFAULT_IPFS_FALLBACKS}).
 *
 * A console warning is emitted whenever a fallback gateway is used.
 *
 * @param cid       - The IPFS content identifier to resolve.
 * @param fallbacks - Optional ordered list of fallback gateway base URLs.
 *                    Defaults to {@link DEFAULT_IPFS_FALLBACKS}.
 * @returns The resolved URL string from the first gateway that responds successfully.
 *
 * @throws {Error} When all gateways (primary + all fallbacks) are exhausted without
 *                 a successful response.
 *
 * @example
 * // Basic usage — uses default fallbacks
 * const url = await ipfsUrl("QmXyz...");
 *
 * @example
 * // Custom fallback list
 * const url = await ipfsUrl("QmXyz...", ["https://my-gateway.example.com/ipfs"]);
 */
export async function ipfsUrl(
  cid: string,
  fallbacks: string[] = DEFAULT_IPFS_FALLBACKS,
): Promise<string> {
  const gateways = [PRIMARY_GATEWAY, ...fallbacks];

  for (let i = 0; i < gateways.length; i++) {
    const gateway = gateways[i];
    const url = `${gateway}/${cid}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        if (i > 0) {
          console.warn(
            `[ipfs] Primary gateway unavailable. Using fallback gateway: ${gateway}`,
          );
        }
        return url;
      }

      // 4xx / 5xx — try next gateway
      console.warn(
        `[ipfs] Gateway ${gateway} returned ${response.status}. Trying next fallback…`,
      );
    } catch {
      clearTimeout(timeoutId);
      console.warn(
        `[ipfs] Gateway ${gateway} failed (timeout or network error). Trying next fallback…`,
      );
    }
  }

  throw new Error(
    `[ipfs] All gateways exhausted for CID "${cid}". Tried: ${gateways.join(', ')}`,
  );
}
