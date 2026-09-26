import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AutomatedModerationLog from '@/components/admin/AutomatedModerationLog';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const API = '/api/admin/automated-moderation-log';
const TIMESTAMP = 1_767_225_600; // 2026-01-01T00:00:00Z (unix seconds)

function entry(
  id: number,
  data: Record<string, unknown>,
  target: string | null = null,
) {
  return {
    id,
    actionType: 'automated_moderation',
    adminWallet: 'system',
    target,
    amountStroops: null,
    txHash: null,
    status: 'success',
    timestamp: TIMESTAMP,
    data,
  };
}

const ENTRIES = [
  entry(
    1,
    {
      category: 'spam',
      rule: 'repeated_links',
      severity: 'high',
      userId: 'user-alice',
      context: { links: 5 },
    },
    'thread-1',
  ),
  entry(2, {
    category: 'language',
    rule: 'profanity_filter',
    severity: 'low',
    userId: 'user-bob',
    context: {},
  }),
];

const mockFetch = jest.fn();

function respondWith(body: unknown, ok = true) {
  mockFetch.mockResolvedValue({ ok, json: async () => body });
}

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

describe('AutomatedModerationLog', () => {
  it('shows a loading state while entries are being fetched', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<AutomatedModerationLog />);
    expect(
      screen.getByText('Loading automated moderation entries...'),
    ).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(API);
  });

  it('renders a row per entry with rule, severity, user, thread, and time', async () => {
    respondWith({ entries: ENTRIES });
    render(<AutomatedModerationLog />);

    expect(await screen.findByText('repeated_links')).toBeInTheDocument();
    expect(screen.getByText('profanity_filter')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('High')).toBeInTheDocument();
    expect(within(table).getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('user-alice')).toBeInTheDocument();
    expect(screen.getByText('user-bob')).toBeInTheDocument();
    expect(screen.getByText('thread-1')).toBeInTheDocument();
    expect(screen.getByText('2 entries')).toBeInTheDocument();

    const expectedTime = new Date(TIMESTAMP * 1000).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    expect(screen.getAllByText(expectedTime)).toHaveLength(2);
    expect(
      screen.queryByText('Loading automated moderation entries...'),
    ).not.toBeInTheDocument();
  });

  it('shows the empty state when the API returns no entries', async () => {
    respondWith({ entries: [] });
    render(<AutomatedModerationLog />);
    expect(
      await screen.findByText('No automated moderation entries found.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows an error when the API responds with a non-OK status', async () => {
    respondWith({}, false);
    render(<AutomatedModerationLog />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to load entries',
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows an error when the request itself fails', async () => {
    mockFetch.mockRejectedValue(new Error('Network down'));
    render(<AutomatedModerationLog />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
  });

  it('filters rows by severity', async () => {
    respondWith({ entries: ENTRIES });
    render(<AutomatedModerationLog />);
    await screen.findByText('repeated_links');

    await userEvent.selectOptions(screen.getByRole('combobox'), 'low');
    expect(screen.queryByText('repeated_links')).not.toBeInTheDocument();
    expect(screen.getByText('profanity_filter')).toBeInTheDocument();
  });

  it('filters rows by user ID', async () => {
    respondWith({ entries: ENTRIES });
    render(<AutomatedModerationLog />);
    await screen.findByText('repeated_links');

    await userEvent.type(
      screen.getByPlaceholderText('User ID...'),
      'user-alice',
    );
    expect(screen.getByText('repeated_links')).toBeInTheDocument();
    expect(screen.queryByText('profanity_filter')).not.toBeInTheDocument();
  });

  it('refetches from the API when Refresh is clicked', async () => {
    respondWith({ entries: [] });
    render(<AutomatedModerationLog />);
    await screen.findByText('No automated moderation entries found.');

    respondWith({ entries: ENTRIES });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText('repeated_links')).toBeInTheDocument();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch).toHaveBeenLastCalledWith(API);
  });
});
