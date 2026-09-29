/**
 * IndexedDB-backed queue for unsigned validator milestone approval intents.
 *
 * This store intentionally never persists an XDR. Soroban transactions built
 * by lib/contract.ts expire after 30 seconds, so the XDR must be rebuilt and
 * signed only after the validator explicitly starts a flush.
 */

export type ApprovalQueueStatus =
  | 'pending'
  | 'processing'
  | 'confirmed'
  | 'failed'
  | 'invalid';

export interface ApprovalIntent {
  /** SHA-256 of playerId + milestone + validator. Also the IndexedDB key. */
  idempotencyKey: string;
  playerId: string;
  milestone: string;
  validator: string;
  status: ApprovalQueueStatus;
  queuedAt: number;
  updatedAt: number;
  retryCount: number;
  txHash?: string;
  errorReason?: string;
}

const DB_NAME = 'scoutoff-approval-queue';
const DB_VERSION = 1;
const STORE_NAME = 'approval_intents';

let dbPromise: Promise<IDBDatabase> | null = null;

export function isApprovalQueueAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'idempotencyKey',
        });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('queuedAt', 'queuedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getDb(): Promise<IDBDatabase> {
  if (!isApprovalQueueAvailable()) {
    throw new Error('IndexedDB is not available in this environment');
  }
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

function transact<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return getDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = operation(transaction.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      }),
  );
}

/** Creates a stable key without putting wallet addresses into a URL or log. */
export async function approvalIdempotencyKey(input: {
  playerId: string;
  milestone: string;
  validator: string;
}): Promise<string> {
  const canonical = JSON.stringify([
    input.playerId,
    input.milestone,
    input.validator,
  ]);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const bytes = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(canonical),
    );
    return Array.from(new Uint8Array(bytes))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  // Older webviews may not expose SubtleCrypto. This fallback is still stable
  // for deduplication on that device and is never used as a transaction id.
  let hash = 2166136261;
  for (const character of canonical) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fallback-${(hash >>> 0).toString(16)}`;
}

export async function enqueueApprovalIntent(input: {
  playerId: string;
  milestone: string;
  validator: string;
}): Promise<ApprovalIntent> {
  const idempotencyKey = await approvalIdempotencyKey(input);
  const existing = await getApprovalIntent(idempotencyKey);
  if (existing) return existing;

  const now = Date.now();
  const intent: ApprovalIntent = {
    ...input,
    idempotencyKey,
    status: 'pending',
    queuedAt: now,
    updatedAt: now,
    retryCount: 0,
  };
  await transact<undefined>('readwrite', (store) => store.add(intent));
  return intent;
}

export function getApprovalIntent(
  idempotencyKey: string,
): Promise<ApprovalIntent | null> {
  return transact<ApprovalIntent | undefined>('readonly', (store) =>
    store.get(idempotencyKey),
  ).then((intent) => intent ?? null);
}

export function getApprovalIntents(): Promise<ApprovalIntent[]> {
  return transact<ApprovalIntent[]>('readonly', (store) => store.getAll()).then(
    (intents) => intents.sort((a, b) => a.queuedAt - b.queuedAt),
  );
}

export async function updateApprovalIntent(
  idempotencyKey: string,
  patch: Partial<Omit<ApprovalIntent, 'idempotencyKey'>>,
): Promise<ApprovalIntent | null> {
  const current = await getApprovalIntent(idempotencyKey);
  if (!current) return null;
  const updated = { ...current, ...patch, updatedAt: Date.now() };
  await transact<undefined>('readwrite', (store) => store.put(updated));
  return updated;
}

export async function removeApprovalIntent(
  idempotencyKey: string,
): Promise<void> {
  if (!isApprovalQueueAvailable()) return;
  await transact<undefined>('readwrite', (store) =>
    store.delete(idempotencyKey),
  );
}

/** Dismisses a terminal item while preserving no stale retryable state. */
export async function dismissApprovalIntent(
  idempotencyKey: string,
): Promise<void> {
  await removeApprovalIntent(idempotencyKey);
}
