/**
 * Offline Queue — IndexedDB-backed queue for non-financial, idempotent-safe
 * form submissions that should not fail when the network is unavailable.
 *
 * When a submission is attempted while offline, it is persisted locally and
 * automatically retried once connectivity is restored.
 *
 * **Scope**: profile updates, text submissions, and other idempotent-safe
 * actions. **Not** for signed blockchain transactions.
 *
 * ## Head-of-line-blocking protection
 *
 * processQueue() iterates **all** queued actions on every pass. A failing
 * action does not block actions queued after it. Instead:
 *
 * - On a **transient** failure (plain `Error` or `OfflineQueueError` with
 *   `permanent: false`), the action is scheduled for a later retry using
 *   exponential backoff with jitter. Subsequent processing passes skip it
 *   until `nextRetryAt` has elapsed.
 * - After `MAX_RETRIES` transient failures, or after **any permanent**
 *   failure (`OfflineQueueError` with `permanent: true`), the action is
 *   moved to the `failed_actions` dead-letter store and removed from the
 *   active queue. It will never be retried automatically; the user may
 *   discard it via `discardFailedAction` / `discardAllFailedActions`.
 *
 * ## Multi-tab / multi-device conflict resolution (issue #1178)
 *
 * Two tabs (or devices) can independently queue an update to the *same*
 * underlying record while offline. Both queues eventually flush after
 * reconnect, in an undefined order relative to each other. Without any
 * coordination, the second flush would silently overwrite the first.
 *
 * To prevent this:
 *
 * - `enqueueAction` accepts an optional `baseVersion` — the version/
 *   timestamp of the record the action was based on, captured at enqueue
 *   time (e.g. the record's server-assigned `updatedAt`). It rides along on
 *   the `QueuedAction` for the handler to send with its write.
 * - A handler that detects the record changed server-side since
 *   `baseVersion` (typically because the server responded 409 Conflict)
 *   throws `OfflineQueueConflictError` instead of a plain `Error`.
 * - `processQueue` treats a conflict as its own outcome, distinct from
 *   transient/permanent failure: the action is moved straight to the
 *   dead-letter store tagged `conflict: true` (with the server's current
 *   version/value attached, if known) rather than being retried — retrying
 *   with the same stale `baseVersion` would just fail again, and applying
 *   it anyway would silently clobber whatever the other tab/device wrote.
 *   The user is expected to review and decide how to proceed; this module
 *   does not attempt an automatic three-way merge.
 *
 * Actions that don't carry a `baseVersion` (the common single-tab case, or
 * any action type that isn't version-tracked) are completely unaffected —
 * there is no extra comparison, round trip, or latency added to that path.
 */

// ── Error classification ─────────────────────────────────────────────────────

/**
 * An error that a handler may throw to signal whether the failure is
 * permanent (e.g. HTTP 422 — the payload will never be valid) or transient
 * (e.g. HTTP 503 — worth retrying).
 *
 * A plain `Error` thrown by a handler is treated as **transient**.
 *
 * @example Permanent (4xx validation failure):
 * ```ts
 * throw new OfflineQueueError('Validation failed: name too long', { permanent: true });
 * ```
 *
 * @example Transient (network / server error):
 * ```ts
 * throw new OfflineQueueError('Service temporarily unavailable', { permanent: false });
 * // or just: throw new Error('network down');
 * ```
 */
export class OfflineQueueError extends Error {
  /** When `true` the action should not be retried and goes straight to the dead-letter store. */
  readonly permanent: boolean;

  constructor(message: string, options: { permanent: boolean }) {
    super(message);
    this.name = 'OfflineQueueError';
    this.permanent = options.permanent;
  }
}

/**
 * An error a handler throws when the server rejects a flush because the
 * record has changed since the action's `baseVersion` was captured — i.e.
 * an optimistic-concurrency conflict (HTTP 409, or equivalent), most often
 * caused by another tab or device having already flushed a write against
 * the same record.
 *
 * Unlike `OfflineQueueError`, a conflict is never treated as retryable:
 * the action's `baseVersion` is stale, so retrying with the same payload
 * would either fail again or silently overwrite the other write. Instead
 * `processQueue` moves the action straight to the dead-letter store, tagged
 * `conflict: true`, for the user to review.
 *
 * @example
 * ```ts
 * const res = await fetch('/api/thing', { method: 'PUT', body: ... });
 * if (res.status === 409) {
 *   const { current, currentVersion } = await res.json();
 *   throw new OfflineQueueConflictError('Record changed elsewhere', {
 *     serverVersion: currentVersion,
 *     serverPayload: current,
 *   });
 * }
 * ```
 */
export class OfflineQueueConflictError extends Error {
  readonly conflict = true as const;
  /** The record's current version/timestamp on the server, if known. */
  readonly serverVersion?: number;
  /** The record's current server-side value, if the server returned one. */
  readonly serverPayload?: unknown;

  constructor(
    message: string,
    options?: { serverVersion?: number; serverPayload?: unknown },
  ) {
    super(message);
    this.name = 'OfflineQueueConflictError';
    this.serverVersion = options?.serverVersion;
    this.serverPayload = options?.serverPayload;
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface QueuedAction {
  /** Unique id assigned at enqueue time. */
  id: string;
  /** When the action was first queued (Unix ms). */
  queuedAt: number;
  /** Number of retry attempts so far. */
  retryCount: number;
  /** The action type, used to dispatch to the right handler. */
  type: string;
  /** Opaque payload — structure depends on the action type. */
  payload: unknown;
  /**
   * Earliest time at which this action may be retried (Unix ms).
   * A value of `0` or `undefined` means the action is eligible immediately.
   * Set by `markRetry` using exponential backoff with jitter.
   */
  nextRetryAt?: number;
  /**
   * Version/timestamp of the underlying record this action was based on,
   * captured at enqueue time (e.g. the record's server-assigned
   * `updatedAt`). Opaque to the queue itself — a handler that targets a
   * versioned record sends this along with its write so the server can
   * detect a conflict; actions that don't target a versioned record simply
   * omit it. See "Multi-tab / multi-device conflict resolution" above.
   */
  baseVersion?: number;
}

/**
 * A permanently-failed action moved to the dead-letter store.
 * It will not be retried automatically. The user may discard it.
 */
export interface FailedAction extends QueuedAction {
  /** When the action was moved to the dead-letter store (Unix ms). */
  failedAt: number;
  /** The error message that caused the final failure. */
  lastError: string;
  /**
   * `true` when this action was dead-lettered because the server detected
   * an optimistic-concurrency conflict (its `baseVersion` no longer matched
   * the record on the server) — as opposed to a validation error or
   * exhausted retries. The UI should surface this distinctly: it means
   * "this was changed elsewhere, please review", not "this failed".
   */
  conflict?: boolean;
  /** The record's current version on the server. Set only when `conflict` is true and the server reported one. */
  serverVersion?: number;
  /** The record's current value on the server. Set only when `conflict` is true and the server reported one. */
  serverPayload?: unknown;
}

export type QueueStatus = 'idle' | 'processing' | 'queued';

export type ActionHandler = (action: QueuedAction) => Promise<void>;

// ── Retry / backoff constants ────────────────────────────────────────────────

/** Maximum number of transient-failure retries before an action is dead-lettered. */
export const MAX_RETRIES = 5;

/** Base delay (ms) for the first retry backoff window. */
export const BASE_DELAY_MS = 5_000; // 5 s

/** Maximum backoff delay (ms), regardless of retry count. */
export const MAX_DELAY_MS = 300_000; // 5 min

// ── Database ─────────────────────────────────────────────────────────────────

const DB_NAME = 'promiscope-offline-queue';
const DB_VERSION = 2;
const STORE_NAME = 'actions';
const FAILED_STORE_NAME = 'failed_actions';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;

      // Create the active-actions store (version 1, preserved across upgrade).
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('queuedAt', 'queuedAt', { unique: false });
      }

      // Version 2: dead-letter store for permanently-failed actions.
      if (!db.objectStoreNames.contains(FAILED_STORE_NAME)) {
        const failedStore = db.createObjectStore(FAILED_STORE_NAME, {
          keyPath: 'id',
        });
        failedStore.createIndex('failedAt', 'failedAt', { unique: false });
      }

      void event; // suppress unused-variable lint
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ── Queue operations ─────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

async function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDb();
  }
  return dbPromise;
}

/**
 * Enqueues an action to be retried when connectivity returns.
 *
 * @param type - A stable string identifying the action type (e.g. `'update_profile'`).
 * @param payload - Arbitrary JSON-serialisable payload.
 * @param options.baseVersion - Version/timestamp of the record this action was
 *   based on, if it targets a versioned record. Carried on the queued action
 *   and available to the handler at flush time so it can detect (and the
 *   server can reject) a write against a since-changed record. Omit for
 *   actions that don't target a versioned record — behaviour and processing
 *   cost are identical to before this option existed.
 * @returns The id of the newly queued action.
 */
export async function enqueueAction(
  type: string,
  payload: unknown,
  options?: { baseVersion?: number },
): Promise<string> {
  const db = await getDb();
  const action: QueuedAction = {
    id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    queuedAt: Date.now(),
    retryCount: 0,
    type,
    payload,
    ...(options?.baseVersion !== undefined
      ? { baseVersion: options.baseVersion }
      : {}),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(action);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return action.id;
}

/**
 * Returns all currently queued actions (oldest first).
 */
export async function getQueuedActions(): Promise<QueuedAction[]> {
  const db = await getDb();
  const actions: QueuedAction[] = [];

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const index = tx.objectStore(STORE_NAME).index('queuedAt');
    const cursor = index.openCursor(null, 'next');

    cursor.onsuccess = () => {
      if (cursor.result) {
        actions.push(cursor.result.value);
        cursor.result.continue();
      } else {
        resolve();
      }
    };
    cursor.onerror = () => reject(cursor.error);
  });

  return actions;
}

/**
 * Removes an action from the active queue after successful processing.
 */
export async function removeAction(id: string): Promise<void> {
  const db = await getDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Schedules the next retry for an action using exponential backoff with
 * full jitter.
 *
 * `nextRetryAt` = now + clamp(BASE_DELAY * 2^retryCount + jitter, 0, MAX_DELAY)
 *
 * Uses the *current* retryCount (before incrementing) so that the first
 * failure gets `BASE_DELAY` worth of backoff.
 */
export async function markRetry(id: string): Promise<void> {
  const db = await getDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const get = store.get(id);

    get.onsuccess = () => {
      const action: QueuedAction | undefined = get.result;
      if (action) {
        const exponential = BASE_DELAY_MS * Math.pow(2, action.retryCount);
        const jitter = Math.random() * exponential;
        const delay = Math.min(exponential + jitter, MAX_DELAY_MS);
        action.nextRetryAt = Date.now() + delay;
        action.retryCount += 1;
        store.put(action);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Returns the count of queued actions.
 */
export async function getQueueLength(): Promise<number> {
  const actions = await getQueuedActions();
  return actions.length;
}

/**
 * Checks whether any actions are currently queued.
 */
export async function hasQueuedActions(): Promise<boolean> {
  const count = await getQueueLength();
  return count > 0;
}

// ── Dead-letter (failed) store operations ────────────────────────────────────

/**
 * Returns all actions in the dead-letter store (oldest failure first).
 */
export async function getFailedActions(): Promise<FailedAction[]> {
  const db = await getDb();
  const actions: FailedAction[] = [];

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FAILED_STORE_NAME, 'readonly');
    const index = tx.objectStore(FAILED_STORE_NAME).index('failedAt');
    const cursor = index.openCursor(null, 'next');

    cursor.onsuccess = () => {
      if (cursor.result) {
        actions.push(cursor.result.value as FailedAction);
        cursor.result.continue();
      } else {
        resolve();
      }
    };
    cursor.onerror = () => reject(cursor.error);
  });

  return actions;
}

/**
 * Returns the number of dead-lettered actions.
 */
export async function getFailedCount(): Promise<number> {
  const actions = await getFailedActions();
  return actions.length;
}

/**
 * Discards a single failed action by id (removes it from the dead-letter store).
 * Safe to call with a non-existent id — resolves without error.
 */
export async function discardFailedAction(id: string): Promise<void> {
  const db = await getDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FAILED_STORE_NAME, 'readwrite');
    tx.objectStore(FAILED_STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Discards all dead-lettered actions.
 */
export async function discardAllFailedActions(): Promise<void> {
  const db = await getDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FAILED_STORE_NAME, 'readwrite');
    tx.objectStore(FAILED_STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Moves an action from the active queue to the dead-letter store.
 * Called internally by `processQueue` when an action is permanently failed
 * or conflicted.
 */
async function deadLetterAction(
  action: QueuedAction,
  error: Error,
  extra?: {
    conflict?: boolean;
    serverVersion?: number;
    serverPayload?: unknown;
  },
): Promise<void> {
  const db = await getDb();
  const failed: FailedAction = {
    ...action,
    failedAt: Date.now(),
    lastError: error.message,
    ...(extra?.conflict ? { conflict: true as const } : {}),
    ...(extra?.serverVersion !== undefined
      ? { serverVersion: extra.serverVersion }
      : {}),
    ...(extra?.serverPayload !== undefined
      ? { serverPayload: extra.serverPayload }
      : {}),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, FAILED_STORE_NAME], 'readwrite');
    tx.objectStore(FAILED_STORE_NAME).put(failed);
    tx.objectStore(STORE_NAME).delete(action.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Processing ───────────────────────────────────────────────────────────────

const handlers = new Map<string, ActionHandler>();

/**
 * Registers a handler for a specific action type.
 *
 * Handlers may throw:
 * - `OfflineQueueError` with `permanent: true` — action is immediately
 *   dead-lettered (never retried).
 * - `OfflineQueueError` with `permanent: false` — treated as transient.
 * - Any other `Error` — treated as transient.
 *
 * After `MAX_RETRIES` transient failures the action is also dead-lettered.
 */
export function registerHandler(type: string, handler: ActionHandler): void {
  handlers.set(type, handler);
}

/**
 * Processes all currently queued actions (oldest first).
 *
 * Unlike the previous implementation, **a failing action does not block
 * later actions**. Each action is evaluated independently:
 *
 * - If the action's `nextRetryAt` is in the future, it is skipped this pass.
 * - If the handler succeeds, the action is removed from the queue.
 * - If the handler throws `OfflineQueueConflictError` (the server detected
 *   the record changed since `baseVersion`), the action is moved to the
 *   dead-letter store immediately, tagged `conflict: true` — retrying would
 *   not help, since the client's base state is stale.
 * - If the handler throws a **permanent** `OfflineQueueError`, or the action
 *   has reached `MAX_RETRIES`, it is moved to the dead-letter store.
 * - Otherwise the action's `nextRetryAt` is set for backoff and it remains
 *   in the queue.
 *
 * @returns The number of successfully processed actions this pass.
 */
export async function processQueue(): Promise<number> {
  const actions = await getQueuedActions();
  const now = Date.now();
  let processed = 0;

  for (const action of actions) {
    // Skip actions not yet due for retry.
    if (action.nextRetryAt !== undefined && action.nextRetryAt > now) {
      continue;
    }

    const handler = handlers.get(action.type);
    if (!handler) continue;

    try {
      await handler(action);
      await removeAction(action.id);
      processed++;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      if (err instanceof OfflineQueueConflictError) {
        // The server rejected this write because the record moved on since
        // `baseVersion` (typically: another tab/device already flushed a
        // conflicting change). Retrying with the same stale base would
        // either fail again or silently clobber that other write, so we
        // dead-letter immediately for the user to review instead.
        await deadLetterAction(action, error, {
          conflict: true,
          serverVersion: err.serverVersion,
          serverPayload: err.serverPayload,
        });
        continue;
      }

      const isPermanent =
        err instanceof OfflineQueueError && err.permanent === true;

      if (isPermanent || action.retryCount >= MAX_RETRIES) {
        // Dead-letter: action will never be retried automatically.
        await deadLetterAction(action, error);
      } else {
        // Transient: schedule a backoff retry and continue with other actions.
        await markRetry(action.id);
      }
      // NOTE: No `break` — we continue to the next action regardless.
    }
  }

  return processed;
}
