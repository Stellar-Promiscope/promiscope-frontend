import {
  analyzeValidatorAbuse,
  DEFAULT_THRESHOLDS,
  type ValidatorApproval,
} from '@/lib/fraudDetection';
import { generateSampleSnapshot, runBacktest } from '@/lib/fraudBacktest';

const BASE = Date.UTC(2024, 0, 1) / 1000; // Unix seconds
const HOUR = 3600;
const DAY = 24 * HOUR;

function approval(
  validator: string,
  playerId: string,
  timestamp: number,
  extra: Partial<ValidatorApproval> = {},
): ValidatorApproval {
  return { validator, playerId, timestamp, ...extra };
}

function heuristics(approvals: ValidatorApproval[], ctx = {}, t = {}) {
  return analyzeValidatorAbuse(approvals, ctx, {
    ...DEFAULT_THRESHOLDS,
    ...t,
  }).map((f) => f.heuristic);
}

describe('validator_approval_burst', () => {
  const burst = (n: number) =>
    Array.from({ length: n }, (_, i) => approval('GV', `p${i}`, BASE + i * 30));

  test('flags more than N approvals within the window', () => {
    const flags = analyzeValidatorAbuse(burst(11));
    expect(flags.map((f) => f.heuristic)).toEqual(['validator_approval_burst']);
    expect(flags[0].category).toBe('validator');
    expect(flags[0].wallets).toEqual(['GV']);
    expect(flags[0].evidence.events).toHaveLength(11);
  });

  test('does not flag at the threshold', () => {
    expect(heuristics(burst(10))).toEqual([]);
  });

  test('threshold is configurable', () => {
    expect(heuristics(burst(5), {}, { VALIDATOR_BURST_MIN_COUNT: 4 })).toEqual([
      'validator_approval_burst',
    ]);
  });
});

describe('validator_region_spread', () => {
  const home = Array.from({ length: 5 }, (_, i) =>
    approval('GV', `h${i}`, BASE + i * DAY, { region: 'Accra' }),
  );
  const away = ['Nairobi', 'Kano', 'Dakar'].map((region, i) =>
    approval('GV', `a${i}`, BASE + 10 * DAY + i * HOUR, { region }),
  );

  test('flags a localized validator suddenly approving across regions', () => {
    expect(heuristics([...home, ...away])).toEqual(['validator_region_spread']);
  });

  test('ignores validators without a localized history', () => {
    expect(heuristics(away)).toEqual([]);
  });

  test('ignores approvals in fewer than K regions', () => {
    expect(heuristics([...home, ...away.slice(0, 2)])).toEqual([]);
  });
});

describe('validator_circular_approval', () => {
  test('flags approving a player referred by the validator itself', () => {
    expect(
      heuristics([approval('GV', 'p1', BASE, { referrerWallet: 'GV' })]),
    ).toEqual(['validator_circular_approval']);
  });

  test('flags a referrer in the same wallet cluster', () => {
    const flags = analyzeValidatorAbuse(
      [approval('GV', 'p1', BASE, { referrerWallet: 'GSCOUT' })],
      { walletClusters: [['GSCOUT', 'GV']] },
    );
    expect(flags[0].heuristic).toBe('validator_circular_approval');
    expect(flags[0].wallets).toEqual(['GV', 'GSCOUT']);
  });

  test('ignores unrelated referrers', () => {
    expect(
      heuristics([approval('GV', 'p1', BASE, { referrerWallet: 'GOTHER' })]),
    ).toEqual([]);
  });
});

describe('validator_level_jump', () => {
  const jumps = (players: number, gap: number) =>
    Array.from({ length: players }, (_, p) =>
      [0, 1, 2].map((a) => approval('GV', `p${p}`, BASE + p * DAY + a * gap)),
    ).flat();

  test('flags taking several players from level 0 to 3 quickly', () => {
    expect(heuristics(jumps(3, HOUR))).toEqual(['validator_level_jump']);
  });

  test('ignores slow progressions', () => {
    expect(heuristics(jumps(3, 2 * DAY))).toEqual([]);
  });

  test('ignores players who already had approvals from someone else', () => {
    const prior = [0, 1, 2].map((p) => approval('GOTHER', `p${p}`, BASE - DAY));
    expect(heuristics([...prior, ...jumps(3, HOUR)])).toEqual([]);
  });
});

describe('backtest on fixture data', () => {
  test('reports precision and recall for the validator heuristics', () => {
    const report = runBacktest(generateSampleSnapshot());
    expect(report.validatorAccuracy).toEqual({
      truePositives: 4,
      falsePositives: 0,
      falseNegatives: 0,
      precision: 1,
      recall: 1,
    });
  });
});
