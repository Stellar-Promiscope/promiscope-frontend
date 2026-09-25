import axios from 'axios';
import type { Milestone } from '@/types';

/**
 * Client for packages/indexer's query API — the off-chain, SQLite-backed
 * event store that lets the frontend read historical contract activity
 * without hitting Horizon/Soroban RPC on every page load (see
 * packages/indexer/README.md, "Querying Indexed Data").
 */
const indexerApi = axios.create({
  baseURL: process.env.NEXT_PUBLIC_INDEXER_API_URL ?? 'http://localhost:3001',
  headers: { 'Content-Type': 'application/json' },
  timeout: 5000,
});

export type IndexedEventType =
  | 'player_registered'
  | 'milestone_approved'
  | 'milestone_revoked'
  | 'scout_subscribed'
  | 'player_contacted'
  | 'trial_offer_logged'
  | 'fees_withdrawn';

export interface IndexedEvent {
  id: number;
  type: IndexedEventType;
  playerId: string | null;
  scout: string | null;
  validator: string | null;
  ledger: number;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface IndexedEventsPage {
  events: IndexedEvent[];
  nextCursor: number | null;
}

export interface EventQueryParams {
  type?: IndexedEventType;
  limit?: number;
  before?: number;
  after?: number;
}

/** Generic event query against GET /events — same filter shape as the player/validator-scoped variants. */
export const fetchEvents = (
  params: EventQueryParams = {},
): Promise<IndexedEventsPage> =>
  indexerApi.get('/events', { params }).then((r) => r.data);

export const fetchPlayerEvents = (
  playerId: string,
  params: EventQueryParams = {},
): Promise<IndexedEventsPage> =>
  indexerApi
    .get(`/players/${encodeURIComponent(playerId)}/events`, { params })
    .then((r) => r.data);

export const fetchValidatorEvents = (
  validatorAddress: string,
  params: EventQueryParams = {},
): Promise<IndexedEventsPage> =>
  indexerApi
    .get(`/validators/${encodeURIComponent(validatorAddress)}/events`, {
      params,
    })
    .then((r) => r.data);

const MAX_PAGES = 10; // caps at 10 * 200 = 2000 events per player before giving up

/**
 * Reconstructs a player's current milestone list from the indexer's raw
 * event log: every milestone_approved is applied in ledger order, and a
 * later milestone_revoked for the same milestone_id removes it — mirroring
 * on-chain state without a second RPC round trip per milestone.
 *
 * `evidenceHash` is not part of the milestone_approved event schema (see
 * README's "Indexed Event Schema"), so it comes back empty; callers that
 * need it still have to fall back to the contract for that one field.
 */
export async function getMilestoneHistoryFromIndexer(
  playerId: string,
): Promise<Milestone[]> {
  // Pages come back newest-ledger-first (page 1 = most recent, page 2 = the
  // next-older batch, ...). Collect everything first, then replay it oldest
  // to newest so a revoke is only ever applied after the approval it revokes.
  const newestFirst: IndexedEvent[] = [];
  let cursor: number | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { events, nextCursor } = await fetchPlayerEvents(playerId, {
      limit: 200,
      before: cursor,
    });

    newestFirst.push(...events);

    if (nextCursor === null) break;
    cursor = nextCursor;
  }

  const approved = new Map<string, Milestone>();
  for (const event of [...newestFirst].reverse()) {
    const milestoneId = event.data.milestone_id;
    if (typeof milestoneId !== 'string') continue;

    if (event.type === 'milestone_approved') {
      approved.set(milestoneId, {
        id: milestoneId,
        description:
          typeof event.data.description === 'string'
            ? event.data.description
            : '',
        evidenceHash: '',
        validator:
          typeof event.data.validator === 'string' ? event.data.validator : '',
        timestamp: event.timestamp,
      });
    } else if (event.type === 'milestone_revoked') {
      approved.delete(milestoneId);
    }
  }

  return Array.from(approved.values()).sort(
    (a, b) => a.timestamp - b.timestamp,
  );
}

/** One wallet + the earliest timestamp (inclusive, unix ms) whose approvals should count for it. */
export interface WalletApprovalWindow {
  wallet: string;
  since: number;
}

export interface ApprovalCountsResponse {
  range: { start: number; end: number };
  /** Approved-milestone count per wallet within range, keyed by wallet address. */
  counts: Record<string, number>;
}

/**
 * Calls the indexer's POST /validators/approval-counts — the building block
 * for the academy-scoped milestone rollup (issue #1172). Used server-side by
 * app/api/admin/academies/rollup, which resolves the wallet→academy mapping
 * (from server/'s academy service) and sums these per-wallet counts into
 * per-academy totals.
 */
export const fetchApprovalCountsByWallets = (
  range: { start: number; end: number },
  wallets: WalletApprovalWindow[],
): Promise<ApprovalCountsResponse> =>
  indexerApi
    .post('/validators/approval-counts', { ...range, wallets })
    .then((r) => r.data);

export default indexerApi;
