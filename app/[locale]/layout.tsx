import { ReactNode } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { seoMetadata } from '@/lib/seo';
import { locales } from '@/lib/locales';
import { BRAND_NAME } from '@/lib/brand';

interface LocaleLayoutProps {
  children: ReactNode;
  params: {
    locale: string;
  };
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

// Open Graph locale codes (language_TERRITORY) for each supported locale.
const OG_LOCALES: Record<string, string> = {
  en: 'en_US',
  fr: 'fr_FR',
  sw: 'sw_KE',
};

/**
 * Generates locale-aware SEO metadata for all `app/[locale]/` pages.
 *
 * Each locale-prefixed page emits a `<link rel="canonical">` tag pointing to
 * its own full URL (using NEXT_PUBLIC_APP_URL as the origin). This prevents
 * search engines from treating locale variants as duplicate content.
 *
 * The canonical URL is constructed from the `x-pathname` request header set
 * by the middleware so it reflects the actual page path (e.g.
 * `/en/player/123` → `https://promiscope.example/en/player/123`).
 *
 * Title, description and Open Graph / Twitter fields are translated from the
 * `meta` namespace. The OG image comes from the sibling
 * `opengraph-image.tsx` route and resolves against the root `metadataBase`.
 */
export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const [seo, t] = await Promise.all([
    seoMetadata(),
    getTranslations({ locale, namespace: 'meta' }),
  ]);
  const canonical = seo.alternates?.canonical;
  const title = t('title');
  const description = t('description');

  return {
    ...seo,
    title,
    description,
    openGraph: {
      title,
      description,
      url: typeof canonical === 'string' ? canonical : undefined,
      siteName: BRAND_NAME,
      type: 'website',
      locale: OG_LOCALES[locale] ?? locale,
      alternateLocale: locales
        .filter((l) => l !== locale)
        .map((l) => OG_LOCALES[l] ?? l),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default function LocaleLayout({
  children,
  params: { locale },
}: LocaleLayoutProps) {
  setRequestLocale(locale);

  // `display: contents` avoids introducing a layout box while still exposing
  // the active locale via the lang attribute for assistive tech / WCAG 3.1.1.
  // The root <html lang> is set separately from the pathname in app/layout.tsx
  // and must not hard-code a single locale over this value.
  return (
    <div lang={locale} className="contents" data-testid="locale-lang">
      {children}
    </div>
  );
}
