/**
 * contactVaultStore — SQLite-backed persistence for sealed player contact
 * details (issue #1301).
 *
 * Mirrors lib/watchlistStore.ts's conventions: a process-wide singleton, DB
 * bootstrap and schema shared via lib/sqliteDb.ts's openSqliteDb, with
 * schema applied through lib/sqliteMigrations.ts's versioned migration
 * runner (see lib/migrations/contactVaultMigrations.ts).
 *
 * Privacy invariant: this store holds ONLY sealed blobs
 * (`{iv, ciphertext}` from lib/contactVaultCrypto.ts). Callers must seal
 * before `upsert` and unseal after `get` — there is no code path here that
 * accepts or returns plaintext, so a database dump reveals nothing without
 * `CONTACT_VAULT_KEY`.
 */
import type Database from 'better-sqlite3';
import { openSqliteDb } from './sqliteDb';
import { contactVaultMigrations } from './migrations/contactVaultMigrations';
import { normalizeStellarAddress } from './stellar';
import type { SealedContactDetails } from './contactVaultCrypto';

interface ContactVaultRow {
  player_id: string;
  owner_wallet: string;
  iv: string;
  ciphertext: string;
  updated_at: number;
}

export interface SealedContactRecord extends SealedContactDetails {
  ownerWallet: string;
  updatedAt: number;
}

function rowToRecord(row: ContactVaultRow): SealedContactRecord {
  return {
    iv: row.iv,
    ciphertext: row.ciphertext,
    ownerWallet: row.owner_wallet,
    updatedAt: row.updated_at,
  };
}

export class ContactVaultStore {
  private static _instance: ContactVaultStore | null = null;

  private db: Database.Database;

  private constructor(db: Database.Database) {
    this.db = db;
  }

  static getInstance(): ContactVaultStore {
    if (!ContactVaultStore._instance) {
      ContactVaultStore._instance = new ContactVaultStore(
        openSqliteDb(
          'contact-vault.db',
          'CONTACT_VAULT_DB_PATH',
          contactVaultMigrations,
        ),
      );
    }
    return ContactVaultStore._instance;
  }

  /** Closes the DB connection and clears the singleton. Use ONLY in tests. */
  static resetInstance(): void {
    if (ContactVaultStore._instance) {
      ContactVaultStore._instance.db.close();
    }
    ContactVaultStore._instance = null;
  }

  /**
   * Inserts or replaces the sealed blob for a player. Only the player's own
   * wallet (or its verified backup) may write — enforced by the route, not
   * here; this method is storage only.
   */
  upsert(
    playerId: string,
    ownerWallet: string,
    sealed: SealedContactDetails,
  ): SealedContactRecord {
    const normalizedPlayerId = normalizeStellarAddress(playerId);
    const normalizedOwner = normalizeStellarAddress(ownerWallet);
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO contact_vault (player_id, owner_wallet, iv, ciphertext, updated_at)
         VALUES (@player_id, @owner_wallet, @iv, @ciphertext, @updated_at)
         ON CONFLICT(player_id) DO UPDATE SET
           owner_wallet = excluded.owner_wallet,
           iv = excluded.iv,
           ciphertext = excluded.ciphertext,
           updated_at = excluded.updated_at`,
      )
      .run({
        player_id: normalizedPlayerId,
        owner_wallet: normalizedOwner,
        iv: sealed.iv,
        ciphertext: sealed.ciphertext,
        updated_at: now,
      });
    const row = this.db
      .prepare('SELECT * FROM contact_vault WHERE player_id = ?')
      .get(normalizedPlayerId) as ContactVaultRow;
    return rowToRecord(row);
  }

  /** Returns the sealed blob for a player, or null when none was uploaded. */
  get(playerId: string): SealedContactRecord | null {
    const normalizedPlayerId = normalizeStellarAddress(playerId);
    const row = this.db
      .prepare('SELECT * FROM contact_vault WHERE player_id = ?')
      .get(normalizedPlayerId) as ContactVaultRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  /** Deletes a player's vault row (account deletion / rotation). */
  remove(playerId: string): boolean {
    const normalizedPlayerId = normalizeStellarAddress(playerId);
    const result = this.db
      .prepare('DELETE FROM contact_vault WHERE player_id = ?')
      .run(normalizedPlayerId);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
