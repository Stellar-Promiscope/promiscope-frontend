import type { Meta, StoryObj, Decorator, StoryFn } from '@storybook/react';
import { useEffect } from 'react';
import XlmFiatDisplay from './XlmFiatDisplay';

// ── Storybook hook-seeding helpers ────────────────────────────────────────────
//
// XlmFiatDisplay calls two hooks at render time:
//
//   • useCurrencyPreference — reads localStorage; works fine in Storybook
//     (returns USD by default when storage is empty).
//   • useXlmUsdRate — fires a real /api/rates/xlm fetch. That makes the "loading"
//     state impossible to pin down in a story and introduces flaky network
//     dependency. We pre-fill the module-level in-memory cache the hook uses
//     so it resolves synchronously on first render with no network call.
//
// The cache object (`rateCache`) is a plain Map that lives in the hook module's
// module scope. Vite's module cache means a dynamic import() here returns the
// same module instance the hook uses, so writing to `rateCache` directly
// controls what the hook sees on mount. We access it via a dynamic import to
// avoid a circular dependency at parse time.
//
// For the LoadingExchangeRate story we deliberately leave the cache empty
// (rate=null), which keeps the hook in its initial loading: true, rate: null
// state — identical to how it behaves before the first rate response.

const STORAGE_KEY = 'scoutoff_currency_preference';

// ── Decorator factory ─────────────────────────────────────────────────────────

/**
 * Returns a Storybook Decorator that:
 *  1. Writes `currency` to localStorage so useCurrencyPreference picks it up.
 *  2. Optionally seeds the useXlmUsdRate module cache with `rate` so the hook
 *     resolves instantly without a live network request.
 *
 * Cleans up localStorage on unmount so stories don't bleed into each other.
 */
function withCurrencyAndRate(currency: string, rate: number | null): Decorator {
  return function CurrencyRateDecorator(Story: StoryFn) {
    useEffect(() => {
      try {
        localStorage.setItem(STORAGE_KEY, currency);
      } catch {
        // localStorage unavailable (e.g. sandboxed iframe)
      }

      if (rate !== null) {
        // Dynamically import the hook module to get the shared Map instance.
        import('@/hooks/useXlmUsdRate').then((mod) => {
          const m = mod as unknown as {
            rateCache: Map<string, { rate: number; fetchedAt: number }>;
          };
          if (m.rateCache) {
            m.rateCache.set(`xlm:${currency}`, {
              rate,
              fetchedAt: Date.now(),
            });
          }
        });
      }

      return () => {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // ignore
        }
      };
    }, []);

    return <Story />;
  };
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta: Meta<typeof XlmFiatDisplay> = {
  title: 'UI/XlmFiatDisplay',
  component: XlmFiatDisplay,
  tags: ['autodocs'],
  parameters: {
    nextjs: { appDirectory: true },
  },
};

export default meta;
type Story = StoryObj<typeof XlmFiatDisplay>;

// ── Stories ───────────────────────────────────────────────────────────────────

/**
 * XLM-primary preference — user's chosen currency is USD (the default).
 * Shows the XLM amount prominently with the USD fiat equivalent on the second
 * line. Rate cache is pre-seeded so no live network call is made.
 */
export const XlmPrimary: Story = {
  name: 'XLM-primary preference (USD fiat)',
  decorators: [withCurrencyAndRate('USD', 0.11)],
  args: {
    xlmAmount: 50,
  },
};

/**
 * Fiat-primary preference — user has switched to EUR. Verifies the component
 * reads the stored preference correctly and formats the fiat figure with the
 * Euro symbol.
 */
export const FiatPrimary: Story = {
  name: 'Fiat-primary preference (EUR)',
  decorators: [withCurrencyAndRate('EUR', 0.1)],
  args: {
    xlmAmount: 50,
  },
};

/**
 * Loading exchange rate — the fiat line is completely hidden while the rate
 * is still being fetched. Only the XLM amount is visible, which is the
 * component's intentional graceful fallback.
 *
 * Achieved by leaving the rate cache empty (rate = null) so the hook stays
 * in its initial loading: true, rate: null state for the life of the story.
 */
export const LoadingExchangeRate: Story = {
  name: 'Loading exchange rate (fiat line hidden)',
  decorators: [withCurrencyAndRate('USD', null)],
  args: {
    xlmAmount: 50,
  },
};

/**
 * Large XLM amount — exercises the formatXlm rounding helper and confirms the
 * fiat figure remains legible at 4-figure XLM values.
 */
export const LargeAmount: Story = {
  name: 'Large XLM amount',
  decorators: [withCurrencyAndRate('USD', 0.11)],
  args: {
    xlmAmount: 10_000,
  },
};

/**
 * Kenyan Shilling (KES) fiat preference — confirms the currency symbol mapping
 * in formatFiat works across the full supported-currency list, not just the
 * western defaults.
 */
export const KenyanShilling: Story = {
  name: 'KES fiat preference',
  decorators: [withCurrencyAndRate('KES', 14.5)],
  args: {
    xlmAmount: 25,
  },
};
