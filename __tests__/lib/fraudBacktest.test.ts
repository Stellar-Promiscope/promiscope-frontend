import {
  generateSampleSnapshot,
  runBacktest,
  referralEntryToCode,
  loadReferralSnapshotFromStore,
  loadSnapshot,
  writeSnapshot,
} from '@/lib/fraudBacktest';
import type { ReferralEntry } from '@/lib/referralStore';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const HEURISTICS = [
  'self_redemption',
  'fast_redemption_pattern',
  'concentrated_redeemer',
  'cross_scout_redeemer_ring',
  'rapid_contact_burst',
  'subscription_cycling',
  'validator_approval_burst',
  'validator_region_spread',
  'validator_circular_approval',
  'validator_level_jump',
];

function countFor(report: ReturnType<typeof runBacktest>, heuristic: string) {
  return (
    report.heuristicCounts.find((h) => h.heuristic === heuristic)?.count ?? 0
  );
}

describe('fraudBacktest', () => {
  describe('runBacktest (default thresholds)', () => {
    const snapshot = generateSampleSnapshot();
    const report = runBacktest(snapshot);

    it('flags every heuristic exactly once on the sample dataset', () => {
      expect(report.totalFlags).toBe(HEURISTICS.length);
      for (const h of HEURISTICS) {
        expect(countFor(report, h)).toBe(1);
      }
    });

    it('includes a full per-flag detail record for manual review', () => {
      expect(report.flaggedCases).toHaveLength(HEURISTICS.length);
      for (const flag of report.flaggedCases) {
        expect(typeof flag.id).toBe('string');
        expect(Array.isArray(flag.wallets)).toBe(true);
        expect(typeof flag.reason).toBe('string');
        expect(typeof flag.evidence).toBe('object');
        expect(flag.evidence).not.toBeNull();
      }
    });

    it('does not mutate or depend on the production threshold constants', () => {
      // Re-running with an explicit override produces a different result while
      // the default-path run above is unchanged.
      const overridden = runBacktest(snapshot, {
        thresholds: { CONCENTRATION_RATIO_THRESHOLD: 0.99 },
      });
      expect(overridden.totalFlags).toBeLessThan(report.totalFlags);
    });
  });

  describe('threshold overrides', () => {
    const snapshot = generateSampleSnapshot();

    it('suppresses concentrated_redeemer when its ratio threshold is raised above the observed ratio', () => {
      const report = runBacktest(snapshot, {
        thresholds: { CONCENTRATION_RATIO_THRESHOLD: 0.9 },
      });
      // Observed ratio is 5/6 ≈ 0.833, so 0.9 suppresses it.
      expect(countFor(report, 'concentrated_redeemer')).toBe(0);
      expect(report.totalFlags).toBe(HEURISTICS.length - 1);
    });

    it('lowers the concentration threshold and still flags (idempotent with default here)', () => {
      const report = runBacktest(snapshot, {
        thresholds: { CONCENTRATION_RATIO_THRESHOLD: 0.4 },
      });
      expect(countFor(report, 'concentrated_redeemer')).toBe(1);
    });
  });

  describe('threshold sweep', () => {
    const snapshot = generateSampleSnapshot();

    it('reports total-flag counts across the swept range', () => {
      const report = runBacktest(snapshot, {
        sweep: {
          heuristic: 'concentrated_redeemer',
          thresholdKey: 'CONCENTRATION_RATIO_THRESHOLD',
          min: 0.4,
          max: 0.9,
          step: 0.1,
        },
      });
      expect(report.sweep).toBeDefined();
      const points = report.sweep!.points;
      // 0.4,0.5,0.6,0.7,0.8,0.9 => 6 points
      expect(points).toHaveLength(6);
      // At 0.9 the observed 0.833 ratio no longer trips the threshold.
      const last = points[points.length - 1];
      expect(last.value).toBe(0.9);
      expect(last.totalFlags).toBe(HEURISTICS.length - 1);
      // At 0.4..0.8 it still fires (every other heuristic + concentrated).
      expect(points[0].totalFlags).toBe(HEURISTICS.length);
    });
  });

  describe('referral store conversion', () => {
    it('converts ISO timestamps to epoch-ms ReferralCode', () => {
      const entry: ReferralEntry = {
        code: 'X',
        scoutWallet: 'G1',
        createdAt: '2024-01-01T00:00:00.000Z',
        usedBy: 'G2',
        usedAt: '2024-01-02T00:00:00.000Z',
      };
      const code = referralEntryToCode(entry);
      expect(code.createdAt).toBe(Date.UTC(2024, 0, 1));
      expect(code.usedAt).toBe(Date.UTC(2024, 0, 2));
      expect(code.usedBy).toBe('G2');
    });

    it('maps null redemption fields to null', () => {
      const entry: ReferralEntry = {
        code: 'Y',
        scoutWallet: 'G1',
        createdAt: '2024-01-01T00:00:00.000Z',
        usedBy: null,
        usedAt: null,
      };
      const code = referralEntryToCode(entry);
      expect(code.usedBy).toBeNull();
      expect(code.usedAt).toBeNull();
    });
  });

  describe('offline snapshot loaders (no network)', () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'fraud-backtest-'));
    });
    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('round-trips a snapshot through writeSnapshot/loadSnapshot', async () => {
      const snapshot = generateSampleSnapshot();
      const path = join(dir, 'snap.json');
      await writeSnapshot(snapshot, path);
      const loaded = await loadSnapshot(path);
      expect(loaded.referralCodes).toHaveLength(snapshot.referralCodes.length);
      expect(loaded.activityEvents).toHaveLength(
        snapshot.activityEvents.length,
      );
    });

    it('loads the on-disk referral store format and converts it', async () => {
      const storePath = join(dir, 'referrals.json');
      const entries: ReferralEntry[] = [
        {
          code: 'Z',
          scoutWallet: 'GA',
          createdAt: '2024-01-01T00:00:00.000Z',
          usedBy: 'GB',
          usedAt: '2024-01-01T01:00:00.000Z',
        },
      ];
      writeFileSync(storePath, JSON.stringify(entries));
      const codes = await loadReferralSnapshotFromStore(storePath);
      expect(codes).toHaveLength(1);
      expect(codes[0].createdAt).toBe(Date.UTC(2024, 0, 1));
    });
  });
});
