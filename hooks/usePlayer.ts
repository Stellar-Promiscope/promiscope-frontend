'use client';
import useSWR, { mutate as globalMutate } from 'swr';
import { getPlayer } from '@/lib/contract';
import type { Player } from '@/types';

/**
 * Cache key scheme for usePlayer:
 *   "player:{walletOrId}"
 *
 * Keys are fully deterministic — same walletOrId always produces the same key.
 * SWR deduplicates concurrent requests for the same key, preventing duplicate
 * RPC calls when multiple components mount with the same player ID.
 */
export function playerKey(walletOrId: string | null): string | null {
  return walletOrId ? `player:${walletOrId}` : null;
}

/**
 * Imperatively invalidate the player cache for a given wallet / ID.
 * Call after any write operation that mutates player state.
 */
export function invalidatePlayerCache(walletOrId: string): Promise<void> {
  return globalMutate(playerKey(walletOrId)) as Promise<void>;
}

/**
 * @param fallbackData Server-fetched player (e.g. from a server component) used
 *   as the initial value so the first render isn't a loading skeleton.
 */
export function usePlayer(
  walletOrId: string | null,
  fallbackData?: Player | null,
) {
  const {
    data: player,
    error,
    isValidating,
    mutate,
  } = useSWR<Player | null>(
    playerKey(walletOrId),
    async () => {
      const result = await getPlayer(walletOrId!);
      return result as Player | null;
    },
    {
      dedupingInterval: 5_000, // no duplicate RPC calls for the same player within 5 s
      revalidateOnFocus: false,
      errorRetryCount: 2,
      fallbackData,
    },
  );

  /**
   * Write optimistic data into the SWR cache without triggering a re-fetch.
   * Call this immediately after a write transaction resolves so the UI shows
   * the submitted data while waiting for on-chain finality.
   */
  const optimisticUpdate = (optimisticPlayer: Player) => {
    mutate(optimisticPlayer, { revalidate: false });
  };

  /**
   * Discard any optimistic data and revalidate from the contract.
   * Pass `discardOptimistic: true` to also clear the cache before fetching
   * (useful on error paths where the optimistic data should not linger).
   */
  const refetch = (options?: { discardOptimistic?: boolean }) => {
    if (options?.discardOptimistic) {
      return mutate(undefined, { revalidate: true }).then(() => {});
    } else {
      return mutate().then(() => {});
    }
  };

  return {
    player: player ?? null,
    loading: isValidating && !player,
    isValidating,
    error: error?.message ?? null,
    refetch,
    optimisticUpdate,
  };
}
