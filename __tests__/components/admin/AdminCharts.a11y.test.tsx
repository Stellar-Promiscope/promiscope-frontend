import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import FeeRevenueChart from '@/components/admin/FeeRevenueChart';
import PlatformAnalyticsCharts from '@/components/admin/PlatformAnalyticsCharts';

expect.extend(toHaveNoViolations);

jest.mock('@/hooks/useFeeRevenue', () => ({
  useFeeRevenue: () => ({
    data: {
      daily: [
        {
          date: '2020-01-01',
          contactFeeXlm: 3,
          subscriptionXlm: 7,
          totalXlm: 10,
        },
        {
          date: '2020-01-02',
          contactFeeXlm: 5,
          subscriptionXlm: 9,
          totalXlm: 14,
        },
      ],
    },
    loading: false,
    error: null,
    refetch: jest.fn(),
  }),
}));

jest.mock('@/hooks/useFeeDriftDetection', () => ({
  useFeeDriftDetection: () => ({ hasDrift: false, warningMessage: null }),
}));

jest.mock('@/hooks/usePlatformAnalytics', () => ({
  usePlatformAnalytics: () => ({
    data: {
      playersCumulative: [
        { date: '2024-01-01', count: 10 },
        { date: '2024-01-03', count: 42 },
      ],
      scoutsCumulative: [{ date: '2024-01-01', count: 3 }],
      milestonesPerWeek: [
        { weekStart: '2023-12-25', count: 5 },
        { weekStart: '2024-01-01', count: 14 },
      ],
    },
    loading: false,
    error: null,
    refetch: jest.fn(),
  }),
}));

// jsdom has no ResizeObserver/SVG layout; render chart children directly.
jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts') as Record<string, unknown>;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
  };
});

describe('admin chart accessibility', () => {
  it('FeeRevenueChart exposes a summary and a data table with no axe violations', async () => {
    const { container } = render(<FeeRevenueChart />);
    fireEvent.click(screen.getByRole('button', { name: 'All-time' }));

    expect(
      screen.getByText('Fee revenue over all time: 24.00 XLM total.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    const table = screen.getByRole('table', {
      name: 'Daily fee revenue (XLM)',
    });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(
      within(rows[2])
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['5.00', '9.00', '14.00']);

    expect(await axe(container)).toHaveNoViolations();
  });

  it('PlatformAnalyticsCharts exposes summaries and data tables with no axe violations', async () => {
    const { container } = render(<PlatformAnalyticsCharts />);

    expect(
      screen.getByText(
        'Cumulative Players Registered: 42 as of 2024-01-03, up 32 since 2024-01-01.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Milestones Approved Per Week: 19 total over 2 weeks, averaging 9.5 per week.',
      ),
    ).toBeInTheDocument();

    screen
      .getAllByRole('button', { name: 'Show as table' })
      .forEach((b) => fireEvent.click(b));
    const weekly = screen.getByRole('table', {
      name: 'Milestones Approved Per Week',
    });
    expect(
      within(weekly)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['5', '14']);

    expect(await axe(container)).toHaveNoViolations();
  });
});
