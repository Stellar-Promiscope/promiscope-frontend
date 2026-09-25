'use client';
import { useLocale } from 'next-intl';
import { useIndexerFreshness } from '@/hooks/useIndexerFreshness';
import { formatRelativeTime } from '@/lib/localeFormat';
import type { Locale } from '@/lib/locales';

/**
 * Shows how fresh indexer-derived data is (see #1357), with a warning style
 * once the indexer lags past the threshold. Styling mirrors
 * components/admin/FraudFlagsStalenessBadge.tsx.
 */
export default function DataFreshnessBadge({
  className = '',
}: {
  className?: string;
}) {
  const locale = useLocale() as Locale;
  const { data, stale, pendingWrite } = useIndexerFreshness();

  if (!data?.lastUpdated && !pendingWrite) return null;

  const style = stale
    ? 'border-yellow-600 bg-yellow-950/30 text-yellow-400'
    : 'border-gray-700 bg-gray-900 text-gray-400';

  return (
    <span
      role="status"
      data-stale={stale ? 'true' : 'false'}
      className={`inline-flex flex-wrap items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${style} ${className}`}
      title="Indexer data freshness"
    >
      {data?.lastUpdated ? (
        <>
          Updated {formatRelativeTime(data.lastUpdated, locale)}
          {stale && ' · data may be out of date'}
        </>
      ) : null}
      {pendingWrite && (
        <span>Your change may take up to a minute to appear</span>
      )}
    </span>
  );
}
