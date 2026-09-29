'use client';
import { useTranslations } from 'next-intl';

export default function BulkImportLoading() {
  const t = useTranslations();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('common.loading')}
      className="max-w-4xl mx-auto flex flex-col gap-6"
    >
      {/* Page title */}
      <div
        aria-hidden="true"
        className="h-9 w-48 rounded bg-gray-700 animate-pulse"
      />

      {/* Upload section */}
      <section className="bg-brand-card border border-gray-800 rounded-xl p-6 flex flex-col gap-4">
        <div
          aria-hidden="true"
          className="h-6 w-32 rounded bg-gray-700 animate-pulse"
        />
        <div
          aria-hidden="true"
          className="h-32 w-full rounded-lg bg-gray-700 animate-pulse"
        />
        <div
          aria-hidden="true"
          className="h-10 w-32 rounded-lg bg-gray-700 animate-pulse"
        />
      </section>

      {/* Preview table */}
      <section className="bg-brand-card border border-gray-800 rounded-xl p-6 flex flex-col gap-4">
        <div
          aria-hidden="true"
          className="h-6 w-40 rounded bg-gray-700 animate-pulse"
        />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className="h-16 rounded-lg bg-gray-700 animate-pulse"
            />
          ))}
        </div>
      </section>
    </div>
  );
}
