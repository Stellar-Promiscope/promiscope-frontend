'use client';
import { useEffect, useSyncExternalStore } from 'react';
import useSWR from 'swr';
import type { IndexerFreshness } from '@/app/api/indexer/health/route';

export type { IndexerFreshness };

/** Past either threshold, indexer-backed data is shown as stale. */
export const STALE_AFTER_MS = 5 * 60 * 1000;
export const STALE_AFTER_LEDGERS = 100;

async function fetchFreshness(url: string): Promise<IndexerFreshness> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function isIndexerStale(
  data: IndexerFreshness,
  now: number = Date.now(),
): boolean {
  if (data.lastUpdated !== null && now - data.lastUpdated > STALE_AFTER_MS) {
    return true;
  }
  return data.ledgerLag !== null && data.ledgerLag > STALE_AFTER_LEDGERS;
}

// ── Pending own-write tracking ─────────────────────────────────────────────
// After the user's own write (e.g. a milestone approval) is confirmed at
// ledger N, indexer-backed views may not show it until the indexer passes N.

let pendingLedger: number | null = null;
const listeners = new Set<() => void>();

function setPendingLedger(value: number | null): void {
  if (pendingLedger === value) return;
  pendingLedger = value;
  listeners.forEach((l) => l());
}

export function markPendingIndexerWrite(ledger: number): void {
  setPendingLedger(Math.max(pendingLedger ?? 0, ledger));
}

/** Test-only reset of the pending-write store. */
export function resetPendingIndexerWrite(): void {
  setPendingLedger(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getPending = () => pendingLedger;

export function useIndexerFreshness() {
  const { data, error, isLoading } = useSWR<IndexerFreshness>(
    '/api/indexer/health',
    fetchFreshness,
    { refreshInterval: 60_000 },
  );
  const pending = useSyncExternalStore(subscribe, getPending, getPending);

  const caughtUp =
    pending !== null && data?.lastLedger != null && data.lastLedger >= pending;
  useEffect(() => {
    if (caughtUp) setPendingLedger(null);
  }, [caughtUp]);

  return {
    data,
    error,
    isLoading,
    stale: data ? isIndexerStale(data) : false,
    pendingWrite: pending !== null && !caughtUp,
  };
}
