/** @jest-environment node */
import { POST as REFRESH } from '../../../../app/api/auth/refresh/route';
import { POST as SEP10_POST } from '../../../../app/api/auth/sep10/route';
import { NextRequest } from 'next/server';
import { createSessionToken, verifySessionToken } from '@/lib/session';
import { SessionStore } from '@/lib/sessionStore';

// Mock stellar-sdk so the lifecycle test below (which goes through the real
// POST /api/auth/sep10 handler to mint a genuine refresh cookie) doesn't
// need a real Stellar keypair or network access — mirrors
// __tests__/api/auth/sep10/route.test.ts's own mock. The SEP-10 signature
// check itself is already covered in isolation there; this file only needs
// "verification succeeds" to get a real cookie to refresh.
jest.mock('@stellar/stellar-sdk', () => ({
  WebAuth: { verifyChallengeTxSigners: jest.fn() },
  Networks: {
    TESTNET: 'Test SDF Network ; September 2015',
    PUBLIC: 'Public Global Stellar Network ; September 2015',
  },
  Keypair: {
    fromSecret: jest.fn((secret: string) => ({ publicKey: () => secret })),
  },
  StrKey: { isValidEd25519PublicKey: (key: string) => key.startsWith('G') },
}));

import { WebAuth } from '@stellar/stellar-sdk';
const mockVerify = WebAuth.verifyChallengeTxSigners as jest.Mock;

const PUBLIC_KEY = 'GREFRESHKEY000000000000000000000000000000000000000000000';
const ALLOWED_ORIGIN = 'https://app.scoutoff.com';

function makeRefreshRequest(refreshCookieValue?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (refreshCookieValue !== undefined) {
    headers['cookie'] = `session_refresh=${refreshCookieValue}`;
  }
  return new NextRequest('http://localhost:3000/api/auth/refresh', {
    method: 'POST',
    headers,
  });
}

let sidCounter = 0;

// Mints a refresh token AND registers its `sid` as an active session in
// the store — i.e. what a real SEP-10 login does. See #1179: the refresh
// route now checks the store (not just the token's signature) before
// rotating, so a bare createSessionToken() call with no matching row would
// no longer be treated as a valid, rotatable session.
function issueActiveRefreshToken(
  publicKey: string,
  ttlSec: number,
  opts: { remember?: boolean } = {},
): string {
  const sid = `sid-${sidCounter++}`;
  const token = createSessionToken(publicKey, 'refresh', ttlSec, {
    ...opts,
    sid,
  });
  SessionStore.getInstance().create(sid, publicKey, Date.now() + ttlSec * 1000);
  return token;
}

beforeEach(() => {
  jest.clearAllMocks();
  SessionStore.resetInstance();
  process.env.NEXT_PUBLIC_BASE_URL = ALLOWED_ORIGIN;
  process.env.SEP10_SERVER_KEY = 'GBSERVERKEY0000000000000000000000000000000';
  process.env.SEP10_HOME_DOMAIN = 'scoutoff.com';
  process.env.NEXT_PUBLIC_NETWORK = 'testnet';
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_BASE_URL;
  delete process.env.SEP10_SERVER_KEY;
  delete process.env.SEP10_HOME_DOMAIN;
  SessionStore.resetInstance();
});

describe('POST /api/auth/refresh', () => {
  it('returns 401 when there is no refresh cookie', async () => {
    const res = await REFRESH(makeRefreshRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 and clears cookies for a hand-crafted, unsigned refresh cookie', async () => {
    const res = await REFRESH(makeRefreshRequest(PUBLIC_KEY));
    expect(res.status).toBe(401);
    expect(res.cookies.get('session')?.value).toBe('');
    expect(res.cookies.get('session_refresh')?.value).toBe('');
  });

  it('returns 401 for an expired refresh token', async () => {
    const expiredRefresh = createSessionToken(PUBLIC_KEY, 'refresh', -1);
    const res = await REFRESH(makeRefreshRequest(expiredRefresh));
    expect(res.status).toBe(401);
  });

  it('returns 401 when an access token is presented as a refresh token', async () => {
    const accessToken = createSessionToken(PUBLIC_KEY, 'access', 20 * 60);
    const res = await REFRESH(makeRefreshRequest(accessToken));
    expect(res.status).toBe(401);
  });

  it('rotates the session: issues a fresh access token and a fresh refresh token', async () => {
    const validRefresh = issueActiveRefreshToken(PUBLIC_KEY, 60 * 60 * 24);
    const res = await REFRESH(makeRefreshRequest(validRefresh));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      publicKey: PUBLIC_KEY,
      maxAge: 60 * 60 * 24,
    });

    const newAccess = res.cookies.get('session');
    const newRefresh = res.cookies.get('session_refresh');
    expect(newAccess?.value).not.toBe(validRefresh);
    expect(newRefresh?.value).not.toBe(validRefresh);

    const accessPayload = verifySessionToken(newAccess!.value, 'access');
    expect(accessPayload?.sub).toBe(PUBLIC_KEY);
    const refreshPayload = verifySessionToken(newRefresh!.value, 'refresh');
    expect(refreshPayload?.sub).toBe(PUBLIC_KEY);
  });

  it('reissues a 30-day refresh token when the original was a "remember me" session', async () => {
    const rememberedRefresh = issueActiveRefreshToken(
      PUBLIC_KEY,
      60 * 60 * 24 * 30,
      { remember: true },
    );
    const res = await REFRESH(makeRefreshRequest(rememberedRefresh));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.maxAge).toBe(60 * 60 * 24 * 30);

    const newRefresh = res.cookies.get('session_refresh');
    const refreshPayload = verifySessionToken(newRefresh!.value, 'refresh');
    expect(refreshPayload?.remember).toBe(true);
  });
});

describe('full SEP-10 lifecycle: challenge -> sign -> verify -> refresh -> expire', () => {
  // A fake-signer harness exercising sep10 issuance and refresh together
  // without a real wallet extension or network access: goes through the
  // real POST /api/auth/sep10 handler (mocking only the Stellar signature
  // check, per the top-of-file mock) to mint a genuine refresh cookie, then
  // feeds that cookie into the real POST /api/auth/refresh handler.
  function makeSep10Request(): NextRequest {
    return new NextRequest('http://localhost:3000/api/auth/sep10', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
      body: JSON.stringify({
        signedXdr: 'fake-signed-xdr',
        publicKey: PUBLIC_KEY,
      }),
    });
  }

  it('a refresh cookie minted by a real SEP-10 verify successfully rotates via /api/auth/refresh', async () => {
    mockVerify.mockReturnValueOnce(undefined);

    const authRes = await SEP10_POST(makeSep10Request());
    expect(authRes.status).toBe(200);
    const mintedRefresh = authRes.cookies.get('session_refresh')?.value;
    expect(mintedRefresh).toBeTruthy();

    const refreshRes = await REFRESH(makeRefreshRequest(mintedRefresh));
    expect(refreshRes.status).toBe(200);
    const body = await refreshRes.json();
    expect(body.publicKey).toBe(PUBLIC_KEY);
  });

  it('a refresh cookie is rejected once its TTL has elapsed, forcing a fresh SEP-10 challenge', async () => {
    mockVerify.mockReturnValueOnce(undefined);

    const authRes = await SEP10_POST(makeSep10Request());
    const mintedRefresh = authRes.cookies.get('session_refresh')?.value;

    const realNow = Date.now;
    try {
      // Fast-forward past the (non-"remember me") 1-day refresh TTL.
      Date.now = () => realNow() + (60 * 60 * 24 + 60) * 1000;

      const refreshRes = await REFRESH(makeRefreshRequest(mintedRefresh));
      expect(refreshRes.status).toBe(401);
    } finally {
      Date.now = realNow;
    }
  });
});
