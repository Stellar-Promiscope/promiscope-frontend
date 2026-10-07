/**
 * Bulk Import Progress Store — IndexedDB-backed persistence for multi-row player registration.
 *
 * Unlike the offline queue (which is idempotent-safe), bulk import cannot blindly replay rows
 * that already succeeded on-chain. This store tracks:
 * - Which rows have confirmed on-chain success
 * - Which rows are in-flight (have a transaction hash awaiting confirmation)
 * - Which rows never got signed/submitted
 *
 * On resume (reload/crash), completed rows are recognized by a stable row identity
 * (file hash + row number) and are not re-presented for signing.
 */

export type BulkImportRowStatus =
  | 'pending'
  | 'signing'
  | 'success'
  | 'failed'
  | 'skipped';

export interface BulkImportRowState {
  /** 1-based row number from the file */
  rowNumber: number;
  /** SHA256 hash of the source file content for resume recognition */
  fileHash: string;
  /** Current status of this row */
  status: BulkImportRowStatus;
  /** Transaction hash if submitted/signed */
  txHash?: string | null;
  /** Error message if failed */
  error?: string | null;
  /** When this row was last updated (Unix ms) */
  updatedAt: number;
}

export interface BulkImportSession {
  /** Unique session ID, created at first import */
  sessionId: string;
  /** SHA256 hash of the source file */
  fileHash: string;
  /** Original file name */
  fileName: string;
  /** When this session was created (Unix ms) */
  createdAt: number;
  /** When this session was last active (Unix ms) */
  lastActivityAt: number;
  /** Per-row state records */
  rows: Map<number, BulkImportRowState>;
}

// ── Database ──────────────────────────────────────────────────────────────────

const DB_NAME = 'promiscope-bulk-import';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'sessionId',
        });
        store.createIndex('fileHash', 'fileHash', { unique: false });
        store.createIndex('lastActivityAt', 'lastActivityAt', {
          unique: false,
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

async function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDb();
  }
  return dbPromise;
}

// ── File hashing (for stable resume recognition) ────────────────────────────

/**
 * Compute SHA256 hash of file text for stable resume recognition.
 * Used to identify whether a re-uploaded file is the same as before.
 */
export async function hashFileContent(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Session operations ────────────────────────────────────────────────────────

/**
 * Create or retrieve a bulk import session for a given file.
 * If a session already exists for this file hash, reuse it (resume case).
 * Otherwise, create a new session.
 */
export async function getOrCreateSession(
  fileHash: string,
  fileName: string,
): Promise<BulkImportSession> {
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('fileHash');
    const query = index.getAll(fileHash);

    query.onsuccess = () => {
      const results = query.result as any[];
      if (results.length > 0) {
        // Resume existing session
        const existingSession = results[0];
        existingSession.lastActivityAt = Date.now();
        existingSession.fileName = fileName;
        store.put(existingSession);
        tx.oncomplete = () => {
          resolve({
            ...existingSession,
            rows: new Map(Object.entries(existingSession.rowsData || {})),
          });
        };
      } else {
        // Create new session
        const sessionId = `session_${fileHash}_${Date.now()}`;
        const session: any = {
          sessionId,
          fileHash,
          fileName,
          createdAt: Date.now(),
          lastActivityAt: Date.now(),
          rowsData: {},
        };
        store.add(session);
        tx.oncomplete = () => {
          resolve({
            ...session,
            rows: new Map(),
          });
        };
      }
    };
    query.onerror = () => reject(query.error);
  });
}

/**
 * Update the status of a single row in a session.
 */
export async function updateRowStatus(
  sessionId: string,
  rowNumber: number,
  status: BulkImportRowStatus,
  txHash?: string | null,
  error?: string | null,
): Promise<void> {
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getRequest = store.get(sessionId);

    getRequest.onsuccess = () => {
      const session = getRequest.result as any;
      if (!session) {
        reject(new Error(`Session ${sessionId} not found`));
        return;
      }

      session.rowsData = session.rowsData || {};
      session.rowsData[rowNumber] = {
        rowNumber,
        fileHash: session.fileHash,
        status,
        txHash,
        error,
        updatedAt: Date.now(),
      };
      session.lastActivityAt = Date.now();

      store.put(session);
      tx.oncomplete = () => resolve();
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

/**
 * Retrieve all rows for a session, indexed by row number.
 */
export async function getSessionRows(
  sessionId: string,
): Promise<Map<number, BulkImportRowState>> {
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const getRequest = store.get(sessionId);

    getRequest.onsuccess = () => {
      const session = getRequest.result as any;
      if (!session) {
        resolve(new Map());
        return;
      }
      const rows = new Map<number, BulkImportRowState>(
        Object.entries(session.rowsData || {}).map(([key, val]: any) => [
          parseInt(key, 10),
          val,
        ]),
      );
      resolve(rows);
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

/**
 * Clean up expired bulk import sessions (older than 7 days).
 * Call this periodically or on app startup to prevent indefinite storage growth.
 */
export async function cleanupExpiredSessions(
  maxAgeMs: number = 7 * 24 * 60 * 60 * 1000,
): Promise<void> {
  const db = await getDb();
  const cutoffTime = Date.now() - maxAgeMs;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('lastActivityAt');
    const range = IDBKeyRange.upperBound(cutoffTime);
    const deleteRequest = index.openCursor(range);

    let count = 0;
    deleteRequest.onsuccess = (event) => {
      const cursor = (event.target as any)?.result;
      if (cursor) {
        cursor.delete();
        count++;
        cursor.continue();
      } else {
        tx.oncomplete = () => {
          console.log(`Cleaned up ${count} expired bulk import sessions`);
          resolve();
        };
      }
    };
    deleteRequest.onerror = () => reject(deleteRequest.error);
  });
}

/**
 * Delete a specific session (called after user completes or abandons import).
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const deleteRequest = store.delete(sessionId);

    deleteRequest.onsuccess = () => {
      tx.oncomplete = () => resolve();
    };
    deleteRequest.onerror = () => reject(deleteRequest.error);
  });
}
