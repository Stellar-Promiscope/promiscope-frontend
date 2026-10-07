const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// db.js reads process.env.DB_PATH once, at require time, so point it at a
// fresh temp file before anything requires the app — this keeps every test
// run isolated from any real/dev database on disk.
const tmpDbPath = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'promiscope-backend-test-')),
  'test.db',
);
process.env.DB_PATH = tmpDbPath;

const createApp = require('../src/app');

let server;
let baseUrl;

test.before(async () => {
  const app = createApp();
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(path.dirname(tmpDbPath), { recursive: true, force: true });
});

async function post(pathname, body) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(pathname) {
  const res = await fetch(`${baseUrl}${pathname}`);
  return { status: res.status, body: await res.json() };
}

test('GET /health returns ok', async () => {
  const res = await get('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok' });
});

test('POST /referrals/generate creates a code owned by the given scout', async () => {
  const res = await post('/referrals/generate', { scoutWallet: 'GSCOUT_A' });
  assert.equal(res.status, 201);
  assert.match(res.body.code, /^SCOUT-[A-Z0-9]{6}$/);
  assert.equal(res.body.scoutWallet, 'GSCOUT_A');
  assert.equal(res.body.usedBy, null);
});

test('POST /referrals/generate requires scoutWallet', async () => {
  const res = await post('/referrals/generate', {});
  assert.equal(res.status, 400);
});

test("GET /referrals/scout/:wallet returns only that scout's codes", async () => {
  await post('/referrals/generate', { scoutWallet: 'GSCOUT_B' });
  await post('/referrals/generate', { scoutWallet: 'GSCOUT_B' });
  await post('/referrals/generate', { scoutWallet: 'GSCOUT_C' });

  const res = await get('/referrals/scout/GSCOUT_B');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
  assert.ok(res.body.every((c) => c.scoutWallet === 'GSCOUT_B'));
});

test('full generate -> redeem -> count lifecycle', async () => {
  const generated = await post('/referrals/generate', {
    scoutWallet: 'GSCOUT_D',
  });
  const code = generated.body.code;

  const countBefore = await get('/referrals/count/GSCOUT_D');
  assert.equal(countBefore.body.totalCodes, 1);
  assert.equal(countBefore.body.successfulReferrals, 0);

  const redeemed = await post('/referrals/redeem', {
    code,
    usedBy: 'GFRIEND_1',
  });
  assert.equal(redeemed.status, 200);
  assert.deepEqual(redeemed.body, { success: true });

  const countAfter = await get('/referrals/count/GSCOUT_D');
  assert.equal(countAfter.body.successfulReferrals, 1);

  // Redeeming the same code again must fail — already used.
  const secondAttempt = await post('/referrals/redeem', {
    code,
    usedBy: 'GFRIEND_2',
  });
  assert.equal(secondAttempt.status, 404);
});

test('POST /referrals/redeem returns 404 for an unknown code', async () => {
  const res = await post('/referrals/redeem', {
    code: 'SCOUT-NOPE99',
    usedBy: 'GANYONE',
  });
  assert.equal(res.status, 404);
});

test('POST /referrals/redeem requires code and usedBy', async () => {
  const res = await post('/referrals/redeem', { code: 'SCOUT-ABC123' });
  assert.equal(res.status, 400);
});

test('POST /referrals/redeem rejects self-redemption', async () => {
  const generated = await post('/referrals/generate', {
    scoutWallet: 'GSCOUT_OWNER',
  });
  const code = generated.body.code;

  const res = await post('/referrals/redeem', {
    code,
    usedBy: 'GSCOUT_OWNER',
  });
  assert.equal(res.status, 404);

  const codes = await get('/referrals/scout/GSCOUT_OWNER');
  assert.equal(codes.body[0].usedBy, null);
});

test('GET /referrals/overview reports totals and top referrers', async () => {
  await post('/referrals/generate', { scoutWallet: 'GSCOUT_E' });
  const generated = await post('/referrals/generate', {
    scoutWallet: 'GSCOUT_E',
  });
  await post('/referrals/redeem', {
    code: generated.body.code,
    usedBy: 'GFRIEND_3',
  });

  const res = await get('/referrals/overview');
  assert.equal(res.status, 200);
  assert.ok(res.body.totalCodes >= 2);
  assert.ok(res.body.totalSuccessfulReferrals >= 1);
  const entry = res.body.topReferrers.find((r) => r.scoutWallet === 'GSCOUT_E');
  assert.deepEqual(entry, {
    scoutWallet: 'GSCOUT_E',
    totalCodes: 2,
    successfulReferrals: 1,
  });
});

test('GET /referrals/all returns every code across every scout', async () => {
  await post('/referrals/generate', { scoutWallet: 'GSCOUT_F' });
  await post('/referrals/generate', { scoutWallet: 'GSCOUT_G' });

  const res = await get('/referrals/all');
  assert.equal(res.status, 200);
  assert.ok(res.body.length >= 2);
  assert.ok(res.body.some((c) => c.scoutWallet === 'GSCOUT_F'));
  assert.ok(res.body.some((c) => c.scoutWallet === 'GSCOUT_G'));
});
