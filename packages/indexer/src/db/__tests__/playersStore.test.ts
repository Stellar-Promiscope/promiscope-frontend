/**
 * @jest-environment node
 *
 * Materialized `players` table tests (issue #1298): event projection and
 * the paginated, filterable getPlayers query that backs GET /players.
 */
import {
  EventStore,
  decodePlayerCursor,
  encodePlayerCursor,
} from '../eventStore';
import type { DecodedEvent } from '../../eventPoller';

let eventIdSeq = 0;

function makeEvent(
  overrides: Partial<DecodedEvent> & { data?: Record<string, unknown> } = {},
): DecodedEvent {
  eventIdSeq += 1;
  return {
    type: 'player_registered',
    ledger: 100,
    timestamp: 1_700_000_000,
    data: { player_id: 'p1', wallet: 'GWALLET' },
    eventId: `players-test-${eventIdSeq}`,
    ...overrides,
  };
}

/** Registration event; `vitals: null` omits vitals entirely. */
function register(
  playerId: string,
  opts: {
    ledger?: number;
    region?: string;
    position?: string;
    vitals?: Record<string, unknown> | null;
    wallet?: string;
    timestamp?: number;
  } = {},
): DecodedEvent {
  const { ledger = 100, wallet = 'GWALLET', vitals } = opts;
  const timestamp = opts.timestamp ?? ledger;
  const data: Record<string, unknown> = {
    player_id: playerId,
    wallet,
    ipfs_hash: `cid-${playerId}`,
    ledger,
    timestamp,
  };
  if (vitals !== null) {
    data.vitals = vitals ?? {
      name: `Player ${playerId}`,
      age: 20,
      position: opts.position ?? 'ST',
      region: opts.region ?? 'West Africa',
      nationality: 'Nigeria',
    };
  }
  return makeEvent({
    type: 'player_registered',
    ledger,
    timestamp,
    data,
  });
}

let store: EventStore;

beforeEach(() => {
  EventStore.resetInstance();
  store = EventStore.getInstance(':memory:');
});

afterEach(() => {
  EventStore.resetInstance();
});

describe('players projection', () => {
  it('materializes a player_registered event with nested vitals', () => {
    store.insertEvent(register('p1'));

    const { players, total } = store.getPlayers();
    expect(total).toBe(1);
    expect(players[0]).toMatchObject({
      id: 'p1',
      wallet: 'GWALLET',
      name: 'Player p1',
      age: 20,
      position: 'ST',
      region: 'West Africa',
      nationality: 'Nigeria',
      ipfsHash: 'cid-p1',
      progressLevel: 0,
      createdAt: 100,
    });
  });

  it('accepts vitals flattened onto the payload (tolerant extraction)', () => {
    store.insertEvent(
      makeEvent({
        type: 'player_registered',
        data: {
          player_id: 'flat1',
          wallet: 'GFLAT',
          name: 'Flat Vital',
          age: 19,
          position: 'GK',
          region: 'East Africa',
          nationality: 'Kenya',
        },
      }),
    );

    const { players } = store.getPlayers();
    expect(players[0]).toMatchObject({
      name: 'Flat Vital',
      age: 19,
      position: 'GK',
      region: 'East Africa',
      nationality: 'Kenya',
    });
  });

  it('stores NULL vitals when the payload has none (empty values in the record)', () => {
    store.insertEvent(register('novitals', { vitals: null }));

    const { players } = store.getPlayers();
    expect(players[0].name).toBe('');
    expect(players[0].region).toBe('');
    expect(players[0].age).toBe(0);
  });

  it('applies profile_updated to ipfs hash and vitals', () => {
    store.insertEvent(register('p1'));

    store.insertEvent(
      makeEvent({
        type: 'profile_updated',
        ledger: 200,
        data: {
          player_id: 'p1',
          ipfs_hash: 'cid-updated',
          vitals: { name: 'Renamed Player', region: 'North Africa' },
        },
      }),
    );

    const { players } = store.getPlayers();
    expect(players[0].ipfsHash).toBe('cid-updated');
    expect(players[0].name).toBe('Renamed Player');
    expect(players[0].region).toBe('North Africa');
    // Untouched fields survive the update
    expect(players[0].position).toBe('ST');
  });

  it('sets progress_level from milestone_approved new_level', () => {
    store.insertEvent(register('p1'));
    store.insertEvent(
      makeEvent({
        type: 'milestone_approved',
        ledger: 150,
        data: { player_id: 'p1', milestone_id: 'm1', new_level: 2 },
      }),
    );

    const { players } = store.getPlayers();
    expect(players[0].progressLevel).toBe(2);
  });

  it('never lowers progress_level (MAX guard) on an out-of-order approval', () => {
    store.insertEvent(register('p1'));
    store.insertEvent(
      makeEvent({
        type: 'milestone_approved',
        ledger: 150,
        data: { player_id: 'p1', milestone_id: 'm2', new_level: 3 },
      }),
    );
    store.insertEvent(
      makeEvent({
        type: 'milestone_approved',
        ledger: 140, // replayed/late lower level
        data: { player_id: 'p1', milestone_id: 'm0', new_level: 1 },
      }),
    );

    const { players } = store.getPlayers();
    expect(players[0].progressLevel).toBe(3);
  });

  it('decrements progress_level on milestone_revoked, floored at 0', () => {
    store.insertEvent(register('p1'));
    store.insertEvent(
      makeEvent({
        type: 'milestone_approved',
        ledger: 150,
        data: { player_id: 'p1', milestone_id: 'm1', new_level: 1 },
      }),
    );
    store.insertEvent(
      makeEvent({
        type: 'milestone_revoked',
        ledger: 160,
        data: { player_id: 'p1', milestone_id: 'm1' },
      }),
    );
    expect(store.getPlayers().players[0].progressLevel).toBe(0);

    store.insertEvent(
      makeEvent({
        type: 'milestone_revoked',
        ledger: 170,
        data: { player_id: 'p1', milestone_id: 'm-other' },
      }),
    );
    expect(store.getPlayers().players[0].progressLevel).toBe(0);
  });

  it('is a no-op for duplicate events (event_id dedup)', () => {
    const reg = register('p1');
    expect(store.insertEvent(reg)).toBe(true);
    expect(store.insertEvent(reg)).toBe(false);

    const approve = makeEvent({
      type: 'milestone_approved',
      ledger: 150,
      data: { player_id: 'p1', milestone_id: 'm1', new_level: 2 },
    });
    store.insertEvent(approve);
    expect(store.insertEvent(approve)).toBe(false);
    expect(store.getPlayers().players[0].progressLevel).toBe(2);
    expect(store.getPlayers().total).toBe(1);
  });

  it('creates a skeleton row for milestones on unknown players, backfilled by a later registration', () => {
    store.insertEvent(
      makeEvent({
        type: 'milestone_approved',
        ledger: 50,
        data: { player_id: 'late', milestone_id: 'm1', new_level: 1 },
      }),
    );

    let { players } = store.getPlayers();
    expect(players[0].wallet).toBe('');
    expect(players[0].progressLevel).toBe(1);

    store.insertEvent(register('late', { ledger: 40 }));

    ({ players } = store.getPlayers());
    expect(players[0].wallet).toBe('GWALLET');
    expect(players[0].name).toBe('Player late');
    // Progress level survives the backfill
    expect(players[0].progressLevel).toBe(1);
    expect(players[0].createdAt).toBe(40);
  });
});

// ── getPlayers query ─────────────────────────────────────────────────────────

describe('getPlayers filters', () => {
  beforeEach(() => {
    store.insertEvent(
      register('a', { region: 'West Africa', position: 'ST', ledger: 10 }),
    );
    store.insertEvent(
      register('b', { region: 'East Africa', position: 'GK', ledger: 20 }),
    );
    store.insertEvent(
      register('c', { region: 'West Africa', position: 'GK', ledger: 30 }),
    );
    store.insertEvent(
      register('d', { region: 'East Africa', position: 'ST', ledger: 40 }),
    );
    store.insertEvent(
      makeEvent({
        type: 'milestone_approved',
        ledger: 50,
        data: { player_id: 'c', milestone_id: 'm1', new_level: 2 },
      }),
    );
  });

  it('filters by region', () => {
    const { players, total } = store.getPlayers({ region: 'West Africa' });
    expect(players.map((p) => p.id).sort()).toEqual(['a', 'c']);
    expect(total).toBe(2);
  });

  it('filters by position', () => {
    const { players } = store.getPlayers({ position: 'GK' });
    expect(players.map((p) => p.id).sort()).toEqual(['b', 'c']);
  });

  it('combines region + position', () => {
    const { players, total } = store.getPlayers({
      region: 'East Africa',
      position: 'ST',
    });
    expect(players.map((p) => p.id)).toEqual(['d']);
    expect(total).toBe(1);
  });

  it('filters by minLevel', () => {
    const { players, total } = store.getPlayers({ minLevel: 1 });
    expect(players.map((p) => p.id)).toEqual(['c']);
    expect(total).toBe(1);
  });

  it('minLevel 0 returns every player', () => {
    expect(store.getPlayers({ minLevel: 0 }).total).toBe(4);
  });

  it('filters by createdAfter (unix seconds)', () => {
    // registrations above use timestamps equal to their ledgers (10..40)
    const { players } = store.getPlayers({ createdAfter: 20 });
    expect(players.map((p) => p.id)).toEqual(['d', 'c']);
  });

  it('orders newest-registration-first', () => {
    const { players } = store.getPlayers();
    expect(players.map((p) => p.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('returns an empty page (not an error) when nothing matches', () => {
    const { players, total, nextCursor } = store.getPlayers({
      region: 'Nowhere',
    });
    expect(players).toEqual([]);
    expect(total).toBe(0);
    expect(nextCursor).toBeNull();
  });
});

describe('getPlayers cursor pagination', () => {
  beforeEach(() => {
    for (let i = 1; i <= 7; i++) {
      store.insertEvent(register(`p${i}`, { ledger: i * 10 }));
    }
  });

  it('walks pages with no gaps or duplicates and terminates', () => {
    const page1 = store.getPlayers({ limit: 3 });
    expect(page1.players.map((p) => p.id)).toEqual(['p7', 'p6', 'p5']);
    expect(page1.nextCursor).not.toBeNull();
    expect(page1.total).toBe(7);

    const page2 = store.getPlayers({ limit: 3, cursor: page1.nextCursor! });
    expect(page2.players.map((p) => p.id)).toEqual(['p4', 'p3', 'p2']);
    expect(page2.total).toBe(7);

    const page3 = store.getPlayers({ limit: 3, cursor: page2.nextCursor! });
    expect(page3.players.map((p) => p.id)).toEqual(['p1']);
    expect(page3.nextCursor).toBeNull();
  });

  it('keeps a stable tie-break when two players share a ledger', () => {
    store.insertEvent(register('tie-a', { ledger: 100 }));
    store.insertEvent(register('tie-b', { ledger: 100 }));

    const page1 = store.getPlayers({ limit: 1 });
    const page2 = store.getPlayers({ limit: 1, cursor: page1.nextCursor! });
    const ids = [page1.players[0].id, page2.players[0].id];
    expect(ids).toEqual(['tie-b', 'tie-a']); // player_id DESC within ledger
    expect(new Set(ids).size).toBe(2);
  });

  it('caps limit at 50', () => {
    for (let i = 8; i <= 60; i++) {
      store.insertEvent(register(`p${i}`, { ledger: i * 10 }));
    }
    const { players } = store.getPlayers({ limit: 10_000 });
    expect(players).toHaveLength(50);
  });

  it('returns the whole set in one page when it is smaller than the cap', () => {
    const { players, nextCursor } = store.getPlayers({ limit: 50 });
    expect(players).toHaveLength(7);
    expect(nextCursor).toBeNull();
  });

  it('throws on a malformed cursor', () => {
    // base64url decoding is lenient, so craft a token that provably decodes
    // to something without the `${ledger}:${playerId}` separator.
    const colonless = Buffer.from('nope').toString('base64url');
    expect(() => store.getPlayers({ cursor: colonless })).toThrow(
      /invalid cursor/,
    );
  });

  it('cursor round-trips through encode/decode', () => {
    const decoded = decodePlayerCursor(encodePlayerCursor(1234, 'p:9'));
    expect(decoded).toEqual({ ledger: 1234, playerId: 'p:9' });
    expect(decodePlayerCursor('')).toBeNull();
    expect(
      decodePlayerCursor(Buffer.from('nope').toString('base64url')),
    ).toBeNull();
  });
});
