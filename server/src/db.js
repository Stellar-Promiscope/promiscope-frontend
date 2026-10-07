const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH =
  process.env.DB_PATH ?? path.join(__dirname, '..', 'data', 'promiscope.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS referral_codes (
    code TEXT PRIMARY KEY,
    scout_wallet TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    used_by TEXT,
    used_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_referral_codes_scout_wallet
    ON referral_codes (scout_wallet);

  -- Academy/organization identities (issue #663): groups several on-chain
  -- validator wallets (head coach, assistant coaches, director, ...) under
  -- one institutional identity for off-chain display/attribution. This is
  -- purely an off-chain grouping layer — each member wallet must still be
  -- individually authorized on-chain via add_validator for its approvals to
  -- be valid; see docs/academy-validator-model.md in the frontend app.
  CREATE TABLE IF NOT EXISTS academies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_wallet TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- A wallet belongs to at most one academy at a time (PRIMARY KEY on
  -- wallet), matching the real-world case this models: institutional staff,
  -- not individuals holding membership in several academies simultaneously.
  CREATE TABLE IF NOT EXISTS academy_members (
    wallet TEXT PRIMARY KEY,
    academy_id TEXT NOT NULL REFERENCES academies(id),
    added_at INTEGER NOT NULL,
    added_by TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_academy_members_academy_id
    ON academy_members (academy_id);

  -- Sponsorship waitlist (issue #696): captures interest from fans, investors,
  -- and potential sponsors before the fractionalized-sponsorship feature ships.
  -- Not publicly readable — this table is only queried by internal admin tooling.
  CREATE TABLE IF NOT EXISTS sponsorship_waitlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    interest_type TEXT NOT NULL DEFAULT 'fan',
    created_at INTEGER NOT NULL,
    ip_hash TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sponsorship_waitlist_email
    ON sponsorship_waitlist (email);

  -- Pending milestone submissions (issues #567, #568): an off-chain queue of
  -- milestone claims awaiting validator review. Distinct from the on-chain
  -- Milestone record in types/index.ts, which only exists once a validator
  -- has already approved one via approve_milestone — this table models the
  -- "not yet approved" state that the contract has no concept of.
  CREATE TABLE IF NOT EXISTS milestone_submissions (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL,
    player_name TEXT,
    description TEXT NOT NULL,
    evidence_url TEXT,
    validator_wallet TEXT NOT NULL,
    submitted_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    tx_hash TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_milestone_submissions_validator_status
    ON milestone_submissions (validator_wallet, status, created_at);
`);

// Academy validator quorum (issue #1185): an optional, off-chain-only
// minimum number of an academy's distinct member wallets that must each
// endorse a milestone before it's shown as "academy-verified" in the UI —
// purely additive, never touches on-chain approve_milestone authorization.
// NULL (the default) means "no quorum configured," which must behave
// identically to today. Added via a guarded ALTER TABLE rather than the
// CREATE TABLE above, since IF NOT EXISTS is a no-op against an
// already-existing `academies` table in any deployment that predates this
// column — this repo has no migration-versioning framework on the server
// side (unlike the Next app's lib/sqliteMigrations.ts), so the guard is
// inlined here instead.
const academyColumns = db.prepare('PRAGMA table_info(academies)').all();
if (!academyColumns.some((c) => c.name === 'quorum')) {
  db.exec('ALTER TABLE academies ADD COLUMN quorum INTEGER');
}

module.exports = db;
