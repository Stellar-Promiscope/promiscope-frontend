import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockShow = jest.fn();
const mockUseWallet = jest.fn();

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => mockUseWallet(),
}));

jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: mockShow }),
}));

import ContactDetailsPanel from '@/components/player/ContactDetailsPanel';
import type { VaultClient } from '@/lib/contactVaultClient';

// jest.setup's next-intl mock echoes unlisted keys back verbatim, so the
// translated strings here are the "*" key paths.
const WALLET = 'GPLAYERWALLETADDRESSHERE0000000000000000000000000';

function makeClient(overrides: Partial<VaultClient> = {}): VaultClient {
  return {
    getMetadata: jest.fn().mockResolvedValue({
      hasContactDetails: false,
      updatedAt: null,
    }),
    save: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function connect() {
  mockUseWallet.mockReturnValue({
    publicKey: WALLET,
    isAuthenticated: true,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseWallet.mockReturnValue({
    publicKey: null,
    isAuthenticated: false,
  });
});

describe('ContactDetailsPanel', () => {
  it('prompts the player to connect when no wallet is present', () => {
    render(<ContactDetailsPanel client={makeClient()} />);
    expect(screen.getByText('connect_wallet')).toBeInTheDocument();
    expect(screen.queryByLabelText('email_label')).toBeNull();
  });

  it('does not read metadata while disconnected', () => {
    const client = makeClient();
    render(<ContactDetailsPanel client={client} />);
    expect(client.getMetadata).not.toHaveBeenCalled();
  });

  it('checks for an existing row scoped to the connected wallet', async () => {
    connect();
    const client = makeClient();
    render(<ContactDetailsPanel client={client} />);

    await waitFor(() =>
      expect(client.getMetadata).toHaveBeenCalledWith(WALLET),
    );
  });

  it('reports that nothing is saved yet, so the player knows to opt in', async () => {
    connect();
    render(<ContactDetailsPanel client={makeClient()} />);

    expect(await screen.findByText('not_stored')).toBeInTheDocument();
  });

  it('saves the entered details to the player’s own vault row', async () => {
    const user = userEvent.setup();
    connect();
    const client = makeClient();
    render(<ContactDetailsPanel client={client} />);

    await user.type(screen.getByLabelText('email_label'), 'me@example.com');
    await user.type(screen.getByLabelText('phone_label'), '+15550100');
    await user.click(screen.getByRole('button', { name: /save_button/ }));

    await waitFor(() =>
      expect(client.save).toHaveBeenCalledWith(WALLET, {
        email: 'me@example.com',
        phone: '+15550100',
        telegram: '',
      }),
    );
    expect(mockShow).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'success' }),
    );
  });

  it('trims whitespace and sends empty channels as empty strings', async () => {
    const user = userEvent.setup();
    connect();
    const client = makeClient();
    render(<ContactDetailsPanel client={client} />);

    await user.type(screen.getByLabelText('telegram_label'), '  @handle  ');
    await user.click(screen.getByRole('button', { name: /save_button/ }));

    await waitFor(() =>
      expect(client.save).toHaveBeenCalledWith(WALLET, {
        email: '',
        phone: '',
        telegram: '@handle',
      }),
    );
  });

  it('refuses to save when every channel is blank, without calling the server', async () => {
    const user = userEvent.setup();
    connect();
    const client = makeClient();
    render(<ContactDetailsPanel client={client} />);

    await user.click(screen.getByRole('button', { name: /save_button/ }));

    expect(client.save).not.toHaveBeenCalled();
    expect(mockShow).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'need_one_channel',
        variant: 'error',
      }),
    );
  });

  it('treats a whitespace-only entry as blank', async () => {
    const user = userEvent.setup();
    connect();
    const client = makeClient();
    render(<ContactDetailsPanel client={client} />);

    await user.type(screen.getByLabelText('email_label'), '   ');
    await user.click(screen.getByRole('button', { name: /save_button/ }));

    expect(client.save).not.toHaveBeenCalled();
    expect(mockShow).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'need_one_channel',
      }),
    );
  });

  it('clears the inputs after a successful save so plaintext does not linger', async () => {
    const user = userEvent.setup();
    connect();
    render(<ContactDetailsPanel client={makeClient()} />);

    const email = screen.getByLabelText('email_label');
    await user.type(email, 'me@example.com');
    await user.click(screen.getByRole('button', { name: /save_button/ }));

    await waitFor(() => expect(email).toHaveValue(''));
  });

  it('keeps the entered values when the save fails, so they are not retyped', async () => {
    const user = userEvent.setup();
    connect();
    const client = makeClient({
      save: jest.fn().mockRejectedValue(new Error('vault exploded')),
    });
    render(<ContactDetailsPanel client={client} />);

    const email = screen.getByLabelText('email_label');
    await user.type(email, 'me@example.com');
    await user.click(screen.getByRole('button', { name: /save_button/ }));

    await waitFor(() =>
      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'vault exploded',
          variant: 'error',
        }),
      ),
    );
    expect(email).toHaveValue('me@example.com');
  });

  it('offers no delete button until a row exists', async () => {
    connect();
    render(<ContactDetailsPanel client={makeClient()} />);

    await screen.findByText('not_stored');
    expect(screen.queryByRole('button', { name: /delete_button/ })).toBeNull();
  });

  it('deletes the player’s own row and flips the status back to unset', async () => {
    const user = userEvent.setup();
    connect();
    const client = makeClient({
      getMetadata: jest.fn().mockResolvedValue({
        hasContactDetails: true,
        updatedAt: 1_700_000_000_000,
      }),
    });
    render(<ContactDetailsPanel client={client} />);

    const del = await screen.findByRole('button', {
      name: /delete_button/,
    });
    await user.click(del);

    await waitFor(() => expect(client.remove).toHaveBeenCalledWith(WALLET));
    expect(await screen.findByText('not_stored')).toBeInTheDocument();
  });

  it('never persists the entered contact details to browser storage', async () => {
    const user = userEvent.setup();
    connect();
    render(<ContactDetailsPanel client={makeClient()} />);

    await user.type(screen.getByLabelText('email_label'), 'me@example.com');
    await user.type(screen.getByLabelText('telegram_label'), '@handle');

    // Same rule lib/contactDetailsCache.ts enforces on the scout's read
    // side: PII lives in component state only. A crash dump, a shared
    // machine, or an XSS'd bundle must not find the player's address.
    const dump = JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    });
    expect(dump).not.toContain('me@example.com');
    expect(dump).not.toContain('@handle');
  });

  it('surfaces the server’s error message when the vault is not configured', async () => {
    const user = userEvent.setup();
    connect();
    const client = makeClient({
      save: jest
        .fn()
        .mockRejectedValue(new Error('Contact vault is not configured')),
    });
    render(<ContactDetailsPanel client={client} />);

    await user.type(screen.getByLabelText('email_label'), 'me@example.com');
    await user.click(screen.getByRole('button', { name: /save_button/ }));

    await waitFor(() =>
      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Contact vault is not configured',
        }),
      ),
    );
  });

  it('still allows saving when the metadata read fails', async () => {
    const user = userEvent.setup();
    connect();
    const client = makeClient({
      getMetadata: jest.fn().mockRejectedValue(new Error('offline')),
    });
    render(<ContactDetailsPanel client={client} />);

    await user.type(screen.getByLabelText('email_label'), 'me@example.com');
    await user.click(screen.getByRole('button', { name: /save_button/ }));

    await waitFor(() =>
      expect(client.save).toHaveBeenCalledWith(WALLET, {
        email: 'me@example.com',
        phone: '',
        telegram: '',
      }),
    );
  });
});
