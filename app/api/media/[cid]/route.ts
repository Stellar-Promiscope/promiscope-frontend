import { NextRequest, NextResponse } from 'next/server';
import { verifyMediaUrlSignature } from '@/lib/mediaUrlSigning';
import { createRequestLogger } from '@/lib/logger';
import { fetchMediaFromGateways } from '@/lib/mediaProxyGateway';
import { isValidCid } from '@/lib/cid';

/**
 * GET /api/media/[cid]
 *
 * Proxies IPFS media through this app's own origin so that:
 *
 * 1. Repeat requests for the same CID are served from a CDN/edge cache in
 *    front of this route (Cache-Control below is what the platform's CDN —
 *    Vercel's Edge Network or any CDN configured in front of it — keys its
 *    cache on) instead of round-tripping to Pinata/IPFS every time.
 * 2. The raw gateway URL never appears in page HTML, so third parties can't
 *    trivially copy a Pinata/dweb.link link out of the DOM and hotlink it
 *    from another site.
 * 3. A signed, time-limited URL mechanism (lib/mediaUrlSigning.ts) is
 *    available for flows that need non-guessable, expiring links. When
 *    `MEDIA_URL_SIGNING_SECRET` isn't set (e.g. local dev), requests fall
 *    back to referrer-based gating instead of a hard block.
 *
 * CIDs are content-addressed — the same CID always resolves to the same
 * bytes — so an aggressive `immutable` Cache-Control is safe: a "changed"
 * profile photo/video is a *new* CID (see buildUpdateProfile in
 * lib/contract.ts), not a mutation of an existing one, which is what makes
 * cache invalidation a non-issue here.
 *
 * HTTP Range requests are forwarded upstream so <video> scrubbing works.
 * A bounded read-ahead probe (lib/mediaProxyGateway.ts) retries the next
 * gateway when an upstream stream stalls or errors before any bytes are
 * committed to the client.
 */

const PRIMARY_GATEWAY =
  process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? 'https://gateway.pinata.cloud/ipfs';

/** Same fallback order as lib/ipfs.ts's client-side gateway fallback. */
const FALLBACK_GATEWAYS = [
  'https://ipfs.io/ipfs',
  'https://cloudflare-ipfs.com/ipfs',
];

const CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Error responses must never be cached by the CDN or browser. */
function errorResponse(
  error: string,
  status: number,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(
    { error },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'CDN-Cache-Control': 'no-store',
        ...headers,
      },
    },
  );
}

// Best-effort in-process rate limit. This only protects a single server
// instance/region — it bounds obvious bulk-scraping in the default
// single-instance deployment, but a production deployment fronted by a real
// CDN should prefer that CDN's (or Cloudflare's/Upstash's) distributed rate
// limiting instead of relying on this alone.
const RATE_LIMIT_PER_WINDOW = 120;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
type RateEntry = { count: number; firstSeen: number };
const rateMap = new Map<string, RateEntry>();

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now - entry.firstSeen > RATE_LIMIT_WINDOW_MS) {
    rateMap.set(ip, { count: 1, firstSeen: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_PER_WINDOW;
}

function isAllowedReferrer(req: NextRequest): boolean {
  const referer = req.headers.get('referer');
  // No Referer at all (direct navigation, privacy-focused browsers/extensions
  // that strip it) is allowed — we can't distinguish that from a legitimate
  // same-site request, so this check only catches an *explicit* cross-site
  // Referer, which is the common hotlinking/scraping signature.
  if (!referer) return true;

  const allowedOrigins = [
    process.env.NEXT_PUBLIC_APP_URL,
    'http://localhost:3000',
  ].filter((v): v is string => Boolean(v));

  try {
    const refOrigin = new URL(referer).origin;
    return allowedOrigins.some((origin) => {
      try {
        return new URL(origin).origin === refOrigin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { cid: string } },
) {
  const log = createRequestLogger(req);
  const cid = params.cid;
  if (!cid) {
    return errorResponse('Missing cid', 400);
  }
  // Validate before any upstream fetch so callers can't shape arbitrary
  // gateway requests (path traversal, query injection) through our origin.
  if (!isValidCid(cid)) {
    return errorResponse('Invalid cid', 400);
  }

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    log.warn('Rate limit exceeded', { ip, cid });
    return errorResponse('Too many requests', 429, { 'Retry-After': '60' });
  }

  const { searchParams } = new URL(req.url);
  const sig = searchParams.get('sig');
  const exp = searchParams.get('exp');

  if (sig || exp) {
    // A signature was presented — it must be valid and unexpired regardless
    // of Referer.
    if (!verifyMediaUrlSignature(cid, exp, sig)) {
      return errorResponse('Invalid or expired signature', 403);
    }
  } else if (!isAllowedReferrer(req)) {
    // No signature — fall back to referrer gating. This rejects the
    // explicit-cross-site-Referer case (another site directly embedding our
    // proxy URL) while still allowing same-site and no-Referer requests,
    // which covers ordinary in-app <img>/<video> usage today.
    return errorResponse('Forbidden', 403);
  }

  const gateways = [PRIMARY_GATEWAY, ...FALLBACK_GATEWAYS];
  const rangeHeader = req.headers.get('range');

  try {
    const result = await fetchMediaFromGateways({
      cid,
      gateways,
      rangeHeader,
    });

    if (!result) {
      log.error('All IPFS gateways exhausted', { cid });
      return errorResponse('Media not available', 502);
    }

    const responseHeaders: Record<string, string> = {
      'Content-Type': result.contentType,
      'Cache-Control': CACHE_CONTROL,
      // Vercel's Edge Network (and most CDNs) prefer a dedicated
      // CDN-facing directive over the browser-facing Cache-Control when
      // both are present, so edge caching still applies even if a
      // downstream proxy strips or rewrites Cache-Control for clients.
      'CDN-Cache-Control': CACHE_CONTROL,
      // Range + Accept so edge caches key full-file vs partial responses
      // separately without disabling caching for the common start-from-zero case.
      Vary: 'Range, Accept',
      'Accept-Ranges': result.acceptRanges,
    };

    if (result.contentRange) {
      responseHeaders['Content-Range'] = result.contentRange;
    }
    if (result.contentLength) {
      responseHeaders['Content-Length'] = result.contentLength;
    }

    return new NextResponse(result.body, {
      status: result.status,
      headers: responseHeaders,
    });
  } catch (err) {
    log.error('All IPFS gateways exhausted', {
      cid,
      reason: err instanceof Error ? err.message : String(err),
    });
    return errorResponse('Media not available', 502);
  }
}
