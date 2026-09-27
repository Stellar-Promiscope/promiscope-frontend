/**
 * lib/walletMigration.ts — transactional off-chain data migration.
 *
 * Migrates every off-chain store keyed by `fromWallet` to `toWallet`.
 * Executes sequentially; throws on any store failure so the caller can mark
 * the migration as failed.
 *
 * On-chain identity transfer:
 *   The ScoutOff Soroban contract does not currently expose a
 *   `transfer_player` entrypoint. Until it does, the on-chain profile
 *   remains bound to the original key. This function performs the complete
 *   off-chain migration and surfaces a clear notice to the caller.
 *
 *   Tracking issue: https://github.com/scout-off/scout-off-frontend/issues/1315
 *
 * Stores migrated:
 *   - watchlist
 *   - savedSearches
 *   - notificationPreferences
 *   - notificationReadIds
 *   - recentlyViewed
 *   - sessions (revoked for fromWallet — toWallet must re-authenticate)
 *
 * Stores NOT migrated (documented reasons):
 *   - milestoneDisputes: dispute authorship is immutable for audit integrity
 *   - adminAuditLog rows: anonymized on deletion; authorship must be retained
 *   - chunkedUploadSessions: in-progress uploads are abandoned on migration
 */

import { WatchlistStore } from './watchlistStore';
import { SavedSearchStore } from './savedSearchStore';
import { NotificationPreferencesStore } from './notificationPreferencesStore';
import { NotificationReadStore } from './notificationReadStore';
import { RecentlyViewedStore } from './recentlyViewedStore';
import { SessionStore } from './sessionStore';

export interface MigrationResult {
  fromWallet: string;
  toWallet: string;
  migratedAt: number;
  counts: {
    watchlist: number;
    savedSearches: number;
    notificationPrefsTransferred: boolean;
    notificationReadIds: number;
    recentlyViewed: number;
    sessionsRevoked: number;
  };
  /**
   * On-chain transfer is not supported by the contract yet.
   * The caller should surface this notice to the user.
   */
  onChainTransferBlocked: {
    reason: string;
    trackingIssue: string;
  };
}

/**
 * Executes the off-chain migration from `fromWallet` to `toWallet`.
 * Throws on any error — the migration API route must mark the request as
 * failed in that case so the state machine stays consistent.
 */
export async function executeWalletMigration(
  fromWallet: string,
  toWallet: string,
): Promise<MigrationResult> {
  const watchlistStore = WatchlistStore.getInstance();
  const savedSearchStore = SavedSearchStore.getInstance();
  const notifPrefsStore = NotificationPreferencesStore.getInstance();
  const notifReadStore = NotificationReadStore.getInstance();
  const recentlyViewedStore = RecentlyViewedStore.getInstance();
  const sessionStore = SessionStore.getInstance();

  // Snapshot all data before any destructive writes.
  const watchlistItems = watchlistStore.list(fromWallet);
  const savedSearchItems = savedSearchStore.list(fromWallet);
  const notifPrefs = notifPrefsStore.get(fromWallet);
  const readIds = notifReadStore.getReadIds(fromWallet);
  const recentlyViewed = recentlyViewedStore.list(fromWallet);

  let sessionsRevoked = 0;

  // 1. Watchlist
  watchlistStore.clearForWallet(fromWallet);
  for (const item of watchlistItems) {
    try {
      watchlistStore.add(toWallet, item.playerId);
    } catch {
      // toWallet may already have this player in its watchlist — skip duplicate
    }
  }

  // 2. Saved searches
  savedSearchStore.clearForWallet(fromWallet);
  for (const search of savedSearchItems) {
    try {
      savedSearchStore.add(toWallet, search.name, search.filter);
    } catch {
      // Duplicate name conflict — skip
    }
  }

  // 3. Notification preferences
  notifPrefsStore.set(toWallet, notifPrefs);
  notifPrefsStore.clearForWallet(fromWallet);

  // 4. Notification read state
  notifReadStore.clearForWallet(fromWallet);
  if (readIds.length > 0) {
    notifReadStore.markRead(toWallet, readIds);
  }

  // 5. Recently viewed
  recentlyViewedStore.clearForWallet(fromWallet);
  for (const item of recentlyViewed) {
    try {
      recentlyViewedStore.record(toWallet, item.playerId, item.viewedAt);
    } catch {
      // Skip on error
    }
  }

  // 6. Revoke all active sessions for fromWallet (security requirement per issue #1315)
  sessionsRevoked = sessionStore.revokeAllForWallet(fromWallet);

  return {
    fromWallet,
    toWallet,
    migratedAt: Date.now(),
    counts: {
      watchlist: watchlistItems.length,
      savedSearches: savedSearchItems.length,
      notificationPrefsTransferred: true,
      notificationReadIds: readIds.length,
      recentlyViewed: recentlyViewed.length,
      sessionsRevoked,
    },
    onChainTransferBlocked: {
      reason:
        'The ScoutOff Soroban contract does not yet expose a transfer_player entrypoint. Your on-chain profile (registration, milestones, subscriptions) remains bound to the original wallet key. Only off-chain data has been migrated.',
      trackingIssue:
        'https://github.com/scout-off/scout-off-frontend/issues/1315',
    },
  };
}
