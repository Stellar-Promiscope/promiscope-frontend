const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDbPath = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'promiscope-backend-turnstile-test-')),
  'test.db',
);
process.env.DB_PATH = tmpDbPath;
process.env.TURNSTILE_SECRET_KEY = 'test-secret';

const createApp = require('../src/app');

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

async function post(pathname, body) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('POST /referrals/generate rejects a missing turnstile token with a clear error', async () => {
  const res = await post('/referrals/generate', { scoutWallet: 'GSCOUT_X' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /challenge/i);
});

test('POST /referrals/generate rejects a failed turnstile verification', async () => {
  global.fetch = async (url, options) => {
    if (typeof url === 'string' && url.includes('challenges.cloudflare.com')) {
      return new Response(JSON.stringify({ success: false }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  const res = await post('/referrals/generate', {
    scoutWallet: 'GSCOUT_Y',
    turnstileToken: 'bad-token',
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /challenge failed/i);
});

test('POST /referrals/generate succeeds when turnstile verification passes', async () => {
  global.fetch = async (url, options) => {
    if (typeof url === 'string' && url.includes('challenges.cloudflare.com')) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  const res = await post('/referrals/generate', {
    scoutWallet: 'GSCOUT_Z',
    turnstileToken: 'good-token',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.scoutWallet, 'GSCOUT_Z');
});
