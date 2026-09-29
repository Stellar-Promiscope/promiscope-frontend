'use client';

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { useScout } from '@/hooks/useScout';
import { SearchRateLimitedError } from '@/lib/api';
import type { Player } from '@/types';

const mockListPlayers = jest.fn();
const mockSearchPlayersByName = jest.fn();

// Discovery is indexer-backed since issue #1298 — no @/lib/contract mock
// exists here anymore because useScout no longer imports it.
jest.mock('@/lib/indexerClient', () => ({
  listPlayers: (...args: unknown[]) => mockListPlayers(...args),
}));

jest.mock('@/lib/api', () => ({
  searchPlayersByName: (...args: unknown[]) => mockSearchPlayersByName(...args),
  SearchRateLimitedError: class SearchRateLimitedError extends Error {
    public retryAfterSec: number;
    constructor(message: string, retryAfterSec: number) {
      super(message);
      this.name = 'SearchRateLimitedError';
      this.retryAfterSec = retryAfterSec;
    }
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    SWRConfig,
    { value: { provider: () => new Map(), shouldRetryOnError: false } },
    children,
  );
}

const makePlayer = (id: string, archived = false): Player =>
  ({
    id,
    wallet: `G${'X'.repeat(55)}`,
    vitals: {
      name: `Test ${id}`,
      position: 'forward',
      region: 'EU',
      age: 20,
      nationality: 'US',
    },
    progressLevel: 1,
    archived,
    milestones: [],
    stats: { matches: 10, goals: 5, assists: 2 },
    ipfsHash: '',
  }) as unknown as Player;

describe('useScout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListPlayers.mockReset();
    mockSearchPlayersByName.mockReset();
  });

  test('search(filter) populates players and filters out archived profiles', async () => {
    mockListPlayers.mockResolvedValueOnce({
      players: [makePlayer('p1'), makePlayer('p2', true), makePlayer('p3')],
      nextCursor: null,
      total: 3,
    });

    const { result } = renderHook(() => useScout(), { wrapper });

    act(() =>
      result.current.search({
        region: 'EU',
        position: 'forward',
        minLevel: 0,
      }),
    );

    await waitFor(() =>
      expect(result.current.players.map((p) => p.id)).toEqual(['p1', 'p3']),
    );

    expect(mockListPlayers).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'EU',
        position: 'forward',
        minLevel: 0,
        limit: 50,
      }),
    );
    expect(result.current.total).toBe(3);
    expect(result.current.error).toBeNull();
    expect(result.current.isRateLimited).toBe(false);
  });

  test('searchByName routes to searchPlayersByName and excludes archived', async () => {
    mockSearchPlayersByName.mockResolvedValueOnce([
      makePlayer('n1'),
      makePlayer('n2', true),
    ]);

    const { result } = renderHook(() => useScout(), { wrapper });

    act(() => result.current.searchByName('alice'));

    await waitFor(() =>
      expect(result.current.players.map((p) => p.id)).toEqual(['n1']),
    );

    expect(mockSearchPlayersByName).toHaveBeenCalledWith('alice');
    expect(mockListPlayers).not.toHaveBeenCalled();
  });

  test('loadMore appends the next cursor page', async () => {
    mockListPlayers.mockImplementation(async (params: { cursor?: string }) => {
      if (params.cursor === 'cursor-1') {
        return { players: [makePlayer('p2')], nextCursor: null, total: 2 };
      }
      return {
        players: [makePlayer('p1')],
        nextCursor: 'cursor-1',
        total: 2,
      };
    });

    const { result } = renderHook(() => useScout(), { wrapper });

    act(() => result.current.search({ region: '', position: '', minLevel: 0 }));

    await waitFor(() =>
      expect(result.current.players.map((p) => p.id)).toEqual(['p1']),
    );
    expect(result.current.hasNextPage).toBe(true);

    act(() => result.current.loadMore());

    await waitFor(() =>
      expect(result.current.players.map((p) => p.id)).toEqual(['p1', 'p2']),
    );
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.total).toBe(2);
    expect(mockListPlayers).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'cursor-1' }),
    );
  });

  test('SearchRateLimitedError from the name-search backend surfaces isRateLimited + retryAfterSec', async () => {
    mockSearchPlayersByName.mockRejectedValueOnce(
      new SearchRateLimitedError('slow down', 42),
    );

    const { result } = renderHook(() => useScout(), { wrapper });

    act(() => result.current.searchByName('alice'));

    await waitFor(() => expect(result.current.error).toMatch(/slow down/));

    expect(result.current.isRateLimited).toBe(true);
    expect(result.current.retryAfterSec).toBe(42);
  });

  test('non-rate-limit error surfaces message verbatim and isRateLimited=false', async () => {
    mockListPlayers.mockRejectedValueOnce(new Error('RPC failed'));

    const { result } = renderHook(() => useScout(), { wrapper });

    act(() =>
      result.current.search({
        region: 'EU',
        position: 'forward',
        minLevel: 0,
      }),
    );

    await waitFor(() => expect(result.current.error).toBe('RPC failed'));
    expect(result.current.isRateLimited).toBe(false);
    expect(result.current.retryAfterSec).toBeNull();
  });

  test('empty result is not an error (Falsy array, not null)', async () => {
    mockListPlayers.mockResolvedValueOnce({
      players: [],
      nextCursor: null,
      total: 0,
    });

    const { result } = renderHook(() => useScout(), { wrapper });

    act(() =>
      result.current.search({
        region: '',
        position: '',
        minLevel: 0,
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.players).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  test('refetch re-runs the in-flight search (mutate is called)', async () => {
    mockListPlayers.mockResolvedValue({
      players: [makePlayer('p1')],
      nextCursor: null,
      total: 1,
    });

    const { result } = renderHook(() => useScout(), { wrapper });

    act(() =>
      result.current.search({
        region: '',
        position: '',
        minLevel: 0,
      }),
    );

    await waitFor(() => expect(result.current.players.length).toBe(1));
    const callsBefore = mockListPlayers.mock.calls.length;

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockListPlayers.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
