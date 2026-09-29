/** @jest-environment node */
jest.mock('@/lib/adminAuth', () => ({ requireAdminWallet: jest.fn() }));

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/admin/media-moderation/route';
import { requireAdminWallet } from '@/lib/adminAuth';
import { AdminAuditStore } from '@/lib/adminAuditStore';
import { MediaModerationStore } from '@/lib/mediaModerationStore';
import {
  __resetForTests as resetSuperseded,
  getAllRecords,
} from '@/lib/supersededMediaStore';

const ADMIN = 'GADMIN';
const CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
const mockAdmin = requireAdminWallet as jest.Mock;

function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/admin/media-moderation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  mockAdmin.mockReturnValue(ADMIN);
  MediaModerationStore.resetInstance();
  AdminAuditStore.resetInstance();
  AdminAuditStore.getInstance(':memory:');
  resetSuperseded();
});

afterEach(() => {
  MediaModerationStore.resetInstance();
  AdminAuditStore.resetInstance();
});

describe('/api/admin/media-moderation', () => {
  it('rejects non-admins', async () => {
    mockAdmin.mockReturnValue(null);
    const res = await GET(
      new NextRequest('http://localhost/api/admin/media-moderation'),
    );
    expect(res.status).toBe(401);
    expect(
      (await post({ cid: CID, decision: 'deny', reason: 'x' })).status,
    ).toBe(401);
  });

  it('returns the aggregated queue', async () => {
    const store = MediaModerationStore.getInstance();
    store.report({
      cid: CID,
      playerId: 'p1',
      reason: 'nudity',
      reporterKey: 'a',
    });
    store.report({
      cid: CID,
      playerId: 'p1',
      reason: 'nudity',
      reporterKey: 'b',
    });

    const res = await GET(
      new NextRequest('http://localhost/api/admin/media-moderation'),
    );
    const body = await res.json();
    expect(body.queue).toHaveLength(1);
    expect(body.queue[0].reportCount).toBe(2);
  });

  it('requires a reason to deny', async () => {
    expect((await post({ cid: CID, decision: 'deny' })).status).toBe(400);
  });

  it('denylists, queues the unpin and audits the decision', async () => {
    MediaModerationStore.getInstance().report({
      cid: CID,
      playerId: 'p1',
      reason: 'nudity',
      reporterKey: 'a',
    });

    const res = await post({
      cid: CID,
      decision: 'deny',
      reason: 'explicit',
      playerId: 'p1',
      unpin: true,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      resolvedReports: 1,
      unpinQueued: true,
    });
    expect(MediaModerationStore.getInstance().isDenylisted(CID)).toBe(true);
    expect(getAllRecords()).toEqual([
      expect.objectContaining({ cid: CID, playerId: 'p1' }),
    ]);
    const { entries } = AdminAuditStore.getInstance().getEntries();
    expect(entries[0]).toMatchObject({
      actionType: 'media_deny',
      adminWallet: ADMIN,
      target: CID,
    });
  });

  it('audits approvals and reinstatements', async () => {
    await post({ cid: CID, decision: 'approve' });
    MediaModerationStore.getInstance().decide(CID, 'deny', ADMIN, 'x');
    await post({ cid: CID, decision: 'reinstate' });

    const types = AdminAuditStore.getInstance()
      .getEntries()
      .entries.map((e) => e.actionType)
      .sort();
    expect(types).toEqual(['media_approve', 'media_reinstate']);
    expect(MediaModerationStore.getInstance().isDenylisted(CID)).toBe(false);
  });
});
