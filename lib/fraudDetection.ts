import type { ActivityEvent } from '@/lib/api';
import type { ReferralCode, FraudFlag } from '@/types';

/**
 * Fraud/abuse heuristics for the referral program and pay-to-contact +
 * subscription flow. See docs/fraud-detection.md for the design rationale,
 * false-positive tradeoffs, and what action is (and isn't) taken on a flag.
 *
 * Every function here is a pure, synchronous transform over already-fetched
 * data — no I/O. Callers (app/api/admin/fraud-flags/route.ts) are
 * responsible for gathering data with cross-wallet visibility (every
 * referral code, the global activity feed) and are the reason this can spot
 * patterns a single request never could.
 */

// ── Tunable thresholds ──────────────────────────────────────────────────────────
// Kept as named constants (not buried in conditionals) so they can be
// re-tuned against real usage data without re-reading the heuristic logic.

/** A code redeemed this soon after being generated looks automated, not organic. */
export const FAST_REDEMPTION_MS = 2 * 60 * 1000; // 2 minutes
/** Require this many redemptions before judging a scout's redemption-speed mix. */
export const MIN_REDEMPTIONS_FOR_SPEED_CHECK = 3;
/** Share of a scout's redemptions that must be "fast" to flag. */
export const FAST_REDEMPTION_RATIO_THRESHOLD = 0.6;

/** Require this many redemptions before judging redeemer concentration. */
export const MIN_REDEMPTIONS_FOR_CONCENTRATION_CHECK = 5;
/** Share of a scout's redemptions from a single redeemer wallet to flag. */
export const CONCENTRATION_RATIO_THRESHOLD = 0.5;

/** A redeemer touching this many distinct scouts' codes looks like one actor farming many "different" scouts. */
export const RING_MIN_DISTINCT_SCOUTS = 4;

/** Contacts within this window that hit the count below look scripted, not human. */
export const CONTACT_BURST_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
export const CONTACT_BURST_MIN_COUNT = 8;

/** Require this many subscriptions before judging subscribe→contact-once→churn cycling. */
export const MIN_SUBSCRIPTIONS_FOR_CYCLING_CHECK = 3;
/** Average contacts per subscription at/below this looks like buying access just to churn. */
export const CYCLING_MAX_CONTACTS_PER_SUBSCRIPTION = 1.5;

// ── Threshold bundle ──────────────────────────────────────────────────────────
// A single object capturing every tunable threshold above. Passing a partial
// override into the `analyze*` entry points lets callers (e.g. the offline
// backtesting harness in lib/fraudBacktest.ts) replay data at arbitrary
// threshold values WITHOUT editing this file — see issue #1183.
export interface FraudThresholds {
  FAST_REDEMPTION_MS: number;
  MIN_REDEMPTIONS_FOR_SPEED_CHECK: number;
  FAST_REDEMPTION_RATIO_THRESHOLD: number;
  MIN_REDEMPTIONS_FOR_CONCENTRATION_CHECK: number;
  CONCENTRATION_RATIO_THRESHOLD: number;
  RING_MIN_DISTINCT_SCOUTS: number;
  CONTACT_BURST_WINDOW_MS: number;
  CONTACT_BURST_MIN_COUNT: number;
  MIN_SUBSCRIPTIONS_FOR_CYCLING_CHECK: number;
  CYCLING_MAX_CONTACTS_PER_SUBSCRIPTION: number;
}

/** The shipped defaults — every threshold constant above, bundled. */
export const DEFAULT_THRESHOLDS: FraudThresholds = {
  FAST_REDEMPTION_MS,
  MIN_REDEMPTIONS_FOR_SPEED_CHECK,
  FAST_REDEMPTION_RATIO_THRESHOLD,
  MIN_REDEMPTIONS_FOR_CONCENTRATION_CHECK,
  CONCENTRATION_RATIO_THRESHOLD,
  RING_MIN_DISTINCT_SCOUTS,
  CONTACT_BURST_WINDOW_MS,
  CONTACT_BURST_MIN_COUNT,
  MIN_SUBSCRIPTIONS_FOR_CYCLING_CHECK,
  CYCLING_MAX_CONTACTS_PER_SUBSCRIPTION,
};

/**
 * Stable, content-derived key identifying "the same flag" across
 * independent runs, for the admin-dismissal layer (issue #1171).
 *
 * `FraudFlag.id` (see `makeFlag` below) already dedupes *within* a single
 * run and is close to this, but deliberately leaves severity out — it only
 * encodes category + heuristic + subject wallets. That's fine for
 * within-run dedup, but wrong for a dismissal key: a dismissal must stop
 * suppressing once the *same* heuristic starts reporting a worse pattern
 * for the *same* wallets (e.g. `fast_redemption_pattern`'s ratio crossing
 * from 'medium' into 'high'), per docs/fraud-detection.md's "What would
 * change this" section — a stale dismissal must never mask a worsening
 * pattern. Folding `severity` into the key handles that: any change to a
 * flag's evidence that's significant enough to move its severity band
 * produces a different key, which was never dismissed, so it resurfaces.
 * Evidence that fluctuates without crossing a severity boundary (e.g. a
 * ratio nudging from 0.61 to 0.64, both 'medium') intentionally keeps the
 * same key — that's "the same flag," not a new one, so a dismissal of it
 * keeps holding.
 *
 * Wallets are sorted before joining so key stability doesn't depend on the
 * heuristic's internal ordering of `flag.wallets`.
 */
export function computeFraudFlagDismissalKey(
  flag: Pick<FraudFlag, 'category' | 'heuristic' | 'severity' | 'wallets'>,
): string {
  const wallets = [...flag.wallets].sort().join(',');
  return `${flag.category}:${flag.heuristic}:${flag.severity}:${wallets}`;
}

function makeFlag(
  category: FraudFlag['category'],
  heuristic: string,
  wallets: string[],
  severity: FraudFlag['severity'],
  reason: string,
  evidence: FraudFlag['evidence'],
): FraudFlag {
  return {
    id: `${category}:${heuristic}:${wallets.join(',')}`,
    category,
    heuristic,
    severity,
    wallets,
    reason,
    evidence,
  };
}

function groupBy<T, K extends string | number>(
  items: T[],
  keyFn: (item: T) => K,
): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

// ── Referral heuristics ─────────────────────────────────────────────────────────

/**
 * Flags codes redeemed by the same wallet that generated them. Unlike the
 * other heuristics here, this one has no false-positive risk at all — it's
 * a definitional violation of "refer someone else" — so it's included as a
 * defense-in-depth surface even where redemption is already blocked at the
 * source (see issue #676). If that guard is ever bypassed or predates this
 * analysis (historical data), it still shows up here.
 */
function detectSelfRedemption(codes: ReferralCode[]): FraudFlag[] {
  return codes
    .filter((c) => c.usedBy && c.usedBy === c.scoutWallet)
    .map((c) =>
      makeFlag(
        'referral',
        'self_redemption',
        [c.scoutWallet],
        'high',
        `Code ${c.code} was generated and redeemed by the same wallet.`,
        { code: c.code, scoutWallet: c.scoutWallet },
      ),
    );
}

/**
 * Flags scouts whose redemptions skew heavily toward near-instant
 * (generate-then-immediately-redeem) turnaround, suggesting the "referred"
 * wallet is scripted or controlled by the same actor rather than an
 * independently-acting friend/player.
 *
 * False-positive guard: requires a minimum redemption volume
 * (`MIN_REDEMPTIONS_FOR_SPEED_CHECK`) before judging a ratio, so one
 * genuinely fast organic redemption out of a scout's first code doesn't
 * get flagged.
 */
function detectFastRedemptionPattern(
  codesByScout: Map<string, ReferralCode[]>,
  t: FraudThresholds,
): FraudFlag[] {
  const flags: FraudFlag[] = [];
  for (const [scoutWallet, codes] of codesByScout) {
    const redeemed = codes.filter(
      (c): c is ReferralCode & { usedBy: string; usedAt: number } =>
        c.usedBy !== null && c.usedAt !== null,
    );
    if (redeemed.length < t.MIN_REDEMPTIONS_FOR_SPEED_CHECK) continue;

    const fast = redeemed.filter(
      (c) => c.usedAt - c.createdAt <= t.FAST_REDEMPTION_MS,
    );
    const ratio = fast.length / redeemed.length;
    if (ratio < t.FAST_REDEMPTION_RATIO_THRESHOLD) continue;

    flags.push(
      makeFlag(
        'referral',
        'fast_redemption_pattern',
        [scoutWallet],
        ratio >= 0.9 ? 'high' : 'medium',
        `${fast.length} of ${redeemed.length} redemptions happened within ${FAST_REDEMPTION_MS / 1000}s of code generation.`,
        {
          redemptions: redeemed.length,
          fastRedemptions: fast.length,
          ratio: Number(ratio.toFixed(2)),
        },
      ),
    );
  }
  return flags;
}

/**
 * Flags scouts where a small number of redeemer wallets account for most of
 * their redemptions — a scout whose "referrals" are really one or two other
 * wallets they (or a partner) also control, rather than a spread of
 * independent people.
 *
 * False-positive guard: requires a minimum redemption volume
 * (`MIN_REDEMPTIONS_FOR_CONCENTRATION_CHECK`) — a brand-new scout with 2
 * redemptions from the same early adopter is normal, not suspicious.
 */
function detectConcentratedRedeemer(
  codesByScout: Map<string, ReferralCode[]>,
  t: FraudThresholds,
): FraudFlag[] {
  const flags: FraudFlag[] = [];
  for (const [scoutWallet, codes] of codesByScout) {
    const redeemed = codes.filter((c) => c.usedBy !== null);
    if (redeemed.length < t.MIN_REDEMPTIONS_FOR_CONCENTRATION_CHECK) continue;

    const byRedeemer = groupBy(redeemed, (c) => c.usedBy as string);
    let topRedeemer = '';
    let topCount = 0;
    for (const [redeemer, list] of byRedeemer) {
      if (list.length > topCount) {
        topCount = list.length;
        topRedeemer = redeemer;
      }
    }
    const ratio = topCount / redeemed.length;
    if (ratio < t.CONCENTRATION_RATIO_THRESHOLD) continue;

    flags.push(
      makeFlag(
        'referral',
        'concentrated_redeemer',
        [scoutWallet, topRedeemer],
        ratio >= 0.8 ? 'high' : 'medium',
        `${topCount} of ${redeemed.length} of this scout's redemptions came from a single wallet.`,
        {
          redemptions: redeemed.length,
          topRedeemerRedemptions: topCount,
          distinctRedeemers: byRedeemer.size,
          ratio: Number(ratio.toFixed(2)),
        },
      ),
    );
  }
  return flags;
}

/**
 * Flags redeemer wallets that have redeemed codes from many distinct
 * scouts — the "one actor controls many different scout accounts" pattern
 * named in the issue. This is keyed on the *redeemer*, not the generator,
 * so it catches rings that `detectConcentratedRedeemer` (per-scout) can't:
 * many scouts, each with diverse-looking redeemers individually, that all
 * happen to share one redeemer in common.
 *
 * False-positive guard: `RING_MIN_DISTINCT_SCOUTS` is set well above what
 * an organic power-redeemer (e.g. someone who signed up via a few different
 * friends' links) would plausibly hit.
 */
function detectCrossScoutRedeemerRing(
  codes: ReferralCode[],
  t: FraudThresholds,
): FraudFlag[] {
  const redeemed = codes.filter((c) => c.usedBy !== null);
  const scoutsByRedeemer = groupBy(redeemed, (c) => c.usedBy as string);

  const flags: FraudFlag[] = [];
  for (const [redeemer, list] of scoutsByRedeemer) {
    const distinctScouts = new Set(list.map((c) => c.scoutWallet));
    if (distinctScouts.size < t.RING_MIN_DISTINCT_SCOUTS) continue;

    flags.push(
      makeFlag(
        'referral',
        'cross_scout_redeemer_ring',
        [redeemer, ...distinctScouts],
        distinctScouts.size >= RING_MIN_DISTINCT_SCOUTS * 2 ? 'high' : 'medium',
        `Wallet redeemed referral codes from ${distinctScouts.size} distinct scouts.`,
        {
          distinctScouts: distinctScouts.size,
          totalRedemptions: list.length,
        },
      ),
    );
  }
  return flags;
}

export function analyzeReferralAbuse(
  codes: ReferralCode[],
  thresholds: FraudThresholds = DEFAULT_THRESHOLDS,
): FraudFlag[] {
  const codesByScout = groupBy(codes, (c) => c.scoutWallet);
  return [
    ...detectSelfRedemption(codes),
    ...detectFastRedemptionPattern(codesByScout, thresholds),
    ...detectConcentratedRedeemer(codesByScout, thresholds),
    ...detectCrossScoutRedeemerRing(codes, thresholds),
  ];
}

// ── Pay-to-contact heuristics ───────────────────────────────────────────────────

function toMs(event: ActivityEvent): number {
  return event.timestamp * 1000; // ActivityEvent.timestamp is Unix seconds
}

/**
 * Flags scouts whose `player_contacted` events cluster far more tightly
 * than a human clicking through profiles would — a burst that looks
 * scripted (e.g. scraping contact details at scale) rather than someone
 * reviewing players one at a time.
 *
 * False-positive guard: the window/count pair (`CONTACT_BURST_WINDOW_MS`,
 * `CONTACT_BURST_MIN_COUNT`) is set well above what a busy scout doing a
 * focused review session could plausibly click through by hand; tune both
 * together against real usage data before relying on this in production.
 */
function detectRapidContactBursts(
  contactsByScout: Map<string, ActivityEvent[]>,
  t: FraudThresholds,
): FraudFlag[] {
  const flags: FraudFlag[] = [];
  for (const [scoutWallet, events] of contactsByScout) {
    if (events.length < t.CONTACT_BURST_MIN_COUNT) continue;

    const timestamps = events.map(toMs).sort((a, b) => a - b);
    let maxInWindow = 1;
    let windowStart = 0;
    for (let i = 0; i < timestamps.length; i++) {
      while (
        timestamps[i] - timestamps[windowStart] >
        t.CONTACT_BURST_WINDOW_MS
      ) {
        windowStart++;
      }
      maxInWindow = Math.max(maxInWindow, i - windowStart + 1);
    }
    if (maxInWindow < t.CONTACT_BURST_MIN_COUNT) continue;

    flags.push(
      makeFlag(
        'pay_to_contact',
        'rapid_contact_burst',
        [scoutWallet],
        maxInWindow >= CONTACT_BURST_MIN_COUNT * 2 ? 'high' : 'medium',
        `${maxInWindow} pay-to-contact calls within ${CONTACT_BURST_WINDOW_MS / 60000} minutes.`,
        {
          maxInWindow,
          windowMinutes: CONTACT_BURST_WINDOW_MS / 60000,
          totalContacts: events.length,
        },
      ),
    );
  }
  return flags;
}

/**
 * Flags scouts who repeatedly subscribe but get very little use out of each
 * subscription — the "pay-to-contact and immediately churn subscriptions"
 * pattern named in the issue: buying just enough access for ~1 contact,
 * letting it lapse, and repeating, rather than subscribing for sustained
 * use.
 *
 * False-positive guard: a scout who is simply an infrequent user (few
 * subscriptions, low usage each time) is not the target here — this only
 * fires once someone has repeated the cycle `MIN_SUBSCRIPTIONS_FOR_CYCLING_CHECK`
 * times, and severity only reaches 'high' when the per-cycle yield is at or
 * below one contact *and* the pattern has repeated at least 5 times, since a
 * single low-usage stretch is unremarkable but a long repeated pattern of
 * minimal yield is the actual cost-minimization signal worth an admin's
 * attention. This heuristic has a higher inherent false-positive rate than
 * the others (a legitimately low-usage scout looks identical from this data
 * alone) — see docs/fraud-detection.md.
 */
function detectSubscriptionCycling(
  subscriptionsByScout: Map<string, ActivityEvent[]>,
  contactsByScout: Map<string, ActivityEvent[]>,
  t: FraudThresholds,
): FraudFlag[] {
  const flags: FraudFlag[] = [];
  for (const [scoutWallet, subs] of subscriptionsByScout) {
    if (subs.length < t.MIN_SUBSCRIPTIONS_FOR_CYCLING_CHECK) continue;

    const contacts = contactsByScout.get(scoutWallet) ?? [];
    const avgContactsPerSubscription = contacts.length / subs.length;
    if (avgContactsPerSubscription > t.CYCLING_MAX_CONTACTS_PER_SUBSCRIPTION) {
      continue;
    }

    const sortedSubs = subs.map(toMs).sort((a, b) => a - b);
    const gaps = sortedSubs.slice(1).map((t, i) => t - sortedSubs[i]);
    const avgGapMs =
      gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;

    const severity =
      avgContactsPerSubscription <= 1 && subs.length >= 5 ? 'high' : 'medium';

    flags.push(
      makeFlag(
        'pay_to_contact',
        'subscription_cycling',
        [scoutWallet],
        severity,
        `${subs.length} subscriptions averaging ${avgContactsPerSubscription.toFixed(1)} contacts each.`,
        {
          subscriptions: subs.length,
          totalContacts: contacts.length,
          avgContactsPerSubscription: Number(
            avgContactsPerSubscription.toFixed(2),
          ),
          avgGapDays: Number((avgGapMs / 86_400_000).toFixed(1)),
        },
      ),
    );
  }
  return flags;
}

export function analyzePayToContactAbuse(
  events: ActivityEvent[],
  thresholds: FraudThresholds = DEFAULT_THRESHOLDS,
): FraudFlag[] {
  const contactsByScout = groupBy(
    events.filter((e) => e.type === 'player_contacted'),
    (e) => e.actor,
  );
  const subscriptionsByScout = groupBy(
    events.filter((e) => e.type === 'scout_subscribed'),
    (e) => e.actor,
  );

  return [
    ...detectRapidContactBursts(contactsByScout, thresholds),
    ...detectSubscriptionCycling(
      subscriptionsByScout,
      contactsByScout,
      thresholds,
    ),
  ];
}

export {
  type WalletReferralAggregate,
  type WalletPayToContactAggregate,
  type WalletFraudAggregate,
  type IncrementalFraudState,
  type IncrementalStepResult,
  createInitialIncrementalState,
  createEmptyWalletAggregate,
  applyReferralCode,
  applyActivityEvent,
  evaluateRulesForWallet,
  updateActiveFlagsForChangedWallets,
  runIncrementalStep,
} from './fraudIncremental';
