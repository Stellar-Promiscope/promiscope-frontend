jest.unmock('next-intl');

import React from 'react';
import { render, screen } from '@/__tests__/setup-providers-intl';
import userEvent from '@testing-library/user-event';
import BackupWalletModal from '@/components/player/BackupWalletModal';
import type { Player } from '@/types';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockLink = jest.fn();
const mockRemove = jest.fn();

jest.mock('@/hooks/useBackupWallet', () => ({
  useBackupWallet: () => ({
    link: mockLink,
    remove: mockRemove,
    claim: jest.fn(),
    loading: false,
    error: null,
  }),
}));

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({
    publicKey: 'GPRIMARYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    signAndSubmit: jest.fn(),
  }),
}));

const PLAYER: Player = {
  id: 'player-1',
  wallet: 'GPRIMARYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  vitals: {
    name: 'Test Player',
    age: 19,
    position: 'Forward',
    region: 'West Africa',
    nationality: 'NG',
  },
  ipfsHash: 'bafy-test',
  progressLevel: 1,
  milestones: [],
  createdAt: 0,
};

const onClose = jest.fn();
const onSuccess = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('BackupWalletModal', () => {
  // Regression guard for issue #852 (react/no-unescaped-entities): these
  // strings contain literal apostrophes/ampersands and must render as the
  // intended punctuation rather than throwing during lint/build or
  // rendering raw HTML entity text.
  it('renders the link-wallet copy with its apostrophe intact', async () => {
    const user = userEvent.setup();
    render(
      <BackupWalletModal
        player={PLAYER}
        isOpen
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Link Backup Wallet' }),
    );

    expect(
      screen.getByText(
        /You'll need to sign a\s*confirmation with your primary wallet\./,
      ),
    ).toBeInTheDocument();
  });

  it('renders the confirm-step copy with its ampersand intact', async () => {
    const user = userEvent.setup();
    render(
      <BackupWalletModal
        player={PLAYER}
        isOpen
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Link Backup Wallet' }),
    );
    await user.type(
      screen.getByPlaceholderText(/56-character Stellar public key/),
      'G'.repeat(56),
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      screen.getByRole('button', { name: 'Link & Sign' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Click "Link & Sign" to confirm with your primary wallet\. This proves you own both/,
      ),
    ).toBeInTheDocument();
  });

  it('renders the remove-wallet copy with its apostrophe intact', async () => {
    const user = userEvent.setup();
    const player = {
      ...PLAYER,
      backupWallet: 'GBACKUPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    };
    render(
      <BackupWalletModal
        player={player}
        isOpen
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(
      screen.getByText(
        /Removing your backup wallet means you won't be able to use it to recover your account/,
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(
      screen.getByText(
        /This action cannot be undone\. You'll have no backup recovery method\./,
      ),
    ).toBeInTheDocument();
  });

  it('renders translated copy and validation errors in French', async () => {
    const user = userEvent.setup();
    render(
      <BackupWalletModal
        player={PLAYER}
        isOpen
        onClose={onClose}
        onSuccess={onSuccess}
      />,
      { locale: 'fr' },
    );

    expect(screen.getByText('Récupération du compte')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: 'Associer un portefeuille de secours',
      }),
    );
    await user.type(
      screen.getByLabelText('Adresse du portefeuille de secours'),
      'not-a-wallet',
    );
    await user.click(screen.getByRole('button', { name: 'Continuer' }));

    expect(
      screen.getByText(
        'Adresse Stellar invalide. Elle doit comporter 56 caractères et commencer par G.',
      ),
    ).toBeInTheDocument();
  });
});
