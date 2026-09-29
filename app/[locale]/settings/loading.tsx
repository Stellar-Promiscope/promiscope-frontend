'use client';
import { useTranslations } from 'next-intl';

export default function SettingsLoading() {
  const t = useTranslations();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('common.loading')}
      className="flex flex-col gap-10 pb-20"
    >
      {/* Header */}
      <section className="relative overflow-hidden rounded-2xl border border-gray-800 bg-brand-card px-6 py-10 sm:px-8 lg:px-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(0,200,83,0.12),_transparent_50%)]" />
        <div className="relative flex flex-col gap-6">
          <div
            aria-hidden="true"
            className="h-5 w-32 rounded bg-gray-700 animate-pulse"
          />
          <div className="max-w-2xl flex flex-col gap-3">
            <div
              aria-hidden="true"
              className="h-10 w-64 rounded bg-gray-700 animate-pulse"
            />
            <div
              aria-hidden="true"
              className="h-4 w-full max-w-lg rounded bg-gray-700 animate-pulse"
            />
          </div>
          <div
            aria-hidden="true"
            className="h-5 w-24 rounded bg-gray-700 animate-pulse"
          />
        </div>
      </section>

      {/* Notification Preferences section */}
      <section className="px-1 sm:px-0">
        <div className="rounded-2xl border border-gray-800 bg-brand-card/70 p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div
              aria-hidden="true"
              className="h-10 w-10 shrink-0 rounded-xl bg-gray-700 animate-pulse"
            />
            <div className="min-w-0 flex-1 flex flex-col gap-3">
              <div
                aria-hidden="true"
                className="h-6 w-48 rounded bg-gray-700 animate-pulse"
              />
              <div
                aria-hidden="true"
                className="h-4 w-64 rounded bg-gray-700 animate-pulse"
              />
              <div
                aria-hidden="true"
                className="h-10 w-full rounded bg-gray-700 animate-pulse"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Session Security section */}
      <section className="px-1 sm:px-0">
        <div className="rounded-2xl border border-gray-800 bg-brand-card/70 p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-start gap-4">
              <div
                aria-hidden="true"
                className="h-10 w-10 shrink-0 rounded-xl bg-gray-700 animate-pulse"
              />
              <div className="flex flex-col gap-3">
                <div
                  aria-hidden="true"
                  className="h-6 w-40 rounded bg-gray-700 animate-pulse"
                />
                <div
                  aria-hidden="true"
                  className="h-4 w-72 rounded bg-gray-700 animate-pulse"
                />
              </div>
            </div>
            <div
              aria-hidden="true"
              className="h-9 w-32 rounded-lg bg-gray-700 animate-pulse shrink-0"
            />
          </div>
        </div>
      </section>

      {/* Data Export section */}
      <section className="px-1 sm:px-0">
        <div className="rounded-2xl border border-gray-800 bg-brand-card/70 p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div
              aria-hidden="true"
              className="h-10 w-10 shrink-0 rounded-xl bg-gray-700 animate-pulse"
            />
            <div className="min-w-0 flex-1 flex flex-col gap-3">
              <div
                aria-hidden="true"
                className="h-6 w-32 rounded bg-gray-700 animate-pulse"
              />
              <div
                aria-hidden="true"
                className="h-4 w-64 rounded bg-gray-700 animate-pulse"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Account Deletion section */}
      <section className="px-1 sm:px-0">
        <div className="rounded-2xl border border-gray-800 bg-brand-card/70 p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div
              aria-hidden="true"
              className="h-10 w-10 shrink-0 rounded-xl bg-gray-700 animate-pulse"
            />
            <div className="min-w-0 flex-1 flex flex-col gap-3">
              <div
                aria-hidden="true"
                className="h-6 w-40 rounded bg-gray-700 animate-pulse"
              />
              <div
                aria-hidden="true"
                className="h-4 w-72 rounded bg-gray-700 animate-pulse"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
