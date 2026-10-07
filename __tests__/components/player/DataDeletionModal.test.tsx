import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DataDeletionModal from '@/components/player/DataDeletionModal';

// ── next-intl mock ────────────────────────────────────────────────────────────
// The global mock in jest.setup.ts only knows a small, unrelated set of keys
// (wallet/nav copy) and falls back to returning the raw key for anything
// else. DataDeletionModal's `dataDeletion` namespace isn't in that dict, so
// we install a local mock with the real copy from messages/en.json to make
// assertions readable and to exercise every t() call site.
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      modal_title: 'Request Data Deletion',
      onchain_heading: 'On-Chain Data (Cannot Be Deleted)',
      onchain_description:
        'Your Stellar public key, transaction history, player registration, and payments are stored permanently on the blockchain. No one — including Promiscope — can modify or delete this data.',
      offchain_heading: 'Off-Chain Data (Can Be Deleted)',
      offchain_description:
        'Chat history, profile metadata, contact details, and analytics data stored on our servers can be deleted upon request.',
      request_button: 'Request Data Deletion',
      request_note:
        'Only off-chain records can be deleted. On-chain data is permanent.',
      confirm_title: 'Are you sure?',
      confirm_message:
        "This will submit a request to delete your personal off-chain data from Promiscope's servers. On-chain data cannot be deleted and will remain on the Stellar blockchain permanently.",
      confirm_button: 'Yes, Request Deletion',
      cancel: 'Cancel',
      close: 'Close',
      retry: 'Try Again',
      success_title: 'Request Submitted',
      success_message:
        "Your data deletion request has been submitted. You'll receive confirmation once your off-chain records have been processed.",
      success_toast: 'Data deletion request submitted successfully.',
      error_toast: 'Failed to submit the request. Please try again.',
      error_message:
        'Something went wrong submitting your request. Please try again.',
      submitting: 'Submitting your request…',
      done: 'Done',
    };
    return messages[key] ?? key;
  },
}));

const mockShow = jest.fn();

jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: mockShow }),
}));

const onClose = jest.fn();

function mockFetchOnce(response: {
  ok: boolean;
  json?: () => Promise<unknown>;
}) {
  (global.fetch as jest.Mock).mockResolvedValueOnce(response);
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

describe('DataDeletionModal', () => {
  it('renders nothing when isOpen is false', () => {
    render(<DataDeletionModal isOpen={false} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the idle state with on-chain/off-chain explanations and a request button', () => {
    render(<DataDeletionModal isOpen onClose={onClose} />);

    expect(
      screen.getByRole('heading', { name: 'Request Data Deletion' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('On-Chain Data (Cannot Be Deleted)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Off-Chain Data (Can Be Deleted)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Only off-chain records can be deleted. On-chain data is permanent.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Request Data Deletion' }),
    ).toBeInTheDocument();
  });

  it('moves to the confirming state when the request button is clicked', async () => {
    const user = userEvent.setup();
    render(<DataDeletionModal isOpen onClose={onClose} />);

    await user.click(
      screen.getByRole('button', { name: 'Request Data Deletion' }),
    );

    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Yes, Request Deletion' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('returns to idle when cancel is clicked from the confirming state', async () => {
    const user = userEvent.setup();
    render(<DataDeletionModal isOpen onClose={onClose} />);

    await user.click(
      screen.getByRole('button', { name: 'Request Data Deletion' }),
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Are you sure?')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Request Data Deletion' }),
    ).toBeInTheDocument();
  });

  it('submits the deletion request and shows the success state', async () => {
    const user = userEvent.setup();
    mockFetchOnce({ ok: true });

    render(<DataDeletionModal isOpen onClose={onClose} />);

    await user.click(
      screen.getByRole('button', { name: 'Request Data Deletion' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Yes, Request Deletion' }),
    );

    await waitFor(() => {
      expect(screen.getByText('Request Submitted')).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/data-deletion/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(mockShow).toHaveBeenCalledWith({
      message: 'Data deletion request submitted successfully.',
      variant: 'success',
      duration: 6000,
    });

    // Done closes and resets the modal.
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the submitting spinner while the request is in flight', async () => {
    const user = userEvent.setup();
    let resolveFetch: (value: { ok: boolean }) => void = () => {};
    (global.fetch as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(<DataDeletionModal isOpen onClose={onClose} />);

    await user.click(
      screen.getByRole('button', { name: 'Request Data Deletion' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Yes, Request Deletion' }),
    );

    expect(screen.getByText('Submitting your request…')).toBeInTheDocument();

    resolveFetch({ ok: true });
    await waitFor(() => {
      expect(screen.getByText('Request Submitted')).toBeInTheDocument();
    });
  });

  it('shows the error state with the server-provided error message in the toast', async () => {
    const user = userEvent.setup();
    mockFetchOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Server exploded' }),
    });

    render(<DataDeletionModal isOpen onClose={onClose} />);

    await user.click(
      screen.getByRole('button', { name: 'Request Data Deletion' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Yes, Request Deletion' }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          'Something went wrong submitting your request. Please try again.',
        ),
      ).toBeInTheDocument();
    });

    expect(mockShow).toHaveBeenCalledWith({
      message: 'Server exploded',
      variant: 'error',
      duration: 6000,
    });
  });

  it('falls back to a generic error message when the failed response has no JSON body', async () => {
    const user = userEvent.setup();
    mockFetchOnce({
      ok: false,
      json: () => Promise.reject(new Error('not json')),
    });

    render(<DataDeletionModal isOpen onClose={onClose} />);

    await user.click(
      screen.getByRole('button', { name: 'Request Data Deletion' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Yes, Request Deletion' }),
    );

    await waitFor(() => {
      expect(mockShow).toHaveBeenCalledWith({
        message: 'Request failed',
        variant: 'error',
        duration: 6000,
      });
    });
  });

  it('shows the generic error toast copy when fetch rejects with a non-Error value', async () => {
    const user = userEvent.setup();
    (global.fetch as jest.Mock).mockRejectedValueOnce('network down');

    render(<DataDeletionModal isOpen onClose={onClose} />);

    await user.click(
      screen.getByRole('button', { name: 'Request Data Deletion' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Yes, Request Deletion' }),
    );

    await waitFor(() => {
      expect(mockShow).toHaveBeenCalledWith({
        message: 'Failed to submit the request. Please try again.',
        variant: 'error',
        duration: 6000,
      });
    });
  });

  it('retries from the error state back to confirming', async () => {
    const user = userEvent.setup();
    mockFetchOnce({ ok: false, json: () => Promise.resolve({}) });

    render(<DataDeletionModal isOpen onClose={onClose} />);

    await user.click(
      screen.getByRole('button', { name: 'Request Data Deletion' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Yes, Request Deletion' }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Try Again' }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('closes and resets state when close is clicked from the error state', async () => {
    const user = userEvent.setup();
    mockFetchOnce({ ok: false, json: () => Promise.resolve({}) });

    render(<DataDeletionModal isOpen onClose={onClose} />);

    await user.click(
      screen.getByRole('button', { name: 'Request Data Deletion' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Yes, Request Deletion' }),
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
