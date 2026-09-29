const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDbPath = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'scout-off-backend-milestones-test-')),
  'test.db',
);
process.env.DB_PATH = tmpDbPath;

const createApp = require('../src/app');
const milestoneSubmissionService = require('../src/milestoneSubmissionService');

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

async function request(method, pathname, body) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const validBody = {
  playerId: 'player-1',
  playerName: 'Ada',
  description: 'Scored a hat-trick',
  evidenceUrl: 'https://example.com/clip',
  validatorWallet: 'GVALIDATOR_A',
  submittedBy: 'GPLAYER_1',
};

test('POST /milestone-submissions rejects missing required fields', async () => {
  const res = await request('POST', '/milestone-submissions', {
    playerId: 'player-1',
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /required/);
});

test('POST /milestone-submissions creates a pending submission', async () => {
  const res = await request('POST', '/milestone-submissions', validBody);
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'pending');
  assert.equal(res.body.playerId, 'player-1');
  assert.equal(res.body.validatorWallet, 'GVALIDATOR_A');
  assert.ok(res.body.id);
});

test('GET /milestone-submissions/validator/:wallet lists pending by default', async () => {
  const res = await request(
    'GET',
    '/milestone-submissions/validator/GVALIDATOR_A',
  );
  assert.equal(res.status, 200);
  assert.ok(res.body.length >= 1);
  assert.ok(res.body.every((s) => s.status === 'pending'));
});

test('GET /milestone-submissions/validator/:wallet rejects an invalid status filter', async () => {
  const res = await request(
    'GET',
    '/milestone-submissions/validator/GVALIDATOR_A?status=bogus',
  );
  assert.equal(res.status, 400);
});

test('PATCH /milestone-submissions/:id rejects an invalid status', async () => {
  const created = await request('POST', '/milestone-submissions', validBody);
  const res = await request(
    'PATCH',
    `/milestone-submissions/${created.body.id}`,
    {
      status: 'pending',
    },
  );
  assert.equal(res.status, 400);
});

test('PATCH /milestone-submissions/:id returns 404 for an unknown id', async () => {
  const res = await request('PATCH', '/milestone-submissions/does-not-exist', {
    status: 'approved',
  });
  assert.equal(res.status, 404);
});

test('PATCH /milestone-submissions/:id records the decision and filters by status', async () => {
  const created = await request('POST', '/milestone-submissions', {
    ...validBody,
    validatorWallet: 'GVALIDATOR_B',
  });
  const res = await request(
    'PATCH',
    `/milestone-submissions/${created.body.id}`,
    {
      status: 'approved',
      txHash: 'abc123',
    },
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'approved');
  assert.equal(res.body.txHash, 'abc123');
  assert.ok(res.body.decidedAt);

  const approved = await request(
    'GET',
    '/milestone-submissions/validator/GVALIDATOR_B?status=approved',
  );
  assert.deepEqual(
    approved.body.map((s) => s.id),
    [created.body.id],
  );
  const pending = await request(
    'GET',
    '/milestone-submissions/validator/GVALIDATOR_B',
  );
  assert.equal(pending.body.length, 0);
});

test('milestoneSubmissionService.decideSubmission throws SubmissionNotFoundError for unknown ids', () => {
  assert.throws(
    () => milestoneSubmissionService.decideSubmission('missing', 'rejected'),
    milestoneSubmissionService.SubmissionNotFoundError,
  );
});

test('milestoneSubmissionService.createSubmission defaults optional fields to null', () => {
  const submission = milestoneSubmissionService.createSubmission({
    playerId: 'player-2',
    description: 'Clean sheet',
    validatorWallet: 'GVALIDATOR_C',
    submittedBy: 'GPLAYER_2',
  });
  assert.equal(submission.playerName, null);
  assert.equal(submission.evidenceUrl, null);
  assert.equal(submission.txHash, null);
  assert.deepEqual(
    milestoneSubmissionService
      .listForValidator('GVALIDATOR_C')
      .map((s) => s.id),
    [submission.id],
  );
});
