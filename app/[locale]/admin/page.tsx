'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useWallet } from '@/hooks/useWallet';
import { useToast } from '@/components/ui/Toast';
import EmptyState from '@/components/ui/EmptyState';
import { recordAuditEntry } from '@/lib/adminAuditClient';
import { buildPauseContract, buildUnpauseContract } from '@/lib/contract';
import {
  fetchActivityEvents,
  type ActivityEvent,
  type ActivityEventType,
} from '@/lib/api';
import TruncatedAddress from '@/components/ui/TruncatedAddress';
import ConfigStatus from '@/components/admin/ConfigStatus';
import FraudFlagsStalenessBadge from '@/components/admin/FraudFlagsStalenessBadge';
import AdminLoadError from '@/components/admin/AdminLoadError';
import { useAdminConfirm } from '@/components/admin/useAdminConfirm';
import { useAdminContractState } from '@/hooks/useAdminContractState';

// Admin-only components lazy-loaded to avoid bundling into shared chunks
// for the much larger player/scout user base (issue #967).
const AdminDashboardSkeleton = dynamic(
  () => import('@/components/admin/AdminDashboardSkeleton'),
  {
    ssr: false,
    loading: () => (
      <div className="bg-brand-card border border-gray-800 rounded-xl p-6 h-64 motion-safe:animate-pulse" />
    ),
  },
);
const PlatformAnalyticsCharts = dynamic(
  () => import('@/components/admin/PlatformAnalyticsCharts'),
  {
    ssr: false,
    loading: () => (
      <div className="bg-brand-card border border-gray-800 rounded-xl p-6 animate-pulse h-64" />
    ),
  },
);

const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID ?? '';
const ACTIVITY_PAGE_SIZE = 20;
const COPIED_RESET_MS = 2000;

function copyToClipboard(text: string) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text);
  }
}

const EVENT_LABELS: Record<ActivityEventType, string> = {
  player_registered: 'Player Registered',
  milestone_approved: 'Milestone Approved',
  milestone_revoked: 'Milestone Revoked',
  scout_subscribed: 'Scout Subscribed',
  player_contacted: 'Player Contacted',
  fees_withdrawn: 'Fees Withdrawn',
};

/**
 * /admin — overview: contract info, circuit breaker, runtime config,
 * activity and platform analytics. Each other admin area has its own route
 * (see components/admin/AdminNav.tsx); the admin guard lives in the layout.
 */
export default function AdminOverviewPage() {
  const { publicKey, signAndSubmit } = useWallet();
  const { show } = useToast();
  const { paused, setPaused, loading, fetchError, reload } =
    useAdminContractState();
  const { confirm, dialog } = useAdminConfirm();

  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityPage, setActivityPage] = useState(1);
  const [activityLoading, setActivityLoading] = useState(false);

  const [contractIdCopied, setContractIdCopied] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyResetTimer.current !== null) clearTimeout(copyResetTimer.current);
    },
    [],
  );

  const handleCopyContractId = useCallback(() => {
    copyToClipboard(CONTRACT_ID);
    setContractIdCopied(true);
    if (copyResetTimer.current !== null) clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(
      () => setContractIdCopied(false),
      COPIED_RESET_MS,
    );
  }, []);

  useEffect(() => {
    setActivityLoading(true);
    fetchActivityEvents(activityPage, ACTIVITY_PAGE_SIZE)
      .then(({ events, total }) => {
        setActivity(events);
        setActivityTotal(total);
      })
      .catch(() =>
        show({ message: 'Failed to load activity.', variant: 'error' }),
      )
      .finally(() => setActivityLoading(false));
  }, [activityPage, show]);

  function togglePause() {
    if (!publicKey) return;
    if (paused) {
      confirm({
        label: 'Unpause Contract',
        message: 'Are you sure you want to unpause the contract?',
        run: async () => {
          const txHash = await signAndSubmit(
            await buildUnpauseContract(publicKey),
          );
          recordAuditEntry({
            actionType: 'unpause',
            txHash,
            status: 'submitted',
          }).catch(() => {});
          setPaused(false);
          show({ message: 'Contract unpaused.', variant: 'success' });
        },
      });
    } else {
      confirm({
        label: 'Pause Contract',
        message:
          'Are you sure you want to pause the contract? All operations will halt.',
        run: async () => {
          const txHash = await signAndSubmit(
            await buildPauseContract(publicKey),
          );
          recordAuditEntry({
            actionType: 'pause',
            txHash,
            status: 'submitted',
          }).catch(() => {});
          setPaused(true);
          show({ message: 'Contract paused.', variant: 'warning' });
        },
      });
    }
  }

  if (loading) return <AdminDashboardSkeleton />;
  if (fetchError) return <AdminLoadError onRetry={reload} />;

  const activityTotalPages = Math.ceil(activityTotal / ACTIVITY_PAGE_SIZE);

  return (
    <div className="max-w-3xl flex flex-col gap-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-3xl font-bold text-white">Admin Dashboard</h1>
        <FraudFlagsStalenessBadge />
      </div>

      {/* Contract Info */}
      <section className="bg-brand-card border border-gray-800 rounded-xl p-6 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-white">Contract</h2>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-sm text-gray-300 truncate">
            {CONTRACT_ID}
          </code>
          <button
            onClick={handleCopyContractId}
            aria-label="Copy contract ID to clipboard"
            className="shrink-0 rounded px-2 py-1 text-xs font-medium transition bg-gray-700 text-gray-300 hover:bg-gray-600"
          >
            {contractIdCopied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </section>

      {/* Circuit Breaker */}
      <section className="bg-brand-card border border-gray-800 rounded-xl p-6 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-white">Circuit Breaker</h2>
        <p className="text-sm text-gray-400">
          Status:{' '}
          <span
            className={
              paused
                ? 'text-red-400 font-medium'
                : 'text-brand-green font-medium'
            }
          >
            {paused ? 'Paused' : 'Active'}
          </span>
        </p>
        <button
          onClick={togglePause}
          className={`w-fit px-5 py-2 rounded-lg font-semibold transition ${paused ? 'bg-brand-green text-black hover:opacity-90' : 'bg-red-600 text-white hover:bg-red-700'}`}
        >
          {paused ? 'Unpause Contract' : 'Pause Contract'}
        </button>
      </section>

      {/* Runtime Configuration Status */}
      <ConfigStatus />

      {/* Activity Feed */}
      <section className="bg-brand-card border border-gray-800 rounded-xl p-6 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-white">Activity</h2>
        {activityLoading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : activity.length === 0 ? (
          <EmptyState
            title="No activity yet"
            description="Contract events will appear here once transactions are recorded."
          />
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-gray-800">
              {activity.map((event) => (
                <li
                  key={event.id}
                  className="flex items-center gap-4 py-3 text-sm first:pt-0 last:pb-0"
                >
                  <span className="text-gray-200 shrink-0">
                    {EVENT_LABELS[event.type]}
                  </span>
                  <span className="font-mono text-gray-400 truncate">
                    <TruncatedAddress
                      address={event.actor}
                      className="text-gray-400"
                    />
                  </span>
                  {event.subjectId && (
                    <span className="font-mono text-gray-400 truncate">
                      <TruncatedAddress
                        address={event.subjectId}
                        className="text-gray-400"
                      />
                    </span>
                  )}
                  <span className="text-gray-400 shrink-0 ml-auto">
                    {new Date(event.timestamp * 1000).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
            {activityTotal > ACTIVITY_PAGE_SIZE && (
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
                  disabled={activityPage <= 1}
                  className="px-4 py-2 rounded-lg border border-gray-700 text-gray-300 disabled:opacity-40 hover:border-brand-green transition"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-400">
                  Page {activityPage} of {activityTotalPages}
                </span>
                <button
                  onClick={() =>
                    setActivityPage((p) => Math.min(activityTotalPages, p + 1))
                  }
                  disabled={activityPage >= activityTotalPages}
                  className="px-4 py-2 rounded-lg border border-gray-700 text-gray-300 disabled:opacity-40 hover:border-brand-green transition"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <PlatformAnalyticsCharts />

      <FeeRevenueChart />

      {/* Referral Program */}
      <section className="bg-brand-card border border-gray-800 rounded-xl p-6 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-white">Referral Program</h2>
        {referralLoading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : !referralOverview || referralOverview.totalCodes === 0 ? (
          <EmptyState
            title="No referral activity yet"
            description="Codes and successful referrals generated by scouts will appear here."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">
                  Codes Generated
                </p>
                <p className="text-2xl font-semibold text-white">
                  {referralOverview.totalCodes}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">
                  Successful Referrals
                </p>
                <p className="text-2xl font-semibold text-white">
                  {referralOverview.totalSuccessfulReferrals}
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-2">
                Top Referrers
              </h3>
              <ul className="flex flex-col divide-y divide-gray-800">
                {referralOverview.topReferrers.map((r) => (
                  <li
                    key={r.scoutWallet}
                    className="flex items-center justify-between gap-4 py-2 text-sm"
                  >
                    <span className="font-mono text-gray-300 truncate">
                      <TruncatedAddress
                        address={r.scoutWallet}
                        className="text-gray-300"
                      />
                    </span>
                    <span className="text-gray-400 shrink-0">
                      {r.successfulReferrals} referral
                      {r.successfulReferrals !== 1 ? 's' : ''} · {r.totalCodes}{' '}
                      code{r.totalCodes !== 1 ? 's' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>

      <AdminAuditLog />

      <ValidatorActionLog />

      <AutomatedModerationLog />

      <FraudFlagsPanel
        onRemoveValidator={(address) => {
          setRemoveTarget(address);
          setDialog({
            action: 'remove',
            label: 'Remove Validator',
            message: `Remove ${address.slice(0, 4)}…${address.slice(-4)} from validators?`,
          });
        }}
      />

      <DisputedMilestonesPanel />

      {dialog && (
        <ConfirmDialog
          isOpen
          title={dialog.label}
          message={dialog.message}
          confirmLabel={dialog.label}
          loading={actionLoading}
          onConfirm={() => execAction(dialog.action)}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
