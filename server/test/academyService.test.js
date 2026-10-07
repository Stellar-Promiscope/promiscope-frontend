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

const academyService = require('../src/academyService');

test.after(() => {
  fs.rmSync(path.dirname(tmpDbPath), { recursive: true, force: true });
});

test('createAcademy registers the owner wallet as the first member', () => {
  const academy = academyService.createAcademy('FC Sahel', 'GOWNER', 'GADMIN');

  assert.equal(academy.name, 'FC Sahel');
  assert.equal(academy.ownerWallet, 'GOWNER');
  assert.equal(academy.members.length, 1);
  assert.equal(academy.members[0].wallet, 'GOWNER');
  assert.equal(academy.members[0].addedBy, 'GADMIN');
});

test('addMember adds an additional signer under the same academy', () => {
  const academy = academyService.createAcademy(
    'FC Coastal',
    'GOWNER2',
    'GADMIN',
  );
  const updated = academyService.addMember(academy.id, 'GCOACH1', 'GADMIN');

  assert.equal(updated.members.length, 2);
  assert.ok(updated.members.some((m) => m.wallet === 'GCOACH1'));
});

test('addMember is idempotent for a wallet already in the same academy', () => {
  const academy = academyService.createAcademy(
    'FC Idempotent',
    'GOWNER3',
    'GADMIN',
  );
  academyService.addMember(academy.id, 'GCOACH2', 'GADMIN');
  const again = academyService.addMember(academy.id, 'GCOACH2', 'GADMIN');

  assert.equal(again.members.filter((m) => m.wallet === 'GCOACH2').length, 1);
});

test('addMember rejects a wallet already assigned to a different academy', () => {
  const academyA = academyService.createAcademy('FC A', 'GOWNER_A', 'GADMIN');
  academyService.createAcademy('FC B', 'GOWNER_B', 'GADMIN');

  assert.throws(
    () => academyService.addMember(academyA.id, 'GOWNER_B', 'GADMIN'),
    academyService.WalletAlreadyAssignedError,
  );
});

test('addMember throws AcademyNotFoundError for an unknown academy id', () => {
  assert.throws(
    () => academyService.addMember('does-not-exist', 'GWALLET', 'GADMIN'),
    academyService.AcademyNotFoundError,
  );
});

test('removeMember removes a signer and returns true; false when absent', () => {
  const academy = academyService.createAcademy(
    'FC Remove',
    'GOWNER4',
    'GADMIN',
  );
  academyService.addMember(academy.id, 'GCOACH3', 'GADMIN');

  assert.equal(academyService.removeMember(academy.id, 'GCOACH3'), true);
  assert.equal(academyService.removeMember(academy.id, 'GCOACH3'), false);

  const updated = academyService.getAcademy(academy.id);
  assert.ok(!updated.members.some((m) => m.wallet === 'GCOACH3'));
});

test('getAcademyForWallet finds the academy a wallet is registered under', () => {
  const academy = academyService.createAcademy(
    'FC Lookup',
    'GOWNER5',
    'GADMIN',
  );

  const found = academyService.getAcademyForWallet('GOWNER5');
  assert.equal(found.id, academy.id);

  assert.equal(academyService.getAcademyForWallet('GNOBODY'), null);
});

test('listAcademies returns every academy with its members', () => {
  const before = academyService.listAcademies().length;
  academyService.createAcademy('FC ListMe', 'GOWNER6', 'GADMIN');

  assert.equal(academyService.listAcademies().length, before + 1);
});

// issue #1173 — scoped academy-owner admin role
test('listAcademiesByOwnerWallet finds academies owned by a wallet', () => {
  const academy = academyService.createAcademy(
    'FC OwnerLookup',
    'GOWNER7',
    'GADMIN',
  );

  const found = academyService.listAcademiesByOwnerWallet('GOWNER7');
  assert.equal(found.length, 1);
  assert.equal(found[0].id, academy.id);

  assert.deepEqual(academyService.listAcademiesByOwnerWallet('GNOBODY'), []);
});
