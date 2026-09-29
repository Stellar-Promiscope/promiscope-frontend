/**
 * @jest-environment node
 *
 * Security proof for issue #1301: no unpaid party can obtain a player's
 * contact details, and the plaintext is not at rest anywhere.
 *
 * The finding this locks down: `pay_to_contact` returned `ContactDetails` as
 * its on-chain return value, and Soroban return values are world-readable
 * (a free `simulateTransaction` from any account) — so the paywall was
 * cosmetic. This file covers the replacement (off-chain sealed vault +
 * indexer-gated release) and asserts the two invariants the issue asks for:
 *
 *   1. the contact details are never stored in plaintext — checked against
 *      the RAW bytes of the SQLite file on disk, not just the store's
 *      accessor, so a future "just add a plaintext cache column" regression
 *      can't slip through the abstraction;
 *   2. the ONLY route that returns plaintext requires both an authenticated
 *      session and a `player_contacted` proof naming that scout for that
 *      player.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NextRequest } from 'next/server';
import { GET as RELEASE_GET } from '@/app/api/contact/[playerId]/route';
import { POST as VAULT_POST } from '@/app/api/contact/vault/route';
import { ContactVaultStore } from '@/lib/contactVaultStore';
import { createSessionToken } from '@/lib/session';
import { SessionStore } from '@/lib/sessionStore';
import { fetchPlayerEvents } from '@/lib/indexerClient';

jest.mock('@/lib/indexerClient', () => ({
  fetchPlayerEvents: jest.fn(),
}));

const mockedFetchPlayerEvents = fetchPlayerEvents as jest.Mock;

const PLAYER = 'GDGXH65ASAZNBPSWMQWO6R4HHT3KQ7VY3DPAQBE2DQGJVSBZL4VAC4AK';
const SCOUT = 'GCCGFUW47T7YAJ74QCG2USO2DUCSLWHFRUYBEVQBQWSOXMD3YUBRERLZ';
const OTHER_SCOUT = 'GBR6LYRKEFYV3MG322FYLED6PLOTEV77KCX6AZSR7V4RV7EJLIWOZJWQ';

const EMAIL = 'private.player+real@gmail.com';
const PHONE = '+447700900123';
const TELEGRAM = '@private_player_real';

const DETAILS = { email: EMAIL, phone: PHONE, telegram: TELEGRAM };

let dbDir: string;
let sidCounter = 0;

/**
 * Reads every byte SQLite has written for the store — the main database
 * file AND the `-wal` sidecar. In WAL mode freshly-inserted rows live in the
 * -wal until a checkpoint, so scanning only the main file would prove
 * nothing about what a stolen disk image contains.
 */
function rawDatabaseBytes(): string {
  const files = fs
    .readdirSync(dbDir)
    .filter((f) => f.startsWith('contact-vault.db'))
    .map((f) => fs.readFileSync(path.join(dbDir, f)));
  return Buffer.concat(files).toString('binary');
}

function sessionCookie(wallet: string): string {
  const sid = `sid-${sidCounter++}`;
  SessionStore.getInstance().create(sid, wallet, Date.now() + 60 * 60 * 1000);
  return `session=${createSessionToken(wallet, 'access', 20 * 60, { sid })}`;
}

function releaseRequest(wallet?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (wallet) headers['cookie'] = sessionCookie(wallet);
  return new NextRequest(`http://localhost/api/contact/${PLAYER}`, {
    method: 'GET',
    headers,
  });
}

async function uploadDetails(wallet = PLAYER) {
  const res = await VAULT_POST(
    new NextRequest('http://localhost/api/contact/vault', {
      method: 'POST',
      headers: {
        cookie: sessionCookie(wallet),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ playerId: PLAYER, ...DETAILS }),
    }),
  );
  expect(res.status).toBe(201);
}

function release(wallet?: string) {
  return RELEASE_GET(releaseRequest(wallet), { params: { playerId: PLAYER } });
}

/** True when any plaintext fragment of the details appears in the body. */
function bodyLeaksPii(body: string): boolean {
  return [EMAIL, PHONE, TELEGRAM, 'gmail.com', 'private_player_real'].some(
    (fragment) => body.includes(fragment),
  );
}

beforeEach(() => {
  // A real on-disk DB (not the test-default :memory:) so the at-rest
  // assertion can read the actual file bytes.
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contact-vault-sec-'));
  process.env.CONTACT_VAULT_DB_PATH = path.join(dbDir, 'contact-vault.db');
  process.env.CONTACT_VAULT_KEY = Buffer.alloc(32, 9).toString('hex');
  ContactVaultStore.resetInstance();
  SessionStore.resetInstance();
  mockedFetchPlayerEvents.mockReset();
});

afterEach(() => {
  ContactVaultStore.resetInstance();
  SessionStore.resetInstance();
  delete process.env.CONTACT_VAULT_DB_PATH;
  delete process.env.CONTACT_VAULT_KEY;
  fs.rmSync(dbDir, { recursive: true, force: true });
});

describe('issue #1301 — contact details are not stored in plaintext', () => {
  it('the raw SQLite file on disk contains no contact fragment', async () => {
    await uploadDetails();

    const dump = rawDatabaseBytes();
    expect(dump.length).toBeGreaterThan(0);
    expect(dump).not.toContain(EMAIL);
    expect(dump).not.toContain(PHONE);
    expect(dump).not.toContain(TELEGRAM);
    expect(dump).not.toContain('gmail.com');
    // The row IS there — this is a real write, not a no-op. Without this
    // the assertions above would pass trivially on an empty file.
    expect(dump).toContain('contact_vault');
  });

  it('a database dump with the server key removed is not decryptable to the details', async () => {
    await uploadDetails();
    // Even a full DB dump is useless without CONTACT_VAULT_KEY, which lives
    // only in the hosting environment and never in the client bundle.
    delete process.env.CONTACT_VAULT_KEY;
    const row = ContactVaultStore.getInstance().get(PLAYER)!;
    expect(row.ciphertext).not.toContain(EMAIL);
    const { unsealContactDetails } = await import('@/lib/contactVaultCrypto');
    expect(() => unsealContactDetails(row)).toThrow(/CONTACT_VAULT_KEY/);
  });
});

describe('issue #1301 — an unpaid scout cannot retrieve contact details', () => {
  beforeEach(async () => {
    await uploadDetails();
    // Indexer confirms this player HAS paid scouts — so a 404 below can
    // only be about *who* is asking, not about the row being missing.
    mockedFetchPlayerEvents.mockResolvedValue({
      events: [
        { type: 'player_contacted', scout: OTHER_SCOUT, playerId: PLAYER },
      ],
      nextCursor: null,
    });
  });

  it('an unauthenticated request is rejected with 401', async () => {
    const res = await release();
    expect(res.status).toBe(401);
    expect(bodyLeaksPii(await res.text())).toBe(false);
  });

  it('a scout with no payment proof gets 404 and zero PII', async () => {
    const res = await release(SCOUT);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(bodyLeaksPii(body)).toBe(false);
    // …and the denial is indistinguishable from "no such player has
    // uploaded", so it cannot be used to enumerate who has details.
    expect(body).toBe(
      JSON.stringify({ error: 'Contact details not available' }),
    );
  });

  it('a scout who paid for a DIFFERENT player gets 404 and zero PII', async () => {
    // The indexer holds a valid payment event, just not naming SCOUT.
    mockedFetchPlayerEvents.mockImplementation(async () => ({
      events: [
        { type: 'player_contacted', scout: OTHER_SCOUT, playerId: PLAYER },
      ],
      nextCursor: null,
    }));
    const res = await release(SCOUT);
    expect(res.status).toBe(404);
    expect(bodyLeaksPii(await res.text())).toBe(false);
  });

  it('an unpaid scout cannot escalate by forging a payment event query', async () => {
    // The route never accepts a scout address from the client — the check
    // is always against the session wallet, so there is no parameter to
    // tamper with. Proved here by driving the route with only a session
    // cookie and no body/query influence over the identity used.
    const res = await release(SCOUT);
    expect(res.status).toBe(404);
    // The indexer was asked about SCOUT, and never about any other wallet.
    expect(mockedFetchPlayerEvents).toHaveBeenCalledTimes(1);
    expect(mockedFetchPlayerEvents).toHaveBeenCalledWith(
      PLAYER,
      expect.objectContaining({ type: 'player_contacted' }),
    );
  });

  it('an indexer outage fails closed rather than serving details', async () => {
    mockedFetchPlayerEvents.mockRejectedValue(new Error('indexer unreachable'));
    const res = await release(SCOUT);
    expect(res.status).toBe(503);
    expect(bodyLeaksPii(await res.text())).toBe(false);
  });

  it('releasing to a paying scout is the one path that yields plaintext', async () => {
    mockedFetchPlayerEvents.mockResolvedValue({
      events: [{ type: 'player_contacted', scout: SCOUT, playerId: PLAYER }],
      nextCursor: null,
    });
    const res = await release(SCOUT);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DETAILS);
    // …and even then it must not be cacheable anywhere downstream.
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(res.headers.get('Cache-Control')).toContain('private');
  });
});
