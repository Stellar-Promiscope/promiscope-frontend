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

async function del(pathname) {
  const res = await fetch(`${baseUrl}${pathname}`, { method: 'DELETE' });
  return { status: res.status, body: await res.json() };
}

async function patch(pathname, body) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('POST /academies creates an academy with the owner as first member', async () => {
  const res = await post('/academies', {
    name: 'FC Sahel',
    ownerWallet: 'GOWNER',
    createdBy: 'GADMIN',
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.name, 'FC Sahel');
  assert.equal(res.body.members.length, 1);
  assert.equal(res.body.members[0].wallet, 'GOWNER');
});

test('POST /academies requires name, ownerWallet, and createdBy', async () => {
  const res = await post('/academies', { name: 'Missing fields' });
  assert.equal(res.status, 400);
});

test('GET /academies lists created academies', async () => {
  await post('/academies', {
    name: 'FC List',
    ownerWallet: 'GOWNER_LIST',
    createdBy: 'GADMIN',
  });

  const res = await get('/academies');
  assert.equal(res.status, 200);
  assert.ok(res.body.some((a) => a.name === 'FC List'));
});

test('POST /academies/:id/members adds a signer wallet', async () => {
  const created = await post('/academies', {
    name: 'FC Members',
    ownerWallet: 'GOWNER_M',
    createdBy: 'GADMIN',
  });

  const res = await post(`/academies/${created.body.id}/members`, {
    wallet: 'GCOACH1',
    addedBy: 'GADMIN',
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.members.length, 2);
});

test('POST /academies/:id/members 404s for an unknown academy', async () => {
  const res = await post('/academies/does-not-exist/members', {
    wallet: 'GCOACH2',
    addedBy: 'GADMIN',
  });
  assert.equal(res.status, 404);
});

test('POST /academies/:id/members 409s when the wallet belongs to another academy', async () => {
  const a = await post('/academies', {
    name: 'FC A',
    ownerWallet: 'GOWNER_A2',
    createdBy: 'GADMIN',
  });
  const b = await post('/academies', {
    name: 'FC B',
    ownerWallet: 'GOWNER_B2',
    createdBy: 'GADMIN',
  });

  const res = await post(`/academies/${a.body.id}/members`, {
    wallet: 'GOWNER_B2',
    addedBy: 'GADMIN',
  });

  assert.equal(res.status, 409);
  assert.ok(b.body.id); // keep b referenced
});

test('GET /academies/wallet/:wallet finds the owning academy', async () => {
  const created = await post('/academies', {
    name: 'FC Wallet Lookup',
    ownerWallet: 'GOWNER_WL',
    createdBy: 'GADMIN',
  });

  const res = await get('/academies/wallet/GOWNER_WL');
  assert.equal(res.status, 200);
  assert.equal(res.body.id, created.body.id);
});

test('GET /academies/wallet/:wallet 404s for a wallet in no academy', async () => {
  const res = await get('/academies/wallet/GNOBODY');
  assert.equal(res.status, 404);
});

test('DELETE /academies/:id/members/:wallet removes a signer', async () => {
  const created = await post('/academies', {
    name: 'FC Delete',
    ownerWallet: 'GOWNER_D',
    createdBy: 'GADMIN',
  });
  await post(`/academies/${created.body.id}/members`, {
    wallet: 'GCOACH_D',
    addedBy: 'GADMIN',
  });

  const res = await del(`/academies/${created.body.id}/members/GCOACH_D`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { success: true });

  const lookup = await get('/academies/wallet/GCOACH_D');
  assert.equal(lookup.status, 404);
});

test('DELETE /academies/:id/members/:wallet 404s when membership does not exist', async () => {
  const res = await del('/academies/does-not-exist/members/GNOBODY');
  assert.equal(res.status, 404);
});

// ── Milestone approval quorum (issue #1185) ──────────────────────────────────

test('PATCH /academies/:id/quorum sets a quorum', async () => {
  const created = await post('/academies', {
    name: 'FC Quorum Route',
    ownerWallet: 'GOWNER_Q',
    createdBy: 'GADMIN',
  });

  const res = await patch(`/academies/${created.body.id}/quorum`, {
    quorum: 2,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.quorum, 2);
});

test('PATCH /academies/:id/quorum clears a quorum with null', async () => {
  const created = await post('/academies', {
    name: 'FC Quorum Clear',
    ownerWallet: 'GOWNER_QC',
    createdBy: 'GADMIN',
  });
  await patch(`/academies/${created.body.id}/quorum`, { quorum: 3 });

  const res = await patch(`/academies/${created.body.id}/quorum`, {
    quorum: null,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.quorum, null);
});

test('PATCH /academies/:id/quorum rejects a non-positive-integer quorum', async () => {
  const created = await post('/academies', {
    name: 'FC Quorum Invalid',
    ownerWallet: 'GOWNER_QI',
    createdBy: 'GADMIN',
  });

  for (const bad of [0, -1, 1.5, 'two']) {
    const res = await patch(`/academies/${created.body.id}/quorum`, {
      quorum: bad,
    });
    assert.equal(res.status, 400, `expected 400 for quorum=${bad}`);
  }
});

test('PATCH /academies/:id/quorum 404s for an unknown academy', async () => {
  const res = await patch('/academies/does-not-exist/quorum', { quorum: 2 });
  assert.equal(res.status, 404);
});
