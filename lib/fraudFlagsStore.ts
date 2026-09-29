/**
 * fraudFlagsStore — SQLite-backed persistence for fraud-flag evaluation
 * runs (issue #1007) and incremental evaluation state.
 *
 * Every run of `runFraudFlagEvaluation` or `runIncrementalFraudFlagEvaluation`
 * (lib/fraudFlagsRunner.ts), whether triggered by an admin loading
 * FraudFlagsPanel.tsx or by the scheduled cron trigger
 * (app/api/cron/fraud-flags/route.ts), is recorded here with a timestamp,
 * events processed, and duration.
 *
 * Supports incremental fraud-heuristic evaluation:
 *  - `fraud_checkpoint`: tracks the last processed ledger sequence.
 *  - `fraud_wallet_aggregates`: keeps rolling aggregates per wallet so only
 *    new events need to be evaluated on each run.
 *  - `fraud_active_flags`: caches the currently active fraud flags across
 *    wallets, updated incrementally when a wallet's activity changes.
 */
import type Database from 'better-sqlite3';
import { openSqliteDb } from './sqliteDb';
import type { FraudFlag } from '@/types';
import type { WalletFraudAggregate } from './fraudIncremental';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS fraud_flag_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluated_at INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  flags TEXT NOT NULL,
  warnings TEXT NOT NULL,
  high_severity_count INTEGER NOT NULL,
  events_processed INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_fraud_flag_runs_evaluated_at ON fraud_flag_runs(evaluated_at DESC);

CREATE TABLE IF NOT EXISTS fraud_checkpoint (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_ledger INTEGER NOT NULL DEFAULT 0,
  last_event_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fraud_wallet_aggregates (
  wallet TEXT PRIMARY KEY,
  aggregate_data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fraud_wallet_aggregates_updated_at ON fraud_wallet_aggregates(updated_at DESC);

CREATE TABLE IF NOT EXISTS fraud_active_flags (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  category TEXT NOT NULL,
  heuristic TEXT NOT NULL,
  severity TEXT NOT NULL,
  flag_data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fraud_active_flags_wallet ON fraud_active_flags(wallet);
`;

export type FraudFlagRunTrigger = 'manual' | 'cron';

export interface FraudFlagRun {
  id: number;
  evaluatedAt: number;
  trigger: FraudFlagRunTrigger;
  flags: FraudFlag[];
  warnings: string[];
  highSeverityCount: number;
  eventsProcessed: number;
  durationMs: number;
}

export interface FraudCheckpoint {
  lastLedger: number;
  lastEventId: string | null;
  updatedAt: number;
}

interface FraudFlagRunRow {
  id: number;
  evaluated_at: number;
  trigger: string;
  flags: string;
  warnings: string;
  high_severity_count: number;
  events_processed?: number;
  duration_ms?: number;
}

interface FraudCheckpointRow {
  id: number;
  last_ledger: number;
  last_event_id: string | null;
  updated_at: number;
}

interface FraudWalletAggregateRow {
  wallet: string;
  aggregate_data: string;
  updated_at: number;
}

interface FraudActiveFlagRow {
  id: string;
  wallet: string;
  category: string;
  heuristic: string;
  severity: string;
  flag_data: string;
  updated_at: number;
}

function rowToRun(row: FraudFlagRunRow): FraudFlagRun {
  return {
    id: row.id,
    evaluatedAt: row.evaluated_at,
    trigger: row.trigger as FraudFlagRunTrigger,
    flags: JSON.parse(row.flags),
    warnings: JSON.parse(row.warnings),
    highSeverityCount: row.high_severity_count,
    eventsProcessed: row.events_processed ?? 0,
    durationMs: row.duration_ms ?? 0,
  };
}

export class FraudFlagsStore {
  private static _instance: FraudFlagsStore | null = null;

  private db: Database.Database;

  private constructor() {
    this.db = openSqliteDb('fraud-flags.db', 'FRAUD_FLAGS_DB_PATH');
    this.db.exec(SCHEMA);
    // Safe column migrations in case DB already exists from earlier schema
    try {
      this.db.exec(
        'ALTER TABLE fraud_flag_runs ADD COLUMN events_processed INTEGER NOT NULL DEFAULT 0;',
      );
    } catch {}
    try {
      this.db.exec(
        'ALTER TABLE fraud_flag_runs ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0;',
      );
    } catch {}
  }

  static getInstance(): FraudFlagsStore {
    if (!FraudFlagsStore._instance) {
      FraudFlagsStore._instance = new FraudFlagsStore();
    }
    return FraudFlagsStore._instance;
  }

  /** Closes the DB connection and clears the singleton. Use ONLY in tests. */
  static resetInstance(): void {
    if (FraudFlagsStore._instance) {
      FraudFlagsStore._instance.db.close();
    }
    FraudFlagsStore._instance = null;
  }

  recordRun(
    trigger: FraudFlagRunTrigger,
    flags: FraudFlag[],
    warnings: string[],
    evaluatedAt: number = Date.now(),
    eventsProcessed: number = 0,
    durationMs: number = 0,
  ): FraudFlagRun {
    const highSeverityCount = flags.filter((f) => f.severity === 'high').length;
    const result = this.db
      .prepare(
        `INSERT INTO fraud_flag_runs
           (evaluated_at, trigger, flags, warnings, high_severity_count, events_processed, duration_ms)
         VALUES (@evaluated_at, @trigger, @flags, @warnings, @high_severity_count, @events_processed, @duration_ms)`,
      )
      .run({
        evaluated_at: evaluatedAt,
        trigger,
        flags: JSON.stringify(flags),
        warnings: JSON.stringify(warnings),
        high_severity_count: highSeverityCount,
        events_processed: eventsProcessed,
        duration_ms: durationMs,
      });

    const row = this.db
      .prepare('SELECT * FROM fraud_flag_runs WHERE id = ?')
      .get(result.lastInsertRowid) as FraudFlagRunRow;
    return rowToRun(row);
  }

  /** Most recent run, regardless of what triggered it, or null if none exist yet. */
  getLatestRun(): FraudFlagRun | null {
    const row = this.db
      .prepare(
        'SELECT * FROM fraud_flag_runs ORDER BY evaluated_at DESC LIMIT 1',
      )
      .get() as FraudFlagRunRow | undefined;
    return row ? rowToRun(row) : null;
  }

  // ── Checkpoint methods ──────────────────────────────────────────────────────

  getCheckpoint(): FraudCheckpoint | null {
    const row = this.db
      .prepare(
        'SELECT last_ledger, last_event_id, updated_at FROM fraud_checkpoint WHERE id = 1',
      )
      .get() as FraudCheckpointRow | undefined;
    if (!row) return null;
    return {
      lastLedger: row.last_ledger,
      lastEventId: row.last_event_id,
      updatedAt: row.updated_at,
    };
  }

  saveCheckpoint(
    lastLedger: number,
    lastEventId: string | null = null,
    updatedAt: number = Date.now(),
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO fraud_checkpoint (id, last_ledger, last_event_id, updated_at)
         VALUES (1, @last_ledger, @last_event_id, @updated_at)`,
      )
      .run({
        last_ledger: lastLedger,
        last_event_id: lastEventId,
        updated_at: updatedAt,
      });
  }

  resetCheckpoint(): void {
    this.db.prepare('DELETE FROM fraud_checkpoint WHERE id = 1').run();
  }

  // ── Wallet Aggregate methods ────────────────────────────────────────────────

  getWalletAggregate(wallet: string): WalletFraudAggregate | null {
    const row = this.db
      .prepare(
        'SELECT aggregate_data FROM fraud_wallet_aggregates WHERE wallet = ?',
      )
      .get(wallet) as FraudWalletAggregateRow | undefined;
    if (!row) return null;
    return JSON.parse(row.aggregate_data) as WalletFraudAggregate;
  }

  getAllWalletAggregates(): Map<string, WalletFraudAggregate> {
    const rows = this.db
      .prepare('SELECT wallet, aggregate_data FROM fraud_wallet_aggregates')
      .all() as FraudWalletAggregateRow[];
    const map = new Map<string, WalletFraudAggregate>();
    for (const row of rows) {
      map.set(row.wallet, JSON.parse(row.aggregate_data));
    }
    return map;
  }

  saveWalletAggregate(aggregate: WalletFraudAggregate): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO fraud_wallet_aggregates (wallet, aggregate_data, updated_at)
         VALUES (@wallet, @aggregate_data, @updated_at)`,
      )
      .run({
        wallet: aggregate.wallet,
        aggregate_data: JSON.stringify(aggregate),
        updated_at: aggregate.updatedAt || Date.now(),
      });
  }

  saveWalletAggregates(aggregates: WalletFraudAggregate[]): void {
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO fraud_wallet_aggregates (wallet, aggregate_data, updated_at)
       VALUES (@wallet, @aggregate_data, @updated_at)`,
    );
    const tx = this.db.transaction((items: WalletFraudAggregate[]) => {
      for (const item of items) {
        insert.run({
          wallet: item.wallet,
          aggregate_data: JSON.stringify(item),
          updated_at: item.updatedAt || Date.now(),
        });
      }
    });
    tx(aggregates);
  }

  // ── Active Flags methods ───────────────────────────────────────────────────

  getActiveFlags(): FraudFlag[] {
    const rows = this.db
      .prepare('SELECT flag_data FROM fraud_active_flags')
      .all() as FraudActiveFlagRow[];
    const flags = rows.map((r) => JSON.parse(r.flag_data) as FraudFlag);
    const severityRank = { high: 0, medium: 1, low: 2 } as const;
    return flags.sort(
      (a, b) => severityRank[a.severity] - severityRank[b.severity],
    );
  }

  getActiveFlagsForWallet(wallet: string): FraudFlag[] {
    const rows = this.db
      .prepare('SELECT flag_data FROM fraud_active_flags WHERE wallet = ?')
      .all(wallet) as FraudActiveFlagRow[];
    return rows.map((r) => JSON.parse(r.flag_data) as FraudFlag);
  }

  saveActiveFlagsForWallet(wallet: string, flags: FraudFlag[]): void {
    const del = this.db.prepare(
      'DELETE FROM fraud_active_flags WHERE wallet = ?',
    );
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO fraud_active_flags (id, wallet, category, heuristic, severity, flag_data, updated_at)
       VALUES (@id, @wallet, @category, @heuristic, @severity, @flag_data, @updated_at)`,
    );

    const tx = this.db.transaction(() => {
      del.run(wallet);
      const now = Date.now();
      for (const flag of flags) {
        insert.run({
          id: flag.id,
          wallet,
          category: flag.category,
          heuristic: flag.heuristic,
          severity: flag.severity,
          flag_data: JSON.stringify(flag),
          updated_at: now,
        });
      }
    });
    tx();
  }

  saveAllActiveFlags(flags: FraudFlag[]): void {
    const delAll = this.db.prepare('DELETE FROM fraud_active_flags');
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO fraud_active_flags (id, wallet, category, heuristic, severity, flag_data, updated_at)
       VALUES (@id, @wallet, @category, @heuristic, @severity, @flag_data, @updated_at)`,
    );

    const tx = this.db.transaction((items: FraudFlag[]) => {
      delAll.run();
      const now = Date.now();
      for (const flag of items) {
        const primaryWallet = flag.wallets[0] ?? 'unknown';
        insert.run({
          id: flag.id,
          wallet: primaryWallet,
          category: flag.category,
          heuristic: flag.heuristic,
          severity: flag.severity,
          flag_data: JSON.stringify(flag),
          updated_at: now,
        });
      }
    });
    tx(flags);
  }

  clearAggregatesAndCheckpoint(): void {
    this.db.prepare('DELETE FROM fraud_checkpoint').run();
    this.db.prepare('DELETE FROM fraud_wallet_aggregates').run();
    this.db.prepare('DELETE FROM fraud_active_flags').run();
  }

  close(): void {
    this.db.close();
  }
}
