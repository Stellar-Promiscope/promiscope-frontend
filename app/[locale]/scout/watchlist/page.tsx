'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { useRequireWallet } from '@/hooks/useRequireWallet';
import { useWatchlist } from '@/hooks/useWatchlist';
import { getPlayer } from '@/lib/contract';
import PlayerCard from '@/components/PlayerCard';
import PlayerCardSkeleton from '@/components/PlayerCardSkeleton';
import EmptyState from '@/components/ui/EmptyState';
import type { Player, WatchlistEntry } from '@/types';

function watchlistPlayersKey(entries: WatchlistEntry[]): string | null {
  if (entries.length === 0) return null;
  return `watchlist-players:${entries
    .map((e) => e.playerId)
    .sort()
    .join(',')}`;
}

async function fetchWatchlistPlayers(
  entries: WatchlistEntry[],
): Promise<Player[]> {
  const results = await Promise.allSettled(
    entries.map((e) => getPlayer(e.playerId) as Promise<Player | null>),
  );
  const players: Player[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value !== null) {
      players.push(r.value);
    }
  }
  return players;
}

export default function WatchlistPage() {
  const { walletAddress: publicKey } = useRequireWallet();
  const watchlist = useWatchlist(publicKey ?? null);
  const t = useTranslations('scout');

  const { data: players, isValidating } = useSWR<Player[]>(
    watchlistPlayersKey(watchlist.entries),
    () => fetchWatchlistPlayers(watchlist.entries),
    { revalidateOnFocus: false, dedupingInterval: 5_000 },
  );

  if (!publicKey) return null;

  const loading =
    watchlist.loading ||
    (watchlist.entries.length > 0 && isValidating && !players);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">
          {t('watchlist.title')}
        </h1>
        <Link
          href="/scout"
          className="text-sm text-gray-400 hover:text-white transition"
        >
          &larr; {t('back_to_dashboard')}
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <PlayerCardSkeleton key={i} />
          ))}
        </div>
      ) : watchlist.entries.length === 0 ? (
        <EmptyState
          title={t('watchlist.empty_title')}
          description={t('watchlist.empty_description')}
        />
      ) : (
        <div
          data-testid="watchlist-grid"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {(players ?? []).map((player) => {
            const entry = watchlist.entries.find(
              (e) => e.playerId === player.id,
            );
            return (
              <PlayerCard
                key={player.id}
                player={player}
                isWatched
                onToggleWatchlist={() => entry && watchlist.remove(entry)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
