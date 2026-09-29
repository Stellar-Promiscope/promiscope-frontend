import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// ── Hook mocks ────────────────────────────────────────────────────────────────

jest.mock('next/navigation', () => ({
  useParams: jest.fn(() => ({ id: 'player-1' })),
}));

jest.mock('@/hooks/useWallet', () => ({
  useWallet: jest.fn(() => ({ publicKey: null })),
}));

jest.mock('@/hooks/usePlayer', () => ({
  usePlayer: jest.fn(),
}));

jest.mock('@/hooks/usePayToContact', () => ({
  usePayToContact: jest.fn(() => ({
    unlock: jest.fn(),
    loading: false,
    contactDetails: undefined,
    error: null,
    clear: jest.fn(),
  })),
}));

jest.mock('@/hooks/useSubscription', () => ({
  useSubscription: jest.fn(() => ({
    subscription: null,
    isExpired: false,
    loading: false,
  })),
}));

const mockUseWatchlist = jest.fn();
jest.mock('@/hooks/useWatchlist', () => ({
  useWatchlist: (...args: unknown[]) => mockUseWatchlist(...args),
}));

jest.mock('@/hooks/useRecentlyViewed', () => ({
  useRecentlyViewed: jest.fn(() => ({ entries: [], record: jest.fn() })),
}));

jest.mock('@/components/ui/Toast', () => ({
  useToast: jest.fn(() => ({ show: jest.fn() })),
}));

// ── Component mocks ───────────────────────────────────────────────────────────

jest.mock('@/components/PlayerProfileSkeleton', () => ({
  __esModule: true,
  default: () => <div data-testid="skeleton" />,
}));

jest.mock('@/components/ProgressBar', () => ({
  __esModule: true,
  default: ({ level }: { level: number }) => (
    <div data-testid="progress-bar">level:{level}</div>
  ),
}));

jest.mock('@/components/player/PlayerStatsCard', () => ({
  __esModule: true,
  default: () => <div data-testid="stats-card" />,
}));

jest.mock('@/components/player/IPFSMediaGallery', () => ({
  __esModule: true,
  default: ({ cids }: { cids: string[] }) => (
    <div data-testid="ipfs-gallery" data-cids={cids.join(',')} />
  ),
}));

jest.mock('@/components/scout/TrialOfferForm', () => ({
  __esModule: true,
  default: () => <div data-testid="trial-offer-form" />,
}));

jest.mock('@/components/ui/Button', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
}));

jest.mock('@/components/ui/ConfirmDialog', () => ({
  __esModule: true,
  default: ({
    isOpen,
    title,
    message,
    onConfirm,
    onCancel,
    confirmLabel,
    loading,
  }: {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
    confirmLabel?: string;
    loading?: boolean;
  }) =>
    isOpen ? (
      <div data-testid="confirm-dialog">
        <p>{title}</p>
        <p>{message}</p>
        <button onClick={onConfirm} disabled={loading}>
          {confirmLabel ?? 'Confirm'}
        </button>
        <button onClick={onCancel} disabled={loading}>
          Cancel
        </button>
      </div>
    ) : null,
}));

jest.mock('@/components/ui/XlmFiatDisplay', () => ({
  __esModule: true,
  default: ({ xlmAmount }: { xlmAmount: number }) => (
    <span data-testid="xlm-fiat-display">{xlmAmount} XLM</span>
  ),
}));

jest.mock('@/components/ui/QRModal', () => ({
  __esModule: true,
  default: () => <div data-testid="qr-modal" />,
}));

const mockGetContactFee = jest.fn();
jest.mock('@/lib/contract', () => ({
  PLATFORM_CONTACT_FEE_XLM: 1,
  getContactFee: (...args: unknown[]) => mockGetContactFee(...args),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import PlayerProfile from '@/app/[locale]/player/[id]/PlayerProfileClient';
import { usePlayer } from '@/hooks/usePlayer';
import { useWallet } from '@/hooks/useWallet';
import { usePayToContact } from '@/hooks/usePayToContact';

const mockUsePlayer = usePlayer as jest.Mock;
const mockUseWallet = useWallet as jest.Mock;
const mockUsePayToContact = usePayToContact as jest.Mock;

const basePlayer = {
  id: 'player-1',
  wallet: 'GABC123XYZ',
  vitals: {
    name: 'Test Player',
    age: 22,
    position: 'ST',
    region: 'West Africa',
    nationality: 'GH',
  },
  stats: { goals: 10, assists: 5, appearances: 20 },
  ipfsHash: 'QmTestHash123',
  progressLevel: 1 as const,
  milestones: [],
  createdAt: 1700000000,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseWallet.mockReturnValue({ publicKey: null });
  mockUsePayToContact.mockReturnValue({
    unlock: jest.fn(),
    loading: false,
    contactDetails: undefined,
    error: null,
    clear: jest.fn(),
  });
  mockGetContactFee.mockResolvedValue(1);
  mockUseWatchlist.mockReturnValue({
    entries: [],
    loading: false,
    error: null,
    isWatched: () => false,
    add: jest.fn(),
    remove: jest.fn(),
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PlayerProfile page', () => {
  it('shows skeleton while loading', () => {
    mockUsePlayer.mockReturnValue({
      player: null,
      loading: true,
      refetch: jest.fn(),
    });
    render(<PlayerProfile />);
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
  });

  it('shows not-found message when player is null', () => {
    mockUsePlayer.mockReturnValue({
      player: null,
      loading: false,
      refetch: jest.fn(),
    });
    render(<PlayerProfile />);
    expect(screen.getByText('Player not found.')).toBeInTheDocument();
  });

  it('renders player name and vitals', () => {
    mockUsePlayer.mockReturnValue({
      player: basePlayer,
      loading: false,
      refetch: jest.fn(),
    });
    render(<PlayerProfile />);
    expect(screen.getByText('Test Player')).toBeInTheDocument();
    expect(screen.getByText(/ST · West Africa · Age 22/)).toBeInTheDocument();
  });

  it('renders IPFSMediaGallery with the player ipfsHash', () => {
    mockUsePlayer.mockReturnValue({
      player: basePlayer,
      loading: false,
      refetch: jest.fn(),
    });
    render(<PlayerProfile />);
    const gallery = screen.getByTestId('ipfs-gallery');
    expect(gallery).toBeInTheDocument();
    expect(gallery).toHaveAttribute('data-cids', 'QmTestHash123');
  });

  it('renders IPFSMediaGallery with empty cids when ipfsHash is empty string', () => {
    mockUsePlayer.mockReturnValue({
      player: { ...basePlayer, ipfsHash: '' },
      loading: false,
      refetch: jest.fn(),
    });
    render(<PlayerProfile />);
    const gallery = screen.getByTestId('ipfs-gallery');
    expect(gallery).toHaveAttribute('data-cids', '');
  });

  it('renders IPFSMediaGallery with empty cids when ipfsHash is undefined', () => {
    mockUsePlayer.mockReturnValue({
      player: { ...basePlayer, ipfsHash: undefined as unknown as string },
      loading: false,
      refetch: jest.fn(),
    });
    render(<PlayerProfile />);
    const gallery = screen.getByTestId('ipfs-gallery');
    expect(gallery).toHaveAttribute('data-cids', '');
  });

  it('shows "no milestones" message when milestones is empty', () => {
    mockUsePlayer.mockReturnValue({
      player: basePlayer,
      loading: false,
      refetch: jest.fn(),
    });
    render(<PlayerProfile />);
    expect(screen.getByText('No milestones recorded yet.')).toBeInTheDocument();
  });

  it('renders milestones when present', () => {
    const player = {
      ...basePlayer,
      milestones: [
        {
          id: 'm1',
          description: 'Scored 5 goals',
          evidenceHash: '',
          validator: 'GVALIDATOR123456',
          timestamp: 1700000000,
        },
      ],
    };
    mockUsePlayer.mockReturnValue({
      player,
      loading: false,
      refetch: jest.fn(),
    });
    render(<PlayerProfile />);
    expect(screen.getByText('Scored 5 goals')).toBeInTheDocument();
  });

  it('does not render pay-to-contact button when no wallet connected', () => {
    mockUsePlayer.mockReturnValue({
      player: basePlayer,
      loading: false,
      refetch: jest.fn(),
    });
    render(<PlayerProfile />);
    expect(screen.queryByText(/Pay to Contact/)).not.toBeInTheDocument();
  });

  it('does not render a watchlist star when no wallet is connected', () => {
    mockUsePlayer.mockReturnValue({
      player: basePlayer,
      loading: false,
      refetch: jest.fn(),
    });
    render(<PlayerProfile />);
    expect(screen.queryByLabelText('Add to watchlist')).not.toBeInTheDocument();
  });
});

// ── Watchlist star toggle ────────────────────────────────────────────────────

describe('PlayerProfile watchlist toggle', () => {
  beforeEach(() => {
    mockUseWallet.mockReturnValue({ publicKey: 'GSCOUTWALLET' });
    mockUsePlayer.mockReturnValue({
      player: basePlayer,
      loading: false,
      refetch: jest.fn(),
    });
  });

  it('does not render the star when viewing your own profile', () => {
    mockUseWallet.mockReturnValue({ publicKey: basePlayer.wallet });
    render(<PlayerProfile />);
    expect(screen.queryByLabelText('Add to watchlist')).not.toBeInTheDocument();
  });

  it('renders an "Add to watchlist" star when not yet watched', () => {
    render(<PlayerProfile />);
    expect(screen.getByLabelText('Add to watchlist')).toBeInTheDocument();
  });

  it('calls watchlist.add when the star is clicked and not yet watched', () => {
    const add = jest.fn();
    mockUseWatchlist.mockReturnValue({
      entries: [],
      loading: false,
      error: null,
      isWatched: () => false,
      add,
      remove: jest.fn(),
    });
    render(<PlayerProfile />);
    fireEvent.click(screen.getByLabelText('Add to watchlist'));
    expect(add).toHaveBeenCalledWith('player-1');
  });

  it('calls watchlist.remove when the star is clicked and already watched', () => {
    const remove = jest.fn();
    const entry = {
      id: 1,
      scoutWallet: 'GSCOUTWALLET',
      playerId: 'player-1',
      createdAt: 0,
    };
    mockUseWatchlist.mockReturnValue({
      entries: [entry],
      loading: false,
      error: null,
      isWatched: () => true,
      add: jest.fn(),
      remove,
    });
    render(<PlayerProfile />);
    fireEvent.click(screen.getByLabelText('Remove from watchlist'));
    expect(remove).toHaveBeenCalledWith(entry);
  });
});

// ── Live contact-fee staleness check ────────────────────────────────────────

describe('PlayerProfile pay-to-contact fee staleness check', () => {
  beforeEach(() => {
    mockUseWallet.mockReturnValue({ publicKey: 'GSCOUTWALLET' });
    mockUsePlayer.mockReturnValue({
      player: basePlayer,
      loading: false,
      refetch: jest.fn(),
    });
  });

  it('labels the pre-confirmation button fee as an estimate', () => {
    render(<PlayerProfile />);
    const button = screen.getByRole('button', { name: /Pay to Contact/ });
    expect(button).toHaveTextContent('Pay to Contact');
    expect(button).toHaveTextContent('1 XLM');
  });

  it('checks the live fee before showing the final confirm message, and shows the confirmed fee when it matches', async () => {
    mockGetContactFee.mockResolvedValue(1);
    render(<PlayerProfile />);

    fireEvent.click(screen.getByRole('button', { name: /Pay to Contact/ }));

    await waitFor(() => {
      expect(mockGetContactFee).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(
        screen.getByText(/Fee: 1 XLM will be deducted from your wallet\./),
      ).toBeInTheDocument();
    });
  });

  it('warns clearly when the live fee differs from the cached/env value', async () => {
    mockGetContactFee.mockResolvedValue(2);
    render(<PlayerProfile />);

    fireEvent.click(screen.getByRole('button', { name: /Pay to Contact/ }));

    await waitFor(() => {
      expect(
        screen.getByText(
          /The live contact fee is now 2 XLM — different from the 1 XLM shown initially\. Confirming will charge 2 XLM\./,
        ),
      ).toBeInTheDocument();
    });
  });

  it('disables the confirm button while the live fee check is in flight', async () => {
    let resolveFee: (fee: number) => void = () => {};
    mockGetContactFee.mockReturnValue(
      new Promise((resolve) => {
        resolveFee = resolve;
      }),
    );
    render(<PlayerProfile />);

    fireEvent.click(screen.getByRole('button', { name: /Pay to Contact/ }));

    expect(screen.getByText(/Confirming the current fee/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();

    resolveFee(1);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Confirm' }),
      ).not.toBeDisabled(),
    );
  });

  it('falls back to a clearly-labeled estimate when the live fee check fails', async () => {
    mockGetContactFee.mockRejectedValue(new Error('rpc down'));
    render(<PlayerProfile />);

    fireEvent.click(screen.getByRole('button', { name: /Pay to Contact/ }));

    await waitFor(() => {
      expect(
        screen.getByText(
          /Fee: ~1 XLM \(estimate — could not confirm the live rate\)/,
        ),
      ).toBeInTheDocument();
    });
    // The user is not locked out by a failed check — Confirm remains available.
    expect(screen.getByRole('button', { name: 'Confirm' })).not.toBeDisabled();
  });
});

// ── No hardcoded gateway URLs ─────────────────────────────────────────────────

describe('No hardcoded IPFS gateway URLs', () => {
  it('page source does not contain hardcoded ipfs.io or pinata gateway URLs', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'app/[locale]/player/[id]/page.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/https:\/\/ipfs\.io/);
    expect(src).not.toMatch(/https:\/\/gateway\.pinata\.cloud/);
  });
});
