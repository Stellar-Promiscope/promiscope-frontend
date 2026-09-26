import type { Migration } from '../sqliteMigrations';

export const mediaModerationMigrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS media_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cid TEXT NOT NULL,
          player_id TEXT,
          reason TEXT NOT NULL,
          details TEXT,
          reporter_key TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER,
          resolution TEXT
        );
        -- One open report per reporter per CID: repeat reports are aggregated, not stacked.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_media_reports_open_reporter
          ON media_reports(cid, reporter_key) WHERE resolved_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_media_reports_open
          ON media_reports(resolved_at, cid);
        CREATE TABLE IF NOT EXISTS media_denylist (
          cid TEXT PRIMARY KEY,
          reason TEXT NOT NULL,
          decided_by TEXT NOT NULL,
          decided_at INTEGER NOT NULL
        );
      `);
    },
  },
];
