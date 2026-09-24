/**
 * Locale-aware number and date formatting, using Intl.NumberFormat /
 * Intl.DateTimeFormat instead of plain string interpolation.
 *
 * Used by the account and notification UI (#1341). Other callers doing manual
 * string formatting for fees, counts, and dates (milestone timestamps,
 * subscription expiry) can switch to these helpers to get correct
 * en/fr/sw output instead of English-style formatting everywhere.
 */

import type { Locale } from './locales';

// BCP 47 tags for next-intl's supported locales.
const INTL_LOCALE_TAG: Record<Locale, string> = {
  en: 'en-US',
  fr: 'fr-FR',
  sw: 'sw-KE',
};

function toIntlLocale(locale: Locale): string {
  return INTL_LOCALE_TAG[locale] ?? 'en-US';
}

export function formatNumber(
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(toIntlLocale(locale), options).format(value);
}

export function formatXlmAmount(value: number, locale: Locale): string {
  return new Intl.NumberFormat(toIntlLocale(locale), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 7,
  }).format(value);
}

export function formatDate(
  value: Date | number,
  locale: Locale,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    dateStyle: 'medium',
    ...options,
  }).format(value);
}

export function formatDateTime(value: Date | number, locale: Locale): string {
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

/** "5 minutes ago" / "il y a 5 minutes" relative to `now` (ms epoch). */
export function formatRelativeTime(
  value: Date | number,
  locale: Locale,
  now: number = Date.now(),
): string {
  const diffMs = new Date(value).getTime() - now;
  const rtf = new Intl.RelativeTimeFormat(toIntlLocale(locale), {
    numeric: 'auto',
  });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(diffMs) >= ms)
      return rtf.format(Math.round(diffMs / ms), unit);
  }
  return rtf.format(Math.round(diffMs / 1000), 'second');
}
