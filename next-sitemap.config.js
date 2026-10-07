const { getPlayerSitemapPaths } = require('./lib/playerSitemapPaths');

/** @type {import('next-sitemap').IConfig} */
const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://promiscope.example';

module.exports = {
  siteUrl,
  generateRobotsTxt: false,
  exclude: [
    // ── Always-private, wallet-gated or admin-only routes ──────────────────
    '/player',
    '/validator',
    '/admin',
    '/admin/*',
    '/api',
    '/api/*',

    // ── Scout private routes ───────────────────────────────────────────────
    '/scout/subscribe',
    '/scout/watchlist',
    '/scout/compare',

    // ── User account & recovery routes ────────────────────────────────────
    '/settings',
    '/recovery',

    // ── Academy management routes ─────────────────────────────────────────
    '/academy/bulk-import',

    // ── Locale-prefixed variants (en / fr / sw) ───────────────────────────
    '/en/admin',
    '/fr/admin',
    '/sw/admin',
    '/en/admin/*',
    '/fr/admin/*',
    '/sw/admin/*',

    '/en/scout/subscribe',
    '/fr/scout/subscribe',
    '/sw/scout/subscribe',

    '/en/scout/watchlist',
    '/fr/scout/watchlist',
    '/sw/scout/watchlist',

    '/en/scout/compare',
    '/fr/scout/compare',
    '/sw/scout/compare',

    '/en/settings',
    '/fr/settings',
    '/sw/settings',

    '/en/recovery',
    '/fr/recovery',
    '/sw/recovery',

    '/en/academy/bulk-import',
    '/fr/academy/bulk-import',
    '/sw/academy/bulk-import',

    // ── Wildcard catch-all for any locale prefix ───────────────────────────
    '/*/admin',
    '/*/scout/subscribe',
    '/*/scout/watchlist',
    '/*/scout/compare',
    '/*/settings',
    '/*/recovery',
    '/*/academy/bulk-import',
  ],
  // Real, locale-prefixed player profile URLs from the indexer (#1350).
  additionalPaths: () => getPlayerSitemapPaths({ siteUrl }),
  sitemapSize: 7000,
};
