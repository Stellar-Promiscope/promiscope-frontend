'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import {
  fetchSavedSearches,
  markSavedSearchViewed,
  removeSavedSearch,
  renameSavedSearch,
  saveSearch,
} from '@/lib/savedSearchClient';
import { listPlayers } from '@/lib/indexerClient';
import { useUndoableRemoval } from './useUndoableRemoval';
import type { PlayerFilter, SavedSearch } from '@/types';

/** SWR key for the current scout's saved-searches cache. */
export function savedSearchesKey(scoutWallet: string | null): string | null {
  return scoutWallet ? `saved-searches:${scoutWallet}` : null;
}

/**
 * Tracks the authenticated scout's saved searches. `remove` is undoable: the
 * item disappears immediately, but the DELETE call is deferred behind an
 * "Undo" toast (see useUndoableRemoval).
 */
export function useSavedSearches(scoutWallet: string | null) {
  const { data, error, isValidating, mutate } = useSWR<SavedSearch[]>(
    savedSearchesKey(scoutWallet),
    fetchSavedSearches,
    {
      dedupingInterval: 5_000,
      revalidateOnFocus: false,
      errorRetryCount: 2,
    },
  );

  const undoableRemove = useUndoableRemoval();

  const save = useCallback(
    async (name: string, filter: PlayerFilter) => {
      await saveSearch(name, filter);
      mutate();
    },
    [mutate],
  );

  const rename = useCallback(
    async (id: number, newName: string) => {
      await renameSavedSearch(id, newName);
      mutate();
    },
    [mutate],
  );

  const markViewed = useCallback(
    async (entry: SavedSearch) => {
      const updated = await markSavedSearchViewed(entry.id);
      mutate(
        (current) =>
          (current ?? []).map((e) => (e.id === updated.id ? updated : e)),
        false,
      );
    },
    [mutate],
  );

  const remove = useCallback(
    (entry: SavedSearch) => {
      undoableRemove({
        id: entry.id,
        message: 'Saved search removed',
        onOptimisticRemove: () =>
          mutate(
            (current) => (current ?? []).filter((e) => e.id !== entry.id),
            false,
          ),
        onRestore: () =>
          mutate((current) => [entry, ...(current ?? [])], false),
        onCommit: async () => {
          try {
            await removeSavedSearch(entry.id);
          } finally {
            mutate();
          }
        },
      });
    },
    [undoableRemove, mutate],
  );

  return {
    searches: data ?? [],
    loading: isValidating && !data,
    error: error?.message ?? null,
    save,
    rename,
    remove,
    markViewed,
  };
}

/**
 * SWR key for the saved-search new-count query. `lastViewedAt` is part of
 * the key so re-marking a search viewed re-fetches its count (mirrors the
 * old scoutSearchKey sharing, which is no longer possible: discovery is
 * cursor-paginated now, so the badge needs its own tiny
 * `limit=1` + `createdAfter` count query instead of the full result list).
 */
export function savedSearchNewCountKey(
  filter: PlayerFilter,
  lastViewedAt: number,
): string {
  return `scout:newcount:${filter.region ?? ''}:${filter.position ?? ''}:${filter.minLevel ?? 0}:${lastViewedAt}`;
}

/**
 * Counts players matching a saved search's filter that were created after
 * `lastViewedAt` — the "new since last viewed" badge. Backed by the
 * indexer's GET /players `createdAfter` + `total` (issue #1298): one
 * indexed COUNT instead of materializing the whole result set the way the
 * old on-chain filterPlayers call did.
 */
export function useSavedSearchNewCount(
  filter: PlayerFilter,
  lastViewedAt: number,
): number {
  const { data } = useSWR<number>(
    savedSearchNewCountKey(filter, lastViewedAt),
    async () => {
      const { total } = await listPlayers({
        region: filter.region || undefined,
        position: filter.position || undefined,
        minLevel: filter.minLevel ?? 0,
        // Same comparison the old client-side filter used:
        // `p.createdAt > lastViewedAt` (createdAt is unix seconds).
        createdAfter: lastViewedAt,
        limit: 1,
      });
      return total;
    },
    {
      dedupingInterval: 60_000,
      revalidateOnFocus: false,
      errorRetryCount: 2,
    },
  );

  return data ?? 0;
}
