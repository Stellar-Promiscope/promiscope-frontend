import axios, { type AxiosInstance, type CreateAxiosDefaults } from 'axios';

/**
 * The only place allowed to call `axios.create` (enforced by
 * __tests__/lib/httpClient.test.ts). Every outbound client must declare a
 * timeout so a stalled dependency fails fast instead of holding a serverless
 * function until the platform kills it (issue #1353).
 */

/** Backend API reads. */
export const BACKEND_READ_TIMEOUT_MS = 5_000;
/** Backend API writes (anything other than GET/HEAD). */
export const BACKEND_WRITE_TIMEOUT_MS = 10_000;
/** Typeahead proxies — fail fast. */
export const SEARCH_TIMEOUT_MS = 3_000;

const PIN_BASE_TIMEOUT_MS = 30_000;
const PIN_PER_MB_MS = 1_000;
// Stay below the 60 s function limit so the route can still answer with 504.
const PIN_MAX_TIMEOUT_MS = 55_000;

/** Pinata pinning timeout: ~30 s + 1 s per MB, capped below the function limit. */
export function pinTimeoutMs(bytes: number): number {
  const mb = Math.ceil(Math.max(0, bytes) / (1024 * 1024));
  return Math.min(PIN_BASE_TIMEOUT_MS + mb * PIN_PER_MB_MS, PIN_MAX_TIMEOUT_MS);
}

export interface CreateClientOptions extends Omit<
  CreateAxiosDefaults,
  'timeout'
> {
  timeoutMs: number;
  /** Timeout for non-GET/HEAD requests; defaults to `timeoutMs`. */
  writeTimeoutMs?: number;
}

function newRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createClient(
  name: string,
  { timeoutMs, writeTimeoutMs, ...config }: CreateClientOptions,
): AxiosInstance {
  const instance = axios.create({ ...config, timeout: timeoutMs });
  // Optional chaining: jest's axios mocks return bare instances.
  instance?.interceptors?.request.use((req) => {
    const method = (req.method ?? 'get').toLowerCase();
    if (writeTimeoutMs && method !== 'get' && method !== 'head') {
      if (req.timeout === timeoutMs) req.timeout = writeTimeoutMs;
    }
    if (!req.headers.has?.('x-request-id')) {
      req.headers.set?.('x-request-id', `${name}-${newRequestId()}`);
    }
    return req;
  });
  return instance;
}

/** True when an axios/network error is a timeout. */
export function isTimeoutError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'ECONNABORTED' || code === 'ETIMEDOUT';
}

/** Maps an outbound failure to an HTTP status: 504 on timeout, else the upstream status or `fallback`. */
export function upstreamStatus(err: unknown, fallback = 502): number {
  if (isTimeoutError(err)) return 504;
  return (
    (err as { response?: { status?: number } } | null)?.response?.status ??
    fallback
  );
}
