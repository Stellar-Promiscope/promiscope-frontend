/**
 * eventStore — SQLite-backed persistence and query layer for decoded contract
 * events.
 *
 * This is the datastore promised by README.md's architecture diagram
 * ("persists them for fast querying, so the frontend can query historical
 * data without hitting the RPC node for every page load") but never
 * implemented. Every event `eventPoller.pollOnce` successfully decodes is
 * written here; `server.ts`'s query endpoints read from here.
 *
 * Design:
 *  - better-sqlite3: synchronous, embedded, zero-ops file database. No
 *    separate DB server to run/deploy alongside a small indexer process.
 *  - One `events` table shared by all 7 event types. Type-specific fields
 *    (e.g. `new_level` on milestone_approved, `fee_xlm` on scout_subscribed)
 *    live in the `data` JSON column rather than as dedicated columns —
 *    conservative schema, per the issue's guidance not to generalize before
 *    there's a second use case. The handful of fields shared across event
 *    types that queries actually filter/sort by (`event_type`, `player_id`,
 *    `scout`, `validator`, `ledger`) get real indexed columns.
 *  - Keyset pagination on `ledger` (not OFFSET) so query cost stays
 *    proportional to page size, not to how deep into the history you are.
 */
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import type { EventType } from '../metrics/IndexerMetrics';
import type { DecodedEvent } from '../eventPoller';

const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', 'data', 'indexer.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  player_id TEXT,
  scout TEXT,
  validator TEXT,
  ledger INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  data TEXT NOT NULL,
  event_id TEXT,
  inserted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_player_ledger ON events(player_id, ledger DESC);
CREATE INDEX IF NOT EXISTS idx_events_type_ledger ON events(event_type, ledger DESC);
CREATE INDEX IF NOT EXISTS idx_events_validator ON events(validator, ledger DESC);
CREATE INDEX IF NOT EXISTS idx_events_ledger ON events(ledger DESC);
CREATE TABLE IF NOT EXISTS checkpoint (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_ledger INTEGER NOT NULL,
  network_ledger INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

/**
 * Supports getApprovalCountsForWallets's per-wallet time-bounded lookup
 * (issue #1172): a composite index on (validator, event_type, timestamp)
 * lets that query's join do an indexed lookup per wallet instead of a table
 * scan, since it filters by validator + event_type and ranges on timestamp.
 */
const VALIDATOR_TIMESTAMP_INDEX = `
CREATE INDEX IF NOT EXISTS idx_events_validator_type_timestamp ON events(validator, event_type, timestamp);
`;

/**
 * Unique index enforcing exactly-once ingestion (issue #1180): `event_id`
 * is the content-derived id `eventPoller.decodeEvent` computes per raw
 * on-chain event (see `computeEventId`), so the same event observed across
 * two overlapping poll cycles collides on this index instead of becoming a
 * second row. A plain `UNIQUE` index still allows any number of `NULL`
 * `event_id` values (SQLite never treats `NULL = NULL`), which keeps this
 * safe to add against a pre-existing `events` table via the migration
 * below, whose already-ingested rows predate the column.
 */
const UNIQUE_EVENT_ID_INDEX = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_event_id ON events(event_id);
`;

export interface EventRecord {
  id: number;
  type: EventType;
  playerId: string | null;
  scout: string | null;
  validator: string | null;
  ledger: number;
  timestamp: number;
  data: Record<string, unknown>;
  /** The content-derived id `insertEvent` deduplicates on; null for rows written before this column existed. */
  eventId: string | null;
}

/**
 * The poller's durable resume point (issue #1319). Written in the same
 * transaction as the event batch it covers, so a crash can never leave the
 * checkpoint ahead of (skipped events) or behind (re-ingest, harmless given
 * the unique `event_id`) the rows actually stored.
 */
export interface Checkpoint {
  /** Last fully indexed ledger. */
  lastLedger: number;
  /** Network tip observed by the leader when it wrote this checkpoint. */
  networkLedger: number;
  /** Unix ms of the write. */
  updatedAt: number;
}

/**
 * The storage surface the poller and HTTP API depend on. Implemented by the
 * synchronous SQLite `EventStore` (dev / single replica) and the async
 * `PgEventStore` (multi-replica prod), hence the `T | Promise<T>` returns —
 * callers always `await`.
 */
export interface IndexerStore {
  insertBatch(
    events: DecodedEvent[],
    checkpoint: Omit<Checkpoint, 'updatedAt'>,
  ): number | Promise<number>;
  getCheckpoint(): Checkpoint | null | Promise<Checkpoint | null>;
  getEvents(filter?: QueryFilter): QueryResult | Promise<QueryResult>;
  getEventsByPlayer(
    playerId: string,
    filter?: Omit<QueryFilter, 'playerId'>,
  ): QueryResult | Promise<QueryResult>;
  getApprovalCountsForWallets(
    range: { start: number; end: number },
    wallets: WalletApprovalWindow[],
  ): ApprovalCountsByWallet | Promise<ApprovalCountsByWallet>;
}

export interface QueryFilter {
  type?: EventType;
  playerId?: string;
  validator?: string;
  /** Keyset cursor: only return events with ledger strictly less than this. */
  before?: number;
  /** Page size, capped at MAX_LIMIT. */
  limit?: number;
}

export interface QueryResult {
  events: EventRecord[];
  /** Pass as `before` on the next call to fetch the next page; null when exhausted. */
  nextCursor: number | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** One wallet + the earliest timestamp (inclusive) whose approvals should count for it. */
export interface WalletApprovalWindow {
  wallet: string;
  /** Only events at or after this timestamp count — typically the wallet's academy_members.added_at. */
  since: number;
}

/** Per-wallet approved-milestone counts for a time range, keyed by wallet. */
export type ApprovalCountsByWallet = Record<string, number>;

/** Hard cap on how many wallets a single getApprovalCountsForWallets call will accept. */
const MAX_WALLETS_PER_QUERY = 500;

/**
 * Bounds how long a computed approval-counts result is reused before being
 * recomputed (issue #1172's "don't re-scan on every request" requirement).
 * Cleared eagerly on every new insertEvent so a fresh approval is reflected
 * well before the TTL would otherwise expire it.
 */
const APPROVAL_COUNTS_CACHE_TTL_MS = 30_000;

interface ApprovalCountsCacheEntry {
  computedAt: number;
  counts: ApprovalCountsByWallet;
}

interface EventRow {
  id: number;
  event_type: string;
  player_id: string | null;
  scout: string | null;
  validator: string | null;
  ledger: number;
  timestamp: number;
  data: string;
  event_id: string | null;
}

function rowToRecord(row: EventRow): EventRecord {
  return {
    id: row.id,
    type: row.event_type as EventType,
    playerId: row.player_id,
    scout: row.scout,
    validator: row.validator,
    ledger: row.ledger,
    timestamp: row.timestamp,
    data: JSON.parse(row.data),
    eventId: row.event_id,
  };
}

function fieldAsString(
  data: Record<string, unknown>,
  key: string,
): string | null {
  const v = data[key];
  return typeof v === 'string' ? v : null;
}

export class EventStore implements IndexerStore {
  private static _instance: EventStore | null = null;

  private db: Database.Database;

  /**
   * Memoizes getApprovalCountsForWallets results keyed by the exact
   * (range, wallet+since set) requested, so repeated calls for the same
   * academy-rollup request (e.g. an admin dashboard re-rendering, or two
   * academies sharing a time range) within APPROVAL_COUNTS_CACHE_TTL_MS
   * reuse one computed result instead of re-running the join. Cleared
   * wholesale on every insertEvent rather than tracked per-key, since the
   * cache is small and short-lived enough that this is simpler than
   * fine-grained invalidation.
   */
  private approvalCountsCache = new Map<string, ApprovalCountsCacheEntry>();

  private constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    if (dbPath !== ':memory:') {
      // WAL: readers (the query API) don't block the writer (the poller).
      this.db.pragma('journal_mode = WAL');
    }
    this.db.exec(SCHEMA);
    this.migrateEventIdColumn();
    this.db.exec(UNIQUE_EVENT_ID_INDEX);
    this.db.exec(VALIDATOR_TIMESTAMP_INDEX);
  }

  /**
   * Adds `event_id` to a pre-existing `events` table that predates it.
   * `CREATE TABLE IF NOT EXISTS` in SCHEMA is a no-op against an existing
   * table, so a DB file created before this migration would otherwise be
   * missing the column the unique index below depends on.
   */
  private migrateEventIdColumn(): void {
    const columns = this.db.prepare('PRAGMA table_info(events)').all() as {
      name: string;
    }[];
    const hasEventId = columns.some((c) => c.name === 'event_id');
    if (!hasEventId) {
      this.db.exec('ALTER TABLE events ADD COLUMN event_id TEXT');
    }
  }

  /**
   * Returns the process-wide singleton, matching IndexerMetrics's pattern.
   * `dbPath` is only honored on first construction; pass it once at startup
   * (or via INDEXER_DB_PATH) rather than relying on call order elsewhere.
   */
  static getInstance(dbPath?: string): EventStore {
    if (!EventStore._instance) {
      const resolvedPath =
        dbPath ??
        process.env.INDEXER_DB_PATH ??
        (process.env.NODE_ENV === 'test' ? ':memory:' : DEFAULT_DB_PATH);
      EventStore._instance = new EventStore(resolvedPath);
    }
    return EventStore._instance;
  }

  /** Closes the DB connection and clears the singleton. Use ONLY in tests. */
  static resetInstance(): void {
    if (EventStore._instance) {
      EventStore._instance.db.close();
    }
    EventStore._instance = null;
  }

  /**
   * Persists one decoded event. Called from the poll loop after a
   * successful decode.
   *
   * Idempotent on `decoded.eventId` (issue #1180): `INSERT OR IGNORE`
   * against the unique index on `event_id` means re-inserting an event
   * already seen in an earlier poll cycle — the "overlapping polling
   * windows" scenario from the issue — is a silent no-op rather than a
   * second row with a new AUTOINCREMENT id. That's what gives every
   * consumer of this table (deriveNotifications in the frontend, in
   * particular) an exactly-once guarantee for free: the same on-chain
   * event can never end up with two different row ids to be notified
   * about.
   *
   * Returns whether a new row was actually written, so callers can tell a
   * genuinely new event apart from a duplicate re-poll.
   */
  insertEvent(decoded: DecodedEvent): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO events (event_type, player_id, scout, validator, ledger, timestamp, data, event_id, inserted_at)
         VALUES (@event_type, @player_id, @scout, @validator, @ledger, @timestamp, @data, @event_id, @inserted_at)`,
      )
      .run({
        event_type: decoded.type,
        player_id: fieldAsString(decoded.data, 'player_id'),
        scout: fieldAsString(decoded.data, 'scout'),
        validator: fieldAsString(decoded.data, 'validator'),
        ledger: decoded.ledger,
        timestamp: decoded.timestamp,
        data: JSON.stringify(decoded.data),
        event_id: decoded.eventId,
        inserted_at: Date.now(),
      });
    const inserted = result.changes > 0;
    if (inserted && decoded.type === 'milestone_approved') {
      // A new approval can change any in-flight approval-counts result, so
      // drop the cache rather than serve a stale rollup until the TTL
      // happens to expire on its own.
      this.approvalCountsCache.clear();
    }
    return inserted;
  }

  /**
   * Inserts a batch of events and advances the checkpoint in one
   * transaction (issue #1319). If any insert throws, nothing — neither the
   * events nor the checkpoint — is persisted. The checkpoint never moves
   * backwards. Returns the number of newly written rows.
   */
  insertBatch(
    events: DecodedEvent[],
    checkpoint: Omit<Checkpoint, 'updatedAt'>,
  ): number {
    const run = this.db.transaction((): number => {
      let inserted = 0;
      for (const event of events) {
        if (this.insertEvent(event)) inserted++;
      }
      this.db
        .prepare(
          `INSERT INTO checkpoint (id, last_ledger, network_ledger, updated_at)
           VALUES (1, @last, @network, @now)
           ON CONFLICT(id) DO UPDATE SET
             last_ledger = MAX(last_ledger, excluded.last_ledger),
             network_ledger = excluded.network_ledger,
             updated_at = excluded.updated_at`,
        )
        .run({
          last: checkpoint.lastLedger,
          network: checkpoint.networkLedger,
          now: Date.now(),
        });
      return inserted;
    });
    return run();
  }

  getCheckpoint(): Checkpoint | null {
    const row = this.db
      .prepare(
        'SELECT last_ledger, network_ledger, updated_at FROM checkpoint WHERE id = 1',
      )
      .get() as
      | { last_ledger: number; network_ledger: number; updated_at: number }
      | undefined;
    return row
      ? {
          lastLedger: row.last_ledger,
          networkLedger: row.network_ledger,
          updatedAt: row.updated_at,
        }
      : null;
  }

  /** General event query, optionally filtered by type and/or player. */
  getEvents(filter: QueryFilter = {}): QueryResult {
    const limit = Math.min(filter.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const clauses: string[] = [];
    const params: Record<string, unknown> = { limit: limit + 1 };

    if (filter.type) {
      clauses.push('event_type = @type');
      params.type = filter.type;
    }
    if (filter.playerId) {
      clauses.push('player_id = @playerId');
      params.playerId = filter.playerId;
    }
    if (filter.validator) {
      clauses.push('validator = @validator');
      params.validator = filter.validator;
    }
    if (filter.before !== undefined) {
      clauses.push('ledger < @before');
      params.before = filter.before;
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT * FROM events ${where} ORDER BY ledger DESC, id DESC LIMIT @limit`,
      )
      .all(params) as EventRow[];

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      events: page.map(rowToRecord),
      nextCursor: hasMore ? page[page.length - 1].ledger : null,
    };
  }

  /** Convenience wrapper for the per-player query endpoint. */
  getEventsByPlayer(
    playerId: string,
    filter: Omit<QueryFilter, 'playerId'> = {},
  ): QueryResult {
    return this.getEvents({ ...filter, playerId });
  }

  /**
   * Counts `milestone_approved` events per wallet within `[start, end]`
   * (inclusive, unix ms timestamps), where each wallet additionally has its
   * own lower bound via `since` — the academy-scoped rollup (issue #1172)
   * uses this to pass each member wallet's `academy_members.added_at` so
   * approvals from before a wallet joined its academy are excluded from
   * that academy's total, rather than naively counting "current members x
   * all-time approvals" for the whole requested range.
   *
   * This does NOT exclude approvals made by a wallet *after* it was removed
   * from an academy — `academy_members` rows are hard-deleted on removal
   * (no `removed_at`/tombstone), so a caller can only pass the wallets it
   * currently considers members and has no way to ask "and only up to when
   * this wallet left." See docs/academy-validator-model.md's "Academy
   * milestone rollup" section for the resulting limitation.
   *
   * Grouped in SQL (one indexed query via idx_events_validator_type_timestamp)
   * rather than fetched-then-grouped in application code, and memoized for
   * APPROVAL_COUNTS_CACHE_TTL_MS so a burst of identical requests (e.g. an
   * admin dashboard rendering several academies against the same range)
   * doesn't re-run the query per call.
   */
  getApprovalCountsForWallets(
    range: { start: number; end: number },
    wallets: WalletApprovalWindow[],
  ): ApprovalCountsByWallet {
    if (wallets.length === 0) return {};
    if (wallets.length > MAX_WALLETS_PER_QUERY) {
      throw new Error(
        `getApprovalCountsForWallets: at most ${MAX_WALLETS_PER_QUERY} wallets per call (got ${wallets.length})`,
      );
    }

    const cacheKey = JSON.stringify({
      start: range.start,
      end: range.end,
      // Sort so the same wallet set in a different order still hits the cache.
      wallets: [...wallets]
        .map((w) => [w.wallet, w.since] as const)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    });
    const cached = this.approvalCountsCache.get(cacheKey);
    if (
      cached &&
      Date.now() - cached.computedAt < APPROVAL_COUNTS_CACHE_TTL_MS
    ) {
      return cached.counts;
    }

    const valuesSql = wallets
      .map((_, i) => `(@wallet${i}, @since${i})`)
      .join(', ');
    const params: Record<string, unknown> = {
      start: range.start,
      end: range.end,
    };
    wallets.forEach((w, i) => {
      params[`wallet${i}`] = w.wallet;
      params[`since${i}`] = w.since;
    });

    const rows = this.db
      .prepare(
        `WITH member(wallet, since) AS (VALUES ${valuesSql})
         SELECT m.wallet AS wallet, COUNT(e.id) AS count
         FROM member m
         LEFT JOIN events e
           ON e.validator = m.wallet
          AND e.event_type = 'milestone_approved'
          AND e.timestamp >= MAX(m.since, @start)
          AND e.timestamp <= @end
         GROUP BY m.wallet`,
      )
      .all(params) as { wallet: string; count: number }[];

    const counts: ApprovalCountsByWallet = {};
    for (const row of rows) counts[row.wallet] = row.count;

    this.approvalCountsCache.set(cacheKey, {
      computedAt: Date.now(),
      counts,
    });
    return counts;
  }

  close(): void {
    this.db.close();
  }
}
