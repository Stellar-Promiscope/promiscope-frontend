import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// ── Globals ───────────────────────────────────────────────────────────────────

// jsdom does not implement ResizeObserver; VirtualizedPlayerGrid's windowing
// hook (useVirtualizedRows) constructs one on mount to track viewport
// height. Provide a no-op stub.
global.ResizeObserver = class {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
} as unknown as typeof ResizeObserver;

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/hooks/useRequireWallet', () => ({
  useRequireWallet: () => ({
    walletAddress: 'GABC1234567890ABCDE1234567890ABCDE1234567890ABCDE123456',
  }),
}));

// ReferralPanel (rendered inside ScoutDashboardContent) reads the connected
// wallet directly via useWallet(), which needs a WalletProvider ancestor —
// mock it the same way useRequireWallet is mocked above.
jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({
    publicKey: 'GABC1234567890ABCDE1234567890ABCDE1234567890ABCDE123456',
  }),
}));

jest.mock('@/hooks/useRequireSubscription', () => ({
  useRequireSubscription: jest
    .fn()
    .mockReturnValue({ isProtected: true, loading: false }),
}));

const mockSearch = jest.fn();
const mockUseScout = jest.fn();

jest.mock('@/hooks/useScout', () => ({
  useScout: () => mockUseScout(),
}));

jest.mock('@/lib/contract', () => ({
  getPlayer: jest.fn(),
  getMilestoneHistoryBatch: jest.fn().mockResolvedValue({}),
}));

// Discovery reads the indexer now (issue #1298); the dashboard polls
// /health for the ledger-lag hint — stub it so no real request is attempted.
jest.mock('@/lib/indexerClient', () => ({
  fetchIndexerHealth: jest.fn().mockResolvedValue({
    status: 'ok',
    lastLedger: 100,
    ledgerLag: 0,
    pollerRunning: true,
    uptime: 1,
  }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => ({ get: () => null, toString: () => '' }),
}));

// Minimal PlayerCard — just renders the player id so we can assert on results.
jest.mock('@/components/PlayerCard', () => ({
  __esModule: true,
  default: ({ player }: { player: { id: string } }) => (
    <div data-testid="player-card">{player.id}</div>
  ),
}));

jest.mock('@/components/PlayerCardSkeleton', () => ({
  __esModule: true,
  default: () => <div data-testid="player-card-skeleton" />,
}));

// PlayerFilterForm mock that:
//  • fires onSearch once on mount (mirrors the real component)
//  • calls onSearch with defaults again whenever resetKey increments
jest.mock('@/components/scout/PlayerFilterForm', () => {
  const { useEffect, useRef } = require('react');
  return {
    __esModule: true,
    default: function MockPlayerFilterForm({
      onSearch,
      resetKey = 0,
    }: {
      onSearch: (f: object) => void;
      resetKey?: number;
    }) {
      const prevKey = useRef(resetKey);

      // Initial search on mount
      useEffect(() => {
        onSearch({});
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      // Reset when resetKey changes
      useEffect(() => {
        if (prevKey.current === resetKey) return;
        prevKey.current = resetKey;
        onSearch({});
      }, [resetKey, onSearch]);

      return <div data-testid="player-filter-form" />;
    },
  };
});

jest.mock('@/hooks/useSubscription', () => ({
  useSubscription: jest.fn().mockReturnValue({
    subscription: null,
    isLoading: false,
    error: null,
    writeLoading: false,
    writeError: null,
    subscribe: jest.fn(),
  }),
}));

// ErrorBoundary is a transparent pass-through for these tests.
jest.mock('@/components/ui/ErrorBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// useWatchlist/useSavedSearches (via useUndoableRemoval) and the component
// itself all call useToast(), which needs a ToastProvider ancestor this
// suite doesn't render.
jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: jest.fn() }),
}));

// The real OnboardingTour renders a "Welcome to Scout Dashboard" heading and
// Previous/Next-step buttons on first visit, colliding with this suite's own
// heading/button queries — mock it out, tour behavior isn't this suite's
// concern.
jest.mock('@/components/ui/OnboardingTour', () => ({
  __esModule: true,
  default: () => null,
}));

// ── Import under test (after mocks) ───────────────────────────────────────────

import ScoutDashboard from '@/app/[locale]/scout/page';

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMPTY_SCOUT = {
  players: [],
  total: 0,
  loading: false,
  error: null,
  isRateLimited: false,
  retryAfterSec: null,
  hasNextPage: false,
  loadMore: jest.fn(),
  searchId: null,
  refetch: jest.fn(),
  search: mockSearch,
  searchByName: jest.fn(),
};

function setupScout(overrides: Partial<typeof EMPTY_SCOUT> = {}) {
  mockUseScout.mockReturnValue({ ...EMPTY_SCOUT, ...overrides });
}

/** Advance the mock through a full loading cycle: idle → loading → done. */
function simulateSearchCycle(
  rerender: (ui: React.ReactElement) => void,
  resultPlayers: (typeof EMPTY_SCOUT)['players'] = [],
) {
  act(() => {
    mockUseScout.mockReturnValue({ ...EMPTY_SCOUT, loading: true });
    rerender(<ScoutDashboard />);
  });
  act(() => {
    mockUseScout.mockReturnValue({
      ...EMPTY_SCOUT,
      loading: false,
      players: resultPlayers,
      total: resultPlayers.length,
    });
    rerender(<ScoutDashboard />);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ScoutDashboard — empty state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { useRequireSubscription } = jest.requireMock(
      '@/hooks/useRequireSubscription',
    );
    useRequireSubscription.mockReturnValue({
      isProtected: true,
      loading: false,
    });
    const { useSubscription } = jest.requireMock('@/hooks/useSubscription');
    useSubscription.mockReturnValue({
      subscription: null,
      isLoading: false,
      error: null,
      writeLoading: false,
      writeError: null,
      subscribe: jest.fn(),
    });
    setupScout();
  });

  // ── Visibility conditions ────────────────────────────────────────────────

  it('does not show the empty state on initial render before any search completes', () => {
    render(<ScoutDashboard />);
    expect(screen.queryByText('No players found')).not.toBeInTheDocument();
  });

  it('does not show the empty state while a search is in progress', () => {
    setupScout({ loading: true });
    render(<ScoutDashboard />);
    expect(screen.queryByText('No players found')).not.toBeInTheDocument();
  });

  it('shows the empty state after a search completes with zero results', () => {
    const { rerender } = render(<ScoutDashboard />);
    simulateSearchCycle(rerender, []);
    expect(screen.getByText('No players found')).toBeInTheDocument();
  });

  it('does not show the empty state when the search returns players', () => {
    const { rerender } = render(<ScoutDashboard />);
    const players = [
      {
        id: 'p1',
        wallet: 'G...',
        vitals: {
          name: 'A',
          age: 20,
          position: 'ST',
          region: 'NG',
          nationality: 'Nigerian',
        },
        ipfsHash: '',
        progressLevel: 0 as const,
        milestones: [],
        createdAt: 0,
      },
    ];
    simulateSearchCycle(rerender, players);
    expect(screen.queryByText('No players found')).not.toBeInTheDocument();
    expect(screen.getByTestId('player-card')).toBeInTheDocument();
  });

  it('hides the empty state while a subsequent search runs after it was shown', () => {
    const { rerender } = render(<ScoutDashboard />);

    // First search returns nothing — empty state appears
    simulateSearchCycle(rerender, []);
    expect(screen.getByText('No players found')).toBeInTheDocument();

    // A second search starts — empty state must hide during loading
    act(() => {
      mockUseScout.mockReturnValue({
        ...EMPTY_SCOUT,
        loading: true,
        players: [],
      });
      rerender(<ScoutDashboard />);
    });
    expect(screen.queryByText('No players found')).not.toBeInTheDocument();
  });

  // ── Content ───────────────────────────────────────────────────────────────

  it('renders the correct heading in the empty state', () => {
    const { rerender } = render(<ScoutDashboard />);
    simulateSearchCycle(rerender, []);
    expect(
      screen.getByRole('heading', { name: /no players found/i }),
    ).toBeInTheDocument();
  });

  it('renders the descriptive subtext in the empty state', () => {
    const { rerender } = render(<ScoutDashboard />);
    simulateSearchCycle(rerender, []);
    expect(screen.getByText('Try adjusting your filters.')).toBeInTheDocument();
  });

  it('renders a "Reset Filters" button inside the empty state', () => {
    const { rerender } = render(<ScoutDashboard />);
    simulateSearchCycle(rerender, []);
    expect(
      screen.getByRole('button', { name: /reset filters/i }),
    ).toBeInTheDocument();
  });

  // ── Clear Filters interaction ─────────────────────────────────────────────

  it('clicking "Reset Filters" retriggers the filter search with defaults', () => {
    const { rerender } = render(<ScoutDashboard />);
    simulateSearchCycle(rerender, []);

    mockSearch.mockClear();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /reset filters/i }));
    });

    // PlayerFilterForm's resetKey effect fires onSearch, which calls handleSearch → search
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it('hides the empty state after "Reset Filters" triggers a new loading cycle', () => {
    const { rerender } = render(<ScoutDashboard />);
    simulateSearchCycle(rerender, []);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /reset filters/i }));
    });

    // New search starts loading — empty state must hide
    act(() => {
      mockUseScout.mockReturnValue({ ...EMPTY_SCOUT, loading: true });
      rerender(<ScoutDashboard />);
    });

    expect(screen.queryByText('No players found')).not.toBeInTheDocument();
  });

  // ── Skeletons vs empty state ───────────────────────────────────────────────

  it('shows loading skeletons (not the empty state) during the very first search', () => {
    setupScout({ loading: true });
    render(<ScoutDashboard />);
    expect(
      screen.getAllByTestId('player-card-skeleton').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('No players found')).not.toBeInTheDocument();
  });
});
