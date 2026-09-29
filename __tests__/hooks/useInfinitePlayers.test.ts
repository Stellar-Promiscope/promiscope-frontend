'use client';

/**
 * useInfinitePlayers (issue #1298) — cursor-paginated discovery backed by
 * the indexer's GET /players. useScout's own tests exercise this hook
 * indirectly; these cases target the hook's contract directly (lazy start,
 * page accumulation, pagination stop).
 */
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { useInfinitePlayers } from '@/hooks/useInfinitePlayers';
import type { Player, PlayerFilter } from '@/types';

const mockListPlayers = jest.fn();

jest.mock('@/lib/indexerClient', () => ({
  listPlayers: (...args: unknown[]) => mockListPlayers(...args),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    SWRConfig,
    { value: { provider: () => new Map(), shouldRetryOnError: false } },
    children,
  );
}

const makePlayer = (id: string): Player =>
  ({
    id,
    wallet: `G${'X'.repeat(55)}`,
    vitals: {
      name: `Player ${id}`,
      age: 20,
      position: 'ST',
      region: 'West Africa',
      nationality: 'Nigeria',
    },
    progressLevel: 0,
    milestones: [],
    ipfsHash: '',
    createdAt: 1,
  }) as unknown as Player;

const FILTER: PlayerFilter = {
  region: 'West Africa',
  position: 'ST',
  minLevel: 0,
};

describe('useInfinitePlayers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListPlayers.mockReset();
  });

  it('does not fetch while the filter is null (lazy start)', async () => {
    const { result } = renderHook(() => useInfinitePlayers(null), {
      wrapper,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockListPlayers).not.toHaveBeenCalled();
    expect(result.current.players).toEqual([]);
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.total).toBe(0);
  });

  it('fetches the first page with the filter and exposes total/hasNextPage', async () => {
    mockListPlayers.mockResolvedValue({
      players: [makePlayer('p1'), makePlayer('p2')],
      nextCursor: 'next-1',
      total: 120,
    });

    const { result } = renderHook(() => useInfinitePlayers(FILTER), {
      wrapper,
    });

    await waitFor(() => expect(result.current.players).toHaveLength(2));

    expect(mockListPlayers).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'West Africa',
        position: 'ST',
        minLevel: 0,
        limit: 50,
      }),
    );
    expect(result.current.total).toBe(120);
    expect(result.current.hasNextPage).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('accumulates pages on loadMore and stops when nextCursor runs out', async () => {
    mockListPlayers.mockImplementation(async (params: { cursor?: string }) =>
      params.cursor
        ? { players: [makePlayer('p2')], nextCursor: null, total: 2 }
        : { players: [makePlayer('p1')], nextCursor: 'next-1', total: 2 },
    );

    const { result } = renderHook(() => useInfinitePlayers(FILTER), {
      wrapper,
    });
    await waitFor(() => expect(result.current.players).toHaveLength(1));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.players).toHaveLength(2));

    expect(result.current.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(result.current.hasNextPage).toBe(false);

    // Another loadMore must not fire a request — the key function returns
    // null once the previous page reported nextCursor: null.
    act(() => result.current.loadMore());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.players).toHaveLength(2);
    expect(
      mockListPlayers.mock.calls.map(
        (call) => (call[0] as { cursor?: string }).cursor,
      ),
    ).toEqual([undefined, 'next-1']);
  });

  it('surfaces indexer errors without falling back to the chain', async () => {
    mockListPlayers.mockRejectedValue(new Error('indexer unreachable'));

    const { result } = renderHook(() => useInfinitePlayers(FILTER), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current.error).toBe('indexer unreachable'),
    );
    expect(result.current.players).toEqual([]);
  });
});
