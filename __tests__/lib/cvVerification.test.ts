import {
  buildCvContent,
  canonicalizeCvContent,
} from '@/lib/cvVerification';
import type { Player } from '@/types';

const PLAYER: Player = {
  id: 'player-1',
  wallet: 'GPLAYER',
  vitals: {
    name: 'Jane Doe',
    age: 21,
    position: 'FWD',
    region: 'EU',
    nationality: 'FR',
  },
  stats: { goals: 5, assists: 2, appearances: 10 },
  ipfsHash: 'QmMedia',
  progressLevel: 2,
  milestones: [],
  createdAt: 1_700_000_000,
};

describe('canonicalizeCvContent', () => {
  it('sorts object keys recursively and milestone order by id', () => {
    const first = buildCvContent(PLAYER, [
      {
        id: 'b',
        description: 'B',
        evidenceHash: 'e2',
        validator: 'v2',
        timestamp: 2,
      },
      {
        id: 'a',
        description: 'A',
        evidenceHash: 'e1',
        validator: 'v1',
        timestamp: 1,
      },
    ]);
    const second = buildCvContent(PLAYER, [
      {
        id: 'a',
        description: 'A',
        evidenceHash: 'e1',
        validator: 'v1',
        timestamp: 1,
      },
      {
        id: 'b',
        description: 'B',
        evidenceHash: 'e2',
        validator: 'v2',
        timestamp: 2,
      },
    ]);

    expect(canonicalizeCvContent(first)).toBe(canonicalizeCvContent(second));
  });
});