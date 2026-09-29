/**
 * @jest-environment node
 */
import { nativeToScVal } from '@stellar/stellar-sdk';
import {
  decodeEvent,
  pollOnce,
  startEventPolling,
  loadConfigFromEnv,
  isRetentionWindowError,
  type PollerConfig,
  type RpcClient,
  type RawEvent,
} from '../eventPoller';
import {
  IndexerMetrics,
  STUCK_CYCLE_THRESHOLD,
} from '../metrics/IndexerMetrics';
import { getLastLedgerInfo, resetLedgerState } from '../ledgerTracker';
import { EventStore } from '../db/eventStore';

const CONTRACT_ID = 'CABCDEF1234567890CONTRACTID1234567890XXXXXXXXXXXXXXXX';

function makeRawEvent(
  eventName: string,
  fields: Record<string, unknown>,
  overrides: Partial<RawEvent> = {},
): RawEvent {
  return {
    ledger: 1000,
    ledgerClosedAt: new Date(1_700_000_000 * 1000).toISOString(),
    topic: [nativeToScVal(eventName, { type: 'symbol' })],
    value: nativeToScVal(fields),
    ...overrides,
  };
}

function baseConfig(overrides: Partial<PollerConfig> = {}): PollerConfig {
  return {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    contractId: CONTRACT_ID,
    networkPassphrase: 'Test SDF Network ; September 2015',
    pollIntervalMs: 5000,
    startLedger: 0,
    contractVersion: 1,
    ...overrides,
  };
}

let store: EventStore;

beforeEach(() => {
  IndexerMetrics.resetInstance();
  resetLedgerState();
  EventStore.resetInstance();
  store = EventStore.getInstance(':memory:');
});

afterEach(() => {
  IndexerMetrics.resetInstance();
  resetLedgerState();
  EventStore.resetInstance();
  jest.useRealTimers();
});

// ── decodeEvent ────────────────────────────────────────────────────────────────

describe('decodeEvent', () => {
  it('decodes a well-formed event into its type, ledger, timestamp, and data', () => {
    const raw = makeRawEvent(
      'player_registered',
      { player_id: 'p1', wallet: 'GABC', ipfs_hash: 'Qm123' },
      {
        ledger: 42,
        ledgerClosedAt: new Date(1_700_000_000 * 1000).toISOString(),
      },
    );

    const decoded = decodeEvent(raw);

    expect(decoded.type).toBe('player_registered');
    expect(decoded.ledger).toBe(42);
    expect(decoded.timestamp).toBe(1_700_000_000);
    expect(decoded.data).toMatchObject({
      player_id: 'p1',
      wallet: 'GABC',
      ipfs_hash: 'Qm123',
    });
  });

  it('decodes every one of the 7 documented event types', () => {
    const names = [
      'player_registered',
      'milestone_approved',
      'milestone_revoked',
      'scout_subscribed',
      'player_contacted',
      'trial_offer_logged',
      'fees_withdrawn',
    ];
    for (const name of names) {
      const decoded = decodeEvent(makeRawEvent(name, { some_field: 'x' }));
      expect(decoded.type).toBe(name);
    }
  });

  it('records an unknown event when it has no topic', () => {
    const raw = makeRawEvent('player_registered', {});
    raw.topic = [];
    expect(decodeEvent(raw).type).toBe('unknown');
  });

  it('records an unknown event for an unrecognized topic', () => {
    const raw = makeRawEvent('some_future_event', { x: 1 });
    expect(decodeEvent(raw).type).toBe('unknown');
  });

  // ── eventId (issue #1180: exactly-once notification delivery) ──────────

  it('derives the same eventId when the same raw event is decoded twice', () => {
    const raw = makeRawEvent(
      'milestone_approved',
      { player_id: 'p1', milestone_id: 'm1' },
      { ledger: 555 },
    );

    const first = decodeEvent(raw);
    const second = decodeEvent(raw);

    expect(second.eventId).toBe(first.eventId);
    // Not derived from wall-clock observation time.
    expect(first.eventId).not.toMatch(/^\d{13}$/);
  });

  it('derives different eventIds for events with different content', () => {
    const a = decodeEvent(
      makeRawEvent(
        'milestone_approved',
        { player_id: 'p1', milestone_id: 'm1' },
        { ledger: 555 },
      ),
    );
    const b = decodeEvent(
      makeRawEvent(
        'milestone_approved',
        { player_id: 'p2', milestone_id: 'm2' },
        { ledger: 555 },
      ),
    );

    expect(a.eventId).not.toBe(b.eventId);
  });

  it('prefers the RPC-reported id over the content hash when present', () => {
    const raw = makeRawEvent(
      'milestone_approved',
      { player_id: 'p1', milestone_id: 'm1' },
      { ledger: 555, id: '555-2' },
    );

    expect(decodeEvent(raw).eventId).toBe('milestone_approved:555-2');
  });
});

// ── pollOnce ──────────────────────────────────────────────────────────────────

describe('pollOnce', () => {
  it('starts from the network tip when cursorLedger is 0 (START_LEDGER=0 = latest)', async () => {
    const rpc: jest.Mocked<RpcClient> = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 5000 }),
      getEvents: jest
        .fn()
        .mockResolvedValue({ latestLedger: 5000, events: [] }),
    };
    const metrics = IndexerMetrics.getInstance();

    await pollOnce(baseConfig(), rpc, metrics, 0, store);

    expect(rpc.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 5000 }),
    );
  });

  it('records a decoded event via IndexerMetrics.recordSuccess and advances the ledger cursor past it', async () => {
    const raw = makeRawEvent(
      'player_contacted',
      { scout: 'G1', player_id: 'p1' },
      {
        ledger: 1234,
      },
    );
    const rpc: jest.Mocked<RpcClient> = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1234 }),
      getEvents: jest
        .fn()
        .mockResolvedValue({ latestLedger: 1234, events: [raw] }),
    };
    const metrics = IndexerMetrics.getInstance();
    const recordSuccessSpy = jest.spyOn(metrics, 'recordSuccess');

    const nextCursor = await pollOnce(baseConfig(), rpc, metrics, 1200, store);

    expect(recordSuccessSpy).toHaveBeenCalledWith(
      'player_contacted',
      expect.any(Number),
      expect.any(Number),
    );
    expect(nextCursor).toBe(1235);
    expect(getLastLedgerInfo().lastLedger).toBe(1234);

    const { events } = store.getEvents({ type: 'player_contacted' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'player_contacted',
      playerId: 'p1',
      scout: 'G1',
      ledger: 1234,
    });
  });

  it('persists an unknown event and counts it without stopping the poller', async () => {
    const badRaw = makeRawEvent('not_a_real_event', {}, { ledger: 777 });
    const rpc: jest.Mocked<RpcClient> = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 777 }),
      getEvents: jest
        .fn()
        .mockResolvedValue({ latestLedger: 777, events: [badRaw] }),
    };
    const metrics = IndexerMetrics.getInstance();

    await pollOnce(baseConfig(), rpc, metrics, 700, store);

    expect(store.getEvents().events[0]).toMatchObject({
      type: 'unknown',
      contractVersion: 1,
    });
    expect(metrics.snapshot().unknownEvents).toBe(1);
  });

  it('calls updateNetworkLedger with the RPC-reported network tip even while behind it', async () => {
    const rpc: jest.Mocked<RpcClient> = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 9999 }),
      getEvents: jest
        .fn()
        .mockResolvedValue({ latestLedger: 9999, events: [] }),
    };
    const metrics = IndexerMetrics.getInstance();

    await pollOnce(baseConfig(), rpc, metrics, 9500, store);

    expect(getLastLedgerInfo().networkLedger).toBe(9999);
  });

  it('advances the cursor to latestLedger + 1 when no events are found', async () => {
    const rpc: jest.Mocked<RpcClient> = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 500 }),
      getEvents: jest.fn().mockResolvedValue({ latestLedger: 500, events: [] }),
    };
    const metrics = IndexerMetrics.getInstance();

    const nextCursor = await pollOnce(baseConfig(), rpc, metrics, 100, store);

    expect(nextCursor).toBe(501);
  });

  it('still advances past an unknown event', async () => {
    const badRaw = makeRawEvent('not_a_real_event', {}, { ledger: 777 });
    const rpc: jest.Mocked<RpcClient> = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 777 }),
      getEvents: jest
        .fn()
        .mockResolvedValue({ latestLedger: 777, events: [badRaw] }),
    };
    const metrics = IndexerMetrics.getInstance();
    const nextCursor = await pollOnce(baseConfig(), rpc, metrics, 700, store);

    expect(nextCursor).toBe(778);
  });

  it('records an RPC-level failure, leaves the cursor unchanged, and does not throw', async () => {
    const rpc: jest.Mocked<RpcClient> = {
      getLatestLedger: jest
        .fn()
        .mockRejectedValue(new Error('RPC unreachable')),
      getEvents: jest.fn(),
    };
    const metrics = IndexerMetrics.getInstance();
    const recordFailureSpy = jest.spyOn(metrics, 'recordFailure');

    const nextCursor = await pollOnce(baseConfig(), rpc, metrics, 42, store);

    expect(recordFailureSpy).toHaveBeenCalled();
    expect(nextCursor).toBe(42);
    expect(rpc.getEvents).not.toHaveBeenCalled();
  });

  // ── Exactly-once ingestion across overlapping poll cycles (issue #1180) ──

  it('persists exactly one event when the same source event is fetched across two overlapping poll cycles', async () => {
    // Same raw event returned by both cycles — simulating the scenario
    // from the issue where the same on-chain event is visible across two
    // overlapping polling windows (e.g. the in-memory cursor resetting on
    // a process restart, or two poller instances briefly covering the
    // same ledger range).
    const raw = makeRawEvent(
      'milestone_approved',
      { player_id: 'p1', milestone_id: 'm1', validator: 'GVAL' },
      { ledger: 4200 },
    );
    const rpc: jest.Mocked<RpcClient> = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 4200 }),
      getEvents: jest
        .fn()
        .mockResolvedValue({ latestLedger: 4200, events: [raw] }),
    };
    const metrics = IndexerMetrics.getInstance();

    // Two independent poll cycles, both starting from the same cursor —
    // the overlapping-window scenario.
    await pollOnce(baseConfig(), rpc, metrics, 4100, store);
    await pollOnce(baseConfig(), rpc, metrics, 4100, store);

    const { events } = store.getEvents({ type: 'milestone_approved' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ playerId: 'p1', ledger: 4200 });
  });

  it('records an RPC-level failure when getEvents itself rejects', async () => {
    const rpc: jest.Mocked<RpcClient> = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 100 }),
      getEvents: jest.fn().mockRejectedValue(new Error('bad startLedger')),
    };
    const metrics = IndexerMetrics.getInstance();
    const recordFailureSpy = jest.spyOn(metrics, 'recordFailure');

    const nextCursor = await pollOnce(baseConfig(), rpc, metrics, 42, store);

    expect(recordFailureSpy).toHaveBeenCalled();
    expect(nextCursor).toBe(42);
  });

  it('marks the indexer healthy again after a successful cycle', async () => {
    const rpc: jest.Mocked<RpcClient> = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 10 }),
      getEvents: jest.fn().mockResolvedValue({ latestLedger: 10, events: [] }),
    };
    const metrics = IndexerMetrics.getInstance();
    for (let i = 0; i < 5; i++) metrics.recordFailure(1);
    expect(metrics.snapshot().isHealthy).toBe(false);

    await pollOnce(baseConfig(), rpc, metrics, 0, store);

    expect(metrics.snapshot().isHealthy).toBe(true);
  });

  // ── Retention window recovery (issue #1000) ──────────────────────────────

  it('skips forward to the network tip when getEvents fails with a retention-window error', async () => {
    const retentionError = new Error(
      'startLedger must be within the ledger retention window',
    );
    const rpc: jest.Mocked<RpcClient> = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 9000 }),
      getEvents: jest.fn().mockRejectedValue(retentionError),
    };
    const metrics = IndexerMetrics.getInstance();

    // Cursor is stuck far behind the network tip (simulates long downtime).
    const nextCursor = await pollOnce(baseConfig(), rpc, metrics, 100, store);

    // Must skip forward to the network tip (not stay at 100).
    expect(nextCursor).toBe(9000);
    expect(nextCursor).not.toBe(100);
  });

  it('records a retention-window gap in metrics when skipping forward', async () => {
    const retentionError = new Error('start is before oldest ledger');
    const rpc: jest.Mocked<RpcClient> = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 5000 }),
      getEvents: jest.fn().mockRejectedValue(retentionError),
    };
    const metrics = IndexerMetrics.getInstance();
    const gapSpy = jest.spyOn(metrics, 'recordRetentionWindowGap');

    await pollOnce(baseConfig(), rpc, metrics, 200, store);

    expect(gapSpy).toHaveBeenCalledWith(200, 5000);
    const snap = metrics.snapshot();
    expect(snap.lastRetentionWindowGap).toMatchObject({
      fromLedger: 200,
      toLedger: 5000,
    });
  });

  it('resumes indexing new events after a skip-forward recovery', async () => {
    const retentionError = new Error('start is before oldest ledger');
    const rpc: jest.Mocked<RpcClient> = {
      getLatestLedger: jest
        .fn()
        .mockResolvedValueOnce({ sequence: 9000 }) // first poll: stuck cursor
        .mockResolvedValueOnce({ sequence: 9001 }), // second poll: after skip
      getEvents: jest
        .fn()
        .mockRejectedValueOnce(retentionError) // first poll fails with retention error
        .mockResolvedValueOnce({
          // second poll succeeds from skipped-to position
          latestLedger: 9001,
          events: [
            makeRawEvent(
              'player_registered',
              { player_id: 'p1', wallet: 'G1', ipfs_hash: 'Qm1' },
              { ledger: 9001 },
            ),
          ],
        }),
    };
    const metrics = IndexerMetrics.getInstance();

    // First cycle: stuck → skip to 9000.
    const cursor1 = await pollOnce(baseConfig(), rpc, metrics, 100, store);
    expect(cursor1).toBe(9000);

    // Second cycle: successfully indexes from skipped-to position.
    const cursor2 = await pollOnce(baseConfig(), rpc, metrics, cursor1, store);
    expect(cursor2).toBe(9002); // advanced past the event at 9001

    const { events } = store.getEvents({ type: 'player_registered' });
    expect(events).toHaveLength(1);
    expect(events[0].ledger).toBe(9001);
  });

  it('retries the same cursor for a generic RPC error (not a retention error)', async () => {
    const genericError = new Error('Network timeout');
    const rpc: jest.Mocked<RpcClient> = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 500 }),
      getEvents: jest.fn().mockRejectedValue(genericError),
    };
    const metrics = IndexerMetrics.getInstance();

    const nextCursor = await pollOnce(baseConfig(), rpc, metrics, 42, store);

    // Must stay at 42, not skip forward.
    expect(nextCursor).toBe(42);
    // No gap recorded.
    expect(metrics.snapshot().lastRetentionWindowGap).toBeNull();
  });

  it('does not skip forward for a generic getLatestLedger failure', async () => {
    const rpc: jest.Mocked<RpcClient> = {
      getLatestLedger: jest.fn().mockRejectedValue(new Error('RPC down')),
      getEvents: jest.fn(),
    };
    const metrics = IndexerMetrics.getInstance();

    const nextCursor = await pollOnce(baseConfig(), rpc, metrics, 42, store);

    expect(nextCursor).toBe(42);
    expect(rpc.getEvents).not.toHaveBeenCalled();
    expect(metrics.snapshot().lastRetentionWindowGap).toBeNull();
  });
});

// ── startEventPolling ─────────────────────────────────────────────────────────

describe('startEventPolling', () => {
  it('polls repeatedly on the configured interval until stopped', async () => {
    jest.useFakeTimers();
    const rpc: jest.Mocked<RpcClient> = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1 }),
      getEvents: jest.fn().mockResolvedValue({ latestLedger: 1, events: [] }),
    };
    const metrics = IndexerMetrics.getInstance();

    const handle = startEventPolling(
      baseConfig({ pollIntervalMs: 1000 }),
      rpc,
      metrics,
    );

    // The first cycle starts synchronously but resolves through a couple of
    // awaited mock promises; advancing by 0ms flushes fake timers *and*
    // pending microtasks without depending on how many hops that takes.
    await jest.advanceTimersByTimeAsync(0);
    expect(rpc.getEvents).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1000);
    expect(rpc.getEvents).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(1000);
    expect(rpc.getEvents).toHaveBeenCalledTimes(3);

    await handle.stop();
    await jest.advanceTimersByTimeAsync(5000);
    expect(rpc.getEvents).toHaveBeenCalledTimes(3);
    expect(handle.isRunning()).toBe(false);
  });

  it('stop() waits for the in-flight batch, and a restart leaves no gaps or duplicates', async () => {
    const events = [1000, 1001, 1002].map((ledger) =>
      makeRawEvent(
        'player_contacted',
        { scout: 'G1', player_id: `p${ledger}` },
        { ledger },
      ),
    );
    let releaseBatch!: () => void;
    const batchGate = new Promise<void>((resolve) => (releaseBatch = resolve));
    const rpc: jest.Mocked<RpcClient> = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1002 }),
      getEvents: jest.fn().mockImplementation(async () => {
        await batchGate;
        return { latestLedger: 1002, events };
      }),
    };
    const metrics = IndexerMetrics.getInstance();

    const handle = startEventPolling(
      baseConfig({ startLedger: 1000 }),
      rpc,
      metrics,
      store,
    );

    // SIGTERM arrives mid-poll: stop() must not resolve before the batch.
    let stopped = false;
    const stopping = handle.stop().then(() => (stopped = true));
    await Promise.resolve();
    expect(stopped).toBe(false);

    releaseBatch();
    await stopping;
    expect(store.getEvents().events).toHaveLength(3);

    // Restart from the same START_LEDGER (the cursor is in-memory) and
    // re-ingest the overlapping range: idempotent inserts, no duplicates.
    await pollOnce(baseConfig(), rpc, metrics, 1000, store);
    const ledgers = store
      .getEvents()
      .events.map((e) => e.ledger)
      .sort();
    expect(ledgers).toEqual([1000, 1001, 1002]);
  });
});

// ── isRetentionWindowError ────────────────────────────────────────────────────

describe('isRetentionWindowError', () => {
  it('returns true for known retention window error messages', () => {
    const retentionMessages = [
      'start is before oldest ledger',
      'startLedger must be within the ledger retention window',
      'outside the ledger retention window',
      'ledger not found',
      'start ledger is before the node oldest',
    ];
    for (const msg of retentionMessages) {
      expect(isRetentionWindowError(new Error(msg))).toBe(true);
    }
  });

  it('returns false for generic network/RPC errors', () => {
    const nonRetentionErrors = [
      new Error('Network timeout'),
      new Error('RPC unreachable'),
      new Error('Internal server error'),
      new Error('bad startLedger'),
    ];
    for (const err of nonRetentionErrors) {
      expect(isRetentionWindowError(err)).toBe(false);
    }
  });

  it('returns false for non-Error values', () => {
    expect(isRetentionWindowError('string error')).toBe(false);
    expect(isRetentionWindowError(null)).toBe(false);
    expect(isRetentionWindowError(42)).toBe(false);
  });
});

// ── Stuck-cursor metrics (issue #1000) ────────────────────────────────────────

describe('IndexerMetrics stuck-cursor detection', () => {
  it('isStuck becomes true after STUCK_CYCLE_THRESHOLD consecutive same-cursor reports', () => {
    const metrics = IndexerMetrics.getInstance();
    for (let i = 0; i < STUCK_CYCLE_THRESHOLD; i++) {
      metrics.reportCursor(100);
      expect(metrics.snapshot().isStuck).toBe(false);
    }
    metrics.reportCursor(100);
    expect(metrics.snapshot().isStuck).toBe(true);
    expect(metrics.snapshot().stuckAtLedger).toBe(100);
  });

  it('resets isStuck when the cursor advances', () => {
    const metrics = IndexerMetrics.getInstance();
    for (let i = 0; i < STUCK_CYCLE_THRESHOLD + 2; i++) {
      metrics.reportCursor(100);
    }
    expect(metrics.snapshot().isStuck).toBe(true);

    metrics.reportCursor(101);
    expect(metrics.snapshot().isStuck).toBe(false);
    expect(metrics.snapshot().stuckAtLedger).toBeNull();
  });

  it('resets stuck-cursor state after a skip-forward gap is recorded', () => {
    const metrics = IndexerMetrics.getInstance();
    for (let i = 0; i < STUCK_CYCLE_THRESHOLD + 2; i++) {
      metrics.reportCursor(100);
    }
    expect(metrics.snapshot().isStuck).toBe(true);

    metrics.recordRetentionWindowGap(100, 9000);
    expect(metrics.snapshot().isStuck).toBe(false);
    expect(metrics.snapshot().stuckAtLedger).toBeNull();
    expect(metrics.snapshot().consecutiveStuckCycles).toBe(0);
  });

  it('polls that advance cursor do not accumulate stuck cycles', async () => {
    const rpc: jest.Mocked<RpcClient> = {
      getLatestLedger: jest
        .fn()
        .mockResolvedValueOnce({ sequence: 100 })
        .mockResolvedValueOnce({ sequence: 101 })
        .mockResolvedValueOnce({ sequence: 102 }),
      getEvents: jest
        .fn()
        .mockResolvedValueOnce({ latestLedger: 100, events: [] })
        .mockResolvedValueOnce({ latestLedger: 101, events: [] })
        .mockResolvedValueOnce({ latestLedger: 102, events: [] }),
    };
    const metrics = IndexerMetrics.getInstance();

    let cursor = 0;
    cursor = await pollOnce(baseConfig(), rpc, metrics, cursor, store);
    cursor = await pollOnce(baseConfig(), rpc, metrics, cursor, store);
    cursor = await pollOnce(baseConfig(), rpc, metrics, cursor, store);

    // Cursor advanced each cycle — should not be stuck.
    expect(metrics.snapshot().isStuck).toBe(false);
    expect(metrics.snapshot().consecutiveStuckCycles).toBe(0);
  });
});

// ── loadConfigFromEnv ─────────────────────────────────────────────────────────

describe('loadConfigFromEnv', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('throws when SOROBAN_RPC_URL is missing', () => {
    delete process.env.SOROBAN_RPC_URL;
    process.env.CONTRACT_ID = CONTRACT_ID;
    expect(() => loadConfigFromEnv()).toThrow(/SOROBAN_RPC_URL/);
  });

  it('throws when CONTRACT_ID is missing', () => {
    process.env.SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';
    delete process.env.CONTRACT_ID;
    expect(() => loadConfigFromEnv()).toThrow(/CONTRACT_ID/);
  });

  it('applies documented defaults for the optional vars', () => {
    process.env.SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';
    process.env.CONTRACT_ID = CONTRACT_ID;
    delete process.env.NETWORK_PASSPHRASE;
    delete process.env.POLL_INTERVAL_MS;
    delete process.env.START_LEDGER;

    const config = loadConfigFromEnv();

    expect(config.pollIntervalMs).toBe(5000);
    expect(config.startLedger).toBe(0);
    expect(config.networkPassphrase).toMatch(/Test SDF Network/);
  });

  it('reads explicit overrides for the optional vars', () => {
    process.env.SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';
    process.env.CONTRACT_ID = CONTRACT_ID;
    process.env.NETWORK_PASSPHRASE =
      'Public Global Stellar Network ; September 2015';
    process.env.POLL_INTERVAL_MS = '10000';
    process.env.START_LEDGER = '123456';

    const config = loadConfigFromEnv();

    expect(config.pollIntervalMs).toBe(10000);
    expect(config.startLedger).toBe(123456);
    expect(config.networkPassphrase).toBe(
      'Public Global Stellar Network ; September 2015',
    );
  });
});
