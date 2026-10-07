import {
  buildExportPayload,
  downloadExportPayload,
  type DataExportPayload,
} from '@/lib/dataExport';
import type { Player, Milestone } from '@/types';

const PLAYER: Player = {
  id: 'player-1',
  wallet: 'GPLAYERWALLET',
  vitals: {
    name: 'Jane Doe',
    age: 21,
    position: 'FWD',
    region: 'EU',
    nationality: 'FR',
  },
  stats: { goals: 5, assists: 2, appearances: 10 },
  ipfsHash: 'QmHighlightReel',
  progressLevel: 2,
  milestones: [],
  createdAt: 1_700_000_000,
};

const MILESTONES: Milestone[] = [
  {
    id: 'm1',
    description: 'Scored a hat-trick',
    evidenceHash: 'QmEvidence1',
    validator: 'GVALIDATOR1',
    timestamp: 1_700_000_100,
  },
  {
    id: 'm2',
    description: 'No evidence recorded',
    evidenceHash: '',
    validator: 'GVALIDATOR2',
    timestamp: 1_700_000_200,
  },
];

describe('buildExportPayload', () => {
  it('assembles the full payload from player + milestones', () => {
    const payload = buildExportPayload(PLAYER, MILESTONES);

    expect(payload.schemaVersion).toBe(1);
    expect(payload.playerId).toBe('player-1');
    expect(payload.wallet).toBe('GPLAYERWALLET');
    expect(payload.vitals).toEqual({
      name: 'Jane Doe',
      age: 21,
      position: 'FWD',
      region: 'EU',
      nationality: 'FR',
    });
    expect(payload.progressLevel).toBe(2);
    expect(payload.createdAt).toBe(1_700_000_000);
    expect(payload.ipfsHash).toBe('QmHighlightReel');
    expect(payload.milestones).toHaveLength(2);
  });

  it('stamps exportedAt with a valid ISO timestamp near now', () => {
    const before = Date.now();
    const payload = buildExportPayload(PLAYER, []);
    const after = Date.now();

    const exportedAtMs = new Date(payload.exportedAt).getTime();
    expect(exportedAtMs).toBeGreaterThanOrEqual(before);
    expect(exportedAtMs).toBeLessThanOrEqual(after);
  });

  it('resolves the highlight reel IPFS URL from the gateway env var', () => {
    const payload = buildExportPayload(PLAYER, []);
    expect(payload.ipfsUrl).toBe(
      'https://gateway.pinata.cloud/ipfs/QmHighlightReel',
    );
  });

  it('resolves each milestone evidence URL individually', () => {
    const payload = buildExportPayload(PLAYER, MILESTONES);
    expect(payload.milestones[0]).toMatchObject({
      id: 'm1',
      description: 'Scored a hat-trick',
      evidenceHash: 'QmEvidence1',
      evidenceUrl: 'https://gateway.pinata.cloud/ipfs/QmEvidence1',
      validator: 'GVALIDATOR1',
      timestamp: 1_700_000_100,
    });
  });

  it('returns a null evidenceUrl for milestones without an evidence hash', () => {
    const payload = buildExportPayload(PLAYER, MILESTONES);
    expect(payload.milestones[1].evidenceUrl).toBeNull();
  });

  it('returns a null ipfsUrl when the player has no highlight reel hash', () => {
    const playerWithoutReel: Player = { ...PLAYER, ipfsHash: '' };
    const payload = buildExportPayload(playerWithoutReel, []);
    expect(payload.ipfsUrl).toBeNull();
  });

  it('produces an empty milestones array when none are passed', () => {
    const payload = buildExportPayload(PLAYER, []);
    expect(payload.milestones).toEqual([]);
  });

  it('falls back to the default Pinata gateway when the env var is unset', () => {
    const original = process.env.NEXT_PUBLIC_IPFS_GATEWAY;
    delete process.env.NEXT_PUBLIC_IPFS_GATEWAY;

    const payload = buildExportPayload(PLAYER, []);
    expect(payload.ipfsUrl).toBe(
      'https://gateway.pinata.cloud/ipfs/QmHighlightReel',
    );

    process.env.NEXT_PUBLIC_IPFS_GATEWAY = original;
  });
});

describe('downloadExportPayload', () => {
  const PAYLOAD: DataExportPayload = {
    schemaVersion: 1,
    exportedAt: '2024-03-07T00:00:00.000Z',
    playerId: 'player-1',
    wallet: 'GPLAYERWALLET',
    vitals: {
      name: 'Jane Doe',
      age: 21,
      position: 'FWD',
      region: 'EU',
      nationality: 'FR',
    },
    progressLevel: 2,
    createdAt: 1_700_000_000,
    ipfsHash: 'QmHighlightReel',
    ipfsUrl: 'https://gateway.pinata.cloud/ipfs/QmHighlightReel',
    milestones: [],
  };

  let createObjectURL: jest.Mock;
  let revokeObjectURL: jest.Mock;
  let clickSpy: jest.SpyInstance;
  let appendChildSpy: jest.SpyInstance;
  let removeChildSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    createObjectURL = jest.fn(() => 'blob:mock-url');
    revokeObjectURL = jest.fn();
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = revokeObjectURL;
    clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    appendChildSpy = jest.spyOn(document.body, 'appendChild');
    removeChildSpy = jest.spyOn(document.body, 'removeChild');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('creates a JSON blob URL and clicks a download anchor', () => {
    downloadExportPayload(PAYLOAD);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe('application/json');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(appendChildSpy).toHaveBeenCalledTimes(1);
    expect(removeChildSpy).toHaveBeenCalledTimes(1);
  });

  it('uses the default filename derived from playerId + date when none is given', () => {
    downloadExportPayload(PAYLOAD);
    const anchor = appendChildSpy.mock.calls[0][0] as HTMLAnchorElement;
    const today = new Date().toISOString().split('T')[0];
    expect(anchor.download).toBe(`promiscope-export-player-1-${today}.json`);
  });

  it('uses a custom filename when provided', () => {
    downloadExportPayload(PAYLOAD, 'my-custom-export.json');
    const anchor = appendChildSpy.mock.calls[0][0] as HTMLAnchorElement;
    expect(anchor.download).toBe('my-custom-export.json');
  });

  it('revokes the object URL after the timeout elapses', () => {
    downloadExportPayload(PAYLOAD);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1000);

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});
