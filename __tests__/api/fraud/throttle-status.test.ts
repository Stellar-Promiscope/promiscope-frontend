/** @jest-environment node */
jest.mock('@/lib/featureFlags', () => ({
  isFeatureEnabled: jest.fn(),
}));

import { GET } from '@/app/api/fraud/throttle-status/route';
import { NextRequest } from 'next/server';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { FraudThrottleStore } from '@/lib/fraudThrottleStore';

const WALLET = 'GTHROTTLED00000000000000000000000000000000000000000000';
const OTHER = 'GCLEAN000000000000000000000000000000000000000000000000';

const mockIsFeatureEnabled = isFeatureEnabled as jest.Mock;

function makeRequest(wallet?: string): NextRequest {
  const url = new URL('http://localhost/api/fraud/throttle-status');
  if (wallet !== undefined) url.searchParams.set('wallet', wallet);
  return new NextRequest(url);
}

function throttle(wallet: string) {
  return FraudThrottleStore.getInstance().placeThrottle({
    wallet,
    heuristic: 'referral_ring',
    category: 'referral',
    flagId: 'flag-1',
    reason: 'secret heuristic reason',
    evidence: { linkedWallets: ['GSECRET'] },
  });
}

beforeEach(() => {
  FraudThrottleStore.resetInstance();
  mockIsFeatureEnabled.mockReset();
  mockIsFeatureEnabled.mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
  FraudThrottleStore.resetInstance();
});

describe('GET /api/fraud/throttle-status', () => {
  it('returns 400 when wallet is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'wallet is required' });
  });

  it('returns 400 when wallet is empty', async () => {
    const res = await GET(makeRequest(''));
    expect(res.status).toBe(400);
  });

  it('always returns { throttled: false } without touching the store when the flag is off', async () => {
    throttle(WALLET);
    mockIsFeatureEnabled.mockReturnValue(false);
    const getInstance = jest.spyOn(FraudThrottleStore, 'getInstance');

    const res = await GET(makeRequest(WALLET));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ throttled: false });
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('FRAUD_AUTO_THROTTLE');
    expect(getInstance).not.toHaveBeenCalled();
  });

  it('returns { throttled: true } when the flag is on and the wallet has an active throttle', async () => {
    throttle(WALLET);
    const res = await GET(makeRequest(WALLET));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ throttled: true });
  });

  it('returns { throttled: false } when the flag is on and the wallet has no throttle', async () => {
    throttle(OTHER);
    const res = await GET(makeRequest(WALLET));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ throttled: false });
  });

  it('returns { throttled: false } once the throttle has been lifted', async () => {
    const placed = throttle(WALLET);
    FraudThrottleStore.getInstance().liftThrottle(placed.id, 'GADMIN', 'ok');
    const res = await GET(makeRequest(WALLET));
    expect(await res.json()).toEqual({ throttled: false });
  });

  it('never exposes heuristic evidence in the response', async () => {
    throttle(WALLET);
    const res = await GET(makeRequest(WALLET));
    const body = await res.json();
    expect(Object.keys(body)).toEqual(['throttled']);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('referral_ring');
    expect(raw).not.toContain('secret heuristic reason');
    expect(raw).not.toContain('GSECRET');
  });
});
