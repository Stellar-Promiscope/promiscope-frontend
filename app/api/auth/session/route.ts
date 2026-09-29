import { NextRequest } from 'next/server';
import { getSessionWallet } from '@/lib/session';
import { privateJson } from '@/lib/httpResponses';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

// better-sqlite3 (via lib/session.ts's SessionStore lookup) is a native
// addon and needs the Node.js runtime, not edge.
export const runtime = 'nodejs';

/**
 * GET /api/auth/session
 *
 * Returns the caller's authentication state based on the `session` cookie.
 * The cookie is a signed, time-bound access token (see lib/session.ts).
 * This route delegates to getSessionWallet() rather than trusting the
 * cookie's value directly, so a caller can no longer authenticate as an
 * arbitrary address just by setting `session=<any-address>` by hand (see
 * #778) — and, per #1179, a revoked session is reported as unauthenticated
 * even before its cookie's natural expiry, since getSessionWallet checks
 * the server-side session store in addition to the token's signature.
 *
 * Rate limiting: max 30 requests per IP per 10 seconds. This is a cheap,
 * low-risk read (it just echoes back a cookie), so the limit is generous
 * relative to app/api/players/search/route.ts's 20/10s — it's
 * defense-in-depth against abuse/runaway polling rather than a tight
 * bottleneck on legitimate session checks. When exceeded, responds with
 * 429 Too Many Requests and a Retry-After header.
 *
 * Real client IP is extracted from the x-forwarded-for header using trusted proxy settings.
 * Uses the shared limiter in lib/rateLimit.ts (Redis-backed when
 * configured) so the limit holds across serverless instances (#1330).
 */
const RATE_LIMIT = 30;
const WINDOW_MS = 10 * 1000;

export async function GET(req: NextRequest) {
  const wallet = getSessionWallet(req);
  const ip = getClientIp(req);
  const key = wallet ? `wallet:${wallet}` : ip;

  const rl = await checkRateLimit(`auth-session:${key}`, {
    limit: RATE_LIMIT,
    windowMs: WINDOW_MS,
  });
  if (rl.limited) {
    console.warn(`[session rate limit] Too many requests from: ${key}`);
    const retryAfter = rl.retryAfterSec ?? Math.ceil(WINDOW_MS / 1000);
    return privateJson(
      { error: 'Too many requests. Please slow down.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  if (!wallet) {
    return privateJson({ authenticated: false }, { status: 401 });
  }

  return privateJson({
    authenticated: true,
    publicKey: wallet,
  });
}
