/** @jest-environment node */
import { MediaModerationStore } from '@/lib/mediaModerationStore';

const CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
const OTHER = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

let store: MediaModerationStore;

beforeEach(() => {
  MediaModerationStore.resetInstance();
  store = MediaModerationStore.getInstance();
});

afterEach(() => MediaModerationStore.resetInstance());

describe('MediaModerationStore', () => {
  it('aggregates reports per CID and ignores repeats from the same reporter', () => {
    expect(
      store.report({
        cid: CID,
        playerId: 'p1',
        reason: 'nudity',
        reporterKey: 'a',
      }),
    ).toBe(true);
    expect(
      store.report({
        cid: CID,
        playerId: 'p1',
        reason: 'nudity',
        reporterKey: 'a',
      }),
    ).toBe(false);
    store.report({
      cid: CID,
      playerId: 'p1',
      reason: 'violence',
      details: 'graphic',
      reporterKey: 'b',
    });
    store.report({
      cid: OTHER,
      playerId: 'p2',
      reason: 'other',
      reporterKey: 'a',
    });

    const queue = store.getQueue();
    expect(queue.map((q) => q.cid)).toEqual([CID, OTHER]);
    expect(queue[0]).toMatchObject({
      playerId: 'p1',
      reportCount: 2,
      reasons: { nudity: 1, violence: 1 },
      details: ['graphic'],
    });
  });

  it('deny resolves reports, denylists the CID and removes it from the queue', () => {
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

    expect(store.decide(CID, 'deny', 'GADMIN', 'explicit')).toBe(2);
    expect(store.isDenylisted(CID)).toBe(true);
    expect(store.filterDenylisted([CID, OTHER])).toEqual([CID]);
    expect(store.getQueue()).toEqual([]);
    expect(store.getDenylist()[0]).toMatchObject({
      cid: CID,
      reason: 'explicit',
      decidedBy: 'GADMIN',
    });
  });

  it('approve resolves reports without denylisting, and a reporter may report again later', () => {
    store.report({
      cid: CID,
      playerId: 'p1',
      reason: 'other',
      reporterKey: 'a',
    });
    store.decide(CID, 'approve', 'GADMIN', 'approved');

    expect(store.isDenylisted(CID)).toBe(false);
    expect(store.getQueue()).toEqual([]);
    expect(
      store.report({
        cid: CID,
        playerId: 'p1',
        reason: 'other',
        reporterKey: 'a',
      }),
    ).toBe(true);
  });
});
