/** @jest-environment node */
import { POST, DELETE, GET } from '../../../../app/api/auth/sep10/route';
import { GET as SESSION_GET } from '../../../../app/api/auth/session/route';
import { NextRequest } from 'next/server';
import { SessionStore } from '@/lib/sessionStore';

// Mock stellar-sdk so tests don't need real Stellar keys or network access.
// Keypair.fromSecret is mocked to return the secret itself as the "public
// key", so route.ts's `Keypair.fromSecret(serverKey).publicKey()` resolves
// to `process.env.SEP10_SERVER_KEY` for assertion purposes below.
jest.mock('@stellar/stellar-sdk', () => ({
  WebAuth: {
    verifyChallengeTxSigners: jest.fn(),
  },
  Networks: {
    TESTNET: 'Test SDF Network ; September 2015',
    PUBLIC: 'Public Global Stellar Network ; September 2015',
  },
  Keypair: {
    fromSecret: jest.fn((secret: string) => ({
      publicKey: () => secret,
    })),
  },
  // Treat any G-prefixed key as valid so the fixture keys below pass
  // without needing real checksummed addresses.
  StrKey: {
    isValidEd25519PublicKey: (key: string) => key.startsWith('G'),
  },
}));

import { WebAuth } from '@stellar/stellar-sdk';
import {
  ACCESS_TOKEN_TTL_SEC,
  DEFAULT_REFRESH_TTL_SEC,
  verifySessionToken,
} from '@/lib/session';
const mockVerify = WebAuth.verifyChallengeTxSigners as jest.Mock;

const ALLOWED_ORIGIN = 'https://app.scoutoff.com';
const VALID_PUBLIC_KEY =
  'GBXXXXXXXXVALIDSTELLARACCOUNTID0000000000000000000000000000';
const SIGNED_XDR = 'AAAAAQAAAA...signedchallenge...XDR==';

function makeRequest(
  origin: string | null,
  body: Record<string, unknown> = {
    signedXdr: SIGNED_XDR,
    publicKey: VALID_PUBLIC_KEY,
  },
): NextRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (origin !== null) headers['origin'] = origin;
  return new NextRequest('http://localhost:3000/api/auth/sep10', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  SessionStore.resetInstance();
  process.env.NEXT_PUBLIC_BASE_URL = ALLOWED_ORIGIN;
  process.env.SEP10_SERVER_KEY =
    'GBSERVERKEY0000000000000000000000000000000000000000000000000';
  process.env.SEP10_HOME_DOMAIN = 'scoutoff.com';
  process.env.NEXT_PUBLIC_NETWORK = 'testnet';
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_BASE_URL;
  delete process.env.SEP10_SERVER_KEY;
  delete process.env.SEP10_HOME_DOMAIN;
  SessionStore.resetInstance();
});

describe('POST /api/auth/sep10 — origin validation', () => {
  test('returns 403 when Origin header is missing', async () => {
    const res = await POST(makeRequest(null));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'Forbidden' });
    expect(mockVerify).not.toHaveBeenCalled();
  });

  test('returns 403 when Origin does not match allowed origin', async () => {
    const res = await POST(makeRequest('https://evil.com'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'Forbidden' });
    expect(mockVerify).not.toHaveBeenCalled();
  });

  test('returns 403 for a subdomain that is not an exact match', async () => {
    const res = await POST(makeRequest('https://sub.app.scoutoff.com'));
    expect(res.status).toBe(403);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  test('returns 403 when scheme differs (http vs https)', async () => {
    const res = await POST(makeRequest('http://app.scoutoff.com'));
    expect(res.status).toBe(403);
    expect(mockVerify).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/sep10 — successful authentication', () => {
  test('returns 200 and sets session cookie when origin matches and SEP-10 verifies', async () => {
    mockVerify.mockReturnValueOnce(undefined); // resolves without throwing

    const res = await POST(makeRequest(ALLOWED_ORIGIN));

    expect(res.status).toBe(200);
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockVerify).toHaveBeenCalledWith(
      SIGNED_XDR,
      process.env.SEP10_SERVER_KEY,
      'Test SDF Network ; September 2015',
      [VALID_PUBLIC_KEY],
      'scoutoff.com',
      'scoutoff.com',
    );

    const body = await res.json();
    expect(body).toEqual({ success: true, maxAge: 86400 });

    // Per #778, the cookie value must be an HMAC-signed, time-bound token —
    // never the caller's plaintext public key — so a client can't forge a
    // session by setting `session=<any-address>` by hand.
    const cookie = res.cookies.get('session');
    expect(cookie).toBeDefined();
    expect(cookie?.value).not.toBe(VALID_PUBLIC_KEY);
    const payload = verifySessionToken(cookie!.value, 'access');
    expect(payload?.sub).toBe(VALID_PUBLIC_KEY);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('strict');
    expect(cookie?.path).toBe('/');

    // A distinct, longer-lived refresh token is also issued, scoped to
    // /api/auth so it isn't sent on every request the way `session` is.
    const refreshCookie = res.cookies.get('session_refresh');
    expect(refreshCookie).toBeDefined();
    const refreshPayload = verifySessionToken(refreshCookie!.value, 'refresh');
    expect(refreshPayload?.sub).toBe(VALID_PUBLIC_KEY);
    expect(refreshCookie?.httpOnly).toBe(true);
    expect(refreshCookie?.path).toBe('/api/auth');
  });

  test('issues a REMEMBER_ME_REFRESH_TTL_SEC-lived refresh token when rememberMe is set', async () => {
    mockVerify.mockReturnValueOnce(undefined);

    const res = await POST(
      makeRequest(ALLOWED_ORIGIN, {
        signedXdr: SIGNED_XDR,
        publicKey: VALID_PUBLIC_KEY,
        rememberMe: true,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.maxAge).toBe(60 * 60 * 24 * 30);

    const refreshCookie = res.cookies.get('session_refresh');
    const refreshPayload = verifySessionToken(refreshCookie!.value, 'refresh');
    expect(refreshPayload?.sub).toBe(VALID_PUBLIC_KEY);
  });
});

describe('POST /api/auth/sep10 — SEP-10 verification failures', () => {
  test('returns 401 when stellar challenge verification fails', async () => {
    mockVerify.mockImplementationOnce(() => {
      throw new Error('Transaction not signed by client');
    });

    const res = await POST(makeRequest(ALLOWED_ORIGIN));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Challenge verification failed' });
  });
});

describe('POST /api/auth/sep10 — input and config validation', () => {
  test('returns 400 when publicKey is not a valid G-address', async () => {
    const res = await POST(
      makeRequest(ALLOWED_ORIGIN, {
        signedXdr: SIGNED_XDR,
        publicKey: 'MBADMUXEDACCOUNT',
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid publicKey' });
    expect(mockVerify).not.toHaveBeenCalled();
  });

  test.each(['SEP10_SERVER_KEY', 'SEP10_HOME_DOMAIN'])(
    'returns 500 without calling the SDK when %s is missing',
    async (name) => {
      delete process.env[name];
      const res = await POST(makeRequest(ALLOWED_ORIGIN));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Server not configured' });
      expect(mockVerify).not.toHaveBeenCalled();
    },
  );
});

describe('GET /api/auth/sep10 — challenge', () => {
  function makeGet(account?: string): NextRequest {
    const qs = account === undefined ? '' : `?account=${account}`;
    return new NextRequest(`http://localhost:3000/api/auth/sep10${qs}`);
  }

  test('returns 400 when account is missing', async () => {
    const res = await GET(makeGet());
    expect(res.status).toBe(400);
  });

  test('returns 400 for an invalid or muxed account', async () => {
    for (const account of ['not-an-address', 'MBADMUXEDACCOUNT']) {
      const res = await GET(makeGet(account));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Invalid account parameter',
      });
    }
  });

  test.each(['SEP10_SERVER_KEY', 'SEP10_HOME_DOMAIN'])(
    'returns 500 when %s is missing',
    async (name) => {
      delete process.env[name];
      const res = await GET(makeGet(VALID_PUBLIC_KEY));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Server not configured' });
    },
  );
});

describe('POST /api/auth/sep10 — malformed request body', () => {
  test('returns 400 for non-JSON body', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/sep10', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: ALLOWED_ORIGIN },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/sep10 — SEP10_ALLOWED_ORIGINS allow-list', () => {
  test('allows request when Origin matches an entry in SEP10_ALLOWED_ORIGINS', async () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    process.env.SEP10_ALLOWED_ORIGINS =
      'https://scoutoff.app,https://www.scoutoff.app';
    mockVerify.mockReturnValueOnce(undefined);

    const req = new NextRequest('http://localhost:3000/api/auth/sep10', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://www.scoutoff.app',
      },
      body: JSON.stringify({
        signedXdr: SIGNED_XDR,
        publicKey: VALID_PUBLIC_KEY,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    delete process.env.SEP10_ALLOWED_ORIGINS;
  });

  test('blocks request when Origin is not in SEP10_ALLOWED_ORIGINS', async () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    process.env.SEP10_ALLOWED_ORIGINS = 'https://scoutoff.app';

    const req = new NextRequest('http://localhost:3000/api/auth/sep10', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.com',
      },
      body: JSON.stringify({
        signedXdr: SIGNED_XDR,
        publicKey: VALID_PUBLIC_KEY,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(mockVerify).not.toHaveBeenCalled();

    delete process.env.SEP10_ALLOWED_ORIGINS;
  });
});

describe('POST /api/auth/sep10 — forged Host header can no longer bypass origin checks', () => {
  test('rejects a request whose Host/X-Forwarded-Proto headers are crafted to match Origin, when neither is in the allow-list', async () => {
    // Regression test for #659: previously, when NEXT_PUBLIC_BASE_URL was
    // unset, the "allowed" origin was derived from the request's own Host /
    // X-Forwarded-Proto headers — both fully attacker-controlled — making
    // `origin === allowed` trivially satisfiable by any non-browser client
    // that sets Host and X-Forwarded-Proto to match its own forged Origin.
    delete process.env.NEXT_PUBLIC_BASE_URL;
    delete process.env.SEP10_ALLOWED_ORIGINS;
    process.env.NEXT_PUBLIC_DOMAIN = 'localhost:3000';

    const forgedOrigin = 'https://attacker.example';
    const req = new NextRequest('http://localhost:3000/api/auth/sep10', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: forgedOrigin,
        host: 'attacker.example',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({
        signedXdr: SIGNED_XDR,
        publicKey: VALID_PUBLIC_KEY,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'Forbidden' });
    expect(mockVerify).not.toHaveBeenCalled();

    delete process.env.NEXT_PUBLIC_DOMAIN;
  });
});

describe('POST /api/auth/sep10 — local dev fallback (NODE_ENV !== production)', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: originalNodeEnv,
      configurable: true,
    });
  });

  test('allows http://<NEXT_PUBLIC_DOMAIN> by default when no allow-list is configured', async () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    delete process.env.SEP10_ALLOWED_ORIGINS;
    process.env.NEXT_PUBLIC_DOMAIN = 'localhost:3000';
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'test',
      configurable: true,
    });
    mockVerify.mockReturnValueOnce(undefined);

    const req = new NextRequest('http://localhost:3000/api/auth/sep10', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        signedXdr: SIGNED_XDR,
        publicKey: VALID_PUBLIC_KEY,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    delete process.env.NEXT_PUBLIC_DOMAIN;
  });
});

describe('POST /api/auth/sep10 — production fails closed with no allow-list configured', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: originalNodeEnv,
      configurable: true,
    });
  });

  test('returns 403 in production when neither SEP10_ALLOWED_ORIGINS nor NEXT_PUBLIC_BASE_URL is set', async () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    delete process.env.SEP10_ALLOWED_ORIGINS;
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'production',
      configurable: true,
    });

    const req = new NextRequest('http://localhost:3000/api/auth/sep10', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://scoutoff.app',
        host: 'scoutoff.app',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({
        signedXdr: SIGNED_XDR,
        publicKey: VALID_PUBLIC_KEY,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'Forbidden' });
    expect(mockVerify).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/auth/sep10 — logout', () => {
  function deleteRequest(cookieHeader?: string): NextRequest {
    const headers: Record<string, string> = {};
    if (cookieHeader) headers['cookie'] = cookieHeader;
    return new NextRequest('http://localhost:3000/api/auth/sep10', {
      method: 'DELETE',
      headers,
    });
  }

  test('clears both the access and refresh session cookies', async () => {
    const res = await DELETE(deleteRequest());
    expect(res.status).toBe(200);

    const cleared = res.cookies.get('session');
    const refreshCleared = res.cookies.get('session_refresh');
    // NextResponse represents a deleted cookie as an empty-value Set-Cookie.
    expect(cleared?.value).toBe('');
    expect(refreshCleared?.value).toBe('');
  });

  // See #1179's core acceptance criterion: revoking a session must reject
  // its cookie on the very next request, not just clear it client-side.
  test('revokes the session server-side so the same cookie is rejected by a subsequent authenticated request', async () => {
    mockVerify.mockReturnValueOnce(undefined);

    const loginRes = await POST(makeRequest(ALLOWED_ORIGIN));
    expect(loginRes.status).toBe(200);
    const accessToken = loginRes.cookies.get('session')!.value;
    const refreshToken = loginRes.cookies.get('session_refresh')!.value;

    // Sanity check: the freshly-issued cookie authenticates before logout.
    const beforeRes = await SESSION_GET(
      new NextRequest('http://localhost:3000/api/auth/session', {
        headers: { cookie: `session=${accessToken}` },
      }),
    );
    expect(beforeRes.status).toBe(200);

    const logoutRes = await DELETE(
      deleteRequest(`session=${accessToken}; session_refresh=${refreshToken}`),
    );
    expect(logoutRes.status).toBe(200);

    // The exact same still-unexpired, still correctly-signed cookie must
    // now be rejected with 401 — proof that revocation is enforced
    // server-side, not merely by clearing the cookie in the response.
    const afterRes = await SESSION_GET(
      new NextRequest('http://localhost:3000/api/auth/session', {
        headers: { cookie: `session=${accessToken}` },
      }),
    );
    expect(afterRes.status).toBe(401);
    expect(await afterRes.json()).toEqual({ authenticated: false });
  });
});

// See #660: the session must carry a bounded lifetime that the server
// enforces, and be revocable server-side independently of the cookie.
describe('POST /api/auth/sep10 — session expiry and revocation', () => {
  function sessionRequest(accessToken: string): NextRequest {
    return new NextRequest('http://localhost:3000/api/auth/session', {
      headers: { cookie: `session=${accessToken}` },
    });
  }

  async function login() {
    mockVerify.mockReturnValueOnce(undefined);
    const res = await POST(makeRequest(ALLOWED_ORIGIN));
    expect(res.status).toBe(200);
    return res;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('sets a bounded maxAge on both session cookies', async () => {
    const res = await login();
    expect(res.cookies.get('session')?.maxAge).toBe(ACCESS_TOKEN_TTL_SEC);
    expect(res.cookies.get('session_refresh')?.maxAge).toBe(
      DEFAULT_REFRESH_TTL_SEC,
    );
  });

  test('rejects the access cookie once its lifetime has elapsed, even if the client still sends it', async () => {
    const start = Date.now();
    const res = await login();
    const accessToken = res.cookies.get('session')!.value;

    expect((await SESSION_GET(sessionRequest(accessToken))).status).toBe(200);

    jest
      .spyOn(Date, 'now')
      .mockReturnValue(start + (ACCESS_TOKEN_TTL_SEC + 1) * 1000);
    const expiredRes = await SESSION_GET(sessionRequest(accessToken));
    expect(expiredRes.status).toBe(401);
    expect(await expiredRes.json()).toEqual({ authenticated: false });
  });

  test('rejects a still-unexpired cookie once its session is revoked server-side', async () => {
    const res = await login();
    const accessToken = res.cookies.get('session')!.value;
    const sid = verifySessionToken(accessToken, 'access')!.sid;

    expect(SessionStore.getInstance().revoke(sid)).toBe(true);

    const revokedRes = await SESSION_GET(sessionRequest(accessToken));
    expect(revokedRes.status).toBe(401);
    expect(await revokedRes.json()).toEqual({ authenticated: false });
  });
});
