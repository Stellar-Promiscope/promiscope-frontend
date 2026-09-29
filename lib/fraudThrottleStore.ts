/**
 * fraudThrottleStore — SQLite-backed persistence for admin-gated
 * auto-throttling (issue #1174). See docs/fraud-detection.md's "What would
 * change this" section: once a heuristic is tuned against real traffic, a
 * reasonable next step is auto-throttling that specific heuristic (pausing
 * further redemptions/pay-to-contact from a flagged wallet pending review)
 * rather than a blanket policy — and the throttle must be admin-gated to
 * unlock, never time-expiring, so a false positive doesn't quietly resolve
 * itself without anyone having looked at it.
 *
 * This store is the durable record a throttle needs: why a wallet was
 * throttled (which heuristic/flag triggered it) and whether an admin has
 * since reviewed and lifted it. A row is never deleted — lifting sets
 * `status = 'lifted'` and records who lifted it and when, so the full
 * history (placed, and any lift) is always auditable from this table alone.
 *
 * Mirrors lib/adminAuditStore.ts's conventions: one table, idempotent
 * `CREATE TABLE IF NOT EXISTS` DDL, process-wide singleton, DB bootstrap
 * shared via lib/sqliteDb.ts.
 */
import type Database from 'better-sqlite3';
import { openSqliteDb } from './sqliteDb';
import { normalizeStellarAddress } from './stellar';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS fraud_throttles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  heuristic TEXT NOT NULL,
  category TEXT NOT NULL,
  flag_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence TEXT NOT NULL,
  status TEXT NOT NULL,
  throttled_at INTEGER NOT NULL,
  lifted_at INTEGER,
  lifted_by TEXT,
  lift_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_fraud_throttles_wallet_status ON fraud_throttles(wallet, status);
CREATE INDEX IF NOT EXISTS idx_fraud_throttles_throttled_at ON fraud_throttles(throttled_at DESC);
`;

export type FraudThrottleStatus = 'throttled' | 'lifted';

export interface FraudThrottle {
  id: number;
  wallet: string;
  heuristic: string;
  category: string;
  flagId: string;
  reason: string;
  evidence: Record<string, unknown>;
  status: FraudThrottleStatus;
  throttledAt: number;
  liftedAt: number | null;
  liftedBy: string | null;
  liftReason: string | null;
}

export interface NewFraudThrottle {
  wallet: string;
  heuristic: string;
  category: string;
  flagId: string;
  reason: string;
  evidence: Record<string, unknown>;
}

interface FraudThrottleRow {
  id: number;
  wallet: string;
  heuristic: string;
  category: string;
  flag_id: string;
  reason: string;
  evidence: string;
  status: string;
  throttled_at: number;
  lifted_at: number | null;
  lifted_by: string | null;
  lift_reason: string | null;
}

function rowToThrottle(row: FraudThrottleRow): FraudThrottle {
  return {
    id: row.id,
    wallet: row.wallet,
    heuristic: row.heuristic,
    category: row.category,
    flagId: row.flag_id,
    reason: row.reason,
    evidence: JSON.parse(row.evidence),
    status: row.status as FraudThrottleStatus,
    throttledAt: row.throttled_at,
    liftedAt: row.lifted_at,
    liftedBy: row.lifted_by,
    liftReason: row.lift_reason,
  };
}

export class FraudThrottleStore {
  private static _instance: FraudThrottleStore | null = null;

  private db: Database.Database;

  private constructor() {
    this.db = openSqliteDb('fraud-throttles.db', 'FRAUD_THROTTLES_DB_PATH');
    this.db.exec(SCHEMA);
  }

  static getInstance(): FraudThrottleStore {
    if (!FraudThrottleStore._instance) {
      FraudThrottleStore._instance = new FraudThrottleStore();
    }
    return FraudThrottleStore._instance;
  }

  /** Closes the DB connection and clears the singleton. Use ONLY in tests. */
  static resetInstance(): void {
    if (FraudThrottleStore._instance) {
      FraudThrottleStore._instance.db.close();
    }
    FraudThrottleStore._instance = null;
  }

  /**
   * Places a wallet in a throttled state. Idempotent per (wallet, heuristic):
   * if that wallet already has an active throttle for the same heuristic,
   * the existing row is returned unchanged rather than duplicated — so
   * re-running evaluation (on-demand or cron) doesn't spam new rows for a
   * wallet that's already under review.
   */
  placeThrottle(input: NewFraudThrottle): FraudThrottle {
    const entry = { ...input, wallet: normalizeStellarAddress(input.wallet) };
    const existing = this.db
      .prepare(
        `SELECT * FROM fraud_throttles
         WHERE wallet = @wallet AND heuristic = @heuristic AND status = 'throttled'
         ORDER BY id DESC LIMIT 1`,
      )
      .get({ wallet: entry.wallet, heuristic: entry.heuristic }) as
      | FraudThrottleRow
      | undefined;
    if (existing) return rowToThrottle(existing);

    const result = this.db
      .prepare(
        `INSERT INTO fraud_throttles
           (wallet, heuristic, category, flag_id, reason, evidence, status, throttled_at)
         VALUES (@wallet, @heuristic, @category, @flag_id, @reason, @evidence, 'throttled', @throttled_at)`,
      )
      .run({
        wallet: entry.wallet,
        heuristic: entry.heuristic,
        category: entry.category,
        flag_id: entry.flagId,
        reason: entry.reason,
        evidence: JSON.stringify(entry.evidence),
        throttled_at: Date.now(),
      });

    const row = this.db
      .prepare('SELECT * FROM fraud_throttles WHERE id = ?')
      .get(result.lastInsertRowid) as FraudThrottleRow;
    return rowToThrottle(row);
  }

  /** The most recent active throttle for a wallet, across any heuristic, or null. */
  getActiveThrottle(wallet: string): FraudThrottle | null {
    const row = this.db
      .prepare(
        `SELECT * FROM fraud_throttles WHERE wallet = ? AND status = 'throttled'
         ORDER BY throttled_at DESC LIMIT 1`,
      )
      .get(normalizeStellarAddress(wallet)) as FraudThrottleRow | undefined;
    return row ? rowToThrottle(row) : null;
  }

  /** Every currently-active throttle, most recently placed first. */
  listActive(): FraudThrottle[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM fraud_throttles WHERE status = 'throttled' ORDER BY throttled_at DESC`,
      )
      .all() as FraudThrottleRow[];
    return rows.map(rowToThrottle);
  }

  /** Full history (active and lifted), most recently placed first — the admin-auditable trail. */
  listAll(limit = 200): FraudThrottle[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM fraud_throttles ORDER BY throttled_at DESC LIMIT ?`,
      )
      .all(limit) as FraudThrottleRow[];
    return rows.map(rowToThrottle);
  }

  /**
   * Lifts an active throttle. This is the ONLY way a throttle's status
   * changes after being placed — there is no expiry, scheduled or
   * otherwise. Returns null if the id doesn't exist or is already lifted
   * (lifting is not idempotent-retryable by design: a second lift attempt
   * should surface as "already lifted," not silently succeed again).
   */
  liftThrottle(
    id: number,
    liftedBy: string,
    liftReason?: string,
  ): FraudThrottle | null {
    const result = this.db
      .prepare(
        `UPDATE fraud_throttles
         SET status = 'lifted', lifted_at = @lifted_at, lifted_by = @lifted_by, lift_reason = @lift_reason
         WHERE id = @id AND status = 'throttled'`,
      )
      .run({
        id,
        lifted_at: Date.now(),
        lifted_by: liftedBy,
        lift_reason: liftReason ?? null,
      });
    if (result.changes === 0) return null;

    const row = this.db
      .prepare('SELECT * FROM fraud_throttles WHERE id = ?')
      .get(id) as FraudThrottleRow;
    return rowToThrottle(row);
  }

  close(): void {
    this.db.close();
  }
}
