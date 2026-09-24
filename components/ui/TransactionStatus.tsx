'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import Spinner from '@/components/ui/Spinner';
import { parseContractError } from '@/lib/contractErrorMessage';

/**
 * Transaction lifecycle for validator approvals and other flows.
 * Kept backward-compatible: `pending` / `success` / `error` still work.
 * Finer states (`confirming`, `failed`, `timeout`, `event_lag`) support the
 * submit → confirm → reconcile machine used by milestone approvals.
 */
export type TxStatus =
  | 'pending'
  | 'confirming'
  | 'success'
  | 'error'
  | 'failed'
  | 'timeout'
  | 'event_lag';

export interface TransactionStatusProps {
  status: TxStatus | null;
  txHash?: string | null;
  error?: string | null;
  /** XLM amount deducted by this transaction, e.g. "5.00". Shown on success. */
  feePaid?: string;
  /** Milliseconds before success/event_lag state auto-hides. Defaults to 8000. */
  autoHideMs?: number;
  onHide?: () => void;
}

function explorerUrl(hash: string): string {
  const network =
    process.env.NEXT_PUBLIC_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
  return `https://stellar.expert/explorer/${network}/tx/${hash}`;
}

function ExplorerLink({ txHash }: { txHash: string }) {
  const t = useTranslations('common');
  return (
    <a
      href={explorerUrl(txHash)}
      target="_blank"
      rel="noopener noreferrer"
      className="ml-auto text-brand-green underline hover:opacity-80 transition shrink-0"
      aria-label={t('view_on_stellar_expert')}
    >
      View on Stellar Expert →
    </a>
  );
}

export default function TransactionStatus({
  status,
  txHash,
  error,
  feePaid,
  autoHideMs = 8000,
  onHide,
}: TransactionStatusProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status === 'success' || status === 'event_lag') {
      timerRef.current = setTimeout(() => {
        onHide?.();
      }, autoHideMs);
    }
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [status, autoHideMs, onHide]);

  if (!status) return null;

  if (status === 'pending') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-brand-card px-4 py-3 text-sm text-gray-700 dark:text-gray-300"
      >
        <Spinner size="sm" />
        <span>Submitting transaction…</span>
      </div>
    );
  }

  if (status === 'confirming') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 rounded-xl border border-yellow-500/60 bg-brand-card px-4 py-3 text-sm text-gray-700 dark:text-gray-300"
      >
        <Spinner size="sm" className="text-yellow-400" />
        <span>Submitted — confirming on-chain…</span>
        {txHash && <ExplorerLink txHash={txHash} />}
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 rounded-xl border border-brand-green bg-brand-card px-4 py-3 text-sm"
      >
        <span className="text-brand-green" aria-hidden="true">
          ✓
        </span>
        <span className="text-gray-700 dark:text-gray-200">
          Transaction confirmed.
        </span>
        {feePaid && (
          <span className="text-gray-500 dark:text-gray-400">
            Fee paid:{' '}
            <span className="text-gray-900 dark:text-white font-medium">
              {feePaid} XLM
            </span>
          </span>
        )}
        {txHash && <ExplorerLink txHash={txHash} />}
      </div>
    );
  }

  if (status === 'event_lag') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 rounded-xl border border-amber-500 bg-brand-card px-4 py-3 text-sm"
      >
        <span className="text-amber-400" aria-hidden="true">
          ✓
        </span>
        <span className="text-gray-700 dark:text-gray-200">
          {error ??
            'Approved on-chain, but the activity feed has not caught up yet.'}
        </span>
        {txHash && <ExplorerLink txHash={txHash} />}
      </div>
    );
  }

  // error | failed | timeout — contract-error parsing only for generic `error`
  // (submit/network). Ledger failure/timeout messages are already user-facing.
  const displayError =
    status === 'error'
      ? error
        ? parseContractError(error)
        : null
      : (error ?? null);
  const fallback =
    status === 'timeout'
      ? 'Transaction was not confirmed in time.'
      : status === 'failed'
        ? 'Transaction failed on the ledger.'
        : 'Transaction failed.';

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-3 rounded-xl border border-red-500 bg-brand-card px-4 py-3 text-sm"
    >
      <span className="text-red-500 mt-0.5" aria-hidden="true">
        ✕
      </span>
      <span className="text-red-700 dark:text-red-300">
        {displayError ?? fallback}
      </span>
      {txHash && (status === 'failed' || status === 'timeout') && (
        <ExplorerLink txHash={txHash} />
      )}
    </div>
  );
}
