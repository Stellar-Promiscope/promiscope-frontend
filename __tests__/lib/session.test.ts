/** @jest-environment node */
import { NextRequest } from 'next/server';
import {
  createSessionToken,
  verifySessionToken,
  getSessionWallet,
  ACCESS_TOKEN_TTL_SEC,
  DEFAULT_REFRESH_TTL_SEC,
  REMEMBER_ME_REFRESH_TTL_SEC,
} from '@/lib/session';
import { SessionStore } from '@/lib/sessionStore';

const PUBLIC_KEY = 'GTESTKEY0000000000000000000000000000000000000000000000000';

beforeEach(() => {
  SessionStore.resetInstance();
});

afterEach(() => {
  SessionStore.resetInstance();
});

describe('createSessionToken / verifySessionToken', () => {
  it('round-trips a valid access token', () => {
    const token = createSessionToken(
      PUBLIC_KEY,
      'access',
      ACCESS_TOKEN_TTL_SEC,
    );
    const payload = verifySessionToken(token, 'access');
    expect(payload?.sub).toBe(PUBLIC_KEY);
    expect(payload?.typ).toBe('access');
  });

  it('round-trips a valid refresh token and carries the remember flag', () => {
    const token = createSessionToken(
      PUBLIC_KEY,
      'refresh',
      REMEMBER_ME_REFRESH_TTL_SEC,
      { remember: true },
    );
    const payload = verifySessionToken(token, 'refresh');
    expect(payload?.sub).toBe(PUBLIC_KEY);
    expect(payload?.remember).toBe(true);
  });

  it('rejects a token whose signature has been tampered with', () => {
    const token = createSessionToken(
      PUBLIC_KEY,
      'access',
      ACCESS_TOKEN_TTL_SEC,
    );
    const [payloadB64] = token.split('.');
    expect(
      verifySessionToken(`${payloadB64}.forgedsignature`, 'access'),
    ).toBeNull();
  });

  it('rejects a token whose payload has been tampered with (signature no longer matches)', () => {
    const token = createSessionToken(
      PUBLIC_KEY,
      'access',
      ACCESS_TOKEN_TTL_SEC,
    );
    const [, signature] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({
        sub: 'GATTACKERADDRESS000000000000000000000000000000000000000',
        typ: 'access',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SEC,
      }),
    ).toString('base64url');
    expect(
      verifySessionToken(`${forgedPayload}.${signature}`, 'access'),
    ).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = createSessionToken(PUBLIC_KEY, 'access', -1);
    expect(verifySessionToken(token, 'access')).toBeNull();
  });

  it('rejects a token of the wrong type', () => {
    const refreshToken = createSessionToken(
      PUBLIC_KEY,
      'refresh',
      DEFAULT_REFRESH_TTL_SEC,
    );
    expect(verifySessionToken(refreshToken, 'access')).toBeNull();
  });

  it('rejects a malformed token', () => {
    expect(verifySessionToken('not-a-real-token', 'access')).toBeNull();
    expect(verifySessionToken('', 'access')).toBeNull();
    expect(verifySessionToken('a.b.c', 'access')).toBeNull();
  });

  it('rejects when SESSION_SECRET is not configured', () => {
    const original = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    try {
      expect(() =>
        createSessionToken(PUBLIC_KEY, 'access', ACCESS_TOKEN_TTL_SEC),
      ).toThrow('SESSION_SECRET is not configured');
    } finally {
      process.env.SESSION_SECRET = original;
    }
  });
});

describe('getSessionWallet', () => {
  function requestWithCookie(cookieHeader?: string): NextRequest {
    const headers: Record<string, string> = {};
    if (cookieHeader) headers['cookie'] = cookieHeader;
    return new NextRequest('http://localhost:3000/', { headers });
  }

  /**
   * Mints an access token AND registers its `sid` in the session store as
   * an active session — i.e. what POST /api/auth/sep10 does for a real
   * login. Plain createSessionToken() alone (no store row) now models a
   * signed-but-never-issued-through-login token, which getSessionWallet
   * must reject just as it rejects an unsigned one (see #1179).
   */
  function issueActiveAccessToken(
    publicKey: string,
    ttlSec = ACCESS_TOKEN_TTL_SEC,
  ): string {
    const sid = `sid-${Math.random().toString(36).slice(2)}`;
    const token = createSessionToken(publicKey, 'access', ttlSec, { sid });
    SessionStore.getInstance().create(sid, publicKey, Date.now() + 60_000);
    return token;
  }

  it('returns null when there is no session cookie', () => {
    expect(getSessionWallet(requestWithCookie())).toBeNull();
  });

  it('returns the public key for a valid access token backed by an active session', () => {
    const token = issueActiveAccessToken(PUBLIC_KEY);
    expect(getSessionWallet(requestWithCookie(`session=${token}`))).toBe(
      PUBLIC_KEY,
    );
  });

  it('returns null for a signature-valid access token with no matching session row (see #1179)', () => {
    // Same as before #1179's store was added: a well-formed, correctly
    // signed, unexpired token whose sid was never registered (or whose
    // session has since been pruned) must not be trusted.
    const token = createSessionToken(
      PUBLIC_KEY,
      'access',
      ACCESS_TOKEN_TTL_SEC,
    );
    expect(getSessionWallet(requestWithCookie(`session=${token}`))).toBeNull();
  });

  it('returns null for a forged raw-address cookie (see #778)', () => {
    expect(
      getSessionWallet(requestWithCookie(`session=${PUBLIC_KEY}`)),
    ).toBeNull();
  });

  it('returns null for an expired access token', () => {
    const token = createSessionToken(PUBLIC_KEY, 'access', -1);
    expect(getSessionWallet(requestWithCookie(`session=${token}`))).toBeNull();
  });

  it('returns null when a refresh token is presented as the session cookie', () => {
    const refreshToken = createSessionToken(
      PUBLIC_KEY,
      'refresh',
      DEFAULT_REFRESH_TTL_SEC,
    );
    expect(
      getSessionWallet(requestWithCookie(`session=${refreshToken}`)),
    ).toBeNull();
  });

  it('rejects a previously-valid session cookie once its session has been revoked (see #1179)', () => {
    const sid = 'sid-revocation-test';
    const token = createSessionToken(
      PUBLIC_KEY,
      'access',
      ACCESS_TOKEN_TTL_SEC,
      {
        sid,
      },
    );
    const store = SessionStore.getInstance();
    store.create(sid, PUBLIC_KEY, Date.now() + 60_000);

    const req = requestWithCookie(`session=${token}`);

    // The cookie authenticates before revocation...
    expect(getSessionWallet(req)).toBe(PUBLIC_KEY);

    // ...revoking the session server-side (what disconnect() and "log out
    // of all devices" both do)...
    expect(store.revoke(sid)).toBe(true);

    // ...rejects the exact same still-unexpired, still correctly-signed
    // cookie on the very next request — this is the core acceptance
    // criterion of #1179: server-side revocation, not just cookie
    // presence/signature.
    expect(getSessionWallet(req)).toBeNull();
  });
});

/**
 * See #1299: the access/refresh lifetimes are env-overridable outside
 * production so a test harness can shrink them (e2e/session-lifecycle.spec.ts
 * runs the dev server with `ACCESS_TOKEN_TTL_SEC=10` to watch a token
 * actually lapse), while a production deployment always gets the
 * compiled-in defaults no matter what is in its environment.
 *
 * The constants are resolved once at import time, so each case re-imports
 * lib/session after changing the environment rather than mutating a module
 * it has already evaluated.
 */
describe('token TTL environment overrides', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const TTL_VARS = [
    'ACCESS_TOKEN_TTL_SEC',
    'DEFAULT_REFRESH_TTL_SEC',
    'REMEMBER_ME_REFRESH_TTL_SEC',
  ] as const;

  /** Re-imports lib/session so its module-level TTL constants are recomputed. */
  function loadSession(): typeof import('@/lib/session') {
    let session!: typeof import('@/lib/session');
    jest.isolateModules(() => {
      session = require('@/lib/session');
    });
    return session;
  }

  beforeEach(() => {
    jest.resetModules();
    for (const name of TTL_VARS) delete process.env[name];
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    for (const name of TTL_VARS) delete process.env[name];
    jest.resetModules();
  });

  it('defaults to the production lifetimes when nothing is overridden', () => {
    const session = loadSession();
    expect(session.ACCESS_TOKEN_TTL_SEC).toBe(20 * 60);
    expect(session.DEFAULT_REFRESH_TTL_SEC).toBe(60 * 60 * 24);
    expect(session.REMEMBER_ME_REFRESH_TTL_SEC).toBe(60 * 60 * 24 * 30);
  });

  it('honours ACCESS_TOKEN_TTL_SEC outside production (what the E2E suite relies on)', () => {
    process.env.ACCESS_TOKEN_TTL_SEC = '10';
    expect(loadSession().ACCESS_TOKEN_TTL_SEC).toBe(10);
  });

  it('honours the refresh-token lifetimes outside production', () => {
    process.env.DEFAULT_REFRESH_TTL_SEC = '90';
    process.env.REMEMBER_ME_REFRESH_TTL_SEC = '120';
    const session = loadSession();
    expect(session.DEFAULT_REFRESH_TTL_SEC).toBe(90);
    expect(session.REMEMBER_ME_REFRESH_TTL_SEC).toBe(120);
  });

  it('floors a fractional override', () => {
    process.env.ACCESS_TOKEN_TTL_SEC = '10.9';
    expect(loadSession().ACCESS_TOKEN_TTL_SEC).toBe(10);
  });

  it.each([
    ['an empty value', ''],
    ['a non-numeric value', 'soon'],
    ['zero', '0'],
    ['a negative value', '-60'],
    ['NaN', 'NaN'],
    ['Infinity', 'Infinity'],
  ])(
    'falls back to the default for %s instead of breaking the auth surface',
    (_label, value) => {
      process.env.ACCESS_TOKEN_TTL_SEC = value;
      expect(loadSession().ACCESS_TOKEN_TTL_SEC).toBe(20 * 60);
    },
  );

  it('ignores overrides entirely in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.ACCESS_TOKEN_TTL_SEC = '10';
    process.env.DEFAULT_REFRESH_TTL_SEC = '90';
    process.env.REMEMBER_ME_REFRESH_TTL_SEC = '120';

    const session = loadSession();
    expect(session.ACCESS_TOKEN_TTL_SEC).toBe(20 * 60);
    expect(session.DEFAULT_REFRESH_TTL_SEC).toBe(60 * 60 * 24);
    expect(session.REMEMBER_ME_REFRESH_TTL_SEC).toBe(60 * 60 * 24 * 30);
  });

  it('reports the override through a token it actually mints', () => {
    process.env.ACCESS_TOKEN_TTL_SEC = '10';
    const { createSessionToken, verifySessionToken } = loadSession();

    const payload = verifySessionToken(
      createSessionToken(PUBLIC_KEY, 'access', 10),
      'access',
    );
    expect(payload).not.toBeNull();
    expect(payload!.exp - payload!.iat).toBe(10);
  });
});
