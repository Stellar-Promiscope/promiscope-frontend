/**
 * uploadTrackingStore — SQLite-backed tracking of IPFS/Pinata pins created
 * by client upload flows, independent of whether the flow that produced
 * them ever completes (issue #1005).
 *
 * The player onboarding wizard (components/player/PlayerOnboardingWizard.tsx)
 * pins a highlight-reel video via VideoUpload/useChunkedUpload *before* the
 * player registration transaction is ever signed — a real file gets pinned,
 * costing storage, the moment step 2's upload completes. If the wizard is
 * then abandoned, or step 2 is redone with a different file, that CID is
 * never referenced by any on-chain profile and — with no tracking — could
 * never be found again for cleanup. A record here is created at upload
 * time (via POST /api/uploads/track) and matched off against a
 * successful registration (via POST /api/uploads/track/match). Anything
 * still unmatched past a grace period is a candidate for cleanup, surfaced
 * to admins via GET /api/admin/orphaned-uploads.
 *
 * Mirrors lib/adminAuditStore.ts's conventions: one table, idempotent
 * `CREATE TABLE IF NOT EXISTS` DDL, process-wide singleton, DB bootstrap
 * shared via lib/sqliteDb.ts.
 */
import type Database from 'better-sqlite3';
import { openSqliteDb } from './sqliteDb';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tracked_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cid TEXT NOT NULL,
  wallet TEXT,
  context TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  matched_at INTEGER,
  matched_tx_hash TEXT,
  cleaned_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tracked_uploads_cid ON tracked_uploads(cid);
CREATE INDEX IF NOT EXISTS idx_tracked_uploads_unmatched ON tracked_uploads(matched_at, cleaned_at, created_at);
`;

/**
 * What a tracked upload is for — kept as a union (not a free-form string)
 * so a new upload flow that wants this same tracking has to deliberately
 * add its own context value here rather than accidentally sharing one.
 */
export type UploadTrackingContext = 'player_onboarding_highlight_reel';

export interface TrackedUpload {
  id: number;
  cid: string;
  wallet: string | null;
  context: UploadTrackingContext;
  createdAt: number;
  matchedAt: number | null;
  matchedTxHash: string | null;
  cleanedAt: number | null;
}

interface TrackedUploadRow {
  id: number;
  cid: string;
  wallet: string | null;
  context: string;
  created_at: number;
  matched_at: number | null;
  matched_tx_hash: string | null;
  cleaned_at: number | null;
}

function rowToRecord(row: TrackedUploadRow): TrackedUpload {
  return {
    id: row.id,
    cid: row.cid,
    wallet: row.wallet,
    context: row.context as UploadTrackingContext,
    createdAt: row.created_at,
    matchedAt: row.matched_at,
    matchedTxHash: row.matched_tx_hash,
    cleanedAt: row.cleaned_at,
  };
}

export class UploadTrackingStore {
  private static _instance: UploadTrackingStore | null = null;

  private db: Database.Database;

  private constructor() {
    this.db = openSqliteDb('upload-tracking.db', 'UPLOAD_TRACKING_DB_PATH');
    this.db.exec(SCHEMA);
  }

  static getInstance(): UploadTrackingStore {
    if (!UploadTrackingStore._instance) {
      UploadTrackingStore._instance = new UploadTrackingStore();
    }
    return UploadTrackingStore._instance;
  }

  /** Closes the DB connection and clears the singleton. Use ONLY in tests. */
  static resetInstance(): void {
    if (UploadTrackingStore._instance) {
      UploadTrackingStore._instance.db.close();
    }
    UploadTrackingStore._instance = null;
  }

  /** Records a new pin as pending — called the moment an upload completes. */
  recordUpload(params: {
    cid: string;
    wallet: string | null;
    context: UploadTrackingContext;
    createdAt?: number;
  }): TrackedUpload {
    const result = this.db
      .prepare(
        `INSERT INTO tracked_uploads (cid, wallet, context, created_at)
         VALUES (@cid, @wallet, @context, @created_at)`,
      )
      .run({
        cid: params.cid,
        wallet: params.wallet,
        context: params.context,
        created_at: params.createdAt ?? Date.now(),
      });

    const row = this.db
      .prepare('SELECT * FROM tracked_uploads WHERE id = ?')
      .get(result.lastInsertRowid) as TrackedUploadRow;
    return rowToRecord(row);
  }

  /**
   * Marks the most recent unmatched record for `cid` as matched to a
   * completed registration. Scoped to unmatched rows so a CID that was
   * (rarely, but possibly) reused across two tracked uploads only consumes
   * one pending record rather than matching all of them at once.
   */
  markMatched(
    cid: string,
    txHash: string | null,
    matchedAt: number = Date.now(),
  ): TrackedUpload | null {
    const row = this.db
      .prepare(
        `SELECT * FROM tracked_uploads
         WHERE cid = @cid AND matched_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get({ cid }) as TrackedUploadRow | undefined;
    if (!row) return null;

    this.db
      .prepare(
        `UPDATE tracked_uploads SET matched_at = @matched_at, matched_tx_hash = @tx_hash WHERE id = @id`,
      )
      .run({ matched_at: matchedAt, tx_hash: txHash, id: row.id });

    return rowToRecord({
      ...row,
      matched_at: matchedAt,
      matched_tx_hash: txHash,
    });
  }

  /**
   * Records still unmatched and older than `graceMs` — cleanup candidates.
   * Excludes rows already marked cleaned so a repeated cleanup run doesn't
   * keep re-surfacing the same ones.
   */
  getOrphanCandidates(
    graceMs: number,
    now: number = Date.now(),
  ): TrackedUpload[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM tracked_uploads
         WHERE matched_at IS NULL AND cleaned_at IS NULL AND created_at <= @cutoff
         ORDER BY created_at ASC`,
      )
      .all({ cutoff: now - graceMs }) as TrackedUploadRow[];
    return rows.map(rowToRecord);
  }

  markCleaned(id: number, cleanedAt: number = Date.now()): void {
    this.db
      .prepare(
        'UPDATE tracked_uploads SET cleaned_at = @cleaned_at WHERE id = @id',
      )
      .run({ cleaned_at: cleanedAt, id });
  }

  /** Test/debug helper — every record for a given CID, newest first. */
  getByCid(cid: string): TrackedUpload[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM tracked_uploads WHERE cid = ? ORDER BY created_at DESC',
      )
      .all(cid) as TrackedUploadRow[];
    return rows.map(rowToRecord);
  }

  /** Every tracked upload attributed to `wallet`, newest first (data export). */
  listForWallet(wallet: string): TrackedUpload[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM tracked_uploads WHERE wallet = ? ORDER BY created_at DESC',
      )
      .all(wallet) as TrackedUploadRow[];
    return rows.map(rowToRecord);
  }

  /**
   * Detaches `wallet` from its tracked uploads (data-deletion cascade). The
   * rows themselves are retained, not deleted: the orphan-cleanup job still
   * needs the CID to unpin media that was never matched to a registration.
   */
  anonymizeWallet(wallet: string): number {
    return this.db
      .prepare('UPDATE tracked_uploads SET wallet = NULL WHERE wallet = ?')
      .run(wallet).changes;
  }

  close(): void {
    this.db.close();
  }
}
