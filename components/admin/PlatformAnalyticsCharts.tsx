'use client';

import { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { usePlatformAnalytics } from '@/hooks/usePlatformAnalytics';
import type { DailyPoint, WeeklyPoint } from '@/hooks/usePlatformAnalytics';
import EmptyState from '@/components/ui/EmptyState';
import DataFreshnessBadge from '@/components/ui/DataFreshnessBadge';

const BRAND_GREEN = '#00C853';
const BRAND_BLUE = '#3B82F6';

function toUnixSeconds(dateInputValue: string): number | undefined {
  if (!dateInputValue) return undefined;
  const ms = new Date(dateInputValue).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

function dailyPointSeconds(point: DailyPoint): number {
  return Math.floor(new Date(`${point.date}T00:00:00Z`).getTime() / 1000);
}

function weeklyPointSeconds(point: WeeklyPoint): number {
  return Math.floor(new Date(`${point.weekStart}T00:00:00Z`).getTime() / 1000);
}

function filterByRange<T>(
  points: T[],
  toSeconds: (point: T) => number,
  from: number | undefined,
  to: number | undefined,
): T[] {
  if (from === undefined && to === undefined) return points;
  return points.filter((p) => {
    const s = toSeconds(p);
    if (from !== undefined && s < from) return false;
    if (to !== undefined && s > to) return false;
    return true;
  });
}

const TOOLTIP_STYLE = {
  backgroundColor: '#111827',
  border: '1px solid #374151',
  borderRadius: 8,
  fontSize: 12,
};

function CumulativeChart({
  title,
  data,
  color,
}: {
  title: string;
  data: DailyPoint[];
  color: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-gray-300">{title}</h3>
      {data.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">
          No data in this range.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart
            data={data}
            margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
            <XAxis
              dataKey="date"
              tick={{ fill: '#9CA3AF', fontSize: 11 }}
              minTickGap={24}
            />
            <YAxis
              tick={{ fill: '#9CA3AF', fontSize: 11 }}
              allowDecimals={false}
              width={40}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: '#E5E7EB' }}
            />
            <Line
              type="monotone"
              dataKey="count"
              stroke={color}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function MilestonesPerWeekChart({ data }: { data: WeeklyPoint[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-gray-300">
        Milestones Approved Per Week
      </h3>
      {data.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">
          No data in this range.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={data}
            margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
            <XAxis
              dataKey="weekStart"
              tick={{ fill: '#9CA3AF', fontSize: 11 }}
              minTickGap={24}
            />
            <YAxis
              tick={{ fill: '#9CA3AF', fontSize: 11 }}
              allowDecimals={false}
              width={40}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: '#E5E7EB' }}
            />
            <Bar dataKey="count" fill={BRAND_GREEN} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export default function PlatformAnalyticsCharts() {
  const { data, loading, error } = usePlatformAnalytics();
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');

  const from = toUnixSeconds(fromInput);
  const to = toUnixSeconds(toInput);

  const filtered = useMemo(() => {
    if (!data) return null;
    return {
      playersCumulative: filterByRange(
        data.playersCumulative,
        dailyPointSeconds,
        from,
        to,
      ),
      scoutsCumulative: filterByRange(
        data.scoutsCumulative,
        dailyPointSeconds,
        from,
        to,
      ),
      milestonesPerWeek: filterByRange(
        data.milestonesPerWeek,
        weeklyPointSeconds,
        from,
        to,
      ),
    };
  }, [data, from, to]);

  return (
    <section className="bg-brand-card border border-gray-800 rounded-xl p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Platform Analytics</h2>
        <p className="text-sm text-gray-400 mt-1">
          Registration and milestone-approval trends, sourced from indexed
          contract history.
        </p>
        <DataFreshnessBadge className="mt-2" />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-gray-400">
          From
          <input
            type="date"
            className="input"
            value={fromInput}
            onChange={(e) => setFromInput(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-400">
          To
          <input
            type="date"
            className="input"
            value={toInput}
            onChange={(e) => setToInput(e.target.value)}
          />
        </label>
        {(fromInput || toInput) && (
          <button
            onClick={() => {
              setFromInput('');
              setToInput('');
            }}
            className="px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:border-brand-green transition text-sm"
          >
            Clear
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-400">
          Failed to load analytics. The indexer may be unavailable.
        </p>
      ) : !filtered ||
        (filtered.playersCumulative.length === 0 &&
          filtered.scoutsCumulative.length === 0 &&
          filtered.milestonesPerWeek.length === 0) ? (
        <EmptyState
          title="No analytics data yet"
          description="Charts will populate as players register, scouts engage, and milestones are approved."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <CumulativeChart
            title="Cumulative Players Registered"
            data={filtered.playersCumulative}
            color={BRAND_GREEN}
          />
          <CumulativeChart
            title="Cumulative Scouts Registered"
            data={filtered.scoutsCumulative}
            color={BRAND_BLUE}
          />
          <div className="lg:col-span-2">
            <MilestonesPerWeekChart data={filtered.milestonesPerWeek} />
          </div>
        </div>
      )}
    </section>
  );
}
