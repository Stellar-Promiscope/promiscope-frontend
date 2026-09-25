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
}

interface SessionMetadataStore {
  create(session: StoredSession): Promise<void>;
  get(sessionId: string): Promise<StoredSession | null>;
  addReceivedChunk(
    sessionId: string,
    chunkIndex: number,
  ): Promise<StoredSession | null>;
  remove(sessionId: string): Promise<void>;
  listByOwner(wallet: string): Promise<StoredSession[]>;
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
    return this.sessions.get(sessionId) ?? null;
  }

  async addReceivedChunk(
    sessionId: string,
    chunkIndex: number,
  ): Promise<StoredSession | null> {
    this.sweepExpired();
    const session = this.sessions.get(sessionId);
    if (!session) return null;
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
    return typeof raw === 'string' ? (JSON.parse(raw) as StoredSession) : raw;
  }

  async addReceivedChunk(
    sessionId: string,
    chunkIndex: number,
  ): Promise<StoredSession | null> {
    const session = await this.get(sessionId);
    if (!session) return null;

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

  ChunkedUploadChunkStore.getInstance().writeChunk(sessionId, chunkIndex, data);
  const updated = await getMetadataStore().addReceivedChunk(
    sessionId,
    chunkIndex,
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
 * Concatenates every received chunk, in order, into a single Buffer.
 * Throws if the session is unknown/expired or any chunk is still missing —
 * correctly regardless of which instance originally received a given
 * chunk, since both the metadata and the bytes now live in shared storage.
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
