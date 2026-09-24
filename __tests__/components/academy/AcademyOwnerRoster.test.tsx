jest.unmock('next-intl');

import React from 'react';
import {
  render,
  screen,
  waitFor,
  within,
} from '@/__tests__/setup-providers-intl';
import userEvent from '@testing-library/user-event';
import AcademyOwnerRoster from '@/components/academy/AcademyOwnerRoster';

const mockShow = jest.fn();
jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: mockShow }),
}));

const mockFetchMyAcademies = jest.fn();
const mockAddAcademyMember = jest.fn();
const mockRemoveAcademyMember = jest.fn();
jest.mock('@/lib/api', () => ({
  fetchMyAcademies: (...args: unknown[]) => mockFetchMyAcademies(...args),
  addAcademyMember: (...args: unknown[]) => mockAddAcademyMember(...args),
  removeAcademyMember: (...args: unknown[]) => mockRemoveAcademyMember(...args),
}));

const mockCheckIsValidator = jest.fn();
jest.mock('@/lib/contract', () => ({
  checkIsValidator: (...args: unknown[]) => mockCheckIsValidator(...args),
}));

function stellarAddress(prefix: string): string {
  return (prefix + 'A'.repeat(56 - prefix.length)).slice(0, 56);
}

const OWNER = stellarAddress('GOWNER');
const SIGNER = stellarAddress('GSIGNER');
const NEW_SIGNER = stellarAddress('GNEW');

function academy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'academy-1',
    name: 'FC Sahel',
    ownerWallet: OWNER,
    createdAt: 1_700_000_000,
    members: [
      {
        wallet: SIGNER,
        academyId: 'academy-1',
        addedAt: 1_700_000_000,
        addedBy: OWNER,
      },
    ],
    quorum: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckIsValidator.mockResolvedValue(true);
});

describe('AcademyOwnerRoster', () => {
  it('shows a loading state, then the fetched roster', async () => {
    mockFetchMyAcademies.mockResolvedValue([academy()]);

    render(<AcademyOwnerRoster />);
    expect(screen.getByText('Loading your academy…')).toBeInTheDocument();

    expect(await screen.findByText('FC Sahel')).toBeInTheDocument();
    expect(screen.getByText('1 signer')).toBeInTheDocument();
  });

  it('renders an error state and retries on demand', async () => {
    mockFetchMyAcademies.mockRejectedValueOnce(new Error('boom'));

    render(<AcademyOwnerRoster />);

    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByText(/Failed to load your academy/)).toBeInTheDocument();

    mockFetchMyAcademies.mockResolvedValueOnce([academy()]);
    await userEvent.click(retry);

    expect(await screen.findByText('FC Sahel')).toBeInTheDocument();
    expect(mockFetchMyAcademies).toHaveBeenCalledTimes(2);
  });

  it('renders the empty-owner state', async () => {
    mockFetchMyAcademies.mockResolvedValue([]);

    render(<AcademyOwnerRoster />);

    expect(
      await screen.findByText(/isn.t recorded as the owner of any academy/i),
    ).toBeInTheDocument();
  });

  it('flags a member that is not authorized on-chain', async () => {
    mockFetchMyAcademies.mockResolvedValue([academy()]);
    mockCheckIsValidator.mockResolvedValue(false);

    render(<AcademyOwnerRoster />);

    expect(await screen.findByText('not on-chain')).toBeInTheDocument();
    expect(mockCheckIsValidator).toHaveBeenCalledWith(SIGNER);
  });

  it('keeps the Add button disabled until a valid G-address is entered', async () => {
    mockFetchMyAcademies.mockResolvedValue([academy()]);

    render(<AcademyOwnerRoster />);
    await screen.findByText('FC Sahel');

    const addButton = screen.getByRole('button', { name: 'Add' });
    expect(addButton).toBeDisabled();

    await userEvent.type(
      screen.getByPlaceholderText('Add signer wallet (G...)'),
      'not-an-address',
    );
    expect(addButton).toBeDisabled();

    await userEvent.clear(
      screen.getByPlaceholderText('Add signer wallet (G...)'),
    );
    await userEvent.type(
      screen.getByPlaceholderText('Add signer wallet (G...)'),
      NEW_SIGNER,
    );
    expect(addButton).toBeEnabled();
  });

  it('adds a signer wallet through the confirm dialog', async () => {
    mockFetchMyAcademies.mockResolvedValue([academy()]);
    mockAddAcademyMember.mockResolvedValue(
      academy({
        members: [
          ...academy().members,
          {
            wallet: NEW_SIGNER,
            academyId: 'academy-1',
            addedAt: 1_700_000_100,
            addedBy: OWNER,
          },
        ],
      }),
    );

    render(<AcademyOwnerRoster />);
    await screen.findByText('FC Sahel');

    await userEvent.type(
      screen.getByPlaceholderText('Add signer wallet (G...)'),
      NEW_SIGNER,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Add Signer' }),
    );

    await waitFor(() =>
      expect(mockAddAcademyMember).toHaveBeenCalledWith(
        'academy-1',
        NEW_SIGNER,
      ),
    );
    expect(mockShow).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'success' }),
    );
    await waitFor(() =>
      expect(screen.getByText('2 signers')).toBeInTheDocument(),
    );
  });

  it('surfaces an error toast when adding a signer fails', async () => {
    mockFetchMyAcademies.mockResolvedValue([academy()]);
    mockAddAcademyMember.mockRejectedValue(new Error('already a member'));

    render(<AcademyOwnerRoster />);
    await screen.findByText('FC Sahel');

    await userEvent.type(
      screen.getByPlaceholderText('Add signer wallet (G...)'),
      NEW_SIGNER,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Add Signer' }),
    );

    await waitFor(() =>
      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'error',
          message: 'already a member',
        }),
      ),
    );
  });

  it('removes a signer wallet through the confirm dialog', async () => {
    mockFetchMyAcademies.mockResolvedValue([academy()]);
    mockRemoveAcademyMember.mockResolvedValue(undefined);

    render(<AcademyOwnerRoster />);
    await screen.findByText('FC Sahel');

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Remove Signer' }),
    );

    await waitFor(() =>
      expect(mockRemoveAcademyMember).toHaveBeenCalledWith('academy-1', SIGNER),
    );
    await waitFor(() =>
      expect(screen.getByText('0 signers')).toBeInTheDocument(),
    );
  });

  it('surfaces an error toast when removing a signer fails', async () => {
    mockFetchMyAcademies.mockResolvedValue([academy()]);
    mockRemoveAcademyMember.mockRejectedValue(new Error('network down'));

    render(<AcademyOwnerRoster />);
    await screen.findByText('FC Sahel');

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Remove Signer' }),
    );

    await waitFor(() =>
      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'error', message: 'network down' }),
      ),
    );
  });

  it('cancels a pending action without calling the API', async () => {
    mockFetchMyAcademies.mockResolvedValue([academy()]);

    render(<AcademyOwnerRoster />);
    await screen.findByText('FC Sahel');

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    );

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(mockRemoveAcademyMember).not.toHaveBeenCalled();
  });
});
