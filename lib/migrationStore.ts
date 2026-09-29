/**
 * migrationStore — SQLite-backed store for wallet data-portability migration
 * requests (issue #1315).
 *
 * A migration request moves every off-chain store keyed by `fromWallet` to
 * `toWallet` after a 72-hour cooling-off period. The cooling-off window
 * allows the original wallet owner to cancel a fraudulent request before it
 * executes.
 *
 * States:
 *   pending   — request submitted; cooling off in progress
 *   cancelled — cancelled by either wallet during cooling-off
 *   approved  — cooling-off elapsed; ready to execute
 *   completed — migration executed successfully
 *   failed    — migration rolled back (partial failure)
 *
 * Security model:
 *   - Only the backup wallet (toWallet, which is signed in via SEP-10 at
 *     the time of submission) can submit a request.
 *   - Either wallet can cancel during cooling-off.
 *   - Execution runs server-side in a transaction; all stores migrate
 *     atomically or roll back.
 *   - All state transitions are written to the admin audit log.
 */

import type Database from 'better-sqlite3';
import { openSqliteDb } from './sqliteDb';

export type MigrationStatus =
  | 'pending'
  | 'cancelled'
  | 'approved'
  | 'completed'
  | 'failed';

/** Duration of the cooling-off period in milliseconds. */
export const COOLING_OFF_MS = 72 * 60 * 60 * 1000; // 72 hours

export interface MigrationRequest {
  id: string;
  fromWallet: string;
  toWallet: string;
  status: MigrationStatus;
  requestedAt: number;
  /** Unix ms when cooling-off ends and migration may execute. */
  executeAfter: number;
  completedAt: number | null;
  cancelledAt: number | null;
  cancelledBy: string | null;
  failureReason: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS migration_requests (
  id TEXT PRIMARY KEY,
  from_wallet TEXT NOT NULL,
  to_wallet TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at INTEGER NOT NULL,
  execute_after INTEGER NOT NULL,
  completed_at INTEGER,
  cancelled_at INTEGER,
  cancelled_by TEXT,
  failure_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_migration_from_wallet ON migration_requests(from_wallet);
CREATE INDEX IF NOT EXISTS idx_migration_to_wallet ON migration_requests(to_wallet);
CREATE INDEX IF NOT EXISTS idx_migration_status ON migration_requests(status);
`;

interface MigrationRow {
  id: string;
  from_wallet: string;
  to_wallet: string;
  status: string;
  requested_at: number;
  execute_after: number;
  completed_at: number | null;
  cancelled_at: number | null;
  cancelled_by: string | null;
  failure_reason: string | null;
}

function rowToRequest(row: MigrationRow): MigrationRequest {
  return {
    id: row.id,
    fromWallet: row.from_wallet,
    toWallet: row.to_wallet,
    status: row.status as MigrationStatus,
    requestedAt: row.requested_at,
    executeAfter: row.execute_after,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    failureReason: row.failure_reason,
  };
}

export class MigrationStore {
  private static _instance: MigrationStore | null = null;
  private db: Database.Database;

  private constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(SCHEMA);
  }

  static getInstance(): MigrationStore {
    if (!MigrationStore._instance) {
      MigrationStore._instance = new MigrationStore(
        openSqliteDb('migration-requests.db', 'MIGRATION_REQUESTS_DB_PATH'),
      );
    }
    return MigrationStore._instance;
  }

  /** For tests only. */
  static resetInstance(): void {
    MigrationStore._instance = null;
  }

  /**
   * Creates a new pending migration request.
   * Rejects if a pending/approved request already exists for this fromWallet.
   */
  create(id: string, fromWallet: string, toWallet: string): MigrationRequest {
    const now = Date.now();
    const existing = this.db
      .prepare(
        `SELECT id FROM migration_requests
         WHERE from_wallet = ? AND status IN ('pending', 'approved')
         LIMIT 1`,
      )
      .get(fromWallet) as { id: string } | undefined;

    if (existing) {
      throw new Error(
        `A pending migration request already exists for this wallet (id: ${existing.id})`,
      );
    }

    this.db
      .prepare(
        `INSERT INTO migration_requests
           (id, from_wallet, to_wallet, status, requested_at, execute_after)
         VALUES (?, ?, ?, 'pending', ?, ?)`,
      )
      .run(id, fromWallet, toWallet, now, now + COOLING_OFF_MS);

    return this.get(id)!;
  }

  get(id: string): MigrationRequest | null {
    const row = this.db
      .prepare('SELECT * FROM migration_requests WHERE id = ?')
      .get(id) as MigrationRow | undefined;
    return row ? rowToRequest(row) : null;
  }

  /** Returns all requests where fromWallet or toWallet equals this address. */
  listForWallet(wallet: string): MigrationRequest[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM migration_requests
         WHERE from_wallet = ? OR to_wallet = ?
         ORDER BY requested_at DESC`,
      )
      .all(wallet, wallet) as MigrationRow[];
    return rows.map(rowToRequest);
  }

  /** Cancels a pending request. Either wallet may cancel during cooling-off. */
  cancel(id: string, cancelledBy: string): MigrationRequest {
    const req = this.get(id);
    if (!req) throw new Error(`Migration request not found: ${id}`);
    if (req.status !== 'pending') {
      throw new Error(
        `Cannot cancel a migration in status '${req.status}' — only pending requests can be cancelled`,
      );
    }

    const now = Date.now();
    this.db
      .prepare(
        `UPDATE migration_requests
         SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?
         WHERE id = ?`,
      )
      .run(now, cancelledBy, id);

    return this.get(id)!;
  }

  /**
   * Marks a request as completed (called after a successful migration).
   * Also used internally by the execution route.
   */
  markCompleted(id: string): MigrationRequest {
    this.db
      .prepare(
        `UPDATE migration_requests
         SET status = 'completed', completed_at = ?
         WHERE id = ?`,
      )
      .run(Date.now(), id);
    return this.get(id)!;
  }

  /** Marks a request as failed (called on migration rollback). */
  markFailed(id: string, reason: string): MigrationRequest {
    this.db
      .prepare(
        `UPDATE migration_requests
         SET status = 'failed', failure_reason = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(reason, Date.now(), id);
    return this.get(id)!;
  }

  /**
   * Returns all pending requests whose cooling-off period has elapsed and
   * are ready to execute.
   */
  listReadyToExecute(): MigrationRequest[] {
    const now = Date.now();
    const rows = this.db
      .prepare(
        `SELECT * FROM migration_requests
         WHERE status = 'pending' AND execute_after <= ?
         ORDER BY execute_after ASC`,
      )
      .all(now) as MigrationRow[];
    return rows.map(rowToRequest);
  }

  /** Transitions a pending request to 'approved' status (post-cooling-off). */
  approve(id: string): MigrationRequest {
    this.db
      .prepare(
        `UPDATE migration_requests SET status = 'approved' WHERE id = ? AND status = 'pending'`,
      )
      .run(id);
    return this.get(id)!;
  }
}
