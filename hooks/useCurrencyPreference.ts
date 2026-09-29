'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CURRENCY_PREFERENCE_KEY } from '@/lib/storageKeys';
import { SUPPORTED_CURRENCIES, type CurrencyCode } from '@/lib/currencies';

// ── Types ──────────────────────────────────────────────────────────────────────

export { SUPPORTED_CURRENCIES, type CurrencyCode };

const DEFAULT_CURRENCY: CurrencyCode = 'USD';

const STORAGE_KEY = CURRENCY_PREFERENCE_KEY;

// ── Helpers ────────────────────────────────────────────────────────────────────

function getStoredCurrency(): CurrencyCode {
  if (typeof window === 'undefined') return DEFAULT_CURRENCY;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED_CURRENCIES.some((c) => c.code === stored)) {
      return stored as CurrencyCode;
    }
  } catch {
    // localStorage unavailable (private browsing, etc.)
  }
  return DEFAULT_CURRENCY;
}

function setStoredCurrency(currency: CurrencyCode): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, currency);
  } catch {
    // Silently ignore storage errors
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export interface CurrencyPreferenceReturn {
  /** Currently selected currency code. */
  currency: CurrencyCode;
  /** Set the currency preference (persisted to localStorage). */
  setCurrency: (c: CurrencyCode) => void;
  /** All supported currencies for the selector UI. */
  supported: typeof SUPPORTED_CURRENCIES;
}

/**
 * Manages the user's fiat currency preference, persisted in localStorage.
 * Used by the currency selector UI and all XLM-to-fiat display call sites.
 */
export function useCurrencyPreference(): CurrencyPreferenceReturn {
  const [currency, setCurrencyState] =
    useState<CurrencyCode>(getStoredCurrency);

  const setCurrency = useCallback((c: CurrencyCode) => {
    setCurrencyState(c);
    setStoredCurrency(c);
  }, []);

  return useMemo(
    () => ({ currency, setCurrency, supported: SUPPORTED_CURRENCIES }),
    [currency, setCurrency],
  );
}
