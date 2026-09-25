'use client';

import {
  useXlmUsdRate,
  convertXlmToFiat,
  formatFiat,
} from '@/hooks/useXlmUsdRate';
import { useCurrencyPreference } from '@/hooks/useCurrencyPreference';
import { formatXlm } from '@/lib/formatXlm';

export interface XlmFiatDisplayProps {
  /** Raw XLM amount to display. */
  xlmAmount: number;
  /** Additional CSS classes for the wrapper. */
  className?: string;
}

/**
 * Displays an XLM amount alongside its approximate fiat equivalent.
 *
 * Shows the XLM value prominently, with a smaller, muted fiat conversion
 * underneath. Gracefully hides the fiat line when the exchange rate API is
 * unreachable, keeping the core XLM display intact.
 *
 * Reads the user's preferred currency from useCurrencyPreference.
 */
export default function XlmFiatDisplay({
  xlmAmount,
  className = '',
}: XlmFiatDisplayProps) {
  const { currency } = useCurrencyPreference();
  const { rate, loading, stale, updatedAt } = useXlmUsdRate(currency);
  const fiatAmount = convertXlmToFiat(xlmAmount, rate);

  return (
    <span className={`inline-flex flex-col ${className}`}>
      <span className="text-gray-900 dark:text-white font-medium">
        {formatXlm(xlmAmount)} XLM
      </span>
      {!loading && fiatAmount !== null && (
        <span
          className="text-xs text-gray-500 dark:text-gray-400"
          title={
            stale
              ? `Exchange rate may be outdated${updatedAt ? ` (last updated ${new Date(updatedAt).toLocaleString()})` : ''}`
              : undefined
          }
        >
          ≈ {formatFiat(fiatAmount, currency)}
          {stale && (
            <>
              <span aria-hidden="true"> *</span>
              <span className="sr-only"> (exchange rate may be outdated)</span>
            </>
          )}
        </span>
      )}
      {/* When loading or rate unavailable: show nothing extra — graceful fallback */}
    </span>
  );
}
