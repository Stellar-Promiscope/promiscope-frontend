/**
 * @jest-environment node
 *
 * Issue #1298 acceptance: "the dashboard loads the first page of 10k seeded
 * players in under 1 s locally." This exercises the exact store query that
 * GET /players runs (same SQL, same indexes) against a 10,000-player
 * materialized table — no HTTP layer, so what's measured is the part that
 * has to scale.
 *
 * The seed goes through EventStore.insertEvent so rows are built by the
 * same projection real events take.
 */
import { EventStore } from '../eventStore';
import type { DecodedEvent } from '../../eventPoller';

const PLAYER_COUNT = 10_000;
/** Acceptance threshold: first page in under 1 s (expected actual: single-digit ms). */
const FIRST_PAGE_BUDGET_MS = 1_000;

const REGIONS = [
  'West Africa',
  'East Africa',
  'North Africa',
  'Southern Africa',
  'Central Africa',
];
const POSITIONS = ['ST', 'CM', 'CB', 'GK', 'LW', 'RB'];

let eventIdSeq = 0;

function registration(i: number): DecodedEvent {
  eventIdSeq += 1;
  const ledger = 1_000_000 + i;
  return {
    type: 'player_registered',
    ledger,
    timestamp: 1_700_000_000 + i,
    data: {
      player_id: `perf-player-${String(i).padStart(6, '0')}`,
      wallet: 'G' + 'A'.repeat(55),
      ipfs_hash: '',
      vitals: {
        name: `Perf Player ${i}`,
        age: 16 + (i % 15),
        position: POSITIONS[i % POSITIONS.length],
        region: REGIONS[i % REGIONS.length],
        nationality: 'Nigeria',
      },
    },
    eventId: `perf-registration-${eventIdSeq}`,
  };
}

function approval(i: number, level: number): DecodedEvent {
  eventIdSeq += 1;
  const ledger = 2_000_000 + i;
  return {
    type: 'milestone_approved',
    ledger,
    timestamp: 1_700_100_000 + i,
    data: {
      player_id: `perf-player-${String(i).padStart(6, '0')}`,
      milestone_id: `perf-m-${i}`,
      new_level: level,
    },
    eventId: `perf-approval-${eventIdSeq}`,
  };
}

describe('GET /players performance (10k seeded players)', () => {
  let store: EventStore;

  beforeAll(() => {
    EventStore.resetInstance();
    store = EventStore.getInstance(':memory:');
    store.transaction(() => {
      for (let i = 0; i < PLAYER_COUNT; i++) {
        store.insertEvent(registration(i));
        // Spread players across levels 0–3 (i % 4); approvals set levels 1–3.
        const level = i % 4;
        if (level > 0) store.insertEvent(approval(i, level));
      }
    });
  }, 60_000);

  afterAll(() => {
    EventStore.resetInstance();
  });

  test('first page of 10k players loads in under 1 s', () => {
    const started = Date.now();
    const result = store.getPlayers({ limit: 50 });
    const elapsed = Date.now() - started;

    expect(result.players).toHaveLength(50);
    expect(result.total).toBe(PLAYER_COUNT);
    expect(result.nextCursor).not.toBeNull();
    expect(elapsed).toBeLessThan(FIRST_PAGE_BUDGET_MS);
  }, 10_000);

  test('filtered first page (region + minLevel) stays under 1 s', () => {
    const started = Date.now();
    const result = store.getPlayers({
      region: 'West Africa',
      minLevel: 1,
      limit: 50,
    });
    const elapsed = Date.now() - started;

    expect(result.players.length).toBeGreaterThan(0);
    expect(result.players.length).toBeLessThanOrEqual(50);
    expect(result.total).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(FIRST_PAGE_BUDGET_MS);
  }, 10_000);

  test('a deep cursor page stays under 1 s', () => {
    // Walk 20 pages in (20 × 50 = 1,000 players deep), then time page 21.
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = store.getPlayers({ limit: 50, cursor });
      expect(res.nextCursor).not.toBeNull();
      cursor = res.nextCursor!;
    }

    const started = Date.now();
    const result = store.getPlayers({ limit: 50, cursor });
    const elapsed = Date.now() - started;

    expect(result.players).toHaveLength(50);
    expect(elapsed).toBeLessThan(FIRST_PAGE_BUDGET_MS);
  }, 30_000);
});
