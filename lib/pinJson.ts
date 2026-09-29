/**
 * pinJson — Pin a JSON metadata object to IPFS via Pinata, with an
 * in-memory deduplication cache.
 *
 * Hashing the metadata object before every Pinata call lets us detect
 * duplicate submissions (e.g. a client retrying after a network timeout
 * when the server already completed the pin) and return the cached CID
 * immediately without making a second Pinata API call.
 *
 * ## Cache design
 *
 * - Key:   SHA-256 hex digest of the deterministically serialised metadata
 * - Value: `{ cid: string, pinnedAt: number }` (pinnedAt is Unix-ms)
 * - TTL:   configurable via `PINJSON_CACHE_TTL_MS` env var; default 5 minutes
 * - Scope: module-level singleton, shared across all API route invocations
 *          in the same Node.js process
 *
 * In a multi-instance deployment you would back this with Redis or a shared
 * DB; the public interface (`pinJson`, `clearPinJsonCache`) is intentionally
 * narrow so that swap is straightforward.
 */

import crypto from 'crypto';
import axios from 'axios';
import { pinTimeoutMs } from './httpClient';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PinJsonOptions {
  /** Pinata-compatible metadata name tag (optional). */
  name?: string;
}

interface CacheEntry {
  cid: string;
  pinnedAt: number; // Date.now() ms
}

// ── Configurable TTL ─────────────────────────────────────────────────────────

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Returns the effective cache TTL in milliseconds.
 * Override with the `PINJSON_CACHE_TTL_MS` environment variable.
 */
export function getCacheTtlMs(): number {
  const raw = process.env.PINJSON_CACHE_TTL_MS;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_CACHE_TTL_MS;
}

// ── Internal cache ───────────────────────────────────────────────────────────

const cache = new Map<string, CacheEntry>();

/**
 * Compute a deterministic SHA-256 hex digest for an arbitrary JSON-
 * serialisable object. Keys are sorted so `{ b: 1, a: 2 }` and
 * `{ a: 2, b: 1 }` produce the same hash.
 */
export function hashMetadata(metadata: unknown): string {
  const canonical = JSON.stringify(
    metadata,
    Object.keys(metadata as object).sort(),
  );
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Pin a JSON metadata object to IPFS via Pinata.
 *
 * Identical metadata submitted within the TTL window is deduplicated: the
 * function returns the cached CID without making a second Pinata API call.
 * Different metadata (or the same metadata submitted after TTL expiry)
 * always triggers a fresh pin.
 *
 * @param metadata - Any JSON-serialisable object.
 * @param options  - Optional Pinata name tag.
 * @returns The IPFS CID string assigned by Pinata.
 * @throws When Pinata is unreachable or returns an unexpected response.
 */
export async function pinJson(
  metadata: unknown,
  options: PinJsonOptions = {},
): Promise<string> {
  const hash = hashMetadata(metadata);
  const ttl = getCacheTtlMs();
  const now = Date.now();

  // Cache hit within TTL
  const entry = cache.get(hash);
  if (entry && now - entry.pinnedAt < ttl) {
    return entry.cid;
  }

  // Cache miss (or TTL expired) — pin via Pinata
  const { data } = await axios.post(
    'https://api.pinata.cloud/pinning/pinJSONToIPFS',
    {
      pinataContent: metadata,
      ...(options.name ? { pinataMetadata: { name: options.name } } : {}),
    },
    {
      headers: {
        pinata_api_key: process.env.PINATA_API_KEY!,
        pinata_secret_api_key: process.env.PINATA_SECRET!,
        'Content-Type': 'application/json',
      },
      timeout: pinTimeoutMs(0),
    },
  );

  const cid = data.IpfsHash as string;

  // Populate cache with fresh entry
  cache.set(hash, { cid, pinnedAt: now });

  return cid;
}

/**
 * Remove all entries from the in-memory cache.
 * Intended for use in tests only.
 */
export function clearPinJsonCache(): void {
  cache.clear();
}

/**
 * Returns the current number of entries in the cache.
 * Intended for diagnostics and tests.
 */
export function getPinJsonCacheSize(): number {
  return cache.size;
}
