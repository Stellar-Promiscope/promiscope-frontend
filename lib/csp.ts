/**
 * lib/csp.ts — per-request nonce-based Content-Security-Policy builder.
 *
 * The policy is generated in middleware.ts (per request, so the nonce is
 * fresh every time) and consumed in app/layout.tsx (to stamp the nonce on
 * the no-flash theme script and the x-nonce request header so Next.js can
 * inject it on its own inline scripts automatically).
 *
 * Origins are sourced from env so they stay correct across staging/prod
 * without code changes.
 *
 * Scaling note: horizontal scaling of the indexer would require Redis
 * pub/sub for SSE fan-out; a single instance is assumed here.
 */

export interface CspOptions {
  nonce: string;
  /** Override env look-ups in unit tests */
  env?: Partial<CspEnv>;
}

interface CspEnv {
  NEXT_PUBLIC_SOROBAN_RPC: string | undefined;
  NEXT_PUBLIC_HORIZON_URL: string | undefined;
  NEXT_PUBLIC_API_URL: string | undefined;
  NEXT_PUBLIC_INDEXER_API_URL: string | undefined;
  NEXT_PUBLIC_IPFS_GATEWAY: string | undefined;
  SENTRY_DSN: string | undefined;
  NODE_ENV: string | undefined;
}

function readEnv(): CspEnv {
  return {
    NEXT_PUBLIC_SOROBAN_RPC: process.env.NEXT_PUBLIC_SOROBAN_RPC,
    NEXT_PUBLIC_HORIZON_URL: process.env.NEXT_PUBLIC_HORIZON_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_INDEXER_API_URL: process.env.NEXT_PUBLIC_INDEXER_API_URL,
    NEXT_PUBLIC_IPFS_GATEWAY: process.env.NEXT_PUBLIC_IPFS_GATEWAY,
    SENTRY_DSN: process.env.SENTRY_DSN,
    NODE_ENV: process.env.NODE_ENV,
  };
}

/** Returns the origin (scheme + host + port) from a URL string, or null on parse failure. */
export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Returns the host for a Sentry DSN (`ingest.sentry.io` style). */
function sentryOrigin(dsn: string | undefined): string | null {
  const origin = originOf(dsn);
  if (!origin) return null;
  // Sentry uses https://o<org>.ingest.sentry.io — we want the whole origin.
  return origin;
}

/**
 * Builds the CSP header value for a single request.
 *
 * Production: strict-dynamic + nonce, no unsafe-inline/unsafe-eval in script-src.
 * Development: adds unsafe-inline + unsafe-eval so Next.js dev overlay works.
 */
export function buildCsp(opts: CspOptions): string {
  const { nonce } = opts;
  const env: CspEnv = { ...readEnv(), ...opts.env };
  const isDev = env.NODE_ENV === 'development';

  const soroban =
    originOf(env.NEXT_PUBLIC_SOROBAN_RPC) ??
    'https://soroban-testnet.stellar.org';
  const horizon =
    originOf(env.NEXT_PUBLIC_HORIZON_URL) ??
    'https://horizon-testnet.stellar.org';
  const api = originOf(env.NEXT_PUBLIC_API_URL) ?? '';
  const indexer = originOf(env.NEXT_PUBLIC_INDEXER_API_URL) ?? '';
  const ipfsGateway =
    originOf(env.NEXT_PUBLIC_IPFS_GATEWAY) ?? 'https://gateway.pinata.cloud';
  const sentry = sentryOrigin(env.SENTRY_DSN) ?? '';

  // All known IPFS gateways used by lib/ipfs.ts (primary + fallbacks).
  const ipfsSrcs = [
    ipfsGateway,
    'https://gateway.pinata.cloud',
    'https://ipfs.io',
    'https://cloudflare-ipfs.com',
    'https://dweb.link',
  ]
    .filter(Boolean)
    // deduplicate
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(' ');

  // connect-src: self + Stellar RPC + backend + indexer + CoinGecko + Sentry + Vercel Analytics
  const connectSrcs = [
    "'self'",
    soroban,
    horizon,
    api,
    indexer,
    'https://api.coingecko.com',
    sentry,
    'https://vitals.vercel-insights.com',
    // Sentry envelope endpoint (used by newer Sentry SDK)
    'https://*.ingest.sentry.io',
  ]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(' ');

  const scriptSrc = isDev
    ? `script-src 'self' 'nonce-${nonce}' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic'`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;

  const directives: string[] = [
    "default-src 'self'",
    scriptSrc,
    `img-src 'self' data: ${ipfsSrcs} https://scoutoff.app`,
    `connect-src ${connectSrcs}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Turnstile renders an iframe from challenges.cloudflare.com
    'frame-src https://challenges.cloudflare.com',
    // PWA service worker
    "worker-src 'self'",
    'report-uri /api/csp-report',
    'report-to csp-endpoint',
  ];

  return directives.join('; ');
}
