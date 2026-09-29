/** @jest-environment node */
import { POST } from '@/app/api/data-deletion/request/route';
import { NextRequest } from 'next/server';
import { WatchlistStore } from '@/lib/watchlistStore';
import { SavedSearchStore } from '@/lib/savedSearchStore';
import { NotificationPreferencesStore } from '@/lib/notificationPreferencesStore';
import { NotificationReadStore } from '@/lib/notificationReadStore';
import { MilestoneDisputeStore } from '@/lib/milestoneDisputeStore';
import { AdminAuditStore } from '@/lib/adminAuditStore';
import { createSessionToken } from '@/lib/session';
import { SessionStore } from '@/lib/sessionStore';
import { __resetForTests } from '@/lib/chunkedUploadStore';

// This suite hits the real route handler and real (SQLite-backed) stores —
// no `global.fetch` mocking involved — specifically to prevent the class of
// gap issue #1170 describes: DataDeletionModal.test.tsx mocked `fetch` at
// the top level, so a POST /api/data-deletion/request route that didn't
// exist at all still made every component test pass.

// Only the partial-failure test sets BACKEND_SERVICE_TOKEN; every other test
// runs with the backend unconfigured, so this mock is never reached there.
const mockDeleteBackend = jest.fn();
jest.mock('@/lib/backendUserData', () => ({
  ...jest.requireActual('@/lib/backendUserData'),
  deleteBackendUserData: (...args: unknown[]) => mockDeleteBackend(...args),
}));

const WALLET = 'GDELETE000000000000000000000000000000000000000000000000000000';
const OTHER = 'GOTHER0000000000000000000000000000000000000000000000000000000';

function makeRequest(wallet?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (wallet !== undefined) {
    // getSessionWallet (lib/session.ts) requires both a validly-signed,
    // unexpired token AND an active row in SessionStore (see #1179) — a
    // bare signed token alone is deliberately not enough.
    const sid = `sid-${wallet}`;
    SessionStore.getInstance().create(sid, wallet, Date.now() + 60_000);
    headers['cookie'] =
      `session=${createSessionToken(wallet, 'access', 20 * 60, { sid })}`;
  }
  return new NextRequest('http://localhost/api/data-deletion/request', {
    method: 'POST',
    headers,
  });
}

function resetAll(): void {
  WatchlistStore.resetInstance();
  SavedSearchStore.resetInstance();
  NotificationPreferencesStore.resetInstance();
  NotificationReadStore.resetInstance();
  MilestoneDisputeStore.resetInstance();
  AdminAuditStore.resetInstance();
  SessionStore.resetInstance();
  __resetForTests();
}

beforeEach(resetAll);
afterEach(resetAll);

describe('POST /api/data-deletion/request', () => {
  it('returns 401 without a valid session cookie', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it('cascades deletion across every in-scope store for the requesting wallet only, and anonymizes retained audit rows', async () => {
    WatchlistStore.getInstance().add(WALLET, 'player-1');
    WatchlistStore.getInstance().add(OTHER, 'player-other');
    SavedSearchStore.getInstance().add(WALLET, 'search-1', {} as never);
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
    // A validator-add audit entry naming the requester's wallet as the
    // target — must be retained (integrity/accountability) but anonymized.
    AdminAuditStore.getInstance().insertEntry({
      actionType: 'validator_add',
      adminWallet:
        'GADMIN00000000000000000000000000000000000000000000000000000',
      target: WALLET,
      status: 'confirmed',
      timestamp: 1_700_000_000,
    });

    const res = await POST(makeRequest(WALLET));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.removed.watchlist).toBe(1);
    expect(body.removed.savedSearches).toBe(1);
    expect(body.removed.notificationPreferences).toBe(1);
    expect(body.removed.notificationReadIds).toBe(2);
    expect(body.removed.milestoneDisputes).toBe(1);
    expect(body.anonymized.adminAuditLog).toBe(1);

    // Confirmation only follows an actually-completed cascade: the stores
    // are already empty by the time the response comes back.
    expect(WatchlistStore.getInstance().list(WALLET)).toEqual([]);
    expect(SavedSearchStore.getInstance().list(WALLET)).toEqual([]);
    expect(NotificationReadStore.getInstance().getReadIds(WALLET)).toEqual([]);
    expect(MilestoneDisputeStore.getInstance().listForWallet(WALLET)).toEqual(
      [],
    );

    // The audit entry survives, but its wallet reference is redacted rather
    // than the row being deleted outright.
    const { entries } = AdminAuditStore.getInstance().getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].target).toBe(AdminAuditStore.REDACTED_WALLET_PLACEHOLDER);
    expect(entries[0].status).toBe('confirmed');

    // Another wallet's data is untouched.
    expect(WatchlistStore.getInstance().list(OTHER)).toHaveLength(1);
  });

  it('reports a partial deletion (502) when the backend cascade fails', async () => {
    process.env.BACKEND_SERVICE_TOKEN = 'test-token';
    mockDeleteBackend.mockRejectedValueOnce(
      new Error('timeout of 10000ms exceeded'),
    );
    try {
      const res = await POST(makeRequest(WALLET));
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.partial).toBe(true);
      expect(body.failed).toEqual(['backend']);
      expect(body.success).toBeUndefined();
    } finally {
      delete process.env.BACKEND_SERVICE_TOKEN;
    }
  });
});
