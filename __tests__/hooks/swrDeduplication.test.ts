/**
 * SWR deduplication tests — issue #394
 *
 * Verifies that read hooks sharing the same SWR cache key collapse multiple
 * concurrent consumers into a single RPC call, and that caches are invalidated
 * after write operations.
 *
 * Each test uses a fresh SWR cache (provider: () => new Map()) so test runs
 * never bleed into one another.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { SWRConfig } from 'swr';
import type { Player, Milestone } from '@/types';

// ── Mocks ────────────────────────────────────────────────────────────────────
jest.mock('@/lib/contract', () => ({
  getPlayer: jest.fn(),
  getMilestoneHistory: jest.fn(),
}));

// useMilestoneHistory reads from the indexer first, falling back to the
// contract only when the indexer errors — force that fallback path here so
// these dedup tests keep exercising getMilestoneHistory directly.
// `listPlayers` is the indexer-backed discovery call useScout deduplicates
// over (issue #1298).
jest.mock('@/lib/indexerClient', () => ({
  getMilestoneHistoryFromIndexer: jest.fn(),
  listPlayers: jest.fn(),
}));

import { getPlayer, getMilestoneHistory } from '@/lib/contract';
import {
  getMilestoneHistoryFromIndexer,
  listPlayers,
} from '@/lib/indexerClient';
import { usePlayer } from '@/hooks/usePlayer';
import { useScout } from '@/hooks/useScout';
import { useMilestoneHistory } from '@/hooks/useMilestoneHistory';

const mockGetPlayer = getPlayer as jest.Mock;
const mockListPlayers = listPlayers as jest.Mock;
const mockGetMilestoneHistory = getMilestoneHistory as jest.Mock;
const mockGetMilestoneHistoryFromIndexer =
  getMilestoneHistoryFromIndexer as jest.Mock;

// ── Test fixtures ─────────────────────────────────────────────────────────────
const PLAYER: Player = {
  id: 'player-1',
  wallet: 'GCFW7QAO3WZQ6X4CZ3OYZFXX3A3DL7XVI5DNVTXA5VJUGE5SU6ZRG5OV',
  vitals: {
    name: 'Ava Rodriguez',
    age: 21,
    position: 'Forward',
    region: 'West Africa',
    nationality: 'Ghana',
  },
  ipfsHash: 'QmHash',
  progressLevel: 2,
  milestones: [],
  createdAt: 0,
};

const MILESTONES: Milestone[] = [
  {
    id: 'm1',
    description: 'Scored 20 goals',
    evidenceHash: 'Qm123',
    validator: 'GABC',
    timestamp: 1700000000,
  },
];

// ── Shared SWR wrapper factory ────────────────────────────────────────────────
// Each call returns a wrapper with its own fresh Map() cache, isolating tests.
function makeWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      SWRConfig,
      { value: { provider: () => new Map(), shouldRetryOnError: false } },
      children,
    );
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  // Reset clears the inline mock impl set at module-mock time too; every
  // test forces the indexer to error so getMilestoneHistory keeps being the
  // thing under test here (see the useMilestoneHistory-specific dedup tests
  // below, which are the only ones that exercise this fallback).
  mockGetMilestoneHistoryFromIndexer.mockRejectedValue(
    new Error('indexer unreachable'),
  );
});

// ── usePlayer deduplication ───────────────────────────────────────────────────
describe('usePlayer — SWR deduplication', () => {
  test('two hooks with the same player ID share a single getPlayer call', async () => {
    mockGetPlayer.mockResolvedValue(PLAYER);
    const wrapper = makeWrapper();

    const { result } = renderHook(
      () => ({ r1: usePlayer('player-1'), r2: usePlayer('player-1') }),
      { wrapper },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Both hooks receive data but only one RPC was fired.
    expect(mockGetPlayer).toHaveBeenCalledTimes(1);
    expect(result.current.r1.player).toEqual(PLAYER);
    expect(result.current.r2.player).toEqual(PLAYER);
  });

  test('two hooks with different player IDs fire separate getPlayer calls', async () => {
    const player2 = { ...PLAYER, id: 'player-2' };
    mockGetPlayer.mockResolvedValueOnce(PLAYER).mockResolvedValueOnce(player2);
    const wrapper = makeWrapper();

    const { result } = renderHook(
      () => ({ r1: usePlayer('player-1'), r2: usePlayer('player-2') }),
      { wrapper },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetPlayer).toHaveBeenCalledTimes(2);
    expect(result.current.r1.player?.id).toBe('player-1');
    expect(result.current.r2.player?.id).toBe('player-2');
  });

  test('cache invalidation via refetch triggers a fresh getPlayer call', async () => {
    mockGetPlayer.mockResolvedValue(PLAYER);
    const wrapper = makeWrapper();

    const { result } = renderHook(() => usePlayer('player-1'), { wrapper });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetPlayer).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refetch();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetPlayer).toHaveBeenCalledTimes(2);
  });
});

// ── useScout deduplication ────────────────────────────────────────────────────
describe('useScout — SWR deduplication', () => {
  test('two hooks searching with identical filters share a single listPlayers call', async () => {
    mockListPlayers.mockResolvedValue({
      players: [PLAYER],
      nextCursor: null,
      total: 1,
    });
    const wrapper = makeWrapper();

    const { result } = renderHook(() => ({ r1: useScout(), r2: useScout() }), {
      wrapper,
    });

    const filter = {
      region: 'West Africa',
      position: 'Forward',
      minLevel: 1 as const,
    };

    act(() => {
      result.current.r1.search(filter);
      result.current.r2.search(filter);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockListPlayers).toHaveBeenCalledTimes(1);
    expect(result.current.r1.players).toEqual([PLAYER]);
    expect(result.current.r2.players).toEqual([PLAYER]);
  });

  test('different filter combos fire separate listPlayers calls', async () => {
    mockListPlayers.mockResolvedValue({
      players: [],
      nextCursor: null,
      total: 0,
    });
    const wrapper = makeWrapper();

    const { result } = renderHook(() => ({ r1: useScout(), r2: useScout() }), {
      wrapper,
    });

    act(() => {
      result.current.r1.search({
        region: 'West Africa',
        position: 'Forward',
        minLevel: 0,
      });
      result.current.r2.search({
        region: 'East Africa',
        position: 'Midfielder',
        minLevel: 1,
      });
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockListPlayers).toHaveBeenCalledTimes(2);
  });
});

// ── useMilestoneHistory deduplication ─────────────────────────────────────────
describe('useMilestoneHistory — SWR deduplication', () => {
  test('two hooks with the same playerID share a single getMilestoneHistory call', async () => {
    mockGetMilestoneHistory.mockResolvedValue(MILESTONES);
    const wrapper = makeWrapper();

    const { result } = renderHook(
      () => ({
        r1: useMilestoneHistory('player-1'),
        r2: useMilestoneHistory('player-1'),
      }),
      { wrapper },
    );

    await waitFor(() => expect(mockGetMilestoneHistory).toHaveBeenCalled());

    expect(mockGetMilestoneHistory).toHaveBeenCalledTimes(1);
    expect(result.current.r1.milestones).toEqual(MILESTONES);
    expect(result.current.r2.milestones).toEqual(MILESTONES);
  });

  test('null playerID suppresses the RPC call and returns empty array', async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useMilestoneHistory(null), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetMilestoneHistory).not.toHaveBeenCalled();
    expect(result.current.milestones).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  test('refetch re-fires getMilestoneHistory for the same player', async () => {
    mockGetMilestoneHistory.mockResolvedValue(MILESTONES);
    const wrapper = makeWrapper();

    const { result } = renderHook(() => useMilestoneHistory('player-1'), {
      wrapper,
    });

    await waitFor(() => expect(mockGetMilestoneHistory).toHaveBeenCalled());
    expect(mockGetMilestoneHistory).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() =>
      expect(mockGetMilestoneHistory).toHaveBeenCalledTimes(2),
    );
  });

  test('two hooks with different playerIDs fire separate getMilestoneHistory calls', async () => {
    mockGetMilestoneHistory.mockResolvedValue([]);
    const wrapper = makeWrapper();

    renderHook(() => useMilestoneHistory('player-1'), { wrapper });
    renderHook(() => useMilestoneHistory('player-2'), { wrapper });

    await waitFor(() =>
      expect(mockGetMilestoneHistory).toHaveBeenCalledTimes(2),
    );
  });
});
