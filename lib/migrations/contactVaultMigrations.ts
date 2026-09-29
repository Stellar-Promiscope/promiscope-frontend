import type { Migration } from '../sqliteMigrations';

/**
 * Migration 1 reproduces the contact-vault schema: one row per player,
 * holding ONLY the AES-256-GCM sealed blob (see lib/contactVaultCrypto.ts).
 * Plaintext contact details must never be written to this table — the upload
 * route seals before insert, and the release route unseals only in memory.
 */
export const contactVaultMigrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS contact_vault (
          player_id TEXT PRIMARY KEY,
          owner_wallet TEXT NOT NULL,
          iv TEXT NOT NULL,
          ciphertext TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_contact_vault_owner ON contact_vault(owner_wallet);
      `);
    },
  },
];
