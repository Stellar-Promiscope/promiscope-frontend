'use client';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMilestonesBatch } from '@/hooks/useMilestonesBatch';
import PlayerCardSkeleton from '@/components/PlayerCardSkeleton';
import EmptyState from '@/components/ui/EmptyState';
import VirtualizedPlayerGrid from '@/components/scout/VirtualizedPlayerGrid';
import type { VirtualizedPlayerGridHandle } from '@/components/scout/VirtualizedPlayerGrid';
import type { Milestone, Player } from '@/types';

export const PAGE_SIZE = 12;

interface ScoutResultsProps {
  players: Player[];
  showSkeletons: boolean;
  showEmptyState: boolean;
  onResetFilters: () => void;
  renderPlayer: (
    player: Player,
    milestones: { milestones?: Milestone[]; milestonesLoading: boolean },
  ) => ReactNode;
}

/** Scout dashboard results: skeletons, empty state, virtualized grid and keyboard pagination. */
export default function ScoutResults({
  players,
  showSkeletons,
  showEmptyState,
  onResetFilters,
  renderPlayer,
}: ScoutResultsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Keyboard-accessible pagination is preserved as a first-class navigation
  // mode alongside real scroll virtualization: `players` is fully in memory
  // (rendering is windowed by VirtualizedPlayerGrid, not by slicing this
  // array), so "page" here just means "where goToPage/Previous/Next scroll
  // the virtualized grid to" — currentPage/totalPages describe that
  // position rather than which items are mounted.
  const totalPages = Math.max(1, Math.ceil(players.length / PAGE_SIZE));
  const [currentPage, setCurrentPage] = useState(1);
  const gridRef = useRef<VirtualizedPlayerGridHandle>(null);

  // Reset to page 1 whenever the result set changes identity (new
  // search/filter results replace `players` with a new array reference).
  useEffect(() => {
    setCurrentPage(1);
    gridRef.current?.scrollToItemIndex(0);
  }, [players]);

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

  function setPage(p: number) {
    const clamped = Math.max(1, Math.min(p, totalPages));
    goToPage(clamped);
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(clamped));
    router.replace(`?${params.toString()}`);
  }

  if (showSkeletons) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: PAGE_SIZE }).map((_, i) => (
          <PlayerCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (showEmptyState) {
    return (
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
          action={{ label: 'Reset Filters', onClick: onResetFilters }}
        />
      </div>
    );
  }

  return (
    <>
      {players.length > 0 && (
        <p className="text-sm text-gray-400">
          {players.length} player{players.length !== 1 ? 's' : ''} found
        </p>
      )}

      <VirtualizedPlayerGrid
        ref={gridRef}
        items={players}
        getKey={(p) => p.id}
        renderItem={(p) =>
          renderPlayer(p, {
            milestones: milestonesById[p.id],
            milestonesLoading: milestonesLoading && !milestonesById[p.id],
          })
        }
      />

      {players.length > PAGE_SIZE && (
        <nav
          aria-label="Player list pagination"
          className="flex flex-col items-center gap-3"
        >
          <p className="sr-only">
            Keyboard pagination — use these buttons if you prefer not to scroll
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
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage >= totalPages}
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
  );
}
