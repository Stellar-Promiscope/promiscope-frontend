import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Player, SavedSearch } from '@/types';

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(),
}));

const mockGetPlayer = jest.fn();
jest.mock('@/lib/contract', () => ({
  getPlayer: (...args: unknown[]) => mockGetPlayer(...args),
}));

jest.mock('@/hooks/useSavedSearches', () => ({
  useSavedSearchNewCount: () => 3,
}));

jest.mock('@/hooks/useMilestonesBatch', () => ({
  useMilestonesBatch: () => ({ milestonesById: {}, isLoading: false }),
}));

jest.mock('@/components/scout/VirtualizedPlayerGrid', () => {
  const { forwardRef } = jest.requireActual('react');
  return {
    __esModule: true,
    default: forwardRef(function Grid(
      {
        items,
        renderItem,
      }: { items: Player[]; renderItem: (p: Player) => React.ReactNode },
      _ref: unknown,
    ) {
      return <div data-testid="grid">{items.map((p) => renderItem(p))}</div>;
    }),
  };
});

jest.mock('@/components/PlayerCardSkeleton', () => ({
  __esModule: true,
  default: () => <div data-testid="skeleton" />,
}));

import ScoutSearchBar from '@/components/scout/ScoutSearchBar';
import SavedSearchesMenu from '@/components/scout/SavedSearchesMenu';
import RecentlyViewedStrip from '@/components/scout/RecentlyViewedStrip';
import ScoutResults, { PAGE_SIZE } from '@/components/scout/ScoutResults';
import WatchlistPreview from '@/components/scout/WatchlistPreview';
import SubscriptionStatusBanner from '@/components/scout/SubscriptionStatusBanner';

const WALLET = 'G' + 'A'.repeat(55);

function player(id: string): Player {
  return { id, vitals: { name: `Player ${id}` } } as unknown as Player;
}

beforeEach(() => jest.clearAllMocks());

describe('ScoutSearchBar', () => {
  const baseProps = {
    nameQuery: '',
    onNameQueryChange: jest.fn(),
    remainingSec: null,
    showNoNameMatches: false,
    renderPlayer: (p: Player) => <p>found {p.id}</p>,
  };

  it('flags an invalid wallet address without querying the contract', () => {
    render(<ScoutSearchBar {...baseProps} />);
    fireEvent.change(screen.getByLabelText('Search by Wallet Address'), {
      target: { value: 'not-a-key' },
    });
    expect(screen.getByText(/Invalid Stellar address/)).toBeInTheDocument();
    expect(mockGetPlayer).not.toHaveBeenCalled();
  });

  it('looks up a valid wallet address after the debounce and renders the player', async () => {
    jest.useFakeTimers();
    mockGetPlayer.mockResolvedValue(player('p1'));
    render(<ScoutSearchBar {...baseProps} />);
    fireEvent.change(screen.getByLabelText('Search by Wallet Address'), {
      target: { value: WALLET },
    });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    jest.useRealTimers();
    expect(await screen.findByText('found p1')).toBeInTheDocument();
    expect(mockGetPlayer).toHaveBeenCalledWith(WALLET);
  });

  it('disables name search and shows the countdown while rate limited', () => {
    render(<ScoutSearchBar {...baseProps} remainingSec={5} />);
    expect(screen.getByLabelText('Search by Player Name')).toBeDisabled();
    expect(
      screen.getByText('Rate limited. Try again in 5s.'),
    ).toBeInTheDocument();
  });
});

describe('SavedSearchesMenu', () => {
  const search = {
    id: 1,
    name: 'Strikers',
    filter: {},
    lastViewedAt: 0,
  } as SavedSearch;

  it('renders nothing without saved searches', () => {
    const { container } = render(
      <SavedSearchesMenu
        searches={[]}
        onApply={jest.fn()}
        onRename={jest.fn()}
        onRemove={jest.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('applies, renames and removes a saved search, with a new-results badge', () => {
    const onApply = jest.fn();
    const onRename = jest.fn();
    const onRemove = jest.fn();
    render(
      <SavedSearchesMenu
        searches={[search]}
        onApply={onApply}
        onRename={onRename}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText('3 new')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith(search);

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByDisplayValue('Strikers'), {
      target: { value: 'Wingers' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onRename).toHaveBeenCalledWith(1, 'Wingers');

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledWith(search);
  });
});

describe('RecentlyViewedStrip', () => {
  it('links each recently viewed player', () => {
    render(
      <RecentlyViewedStrip
        entries={[
          { id: 1, playerId: 'p1', name: 'Amara', position: 'FW', viewedAt: 0 },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Amara' })).toHaveAttribute(
      'href',
      '/player/p1',
    );
    expect(screen.getByText('FW')).toBeInTheDocument();
  });

  it('renders nothing when empty', () => {
    const { container } = render(<RecentlyViewedStrip entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ScoutResults', () => {
  const renderPlayer = (p: Player) => <p key={p.id}>{p.id}</p>;

  it('shows skeletons while the first search loads', () => {
    render(
      <ScoutResults
        players={[]}
        showSkeletons
        showEmptyState={false}
        onResetFilters={jest.fn()}
        renderPlayer={renderPlayer}
      />,
    );
    expect(screen.getAllByTestId('skeleton')).toHaveLength(PAGE_SIZE);
  });

  it('shows the empty state with a reset action', () => {
    const onReset = jest.fn();
    render(
      <ScoutResults
        players={[]}
        showSkeletons={false}
        showEmptyState
        onResetFilters={onReset}
        renderPlayer={renderPlayer}
      />,
    );
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset Filters' }));
    expect(onReset).toHaveBeenCalled();
  });

  it('renders results and paginates with URL sync', () => {
    const players = Array.from({ length: PAGE_SIZE + 1 }, (_, i) =>
      player(`p${i}`),
    );
    render(
      <ScoutResults
        players={players}
        showSkeletons={false}
        showEmptyState={false}
        onResetFilters={jest.fn()}
        renderPlayer={renderPlayer}
      />,
    );
    expect(
      screen.getByText(`${PAGE_SIZE + 1} players found`),
    ).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pagination-next'));
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledWith('?page=2');
  });
});

describe('WatchlistPreview', () => {
  it('lists watched players with a remove action', () => {
    const entry = { id: 1, playerId: 'p1' } as never;
    const onRemove = jest.fn();
    render(<WatchlistPreview entries={[entry]} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledWith(entry);
  });
});

describe('SubscriptionStatusBanner', () => {
  it('prompts renewal when the subscription has expired', () => {
    render(
      <SubscriptionStatusBanner
        subscription={{ tier: 'basic', expiresAt: 0 } as never}
      />,
    );
    expect(screen.getByText('Subscription expired')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Renew' })).toBeInTheDocument();
  });
});
