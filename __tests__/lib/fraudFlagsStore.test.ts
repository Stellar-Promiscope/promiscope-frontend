/**
 * @jest-environment node
 */
import { FraudFlagsStore } from '@/lib/fraudFlagsStore';
import type { FraudFlag } from '@/types';

function flag(severity: FraudFlag['severity'], id: string): FraudFlag {
  return {
    id,
    category: 'referral',
    heuristic: 'test',
    severity,
    wallets: ['GSOMEONE'],
    reason: 'test reason',
    evidence: {},
  };
}

let store: FraudFlagsStore;

beforeEach(() => {
  FraudFlagsStore.resetInstance();
  store = FraudFlagsStore.getInstance();
});

afterEach(() => {
  FraudFlagsStore.resetInstance();
});

describe('FraudFlagsStore', () => {
  it('is a singleton', () => {
    expect(FraudFlagsStore.getInstance()).toBe(store);
  });

  it('returns null when no run has been recorded yet', () => {
    expect(store.getLatestRun()).toBeNull();
  });

  it('persists a run and returns it as the latest', () => {
    const flags = [flag('high', 'a'), flag('low', 'b')];
    const run = store.recordRun('manual', flags, ['warn'], 1_700_000_000);

    expect(run.trigger).toBe('manual');
    expect(run.highSeverityCount).toBe(1);
    expect(run.flags).toEqual(flags);
    expect(run.warnings).toEqual(['warn']);

    const latest = store.getLatestRun();
    expect(latest).toEqual(run);
  });

  it('getLatestRun returns the most recently evaluated run, not just the last inserted id', () => {
    store.recordRun('cron', [], [], 1_000);
    const newer = store.recordRun('manual', [flag('high', 'x')], [], 2_000);

    const latest = store.getLatestRun();
    expect(latest?.evaluatedAt).toBe(2_000);
    expect(latest?.trigger).toBe('manual');
    expect(latest?.id).toBe(newer.id);
  });

  it('records and returns run stats (eventsProcessed and durationMs)', () => {
    store.recordRun('cron', [], [], 1_000, 150, 420);
    const latest = store.getLatestRun();
    expect(latest?.eventsProcessed).toBe(150);
    expect(latest?.durationMs).toBe(420);
  });

  describe('checkpoint persistence', () => {
    it('returns null when no checkpoint is saved', () => {
      expect(store.getCheckpoint()).toBeNull();
    });

    it('saves and reads back the checkpoint', () => {
      store.saveCheckpoint(1050, 'event-1050', 1_700_000_100);
      const cp = store.getCheckpoint();
      expect(cp).toEqual({
        lastLedger: 1050,
        lastEventId: 'event-1050',
        updatedAt: 1_700_000_100,
      });
    });

    it('overwrites previous checkpoint on subsequent save', () => {
      store.saveCheckpoint(100, 'e-100', 1_000);
      store.saveCheckpoint(200, 'e-200', 2_000);
      const cp = store.getCheckpoint();
      expect(cp?.lastLedger).toBe(200);
      expect(cp?.lastEventId).toBe('e-200');
    });

    it('resets checkpoint', () => {
      store.saveCheckpoint(500);
      expect(store.getCheckpoint()?.lastLedger).toBe(500);
      store.resetCheckpoint();
      expect(store.getCheckpoint()).toBeNull();
    });
  });

  describe('wallet aggregates persistence', () => {
    it('returns null for an unknown wallet aggregate', () => {
      expect(store.getWalletAggregate('GUNKNOWN')).toBeNull();
    });

    it('saves and retrieves a wallet aggregate', () => {
      const agg = {
        wallet: 'GWALLET1',
        referral: {
          selfRedemptions: [],
          scoutCodes: {},
          redeemedCodes: {},
        },
        payToContact: {
          contactTimestamps: [1_000, 2_000],
          subscriptionTimestamps: [1_500],
          contactsPerHour: { '2024-01-01T12': 2 },
        },
        updatedAt: 1_700_000_000,
      };

      store.saveWalletAggregate(agg);
      const loaded = store.getWalletAggregate('GWALLET1');
      expect(loaded).toEqual(agg);
    });

    it('loads all wallet aggregates into a Map', () => {
      const agg1 = {
        wallet: 'GWALLET_A',
        referral: { selfRedemptions: [], scoutCodes: {}, redeemedCodes: {} },
        payToContact: { contactTimestamps: [100], subscriptionTimestamps: [], contactsPerHour: {} },
        updatedAt: 1_000,
      };
      const agg2 = {
        wallet: 'GWALLET_B',
        referral: { selfRedemptions: [], scoutCodes: {}, redeemedCodes: {} },
        payToContact: { contactTimestamps: [200], subscriptionTimestamps: [], contactsPerHour: {} },
        updatedAt: 2_000,
      };

      store.saveWalletAggregates([agg1, agg2]);
      const all = store.getAllWalletAggregates();
      expect(all.size).toBe(2);
      expect(all.get('GWALLET_A')?.payToContact.contactTimestamps).toEqual([100]);
      expect(all.get('GWALLET_B')?.payToContact.contactTimestamps).toEqual([200]);
    });
  });

  describe('active flags persistence', () => {
    it('saves and loads active flags per wallet', () => {
      const f1 = flag('high', 'flag-1');
      const f2 = flag('medium', 'flag-2');
      store.saveActiveFlagsForWallet('GSOMEONE', [f1, f2]);

      const loaded = store.getActiveFlagsForWallet('GSOMEONE');
      expect(loaded).toHaveLength(2);
      expect(loaded[0].id).toBe('flag-1');

      const all = store.getActiveFlags();
      expect(all).toHaveLength(2);
    });

    it('clears old flags when saving new flags for a wallet', () => {
      const f1 = flag('high', 'flag-1');
      store.saveActiveFlagsForWallet('GSOMEONE', [f1]);
      expect(store.getActiveFlagsForWallet('GSOMEONE')).toHaveLength(1);

      // Save empty flags for wallet -> clears previous
      store.saveActiveFlagsForWallet('GSOMEONE', []);
      expect(store.getActiveFlagsForWallet('GSOMEONE')).toHaveLength(0);
    });
  });
});

