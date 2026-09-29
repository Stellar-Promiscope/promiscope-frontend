/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import {
  collectUserData,
  deleteUserData,
  WALLET_DATA_STORES,
  EXEMPT_STORES,
} from '@/lib/offChainDataCollection';
import { WatchlistStore } from '@/lib/watchlistStore';
import { SavedSearchStore } from '@/lib/savedSearchStore';
import { NotificationPreferencesStore } from '@/lib/notificationPreferencesStore';
import { NotificationReadStore } from '@/lib/notificationReadStore';
import { MilestoneDisputeStore } from '@/lib/milestoneDisputeStore';
import {
  initSession,
  clearSessionsForWallet,
  __resetForTests,
} from '@/lib/chunkedUploadStore';
import { RecentlyViewedStore } from '@/lib/recentlyViewedStore';
import { SessionStore } from '@/lib/sessionStore';
import { MilestoneEndorsementStore } from '@/lib/milestoneEndorsementStore';
import { UploadTrackingStore } from '@/lib/uploadTrackingStore';
import type { PlayerFilter } from '@/types';

const WALLET = 'GEXPORT0000000000000000000000000000000000000000000000000000000';
const OTHER = 'GOTHER000000000000000000000000000000000000000000000000000000000';

function resetAll(): void {
  WatchlistStore.resetInstance();
  SavedSearchStore.resetInstance();
  NotificationPreferencesStore.resetInstance();
  NotificationReadStore.resetInstance();
  MilestoneDisputeStore.resetInstance();
  RecentlyViewedStore.resetInstance();
  SessionStore.resetInstance();
  MilestoneEndorsementStore.resetInstance();
  UploadTrackingStore.resetInstance();
  __resetForTests();
}

beforeEach(resetAll);
afterEach(resetAll);

describe('collectUserData', () => {
  it('collects every in-scope store record referencing the wallet', async () => {
    WatchlistStore.getInstance().add(WALLET, 'player-1');
    WatchlistStore.getInstance().add(OTHER, 'player-other');
    SavedSearchStore.getInstance().add(WALLET, 'search-1', {} as PlayerFilter);
    NotificationPreferencesStore.getInstance().set(WALLET, {
      milestoneApprovals: false,
      contactUnlocks: true,
    });
    NotificationReadStore.getInstance().markRead(WALLET, [1, 2]);
    MilestoneDisputeStore.getInstance().create({
      playerId: 'player-1',
      playerWallet: WALLET,
      milestoneId: 'm-1',
      milestoneDescription: 'desc',
      reason: 'reason',
    });
    await initSession({
      filename: 'clip.mp4',
      fileType: 'video/mp4',
      fileSize: 1024,
      totalChunks: 2,
      ownerWallet: WALLET,
    });
    await initSession({
      filename: 'other.mp4',
      fileType: 'video/mp4',
      fileSize: 1024,
      totalChunks: 2,
      ownerWallet: OTHER,
    });

    const data = await collectUserData(WALLET);

    expect(data.wallet).toBe(WALLET);
    // WatchlistStore.add normalizes the player id via normalizeStellarAddress
    // (upper-cases, canonicalizes valid keys), so it round-trips as PLAYER-1.
    expect(data.sections.watchlist.map((e) => e.playerId)).toEqual([
      'PLAYER-1',
    ]);
    expect(data.sections.savedSearches).toHaveLength(1);
    expect(data.sections.notificationPreferences).toEqual({
      milestoneApprovals: false,
      contactUnlocks: true,
    });
    expect(data.sections.notificationReadIds).toEqual([1, 2]);
    expect(data.sections.milestoneDisputes).toHaveLength(1);
    expect(data.sections.activeUploadSessions).toHaveLength(1);
    expect(data.sections.activeUploadSessions[0].filename).toBe('clip.mp4');

    expect(data.onChainExcluded.explorerUrl).toContain(WALLET);
    expect(data.onChainExcluded.explanation).toMatch(/on-chain/i);

    const excludedNames = data.excluded.map((e) => e.name);
    expect(excludedNames).toContain('contactDetailsCache');
    expect(excludedNames).toContain('messaging');
    expect(excludedNames).not.toContain('collectionErrors');
  });

  it('documents collection errors instead of dropping them silently', async () => {
    // Force the watchlist store to throw by closing its DB.
    WatchlistStore.getInstance().close();

    const data = await collectUserData(WALLET);
    expect(data.sections.watchlist).toEqual([]);
    expect(data.excluded.map((e) => e.name)).toContain('collectionErrors');
  });
});

describe('deleteUserData', () => {
  it('removes every in-scope record for the wallet but leaves others intact', async () => {
    WatchlistStore.getInstance().add(WALLET, 'player-1');
    WatchlistStore.getInstance().add(OTHER, 'player-other');
    SavedSearchStore.getInstance().add(WALLET, 'search-1', {} as PlayerFilter);
    NotificationPreferencesStore.getInstance().set(WALLET, {
      milestoneApprovals: true,
      contactUnlocks: true,
    });
    NotificationReadStore.getInstance().markRead(WALLET, [1, 2]);
    MilestoneDisputeStore.getInstance().create({
      playerId: 'player-1',
      playerWallet: WALLET,
      milestoneId: 'm-1',
      milestoneDescription: 'desc',
      reason: 'reason',
    });
    await initSession({
      filename: 'clip.mp4',
      fileType: 'video/mp4',
      fileSize: 1024,
      totalChunks: 2,
      ownerWallet: WALLET,
    });

    const { removed } = await deleteUserData(WALLET);

    expect(removed.watchlist).toBe(1);
    expect(removed.savedSearches).toBe(1);
    expect(removed.notificationPreferences).toBe(1);
    expect(removed.notificationReadIds).toBe(2);
    expect(removed.milestoneDisputes).toBe(1);
    expect(removed.activeUploadSessions).toBe(1);
    expect(await clearSessionsForWallet(WALLET)).toBe(0);

    expect(WatchlistStore.getInstance().list(WALLET)).toEqual([]);
    expect(NotificationPreferencesStore.getInstance().get(WALLET)).toEqual({
      milestoneApprovals: true,
      contactUnlocks: true,
    });
    expect(NotificationReadStore.getInstance().getReadIds(WALLET)).toEqual([]);
    expect(MilestoneDisputeStore.getInstance().listForWallet(WALLET)).toEqual(
      [],
    );

    // Other wallet's data is untouched.
    expect(WatchlistStore.getInstance().list(OTHER)).toHaveLength(1);
  });
});

describe('wallet-keyed stores added in #1351', () => {
  function seed(): void {
    RecentlyViewedStore.getInstance().record(WALLET, 'player-1', Date.now());
    SessionStore.getInstance().create('s1', WALLET, Date.now() + 60_000, 'UA');
    SessionStore.getInstance().create('s2', OTHER, Date.now() + 60_000, 'UA');
    MilestoneEndorsementStore.getInstance().add('player-1', 'm1', WALLET);
    UploadTrackingStore.getInstance().recordUpload({
      cid: 'QmCid',
      wallet: WALLET,
      context: 'player_onboarding_highlight_reel',
    });
  }

  it('exports recently viewed, sessions, endorsements and tracked uploads', async () => {
    seed();
    const data = await collectUserData(WALLET);

    expect(data.schemaVersion).toBe(2);
    expect(data.sections.recentlyViewed).toHaveLength(1);
    expect(data.sections.sessions.map((s) => s.id)).toEqual(['s1']);
    expect(data.sections.milestoneEndorsements).toHaveLength(1);
    expect(data.sections.trackedUploads).toHaveLength(1);
    expect(data.excluded.map((e) => e.name)).toContain('onboardingSync');
  });

  it('deletes them, revokes sessions, and anonymizes tracked uploads', async () => {
    seed();
    const revoke = jest.spyOn(SessionStore.prototype, 'revokeAllForWallet');
    const { removed, anonymized } = await deleteUserData(WALLET);

    expect(revoke).toHaveBeenCalledWith(WALLET);
    expect(removed.recentlyViewed).toBe(1);
    expect(removed.sessions).toBe(1);
    expect(removed.milestoneEndorsements).toBe(1);
    expect(anonymized.trackedUploads).toBe(1);
    expect(SessionStore.getInstance().isActive('s1')).toBe(false);
    expect(SessionStore.getInstance().listForWallet(OTHER)).toHaveLength(1);
    expect(UploadTrackingStore.getInstance().getByCid('QmCid')[0].wallet).toBe(
      null,
    );
    revoke.mockRestore();
  });
});

describe('store registry guard (#1351)', () => {
  it('classifies every lib/*Store.ts as registered or exempt', () => {
    const classified = new Set<string>([
      ...WALLET_DATA_STORES,
      ...Object.keys(EXEMPT_STORES),
    ]);
    const stores = fs
      .readdirSync(path.join(__dirname, '../../lib'))
      .filter((f) => f.endsWith('Store.ts'))
      .map((f) => f.replace(/\.ts$/, ''));

    expect(stores.filter((s) => !classified.has(s))).toEqual([]);
    Object.values(EXEMPT_STORES).forEach((reason) =>
      expect(reason.length).toBeGreaterThan(0),
    );
  });
});
