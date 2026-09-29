/**
 * Locale-aware number and date formatting, using Intl.NumberFormat /
 * Intl.DateTimeFormat instead of plain string interpolation.
 *
 * Not yet wired into existing components - callers currently doing manual
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

/** e.g. "3 minutes ago" / "il y a 3 minutes", from a past timestamp. */
export function formatRelativeTime(
  value: Date | number,
  locale: Locale,
  now: number = Date.now(),
): string {
  const diffSec = Math.round((Number(value) - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(toIntlLocale(locale), {
    numeric: 'auto',
  });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86400), 'day');
}
