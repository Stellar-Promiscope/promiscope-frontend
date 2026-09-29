// ── Progress ──────────────────────────────────────────────────────────────────
export type ProgressLevel = 0 | 1 | 2 | 3;

export const PROGRESS_LABELS: Record<ProgressLevel, string> = {
  0: 'Unverified',
  1: 'Verified Identity',
  2: 'Performance Milestones',
  3: 'Elite Tier',
};

// ── Player Stats ──────────────────────────────────────────────────────────────
export interface PlayerStats {
  goals: number;
  assists: number;
  appearances: number;
  clean_sheets?: number;
}

// ── Player ────────────────────────────────────────────────────────────────────
export interface PlayerVitals {
  name: string;
  age: number;
  position: string;
  region: string;
  nationality: string;
}

export interface Milestone {
  id: string;
  description: string;
  evidenceHash: string; // IPFS CID of supporting media
  validator: string; // Stellar address of approving validator
  timestamp: number; // Unix timestamp from ledger
}

/**
 * An off-chain academy-quorum endorsement of an already-on-chain-approved
 * milestone (issue #1185). See lib/milestoneEndorsementStore.ts.
 */
export interface MilestoneEndorsement {
  playerId: string;
  milestoneId: string;
  wallet: string; // endorsing academy-member wallet
  createdAt: number; // Unix ms
}

export interface Player {
  id: string;
  wallet: string;
  vitals: PlayerVitals;
  stats?: PlayerStats;
  ipfsHash: string; // Latest highlight reel CID
  progressLevel: ProgressLevel;
  milestones: Milestone[];
  createdAt: number;
  archived?: boolean; // Off-chain archive flag; defaults to false
  backupWallet?: string; // Optional recovery/backup wallet address
  backupWalletVerifiedAt?: number; // Timestamp when backup was verified with primary wallet signature
}

// ── Validator ────────────────────────────────────────────────────────────────────

/**
 * Represents an approved validator's on-chain record as stored in the contract.
 */
export interface ValidatorInfo {
  /** Stellar public key of the validator. */
  address: string;

  /**
   * Unix timestamp (seconds) when this validator was added to the contract.
   * Sourced directly from the ledger close time at the time of the `add_validator`
   * transaction.
   */
  addedAt: number;

  /**
   * Stellar public key of the admin wallet that authorized this validator.
   * Recorded on-chain at the time of the `add_validator` call.
   */
  addedBy: string;
}

/**
 * An off-chain milestone claim awaiting a validator's on-chain approval
 * (issues #567, #568). Distinct from {@link Milestone}, which only exists
 * once a validator has already approved one.
 */
export interface MilestoneSubmission {
  id: string;
  playerId: string;
  playerName: string | null;
  description: string;
  evidenceUrl: string | null;
  validatorWallet: string;
  submittedBy: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  decidedAt: number | null;
  txHash: string | null;
}

// ── Academy ──────────────────────────────────────────────────────────────────
/**
 * An off-chain grouping of validator wallets under one institutional
 * identity (e.g. a football academy with several coaching staff). This is
 * purely an off-chain overlay — each member wallet must still be
 * individually authorized on-chain via `add_validator` for its milestone
 * approvals to be valid. See docs/academy-validator-model.md.
 */
export interface Academy {
  id: string;
  name: string;
  /** Stellar public key of the wallet that owns/manages this academy record. */
  ownerWallet: string;
  createdAt: number;
  members: AcademyMember[];
  /**
   * Optional milestone-approval quorum (issue #1185): the minimum number of
   * this academy's distinct member wallets that must each endorse a
   * milestone before it's shown as "academy-verified" in the UI. `null`
   * (the default) means no quorum is configured — behaves identically to
   * before this feature existed. Purely an off-chain display/workflow
   * setting; never affects on-chain `approve_milestone` authorization,
   * which stays single-signer regardless of this value.
   */
  quorum: number | null;
}

/** One wallet registered as a signer under an {@link Academy}. */
export interface AcademyMember {
  wallet: string;
  academyId: string;
  addedAt: number;
  /** Stellar public key of the admin who registered this wallet under the academy. */
  addedBy: string;
}

/**
 * One academy's total approved-milestone count across its member wallets
 * for a given time range (issue #1172 — see docs/academy-validator-model.md,
 * "Academy milestone rollup"). `approvedMilestones` is `null` when the
 * indexer couldn't be reached, matching `fetchValidatorMilestoneCount`'s
 * fail-open convention rather than surfacing 0 (which would read as "no
 * milestones" instead of "unknown").
 */
export interface AcademyMilestoneRollupEntry {
  academyId: string;
  academyName: string;
  memberCount: number;
  approvedMilestones: number | null;
}

export interface AcademyMilestoneRollup {
  range: { start: number; end: number };
  /** False when the indexer request failed — every entry's approvedMilestones is null in that case. */
  indexerAvailable: boolean;
  academies: AcademyMilestoneRollupEntry[];
}

// ── Scout ─────────────────────────────────────────────────────────────────────
export type SubscriptionTier = 'basic' | 'pro' | 'elite';

export interface Scout {
  id: string;
  wallet: string;
  name: string;
  organisation: string;
  subscriptionTier: SubscriptionTier;
  subscriptionExpiry: number; // Unix timestamp
  contactedPlayers: string[]; // player IDs
}

// ── Subscription ──────────────────────────────────────────────────────────────
/**
 * Represents a scout's subscription details.
 */
export interface Subscription {
  scout: string; // Stellar address
  tier: SubscriptionTier;
  expiresAt: number; // Unix timestamp
}

// ── Filter ────────────────────────────────────────────────────────────────────
export interface PlayerFilter {
  region?: string;
  position?: string;
  minLevel?: ProgressLevel;
}

// ── Contact Details ───────────────────────────────────────────────────────────
/**
 * Contact information returned after pay-to-contact is unlocked for a player.
 * At least one field must be present. Validation of the requirement is enforced
 * at the contract level to ensure data integrity.
 */
export interface ContactDetails {
  email?: string;
  phone?: string;
  telegram?: string;
}

// ── Trial Offer ───────────────────────────────────────────────────────────────
export type TrialOfferType = 'trial' | 'loan' | 'transfer';

export interface TrialOfferDetails {
  clubName: string;
  offerType: TrialOfferType;
  message?: string;
}

// ── Referral / Invite ─────────────────────────────────────────────────────────
export interface ReferralCode {
  code: string;
  scoutWallet: string;
  createdAt: number;
  usedBy: string | null;
  usedAt: number | null;
}

export interface ReferralStats {
  totalCodes: number;
  successfulReferrals: number;
}

export interface TopReferrer {
  scoutWallet: string;
  totalCodes: number;
  successfulReferrals: number;
}

export interface ReferralOverview {
  totalCodes: number;
  totalSuccessfulReferrals: number;
  topReferrers: TopReferrer[];
}

// ── Fraud / abuse detection ────────────────────────────────────────────────────
export type FraudFlagCategory = 'referral' | 'pay_to_contact' | 'validator';

export type FraudFlagSeverity = 'low' | 'medium' | 'high';

export interface FraudFlag {
  /** Stable id derived from category + heuristic + subject, so re-runs dedupe. */
  id: string;
  category: FraudFlagCategory;
  /** Which heuristic in lib/fraudDetection.ts produced this flag. */
  heuristic: string;
  severity: FraudFlagSeverity;
  /** Wallet(s) the flag is about, in the order most relevant to the heuristic. */
  wallets: string[];
  /** One-line, human-readable explanation for the admin panel. */
  reason: string;
  /** Structured numbers backing `reason`, shown expanded for investigation. */
  evidence: Record<string, number | string | string[]>;
}

// ── Admin-gated auto-throttling (issue #1174) ──────────────────────────────

export type FraudThrottleStatus = 'throttled' | 'lifted';

/**
 * A wallet placed in a throttled state by an auto-throttle-eligible
 * FraudFlag (see lib/fraudFlagsRunner.ts's applyAutoThrottles). Never
 * auto-expires — `status` only ever moves to 'lifted' via an explicit
 * admin action (POST /api/admin/fraud-flags/throttles/:id/lift).
 */
export interface FraudThrottle {
  id: number;
  wallet: string;
  heuristic: string;
  category: FraudFlagCategory;
  flagId: string;
  reason: string;
  evidence: Record<string, unknown>;
  status: FraudThrottleStatus;
  throttledAt: number;
  liftedAt: number | null;
  liftedBy: string | null;
  liftReason: string | null;
}

// ── Admin decisions on fraud flags (issue #1171) ────────────────────────────

/**
 * An admin's decision to dismiss a specific, content-keyed fraud flag as a
 * false positive so it stops re-surfacing on every panel load. Keyed by
 * `computeFraudFlagDismissalKey` (lib/fraudDetection.ts), not a database id
 * carried on the flag itself — flags are recomputed from scratch on every
 * run, so there is no such id to key on. See lib/fraudFlagDismissalStore.ts.
 */
export interface FraudFlagDismissal {
  id: number;
  flagKey: string;
  category: FraudFlagCategory;
  heuristic: string;
  severity: FraudFlagSeverity;
  wallets: string[];
  /** Snapshot of `FraudFlag.reason` at the time of dismissal, for display. */
  flagReason: string;
  /** Optional free-form context the dismissing admin left. */
  note: string | null;
  dismissedBy: string;
  dismissedAt: number;
}

// ── Contract call helpers ─────────────────────────────────────────────────────
export interface ContractCallResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ── Watchlist / Saved Search ────────────────────────────────────────────────
export interface WatchlistEntry {
  id: number;
  scoutWallet: string;
  playerId: string;
  createdAt: number; // Unix ms
  version?: number;
}

export interface SavedSearch {
  id: number;
  scoutWallet: string;
  name: string;
  filter: PlayerFilter;
  createdAt: number; // Unix ms
  lastViewedAt: number; // Unix ms — when the scout last opened this search's results
  version?: number;
}

// ── Notifications ────────────────────────────────────────────────────────────
/**
 * Wallet-relevant event categories surfaced in the notification center
 * (issue #557): milestone approvals for players, contact unlocks for
 * scouts. Mirrors a subset of `IndexedEventType` (lib/indexerClient.ts) —
 * only the two event types that map to something a player or scout would
 * actually want to be notified about.
 */
export type NotificationCategory = 'milestone_approval' | 'contact_unlock';

export interface Notification {
  /** The underlying indexer event's id — globally unique, used as the read-state key. */
  id: number;
  category: NotificationCategory;
  title: string;
  message: string;
  createdAt: number; // Unix seconds, from the source event's ledger close time
  read: boolean;
  playerId: string | null;
}

/**
 * Per-wallet toggles for which notification categories generate in-app
 * notifications (issue #560). Keys match {@link NotificationCategory}.
 */
export interface NotificationPreferences {
  milestoneApprovals: boolean;
  contactUnlocks: boolean;
  version?: number;
}

// ── Milestone Disputes ────────────────────────────────────────────────────────
/**
 * Off-chain moderation record for a player-raised dispute over a milestone
 * decision (issue #562, extended in the evidence-exchange PR).
 *
 * Status lifecycle:
 *   opened → pending  (dispute filed, validator notified)
 *   pending → under_review  (validator responded)
 *   pending → escalated   (response window elapsed, no response)
 *   under_review / escalated → upheld | reversed  (admin decides)
 *
 * 'reversed' means the admin also submitted an on-chain revoke_milestone
 * call (lib/contract.ts submitAndConfirmRevokeMilestone); the resulting
 * tx hash is stored in `revokeTxHash`. This record never triggers a contract
 * call by itself, it only tracks the outcome.
 */
export type MilestoneDisputeStatus =
  | 'pending'
  | 'under_review'
  | 'escalated'
  | 'upheld'
  | 'reversed';

export interface MilestoneDispute {
  id: number;
  playerId: string;
  playerWallet: string;
  /** Stellar public key of the validator who approved the disputed milestone. */
  validatorWallet: string;
  milestoneId: string;
  milestoneDescription: string;
  reason: string;
  status: MilestoneDisputeStatus;
  createdAt: number;     // Unix ms
  /** UTC deadline by which the validator must respond (Unix ms). */
  responseDeadline: number;
  decidedAt: number | null;  // Unix ms
  decidedBy: string | null;  // admin wallet
  resolutionNote: string | null;
  /** Set only when status is 'reversed' — the on-chain revoke_milestone tx hash. */
  revokeTxHash: string | null;
}

/**
 * Possible event types in a dispute's audit timeline.
 *
 * - opened          — the player filed the dispute
 * - evidence_added  — player or validator attached an IPFS evidence item
 * - validator_response — the validator submitted their textual response
 * - admin_note      — the admin recorded an internal note mid-review
 * - decided         — the admin made a final decision (upheld / reversed)
 * - escalated       — the response window elapsed without a validator response
 */
export type DisputeEventType =
  | 'opened'
  | 'evidence_added'
  | 'validator_response'
  | 'admin_note'
  | 'decided'
  | 'escalated';

export interface DisputeEvent {
  id: number;
  disputeId: number;
  type: DisputeEventType;
  /** Wallet address of the actor (player, validator, admin, or 'system'). */
  actorWallet: string;
  /** Optional free-text (reason, note, validator response body). */
  body: string | null;
  /** IPFS CID of an attached evidence file, if any. */
  ipfsHash: string | null;
  /** MIME type of the evidence (e.g. 'image/jpeg', 'video/mp4'). */
  ipfsMimeType: string | null;
  createdAt: number; // Unix ms
}

/** A dispute with its full ordered event timeline for the admin timeline view. */
export interface DisputeWithEvents extends MilestoneDispute {
  events: DisputeEvent[];
}

// â”€â”€ Recently Viewed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface RecentlyViewedEntry {
  id: number;
  playerId: string;
  name: string;
  position: string;
  viewedAt: number; // Unix ms
}
