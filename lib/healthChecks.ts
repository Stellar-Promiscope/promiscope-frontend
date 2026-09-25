/**
 * Per-dependency checks for the aggregate admin health endpoint
 * (app/api/admin/health/route.ts). Each check runs with its own timeout and
 * never throws, so one failing dependency cannot affect the others. Error
 * messages are scrubbed of configured secrets before being returned.
 */

import { Redis } from '@upstash/redis';
import type Database from 'better-sqlite3';
import { openSqliteDb } from './sqliteDb';

export type DependencyStatus =
  | 'ok'
  | 'degraded'
  | 'unreachable'
  | 'not_configured';

export interface DependencyCheck {
  status: DependencyStatus;
  latencyMs: number;
  detail?: Record<string, unknown>;
  error?: string;
  /** What an operator should do when the check is not ok. */
  hint?: string;
}

export const CHECK_TIMEOUT_MS = 5000;
const PINATA_CACHE_TTL_MS = 5 * 60 * 1000;

const SECRET_ENV_VARS = [
  'UPSTASH_REDIS_REST_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'PINATA_API_KEY',
  'PINATA_SECRET',
  'SESSION_SECRET',
];

export function redactSecrets(message: string): string {
  let out = message;
  for (const name of SECRET_ENV_VARS) {
    const value = process.env[name];
    if (value && value.length >= 4) out = out.split(value).join('[redacted]');
  }
  return out;
}

type CheckResult = Omit<DependencyCheck, 'latencyMs'>;

/**
 * Runs `fn` with a timeout, timing it and converting any rejection into an
 * `unreachable` result carrying `hint`.
 */
export async function runCheck(
  fn: () => Promise<CheckResult>,
  hint: string,
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<DependencyCheck> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Check timed out')),
          timeoutMs,
        );
      }),
    ]);
    return {
      ...result,
      ...(result.status !== 'ok' && !result.hint ? { hint } : {}),
      ...(result.error ? { error: redactSecrets(result.error) } : {}),
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      status: 'unreachable',
      error: redactSecrets(err instanceof Error ? err.message : 'Check failed'),
      hint,
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

function notConfigured(what: string): CheckResult {
  // Missing config is expected in local dev, but a real problem in prod.
  return process.env.NODE_ENV === 'production'
    ? { status: 'degraded', error: `${what} not configured` }
    : { status: 'not_configured' };
}

// ── Redis ────────────────────────────────────────────────────────────────────

export async function checkRedis(): Promise<CheckResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return notConfigured('Upstash Redis');

  const pong = await new Redis({ url, token }).ping();
  return pong === 'PONG'
    ? { status: 'ok' }
    : { status: 'degraded', error: 'Unexpected PING reply' };
}

// ── Pinata ───────────────────────────────────────────────────────────────────

let pinataCache: { result: CheckResult; checkedAt: number } | null = null;

export function resetHealthCheckCaches(): void {
  pinataCache = null;
  sqliteDb = null;
}

export async function checkPinata(): Promise<CheckResult> {
  const apiKey = process.env.PINATA_API_KEY;
  const apiSecret = process.env.PINATA_SECRET;
  if (!apiKey || !apiSecret) return notConfigured('Pinata credentials');

  if (pinataCache && Date.now() - pinataCache.checkedAt < PINATA_CACHE_TTL_MS) {
    return { ...pinataCache.result, detail: { cached: true } };
  }

  const res = await fetch('https://api.pinata.cloud/data/testAuthentication', {
    headers: { pinata_api_key: apiKey, pinata_secret_api_key: apiSecret },
    cache: 'no-store',
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  const result: CheckResult = res.ok
    ? { status: 'ok' }
    : {
        status:
          res.status === 401 || res.status === 403 ? 'degraded' : 'unreachable',
        error: `Pinata returned HTTP ${res.status}`,
      };
  pinataCache = { result, checkedAt: Date.now() };
  return result;
}

// ── Session store / SQLite ───────────────────────────────────────────────────

let sqliteDb: Database.Database | null = null;

export async function checkSessionStore(): Promise<CheckResult> {
  if (!process.env.SESSION_SECRET) {
    return { status: 'degraded', error: 'SESSION_SECRET not configured' };
  }

  sqliteDb ??= openSqliteDb('health-check.db', 'HEALTH_CHECK_DB_PATH');
  sqliteDb.prepare('SELECT 1').get();
  // A write catches read-only filesystems, which a SELECT alone would not.
  sqliteDb.exec(
    'CREATE TABLE IF NOT EXISTS health_probe (id INTEGER PRIMARY KEY, checked_at INTEGER NOT NULL)',
  );
  sqliteDb
    .prepare(
      'INSERT OR REPLACE INTO health_probe (id, checked_at) VALUES (1, ?)',
    )
    .run(Date.now());
  return { status: 'ok', detail: { writable: true } };
}

// ── Soroban RPC ──────────────────────────────────────────────────────────────

export async function checkSorobanRpc(): Promise<CheckResult> {
  const { rpc, NETWORK } = await import('./stellar');
  const [ledger, network] = await Promise.all([
    rpc.getLatestLedger(),
    rpc.getNetwork(),
  ]);
  const detail = { latestLedger: ledger.sequence };
  if (network.passphrase !== NETWORK) {
    return {
      status: 'degraded',
      detail,
      error: 'RPC network passphrase does not match NEXT_PUBLIC_NETWORK',
    };
  }
  return { status: 'ok', detail };
}

// ── Contract ─────────────────────────────────────────────────────────────────

export async function checkContract(): Promise<CheckResult> {
  const { checkContractCompatibility } = await import('./contract');
  const result = await checkContractCompatibility();
  const detail = {
    compatibility: result.status,
    deployedVersion: result.deployedVersion,
    expectedVersion: result.expectedVersion,
  };
  return result.status === 'incompatible'
    ? { status: 'degraded', detail, error: result.message ?? undefined }
    : { status: 'ok', detail };
}

export const DEPENDENCY_HINTS: Record<string, string> = {
  redis:
    'Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN; rate limiting and chunked uploads fall back to per-instance memory without them.',
  pinata:
    'Check PINATA_API_KEY and PINATA_SECRET; uploads fail at the pinning step when they are wrong.',
  sessionStore:
    'Set SESSION_SECRET and make sure the data directory (or *_DB_PATH) is on a writable volume.',
  sorobanRpc:
    'Check NEXT_PUBLIC_SOROBAN_RPC is reachable and serves the network named by NEXT_PUBLIC_NETWORK.',
  contract:
    'The deployed contract version does not match this frontend; deploy a matching frontend or contract.',
};

export async function runDependencyChecks(): Promise<
  Record<string, DependencyCheck>
> {
  const checks: [string, () => Promise<CheckResult>][] = [
    ['redis', checkRedis],
    ['pinata', checkPinata],
    ['sessionStore', checkSessionStore],
    ['sorobanRpc', checkSorobanRpc],
    ['contract', checkContract],
  ];
  const results = await Promise.all(
    checks.map(([name, fn]) => runCheck(fn, DEPENDENCY_HINTS[name])),
  );
  return Object.fromEntries(checks.map(([name], i) => [name, results[i]]));
}
