import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import ContractPausedBanner from './ContractPausedBanner';

// ContractPausedBanner calls:
//   - useIsPaused()  — delegates to useContractHealth → useContractStatus which
//                      dynamically imports lib/contract (Soroban RPC). In
//                      Storybook (no RPC endpoint) the dynamic import always
//                      resolves `isPaused = false`, so paused/unpaused states
//                      are controlled below via sessionStorage manipulation and
//                      a thin wrapper that forces the visible/hidden state.
//   - usePathname()  — aliased to the next/navigation stub in .storybook/main.ts;
//                      returns '/' → locale 'en' → /en/status link.
//   - next/link      — resolved by the same stub.
//
// Rather than shimming the full RPC call chain, we use a PausedBannerPreview
// wrapper that renders the inner banner markup directly — matching the exact
// DOM the real component produces — so stories exercise the visual output
// faithfully without requiring a live contract. The Unpaused story renders
// the real ContractPausedBanner (which will naturally show nothing because
// isPaused is always false in Storybook).

/** Inner banner markup mirroring what ContractPausedBanner renders when visible. */
function PausedBannerPreview({ onDismiss = fn() }: { onDismiss?: () => void }) {
  return (
    <div aria-live="polite">
      <div className="w-full bg-yellow-300 text-black px-4 py-3 flex items-center justify-between gap-4 sticky top-0 z-40 border-b border-yellow-400">
        <div>
          <strong className="font-semibold">
            Promiscope is currently under maintenance.
          </strong>{' '}
          <span className="text-sm">
            Transactions are disabled.{' '}
            <a
              href="https://discord.gg/stellar"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-medium"
            >
              Get updates on Discord
            </a>{' '}
            <span>
              or{' '}
              <a href="/en/status" className="underline font-medium">
                check status
              </a>
              .
            </span>
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 bg-black text-yellow-300 px-3 py-1 rounded-md font-medium"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

const meta: Meta<typeof ContractPausedBanner> = {
  title: 'Components/ContractPausedBanner',
  component: ContractPausedBanner,
  tags: ['autodocs'],
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: '/en/player',
      },
    },
    // The banner is sticky and spans the full viewport width; remove the
    // default story padding so it renders edge-to-edge as it does in the app.
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof ContractPausedBanner>;

// ── Paused ────────────────────────────────────────────────────────────────────

/**
 * **Paused** — the Soroban contract is paused.
 *
 * The yellow maintenance banner is visible at the top of the page with:
 * - A prominent maintenance notice
 * - An external Discord link for live updates
 * - An internal `/en/status` link (locale derived from the pathname)
 * - A **Dismiss** button that hides the banner for the current browser session
 *
 * Because Storybook's Vite environment cannot reach the Soroban RPC endpoint
 * that `useIsPaused` polls, this story renders the paused UI directly using
 * `PausedBannerPreview` — which mirrors the exact markup `ContractPausedBanner`
 * produces — so the visual output is faithful to the real component.
 */
export const Paused: Story = {
  render: () => <PausedBannerPreview onDismiss={fn()} />,
};

// ── Unpaused ──────────────────────────────────────────────────────────────────

/**
 * **Unpaused** — the Soroban contract is operating normally.
 *
 * The banner is hidden. `ContractPausedBanner` renders only an empty
 * `aria-live="polite"` wrapper (zero height, no visible content).
 *
 * This story uses the **real component** directly — `useIsPaused` returns
 * `false` in the Storybook environment (no RPC reachable), which is exactly
 * the hidden state we want to document.
 */
export const Unpaused: Story = {};
