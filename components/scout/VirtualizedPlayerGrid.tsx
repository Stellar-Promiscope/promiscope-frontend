'use client';
import {
  Fragment,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useCallback,
} from 'react';
import type { ReactElement, ReactNode, Ref } from 'react';

/**
 * Lightweight windowing wrapper for large player result sets.
 *
 * Renders only the rows near the viewport instead of the entire filtered
 * list, avoiding the slow initial render / janky scroll seen with hundreds
 * of player cards. No external dependency required — swap in for a direct
 * `.map()` render wherever the full player grid is mounted.
 *
 * This hook uses a fixed row height for windowing math. For variable-height
 * rows, see `VirtualizedPlayerGrid` which measures actual row heights via
 * ResizeObserver.
 */
export function useVirtualizedRows<T>({
  items,
  rowHeight,
  overscan = 5,
}: {
  items: T[];
  rowHeight: number;
  overscan?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => setScrollTop(el.scrollTop);
    setViewportHeight(el.clientHeight);
    el.addEventListener('scroll', onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      setViewportHeight(el.clientHeight);
    });
    resizeObserver.observe(el);

    return () => {
      el.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
    };
  }, []);

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
  );

  return {
    containerRef,
    visibleItems: items.slice(startIndex, endIndex),
    startIndex,
    endIndex,
    topSpacerHeight: startIndex * rowHeight,
    bottomSpacerHeight: Math.max(0, (items.length - endIndex) * rowHeight),
    totalHeight: items.length * rowHeight,
  };
}

// ── Variable-height grid virtualization ──────────────────────────────────────
//
// The scout results grid uses responsive CSS columns (1/2/3 by breakpoint)
// with variable-height PlayerCards (height varies based on badge count,
// watchlist state, name length). Fixed-row-height windowing produces
// incorrect spacer heights and potential row overlap when actual heights
// differ from the estimate.
//
// This module measures actual row heights via ResizeObserver after each
// render of visible rows, then uses prefix sums of measured heights for
// accurate spacer calculations and a binary search to find the visible
// row range in O(log n) per scroll event.

/** Tailwind breakpoints mirrored here: `sm` = 640px, `lg` = 1024px. */
const COLUMN_BREAKPOINTS: Array<{ minWidth: number; columns: number }> = [
  { minWidth: 1024, columns: 3 },
  { minWidth: 640, columns: 2 },
];

/**
 * Tracks how many grid columns are currently rendered, mirroring the
 * `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` breakpoints used elsewhere in
 * this codebase for the same player grid, so virtualized rows line up with
 * what CSS actually renders.
 */
function useResponsiveColumns(): number {
  const [columns, setColumns] = useState(1);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const queries = COLUMN_BREAKPOINTS.map(({ minWidth, columns: c }) => ({
      columns: c,
      mql: window.matchMedia(`(min-width: ${minWidth}px)`),
    }));

    const update = () => {
      const match = queries.find((q) => q.mql.matches);
      setColumns(match ? match.columns : 1);
    };
    update();

    queries.forEach(({ mql }) => mql.addEventListener('change', update));
    return () => {
      queries.forEach(({ mql }) => mql.removeEventListener('change', update));
    };
  }, []);

  return columns;
}

function chunkIntoRows<T>(items: T[], columns: number): T[][] {
  const size = Math.max(1, columns);
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

export interface VirtualizedPlayerGridHandle {
  /**
   * Scrolls so the item at `itemIndex` (0-based, into the flat item array
   * passed to `items`) is at the top of the viewport. Used by keyboard
   * pagination (`goToPage`/Previous/Next) to jump directly to a page
   * without requiring the user to scroll.
   */
  scrollToItemIndex: (itemIndex: number) => void;
}

export interface VirtualizedPlayerGridProps<T> {
  items: T[];
  /** Stable React key for an item, e.g. `(player) => player.id`. */
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** Estimated row height used before measurement. Default PLAYER_GRID_ROW_HEIGHT. */
  estimatedRowHeight?: number;
  overscan?: number;
  /** CSS height of the scrollable viewport. Default `'70vh'`. */
  height?: string;
  className?: string;
  'data-testid'?: string;
  /**
   * Called once each time the user scrolls within `endReachedThresholdPx`
   * of the bottom while `hasMore` is true — the infinite-scroll hook point
   * for cursor-paginated results (issue #1298). Guarded by an internal
   * latch so a parked-at-bottom scroll handler doesn't re-fire it every
   * tick; the latch re-arms when new items grow the scroll height or the
   * user scrolls back up.
   */
  onEndReached?: () => void;
  /** Whether more pages exist. `onEndReached` is never called when false. */
  hasMore?: boolean;
  /** How many px from the bottom triggers onEndReached. Default 240. */
  endReachedThresholdPx?: number;
}

/**
 * Estimated height (px) of one grid row before ResizeObserver measures it.
 * Used as the initial spacer height and as a fallback for rows that haven't
 * been measured yet. PlayerCard's content (avatar, name, position/region,
 * badges, progress bar, "View Profile" button) is fairly uniform in height
 * across players, so this estimate is close to actual for most rows.
 */
export const PLAYER_GRID_ROW_HEIGHT = 316;

/**
 * Stated DOM bound: the grid will never mount more than this many PlayerCards
 * simultaneously, regardless of viewport size or result-set size. With 3
 * columns and a typical 1080p viewport (~700px visible at 70vh), we see
 * ~2-3 rows (6-9 cards) plus overscan — well under 60. Even on an
 * unusually tall 4K viewport with 3 columns, the bound holds.
 */
export const MAX_MOUNTED_CARDS = 60;

/**
 * Binary search: find the first index where prefixSums[idx] > target.
 * Returns array length if no such index exists.
 */
function lowerBound(prefixSums: number[], target: number): number {
  let lo = 0;
  let hi = prefixSums.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (prefixSums[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function VirtualizedPlayerGridInner<T>(
  {
    items,
    getKey,
    renderItem,
    estimatedRowHeight = PLAYER_GRID_ROW_HEIGHT,
    overscan = 2,
    height = '70vh',
    className,
    'data-testid': testId = 'player-grid',
    onEndReached,
    hasMore = false,
    endReachedThresholdPx = 240,
  }: VirtualizedPlayerGridProps<T>,
  ref: Ref<VirtualizedPlayerGridHandle>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const columns = useResponsiveColumns();
  const rows = useMemo(() => chunkIntoRows(items, columns), [items, columns]);

  // ── Scroll + viewport tracking ───────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => setScrollTop(el.scrollTop);
    setViewportHeight(el.clientHeight);
    el.addEventListener('scroll', onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      setViewportHeight(el.clientHeight);
    });
    resizeObserver.observe(el);

    return () => {
      el.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
    };
  }, []);

  // ── Row height measurement ──────────────────────────────────────────────
  // Maps row index → measured pixel height. Until a row is measured,
  // estimatedRowHeight is used as a fallback.

  const [measuredHeights, setMeasuredHeights] = useState<Map<number, number>>(
    new Map(),
  );
  const rowElementRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const getRowHeight = useCallback(
    (idx: number) => measuredHeights.get(idx) ?? estimatedRowHeight,
    [measuredHeights, estimatedRowHeight],
  );

  // ── Prefix sums for all rows ────────────────────────────────────────────

  const prefixSums = useMemo(() => {
    const sums = [0];
    for (let i = 0; i < rows.length; i++) {
      sums.push(sums[i] + getRowHeight(i));
    }
    return sums;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, getRowHeight]);

  const totalHeight = prefixSums[rows.length];

  // ── Visible row range via binary search ─────────────────────────────────

  const startIndex = useMemo(() => {
    const idx = lowerBound(prefixSums, scrollTop);
    return Math.max(0, idx - overscan);
  }, [prefixSums, scrollTop, overscan]);

  const endIndex = useMemo(() => {
    const idx = lowerBound(prefixSums, scrollTop + viewportHeight);
    return Math.min(rows.length, idx + overscan);
  }, [prefixSums, scrollTop, viewportHeight, overscan]);

  const visibleRows = rows.slice(startIndex, endIndex);
  const topSpacerHeight = prefixSums[startIndex];
  const bottomSpacerHeight = Math.max(0, totalHeight - prefixSums[endIndex]);

  // ── Infinite-scroll end detection (issue #1298) ────────────────────────────
  // Fires onEndReached at most once per "arrival" at the bottom: the latch
  // blocks repeat calls while the user sits at the bottom (e.g. waiting for
  // a fetch), and re-arms when the scroll height grows (new page appended)
  // or the user scrolls away from the bottom.
  const endReachedLatchRef = useRef(false);

  useEffect(() => {
    if (!onEndReached || !hasMore || totalHeight <= 0) return;
    const reached =
      scrollTop + viewportHeight >= totalHeight - endReachedThresholdPx;
    if (reached) {
      if (!endReachedLatchRef.current) {
        endReachedLatchRef.current = true;
        onEndReached();
      }
    } else {
      endReachedLatchRef.current = false;
    }
  }, [
    onEndReached,
    hasMore,
    scrollTop,
    viewportHeight,
    totalHeight,
    endReachedThresholdPx,
    items.length,
  ]);

  // ── ResizeObserver: measure visible row heights after render ────────────

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      const updates = new Map<number, number>();
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        const rowIdx = Number(target.dataset.rowIndex);
        if (Number.isNaN(rowIdx)) continue;
        const h =
          entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        if (h > 0) updates.set(rowIdx, h);
      }
      if (updates.size > 0) {
        setMeasuredHeights((prev) => {
          const next = new Map(prev);
          updates.forEach((h, k) => {
            if (next.get(k) !== h) {
              next.set(k, h);
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      }
    });

    rowElementRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [visibleRows, startIndex]);

  // ── Imperative handle: scrollToItemIndex ────────────────────────────────

  useImperativeHandle(
    ref,
    () => ({
      scrollToItemIndex(itemIndex: number) {
        const el = containerRef.current;
        if (!el) return;
        const rowIndex = Math.floor(itemIndex / Math.max(1, columns));
        el.scrollTop = prefixSums[rowIndex] ?? rowIndex * estimatedRowHeight;
      },
    }),
    [columns, estimatedRowHeight, prefixSums, containerRef],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      data-testid={testId}
      className={`overflow-y-auto${className ? ` ${className}` : ''}`}
      style={{ height }}
    >
      <div style={{ height: topSpacerHeight }} aria-hidden="true" />
      {visibleRows.map((row, i) => {
        const rowIdx = startIndex + i;
        return (
          <div
            key={rowIdx}
            data-row-index={rowIdx}
            ref={(el) => {
              if (el) rowElementRefs.current.set(rowIdx, el);
              else rowElementRefs.current.delete(rowIdx);
            }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-6"
          >
            {row.map((item) => (
              <Fragment key={getKey(item)}>{renderItem(item)}</Fragment>
            ))}
          </div>
        );
      })}
      <div style={{ height: bottomSpacerHeight }} aria-hidden="true" />
    </div>
  );
}

/**
 * Windowed, grid-aware player list: only cards on/near the visible viewport
 * are mounted. Uses ResizeObserver to measure actual row heights for correct
 * spacer sizing when card heights vary (variable badge count, watchlist
 * state, name length). See the module-level comment above for why this
 * hand-rolls windowing instead of pulling in a general-purpose
 * grid-virtualization dependency.
 */
const VirtualizedPlayerGrid = forwardRef(VirtualizedPlayerGridInner) as <T>(
  props: VirtualizedPlayerGridProps<T> & {
    ref?: Ref<VirtualizedPlayerGridHandle>;
  },
) => ReactElement;

export default VirtualizedPlayerGrid;
