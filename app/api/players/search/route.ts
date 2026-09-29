import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import { createRequestLogger } from '@/lib/logger';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { withOutboundSpan, withRouteTelemetry } from '@/lib/telemetry';

// Search names longer than this are likely abuse or mistake; never forward them.
const PLAYER_SEARCH_NAME_MAX = 100;

/**
 * GET /api/players/search?name=...
 *
 * Proxies player name search to the off-chain backend (NEXT_PUBLIC_API_URL)
 * and rate limits per client IP. Typeahead search sends a request per
 * keystroke — the existing 300ms useDebounce in ScoutDashboardContent
 * already cuts that down client-side, but debouncing is not a security
 * boundary (it's trivially bypassable by calling the endpoint directly), so
 * this is the actual defense against abuse or a runaway client.
 *
 * Rate limiting: max 20 searches per IP per 10 seconds, enforced via the
 * shared lib/rateLimit.ts (Redis-backed in production, in-memory in dev —
 * see that file for why a per-route in-memory Map isn't sufficient). When
 * exceeded, responds with 429 Too Many Requests and a Retry-After header.
 *
 * Real client IP is extracted from the x-forwarded-for header, same
 * convention as app/api/ipfs/upload/route.ts.
 */
const RATE_LIMIT = 20;
const WINDOW_MS = 10 * 1000;

const backend = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  headers: { 'Content-Type': 'application/json' },
});

async function getPlayerSearch(req: NextRequest) {
  const log = createRequestLogger(req);
  const ip = getClientIp(req);

  const rl = await checkRateLimit(`players-search:${ip}`, {
    limit: RATE_LIMIT,
    windowMs: WINDOW_MS,
  });
  if (rl.limited) {
    log.warn('Rate limit exceeded', { ip });
    const retryAfter = rl.retryAfterSec ?? Math.ceil(WINDOW_MS / 1000);
    return NextResponse.json(
      { error: 'Too many search requests. Please slow down.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  const name = req.nextUrl.searchParams.get('name') ?? '';

  if (name.length > PLAYER_SEARCH_NAME_MAX) {
    return NextResponse.json(
      { error: `name must be at most ${PLAYER_SEARCH_NAME_MAX} characters` },
      { status: 400 },
    );
  }

  try {
    const res = await withOutboundSpan(
      'backend.players.search',
      { dependency: 'backend', operation: 'players.search' },
      () => backend.get('/players/search', { params: { name } }),
    );
    return NextResponse.json(res.data);
  } catch (e: any) {
    const status = e?.response?.status ?? 502;
    log.error('Player search proxy failed', {
      status,
      reason: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: 'Failed to search players' }, { status });
  }
}

export const GET = withRouteTelemetry(getPlayerSearch, '/api/players/search');
