jest.unmock('next-intl');

import React from 'react';
import { render, screen } from '@/__tests__/setup-providers-intl';
import userEvent from '@testing-library/user-event';
import ArchiveProfileModal from '@/components/player/ArchiveProfileModal';
import { useArchiveProfile } from '@/hooks/useArchiveProfile';
import type { Player } from '@/types';

jest.mock('@/hooks/useArchiveProfile', () => ({
  useArchiveProfile: jest.fn(),
}));

const mockUseArchiveProfile = useArchiveProfile as jest.Mock;

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
const archive = jest.fn();
const unarchive = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockUseArchiveProfile.mockReturnValue({
    archive,
    unarchive,
    loading: false,
    error: null,
  });
});

describe('ArchiveProfileModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ArchiveProfileModal
        player={PLAYER}
        isOpen={false}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('requires an explicit confirm step before archiving', async () => {
    const user = userEvent.setup();
    render(
      <ArchiveProfileModal
        player={PLAYER}
        isOpen
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    // The initial step should not expose the destructive confirm action yet.
    expect(
      screen.queryByRole('button', { name: 'Yes, Archive' }),
    ).not.toBeInTheDocument();
    expect(archive).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Archive Profile' }));

    expect(
      screen.getByRole('heading', { name: 'Archive your profile?' }),
    ).toBeInTheDocument();
    expect(archive).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Yes, Archive' }));

    expect(archive).toHaveBeenCalledWith('player-1');
  });

  it('returns to the initial step when "Go Back" is clicked instead of confirming', async () => {
    const user = userEvent.setup();
    render(
      <ArchiveProfileModal
        player={PLAYER}
        isOpen
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Archive Profile' }));
    await user.click(screen.getByRole('button', { name: 'Go Back' }));

    expect(
      screen.getByRole('heading', { name: 'Archive Your Profile?' }),
    ).toBeInTheDocument();
    expect(archive).not.toHaveBeenCalled();
  });

  it('calls unarchive when the player is already archived', async () => {
    const user = userEvent.setup();
    const archivedPlayer = { ...PLAYER, archived: true };
    render(
      <ArchiveProfileModal
        player={archivedPlayer}
        isOpen
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Restore Profile' }));
    await user.click(screen.getByRole('button', { name: 'Yes, Restore' }));

    expect(unarchive).toHaveBeenCalledWith('player-1');
    expect(archive).not.toHaveBeenCalled();
  });

  it('disables the archive action on the initial step while loading', () => {
    mockUseArchiveProfile.mockReturnValue({
      archive,
      unarchive,
      loading: true,
      error: null,
    });
    render(
      <ArchiveProfileModal
        player={PLAYER}
        isOpen
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    expect(
      screen.getByRole('button', { name: /Archive Profile/ }),
    ).toBeDisabled();
  });

  it('shows a "Processing..." state and disables both buttons on the confirm step', async () => {
    // Start with loading:false so the initial "Archive Profile" click is
    // registered, then flip to loading:true to simulate the in-flight call.
    const { rerender } = render(
      <ArchiveProfileModal
        player={PLAYER}
        isOpen
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Archive Profile' }));

    mockUseArchiveProfile.mockReturnValue({
      archive,
      unarchive,
      loading: true,
      error: null,
    });
    rerender(
      <ArchiveProfileModal
        player={PLAYER}
        isOpen
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    const confirmButton = screen.getByRole('button', { name: /Processing/ });
    expect(confirmButton).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Go Back' })).toBeDisabled();
  });

  it('calls onSuccess and closes the modal when the archive call succeeds', async () => {
    const updatedPlayer = { ...PLAYER, archived: true };
    archive.mockResolvedValueOnce(updatedPlayer);
    const user = userEvent.setup();
    render(
      <ArchiveProfileModal
        player={PLAYER}
        isOpen
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Archive Profile' }));
    await user.click(screen.getByRole('button', { name: 'Yes, Archive' }));

    expect(onSuccess).toHaveBeenCalledWith(updatedPlayer);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('surfaces an error message from a previously failed archive call', () => {
    mockUseArchiveProfile.mockReturnValue({
      archive,
      unarchive,
      loading: false,
      error: 'Network error',
    });
    render(
      <ArchiveProfileModal
        player={PLAYER}
        isOpen
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    expect(screen.getByText('Network error')).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders translated copy in French', () => {
    render(
      <ArchiveProfileModal
        player={PLAYER}
        isOpen
        onClose={onClose}
        onSuccess={onSuccess}
      />,
      { locale: 'fr' },
    );

    expect(screen.getByText('Archiver votre profil ?')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Archiver le profil' }),
    ).toBeInTheDocument();
  });
});
