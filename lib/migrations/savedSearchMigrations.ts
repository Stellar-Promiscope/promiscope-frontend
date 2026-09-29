import type { Migration } from '../sqliteMigrations';

/**
 * Migration 1 reproduces saved_search's already-shipped schema with
 * `IF NOT EXISTS` DDL, so opening an existing production database applies
 * zero destructive changes — it just records that version 1 is present.
 */
export const savedSearchMigrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS saved_search (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scout_wallet TEXT NOT NULL,
          name TEXT NOT NULL,
          filter TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_saved_search_scout_wallet ON saved_search(scout_wallet);
      `);
    },
  },
  {
    // Tracks when a scout last looked at a saved search's results, so the UI
    // can surface how many matching players are new since then. Backfilled
    // to created_at — a search nobody has re-opened yet counts new matches
    // from the moment it was saved.
    version: 2,
    name: 'add_last_viewed_at',
    up: (db) => {
      const columns = db.prepare('PRAGMA table_info(saved_search)').all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === 'last_viewed_at')) {
        db.exec('ALTER TABLE saved_search ADD COLUMN last_viewed_at INTEGER');
        db.exec(
          'UPDATE saved_search SET last_viewed_at = created_at WHERE last_viewed_at IS NULL',
        );
      }
    },
  },
  {
    // Tracks row version for optimistic concurrency (ETag / If-Match).
    // Incremented on every update so concurrent writes can be detected and
    // rejected with 409 Conflict.
    version: 3,
    name: 'add_version',
    up: (db) => {
      const columns = db.prepare('PRAGMA table_info(saved_search)').all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === 'version')) {
        db.exec(
          'ALTER TABLE saved_search ADD COLUMN version INTEGER NOT NULL DEFAULT 1',
        );
      }
    },
  },
];
