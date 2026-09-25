/**
 * Hardcoded subset of ISO 4217 codes the platform supports for display.
 * Lives outside the 'use client' hook so server routes can validate against it.
 */
export const SUPPORTED_CURRENCIES = [
  { code: 'USD', label: 'US Dollar ($)' },
  { code: 'EUR', label: 'Euro (€)' },
  { code: 'GBP', label: 'British Pound (£)' },
  { code: 'NGN', label: 'Nigerian Naira (₦)' },
  { code: 'KES', label: 'Kenyan Shilling (KSh)' },
  { code: 'ZAR', label: 'South African Rand (R)' },
  { code: 'JPY', label: 'Japanese Yen (¥)' },
  { code: 'CAD', label: 'Canadian Dollar (CA$)' },
  { code: 'AUD', label: 'Australian Dollar (A$)' },
  { code: 'BRL', label: 'Brazilian Real (R$)' },
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]['code'];
