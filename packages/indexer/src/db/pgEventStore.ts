/**
 * pgEventStore — Postgres-backed `IndexerStore` for running N indexer
 * replicas against one shared database (issue #1319).
 *
 * Mirrors the SQLite `EventStore` schema and query semantics:
 *  - `INSERT ... ON CONFLICT (event_id) DO NOTHING`, so a double ingest (two
 *    leaders briefly overlapping, or a re-polled ledger range) is harmless.
 *  - The event batch and the checkpoint are written in one transaction.
 *  - The checkpoint only ever moves forward (`GREATEST`), so a stale leader
 *    that commits late can't rewind the resume point.
 *
 * Only a minimal structural slice of `pg.Pool` is used, so tests can supply
 * an in-process fake without a running Postgres.
 */
import type { EventType } from '../metrics/IndexerMetrics';
import type { DecodedEvent } from '../eventPoller';
import type {
  ApprovalCountsByWallet,
  Checkpoint,
  EventRecord,
  IndexerStore,
  QueryFilter,
  QueryResult,
  WalletApprovalWindow,
} from './eventStore';

export interface PgQueryable {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface PgPoolClient extends PgQueryable {
  release(err?: Error | boolean): void;
  on?(event: 'error', listener: (err: Error) => void): unknown;
}

export interface PgPool extends PgQueryable {
  connect(): Promise<PgPoolClient>;
  end?(): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  player_id TEXT,
  scout TEXT,
  validator TEXT,
  ledger BIGINT NOT NULL,
  contract_version INTEGER NOT NULL DEFAULT 1,
  timestamp BIGINT NOT NULL,
  data JSONB NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  inserted_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_player_ledger ON events(player_id, ledger DESC);
CREATE INDEX IF NOT EXISTS idx_events_type_ledger ON events(event_type, ledger DESC);
CREATE INDEX IF NOT EXISTS idx_events_validator ON events(validator, ledger DESC);
CREATE INDEX IF NOT EXISTS idx_events_ledger ON events(ledger DESC);
CREATE INDEX IF NOT EXISTS idx_events_validator_type_timestamp ON events(validator, event_type, timestamp);
CREATE TABLE IF NOT EXISTS checkpoint (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  last_ledger BIGINT NOT NULL,
  network_ledger BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
`;

const INSERT_EVENT_SQL = `INSERT INTO events (event_type, player_id, scout, validator, ledger, contract_version, timestamp, data, event_id, inserted_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (event_id) DO NOTHING`;

const UPSERT_CHECKPOINT_SQL = `INSERT INTO checkpoint (id, last_ledger, network_ledger, updated_at)
VALUES (1, $1, $2, $3)
ON CONFLICT (id) DO UPDATE SET
  last_ledger = GREATEST(checkpoint.last_ledger, EXCLUDED.last_ledger),
  network_ledger = EXCLUDED.network_ledger,
  updated_at = EXCLUDED.updated_at`;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_WALLETS_PER_QUERY = 500;

function fieldAsString(
  data: Record<string, unknown>,
  key: string,
): string | null {
  const v = data[key];
  return typeof v === 'string' ? v : null;
}

function rowToRecord(row: Record<string, any>): EventRecord {
  return {
    id: Number(row.id),
    type: row.event_type as EventType,
    playerId: row.player_id,
    scout: row.scout,
    validator: row.validator,
    ledger: Number(row.ledger),
    contractVersion: Number(row.contract_version ?? 1),
    timestamp: Number(row.timestamp),
    data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
    eventId: row.event_id,
  };
}

export class PgEventStore implements IndexerStore {
  constructor(private readonly pool: PgPool) {}

  /** Creates tables/indexes if missing. Safe to run from every replica. */
  async init(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async insertBatch(
    events: DecodedEvent[],
    checkpoint: Omit<Checkpoint, 'updatedAt'>,
  ): Promise<number> {
    const client = await this.pool.connect();
    let inserted = 0;
    try {
      await client.query('BEGIN');
      for (const e of events) {
        const res = await client.query(INSERT_EVENT_SQL, [
          e.type,
          fieldAsString(e.data, 'player_id'),
          fieldAsString(e.data, 'scout'),
          fieldAsString(e.data, 'validator'),
          e.ledger,
          e.contractVersion,
          e.timestamp,
          JSON.stringify(e.data),
          e.eventId,
          Date.now(),
        ]);
        inserted += res.rowCount ?? 0;
      }
      await client.query(UPSERT_CHECKPOINT_SQL, [
        checkpoint.lastLedger,
        checkpoint.networkLedger,
        Date.now(),
      ]);
      await client.query('COMMIT');
      return inserted;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async getCheckpoint(): Promise<Checkpoint | null> {
    const { rows } = await this.pool.query(
      'SELECT last_ledger, network_ledger, updated_at FROM checkpoint WHERE id = 1',
    );
    if (rows.length === 0) return null;
    return {
      lastLedger: Number(rows[0].last_ledger),
      networkLedger: Number(rows[0].network_ledger),
      updatedAt: Number(rows[0].updated_at),
    };
  }

  async getEvents(filter: QueryFilter = {}): Promise<QueryResult> {
    const limit = Math.min(filter.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const clauses: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      clauses.push(sql.replace('?', `$${params.length}`));
    };

    if (filter.type) add('event_type = ?', filter.type);
    if (filter.playerId) add('player_id = ?', filter.playerId);
    if (filter.validator) add('validator = ?', filter.validator);
    if (filter.before !== undefined) add('ledger < ?', filter.before);

    params.push(limit + 1);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await this.pool.query(
      `SELECT * FROM events ${where} ORDER BY ledger DESC, id DESC LIMIT $${params.length}`,
      params,
    );

    const hasMore = rows.length > limit;
    const page = (hasMore ? rows.slice(0, limit) : rows).map(rowToRecord);
    return {
      events: page,
      nextCursor: hasMore ? page[page.length - 1].ledger : null,
    };
  }

  getEventsByPlayer(
    playerId: string,
    filter: Omit<QueryFilter, 'playerId'> = {},
  ): Promise<QueryResult> {
    return this.getEvents({ ...filter, playerId });
  }

  async getApprovalCountsForWallets(
    range: { start: number; end: number },
    wallets: WalletApprovalWindow[],
  ): Promise<ApprovalCountsByWallet> {
    if (wallets.length === 0) return {};
    if (wallets.length > MAX_WALLETS_PER_QUERY) {
      throw new Error(
        `getApprovalCountsForWallets: at most ${MAX_WALLETS_PER_QUERY} wallets per call (got ${wallets.length})`,
      );
    }

    const { rows } = await this.pool.query(
      `WITH member(wallet, since) AS (
         SELECT * FROM UNNEST($1::text[], $2::bigint[])
       )
       SELECT m.wallet AS wallet, COUNT(e.id)::int AS count
       FROM member m
       LEFT JOIN events e
         ON e.validator = m.wallet
        AND e.event_type = 'milestone_approved'
        AND e.timestamp >= GREATEST(m.since, $3)
        AND e.timestamp <= $4
       GROUP BY m.wallet`,
      [
        wallets.map((w) => w.wallet),
        wallets.map((w) => w.since),
        range.start,
        range.end,
      ],
    );

    const counts: ApprovalCountsByWallet = {};
    for (const row of rows) counts[row.wallet] = Number(row.count);
    return counts;
  }
}
