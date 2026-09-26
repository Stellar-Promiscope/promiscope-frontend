/**
 * @jest-environment node
 *
 * The event batch and the checkpoint commit together or not at all
 * (issue #1319), for both the SQLite and Postgres stores.
 */
import { EventStore } from '../eventStore';
import { PgEventStore, type PgPool } from '../pgEventStore';
import type { DecodedEvent } from '../../eventPoller';

function event(
  ledger: number,
  data: Record<string, unknown> = {},
): DecodedEvent {
  return {
    type: 'player_registered',
    ledger,
    timestamp: 1_700_000_000,
    data: { player_id: `p${ledger}`, ...data },
    eventId: `player_registered:${ledger}`,
  };
}

describe('EventStore.insertBatch (SQLite)', () => {
  let store: EventStore;

  beforeEach(() => {
    EventStore.resetInstance();
    store = EventStore.getInstance(':memory:');
  });

  afterEach(() => EventStore.resetInstance());

  it('writes events and the checkpoint together', () => {
    expect(
      store.insertBatch([event(10), event(11)], {
        lastLedger: 11,
        networkLedger: 15,
      }),
    ).toBe(2);
    expect(store.getEvents().events).toHaveLength(2);
    expect(store.getCheckpoint()).toMatchObject({
      lastLedger: 11,
      networkLedger: 15,
    });
  });

  it('rolls back every event and the checkpoint when one insert fails', () => {
    store.insertBatch([event(1)], { lastLedger: 1, networkLedger: 1 });

    // BigInt can't be JSON-serialised, so the second insert throws mid-batch.
    expect(() =>
      store.insertBatch([event(20), event(21, { bad: BigInt(1) })], {
        lastLedger: 21,
        networkLedger: 30,
      }),
    ).toThrow();

    expect(store.getEvents().events.map((e) => e.ledger)).toEqual([1]);
    expect(store.getCheckpoint()).toMatchObject({ lastLedger: 1 });
  });

  it('never moves the checkpoint backwards and ignores duplicate events', () => {
    store.insertBatch([event(50)], { lastLedger: 50, networkLedger: 60 });
    expect(
      store.insertBatch([event(50)], { lastLedger: 40, networkLedger: 61 }),
    ).toBe(0);
    expect(store.getEvents().events).toHaveLength(1);
    expect(store.getCheckpoint()).toMatchObject({
      lastLedger: 50,
      networkLedger: 61,
    });
  });
});

describe('PgEventStore.insertBatch', () => {
  function fakePool(failOn?: RegExp) {
    const log: string[] = [];
    const released: unknown[] = [];
    const pool: PgPool = {
      query: async () => ({ rows: [] }),
      connect: async () => ({
        query: async (text: string) => {
          log.push(text.trim().split(/\s+/).slice(0, 3).join(' '));
          if (failOn?.test(text)) throw new Error('boom');
          return { rows: [], rowCount: 1 };
        },
        release: (err?: unknown) => released.push(err),
      }),
    };
    return { pool, log, released };
  }

  it('wraps the inserts and checkpoint upsert in one transaction', async () => {
    const { pool, log, released } = fakePool();
    const store = new PgEventStore(pool);
    await expect(
      store.insertBatch([event(1), event(2)], {
        lastLedger: 2,
        networkLedger: 3,
      }),
    ).resolves.toBe(2);
    expect(log).toEqual([
      'BEGIN',
      'INSERT INTO events',
      'INSERT INTO events',
      'INSERT INTO checkpoint',
      'COMMIT',
    ]);
    expect(released).toHaveLength(1);
  });

  it('rolls back (and never commits) when the checkpoint write fails', async () => {
    const { pool, log, released } = fakePool(/INTO checkpoint/);
    const store = new PgEventStore(pool);
    await expect(
      store.insertBatch([event(1)], { lastLedger: 1, networkLedger: 1 }),
    ).rejects.toThrow('boom');
    expect(log).toContain('ROLLBACK');
    expect(log).not.toContain('COMMIT');
    expect(released).toHaveLength(1);
  });
});
