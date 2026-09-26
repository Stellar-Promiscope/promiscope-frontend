import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockUsePayToContact = jest.fn();

jest.mock('@/hooks/usePayToContact', () => ({
  usePayToContact: (...args: unknown[]) => mockUsePayToContact(...args),
}));

import ContactModal from '@/components/scout/ContactModal';

const PLAYER_ID = 'player-123';

function setHook(
  overrides: {
    contactDetails?: Record<string, string | undefined>;
    clear?: jest.Mock;
    loading?: boolean;
  } = {},
) {
  mockUsePayToContact.mockReturnValue({
    contactDetails: undefined,
    loading: false,
    clear: jest.fn(),
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setHook();
});

describe('ContactModal', () => {
  it('renders nothing when isOpen is false', () => {
    render(
      <ContactModal isOpen={false} onClose={jest.fn()} playerId={PLAYER_ID} />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('passes the playerId through to the hook so it reads the same cache entry unlock() populated', () => {
    render(<ContactModal isOpen onClose={jest.fn()} playerId={PLAYER_ID} />);
    expect(mockUsePayToContact).toHaveBeenCalledWith(PLAYER_ID);
  });

  it('shows a placeholder when nothing has been unlocked for this player yet', () => {
    render(<ContactModal isOpen onClose={jest.fn()} playerId={PLAYER_ID} />);

    expect(
      screen.getByText('No contact details unlocked for this player yet.'),
    ).toBeInTheDocument();
  });

  it('renders contact details with copy buttons for each present field', async () => {
    const user = userEvent.setup();
    const writeTextSpy = jest
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    setHook({
      contactDetails: {
        email: 'scout@example.com',
        phone: '+123456789',
        telegram: '@scoutguy',
      },
    });
    render(<ContactModal isOpen onClose={jest.fn()} playerId={PLAYER_ID} />);

    expect(screen.getByText('Email: scout@example.com')).toBeInTheDocument();
    expect(screen.getByText('Phone: +123456789')).toBeInTheDocument();
    expect(screen.getByText('Telegram: @scoutguy')).toBeInTheDocument();

    const copyButtons = screen.getAllByRole('button', { name: 'Copy' });
    expect(copyButtons).toHaveLength(3);

    await user.click(copyButtons[0]);
    expect(writeTextSpy).toHaveBeenCalledWith('scout@example.com');
  });

  it('only renders rows for contact fields that are present', () => {
    setHook({ contactDetails: { email: 'only@example.com' } });
    render(<ContactModal isOpen onClose={jest.fn()} playerId={PLAYER_ID} />);

    expect(screen.getByText('Email: only@example.com')).toBeInTheDocument();
    expect(screen.queryByText(/^Phone:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Telegram:/)).not.toBeInTheDocument();
  });

  it('purges the cached contact details and calls onClose when closed', async () => {
    const user = userEvent.setup();
    const clear = jest.fn();
    const onClose = jest.fn();
    setHook({ contactDetails: { email: 'scout@example.com' }, clear });
    render(<ContactModal isOpen onClose={onClose} playerId={PLAYER_ID} />);

    await user.click(screen.getByRole('button', { name: 'Close modal' }));

    expect(clear).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a spinner and disables the action buttons while pay-to-contact is pending', () => {
    setHook({ loading: true, contactDetails: { email: 'p@example.com' } });
    render(<ContactModal isOpen onClose={jest.fn()} playerId={PLAYER_ID} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(
      screen.getByText(/Confirming pay-to-contact transaction/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
  });

  it('re-enables the action buttons once the transaction resolves', () => {
    setHook({ loading: false, contactDetails: { email: 'p@example.com' } });
    render(<ContactModal isOpen onClose={jest.fn()} playerId={PLAYER_ID} />);
    expect(
      screen.queryByText(/Confirming pay-to-contact transaction/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
  });
});
