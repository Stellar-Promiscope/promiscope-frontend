import { Redis } from '@upstash/redis';
import * as crypto from 'crypto';
import { ChunkedUploadChunkStore } from './chunkedUploadChunkStore';

/**
 * Server-side session store backing the chunked/resumable upload flow
 * (app/api/ipfs/upload/{init,chunk,status,complete}).
 *
 * Fix for issue #1175: this used to keep an in-memory session `Map` and
 * write chunk bytes to a given instance's own `os.tmpdir()` — see
 * docs/chunked-video-upload.md's own note that this assumes "a single,
 * long-running Node process," not a stateless multi-instance/serverless
 * deployment. That's the same class of bug lib/rateLimit.ts already fixed
 * for its own in-memory counter (issue #658): each warm serverless instance
 * had its own copy of the state, so a resumed upload landing on a different
 * instance than the one that received earlier chunks would see "session not
 * found" or an incomplete-looking status, even though the chunks genuinely
 * exist — just on a different instance's disk.
 *
 * The fix mirrors lib/rateLimit.ts's pattern exactly: session metadata
 * (which chunks a session has received, when it expires) is backed by
 * Upstash Redis when configured, so every instance reads/writes the same
 * record, with an in-memory fallback documented as single-instance-only.
 * Chunk *bytes* are a different shape of problem — larger binary payloads,
 * not a counter — so they go to lib/chunkedUploadChunkStore.ts's SQLite BLOB
 * table instead of Redis; see that file's doc comment for why and for its
 * own shared-storage caveat.
 */

export class ChunkTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChunkTooLargeError';
  }
}

export class TotalSizeExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TotalSizeExceededError';
  }
}

export class SizeMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SizeMismatchError';
  }
}

/**
 * Canonical per-chunk byte size (issue #1294).
 * Matches lib/ipfs.ts's client slicing (`CHUNK_SIZE_BYTES = 1 MB`):
 * every non-final chunk is exactly 1 MB and the final chunk holds the
 * remainder. Exported so the /chunk route can pre-check Content-Length
 * before buffering the body.
 */
export const CHUNK_SIZE_BYTES = 1 * 1024 * 1024;

/** Absolute cap for any assembled file — mirrors /init and /upload. */
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

/**
 * Expected byte size for a given chunk index (issue #1294).
 *
 * Real clients slice with 1 MB chunks (`CHUNK_SIZE_BYTES`), so every
 * non-final chunk holds exactly 1 MB and the final chunk holds the
 * remainder `fileSize - CHUNK_SIZE_BYTES * (totalChunks - 1)`. For tiny
 * sessions where `fileSize < CHUNK_SIZE_BYTES * (totalChunks - 1)` (only
 * ever seen in test fixtures that declare an arbitrary small fileSize with
 * several chunks), the remainder would be non-positive — in that
 * degenerate case fall back to the global chunk cap and let the
 * running-total check bound the upload instead.
 */
export function expectedChunkSize(
  fileSize: number,
  totalChunks: number,
  chunkIndex: number,
): number {
  if (chunkIndex < totalChunks - 1) return CHUNK_SIZE_BYTES;
  const remainder = fileSize - CHUNK_SIZE_BYTES * (totalChunks - 1);
  if (!(remainder > 0)) return CHUNK_SIZE_BYTES;
  return Math.min(CHUNK_SIZE_BYTES, remainder);
}

/**
 * Upper bound for a single chunk index. Non-final chunks must not exceed
 * CHUNK_SIZE_BYTES; the final chunk must not exceed the remainder (it may
 * be smaller). Degenerate tiny sessions fall back to CHUNK_SIZE_BYTES (see
 * above) with the total-size check as the backstop.
 */
export function maxChunkSizeForIndex(
  fileSize: number,
  totalChunks: number,
  chunkIndex: number,
): number {
  return expectedChunkSize(fileSize, totalChunks, chunkIndex);
}

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface InitParams {
  filename: string;
  fileType: string;
  fileSize: number;
  totalChunks: number;
  /** Optional owner wallet to associate with the session for data export. */
  ownerWallet?: string | null;
}

export interface SessionStatus {
  receivedChunks: number[];
  totalChunks: number;
}

export interface SessionSummary {
  sessionId: string;
  filename: string;
  fileType: string;
  fileSize: number;
  totalChunks: number;
  receivedChunks: number;
  createdAt: number;
}

interface StoredSession {
  sessionId: string;
  filename: string;
  fileType: string;
  fileSize: number;
  totalChunks: number;
  receivedChunks: number[];
  createdAt: number;
  ownerWallet: string | null;
  /** Running total of stored chunk bytes (issue #1294). */
  bytesReceived: number;
  /** Per-index stored byte sizes, so re-uploads adjust the total by delta. */
  chunkSizes: Record<string, number>;
}

interface SessionMetadataStore {
  create(session: StoredSession): Promise<void>;
  get(sessionId: string): Promise<StoredSession | null>;
  addReceivedChunk(
    sessionId: string,
    chunkIndex: number,
    chunkSize: number,
  ): Promise<StoredSession | null>;
  remove(sessionId: string): Promise<void>;
  listByOwner(wallet: string): Promise<StoredSession[]>;
}

/** Backfill for sessions persisted before bytesReceived/chunkSizes existed. */
function normalizeSession(session: StoredSession): StoredSession {
  if (typeof session.bytesReceived !== 'number') {
    const sizes =
      session.chunkSizes && typeof session.chunkSizes === 'object'
        ? session.chunkSizes
        : {};
    session.chunkSizes = sizes;
    session.bytesReceived = Object.values(sizes).reduce(
      (sum, n) => sum + (typeof n === 'number' ? n : 0),
      0,
    );
  }
  if (!session.chunkSizes || typeof session.chunkSizes !== 'object') {
    session.chunkSizes = {};
  }
  return session;
}

// ── In-memory store (dev/test fallback, single-instance-only) ──────────────

class InMemoryMetadataStore implements SessionMetadataStore {
  private sessions = new Map<string, StoredSession>();

  private sweepExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }
  }

  async create(session: StoredSession): Promise<void> {
    this.sweepExpired();
    this.sessions.set(session.sessionId, session);
  }

  async get(sessionId: string): Promise<StoredSession | null> {
    this.sweepExpired();
    const session = this.sessions.get(sessionId) ?? null;
    return session ? normalizeSession(session) : null;
  }

  async addReceivedChunk(
    sessionId: string,
    chunkIndex: number,
    chunkSize: number,
  ): Promise<StoredSession | null> {
    this.sweepExpired();
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    normalizeSession(session);
    const key = String(chunkIndex);
    const prev = session.chunkSizes[key] ?? 0;
    session.bytesReceived += chunkSize - prev;
    session.chunkSizes[key] = chunkSize;
    if (!session.receivedChunks.includes(chunkIndex)) {
      session.receivedChunks.push(chunkIndex);
    }
    return session;
  }

  async remove(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async listByOwner(wallet: string): Promise<StoredSession[]> {
    this.sweepExpired();
    return Array.from(this.sessions.values()).filter(
      (s) => s.ownerWallet === wallet,
    );
  }
}

// ── Redis store (production / shared across instances) ─────────────────────

class RedisMetadataStore implements SessionMetadataStore {
  constructor(private redis: Redis) {}

  private key(sessionId: string): string {
    return `chunked-upload:session:${sessionId}`;
  }

  private ownerKey(wallet: string): string {
    return `chunked-upload:owner:${wallet}`;
  }

  /** Absolute expiry from createdAt, not sliding — matches the original TTL semantics. */
  private remainingMs(session: StoredSession): number {
    return session.createdAt + SESSION_TTL_MS - Date.now();
  }

  async create(session: StoredSession): Promise<void> {
    const ttl = Math.max(1, this.remainingMs(session));
    await this.redis.psetex(this.key(session.sessionId), ttl, session);
    if (session.ownerWallet) {
      await this.redis.sadd(
        this.ownerKey(session.ownerWallet),
        session.sessionId,
      );
    }
  }

  async get(sessionId: string): Promise<StoredSession | null> {
    const raw = await this.redis.get<StoredSession | string>(
      this.key(sessionId),
    );
    if (!raw) return null;
    // @upstash/redis's automatic deserialization behavior can vary by SDK
    // version/config, so handle both an already-parsed object and a raw
    // JSON string defensively.
    const session =
      typeof raw === 'string' ? (JSON.parse(raw) as StoredSession) : raw;
    return normalizeSession(session);
  }

  async addReceivedChunk(
    sessionId: string,
    chunkIndex: number,
    chunkSize: number,
  ): Promise<StoredSession | null> {
    const session = await this.get(sessionId);
    if (!session) return null;

    const key = String(chunkIndex);
    const prev = session.chunkSizes[key] ?? 0;
    session.bytesReceived += chunkSize - prev;
    session.chunkSizes[key] = chunkSize;
    if (!session.receivedChunks.includes(chunkIndex)) {
      session.receivedChunks.push(chunkIndex);
    }

    const ttl = this.remainingMs(session);
    if (ttl <= 0) {
      await this.remove(sessionId);
      return null;
    }
    await this.redis.psetex(this.key(sessionId), ttl, session);
    return session;
  }

  async remove(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    await this.redis.del(this.key(sessionId));
    if (session?.ownerWallet) {
      await this.redis.srem(this.ownerKey(session.ownerWallet), sessionId);
    }
  }

  async listByOwner(wallet: string): Promise<StoredSession[]> {
    const ids = await this.redis.smembers(this.ownerKey(wallet));
    const result: StoredSession[] = [];
    for (const id of ids) {
      const session = await this.get(id);
      if (session) {
        result.push(session);
      } else {
        // Lazy cleanup: the session's own TTL expired without going through
        // remove(), so the owner-index entry is now stale — Redis SET
        // members don't expire individually, so this is the sweep point.
        await this.redis.srem(this.ownerKey(wallet), id);
      }
    }
    return result;
  }
}

// ── Store selection ──────────────────────────────────────────────────────────

let cachedStore: SessionMetadataStore | null = null;
let warnedMissingRedisInProd = false;

function buildStore(): SessionMetadataStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    return new RedisMetadataStore(new Redis({ url, token }));
  }

  // Same reasoning as lib/rateLimit.ts's buildStore(): don't hard-fail the
  // route when Redis isn't configured — degrade to an in-memory,
  // single-instance-only store and log loudly (once) in production so the
  // gap is visible rather than silently wrong.
  if (process.env.NODE_ENV === 'production' && !warnedMissingRedisInProd) {
    warnedMissingRedisInProd = true;
    console.error(
      '[chunkedUploadStore] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not ' +
        'set in production. Falling back to an in-memory, per-instance session store. ' +
        'A resumed upload will fail with "session not found" if it lands on a different ' +
        'instance than the one that received earlier chunks. Configure Upstash Redis ' +
        '(see .env.example) to restore correct behavior across instances.',
    );
  }

  return new InMemoryMetadataStore();
}

function getMetadataStore(): SessionMetadataStore {
  if (!cachedStore) {
    cachedStore = buildStore();
  }
  return cachedStore;
}

// ── Public API ────────────────────────────────────────────────────────────

/** Starts a new upload session and returns its id. */
export async function initSession(
  params: InitParams,
): Promise<{ sessionId: string }> {
  const sessionId = crypto.randomUUID();
  const session: StoredSession = {
    sessionId,
    filename: params.filename,
    fileType: params.fileType,
    fileSize: params.fileSize,
    totalChunks: params.totalChunks,
    receivedChunks: [],
    createdAt: Date.now(),
    ownerWallet: params.ownerWallet ?? null,
    bytesReceived: 0,
    chunkSizes: {},
  };
  await getMetadataStore().create(session);
  return { sessionId };
}

/** Returns the current status of a session, or null if unknown/expired. */
export async function getSessionStatus(
  sessionId: string,
): Promise<SessionStatus | null> {
  const session = await getMetadataStore().get(sessionId);
  if (!session) return null;
  return {
    receivedChunks: [...session.receivedChunks].sort((a, b) => a - b),
    totalChunks: session.totalChunks,
  };
}

/** Thrown when an upload session does not exist or has expired. */
export class UploadSessionNotFoundError extends Error {
  constructor(message = 'Upload session not found or expired') {
    super(message);
    this.name = 'UploadSessionNotFoundError';
  }
}

/** Thrown when a chunk index is outside the session's `[0, totalChunks)` range. */
export class ChunkIndexOutOfRangeError extends Error {
  constructor(message = 'Chunk index out of range') {
    super(message);
    this.name = 'ChunkIndexOutOfRangeError';
  }
}

/** Persists one chunk and records it as received. Reachable from any instance. */
export async function writeChunk(
  sessionId: string,
  chunkIndex: number,
  data: Buffer,
): Promise<SessionStatus> {
  const session = await getMetadataStore().get(sessionId);
  if (!session) {
    throw new UploadSessionNotFoundError();
  }
  if (
    !Number.isInteger(chunkIndex) ||
    chunkIndex < 0 ||
    chunkIndex >= session.totalChunks
  ) {
    throw new ChunkIndexOutOfRangeError();
  }

  // ── Issue #1294: per-chunk + total size enforcement. A client can declare
  //    fileSize = 1 MB at /init and then stream gigabytes through /chunk,
  //    filling the SQLite chunk store; /complete would then buffer all of it
  //    into memory. Enforce both dimensions here (defense in depth alongside
  //    the /chunk route's own Content-Length pre-check):
  //    1. Per-chunk cap: no single chunk may exceed the session-uniform
  //       expectation (CHUNK_SIZE_BYTES for non-final chunks; the declared
  //       remainder — which may be smaller — for the final chunk). Anything
  //       larger is rejected before it reaches SQLite.
  //    2. Running total: a chunk that would push the stored total past the
  //       declared fileSize is rejected. The chunk-bytes table is the source
  //       of truth when it disagrees with metadata (e.g. a session written
  //       before #1294), so compute the would-be total from SQLite:
  //       total - prevSize + newSize (delta-adjusted on re-upload so retries
  //       don't inflate it).
  const maxForIndex = maxChunkSizeForIndex(
    session.fileSize,
    session.totalChunks,
    chunkIndex,
  );
  if (data.length > maxForIndex) {
    throw new ChunkTooLargeError(
      `Chunk ${chunkIndex} exceeds the ${maxForIndex}-byte limit for this upload (received ${data.length} bytes)`,
    );
  }
  if (data.length > MAX_FILE_SIZE_BYTES) {
    throw new ChunkTooLargeError(
      `Chunk exceeds the 100 MB file size limit (received ${data.length} bytes)`,
    );
  }

  const chunkStore = ChunkedUploadChunkStore.getInstance();
  const prevSize = chunkStore.getChunkSize(sessionId, chunkIndex) ?? 0;
  const storedTotal = chunkStore.totalBytes(sessionId);
  if (storedTotal - prevSize + data.length > session.fileSize) {
    throw new TotalSizeExceededError(
      `Upload would exceed the declared file size of ${session.fileSize} bytes`,
    );
  }

  chunkStore.writeChunk(sessionId, chunkIndex, data);
  const updated = await getMetadataStore().addReceivedChunk(
    sessionId,
    chunkIndex,
    data.length,
  );
  if (!updated) {
    // Rare race: the session's TTL expired between the get() above and the
    // addReceivedChunk() call.
    throw new UploadSessionNotFoundError();
  }

  return {
    receivedChunks: [...updated.receivedChunks].sort((a, b) => a - b),
    totalChunks: updated.totalChunks,
  };
}

export interface AssembledFile {
  buffer: Buffer;
  filename: string;
  fileType: string;
}

/**
 * Streaming assembly descriptor (issue #1295) — everything /complete needs
 * to pin a session's file *without* concatenating it into one Buffer:
 *
 * - `chunks()` yields each stored chunk in index order, one at a time, so
 *   peak residency is a single chunk (~1 MB), not the file.
 * - `sha256` is the hex digest computed over those same bytes (hashed from
 *   the identical chunk reads, in order) for integrity verification.
 * - `totalBytes` is the summed stored length, already asserted to equal the
 *   declared `fileSize`, so the multipart `Content-Length` is exact.
 * - `header` carries the first 12 bytes for magic-byte validation before
 *   any byte is pinned.
 *
 * Sizes are checked from SQLite `length(data)` aggregates *before* any
 * chunk is read, so a session whose bytes drifted out-of-band (issue #1294)
 * fails without streaming anything.
 */
export interface StreamedAssembly {
  filename: string;
  fileType: string;
  fileSize: number;
  totalChunks: number;
  totalBytes: number;
  sha256: string;
  header: Uint8Array;
  chunks: () => Generator<Buffer, void, void>;
}

/**
 * Validates a session for streaming assembly and precomputes its digest.
 * Reads each chunk exactly once to hash it (same order as the later upload
 * pass); hashing is O(1) memory and representative of the streaming
 * pipeline's own reads, keeping the route's extra peak at one chunk.
 *
 * Throws 400-class errors for unknown/incomplete sessions, performs the
 * issue-#1294 size-mismatch cleanup, and does NOT clean up on success —
 * the caller cleans up only after Pinata + verification succeed.
 */
export async function prepareStreamedAssembly(
  sessionId: string,
): Promise<StreamedAssembly> {
  const session = await getMetadataStore().get(sessionId);
  if (!session) {
    throw new Error('Upload session not found or expired');
  }
  if (session.receivedChunks.length !== session.totalChunks) {
    throw new Error(
      `Incomplete upload: received ${session.receivedChunks.length}/${session.totalChunks} chunks`,
    );
  }

  const store = ChunkedUploadChunkStore.getInstance();
  const totalBytes = store.totalBytes(sessionId);
  const count = store.receivedIndices(sessionId).length;
  if (count !== session.totalChunks) {
    throw new Error(
      `Incomplete upload: received ${count}/${session.totalChunks} chunks`,
    );
  }
  if (totalBytes !== session.fileSize) {
    // Same poisoned-session cleanup as assembleFile(): the client must
    // start over with a truthful size.
    store.deleteForSession(sessionId);
    await getMetadataStore().remove(sessionId);
    throw new SizeMismatchError(
      `Assembled size ${totalBytes} bytes does not match the declared file size of ${session.fileSize} bytes`,
    );
  }

  // Hash pass over the stored chunks, one at a time. Also captures the
  // leading 12 bytes for the route's magic-byte gate.
  const hash = crypto.createHash('sha256');
  let seen = 0;
  const headerBytes = new Uint8Array(12);
  let headerFilled = 0;
  for (const piece of store.iterateChunks(sessionId, session.totalChunks)) {
    hash.update(new Uint8Array(piece));
    if (headerFilled < 12) {
      const take = Math.min(12 - headerFilled, piece.length);
      headerBytes.set(piece.subarray(0, take), headerFilled);
      headerFilled += take;
    }
    seen += piece.length;
  }
  if (seen !== totalBytes) {
    throw new Error('Upload session changed during assembly');
  }

  return {
    filename: session.filename,
    fileType: session.fileType,
    fileSize: session.fileSize,
    totalChunks: session.totalChunks,
    totalBytes,
    sha256: hash.digest('hex'),
    header: headerBytes.subarray(0, headerFilled),
    chunks: () => store.iterateChunks(sessionId, session.totalChunks),
  };
}

/**
 * Concatenates every received chunk, in order, into a single Buffer.
 * Throws if the session is unknown/expired or any chunk is still missing —
 * correctly regardless of which instance originally received a given
 * chunk, since both the metadata and the bytes now live in shared storage.
 *
 * Issue #1294: also asserts the assembled byte length equals the declared
 * fileSize. Chunks that slipped past older (unenforced) writes, or were
 * written out-of-band, would otherwise let a client declare 1 MB, store
 * gigabytes, and force /complete to buffer all of it. On mismatch the
 * session's bytes are deleted and a SizeMismatchError is thrown so the
 * /complete route can answer 400.
 */
export async function assembleFile(sessionId: string): Promise<AssembledFile> {
  const session = await getMetadataStore().get(sessionId);
  if (!session) {
    throw new Error('Upload session not found or expired');
  }
  if (session.receivedChunks.length !== session.totalChunks) {
    throw new Error(
      `Incomplete upload: received ${session.receivedChunks.length}/${session.totalChunks} chunks`,
    );
  }

  const buffer = ChunkedUploadChunkStore.getInstance().readAllInOrder(
    sessionId,
    session.totalChunks,
  );

  if (buffer.length !== session.fileSize) {
    // Clean up so a poisoned session can't be retried into another giant
    // buffering attempt; the client must start over with a truthful size.
    ChunkedUploadChunkStore.getInstance().deleteForSession(sessionId);
    await getMetadataStore().remove(sessionId);
    throw new SizeMismatchError(
      `Assembled size ${buffer.length} bytes does not match the declared file size of ${session.fileSize} bytes`,
    );
  }

  return { buffer, filename: session.filename, fileType: session.fileType };
}

/** Removes a session's metadata and chunk bytes. Harmless no-op if unknown. */
export async function cleanupSession(sessionId: string): Promise<void> {
  await getMetadataStore().remove(sessionId);
  ChunkedUploadChunkStore.getInstance().deleteForSession(sessionId);
}

/** Returns summaries of all active sessions owned by the given wallet. */
export async function listSessionsForWallet(
  wallet: string,
): Promise<SessionSummary[]> {
  const sessions = await getMetadataStore().listByOwner(wallet);
  return sessions.map((s) => ({
    sessionId: s.sessionId,
    filename: s.filename,
    fileType: s.fileType,
    fileSize: s.fileSize,
    totalChunks: s.totalChunks,
    receivedChunks: s.receivedChunks.length,
    createdAt: s.createdAt,
  }));
}

/** Removes every active session owned by the given wallet. Returns the count removed. */
export async function clearSessionsForWallet(wallet: string): Promise<number> {
  const sessions = await getMetadataStore().listByOwner(wallet);
  for (const session of sessions) {
    await getMetadataStore().remove(session.sessionId);
    ChunkedUploadChunkStore.getInstance().deleteForSession(session.sessionId);
  }
  return sessions.length;
}

/**
 * Test-only escape hatch: clears the cached metadata store and the
 * "already warned" flag so the next call re-evaluates env vars — mirrors
 * lib/rateLimit.ts's `_resetRateLimitStoreForTests`. Does NOT touch the
 * chunk-bytes store, so a test can use this alone to simulate a fresh
 * metadata-store connection (e.g. a different serverless instance) while
 * still reading back chunk bytes a prior connection already wrote to
 * shared storage. See __resetForTests for full teardown between tests.
 */
export function _resetMetadataCacheForTests(): void {
  cachedStore = null;
  warnedMissingRedisInProd = false;
}

/**
 * Test-only escape hatch: full teardown — clears the cached metadata store
 * and closes/clears the chunk-bytes store singleton, so each test starts
 * from a clean slate.
 */
export function __resetForTests(): void {
  _resetMetadataCacheForTests();
  ChunkedUploadChunkStore.resetInstance();
}
