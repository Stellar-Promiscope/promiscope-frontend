import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import FeeRevenueChart from '@/components/admin/FeeRevenueChart';
import { useFeeRevenue } from '@/hooks/useFeeRevenue';
import { useFeeDriftDetection } from '@/hooks/useFeeDriftDetection';
import type { FeeDriftState } from '@/hooks/useFeeDriftDetection';
import type { FeeRevenueData } from '@/hooks/useFeeRevenue';

jest.mock('@/hooks/useFeeRevenue', () => ({
  useFeeRevenue: jest.fn(),
}));

jest.mock('@/hooks/useFeeDriftDetection', () => ({
  useFeeDriftDetection: jest.fn(),
}));

// recharts relies on ResizeObserver and SVG measurement APIs that jsdom does
// not implement. Stub ResponsiveContainer to render children directly so
// chart content is exercised without jsdom layout errors.
jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts') as Record<string, unknown>;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="responsive-container">{children}</div>
    ),
  };
});

const mockUseFeeRevenue = useFeeRevenue as jest.MockedFunction<
  typeof useFeeRevenue
>;
const mockUseFeeDriftDetection = useFeeDriftDetection as jest.MockedFunction<
  typeof useFeeDriftDetection
>;

// ── Helpers ────────────────────────────────────────────────────────────────────

const noDrift: FeeDriftState = {
  hasDrift: false,
  liveContactFee: 1,
  expectedContactFee: 1,
  warningMessage: null,
  loading: false,
  error: null,
  refetch: jest.fn(),
};

function baseRevenue(
  overrides: Partial<ReturnType<typeof useFeeRevenue>> = {},
): ReturnType<typeof useFeeRevenue> {
  return {
    data: null,
    loading: false,
    error: null,
    refetch: jest.fn(),
    ...overrides,
  };
}

const POPULATED_DATA: FeeRevenueData = {
  daily: [
    {
      date: '2026-08-18',
      contactFeeXlm: 3,
      subscriptionXlm: 7,
      totalXlm: 10,
    },
    {
      date: '2026-08-19',
      contactFeeXlm: 5,
      subscriptionXlm: 9,
      totalXlm: 14,
    },
    {
      date: '2026-08-20',
      contactFeeXlm: 2,
      subscriptionXlm: 12,
      totalXlm: 14,
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseFeeDriftDetection.mockReturnValue(noDrift);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('FeeRevenueChart', () => {
  // ── Loading state ────────────────────────────────────────────────────────────
  it('renders the loading state while data is being fetched', () => {
    mockUseFeeRevenue.mockReturnValue(baseRevenue({ loading: true }));

    render(<FeeRevenueChart />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    // Chart and totals should not appear while loading
    expect(
      screen.queryByTestId('responsive-container'),
    ).not.toBeInTheDocument();
  });

  // ── Error state ──────────────────────────────────────────────────────────────
  it('renders an accessible error alert when the hook returns an error', () => {
    mockUseFeeRevenue.mockReturnValue(
      baseRevenue({ error: 'indexer unavailable' }),
    );

    render(<FeeRevenueChart />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      /Failed to load fee revenue. The indexer may be unavailable./i,
    );
    expect(
      screen.queryByTestId('responsive-container'),
    ).not.toBeInTheDocument();
  });

  // ── Empty-data state ─────────────────────────────────────────────────────────
  it('renders the empty state when daily array is empty', () => {
    mockUseFeeRevenue.mockReturnValue(baseRevenue({ data: { daily: [] } }));

    render(<FeeRevenueChart />);

    expect(
      screen.getByText('No fee revenue in this period'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('responsive-container'),
    ).not.toBeInTheDocument();
  });

  it('renders the empty state when the selected period filter excludes all data points', () => {
    // Provide data that only has an "old" day outside the 7-day window
    mockUseFeeRevenue.mockReturnValue(
      baseRevenue({
        data: {
          daily: [
            {
              date: '2020-01-01',
              contactFeeXlm: 5,
              subscriptionXlm: 5,
              totalXlm: 10,
            },
          ],
        },
      }),
    );

    render(<FeeRevenueChart />);

    // Default period is 30d; 2020-01-01 is outside that window.
    expect(
      screen.getByText('No fee revenue in this period'),
    ).toBeInTheDocument();
  });

  // ── Populated revenue series ─────────────────────────────────────────────────
  it('renders totals and the chart when data is present for the selected period', () => {
    mockUseFeeRevenue.mockReturnValue(baseRevenue({ data: POPULATED_DATA }));

    render(<FeeRevenueChart />);

    // Section heading and description
    expect(screen.getByText('Fee Revenue')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Pay-to-contact and subscription fees, sourced from indexed fee-payment events\./i,
      ),
    ).toBeInTheDocument();

    // Totals: 3+5+2 = 10 contact, 7+9+12 = 28 subscription, 38 total
    expect(screen.getByText('Contact Fees')).toBeInTheDocument();
    expect(screen.getByText(/^10\.00\s*XLM$/i)).toBeInTheDocument();

    expect(screen.getByText('Subscriptions')).toBeInTheDocument();
    expect(screen.getByText(/^28\.00\s*XLM$/i)).toBeInTheDocument();

    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText(/^38\.00\s*XLM$/i)).toBeInTheDocument();

    // Chart container is rendered
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });

  it('renders all four period filter buttons', () => {
    mockUseFeeRevenue.mockReturnValue(baseRevenue({ data: POPULATED_DATA }));

    render(<FeeRevenueChart />);

    expect(screen.getByRole('button', { name: '7d' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30d' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '90d' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'All-time' }),
    ).toBeInTheDocument();
  });

  it('switches to the all-time period and shows all data when clicked', () => {
    // Provide an old date that is filtered out by the default 30d window
    const withOldData: FeeRevenueData = {
      daily: [
        ...POPULATED_DATA.daily,
        {
          date: '2020-01-01',
          contactFeeXlm: 100,
          subscriptionXlm: 200,
          totalXlm: 300,
        },
      ],
    };
    mockUseFeeRevenue.mockReturnValue(baseRevenue({ data: withOldData }));

    render(<FeeRevenueChart />);

    // 2020-01-01 is outside 30d, so not included in default total
    expect(screen.queryByText(/^300\.00\s*XLM$/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All-time' }));

    // Now the old entry is included: contact 10+100=110, sub 28+200=228, total 338
    expect(screen.getByText(/^338\.00\s*XLM$/i)).toBeInTheDocument();
  });

  // ── Fee drift warning ────────────────────────────────────────────────────────
  it('shows an accessible drift warning banner when fee drift is detected', () => {
    mockUseFeeRevenue.mockReturnValue(baseRevenue({ data: POPULATED_DATA }));
    mockUseFeeDriftDetection.mockReturnValue({
      hasDrift: true,
      liveContactFee: 2,
      expectedContactFee: 1,
      warningMessage:
        'On-chain fee drift detected: Contract pay-to-contact fee is currently 2 XLM, but the frontend fee schedule is configured for 1 XLM.',
      loading: false,
      error: null,
      refetch: jest.fn(),
    });

    render(<FeeRevenueChart />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/On-chain fee drift detected/i);
  });

  it('does not show a drift warning when there is no drift', () => {
    mockUseFeeRevenue.mockReturnValue(baseRevenue({ data: POPULATED_DATA }));
    mockUseFeeDriftDetection.mockReturnValue(noDrift);

    render(<FeeRevenueChart />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
