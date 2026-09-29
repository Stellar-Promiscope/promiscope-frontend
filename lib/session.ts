import { NextRequest } from 'next/server';
import { createHmac, timingSafeEqual, randomUUID } from 'crypto';
import { SessionStore } from './sessionStore';

// See #778: the `session` cookie used to hold the caller's own plaintext
// public key with no signature and no server-side expiry — any HTTP client
// able to attach a `Cookie: session=<any-G-address>` header was
// authenticated as that address, without ever producing a signed SEP-10
// challenge transaction. Tokens below are HMAC-signed and time-bound so a
// cookie can only carry an identity this server actually issued.
//
// See #1179: a valid signature and an unexpired `exp` were still not
// enough to let the server invalidate one specific session before it
// naturally expired (e.g. "log out of all devices"). Every access/refresh
// token pair minted for a login now carries a shared `sid` claim, which
// lib/sessionStore.ts tracks server-side — getSessionWallet below checks
// that store, not just the token's signature, so revoking a `sid` rejects
// its cookie on the very next request.

/**
 * Resolves a token lifetime, letting an environment variable override the
 * built-in default — the same "env var wins" convention lib/sqliteDb.ts uses
 * for `SESSIONS_DB_PATH` (see #1299).
 *
 * The override exists so a test harness can shrink a lifetime to seconds
 * without waiting 20 real minutes for an access token to lapse
 * (e2e/session-lifecycle.spec.ts drives the silent-refresh path with
 * `ACCESS_TOKEN_TTL_SEC=10`). It is deliberately ignored in production:
 * deployments must not be able to accidentally mint five-second or
 * ten-year sessions from a stray env var, so `NODE_ENV=production` always
 * gets the compiled-in default. Unset, non-numeric, zero and negative
 * values likewise fall back to the default rather than failing closed at
 * import time (a bad env var must not take the whole auth surface down).
 */
function resolveTtlSec(envVar: string, defaultSec: number): number {
  if (process.env.NODE_ENV === 'production') return defaultSec;
  const raw = process.env[envVar];
  if (!raw) return defaultSec;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultSec;
  return Math.floor(parsed);
}

/** How long an access token (the `session` cookie) is valid for. */
export const ACCESS_TOKEN_TTL_SEC = resolveTtlSec(
  'ACCESS_TOKEN_TTL_SEC',
  20 * 60, // 20 minutes
);

/** Refresh token lifetime for a normal (non "remember me") sign-in. */
export const DEFAULT_REFRESH_TTL_SEC = resolveTtlSec(
  'DEFAULT_REFRESH_TTL_SEC',
  60 * 60 * 24, // 1 day
);

/** Refresh token lifetime when the caller opted into "remember me". */
export const REMEMBER_ME_REFRESH_TTL_SEC = resolveTtlSec(
  'REMEMBER_ME_REFRESH_TTL_SEC',
  60 * 60 * 24 * 30, // 30 days
);

type SessionTokenType = 'access' | 'refresh';

interface SessionTokenPayload {
  sub: string;
  typ: SessionTokenType;
  iat: number;
  exp: number;
  /**
   * Random per-token identifier. Guarantees each issued token is a distinct
   * string even when two tokens for the same subject/type/TTL are minted
   * within the same second (`iat` alone wouldn't distinguish them) — most
   * relevant for rotation, where the whole point is that the pre-rotation
   * token stops being the one currently in use.
   */
  jti: string;
  /** Only set on refresh tokens; carries the "remember me" TTL class through rotation. */
  remember?: boolean;
  /**
   * Session id (see lib/sessionStore.ts). Shared by an access token and its
   * paired refresh token, and carried forward across refresh rotations, so
   * the underlying server-side session row — and therefore its revocation
   * state — persists even as the tokens themselves rotate.
   */
  sid: string;
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET is not configured');
  }
  return secret;
}

function sign(payloadB64: string): string {
  return createHmac('sha256', getSessionSecret())
    .update(payloadB64)
    .digest('base64url');
}

/**
 * Creates an HMAC-signed, time-bound session token of the form
 * `<base64url payload>.<base64url signature>`. Deliberately a lightweight,
 * self-contained token (HMAC over a small JSON payload via Node's built-in
 * crypto) rather than pulling in a JWT library — the payload here is two
 * fields and one signature algorithm, so a full JWT implementation (header,
 * multiple alg support, etc.) would add a dependency to solve a problem this
 * doesn't have.
 */
export function createSessionToken(
  publicKey: string,
  type: SessionTokenType,
  ttlSec: number,
  opts: { remember?: boolean; sid?: string } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionTokenPayload = {
    sub: publicKey,
    typ: type,
    iat: now,
    exp: now + ttlSec,
    jti: randomUUID(),
    // Callers that mint an access/refresh pair for the same login (or that
    // rotate an existing session) pass the shared `sid` explicitly so both
    // tokens — and every token that follows from rotating them — resolve
    // to the same lib/sessionStore.ts row. A bare, sid-less call (e.g. in
    // tests exercising the token format alone) still gets a valid, unique
    // sid rather than an error.
    sid: opts.sid ?? randomUUID(),
    ...(type === 'refresh' ? { remember: !!opts.remember } : {}),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

/**
 * Verifies a session token's signature, type, and expiry, returning the
 * decoded payload only when all three hold. Signature comparison uses
 * `timingSafeEqual` (not `===`) to avoid leaking match-length information
 * through response timing. This is the only sanctioned way to trust a
 * token's claims — never parse/trust a cookie's raw value directly.
 */
export function verifySessionToken(
  token: string,
  expectedType: SessionTokenType,
): SessionTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  let expectedSignature: string;
  try {
    expectedSignature = sign(payloadB64);
  } catch {
    return null;
  }

  // Buffer.from(...).buffer is typed as ArrayBufferLike (it may back onto a
  // SharedArrayBuffer), which timingSafeEqual's ArrayBufferView parameter
  // type doesn't accept — Uint8Array.from copies into a plain ArrayBuffer,
  // satisfying the type without changing the runtime bytes compared.
  const sigBuf = Uint8Array.from(Buffer.from(signature));
  const expectedBuf = Uint8Array.from(Buffer.from(expectedSignature));
  if (
    sigBuf.length !== expectedBuf.length ||
    !timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return null;
  }

  let payload: SessionTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (payload.typ !== expectedType) return null;
  if (typeof payload.sub !== 'string' || !payload.sub) return null;
  if (typeof payload.jti !== 'string' || !payload.jti) return null;
  if (
    typeof payload.exp !== 'number' ||
    payload.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  return payload;
}

/**
 * Returns the authenticated wallet's public key from `req`'s signed
 * `session` cookie, or null if it's missing, malformed, tampered with, of
 * the wrong token type, expired, OR belongs to a session that's been
 * revoked server-side (see #1179 — a still-unexpired, still
 * correctly-signed token is no longer sufficient on its own; its `sid`
 * must also still be active in lib/sessionStore.ts). This is the ONLY
 * sanctioned way for a route to read caller identity from the `session`
 * cookie — routes that used to read `req.cookies.get('session')?.value`
 * directly were trusting whatever string the client sent, with no proof it
 * came from a completed SEP-10 flow (see #778).
 */
export function getSessionWallet(req: NextRequest): string | null {
  const token = req.cookies.get('session')?.value;
  if (!token) return null;
  const payload = verifySessionToken(token, 'access');
  if (!payload) return null;
  if (!SessionStore.getInstance().isActive(payload.sid)) return null;
  return payload.sub;
}

/**
 * Returns the `sid` (see lib/sessionStore.ts) of the session making `req`,
 * under the same validity rules as {@link getSessionWallet} — signature,
 * type, expiry, and server-side active-ness all checked. Lets a route tell
 * "which one of this wallet's sessions is the one I'm currently handling"
 * apart from its siblings (see #1187's active-sessions view, which needs to
 * mark the caller's own row distinctly so it isn't revoked by accident).
 */
export function getSessionId(req: NextRequest): string | null {
  const token = req.cookies.get('session')?.value;
  if (!token) return null;
  const payload = verifySessionToken(token, 'access');
  if (!payload) return null;
  if (!SessionStore.getInstance().isActive(payload.sid)) return null;
  return payload.sid;
}
