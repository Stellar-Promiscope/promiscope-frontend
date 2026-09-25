import {
  fetchAllReferralCodes,
  fetchActivityEvents,
  fetchPlayerProfile,
  type ActivityEvent,
} from '@/lib/api';
import {
  analyzeReferralAbuse,
  analyzePayToContactAbuse,
  analyzeValidatorAbuse,
  type ValidatorApproval,
} from '@/lib/fraudDetection';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { FraudThrottleStore } from '@/lib/fraudThrottleStore';
import type { FraudFlag, Player, ReferralCode } from '@/types';

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
 * named heuristics at 'high' severity (the documented confidence bar —
 * self_redemption is always 'high' since it has no false-positive risk;
 * cross_scout_redeemer_ring only reaches 'high' at double its base distinct-
 * scout threshold). Behind NEXT_PUBLIC_FEATURE_FRAUD_AUTO_THROTTLE so this
 * can be enabled only once thresholds have actually been validated against
 * real traffic, per the doc's own caution against auto-enforcement on
 * untuned thresholds. A throttle never auto-expires — only an explicit
 * admin action (FraudFlagsPanel.tsx) lifts it; see lib/fraudThrottleStore.ts.
 */
function applyAutoThrottles(flags: FraudFlag[]): void {
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
 * running pay-to-contact heuristics over it. Shared by both the on-demand
 * (admin panel load) and scheduled (cron) evaluation paths — see
 * docs/fraud-detection.md.
 */
const ACTIVITY_PAGE_SIZE = 200;
const MAX_ACTIVITY_PAGES = 25; // up to 5,000 events

async function fetchAllActivityEvents(): Promise<{
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

/** Cap on player-profile lookups used to enrich approvals with a region. */
const MAX_PLAYER_LOOKUPS = 100;

/**
 * Turns `milestone_approved` activity into ValidatorApprovals, enriched
 * best-effort with each player's region (for the spread heuristic) and
 * referring scout (for the circular heuristic). A failed profile lookup
 * just leaves that approval un-enriched.
 */
async function buildValidatorApprovals(
  events: ActivityEvent[],
  referralCodes: ReferralCode[],
): Promise<ValidatorApproval[]> {
  const approvals = events.filter(
    (e) => e.type === 'milestone_approved' && e.subjectId,
  );
  const playerIds = [
    ...new Set(approvals.map((e) => e.subjectId as string)),
  ].slice(0, MAX_PLAYER_LOOKUPS);
  const profiles = new Map<string, Player>();
  await Promise.all(
    playerIds.map(async (id) => {
      try {
        const profile: Player | undefined = await fetchPlayerProfile(id);
        if (profile) profiles.set(id, profile);
      } catch {
        // Best-effort enrichment only.
      }
    }),
  );
  const referrerByRedeemer = new Map(
    referralCodes
      .filter((c) => c.usedBy)
      .map((c) => [c.usedBy as string, c.scoutWallet]),
  );

  return approvals.map((e) => {
    const playerId = e.subjectId as string;
    const profile = profiles.get(playerId);
    return {
      validator: e.actor,
      playerId,
      timestamp: e.timestamp,
      region: profile?.vitals?.region,
      referrerWallet:
        referrerByRedeemer.get(profile?.wallet ?? playerId) ?? null,
    };
  });
}

export interface FraudFlagEvaluationResult {
  flags: FraudFlag[];
  warnings: string[];
}

/**
 * Gathers cross-wallet referral/activity data and runs the pure heuristics
 * in lib/fraudDetection.ts over it. Extracted out of
 * app/api/admin/fraud-flags/route.ts so the exact same evaluation can be
 * driven either by an admin's on-demand page load or by the scheduled cron
 * trigger (app/api/cron/fraud-flags/route.ts) without duplicating the
 * gathering/error-handling logic.
 */
export async function runFraudFlagEvaluation(): Promise<FraudFlagEvaluationResult> {
  let referralFlags: FraudFlag[] = [];
  let referralCodes: ReferralCode[] = [];
  const warnings: string[] = [];
  try {
    referralCodes = await fetchAllReferralCodes();
    referralFlags = analyzeReferralAbuse(referralCodes);
  } catch {
    warnings.push(
      'Referral backend is unavailable — referral heuristics were skipped. Pay-to-contact heuristics below are unaffected.',
    );
  }

  let payToContactFlags: FraudFlag[] = [];
  let validatorFlags: FraudFlag[] = [];
  try {
    const { events, truncated } = await fetchAllActivityEvents();
    payToContactFlags = analyzePayToContactAbuse(events);
    try {
      // Wallets co-flagged by a referral heuristic are treated as one
      // cluster for the circular-approval check.
      validatorFlags = analyzeValidatorAbuse(
        await buildValidatorApprovals(events, referralCodes ?? []),
        { walletClusters: referralFlags.map((f) => f.wallets) },
      );
    } catch {
      warnings.push(
        'Validator heuristics could not be evaluated — other heuristics below are unaffected.',
      );
    }
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

  const flags = [
    ...referralFlags,
    ...payToContactFlags,
    ...validatorFlags,
  ].sort((a, b) => {
    const severityRank = { high: 0, medium: 1, low: 2 } as const;
    return severityRank[a.severity] - severityRank[b.severity];
  });

  applyAutoThrottles(flags);

  return { flags, warnings };
}
