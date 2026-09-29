/**
 * @jest-environment node
 */
import * as http from 'http';
import { IndexerMetrics } from '../metrics/IndexerMetrics';
import {
  updateLastLedger,
  updateNetworkLedger,
  resetLedgerState,
} from '../ledgerTracker';
import { EventStore } from '../db/eventStore';
import type { DecodedEvent } from '../eventPoller';

// Import server after mocking so it uses our module state
import {
  server,
  computeHealthStatus,
  setPollerState,
  shutdown,
  type HealthInput,
} from '../server';
import type { EventPollerHandle } from '../eventPoller';

function fakePoller(running = true): EventPollerHandle {
  let isRunning = running;
  return {
    stop: jest.fn(async () => {
      isRunning = false;
    }),
    isRunning: () => isRunning,
  };
}

// Distinct default eventId per call (see eventStore.test.ts for why) so
// unrelated tests inserting several events don't collide on the unique
// event_id index.
let eventIdSeq = 0;

function makeDecoded(overrides: Partial<DecodedEvent> = {}): DecodedEvent {
  eventIdSeq += 1;
  return {
    type: 'milestone_approved',
    ledger: 100,
    timestamp: 1_700_000_000,
    data: { player_id: 'player-1', milestone_id: 'm1', validator: 'GVAL' },
    eventId: `test-event-${eventIdSeq}`,
    ...overrides,
  };
}

function request(
  path: string,
): Promise<{ status: number; body: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.get(`http://127.0.0.1:${addr.port}${path}`, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          body,
          contentType: res.headers['content-type'] ?? '',
        }),
      );
    });
    req.on('error', reject);
  });
}

beforeAll((done) => {
  server.listen(0, done); // random port
});

afterAll((done) => {
  setPollerState(null);
  server.close(done);
});

beforeEach(() => {
  IndexerMetrics.resetInstance();
  resetLedgerState();
  EventStore.resetInstance();
  EventStore.getInstance(':memory:');
  setPollerState(fakePoller());
});

afterEach(() => {
  IndexerMetrics.resetInstance();
  resetLedgerState();
  EventStore.resetInstance();
});

// ── /health ──────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  test('returns 200 with application/json', async () => {
    const { status, contentType } = await request('/health');
    expect(status).toBe(200);
    expect(contentType).toContain('application/json');
  });

  test('returns status ok with lag info when ledger is fresh', async () => {
    updateNetworkLedger(105);
    updateLastLedger(100);
    const { status, body } = await request('/health');
    const json = JSON.parse(body);
    expect(status).toBe(200);
    expect(json.status).toBe('ok');
    expect(json.lastLedger).toBe(100);
    expect(json.ledgerLag).toBe(5);
    expect(json.pollerRunning).toBe(true);
    expect(json.lastError).toBeNull();
    expect(typeof json.uptime).toBe('number');
  });

  test('returns starting (200) before the first ingestion', async () => {
    const { status, body } = await request('/health');
    expect(status).toBe(200);
    expect(JSON.parse(body).status).toBe('starting');
  });

  test('returns 503 unhealthy with the start error when the poller failed to start', async () => {
    setPollerState(null, 'SOROBAN_RPC_URL is required');
    const { status, body } = await request('/health');
    const json = JSON.parse(body);
    expect(status).toBe(503);
    expect(json.status).toBe('unhealthy');
    expect(json.pollerRunning).toBe(false);
    expect(json.lastError).toBe('SOROBAN_RPC_URL is required');
  });
});

describe('computeHealthStatus', () => {
  const base: HealthInput = {
    now: 1_000_000,
    startedAt: 1_000_000 - 1_000,
    lastIngestedAt: 1_000_000 - 1_000,
    pollerRunning: true,
    pollerHealthy: true,
    ledgerLag: 0,
  };

  test('ok when fresh and caught up', () => {
    expect(computeHealthStatus(base)).toBe('ok');
  });

  test('starting within the grace period with no ingestion', () => {
    expect(computeHealthStatus({ ...base, lastIngestedAt: 0 })).toBe(
      'starting',
    );
  });

  test('unhealthy after the grace period with no ingestion (e.g. bad RPC URL)', () => {
    expect(
      computeHealthStatus({
        ...base,
        lastIngestedAt: 0,
        startedAt: base.now - 121_000,
      }),
    ).toBe('unhealthy');
  });

  test('degraded when the last poll is over 60 s old', () => {
    expect(
      computeHealthStatus({ ...base, lastIngestedAt: base.now - 61_000 }),
    ).toBe('degraded');
  });

  test('degraded when ledger lag exceeds the threshold', () => {
    expect(computeHealthStatus({ ...base, ledgerLag: 101 })).toBe('degraded');
  });

  test('unhealthy when the poller is not running', () => {
    expect(computeHealthStatus({ ...base, pollerRunning: false })).toBe(
      'unhealthy',
    );
  });

  test('unhealthy after repeated RPC failures', () => {
    expect(computeHealthStatus({ ...base, pollerHealthy: false })).toBe(
      'unhealthy',
    );
  });
});

describe('shutdown', () => {
  test('stops the poller and closes the event store', async () => {
    const handle = fakePoller();
    setPollerState(handle);
    const closeSpy = jest.spyOn(EventStore.getInstance(), 'close');
    const serverClose = jest
      .spyOn(server, 'close')
      .mockImplementation(() => server);

    await shutdown('SIGTERM');

    expect(serverClose).toHaveBeenCalled();
    expect(handle.stop).toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalled();
    serverClose.mockRestore();
  });
});

// ── /metrics ─────────────────────────────────────────────────────────────────

describe('GET /metrics', () => {
  test('returns 200 with Prometheus content-type', async () => {
    const { status, contentType } = await request('/metrics');
    expect(status).toBe(200);
    expect(contentType).toContain('text/plain');
  });

  test('contains all four metric categories', async () => {
    const { body } = await request('/metrics');
    // Events
    expect(body).toContain('indexer_events_total');
    // Errors
    expect(body).toContain('indexer_errors_total');
    // Latency
    expect(body).toContain('indexer_latency_avg_ms');
    expect(body).toContain('indexer_latency_p95_ms');
    // Ledger lag
    expect(body).toContain('indexer_ledger_lag');
  });

  test('reflects recorded event counts', async () => {
    const metrics = IndexerMetrics.getInstance();
    metrics.recordSuccess('player_registered', 10);
    metrics.recordSuccess('player_registered', 20);
    metrics.recordSuccess('milestone_approved', 5);

    const { body } = await request('/metrics');
    expect(body).toContain('indexer_events_total{type="player_registered"} 2');
    expect(body).toContain('indexer_events_total{type="milestone_approved"} 1');
    expect(body).toContain('indexer_processed_total 3');
  });

  test('reflects error count', async () => {
    const metrics = IndexerMetrics.getInstance();
    metrics.recordFailure(10);
    metrics.recordFailure(10);

    const { body } = await request('/metrics');
    expect(body).toContain('indexer_errors_total 2');
  });

  test('reflects ledger lag', async () => {
    updateNetworkLedger(1050);
    updateLastLedger(1000);

    const { body } = await request('/metrics');
    expect(body).toContain('indexer_ledger_lag 50');
  });

  test('returns 0 lag when ledger values are unknown', async () => {
    // Neither updateLastLedger nor updateNetworkLedger called
    const { body } = await request('/metrics');
    expect(body).toContain('indexer_ledger_lag 0');
  });
});

// ── GET /events ──────────────────────────────────────────────────────────────

describe('GET /events', () => {
  test('returns an empty page when no events have been indexed', async () => {
    const { status, body } = await request('/events');
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ events: [], nextCursor: null });
  });

  test('returns indexed events newest-ledger-first', async () => {
    const store = EventStore.getInstance();
    store.insertEvent(makeDecoded({ ledger: 10 }));
    store.insertEvent(makeDecoded({ ledger: 20 }));

    const { body } = await request('/events');
    const json = JSON.parse(body);
    expect(json.events.map((e: { ledger: number }) => e.ledger)).toEqual([
      20, 10,
    ]);
  });

  test('filters by type', async () => {
    const store = EventStore.getInstance();
    store.insertEvent(makeDecoded({ type: 'milestone_approved' }));
    store.insertEvent(
      makeDecoded({
        type: 'player_contacted',
        data: { player_id: 'player-1', scout: 'GS' },
      }),
    );

    const { body } = await request('/events?type=player_contacted');
    const json = JSON.parse(body);
    expect(json.events).toHaveLength(1);
    expect(json.events[0].type).toBe('player_contacted');
  });

  test('rejects an unknown event type with 400', async () => {
    const { status, body } = await request('/events?type=not_a_real_type');
    expect(status).toBe(400);
    expect(JSON.parse(body).error).toMatch(/unknown event type/i);
  });

  test('rejects a non-numeric limit with 400', async () => {
    const { status } = await request('/events?limit=abc');
    expect(status).toBe(400);
  });
});

// ── GET /players/:id/events ────────────────────────────────────────────────

describe('GET /players/:id/events', () => {
  test('returns only events for the requested player', async () => {
    const store = EventStore.getInstance();
    store.insertEvent(makeDecoded({ data: { player_id: 'player-1' } }));
    store.insertEvent(makeDecoded({ data: { player_id: 'player-2' } }));

    const { status, body } = await request('/players/player-1/events');
    expect(status).toBe(200);
    const json = JSON.parse(body);
    expect(json.events).toHaveLength(1);
    expect(json.events[0].playerId).toBe('player-1');
  });

  test('supports pagination via limit and the returned nextCursor', async () => {
    const store = EventStore.getInstance();
    for (let ledger = 1; ledger <= 3; ledger++) {
      store.insertEvent(
        makeDecoded({ ledger, data: { player_id: 'player-1' } }),
      );
    }

    const page1 = JSON.parse(
      await (
        await request('/players/player-1/events?limit=2')
      ).body,
    );
    expect(page1.events.map((e: { ledger: number }) => e.ledger)).toEqual([
      3, 2,
    ]);
    expect(page1.nextCursor).toBe(2);

    const page2 = JSON.parse(
      await (
        await request(
          `/players/player-1/events?limit=2&before=${page1.nextCursor}`,
        )
      ).body,
    );
    expect(page2.events.map((e: { ledger: number }) => e.ledger)).toEqual([1]);
    expect(page2.nextCursor).toBeNull();
  });
});

// ── 404 ──────────────────────────────────────────────────────────────────────

describe('unknown routes', () => {
  test('returns 404 for unrecognised paths', async () => {
    const { status } = await request('/unknown');
    expect(status).toBe(404);
  });
});

describe('malformed path encoding (issue #1331)', () => {
  it.each(['/players/%E0%A4%A/events', '/validators/%E0%A4%A/events'])(
    'returns 400 for %s and keeps the server listening',
    async (path) => {
      const { status, body } = await request(path);
      expect(status).toBe(400);
      expect(JSON.parse(body)).toEqual({ error: 'invalid path encoding' });

      expect(server.listening).toBe(true);
      const health = await request('/health');
      expect(health.status).toBe(200);
    },
  );

  it('returns 500 without crashing when a handler throws unexpectedly', async () => {
    const spy = jest
      .spyOn(EventStore, 'getInstance')
      .mockImplementationOnce(() => {
        throw new Error('boom');
      });

    const { status } = await request('/players/player-1/events');
    expect(status).toBe(500);
    expect(server.listening).toBe(true);

    spy.mockRestore();
  });
});
