/** @jest-environment node */
import { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { GET } from '@/app/api/fraud/throttle-status/route';
import { FraudThrottleStore } from '@/lib/fraudThrottleStore';
import { checkRateLimit } from '@/lib/rateLimit';

jest.mock('@/lib/featureFlags', () => ({
  isFeatureEnabled: jest.fn(() => true),
}));

jest.mock('@/lib/rateLimit', () => ({
  ...jest.requireActual('@/lib/rateLimit'),
  checkRateLimit: jest.fn(async () => ({ limited: false })),
}));

const WALLET = Keypair.random().publicKey();

function get(wallet: string) {
  return GET(
    new NextRequest(
      `http://localhost/api/fraud/throttle-status?wallet=${encodeURIComponent(wallet)}`,
    ),
  );
}

describe('GET /api/fraud/throttle-status', () => {
  beforeEach(() => {
    FraudThrottleStore.resetInstance();
    (checkRateLimit as jest.Mock).mockResolvedValue({ limited: false });
  });

  afterAll(() => FraudThrottleStore.resetInstance());

  it('returns 400 for an invalid wallet address', async () => {
    const res = await get('not-a-wallet');
    expect(res.status).toBe(400);
  });

  it('matches a throttled wallet case- and whitespace-insensitively', async () => {
    FraudThrottleStore.getInstance().placeThrottle({
      wallet: WALLET,
      heuristic: 'test',
      category: 'test',
      flagId: 'flag-1',
      reason: 'test',
      evidence: {},
    });

    const res = await get(`  ${WALLET.toLowerCase()} `);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ throttled: true });
  });

  it('returns throttled: false for a valid, unthrottled wallet', async () => {
    const res = await get(Keypair.random().publicKey());
    expect(await res.json()).toEqual({ throttled: false });
  });

  it('returns 429 when rate-limited', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue({
      limited: true,
      retryAfterSec: 30,
    });
    const res = await get(WALLET);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
  });
});
