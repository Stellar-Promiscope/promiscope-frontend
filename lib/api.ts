import axios from 'axios';
import type { Player } from '@/types';
import { fetchWithRetry } from './fetchWithRetry';
import { fetchValidatorEvents, type IndexedEvent } from './indexerClient';
import type { ValidatorLeaderboardRange } from './validatorLeaderboard';
import type { ScoutContact } from './scoutContactsCsv';

// `API_URL_INTERNAL` (server-only, no NEXT_PUBLIC_ prefix) lets a Server
// Component's SSR-time fetch reach the backend via a container-internal
// hostname (e.g. Docker Compose's `http://mock-api:4000`) while the browser
// bundle still uses the public `NEXT_PUBLIC_API_URL` — since it isn't
// NEXT_PUBLIC_-prefixed, this only ever resolves server-side; the browser
// bundle sees `undefined` here and falls through. See docker-compose.yml.
const api = axios.create({
  baseURL:
    process.env.API_URL_INTERNAL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:4000',
  headers: { 'Content-Type': 'application/json' },
});

// Players
export const fetchPlayerProfile = (playerId: string) =>
  api.get(`/players/${playerId}`).then((r) => r.data);

/**
 * Thrown when the player search proxy (app/api/players/search/route.ts)
 * rate-limits the caller. `retryAfterSec` mirrors the response's
 * Retry-After header so callers can back off appropriately.
 */
export class SearchRateLimitedError extends Error {
  retryAfterSec: number;
  constructor(retryAfterSec: number) {
    super('Too many search requests. Please slow down.');
    this.name = 'SearchRateLimitedError';
    this.retryAfterSec = retryAfterSec;
  }
}

// Routed through app/api/players/search/route.ts (same-origin), not the
// external backend directly — that route applies per-IP rate limiting on
// top of the client-side debouncing in ScoutDashboardContent.
export const searchPlayersByName = async (name: string): Promise<Player[]> => {
  const res = await fetchWithRetry(
    `/api/players/search?name=${encodeURIComponent(name)}`,
  );
  if (res.status === 429) {
    const retryAfterSec = Number(res.headers.get('Retry-After') ?? '0');
    throw new SearchRateLimitedError(retryAfterSec);
  }
  if (!res.ok) {
    throw new Error('Failed to search players');
  }
  return res.json();
};

export const fetchPlayerComments = (playerId: string) =>
  api.get(`/players/${playerId}/comments`).then((r) => r.data);

export const archivePlayerProfile = (playerId: string): Promise<Player> =>
  api.post(`/players/${playerId}/archive`).then((r) => r.data);

export const unarchivePlayerProfile = (playerId: string): Promise<Player> =>
  api.post(`/players/${playerId}/unarchive`).then((r) => r.data);

export const linkBackupWallet = (
  playerId: string,
  backupWallet: string,
  signature: string,
): Promise<Player> =>
  api
    .post(`/players/${playerId}/backup-wallet/link`, {
      backupWallet,
      signature,
    })
    .then((r) => r.data);

export const removeBackupWallet = (playerId: string): Promise<Player> =>
  api.post(`/players/${playerId}/backup-wallet/remove`).then((r) => r.data);

export const claimAccountWithBackupWallet = (
  primaryWallet: string,
  backupWallet: string,
): Promise<{ playerId: string; wallet: string }> =>
  api
    .post('/players/recovery/claim', { primaryWallet, backupWallet })
    .then((r) => r.data);

// Scouts
export const fetchScoutProfile = (scoutId: string) =>
  api.get(`/scouts/${scoutId}`).then((r) => r.data);

export const fetchScoutContacts = (scoutId: string): Promise<ScoutContact[]> =>
  api.get(`/scouts/${scoutId}/contacts`).then((r) => r.data);

export interface ScoutStats {
  contactedCount: number;
  trialOffersCount: number;
}

export const fetchScoutStats = (scoutId: string): Promise<ScoutStats> =>
  api.get(`/scouts/${scoutId}/stats`).then((r) => r.data);

// Web Push (issue #558) — the backend stores the PushSubscription and sends
// a Web Push message (VAPID-signed) when a validator approves a milestone.
export const subscribeToPush = (
  wallet: string,
  subscription: PushSubscriptionJSON,
) => api.post('/push/subscriptions', { wallet, subscription });

export const unsubscribeFromPush = (wallet: string, endpoint: string) =>
  api.delete('/push/subscriptions', { data: { wallet, endpoint } });

// Chat
export const fetchChatHistory = (roomId: string) =>
  api.get(`/chat/${roomId}`).then((r) => r.data);

export const postChatMessage = (
  roomId: string,
  message: string,
  sender: string,
) => api.post(`/chat/${roomId}`, { message, sender }).then((r) => r.data);

// Admin activity feed
export type ActivityEventType =
  | 'player_registered'
  | 'milestone_approved'
  | 'milestone_revoked'
  | 'scout_subscribed'
  | 'player_contacted'
  | 'fees_withdrawn';

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  timestamp: number;
  actor: string;
  subjectId?: string;
}

export const fetchActivityEvents = (
  page = 1,
  pageSize = 20,
): Promise<{ events: ActivityEvent[]; total: number }> =>
  api
    .get('/admin/activity', { params: { page, pageSize } })
    .then((r) => r.data);

// Validators
/**
 * Fetches the number of milestones approved by a specific validator from the
 * indexer. Returns `null` when the indexer is unavailable or returns an
 * unexpected response so callers can fall back gracefully.
 */
export const fetchValidatorMilestoneCount = async (
  validatorAddress: string,
  range?: { start: number; end: number },
): Promise<number | null> => {
  try {
    if (range) {
      const events: IndexedEvent[] = [];
      let before: number | undefined;
      for (let page = 0; page < 10; page++) {
        const result = await fetchValidatorEvents(validatorAddress, {
          type: 'milestone_approved',
          limit: 200,
          before,
        });
        events.push(...result.events);
        if (result.nextCursor === null || result.events.length === 0) break;
        before = result.nextCursor;
      }
      return events.filter(
        (event) =>
          event.timestamp >= range.start && event.timestamp <= range.end,
      ).length;
    }

    const data = await api
      .get(`/validators/${encodeURIComponent(validatorAddress)}/stats`)
      .then((r) => r.data);
    const count = data?.milestoneCount ?? data?.milestone_count;
    return typeof count === 'number' ? count : null;
  } catch {
    return null;
  }
};

// Referrals
//
// Backed by the Node.js off-chain API (server/) — a real SQLite-backed
// service, not a local Next.js route reading/writing a JSON file. Follows
// the same shared-axios-client pattern as the chat helpers above.
import type {
  ReferralCode,
  ReferralStats,
  ReferralOverview,
  FraudFlag,
  FraudThrottle,
  FraudFlagDismissal,
} from '@/types';

export const generateReferralCode = (
  scoutWallet: string,
  turnstileToken?: string,
): Promise<ReferralCode> =>
  api
    .post('/referrals/generate', { scoutWallet, turnstileToken })
    .then((r) => r.data);

export const getReferralStats = (scoutWallet: string): Promise<ReferralStats> =>
  api
    .get(`/referrals/count/${encodeURIComponent(scoutWallet)}`)
    .then((r) => r.data);

export const listReferralCodes = (
  scoutWallet: string,
): Promise<ReferralCode[]> =>
  api
    .get(`/referrals/scout/${encodeURIComponent(scoutWallet)}`)
    .then((r) => r.data);

/**
 * Checks issue #1174's admin-gated auto-throttle state for `wallet` via this
 * app's own /api/fraud/throttle-status (never the external referral/activity
 * backend `api` above — throttle state is local to this Next.js deployment).
 * Fails open (`false`) on any network/parse error, matching this repo's
 * existing precedent of never letting an auxiliary check block a core flow
 * outright on its own failure — a throttle is enforced when confirmed
 * throttled, not merely when the check itself couldn't be reached.
 */
export const checkFraudThrottle = async (wallet: string): Promise<boolean> => {
  try {
    const res = await fetch(
      `/api/fraud/throttle-status?wallet=${encodeURIComponent(wallet)}`,
    );
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.throttled);
  } catch {
    return false;
  }
};

export const REFERRAL_THROTTLE_MESSAGE =
  'This wallet is temporarily unable to redeem referral codes while under review. If you believe this is a mistake, please contact support.';

export const redeemReferralCode = async (
  code: string,
  usedBy: string,
): Promise<boolean> => {
  if (await checkFraudThrottle(usedBy)) {
    return false;
  }
  return api
    .post('/referrals/redeem', { code, usedBy })
    .then(() => true)
    .catch(() => false);
};

// ── Sponsorship waitlist ───────────────────────────────────────────────────
//
// Backed by the server/ Express API (SQLite), not the local filesystem
// pattern used by the referral store.

export type InterestType = 'fan' | 'investor' | 'sponsor';

export const joinSponsorshipWaitlist = (
  email: string,
  interestType: InterestType = 'fan',
  turnstileToken?: string,
): Promise<{ message: string }> =>
  api
    .post('/sponsorship/waitlist', { email, interestType, turnstileToken })
    .then((r) => r.data);

export const fetchAllReferralCodes = (): Promise<ReferralCode[]> =>
  api.get('/referrals/all').then((r) => r.data);

export const getReferralOverview = async (): Promise<ReferralOverview> => {
  const res = await fetchWithRetry('/api/admin/referrals');
  if (!res.ok) throw new Error('Failed to fetch referral overview');
  return res.json();
};

// Fraud / abuse detection (admin only)
export const fetchFraudFlags = async (): Promise<{
  flags: FraudFlag[];
  warnings: string[];
  evaluatedAt: number;
}> => {
  const res = await fetchWithRetry('/api/admin/fraud-flags');
  if (!res.ok) throw new Error('Failed to fetch fraud flags');
  return res.json();
};

/**
 * Lightweight status of the most recently *persisted* fraud-flag
 * evaluation (issue #1007) — populated by either an admin panel load or
 * the scheduled cron trigger, whichever ran most recently. Used to render
 * a staleness indicator without paying the cost of a full evaluation.
 */
export const fetchFraudFlagsStatus = async (): Promise<{
  evaluatedAt: number | null;
  highSeverityCount: number;
  trigger: 'manual' | 'cron' | null;
}> => {
  const res = await fetchWithRetry('/api/admin/fraud-flags/status');
  if (!res.ok) throw new Error('Failed to fetch fraud flags status');
  return res.json();
};

/**
 * The admin-auditable trail for issue #1174's admin-gated auto-throttling —
 * full history (active and lifted), most recently placed first.
 */
export const fetchFraudThrottles = async (): Promise<{
  throttles: FraudThrottle[];
}> => {
  const res = await fetchWithRetry('/api/admin/fraud-flags/throttles');
  if (!res.ok) throw new Error('Failed to fetch fraud throttles');
  return res.json();
};

/**
 * The only way a throttle changes state — no automatic expiry exists
 * anywhere in this codebase, per docs/fraud-detection.md.
 *
 * Deliberately a bare `fetch`, not `fetchWithRetry`: a POST with no
 * idempotency key, so an automatic retry after a lost response risks a
 * confusing double-lift attempt.
 */
export const liftFraudThrottle = async (
  id: number,
  reason?: string,
): Promise<FraudThrottle> => {
  const res = await fetch(`/api/admin/fraud-flags/throttles/${id}/lift`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error('Failed to lift fraud throttle');
  return res.json();
};

/**
 * Persists an admin decision that `flag` is reviewed and not actually abuse
 * (issue #1171), so it stops re-surfacing on subsequent `fetchFraudFlags`
 * loads as long as the underlying evidence hasn't materially changed. See
 * lib/fraudFlagDismissalStore.ts and app/api/admin/fraud-flags/dismiss/route.ts.
 *
 * Deliberately a bare `fetch`, not `fetchWithRetry`: a POST with no
 * idempotency key, matching liftFraudThrottle's precedent above.
 */
export const dismissFraudFlag = async (
  flag: Pick<
    FraudFlag,
    'category' | 'heuristic' | 'severity' | 'wallets' | 'reason'
  >,
  note?: string,
): Promise<FraudFlagDismissal> => {
  const res = await fetch('/api/admin/fraud-flags/dismiss', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flag, note }),
  });
  if (!res.ok) throw new Error('Failed to dismiss fraud flag');
  return res.json();
};

// Academies (issue #663) — off-chain grouping of validator wallets under one
// institutional identity. Admin-write endpoints go through the session-cookie-
// gated Next.js proxy (app/api/admin/academies/**), matching the referrals
// admin pattern above. The wallet-lookup read is public and unauthenticated,
// hitting the backend directly (matching fetchValidatorMilestoneCount below).
import type { Academy } from '@/types';

async function parseErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.error === 'string' ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export const fetchAcademies = async (): Promise<Academy[]> => {
  const res = await fetchWithRetry('/api/admin/academies');
  if (!res.ok)
    throw new Error(await parseErrorMessage(res, 'Failed to fetch academies'));
  return res.json();
};

/**
 * Scoped academy-owner admin role (issue #1173) — returns the academy/
 * academies the *connected* wallet is recorded as `ownerWallet` for, via
 * the session cookie (not the super-admin-gated full list above). Used by
 * AcademyOwnerManager to find which academy(ies) it may self-serve.
 */
export const fetchMyAcademies = async (): Promise<Academy[]> => {
  const res = await fetchWithRetry('/api/admin/academies/mine');
  if (!res.ok)
    throw new Error(
      await parseErrorMessage(res, 'Failed to fetch your academies'),
    );
  return res.json();
};

// createAcademy/addAcademyMember deliberately use a bare `fetch`, not
// `fetchWithRetry`: both are POSTs with no idempotency key, so an automatic
// retry after a lost response risks creating a duplicate academy or
// membership row.
export const createAcademy = async (
  name: string,
  ownerWallet: string,
): Promise<Academy> => {
  const res = await fetch('/api/admin/academies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ownerWallet }),
  });
  if (!res.ok)
    throw new Error(await parseErrorMessage(res, 'Failed to create academy'));
  return res.json();
};

export const addAcademyMember = async (
  academyId: string,
  wallet: string,
): Promise<Academy> => {
  const res = await fetch(
    `/api/admin/academies/${encodeURIComponent(academyId)}/members`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet }),
    },
  );
  if (!res.ok)
    throw new Error(
      await parseErrorMessage(res, 'Failed to add signer wallet'),
    );
  return res.json();
};

export const removeAcademyMember = async (
  academyId: string,
  wallet: string,
): Promise<void> => {
  const res = await fetchWithRetry(
    `/api/admin/academies/${encodeURIComponent(academyId)}/members/${encodeURIComponent(wallet)}`,
    { method: 'DELETE' },
  );
  if (!res.ok)
    throw new Error(
      await parseErrorMessage(res, 'Failed to remove signer wallet'),
    );
};

/**
 * Sets (or, with `quorum: null`, clears) an academy's milestone-approval
 * quorum (issue #1185). See types/index.ts's `Academy.quorum` doc comment —
 * purely off-chain display/workflow, never on-chain authorization.
 */
export const setAcademyQuorum = async (
  academyId: string,
  quorum: number | null,
): Promise<Academy> => {
  const res = await fetchWithRetry(
    `/api/admin/academies/${encodeURIComponent(academyId)}/quorum`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quorum }),
    },
  );
  if (!res.ok)
    throw new Error(await parseErrorMessage(res, 'Failed to set quorum'));
  return res.json();
};

/**
 * Looks up the academy a validator wallet is registered under, for
 * milestone-attribution display. Returns `null` when the wallet isn't part
 * of any academy or the lookup fails, so callers (e.g. ValidatorChip) can
 * fall back to address-only display — this is enrichment, not a gate.
 */
export const fetchAcademyForWallet = async (
  wallet: string,
): Promise<Academy | null> => {
  try {
    const data = await api
      .get(`/academies/wallet/${encodeURIComponent(wallet)}`)
      .then((r) => r.data);
    return data ?? null;
  } catch {
    return null;
  }
};

import type { AcademyMilestoneRollup, MilestoneEndorsement } from '@/types';

/**
 * Off-chain academy-quorum endorsements for a milestone (issue #1185).
 * Public/unauthenticated — enrichment for the "N of M academy signers"
 * badge, never an on-chain gate. See
 * app/api/milestones/[playerId]/[milestoneId]/endorsements/route.ts.
 */
export const fetchMilestoneEndorsements = async (
  playerId: string,
  milestoneId: string,
): Promise<MilestoneEndorsement[]> => {
  const res = await fetchWithRetry(
    `/api/milestones/${encodeURIComponent(playerId)}/${encodeURIComponent(
      milestoneId,
    )}/endorsements`,
  );
  if (!res.ok)
    throw new Error(
      await parseErrorMessage(res, 'Failed to fetch milestone endorsements'),
    );
  const data = await res.json();
  return data.endorsements ?? [];
};

/**
 * Records the caller's own off-chain endorsement of an
 * already-on-chain-approved milestone (issue #1185). Requires a session
 * whose wallet is a validator in the same academy as the approving
 * validator; never triggers an on-chain `approve_milestone`.
 */
export const endorseMilestone = async (
  playerId: string,
  milestoneId: string,
): Promise<void> => {
  const res = await fetchWithRetry(
    `/api/milestones/${encodeURIComponent(playerId)}/${encodeURIComponent(
      milestoneId,
    )}/endorsements`,
    { method: 'POST' },
  );
  if (!res.ok)
    throw new Error(
      await parseErrorMessage(res, 'Failed to endorse milestone'),
    );
};

/**
 * Academy-scoped milestone-approval rollup (issue #1172): total approved
 * milestones per academy, summed across its member wallets, for the last
 * `rangeDays` days (or all-time when `rangeDays` is `'all'`). See
 * docs/academy-validator-model.md's "Academy milestone rollup" section for
 * the historical-attribution caveat this carries.
 */
export const fetchAcademyMilestoneRollup = async (
  rangeDays: number | 'all' = 30,
): Promise<AcademyMilestoneRollup> => {
  const res = await fetchWithRetry(
    `/api/admin/academies/rollup?rangeDays=${rangeDays}`,
  );
  if (!res.ok)
    throw new Error(
      await parseErrorMessage(res, 'Failed to fetch academy milestone rollup'),
    );
  return res.json();
};

// Milestone submissions (issues #567, #568) — an off-chain queue of
// milestone claims awaiting validator review. See server/src/db.js for the
// schema; this table models the "not yet approved" state the contract has
// no concept of.
import type { MilestoneSubmission } from '@/types';

export const fetchPendingMilestoneSubmissions = (
  validatorWallet: string,
): Promise<MilestoneSubmission[]> =>
  api
    .get(
      `/milestone-submissions/validator/${encodeURIComponent(validatorWallet)}`,
      {
        params: { status: 'pending' },
      },
    )
    .then((r) => r.data);

export const decideMilestoneSubmission = (
  id: string,
  status: 'approved' | 'rejected',
  txHash?: string | null,
): Promise<MilestoneSubmission> =>
  api
    .patch(`/milestone-submissions/${encodeURIComponent(id)}`, {
      status,
      txHash,
    })
    .then((r) => r.data);

export const createMilestoneSubmission = (payload: {
  playerId: string;
  playerName?: string;
  description: string;
  evidenceUrl?: string;
  validatorWallet: string;
  submittedBy: string;
}): Promise<MilestoneSubmission> =>
  api.post('/milestone-submissions', payload).then((r) => r.data);

export default api;

// #851: duplicate redeemReferralCode removed
