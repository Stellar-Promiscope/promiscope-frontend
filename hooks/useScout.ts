'use client';
import { useState, useCallback } from 'react';
import useSWR from 'swr';
import { searchPlayersByName, SearchRateLimitedError } from '@/lib/api';
import { rankByFuzzyMatch } from '@/lib/fuzzyMatch';
import {
  useInfinitePlayers,
  scoutSearchKey,
  invalidateScoutSearch,
} from './useInfinitePlayers';
import type { Player, PlayerFilter } from '@/types';

// Re-exported for existing consumers (useSavedSearches) — the key helpers
// moved into useInfinitePlayers when discovery became cursor-paginated
// (issue #1298) but keep their original name and format.
export { scoutSearchKey, invalidateScoutSearch };

type ScoutMode =
  | { kind: 'idle' }
  | { kind: 'name'; name: string }
  | { kind: 'filter'; filter: PlayerFilter };

/**
 * Scout discovery (issue #1298).
 *
 * Two modes:
 *  - name search → the backend's /players/search proxy (unchanged; it
 *    returns the full result set, so no cursor pagination here);
 *  - filter search → useInfinitePlayers, i.e. the indexer's paginated
 *    GET /players. The on-chain `filter_players` simulation is gone from
 *    this path: it returns every matching Player in one Vec and eventually
 *    exceeds Soroban's read-only simulation limits as the registry grows.
 */
export function useScout() {
  const [mode, setMode] = useState<ScoutMode>({ kind: 'idle' });

  const nameKey = mode.kind === 'name' ? `scout:name:${mode.name}` : null;
  const {
    data: nameResults,
    error: nameError,
    isValidating: nameValidating,
    mutate: nameMutate,
  } = useSWR<Player[]>(
    nameKey,
    async (key: string) => {
      const name = key.slice('scout:name:'.length);
      const results = await searchPlayersByName(name);
      // Typo-tolerant ranking: exact/substring matches lead and close
      // misspellings still float to the top. Threshold 0 means we only
      // reorder — the backend already decided what's a match (it may use
      // signals a client-side edit-distance check can't see, e.g.
      // aliases), so we never hide a result it chose to return.
      const ranked = rankByFuzzyMatch(results, name, (p) => p.vitals.name, 0);
      // Filter out archived profiles
      return ranked.filter((p) => !p.archived);
    },
    {
      dedupingInterval: 60_000,
      revalidateOnFocus: false,
      errorRetryCount: 2,
    },
  );

  const infinite = useInfinitePlayers(
    mode.kind === 'filter' ? mode.filter : null,
  );

  const isFilterMode = mode.kind === 'filter';
  const players = isFilterMode ? infinite.players : (nameResults ?? []);

  /** Stable identity of the current search — changes only when the user starts a different search, not when a page is appended. */
  const searchId =
    mode.kind === 'idle'
      ? null
      : mode.kind === 'name'
        ? `scout:name:${mode.name}`
        : scoutSearchKey(mode.filter);

  /** Trigger a filter search with the given filter (indexer-backed, paginated). */
  const search = useCallback((filter: PlayerFilter) => {
    setMode({ kind: 'filter', filter });
  }, []);

  const searchByName = useCallback((name: string) => {
    setMode({ kind: 'name', name });
  }, []);

  const refetch = useCallback((): Promise<void> => {
    return isFilterMode ? infinite.refetch() : (nameMutate() as Promise<void>);
  }, [isFilterMode, infinite.refetch, nameMutate]);

  return {
    players,
    /**
     * Total players matching the current filter (server-side count from
     * GET /players). On the name-search path the backend returns the full
     * result set, so the local length *is* the total.
     */
    total: isFilterMode ? infinite.total : players.length,
    loading: isFilterMode ? infinite.loading : nameValidating,
    error: isFilterMode ? infinite.error : (nameError?.message ?? null),
    isRateLimited: nameError instanceof SearchRateLimitedError,
    retryAfterSec:
      nameError instanceof SearchRateLimitedError
        ? nameError.retryAfterSec
        : null,
    /** Whether another page can be fetched (filter mode only). */
    hasNextPage: isFilterMode && infinite.hasNextPage,
    /** Fetch the next page of the current filter search. */
    loadMore: infinite.loadMore,
    searchId,
    search,
    searchByName,
    refetch,
  };
}
