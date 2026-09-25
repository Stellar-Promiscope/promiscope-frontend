import {
  describeTrend,
  percentChange,
  summarizeCumulative,
  summarizeFeeRevenue,
  summarizeWeekly,
} from '@/lib/chartSummary';

describe('chartSummary', () => {
  it('computes percentage change and guards against a zero baseline', () => {
    expect(percentChange(112, 100)).toBeCloseTo(12);
    expect(percentChange(5, 0)).toBeNull();
  });

  it('describes the trend direction', () => {
    expect(describeTrend(12.4)).toBe('up 12%');
    expect(describeTrend(-4)).toBe('down 4%');
    expect(describeTrend(0.2)).toBe('unchanged');
    expect(describeTrend(null)).toBeNull();
  });

  it('summarizes fee revenue with and without a previous period', () => {
    expect(
      summarizeFeeRevenue({ totalXlm: 1120, previousTotalXlm: 1000, days: 30 }),
    ).toBe(
      'Fee revenue over the last 30 days: 1120.00 XLM total, up 12% from the previous period.',
    );
    expect(
      summarizeFeeRevenue({ totalXlm: 38, previousTotalXlm: null, days: null }),
    ).toBe('Fee revenue over all time: 38.00 XLM total.');
  });

  it('summarizes cumulative and weekly series', () => {
    expect(
      summarizeCumulative('Players', [
        { date: '2026-01-01', count: 100 },
        { date: '2026-01-31', count: 120 },
      ]),
    ).toBe('Players: 120 as of 2026-01-31, up 20 since 2026-01-01.');
    expect(
      summarizeWeekly('Milestones', [
        { weekStart: '2026-01-05', count: 3 },
        { weekStart: '2026-01-12', count: 4 },
      ]),
    ).toBe('Milestones: 7 total over 2 weeks, averaging 3.5 per week.');
    expect(summarizeWeekly('Milestones', [])).toBe(
      'Milestones: no data in this range.',
    );
  });
});
