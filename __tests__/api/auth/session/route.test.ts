/** @jest-environment node */
import { GET } from '../../../../app/api/auth/session/route';
import { NextRequest } from 'next/server';
import { _resetRateLimitStoreForTests } from '@/lib/rateLimit';
import { createSessionToken } from '@/lib/session';
import { SessionStore } from '@/lib/sessionStore';

function makeRequest(cookieHeader?: string, ip?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (cookieHeader) headers['cookie'] = cookieHeader;
  if (ip) headers['x-forwarded-for'] = ip;
  return new NextRequest('http://localhost:3000/api/auth/session', {
    method: 'GET',
    headers,
  });
}

let sidCounter = 0;

// Builds a `session=<token>` cookie header for an access token whose `sid`
// is also registered in the session store as active — i.e. what a real
// SEP-10 login produces. See #1179: getSessionWallet (which this route now
// delegates to) checks the store in addition to the token's signature, so
// a cookie with no matching store row is correctly treated the same as an
// unsigned one by every test below that expects success.
function accessCookie(publicKey: string, ttlSec = 20 * 60): string {
  const sid = `sid-${sidCounter++}`;
  const token = createSessionToken(publicKey, 'access', ttlSec, { sid });
  SessionStore.getInstance().create(
    sid,
    publicKey,
    Date.now() + 60 * 60 * 1000,
  );
  return `session=${token}`;
}

beforeEach(() => {
  SessionStore.resetInstance();
  _resetRateLimitStoreForTests();
});

afterEach(() => {
  SessionStore.resetInstance();
});

describe('GET /api/auth/session', () => {
  it('returns 401 and authenticated: false when there is no session cookie', async () => {
    const res = await GET(makeRequest(undefined, 'ip-basic-401'));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it('returns 200 with authenticated: true and the public key when a valid signed session cookie is present', async () => {
    const publicKey =
      'GPUBLICKEY0000000000000000000000000000000000000000000000';
    const res = await GET(makeRequest(accessCookie(publicKey), 'ip-basic-200'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      authenticated: true,
      publicKey,
    });
  });

  it('returns 401 when the cookie is a hand-crafted, unsigned address rather than a real session token (see #778)', async () => {
    // Adversarial test: pre-#778, the `session` cookie's value WAS the
    // caller's plaintext public key, so this exact request would have
    // authenticated as the attacker-chosen address with no SEP-10 flow at
    // all. Setting the same raw value now must be rejected.
    const forgedAddress =
      'GATTACKERCHOSEN00000000000000000000000000000000000000000';
    const res = await GET(
      makeRequest(`session=${forgedAddress}`, 'ip-forged-cookie'),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it('returns 401 when the session cookie signature has been tampered with', async () => {
    const publicKey =
      'GPUBLICKEY0000000000000000000000000000000000000000000000';
    const token = createSessionToken(publicKey, 'access', 20 * 60);
    const [payloadB64] = token.split('.');
    const tampered = `${payloadB64}.tamperedsignature`;

    const res = await GET(
      makeRequest(`session=${tampered}`, 'ip-tampered-cookie'),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it('returns 401 once the access token has expired', async () => {
    const publicKey =
      'GPUBLICKEY0000000000000000000000000000000000000000000000';
    // Negative TTL: already expired the instant it's created — simulates
    // "a request made after expiry" without needing real clock injection.
    const res = await GET(
      makeRequest(accessCookie(publicKey, -1), 'ip-expired-cookie'),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it('returns 401 when a refresh token is presented as an access token', async () => {
    // Type confusion guard: a `session_refresh` token must never be
    // accepted where an access token is expected.
    const publicKey =
      'GPUBLICKEY0000000000000000000000000000000000000000000000';
    const refreshToken = createSessionToken(publicKey, 'refresh', 60 * 60 * 24);
    const res = await GET(
      makeRequest(`session=${refreshToken}`, 'ip-wrong-type-cookie'),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it('allows requests under the rate limit to proceed normally', async () => {
    const ip = 'ip-under-limit';

    let lastRes;
    for (let i = 0; i < 30; i++) {
      lastRes = await GET(makeRequest(undefined, ip));
    }

    expect(lastRes!.status).toBe(401);
    expect(await lastRes!.json()).toEqual({ authenticated: false });
  });

  it('rate limits after exceeding 30 requests from the same IP within the window', async () => {
    const ip = 'ip-rate-limited';

    let lastRes;
    for (let i = 0; i < 31; i++) {
      lastRes = await GET(makeRequest(undefined, ip));
    }

    expect(lastRes!.status).toBe(429);
    const body = await lastRes!.json();
    expect(body).toEqual({ error: 'Too many requests. Please slow down.' });
    expect(lastRes!.headers.get('Retry-After')).toBeTruthy();
  });

  it('tracks rate limits per IP independently', async () => {
    for (let i = 0; i < 30; i++) {
      await GET(makeRequest(undefined, 'ip-A-session'));
    }
    // ip-A-session is now at the limit; a different IP should be unaffected.
    const res = await GET(makeRequest(undefined, 'ip-B-session'));

    expect(res.status).toBe(401);
  });
});
