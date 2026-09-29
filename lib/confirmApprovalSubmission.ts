/**
 * Shared submit → confirm → reconcile pipeline for validator milestone
 * approvals (ApproveForm + PendingMilestoneQueue).
 *
 * `WalletContext.signAndSubmit` only returns when Soroban RPC accepts the
 * transaction into the mempool. Callers must not treat that as terminal
 * success — this module polls for ledger inclusion and optionally waits for
 * the matching indexed / Horizon event before declaring a final outcome.
 */

import { fetchPlayerEvents } from '@/lib/indexerClient';
import {
  pollTransaction,
  TransactionFailedError,
  TransactionTimeoutError,
} from '@/lib/stellar';
import { markPendingIndexerWrite } from '@/hooks/useIndexerFreshness';

/** ~2s between getTransaction polls — half a typical ~5s ledger close. */
export const CONFIRM_POLL_INTERVAL_MS = 2_000;

/**
 * 20 attempts × 2s ≈ 40s (~8 ledger closes). Long enough for mild
 * congestion; short enough that a bulk batch cannot hang on one item.
 */
export const CONFIRM_MAX_ATTEMPTS = 20;

/** After ledger SUCCESS, wait this long for indexer/Horizon visibility. */
export const EVENT_RECONCILE_TIMEOUT_MS = 15_000;

export const EVENT_RECONCILE_INTERVAL_MS = 2_000;

const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';

export type ApprovalPhase =
  | 'idle'
  | 'signing'
  | 'submitted'
  | 'confirming'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'event_lag'
  | 'error';

export type ApprovalTerminalPhase =
  | 'success'
  | 'event_lag'
  | 'failed'
  | 'timeout'
  | 'error';

export interface ApprovalPhaseMeta {
  hash: string | null;
  message?: string;
}

export interface SubmitAndConfirmApprovalParams {
  /** Builds the unsigned approve_milestone XDR. */
  buildXdr: () => Promise<string>;
  /** WalletContext.signAndSubmit — returns the mempool-accepted hash. */
  signAndSubmit: (xdr: string) => Promise<string>;
  playerId: string;
  validatorAddress: string;
  onPhase?: (phase: ApprovalPhase, meta: ApprovalPhaseMeta) => void;
  signal?: AbortSignal;
  confirmMaxAttempts?: number;
  confirmDelayMs?: number;
  eventReconcileTimeoutMs?: number;
  eventReconcileIntervalMs?: number;
  /** Injected for tests — defaults to live Horizon + indexer checks. */
  waitForEvent?: (args: {
    txHash: string;
    playerId: string;
    validatorAddress: string;
    signal?: AbortSignal;
    timeoutMs: number;
    intervalMs: number;
  }) => Promise<boolean>;
}

export interface SubmitAndConfirmApprovalResult {
  phase: ApprovalTerminalPhase;
  hash: string | null;
  message: string;
}

function emit(
  onPhase: SubmitAndConfirmApprovalParams['onPhase'],
  phase: ApprovalPhase,
  meta: ApprovalPhaseMeta,
) {
  onPhase?.(phase, meta);
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const err = new Error('Approval aborted');
    err.name = 'AbortError';
    throw err;
  }
}

/**
 * Returns true if Horizon has operations for `txHash` (the same signal
 * useContractEvents ultimately observes) OR the indexer has a recent
 * milestone_approved for this player/validator.
 */
export async function waitForMilestoneApprovalEvent(args: {
  txHash: string;
  playerId: string;
  validatorAddress: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<boolean> {
  const {
    txHash,
    playerId,
    validatorAddress,
    signal,
    timeoutMs = EVENT_RECONCILE_TIMEOUT_MS,
    intervalMs = EVENT_RECONCILE_INTERVAL_MS,
  } = args;

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    assertNotAborted(signal);

    try {
      const horizonRes = await fetch(
        `${HORIZON_URL}/transactions/${encodeURIComponent(txHash)}/operations?limit=10`,
      );
      if (horizonRes.ok) {
        const json = (await horizonRes.json()) as {
          _embedded?: { records?: Array<{ type?: string }> };
        };
        const records = json._embedded?.records ?? [];
        if (
          records.some(
            (r) =>
              r.type === 'invoke_host_function' ||
              r.type === 'invokeHostFunction',
          )
        ) {
          return true;
        }
      }
    } catch {
      // Horizon blip — fall through to indexer / retry.
    }

    try {
      const { events } = await fetchPlayerEvents(playerId, {
        type: 'milestone_approved',
        limit: 20,
      });
      const match = events.some(
        (e) =>
          e.type === 'milestone_approved' &&
          (e.validator == null || e.validator === validatorAddress),
      );
      if (match) return true;
    } catch {
      // Indexer lag/outage is exactly the case we surface as event_lag.
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    await new Promise<void>((resolve, reject) => {
      const wait = Math.min(intervalMs, remaining);
      const timer = setTimeout(resolve, wait);
      const onAbort = () => {
        clearTimeout(timer);
        const err = new Error('Approval aborted');
        err.name = 'AbortError';
        reject(err);
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  return false;
}

/**
 * Full approval pipeline: sign+submit → ledger confirm → event reconcile.
 *
 * Terminal phases:
 * - `success` — ledger SUCCESS and event visible
 * - `event_lag` — ledger SUCCESS but event not seen in time (on-chain is OK;
 *   callers SHOULD still call decideMilestoneSubmission)
 * - `failed` — ledger FAILED (do NOT decide)
 * - `timeout` — never confirmed within the poll bound (do NOT decide)
 * - `error` — sign/submit/network failure before confirmation (do NOT decide)
 */
export async function submitAndConfirmApproval(
  params: SubmitAndConfirmApprovalParams,
): Promise<SubmitAndConfirmApprovalResult> {
  const {
    buildXdr,
    signAndSubmit,
    playerId,
    validatorAddress,
    onPhase,
    signal,
    confirmMaxAttempts = CONFIRM_MAX_ATTEMPTS,
    confirmDelayMs = CONFIRM_POLL_INTERVAL_MS,
    eventReconcileTimeoutMs = EVENT_RECONCILE_TIMEOUT_MS,
    eventReconcileIntervalMs = EVENT_RECONCILE_INTERVAL_MS,
    waitForEvent = waitForMilestoneApprovalEvent,
  } = params;

  let hash: string | null = null;

  try {
    emit(onPhase, 'signing', { hash: null });
    assertNotAborted(signal);

    const xdr = await buildXdr();
    assertNotAborted(signal);

    hash = await signAndSubmit(xdr);
    if (!hash || typeof hash !== 'string') {
      const message = 'Wallet did not return a transaction hash after submit';
      emit(onPhase, 'error', { hash: null, message });
      return { phase: 'error', hash: null, message };
    }

    emit(onPhase, 'submitted', { hash });
    emit(onPhase, 'confirming', { hash });

    try {
      const tx = await pollTransaction(
        hash,
        confirmMaxAttempts,
        confirmDelayMs,
        { signal },
      );
      // Indexer-backed views show a "may take a minute" hint until the
      // indexer passes this ledger (see DataFreshnessBadge).
      const ledger = (tx as { ledger?: number } | undefined)?.ledger;
      if (typeof ledger === 'number') markPendingIndexerWrite(ledger);
    } catch (err) {
      if (err instanceof TransactionFailedError) {
        const message =
          'Transaction failed on the ledger. The milestone was not approved — you can try again.';
        emit(onPhase, 'failed', { hash, message });
        return { phase: 'failed', hash, message };
      }
      if (err instanceof TransactionTimeoutError) {
        const message =
          'Transaction was submitted but not confirmed on-chain in time. Check the explorer link; if it never confirms, you can retry.';
        emit(onPhase, 'timeout', { hash, message });
        return { phase: 'timeout', hash, message };
      }
      if (err instanceof Error && err.name === 'AbortError') throw err;
      const message =
        err instanceof Error ? err.message : 'Confirmation polling failed';
      emit(onPhase, 'error', { hash, message });
      return { phase: 'error', hash, message };
    }

    // Ledger confirmed — reconcile against event stream / indexer.
    const eventSeen = await waitForEvent({
      txHash: hash,
      playerId,
      validatorAddress,
      signal,
      timeoutMs: eventReconcileTimeoutMs,
      intervalMs: eventReconcileIntervalMs,
    });

    if (eventSeen) {
      const message = 'Transaction confirmed on-chain.';
      emit(onPhase, 'success', { hash, message });
      return { phase: 'success', hash, message };
    }

    const message =
      'Approved on-chain, but the activity feed has not caught up yet. The approval stands — refresh later to see it in history.';
    emit(onPhase, 'event_lag', { hash, message });
    return { phase: 'event_lag', hash, message };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    const message =
      err instanceof Error ? err.message : 'Approval submission failed';
    emit(onPhase, 'error', { hash, message });
    return { phase: 'error', hash, message };
  }
}

/** True when on-chain confirmation succeeded (including indexer lag). */
export function isOnChainApproved(phase: ApprovalTerminalPhase): boolean {
  return phase === 'success' || phase === 'event_lag';
}
