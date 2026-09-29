/** @jest-environment node */
import { GET } from '@/app/api/contact/[playerId]/route';
import { POST, DELETE, GET as VAULT_GET } from '@/app/api/contact/vault/route';
import { NextRequest } from 'next/server';
import { ContactVaultStore } from '@/lib/contactVaultStore';
import { sealContactDetails } from '@/lib/contactVaultCrypto';
import { createSessionToken } from '@/lib/session';
import { SessionStore } from '@/lib/sessionStore';
import { fetchPlayerEvents } from '@/lib/indexerClient';

jest.mock('@/lib/indexerClient', () => ({
  fetchPlayerEvents: jest.fn(),
}));

const mockedFetchPlayerEvents = fetchPlayerEvents as jest.Mock;

// Real, checksum-valid Ed25519 public keys — routes gate playerIds on
// isValidStellarAddress(), so fixtures must be genuine keys.
const PLAYER = 'GDGXH65ASAZNBPSWMQWO6R4HHT3KQ7VY3DPAQBE2DQGJVSBZL4VAC4AK';
const SCOUT = 'GCCGFUW47T7YAJ74QCG2USO2DUCSLWHFRUYBEVQBQWSOXMD3YUBRERLZ';
const OTHER = 'GBR6LYRKEFYV3MG322FYLED6PLOTEV77KCX6AZSR7V4RV7EJLIWOZJWQ';

const DETAILS = { email: 'p@example.com', phone: '+10000000000' };

let sidCounter = 0;

function sessionCookie(wallet: string): string {
  const sid = `sid-${sidCounter++}`;
  SessionStore.getInstance().create(sid, wallet, Date.now() + 60 * 60 * 1000);
  return `session=${createSessionToken(wallet, 'access', 20 * 60, { sid })}`;
}

function makeRequest(
  url: string,
  init: { method?: string; wallet?: string; body?: unknown } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (init.wallet) headers['cookie'] = sessionCookie(init.wallet);
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(url, {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

function seedVault() {
  ContactVaultStore.getInstance().upsert(
    PLAYER,
    PLAYER,
    sealContactDetails(JSON.stringify(DETAILS)),
  );
}

beforeEach(() => {
  process.env.CONTACT_VAULT_KEY = Buffer.alloc(32, 7).toString('hex');
  ContactVaultStore.resetInstance();
  SessionStore.resetInstance();
  mockedFetchPlayerEvents.mockReset();
});

afterEach(() => {
  ContactVaultStore.resetInstance();
  SessionStore.resetInstance();
  delete process.env.CONTACT_VAULT_KEY;
});

describe('contact vault — crypto', () => {
  it('stores only ciphertext: the DB row contains no plaintext', async () => {
    await POST(
      makeRequest('http://localhost/api/contact/vault', {
        method: 'POST',
        wallet: PLAYER,
        body: { playerId: PLAYER, ...DETAILS },
      }),
    );
    const row = ContactVaultStore.getInstance().get(PLAYER)!;
    expect(row.ciphertext).not.toContain('p@example.com');
    expect(row.ciphertext).not.toContain('+10000000000');
    expect(row.iv).not.toContain('p@example.com');
  });

  it('tampered ciphertext fails closed instead of returning partial plaintext', async () => {
    seedVault();
    const row = ContactVaultStore.getInstance().get(PLAYER)!;
    const tampered = {
      ...row,
      ciphertext:
        row.ciphertext.slice(0, 10) +
        (row.ciphertext[10] === 'A' ? 'B' : 'A') +
        row.ciphertext.slice(11),
    };
    ContactVaultStore.getInstance().upsert(PLAYER, PLAYER, tampered);
    mockedFetchPlayerEvents.mockResolvedValue({
      events: [{ type: 'player_contacted', scout: SCOUT, playerId: PLAYER }],
      nextCursor: null,
    });
    const res = await GET(
      makeRequest(`http://localhost/api/contact/${PLAYER}`, {
        wallet: SCOUT,
      }),
      { params: { playerId: PLAYER } },
    );
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('p@example.com');
  });
});

describe('GET /api/contact/[playerId] — unpaid scout cannot retrieve details', () => {
  it('returns 401 without a session cookie', async () => {
    seedVault();
    const res = await GET(
      makeRequest(`http://localhost/api/contact/${PLAYER}`),
      { params: { playerId: PLAYER } },
    );
    expect(res.status).toBe(401);
  });

  it('an unpaid scout gets 404 with no plaintext (payment proof missing)', async () => {
    seedVault();
    mockedFetchPlayerEvents.mockResolvedValue({
      events: [],
      nextCursor: null,
    });
    const res = await GET(
      makeRequest(`http://localhost/api/contact/${PLAYER}`, {
        wallet: SCOUT,
      }),
      { params: { playerId: PLAYER } },
    );
    expect(res.status).toBe(404);
    expect(mockedFetchPlayerEvents).toHaveBeenCalled();
    expect(await res.json()).toEqual({
      error: 'Contact details not available',
    });
  });

  it('a scout who paid a DIFFERENT player still gets 404 (proof is per-player)', async () => {
    seedVault();
    mockedFetchPlayerEvents.mockImplementation(async (playerId: string) => {
      if (playerId === OTHER) {
        return {
          events: [{ type: 'player_contacted', scout: SCOUT, playerId: OTHER }],
          nextCursor: null,
        };
      }
      return { events: [], nextCursor: null };
    });
    const res = await GET(
      makeRequest(`http://localhost/api/contact/${PLAYER}`, {
        wallet: SCOUT,
      }),
      { params: { playerId: PLAYER } },
    );
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain('p@example.com');
  });

  it('missing vault row and missing payment return the SAME 404 (no oracle)', async () => {
    mockedFetchPlayerEvents.mockResolvedValue({
      events: [],
      nextCursor: null,
    });
    const noRow = await GET(
      makeRequest(`http://localhost/api/contact/${PLAYER}`, {
        wallet: SCOUT,
      }),
      { params: { playerId: PLAYER } },
    );
    seedVault();
    const noPayment = await GET(
      makeRequest(`http://localhost/api/contact/${PLAYER}`, {
        wallet: SCOUT,
      }),
      { params: { playerId: PLAYER } },
    );
    expect(noRow.status).toBe(404);
    expect(noPayment.status).toBe(404);
    expect(await noRow.json()).toEqual(await noPayment.json());
  });

  it('a paying scout receives the decrypted details', async () => {
    seedVault();
    mockedFetchPlayerEvents.mockResolvedValue({
      events: [{ type: 'player_contacted', scout: SCOUT, playerId: PLAYER }],
      nextCursor: null,
    });
    const res = await GET(
      makeRequest(`http://localhost/api/contact/${PLAYER}`, {
        wallet: SCOUT,
      }),
      { params: { playerId: PLAYER } },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DETAILS);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

  it('indexer outage fails closed with 503, not a 404 denial', async () => {
    seedVault();
    mockedFetchPlayerEvents.mockRejectedValue(new Error('indexer down'));
    const res = await GET(
      makeRequest(`http://localhost/api/contact/${PLAYER}`, {
        wallet: SCOUT,
      }),
      { params: { playerId: PLAYER } },
    );
    expect(res.status).toBe(503);
  });
});

describe('GET /api/contact/vault — metadata only, never the plaintext', () => {
  it('401 without a session cookie', async () => {
    const res = await VAULT_GET(
      makeRequest(`http://localhost/api/contact/vault?playerId=${PLAYER}`),
    );
    expect(res.status).toBe(401);
  });

  it('403 when a scout probes another player’s vault status', async () => {
    const res = await VAULT_GET(
      makeRequest(`http://localhost/api/contact/vault?playerId=${PLAYER}`, {
        wallet: SCOUT,
      }),
    );
    expect(res.status).toBe(403);
  });

  it('reports hasContactDetails:false before the player uploads anything', async () => {
    const res = await VAULT_GET(
      makeRequest(`http://localhost/api/contact/vault?playerId=${PLAYER}`, {
        wallet: PLAYER,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      hasContactDetails: false,
      updatedAt: null,
    });
  });

  it('never returns the stored plaintext, not even to the owner', async () => {
    seedVault();
    const res = await VAULT_GET(
      makeRequest(`http://localhost/api/contact/vault?playerId=${PLAYER}`, {
        wallet: PLAYER,
      }),
    );
    expect(res.status).toBe(200);
    const raw = await res.text();
    // The whole point of the blind-write form: the player cannot read their
    // own PII back out of the API, so a shared browser can't hand an
    // already-unlocked address to the next person who sits down at it.
    expect(raw).not.toContain('p@example.com');
    expect(raw).not.toContain('+10000000000');
    const body = JSON.parse(raw);
    expect(body.hasContactDetails).toBe(true);
    expect(typeof body.updatedAt).toBe('number');
    expect(Object.keys(body).sort()).toEqual([
      'hasContactDetails',
      'updatedAt',
    ]);
  });

  it('marks the row absent after the player deletes it', async () => {
    seedVault();
    const del = await DELETE(
      makeRequest(`http://localhost/api/contact/vault?playerId=${PLAYER}`, {
        method: 'DELETE',
        wallet: PLAYER,
      }),
    );
    expect(del.status).toBe(200);

    const res = await VAULT_GET(
      makeRequest(`http://localhost/api/contact/vault?playerId=${PLAYER}`, {
        wallet: PLAYER,
      }),
    );
    expect(await res.json()).toEqual({
      hasContactDetails: false,
      updatedAt: null,
    });
  });

  it('rejects a malformed playerId with 400', async () => {
    const res = await VAULT_GET(
      makeRequest('http://localhost/api/contact/vault?playerId=not-a-key', {
        wallet: PLAYER,
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('POST/DELETE /api/contact/vault — ownership', () => {
  it('a non-owner cannot overwrite another player’s vault row', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/contact/vault', {
        method: 'POST',
        wallet: SCOUT,
        body: { playerId: PLAYER, ...DETAILS },
      }),
    );
    expect(res.status).toBe(403);
    expect(ContactVaultStore.getInstance().get(PLAYER)).toBeNull();
  });

  it('rejects empty contact details (at least one channel required)', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/contact/vault', {
        method: 'POST',
        wallet: PLAYER,
        body: { playerId: PLAYER },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('a non-owner cannot delete another player’s vault row', async () => {
    seedVault();
    const res = await DELETE(
      makeRequest(`http://localhost/api/contact/vault?playerId=${PLAYER}`, {
        method: 'DELETE',
        wallet: SCOUT,
      }),
    );
    expect(res.status).toBe(403);
    expect(ContactVaultStore.getInstance().get(PLAYER)).not.toBeNull();
  });
});
