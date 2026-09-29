'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDebounce } from '@/hooks/useDebounce';
import { useToast } from '@/components/ui/Toast';
import type { PlayerFilter } from '@/types';

export const MAX_COMPARE_PLAYERS = 4;

function parseCompareIds(raw: string | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, MAX_COMPARE_PLAYERS);
}

interface ScoutSearchState {
  loading: boolean;
  isRateLimited: boolean;
  retryAfterSec: number | null;
  search: (filter: PlayerFilter) => void;
  searchByName: (name: string) => void;
}

/**
 * Filter state for the scout dashboard (issue #1355): the debounced name
 * search, structured filter searches, rate-limit countdown, the "has a
 * search completed yet" flags that drive skeleton/empty states, and the
 * compare selection synced to the `?ids=` URL param.
 */
export function useScoutDashboardFilters({
  loading,
  isRateLimited,
  retryAfterSec,
  search,
  searchByName,
}: ScoutSearchState) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { show: showToast } = useToast();

  const [remainingSec, setRemainingSec] = useState<number | null>(null);

  useEffect(() => {
    if (!isRateLimited) {
      setRemainingSec(null);
      return;
    }

    if (retryAfterSec === null) {
      showToast({
        message: 'Searching too fast — please slow down and try again.',
        variant: 'warning',
      });
      setRemainingSec(null);
      return;
    }

    setRemainingSec(retryAfterSec);
    showToast({
      message: `Searching too fast — please wait ${retryAfterSec}s and try again.`,
      variant: 'warning',
    });
  }, [isRateLimited, retryAfterSec, showToast]);

  // Countdown timer for rate limit
  useEffect(() => {
    if (remainingSec === null || remainingSec <= 0) {
      setRemainingSec(null);
      return;
    }
    const interval = setInterval(() => {
      setRemainingSec((prev) => (prev !== null && prev > 0 ? prev - 1 : null));
    }, 1000);
    return () => clearInterval(interval);
  }, [remainingSec]);

  const hasLoaded = useRef(false);
  const loadingEverStarted = useRef(false);
  const [searchHasCompleted, setSearchHasCompleted] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [compareIds, setCompareIds] = useState<string[]>(() =>
    parseCompareIds(searchParams.get('ids')),
  );

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const currentIds = params.get('ids');
    const nextIds = compareIds.join(',');

    if (compareIds.length === 0 && !currentIds) return;
    if (compareIds.length === 0) {
      if (currentIds) {
        params.delete('ids');
        router.replace(`?${params.toString()}`);
      }
      return;
    }

    if (currentIds !== nextIds) {
      params.set('ids', nextIds);
      const nextQuery = params.toString().replace(/%2C/gi, ',');
      router.replace(nextQuery ? `?${nextQuery}` : '?');
    }
  }, [compareIds, router, searchParams]);

  const [nameQuery, setNameQuery] = useState('');
  const debouncedName = useDebounce(nameQuery, 300);

  useEffect(() => {
    if (loading) {
      loadingEverStarted.current = true;
    } else if (loadingEverStarted.current) {
      hasLoaded.current = true;
      setSearchHasCompleted(true);
    }
  }, [loading]);

  useEffect(() => {
    if (debouncedName) {
      hasLoaded.current = false;
      setSearchHasCompleted(false);
      searchByName(debouncedName);
    } else {
      searchByName('');
    }
  }, [debouncedName, searchByName]);

  const handleSearch = useCallback(
    (filter: PlayerFilter) => {
      setNameQuery('');
      hasLoaded.current = false;
      search(filter);
    },
    [search],
  );

  const toggleCompare = useCallback(
    (playerId: string) => {
      setCompareIds((prev) => {
        if (prev.includes(playerId)) {
          return prev.filter((id) => id !== playerId);
        }
        if (prev.length >= MAX_COMPARE_PLAYERS) {
          showToast({
            message: `Maximum ${MAX_COMPARE_PLAYERS} players for comparison`,
            variant: 'info',
          });
          return prev;
        }
        return [...prev, playerId];
      });
    },
    [showToast],
  );

  const clearCompare = useCallback(() => {
    setCompareIds([]);
  }, []);

  const handleClearFilters = useCallback(() => {
    setNameQuery('');
    setResetKey((k) => k + 1);
  }, []);

  return {
    nameQuery,
    setNameQuery,
    remainingSec,
    searchHasCompleted,
    showSkeletons: loading && !hasLoaded.current,
    resetKey,
    handleSearch,
    handleClearFilters,
    compareIds,
    toggleCompare,
    clearCompare,
  };
}
