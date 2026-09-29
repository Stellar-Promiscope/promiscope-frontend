import { parsePlayerSort, sortPlayers } from '@/lib/playerSort';
import type { Player } from '@/types';

function player(
  id: string,
  progressLevel: Player['progressLevel'],
  region: string,
  createdAt: number,
  milestoneTs: number[] = [],
): Player {
  return {
    id,
    wallet: id,
    vitals: { name: id, age: 18, position: 'FW', region, nationality: 'X' },
    ipfsHash: '',
    progressLevel,
    milestones: milestoneTs.map((timestamp, i) => ({
      id: `${id}-${i}`,
      description: '',
      evidenceHash: '',
      validator: '',
      timestamp,
    })),
    createdAt,
  };
}

const players = [
  player('a', 1, 'Lagos', 100, [500]),
  player('b', 3, 'Accra', 200),
  player('c', 2, 'Nairobi', 300),
];

describe('sortPlayers', () => {
  it('keeps backend order by default', () => {
    expect(sortPlayers(players, 'default')).toBe(players);
  });
  it('sorts by progress level descending', () => {
    expect(sortPlayers(players, 'progress').map((p) => p.id)).toEqual([
      'b',
      'c',
      'a',
    ]);
  });
  it('sorts by region A-Z', () => {
    expect(sortPlayers(players, 'region').map((p) => p.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });
  it('sorts by most recent activity', () => {
    expect(sortPlayers(players, 'recent').map((p) => p.id)).toEqual([
      'a',
      'c',
      'b',
    ]);
  });
});

describe('parsePlayerSort', () => {
  it('falls back to default for unknown values', () => {
    expect(parsePlayerSort('bogus')).toBe('default');
    expect(parsePlayerSort(null)).toBe('default');
    expect(parsePlayerSort('region')).toBe('region');
  });
});
