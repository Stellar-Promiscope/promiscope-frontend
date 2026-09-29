import type { Player } from '@/types';

export type PlayerSort = 'default' | 'progress' | 'region' | 'recent';

export const PLAYER_SORT_OPTIONS: { value: PlayerSort; label: string }[] = [
  { value: 'default', label: 'Relevance' },
  { value: 'progress', label: 'Progress level (high → low)' },
  { value: 'region', label: 'Region (A–Z)' },
  { value: 'recent', label: 'Recently updated' },
];

export function parsePlayerSort(raw: string | null): PlayerSort {
  return PLAYER_SORT_OPTIONS.some((o) => o.value === raw)
    ? (raw as PlayerSort)
    : 'default';
}

/** Most recent activity: latest milestone approval, else registration time. */
function lastUpdated(p: Player): number {
  return p.milestones.reduce(
    (max, m) => Math.max(max, m.timestamp),
    p.createdAt,
  );
}

/** Returns a sorted copy; 'default' keeps backend order (same reference). */
export function sortPlayers(players: Player[], sort: PlayerSort): Player[] {
  switch (sort) {
    case 'progress':
      return [...players].sort((a, b) => b.progressLevel - a.progressLevel);
    case 'region':
      return [...players].sort((a, b) =>
        a.vitals.region.localeCompare(b.vitals.region),
      );
    case 'recent':
      return [...players].sort((a, b) => lastUpdated(b) - lastUpdated(a));
    default:
      return players;
  }
}
