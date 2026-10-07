import {
  getBaseUrl,
  buildLanguageAlternates,
  getCanonicalUrl,
  seoMetadata,
  locales,
  defaultLocale,
} from '@/lib/seo';

const mockHeaders = new Map<string, string>();

jest.mock('next/headers', () => ({
  headers: jest.fn().mockImplementation(async () => ({
    get: (key: string) => mockHeaders.get(key) ?? null,
  })),
}));

describe('lib/seo', () => {
  const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    mockHeaders.clear();
    process.env.NEXT_PUBLIC_APP_URL = 'https://promiscope.example';
  });

  afterAll(() => {
    process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL;
  });

  describe('locales / defaultLocale', () => {
    it('exposes the three supported locales', () => {
      expect(locales).toEqual(['en', 'fr', 'sw']);
    });

    it('defaults to en', () => {
      expect(defaultLocale).toBe('en');
    });
  });

  describe('getBaseUrl', () => {
    it('returns NEXT_PUBLIC_APP_URL when set', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://custom.example';
      expect(getBaseUrl()).toBe('https://custom.example');
    });

    it('falls back to the promiscope.example default when unset', () => {
      delete process.env.NEXT_PUBLIC_APP_URL;
      expect(getBaseUrl()).toBe('https://promiscope.example');
    });
  });

  describe('buildLanguageAlternates', () => {
    it('builds one URL per locale plus x-default for a nested page', () => {
      const languages = buildLanguageAlternates('/en/player/123');

      expect(languages).toEqual({
        en: 'https://promiscope.example/en/player/123',
        fr: 'https://promiscope.example/fr/player/123',
        sw: 'https://promiscope.example/sw/player/123',
        'x-default': 'https://promiscope.example/en/player/123',
      });
    });

    it('produces the same alternates regardless of which locale the request came in on', () => {
      // Reciprocity: /en/player/123, /fr/player/123, and /sw/player/123 all
      // describe the same logical page, so they must all resolve to the
      // exact same set of alternates.
      const fromEn = buildLanguageAlternates('/en/player/123');
      const fromFr = buildLanguageAlternates('/fr/player/123');
      const fromSw = buildLanguageAlternates('/sw/player/123');

      expect(fromEn).toEqual(fromFr);
      expect(fromFr).toEqual(fromSw);
    });

    it('handles a deeper nested path', () => {
      const languages = buildLanguageAlternates('/fr/scout/dashboard/settings');

      expect(languages).toEqual({
        en: 'https://promiscope.example/en/scout/dashboard/settings',
        fr: 'https://promiscope.example/fr/scout/dashboard/settings',
        sw: 'https://promiscope.example/sw/scout/dashboard/settings',
        'x-default': 'https://promiscope.example/en/scout/dashboard/settings',
      });
    });

    it('handles the bare locale root without a trailing path', () => {
      const languages = buildLanguageAlternates('/en');

      expect(languages).toEqual({
        en: 'https://promiscope.example/en',
        fr: 'https://promiscope.example/fr',
        sw: 'https://promiscope.example/sw',
        'x-default': 'https://promiscope.example/en',
      });
    });

    it('handles the bare locale root with a trailing slash', () => {
      const languages = buildLanguageAlternates('/sw/');

      expect(languages).toEqual({
        en: 'https://promiscope.example/en',
        fr: 'https://promiscope.example/fr',
        sw: 'https://promiscope.example/sw',
        'x-default': 'https://promiscope.example/en',
      });
    });

    it('does not produce a malformed (double-slash) URL for the bare root', () => {
      const languages = buildLanguageAlternates('/fr');

      Object.values(languages).forEach((url) => {
        expect(url).not.toMatch(/[^:]\/\//);
      });
    });

    it('respects NEXT_PUBLIC_APP_URL as the origin for every locale', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://example.com';

      const languages = buildLanguageAlternates('/sw/player/42');

      expect(languages).toEqual({
        en: 'https://example.com/en/player/42',
        fr: 'https://example.com/fr/player/42',
        sw: 'https://example.com/sw/player/42',
        'x-default': 'https://example.com/en/player/42',
      });
    });
  });

  describe('getCanonicalUrl', () => {
    it('builds the canonical URL from the x-pathname header', async () => {
      mockHeaders.set('x-pathname', '/en/player/123');

      const canonical = await getCanonicalUrl();

      expect(canonical.toString()).toBe('https://promiscope.example/en/player/123');
    });

    it('falls back to root when x-pathname is absent', async () => {
      const canonical = await getCanonicalUrl();

      expect(canonical.toString()).toBe('https://promiscope.example/');
    });
  });

  describe('seoMetadata', () => {
    it('includes both canonical and languages for a nested page', async () => {
      mockHeaders.set('x-pathname', '/en/player/123');

      const metadata = await seoMetadata();

      expect(metadata).toEqual({
        alternates: {
          canonical: 'https://promiscope.example/en/player/123',
          languages: {
            en: 'https://promiscope.example/en/player/123',
            fr: 'https://promiscope.example/fr/player/123',
            sw: 'https://promiscope.example/sw/player/123',
            'x-default': 'https://promiscope.example/en/player/123',
          },
        },
      });
    });

    it('includes languages for the bare locale root', async () => {
      mockHeaders.set('x-pathname', '/fr');

      const metadata = await seoMetadata();

      expect(metadata.alternates?.languages).toEqual({
        en: 'https://promiscope.example/en',
        fr: 'https://promiscope.example/fr',
        sw: 'https://promiscope.example/sw',
        'x-default': 'https://promiscope.example/en',
      });
    });
  });
});
