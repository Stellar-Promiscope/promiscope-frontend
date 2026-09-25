/** @jest-environment node */
import {
  checkContract,
  checkPinata,
  checkRedis,
  checkSessionStore,
  checkSorobanRpc,
  redactSecrets,
  resetHealthCheckCaches,
  runCheck,
  runDependencyChecks,
} from '@/lib/healthChecks';

const mockPing = jest.fn();
jest.mock('@upstash/redis', () => ({
  Redis: jest.fn().mockImplementation(() => ({ ping: mockPing })),
}));

const mockGetLatestLedger = jest.fn();
const mockGetNetwork = jest.fn();
jest.mock('@/lib/stellar', () => ({
  NETWORK: 'Test SDF Network ; September 2015',
  rpc: {
    getLatestLedger: (...a: unknown[]) => mockGetLatestLedger(...a),
    getNetwork: (...a: unknown[]) => mockGetNetwork(...a),
  },
}));

const mockCompat = jest.fn();
jest.mock('@/lib/contract', () => ({
  checkContractCompatibility: (...a: unknown[]) => mockCompat(...a),
}));

const originalFetch = global.fetch;
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  resetHealthCheckCaches();
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = ORIGINAL_ENV;
});

describe('runCheck', () => {
  it('times out a hanging check without throwing', async () => {
    const result = await runCheck(() => new Promise(() => {}), 'hint', 10);
    expect(result).toMatchObject({
      status: 'unreachable',
      error: 'Check timed out',
      hint: 'hint',
    });
    expect(typeof result.latencyMs).toBe('number');
  });

  it('keeps secrets out of error messages', async () => {
    process.env.PINATA_SECRET = 'super-secret-value';
    expect(redactSecrets('bad key super-secret-value')).toBe(
      'bad key [redacted]',
    );
  });
});

describe('checkRedis', () => {
  it('reports not_configured without Upstash env', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    expect(await checkRedis()).toEqual({ status: 'not_configured' });
  });

  it('is ok on PONG and fails when PING rejects', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
    mockPing.mockResolvedValueOnce('PONG');
    expect((await checkRedis()).status).toBe('ok');
    mockPing.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect((await runCheck(checkRedis, 'h')).status).toBe('unreachable');
  });
});

describe('checkPinata', () => {
  beforeEach(() => {
    process.env.PINATA_API_KEY = 'key';
    process.env.PINATA_SECRET = 'secret';
  });

  it('is ok when authentication succeeds and caches the result', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('{}'));
    expect((await checkPinata()).status).toBe('ok');
    await checkPinata();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('is degraded when the keys are rejected', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response('{}', { status: 401 }));
    expect(await checkPinata()).toMatchObject({
      status: 'degraded',
      error: 'Pinata returned HTTP 401',
    });
  });
});

describe('checkSessionStore', () => {
  it('runs SELECT 1 and a write against SQLite', async () => {
    process.env.SESSION_SECRET = 'x'.repeat(32);
    expect(await checkSessionStore()).toEqual({
      status: 'ok',
      detail: { writable: true },
    });
  });

  it('is degraded without SESSION_SECRET', async () => {
    delete process.env.SESSION_SECRET;
    expect((await checkSessionStore()).status).toBe('degraded');
  });
});

describe('checkSorobanRpc', () => {
  it('is ok when the passphrase matches', async () => {
    mockGetLatestLedger.mockResolvedValue({ sequence: 123 });
    mockGetNetwork.mockResolvedValue({
      passphrase: 'Test SDF Network ; September 2015',
    });
    expect(await checkSorobanRpc()).toEqual({
      status: 'ok',
      detail: { latestLedger: 123 },
    });
  });

  it('is degraded on a network mismatch', async () => {
    mockGetLatestLedger.mockResolvedValue({ sequence: 1 });
    mockGetNetwork.mockResolvedValue({ passphrase: 'Public Global' });
    expect((await checkSorobanRpc()).status).toBe('degraded');
  });
});

describe('checkContract', () => {
  it('maps compatibility status', async () => {
    mockCompat.mockResolvedValueOnce({
      status: 'compatible',
      deployedVersion: 2,
      expectedVersion: 2,
      message: null,
    });
    expect((await checkContract()).status).toBe('ok');
    mockCompat.mockResolvedValueOnce({
      status: 'incompatible',
      deployedVersion: 1,
      expectedVersion: 2,
      message: 'Mismatch',
    });
    expect(await checkContract()).toMatchObject({
      status: 'degraded',
      error: 'Mismatch',
    });
  });
});

describe('runDependencyChecks', () => {
  it('isolates failures between dependencies', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.PINATA_API_KEY;
    process.env.SESSION_SECRET = 'x'.repeat(32);
    mockGetLatestLedger.mockRejectedValue(new Error('RPC down'));
    mockGetNetwork.mockRejectedValue(new Error('RPC down'));
    mockCompat.mockResolvedValue({
      status: 'unknown',
      deployedVersion: null,
      expectedVersion: 2,
      message: null,
    });

    const checks = await runDependencyChecks();
    expect(checks.redis.status).toBe('not_configured');
    expect(checks.pinata.status).toBe('not_configured');
    expect(checks.sessionStore.status).toBe('ok');
    expect(checks.sorobanRpc).toMatchObject({
      status: 'unreachable',
      error: 'RPC down',
    });
    expect(checks.sorobanRpc.hint).toBeTruthy();
    expect(checks.contract.status).toBe('ok');
  });
});
