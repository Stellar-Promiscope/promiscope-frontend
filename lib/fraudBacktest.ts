import {
  analyzeReferralAbuse,
  analyzePayToContactAbuse,
  analyzeValidatorAbuse,
  DEFAULT_THRESHOLDS,
  type FraudThresholds,
  type ValidatorApproval,
} from './fraudDetection.ts';
import {
  createInitialIncrementalState,
  runIncrementalStep,
  type IncrementalFraudState,
} from './fraudIncremental';
import type { ReferralCode, FraudFlag } from '@/types';
import type { ActivityEvent } from '@/lib/api';
import type { ReferralEntry } from './referralStore';

/**
 * Offline backtesting harness for lib/fraudDetection.ts (issue #1183).
 *
 * This module is intentionally side-effect free: it only ever calls the
 * *pure* analysis functions in lib/fraudDetection.ts. It never imports
 * lib/fraudFlagsRunner.ts (where admin-gated auto-throttling lives), never
 * calls any network/indexer/referral backend, and never writes anywhere
 * except an optional report file you pass explicitly. That's what makes it
 * safe to run against real historical data without any risk of triggering a
 * production fraud-detection side effect.
 *
 * Data enters either as a direct `BacktestSnapshot` (a JSON export of
 * already-typed `ReferralCode[]` / `ActivityEvent[]`) or is loaded from a
 * local file (the on-disk referral store, or an activity export) — no live
 * fetch is performed in either case.
 */

export const SNAPSHOT_FILE = 'data/fraud-backtest-snapshot.json';
const STORE_FILE = 'data/referrals.json';

// ── Snapshot shape ────────────────────────────────────────────────────────────

export interface BacktestSnapshot {
  /** One referral code per historical redemption/invite. */
  referralCodes: ReferralCode[];
  /** Global activity feed events (player_contacted, scout_subscribed, ...). */
  activityEvents: ActivityEvent[];
  /** Milestone approvals for the validator heuristics (#1359). */
  validatorApprovals?: ValidatorApproval[];
  /**
   * Ground-truth labels: validators known to be abusive in this dataset.
   * When present, the report includes validator precision and recall.
   */
  knownBadValidators?: string[];
}

export interface ValidatorAccuracy {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
}

export interface HeuristicCount {
  heuristic: string;
  category: FraudFlag['category'];
  count: number;
  severity: Record<FraudFlag['severity'], number>;
}

export interface SweepPoint {
  /** The threshold value tried at this point. */
  value: number;
  counts: HeuristicCount[];
  totalFlags: number;
}

export interface SweepConfig {
  /** Which heuristic this threshold governs (label only, for the report). */
  heuristic: string;
  /** Which FraudThresholds key to vary. */
  thresholdKey: keyof FraudThresholds;
  min: number;
  max: number;
  step: number;
}

export interface BacktestOptions {
  /** Override any subset of thresholds for this run. */
  thresholds?: Partial<FraudThresholds>;
  /** Optionally sweep one threshold across a range and report counts per value. */
  sweep?: SweepConfig;
}

export interface BacktestReport {
  generatedAt: string;
  /** The exact threshold set used for the main run. */
  thresholds: FraudThresholds;
  dataset: {
    referralCodes: number;
    activityEvents: number;
    validatorApprovals: number;
  };
  heuristicCounts: HeuristicCount[];
  totalFlags: number;
  /**
   * Every flag produced by the main run, with full evidence. This is the
   * per-case detail an admin uses to judge true- vs false-positives on a
   * sample rather than relying on aggregate counts alone.
   */
  flaggedCases: FraudFlag[];
  /** Only when the snapshot carries `knownBadValidators` labels. */
  validatorAccuracy?: ValidatorAccuracy;
  sweep?: {
    heuristic: string;
    thresholdKey: keyof FraudThresholds;
    points: SweepPoint[];
  };
  warnings: string[];
}

// ── Threshold helpers ─────────────────────────────────────────────────────────

export function mergeThresholds(
  overrides?: Partial<FraudThresholds>,
): FraudThresholds {
  return { ...DEFAULT_THRESHOLDS, ...(overrides ?? {}) };
}

// ── Loading / converting historical data (offline) ─────────────────────────────

/**
 * Convert an on-disk referral-store entry (ISO strings) into the
 * `ReferralCode` shape the heuristics expect (epoch-ms numbers). Loses no
 * information; `null` usedBy/usedAt map to `null` as expected.
 */
export function referralEntryToCode(entry: ReferralEntry): ReferralCode {
  return {
    code: entry.code,
    scoutWallet: entry.scoutWallet,
    createdAt: new Date(entry.createdAt).getTime(),
    usedBy: entry.usedBy,
    usedAt: entry.usedAt !== null ? new Date(entry.usedAt).getTime() : null,
  };
}

async function readJsonFile(path: string): Promise<unknown> {
  // Dynamic import keeps this module free of a static `fs` import (which would
  // otherwise get pulled into client bundles) and works under both the tsx
  // ESM runner and Jest's CJS transform.
  const { readFileSync } = await import('fs');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** Load referral codes from the local on-disk store (data/referrals.json). */
export async function loadReferralSnapshotFromStore(
  path: string = STORE_FILE,
): Promise<ReferralCode[]> {
  const raw = (await readJsonFile(path)) as ReferralEntry[];
  return raw.map(referralEntryToCode);
}

/** Load an activity-event export (ActivityEvent[]) from a JSON file. */
export async function loadActivitySnapshot(
  path: string,
): Promise<ActivityEvent[]> {
  return (await readJsonFile(path)) as ActivityEvent[];
}

/** Load a combined snapshot written by `writeSnapshot` / `--generate-sample`. */
export async function loadSnapshot(
  path: string = SNAPSHOT_FILE,
): Promise<BacktestSnapshot> {
  const raw = (await readJsonFile(path)) as Partial<BacktestSnapshot>;
  if (!Array.isArray(raw.referralCodes) || !Array.isArray(raw.activityEvents)) {
    throw new Error(
      `Snapshot at ${path} must contain "referralCodes" and "activityEvents" arrays.`,
    );
  }
  return {
    referralCodes: raw.referralCodes,
    activityEvents: raw.activityEvents,
  };
}

/** Persist a snapshot to disk (used by `--generate-sample`). */
export async function writeSnapshot(
  snapshot: BacktestSnapshot,
  path: string = SNAPSHOT_FILE,
): Promise<void> {
  const { writeFileSync } = await import('fs');
  const { dirname } = await import('path');
  const dir = dirname(path);
  if (dir && dir !== '.') {
    // mkdirSync from fs is synchronous; import lazily to avoid static fs dep.
    const { mkdirSync } = await import('fs');
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(snapshot, null, 2), 'utf-8');
}

// ── Sample data (synthetic, for offline demos / tests) ─────────────────────────

const SAMPLE_BASE_MS = Date.UTC(2024, 0, 1, 12, 0, 0);

/**
 * Build a synthetic but realistic historical window that exercises every
 * heuristic in both directions (clear hits + clean noise) so the harness can
 * be run with zero external data. Clearly synthetic — never write this over a
 * real production export.
 */
export function generateSampleSnapshot(): BacktestSnapshot {
  const referralCodes: ReferralCode[] = [];
  const activityEvents: ActivityEvent[] = [];

  // 1) self_redemption: code generated and redeemed by the same wallet.
  referralCodes.push({
    code: 'S-SELF',
    scoutWallet: 'GSAME',
    createdAt: SAMPLE_BASE_MS,
    usedBy: 'GSAME',
    usedAt: SAMPLE_BASE_MS + 5_000,
  });

  // 2) fast_redemption_pattern: 4 redemptions, all within 1 minute.
  for (let i = 0; i < 4; i++) {
    referralCodes.push({
      code: `S-FAST-${i}`,
      scoutWallet: 'GFAST',
      createdAt: SAMPLE_BASE_MS + i * 60_000,
      usedBy: `GRED${i}`,
      usedAt: SAMPLE_BASE_MS + i * 60_000 + 30_000,
    });
  }

  // 3) concentrated_redeemer: 6 redemptions, 5 from one wallet. Deliberately
  //    NOT "fast" (redeemed ~1 day later) so this only trips concentrated_redeemer,
  //    keeping the sample dataset to exactly one flag per heuristic.
  for (let i = 0; i < 6; i++) {
    const created = SAMPLE_BASE_MS + i * 3_600_000;
    referralCodes.push({
      code: `S-CONC-${i}`,
      scoutWallet: 'GCONC',
      createdAt: created,
      usedBy: i < 5 ? 'GBULK' : `GOTHER${i}`,
      usedAt: created + 86_400_000,
    });
  }

  // 4) cross_scout_redeemer_ring: one redeemer across 5 distinct scouts.
  for (let i = 0; i < 5; i++) {
    referralCodes.push({
      code: `S-RING-${i}`,
      scoutWallet: `GRING-SCOUT${i}`,
      createdAt: SAMPLE_BASE_MS + i * 86_400_000,
      usedBy: 'GRING',
      usedAt: SAMPLE_BASE_MS + i * 86_400_000 + 60_000,
    });
  }

  // 5) rapid_contact_burst: 10 contacts within 10 minutes.
  for (let i = 0; i < 10; i++) {
    activityEvents.push({
      id: `c-${i}`,
      type: 'player_contacted',
      timestamp: Math.floor((SAMPLE_BASE_MS + i * 30_000) / 1000),
      actor: 'GBURST',
    });
  }

  // 6) subscription_cycling: 4 subscriptions, only 2 contacts total.
  for (let i = 0; i < 4; i++) {
    activityEvents.push({
      id: `s-${i}`,
      type: 'scout_subscribed',
      timestamp: Math.floor((SAMPLE_BASE_MS + i * 14 * 86_400_000) / 1000),
      actor: 'GCYCLE',
    });
  }
  activityEvents.push(
    {
      id: 'cc-1',
      type: 'player_contacted',
      timestamp: Math.floor((SAMPLE_BASE_MS + 1) / 1000),
      actor: 'GCYCLE',
    },
    {
      id: 'cc-2',
      type: 'player_contacted',
      timestamp: Math.floor((SAMPLE_BASE_MS + 2) / 1000),
      actor: 'GCYCLE',
    },
  );

  // Clean noise so "no flag" cases are also represented.
  for (let i = 0; i < 10; i++) {
    referralCodes.push({
      code: `S-CLEAN-${i}`,
      scoutWallet: `GCLEAN${i}`,
      createdAt: SAMPLE_BASE_MS + i * 86_400_000,
      usedBy: `GUSER${i}`,
      usedAt: SAMPLE_BASE_MS + i * 86_400_000 + 7 * 86_400_000,
    });
    activityEvents.push({
      id: `clean-c-${i}`,
      type: 'player_contacted',
      timestamp: Math.floor((SAMPLE_BASE_MS + i * 86_400_000) / 1000),
      actor: `GCLEAN${i}`,
    });
  }

  // Validator approvals (#1359): four abusive validators, one per
  // heuristic, plus localized validators approving at a normal pace.
  const validatorApprovals: ValidatorApproval[] = [];
  const at = (ms: number) => Math.floor(ms / 1000);
  const DAY = 86_400_000;

  // validator_approval_burst: 12 approvals in 6 minutes.
  for (let i = 0; i < 12; i++) {
    validatorApprovals.push({
      validator: 'GVALBURST',
      playerId: `burst-player-${i}`,
      timestamp: at(SAMPLE_BASE_MS + i * 30_000),
      region: 'Lagos',
    });
  }
  // validator_region_spread: a week in Accra, then 4 regions in one day.
  for (let i = 0; i < 6; i++) {
    validatorApprovals.push({
      validator: 'GVALSPREAD',
      playerId: `spread-home-${i}`,
      timestamp: at(SAMPLE_BASE_MS + i * DAY),
      region: 'Accra',
    });
  }
  ['Nairobi', 'Kano', 'Dakar', 'Kumasi'].forEach((region, i) => {
    validatorApprovals.push({
      validator: 'GVALSPREAD',
      playerId: `spread-away-${i}`,
      timestamp: at(SAMPLE_BASE_MS + 10 * DAY + i * 3_600_000),
      region,
    });
  });
  // validator_circular_approval: approves a player its own wallet referred.
  validatorApprovals.push({
    validator: 'GVALCIRC',
    playerId: 'circ-player',
    timestamp: at(SAMPLE_BASE_MS + 2 * DAY),
    region: 'Abuja',
    referrerWallet: 'GVALCIRC',
  });
  // validator_level_jump: three players taken 0 -> 3 within hours.
  for (let p = 0; p < 3; p++) {
    for (let a = 0; a < 3; a++) {
      validatorApprovals.push({
        validator: 'GVALJUMP',
        playerId: `jump-player-${p}`,
        timestamp: at(SAMPLE_BASE_MS + 3 * DAY + p * DAY + a * 3_600_000),
        region: 'Kampala',
      });
    }
  }
  // Clean validators: one approval a day, one region, referred by others.
  for (let v = 0; v < 5; v++) {
    for (let i = 0; i < 8; i++) {
      validatorApprovals.push({
        validator: `GVALCLEAN${v}`,
        playerId: `clean-val-${v}-player-${i}`,
        timestamp: at(SAMPLE_BASE_MS + i * DAY + v * 3_600_000),
        region: `Region${v}`,
        referrerWallet: `GSCOUTREF${i}`,
      });
    }
  }

  return {
    referralCodes,
    activityEvents,
    validatorApprovals,
    knownBadValidators: ['GVALBURST', 'GVALSPREAD', 'GVALCIRC', 'GVALJUMP'],
  };
}

/** Precision/recall of validator flags against labeled bad validators. */
export function computeValidatorAccuracy(
  flags: FraudFlag[],
  knownBad: string[],
): ValidatorAccuracy {
  const flagged = new Set(
    flags.filter((f) => f.category === 'validator').map((f) => f.wallets[0]),
  );
  const bad = new Set(knownBad);
  const truePositives = [...flagged].filter((w) => bad.has(w)).length;
  const falsePositives = flagged.size - truePositives;
  const falseNegatives = bad.size - truePositives;
  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision: flagged.size ? truePositives / flagged.size : 1,
    recall: bad.size ? truePositives / bad.size : 1,
  };
}

// ── Analysis / reporting ───────────────────────────────────────────────────────

function summarizeFlags(flags: FraudFlag[]): {
  heuristicCounts: HeuristicCount[];
  totalFlags: number;
} {
  const byHeuristic = new Map<string, HeuristicCount>();
  for (const f of flags) {
    let entry = byHeuristic.get(f.heuristic);
    if (!entry) {
      entry = {
        heuristic: f.heuristic,
        category: f.category,
        count: 0,
        severity: { low: 0, medium: 0, high: 0 },
      };
      byHeuristic.set(f.heuristic, entry);
    }
    entry.count += 1;
    entry.severity[f.severity] += 1;
  }
  const heuristicCounts = Array.from(byHeuristic.values()).sort((a, b) =>
    a.heuristic.localeCompare(b.heuristic),
  );
  return { heuristicCounts, totalFlags: flags.length };
}

/**
 * Replay a historical snapshot through the heuristics at the given (or default)
 * thresholds and produce a full report: per-heuristic counts, severity
 * distribution, every individual flagged case (for manual review), and an
 * optional threshold sweep.
 */
export function runBacktest(
  snapshot: BacktestSnapshot,
  options: BacktestOptions = {},
): BacktestReport {
  const warnings: string[] = [];
  const thresholds = mergeThresholds(options.thresholds);

  const referralFlags = analyzeReferralAbuse(
    snapshot.referralCodes,
    thresholds,
  );
  const payToContactFlags = analyzePayToContactAbuse(
    snapshot.activityEvents,
    thresholds,
  );
  const validatorContext = {
    walletClusters: referralFlags.map((f) => f.wallets),
  };
  const validatorFlags = analyzeValidatorAbuse(
    snapshot.validatorApprovals ?? [],
    validatorContext,
    thresholds,
  );
  const flags = [
    ...referralFlags,
    ...payToContactFlags,
    ...validatorFlags,
  ].sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 } as const;
    return rank[a.severity] - rank[b.severity];
  });

  const { heuristicCounts, totalFlags } = summarizeFlags(flags);

  const report: BacktestReport = {
    generatedAt: new Date().toISOString(),
    thresholds,
    dataset: {
      referralCodes: snapshot.referralCodes.length,
      activityEvents: snapshot.activityEvents.length,
      validatorApprovals: snapshot.validatorApprovals?.length ?? 0,
    },
    heuristicCounts,
    totalFlags,
    flaggedCases: flags,
    warnings,
  };

  if (snapshot.knownBadValidators) {
    report.validatorAccuracy = computeValidatorAccuracy(
      validatorFlags,
      snapshot.knownBadValidators,
    );
  }

  if (options.sweep) {
    const { heuristic, thresholdKey, min, max, step } = options.sweep;
    const points: SweepPoint[] = [];

    // Index-based loop to avoid floating-point drift in the stop condition.
    const steps = Math.max(1, Math.round((max - min) / step) + 1);
    for (let i = 0; i < steps; i++) {
      const value = Number((min + i * step).toFixed(6));
      const t = { ...thresholds, [thresholdKey]: value };
      const sweepFlags = [
        ...analyzeReferralAbuse(snapshot.referralCodes, t),
        ...analyzePayToContactAbuse(snapshot.activityEvents, t),
        ...analyzeValidatorAbuse(
          snapshot.validatorApprovals ?? [],
          validatorContext,
          t,
        ),
      ];
      const summary = summarizeFlags(sweepFlags);
      points.push({
        value,
        counts: summary.heuristicCounts,
        totalFlags: summary.totalFlags,
      });
      if (value >= max) break;
    }

    report.sweep = { heuristic, thresholdKey, points };
  }

  return report;
}

// ── Formatting ─────────────────────────────────────────────────────────────────

export type ReportFormat = 'text' | 'json';

function formatText(report: BacktestReport): string {
  const lines: string[] = [];
  lines.push('Fraud-detection backtest report');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(
    `Dataset: ${report.dataset.referralCodes} referral codes, ${report.dataset.activityEvents} activity events, ${report.dataset.validatorApprovals} validator approvals`,
  );
  lines.push('');
  lines.push('Thresholds used:');
  for (const [k, v] of Object.entries(report.thresholds)) {
    lines.push(`  ${k} = ${v}`);
  }
  lines.push('');
  lines.push(`Total flags: ${report.totalFlags}`);
  lines.push('');
  lines.push('Flags per heuristic (high/medium/low):');
  if (report.heuristicCounts.length === 0) {
    lines.push('  (none)');
  }
  for (const h of report.heuristicCounts) {
    lines.push(
      `  ${h.heuristic.padEnd(28)} ${String(h.count).padStart(3)}  (${h.severity.high}/${h.severity.medium}/${h.severity.low})`,
    );
  }

  if (report.validatorAccuracy) {
    const a = report.validatorAccuracy;
    lines.push('');
    lines.push(
      `Validator heuristics vs labels: precision ${(a.precision * 100).toFixed(1)}%, recall ${(a.recall * 100).toFixed(1)}% (TP ${a.truePositives}, FP ${a.falsePositives}, FN ${a.falseNegatives})`,
    );
  }

  if (report.sweep) {
    const s = report.sweep;
    lines.push('');
    lines.push(
      `Threshold sweep: ${s.heuristic} / ${String(s.thresholdKey)} (total flags per value)`,
    );
    for (const p of s.points) {
      lines.push(
        `  ${String(s.thresholdKey)} = ${p.value}  ->  ${p.totalFlags} flags`,
      );
    }
  }

  lines.push('');
  lines.push(
    `Flagged cases for manual review (${report.flaggedCases.length}):`,
  );
  for (const f of report.flaggedCases) {
    lines.push('');
    lines.push(`  [${f.severity}] ${f.heuristic} (${f.category})`);
    lines.push(`    id: ${f.id}`);
    lines.push(`    wallets: ${f.wallets.join(', ')}`);
    lines.push(`    ${f.reason}`);
    lines.push(`    evidence: ${JSON.stringify(f.evidence)}`);
  }

  if (report.warnings.length) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of report.warnings) lines.push(`  - ${w}`);
  }

  return lines.join('\n');
}

export function formatReport(
  report: BacktestReport,
  format: ReportFormat = 'text',
): string {
  if (format === 'json') return JSON.stringify(report, null, 2);
  return formatText(report);
}

/** Write a report to disk (only when explicitly asked via --out). */
export async function saveReport(content: string, path: string): Promise<void> {
  const { writeFileSync, mkdirSync } = await import('fs');
  const { dirname } = await import('path');
  const dir = dirname(path);
  if (dir && dir !== '.') mkdirSync(dir, { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

// ── Incremental Backtesting & Equivalence ────────────────────────────────────

export interface IncrementalBacktestOptions extends BacktestOptions {
  chunkSize?: number;
  timeBudgetMs?: number;
  state?: IncrementalFraudState;
}

export interface IncrementalBacktestReport extends BacktestReport {
  eventsProcessed: number;
  durationMs: number;
  chunksCount: number;
  hitTimeBudget: boolean;
  state: IncrementalFraudState;
}

/**
 * Replays a historical snapshot incrementally through chunked evaluation,
 * matching the scheduled incremental job's execution model.
 */
export function runIncrementalBacktest(
  snapshot: BacktestSnapshot,
  options: IncrementalBacktestOptions = {},
): IncrementalBacktestReport {
  const startTime = Date.now();
  const thresholds = mergeThresholds(options.thresholds);
  const state = options.state ?? createInitialIncrementalState();

  const chunkSize = options.chunkSize ?? 50;
  const timeBudget = options.timeBudgetMs ?? Infinity;
  let eventsProcessed = 0;
  let chunksCount = 0;
  let hitTimeBudget = false;
  const warnings: string[] = [];

  // 1. Process referral codes in chunks
  const codes = snapshot.referralCodes;
  for (let i = 0; i < codes.length; i += chunkSize) {
    if (Date.now() - startTime >= timeBudget) {
      hitTimeBudget = true;
      warnings.push(
        `Time budget exceeded after processing ${eventsProcessed} events.`,
      );
      break;
    }
    const chunk = codes.slice(i, i + chunkSize);
    const step = runIncrementalStep(state, chunk, [], {
      thresholds,
      timeBudgetMs: timeBudget - (Date.now() - startTime),
    });
    eventsProcessed += step.eventsProcessed;
    chunksCount++;
    if (step.hitTimeBudget) {
      hitTimeBudget = true;
      break;
    }
  }

  // 2. Process activity events in chunks
  if (!hitTimeBudget) {
    const events = snapshot.activityEvents;
    for (let i = 0; i < events.length; i += chunkSize) {
      if (Date.now() - startTime >= timeBudget) {
        hitTimeBudget = true;
        warnings.push(
          `Time budget exceeded after processing ${eventsProcessed} events.`,
        );
        break;
      }
      const chunk = events.slice(i, i + chunkSize);
      const step = runIncrementalStep(state, [], chunk, {
        thresholds,
        timeBudgetMs: timeBudget - (Date.now() - startTime),
      });
      eventsProcessed += step.eventsProcessed;
      chunksCount++;
      if (step.hitTimeBudget) {
        hitTimeBudget = true;
        break;
      }
    }
  }

  // Collect and sort all active flags
  const flags: FraudFlag[] = [];
  for (const list of state.activeFlags.values()) {
    flags.push(...list);
  }
  const rank = { high: 0, medium: 1, low: 2 } as const;
  flags.sort((a, b) => rank[a.severity] - rank[b.severity]);

  const { heuristicCounts, totalFlags } = summarizeFlags(flags);
  const durationMs = Date.now() - startTime;

  return {
    generatedAt: new Date().toISOString(),
    thresholds,
    dataset: {
      referralCodes: snapshot.referralCodes.length,
      activityEvents: snapshot.activityEvents.length,
      validatorApprovals: snapshot.validatorApprovals?.length ?? 0,
    },
    heuristicCounts,
    totalFlags,
    flaggedCases: flags,
    warnings,
    eventsProcessed,
    durationMs,
    chunksCount,
    hitTimeBudget,
    state,
  };
}

export interface EquivalenceCheckResult {
  equivalent: boolean;
  fullReport: BacktestReport;
  incrementalReport: IncrementalBacktestReport;
  differences: string[];
}

/**
 * Asserts equivalence between full evaluation and incremental evaluation:
 * verifies that both produce identical flags (same ids, severities, wallets, reasons, evidence).
 */
export function verifyIncrementalEquivalence(
  snapshot: BacktestSnapshot,
  options: IncrementalBacktestOptions = {},
): EquivalenceCheckResult {
  const fullReport = runBacktest(snapshot, options);
  const incrementalReport = runIncrementalBacktest(snapshot, options);
  const differences: string[] = [];

  if (fullReport.totalFlags !== incrementalReport.totalFlags) {
    differences.push(
      `Flag count mismatch: full=${fullReport.totalFlags}, incremental=${incrementalReport.totalFlags}`,
    );
  }

  const incMap = new Map<string, FraudFlag>();
  for (const f of incrementalReport.flaggedCases) {
    incMap.set(f.id, f);
  }

  for (const fullFlag of fullReport.flaggedCases) {
    const incFlag = incMap.get(fullFlag.id);
    if (!incFlag) {
      differences.push(`Missing flag in incremental: ${fullFlag.id}`);
      continue;
    }
    if (fullFlag.severity !== incFlag.severity) {
      differences.push(
        `Severity mismatch for ${fullFlag.id}: full=${fullFlag.severity}, inc=${incFlag.severity}`,
      );
    }
    if (fullFlag.reason !== incFlag.reason) {
      differences.push(
        `Reason mismatch for ${fullFlag.id}: full="${fullFlag.reason}", inc="${incFlag.reason}"`,
      );
    }
    const fullEv = JSON.stringify(fullFlag.evidence);
    const incEv = JSON.stringify(incFlag.evidence);
    if (fullEv !== incEv) {
      differences.push(
        `Evidence mismatch for ${fullFlag.id}: full=${fullEv}, inc=${incEv}`,
      );
    }
  }

  for (const incFlag of incrementalReport.flaggedCases) {
    if (!fullReport.flaggedCases.some((f) => f.id === incFlag.id)) {
      differences.push(`Unexpected flag in incremental: ${incFlag.id}`);
    }
  }

  return {
    equivalent: differences.length === 0,
    fullReport,
    incrementalReport,
    differences,
  };
}

export interface BenchmarkResult {
  fullTimeMs: number;
  incrementalTimeMs: number;
  historyEventsCount: number;
  newEventsCount: number;
  isProportional: boolean;
  speedup: number;
}

/**
 * Benchmark measuring that incremental evaluation runtime is roughly proportional
 * to new events processed, rather than the total size of event history.
 */
export function benchmarkIncrementalVsFull(
  options: {
    historyWallets?: number;
    eventsPerWallet?: number;
    newEventsCount?: number;
  } = {},
): BenchmarkResult {
  const historyWallets = options.historyWallets ?? 150;
  const eventsPerWallet = options.eventsPerWallet ?? 10;
  const newEventsCount = options.newEventsCount ?? 10;

  const baseMs = Date.UTC(2024, 0, 1, 0, 0, 0);
  const historicalEvents: ActivityEvent[] = [];
  const historicalCodes: ReferralCode[] = [];

  for (let w = 0; w < historyWallets; w++) {
    const wallet = `GWALLET_BENCH_${w}`;
    for (let e = 0; e < eventsPerWallet; e++) {
      historicalEvents.push({
        id: `bench-event-${w}-${e}`,
        type: 'player_contacted',
        actor: wallet,
        timestamp: Math.floor((baseMs + e * 3600_000) / 1000),
      });
      historicalCodes.push({
        code: `BENCH-CODE-${w}-${e}`,
        scoutWallet: wallet,
        createdAt: baseMs + e * 3600_000,
        usedBy: `GUSER_${w}_${e}`,
        usedAt: baseMs + e * 3600_000 + 86400_000,
      });
    }
  }

  // Pre-seed incremental state with history
  const incrementalState = createInitialIncrementalState();
  runIncrementalStep(incrementalState, historicalCodes, historicalEvents);

  // New events for 1 specific wallet
  const newEvents: ActivityEvent[] = [];
  for (let i = 0; i < newEventsCount; i++) {
    newEvents.push({
      id: `new-event-${i}`,
      type: 'player_contacted',
      actor: 'GNEW_ACTOR',
      timestamp: Math.floor((baseMs + 1000_000_000 + i * 10_000) / 1000),
    });
  }

  // Benchmark full evaluation (rescans all history + new events)
  const fullSnapshot: BacktestSnapshot = {
    referralCodes: historicalCodes,
    activityEvents: [...historicalEvents, ...newEvents],
  };

  const startFull = Date.now();
  for (let iter = 0; iter < 5; iter++) {
    runBacktest(fullSnapshot);
  }
  const fullTimeMs = (Date.now() - startFull) / 5;

  // Benchmark incremental evaluation (only processes the new events)
  const startInc = Date.now();
  for (let iter = 0; iter < 5; iter++) {
    runIncrementalStep(incrementalState, [], newEvents);
  }
  const incrementalTimeMs = (Date.now() - startInc) / 5;

  return {
    fullTimeMs,
    incrementalTimeMs,
    historyEventsCount: historicalEvents.length + historicalCodes.length,
    newEventsCount,
    isProportional: incrementalTimeMs <= fullTimeMs,
    speedup: Number(
      (fullTimeMs / Math.max(incrementalTimeMs, 0.01)).toFixed(2),
    ),
  };
}

