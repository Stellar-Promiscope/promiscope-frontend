import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import LocaleLayout, {
  generateMetadata,
  generateStaticParams,
} from '@/app/[locale]/layout';

const setRequestLocale = jest.fn();

jest.mock('next-intl/server', () => ({
  setRequestLocale: (...args: unknown[]) => setRequestLocale(...args),
  getTranslations: async ({
    locale,
    namespace,
  }: {
    locale: string;
    namespace: string;
  }) => {
    const messages = require(`@/messages/${locale}.json`);
    return (key: string) => messages[namespace][key];
  },
}));

const mockHeaders = new Map<string, string>();

jest.mock('next/headers', () => ({
  headers: jest.fn().mockImplementation(async () => ({
    get: (key: string) => mockHeaders.get(key) ?? null,
  })),
}));

describe('LocaleLayout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHeaders.clear();
    process.env.NEXT_PUBLIC_APP_URL = 'https://promiscope.example';
  });

  it('renders its children unchanged', () => {
    render(
      <LocaleLayout params={{ locale: 'fr' }}>
        <p>Locale-scoped content</p>
      </LocaleLayout>,
    );

    expect(screen.getByText('Locale-scoped content')).toBeInTheDocument();
  });

  it('sets lang="fr" on the locale root for French', () => {
    render(
      <LocaleLayout params={{ locale: 'fr' }}>
        <p>Bonjour</p>
      </LocaleLayout>,
    );

    expect(screen.getByTestId('locale-lang')).toHaveAttribute('lang', 'fr');
  });

  it('sets lang="sw" on the locale root for Swahili', () => {
    render(
      <LocaleLayout params={{ locale: 'sw' }}>
        <p>Habari</p>
      </LocaleLayout>,
    );

    expect(screen.getByTestId('locale-lang')).toHaveAttribute('lang', 'sw');
  });

  it('sets the request locale from params', () => {
    render(
      <LocaleLayout params={{ locale: 'sw' }}>
        <p>content</p>
      </LocaleLayout>,
    );

    expect(setRequestLocale).toHaveBeenCalledWith('sw');
  });

  it('generates static params for every supported locale', () => {
    expect(generateStaticParams()).toEqual([
      { locale: 'en' },
      { locale: 'fr' },
      { locale: 'sw' },
    ]);
  });

  describe('generateMetadata', () => {
    it('returns localized title, description, Open Graph and Twitter fields', async () => {
      mockHeaders.set('x-pathname', '/fr/scout');

      const metadata = await generateMetadata({ params: { locale: 'fr' } });

      const fr = require('@/messages/fr.json').meta;
      expect(metadata).toMatchObject({
        title: fr.title,
        description: fr.description,
        openGraph: {
          title: fr.title,
          description: fr.description,
          url: 'https://promiscope.example/fr/scout',
          siteName: 'Promiscope',
          type: 'website',
          locale: 'fr_FR',
          alternateLocale: ['en_US', 'sw_KE'],
        },
        twitter: {
          card: 'summary_large_image',
          title: fr.title,
          description: fr.description,
        },
      });
      // The raster OG image comes from app/[locale]/opengraph-image.tsx.
      expect(JSON.stringify(metadata)).not.toMatch(/\.svg/);
    });

    it('returns canonical URL and hreflang alternates from x-pathname header', async () => {
      mockHeaders.set('x-pathname', '/en/scout/abc123');

      const metadata = await generateMetadata({ params: { locale: 'en' } });

      expect(metadata).toMatchObject({
        alternates: {
          canonical: 'https://promiscope.example/en/scout/abc123',
          languages: {
            en: 'https://promiscope.example/en/scout/abc123',
            fr: 'https://promiscope.example/fr/scout/abc123',
            sw: 'https://promiscope.example/sw/scout/abc123',
            'x-default': 'https://promiscope.example/en/scout/abc123',
          },
        },
      });
    });

    it('falls back to root when x-pathname header is absent', async () => {
      const metadata = await generateMetadata({ params: { locale: 'en' } });

      expect(metadata).toMatchObject({
        alternates: {
          canonical: 'https://promiscope.example/',
          languages: {
            en: 'https://promiscope.example/en/',
            fr: 'https://promiscope.example/fr/',
            sw: 'https://promiscope.example/sw/',
            'x-default': 'https://promiscope.example/en/',
          },
        },
      });
    });

    it('uses NEXT_PUBLIC_APP_URL as the origin', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://example.com';
      mockHeaders.set('x-pathname', '/fr/player/42');

      const metadata = await generateMetadata({ params: { locale: 'en' } });

      expect(metadata).toMatchObject({
        alternates: {
          canonical: 'https://example.com/fr/player/42',
          languages: {
            en: 'https://example.com/en/player/42',
            fr: 'https://example.com/fr/player/42',
            sw: 'https://example.com/sw/player/42',
            'x-default': 'https://example.com/en/player/42',
          },
        },
      });
    });
  });
});
