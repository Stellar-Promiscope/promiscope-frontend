import { Redis } from '@upstash/redis';
import type { NextRequest } from 'next/server';

/**
 * Shared rate limiter used by API routes that need per-IP throttling
 * (app/api/players/search/route.ts, app/api/ipfs/upload/route.ts, and any
 * future route with the same need).
 *
 * Why this file exists (issue #658): both routes used to keep their own
 * module-level `Map<string, ...>` as rate-limit state. On Vercel-style
 * serverless deployments, each warm function instance gets its own copy of
 * that module state. A client hammering the endpoint gets load-balanced
 * across N instances, each independently allowing up to `limit` requests —
 * so the *effective* limit becomes `limit * N`, not `limit`. That's a real
 * abuse-protection gap, not just a theoretical one.
 *
 * The fix: back the counter with Upstash Redis (a REST-based client, so it
 * works from serverless/edge runtimes without a persistent TCP connection)
 * when it's configured, so every instance increments the same counter. When
 * Redis isn't configured, fall back to an in-memory Map — see
 * `getStore()` below for exactly when that's acceptable and when it's not.
 */

export interface RateLimitOptions {
  /** Max requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  limited: boolean;
  /** Only set when `limited` is true. Seconds until the caller may retry. */
  retryAfterSec?: number;
}

interface RateLimitStore {
  /**
   * Increment the counter for `key`, creating a new window if none is
   * active, and report the post-increment count plus how much of the
   * current window remains.
   */
  increment(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; ttlMs: number }>;
}

// ── In-memory store (dev/test fallback) ─────────────────────────────────────

type RateEntry = { count: number; resetAt: number };

class InMemoryStore implements RateLimitStore {
  private map = new Map<string, RateEntry>();

  async increment(key: string, windowMs: number) {
    const now = Date.now();
    const entry = this.map.get(key);

    if (!entry || now >= entry.resetAt) {
      const resetAt = now + windowMs;
      this.map.set(key, { count: 1, resetAt });
      return { count: 1, ttlMs: windowMs };
    }

    entry.count += 1;
    return { count: entry.count, ttlMs: entry.resetAt - now };
  }
}

// ── Redis store (production / shared across instances) ─────────────────────

class RedisStore implements RateLimitStore {
  constructor(private redis: Redis) {}

  async increment(key: string, windowMs: number) {
    // Fixed-window counter: INCR the key, and on the first hit in a window
    // set an EXPIRE so it resets after `windowMs`.
    //
    // Tradeoff vs. a sliding window: fixed windows allow up to 2x `limit`
    // requests across a window boundary (e.g. `limit` requests in the last
    // instant of one window plus `limit` more in the first instant of the
    // next). A sliding-log or sliding-window-counter algorithm avoids that
    // at the cost of extra Redis calls/state (a sorted set per key, or two
    // counters blended by elapsed-time weight). For per-IP abuse protection
    // on these routes, admitting up to 2x `limit` for a brief instant at a
    // window boundary is an acceptable tradeoff for the simplicity of a
    // single INCR/EXPIRE pair — revisit if these limits ever need to be
    // exact rather than "good enough to stop scripted abuse."
    const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
    const count = await this.redis.incr(key);

    if (count === 1) {
      await this.redis.expire(key, windowSec);
      return { count, ttlMs: windowMs };
    }

    const pttlMs = await this.redis.pttl(key);
    // pttl returns -1 if the key has no TTL (shouldn't happen — we always
    // set one on creation) and -2 if the key doesn't exist (a race with
    // expiry). Fall back to the nominal window length in either case.
    const ttlMs = pttlMs && pttlMs > 0 ? pttlMs : windowMs;
    return { count, ttlMs };
  }
}

// ── Store selection ──────────────────────────────────────────────────────────

let cachedStore: RateLimitStore | null = null;
let warnedMissingRedisInProd = false;

function buildStore(): RateLimitStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    return new RedisStore(new Redis({ url, token }));
  }

  // No Redis configured. This is expected (and fine) in local dev/test —
  // NODE_ENV !== 'production' — where a single process is the only
  // "instance" anyway, so an in-memory Map is fully authoritative.
  //
  // In production, though, this in-memory fallback is NOT globally
  // authoritative: it's scoped to a single serverless instance, which is
  // exactly the bug this file exists to fix (see the file-level comment
  // above). We intentionally do NOT hard-fail the request or fail closed
  // (treating every request as rate-limited) here — an outage of the rate
  // limiter shouldn't take down the whole route. Instead we log loudly
  // (once, not per-request) so the misconfiguration is visible in
  // production logs/alerts, and degrade to best-effort, per-instance
  // limiting rather than no limiting at all. Configure
  // UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN to get the real,
  // shared-across-instances guarantee back.
  if (process.env.NODE_ENV === 'production' && !warnedMissingRedisInProd) {
    warnedMissingRedisInProd = true;
    console.error(
      '[rateLimit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set in ' +
        'production. Falling back to an in-memory, per-instance rate limiter. This is ' +
        'NOT globally authoritative: under concurrent traffic spread across N warm ' +
        'serverless instances, the effective limit is approximately `limit * N`, not ' +
        '`limit`. Configure Upstash Redis (see .env.example) to restore a shared, ' +
        'globally-enforced rate limit.',
    );
  }

  return new InMemoryStore();
}

function getStore(): RateLimitStore {
  if (!cachedStore) {
    cachedStore = buildStore();
  }
  return cachedStore;
}

/**
 * Test-only escape hatch: clears the cached store (and the "already warned"
 * flag) so each test can start from a clean slate and re-evaluate env vars.
 * Not used by application code.
 */
export function _resetRateLimitStoreForTests(): void {
  cachedStore = null;
  warnedMissingRedisInProd = false;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Check (and consume) one unit of rate-limit budget for `key`.
 *
 * `key` should namespace by both the caller (e.g. route name) and the
 * client identity (e.g. IP) — callers here use keys like
 * `players-search:<ip>` and `ipfs-upload:<ip>` so the two routes' limits
 * never collide with each other in a shared store.
 */
export async function checkRateLimit(
  key: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const store = getStore();
  const { count, ttlMs } = await store.increment(key, opts.windowMs);

  if (count > opts.limit) {
    return { limited: true, retryAfterSec: Math.ceil(ttlMs / 1000) };
  }

  return { limited: false };
}

export { getClientIp } from './clientIp';
