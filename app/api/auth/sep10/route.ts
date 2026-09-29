import { WebAuth, Networks, Keypair, StrKey } from '@stellar/stellar-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createRequestLogger, withRequestId } from '@/lib/logger';
import {
  createSessionToken,
  verifySessionToken,
  ACCESS_TOKEN_TTL_SEC,
  DEFAULT_REFRESH_TTL_SEC,
  REMEMBER_ME_REFRESH_TTL_SEC,
} from '@/lib/session';
import { SessionStore } from '@/lib/sessionStore';
import { withRouteTelemetry } from '@/lib/telemetry';

// better-sqlite3 (via lib/sessionStore.ts) is a native addon and needs the
// Node.js runtime, not edge.
export const runtime = 'nodejs';

// Same check as lib/stellar's isValidStellarAddress, without importing that
// module's RPC client into the auth route. Only G-addresses pass; muxed
// (M...) accounts aren't supported.
const isValidStellarAddress = (key: string) =>
  StrKey.isValidEd25519PublicKey(key);

// Both handlers need the server signing key and home domain. An empty home
// domain would make every verification fail, so it's a config error too.
function getSep10Config(): { serverKey: string; homeDomain: string } | null {
  const serverKey = process.env.SEP10_SERVER_KEY;
  const homeDomain = process.env.SEP10_HOME_DOMAIN;
  if (!serverKey || !homeDomain) return null;
  return { serverKey, homeDomain };
}

function serverNotConfigured(): NextResponse {
  return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
}

// Returns the set of origins this route will accept requests from. This is
// derived ONLY from server-controlled configuration (env vars) — never from
// the incoming request's own Host/X-Forwarded-Proto headers, which a caller
// fully controls and could otherwise use to make `origin === allowed` a
// self-referential, always-true check (see #659).
function getAllowedOrigins(): string[] {
  const allowList = process.env.SEP10_ALLOWED_ORIGINS;
  const origins = new Set<string>();

  if (allowList) {
    for (const entry of allowList.split(',')) {
      const trimmed = entry.trim();
      if (trimmed) origins.add(trimmed);
    }
  }

  // Honor NEXT_PUBLIC_BASE_URL as a convenience single-origin entry, kept
  // for backward compatibility — folded into the allow-list rather than
  // used as a separate fallback path.
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (baseUrl) origins.add(baseUrl);

  if (origins.size > 0) return [...origins];

  // No allow-list configured. In production this must fail closed — do not
  // derive an "allowed" origin from anything on the request itself.
  if (process.env.NODE_ENV === 'production') return [];

  // Local development convenience default, based on NEXT_PUBLIC_DOMAIN
  // (see .env.example, defaults to `localhost:3000`) — never derived from
  // the request.
  const domain = process.env.NEXT_PUBLIC_DOMAIN || 'localhost:3000';
  return [`http://${domain}`];
}

async function postSep10(req: NextRequest) {
  const log = createRequestLogger(req);
  const origin = req.headers.get('origin');
  const allowedOrigins = getAllowedOrigins();

  if (
    !origin ||
    allowedOrigins.length === 0 ||
    !allowedOrigins.includes(origin)
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { signedXdr?: string; publicKey?: string; rememberMe?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 },
    );
  }

  const { signedXdr, publicKey, rememberMe } = body ?? {};
  if (!signedXdr || !publicKey) {
    return NextResponse.json(
      { error: 'Missing signedXdr or publicKey' },
      { status: 400 },
    );
  }

  if (typeof publicKey !== 'string' || !isValidStellarAddress(publicKey)) {
    return NextResponse.json({ error: 'Invalid publicKey' }, { status: 400 });
  }

  const config = getSep10Config();
  if (!config) return serverNotConfigured();
  const { serverKey, homeDomain } = config;
  const network =
    process.env.NEXT_PUBLIC_NETWORK === 'mainnet'
      ? Networks.PUBLIC
      : Networks.TESTNET;

  try {
    // verifyChallengeTxSigners' second argument is the server's *public* key
    // (compared directly against the challenge transaction's source
    // account) — passing the raw secret seed here always fails with
    // "the transaction source account is not equal to the server's account".
    const serverAccountId = Keypair.fromSecret(serverKey).publicKey();
    WebAuth.verifyChallengeTxSigners(
      signedXdr,
      serverAccountId,
      network,
      [publicKey],
      homeDomain,
      homeDomain,
    );

    // `maxAge` in the response reflects the refresh token's lifetime — the
    // window before a caller must produce a brand-new signed SEP-10
    // challenge rather than just calling /api/auth/refresh — preserving the
    // shape existing consumers (context/WalletContext.tsx) already read.
    // The `session` cookie itself is short-lived (ACCESS_TOKEN_TTL_SEC);
    // /api/auth/refresh rotates it using the longer-lived `session_refresh`
    // cookie. See #778.
    const maxAge = rememberMe
      ? REMEMBER_ME_REFRESH_TTL_SEC
      : DEFAULT_REFRESH_TTL_SEC;
    const isProd = process.env.NODE_ENV === 'production';

    // A single session id ties this login's access and refresh tokens
    // together (and is carried forward across every future refresh
    // rotation of them — see app/api/auth/refresh/route.ts) so the whole
    // login can be revoked as one unit server-side (see #1179), rather
    // than a signed-but-unrevocable token being the only thing that
    // stands between a stolen cookie and continued access.
    const sid = randomUUID();
    const accessToken = createSessionToken(
      publicKey,
      'access',
      ACCESS_TOKEN_TTL_SEC,
      { sid },
    );
    const refreshToken = createSessionToken(publicKey, 'refresh', maxAge, {
      remember: !!rememberMe,
      sid,
    });

    SessionStore.getInstance().create(
      sid,
      publicKey,
      Date.now() + maxAge * 1000,
      req.headers.get('user-agent'),
    );

    const response = NextResponse.json({ success: true, maxAge });
    response.cookies.set('session', accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      path: '/',
      maxAge: ACCESS_TOKEN_TTL_SEC,
    });
    // Scoped to /api/auth so it's only ever sent to the refresh/logout
    // endpoints, not on every request the way `session` is.
    response.cookies.set('session_refresh', refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      path: '/api/auth',
      maxAge,
    });
    return withRequestId(response, log.requestId);
  } catch (error) {
    log.error('SEP-10 verification failed', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return withRequestId(
      NextResponse.json(
        { error: 'Challenge verification failed' },
        { status: 401 },
      ),
      log.requestId,
    );
  }
}

async function getSep10(req: NextRequest) {
  const log = createRequestLogger(req);
  const account = req.nextUrl.searchParams.get('account');
  if (!account) {
    return NextResponse.json(
      { error: 'Missing account parameter' },
      { status: 400 },
    );
  }

  if (!isValidStellarAddress(account)) {
    return NextResponse.json(
      { error: 'Invalid account parameter' },
      { status: 400 },
    );
  }

  const config = getSep10Config();
  if (!config) return serverNotConfigured();
  const { serverKey, homeDomain } = config;
  const network =
    process.env.NEXT_PUBLIC_NETWORK === 'mainnet'
      ? Networks.PUBLIC
      : Networks.TESTNET;

  try {
    const { Keypair } = await import('@stellar/stellar-sdk');
    const serverKeypair = Keypair.fromSecret(serverKey);
    const { buildChallengeTx } = (await import('@stellar/stellar-sdk')).WebAuth;
    const challengeXdr = buildChallengeTx(
      serverKeypair,
      account,
      homeDomain,
      300,
      network,
      homeDomain,
    );
    return NextResponse.json({ transaction: challengeXdr });
  } catch (error) {
    log.error('SEP-10 challenge generation failed', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return withRequestId(
      NextResponse.json(
        { error: 'Failed to generate challenge' },
        { status: 500 },
      ),
      log.requestId,
    );
  }
}

/**
 * DELETE /api/auth/sep10
 *
 * Logs the caller out: clears both session cookies AND revokes the
 * session's row server-side (see #1179), so a copy of the cookie captured
 * before this call (a stale browser tab, a proxy log, XSS exfiltration)
 * stops working immediately instead of remaining valid until its natural
 * `exp`. Called by context/WalletContext.tsx's disconnect().
 *
 * The `sid` is read from whichever of the two cookies still verifies —
 * `session` (access token) is usually present, but a caller whose access
 * token already expired and hasn't refreshed yet still has a chance to
 * revoke via `session_refresh`. Best-effort: an unreadable/absent sid just
 * means there's nothing server-side left to revoke, but the cookies are
 * still cleared either way.
 */
async function deleteSep10(req: NextRequest) {
  const accessToken = req.cookies.get('session')?.value;
  const refreshToken = req.cookies.get('session_refresh')?.value;
  const sid =
    (accessToken && verifySessionToken(accessToken, 'access')?.sid) ||
    (refreshToken && verifySessionToken(refreshToken, 'refresh')?.sid) ||
    null;

  if (sid) {
    try {
      SessionStore.getInstance().revoke(sid);
    } catch {
      // Best-effort — cookies are still cleared below regardless.
    }
  }

  const response = NextResponse.json({ success: true });
  response.cookies.delete('session');
  response.cookies.delete({ name: 'session_refresh', path: '/api/auth' });
  return response;
}

export const POST = withRouteTelemetry(postSep10, '/api/auth/sep10');
export const GET = withRouteTelemetry(getSep10, '/api/auth/sep10');
export const DELETE = withRouteTelemetry(deleteSep10, '/api/auth/sep10');
