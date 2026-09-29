'use client';
import { useTranslations } from 'next-intl';

export default function RecoveryLoading() {
  const t = useTranslations();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('common.loading')}
      className="max-w-2xl mx-auto flex flex-col gap-8 py-12"
    >
      {/* Page title */}
      <div
        aria-hidden="true"
        className="h-9 w-56 rounded bg-gray-700 animate-pulse"
      />

      {/* Intro card */}
      <section className="bg-brand-card border border-gray-800 rounded-xl p-6 flex flex-col gap-4">
        <div
          aria-hidden="true"
          className="h-6 w-40 rounded bg-gray-700 animate-pulse"
        />
        <div
          aria-hidden="true"
          className="h-4 w-full max-w-lg rounded bg-gray-700 animate-pulse"
        />
        <div
          aria-hidden="true"
          className="h-4 w-64 rounded bg-gray-700 animate-pulse"
        />
        <div
          aria-hidden="true"
          className="h-10 w-32 rounded-lg bg-gray-700 animate-pulse"
        />
      </section>

      {/* Input section */}
      <section className="bg-brand-card border border-gray-800 rounded-xl p-6 flex flex-col gap-4">
        <div
          aria-hidden="true"
          className="h-6 w-32 rounded bg-gray-700 animate-pulse"
        />
        <div
          aria-hidden="true"
          className="h-10 w-full rounded bg-gray-700 animate-pulse"
        />
        <div
          aria-hidden="true"
          className="h-10 w-32 rounded-lg bg-gray-700 animate-pulse"
        />
      </section>
    </div>
  );
}
