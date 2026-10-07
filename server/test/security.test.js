const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDbPath = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'promiscope-backend-security-test-')),
  'test.db',
);
process.env.DB_PATH = tmpDbPath;
process.env.CORS_ORIGINS = 'https://promiscope.example, https://admin.promiscope.example';
process.env.CORS_ORIGIN_PATTERN =
  '^https://promiscope-[a-z0-9-]+\\.vercel\\.app$';
process.env.RATE_LIMIT_MAX = '1000';
process.env.RATE_LIMIT_WRITE_MAX = '3';

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

test('sets security headers and hides x-powered-by', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(res.headers.get('strict-transport-security'));
  assert.ok(res.headers.get('x-frame-options'));
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('security headers are present on 404s too', async () => {
  const res = await fetch(`${baseUrl}/does-not-exist`);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('allows every configured CORS origin and the preview pattern', async () => {
  for (const origin of [
    'https://promiscope.example',
    'https://admin.promiscope.example',
    'https://promiscope-git-feature-x.vercel.app',
  ]) {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Origin: origin },
    });
    assert.equal(res.headers.get('access-control-allow-origin'), origin);
  }
});

test('denies CORS for origins outside the allow-list', async () => {
  const res = await fetch(`${baseUrl}/health`, {
    headers: { Origin: 'https://evil.example.com' },
  });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('returns 413 JSON for oversized bodies', async () => {
  const res = await fetch(`${baseUrl}/academies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'x'.repeat(200 * 1024) }),
  });
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: 'Request body too large' });
});

test('rate-limits write routes with 429 JSON', async () => {
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${baseUrl}/referrals/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    statuses.push(res.status);
    if (res.status === 429) {
      assert.deepEqual(await res.json(), { error: 'Too many requests' });
    }
  }
  // The 413 test above already used one unit of the write budget.
  assert.ok(statuses.includes(429), `expected a 429 in ${statuses}`);
  assert.notEqual(statuses[0], 429);

  // Reads are not affected by the write limit.
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
});
