import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

// Same-origin proxy for packages/indexer's query API (issue #1332, extended
// by #1298 for /players and /health). The
// indexer sends no CORS headers and has no auth or rate limiting of its own,
// so browser code (lib/indexerClient.ts) calls /api/indexer/* instead of the
// indexer origin, and this route forwards only the allow-listed query routes
// to INDEXER_API_URL_INTERNAL — keeping the indexer on a private network.

const FETCH_TIMEOUT_MS = 5000;
const RATE_LIMIT = { limit: 120, windowMs: 60_000 };
// Public event queries are safe to cache briefly at the edge.
const CACHE_CONTROL = 'public, s-maxage=10, stale-while-revalidate=30';

const GET_ROUTES = [
  /^events$/,
  /^health$/,
  /^players$/,
  /^players\/[^/]+\/events$/,
  /^validators\/[^/]+\/events$/,
];
const POST_ROUTES = [/^validators\/approval-counts$/];

function indexerBaseUrl(): string {
  return (
    process.env.INDEXER_API_URL_INTERNAL ??
    process.env.NEXT_PUBLIC_INDEXER_API_URL ??
    'http://localhost:3001'
  ).replace(/\/+$/, '');
}

function isAllowed(method: 'GET' | 'POST', path: string): boolean {
  const routes = method === 'GET' ? GET_ROUTES : POST_ROUTES;
  return routes.some((route) => route.test(path));
}

async function proxy(
  req: NextRequest,
  method: 'GET' | 'POST',
  segments: string[],
): Promise<NextResponse> {
  const path = segments.map(encodeURIComponent).join('/');
  if (!isAllowed(method, path)) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  const { limited, retryAfterSec } = await checkRateLimit(
    `indexer-proxy:${getClientIp(req)}`,
    RATE_LIMIT,
  );
  if (limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSec ?? 60) },
      },
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const upstream = await fetch(
      `${indexerBaseUrl()}/${path}${req.nextUrl.search}`,
      {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? await req.text() : undefined,
        signal: controller.signal,
        cache: 'no-store',
      },
    );
    const data = await upstream.json().catch(() => ({}));
    const headers: Record<string, string> = {};
    if (method === 'GET' && upstream.ok) {
      headers['Cache-Control'] = CACHE_CONTROL;
    }
    return NextResponse.json(data, { status: upstream.status, headers });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'AbortError';
    return NextResponse.json(
      { error: timedOut ? 'Indexer request timed out' : 'Indexer unreachable' },
      { status: timedOut ? 504 : 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}

type RouteContext = { params: { path: string[] } };

export function GET(req: NextRequest, { params }: RouteContext) {
  return proxy(req, 'GET', params.path);
}

export function POST(req: NextRequest, { params }: RouteContext) {
  return proxy(req, 'POST', params.path);
}
