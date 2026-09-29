/**
 * @jest-environment node
 *
 * Leader election and multi-replica polling (issue #1319), against an
 * in-process fake of Postgres advisory-lock semantics: a session lock is
 * held until explicitly unlocked or until its connection dies.
 */
import { nativeToScVal } from '@stellar/stellar-sdk';
import {
  startEventPolling,
  type PollerConfig,
  type RpcClient,
} from '../eventPoller';
import { IndexerMetrics } from '../metrics/IndexerMetrics';
import { getRole, resetLedgerState } from '../ledgerTracker';
import { EventStore } from '../db/eventStore';
import { LeaderElector } from '../leaderElection';
import type { PgPool, PgPoolClient } from '../db/pgEventStore';

class FakeLockServer {
  holder: FakeClient | null = null;

  pool(): PgPool & { clients: FakeClient[] } {
    const clients: FakeClient[] = [];
    return {
      clients,
      connect: async () => {
        const c = new FakeClient(this);
        clients.push(c);
        return c;
      },
      query: async () => ({ rows: [] }),
    };
  }
}

class FakeClient implements PgPoolClient {
  dead = false;
  constructor(private readonly server: FakeLockServer) {}

  async query(text: string) {
    if (this.dead) throw new Error('Connection terminated');
    if (text.includes('pg_try_advisory_lock')) {
      if (!this.server.holder || this.server.holder === this) {
        this.server.holder = this;
        return { rows: [{ acquired: true }] };
      }
      return { rows: [{ acquired: false }] };
    }
    if (text.includes('pg_locks')) {
      return { rows: [{ held: this.server.holder === this }] };
    }
    if (text.includes('pg_advisory_unlock')) {
      if (this.server.holder === this) this.server.holder = null;
      return { rows: [{ pg_advisory_unlock: true }] };
    }
    return { rows: [] };
  }

  release(destroy?: Error | boolean) {
    if (destroy) this.kill();
  }

  /** Simulates the process/connection dying: Postgres drops its locks. */
  kill() {
    this.dead = true;
    if (this.server.holder === this) this.server.holder = null;
  }
}

const POLL_MS = 1000;

function config(): PollerConfig {
  return {
    rpcUrl: 'http://localhost',
    contractId: 'CTEST',
    networkPassphrase: 'Test SDF Network ; September 2015',
    pollIntervalMs: POLL_MS,
    startLedger: 100,
  };
}

/** Every call returns the same two events, as two replicas polling the same RPC would see. */
function sharedRpc(): jest.Mocked<RpcClient> {
  const events = [100, 101].map((ledger) => ({
    ledger,
    ledgerClosedAt: new Date(1_700_000_000 * 1000).toISOString(),
    topic: [nativeToScVal('player_registered', { type: 'symbol' })],
    value: nativeToScVal({ player_id: `p${ledger}`, wallet: 'GABC' }),
  }));
  return {
    getLatestLedger: jest.fn().mockResolvedValue({ sequence: 102 }),
    getEvents: jest.fn().mockResolvedValue({ latestLedger: 102, events }),
  };
}

let store: EventStore;

beforeEach(() => {
  jest.useFakeTimers();
  IndexerMetrics.resetInstance();
  resetLedgerState();
  EventStore.resetInstance();
  store = EventStore.getInstance(':memory:');
});

afterEach(() => {
  jest.useRealTimers();
  EventStore.resetInstance();
  resetLedgerState();
});

describe('LeaderElector', () => {
  it('grants leadership to exactly one replica', async () => {
    const server = new FakeLockServer();
    const a = new LeaderElector(server.pool(), { leaseMs: POLL_MS });
    const b = new LeaderElector(server.pool(), { leaseMs: POLL_MS });

    expect(await a.tick()).toBe(true);
    expect(await b.tick()).toBe(false);
    // Renewal keeps the same leader.
    expect(await a.tick()).toBe(true);
    expect(await b.tick()).toBe(false);
  });

  it('steps down immediately when its connection (and so the lock) is lost', async () => {
    const server = new FakeLockServer();
    const pool = server.pool();
    const a = new LeaderElector(pool, { leaseMs: POLL_MS });
    expect(await a.tick()).toBe(true);

    pool.clients[0].kill();
    expect(await a.tick()).toBe(false);
  });

  it('steps down when renewal exceeds the lease', async () => {
    const server = new FakeLockServer();
    const pool = server.pool();
    const a = new LeaderElector(pool, { leaseMs: POLL_MS });
    expect(await a.tick()).toBe(true);

    jest
      .spyOn(pool.clients[0], 'query')
      .mockImplementationOnce(() => new Promise(() => undefined));
    const renewal = a.tick();
    await jest.advanceTimersByTimeAsync(POLL_MS);
    expect(await renewal).toBe(false);
    // The hung connection is destroyed so the lock is released.
    expect(server.holder).toBeNull();
  });

  it('release() hands the lock over without waiting for a timeout', async () => {
    const server = new FakeLockServer();
    const a = new LeaderElector(server.pool(), { leaseMs: POLL_MS });
    const b = new LeaderElector(server.pool(), { leaseMs: POLL_MS });
    await a.tick();
    await a.release();
    expect(await b.tick()).toBe(true);
  });
});

describe('two replicas polling a shared store', () => {
  it('ingests each event once, and a follower takes over within the lease after the leader dies', async () => {
    const server = new FakeLockServer();
    const poolA = server.pool();
    const poolB = server.pool();
    const rpcA = sharedRpc();
    const rpcB = sharedRpc();
    const metrics = IndexerMetrics.getInstance();

    const a = startEventPolling(
      config(),
      rpcA,
      metrics,
      store,
      new LeaderElector(poolA, { leaseMs: POLL_MS }),
    );
    await jest.advanceTimersByTimeAsync(0);
    const b = startEventPolling(
      config(),
      rpcB,
      metrics,
      store,
      new LeaderElector(poolB, { leaseMs: POLL_MS }),
    );
    await jest.advanceTimersByTimeAsync(0);

    // Several cycles: only the leader polls, and nothing is duplicated.
    await jest.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(rpcA.getEvents).toHaveBeenCalled();
    expect(rpcB.getEvents).not.toHaveBeenCalled();
    expect(store.getEvents().events).toHaveLength(2);

    // Kill the leader's DB session (process crash).
    poolA.clients[0].kill();
    a.stop();
    const aCalls = rpcA.getEvents.mock.calls.length;

    // The follower acquires the lock on its next attempt — within one lease.
    await jest.advanceTimersByTimeAsync(POLL_MS);
    expect(getRole()).toBe('leader');
    expect(rpcB.getEvents).toHaveBeenCalled();
    // It resumes from the shared checkpoint rather than START_LEDGER.
    expect(rpcB.getEvents.mock.calls[0][0].startLedger).toBe(102);
    expect(rpcA.getEvents).toHaveBeenCalledTimes(aCalls);

    await jest.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(store.getEvents().events).toHaveLength(2);
    b.stop();
  });
});
