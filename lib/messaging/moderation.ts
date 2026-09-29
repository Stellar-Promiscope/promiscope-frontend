import chatApi from './chatApi';
import { BLOCKED_USERS_KEY } from '@/lib/storageKeys';
import { walletScopedKey } from '@/lib/activeWallet';

/**
 * Report/block actions for direct messaging threads. Reports route to a
 * moderation queue on the chat API; blocks are enforced server-side to stop
 * further messages and pay-to-contact unlocks from the blocked party.
 */
export interface BlockedUser {
  userId: string;
  blockedAt: string;
}

/**
 * Base key for the local block-list cache. Entries are stored per wallet as
 * `scoutoff_blocked_users:<wallet>` so switching accounts never exposes (or
 * appends to) another wallet's block list — see #1343.
 */
export { BLOCKED_USERS_KEY };
export async function reportUser(
  threadId: string,
  counterpartId: string,
  reason: string,
): Promise<void> {
  await chatApi.post('/moderation/reports', {
    threadId,
    counterpartId,
    reason,
  });
}

export async function blockUser(counterpartId: string): Promise<void> {
  await chatApi.post('/moderation/blocks', { counterpartId });
  const blocked = getBlockedUsers();
  if (!blocked.some((b) => b.userId === counterpartId)) {
    blocked.push({
      userId: counterpartId,
      blockedAt: new Date().toISOString(),
    });
    persistBlockedUsers(blocked);
  }
}

export async function unblockUser(counterpartId: string): Promise<void> {
  await chatApi.delete(`/moderation/blocks/${counterpartId}`);
  persistBlockedUsers(
    getBlockedUsers().filter((b) => b.userId !== counterpartId),
  );
}

/**
 * Fetches the current wallet's authoritative block list from the server.
 * The local cache (read by getBlockedUsers/isUserBlocked) only reflects
 * blocks made from this browser, so this is the source of truth once it
 * resolves — the result is also persisted locally so subsequent
 * synchronous reads (e.g. optimistic UI on the next page load) stay in
 * sync with the server until the next fetch.
 */
export async function fetchBlockedUsers(): Promise<BlockedUser[]> {
  const { data } = await chatApi.get<BlockedUser[]>('/moderation/blocks');
  persistBlockedUsers(data);
  return data;
}

export function getBlockedUsers(): BlockedUser[] {
  const key = walletScopedKey(BLOCKED_USERS_KEY);
  if (typeof window === 'undefined' || !key) return [];
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? '[]');
  } catch {
    return [];
  }
}

export function isUserBlocked(counterpartId: string): boolean {
  return getBlockedUsers().some((b) => b.userId === counterpartId);
}

/**
 * Checks whether `counterpartId` has blocked the current wallet — the
 * reverse of getBlockedUsers()/isUserBlocked(), which only ever reflect
 * blocks *this* wallet made. Needed because pay-to-contact and trial-offer
 * submissions go straight to the chain (see lib/contract.ts) and never pass
 * through the chat API, so they aren't covered by its message-send block
 * check; callers must gate those actions on this before building a
 * transaction against `counterpartId`.
 */
export async function isBlockedByCounterpart(
  counterpartId: string,
): Promise<boolean> {
  const { data } = await chatApi.get<{ blocked: boolean }>(
    `/moderation/blocks/${counterpartId}/status`,
  );
  return data.blocked;
}

function persistBlockedUsers(blocked: BlockedUser[]): void {
  const key = walletScopedKey(BLOCKED_USERS_KEY);
  if (typeof window === 'undefined' || !key) return;
  window.localStorage.setItem(key, JSON.stringify(blocked));
}
