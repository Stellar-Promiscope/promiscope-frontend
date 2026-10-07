/**
 * IndexedDB-backed store for a pending player-onboarding submission that
 * needs to reach the Soroban network once connectivity returns (issue
 * #1181 — background sync for the onboarding wizard).
 *
 * This is deliberately separate from lib/offlineQueue.ts. That module's own
 * docstring scopes it to "non-financial, idempotent-safe" actions and
 * explicitly excludes signed blockchain transactions — a player
 * registration *is* a signed blockchain transaction, so it gets its own
 * store here, keyed by its own background-sync tag (`onboarding-sync`,
 * registered by hooks/useOnboardingSync.ts) rather than being shoehorned
 * into the generic queue.
 *
 * Read and written from two different JS execution contexts that cannot
 * otherwise share state:
 *  - the main thread, via hooks/useOnboardingSync.ts, and
 *  - the background-sync service worker, worker/index.js — which has no
 *    access to a live page's React state or to localStorage/sessionStorage,
 *    so IndexedDB is the only persistent storage both sides share.
 *
 * There is at most one queued submission per wallet — the wallet address is
 * the record's key, mirroring the "one profile per wallet" invariant the
 * contract itself enforces. A second offline submission attempt for a
 * wallet that already has one queued simply supersedes it.
 */
import type { PlayerVitals } from '@/types';

export type OnboardingSyncStatus =
  | 'pending'
  | 'syncing'
  | 'complete'
  | 'failed';

export interface PendingOnboardingSubmission {
  /** Also the IndexedDB record key. */
  wallet: string;
  vitals: PlayerVitals;
  ipfsHash: string;
  /**
   * The wallet-signed transaction envelope XDR. Signing already happened
   * (locally, in-tab, via the wallet extension) before this record was
   * created — only *broadcasting* it to the RPC node was interrupted by a
   * dropped connection. Nothing here requires the private key again.
   */
  signedXdr: string;
  status: OnboardingSyncStatus;
  queuedAt: number;
  updatedAt: number;
  /** Number of broadcast attempts made so far (by either the SW or the in-tab fallback). */
  retryCount: number;
  /** Set once a broadcast attempt is accepted by the RPC node. */
  txHash?: string;
  /** Set when `status` is 'failed' — the terminal error that stopped retries. */
  lastError?: string;
}

const DB_NAME = 'promiscope-onboarding-sync';
const DB_VERSION = 1;
const STORE_NAME = 'submissions';

/** After this many failed broadcast attempts, a submission stops being retried automatically. */
export const MAX_ONBOARDING_SYNC_RETRIES = 8;

/** True in any context (main thread or service worker) with a working IndexedDB. */
export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'wallet' });
        store.createIndex('status', 'status', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getDb(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    throw new Error('IndexedDB is not available in this environment');
  }
  if (!dbPromise) {
    dbPromise = openDb();
  }
  return dbPromise;
}

/**
 * Persists a freshly-signed, not-yet-broadcast submission and resets it to
 * `pending`. Overwrites any existing record for the same wallet.
 */
export async function saveOnboardingSubmission(input: {
  wallet: string;
  vitals: PlayerVitals;
  ipfsHash: string;
  signedXdr: string;
}): Promise<PendingOnboardingSubmission> {
  const db = await getDb();
  const now = Date.now();
  const record: PendingOnboardingSubmission = {
    ...input,
    status: 'pending',
    queuedAt: now,
    updatedAt: now,
    retryCount: 0,
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return record;
}

/** Returns the queued/complete/failed submission for `wallet`, if any. */
export async function getOnboardingSubmission(
  wallet: string,
): Promise<PendingOnboardingSubmission | null> {
  if (!isIndexedDbAvailable()) return null;
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(wallet);
    req.onsuccess = () =>
      resolve((req.result as PendingOnboardingSubmission) ?? null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Returns every submission still eligible for a broadcast attempt — read by
 * the service worker's `sync` handler, which processes all wallets queued
 * on this device rather than just one.
 */
export async function getSyncableSubmissions(): Promise<
  PendingOnboardingSubmission[]
> {
  if (!isIndexedDbAvailable()) return [];
  const db = await getDb();

  const all = await new Promise<PendingOnboardingSubmission[]>(
    (resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () =>
        resolve((req.result as PendingOnboardingSubmission[]) ?? []);
      req.onerror = () => reject(req.error);
    },
  );

  return all.filter(
    (s) =>
      (s.status === 'pending' || s.status === 'syncing') &&
      s.retryCount < MAX_ONBOARDING_SYNC_RETRIES,
  );
}

/**
 * Applies a partial update to the record for `wallet` (e.g. moving it
 * pending → syncing → complete/failed, or recording a txHash). No-ops if
 * the wallet has no queued record.
 */
export async function updateOnboardingSubmission(
  wallet: string,
  patch: Partial<Omit<PendingOnboardingSubmission, 'wallet'>>,
): Promise<PendingOnboardingSubmission | null> {
  const db = await getDb();
  let updated: PendingOnboardingSubmission | null = null;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(wallet);
    req.onsuccess = () => {
      const existing: PendingOnboardingSubmission | undefined = req.result;
      if (existing) {
        updated = { ...existing, ...patch, updatedAt: Date.now() };
        store.put(updated);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return updated;
}

/** Removes the queued record for `wallet` entirely (discard / cleanup). */
export async function deleteOnboardingSubmission(
  wallet: string,
): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  const db = await getDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(wallet);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
