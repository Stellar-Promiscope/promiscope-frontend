/**
 * Single source of truth for next-pwa `runtimeCaching` entries for this app.
 *
 * Static, rarely-changing assets (icons, fonts) use CacheFirst with long TTLs.
 * Public, non-personal API endpoints (e.g., content-addressed /api/media/* and
 * public leaderboard/search data) are cached via an explicit allowlist.
 *
 * ALL OTHER /api/* endpoints — especially credentialed/personal routes like
 * /api/watchlist, /api/saved-searches, /api/recently-viewed, /api/auth/*,
 * /api/notification-preferences, /api/data-export, and /api/admin/* — use
 * NetworkOnly so they are never stored in Cache Storage, avoiding cross-account
 * data leakage on shared devices.
 */

export interface RuntimeCachingEntry {
  urlPattern: RegExp | string;
  handler:
    | 'CacheFirst'
    | 'StaleWhileRevalidate'
    | 'NetworkFirst'
    | 'NetworkOnly'
    | 'CacheOnly';
  options?: {
    cacheName?: string;
    expiration?: {
      maxEntries?: number;
      maxAgeSeconds?: number;
    };
    [key: string]: unknown;
  };
}

export const tunedRuntimeCaching: RuntimeCachingEntry[] = [
  {
    urlPattern:
      /^https:\/\/(soroban-testnet|horizon-testnet|soroban)\.stellar\.org\/.*/i,
    handler: 'NetworkFirst',
    options: {
      cacheName: 'stellar-rpc-cache',
      expiration: { maxEntries: 32, maxAgeSeconds: 60 },
    },
  },
  {
    urlPattern: /\.(?:woff2?|ttf|eot|otf)$/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'font-assets-cache',
      expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 365 },
    },
  },
  {
    urlPattern: /\/icons\/.*\.(?:png|svg|ico)$/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'icon-assets-cache',
      expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 180 },
    },
  },
  {
    urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'static-assets',
      expiration: { maxEntries: 128, maxAgeSeconds: 30 * 24 * 60 * 60 },
    },
  },
  {
    urlPattern: /\.(?:js|css)$/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'static-js-css',
      expiration: { maxEntries: 64, maxAgeSeconds: 7 * 24 * 60 * 60 },
    },
  },
  // Explicit allowlist of public, non-personal API endpoints
  {
    urlPattern: /\/api\/media\/.*/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'public-media-cache',
      expiration: { maxEntries: 64, maxAgeSeconds: 30 * 24 * 60 * 60 },
    },
  },
  {
    urlPattern: /\/api\/(?:leaderboard|players\/search).*/i,
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: 'public-api-cache',
      expiration: { maxEntries: 64, maxAgeSeconds: 60 * 5 },
    },
  },
  // NetworkOnly for all other /api/* routes (never cached in Cache Storage)
  {
    urlPattern: /\/api\/.*/i,
    handler: 'NetworkOnly',
  },
];

/**
 * Best-effort deletion of API/user-scoped Cache Storage entries and SW notification.
 * Called on wallet disconnect and account switch to prevent cross-account
 * data leakage on shared devices.
 */
export async function clearUserCaches(): Promise<void> {
  if (typeof window === 'undefined') return;

  // 1. Direct Cache Storage deletion
  if ('caches' in window) {
    try {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map(async (name) => {
          if (
            name === 'api-cache' ||
            name.includes('api') ||
            name.includes('player-scout')
          ) {
            await caches.delete(name);
          }
        }),
      );
    } catch {
      // Best effort — ignore storage errors
    }
  }

  // 2. Message ServiceWorker to clear per-user caches
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    try {
      navigator.serviceWorker.controller.postMessage({
        type: 'CLEAR_USER_CACHES',
      });
    } catch {
      // Best effort
    }
  }
}
