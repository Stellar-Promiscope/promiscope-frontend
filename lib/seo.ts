import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { locales, defaultLocale } from '@/lib/locales';

export type { Locale } from '@/lib/locales';
export { locales, defaultLocale };

/**
 * Returns the base URL for the application from environment or a sensible default.
 */
export function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://promiscope.example';
}

/**
 * Strips a leading `/{locale}` prefix from a pathname, returning the
 * locale-independent remainder.
 *
 * The remainder always either starts with `/` or is empty (for a bare
 * locale root):
 *
 * - `/en/player/123` -> `/player/123`
 * - `/en`            -> `` (empty string)
 * - `/en/`           -> `` (empty string)
 * - `/unknown/path`  -> `/unknown/path` (no recognized locale prefix)
 */
function stripLocalePrefix(pathname: string): string {
  for (const locale of locales) {
    const prefix = `/${locale}`;
    if (pathname === prefix || pathname === `${prefix}/`) {
      return '';
    }
    if (pathname.startsWith(`${prefix}/`)) {
      return pathname.slice(prefix.length);
    }
  }
  return pathname;
}

/**
 * Builds the hreflang alternates map for a given pathname: one absolute URL
 * per supported locale, plus an `x-default` entry.
 *
 * The locale-independent suffix is derived once from `pathname` and then
 * re-prepended with each supported locale, so every generated URL points at
 * the equivalent page in that locale. This is what guarantees hreflang
 * reciprocity — the `en`, `fr`, and `sw` pages for a given path all list the
 * exact same set of alternates (themselves included), and `x-default`
 * always points at the `en` variant.
 *
 * - `/en/player/123` -> { en: '.../en/player/123', fr: '.../fr/player/123',
 *   sw: '.../sw/player/123', 'x-default': '.../en/player/123' }
 * - `/en` -> { en: '.../en', fr: '.../fr', sw: '.../sw', 'x-default': '.../en' }
 */
export function buildLanguageAlternates(
  pathname: string,
): Record<string, string> {
  const baseUrl = getBaseUrl();
  const suffix = stripLocalePrefix(pathname);

  const languages: Record<string, string> = {};
  for (const locale of locales) {
    languages[locale] = new URL(`/${locale}${suffix}`, baseUrl).toString();
  }
  languages['x-default'] = languages[defaultLocale];

  return languages;
}

/**
 * Constructs the full canonical URL for the current request.
 *
 * Reads the `x-pathname` header (set by middleware) to determine the current
 * path, then prepends the app origin. Falls back to the root path if the
 * header is absent.
 */
export async function getCanonicalUrl(): Promise<URL> {
  const baseUrl = getBaseUrl();
  const headersList = await headers();
  const pathname = headersList.get('x-pathname') || '/';
  return new URL(pathname, baseUrl);
}

/**
 * Generates SEO metadata for the current page: a canonical URL plus
 * `hreflang` alternates (`alternates.languages`) for every supported locale
 * and `x-default`.
 *
 * Designed for use in layout/page `generateMetadata` functions.
 *
 * @example
 * ```ts
 * // app/[locale]/layout.tsx
 * export async function generateMetadata(): Promise<Metadata> {
 *   return seoMetadata();
 * }
 * ```
 */
export async function seoMetadata(): Promise<Metadata> {
  const baseUrl = getBaseUrl();
  const headersList = await headers();
  const pathname = headersList.get('x-pathname') || '/';

  const canonical = new URL(pathname, baseUrl);
  const languages = buildLanguageAlternates(pathname);

  return {
    alternates: {
      canonical: canonical.toString(),
      languages,
    },
  };
}

/**
 * Options for building comprehensive page metadata including OpenGraph and Twitter cards.
 */
export interface PageMetadataOptions {
  /** Page title (displayed in browser tab) */
  title: string;
  /** Page description (displayed in search results and social cards) */
  description: string;
  /** Relative path for the page (e.g., '/changelog', '/privacy') */
  path: string;
  /** OpenGraph image URL (defaults to /og-image.svg) */
  openGraphImage?: string;
  /** OpenGraph type (defaults to 'website') */
  openGraphType?: 'website' | 'article' | 'profile';
  /** Twitter card type (defaults to 'summary_large_image') */
  twitterCard?: 'summary' | 'summary_large_image';
}

/**
 * Generates comprehensive SEO metadata for a page, including:
 * - Title and description
 * - Canonical URL and hreflang alternates
 * - OpenGraph tags for social sharing
 * - Twitter card tags for Twitter sharing
 *
 * Designed for use in static pages like changelog, privacy, terms, etc.
 *
 * @example
 * ```ts
 * // app/[locale]/changelog/page.tsx
 * export async function generateMetadata({ params }: Props): Promise<Metadata> {
 *   const t = await getTranslations({ locale: params.locale, namespace: 'changelog' });
 *   return buildPageMetadata({
 *     title: `${t('page_title')} | Promiscope`,
 *     description: t('page_description'),
 *     path: `/${params.locale}/changelog`,
 *   });
 * }
 * ```
 */
export async function buildPageMetadata({
  title,
  description,
  path,
  openGraphImage = `${getBaseUrl()}/og-image.svg`,
  openGraphType = 'website',
  twitterCard = 'summary_large_image',
}: PageMetadataOptions): Promise<Metadata> {
  const baseUrl = getBaseUrl();
  const fullUrl = new URL(path, baseUrl).toString();

  // Get canonical and alternates from seoMetadata
  const baseMetadata = await seoMetadata();

  return {
    title,
    description,
    ...baseMetadata,
    openGraph: {
      title,
      description,
      url: fullUrl,
      siteName: 'Promiscope',
      type: openGraphType,
      images: [
        {
          url: openGraphImage,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: twitterCard,
      title,
      description,
      images: [openGraphImage],
    },
  };
}
