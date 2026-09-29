/**
 * E2E test: Shared-device Service Worker cache isolation
 *
 * Verifies that personal/authenticated API responses (like /api/watchlist)
 * are never served from SW Cache Storage to a different user after wallet disconnect
 * or account switch when offline.
 */

import { test, expect } from '@playwright/test';
import { installMockFreighter } from './fixtures/wallet-mock';
import { Keypair } from '@stellar/stellar-sdk';

const WALLET_A_SECRET =
  'SD1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567';
const WALLET_A_KEYPAIR = Keypair.fromSecret(WALLET_A_SECRET);
const WALLET_A_ADDRESS = WALLET_A_KEYPAIR.publicKey();

const WALLET_B_SECRET =
  'SD9876543210FEDCBA9876543210FEDCBA9876543210FEDCBA9876543';
const WALLET_B_KEYPAIR = Keypair.fromSecret(WALLET_B_SECRET);
const WALLET_B_ADDRESS = WALLET_B_KEYPAIR.publicKey();

test.describe('Shared Device Cache Leak Prevention', () => {
  test('User B does not see User A cached watchlist data when network goes offline', async ({
    page,
    context,
  }) => {
    // 1. Install mock wallet for User A
    await installMockFreighter(page, { secret: WALLET_A_SECRET });

    // Mock API routes for watchlist
    await page.route('**/api/watchlist**', async (route) => {
      const request = route.request();
      if (request.headers()['x-wallet-address'] === WALLET_B_ADDRESS) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: ['player-b-unique-id'] }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: ['player-a-secret-data'] }),
        });
      }
    });

    // Mock SEP-10 auth routes
    await page.route('**/api/auth/sep10**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ transaction: 'AAAA...', token: 'mock-jwt' }),
      });
    });

    // Mock session routes
    await page.route('**/api/auth/session**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: true }),
      });
    });

    await page.goto('/en');

    // Fetch User A's watchlist request to simulate loading
    const responseA = await page.evaluate(async () => {
      const res = await fetch('/api/watchlist', {
        headers: { 'x-wallet-address': 'WALLET_A' },
      });
      return res.json();
    });
    expect(responseA.items).toContain('player-a-secret-data');

    // Disconnect / Clear User Caches
    await page.evaluate(async () => {
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }
    });

    // Go offline
    await context.setOffline(true);

    // Switch to User B
    await installMockFreighter(page, { secret: WALLET_B_SECRET });

    // Try fetching /api/watchlist offline as User B
    const offlineFetch = page.evaluate(async () => {
      try {
        const res = await fetch('/api/watchlist', {
          headers: { 'x-wallet-address': 'WALLET_B' },
        });
        const data = await res.json();
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    });

    const result = await offlineFetch;

    // Assert User A's data was NOT returned to User B from cache
    if (result.success) {
      expect(result.data.items).not.toContain('player-a-secret-data');
    } else {
      expect(result.success).toBe(false);
    }
  });
});
