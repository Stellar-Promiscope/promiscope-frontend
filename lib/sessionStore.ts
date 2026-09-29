/**
 * sessionStore — SQLite-backed server-side session registry (see #1179).
 *
 * lib/session.ts's access/refresh cookies are HMAC-signed and time-bound,
 * but a signature alone can't be revoked early — there was no way to
 * invalidate a specific still-valid cookie before its own `exp`, e.g. to
 * support "log out of all devices" or to react to a compromised device.
 *
 * Every login now mints a random opaque session id (`sid`) shared by that
 * login's access and refresh token pair (and carried forward across
 * refresh-token rotations, so the underlying session persists even though
 * the tokens themselves rotate). This store is the source of truth for
 * whether a given `sid` is still active: lib/session.ts's getSessionWallet
 * and app/api/auth/refresh's rotation both check `isActive()` in addition
 * to verifying the token's signature, so revoking a row here rejects that
 * cookie on its very next request even though the token remains
 * cryptographically valid until its `exp`.
 *
 * Mirrors lib/watchlistStore.ts / lib/notificationReadStore.ts's
 * conventions: one table, idempotent `CREATE TABLE IF NOT EXISTS` DDL run
 * on construction, a process-wide singleton, DB bootstrap shared via
 * lib/sqliteDb.ts.
 */
import type Database from 'better-sqlite3';
import { openSqliteDb } from './sqliteDb';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_wallet ON sessions(wallet);
`;

export interface SessionRow {
  id: string;
  wallet: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  revokedAt: number | null;
  userAgent: string | null;
}

interface RawSessionRow {
  id: string;
  wallet: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
  revoked_at: number | null;
  user_agent: string | null;
}

function rowToSession(row: RawSessionRow): SessionRow {
  return {
    id: row.id,
    wallet: row.wallet,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
    userAgent: row.user_agent,
  };
}

export class SessionStore {
  private static _instance: SessionStore | null = null;

  private db: Database.Database;

  private constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(SCHEMA);
  }

  static getInstance(): SessionStore {
    if (!SessionStore._instance) {
      SessionStore._instance = new SessionStore(
        openSqliteDb('sessions.db', 'SESSIONS_DB_PATH'),
      );
    }
    return SessionStore._instance;
  }

  /** Closes the DB connection and clears the singleton. Use ONLY in tests. */
  static resetInstance(): void {
    if (SessionStore._instance) {
      SessionStore._instance.db.close();
    }
    SessionStore._instance = null;
  }

  /**
   * Registers a freshly-issued session id, mapped to `wallet`, expiring at
   * `expiresAt` (epoch ms) — the same instant the paired refresh cookie's
   * `maxAge` would naturally expire it.
   */
  create(
    id: string,
    wallet: string,
    expiresAt: number,
    userAgent?: string | null,
  ): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (id, wallet, created_at, expires_at, last_seen_at, revoked_at, user_agent)
         VALUES (@id, @wallet, @created_at, @expires_at, @last_seen_at, NULL, @user_agent)`,
      )
      .run({
        id,
        wallet,
        created_at: now,
        expires_at: expiresAt,
        last_seen_at: now,
        user_agent: userAgent ?? null,
      });
  }

  /**
   * Extends an existing, still-active session's expiry and bumps its
   * last-seen timestamp — called on refresh-token rotation so the
   * underlying session id (and therefore its revocation state) survives
   * across rotations instead of each refresh minting an unrelated session.
   * No-op if the session doesn't exist or is already revoked.
   */
  touch(id: string, expiresAt: number): void {
    this.db
      .prepare(
        `UPDATE sessions SET expires_at = ?, last_seen_at = ?
         WHERE id = ? AND revoked_at IS NULL`,
      )
      .run(expiresAt, Date.now(), id);
  }

  /**
   * Whether `id` is a currently active session: exists, has not been
   * revoked, and has not passed its stored expiry. This is the check that
   * gives revocation real teeth — a token can still verify
   * cryptographically after its session row is gone or flagged revoked, so
   * callers MUST treat that as unauthenticated regardless of the token's
   * own `exp` claim.
   */
  isActive(id: string): boolean {
    const row = this.db
      .prepare('SELECT revoked_at, expires_at FROM sessions WHERE id = ?')
      .get(id) as { revoked_at: number | null; expires_at: number } | undefined;
    if (!row) return false;
    if (row.revoked_at !== null) return false;
    if (row.expires_at < Date.now()) return false;
    return true;
  }

  /**
   * Flags a single session revoked (a soft delete — the row is kept for
   * audit purposes). Returns false if the session didn't exist or was
   * already revoked.
   */
  revoke(id: string): boolean {
    const result = this.db
      .prepare(
        'UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
      )
      .run(Date.now(), id);
    return result.changes > 0;
  }

  /**
   * Flags every currently-active session belonging to `wallet` revoked —
   * the "log out of all devices" primitive. Returns the number of sessions
   * revoked.
   */
  revokeAllForWallet(wallet: string): number {
    const result = this.db
      .prepare(
        'UPDATE sessions SET revoked_at = ? WHERE wallet = ? AND revoked_at IS NULL',
      )
      .run(Date.now(), wallet);
    return result.changes;
  }

  /** Lists every session row (active or revoked) for wallet, newest first. */
  listForWallet(wallet: string): SessionRow[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM sessions WHERE wallet = ? ORDER BY created_at DESC',
      )
      .all(wallet) as RawSessionRow[];
    return rows.map(rowToSession);
  }

  /**
   * Deletes every session row for `wallet` (data-deletion cascade). Callers
   * should revokeAllForWallet first so no live session outlives the request.
   */
  deleteForWallet(wallet: string): number {
    return this.db.prepare('DELETE FROM sessions WHERE wallet = ?').run(wallet)
      .changes;
  }

  close(): void {
    this.db.close();
  }
}
