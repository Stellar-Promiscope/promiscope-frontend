'use client';

import { Suspense, useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useComparePlayers } from '@/hooks/useComparePlayers';
import PlayerCompareView from '@/components/scout/PlayerCompareView';
import Spinner from '@/components/ui/Spinner';
import ErrorBoundary from '@/components/ui/ErrorBoundary';

const MAX_PLAYERS = 4;

function ParseIds() {
  const searchParams = useSearchParams();
  const t = useTranslations('scout');
  const raw = searchParams.get('ids') ?? '';

  const ids = useMemo(() => {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.slice(0, MAX_PLAYERS);
  }, [raw]);

  const { players, loading, error } = useComparePlayers(ids);

  if (ids.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-gray-400 text-lg">
          {t('compare.select_prompt', { max: MAX_PLAYERS })}
        </p>
        <Link
          href="/scout"
          className="text-brand-green underline hover:opacity-80 transition"
        >
          {t('back_to_dashboard')}
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-red-400">{t('compare.load_error', { error })}</p>
        <Link
          href="/scout"
          className="text-brand-green underline hover:opacity-80 transition"
        >
          {t('back_to_dashboard')}
        </Link>
      </div>
    );
  }

  if (players.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-gray-400">{t('compare.no_players')}</p>
        <Link
          href="/scout"
          className="text-brand-green underline hover:opacity-80 transition"
        >
          {t('back_to_dashboard')}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">{t('compare.title')}</h1>
        <Link
          href="/scout"
          className="text-sm text-gray-400 hover:text-white transition"
        >
          &larr; {t('back_to_dashboard')}
        </Link>
      </div>
      {players.length < ids.length && (
        <p className="text-sm text-gray-500">
          {t('compare.partial_failure', {
            count: ids.length - players.length,
          })}
        </p>
      )}
      <PlayerCompareView players={players} />
    </div>
  );
}

export default function ComparePage() {
  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className="flex justify-center py-20">
            <Spinner size="lg" />
          </div>
        }
      >
        <ParseIds />
      </Suspense>
    </ErrorBoundary>
  );
}
