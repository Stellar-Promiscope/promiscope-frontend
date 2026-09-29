'use client';
import { useCallback } from 'react';
import Link from 'next/link';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRequireWallet } from '@/hooks/useRequireWallet';
import { useRequireSubscription } from '@/hooks/useRequireSubscription';
import { useScout } from '@/hooks/useScout';
import { useSubscription } from '@/hooks/useSubscription';
import { useOnboardingTour } from '@/hooks/useOnboardingTour';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useSavedSearches } from '@/hooks/useSavedSearches';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useToast } from '@/components/ui/Toast';
import useSWR from 'swr';
import { getPlayer } from '@/lib/contract';
import { fetchIndexerHealth, type IndexerHealth } from '@/lib/indexerClient';
import PlayerCard from '@/components/PlayerCard';
import PlayerFilterForm from '@/components/scout/PlayerFilterForm';
import ReferralPanel from '@/components/scout/ReferralPanel';
import SpendingSummary from '@/components/scout/SpendingSummary';
import OnboardingTour from '@/components/ui/OnboardingTour';
import { getTourSteps, SCOUT_TOUR_ID } from '@/lib/tourSteps';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { Player, PlayerFilter } from '@/types';
import PullToRefresh from '@/components/ui/PullToRefresh';
import ScrollToTop from '@/components/ui/ScrollToTop';
import VirtualizedPlayerGrid from '@/components/scout/VirtualizedPlayerGrid';
import ExportContactsCsvButton from '@/components/scout/ExportContactsCsvButton';
import Select from '@/components/ui/Select';
import {
  PLAYER_SORT_OPTIONS,
  parsePlayerSort,
  sortPlayers,
  type PlayerSort,
} from '@/lib/playerSort';
import type { VirtualizedPlayerGridHandle } from '@/components/scout/VirtualizedPlayerGrid';

const PAGE_SIZE = 12;
const MAX_COMPARE_PLAYERS = 4;

function isStellarKey(v: string) {
  return /^G[A-Z2-7]{55}$/.test(v);
}

function parseCompareIds(raw: string | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, MAX_COMPARE_PLAYERS);
}

/** Badge showing how many players matching a saved search appeared since it was last viewed. */
function SavedSearchNewBadge({
  filter,
  lastViewedAt,
}: {
  filter: PlayerFilter;
  lastViewedAt: number;
}) {
  const newCount = useSavedSearchNewCount(filter, lastViewedAt);
  if (newCount === 0) return null;
  return (
    <span className="shrink-0 rounded-full bg-brand-green/20 px-2 py-0.5 text-xs font-medium text-brand-green">
      {newCount} new
    </span>
  );
}

export default function ScoutDashboardContent() {
  const { walletAddress: publicKey } = useRequireWallet();
  const { isProtected, loading: subscriptionLoading } =
    useRequireSubscription();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('scout_dashboard');

  const isMobile = useIsMobile();
  const tourSteps = useMemo(
    () => getTourSteps('scout', { isMobile }),
    [isMobile],
  );
  const tour = useOnboardingTour(
    SCOUT_TOUR_ID,
    tourSteps,
    publicKey ?? undefined,
  );

  const {
    players: unsortedPlayers,
    total,
    loading,
    isRateLimited,
    retryAfterSec,
    hasNextPage,
    loadMore,
    searchId,
    search,
    searchByName,
    refetch,
  } = useScout();

  // Indexer freshness (issue #1298): GET /health's ledgerLag drives the
  // "results may be up to N ledgers behind" hint — discovery now reads the
  // indexer, so a lagging poller means slightly stale results.
  const { data: indexerHealth } = useSWR<IndexerHealth>(
    'scout:indexer-health',
    fetchIndexerHealth,
    {
      refreshInterval: 60_000,
      dedupingInterval: 30_000,
      revalidateOnFocus: false,
      errorRetryCount: 1,
    },
  );
  const ledgerLag = indexerHealth?.ledgerLag ?? 0;
  const { subscription } = useSubscription();

  // Issue #556: sort is kept in the `sort` query param so it survives a
  // refresh or shared link; sorting happens client-side over loaded results.
  const sort = parsePlayerSort(searchParams.get('sort'));
  const players = useMemo(
    () => sortPlayers(unsortedPlayers, sort),
    [unsortedPlayers, sort],
  );
  const handleSortChange = useCallback(
    (next: PlayerSort) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'default') params.delete('sort');
      else params.set('sort', next);
      params.delete('page');
      const query = params.toString();
      router.replace(query ? `?${query}` : '?', { scroll: false });
    },
    [router, searchParams],
  );
  const watchlist = useWatchlist(publicKey ?? null);
  const savedSearches = useSavedSearches(publicKey ?? null);
  const recentlyViewed = useRecentlyViewed();
  const { show: showToast } = useToast();
  const [now, setNow] = useState(() => Date.now());
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const [searchAnnouncement, setSearchAnnouncement] = useState<string>('');

  const filters = useScoutDashboardFilters({
    loading,
    isRateLimited,
    retryAfterSec,
    search,
    searchByName,
  });
  const { compareIds, toggleCompare, handleSearch } = filters;
  const showCompareBar = compareIds.length >= 2;
  const compareLimitReached = compareIds.length >= MAX_COMPARE_PLAYERS;

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

  const [walletQuery, setWalletQuery] = useState('');
  const [searchResult, setSearchResult] = useState<
    Player | null | 'not-found' | 'invalid'
  >(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [nameQuery, setNameQuery] = useState('');
  const debouncedName = useDebounce(nameQuery, 300);

  // Keyboard-accessible pagination is preserved as a first-class navigation
  // mode alongside real scroll virtualization: `players` is fully in memory
  // (rendering is windowed by VirtualizedPlayerGrid, not by slicing this
  // array), so "page" here just means "where goToPage/Previous/Next scroll
  // the virtualized grid to" — currentPage/totalPages describe that
  // position rather than which items are mounted.
  const totalPages = Math.max(1, Math.ceil(players.length / PAGE_SIZE));
  const [currentPage, setCurrentPage] = useState(1);
  const gridRef = useRef<VirtualizedPlayerGridHandle>(null);

  // Reset to page 1 whenever a *different* search starts (new filter, name
  // query, or saved-search apply). Keyed on searchId rather than the
  // `players` array so appending a cursor-paginated page (issue #1298) —
  // which also creates a new array reference — doesn't yank the scout back
  // to the top mid-scroll.
  useEffect(() => {
    setCurrentPage(1);
    gridRef.current?.scrollToItemIndex(0);
  }, [searchId]);

  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(page, totalPages));
      setCurrentPage(clamped);
      gridRef.current?.scrollToItemIndex((clamped - 1) * PAGE_SIZE);
    },
    [totalPages],
  );

  // Batched milestone fetch for the whole current result set — one request
  // regardless of how many PlayerCards are mounted at any given scroll
  // position, replacing each card's own per-player RPC call.
  const playerIds = useMemo(() => players.map((p) => p.id), [players]);
  const { milestonesById, isLoading: milestonesLoading } =
    useMilestonesBatch(playerIds);

  const pageParam = Math.max(1, Number(searchParams.get('page') ?? '1'));

  function setPage(p: number) {
    const clamped = Math.max(1, Math.min(p, totalPages));
    goToPage(clamped);
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(clamped));
    router.replace(`?${params.toString()}`);
  }

  useEffect(() => {
    if (loading) {
      loadingEverStarted.current = true;
    } else if (loadingEverStarted.current) {
      hasLoaded.current = true;
      setSearchHasCompleted(true);
    }
  }, [loading]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!walletQuery) {
      setSearchResult(null);
      return;
    }

    if (!isStellarKey(walletQuery)) {
      setSearchResult('invalid');
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const result = await getPlayer(walletQuery);
        setSearchResult(result ? (result as Player) : 'not-found');
      } catch {
        setSearchResult('not-found');
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [walletQuery]);

  useEffect(() => {
    if (debouncedName) {
      hasLoaded.current = false;
      setSearchHasCompleted(false);
      searchByName(debouncedName);
    } else {
      searchByName('');
    }
  }, [debouncedName, searchByName]);

  // Announce search results after debounce and fetch resolves
  useEffect(() => {
    if (!searchHasCompleted || nameQuery === '') {
      setSearchAnnouncement('');
      return;
    }

    if (players.length === 0) {
      setSearchAnnouncement(t('no_players'));
    } else {
      // Use ICU plural for proper localization
      setSearchAnnouncement(t('players_found', { count: players.length }));
    }
  }, [searchHasCompleted, players.length, nameQuery, t]);

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

  const handleClearCompare = useCallback(() => {
    setCompareIds([]);
  }, []);

  const handleClearFilters = useCallback(() => {
    setNameQuery('');
    setResetKey((k) => k + 1);
  }, []);

  const handleToggleWatchlist = useCallback(
    (targetPlayer: Player) => {
      const existing = watchlist.entries.find(
        (e) => e.playerId === targetPlayer.id,
      );
      if (existing) {
        watchlist.remove(existing);
      } else {
        watchlist.add(targetPlayer.id);
      }
    },
    [watchlist],
  );

  const handleSaveSearch = useCallback(
    (name: string, filter: PlayerFilter) => {
      savedSearches.save(name, filter);
    },
    [savedSearches],
  );

  if (!publicKey) return null;
  if (subscriptionLoading || !isProtected) return null;

  const showEmptyState =
    filters.searchHasCompleted && !loading && players.length === 0;

  const renderPlayerCard = (
    p: Player,
    milestones?: { milestones?: Milestone[]; milestonesLoading: boolean },
  ) => (
    <PlayerCard
      player={p}
      isWatched={watchlist.isWatched(p.id)}
      onToggleWatchlist={() => handleToggleWatchlist(p)}
      isCompareSelected={compareIds.includes(p.id)}
      onToggleCompare={() => toggleCompare(p.id)}
      {...milestones}
    />
  );

  return (
    <PullToRefresh onRefresh={refetch} isLoading={loading}>
      <OnboardingTour
        isVisible={tour.isVisible}
        currentStep={tour.currentStep}
        currentStepData={tour.currentStepData}
        steps={tour.steps}
        onNext={tour.nextStep}
        onPrev={tour.prevStep}
        onDismiss={tour.dismissTour}
        onSkip={tour.skipTour}
        onComplete={tour.completeTour}
        onGoToStep={tour.goToStep}
      />
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold text-white">Scout Dashboard</h1>
          <ExportContactsCsvButton scoutId={publicKey} />
        </div>

        {subscription && (
          <SubscriptionStatusBanner subscription={subscription} />
        )}

        <ReferralPanel />

        <SpendingSummary />

        {watchlist.entries.length > 0 && (
          <div className="bg-brand-card border border-gray-800 rounded-xl p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-300">
                My Watchlist
              </h2>
              <Link
                href="/scout/watchlist"
                className="text-xs text-brand-green hover:underline"
              >
                View all
              </Link>
            </div>
            <ul className="flex flex-col gap-2">
              {watchlist.entries.slice(0, 5).map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 text-sm text-gray-200"
                >
                  <Link
                    href={`/player/${entry.playerId}`}
                    className="text-brand-green hover:underline truncate"
                  >
                    {entry.playerId}
                  </Link>
                  <button
                    type="button"
                    onClick={() => watchlist.remove(entry)}
                    className="px-3 py-1 rounded-lg border border-gray-700 text-xs text-gray-300 hover:border-red-500 hover:text-red-400 transition"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {recentlyViewed.entries.length > 0 && (
          <div className="bg-brand-card border border-gray-800 rounded-xl p-5 flex flex-col gap-3">
            <h2 className="text-sm font-medium text-gray-300">
              Recently Viewed
            </h2>
            <ul className="flex flex-col gap-2">
              {recentlyViewed.entries.map((entry) => (
                <li
                  key={entry.playerId}
                  className="flex items-center justify-between gap-3 text-sm text-gray-200"
                >
                  <Link
                    href={`/player/${entry.playerId}`}
                    className="text-brand-green hover:underline truncate"
                  >
                    {entry.name}
                  </Link>
                  <span className="text-xs text-gray-500 shrink-0">
                    {entry.position}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {savedSearches.searches.length > 0 && (
          <div className="bg-brand-card border border-gray-800 rounded-xl p-5 flex flex-col gap-3">
            <h2 className="text-sm font-medium text-gray-300">
              Saved Searches
            </h2>
            <ul className="flex flex-col gap-2">
              {savedSearches.searches.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 text-sm text-gray-200"
                >
                  {renamingId === s.id ? (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <input
                        className="input flex-1 min-w-0"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const trimmed = renameValue.trim();
                            if (trimmed) {
                              savedSearches.rename(s.id, trimmed);
                            }
                            setRenamingId(null);
                          }
                          if (e.key === 'Escape') {
                            setRenamingId(null);
                          }
                        }}
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const trimmed = renameValue.trim();
                          if (trimmed) {
                            savedSearches.rename(s.id, trimmed);
                          }
                          setRenamingId(null);
                        }}
                        disabled={!renameValue.trim()}
                        className="px-3 py-1 rounded-lg border border-brand-green text-xs text-brand-green disabled:opacity-40 hover:bg-brand-green hover:text-black transition"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingId(null)}
                        className="px-3 py-1 rounded-lg border border-gray-700 text-xs text-gray-300 hover:border-gray-500 transition"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="flex items-center gap-2 truncate">
                        <span className="truncate">{s.name}</span>
                        <SavedSearchNewBadge
                          filter={s.filter}
                          lastViewedAt={s.lastViewedAt}
                        />
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            handleSearch(s.filter);
                            savedSearches.markViewed(s);
                          }}
                          className="px-3 py-1 rounded-lg border border-brand-green text-xs text-brand-green hover:bg-brand-green hover:text-black transition"
                        >
                          Apply
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenameValue(s.name);
                            setRenamingId(s.id);
                          }}
                          className="px-3 py-1 rounded-lg border border-gray-700 text-xs text-gray-300 hover:border-yellow-500 hover:text-yellow-400 transition"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => savedSearches.remove(s)}
                          className="px-3 py-1 rounded-lg border border-gray-700 text-xs text-gray-300 hover:border-red-500 hover:text-red-400 transition"
                        >
                          Remove
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div
          className="bg-brand-card border border-gray-800 rounded-xl p-5 flex flex-col gap-3"
          data-tour="search-section"
        >
          <label
            className="text-sm font-medium text-gray-300"
            htmlFor="wallet-search"
          >
            Search by Wallet Address
          </label>
          <input
            id="wallet-search"
            className="input"
            placeholder="G... (56-character Stellar public key)"
            value={walletQuery}
            onChange={(e) => setWalletQuery(e.target.value.trim())}
            autoComplete="off"
            spellCheck={false}
          />
          {walletQuery && (
            <div className="mt-1">
              {searchLoading && (
                <p className="text-sm text-gray-400">Searching…</p>
              )}
              {!searchLoading && searchResult === 'invalid' && (
                <p className="text-sm text-red-400">
                  Invalid Stellar address — must be a 56-character key starting
                  with G.
                </p>
              )}
              {!searchLoading && searchResult === 'not-found' && (
                <EmptyState
                  title="No players found"
                  description="No player is registered with that wallet address."
                />
              )}
              {!searchLoading &&
                searchResult &&
                searchResult !== 'invalid' &&
                searchResult !== 'not-found' && (
                  <div className="mt-2 max-w-sm">
                    <PlayerCard
                      player={searchResult}
                      isWatched={watchlist.isWatched(searchResult.id)}
                      onToggleWatchlist={() =>
                        handleToggleWatchlist(searchResult)
                      }
                      isCompareSelected={compareIds.includes(searchResult.id)}
                      onToggleCompare={() => toggleCompare(searchResult.id)}
                    />
                  </div>
                )}
            </div>
          )}
        </div>

        <div className="bg-brand-card border border-gray-800 rounded-xl p-5 flex flex-col gap-3">
          <label
            className="text-sm font-medium text-gray-300"
            htmlFor="name-search"
          >
            Search by Player Name
          </label>
          <input
            id="name-search"
            className="input"
            placeholder="e.g. Amara Diallo"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            autoComplete="off"
            disabled={remainingSec !== null}
            aria-controls="search-results"
            aria-expanded={nameQuery.length > 0 && !loading}
          />
          <div
            id="search-results"
            role="status"
            aria-live="polite"
            className="sr-only"
          >
            {searchAnnouncement}
          </div>
          {remainingSec !== null && (
            <p className="text-sm text-orange-400">
              Rate limited. Try again in {remainingSec}s.
            </p>
          )}
          {nameQuery &&
            !loading &&
            players.length === 0 &&
            searchHasCompleted && (
              <EmptyState
                title="No players found"
                description={`No players match "${nameQuery}".`}
              />
            )}
        </div>

        <div
          className={`bg-brand-card border border-gray-800 rounded-xl p-5${filters.nameQuery ? ' opacity-50 pointer-events-none' : ''}`}
          data-tour="filter-section"
          data-testid="filter-form"
        >
          <PlayerFilterForm
            onSearch={handleSearch}
            resetKey={filters.resetKey}
            onSaveSearch={handleSaveSearch}
            disabled={filters.remainingSec !== null}
          />
          <div className="mt-4 sm:max-w-xs">
            <Select
              id="player-sort"
              label="Sort by"
              value={sort}
              onChange={(e) =>
                handleSortChange(parsePlayerSort(e.target.value))
              }
              data-testid="player-sort"
            >
              {PLAYER_SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {showCompareBar && (
          <div className="flex items-center justify-between bg-brand-card border border-brand-green rounded-xl px-5 py-3 gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm text-gray-200">
                {compareIds.length} player{compareIds.length !== 1 ? 's' : ''}{' '}
                selected for comparison
              </span>
              {compareLimitReached && (
                <span className="text-xs text-brand-green">
                  Limit reached: up to {MAX_COMPARE_PLAYERS} players can be
                  compared.
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Link
                href={`/scout/compare?ids=${compareIds.join(',')}`}
                className="px-4 py-1.5 rounded-lg border border-brand-green text-sm text-brand-green hover:bg-brand-green hover:text-black transition"
              >
                Compare
              </Link>
              <button
                type="button"
                onClick={filters.clearCompare}
                className="px-4 py-1.5 rounded-lg border border-gray-700 text-sm text-gray-300 hover:border-red-500 hover:text-red-400 transition"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {showSkeletons ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: PAGE_SIZE }).map((_, i) => (
              <PlayerCardSkeleton key={i} />
            ))}
          </div>
        ) : showEmptyState ? (
          <div data-testid="empty-state">
            <EmptyState
              title="No players found"
              description="Try adjusting your filters."
              icon={
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-12 h-12 mx-auto"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
                  />
                </svg>
              }
              action={{ label: 'Reset Filters', onClick: handleClearFilters }}
            />
          </div>
        ) : (
          <>
            {players.length > 0 && (
              <p className="text-sm text-gray-400">
                {total} player{total !== 1 ? 's' : ''} found
              </p>
            )}

            {ledgerLag > 0 && (
              <p
                data-testid="indexer-lag-hint"
                className="text-xs text-gray-500"
              >
                {t('results_behind', { count: ledgerLag })}
              </p>
            )}

            <VirtualizedPlayerGrid
              ref={gridRef}
              items={players}
              getKey={(p) => p.id}
              hasMore={hasNextPage}
              onEndReached={loadMore}
              renderItem={(p) => (
                <PlayerCard
                  player={p}
                  isWatched={watchlist.isWatched(p.id)}
                  onToggleWatchlist={() => handleToggleWatchlist(p)}
                  isCompareSelected={compareIds.includes(p.id)}
                  onToggleCompare={() => toggleCompare(p.id)}
                  milestones={milestonesById[p.id]}
                  milestonesLoading={milestonesLoading && !milestonesById[p.id]}
                />
              )}
            />

            {players.length > PAGE_SIZE && (
              <nav
                aria-label="Player list pagination"
                className="flex flex-col items-center gap-3"
              >
                <p className="sr-only">
                  Keyboard pagination — use these buttons if you prefer not to
                  scroll
                </p>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setPage(currentPage - 1)}
                    disabled={currentPage <= 1}
                    aria-label="Previous page"
                    data-testid="pagination-prev"
                    className="px-4 py-2 rounded-lg border border-gray-700 text-gray-300 disabled:opacity-40 hover:border-brand-green transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green"
                  >
                    Previous
                  </button>
                  <span
                    className="text-sm text-gray-400"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => {
                      if (currentPage >= totalPages && hasNextPage) {
                        // At the end of what's loaded — fetch the next
                        // cursor page (issue #1298); the following click
                        // advances into it.
                        loadMore();
                      } else {
                        setPage(currentPage + 1);
                      }
                    }}
                    disabled={currentPage >= totalPages && !hasNextPage}
                    aria-label="Next page"
                    data-testid="pagination-next"
                    className="px-4 py-2 rounded-lg border border-gray-700 text-gray-300 disabled:opacity-40 hover:border-brand-green transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green"
                  >
                    Next
                  </button>
                </div>
              </nav>
            )}
          </>
        )}
      </div>
      <ScrollToTop />
    </PullToRefresh>
  );
}
