'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import TruncatedAddress from '@/components/ui/TruncatedAddress';
import EmptyState from '@/components/ui/EmptyState';
import DataFreshnessBadge from '@/components/ui/DataFreshnessBadge';
import type { LeaderboardEntry } from './data';
import {
  parseValidatorLeaderboardRange,
  type ValidatorLeaderboardRange,
} from '@/lib/validatorLeaderboard';
import { useValidatorLeaderboard } from '@/hooks/useValidatorLeaderboard';

interface LeaderboardContentProps {
  entries: LeaderboardEntry[];
  range?: ValidatorLeaderboardRange;
}

export default function LeaderboardContent({
  entries: initialEntries,
  range: initialRange = 'all-time',
}: LeaderboardContentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const range = parseValidatorLeaderboardRange(
    searchParams.get('range') ?? initialRange,
  );
  const { entries } = useValidatorLeaderboard(range, initialEntries);

  function changeRange(nextRange: ValidatorLeaderboardRange) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('range', nextRange);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  if (entries.length === 0) {
    return (
      <>
        <RangeSelector range={range} onChange={changeRange} />
        <div className="bg-brand-card border border-gray-800 rounded-xl p-6">
          <EmptyState
            title="No validators yet"
            description="Once validators are added to the contract, they'll appear here ranked by approvals."
          />
        </div>
      </>
    );
  }

  return (
    <>
      <RangeSelector range={range} onChange={changeRange} />
      <DataFreshnessBadge className="self-start" />
      <div className="bg-brand-card border border-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm text-left">
          <caption className="sr-only">
            Validators ranked by approval count
          </caption>
          <thead>
            <tr className="border-b border-gray-800 text-gray-400">
              <th scope="col" className="py-3 pl-6 pr-4 font-medium">
                Rank
              </th>
              <th scope="col" className="py-3 pr-4 font-medium">
                Validator
              </th>
              <th scope="col" className="py-3 pr-4 font-medium">
                Approvals
              </th>
              <th scope="col" className="py-3 pr-6 font-medium">
                Reputation Score
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => (
              <tr
                key={entry.address}
                className="border-b border-gray-800/60 last:border-0"
              >
                <td className="py-3 pl-6 pr-4 text-gray-400 font-mono">
                  {i + 1}
                </td>
                <td className="py-3 pr-4">
                  {entry.isAcademy ? (
                    <span className="text-white font-medium">
                      {entry.displayName}
                    </span>
                  ) : (
                    <TruncatedAddress
                      address={entry.address}
                      className="text-white"
                    />
                  )}
                </td>
                <td className="py-3 pr-4 text-gray-300">
                  {entry.approvalCount !== null ? entry.approvalCount : '—'}
                </td>
                <td className="py-3 pr-6 text-gray-300">
                  {entry.approvalCount !== null
                    ? entry.approvalCount
                    : 'Unavailable'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Link
        href="/validator"
        className="self-start text-sm text-gray-400 hover:text-white transition"
      >
        ← Back to Validator Dashboard
      </Link>
    </>
  );
}

function RangeSelector({
  range,
  onChange,
}: {
  range: ValidatorLeaderboardRange;
  onChange: (range: ValidatorLeaderboardRange) => void;
}) {
  return (
    <label className="flex items-center gap-3 self-start text-sm text-gray-300">
      <span>Time range</span>
      <select
        aria-label="Leaderboard time range"
        value={range}
        onChange={(event) =>
          onChange(event.target.value as ValidatorLeaderboardRange)
        }
        className="rounded border border-gray-700 bg-brand-card px-3 py-2 text-white"
      >
        <option value="week">This week</option>
        <option value="month">This month</option>
        <option value="all-time">All time</option>
      </select>
    </label>
  );
}
