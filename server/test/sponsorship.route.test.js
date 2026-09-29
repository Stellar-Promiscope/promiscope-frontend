const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDbPath = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'scout-off-backend-sponsorship-test-')),
  'test.db',
);
process.env.DB_PATH = tmpDbPath;
delete process.env.TURNSTILE_SECRET_KEY;

const createApp = require('../src/app');
const sponsorshipService = require('../src/sponsorshipService');

let server;
let baseUrl;
let originalFetch;

test.before(async () => {
  const app = createApp();
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  originalFetch = global.fetch;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(path.dirname(tmpDbPath), { recursive: true, force: true });
  delete process.env.TURNSTILE_SECRET_KEY;
  global.fetch = originalFetch;
});

async function post(body) {
  const res = await originalFetch(`${baseUrl}/sponsorship/waitlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('POST /sponsorship/waitlist rejects an invalid email', async () => {
  const res = await post({ email: 'not-an-email' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /email/i);
});

test('POST /sponsorship/waitlist rejects an unknown interestType', async () => {
  const res = await post({ email: 'a@example.com', interestType: 'whale' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /interestType/);
});

test('POST /sponsorship/waitlist signs up a new email', async () => {
  const res = await post({
    email: 'fan@example.com',
    interestType: 'investor',
  });
  assert.equal(res.status, 201);
});

test('POST /sponsorship/waitlist returns 409 for a duplicate email, case-insensitively', async () => {
  const res = await post({ email: 'FAN@example.com' });
  assert.equal(res.status, 409);
  assert.match(res.body.message, /already/);
});

test('GET /sponsorship/waitlist lists signups without IP hashes', async () => {
  const res = await originalFetch(`${baseUrl}/sponsorship/waitlist`);
  const body = await res.json();
  assert.equal(res.status, 200);
  const entry = body.find((s) => s.email === 'fan@example.com');
  assert.equal(entry.interestType, 'investor');
  assert.equal(entry.ipHash, undefined);
  assert.equal(entry.ip_hash, undefined);
});

test('sponsorshipService.addSignup falls back to fan and returns null on duplicates', () => {
  const row = sponsorshipService.addSignup('svc@example.com', 'bogus', 1, 'h');
  assert.equal(row.interest_type, 'fan');
  assert.equal(
    sponsorshipService.addSignup('svc@example.com', 'fan', 2, 'h'),
    null,
  );
});

test('POST /sponsorship/waitlist enforces Turnstile when a secret is configured', async (t) => {
  process.env.TURNSTILE_SECRET_KEY = 'test-secret';
  t.after(() => {
    delete process.env.TURNSTILE_SECRET_KEY;
    global.fetch = originalFetch;
  });

  const missing = await post({ email: 'bot@example.com' });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /challenge/i);

  global.fetch = async () =>
    new Response(JSON.stringify({ success: false }), { status: 200 });
  const failed = await post({
    email: 'bot@example.com',
    turnstileToken: 'bad',
  });
  assert.equal(failed.status, 400);

  global.fetch = async () =>
    new Response(JSON.stringify({ success: true }), { status: 200 });
  const ok = await post({ email: 'human@example.com', turnstileToken: 'good' });
  assert.equal(ok.status, 201);
});
