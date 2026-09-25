/**
 * Server-side XLM exchange-rate lookup backing /api/rates/xlm. Browsers call
 * our route instead of CoinGecko directly, so the upstream rate limit is hit
 * once per server per minute rather than once per visitor IP.
 */

import { SUPPORTED_CURRENCIES } from './currencies';

export type RateSource = 'coingecko' | 'stellar-dex';

export interface XlmRateResponse {
  rate: number;
  /** ISO timestamp of when the rate was fetched upstream. */
  updatedAt: string;
  /** True when serving the last known value because every upstream failed. */
  stale: boolean;
  source: RateSource;
}

export const RATE_CACHE_TTL_MS = 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 3000;

const SUPPORTED_VS = new Set<string>(
  SUPPORTED_CURRENCIES.map((c) => c.code.toLowerCase()),
);

export function isSupportedVsCurrency(vs: string): boolean {
  return SUPPORTED_VS.has(vs);
}

interface CacheEntry {
  rate: number;
  fetchedAt: number;
  source: RateSource;
}

const cache = new Map<string, CacheEntry>();

/** Test hook: clear the module-level cache. */
export function resetXlmRateCache(): void {
  cache.clear();
}

async function fetchJson(url: string, headers?: HeadersInit): Promise<unknown> {
  const res = await fetch(url, {
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Upstream returned ${res.status}`);
  return res.json();
}

async function fetchFromCoinGecko(vs: string): Promise<number> {
  const key = process.env.COINGECKO_API_KEY;
  const pro = process.env.COINGECKO_API_PLAN === 'pro';
  const base = pro
    ? 'https://pro-api.coingecko.com/api/v3'
    : 'https://api.coingecko.com/api/v3';
  const headers: Record<string, string> = {};
  if (key) headers[pro ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key'] = key;

  const data = (await fetchJson(
    `${base}/simple/price?ids=stellar&vs_currencies=${encodeURIComponent(vs)}`,
    headers,
  )) as { stellar?: Record<string, number> };
  const rate = data.stellar?.[vs];
  if (typeof rate !== 'number' || !(rate > 0)) {
    throw new Error('Invalid CoinGecko rate');
  }
  return rate;
}

// Circle's USDC on Stellar mainnet. Price data always comes from the public
// network regardless of NEXT_PUBLIC_NETWORK, since testnet order books are
// not meaningful.
const USDC_ISSUER =
  process.env.STELLAR_USDC_ISSUER ??
  'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const PRICE_HORIZON_URL =
  process.env.STELLAR_PRICE_HORIZON_URL ?? 'https://horizon.stellar.org';

/** XLM/USDC mid-price from the Stellar DEX order book (USD only). */
async function fetchFromStellarDex(): Promise<number> {
  const params = new URLSearchParams({
    selling_asset_type: 'native',
    buying_asset_type: 'credit_alphanum4',
    buying_asset_code: 'USDC',
    buying_asset_issuer: USDC_ISSUER,
    limit: '1',
  });
  const book = (await fetchJson(
    `${PRICE_HORIZON_URL}/order_book?${params}`,
  )) as { bids?: { price: string }[]; asks?: { price: string }[] };
  const bid = Number(book.bids?.[0]?.price);
  const ask = Number(book.asks?.[0]?.price);
  if (!(bid > 0) || !(ask > 0)) throw new Error('Empty order book');
  return (bid + ask) / 2;
}

/**
 * Returns the XLM rate for `vs` (lowercase ISO code), serving from a 60 s
 * in-memory cache, falling back to the Stellar DEX (USD only) and then to
 * the last known value marked `stale`. Throws only when nothing is known.
 */
export async function getXlmRate(
  vs: string,
  now: number = Date.now(),
): Promise<XlmRateResponse> {
  const cached = cache.get(vs);
  if (cached && now - cached.fetchedAt < RATE_CACHE_TTL_MS) {
    return toResponse(cached, false);
  }

  const providers: [RateSource, () => Promise<number>][] = [
    ['coingecko', () => fetchFromCoinGecko(vs)],
  ];
  if (vs === 'usd') providers.push(['stellar-dex', fetchFromStellarDex]);

  for (const [source, fetchRate] of providers) {
    try {
      const entry = { rate: await fetchRate(), fetchedAt: now, source };
      cache.set(vs, entry);
      return toResponse(entry, false);
    } catch {
      // Try the next provider.
    }
  }

  if (cached) return toResponse(cached, true);
  throw new Error('XLM rate unavailable');
}

function toResponse(entry: CacheEntry, stale: boolean): XlmRateResponse {
  return {
    rate: entry.rate,
    updatedAt: new Date(entry.fetchedAt).toISOString(),
    stale,
    source: entry.source,
  };
}
