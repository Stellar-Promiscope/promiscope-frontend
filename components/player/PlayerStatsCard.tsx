'use client';
import { Goal, Hand, CalendarDays, Shield } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { PlayerStats } from '@/types';

interface StatCellProps {
  icon: React.ReactNode;
  value: number;
  label: string;
}

function StatCell({ icon, value, label }: StatCellProps) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-gray-800 bg-brand-card p-4">
      <span className="text-brand-green">{icon}</span>
      <span className="text-2xl font-bold text-white">{value}</span>
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}

export default function PlayerStatsCard({
  stats,
  position,
}: {
  stats?: PlayerStats;
  position?: string;
}) {
  const t = useTranslations('stats');

  if (!stats) {
    return (
      <div
        className="bg-brand-card border border-gray-800 rounded-xl p-6 animate-pulse"
        aria-busy="true"
        aria-label={t('loading')}
      >
        <div className="h-5 w-36 rounded bg-gray-700 mb-4" />
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col items-center gap-2 rounded-xl border border-gray-800 p-4"
            >
              <div className="h-5 w-5 rounded-full bg-gray-700" />
              <div className="h-8 w-12 rounded bg-gray-700" />
              <div className="h-3 w-16 rounded bg-gray-700" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const isGK = position === 'GK';

  return (
    <div className="bg-brand-card border border-gray-800 rounded-xl p-6">
      <h2 className="font-semibold text-white mb-4">{t('title')}</h2>
      <div className="grid grid-cols-2 gap-4">
        <StatCell
          icon={<Goal className="h-5 w-5" />}
          value={stats.goals}
          label={t('goals')}
        />
        <StatCell
          icon={<Hand className="h-5 w-5" />}
          value={stats.assists}
          label={t('assists')}
        />
        <StatCell
          icon={<CalendarDays className="h-5 w-5" />}
          value={stats.appearances}
          label={t('appearances')}
        />
        {isGK && (
          <StatCell
            icon={<Shield className="h-5 w-5" />}
            value={stats.clean_sheets ?? 0}
            label={t('clean_sheets')}
          />
        )}
      </div>
    </div>
  );
}
