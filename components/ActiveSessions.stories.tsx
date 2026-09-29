import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { Laptop, ShieldCheck } from 'lucide-react';
import { ToastProvider } from '@/components/ui/Toast';
import type { ActiveSessionSummary } from '@/app/api/auth/sessions/route';

// ActiveSessions calls:
//   - useWallet()                    — WalletContext; no WalletProvider in Storybook
//   - useToast()                     — requires ToastProvider wrapper
//
// Because Storybook uses @storybook/react-vite (not @storybook/nextjs) there
// is no WalletProvider in the story tree.  Each story uses a thin render-function
// wrapper that:
//   1. Wraps in <ToastProvider> (real provider, trivial to mount)
//   2. Renders a presentational shell that mirrors ActiveSessions's markup
//      with the desired state (loading, empty, sessions, error)
//
// This mirrors the WalletButton.stories.tsx pattern — we render the exact
// markup the component would produce, controlled by story props, rather than
// trying to mock hooks at the module level in Storybook.

// ── Story wrapper helpers ───────────────────────────────────────────────────

/**
 * Renders story content inside the required ToastProvider.
 */
function StoryWrapper({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

// ── Session fixtures with realistic user-agent labels ──────────────────────
// Using labels from lib/userAgentLabel.ts for realism

const MOCK_SESSIONS: ActiveSessionSummary[] = [
  {
    id: 'sess-1',
    deviceLabel: 'Chrome on macOS',
    createdAt: 1_700_000_000_000,
    lastSeenAt: 1_700_000_100_000,
    expiresAt: 1_700_008_640_000,
    isCurrent: true,
  },
  {
    id: 'sess-2',
    deviceLabel: 'Safari on iPhone',
    createdAt: 1_699_990_000_000,
    lastSeenAt: 1_700_000_050_000,
    expiresAt: 1_699_998_640_000,
    isCurrent: false,
  },
  {
    id: 'sess-3',
    deviceLabel: 'Firefox on Windows',
    createdAt: 1_699_980_000_000,
    lastSeenAt: 1_699_990_000_000,
    expiresAt: 1_699_988_640_000,
    isCurrent: false,
  },
  {
    id: 'sess-4',
    deviceLabel: 'Edge on Android',
    createdAt: 1_699_970_000_000,
    lastSeenAt: 1_699_980_000_000,
    expiresAt: 1_699_978_640_000,
    isCurrent: false,
  },
];

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

// ── Presentational shells mirroring ActiveSessions markup ──────────────────

/**
 * Mirrors the exact markup ActiveSessions renders when loading=true.
 */
function LoadingState() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-400">Loading sessions…</p>
    </div>
  );
}

/**
 * Mirrors the exact markup ActiveSessions renders when sessions=[].
 */
function EmptyState() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-400">No active sessions found.</p>
    </div>
  );
}

/**
 * Mirrors the exact markup ActiveSessions renders when error=true.
 */
function ErrorState() {
  return (
    <div className="flex flex-col gap-3">
      <p role="alert" className="text-sm text-red-400">
        Failed to load active sessions.
      </p>
    </div>
  );
}

/**
 * Mirrors the exact markup ActiveSessions renders for a session list.
 */
function SessionsList({
  sessions,
  revokingId = null,
}: {
  sessions: ActiveSessionSummary[];
  revokingId?: string | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {sessions.map((session) => (
          <li
            key={session.id}
            className="flex flex-col gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-800 text-gray-400">
                <Laptop size={16} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-white">
                    {session.deviceLabel}
                  </span>
                  {session.isCurrent && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-brand-green/40 bg-brand-green/10 px-2 py-0.5 text-xs font-semibold text-brand-green">
                      <ShieldCheck size={11} aria-hidden="true" />
                      This device
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Signed in {formatTimestamp(session.createdAt)}
                </p>
                <p className="text-xs text-gray-500">
                  Last active {formatTimestamp(session.lastSeenAt)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={fn()}
              disabled={revokingId === session.id}
              className="shrink-0 self-start rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-400 transition hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed sm:self-center"
            >
              {revokingId === session.id ? 'Revoking…' : 'Revoke'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Meta ────────────────────────────────────────────────────────────────────

const meta: Meta = {
  title: 'Components/ActiveSessions',
  component: SessionsList,
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
        pathname: '/en/settings',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

// ── Loading ─────────────────────────────────────────────────────────────────

/**
 * **Loading** — the component is fetching sessions from the server.
 *
 * Shows "Loading sessions…" while the initial fetch is in progress.
 */
export const Loading: Story = {
  render: () => <LoadingState />,
};

// ── Empty ───────────────────────────────────────────────────────────────────

/**
 * **Empty** — no active sessions exist for the authenticated wallet.
 *
 * Displays "No active sessions found." when the API returns an empty list.
 */
export const Empty: Story = {
  render: () => <EmptyState />,
};

// ── Several Sessions with Current Device Marked ───────────────────────────

/**
 * **Several Sessions** — multiple active sessions across different devices.
 *
 * Shows a list of sessions with device labels, timestamps, and a "This device"
 * badge on the current session. Each row has a Revoke button.
 */
export const SeveralSessions: Story = {
  render: () => <SessionsList sessions={MOCK_SESSIONS} />,
};

// ── Revoke in Progress ─────────────────────────────────────────────────────

/**
 * **Revoke in Progress** — a session revocation is currently underway.
 *
 * The Revoke button for the target session shows "Revoking…" and is disabled
 * while the DELETE request is in flight.
 */
export const RevokeInProgress: Story = {
  render: () => (
    <SessionsList sessions={MOCK_SESSIONS} revokingId="sess-2" />
  ),
};

// ── Error ───────────────────────────────────────────────────────────────────

/**
 * **Error** — the session list failed to load.
 *
 * Displays "Failed to load active sessions." when the API request fails.
 */
export const Error: Story = {
  render: () => <ErrorState />,
};
