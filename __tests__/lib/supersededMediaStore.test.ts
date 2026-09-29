/**
 * @jest-environment node
 */
import {
  UNPIN_GRACE_PERIOD_MS,
  __resetForTests,
  getAllRecords,
  getEligibleForUnpin,
  isCidStillReferenced,
  markUnpinned,
  recordSupersededCid,
} from '@/lib/supersededMediaStore';

const START = new Date('2026-01-01T00:00:00Z').getTime();

describe('supersededMediaStore', () => {
  beforeEach(() => {
    __resetForTests();
    jest.useFakeTimers();
    jest.setSystemTime(START);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('records a CID with an id and timestamp', () => {
    const record = recordSupersededCid('bafyOld', 'player-1');
    expect(record).toEqual({
      id: expect.any(String),
      cid: 'bafyOld',
      playerId: 'player-1',
      supersededAt: START,
      unpinnedAt: null,
    });
    expect(getAllRecords()).toEqual([record]);
  });

  it('does not return records younger than the grace period', () => {
    recordSupersededCid('bafyOld', 'player-1');
    jest.advanceTimersByTime(UNPIN_GRACE_PERIOD_MS - 1);
    expect(getEligibleForUnpin()).toEqual([]);
  });

  it('returns records once the grace period has elapsed', () => {
    const record = recordSupersededCid('bafyOld', 'player-1');
    jest.advanceTimersByTime(UNPIN_GRACE_PERIOD_MS);
    expect(getEligibleForUnpin()).toEqual([record]);
  });

  it('excludes records marked as unpinned', () => {
    const record = recordSupersededCid('bafyOld', 'player-1');
    jest.advanceTimersByTime(UNPIN_GRACE_PERIOD_MS);
    markUnpinned(record.id);
    expect(getEligibleForUnpin()).toEqual([]);
    expect(getAllRecords()[0].unpinnedAt).toBe(START + UNPIN_GRACE_PERIOD_MS);
  });

  it('keeps duplicate CIDs as separate records', () => {
    const a = recordSupersededCid('bafyDup', 'player-1');
    const b = recordSupersededCid('bafyDup', 'player-2');
    expect(a.id).not.toBe(b.id);
    jest.advanceTimersByTime(UNPIN_GRACE_PERIOD_MS);
    markUnpinned(a.id);
    expect(getEligibleForUnpin()).toEqual([b]);
  });

  it('ignores markUnpinned for unknown ids', () => {
    expect(() => markUnpinned('missing')).not.toThrow();
  });

  it('reports whether a CID is still referenced', () => {
    const current = new Map([['player-1', 'bafyNew']]);
    expect(isCidStillReferenced('bafyNew', current)).toBe(true);
    expect(isCidStillReferenced('bafyOld', current)).toBe(false);
  });
});
