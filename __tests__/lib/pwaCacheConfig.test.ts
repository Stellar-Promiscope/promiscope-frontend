/**
 * Unit tests for lib/pwaCacheConfig.ts
 *
 * The exported `tunedRuntimeCaching` array is a pure config object — no
 * network calls, no side effects. Tests validate the cache names, urlPattern
 * regexes, handlers, allowlist rules vs NetworkOnly catch-all rules, and the
 * behavior of `clearUserCaches()`.
 */
import { tunedRuntimeCaching, clearUserCaches } from '@/lib/pwaCacheConfig';

describe('tunedRuntimeCaching — overall shape', () => {
  it('exports an array with runtime caching entries', () => {
    expect(Array.isArray(tunedRuntimeCaching)).toBe(true);
    expect(tunedRuntimeCaching.length).toBeGreaterThanOrEqual(8);
  });

  it('every entry (except NetworkOnly catch-all) has urlPattern and handler', () => {
    for (const entry of tunedRuntimeCaching) {
      expect(entry).toHaveProperty('urlPattern');
      expect(entry).toHaveProperty('handler');
    }
  });
});

describe('Font and Icon assets entries', () => {
  const fontEntry = tunedRuntimeCaching.find(
    (e) => e.options?.cacheName === 'font-assets-cache',
  );
  const iconEntry = tunedRuntimeCaching.find(
    (e) => e.options?.cacheName === 'icon-assets-cache',
  );

  it('font entry uses CacheFirst handler and matches font files', () => {
    expect(fontEntry).toBeDefined();
    expect(fontEntry?.handler).toBe('CacheFirst');
    const pattern = fontEntry?.urlPattern as RegExp;
    expect(pattern.test('/fonts/myfont.woff2')).toBe(true);
    expect(pattern.test('/images/photo.png')).toBe(false);
  });

  it('icon entry uses CacheFirst handler and matches icon files under /icons/', () => {
    expect(iconEntry).toBeDefined();
    expect(iconEntry?.handler).toBe('CacheFirst');
    const pattern = iconEntry?.urlPattern as RegExp;
    expect(pattern.test('/icons/icon-192.png')).toBe(true);
    expect(pattern.test('/images/logo.png')).toBe(false);
  });
});

describe('Public API allowlist entries', () => {
  const mediaEntry = tunedRuntimeCaching.find(
    (e) => e.options?.cacheName === 'public-media-cache',
  );
  const publicApiEntry = tunedRuntimeCaching.find(
    (e) => e.options?.cacheName === 'public-api-cache',
  );

  it('media entry matches /api/media/* content-addressed endpoints', () => {
    expect(mediaEntry).toBeDefined();
    expect(mediaEntry?.handler).toBe('CacheFirst');
    const pattern = mediaEntry?.urlPattern as RegExp;
    expect(pattern.test('/api/media/bafybeic12345')).toBe(true);
    expect(pattern.test('/api/watchlist')).toBe(false);
  });

  it('public API entry matches /api/leaderboard and /api/players/search', () => {
    expect(publicApiEntry).toBeDefined();
    expect(publicApiEntry?.handler).toBe('StaleWhileRevalidate');
    const pattern = publicApiEntry?.urlPattern as RegExp;
    expect(pattern.test('/api/leaderboard')).toBe(true);
    expect(pattern.test('/api/players/search?name=test')).toBe(true);
    expect(pattern.test('/api/watchlist')).toBe(false);
    expect(pattern.test('/api/admin/audit-log')).toBe(false);
  });
});

describe('API catch-all NetworkOnly entry', () => {
  const networkOnlyEntry = tunedRuntimeCaching.find(
    (e) => e.handler === 'NetworkOnly',
  );

  it('exists and matches all /api/* URLs', () => {
    expect(networkOnlyEntry).toBeDefined();
    expect(networkOnlyEntry?.handler).toBe('NetworkOnly');
    const pattern = networkOnlyEntry?.urlPattern as RegExp;
    expect(pattern.test('/api/watchlist')).toBe(true);
    expect(pattern.test('/api/saved-searches')).toBe(true);
    expect(pattern.test('/api/recently-viewed')).toBe(true);
    expect(pattern.test('/api/auth/sessions')).toBe(true);
    expect(pattern.test('/api/notification-preferences')).toBe(true);
    expect(pattern.test('/api/data-export')).toBe(true);
    expect(pattern.test('/api/admin/audit-log')).toBe(true);
    expect(pattern.test('/api/admin/fraud-flags')).toBe(true);
  });

  it('ensures personal / credentialed API routes do NOT match any caching allowlist', () => {
    const cachingApiEntries = tunedRuntimeCaching.filter(
      (e) =>
        e.handler !== 'NetworkOnly' &&
        typeof e.urlPattern === 'object' &&
        (e.urlPattern as RegExp).source.includes('api'),
    );

    const personalRoutes = [
      '/api/watchlist',
      '/api/saved-searches',
      '/api/recently-viewed',
      '/api/auth/sessions',
      '/api/auth/session',
      '/api/auth/sep10',
      '/api/notification-preferences',
      '/api/data-export',
      '/api/admin/audit-log',
      '/api/admin/fraud-flags',
    ];

    for (const route of personalRoutes) {
      for (const entry of cachingApiEntries) {
        const pattern = entry.urlPattern as RegExp;
        expect(pattern.test(route)).toBe(false);
      }
    }
  });
});

describe('clearUserCaches helper', () => {
  const originalCaches = window.caches;
  const originalServiceWorker = navigator.serviceWorker;

  afterEach(() => {
    Object.defineProperty(window, 'caches', {
      value: originalCaches,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      value: originalServiceWorker,
      writable: true,
      configurable: true,
    });
  });

  it('deletes api and user caches and messages service worker controller', async () => {
    const deletedCaches: string[] = [];
    const mockDelete = jest.fn((name: string) => {
      deletedCaches.push(name);
      return Promise.resolve(true);
    });

    const mockCaches = {
      keys: jest
        .fn()
        .mockResolvedValue(['api-cache', 'static-assets', 'player-scout-data-cache']),
      delete: mockDelete,
    };

    const mockPostMessage = jest.fn();

    Object.defineProperty(window, 'caches', {
      value: mockCaches,
      writable: true,
      configurable: true,
    });

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        controller: {
          postMessage: mockPostMessage,
        },
      },
      writable: true,
      configurable: true,
    });

    await clearUserCaches();

    expect(mockCaches.keys).toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith('api-cache');
    expect(mockDelete).toHaveBeenCalledWith('player-scout-data-cache');
    expect(mockDelete).not.toHaveBeenCalledWith('static-assets');
    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'CLEAR_USER_CACHES',
    });
  });

  it('handles missing caches and controller gracefully', async () => {
    Object.defineProperty(window, 'caches', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {},
      writable: true,
      configurable: true,
    });

    await expect(clearUserCaches()).resolves.not.toThrow();
  });
});
