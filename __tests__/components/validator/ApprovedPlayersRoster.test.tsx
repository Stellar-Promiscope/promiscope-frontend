import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ApprovedPlayersRoster from '@/components/validator/ApprovedPlayersRoster';

const mockUseApprovedPlayers = jest.fn();

jest.mock('@/hooks/useApprovedPlayers', () => ({
  useApprovedPlayers: (...args: unknown[]) => mockUseApprovedPlayers(...args),
}));

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(() => '/en/validator'),
}));

jest.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: { count?: number }) => {
    const messages: Record<string, string> = {
      roster_title: 'My Approved Players',
      roster_empty_title: 'No approved players yet',
      roster_empty_description:
        "Use the approval form above to approve a player's milestone.",
      roster_error:
        'Could not load approved players. The indexer may be temporarily unavailable.',
      roster_retry: 'Retry',
      roster_count_one: '1 player',
      roster_count_other: `${values?.count ?? 0} players`,
    };
    return messages[key] ?? key;
  },
}));

jest.mock('@/components/PlayerCard', () => ({
  __esModule: true,
  default: ({ player }: { player: { vitals: { name: string } } }) => (
    <div data-testid="player-card">{player.vitals.name}</div>
  ),
}));

jest.mock('@/components/ui/Button', () => ({
  __esModule: true,
  default: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button onClick={onClick} data-testid="retry-button">
      {children}
    </button>
  ),
}));

jest.mock('@/components/ui/EmptyState', () => ({
  __esModule: true,
  default: ({
    title,
    description,
  }: {
    title: string;
    description?: string;
  }) => (
    <div data-testid="empty-state">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
    </div>
  ),
}));

const samplePlayers = [
  {
    id: 'player-1',
    wallet: 'GAPLAYER1',
    vitals: {
      name: 'Alex Okafor',
      age: 22,
      position: 'Forward',
      region: 'West Africa',
      nationality: 'Nigeria',
    },
    ipfsHash: 'QmHash1',
    progressLevel: 2,
    milestones: [],
    createdAt: 1000000,
  },
  {
    id: 'player-2',
    wallet: 'GAPLAYER2',
    vitals: {
      name: 'Maria Santos',
      age: 20,
      position: 'Midfielder',
      region: 'South America',
      nationality: 'Brazil',
    },
    ipfsHash: 'QmHash2',
    progressLevel: 1,
    milestones: [],
    createdAt: 1000001,
  },
];

describe('ApprovedPlayersRoster', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading skeleton while fetching', () => {
    mockUseApprovedPlayers.mockReturnValue({
      players: [],
      loading: true,
      error: null,
      refetch: jest.fn(),
    });

    const { container } = render(
      <ApprovedPlayersRoster validatorAddress="GVALIDATOR" />,
    );

    expect(screen.getByText('My Approved Players')).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(
      0,
    );
  });

  it('shows error state with retry button', () => {
    const refetch = jest.fn();
    mockUseApprovedPlayers.mockReturnValue({
      players: [],
      loading: false,
      error: 'Indexer unavailable',
      refetch,
    });

    render(<ApprovedPlayersRoster validatorAddress="GVALIDATOR" />);

    expect(screen.getByText('My Approved Players')).toBeInTheDocument();
    expect(
      screen.getByText(/Could not load approved players/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('retry-button')).toBeInTheDocument();
  });

  it('shows EmptyState when no players are approved and not loading', () => {
    mockUseApprovedPlayers.mockReturnValue({
      players: [],
      loading: false,
      error: null,
      refetch: jest.fn(),
    });

    render(<ApprovedPlayersRoster validatorAddress="GVALIDATOR" />);

    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No approved players yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Use the approval form above to approve a player's milestone.",
      ),
    ).toBeInTheDocument();
  });

  it('renders player cards for approved players', () => {
    mockUseApprovedPlayers.mockReturnValue({
      players: samplePlayers,
      loading: false,
      error: null,
      refetch: jest.fn(),
    });

    render(<ApprovedPlayersRoster validatorAddress="GVALIDATOR" />);

    expect(screen.getByText('My Approved Players')).toBeInTheDocument();
    expect(screen.getByText('2 players')).toBeInTheDocument();
    expect(screen.getByText('Alex Okafor')).toBeInTheDocument();
    expect(screen.getByText('Maria Santos')).toBeInTheDocument();
  });

  it('shows singular "1 player" count for a single player', () => {
    mockUseApprovedPlayers.mockReturnValue({
      players: [samplePlayers[0]],
      loading: false,
      error: null,
      refetch: jest.fn(),
    });

    render(<ApprovedPlayersRoster validatorAddress="GVALIDATOR" />);

    expect(screen.getByText('1 player')).toBeInTheDocument();
  });

  it('links each player card to their profile page with locale prefix', () => {
    mockUseApprovedPlayers.mockReturnValue({
      players: samplePlayers,
      loading: false,
      error: null,
      refetch: jest.fn(),
    });

    render(<ApprovedPlayersRoster validatorAddress="GVALIDATOR" />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/en/player/player-1');
    expect(links[1]).toHaveAttribute('href', '/en/player/player-2');
  });
});
