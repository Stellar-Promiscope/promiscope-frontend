import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// jsdom doesn't implement ResizeObserver; VirtualizedPlayerGrid's windowing
// hook (useVirtualizedRows) constructs one on mount to track viewport
// height. This suite isn't testing scroll/resize behavior itself, so a
// no-op stub is enough to avoid the ReferenceError.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = MockResizeObserver;

// jsdom always reports clientHeight 0 (it doesn't run layout), so
// VirtualizedPlayerGrid's viewport-derived visible window would otherwise
// only include a couple of rows regardless of how many players a test
// renders. Stub a realistic desktop viewport height so this suite's
// existing interaction tests (which click buttons on several players at
// once, e.g. multi-select compare) keep finding every player they render
// in the DOM, the same way they would in a real browser where the grid
// actually has room on screen. Dedicated virtualization/bounded-DOM
// behavior is covered separately in VirtualizedPlayerGrid.test.tsx.
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  value: 2000,
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

const DASHBOARD_WALLET =
  'GABC1234567890ABCDE1234567890ABCDE1234567890ABCDE123456';

jest.mock('@/hooks/useRequireWallet', () => ({
  useRequireWallet: () => ({
    walletAddress: DASHBOARD_WALLET,
  }),
}));

// useSubscription/useRequireSubscription (transitively, via
// useRequireSubscription -> useWallet -> useWalletContext) both need a real
// WalletProvider ancestor this suite doesn't render — mock useWallet
// directly instead.
jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({ publicKey: DASHBOARD_WALLET }),
}));

jest.mock('@/hooks/useRequireSubscription', () => ({
  useRequireSubscription: () => ({ isProtected: true, loading: false }),
}));

jest.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({
    subscription: { tier: 'pro', expiresAt: Date.now() + 1000 * 60 * 60 },
    isExpired: false,
    subscribe: jest.fn(),
    loading: false,
    error: null,
  }),
}));

const mockShowToast = jest.fn();
jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: mockShowToast }),
}));

// The real OnboardingTour renders a "Welcome to Scout Dashboard" heading and
// Previous/Next-step buttons on first visit (no dismissal recorded in
// jsdom's localStorage), which collide with this suite's own heading/button
// queries — mock it out since tour behavior isn't this suite's concern.
jest.mock('@/components/ui/OnboardingTour', () => ({
  __esModule: true,
  default: () => null,
}));

const mockSearch = jest.fn();
const mockSearchByName = jest.fn();
const mockUseScout = jest.fn();

jest.mock('@/hooks/useScout', () => ({
  useScout: () => mockUseScout(),
}));

const mockGetMilestoneHistoryBatch = jest.fn().mockResolvedValue({});
jest.mock('@/lib/contract', () => ({
  getPlayer: jest.fn(),
  getMilestoneHistoryBatch: (...args: unknown[]) =>
    mockGetMilestoneHistoryBatch(...args),
}));

const mockRouterReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
  useSearchParams: () => ({ get: () => null, toString: () => '' }),
}));

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<
      string,
      (params?: { count?: number }) => string
    > = {
      'scout_dashboard.no_players': () => 'No players found',
      'scout_dashboard.players_found': ({ count }: { count: number }) =>
        `${count} ${count === 1 ? 'player' : 'players'} found`,
    };
    const t = translations[key];
    return t ? t : (key: string) => key;
  },
}));

jest.mock('@/components/PlayerCard', () => ({
  __esModule: true,
  default: ({
    player,
    isWatched,
    onToggleWatchlist,
    isCompareSelected,
    onToggleCompare,
  }: {
    player: { id: string };
    isWatched?: boolean;
    onToggleWatchlist?: () => void;
    isCompareSelected?: boolean;
    onToggleCompare?: () => void;
  }) => (
    <div data-testid="player-card">
      {player.id}
      <button
        type="button"
        aria-label={`toggle-watch-${player.id}`}
        onClick={onToggleWatchlist}
      >
        {isWatched ? 'unwatch' : 'watch'}
      </button>
      <button
        type="button"
        aria-label={`toggle-compare-${player.id}`}
        onClick={onToggleCompare}
      >
        {isCompareSelected ? 'uncompare' : 'compare'}
      </button>
    </div>
  ),
}));

jest.mock('@/components/PlayerCardSkeleton', () => ({
  __esModule: true,
  default: () => <div data-testid="player-card-skeleton" />,
}));

// PlayerFilterForm mock:
//  • fires onSearch once on mount (mirrors the real component behaviour)
//  • re-fires onSearch when resetKey increments
jest.mock('@/components/scout/PlayerFilterForm', () => {
  const { useEffect, useRef } = require('react');
  return {
    __esModule: true,
    default: function MockPlayerFilterForm({
      onSearch,
      resetKey = 0,
      onSaveSearch,
    }: {
      onSearch: (f: object) => void;
      resetKey?: number;
      onSaveSearch?: (name: string, filter: object) => void;
    }) {
      const prevKey = useRef(resetKey);

      useEffect(() => {
        onSearch({});
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      useEffect(() => {
        if (prevKey.current === resetKey) return;
        prevKey.current = resetKey;
        onSearch({});
      }, [resetKey, onSearch]);

      return (
        <div data-testid="player-filter-form">
          <button type="button" onClick={() => onSaveSearch?.('My Search', {})}>
            Save Search
          </button>
        </div>
      );
    },
  };
});

// useWatchlist/useSavedSearches/useRecentlyViewed hit real SWR + fetch by
// default; mock them directly (mirrors the useScout pattern above) so tests
// can deterministically control entries and assert on add/remove/rename.
const mockWatchlistAdd = jest.fn();
const mockWatchlistRemove = jest.fn();
const mockUseWatchlist = jest.fn();
jest.mock('@/hooks/useWatchlist', () => ({
  useWatchlist: (...args: unknown[]) => mockUseWatchlist(...args),
}));

const mockSavedSearchesSave = jest.fn();
const mockSavedSearchesRename = jest.fn();
const mockSavedSearchesRemove = jest.fn();
const mockSavedSearchesMarkViewed = jest.fn();
const mockUseSavedSearches = jest.fn();
const mockUseSavedSearchNewCount = jest.fn();
jest.mock('@/hooks/useSavedSearches', () => ({
  useSavedSearches: (...args: unknown[]) => mockUseSavedSearches(...args),
  useSavedSearchNewCount: (...args: unknown[]) =>
    mockUseSavedSearchNewCount(...args),
}));

const mockUseRecentlyViewed = jest.fn();
jest.mock('@/hooks/useRecentlyViewed', () => ({
  useRecentlyViewed: () => mockUseRecentlyViewed(),
}));

// ── Import the component under test (after mocks) ────────────────────────────

import ScoutDashboardContent from '@/components/scout/ScoutDashboardContent';
import { getPlayer } from '@/lib/contract';

const mockGetPlayer = getPlayer as jest.Mock;

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMPTY_SCOUT = {
  players: [],
  // Server-side match count from the indexer (issue #1298). The results
  // header renders this rather than `players.length`, because `players`
  // only holds the pages fetched so far while `total` counts every match.
  total: 0,
  loading: false,
  error: null,
  isRateLimited: false,
  retryAfterSec: null,
  hasNextPage: false,
  loadMore: jest.fn(),
  searchId: 0,
  search: mockSearch,
  searchByName: mockSearchByName,
  refetch: jest.fn(),
};

type ScoutState = typeof EMPTY_SCOUT;

function setupScout(overrides: Partial<ScoutState> = {}) {
  mockUseScout.mockReturnValue({ ...EMPTY_SCOUT, ...overrides });
}

// ── Default state for the watchlist / saved-searches / recently-viewed
// hooks. Individual tests override via mockUseWatchlist.mockReturnValue(...)
// etc; this global beforeEach restores sane empty defaults before every
// test in the file (jest.clearAllMocks() in local beforeEach hooks clears
// call counts but NOT a previously-set mockReturnValue, so without this the
// override from one test could leak into the next).
beforeEach(() => {
  mockUseWatchlist.mockReturnValue({
    entries: [],
    loading: false,
    error: null,
    isWatched: () => false,
    add: mockWatchlistAdd,
    remove: mockWatchlistRemove,
  });
  mockUseSavedSearches.mockReturnValue({
    searches: [],
    loading: false,
    error: null,
    save: mockSavedSearchesSave,
    rename: mockSavedSearchesRename,
    remove: mockSavedSearchesRemove,
    markViewed: mockSavedSearchesMarkViewed,
  });
  mockUseSavedSearchNewCount.mockReturnValue(0);
  mockUseRecentlyViewed.mockReturnValue({ entries: [], record: jest.fn() });
});

function makePlayer(id: string) {
  return {
    id,
    wallet: `G${'A'.repeat(55)}`,
    vitals: {
      name: `Player ${id}`,
      age: 20,
      position: 'ST',
      region: 'NG',
      nationality: 'Nigerian',
    },
    ipfsHash: '',
    progressLevel: 0 as const,
    milestones: [],
    createdAt: 0,
  };
}

/**
 * Advance the mock through a full loading cycle: idle → loading → done.
 */
function simulateSearchCycle(
  rerender: (ui: React.ReactElement) => void,
  resultPlayers: ScoutState['players'] = [],
) {
  act(() => {
    mockUseScout.mockReturnValue({ ...EMPTY_SCOUT, loading: true });
    rerender(<ScoutDashboardContent />);
  });
  act(() => {
    mockUseScout.mockReturnValue({
      ...EMPTY_SCOUT,
      loading: false,
      players: resultPlayers,
      // A single page holds every match in these tests, so the indexer's
      // `total` equals the number of rows returned.
      total: resultPlayers.length,
    });
    rerender(<ScoutDashboardContent />);
  });
}

// ── Test suites ───────────────────────────────────────────────────────────────

describe('ScoutDashboardContent — initial render', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupScout();
  });

  it('renders the Scout Dashboard heading', () => {
    render(<ScoutDashboardContent />);
    expect(
      screen.getByRole('heading', { name: /scout dashboard/i }),
    ).toBeInTheDocument();
  });

  it('renders the wallet address search input', () => {
    render(<ScoutDashboardContent />);
    expect(
      screen.getByLabelText(/search by wallet address/i),
    ).toBeInTheDocument();
  });

  it('renders the PlayerFilterForm', () => {
    render(<ScoutDashboardContent />);
    expect(screen.getByTestId('player-filter-form')).toBeInTheDocument();
  });

  it('renders the filter form wrapper with data-testid', () => {
    render(<ScoutDashboardContent />);
    expect(screen.getByTestId('filter-form')).toBeInTheDocument();
  });
});

// ── Loading / skeleton state ──────────────────────────────────────────────────

describe('ScoutDashboardContent — loading state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading skeletons while a search is in progress for the first time', () => {
    setupScout({ loading: true });
    render(<ScoutDashboardContent />);
    expect(
      screen.getAllByTestId('player-card-skeleton').length,
    ).toBeGreaterThan(0);
  });

  it('does not show the empty state while loading', () => {
    setupScout({ loading: true });
    render(<ScoutDashboardContent />);
    expect(screen.queryByText('No players found')).not.toBeInTheDocument();
  });

  it('does not show player cards while loading', () => {
    setupScout({ loading: true });
    render(<ScoutDashboardContent />);
    expect(screen.queryByTestId('player-card')).not.toBeInTheDocument();
  });
});

// ── Empty state ───────────────────────────────────────────────────────────────

describe('ScoutDashboardContent — empty state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupScout();
  });

  it('does not show the empty state on initial render before any search completes', () => {
    render(<ScoutDashboardContent />);
    expect(screen.queryByText('No players found')).not.toBeInTheDocument();
  });

  it('shows the empty state after a search completes with zero results', () => {
    const { rerender } = render(<ScoutDashboardContent />);
    simulateSearchCycle(rerender, []);
    expect(screen.getByText('No players found')).toBeInTheDocument();
  });

  it('renders the empty state container with data-testid', () => {
    const { rerender } = render(<ScoutDashboardContent />);
    simulateSearchCycle(rerender, []);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });

  it('renders the descriptive subtext in the empty state', () => {
    const { rerender } = render(<ScoutDashboardContent />);
    simulateSearchCycle(rerender, []);
    expect(screen.getByText('Try adjusting your filters.')).toBeInTheDocument();
  });

  it('renders a "Reset Filters" button inside the empty state', () => {
    const { rerender } = render(<ScoutDashboardContent />);
    simulateSearchCycle(rerender, []);
    expect(
      screen.getByRole('button', { name: /reset filters/i }),
    ).toBeInTheDocument();
  });

  it('hides the empty state while a subsequent search runs after it was shown', () => {
    const { rerender } = render(<ScoutDashboardContent />);
    simulateSearchCycle(rerender, []);
    expect(screen.getByText('No players found')).toBeInTheDocument();

    act(() => {
      mockUseScout.mockReturnValue({
        ...EMPTY_SCOUT,
        loading: true,
        players: [],
      });
      rerender(<ScoutDashboardContent />);
    });
    expect(screen.queryByText('No players found')).not.toBeInTheDocument();
  });
});

// ── Filter / search interactions ──────────────────────────────────────────────

describe('ScoutDashboardContent — filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupScout();
  });

  it('calls search when PlayerFilterForm fires onSearch', () => {
    render(<ScoutDashboardContent />);
    // The mock PlayerFilterForm fires onSearch once on mount
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it('clicking "Reset Filters" triggers a new search with defaults', () => {
    const { rerender } = render(<ScoutDashboardContent />);
    simulateSearchCycle(rerender, []);

    mockSearch.mockClear();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /reset filters/i }));
    });

    // PlayerFilterForm resets and calls onSearch once
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it('hides the empty state after "Reset Filters" triggers a new loading cycle', () => {
    const { rerender } = render(<ScoutDashboardContent />);
    simulateSearchCycle(rerender, []);
    expect(screen.getByText('No players found')).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /reset filters/i }));
    });

    act(() => {
      mockUseScout.mockReturnValue({ ...EMPTY_SCOUT, loading: true });
      rerender(<ScoutDashboardContent />);
    });
    expect(screen.queryByText('No players found')).not.toBeInTheDocument();
  });
});

// ── Results grid and player cards ─────────────────────────────────────────────

describe('ScoutDashboardContent — results', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupScout();
  });

  it('renders player cards when search returns results', () => {
    const { rerender } = render(<ScoutDashboardContent />);
    simulateSearchCycle(rerender, [makePlayer('p1'), makePlayer('p2')]);
    expect(screen.getAllByTestId('player-card')).toHaveLength(2);
  });

  it('does not show the empty state when the search returns players', () => {
    const { rerender } = render(<ScoutDashboardContent />);
    simulateSearchCycle(rerender, [makePlayer('p1')]);
    expect(screen.queryByText('No players found')).not.toBeInTheDocument();
  });

  it('shows a result count when players are returned', () => {
    const { rerender } = render(<ScoutDashboardContent />);
    simulateSearchCycle(rerender, [makePlayer('p1'), makePlayer('p2')]);
    expect(screen.getByText(/2 players found/i)).toBeInTheDocument();
  });

  it('uses singular "player" in count when exactly one result is returned', () => {
    const { rerender } = render(<ScoutDashboardContent />);
    simulateSearchCycle(rerender, [makePlayer('p1')]);
    expect(screen.getByText(/1 player found/i)).toBeInTheDocument();
  });
});

// ── Milestone batching (issue #781) ───────────────────────────────────────────
//
// The results grid must fetch milestone data once for the whole result
// set, not once per rendered PlayerCard — this is the fix for the N+1 RPC
// fan-out the old per-card SWR call caused.

describe('ScoutDashboardContent — milestone batching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMilestoneHistoryBatch.mockResolvedValue({});
    setupScout();
  });

  it('fetches milestone data once for a batch of players, not once per card', async () => {
    const manyPlayers = Array.from({ length: 30 }, (_, i) =>
      makePlayer(`p${i}`),
    );
    const { rerender } = render(<ScoutDashboardContent />);

    await act(async () => {
      simulateSearchCycle(rerender, manyPlayers);
      await Promise.resolve();
    });

    expect(mockGetMilestoneHistoryBatch).toHaveBeenCalledTimes(1);
    expect(mockGetMilestoneHistoryBatch).toHaveBeenCalledWith(
      manyPlayers.map((p) => p.id),
    );
  });

  it('does not re-fetch milestones on a re-render with the same result set', async () => {
    const players = Array.from({ length: 5 }, (_, i) => makePlayer(`p${i}`));
    const { rerender } = render(<ScoutDashboardContent />);

    await act(async () => {
      simulateSearchCycle(rerender, players);
      await Promise.resolve();
    });
    expect(mockGetMilestoneHistoryBatch).toHaveBeenCalledTimes(1);

    // Re-render without changing the underlying result set.
    await act(async () => {
      rerender(<ScoutDashboardContent />);
      await Promise.resolve();
    });
    expect(mockGetMilestoneHistoryBatch).toHaveBeenCalledTimes(1);
  });
});

// ── Pagination ────────────────────────────────────────────────────────────────

describe('ScoutDashboardContent — pagination', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupScout();
  });

  it('does not render pagination controls when results fit on one page', () => {
    const { rerender } = render(<ScoutDashboardContent />);
    simulateSearchCycle(
      rerender,
      Array.from({ length: 5 }, (_, i) => makePlayer(`p${i}`)),
    );
    expect(
      screen.queryByRole('button', { name: /previous/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /next/i }),
    ).not.toBeInTheDocument();
  });

  it('renders pagination controls when results exceed one page (>12 items)', () => {
    const manyPlayers = Array.from({ length: 13 }, (_, i) =>
      makePlayer(`p${i}`),
    );
    const { rerender } = render(<ScoutDashboardContent />);
    simulateSearchCycle(rerender, manyPlayers);
    expect(screen.getByTestId('pagination-prev')).toBeInTheDocument();
    expect(screen.getByTestId('pagination-next')).toBeInTheDocument();
  });

  it('Previous button is disabled on the first page', () => {
    const manyPlayers = Array.from({ length: 13 }, (_, i) =>
      makePlayer(`p${i}`),
    );
    const { rerender } = render(<ScoutDashboardContent />);
    simulateSearchCycle(rerender, manyPlayers);
    expect(screen.getByTestId('pagination-prev')).toBeDisabled();
  });
});

// ── Wallet address search ─────────────────────────────────────────────────────

describe('ScoutDashboardContent — wallet address search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupScout();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('shows an invalid address message for a malformed wallet key', () => {
    render(<ScoutDashboardContent />);
    const input = screen.getByLabelText(/search by wallet address/i);
    fireEvent.change(input, { target: { value: 'not-a-key' } });
    expect(screen.getByText(/invalid stellar address/i)).toBeInTheDocument();
  });

  it('shows "Searching…" while a valid wallet lookup is in-flight', async () => {
    mockGetPlayer.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ScoutDashboardContent />);
    const input = screen.getByLabelText(/search by wallet address/i);
    // A valid 56-char Stellar key
    const validKey = `G${'A'.repeat(55)}`;
    fireEvent.change(input, { target: { value: validKey } });

    // Advance past the 300 ms debounce
    act(() => {
      jest.advanceTimersByTime(350);
    });

    expect(screen.getByText(/searching/i)).toBeInTheDocument();
  });

  it('shows a not-found empty state when wallet lookup returns null', async () => {
    mockGetPlayer.mockResolvedValue(null);
    render(<ScoutDashboardContent />);
    const input = screen.getByLabelText(/search by wallet address/i);
    const validKey = `G${'A'.repeat(55)}`;
    fireEvent.change(input, { target: { value: validKey } });

    await act(async () => {
      jest.advanceTimersByTime(350);
      await Promise.resolve();
    });

    expect(screen.getByText(/no player is registered/i)).toBeInTheDocument();
  });

  it('treats a rejected wallet lookup as not-found', async () => {
    mockGetPlayer.mockRejectedValue(new Error('rpc failure'));
    render(<ScoutDashboardContent />);
    const input = screen.getByLabelText(/search by wallet address/i);
    const validKey = `G${'A'.repeat(55)}`;
    fireEvent.change(input, { target: { value: validKey } });

    await act(async () => {
      jest.advanceTimersByTime(350);
      await Promise.resolve();
    });

    expect(screen.getByText(/no player is registered/i)).toBeInTheDocument();
  });

  it('clearing the wallet query hides any previous result', async () => {
    mockGetPlayer.mockResolvedValue(null);
    render(<ScoutDashboardContent />);
    const input = screen.getByLabelText(/search by wallet address/i);
    const validKey = `G${'A'.repeat(55)}`;
    fireEvent.change(input, { target: { value: validKey } });

    await act(async () => {
      jest.advanceTimersByTime(350);
      await Promise.resolve();
    });
    expect(screen.getByText(/no player is registered/i)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '' } });
    expect(
      screen.queryByText(/no player is registered/i),
    ).not.toBeInTheDocument();
  });

  it('renders a PlayerCard for a found wallet address and adds it to the watchlist', async () => {
    mockGetPlayer.mockResolvedValue(makePlayer('found1'));
    render(<ScoutDashboardContent />);
    const input = screen.getByLabelText(/search by wallet address/i);
    const validKey = `G${'A'.repeat(55)}`;
    fireEvent.change(input, { target: { value: validKey } });

    await act(async () => {
      jest.advanceTimersByTime(350);
      await Promise.resolve();
    });

    expect(screen.getByText('found1')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'toggle-watch-found1' }),
    );
    expect(mockWatchlistAdd).toHaveBeenCalledWith('found1');
  });

  it('removes an already-watched player found via wallet search', async () => {
    mockUseWatchlist.mockReturnValue({
      entries: [
        {
          id: 1,
          scoutWallet: DASHBOARD_WALLET,
          playerId: 'found1',
          createdAt: 0,
        },
      ],
      loading: false,
      error: null,
      isWatched: (id: string) => id === 'found1',
      add: mockWatchlistAdd,
      remove: mockWatchlistRemove,
    });
    mockGetPlayer.mockResolvedValue(makePlayer('found1'));
    render(<ScoutDashboardContent />);
    const input = screen.getByLabelText(/search by wallet address/i);
    const validKey = `G${'A'.repeat(55)}`;
    fireEvent.change(input, { target: { value: validKey } });

    await act(async () => {
      jest.advanceTimersByTime(350);
      await Promise.resolve();
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'toggle-watch-found1' }),
    );
    expect(mockWatchlistRemove).toHaveBeenCalledWith({
      id: 1,
      scoutWallet: DASHBOARD_WALLET,
      playerId: 'found1',
      createdAt: 0,
    });
  });

  it('toggles compare selection for a player found via wallet search', async () => {
    mockGetPlayer.mockResolvedValue(makePlayer('found1'));
    render(<ScoutDashboardContent />);
    const input = screen.getByLabelText(/search by wallet address/i);
    const validKey = `G${'A'.repeat(55)}`;
    fireEvent.change(input, { target: { value: validKey } });

    await act(async () => {
      jest.advanceTimersByTime(350);
      await Promise.resolve();
    });

    const compareBtn = screen.getByRole('button', {
      name: 'toggle-compare-found1',
    });
    expect(compareBtn).toHaveTextContent('compare');
    fireEvent.click(compareBtn);
    expect(
      screen.getByRole('button', { name: 'toggle-compare-found1' }),
    ).toHaveTextContent('uncompare');
  });
});

// ── Rate-limit toast ──────────────────────────────────────────────────────────

describe('ScoutDashboardContent — rate limit toast', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a toast with the retry-after seconds when rate limited', () => {
    setupScout({ isRateLimited: true, retryAfterSec: 5 });
    render(<ScoutDashboardContent />);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'warning',
        message: expect.stringContaining('5s'),
      }),
    );
  });

  it('shows a generic slow-down toast when retryAfterSec is not provided', () => {
    setupScout({ isRateLimited: true, retryAfterSec: null });
    render(<ScoutDashboardContent />);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'warning',
        message: expect.stringContaining('slow down'),
      }),
    );
  });

  it('does not show a rate-limit toast when not rate limited', () => {
    setupScout({ isRateLimited: false });
    render(<ScoutDashboardContent />);
    expect(mockShowToast).not.toHaveBeenCalled();
  });
});

// ── Keyboard pagination navigation ────────────────────────────────────────────

describe('ScoutDashboardContent — pagination navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupScout();
  });

  it('clicking Next advances to page 2 and updates the URL', () => {
    const manyPlayers = Array.from({ length: 13 }, (_, i) =>
      makePlayer(`p${i}`),
    );
    const { rerender } = render(<ScoutDashboardContent />);
    simulateSearchCycle(rerender, manyPlayers);

    fireEvent.click(screen.getByTestId('pagination-next'));

    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(mockRouterReplace).toHaveBeenCalledWith('?page=2');
  });

  it('Next button is disabled on the last page', () => {
    const manyPlayers = Array.from({ length: 13 }, (_, i) =>
      makePlayer(`p${i}`),
    );
    const { rerender } = render(<ScoutDashboardContent />);
    simulateSearchCycle(rerender, manyPlayers);

    fireEvent.click(screen.getByTestId('pagination-next'));

    expect(screen.getByTestId('pagination-next')).toBeDisabled();
  });

  it('clicking Previous after advancing returns to page 1', () => {
    const manyPlayers = Array.from({ length: 13 }, (_, i) =>
      makePlayer(`p${i}`),
    );
    const { rerender } = render(<ScoutDashboardContent />);
    simulateSearchCycle(rerender, manyPlayers);

    fireEvent.click(screen.getByTestId('pagination-next'));
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('pagination-prev'));
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(mockRouterReplace).toHaveBeenLastCalledWith('?page=1');
  });
});

// ── Name search debouncing ────────────────────────────────────────────────────

describe('ScoutDashboardContent — name search debouncing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupScout();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('debounces the name query and calls searchByName once settled', () => {
    render(<ScoutDashboardContent />);
    const input = screen.getByLabelText(/search by player name/i);
    fireEvent.change(input, { target: { value: 'Amara' } });

    mockSearchByName.mockClear();
    act(() => {
      jest.advanceTimersByTime(350);
    });

    expect(mockSearchByName).toHaveBeenCalledWith('Amara');
  });

  it('calls searchByName with an empty string once the name query is cleared', () => {
    render(<ScoutDashboardContent />);
    const input = screen.getByLabelText(/search by player name/i);
    fireEvent.change(input, { target: { value: 'Amara' } });
    act(() => {
      jest.advanceTimersByTime(350);
    });

    mockSearchByName.mockClear();
    fireEvent.change(input, { target: { value: '' } });
    act(() => {
      jest.advanceTimersByTime(350);
    });

    expect(mockSearchByName).toHaveBeenCalledWith('');
  });
});

// ── Screen reader announcements (issue #553, #554) ─────────────────────────────

describe('ScoutDashboardContent — screen reader announcements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupScout();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('renders a visually hidden status region for announcements', () => {
    render(<ScoutDashboardContent />);
    const statusRegion = screen.getByRole('status');
    expect(statusRegion).toBeInTheDocument();
    expect(statusRegion).toHaveAttribute('aria-live', 'polite');
    expect(statusRegion).toHaveClass('sr-only');
  });

  it('search input has aria-controls pointing to the status region', () => {
    render(<ScoutDashboardContent />);
    const input = screen.getByLabelText(/search by player name/i);
    expect(input).toHaveAttribute('aria-controls', 'search-results');
  });

  it('search input has aria-expanded set correctly based on query state', () => {
    render(<ScoutDashboardContent />);
    const input = screen.getByLabelText(/search by player name/i);
    // Initially empty, so aria-expanded should be false
    expect(input).toHaveAttribute('aria-expanded', 'false');

    fireEvent.change(input, { target: { value: 'Amara' } });
    // After typing but before debounce settles, aria-expanded should be true
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });

  it('announces "No players found" after search completes with zero results', () => {
    const { rerender } = render(<ScoutDashboardContent />);
    const input = screen.getByLabelText(/search by player name/i);
    const statusRegion = screen.getByRole('status');

    fireEvent.change(input, { target: { value: 'Amara' } });
    act(() => {
      jest.advanceTimersByTime(350);
    });

    // Simulate search completing with no results
    act(() => {
      mockUseScout.mockReturnValue({
        ...EMPTY_SCOUT,
        loading: false,
        players: [],
      });
      rerender(<ScoutDashboardContent />);
    });

    expect(statusRegion).toHaveTextContent('No players found');
  });

  it('announces result count after search completes with results', () => {
    const { rerender } = render(<ScoutDashboardContent />);
    const input = screen.getByLabelText(/search by player name/i);
    const statusRegion = screen.getByRole('status');

    fireEvent.change(input, { target: { value: 'Amara' } });
    act(() => {
      jest.advanceTimersByTime(350);
    });

    // Simulate search completing with 3 results
    act(() => {
      mockUseScout.mockReturnValue({
        ...EMPTY_SCOUT,
        loading: false,
        players: [makePlayer('p1'), makePlayer('p2'), makePlayer('p3')],
      });
      rerender(<ScoutDashboardContent />);
    });

    expect(statusRegion).toHaveTextContent('3 players found');
  });

  it('uses singular form when exactly one result is returned', () => {
    const { rerender } = render(<ScoutDashboardContent />);
    const input = screen.getByLabelText(/search by player name/i);
    const statusRegion = screen.getByRole('status');

    fireEvent.change(input, { target: { value: 'Amara' } });
    act(() => {
      jest.advanceTimersByTime(350);
    });

    // Simulate search completing with 1 result
    act(() => {
      mockUseScout.mockReturnValue({
        ...EMPTY_SCOUT,
        loading: false,
        players: [makePlayer('p1')],
      });
      rerender(<ScoutDashboardContent />);
    });

    expect(statusRegion).toHaveTextContent('1 player found');
  });

  it('clears announcement when query is cleared', () => {
    const { rerender } = render(<ScoutDashboardContent />);
    const input = screen.getByLabelText(/search by player name/i);
    const statusRegion = screen.getByRole('status');

    fireEvent.change(input, { target: { value: 'Amara' } });
    act(() => {
      jest.advanceTimersByTime(350);
    });

    // Simulate search completing with results
    act(() => {
      mockUseScout.mockReturnValue({
        ...EMPTY_SCOUT,
        loading: false,
        players: [makePlayer('p1')],
      });
      rerender(<ScoutDashboardContent />);
    });

    expect(statusRegion).toHaveTextContent('1 player found');

    // Clear the query
    fireEvent.change(input, { target: { value: '' } });
    act(() => {
      jest.advanceTimersByTime(350);
    });

    expect(statusRegion).toHaveTextContent('');
  });
});

// ── Compare selection (results grid) ──────────────────────────────────────────

describe('ScoutDashboardContent — compare selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupScout();
  });

  function renderWithPlayers(count: number) {
    const players = Array.from({ length: count }, (_, i) =>
      makePlayer(`p${i}`),
    );
    const { rerender } = render(<ScoutDashboardContent />);
    simulateSearchCycle(rerender, players);
  }

  it('selecting two players shows the compare bar with a count', () => {
    renderWithPlayers(3);
    fireEvent.click(screen.getByRole('button', { name: 'toggle-compare-p0' }));
    fireEvent.click(screen.getByRole('button', { name: 'toggle-compare-p1' }));

    expect(
      screen.getByText(/2 players selected for comparison/i),
    ).toBeInTheDocument();
  });

  it('does not show the compare bar when only one player is selected', () => {
    renderWithPlayers(3);
    fireEvent.click(screen.getByRole('button', { name: 'toggle-compare-p0' }));
    // Only one selected — the compare bar itself is not shown yet.
    expect(
      screen.queryByText(/selected for comparison/i),
    ).not.toBeInTheDocument();
  });

  it('the Compare link includes the selected player ids', () => {
    renderWithPlayers(3);
    fireEvent.click(screen.getByRole('button', { name: 'toggle-compare-p0' }));
    fireEvent.click(screen.getByRole('button', { name: 'toggle-compare-p1' }));

    expect(screen.getByRole('link', { name: /compare/i })).toHaveAttribute(
      'href',
      '/scout/compare?ids=p0,p1',
    );
  });

  it('stores the selected comparison ids in the URL query string', () => {
    renderWithPlayers(3);
    fireEvent.click(screen.getByRole('button', { name: 'toggle-compare-p0' }));
    fireEvent.click(screen.getByRole('button', { name: 'toggle-compare-p1' }));

    expect(mockRouterReplace).toHaveBeenLastCalledWith('?ids=p0,p1');
  });

  it('clicking Clear resets the compare selection and hides the bar', () => {
    renderWithPlayers(3);
    fireEvent.click(screen.getByRole('button', { name: 'toggle-compare-p0' }));
    fireEvent.click(screen.getByRole('button', { name: 'toggle-compare-p1' }));
    expect(
      screen.getByText(/2 players selected for comparison/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(
      screen.queryByText(/selected for comparison/i),
    ).not.toBeInTheDocument();
  });

  it('clicking an already-selected player removes it from the comparison', () => {
    renderWithPlayers(3);
    fireEvent.click(screen.getByRole('button', { name: 'toggle-compare-p0' }));
    fireEvent.click(screen.getByRole('button', { name: 'toggle-compare-p1' }));
    fireEvent.click(screen.getByRole('button', { name: 'toggle-compare-p2' }));
    expect(
      screen.getByText(/3 players selected for comparison/i),
    ).toBeInTheDocument();

    // Deselect p1 — back down to 2.
    fireEvent.click(screen.getByRole('button', { name: 'toggle-compare-p1' }));
    expect(
      screen.getByText(/2 players selected for comparison/i),
    ).toBeInTheDocument();
  });

  it('shows a toast and stops adding once 4 players are already selected', () => {
    renderWithPlayers(5);
    fireEvent.click(screen.getByRole('button', { name: 'toggle-compare-p0' }));
    fireEvent.click(screen.getByRole('button', { name: 'toggle-compare-p1' }));
    fireEvent.click(screen.getByRole('button', { name: 'toggle-compare-p2' }));
    fireEvent.click(screen.getByRole('button', { name: 'toggle-compare-p3' }));
    expect(
      screen.getByText(/4 players selected for comparison/i),
    ).toBeInTheDocument();

    mockShowToast.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'toggle-compare-p4' }));

    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'Maximum 4 players for comparison',
      variant: 'info',
    });
    // Still capped at 4 — the 5th player was not added.
    expect(
      screen.getByText(/4 players selected for comparison/i),
    ).toBeInTheDocument();
  });
});

// ── Watchlist toggle (results grid) ───────────────────────────────────────────

describe('ScoutDashboardContent — watchlist toggle in results grid', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupScout();
  });

  it('adds a player to the watchlist when not already watched', () => {
    const { rerender } = render(<ScoutDashboardContent />);
    simulateSearchCycle(rerender, [makePlayer('p0')]);

    fireEvent.click(screen.getByRole('button', { name: 'toggle-watch-p0' }));
    expect(mockWatchlistAdd).toHaveBeenCalledWith('p0');
  });

  it('removes a player from the watchlist when already watched', () => {
    mockUseWatchlist.mockReturnValue({
      entries: [
        { id: 9, scoutWallet: DASHBOARD_WALLET, playerId: 'p0', createdAt: 0 },
      ],
      loading: false,
      error: null,
      isWatched: (id: string) => id === 'p0',
      add: mockWatchlistAdd,
      remove: mockWatchlistRemove,
    });
    const { rerender } = render(<ScoutDashboardContent />);
    simulateSearchCycle(rerender, [makePlayer('p0')]);

    fireEvent.click(screen.getByRole('button', { name: 'toggle-watch-p0' }));
    expect(mockWatchlistRemove).toHaveBeenCalledWith({
      id: 9,
      scoutWallet: DASHBOARD_WALLET,
      playerId: 'p0',
      createdAt: 0,
    });
  });
});

// ── Watchlist / Recently Viewed / Saved Searches panels ───────────────────────

describe('ScoutDashboardContent — dashboard panels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupScout();
  });

  it('renders the My Watchlist panel with a View all link when entries exist', () => {
    mockUseWatchlist.mockReturnValue({
      entries: [
        { id: 1, scoutWallet: DASHBOARD_WALLET, playerId: 'w1', createdAt: 0 },
      ],
      loading: false,
      error: null,
      isWatched: () => true,
      add: mockWatchlistAdd,
      remove: mockWatchlistRemove,
    });
    render(<ScoutDashboardContent />);

    expect(screen.getByText('My Watchlist')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view all/i })).toHaveAttribute(
      'href',
      '/scout/watchlist',
    );
    expect(screen.getByRole('link', { name: 'w1' })).toBeInTheDocument();
  });

  it('removes a watchlist entry when its Remove button is clicked', () => {
    const entry = {
      id: 1,
      scoutWallet: DASHBOARD_WALLET,
      playerId: 'w1',
      createdAt: 0,
    };
    mockUseWatchlist.mockReturnValue({
      entries: [entry],
      loading: false,
      error: null,
      isWatched: () => true,
      add: mockWatchlistAdd,
      remove: mockWatchlistRemove,
    });
    render(<ScoutDashboardContent />);

    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    expect(mockWatchlistRemove).toHaveBeenCalledWith(entry);
  });

  it('does not render the My Watchlist panel when there are no entries', () => {
    render(<ScoutDashboardContent />);
    expect(screen.queryByText('My Watchlist')).not.toBeInTheDocument();
  });

  it('renders the Recently Viewed panel with entries', () => {
    mockUseRecentlyViewed.mockReturnValue({
      entries: [
        { playerId: 'r1', name: 'Runner One', position: 'GK', viewedAt: 0 },
      ],
      record: jest.fn(),
    });
    render(<ScoutDashboardContent />);

    expect(screen.getByText('Recently Viewed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Runner One' })).toHaveAttribute(
      'href',
      '/player/r1',
    );
    expect(screen.getByText('GK')).toBeInTheDocument();
  });

  it('does not render the Recently Viewed panel when there are no entries', () => {
    render(<ScoutDashboardContent />);
    expect(screen.queryByText('Recently Viewed')).not.toBeInTheDocument();
  });

  describe('saved searches', () => {
    const savedSearch = {
      id: 1,
      scoutWallet: DASHBOARD_WALLET,
      name: 'My Filter',
      filter: { position: 'ST' },
      createdAt: 0,
      lastViewedAt: 0,
    };

    beforeEach(() => {
      mockUseSavedSearches.mockReturnValue({
        searches: [savedSearch],
        loading: false,
        error: null,
        save: mockSavedSearchesSave,
        rename: mockSavedSearchesRename,
        remove: mockSavedSearchesRemove,
        markViewed: mockSavedSearchesMarkViewed,
      });
    });

    it('renders the Saved Searches panel', () => {
      render(<ScoutDashboardContent />);
      expect(screen.getByText('Saved Searches')).toBeInTheDocument();
      expect(screen.getByText('My Filter')).toBeInTheDocument();
    });

    it('applying a saved search triggers a new search with its filter and marks it viewed', () => {
      render(<ScoutDashboardContent />);
      mockSearch.mockClear();
      fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
      expect(mockSearch).toHaveBeenCalledWith(savedSearch.filter);
      expect(mockSavedSearchesMarkViewed).toHaveBeenCalledWith(savedSearch);
    });

    it('shows a "new" badge when new matches exist since last viewed', () => {
      mockUseSavedSearchNewCount.mockReturnValue(3);
      render(<ScoutDashboardContent />);
      expect(screen.getByText('3 new')).toBeInTheDocument();
    });

    it('does not show a badge when there are no new matches', () => {
      mockUseSavedSearchNewCount.mockReturnValue(0);
      render(<ScoutDashboardContent />);
      expect(screen.queryByText(/new$/)).not.toBeInTheDocument();
    });

    it('clicking Remove calls savedSearches.remove with the entry', () => {
      render(<ScoutDashboardContent />);
      fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
      expect(mockSavedSearchesRemove).toHaveBeenCalledWith(savedSearch);
    });

    it('clicking Rename shows an editable input pre-filled with the current name', () => {
      render(<ScoutDashboardContent />);
      fireEvent.click(screen.getByRole('button', { name: /^rename$/i }));
      expect(screen.getByDisplayValue('My Filter')).toBeInTheDocument();
    });

    it('pressing Enter while renaming saves the trimmed value', () => {
      render(<ScoutDashboardContent />);
      fireEvent.click(screen.getByRole('button', { name: /^rename$/i }));
      const editInput = screen.getByDisplayValue('My Filter');
      fireEvent.change(editInput, { target: { value: '  New Name  ' } });
      fireEvent.keyDown(editInput, { key: 'Enter' });

      expect(mockSavedSearchesRename).toHaveBeenCalledWith(1, 'New Name');
      expect(screen.queryByDisplayValue('New Name')).not.toBeInTheDocument();
    });

    it('pressing Enter with a blank value does not call rename', () => {
      render(<ScoutDashboardContent />);
      fireEvent.click(screen.getByRole('button', { name: /^rename$/i }));
      const editInput = screen.getByDisplayValue('My Filter');
      fireEvent.change(editInput, { target: { value: '   ' } });
      fireEvent.keyDown(editInput, { key: 'Enter' });

      expect(mockSavedSearchesRename).not.toHaveBeenCalled();
    });

    it('pressing Escape while renaming cancels without saving', () => {
      render(<ScoutDashboardContent />);
      fireEvent.click(screen.getByRole('button', { name: /^rename$/i }));
      const editInput = screen.getByDisplayValue('My Filter');
      fireEvent.change(editInput, { target: { value: 'Discarded' } });
      fireEvent.keyDown(editInput, { key: 'Escape' });

      expect(mockSavedSearchesRename).not.toHaveBeenCalled();
      expect(screen.queryByDisplayValue('Discarded')).not.toBeInTheDocument();
    });

    it('the Save button is disabled while the rename value is blank', () => {
      render(<ScoutDashboardContent />);
      fireEvent.click(screen.getByRole('button', { name: /^rename$/i }));
      const editInput = screen.getByDisplayValue('My Filter');
      fireEvent.change(editInput, { target: { value: '   ' } });

      expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    });

    it('clicking Save commits the trimmed rename', () => {
      render(<ScoutDashboardContent />);
      fireEvent.click(screen.getByRole('button', { name: /^rename$/i }));
      const editInput = screen.getByDisplayValue('My Filter');
      fireEvent.change(editInput, { target: { value: ' Renamed ' } });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

      expect(mockSavedSearchesRename).toHaveBeenCalledWith(1, 'Renamed');
    });

    it('clicking Cancel while renaming discards edits', () => {
      render(<ScoutDashboardContent />);
      fireEvent.click(screen.getByRole('button', { name: /^rename$/i }));
      const editInput = screen.getByDisplayValue('My Filter');
      fireEvent.change(editInput, { target: { value: 'Discarded' } });
      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

      expect(mockSavedSearchesRename).not.toHaveBeenCalled();
      expect(screen.queryByDisplayValue('Discarded')).not.toBeInTheDocument();
    });
  });

  it('does not render the Saved Searches panel when there are none', () => {
    render(<ScoutDashboardContent />);
    expect(screen.queryByText('Saved Searches')).not.toBeInTheDocument();
  });

  it('triggering onSaveSearch from the filter form calls savedSearches.save', () => {
    render(<ScoutDashboardContent />);
    fireEvent.click(screen.getByRole('button', { name: /save search/i }));
    expect(mockSavedSearchesSave).toHaveBeenCalledWith('My Search', {});
  });
});
