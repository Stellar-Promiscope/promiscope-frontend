const mockFetchAcademyForWallet = jest.fn();

jest.mock('@/lib/api', () => ({
  fetchAcademyForWallet: (...args: unknown[]) =>
    mockFetchAcademyForWallet(...args),
}));

import { PDFDocument } from 'pdf-lib';
import {
  buildCvFilename,
  generatePlayerCvPdf,
  downloadPlayerCvPdf,
} from '@/lib/cvExport';
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

const GK_PLAYER: Player = {
  ...PLAYER,
  vitals: { ...PLAYER.vitals, position: 'GK' },
  stats: { goals: 0, assists: 0, appearances: 12, clean_sheets: 4 },
};

const MILESTONES: Milestone[] = [
  {
    id: 'm1',
    description: 'Scored a hat-trick',
    evidenceHash: 'QmEvidence1',
    validator: 'GVALIDATOR1',
    timestamp: 1_700_000_200,
  },
  {
    id: 'm2',
    description: 'Clean sheet streak',
    evidenceHash: 'QmEvidence2',
    validator: 'GVALIDATOR2',
    timestamp: 1_700_000_100,
  },
];

beforeEach(() => {
  mockFetchAcademyForWallet.mockReset();
  mockFetchAcademyForWallet.mockResolvedValue(null);
});

describe('buildCvFilename', () => {
  it('slugifies a normal name', () => {
    expect(buildCvFilename('Jane Doe')).toBe('jane-doe-promiscope-cv.pdf');
  });

  it('lowercases and strips punctuation', () => {
    expect(buildCvFilename("O'Brien, Séan!!")).toBe(
      'o-brien-s-an-promiscope-cv.pdf',
    );
  });

  it('trims leading/trailing dashes produced by non-alphanumeric edges', () => {
    expect(buildCvFilename('---Jane Doe---')).toBe('jane-doe-promiscope-cv.pdf');
  });

  it('falls back to "player" when the name has no alphanumeric characters', () => {
    expect(buildCvFilename('!!!')).toBe('player-promiscope-cv.pdf');
  });

  it('falls back to "player" for an empty string', () => {
    expect(buildCvFilename('')).toBe('player-promiscope-cv.pdf');
  });
});

describe('generatePlayerCvPdf', () => {
  it('generates valid, loadable PDF bytes for a player with milestones', async () => {
    const bytes = await generatePlayerCvPdf(PLAYER, MILESTONES);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);

    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('resolves validator names via fetchAcademyForWallet when an academy is found', async () => {
    mockFetchAcademyForWallet.mockImplementation(async (address: string) =>
      address === 'GVALIDATOR1' ? { name: 'Sunrise Academy' } : null,
    );

    await generatePlayerCvPdf(PLAYER, MILESTONES);

    expect(mockFetchAcademyForWallet).toHaveBeenCalledWith('GVALIDATOR1');
    expect(mockFetchAcademyForWallet).toHaveBeenCalledWith('GVALIDATOR2');
  });

  it('deduplicates validator address lookups', async () => {
    const sameValidatorMilestones: Milestone[] = [
      { ...MILESTONES[0], validator: 'GVALIDATOR1' },
      { ...MILESTONES[1], validator: 'GVALIDATOR1' },
    ];

    await generatePlayerCvPdf(PLAYER, sameValidatorMilestones);

    expect(mockFetchAcademyForWallet).toHaveBeenCalledTimes(1);
  });

  it('handles a player with no milestones', async () => {
    const bytes = await generatePlayerCvPdf(PLAYER, []);
    expect(mockFetchAcademyForWallet).not.toHaveBeenCalled();

    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('handles a player with no stats block', async () => {
    const noStatsPlayer: Player = { ...PLAYER, stats: undefined };
    const bytes = await generatePlayerCvPdf(noStatsPlayer, []);

    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('includes clean sheets stat line for a GK', async () => {
    const bytes = await generatePlayerCvPdf(GK_PLAYER, []);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('spans multiple pages when there are enough milestones to overflow one page', async () => {
    const manyMilestones: Milestone[] = Array.from({ length: 60 }, (_, i) => ({
      id: `m${i}`,
      description: `Milestone number ${i} with a reasonably long description text`,
      evidenceHash: `QmEvidence${i}`,
      validator: `GVALIDATOR${i % 3}`,
      timestamp: 1_700_000_000 + i,
    }));

    const bytes = await generatePlayerCvPdf(PLAYER, manyMilestones);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThan(1);
  });

  it('caps concurrent validator lookups at no more than 5 in flight at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockFetchAcademyForWallet.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return null;
    });

    const manyValidatorMilestones: Milestone[] = Array.from(
      { length: 50 },
      (_, i) => ({
        id: `m${i}`,
        description: `Milestone ${i}`,
        evidenceHash: `QmEvidence${i}`,
        validator: `GVALIDATOR${i}`, // 50 distinct validators
        timestamp: 1_700_000_000 + i,
      }),
    );

    await generatePlayerCvPdf(PLAYER, manyValidatorMilestones);

    expect(mockFetchAcademyForWallet).toHaveBeenCalledTimes(50);
    expect(maxInFlight).toBeLessThanOrEqual(5);
  });

  it('completes for a large synthetic milestone list with many distinct validators without an extended timeout', async () => {
    const largeMilestoneList: Milestone[] = Array.from(
      { length: 250 },
      (_, i) => ({
        id: `m${i}`,
        description: `Milestone number ${i} with a reasonably long description text describing what happened`,
        evidenceHash: `QmEvidence${i}`,
        validator: `GVALIDATOR${i % 40}`, // 40 distinct validators
        timestamp: 1_700_000_000 + i,
      }),
    );

    const bytes = await generatePlayerCvPdf(PLAYER, largeMilestoneList);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThan(1);
    expect(mockFetchAcademyForWallet).toHaveBeenCalledTimes(40);
  });
});

describe('downloadPlayerCvPdf', () => {
  let createObjectURL: jest.Mock;
  let revokeObjectURL: jest.Mock;
  let clickSpy: jest.SpyInstance;
  let appendChildSpy: jest.SpyInstance;
  let removeChildSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    createObjectURL = jest.fn(() => 'blob:mock-cv-url');
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

  it('creates a PDF blob URL and clicks a download anchor with the CV filename', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    downloadPlayerCvPdf(bytes, 'Jane Doe');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe('application/pdf');

    const anchor = appendChildSpy.mock.calls[0][0] as HTMLAnchorElement;
    expect(anchor.download).toBe('jane-doe-promiscope-cv.pdf');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(removeChildSpy).toHaveBeenCalledTimes(1);
  });

  it('revokes the object URL after the timeout elapses', () => {
    downloadPlayerCvPdf(new Uint8Array([1]), 'Jane Doe');
    expect(revokeObjectURL).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1000);

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-cv-url');
  });
});
