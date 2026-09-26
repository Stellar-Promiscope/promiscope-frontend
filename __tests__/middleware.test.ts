/** @jest-environment node */
/**
 * Unit tests for middleware.ts locale routing
 *
 * Tests the locale configuration used by middleware.ts. Since middleware runs
 * in the Next.js Edge runtime with special APIs not available in Jest, we test
 * the underlying locale configuration rather than the middleware function itself.
 *
 * Full routing behavior is verified by E2E tests.
 *
 * Issue #530
 */

import { NextRequest } from 'next/server';
import { locales, defaultLocale } from '@/lib/locales';
import { middleware } from '@/middleware';

describe('middleware.ts locale configuration', () => {
  describe('locale configuration', () => {
    it('supported locales are defined', () => {
      expect(locales).toBeDefined();
      expect(Array.isArray(locales)).toBe(true);
      expect(locales.length).toBeGreaterThan(0);
    });

    it('default locale is defined', () => {
      expect(defaultLocale).toBeDefined();
      expect(typeof defaultLocale).toBe('string');
      expect(defaultLocale.length).toBeGreaterThan(0);
    });

    it('default locale is in supported locales', () => {
      expect(locales).toContain(defaultLocale);
    });

    it('supported locales include en, fr, sw', () => {
      expect(locales).toContain('en');
      expect(locales).toContain('fr');
      expect(locales).toContain('sw');
    });

    it('default locale is English', () => {
      expect(defaultLocale).toBe('en');
    });

    it('locale configuration has exactly 3 supported locales', () => {
      // ScoutOff supports en, fr, sw — this ensures no accidental additions/removals
      expect(locales.length).toBe(3);
      expect(locales).toContain('en');
      expect(locales).toContain('fr');
      expect(locales).toContain('sw');
    });
  });

  describe('middleware file structure', () => {
    it('middleware.ts file exists in project', () => {
      // Verify the middleware file exists by checking if the module path resolves
      // We don't import it because it requires Next.js Edge runtime APIs
      const fs = require('fs');
      const path = require('path');
      const middlewarePath = path.join(process.cwd(), 'middleware.ts');

      expect(fs.existsSync(middlewarePath)).toBe(true);
    });
  });

  describe('regression protection', () => {
    it('locale list never becomes empty', () => {
      expect(locales.length).toBeGreaterThan(0);
    });

    it('default locale always exists', () => {
      expect(defaultLocale).toBeTruthy();
      expect(defaultLocale.length).toBeGreaterThanOrEqual(2);
    });

    it('default locale is always a supported locale', () => {
      expect(locales).toContain(defaultLocale);
    });

    it('all locales are valid ISO 639-1 codes', () => {
      // en, fr, sw are all valid 2-letter ISO 639-1 language codes
      locales.forEach((locale) => {
        expect(typeof locale).toBe('string');
        expect(locale.length).toBe(2);
        expect(locale).toMatch(/^[a-z]{2}$/);
      });
    });
  });
});

describe('middleware locale redirect', () => {
  async function redirectFor(
    url: string,
    headers: Record<string, string> = {},
  ): Promise<string | null> {
    const res = await middleware(new NextRequest(url, { headers }));
    return res.headers.get('location');
  }

  it('keeps a ?ref= referral code (#1324)', async () => {
    expect(await redirectFor('https://scoutoff.app/scout?ref=TEST')).toBe(
      'https://scoutoff.app/en/scout?ref=TEST',
    );
  });

  it('keeps multiple query params', async () => {
    expect(
      await redirectFor(
        'https://scoutoff.app/compare?ids=1,2&utm_source=x&utm_medium=y',
      ),
    ).toBe('https://scoutoff.app/en/compare?ids=1,2&utm_source=x&utm_medium=y');
  });

  it('keeps encoded values intact', async () => {
    expect(
      await redirectFor('https://scoutoff.app/search?q=caf%C3%A9%20%26%20co'),
    ).toBe('https://scoutoff.app/en/search?q=caf%C3%A9%20%26%20co');
  });

  it('redirects without a query string unchanged', async () => {
    expect(await redirectFor('https://scoutoff.app/scout')).toBe(
      'https://scoutoff.app/en/scout',
    );
  });

  it('negotiates the locale from accept-language q-values (#1325)', async () => {
    expect(
      await redirectFor('https://scoutoff.app/scout', {
        'accept-language': 'de-DE,de;q=0.9,fr;q=0.8,en;q=0.7',
      }),
    ).toBe('https://scoutoff.app/fr/scout');
  });

  it('prefers the NEXT_LOCALE cookie over accept-language', async () => {
    expect(
      await redirectFor('https://scoutoff.app/scout', {
        'accept-language': 'fr',
        cookie: 'NEXT_LOCALE=sw',
      }),
    ).toBe('https://scoutoff.app/sw/scout');
  });
});
