/**
 * chunkedUploadChunkStore — SQLite-backed storage for chunked/resumable
 * upload chunk bytes (issue #1175). Companion to lib/chunkedUploadStore.ts's
 * session metadata store: metadata answers "which chunks has this session
 * received," this store holds the bytes themselves.
 *
 * Chunk bytes are larger binary payloads than the counters Redis backs
 * elsewhere in this repo (lib/rateLimit.ts), so rather than Redis they go
 * to the shared-disk-backed better-sqlite3 infrastructure already used
 * throughout lib/*Store.ts, per docs/chunked-video-upload.md's own note
 * that this store "would need to move to shared storage (e.g. one of the
 * SQLite services already used elsewhere in this repo)." This resolves the
 * bug (a chunk landing on one instance's local os.tmpdir() being invisible
 * to another instance) as long as the SQLite database file itself is on
 * shared/persistent storage reachable from every instance (a shared volume,
 * not per-instance ephemeral disk) — see CHUNKED_UPLOAD_DB_PATH in
 * .env.example. On a truly stateless/ephemeral-disk serverless deployment
 * with no shared volume, this same limitation would resurface one layer
 * down; that's an explicit, documented tradeoff, not a silent gap.
 *
 * Issue #1294: every write is still bounded per (sessionId, chunkIndex) by
 * the PRIMARY KEY upsert, but callers must enforce per-chunk and total size
 * limits *before* calling writeChunk (see lib/chunkedUploadStore.ts) —
 * this store itself stays a dumb byte bucket plus size-introspection
 * helpers (getChunkSize/totalBytes) so limit checks stay consistent across
 * instances sharing this SQLite file.
 */
import type Database from 'better-sqlite3';
import { openSqliteDb } from './sqliteDb';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chunked_upload_chunks (
  session_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_chunked_upload_chunks_session ON chunked_upload_chunks(session_id);
`;

interface ChunkRow {
  chunk_index: number;
  data: Buffer;
}

export class ChunkedUploadChunkStore {
  private static _instance: ChunkedUploadChunkStore | null = null;

  private db: Database.Database;

  private constructor() {
    this.db = openSqliteDb('chunked-uploads.db', 'CHUNKED_UPLOAD_DB_PATH');
    this.db.exec(SCHEMA);
  }

  static getInstance(): ChunkedUploadChunkStore {
    if (!ChunkedUploadChunkStore._instance) {
      ChunkedUploadChunkStore._instance = new ChunkedUploadChunkStore();
    }
    return ChunkedUploadChunkStore._instance;
  }

  /** Closes the DB connection and clears the singleton. Use ONLY in tests. */
  static resetInstance(): void {
    if (ChunkedUploadChunkStore._instance) {
      ChunkedUploadChunkStore._instance.db.close();
    }
    ChunkedUploadChunkStore._instance = null;
  }

  /** Idempotent per (sessionId, chunkIndex) — re-uploading a chunk overwrites it. */
  writeChunk(sessionId: string, chunkIndex: number, data: Buffer): void {
    this.db
      .prepare(
        `INSERT INTO chunked_upload_chunks (session_id, chunk_index, data, created_at)
         VALUES (@session_id, @chunk_index, @data, @created_at)
         ON CONFLICT(session_id, chunk_index) DO UPDATE SET
           data = excluded.data, created_at = excluded.created_at`,
      )
      .run({
        session_id: sessionId,
        chunk_index: chunkIndex,
        // Copy into a plain-ArrayBuffer-backed Uint8Array: @types/node's
        // Buffer is generic over ArrayBufferLike, which this project's
        // DOM-lib-inclusive tsconfig can't unify with better-sqlite3's BLOB
        // binding — same pattern as the whole-file /complete route.
        data: new Uint8Array(data),
        created_at: Date.now(),
      });
  }

  /** Stored byte size for one chunk, or null when absent. */
  getChunkSize(sessionId: string, chunkIndex: number): number | null {
    const row = this.db
      .prepare(
        `SELECT length(data) AS size FROM chunked_upload_chunks WHERE session_id = ? AND chunk_index = ?`,
      )
      .get(sessionId, chunkIndex) as { size: number } | undefined;
    return row ? Number(row.size) : null;
  }

  /** Sum of stored chunk bytes for a session (0 when none). */
  totalBytes(sessionId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(length(data)), 0) AS total FROM chunked_upload_chunks WHERE session_id = ?`,
      )
      .get(sessionId) as { total: number };
    return Number(row.total) || 0;
  }

  /** Which chunk indices this store currently holds for a session. */
  receivedIndices(sessionId: string): number[] {
    const rows = this.db
      .prepare(
        `SELECT chunk_index FROM chunked_upload_chunks WHERE session_id = ? ORDER BY chunk_index ASC`,
      )
      .all(sessionId) as Array<{ chunk_index: number }>;
    return rows.map((r) => r.chunk_index);
  }

  /**
   * Reads a single chunk's bytes, or null when absent. At most one chunk
   * (~1 MB) is ever resident — the streaming read path for issue #1295.
   */
  readChunk(sessionId: string, chunkIndex: number): Buffer | null {
    const row = this.db
      .prepare(
        `SELECT data FROM chunked_upload_chunks WHERE session_id = ? AND chunk_index = ?`,
      )
      .get(sessionId, chunkIndex) as { data: Buffer } | undefined;
    if (!row) return null;
    return Buffer.from(new Uint8Array(row.data));
  }

  /**
   * Yields every chunk for a session in index order, one at a time.
   * Throws on the first missing index. Peak residency is a single chunk,
   * so a 100 MB assembly streams at ~1 MB — see prepareStreamedAssembly()
   * in lib/chunkedUploadStore.ts (issue #1295).
   */
  *iterateChunks(
    sessionId: string,
    totalChunks: number,
  ): Generator<Buffer, void, void> {
    const stmt = this.db.prepare(
      `SELECT data FROM chunked_upload_chunks WHERE session_id = ? AND chunk_index = ?`,
    );
    for (let i = 0; i < totalChunks; i++) {
      const row = stmt.get(sessionId, i) as { data: Buffer } | undefined;
      if (!row) {
        throw new Error(`Incomplete upload: missing chunk ${i}/${totalChunks}`);
      }
      yield Buffer.from(new Uint8Array(row.data));
    }
  }

  /**
   * Concatenates every chunk for a session, in index order, into one
   * Buffer. Throws if the count doesn't match `totalChunks` — a defense-in-
   * depth check independent of the caller's own metadata-based check.
   */
  readAllInOrder(sessionId: string, totalChunks: number): Buffer {
    const rows = this.db
      .prepare(
        `SELECT chunk_index, data FROM chunked_upload_chunks WHERE session_id = ? ORDER BY chunk_index ASC`,
      )
      .all(sessionId) as ChunkRow[];
    if (rows.length !== totalChunks) {
      throw new Error(
        `Incomplete upload: received ${rows.length}/${totalChunks} chunks`,
      );
    }
    return Buffer.concat(rows.map((r) => new Uint8Array(r.data)));
  }

  deleteForSession(sessionId: string): void {
    this.db
      .prepare(`DELETE FROM chunked_upload_chunks WHERE session_id = ?`)
      .run(sessionId);
  }

  close(): void {
    this.db.close();
  }
}
