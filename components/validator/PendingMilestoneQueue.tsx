'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useValidatorPendingQueue } from '@/hooks/useValidatorPendingQueue';
import { useApprovalQueue } from '@/hooks/useApprovalQueue';
import { useApprovedPlayers } from '@/hooks/useApprovedPlayers';
import { useValidator } from '@/hooks/useValidator';
import { useWallet } from '@/hooks/useWallet';
import useIsPaused from '@/hooks/useIsPaused';
import { decideMilestoneSubmission } from '@/lib/api';
import {
  CONFIRM_MAX_ATTEMPTS,
  CONFIRM_POLL_INTERVAL_MS,
  isOnChainApproved,
  submitAndConfirmApproval,
  type ApprovalPhase,
} from '@/lib/confirmApprovalSubmission';
import Select from '@/components/ui/Select';
import EmptyState from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import type { MilestoneSubmission } from '@/types';

type SortOrder = 'oldest' | 'newest';
type PlayerFilter = 'all' | 'previously-approved';
type ItemStatus =
  | 'signing'
  | 'confirming'
  | 'success'
  | 'event_lag'
  | 'failed'
  | 'timeout'
  | 'error'
  | 'skipped';

interface PendingMilestoneQueueProps {
  validatorAddress: string;
}

function sortSubmissions(
  submissions: MilestoneSubmission[],
  order: SortOrder,
): MilestoneSubmission[] {
  const sorted = [...submissions].sort((a, b) => a.createdAt - b.createdAt);
  return order === 'newest' ? sorted.reverse() : sorted;
}

function phaseToItemStatus(phase: ApprovalPhase): ItemStatus | null {
  switch (phase) {
    case 'signing':
      return 'signing';
    case 'submitted':
    case 'confirming':
      return 'confirming';
    case 'success':
      return 'success';
    case 'event_lag':
      return 'event_lag';
    case 'failed':
      return 'failed';
    case 'timeout':
      return 'timeout';
    case 'error':
      return 'error';
    default:
      return null;
  }
}

export default function PendingMilestoneQueue({
  validatorAddress,
}: PendingMilestoneQueueProps) {
  const { submissions, loading, error, refetch } =
    useValidatorPendingQueue(validatorAddress);
  const { players: approvedPlayers } = useApprovedPlayers(validatorAddress);
  const { approveMilestone } = useValidator(validatorAddress);
  const { signAndSubmit } = useWallet();
  const approvalQueue = useApprovalQueue(validatorAddress);
  const isPaused = useIsPaused();
  const tContractStatus = useTranslations('contract_status');

  const [sortOrder, setSortOrder] = useState<SortOrder>('oldest');
  const [playerFilter, setPlayerFilter] = useState<PlayerFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [itemStatus, setItemStatus] = useState<Record<string, ItemStatus>>({});
  const [itemError, setItemError] = useState<Record<string, string>>({});
  const [itemHash, setItemHash] = useState<Record<string, string>>({});
  const [bulkSummary, setBulkSummary] = useState<{
    succeeded: number;
    failed: number;
    skipped: number;
  } | null>(null);
  const cancelBulkRef = useRef(false);
  const [isOnline, setIsOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine,
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const previouslyApprovedIds = useMemo(
    () => new Set(approvedPlayers.map((p) => p.id)),
    [approvedPlayers],
  );

  // Sort/filter apply instantly client-side — no refetch or page reload.
  const visibleSubmissions = useMemo(() => {
    const filtered =
      playerFilter === 'previously-approved'
        ? submissions.filter((s) => previouslyApprovedIds.has(s.playerId))
        : submissions;
    return sortSubmissions(filtered, sortOrder);
  }, [submissions, playerFilter, previouslyApprovedIds, sortOrder]);

  const visibleIds = useMemo(
    () => visibleSubmissions.map((s) => s.id),
    [visibleSubmissions],
  );
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...visibleIds]);
    });
  }

  function handleCancelBulk() {
    cancelBulkRef.current = true;
    setStopRequested(true);
  }

  // Soroban transactions carry a single invoke-host-function operation each,
  // so there is no way to bundle multiple approve_milestone calls into one
  // signed transaction without a batch entry point in the contract — this
  // submits one signed transaction per selected item, sequentially, so a
  // rejected/failed signature only stops that item rather than the batch.
  // Each item has a bounded confirmation poll (~40s) so one timeout cannot
  // hang the batch indefinitely.
  //
  // A signature prompt already in flight can't cleanly be interrupted, so
  // cancellation is checked between items: the current item is always
  // allowed to finish (success or failure) before the loop stops.
  async function handleBulkApprove() {
    if (!validatorAddress || isPaused || bulkRunning) return;
    const ids = visibleIds.filter((id) => selectedIds.has(id));
    if (ids.length === 0) return;

    if (!isOnline) {
      await approvalQueue.enqueueMany(
        ids.flatMap((id) => {
          const submission = submissions.find((item) => item.id === id);
          return submission
            ? [
                {
                  playerId: submission.playerId,
                  milestone: submission.description,
                },
              ]
            : [];
        }),
      );
      setSelectedIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      return;
    }

    cancelBulkRef.current = false;
    setStopRequested(false);
    setBulkRunning(true);
    setBulkSummary(null);
    setItemError({});
    setItemHash({});
    setItemStatus({});

    let succeeded = 0;
    let failed = 0;
    const processedIds = new Set<string>();

    for (const id of ids) {
      if (cancelBulkRef.current) break;

      const submission = submissions.find((s) => s.id === id);
      if (!submission) {
        processedIds.add(id);
        continue;
      }

      setItemStatus((prev) => ({ ...prev, [id]: 'signing' }));
      try {
        const result = await submitAndConfirmApproval({
          buildXdr: () =>
            approveMilestone(submission.playerId, submission.description),
          signAndSubmit,
          playerId: submission.playerId,
          validatorAddress,
          confirmMaxAttempts: CONFIRM_MAX_ATTEMPTS,
          confirmDelayMs: CONFIRM_POLL_INTERVAL_MS,
          // Keep event wait short in bulk so siblings are not delayed as much.
          eventReconcileTimeoutMs: 8_000,
          onPhase: (phase, meta) => {
            const mapped = phaseToItemStatus(phase);
            if (mapped) {
              setItemStatus((prev) => ({ ...prev, [id]: mapped }));
            }
            if (meta.hash) {
              setItemHash((prev) => ({ ...prev, [id]: meta.hash! }));
            }
            if (
              meta.message &&
              (phase === 'failed' || phase === 'timeout' || phase === 'error')
            ) {
              setItemError((prev) => ({
                ...prev,
                [id]: meta.message!,
              }));
            }
          },
        });

        if (result.hash) {
          setItemHash((prev) => ({ ...prev, [id]: result.hash! }));
        }

        if (isOnChainApproved(result.phase)) {
          // Only notify the backend after ledger confirmation (or confirmed
          // with indexer lag — on-chain state is still correct).
          await decideMilestoneSubmission(id, 'approved', result.hash!);
          setItemStatus((prev) => ({
            ...prev,
            [id]: result.phase === 'event_lag' ? 'event_lag' : 'success',
          }));
          if (result.phase === 'event_lag') {
            setItemError((prev) => ({ ...prev, [id]: result.message }));
          }
          succeeded++;
        } else {
          setItemStatus((prev) => ({
            ...prev,
            [id]:
              result.phase === 'timeout'
                ? 'timeout'
                : result.phase === 'failed'
                  ? 'failed'
                  : 'error',
          }));
          setItemError((prev) => ({ ...prev, [id]: result.message }));
          failed++;
        }
      } catch (e) {
        setItemStatus((prev) => ({ ...prev, [id]: 'error' }));
        setItemError((prev) => ({
          ...prev,
          [id]: e instanceof Error ? e.message : 'Approval failed',
        }));
        failed++;
      }

      processedIds.add(id);
    }

    // Items never reached because the batch was stopped are neither
    // succeeded nor failed — mark them distinctly and leave them selected
    // so the validator can resume or retry them directly.
    const skippedIds = ids.filter((id) => !processedIds.has(id));
    if (skippedIds.length > 0) {
      setItemStatus((prev) => ({
        ...prev,
        ...Object.fromEntries(skippedIds.map((id) => [id, 'skipped'])),
      }));
    }

    setBulkSummary({ succeeded, failed, skipped: skippedIds.length });
    setSelectedIds((prev) => {
      const next = new Set(prev);
      processedIds.forEach((id) => next.delete(id));
      return next;
    });
    setBulkRunning(false);
    setStopRequested(false);
    refetch(); // drop the now-approved items from the pending list; a
    // cancelled batch may still have items that succeeded before it stopped
  }

  const selectedCount = visibleIds.filter((id) => selectedIds.has(id)).length;

  return (
    <div className="bg-brand-card border border-gray-800 rounded-xl p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-white">Pending Milestones</h2>
        {!loading && !error && (
          <span className="text-sm text-gray-400">
            {visibleSubmissions.length} pending
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-4">
        <Select
          id="pending-queue-sort"
          label="Sort"
          className="w-40"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as SortOrder)}
        >
          <option value="oldest">Oldest first</option>
          <option value="newest">Newest first</option>
        </Select>

        <Select
          id="pending-queue-filter"
          label="Filter"
          className="w-56"
          value={playerFilter}
          onChange={(e) => setPlayerFilter(e.target.value as PlayerFilter)}
        >
          <option value="all">All players</option>
          <option value="previously-approved">
            Only players I&apos;ve previously approved
          </option>
        </Select>
      </div>

      {(approvalQueue.pending.length > 0 ||
        approvalQueue.terminal.length > 0) && (
        <section
          aria-label="Offline approval queue"
          className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-medium text-amber-200">
                {approvalQueue.pending.length} approval
                {approvalQueue.pending.length === 1 ? '' : 's'} ready to sign
              </h3>
              <p className="mt-1 text-xs text-amber-300/80">
                Unsigned approvals are stored on this device. Review the batch
                before opening your wallet.
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={approvalQueue.flush}
              disabled={
                approvalQueue.pending.length === 0 ||
                approvalQueue.flushing ||
                !isOnline ||
                isPaused
              }
            >
              {approvalQueue.flushing
                ? 'Signing queued approvals…'
                : `Sign ${approvalQueue.pending.length} queued approval${approvalQueue.pending.length === 1 ? '' : 's'}`}
            </Button>
          </div>
          {approvalQueue.flushError && (
            <p role="alert" className="mt-3 text-sm text-red-300">
              {approvalQueue.flushError}
            </p>
          )}
          <ul className="mt-3 space-y-2">
            {[...approvalQueue.pending, ...approvalQueue.terminal].map(
              (intent) => (
                <li
                  key={intent.idempotencyKey}
                  className="flex items-start justify-between gap-3 rounded-md border border-gray-700/80 px-3 py-2 text-xs"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-gray-200">
                      {intent.playerId}: {intent.milestone}
                    </span>
                    <span
                      className={`block mt-1 ${
                        intent.status === 'confirmed'
                          ? 'text-brand-green'
                          : intent.status === 'invalid'
                            ? 'text-red-300'
                            : 'text-amber-300'
                      }`}
                    >
                      {intent.errorReason ??
                        (intent.status === 'confirmed'
                          ? 'Confirmed on-chain'
                          : intent.status === 'invalid'
                            ? 'Approval is no longer valid'
                            : 'Waiting for batch signing')}
                    </span>
                  </span>
                  {(intent.status === 'confirmed' ||
                    intent.status === 'invalid') && (
                    <button
                      type="button"
                      className="shrink-0 text-gray-400 underline hover:text-white"
                      onClick={() =>
                        approvalQueue.dismiss(intent.idempotencyKey)
                      }
                    >
                      Dismiss
                    </button>
                  )}
                </li>
              ),
            )}
          </ul>
        </section>
      )}

      {loading && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-16 rounded-lg bg-gray-800/50 animate-pulse"
            />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center justify-between">
          <p className="text-red-400 text-sm">
            Could not load pending milestones.
          </p>
          <Button variant="secondary" onClick={refetch}>
            Retry
          </Button>
        </div>
      )}

      {!loading && !error && visibleSubmissions.length === 0 && (
        <EmptyState
          title="No pending milestones"
          description={
            playerFilter === 'previously-approved'
              ? "No pending submissions from players you've previously approved."
              : 'New submissions from players will appear here for review.'
          }
        />
      )}

      {!loading && !error && visibleSubmissions.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-4 border-b border-gray-800 pb-3">
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
                disabled={bulkRunning}
                aria-label="Select all visible pending milestones"
              />
              Select all
            </label>
            <div className="flex items-center gap-2">
              {bulkRunning && (
                <Button
                  variant="danger"
                  onClick={handleCancelBulk}
                  disabled={stopRequested}
                >
                  {stopRequested ? 'Stopping…' : 'Stop'}
                </Button>
              )}
              <Button
                onClick={handleBulkApprove}
                isLoading={bulkRunning}
                disabled={
                  selectedCount === 0 || bulkRunning || !validatorAddress
                }
                disabledReason={
                  isPaused ? tContractStatus('paused_hint') : undefined
                }
              >
                {!isOnline
                  ? `Queue offline${selectedCount > 0 ? ` (${selectedCount})` : ''}`
                  : bulkRunning
                    ? `Approving ${selectedCount}…`
                    : `Bulk Approve${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
              </Button>
            </div>
          </div>

          {bulkSummary && (
            <div
              role="status"
              aria-live="polite"
              className={`rounded-md border p-3 text-sm ${
                bulkSummary.failed > 0
                  ? 'border-red-500 bg-red-950/30 text-red-300'
                  : bulkSummary.skipped > 0
                    ? 'border-amber-500 bg-amber-950/30 text-amber-300'
                    : 'border-brand-green bg-brand-green/10 text-brand-green'
              }`}
            >
              {bulkSummary.skipped > 0
                ? `${bulkSummary.succeeded} of ${bulkSummary.succeeded + bulkSummary.failed + bulkSummary.skipped} selected approvals completed before the batch was stopped — ${bulkSummary.succeeded} confirmed on-chain${bulkSummary.failed > 0 ? `, ${bulkSummary.failed} failed` : ''}, and ${bulkSummary.skipped} not attempted.`
                : bulkSummary.failed > 0
                  ? `${bulkSummary.succeeded} of ${bulkSummary.succeeded + bulkSummary.failed} approvals confirmed on-chain — ${bulkSummary.failed} failed and remain pending for retry.`
                  : `All ${bulkSummary.succeeded} selected milestones were confirmed on-chain.`}
            </div>
          )}

          <ul className="flex flex-col gap-3">
            {visibleSubmissions.map((submission) => {
              const status = itemStatus[submission.id];
              const hash = itemHash[submission.id];
              return (
                <li
                  key={submission.id}
                  className="border border-gray-700 rounded-lg p-4 flex flex-col gap-1"
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedIds.has(submission.id)}
                      onChange={() => toggleSelected(submission.id)}
                      disabled={bulkRunning}
                      aria-label={`Select milestone for ${submission.playerName ?? submission.playerId}`}
                    />
                    <div className="flex-1 flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-white font-medium">
                          {submission.playerName ?? submission.playerId}
                        </span>
                        <span className="text-xs text-gray-400">
                          {new Date(submission.createdAt).toLocaleDateString(
                            undefined,
                            {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            },
                          )}
                        </span>
                      </div>
                      <p className="text-sm text-gray-300">
                        {submission.description}
                      </p>
                      {submission.evidenceUrl && (
                        <a
                          href={submission.evidenceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-brand-green underline underline-offset-2 hover:opacity-80 w-fit"
                        >
                          View evidence
                        </a>
                      )}

                      {status === 'signing' && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-yellow-300 mt-1">
                          <Spinner size="sm" className="text-yellow-300" />
                          Awaiting signature&hellip;
                        </span>
                      )}
                      {status === 'confirming' && (
                        <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-yellow-300 mt-1">
                          <Spinner size="sm" className="text-yellow-300" />
                          Submitted — confirming on-chain&hellip;
                          {hash && (
                            <a
                              href={`https://stellar.expert/explorer/${process.env.NEXT_PUBLIC_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'}/tx/${hash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-brand-green underline"
                            >
                              View tx
                            </a>
                          )}
                        </span>
                      )}
                      {status === 'success' && (
                        <span className="text-xs text-brand-green mt-1">
                          ✓ Confirmed on-chain
                        </span>
                      )}
                      {status === 'event_lag' && (
                        <span className="text-xs text-amber-400 mt-1">
                          ✓ Confirmed on-chain (feed lag)
                          {itemError[submission.id]
                            ? ` — ${itemError[submission.id]}`
                            : ''}
                        </span>
                      )}
                      {(status === 'failed' ||
                        status === 'timeout' ||
                        status === 'error') && (
                        <span className="text-xs text-red-400 mt-1">
                          ✕{' '}
                          {status === 'timeout'
                            ? 'Not confirmed in time'
                            : status === 'failed'
                              ? 'Failed on ledger'
                              : 'Failed'}
                          {itemError[submission.id]
                            ? `: ${itemError[submission.id]}`
                            : ''}
                        </span>
                      )}
                      {status === 'skipped' && (
                        <span className="text-xs text-gray-400 mt-1">
                          Not attempted — batch was stopped
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
