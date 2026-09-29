/**
 * Unit tests for lib/indexerClient.ts — the frontend client for
 * packages/indexer's query API (GET /players/:id/events).
 *
 * Strategy mirrors __tests__/lib/api.test.ts: mock axios via a factory so
 * we can assert on the calls it makes and control its responses.
 */

let mockGet: jest.Mock;

jest.mock('axios', () => {
  const get = jest.fn();
  const instance = { get, __mockGet: get };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => instance),
      __instance: instance,
    },
  };
});

import axios from 'axios';
import {
  fetchEvents,
  fetchIndexerHealth,
  fetchPlayerEvents,
  getMilestoneHistoryFromIndexer,
  listPlayers,
} from '@/lib/indexerClient';

beforeAll(() => {
  mockGet = (axios as any).__instance.__mockGet;
});

beforeEach(() => {
  mockGet.mockReset();
});

describe('lib/indexerClient – axios instance configuration', () => {
  it('creates the client with the indexer base URL', () => {
    expect(axios.create as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: expect.any(String),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
});

describe('fetchEvents', () => {
  it('GETs /events with the given query params', async () => {
    mockGet.mockResolvedValue({ data: { events: [], nextCursor: null } });

    await fetchEvents({ type: 'fees_withdrawn', limit: 200 });

    expect(mockGet).toHaveBeenCalledWith('/events', {
      params: { type: 'fees_withdrawn', limit: 200 },
    });
  });

  it('defaults to no params', async () => {
    mockGet.mockResolvedValue({ data: { events: [], nextCursor: null } });

    await fetchEvents();

    expect(mockGet).toHaveBeenCalledWith('/events', { params: {} });
  });
});

describe('fetchPlayerEvents', () => {
  it('GETs /players/:id/events with the given query params', async () => {
    mockGet.mockResolvedValue({ data: { events: [], nextCursor: null } });

    await fetchPlayerEvents('player-1', {
      type: 'milestone_approved',
      limit: 20,
    });

    expect(mockGet).toHaveBeenCalledWith('/players/player-1/events', {
      params: { type: 'milestone_approved', limit: 20 },
    });
  });

  it('URL-encodes the player id', async () => {
    mockGet.mockResolvedValue({ data: { events: [], nextCursor: null } });

    await fetchPlayerEvents('player one/weird', {});

    expect(mockGet).toHaveBeenCalledWith(
      '/players/player%20one%2Fweird/events',
      expect.anything(),
    );
  });
});

describe('getMilestoneHistoryFromIndexer', () => {
  it('applies milestone_approved events into the returned list', async () => {
    mockGet.mockResolvedValue({
      data: {
        events: [
          {
            id: 1,
            type: 'milestone_approved',
            playerId: 'player-1',
            scout: null,
            validator: 'GVAL',
            ledger: 10,
            timestamp: 1000,
            data: {
              milestone_id: 'm1',
              description: 'Scored 20 goals',
              validator: 'GVAL',
            },
          },
        ],
        nextCursor: null,
      },
    });

    const milestones = await getMilestoneHistoryFromIndexer('player-1');

    expect(milestones).toEqual([
      {
        id: 'm1',
        description: 'Scored 20 goals',
        evidenceHash: '',
        validator: 'GVAL',
        timestamp: 1000,
      },
    ]);
  });

  it('removes a milestone revoked after it was approved', async () => {
    mockGet.mockResolvedValue({
      data: {
        events: [
          // newest-first, as the query API returns them
          {
            id: 2,
            type: 'milestone_revoked',
            playerId: 'player-1',
            scout: null,
            validator: null,
            ledger: 20,
            timestamp: 2000,
            data: { milestone_id: 'm1', revoked_by: 'GADMIN' },
          },
          {
            id: 1,
            type: 'milestone_approved',
            playerId: 'player-1',
            scout: null,
            validator: 'GVAL',
            ledger: 10,
            timestamp: 1000,
            data: {
              milestone_id: 'm1',
              description: 'Scored 20 goals',
              validator: 'GVAL',
            },
          },
        ],
        nextCursor: null,
      },
    });

    const milestones = await getMilestoneHistoryFromIndexer('player-1');

    expect(milestones).toEqual([]);
  });

  it('keeps a milestone re-approved after an earlier revocation', async () => {
    mockGet.mockResolvedValue({
      data: {
        events: [
          {
            id: 3,
            type: 'milestone_approved',
            playerId: 'player-1',
            scout: null,
            validator: 'GVAL',
            ledger: 30,
            timestamp: 3000,
            data: {
              milestone_id: 'm1',
              description: 'Re-approved',
              validator: 'GVAL',
            },
          },
          {
            id: 2,
            type: 'milestone_revoked',
            playerId: 'player-1',
            scout: null,
            validator: null,
            ledger: 20,
            timestamp: 2000,
            data: { milestone_id: 'm1' },
          },
          {
            id: 1,
            type: 'milestone_approved',
            playerId: 'player-1',
            scout: null,
            validator: 'GVAL',
            ledger: 10,
            timestamp: 1000,
            data: {
              milestone_id: 'm1',
              description: 'First approval',
              validator: 'GVAL',
            },
          },
        ],
        nextCursor: null,
      },
    });

    const milestones = await getMilestoneHistoryFromIndexer('player-1');

    expect(milestones).toEqual([
      {
        id: 'm1',
        description: 'Re-approved',
        evidenceHash: '',
        validator: 'GVAL',
        timestamp: 3000,
      },
    ]);
  });

  it('follows nextCursor to page through more than one batch of events', async () => {
    mockGet
      .mockResolvedValueOnce({
        data: {
          events: [
            {
              id: 2,
              type: 'milestone_approved',
              playerId: 'player-1',
              scout: null,
              validator: 'GVAL',
              ledger: 20,
              timestamp: 2000,
              data: {
                milestone_id: 'm2',
                description: 'Second',
                validator: 'GVAL',
              },
            },
          ],
          nextCursor: 20,
        },
      })
      .mockResolvedValueOnce({
        data: {
          events: [
            {
              id: 1,
              type: 'milestone_approved',
              playerId: 'player-1',
              scout: null,
              validator: 'GVAL',
              ledger: 10,
              timestamp: 1000,
              data: {
                milestone_id: 'm1',
                description: 'First',
                validator: 'GVAL',
              },
            },
          ],
          nextCursor: null,
        },
      });

    const milestones = await getMilestoneHistoryFromIndexer('player-1');

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet).toHaveBeenNthCalledWith(2, '/players/player-1/events', {
      params: { limit: 200, before: 20 },
    });
    expect(milestones.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('propagates a request failure to the caller', async () => {
    mockGet.mockRejectedValue(new Error('network error'));

    await expect(getMilestoneHistoryFromIndexer('player-1')).rejects.toThrow(
      'network error',
    );
  });
});

// ── Scout discovery (issue #1298) ─────────────────────────────────────────────

describe('listPlayers', () => {
  it('GETs /players with the filter and cursor params', async () => {
    const page = { players: [], nextCursor: 'abc', total: 42 };
    mockGet.mockResolvedValue({ data: page });

    const result = await listPlayers({
      region: 'West Africa',
      position: 'ST',
      minLevel: 1,
      cursor: 'abc',
      limit: 50,
      createdAfter: 1_700_000_000,
    });

    expect(mockGet).toHaveBeenCalledWith('/players', {
      params: {
        region: 'West Africa',
        position: 'ST',
        minLevel: 1,
        cursor: 'abc',
        limit: 50,
        createdAfter: 1_700_000_000,
      },
    });
    expect(result).toEqual(page);
  });

  it('defaults to an empty params object', async () => {
    mockGet.mockResolvedValue({
      data: { players: [], nextCursor: null, total: 0 },
    });

    await listPlayers();

    expect(mockGet).toHaveBeenCalledWith('/players', { params: {} });
  });
});

describe('fetchIndexerHealth', () => {
  it('GETs /health and returns the lag snapshot', async () => {
    const health = {
      status: 'ok',
      lastLedger: 123,
      ledgerLag: 4,
      pollerRunning: true,
      uptime: 10,
    };
    mockGet.mockResolvedValue({ data: health });

    const result = await fetchIndexerHealth();

    expect(mockGet).toHaveBeenCalledWith('/health');
    expect(result.lastLedger).toBe(123);
    expect(result.ledgerLag).toBe(4);
  });
});
