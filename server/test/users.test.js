const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDbPath = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'promiscope-backend-test-')),
  'test.db',
);
process.env.DB_PATH = tmpDbPath;
process.env.BACKEND_SERVICE_TOKEN = 'test-service-token';

const createApp = require('../src/app');
const db = require('../src/db');

const WALLET = 'GUSER';
const OTHER = 'GOTHER';

let server;
let baseUrl;

test.before(async () => {
  server = await new Promise((resolve) => {
    const s = createApp().listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const now = Date.now();
  const insertCode = db.prepare(
    'INSERT INTO referral_codes (code, scout_wallet, created_at, used_by, used_at) VALUES (?, ?, ?, ?, ?)',
  );
  insertCode.run('UNUSED', WALLET, now, null, null);
  insertCode.run('REDEEMED', WALLET, now, OTHER, now);
  insertCode.run('THEIRS', OTHER, now, WALLET, now);
  db.prepare(
    'INSERT INTO academies (id, name, owner_wallet, created_at) VALUES (?, ?, ?, ?)',
  ).run('a1', 'Academy', WALLET, now);
  const insertMember = db.prepare(
    'INSERT INTO academy_members (wallet, academy_id, added_at, added_by) VALUES (?, ?, ?, ?)',
  );
  insertMember.run(WALLET, 'a1', now, WALLET);
  insertMember.run(OTHER, 'a1', now, WALLET);
  const insertSubmission = db.prepare(
    `INSERT INTO milestone_submissions (id, player_id, description, validator_wallet, submitted_by, status, created_at)
     VALUES (?, 'p1', 'goal', ?, ?, ?, ?)`,
  );
  insertSubmission.run('s-pending', OTHER, WALLET, 'pending', now);
  insertSubmission.run('s-approved', OTHER, WALLET, 'approved', now);
  insertSubmission.run('s-reviewed', WALLET, OTHER, 'pending', now);
  db.prepare(
    "INSERT INTO sponsorship_waitlist (email, interest_type, created_at, ip_hash) VALUES ('fan@example.com', 'fan', ?, 'h')",
  ).run(now);
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(path.dirname(tmpDbPath), { recursive: true, force: true });
});

function call(method, pathname, { token = 'test-service-token', body } = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Wallet': WALLET,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test('rejects requests without the service token', async () => {
  const res = await call('GET', '/users/me/export', { token: 'wrong' });
  assert.equal(res.status, 401);
});

test('exports every backend section linked to the wallet', async () => {
  const res = await call('GET', '/users/me/export');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.referralCodes.length, 2);
  assert.equal(body.referralRedemptions.length, 1);
  assert.equal(body.academiesOwned.length, 1);
  assert.equal(body.academyMembership.academy_id, 'a1');
  assert.equal(body.academyMembersAdded.length, 1);
  assert.equal(body.milestoneSubmissions.length, 2);
  assert.equal(body.milestoneSubmissionsReviewed.length, 1);
});

test('deletes or anonymizes wallet data, then exports nothing', async () => {
  const res = await call('DELETE', '/users/me');
  assert.equal(res.status, 200);
  const { removed, anonymized } = await res.json();
  assert.deepEqual(removed, {
    referralCodes: 1,
    academyMembership: 1,
    milestoneSubmissions: 1,
  });
  assert.equal(anonymized.referralCodes, 1);
  assert.equal(anonymized.referralRedemptions, 1);
  assert.equal(anonymized.milestoneSubmissions, 1);

  // The referring scout's redemption is still counted.
  const theirs = db
    .prepare("SELECT used_by FROM referral_codes WHERE code = 'THEIRS'")
    .get();
  assert.equal(theirs.used_by, 'deleted-user');

  const after = await (await call('GET', '/users/me/export')).json();
  for (const [key, value] of Object.entries(after)) {
    assert.ok(
      value === null || value.length === 0,
      `${key} should be empty after deletion`,
    );
  }
});

test('exports and deletes sponsorship waitlist entries by email', async () => {
  const found = await (
    await call('GET', '/users/me/sponsorship-waitlist?email=Fan@example.com')
  ).json();
  assert.equal(found.entry.email, 'fan@example.com');

  const res = await call('DELETE', '/users/me/sponsorship-waitlist', {
    body: { email: 'fan@example.com' },
  });
  assert.deepEqual(await res.json(), { removed: 1 });
});
