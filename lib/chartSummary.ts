/**
 * Text-alternative helpers for the admin recharts charts. Each chart renders
 * a <figcaption> built from these so screen-reader users get the same
 * headline (total and trend) that sighted users read off the chart.
 */

import { formatXlm } from './formatXlm';
import { formatNumber } from './localeFormat';

/** Percentage change from `previous` to `current`, or null when undefined. */
export function percentChange(
  current: number,
  previous: number,
): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** "up 12%", "down 4%", "unchanged" or null when there is no comparison. */
export function describeTrend(change: number | null): string | null {
  if (change === null) return null;
  const rounded = Math.round(change);
  if (rounded === 0) return 'unchanged';
  return `${rounded > 0 ? 'up' : 'down'} ${formatNumber(Math.abs(rounded), 'en')}%`;
}

export function summarizeFeeRevenue({
  totalXlm,
  previousTotalXlm,
  days,
}: {
  totalXlm: number;
  previousTotalXlm: number | null;
  days: number | null;
}): string {
  const range = days === null ? 'all time' : `the last ${days} days`;
  const base = `Fee revenue over ${range}: ${formatXlm(totalXlm)} XLM total`;
  const trend =
    previousTotalXlm === null
      ? null
      : describeTrend(percentChange(totalXlm, previousTotalXlm));
  return trend ? `${base}, ${trend} from the previous period.` : `${base}.`;
}

export function summarizeCumulative(
  title: string,
  points: { date: string; count: number }[],
): string {
  if (points.length === 0) return `${title}: no data in this range.`;
  const first = points[0];
  const last = points[points.length - 1];
  const delta = last.count - first.count;
  return (
    `${title}: ${formatNumber(last.count, 'en')} as of ${last.date}, ` +
    `${delta >= 0 ? 'up' : 'down'} ${formatNumber(Math.abs(delta), 'en')} ` +
    `since ${first.date}.`
  );
}

export function summarizeWeekly(
  title: string,
  points: { weekStart: string; count: number }[],
): string {
  if (points.length === 0) return `${title}: no data in this range.`;
  const total = points.reduce((sum, p) => sum + p.count, 0);
  const average = total / points.length;
  return (
    `${title}: ${formatNumber(total, 'en')} total over ${points.length} ` +
    `${points.length === 1 ? 'week' : 'weeks'}, averaging ` +
    `${formatNumber(average, 'en', { maximumFractionDigits: 1 })} per week.`
  );
}
