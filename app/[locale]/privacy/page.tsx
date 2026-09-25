import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import LegalPageLayout from '@/components/ui/LegalPageLayout';

interface PrivacyPageProps {
  params: {
    locale: string;
  };
}

export async function generateMetadata({
  params,
}: PrivacyPageProps): Promise<Metadata> {
  const locale = params.locale;
  const t = await getTranslations({ locale, namespace: 'privacy' });

  const { buildPageMetadata } = await import('@/lib/seo');
  return buildPageMetadata({
    title: `${t('page_title')} | ScoutOff`,
    description: t('page_description'),
    path: `/${locale}/privacy`,
  });
}

export default async function PrivacyPage({ params }: PrivacyPageProps) {
  const locale = params.locale;
  const t = await getTranslations({ locale, namespace: 'privacy' });

  return (
    <LegalPageLayout
      locale={locale}
      backToHomeLabel={t('back_to_home')}
      eyebrow={t('eyebrow')}
      title={t('page_title')}
      description={t('page_description')}
      lastUpdated={t('last_updated')}
    >
      <h2>{t('section1_title')}</h2>
      <p>{t('section1_content')}</p>

      <h2>{t('section2_title')}</h2>
      <p>{t('section2_content')}</p>

      <h2>{t('section3_title')}</h2>
      <p>{t('section3_content')}</p>

      <h2>{t('section4_title')}</h2>
      <p>{t('section4_content')}</p>

      <h2>{t('section5_title')}</h2>
      <p>{t('section5_content')}</p>

      <h2>{t('section6_title')}</h2>
      <p>{t('section6_content')}</p>

      <h2>{t('section7_title')}</h2>
      <p>{t('section7_content')}</p>

      <h2>{t('section8_title')}</h2>
      <p>{t('section8_content')}</p>
    </LegalPageLayout>
  );
}
