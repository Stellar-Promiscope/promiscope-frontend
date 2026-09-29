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
 *  - One `events` table shared by all 8 event types. Type-specific fields
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
  contract_version INTEGER NOT NULL DEFAULT 1,
  timestamp INTEGER NOT NULL,
  data TEXT NOT NULL,
  event_id TEXT,
  inserted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_player_ledger ON events(player_id, ledger DESC);
CREATE INDEX IF NOT EXISTS idx_events_type_ledger ON events(event_type, ledger DESC);
CREATE INDEX IF NOT EXISTS idx_events_validator ON events(validator, ledger DESC);
CREATE INDEX IF NOT EXISTS idx_events_ledger ON events(ledger DESC);
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

/**
 * Materialized player projection (issue #1298) — one row per registered
 * player, maintained from the event stream so scout discovery never has to
 * run an unpaginated `filter_players` simulation against Soroban (whose
 * read-only CPU/memory/ledger-entry limits are exceeded once the registry
 * grows to a few hundred players).
 *
 * Projection sources:
 *  - `player_registered` — upserts the row (id, wallet, ipfs hash, vitals).
 *  - `profile_updated`   — refreshes ipfs hash / vitals when the payload
 *    carries them.
 *  - `milestone_approved` / `milestone_revoked` — maintain `progress_level`
 *    (approve: `MAX(current, new_level)`; revoke: one-step decrement, which
 *    is what the contract applies on chain).
 *
 * Vitals are extracted tolerantly (nested `vitals` object or flat fields)
 * because no Rust contract source lives in this repository to confirm the
 * event wire format against — the same ASSUMPTION documented on
 * `eventPoller.decodeEvent` and in README.md. A payload without vitals
 * leaves those columns NULL; filters simply won't match such rows.
 *
 * `wallet` is nullable so a milestone for a player registered before the
 * indexer started still creates a (partial) row rather than being dropped —
 * it is backfilled if a replayed `player_registered` event arrives later.
 */
const PLAYERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  player_id TEXT PRIMARY KEY,
  wallet TEXT,
  name TEXT,
  age INTEGER,
  position TEXT,
  region TEXT,
  nationality TEXT,
  ipfs_hash TEXT,
  progress_level INTEGER NOT NULL DEFAULT 0,
  created_ledger INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_ledger INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_players_cursor ON players(created_ledger DESC, player_id DESC);
CREATE INDEX IF NOT EXISTS idx_players_region ON players(region);
CREATE INDEX IF NOT EXISTS idx_players_position ON players(position);
CREATE INDEX IF NOT EXISTS idx_players_level ON players(progress_level);
`;

export interface EventRecord {
  id: number;
  type: EventType;
  playerId: string | null;
  scout: string | null;
  validator: string | null;
  ledger: number;
  contractVersion: number;
  timestamp: number;
  data: Record<string, unknown>;
  /** The content-derived id `insertEvent` deduplicates on; null for rows written before this column existed. */
  eventId: string | null;
}

export interface QueryFilter {
  type?: EventType;
  playerId?: string;
  validator?: string;
  /** Keyset cursor: only return events with ledger strictly less than this. */
  before?: number;
  /** Keyset cursor: only return events with ledger strictly greater than this. */
  after?: number;
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

/**
 * Page size bounds for GET /players (issue #1298): the endpoint's contract
 * is `limit ≤ 50`, so requests above 50 are capped here rather than
 * rejected — same silent-cap convention as the event endpoints use for
 * MAX_LIMIT.
 */
const DEFAULT_PLAYERS_LIMIT = 50;
const MAX_PLAYERS_LIMIT = 50;

/** Filter + cursor for the materialized players query (GET /players). */
export interface PlayerQueryFilter {
  /** Exact-match region; empty/omitted = all regions. */
  region?: string;
  /** Exact-match position; empty/omitted = all positions. */
  position?: string;
  /** Minimum progress level (0–3); 0/omitted = every level. */
  minLevel?: number;
  /** Only players created strictly after this unix-seconds timestamp — powers the saved-search "new since last viewed" badge. */
  createdAfter?: number;
  /** Opaque keyset cursor from a previous page's `nextCursor`. */
  cursor?: string;
  /** Page size, capped at MAX_PLAYERS_LIMIT. */
  limit?: number;
}

/** Flat materialized-player row, camelCased for API consumers. */
export interface PlayerRecord {
  id: string;
  wallet: string;
  name: string;
  age: number;
  position: string;
  region: string;
  nationality: string;
  ipfsHash: string;
  progressLevel: number;
  createdAt: number;
  updatedLedger: number;
}

export interface PlayersQueryResult {
  players: PlayerRecord[];
  /** Pass as `cursor` on the next call; null when the result set is exhausted. */
  nextCursor: string | null;
  /** Total rows matching the filters, independent of the cursor — lets the dashboard show an accurate "N players found" without loading every page. */
  total: number;
}

/**
 * Keyset cursor over the stable order key `(created_ledger DESC,
 * player_id DESC)`. Encoded as base64url of `${ledger}:${playerId}` so
 * clients treat it as opaque (the format may evolve without breaking
 * callers that only echo it back).
 */
export function encodePlayerCursor(ledger: number, playerId: string): string {
  return Buffer.from(`${ledger}:${playerId}`, 'utf8').toString('base64url');
}

/** Decodes a cursor produced by encodePlayerCursor; null when malformed. */
export function decodePlayerCursor(
  cursor: string,
): { ledger: number; playerId: string } | null {
  if (
    typeof cursor !== 'string' ||
    cursor.length === 0 ||
    cursor.length > 512
  ) {
    return null;
  }
  let raw: string;
  try {
    raw = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const sep = raw.indexOf(':');
  if (sep <= 0) return null;
  const ledger = Number(raw.slice(0, sep));
  const playerId = raw.slice(sep + 1);
  if (!Number.isInteger(ledger) || ledger < 0 || playerId.length === 0) {
    return null;
  }
  return { ledger, playerId };
}

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
  contract_version: number;
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
    contractVersion: row.contract_version,
    timestamp: row.timestamp,
    data: JSON.parse(row.data),
    eventId: row.event_id,
  };
}

/** Raw row shape of the materialized `players` table. */
interface PlayerRow {
  player_id: string;
  wallet: string | null;
  name: string | null;
  age: number | null;
  position: string | null;
  region: string | null;
  nationality: string | null;
  ipfs_hash: string | null;
  progress_level: number;
  created_ledger: number;
  created_at: number;
  updated_ledger: number;
}

/**
 * Maps a players row to the API record. NULL vitals become empty values
 * (the frontend's `PlayerVitals` has no nullable fields) — a player
 * registered without vitals in the event payload renders with placeholders
 * and simply won't match region/position filters, rather than being hidden.
 */
function rowToPlayerRecord(row: PlayerRow): PlayerRecord {
  return {
    id: row.player_id,
    wallet: row.wallet ?? '',
    name: row.name ?? '',
    age: row.age ?? 0,
    position: row.position ?? '',
    region: row.region ?? '',
    nationality: row.nationality ?? '',
    ipfsHash: row.ipfs_hash ?? '',
    progressLevel: row.progress_level,
    createdAt: row.created_at,
    updatedLedger: row.updated_ledger,
  };
}

function fieldAsString(
  data: Record<string, unknown>,
  key: string,
): string | null {
  const v = data[key];
  return typeof v === 'string' ? v : null;
}

/** Vitals columns as stored on the materialized players row. */
export interface ExtractedVitals {
  name: string | null;
  age: number | null;
  position: string | null;
  region: string | null;
  nationality: string | null;
}

/**
 * Tolerantly extracts a player's vitals from an event payload (issue
 * #1298). Accepts either a nested `vitals` object (the on-chain
 * `PlayerVitals` shape) or the same fields flattened onto the payload
 * itself; anything missing/ill-typed comes back as NULL and is stored as
 * NULL (never coerced to a misleading empty value).
 */
export function extractVitals(data: Record<string, unknown>): ExtractedVitals {
  const source =
    typeof data.vitals === 'object' && data.vitals !== null
      ? (data.vitals as Record<string, unknown>)
      : data;
  const str = (key: string): string | null =>
    typeof source[key] === 'string' ? (source[key] as string) : null;
  const ageRaw = source.age;
  const ageNum =
    typeof ageRaw === 'number'
      ? ageRaw
      : typeof ageRaw === 'string' && ageRaw.trim() !== ''
        ? Number(ageRaw)
        : NaN;
  return {
    name: str('name'),
    age: Number.isFinite(ageNum) ? ageNum : null,
    position: str('position'),
    region: str('region'),
    nationality: str('nationality'),
  };
}

export class EventStore {
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
    this.migrateContractVersionColumn();
    this.db.exec(UNIQUE_EVENT_ID_INDEX);
    this.db.exec(VALIDATOR_TIMESTAMP_INDEX);
    this.db.exec(PLAYERS_SCHEMA);
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

  private migrateContractVersionColumn(): void {
    const columns = this.db.prepare('PRAGMA table_info(events)').all() as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === 'contract_version')) {
      this.db.exec(
        'ALTER TABLE events ADD COLUMN contract_version INTEGER NOT NULL DEFAULT 1',
      );
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
   * SSE subscriber registry. Keyed by a unique subscriber id. Each entry
   * holds the filter (topics/wallet) and a push callback. `insertEvent`
   * fans out to matching subscribers after every new write.
   *
   * NOTE: This is per-process. Horizontal scaling would require Redis
   * pub/sub to broadcast across indexer instances.
   */
  private subscribers = new Map<
    string,
    {
      topics: Set<string>;
      wallet: string | null;
      push: (record: EventRecord) => void;
    }
  >();

  private nextSubscriberId = 0;

  /**
   * Registers an SSE subscriber that will be called with every new event
   * that matches its filter. Returns an unsubscribe function.
   *
   * @param topics  - set of event type strings to include; empty = all topics
   * @param wallet  - if set, only events where playerId, scout, or validator equals this wallet
   * @param push    - callback invoked with each matched EventRecord
   */
  subscribe(
    topics: string[],
    wallet: string | null,
    push: (record: EventRecord) => void,
  ): () => void {
    const id = String(this.nextSubscriberId++);
    this.subscribers.set(id, {
      topics: new Set(topics),
      wallet,
      push,
    });
    return () => this.subscribers.delete(id);
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
   *
   * The event insert and the `players` projection it drives run in one
   * SQLite transaction, so the materialized table can never diverge from
   * the event log (issue #1298): either both land or neither does.
   */
  insertEvent(decoded: DecodedEvent): boolean {
    const inserted = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT OR IGNORE INTO events (event_type, player_id, scout, validator, ledger, contract_version, timestamp, data, event_id, inserted_at)
           VALUES (@event_type, @player_id, @scout, @validator, @ledger, @contract_version, @timestamp, @data, @event_id, @inserted_at)`,
        )
        .run({
          event_type: decoded.type,
          player_id: fieldAsString(decoded.data, 'player_id'),
          scout: fieldAsString(decoded.data, 'scout'),
          validator: fieldAsString(decoded.data, 'validator'),
          ledger: decoded.ledger,
          contract_version: decoded.contractVersion,
          timestamp: decoded.timestamp,
          data: JSON.stringify(decoded.data),
          event_id: decoded.eventId,
          inserted_at: Date.now(),
        });
      const wrote = result.changes > 0;
      if (wrote) this.applyProjection(decoded);
      return wrote;
    })();
    if (inserted && decoded.type === 'milestone_approved') {
      // A new approval can change any in-flight approval-counts result, so
      // drop the cache rather than serve a stale rollup until the TTL
      // happens to expire on its own.
      this.approvalCountsCache.clear();
    }
    if (inserted) {
      // Fan out to SSE subscribers after the write is committed.
      if (this.subscribers.size > 0) {
        // Fetch the actual written row so subscribers get the assigned id.
        const row = this.db
          .prepare(
            'SELECT * FROM events WHERE event_id = ? ORDER BY id DESC LIMIT 1',
          )
          .get(decoded.eventId ?? '') as EventRow | undefined;
        const record = row ? rowToRecord(row) : null;
        if (record) {
          for (const sub of this.subscribers.values()) {
            const topicMatch =
              sub.topics.size === 0 || sub.topics.has(record.type);
            const walletMatch =
              !sub.wallet ||
              record.playerId === sub.wallet ||
              record.scout === sub.wallet ||
              record.validator === sub.wallet;
            if (topicMatch && walletMatch) {
              try {
                sub.push(record);
              } catch {
                // Subscriber closed; will be removed by its own unsubscribe
              }
            }
          }
        }
      }
    }
    return inserted;
  }

  /**
   * Applies one decoded event to the materialized `players` table. Called
   * from inside insertEvent's transaction and only for events that were
   * genuinely new, so the exactly-once guarantee on `event_id` doubles as a
   * no-double-apply guarantee for level increments/decrements.
   */
  private applyProjection(decoded: DecodedEvent): void {
    switch (decoded.type) {
      case 'player_registered':
        this.upsertRegisteredPlayer(decoded);
        break;
      case 'profile_updated':
        this.applyProfileUpdate(decoded);
        break;
      case 'milestone_approved':
        this.applyMilestoneApproved(decoded);
        break;
      case 'milestone_revoked':
        this.applyMilestoneRevoked(decoded);
        break;
      default:
        break;
    }
  }

  /**
   * player_registered → insert-or-refresh the player row.
   *
   * COALESCE on every updatable column means a replayed registration never
   * clobbers richer existing data with NULLs, and a skeleton row created
   * earlier by a milestone event gets its wallet/vitals backfilled when the
   * registration event is (re)played.
   */
  private upsertRegisteredPlayer(decoded: DecodedEvent): void {
    const playerId = fieldAsString(decoded.data, 'player_id');
    if (!playerId) return;
    const vitals = extractVitals(decoded.data);
    this.db
      .prepare(
        `INSERT INTO players (player_id, wallet, name, age, position, region, nationality, ipfs_hash, progress_level, created_ledger, created_at, updated_ledger)
         VALUES (@player_id, @wallet, @name, @age, @position, @region, @nationality, @ipfs_hash, 0, @ledger, @timestamp, @ledger)
         ON CONFLICT(player_id) DO UPDATE SET
           wallet = COALESCE(excluded.wallet, players.wallet),
           name = COALESCE(excluded.name, players.name),
           age = COALESCE(excluded.age, players.age),
           position = COALESCE(excluded.position, players.position),
           region = COALESCE(excluded.region, players.region),
           nationality = COALESCE(excluded.nationality, players.nationality),
           ipfs_hash = COALESCE(excluded.ipfs_hash, players.ipfs_hash),
           created_ledger = MIN(players.created_ledger, excluded.created_ledger),
           created_at = MIN(players.created_at, excluded.created_at),
           updated_ledger = excluded.updated_ledger`,
      )
      .run({
        player_id: playerId,
        wallet: fieldAsString(decoded.data, 'wallet'),
        name: vitals.name,
        age: vitals.age,
        position: vitals.position,
        region: vitals.region,
        nationality: vitals.nationality,
        ipfs_hash: fieldAsString(decoded.data, 'ipfs_hash'),
        ledger: decoded.ledger,
        timestamp: decoded.timestamp,
      });
  }

  /**
   * profile_updated → refresh media/vitals on an existing row. Creates a
   * skeleton first (INSERT OR IGNORE) so an out-of-order update for a
   * player whose registration hasn't been indexed yet doesn't vanish.
   */
  private applyProfileUpdate(decoded: DecodedEvent): void {
    const playerId = fieldAsString(decoded.data, 'player_id');
    if (!playerId) return;
    const vitals = extractVitals(decoded.data);
    this.ensurePlayerSkeleton(playerId, decoded);
    this.db
      .prepare(
        `UPDATE players SET
           ipfs_hash = COALESCE(@ipfs_hash, ipfs_hash),
           name = COALESCE(@name, name),
           age = COALESCE(@age, age),
           position = COALESCE(@position, position),
           region = COALESCE(@region, region),
           nationality = COALESCE(@nationality, nationality),
           updated_ledger = @ledger
         WHERE player_id = @player_id`,
      )
      .run({
        player_id: playerId,
        ipfs_hash: fieldAsString(decoded.data, 'ipfs_hash'),
        name: vitals.name,
        age: vitals.age,
        position: vitals.position,
        region: vitals.region,
        nationality: vitals.nationality,
        ledger: decoded.ledger,
      });
  }

  /**
   * milestone_approved → progress_level = MAX(current, new_level). MAX (not
   * plain assignment) so a re-delivered or out-of-order event can't lower a
   * level the chain has already advanced past; a payload without `new_level`
   * leaves the level untouched (the row still gets created).
   */
  private applyMilestoneApproved(decoded: DecodedEvent): void {
    const playerId = fieldAsString(decoded.data, 'player_id');
    if (!playerId) return;
    this.ensurePlayerSkeleton(playerId, decoded);
    const newLevel = decoded.data.new_level;
    if (typeof newLevel !== 'number' || !Number.isInteger(newLevel)) return;
    this.db
      .prepare(
        `UPDATE players SET progress_level = MAX(progress_level, @new_level), updated_ledger = @ledger
         WHERE player_id = @player_id`,
      )
      .run({
        player_id: playerId,
        new_level: newLevel,
        ledger: decoded.ledger,
      });
  }

  /**
   * milestone_revoked → one-step decrement (what the contract applies on
   * chain), floored at 0. Safe from double-decrement because projection
   * only runs for genuinely new events.
   */
  private applyMilestoneRevoked(decoded: DecodedEvent): void {
    const playerId = fieldAsString(decoded.data, 'player_id');
    if (!playerId) return;
    this.ensurePlayerSkeleton(playerId, decoded);
    this.db
      .prepare(
        `UPDATE players SET progress_level = MAX(progress_level - 1, 0), updated_ledger = @ledger
         WHERE player_id = @player_id`,
      )
      .run({ player_id: playerId, ledger: decoded.ledger });
  }

  /** Creates a vitals-less row for an unknown player (see PLAYERS_SCHEMA). */
  private ensurePlayerSkeleton(playerId: string, decoded: DecodedEvent): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO players (player_id, progress_level, created_ledger, created_at, updated_ledger)
         VALUES (@player_id, 0, @ledger, @timestamp, @ledger)`,
      )
      .run({
        player_id: playerId,
        ledger: decoded.ledger,
        timestamp: decoded.timestamp,
      });
  }

  /**
   * Paginated, filterable query over the materialized players table (issue
   * #1298) — the scout-discovery replacement for an unpaginated
   * `filter_players` simulation.
   *
   * Ordered by the stable key (created_ledger DESC, player_id DESC) with
   * keyset pagination on that same pair, so page cost stays proportional to
   * page size — no OFFSET scan degradation as the registry grows, and no
   * skipped/duplicated rows when new players register mid-pagination.
   *
   * `total` runs the same filter clauses minus the cursor, so callers can
   * show an accurate "N players found" without fetching every page.
   */
  getPlayers(filter: PlayerQueryFilter = {}): PlayersQueryResult {
    const limit = Math.min(
      Math.max(filter.limit ?? DEFAULT_PLAYERS_LIMIT, 1),
      MAX_PLAYERS_LIMIT,
    );

    const clauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.region) {
      clauses.push('region = @region');
      params.region = filter.region;
    }
    if (filter.position) {
      clauses.push('position = @position');
      params.position = filter.position;
    }
    if (filter.minLevel !== undefined && filter.minLevel > 0) {
      clauses.push('progress_level >= @minLevel');
      params.minLevel = filter.minLevel;
    }
    if (filter.createdAfter !== undefined) {
      clauses.push('created_at > @createdAfter');
      params.createdAfter = filter.createdAfter;
    }

    const filterWhere =
      clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const total = (
      this.db
        .prepare(`SELECT COUNT(*) AS count FROM players ${filterWhere}`)
        .get(params) as { count: number }
    ).count;

    const pageClauses = [...clauses];
    if (filter.cursor !== undefined) {
      const decoded = decodePlayerCursor(filter.cursor);
      if (!decoded) throw new Error('invalid cursor');
      pageClauses.push(
        '(created_ledger < @cursorLedger OR (created_ledger = @cursorLedger AND player_id < @cursorId))',
      );
      params.cursorLedger = decoded.ledger;
      params.cursorId = decoded.playerId;
    }
    const pageWhere =
      pageClauses.length > 0 ? `WHERE ${pageClauses.join(' AND ')}` : '';

    const rows = this.db
      .prepare(
        `SELECT * FROM players ${pageWhere}
         ORDER BY created_ledger DESC, player_id DESC
         LIMIT @limit`,
      )
      .all({ ...params, limit: limit + 1 }) as PlayerRow[];

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      players: page.map(rowToPlayerRecord),
      nextCursor:
        hasMore && last
          ? encodePlayerCursor(last.created_ledger, last.player_id)
          : null,
      total,
    };
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
    if (filter.after !== undefined) {
      clauses.push('ledger > @after');
      params.after = filter.after;
    }

    const order =
      filter.after !== undefined && filter.before === undefined
        ? 'ORDER BY ledger ASC, id ASC'
        : 'ORDER BY ledger DESC, id DESC';

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT * FROM events ${where} ${order} LIMIT @limit`,
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

  /** Runs `fn` inside a single SQLite transaction (rolled back if it throws). */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Flushes the WAL into the main DB file and closes the connection — the
   * last step of the indexer's graceful shutdown (issue #1333).
   */
  close(): void {
    if (!this.db.open) return;
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
      this.db.close();
    }
    if (EventStore._instance === this) EventStore._instance = null;
  }
}
