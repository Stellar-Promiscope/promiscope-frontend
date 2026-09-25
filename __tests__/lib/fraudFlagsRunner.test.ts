/**
 * @jest-environment node
 */
import {
  runFraudFlagEvaluation,
  runIncrementalFraudFlagEvaluation,
} from '@/lib/fraudFlagsRunner';
import { FraudThrottleStore } from '@/lib/fraudThrottleStore';
import { FraudFlagsStore } from '@/lib/fraudFlagsStore';
import { clearFeatureFlagCache } from '@/lib/featureFlags';
import type { ReferralCode } from '@/types';

jest.mock('@/lib/api', () => ({
  fetchAllReferralCodes: jest.fn(),
  fetchActivityEvents: jest.fn(),
}));

import { fetchAllReferralCodes, fetchActivityEvents } from '@/lib/api';

const mockedFetchAllReferralCodes = fetchAllReferralCodes as jest.Mock;
const mockedFetchActivityEvents = fetchActivityEvents as jest.Mock;

/** A redeemer wallet that redeemed codes from 8 distinct scouts — crosses
 * RING_MIN_DISTINCT_SCOUTS * 2, so cross_scout_redeemer_ring reaches 'high'. */
function ringCodes(redeemer: string, scoutCount: number): ReferralCode[] {
  return Array.from({ length: scoutCount }, (_, i) => ({
    code: `CODE-${i}`,
    scoutWallet: `GSCOUT${i}`,
    createdAt: 0,
    usedBy: redeemer,
    usedAt: 1,
  }));
}

describe('runFraudFlagEvaluation — auto-throttle (issue #1174)', () => {
  const originalEnv = process.env.NEXT_PUBLIC_FEATURE_FRAUD_AUTO_THROTTLE;

  beforeEach(() => {
    FraudThrottleStore.resetInstance();
    clearFeatureFlagCache();
    mockedFetchAllReferralCodes.mockResolvedValue(ringCodes('GRING', 8));
    mockedFetchActivityEvents.mockResolvedValue({ events: [], total: 0 });
  });

  afterEach(() => {
    FraudThrottleStore.resetInstance();
    process.env.NEXT_PUBLIC_FEATURE_FRAUD_AUTO_THROTTLE = originalEnv;
    clearFeatureFlagCache();
  });

  it('does not throttle anything when the feature flag is off', async () => {
    process.env.NEXT_PUBLIC_FEATURE_FRAUD_AUTO_THROTTLE = '0';
    clearFeatureFlagCache();

    const { flags } = await runFraudFlagEvaluation();
    expect(flags.some((f) => f.heuristic === 'cross_scout_redeemer_ring')).toBe(
      true,
    );
    expect(FraudThrottleStore.getInstance().listAll()).toHaveLength(0);
  });

  it('throttles the redeemer wallet for a high-severity cross_scout_redeemer_ring flag when enabled', async () => {
    process.env.NEXT_PUBLIC_FEATURE_FRAUD_AUTO_THROTTLE = '1';
    clearFeatureFlagCache();

    await runFraudFlagEvaluation();

    const active = FraudThrottleStore.getInstance().getActiveThrottle('GRING');
    expect(active).not.toBeNull();
    expect(active?.heuristic).toBe('cross_scout_redeemer_ring');
    expect(active?.status).toBe('throttled');
    expect(active?.liftedAt).toBeNull();
  });

  it('never throttles subscription_cycling, even at high confidence', async () => {
    process.env.NEXT_PUBLIC_FEATURE_FRAUD_AUTO_THROTTLE = '1';
    clearFeatureFlagCache();
    mockedFetchAllReferralCodes.mockResolvedValue([]);
    mockedFetchActivityEvents.mockResolvedValue({
      total: 10,
      events: [
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `sub-${i}`,
          type: 'scout_subscribed' as const,
          actor: 'GCYCLER',
          timestamp: i * 1000,
        })),
        {
          id: 'contact-1',
          type: 'player_contacted' as const,
          actor: 'GCYCLER',
          timestamp: 1,
        },
      ],
    });

    const { flags } = await runFraudFlagEvaluation();
    expect(flags.some((f) => f.heuristic === 'subscription_cycling')).toBe(
      true,
    );
    expect(FraudThrottleStore.getInstance().listAll()).toHaveLength(0);
  });
});

describe('runIncrementalFraudFlagEvaluation', () => {
  beforeEach(() => {
    FraudThrottleStore.resetInstance();
    FraudFlagsStore.resetInstance();
    mockedFetchAllReferralCodes.mockResolvedValue([]);
    mockedFetchActivityEvents.mockResolvedValue({ events: [], total: 0 });
  });

  afterEach(() => {
    FraudThrottleStore.resetInstance();
    FraudFlagsStore.resetInstance();
  });

  it('records checkpoint and per-wallet aggregates after incremental evaluation', async () => {
    mockedFetchActivityEvents.mockResolvedValue({
      total: 10,
      events: Array.from({ length: 8 }, (_, i) => ({
        id: `contact-${i}`,
        type: 'player_contacted' as const,
        actor: 'GBURST',
        timestamp: 1_700_000_000 + i * 10,
        ledger: 100 + i,
      })),
    });

    const result = await runIncrementalFraudFlagEvaluation({
      timeBudgetMs: 10_000,
    });

    expect(result.eventsProcessed).toBe(8);
    expect(result.flags.some((f) => f.heuristic === 'rapid_contact_burst')).toBe(
      true,
    );

    const store = FraudFlagsStore.getInstance();
    const checkpoint = store.getCheckpoint();
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.lastLedger).toBe(107);

    const agg = store.getWalletAggregate('GBURST');
    expect(agg).not.toBeNull();
    expect(agg?.payToContact.contactTimestamps).toHaveLength(8);

    const activeFlags = store.getActiveFlags();
    expect(activeFlags.some((f) => f.heuristic === 'rapid_contact_burst')).toBe(
      true,
    );
  });

  it('halts and saves progress when time budget is nearly exhausted', async () => {
    mockedFetchActivityEvents.mockResolvedValue({
      total: 2,
      events: [
        {
          id: 'c-1',
          type: 'player_contacted' as const,
          actor: 'G1',
          timestamp: 1_000,
          ledger: 10,
        },
      ],
    });

    const result = await runIncrementalFraudFlagEvaluation({
      timeBudgetMs: 0, // forces immediate budget hit
      safetyMarginMs: 0,
    });

    expect(result.hitTimeBudget).toBe(true);
  });
});

