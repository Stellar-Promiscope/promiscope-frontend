import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import SponsorshipClient from './SponsorshipClient';

interface SponsorshipPageProps {
  params: {
    locale: string;
  };
}

export async function generateMetadata({
  params,
}: SponsorshipPageProps): Promise<Metadata> {
  const locale = params.locale;
  const t = await getTranslations({ locale, namespace: 'sponsorship' });

  const { buildPageMetadata } = await import('@/lib/seo');
  return buildPageMetadata({
    title: `${t('title')} | Promiscope`,
    description: t('metaDescription'),
    path: `/${locale}/sponsorship`,
  });
}

export default function SponsorshipPage() {
  return <SponsorshipClient />;
}
