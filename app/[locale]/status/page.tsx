import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, ArrowUpRight, Radio, Server, Globe } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';

interface StatusPageProps {
  params: {
    locale: string;
  };
}

export async function generateMetadata({
  params,
}: StatusPageProps): Promise<Metadata> {
  const locale = params.locale;
  const t = await getTranslations({ locale, namespace: 'status' });

  const { buildPageMetadata } = await import('@/lib/seo');
  return buildPageMetadata({
    title: `${t('page_title')} | Promiscope`,
    description: t('page_description'),
    path: `/${locale}/status`,
  });
}

export default async function StatusPage({ params }: StatusPageProps) {
  const locale = params.locale;
  const t = await getTranslations({ locale, namespace: 'status' });
  const statusPageUrl = process.env.NEXT_PUBLIC_STATUS_PAGE_URL;

  const dependencies = [
    { icon: Globe, label: t('dependency_frontend') },
    { icon: Server, label: t('dependency_backend') },
    { icon: Radio, label: t('dependency_rpc') },
  ];

  return (
    <div className="flex flex-col gap-10 pb-20">
      <section className="relative overflow-hidden rounded-2xl border border-gray-800 bg-brand-card px-6 py-10 sm:px-8 lg:px-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(0,200,83,0.12),_transparent_50%)]" />
        <div className="relative flex flex-col gap-6">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-brand-green/30 bg-brand-green/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-brand-green">
            <Radio size={12} />
            {t('eyebrow')}
          </span>
          <div className="max-w-2xl">
            <h1 className="text-3xl font-bold text-white sm:text-4xl">
              {t('page_title')}
            </h1>
            <p className="mt-3 text-sm leading-7 text-gray-400 sm:text-base">
              {t('page_description')}
            </p>
          </div>
          <div className="flex justify-start">
            <Link
              href={`/${locale}`}
              className="inline-flex items-center gap-2 text-sm font-medium text-brand-green transition hover:text-green-400"
            >
              {t('back_to_home')}
              <ArrowLeft size={15} />
            </Link>
          </div>
        </div>
      </section>

      <section className="px-1 sm:px-0">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">
          {t('dependencies_title')}
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {dependencies.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-3 rounded-2xl border border-gray-800 bg-brand-card/70 p-5"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-green/10 text-brand-green">
                <Icon size={18} />
              </div>
              <span className="text-sm font-medium text-white">{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="px-1 sm:px-0">
        {statusPageUrl ? (
          <div className="rounded-2xl border border-gray-800 bg-brand-card/70 p-6 sm:p-8">
            <h2 className="text-xl font-semibold text-white">
              {t('live_status_title')}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-gray-400">
              {t('live_status_description')}
            </p>
            <a
              href={statusPageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-green px-5 py-2.5 text-sm font-semibold text-black transition hover:opacity-90"
            >
              {t('live_status_cta')}
              <ArrowUpRight size={15} />
            </a>
            <p className="mt-4 text-xs text-gray-400">
              {t('incident_history_note')}
            </p>
          </div>
        ) : (
          <EmptyState
            title={t('empty_title')}
            description={t('empty_description')}
          />
        )}
      </section>
    </div>
  );
}
