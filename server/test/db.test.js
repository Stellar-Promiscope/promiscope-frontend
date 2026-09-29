const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'scout-off-backend-db-test-'),
);
process.env.DB_PATH = path.join(tmpDir, 'nested', 'test.db');

const dbModulePath = require.resolve('../src/db');

function loadDb() {
  delete require.cache[dbModulePath];
  return require('../src/db');
}

function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => r.name);
}

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('db creates the DB_PATH directory and every table', () => {
  const db = loadDb();
  assert.ok(fs.existsSync(process.env.DB_PATH));
  const tables = tableNames(db);
  for (const name of [
    'referral_codes',
    'academies',
    'academy_members',
    'sponsorship_waitlist',
    'milestone_submissions',
  ]) {
    assert.ok(tables.includes(name), `missing table ${name}`);
  }
  const academyColumns = db.prepare('PRAGMA table_info(academies)').all();
  assert.ok(academyColumns.some((c) => c.name === 'quorum'));
  db.prepare(
    "INSERT INTO academies (id, name, owner_wallet, created_at) VALUES ('a1', 'A', 'G', 1)",
  ).run();
  db.close();
});

test('db schema setup is idempotent and preserves existing data', () => {
  const db = loadDb();
  const quorumColumns = db
    .prepare('PRAGMA table_info(academies)')
    .all()
    .filter((c) => c.name === 'quorum');
  assert.equal(quorumColumns.length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM academies').get().n, 1);
  db.close();
});
