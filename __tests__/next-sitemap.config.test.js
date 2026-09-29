/**
 * Unit tests for next-sitemap.config.js
 *
 * Ensures the sitemap config correctly excludes all private, wallet-gated, and
 * admin-only routes for every configured locale prefix. This test guards against
 * regressions where a future edit accidentally removes a critical exclusion pattern.
 *
 * Issue #532; updated to cover /scout/watchlist, /settings, /recovery,
 * /academy/bulk-import, and /scout/compare added after the initial list.
 */

const config = require('../next-sitemap.config');

// ── Canonical list of all known private routes ───────────────────────────────
// Update this list whenever a new wallet-gated or non-public route is added
// under app/[locale]/. The tests below assert every entry is present in the
// sitemap exclude array.
//
// ROUTES_WITH_LOCALE_VARIANTS: routes that must appear as both bare paths AND
// with each locale prefix (e.g. /en/admin, /fr/settings …) and a /*/wildcard.
// ROUTES_BARE_ONLY: routes excluded only at root level (no locale variants
// currently needed — /player and /validator are template routes whose content
// is driven by [id]; /api is a structural exclusion).
const ROUTES_WITH_LOCALE_VARIANTS = [
  '/admin',
  '/scout/subscribe',
  '/scout/watchlist',
  '/scout/compare',
  '/settings',
  '/recovery',
  '/academy/bulk-import',
];

const ROUTES_BARE_ONLY = ['/player', '/validator', '/api', '/api/*'];

const PRIVATE_ROUTES = [...ROUTES_WITH_LOCALE_VARIANTS, ...ROUTES_BARE_ONLY];

const LOCALES = ['en', 'fr', 'sw'];

describe('next-sitemap.config.js', () => {
  it('exports a valid config object', () => {
    expect(config).toBeDefined();
    expect(typeof config).toBe('object');
    expect(config.siteUrl).toBeDefined();
    expect(Array.isArray(config.exclude)).toBe(true);
  });

  it('contains siteUrl', () => {
    expect(config.siteUrl).toBeTruthy();
    expect(typeof config.siteUrl).toBe('string');
  });

  describe('exclude array', () => {
    it('is defined and is an array', () => {
      expect(config.exclude).toBeDefined();
      expect(Array.isArray(config.exclude)).toBe(true);
    });

    it('excludes every known private route at root level', () => {
      PRIVATE_ROUTES.forEach((route) => {
        expect(config.exclude).toContain(route);
      });
    });

    it('excludes every known private route for each locale prefix', () => {
      LOCALES.forEach((locale) => {
        ROUTES_WITH_LOCALE_VARIANTS.forEach((route) => {
          const localised = `/${locale}${route}`;
          expect(config.exclude).toContain(localised);
        });
      });
    });

    it('includes wildcard catch-all patterns for every private route that has locale variants', () => {
      ROUTES_WITH_LOCALE_VARIANTS.forEach((route) => {
        const wildcard = `/*${route}`;
        expect(config.exclude).toContain(wildcard);
      });
    });

    // ── Backward-compatible individual assertions ────────────────────────────

    it('excludes /admin route', () => {
      expect(config.exclude).toContain('/admin');
    });

    it('excludes admin route for all locales (en, fr, sw)', () => {
      LOCALES.forEach((locale) => {
        expect(config.exclude).toContain(`/${locale}/admin`);
      });
    });

    it('includes wildcard pattern for any locale admin route', () => {
      expect(config.exclude).toContain('/*/admin');
    });

    it('excludes /api base route', () => {
      expect(config.exclude).toContain('/api');
    });

    it('excludes /api/* wildcard routes', () => {
      expect(config.exclude).toContain('/api/*');
    });

    it('excludes /scout/watchlist and locale variants', () => {
      expect(config.exclude).toContain('/scout/watchlist');
      LOCALES.forEach((locale) => {
        expect(config.exclude).toContain(`/${locale}/scout/watchlist`);
      });
    });

    it('excludes /settings and locale variants', () => {
      expect(config.exclude).toContain('/settings');
      LOCALES.forEach((locale) => {
        expect(config.exclude).toContain(`/${locale}/settings`);
      });
    });

    it('excludes /recovery and locale variants', () => {
      expect(config.exclude).toContain('/recovery');
      LOCALES.forEach((locale) => {
        expect(config.exclude).toContain(`/${locale}/recovery`);
      });
    });

    it('excludes /academy/bulk-import and locale variants', () => {
      expect(config.exclude).toContain('/academy/bulk-import');
      LOCALES.forEach((locale) => {
        expect(config.exclude).toContain(`/${locale}/academy/bulk-import`);
      });
    });

    it('excludes /scout/compare and locale variants', () => {
      expect(config.exclude).toContain('/scout/compare');
      LOCALES.forEach((locale) => {
        expect(config.exclude).toContain(`/${locale}/scout/compare`);
      });
    });
  });

  describe('other config properties', () => {
    it('has generateRobotsTxt set to false', () => {
      expect(config.generateRobotsTxt).toBe(false);
    });

    it('has sitemapSize configured', () => {
      expect(config.sitemapSize).toBeDefined();
      expect(typeof config.sitemapSize).toBe('number');
      expect(config.sitemapSize).toBeGreaterThan(0);
    });

    it('has additionalPaths defined', () => {
      expect(config.additionalPaths).toBeDefined();
      expect(typeof config.additionalPaths).toBe('function');
    });
  });

  describe('regression protection — full expected exclude list', () => {
    it('contains every known private route pattern (root + per-locale + wildcard)', () => {
      // Root-level patterns
      PRIVATE_ROUTES.forEach((route) => {
        expect(config.exclude).toContain(route);
      });

      // Per-locale patterns (only routes that have locale variants)
      LOCALES.forEach((locale) => {
        ROUTES_WITH_LOCALE_VARIANTS.forEach((route) => {
          const localised = `/${locale}${route}`;
          expect(config.exclude).toContain(localised);
        });
      });

      // Wildcard patterns
      ROUTES_WITH_LOCALE_VARIANTS.forEach((route) => {
        const wildcard = `/*${route}`;
        expect(config.exclude).toContain(wildcard);
      });
    });

    it('fails if admin exclusions are removed', () => {
      const adminPatterns = [
        '/admin',
        '/en/admin',
        '/fr/admin',
        '/sw/admin',
        '/*/admin',
      ];
      adminPatterns.forEach((pattern) => {
        expect(config.exclude).toContain(pattern);
      });
    });

    it('fails if API exclusions are removed', () => {
      ['/api', '/api/*'].forEach((pattern) => {
        expect(config.exclude).toContain(pattern);
      });
    });
  });

  describe('player profile URLs (#1350)', () => {
    const { getPlayerSitemapPaths } = require('../lib/playerSitemapPaths');

    const pages = {
      player_registered: {
        events: [
          { playerId: 'P1', timestamp: 1_700_000_000, data: {} },
          {
            playerId: 'P2',
            timestamp: 1_700_000_000,
            data: { archived: true },
          },
          { playerId: 'P3', timestamp: 1_700_000_000, data: {} },
        ],
        nextCursor: null,
      },
      milestone_approved: {
        events: [{ playerId: 'P1', timestamp: 1_710_000_000, data: {} }],
        nextCursor: null,
      },
    };
    const fetchImpl = jest.fn(async (url) => ({
      ok: true,
      json: async () => pages[new URL(url).searchParams.get('type')],
    }));

    it('emits real, locale-prefixed URLs and excludes archived/denylisted players', async () => {
      const paths = await getPlayerSitemapPaths({
        siteUrl: 'https://scoutoff.app',
        indexerUrl: 'http://indexer',
        denylist: ['P3'],
        fetchImpl,
      });

      expect(paths.map((p) => p.loc)).toEqual([
        '/en/player/P1',
        '/fr/player/P1',
        '/sw/player/P1',
      ]);
      expect(paths.some((p) => p.loc.includes('[id]'))).toBe(false);
      expect(paths[0].lastmod).toBe(
        new Date(1_710_000_000 * 1000).toISOString(),
      );
      expect(paths[0].alternateRefs).toContainEqual({
        href: 'https://scoutoff.app/fr/player/P1',
        hreflang: 'fr',
        hrefIsAbsolute: true,
      });
    });

    it('returns no player URLs (instead of failing the build) when the indexer is down', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      const paths = await getPlayerSitemapPaths({
        siteUrl: 'https://scoutoff.app',
        fetchImpl: async () => ({ ok: false, status: 503 }),
      });
      expect(paths).toEqual([]);
    });
  });
});
