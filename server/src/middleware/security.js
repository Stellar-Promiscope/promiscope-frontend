const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

// Baseline HTTP hardening (issue #1335): security headers, CORS allow-list
// and per-IP rate limits, all driven by environment variables.

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Routes guarded by the Turnstile middleware get the strictest limit.
const TURNSTILE_ROUTES = new Set([
  '/referrals/generate',
  '/sponsorship/waitlist',
]);

function intFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * JSON-API headers: CSP and the cross-origin isolation headers are aimed
 * at HTML documents and would only get in the way of a JSON API consumed
 * cross-origin, so they're off; everything else helmet sets stays on.
 */
function securityHeaders() {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
}

/**
 * CORS_ORIGINS is a comma-separated allow-list; CORS_ORIGIN_PATTERN an
 * optional regex for preview deployments (e.g. `^https://promiscope-.*\.vercel\.app$`).
 * CORS_ORIGIN (single origin) is still honored for backward compatibility.
 */
function corsMiddleware() {
  const origins = new Set(
    [process.env.CORS_ORIGINS, process.env.CORS_ORIGIN]
      .filter(Boolean)
      .flatMap((value) => value.split(','))
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  if (origins.size === 0) origins.add('http://localhost:3000');
  const pattern = process.env.CORS_ORIGIN_PATTERN
    ? new RegExp(process.env.CORS_ORIGIN_PATTERN)
    : null;

  return cors({
    origin(origin, callback) {
      // Non-browser callers (curl, server-to-server) send no Origin header.
      const allowed =
        !origin || origins.has(origin) || (pattern?.test(origin) ?? false);
      callback(null, allowed);
    },
  });
}

let redisClient;

function createStore(prefix) {
  if (!process.env.REDIS_URL) return undefined; // express-rate-limit's MemoryStore
  const { RedisStore } = require('rate-limit-redis');
  if (!redisClient) {
    const { createClient } = require('redis');
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (err) =>
      console.error('Rate-limit Redis error:', err.message),
    );
    redisClient.connect().catch(() => {});
  }
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (...args) => redisClient.sendCommand(args),
  });
}

function limiter(prefix, max, skip) {
  return rateLimit({
    windowMs: intFromEnv('RATE_LIMIT_WINDOW_MS', 60_000),
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip,
    store: createStore(prefix),
    handler: (req, res) => res.status(429).json({ error: 'Too many requests' }),
  });
}

/** Global, write-route and Turnstile-route limiters, applied in that order. */
function rateLimiters() {
  return [
    limiter('all', intFromEnv('RATE_LIMIT_MAX', 300)),
    limiter(
      'write',
      intFromEnv('RATE_LIMIT_WRITE_MAX', 30),
      (req) => !WRITE_METHODS.has(req.method),
    ),
    limiter(
      'turnstile',
      intFromEnv('RATE_LIMIT_TURNSTILE_MAX', 10),
      (req) => !TURNSTILE_ROUTES.has(req.path),
    ),
  ];
}

module.exports = { securityHeaders, corsMiddleware, rateLimiters };
