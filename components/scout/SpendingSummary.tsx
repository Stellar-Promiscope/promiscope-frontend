'use client';

import { useSpendingSummary } from '@/hooks/useSpendingSummary';
import { useFeeDriftDetection } from '@/hooks/useFeeDriftDetection';
import { formatXlm } from '@/lib/formatXlm';
import XlmFiatDisplay from '@/components/ui/XlmFiatDisplay';
import Spinner from '@/components/ui/Spinner';
import DataFreshnessBadge from '@/components/ui/DataFreshnessBadge';

/**
 * Spending Summary section displayed on the scout's dashboard.
 *
 * Shows total XLM spent on contact fees, subscriptions, and a combined total,
 * with a month-by-month breakdown for the trailing 12 months.
 *
 * Sources payment events from the indexer (via useSpendingSummary).
 */
export default function SpendingSummary() {
  const { data, loading, error } = useSpendingSummary();
  const { hasDrift, warningMessage } = useFeeDriftDetection();

  if (loading) {
    return (
      <section className="bg-brand-card border border-gray-800 rounded-xl p-6 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-white">Spending Summary</h2>
        <div className="flex justify-center py-8">
          <Spinner size="md" />
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="bg-brand-card border border-gray-800 rounded-xl p-6 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-white">Spending Summary</h2>
        <p className="text-sm text-gray-500">
          {error
            ? 'Could not load spending data. The indexer may be unavailable.'
            : 'No spending data available yet.'}
        </p>
      </section>
    );
  }

  const hasSpending = data.totalXlm > 0;

  return (
    <section className="bg-brand-card border border-gray-800 rounded-xl p-6 flex flex-col gap-6">
      <h2 className="text-lg font-semibold text-white">Spending Summary</h2>
      <DataFreshnessBadge className="self-start" />

      {hasDrift && warningMessage && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-lg border border-yellow-600/50 bg-yellow-950/30 p-3 text-xs text-yellow-300 flex items-start gap-2"
        >
          <span className="text-sm leading-none mt-0.5">⚠️</span>
          <span>{warningMessage}</span>
        </div>
      )}

      {/* Totals */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-lg p-4 text-center">
          <p className="text-xs text-gray-500 mb-1">Contact Fees</p>
          <XlmFiatDisplay
            xlmAmount={data.totalContactFeesXlm}
            className="items-center"
          />
        </div>
        <div className="bg-gray-900 rounded-lg p-4 text-center">
          <p className="text-xs text-gray-500 mb-1">Subscriptions</p>
          <XlmFiatDisplay
            xlmAmount={data.totalSubscriptionsXlm}
            className="items-center"
          />
        </div>
        <div className="bg-gray-900 rounded-lg p-4 text-center">
          <p className="text-xs text-gray-500 mb-1">Total</p>
          <XlmFiatDisplay xlmAmount={data.totalXlm} className="items-center" />
        </div>
      </div>

      {/* Monthly Breakdown */}
      {hasSpending && (
        <div>
          <h3 className="text-sm font-medium text-gray-300 mb-3">
            Monthly Breakdown
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="pb-2 font-medium">Month</th>
                  <th className="pb-2 font-medium text-right">Contact Fees</th>
                  <th className="pb-2 font-medium text-right">Subscriptions</th>
                  <th className="pb-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {data.monthlyBreakdown
                  .filter((m) => m.totalXlm > 0)
                  .map((month) => (
                    <tr key={month.monthKey} className="text-gray-300">
                      <td className="py-2.5 pr-4">{month.label}</td>
                      <td className="py-2.5 text-right tabular-nums">
                        {formatXlm(month.contactFeeXlm)} XLM
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {formatXlm(month.subscriptionXlm)} XLM
                      </td>
                      <td className="py-2.5 text-right tabular-nums font-medium text-white">
                        {formatXlm(month.totalXlm)} XLM
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!hasSpending && (
        <p className="text-sm text-gray-500">
          No payments recorded yet. Your spending history will appear here once
          you start contacting players or subscribing.
        </p>
      )}
    </section>
  );
}
