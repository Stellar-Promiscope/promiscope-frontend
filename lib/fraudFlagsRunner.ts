import {
  fetchAllReferralCodes,
  fetchActivityEvents,
  type ActivityEvent,
  type ActivityEventType,
} from '@/lib/api';
import {
  analyzeReferralAbuse,
  analyzePayToContactAbuse,
  type FraudThresholds,
  DEFAULT_THRESHOLDS,
} from '@/lib/fraudDetection';
import {
  type IncrementalFraudState,
  applyReferralCode,
  applyActivityEvent,
  updateActiveFlagsForChangedWallets,
} from '@/lib/fraudIncremental';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { FraudThrottleStore } from '@/lib/fraudThrottleStore';
import { FraudFlagsStore } from '@/lib/fraudFlagsStore';
import { fetchEvents } from '@/lib/indexerClient';
import type { FraudFlag } from '@/types';

/**
 * Heuristics the doc explicitly names as safe auto-throttle candidates —
 * see docs/fraud-detection.md's "What would change this" section.
 * subscription_cycling is explicitly excluded: it has "the highest genuine
 * false-positive rate" of any heuristic here and must stay alert-only.
 */
const AUTO_THROTTLE_HEURISTICS = new Set([
  'cross_scout_redeemer_ring',
  'self_redemption',
]);

/**
 * Places a wallet in a throttled state for any flag matching one of the two
 * named heuristics at 'high' severity.
 */
export function applyAutoThrottles(flags: FraudFlag[]): void {
  if (!isFeatureEnabled('FRAUD_AUTO_THROTTLE')) return;

  const store = FraudThrottleStore.getInstance();
  for (const flag of flags) {
    if (!AUTO_THROTTLE_HEURISTICS.has(flag.heuristic)) continue;
    if (flag.severity !== 'high') continue;

    const wallet = flag.wallets[0];
    if (!wallet) continue;

    store.placeThrottle({
      wallet,
      heuristic: flag.heuristic,
      category: flag.category,
      flagId: flag.id,
      reason: flag.reason,
      evidence: flag.evidence,
    });
  }
}

/**
 * Bounds how much of the activity feed a single evaluation will pull before
 * running pay-to-contact heuristics over it.
 */
const ACTIVITY_PAGE_SIZE = 200;
const MAX_ACTIVITY_PAGES = 25; // up to 5,000 events
export const DEFAULT_TIME_BUDGET_MS = 45_000; // 45 seconds serverless budget
export const DEFAULT_SAFETY_MARGIN_MS = 3_000; // 3 seconds reserve

export async function fetchAllActivityEvents(): Promise<{
  events: ActivityEvent[];
  truncated: boolean;
}> {
  const events: ActivityEvent[] = [];
  let page = 1;
  let total = Infinity;

  while (events.length < total && page <= MAX_ACTIVITY_PAGES) {
    const res = await fetchActivityEvents(page, ACTIVITY_PAGE_SIZE);
    events.push(...res.events);
    total = res.total;
    if (res.events.length === 0) break;
    page++;
  }

  return { events, truncated: events.length < total };
}

export interface FraudFlagEvaluationResult {
  flags: FraudFlag[];
  warnings: string[];
  evaluatedAt?: number;
  eventsProcessed?: number;
  durationMs?: number;
}

export interface IncrementalEvaluationOptions {
  trigger?: 'manual' | 'cron';
  timeBudgetMs?: number;
  safetyMarginMs?: number;
  chunkSize?: number;
  maxPages?: number;
  thresholds?: FraudThresholds;
  forceFull?: boolean;
}

export interface IncrementalEvaluationResult extends FraudFlagEvaluationResult {
  hitTimeBudget: boolean;
  lastLedger: number;
  changedWalletsCount: number;
}

/**
 * Runs an incremental evaluation job:
 * 1. Reads last checkpoint (ledger) and wallet aggregates from fraudFlagsStore.
 * 2. Fetches only events strictly after the checkpoint ledger.
 * 3. Chunks work and monitors time budget (e.g. 45s); halts and persists progress
 *    if the budget is nearly exhausted.
 * 4. Updates rolling aggregates and evaluates heuristics ONLY for wallets that changed.
 * 5. Persists progress, active flags, and run stats for the next invocation.
 */
export async function runIncrementalFraudFlagEvaluation(
  options: IncrementalEvaluationOptions = {},
): Promise<IncrementalEvaluationResult> {
  const startTime = Date.now();
  const timeBudget = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const safetyMargin = options.safetyMarginMs ?? DEFAULT_SAFETY_MARGIN_MS;
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const chunkSize = options.chunkSize ?? ACTIVITY_PAGE_SIZE;
  const maxPages = options.maxPages ?? MAX_ACTIVITY_PAGES;

  const store = FraudFlagsStore.getInstance();
  const checkpoint = store.getCheckpoint();
  let currentLedger = checkpoint?.lastLedger ?? 0;
  let lastEventId = checkpoint?.lastEventId ?? null;

  // Initialize state with stored aggregates and flags
  const existingAggregates = store.getAllWalletAggregates();
  const existingActiveFlags = store.getActiveFlags();
  const state: IncrementalFraudState = {
    wallets: existingAggregates,
    activeFlags: new Map(),
    lastLedger: currentLedger,
    lastEventId,
    updatedAt: checkpoint?.updatedAt ?? Date.now(),
  };

  for (const flag of existingActiveFlags) {
    const primaryWallet = flag.wallets[0];
    if (primaryWallet) {
      const list = state.activeFlags.get(primaryWallet) ?? [];
      list.push(flag);
      state.activeFlags.set(primaryWallet, list);
    }
  }

  const warnings: string[] = [];
  const changedWallets = new Set<string>();
  let eventsProcessed = 0;
  let hitTimeBudget = false;

  // 1. Process referral codes
  try {
    const codes = await fetchAllReferralCodes();
    for (const code of codes) {
      if (Date.now() - startTime >= timeBudget - safetyMargin) {
        hitTimeBudget = true;
        break;
      }
      const modified = applyReferralCode(state, code);
      for (const w of modified) changedWallets.add(w);
      eventsProcessed++;
    }
  } catch {
    warnings.push(
      'Referral backend is unavailable — referral heuristics were skipped. Pay-to-contact heuristics below are unaffected.',
    );
  }

  // 2. Process activity events incrementally
  if (!hitTimeBudget) {
    try {
      let indexerHandled = false;
      try {
        const indexerRes = await fetchEvents({
          after: currentLedger,
          limit: chunkSize,
        });

        if (indexerRes && Array.isArray(indexerRes.events)) {
          indexerHandled = true;
          let events = indexerRes.events;
          let nextCursor = indexerRes.nextCursor;
          let page = 0;

          while (events.length > 0 && page < maxPages) {
            page++;
            for (const item of events) {
              if (Date.now() - startTime >= timeBudget - safetyMargin) {
                hitTimeBudget = true;
                break;
              }
              const actEvent: ActivityEvent = {
                id: String(item.id),
                type: item.type as ActivityEventType,
                timestamp: item.timestamp,
                actor: (item.data?.scout as string) ?? item.scout ?? '',
                subjectId:
                  (item.data?.player_id as string) ??
                  item.playerId ??
                  undefined,
                ledger: item.ledger,
              };
              const modified = applyActivityEvent(state, actEvent);
              for (const w of modified) changedWallets.add(w);
              if (item.ledger > currentLedger) {
                currentLedger = item.ledger;
              }
              lastEventId = String(item.id);
              eventsProcessed++;
            }

            if (hitTimeBudget || nextCursor === null) break;
            const nextPage = await fetchEvents({
              after: nextCursor,
              limit: chunkSize,
            });
            events = nextPage.events;
            nextCursor = nextPage.nextCursor;
          }
        }
      } catch {
        indexerHandled = false;
      }

      // If indexer was unavailable or not configured, fall back to fetchActivityEvents
      if (!indexerHandled) {
        const { events, truncated } = await fetchAllActivityEvents();
        if (truncated) {
          warnings.push(
            `Activity feed has more than ${maxPages * chunkSize} events; pay-to-contact analysis only covers the most recent ones.`,
          );
        }

        // Process only events newer than currentLedger (or all if first run)
        for (const event of events) {
          if (Date.now() - startTime >= timeBudget - safetyMargin) {
            hitTimeBudget = true;
            break;
          }
          const eventLedger = event.ledger ?? event.timestamp;
          if (currentLedger === 0 || eventLedger > currentLedger) {
            const modified = applyActivityEvent(state, event);
            for (const w of modified) changedWallets.add(w);
            if (eventLedger > currentLedger) {
              currentLedger = eventLedger;
            }
            lastEventId = event.id;
            eventsProcessed++;
          }
        }
      }
    } catch {
      warnings.push(
        'Activity feed backend is unavailable — pay-to-contact heuristics were skipped. Referral heuristics below are unaffected.',
      );
    }
  }

  // 3. Evaluate heuristics ONLY for changed wallets
  const flags = updateActiveFlagsForChangedWallets(
    state,
    changedWallets,
    thresholds,
  );

  // 4. Persist progress to store
  for (const wallet of changedWallets) {
    const agg = state.wallets.get(wallet);
    if (agg) store.saveWalletAggregate(agg);
    const walletFlags = state.activeFlags.get(wallet) ?? [];
    store.saveActiveFlagsForWallet(wallet, walletFlags);
  }

  store.saveCheckpoint(currentLedger, lastEventId);

  const evaluatedAt = Date.now();
  const durationMs = evaluatedAt - startTime;

  store.recordRun(
    options.trigger ?? 'cron',
    flags,
    warnings,
    evaluatedAt,
    eventsProcessed,
    durationMs,
  );

  applyAutoThrottles(flags);

  return {
    flags,
    warnings,
    evaluatedAt,
    eventsProcessed,
    durationMs,
    hitTimeBudget,
    lastLedger: currentLedger,
    changedWalletsCount: changedWallets.size,
  };
}

/**
 * Gathers cross-wallet referral/activity data and runs heuristics.
 * Supports both incremental evaluation (recommended for scheduled cron)
 * and legacy full evaluation for backward compatibility and test suites.
 */
export async function runFraudFlagEvaluation(options?: {
  mode?: 'full' | 'incremental';
  trigger?: 'manual' | 'cron';
  timeBudgetMs?: number;
}): Promise<FraudFlagEvaluationResult> {
  if (options?.mode === 'incremental') {
    return runIncrementalFraudFlagEvaluation({
      trigger: options.trigger,
      timeBudgetMs: options.timeBudgetMs,
    });
  }

  const startTime = Date.now();
  let referralFlags: FraudFlag[] = [];
  const warnings: string[] = [];
  let referralCount = 0;

  try {
    const codes = await fetchAllReferralCodes();
    referralCount = codes.length;
    referralFlags = analyzeReferralAbuse(codes);
  } catch {
    warnings.push(
      'Referral backend is unavailable — referral heuristics were skipped. Pay-to-contact heuristics below are unaffected.',
    );
  }

  let payToContactFlags: FraudFlag[] = [];
  let activityCount = 0;

  try {
    const { events, truncated } = await fetchAllActivityEvents();
    activityCount = events.length;
    payToContactFlags = analyzePayToContactAbuse(events);
    if (truncated) {
      warnings.push(
        `Activity feed has more than ${MAX_ACTIVITY_PAGES * ACTIVITY_PAGE_SIZE} events; pay-to-contact analysis only covers the most recent ones.`,
      );
    }
  } catch {
    warnings.push(
      'Activity feed backend is unavailable — pay-to-contact heuristics were skipped. Referral heuristics below are unaffected.',
    );
  }

  const flags = [...referralFlags, ...payToContactFlags].sort((a, b) => {
    const severityRank = { high: 0, medium: 1, low: 2 } as const;
    return severityRank[a.severity] - severityRank[b.severity];
  });

  applyAutoThrottles(flags);

  const evaluatedAt = Date.now();
  const durationMs = evaluatedAt - startTime;
  const eventsProcessed = referralCount + activityCount;

  return { flags, warnings, evaluatedAt, eventsProcessed, durationMs };
}
