import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
  cleanup,
} from '@testing-library/react';

const ADMIN_ADDRESS = 'G'.padEnd(56, 'A');
const NON_ADMIN_ADDRESS = 'G'.padEnd(56, 'B');
const VALID_VALIDATOR_ADDRESS = 'G'.padEnd(56, 'C');

let mockPublicKey: string | null = null;
const mockSignAndSubmit = jest.fn();
const mockShow = jest.fn();
const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/en/admin',
}));

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({
    publicKey: mockPublicKey,
    signAndSubmit: mockSignAndSubmit,
  }),
}));

jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: mockShow }),
}));

jest.mock('@/components/ui/ErrorBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/admin/AdminDashboardSkeleton', () => ({
  __esModule: true,
  default: () => <div data-testid="admin-skeleton">Loading skeleton</div>,
}));

// ConfigStatus fetches '/api/admin/config-status' directly via the global
// fetch() (not the axios-based @/lib/api client the other mocks above
// intercept), which jsdom doesn't provide — mock the component itself
// since this suite is testing the surrounding page, not ConfigStatus.
jest.mock('@/components/admin/ConfigStatus', () => ({
  __esModule: true,
  default: () => <div data-testid="config-status" />,
}));

// AcademyManager calls fetchAcademies() from @/lib/api, which the mock
// below doesn't provide (this suite is testing the surrounding page, not
// AcademyManager) — mock the component itself, same as ConfigStatus above.
jest.mock('@/components/admin/AcademyManager', () => ({
  __esModule: true,
  default: () => <div data-testid="academy-manager" />,
}));

// Same as AcademyManager above: fetchFraudFlags() isn't in the @/lib/api
// mock below, so mock the component itself.
jest.mock('@/components/admin/FraudFlagsPanel', () => ({
  __esModule: true,
  default: () => <div data-testid="fraud-flags-panel" />,
}));

jest.mock('@/components/ui/EmptyState', () => ({
  __esModule: true,
  default: ({
    title,
    description,
  }: {
    title: string;
    description?: string;
  }) => (
    <div data-testid="empty-state">
      <p>{title}</p>
      {description && <p>{description}</p>}
    </div>
  ),
}));

jest.mock('@/components/ui/TransactionStatus', () => ({
  __esModule: true,
  default: ({ status }: { status: string | null }) =>
    status ? <div data-testid="tx-status">{status}</div> : null,
}));

jest.mock('@/components/ui/ConfirmDialog', () => ({
  __esModule: true,
  default: ({
    isOpen,
    title,
    message,
    onConfirm,
    onCancel,
    loading,
  }: {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
    loading?: boolean;
  }) =>
    isOpen ? (
      <div data-testid="confirm-dialog">
        <p>{title}</p>
        <p>{message}</p>
        <button onClick={onConfirm} disabled={loading}>
          Confirm
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    ) : null,
}));

jest.mock('@/components/ui/TruncatedAddress', () => ({
  __esModule: true,
  default: ({ address }: { address: string }) => <span>{address}</span>,
}));

const mockGetValidators = jest.fn();
const mockBuildAddValidator = jest.fn();
const mockBuildRemoveValidator = jest.fn();
const mockGetPlatformFees = jest.fn();
const mockBuildWithdrawFees = jest.fn();
const mockBuildPauseContract = jest.fn();
const mockBuildUnpauseContract = jest.fn();
const mockGetContractPaused = jest.fn();

jest.mock('@/lib/contract', () => ({
  getValidators: (...args: unknown[]) => mockGetValidators(...args),
  buildAddValidator: (...args: unknown[]) => mockBuildAddValidator(...args),
  buildRemoveValidator: (...args: unknown[]) =>
    mockBuildRemoveValidator(...args),
  getPlatformFees: (...args: unknown[]) => mockGetPlatformFees(...args),
  buildWithdrawFees: (...args: unknown[]) => mockBuildWithdrawFees(...args),
  buildPauseContract: (...args: unknown[]) => mockBuildPauseContract(...args),
  buildUnpauseContract: (...args: unknown[]) =>
    mockBuildUnpauseContract(...args),
  getContractPaused: (...args: unknown[]) => mockGetContractPaused(...args),
}));

const mockFetchActivityEvents = jest.fn();
const mockGetReferralOverview = jest.fn();
const mockFetchFraudFlagsStatus = jest.fn();
jest.mock('@/lib/api', () => ({
  fetchActivityEvents: (...args: unknown[]) => mockFetchActivityEvents(...args),
  getReferralOverview: (...args: unknown[]) => mockGetReferralOverview(...args),
  // FraudFlagsStalenessBadge (rendered inside the dashboard) reads this on
  // mount — stub it so the module mock stays complete.
  fetchFraudFlagsStatus: (...args: unknown[]) =>
    mockFetchFraudFlagsStatus(...args),
}));

jest.mock('@/lib/contractErrorMessage', () => ({
  parseContractError: (e: unknown) =>
    e instanceof Error ? e.message : 'Unknown error',
}));

process.env.NEXT_PUBLIC_ADMIN_ADDRESS = ADMIN_ADDRESS;

// The admin area is split into routed sections (issue #1354): the guard and
// nav live in AdminShell (rendered by admin/layout.tsx), and each section is
// its own page. Every test renders the shell around the page it exercises.
const AdminShell = require('@/components/admin/AdminShell')
  .default as React.ComponentType<{ children: React.ReactNode }>;
const OverviewPage = require('@/app/[locale]/admin/page')
  .default as React.ComponentType;
const ValidatorsPage = require('@/app/[locale]/admin/validators/page')
  .default as React.ComponentType;
const FeesPage = require('@/app/[locale]/admin/fees/page')
  .default as React.ComponentType;
const ReferralsPage = require('@/app/[locale]/admin/referrals/page')
  .default as React.ComponentType;

function renderAdmin(Page: React.ComponentType = OverviewPage) {
  return render(
    <AdminShell>
      <Page />
    </AdminShell>,
  );
}

function defaultActivity() {
  return { events: [], total: 0 };
}

function defaultReferralOverview() {
  return { totalCodes: 0, totalSuccessfulReferrals: 0, topReferrers: [] };
}

describe('AdminDashboard page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPublicKey = null;
    mockGetValidators.mockResolvedValue([]);
    mockGetPlatformFees.mockResolvedValue(0);
    mockGetContractPaused.mockResolvedValue(false);
    mockFetchActivityEvents.mockResolvedValue(defaultActivity());
    mockGetReferralOverview.mockResolvedValue(defaultReferralOverview());
    mockFetchFraudFlagsStatus.mockResolvedValue({
      evaluatedAt: null,
      highSeverityCount: 0,
      trigger: null,
    });
  });

  it('renders nothing when no wallet is connected', () => {
    mockPublicKey = null;
    const { container } = renderAdmin();
    expect(container).toBeEmptyDOMElement();
  });

  it('redirects and shows a toast when connected wallet is not the admin wallet', async () => {
    mockPublicKey = NON_ADMIN_ADDRESS;
    const { container } = renderAdmin();

    await waitFor(() => {
      expect(mockShow).toHaveBeenCalledWith({
        message: 'Unauthorized: admin wallet required.',
        variant: 'error',
      });
    });
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the skeleton while admin data is loading', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    let resolveValidators: (v: unknown[]) => void = () => {};
    mockGetValidators.mockReturnValue(
      new Promise((resolve) => {
        resolveValidators = resolve;
      }),
    );

    renderAdmin();
    // AdminDashboardSkeleton is lazy-loaded via next/dynamic ({ ssr: false }),
    // so it isn't present on the first synchronous render — only after the
    // dynamic import's promise resolves.
    expect(await screen.findByTestId('admin-skeleton')).toBeInTheDocument();

    await act(async () => {
      resolveValidators([]);
    });
  });

  it('renders the dashboard content once data has loaded', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    mockGetValidators.mockResolvedValue([
      { address: VALID_VALIDATOR_ADDRESS, addedAt: 0, addedBy: ADMIN_ADDRESS },
    ]);
    mockGetPlatformFees.mockResolvedValue(42);
    mockGetContractPaused.mockResolvedValue(false);

    renderAdmin();

    expect(
      await screen.findByRole('heading', { name: 'Admin Dashboard' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    cleanup();

    renderAdmin(FeesPage);
    expect(await screen.findByText(/42\.00 XLM/)).toBeInTheDocument();
    cleanup();

    renderAdmin(ValidatorsPage);
    expect(
      await screen.findByText('Authorized Validators (1)'),
    ).toBeInTheDocument();
    expect(screen.getByText(VALID_VALIDATOR_ADDRESS)).toBeInTheDocument();
  });

  it('shows a "Paused" status and disables mutating actions when the contract is paused', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    mockGetContractPaused.mockResolvedValue(true);
    mockGetPlatformFees.mockResolvedValue(10);

    renderAdmin();

    await screen.findByText('Paused');
    expect(
      screen.getByRole('button', { name: 'Unpause Contract' }),
    ).toBeInTheDocument();
    cleanup();

    renderAdmin(FeesPage);
    expect(
      await screen.findByRole('button', { name: 'Withdraw Fees' }),
    ).toBeDisabled();
    cleanup();

    renderAdmin(ValidatorsPage);
    expect(await screen.findByRole('button', { name: 'Add' })).toBeDisabled();
  });

  it('shows an empty state message when there are no validators', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    renderAdmin(ValidatorsPage);
    expect(
      await screen.findByText('No validators authorized.'),
    ).toBeInTheDocument();
  });

  it('shows the fetch error state and retries on button click', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    mockGetValidators
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([]);

    renderAdmin();

    expect(
      await screen.findByText(/Failed to load admin data/),
    ).toBeInTheDocument();
    expect(mockShow).toHaveBeenCalledWith({
      message: 'Failed to load admin data.',
      variant: 'error',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    });
    expect(mockGetValidators).toHaveBeenCalledTimes(2);
  });

  it('shows a toast when activity events fail to load', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    mockFetchActivityEvents.mockRejectedValue(new Error('activity down'));

    renderAdmin();

    await waitFor(() => {
      expect(mockShow).toHaveBeenCalledWith({
        message: 'Failed to load activity.',
        variant: 'error',
      });
    });
  });

  it('shows the empty state for the activity feed when there are no events', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    renderAdmin();
    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
  });

  it('renders activity events with their labels and pagination controls', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    mockFetchActivityEvents.mockResolvedValue({
      events: [
        {
          id: 'e1',
          type: 'player_registered',
          timestamp: 1700000000,
          actor: ADMIN_ADDRESS,
        },
        {
          id: 'e2',
          type: 'milestone_approved',
          timestamp: 1700000001,
          actor: ADMIN_ADDRESS,
          subjectId: 'player-1',
        },
      ],
      total: 45,
    });

    renderAdmin();

    expect(await screen.findByText('Player Registered')).toBeInTheDocument();
    expect(screen.getByText('Milestone Approved')).toBeInTheDocument();
    expect(screen.getByText('player-1')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();

    const prevButton = screen.getByRole('button', { name: 'Previous' });
    const nextButton = screen.getByRole('button', { name: 'Next' });
    expect(prevButton).toBeDisabled();
    expect(nextButton).not.toBeDisabled();

    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(mockFetchActivityEvents).toHaveBeenLastCalledWith(2, 20);
    });
  });

  it('shows a toast when the referral overview fails to load', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    mockGetReferralOverview.mockRejectedValue(new Error('referrals down'));

    renderAdmin(ReferralsPage);

    await waitFor(() => {
      expect(mockShow).toHaveBeenCalledWith({
        message: 'Failed to load referral program data.',
        variant: 'error',
      });
    });
  });

  it('shows the empty state for the referral program when there is no activity', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    renderAdmin(ReferralsPage);
    expect(
      await screen.findByText('No referral activity yet'),
    ).toBeInTheDocument();
  });

  it('renders referral program totals and top referrers', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    mockGetReferralOverview.mockResolvedValue({
      totalCodes: 12,
      totalSuccessfulReferrals: 5,
      topReferrers: [
        {
          scoutWallet: VALID_VALIDATOR_ADDRESS,
          totalCodes: 8,
          successfulReferrals: 4,
        },
      ],
    });

    renderAdmin(ReferralsPage);

    expect(await screen.findByText('Referral Program')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText(VALID_VALIDATOR_ADDRESS)).toBeInTheDocument();
    expect(screen.getByText('4 referrals · 8 codes')).toBeInTheDocument();
  });

  it('adds a validator through the confirm dialog flow', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    mockBuildAddValidator.mockResolvedValue('add-xdr');
    mockSignAndSubmit.mockResolvedValue({ hash: 'tx-hash' });

    renderAdmin(ValidatorsPage);
    await screen.findByText('Manage Validators');

    const input = screen.getByPlaceholderText('Stellar public key (G...)');
    fireEvent.change(input, { target: { value: VALID_VALIDATOR_ADDRESS } });

    const addButton = screen.getByRole('button', { name: 'Add' });
    expect(addButton).not.toBeDisabled();
    fireEvent.click(addButton);

    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(mockBuildAddValidator).toHaveBeenCalledWith(
        ADMIN_ADDRESS,
        VALID_VALIDATOR_ADDRESS,
      );
    });
    expect(mockSignAndSubmit).toHaveBeenCalledWith('add-xdr');
    await waitFor(() => {
      expect(mockShow).toHaveBeenCalledWith({
        message: 'Validator added.',
        variant: 'success',
      });
    });
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it('removes a validator through the confirm dialog flow', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    mockGetValidators.mockResolvedValue([
      { address: VALID_VALIDATOR_ADDRESS, addedAt: 0, addedBy: ADMIN_ADDRESS },
    ]);
    mockBuildRemoveValidator.mockResolvedValue('remove-xdr');
    mockSignAndSubmit.mockResolvedValue({});

    renderAdmin(ValidatorsPage);
    await screen.findByText(VALID_VALIDATOR_ADDRESS);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(mockBuildRemoveValidator).toHaveBeenCalledWith(
        ADMIN_ADDRESS,
        VALID_VALIDATOR_ADDRESS,
      );
    });
    await waitFor(() => {
      expect(screen.getByText('No validators authorized.')).toBeInTheDocument();
    });
    expect(mockShow).toHaveBeenCalledWith({
      message: 'Validator removed.',
      variant: 'success',
    });
  });

  it('cancels the confirm dialog without invoking the action', async () => {
    mockPublicKey = ADMIN_ADDRESS;

    renderAdmin();
    await screen.findByText('Admin Dashboard');

    fireEvent.click(screen.getByRole('button', { name: 'Pause Contract' }));
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    expect(mockBuildPauseContract).not.toHaveBeenCalled();
  });

  it('withdraws platform fees and shows a success transaction status', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    mockGetPlatformFees.mockResolvedValueOnce(100).mockResolvedValueOnce(0);
    mockBuildWithdrawFees.mockResolvedValue('withdraw-xdr');
    mockSignAndSubmit.mockResolvedValue({ hash: 'withdraw-hash' });

    renderAdmin(FeesPage);
    await screen.findByText(/100\.00 XLM/);

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw Fees' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(mockBuildWithdrawFees).toHaveBeenCalledWith(ADMIN_ADDRESS);
    });
    await waitFor(() => {
      expect(screen.getByTestId('tx-status')).toHaveTextContent('success');
    });
    expect(mockGetPlatformFees).toHaveBeenCalledTimes(2);
  });

  it('shows an error transaction status and toast when withdrawal fails', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    mockGetPlatformFees.mockResolvedValue(100);
    mockBuildWithdrawFees.mockResolvedValue('withdraw-xdr');
    mockSignAndSubmit.mockRejectedValue(new Error('signing failed'));

    renderAdmin(FeesPage);
    await screen.findByText(/100\.00 XLM/);

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw Fees' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(screen.getByTestId('tx-status')).toHaveTextContent('error');
    });
    expect(mockShow).toHaveBeenCalledWith({
      message: 'signing failed',
      variant: 'error',
    });
  });

  it('pauses the contract', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    mockGetContractPaused.mockResolvedValue(false);
    mockBuildPauseContract.mockResolvedValue('pause-xdr');
    mockSignAndSubmit.mockResolvedValue({});

    renderAdmin();
    await screen.findByText('Active');

    fireEvent.click(screen.getByRole('button', { name: 'Pause Contract' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(mockBuildPauseContract).toHaveBeenCalledWith(ADMIN_ADDRESS);
    });
    await waitFor(() => {
      expect(screen.getByText('Paused')).toBeInTheDocument();
    });
    expect(mockShow).toHaveBeenCalledWith({
      message: 'Contract paused.',
      variant: 'warning',
    });
  });

  it('unpauses the contract', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    mockGetContractPaused.mockResolvedValue(true);
    mockBuildUnpauseContract.mockResolvedValue('unpause-xdr');
    mockSignAndSubmit.mockResolvedValue({});

    renderAdmin();
    await screen.findByText('Paused');

    fireEvent.click(screen.getByRole('button', { name: 'Unpause Contract' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(mockBuildUnpauseContract).toHaveBeenCalledWith(ADMIN_ADDRESS);
    });
    await waitFor(() => {
      expect(screen.getByText('Active')).toBeInTheDocument();
    });
    expect(mockShow).toHaveBeenCalledWith({
      message: 'Contract unpaused.',
      variant: 'success',
    });
  });
});
