/**
 * Store selection (issue #1319): Postgres when INDEXER_DATABASE_URL is set
 * (multi-replica prod), otherwise the embedded SQLite `EventStore` (dev /
 * single replica).
 */
import { EventStore, type IndexerStore } from './eventStore';
import { PgEventStore, type PgPool } from './pgEventStore';

let pgStore: PgEventStore | null = null;
let pgPool: PgPool | null = null;

/** Creates a `pg.Pool` for INDEXER_DATABASE_URL. `pg` is loaded lazily so SQLite-only setups never need it. */
export function createPgPoolFromEnv(): PgPool | null {
  const connectionString = process.env.INDEXER_DATABASE_URL;
  if (!connectionString) return null;
  if (!pgPool) {
    const { Pool } = require('pg') as typeof import('pg');
    pgPool = new Pool({ connectionString }) as unknown as PgPool;
  }
  return pgPool;
}

/** Initialises the configured store (creates the Postgres schema if needed). */
export async function initStore(): Promise<IndexerStore> {
  const pool = createPgPoolFromEnv();
  if (!pool) return EventStore.getInstance();
  if (!pgStore) {
    const store = new PgEventStore(pool);
    await store.init();
    pgStore = store;
  }
  return pgStore;
}

/** The active store: the Postgres store once `initStore` has run, else SQLite. */
export function getStore(): IndexerStore {
  return pgStore ?? EventStore.getInstance();
}
