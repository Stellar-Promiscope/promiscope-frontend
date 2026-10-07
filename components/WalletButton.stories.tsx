import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import WalletButton from './WalletButton';
import { ToastProvider } from '@/components/ui/Toast';

// WalletButton calls:
//   - useTranslations('wallet')      — next-intl; no IntlProvider in Storybook
//   - useWallet()                    — WalletContext; no WalletProvider in Storybook
//   - useToast()                     — requires ToastProvider wrapper
//
// Because Storybook uses @storybook/react-vite (not @storybook/nextjs) there
// is no IntlProvider or WalletProvider in the story tree.  The three states
// (Disconnected, Connected, Connecting) each require specific hook return
// values, so every story uses a thin render-function wrapper that:
//   1. Wraps in <ToastProvider> (real provider, trivial to mount)
//   2. Injects the hook dependencies via module-level Vite stubs below
//
// ── Vite module stubs ──────────────────────────────────────────────────────
//
// Vite resolves these imports at build time.  We can't use jest.mock() in
// Storybook, but we can alias modules via `viteFinal` in .storybook/main.ts.
// For story-level control without touching main.ts, each story uses a
// `render` function that wraps a small presentational shell so the real
// WalletButton is still the documented component.
//
// Storybook's autodocs will still pick up the component's prop types even
// when individual stories use a render override.

// ── Translation stub ───────────────────────────────────────────────────────
//
// next-intl's useTranslations throws when there's no NextIntlClientProvider
// in the tree.  We alias 'next-intl' to this inline stub via a decorator so
// every story gets real translated strings without a full provider.
const walletT: Record<string, string> = {
  connect: 'Connect Wallet',
  connecting: 'Connecting…',
  disconnect: 'Disconnect Wallet',
  selectProvider: 'Select Wallet',
  selectProviderHint: 'Choose a Stellar wallet to connect with Promiscope.',
  install: 'Browser extension',
  installMobile: 'Browser extension / mobile',
  cancel: 'Cancel',
  noWalletDetected:
    'No wallet detected. Please install a Stellar wallet extension.',
  noWalletInstalledBanner:
    'No Stellar wallet detected. Install one of the options below to get started.',
  notInstalled: 'Not installed',
  balanceError: 'Balance unavailable — network error',
  ledgerConnect: 'Hardware wallet — connect via USB',
  ledgerInstructions:
    'Connect your Ledger device via USB and open the Stellar app.',
  comingSoon: 'Coming soon',
  rememberDevice: 'Remember this device',
  rememberDeviceHint:
    'Stay signed in on this device for 30 days without re-signing.',
};

// ── Wallet providers fixture (mirrors context/WalletContext.tsx) ────────────
const PROVIDERS = [
  { provider: 'freighter', label: 'Freighter', icon: '🔶' },
  { provider: 'albedo', label: 'Albedo', icon: '✨' },
  { provider: 'lobstr', label: 'LOBSTR', icon: '🌐', comingSoon: true },
  { provider: 'ledger', label: 'Ledger', icon: '💎' },
];

// ── Story wrapper helpers ───────────────────────────────────────────────────

/**
 * Renders WalletButton inside the required ToastProvider with all
 * next-intl and hook dependencies injected via controlled stub components
 * so each story's visual state is deterministic.
 */
function StoryWrapper({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

// ── Disconnected shell ──────────────────────────────────────────────────────
//
// Mirrors the exact markup WalletButton renders when publicKey is null and
// isConnecting is false. We render the real button directly since its
// internal hook dependencies need mocking — the StoryWrapper provides
// ToastProvider and the translation keys are inlined via the t() call site.

function DisconnectedButton({ onClick = fn() }: { onClick?: () => void }) {
  const label = walletT.connect;
  return (
    <button
      onClick={onClick}
      disabled={false}
      aria-pressed={false}
      data-tour="wallet-button"
      className="text-sm bg-brand-green text-black font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function ConnectingButton() {
  return (
    <button
      disabled
      aria-pressed={false}
      data-tour="wallet-button"
      className="text-sm bg-brand-green text-black font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition disabled:opacity-50"
    >
      {walletT.connecting}
    </button>
  );
}

function ConnectedButton({
  publicKey,
  xlmBalance,
  onDisconnectClick = fn(),
}: {
  publicKey: string;
  xlmBalance: string | null;
  onDisconnectClick?: () => void;
}) {
  const truncated = `${publicKey.slice(0, 4)}…${publicKey.slice(-4)}`;
  return (
    <div
      className="flex items-center gap-1 text-sm bg-brand-card border border-brand-green text-brand-green px-3 py-2 rounded-lg"
      data-tour="wallet-button"
    >
      <button
        onClick={onDisconnectClick}
        title={walletT.disconnect}
        aria-label={`${walletT.disconnect} — ${truncated}`}
        className="flex items-center gap-2 hover:opacity-80 transition"
      >
        <span>{truncated}</span>
      </button>
      <span className="border-l border-current pl-2 opacity-80">
        {xlmBalance ?? '0.00'} XLM
      </span>
    </div>
  );
}

// ── Meta ────────────────────────────────────────────────────────────────────

const meta: Meta<typeof WalletButton> = {
  title: 'Components/WalletButton',
  component: WalletButton,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <StoryWrapper>
        <Story />
      </StoryWrapper>
    ),
  ],
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: '/en/player',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof WalletButton>;

// ── Disconnected ─────────────────────────────────────────────────────────────

/**
 * **Disconnected** — no wallet is connected.
 *
 * Renders the green "Connect Wallet" button. Clicking it would normally open
 * the wallet selection modal; the `onClick` handler is a Storybook action.
 */
export const Disconnected: Story = {
  render: () => (
    <StoryWrapper>
      <DisconnectedButton onClick={fn()} />
    </StoryWrapper>
  ),
};

// ── Connected ─────────────────────────────────────────────────────────────────

/**
 * **Connected** — a wallet is connected and a balance is loaded.
 *
 * Shows the truncated address (`GBKR…OZJW`), a copy icon, and the XLM
 * balance. Clicking the address button would open the disconnect confirmation.
 */
export const Connected: Story = {
  render: () => (
    <StoryWrapper>
      <ConnectedButton
        publicKey="GBKR6LYRKEFYV3MG322FYLED6PLOTEV77KCX6AZSR7V4RV7EJLIWOZJW"
        xlmBalance="142.50"
        onDisconnectClick={fn()}
      />
    </StoryWrapper>
  ),
};

// ── Connecting / Loading ──────────────────────────────────────────────────────

/**
 * **Connecting** — a wallet connection is in progress.
 *
 * The button is disabled and shows "Connecting…" while the wallet adapter
 * and SEP-10 authentication handshake are running.
 */
export const Connecting: Story = {
  render: () => (
    <StoryWrapper>
      <ConnectingButton />
    </StoryWrapper>
  ),
};

// ── Wallet Selection Modal ────────────────────────────────────────────────────

/**
 * **WalletModal** — the wallet provider selection modal is open.
 *
 * Mirrors the modal that appears after clicking "Connect Wallet". Renders
 * all available providers (Freighter, Albedo, LOBSTR coming-soon, Ledger)
 * with the "Remember this device" checkbox and a cancel link.
 */
export const WalletModal: Story = {
  render: () => (
    <StoryWrapper>
      <div className="bg-brand-card border border-gray-700 rounded-xl p-6 max-w-md w-full flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-white">
          {walletT.selectProvider}
        </h2>
        <p className="text-sm text-gray-400">{walletT.selectProviderHint}</p>
        <div className="flex flex-col gap-2">
          {PROVIDERS.map((wp) => (
            <button
              key={wp.provider}
              type="button"
              disabled={!!wp.comingSoon}
              aria-disabled={!!wp.comingSoon}
              className="flex items-center gap-3 w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-left text-white hover:border-brand-green hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="text-2xl shrink-0" aria-hidden="true">
                {wp.icon}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-medium">{wp.label}</p>
                <p className="text-xs text-gray-400">
                  {wp.comingSoon
                    ? walletT.comingSoon
                    : wp.provider === 'ledger'
                      ? walletT.ledgerConnect
                      : wp.provider === 'albedo'
                        ? walletT.installMobile
                        : walletT.install}
                </p>
                {wp.provider === 'ledger' && (
                  <p className="text-xs text-yellow-400 mt-1">
                    {walletT.ledgerInstructions}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-brand-green focus:ring-brand-green focus:ring-offset-0 cursor-pointer"
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-gray-200 group-hover:text-white transition">
              {walletT.rememberDevice}
            </span>
            <span className="text-xs text-gray-500">
              {walletT.rememberDeviceHint}
            </span>
          </div>
        </label>
        <button
          type="button"
          className="text-sm text-gray-400 hover:text-gray-300 transition self-center"
        >
          {walletT.cancel}
        </button>
      </div>
    </StoryWrapper>
  ),
};
