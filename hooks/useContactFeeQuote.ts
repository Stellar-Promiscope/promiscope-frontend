'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  fetchStrictReceiveQuote,
  USDC,
  type FeeAsset,
  type PathQuote,
} from '@/lib/pathPayment';

/**
 * Fetches a Horizon strict-receive quote for paying `feeXlm` with `asset`
 * (issue #1321) and tracks how long it stays valid. The quote is not
 * refreshed automatically once it expires: the scout must refresh it, so they
 * always see the price they are agreeing to.
 */
export function useContactFeeQuote(
  feeXlm: number,
  enabled: boolean,
  asset: FeeAsset = USDC,
) {
  const [quote, setQuote] = useState<PathQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setQuote(await fetchStrictReceiveQuote(feeXlm, asset));
    } catch (err) {
      setQuote(null);
      setError(err instanceof Error ? err.message : 'Could not fetch a quote');
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, [feeXlm, asset]);

  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!quote) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [quote]);

  const secondsLeft = quote
    ? Math.max(0, Math.ceil((quote.expiresAt - now) / 1000))
    : 0;

  return {
    quote,
    error,
    loading,
    refresh,
    secondsLeft,
    expired: quote !== null && secondsLeft === 0,
  };
}
