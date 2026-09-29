/** @jest-environment node */
import { GET } from '../../../../app/api/media/[cid]/route';
import { NextRequest } from 'next/server';
import { MediaModerationStore } from '@/lib/mediaModerationStore';

const CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';

beforeEach(() => {
  MediaModerationStore.resetInstance();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    body: new ReadableStream({ start: (c) => c.close() }),
    headers: new Headers({ 'content-type': 'image/png' }),
  });
});

afterEach(() => MediaModerationStore.resetInstance());

function get(cid: string) {
  return GET(new NextRequest(`http://localhost:3000/api/media/${cid}`), {
    params: { cid },
  });
}

describe('GET /api/media/[cid] — moderation denylist (#1320)', () => {
  it('returns 451 for a denylisted CID without contacting any gateway', async () => {
    MediaModerationStore.getInstance().decide(CID, 'deny', 'GADMIN', 'nudity');

    const res = await get(CID);

    expect(res.status).toBe(451);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('serves a CID whose reports were approved', async () => {
    const store = MediaModerationStore.getInstance();
    store.report({
      cid: CID,
      playerId: 'p1',
      reason: 'other',
      reporterKey: 'r1',
    });
    store.decide(CID, 'approve', 'GADMIN', 'approved');

    const res = await get(CID);

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('serves the CID again once reinstated', async () => {
    const store = MediaModerationStore.getInstance();
    store.decide(CID, 'deny', 'GADMIN', 'copyright');
    expect((await get(CID)).status).toBe(451);

    store.reinstate(CID);
    expect((await get(CID)).status).toBe(200);
  });
});
