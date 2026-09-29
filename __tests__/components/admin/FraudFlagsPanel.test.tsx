import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FraudFlagsPanel from '@/components/admin/FraudFlagsPanel';
import { fetchFraudFlags, fetchFraudThrottles } from '@/lib/api';
import type { FraudFlag } from '@/types';

jest.mock('@/lib/api', () => ({
  fetchFraudFlags: jest.fn(),
  fetchFraudThrottles: jest.fn(),
  liftFraudThrottle: jest.fn(),
}));

jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: jest.fn() }),
}));

const mockedFetchFraudFlags = fetchFraudFlags as jest.MockedFunction<
  typeof fetchFraudFlags
>;
const mockedFetchFraudThrottles = fetchFraudThrottles as jest.MockedFunction<
  typeof fetchFraudThrottles
>;

const referralFlag: FraudFlag = {
  id: 'flag-1',
  category: 'referral',
  heuristic: 'circular-referral-ring',
  severity: 'high',
  wallets: ['GWALLETONE00000000000000000000000000000000000000000000'],
  reason: 'Circular referral pattern detected among 4 wallets.',
  evidence: { ringSize: 4, totalRewards: 120 },
};

const payToContactFlag: FraudFlag = {
  id: 'flag-2',
  category: 'pay_to_contact',
  heuristic: 'rapid-unlock-burst',
  severity: 'medium',
  wallets: [
    'GWALLETTWO00000000000000000000000000000000000000000000',
    'GWALLETTHREE0000000000000000000000000000000000000000000',
  ],
  reason: 'Unusually rapid pay-to-contact unlocks from one wallet.',
  evidence: { unlocks: 15, windowMinutes: 10, targets: ['p1', 'p2'] },
};

const validatorFlag: FraudFlag = {
  id: 'flag-3',
  category: 'validator',
  heuristic: 'validator_approval_burst',
  severity: 'high',
  wallets: ['GVALIDATOR000000000000000000000000000000000000000000000'],
  reason: '25 milestone approvals within 10 minutes.',
  evidence: { maxInWindow: 25, events: ['p1@2024-01-01T00:00:00.000Z'] },
};

describe('FraudFlagsPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFetchFraudThrottles.mockResolvedValue({ throttles: [] });
  });

  it('shows validator flags with an alert and a remove-validator action', async () => {
    mockedFetchFraudFlags.mockResolvedValue({
      flags: [validatorFlag],
      warnings: [],
      evaluatedAt: 1_700_000_000_000,
    });
    const onRemoveValidator = jest.fn();

    render(<FraudFlagsPanel onRemoveValidator={onRemoveValidator} />);

    expect(await screen.findByText('Validator')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'High-severity validator activity detected',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove validator' }));
    expect(onRemoveValidator).toHaveBeenCalledWith(validatorFlag.wallets[0]);
  });

  it('shows a loading message while fetching', () => {
    mockedFetchFraudFlags.mockReturnValue(new Promise(() => {}));

    render(<FraudFlagsPanel />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.getByText('Flagged Activity')).toBeInTheDocument();
  });

  it('shows an error message when the fetch fails', async () => {
    mockedFetchFraudFlags.mockRejectedValue(new Error('boom'));

    render(<FraudFlagsPanel />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to load flagged activity.');
  });

  it('shows the empty state when there are no flags and no warnings', async () => {
    mockedFetchFraudFlags.mockResolvedValue({
      flags: [],
      warnings: [],
      evaluatedAt: 1_700_000_000_000,
    });

    render(<FraudFlagsPanel />);

    expect(await screen.findByText('No flags')).toBeInTheDocument();
    expect(
      screen.getByText(
        'No suspicious referral, pay-to-contact or validator patterns detected.',
      ),
    ).toBeInTheDocument();
  });

  it('renders warning banners returned alongside flags', async () => {
    mockedFetchFraudFlags.mockResolvedValue({
      flags: [],
      warnings: ['Fraud detection ran on a partial dataset.'],
      evaluatedAt: 1_700_000_000_000,
    });

    render(<FraudFlagsPanel />);

    const warning = await screen.findByRole('status');
    expect(warning).toHaveTextContent(
      'Fraud detection ran on a partial dataset.',
    );
  });

  it('renders flag cards with severity, category, reason, wallets, and evidence', async () => {
    mockedFetchFraudFlags.mockResolvedValue({
      flags: [referralFlag, payToContactFlag],
      warnings: [],
      evaluatedAt: 1_700_000_000_000,
    });

    render(<FraudFlagsPanel />);

    await waitFor(() =>
      expect(
        screen.getByText('Circular referral pattern detected among 4 wallets.'),
      ).toBeInTheDocument(),
    );

    // Category labels
    expect(screen.getByText('Referral')).toBeInTheDocument();
    expect(screen.getByText('Pay-to-Contact')).toBeInTheDocument();

    // Severity badges
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText('medium')).toBeInTheDocument();

    // Heuristic names
    expect(screen.getByText('circular-referral-ring')).toBeInTheDocument();
    expect(screen.getByText('rapid-unlock-burst')).toBeInTheDocument();

    // Evidence keys are revealed inside a <details> element
    expect(screen.getByText('ringSize')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('totalRewards')).toBeInTheDocument();

    // Array evidence values are joined with commas
    expect(screen.getByText('p1, p2')).toBeInTheDocument();
  });

  it('rate-limits rapid refresh clicks with a short cooldown', async () => {
    mockedFetchFraudFlags.mockResolvedValue({
      flags: [],
      warnings: [],
      evaluatedAt: 1_700_000_000_000,
    });

    render(<FraudFlagsPanel />);
    await screen.findByText('No flags');

    mockedFetchFraudFlags.mockClear();
    const refreshButton = screen.getByRole('button', { name: /^refresh$/i });

    fireEvent.click(refreshButton);
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(mockedFetchFraudFlags).toHaveBeenCalledTimes(1);
    });
  });

  it('does not update state after unmount when the fetch resolves late (no act warning)', async () => {
    let resolvePromise: (v: {
      flags: FraudFlag[];
      warnings: string[];
      evaluatedAt: number;
    }) => void;
    mockedFetchFraudFlags.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      }),
    );

    const { unmount } = render(<FraudFlagsPanel />);
    unmount();

    resolvePromise!({
      flags: [referralFlag],
      warnings: [],
      evaluatedAt: 1_700_000_000_000,
    });
    await Promise.resolve();
  });
});
