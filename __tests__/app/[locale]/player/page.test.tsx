import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import PlayerDashboard from '@/app/[locale]/player/page';
import { usePlayer } from '@/hooks/usePlayer';
import { useRequireWallet } from '@/hooks/useRequireWallet';
import type { Player } from '@/types';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('next-intl', () => ({
  useTranslations: () =>
    Object.assign((key: string) => key, { rich: (key: string) => key }),
}));

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ push: jest.fn(), replace: jest.fn() })),
  usePathname: jest.fn(() => '/player'),
  useSearchParams: jest.fn(() => new URLSearchParams()),
}));

jest.mock('@/hooks/useRequireWallet', () => ({
  useRequireWallet: jest.fn(),
}));

jest.mock('@/hooks/usePlayer', () => ({
  usePlayer: jest.fn(),
}));

jest.mock('@/hooks/useIsPaused', () => ({
  __esModule: true,
  default: jest.fn().mockReturnValue(false),
}));

// Lightweight stand-ins for child components that are tested elsewhere
jest.mock('@/components/player/PlayerProfileForm', () => ({
  __esModule: true,
  default: ({
    onSuccess,
  }: {
    onSuccess: (result: {
      playerId: string;
      vitals: {
        name: string;
        age: number;
        position: string;
        region: string;
        nationality: string;
      };
      ipfsHash: string;
    }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onSuccess({
          playerId: 'player-optimistic',
          vitals: {
            name: 'Optimistic Player',
            age: 22,
            position: 'ST',
            region: 'nigeria',
            nationality: 'Nigerian',
          },
          ipfsHash: 'QmOptimisticCID',
        })
      }
    >
      Register Player
    </button>
  ),
}));

jest.mock('@/components/player/UpdateProfileForm', () => ({
  __esModule: true,
  default: () => <div data-testid="update-profile-form" />,
}));

jest.mock('@/components/player/MilestoneTimeline', () => ({
  __esModule: true,
  default: () => <div data-testid="milestone-timeline" />,
}));

jest.mock('@/components/ProgressBar', () => ({
  __esModule: true,
  default: ({ level }: { level: number }) => (
    <div data-testid="progress-bar" data-level={level} />
  ),
}));

jest.mock('@/components/ui/ErrorBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockShowToast = jest.fn();
jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: mockShowToast }),
}));

// BackupWalletModal reads useWalletContext() unconditionally (regardless of
// its isOpen prop), which requires a real WalletProvider ancestor this
// suite doesn't render — mock it out like the other page subcomponents.
jest.mock('@/components/player/BackupWalletModal', () => ({
  __esModule: true,
  default: () => null,
}));

// ── Typed mock helpers ────────────────────────────────────────────────────────

const mockedUseRequireWallet = useRequireWallet as jest.MockedFunction<
  typeof useRequireWallet
>;
const mockedUsePlayer = usePlayer as jest.MockedFunction<typeof usePlayer>;

const MOCK_PUBLIC_KEY = 'GABC123PUBLICKEY';

const confirmedPlayer: Player = {
  id: 'player-confirmed',
  wallet: MOCK_PUBLIC_KEY,
  vitals: {
    name: 'Confirmed Player',
    age: 23,
    position: 'CM',
    region: 'ghana',
    nationality: 'Ghanaian',
  },
  ipfsHash: 'QmConfirmedCID',
  progressLevel: 1,
  milestones: [],
  createdAt: 1700000000,
};

function makePlayerHook(overrides: Partial<ReturnType<typeof usePlayer>> = {}) {
  const defaults: ReturnType<typeof usePlayer> = {
    player: null,
    loading: false,
    isValidating: false,
    error: null,
    refetch: jest.fn<ReturnType<typeof usePlayer>['refetch']>(),
    optimisticUpdate: jest.fn(),
  };
  return { ...defaults, ...overrides };
}

function setup(
  playerHookOverrides: Partial<ReturnType<typeof usePlayer>> = {},
) {
  mockedUseRequireWallet.mockReturnValue({
    walletAddress: MOCK_PUBLIC_KEY,
  } as any);
  mockedUsePlayer.mockReturnValue(makePlayerHook(playerHookOverrides));
  return render(<PlayerDashboard />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PlayerDashboard', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── Initial render ────────────────────────────────────────────────────────

  it('shows the register tab when the player has no profile', () => {
    setup({ player: null });
    expect(
      screen.getByRole('button', { name: /register player/i }),
    ).toBeInTheDocument();
  });

  it('shows the profile tab when the player is already registered', () => {
    setup({ player: confirmedPlayer });
    expect(screen.getByText('Confirmed Player')).toBeInTheDocument();
  });

  it('shows a loading indicator while the player data is being fetched', () => {
    setup({ loading: true, player: null });
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  // ── Optimistic UI ─────────────────────────────────────────────────────────

  it('calls optimisticUpdate immediately when registration succeeds', async () => {
    const optimisticUpdate = jest.fn();
    setup({ player: null, optimisticUpdate });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /register player/i }));
    });

    expect(optimisticUpdate).toHaveBeenCalledTimes(1);
    expect(optimisticUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        vitals: expect.objectContaining({ name: 'Optimistic Player' }),
        wallet: MOCK_PUBLIC_KEY,
        progressLevel: 0,
        milestones: [],
      }),
    );
  });

  it('switches to the profile tab immediately after registration without waiting for re-fetch', async () => {
    // refetch never resolves so we can assert during the pending window
    const refetch = jest.fn(() => new Promise<void>(() => {}));
    const optimisticUpdate = jest.fn();

    mockedUseRequireWallet.mockReturnValue({
      walletAddress: MOCK_PUBLIC_KEY,
    } as any);

    // First render: no player
    mockedUsePlayer.mockReturnValue(
      makePlayerHook({ player: null, refetch, optimisticUpdate }),
    );

    const { rerender } = render(<PlayerDashboard />);

    // After optimisticUpdate is called the hook returns the optimistic player
    mockedUsePlayer.mockReturnValue(
      makePlayerHook({
        player: {
          id: 'player-optimistic',
          wallet: MOCK_PUBLIC_KEY,
          vitals: {
            name: 'Optimistic Player',
            age: 22,
            position: 'ST',
            region: 'nigeria',
            nationality: 'Nigerian',
          },
          ipfsHash: 'QmOptimisticCID',
          progressLevel: 0,
          milestones: [],
          createdAt: Math.floor(Date.now() / 1000),
        },
        refetch,
        optimisticUpdate,
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /register player/i }));
    });

    rerender(<PlayerDashboard />);

    expect(screen.getByText('Optimistic Player')).toBeInTheDocument();
  });

  it('shows the pending-confirmation banner while re-fetch is in flight', async () => {
    const refetch = jest.fn(() => new Promise<void>(() => {})); // never resolves
    const optimisticUpdate = jest.fn();

    mockedUseRequireWallet.mockReturnValue({
      walletAddress: MOCK_PUBLIC_KEY,
    } as any);

    mockedUsePlayer.mockReturnValue(
      makePlayerHook({ player: null, refetch, optimisticUpdate }),
    );

    const { rerender } = render(<PlayerDashboard />);

    mockedUsePlayer.mockReturnValue(
      makePlayerHook({
        player: {
          id: 'player-optimistic',
          wallet: MOCK_PUBLIC_KEY,
          vitals: {
            name: 'Optimistic Player',
            age: 22,
            position: 'ST',
            region: 'nigeria',
            nationality: 'Nigerian',
          },
          ipfsHash: 'QmOptimisticCID',
          progressLevel: 0,
          milestones: [],
          createdAt: Math.floor(Date.now() / 1000),
        },
        refetch,
        optimisticUpdate,
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /register player/i }));
    });

    rerender(<PlayerDashboard />);

    expect(screen.getByTestId('pending-confirmation')).toBeInTheDocument();
    expect(screen.getByText(/confirming on-chain/i)).toBeInTheDocument();
  });

  it('removes the pending-confirmation banner once re-fetch resolves', async () => {
    let resolveRefetch!: () => void;
    const refetch = jest.fn(
      () =>
        new Promise<void>((res) => {
          resolveRefetch = res;
        }),
    );
    const optimisticUpdate = jest.fn();

    mockedUseRequireWallet.mockReturnValue({
      walletAddress: MOCK_PUBLIC_KEY,
    } as any);

    mockedUsePlayer.mockReturnValue(
      makePlayerHook({ player: null, refetch, optimisticUpdate }),
    );

    const { rerender } = render(<PlayerDashboard />);

    const optimisticData: Player = {
      id: 'player-optimistic',
      wallet: MOCK_PUBLIC_KEY,
      vitals: {
        name: 'Optimistic Player',
        age: 22,
        position: 'ST',
        region: 'nigeria',
        nationality: 'Nigerian',
      },
      ipfsHash: 'QmOptimisticCID',
      progressLevel: 0,
      milestones: [],
      createdAt: Math.floor(Date.now() / 1000),
    };

    mockedUsePlayer.mockReturnValue(
      makePlayerHook({ player: optimisticData, refetch, optimisticUpdate }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /register player/i }));
    });

    rerender(<PlayerDashboard />);
    expect(screen.getByTestId('pending-confirmation')).toBeInTheDocument();

    // Resolve the re-fetch
    await act(async () => {
      resolveRefetch();
    });

    rerender(<PlayerDashboard />);
    expect(
      screen.queryByTestId('pending-confirmation'),
    ).not.toBeInTheDocument();
  });

  it('replaces optimistic data with confirmed on-chain data after re-fetch', async () => {
    let resolveRefetch!: () => void;
    const refetch = jest.fn(
      () =>
        new Promise<void>((res) => {
          resolveRefetch = res;
        }),
    );
    const optimisticUpdate = jest.fn();

    mockedUseRequireWallet.mockReturnValue({
      walletAddress: MOCK_PUBLIC_KEY,
    } as any);

    mockedUsePlayer.mockReturnValue(
      makePlayerHook({ player: null, refetch, optimisticUpdate }),
    );

    const { rerender } = render(<PlayerDashboard />);

    // Step 1: show optimistic data
    mockedUsePlayer.mockReturnValue(
      makePlayerHook({
        player: {
          id: 'player-optimistic',
          wallet: MOCK_PUBLIC_KEY,
          vitals: {
            name: 'Optimistic Player',
            age: 22,
            position: 'ST',
            region: 'nigeria',
            nationality: 'Nigerian',
          },
          ipfsHash: 'QmOptimisticCID',
          progressLevel: 0,
          milestones: [],
          createdAt: Math.floor(Date.now() / 1000),
        },
        refetch,
        optimisticUpdate,
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /register player/i }));
    });
    rerender(<PlayerDashboard />);
    expect(screen.getByText('Optimistic Player')).toBeInTheDocument();

    // Step 2: re-fetch completes, hook now returns confirmed data
    mockedUsePlayer.mockReturnValue(
      makePlayerHook({ player: confirmedPlayer, refetch, optimisticUpdate }),
    );

    await act(async () => {
      resolveRefetch();
    });
    rerender(<PlayerDashboard />);

    expect(screen.getByText('Confirmed Player')).toBeInTheDocument();
    expect(screen.queryByText('Optimistic Player')).not.toBeInTheDocument();
  });

  // ── Error path ────────────────────────────────────────────────────────────

  it('discards optimistic data and returns to register tab when re-fetch fails', async () => {
    const refetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('Network error')) // first call (re-fetch after success) fails
      .mockResolvedValue(undefined); // second call (discard + revalidate)

    const optimisticUpdate = jest.fn();

    mockedUseRequireWallet.mockReturnValue({
      walletAddress: MOCK_PUBLIC_KEY,
    } as any);

    mockedUsePlayer.mockReturnValue(
      makePlayerHook({ player: null, refetch, optimisticUpdate }),
    );

    render(<PlayerDashboard />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /register player/i }));
    });

    // After error the page should fall back to register tab (player still null)
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /register player/i }),
      ).toBeInTheDocument();
    });

    // discardOptimistic refetch should have been called
    expect(refetch).toHaveBeenCalledWith({ discardOptimistic: true });
  });

  it('does not show the pending banner after the error path clears', async () => {
    const refetch = jest.fn().mockRejectedValue(new Error('Network error'));
    const optimisticUpdate = jest.fn();

    mockedUseRequireWallet.mockReturnValue({
      walletAddress: MOCK_PUBLIC_KEY,
    } as any);
    mockedUsePlayer.mockReturnValue(
      makePlayerHook({ player: null, refetch, optimisticUpdate }),
    );

    render(<PlayerDashboard />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /register player/i }));
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId('pending-confirmation'),
      ).not.toBeInTheDocument();
    });
  });
});
