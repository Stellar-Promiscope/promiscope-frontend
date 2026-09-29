'use client';
import { useCallback } from 'react';
import useSWRInfinite from 'swr/infinite';
import { mutate as globalMutate } from 'swr';
import { listPlayers, type ListPlayersResponse } from '@/lib/indexerClient';
import type { Player, PlayerFilter } from '@/types';

/**
 * Page size for discovery fetches. The indexer's GET /players caps `limit`
 * at 50 (issue #1298), so this matches the server-side maximum.
 */
export const PLAYERS_PAGE_SIZE = 50;

/**
 * Cache key scheme for paginated discovery (issue #1298):
 *   page 0:      "scout:search:{region}:{position}:{minLevel}"
 *   page n > 0:  "scout:search:{region}:{position}:{minLevel}:{cursor}"
 *
 * The base format matches the pre-pagination `scoutSearchKey` so different
 * filter combos still get separate cache entries and SWR still deduplicates
 * concurrent identical searches. Sub-page keys embed the opaque cursor the
 * previous page returned, so each page is its own cache entry and a filter
 * change (different base key) resets the whole chain — SWR-infinite resets
 * `size` when the first-page key changes (`persistSize` defaults to false).
 */
export function scoutSearchKey(filter: PlayerFilter): string {
  return `scout:search:${filter.region ?? ''}:${filter.position ?? ''}:${filter.minLevel ?? 0}`;
}

/**
 * Imperatively invalidate every cached page of a scout search. Call after a
 * write operation that changes the player list (e.g. registration). Uses a
 * key filter so both the base key and all `base:{cursor}` page keys are
 * matched in one call.
 */
export async function invalidateScoutSearch(
  filter: PlayerFilter,
): Promise<void> {
  const base = scoutSearchKey(filter);
  await globalMutate(
    (key: unknown) =>
      typeof key === 'string' && (key === base || key.startsWith(`${base}:`)),
  );
}

interface PlayersPage {
  players: Player[];
  nextCursor: string | null;
  total: number;
}

export interface UseInfinitePlayersResult {
  players: Player[];
  /** Total matching the filter (server-side count), 0 before the first page resolves. */
  total: number;
  /** True while the first page or any subsequent page is fetching. */
  loading: boolean;
  error: string | null;
  /** True while more pages can be loaded (filter active and last page had a nextCursor). */
  hasNextPage: boolean;
  /** Fetches the next page; no-op when hasNextPage is false. */
  loadMore: () => void;
  refetch: () => Promise<void>;
}

/**
 * Cursor-paginated player discovery backed by the indexer's GET /players
 * (issue #1298) — replaces the on-chain `filter_players` simulation, whose
 * unbounded result Vec eventually exceeds Soroban's read-only simulation
 * limits as the registry grows.
 *
 * Pass `null` to disable (no fetch) until a search is initiated, mirroring
 * useScout's lazy behavior. Deliberately no on-chain fallback: falling back
 * to `filter_players` would re-create the exact failure mode this hook
 * exists to remove — indexer errors surface as `error` instead.
 */
export function useInfinitePlayers(
  filter: PlayerFilter | null,
): UseInfinitePlayersResult {
  const baseKey = filter ? scoutSearchKey(filter) : null;

  const { data, error, isValidating, mutate, size, setSize } =
    useSWRInfinite<PlayersPage>(
      (pageIndex: number, previousPageData: PlayersPage | null) => {
        if (baseKey === null) return null;
        if (pageIndex === 0) return baseKey;
        if (!previousPageData || previousPageData.nextCursor === null) {
          return null; // no cursor → no further pages, stop fetching
        }
        return `${baseKey}:${previousPageData.nextCursor}`;
      },
      async (key: string) => {
        const cursor =
          key === baseKey ? undefined : key.slice(baseKey!.length + 1);
        const page = await listPlayers({
          region: filter!.region || undefined,
          position: filter!.position || undefined,
          minLevel: filter!.minLevel ?? 0,
          cursor,
          limit: PLAYERS_PAGE_SIZE,
        });
        // Filter out archived profiles — same client-side exclusion the old
        // contract fetcher applied (the indexer doesn't know about the
        // off-chain archive flag, so this is a no-op for its rows today).
        return {
          ...page,
          players: page.players.filter((p) => !p.archived),
        };
      },
      {
        // revalidateFirstPage would refire page 0 on every `loadMore`
        // (SWR re-runs the first page whenever size changes), doubling the
        // request volume for deep scrolls. Freshness still comes from three
        // places: an empty cache on first load, an explicit refetch()
        // (mutate force-revalidates every page), and a filter change (new
        // base key → the whole chain restarts).
        revalidateFirstPage: false,
        revalidateOnFocus: false,
        dedupingInterval: 60_000,
        errorRetryCount: 2,
        persistSize: false,
      },
    );

  const lastPage: PlayersPage | undefined = data?.[data.length - 1];
  const players = data ? data.flatMap((page) => page.players) : [];

  const loadMore = useCallback(() => {
    setSize(size + 1);
  }, [setSize, size]);

  const refetch = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    players,
    total: lastPage?.total ?? 0,
    loading: isValidating,
    error: error?.message ?? null,
    hasNextPage: filter !== null && lastPage?.nextCursor != null,
    loadMore,
    refetch,
  };
}

export type { ListPlayersResponse };
