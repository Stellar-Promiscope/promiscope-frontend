import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from '@testing-library/react';

const ADMIN_ADDRESS = 'G'.padEnd(56, 'A');
const NON_ADMIN_ADDRESS = 'G'.padEnd(56, 'B');

let mockPublicKey: string | null = null;
const mockShow = jest.fn();
const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({ publicKey: mockPublicKey }),
}));

jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: mockShow }),
}));

jest.mock('@/components/ui/ErrorBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockUseContractHealth = jest.fn();
jest.mock('@/hooks/useContractHealth', () => ({
  useContractHealth: () => mockUseContractHealth(),
}));

process.env.NEXT_PUBLIC_ADMIN_ADDRESS = ADMIN_ADDRESS;

const HealthDashboard = require('@/app/[locale]/admin/health/page')
  .default as React.ComponentType;

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
  });
}

function healthyRemoteBody() {
  return {
    indexer: {
      status: 'ok',
      detail: { status: 'ok', lastLedger: 12345, uptime: 600 },
    },
    backend: { status: 'ok', detail: { status: 'ok' } },
    checkedAt: Date.now(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPublicKey = null;
  global.fetch = jest.fn();
  mockUseContractHealth.mockReturnValue({
    healthy: true,
    paused: false,
    loading: false,
  });
});

describe('Admin System Health page', () => {
  it('renders nothing when no wallet is connected', () => {
    mockPublicKey = null;
    const { container } = render(<HealthDashboard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('redirects and shows a toast when connected wallet is not the admin wallet', async () => {
    mockPublicKey = NON_ADMIN_ADDRESS;
    const { container } = render(<HealthDashboard />);

    await waitFor(() => {
      expect(mockShow).toHaveBeenCalledWith({
        message: 'Unauthorized: admin wallet required.',
        variant: 'error',
      });
    });
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(container).toBeEmptyDOMElement();
    // The non-admin gate should short-circuit before any health check fires.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('renders all three sections as healthy when every subsystem is ok', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    mockUseContractHealth.mockReturnValue({
      healthy: true,
      paused: false,
      loading: false,
    });
    mockFetchOnce(healthyRemoteBody());

    render(<HealthDashboard />);

    expect(await screen.findByText('System Health')).toBeInTheDocument();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/health',
        expect.objectContaining({ cache: 'no-store' }),
      );
    });

    const contractSection = await screen.findByTestId(
      'health-section-contract',
    );
    const indexerSection = await screen.findByTestId('health-section-indexer');
    const backendSection = await screen.findByTestId(
      'health-section-backend-api',
    );

    expect(contractSection).toHaveTextContent('Healthy');
    await waitFor(() => expect(indexerSection).toHaveTextContent('Healthy'));
    expect(backendSection).toHaveTextContent('Healthy');

    // Indexer detail fields surfaced from the proxied /health payload.
    expect(indexerSection).toHaveTextContent('12345');
    expect(indexerSection).toHaveTextContent('600s');

    expect(screen.getByTestId('health-last-checked')).not.toHaveTextContent(
      'never',
    );
  });

  it('shows the indexer as unreachable without blocking the contract or backend sections', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    mockUseContractHealth.mockReturnValue({
      healthy: true,
      paused: false,
      loading: false,
    });
    mockFetchOnce({
      indexer: { status: 'unreachable', error: 'Request timed out' },
      backend: { status: 'ok', detail: { status: 'ok' } },
      checkedAt: Date.now(),
    });

    render(<HealthDashboard />);

    const contractSection = await screen.findByTestId(
      'health-section-contract',
    );
    const indexerSection = await screen.findByTestId('health-section-indexer');
    const backendSection = await screen.findByTestId(
      'health-section-backend-api',
    );

    expect(contractSection).toHaveTextContent('Healthy');
    await waitFor(() =>
      expect(indexerSection).toHaveTextContent('Unreachable'),
    );
    expect(indexerSection).toHaveTextContent('Request timed out');
    expect(backendSection).toHaveTextContent('Healthy');
  });

  it('degrades gracefully to "unreachable" for both remote checks when the aggregate route itself fails, without crashing the page', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    mockUseContractHealth.mockReturnValue({
      healthy: true,
      paused: false,
      loading: false,
    });
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error('network error'),
    );

    render(<HealthDashboard />);

    const contractSection = await screen.findByTestId(
      'health-section-contract',
    );
    expect(contractSection).toHaveTextContent('Healthy');

    const indexerSection = await screen.findByTestId('health-section-indexer');
    const backendSection = await screen.findByTestId(
      'health-section-backend-api',
    );
    await waitFor(() =>
      expect(indexerSection).toHaveTextContent('Unreachable'),
    );
    expect(backendSection).toHaveTextContent('Unreachable');
    expect(
      screen.getByText(/last failed with: network error/),
    ).toBeInTheDocument();
  });

  it('renders per-dependency checks with status, latency and a remediation hint', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    mockUseContractHealth.mockReturnValue({
      healthy: true,
      paused: false,
      loading: false,
    });
    mockFetchOnce({
      ...healthyRemoteBody(),
      checks: {
        redis: { status: 'ok', latencyMs: 12 },
        pinata: {
          status: 'degraded',
          latencyMs: 80,
          error: 'Pinata returned HTTP 401',
          hint: 'Check PINATA_API_KEY and PINATA_SECRET',
        },
      },
    });

    render(<HealthDashboard />);

    const redis = await screen.findByTestId('health-section-redis');
    expect(redis).toHaveTextContent('Healthy');
    expect(redis).toHaveTextContent('12 ms');
    const pinata = screen.getByTestId('health-section-pinata');
    expect(pinata).toHaveTextContent('Degraded');
    expect(pinata).toHaveTextContent('Pinata returned HTTP 401');
    expect(pinata).toHaveTextContent('Check PINATA_API_KEY and PINATA_SECRET');
  });

  it('shows the paused/degraded state for the contract section when the circuit breaker is engaged', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    mockUseContractHealth.mockReturnValue({
      healthy: true,
      paused: true,
      loading: false,
    });
    mockFetchOnce(healthyRemoteBody());

    render(<HealthDashboard />);

    const contractSection = await screen.findByTestId(
      'health-section-contract',
    );
    expect(contractSection).toHaveTextContent('Degraded');
    expect(contractSection).toHaveTextContent('circuit breaker is engaged');
  });

  it('re-fetches remote health when the refresh button is clicked', async () => {
    mockPublicKey = ADMIN_ADDRESS;
    mockFetchOnce(healthyRemoteBody());
    mockFetchOnce(healthyRemoteBody());

    render(<HealthDashboard />);
    await screen.findByText('System Health');

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });
});
