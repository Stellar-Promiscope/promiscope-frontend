/**
 * @jest-environment node
 *
 * Two replicas against a real Postgres (issue #1319). Skipped unless
 * INDEXER_TEST_DATABASE_URL points at a disposable database, e.g.:
 *
 *   docker run --rm -e POSTGRES_PASSWORD=pg -p 5432:5432 postgres:16
 *   INDEXER_TEST_DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres \
 *     npx jest packages/indexer/src/__tests__/replicas.pg.integration
 */
import { nativeToScVal } from '@stellar/stellar-sdk';
import { pollOnce, type PollerConfig, type RpcClient } from '../eventPoller';
import { IndexerMetrics } from '../metrics/IndexerMetrics';
import { PgEventStore, type PgPool } from '../db/pgEventStore';
import { LeaderElector } from '../leaderElection';

const url = process.env.INDEXER_TEST_DATABASE_URL;
const describeIfPg = url ? describe : describe.skip;

const config: PollerConfig = {
  rpcUrl: 'http://localhost',
  contractId: 'CTEST',
  networkPassphrase: 'Test SDF Network ; September 2015',
  pollIntervalMs: 500,
  startLedger: 100,
};

const rpc: RpcClient = {
  getLatestLedger: async () => ({ sequence: 110 }),
  getEvents: async () => ({
    latestLedger: 110,
    events: [100, 101, 102].map((ledger) => ({
      ledger,
      ledgerClosedAt: new Date(1_700_000_000 * 1000).toISOString(),
      topic: [nativeToScVal('player_registered', { type: 'symbol' })],
      value: nativeToScVal({ player_id: `p${ledger}` }),
    })),
  }),
};

describeIfPg('indexer replicas on Postgres', () => {
  let poolA: PgPool & { end(): Promise<void> };
  let poolB: PgPool & { end(): Promise<void> };
  let store: PgEventStore;

  beforeAll(async () => {
    const { Pool } = require('pg') as typeof import('pg');
    poolA = new Pool({ connectionString: url }) as never;
    poolB = new Pool({ connectionString: url }) as never;
    await poolA.query('DROP TABLE IF EXISTS events, checkpoint');
    store = new PgEventStore(poolA);
    await store.init();
  });

  afterAll(async () => {
    await poolA.end();
    await poolB.end();
  });

  it('never duplicates events when both replicas ingest the same range', async () => {
    const storeB = new PgEventStore(poolB);
    const metrics = IndexerMetrics.getInstance();
    await Promise.all([
      pollOnce(config, rpc, metrics, 100, store),
      pollOnce(config, rpc, metrics, 100, storeB),
      pollOnce(config, rpc, metrics, 100, store),
    ]);
    const { rows } = await poolA.query('SELECT COUNT(*)::int AS n FROM events');
    expect(rows[0].n).toBe(3);
    expect(await store.getCheckpoint()).toMatchObject({ lastLedger: 102 });
  });

  it('hands leadership to the follower when the leader session dies', async () => {
    const a = new LeaderElector(poolA, { leaseMs: config.pollIntervalMs });
    const b = new LeaderElector(poolB, { leaseMs: config.pollIntervalMs });
    expect(await a.tick()).toBe(true);
    expect(await b.tick()).toBe(false);

    // Terminate the leader's backend, as a crashed process would.
    await poolB.query(
      `SELECT pg_terminate_backend(pid) FROM pg_locks
       WHERE locktype = 'advisory' AND objid = $1`,
      [7_319_001],
    );
    expect(await b.tick()).toBe(true);
    expect(await a.tick()).toBe(false);
    await b.release();
    await a.release();
  });
});
