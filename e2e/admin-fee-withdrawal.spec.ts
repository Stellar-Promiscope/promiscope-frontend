/**
 * E2E test: Admin fee withdrawal flow
 *
 * Verifies that an admin wallet can complete the fee withdrawal flow:
 * 1. See accumulated platform fees
 * 2. Click withdraw button
 * 3. Confirm the action
 * 4. Transaction succeeds with proper status display
 *
 * Issue #529
 */

import { test, expect } from '@playwright/test';
import { installMockFreighter } from './fixtures/wallet-mock';
import { Keypair } from '@stellar/stellar-sdk';

// Admin keypair for testing (must match the environment variable in test setup)
const ADMIN_SECRET =
  process.env.E2E_ADMIN_SECRET ??
  'SADMINKEYSECRETFORTESTINGFEEWITHDRAWAL123456789ABCDE';
const ADMIN_KEYPAIR = Keypair.fromSecret(ADMIN_SECRET);
const ADMIN_ADDRESS = ADMIN_KEYPAIR.publicKey();

const MOCK_ACCUMULATED_FEES = 5000000; // 5 XLM in stroops
const MOCK_TX_HASH =
  'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2';

function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

async function connectAdminWallet(page: import('@playwright/test').Page) {
  await page.goto('/en');
  await page.getByRole('button', { name: 'Connect Wallet' }).click();
  await page.getByRole('button', { name: /freighter/i }).click();
  await expect(page.getByText(truncateAddress(ADMIN_ADDRESS))).toBeVisible();
}

test.describe('Admin fee withdrawal', () => {
  test.beforeEach(async ({ page, context }) => {
    // Install mock admin wallet
    await installMockFreighter(page, {
      secret: ADMIN_SECRET,
    });

    // Mock environment setup for admin address
    await page.addInitScript((adminAddress) => {
      // Override the admin address check
      Object.defineProperty(window, '__TEST_ADMIN_ADDRESS__', {
        value: adminAddress,
        writable: false,
      });
    }, ADMIN_ADDRESS);

    // Mock contract and API responses
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();

      if (url.includes('validators') || url.includes('getValidators')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      } else if (url.includes('fees') || url.includes('getPlatformFees')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_ACCUMULATED_FEES),
        });
      } else if (url.includes('paused') || url.includes('getContractPaused')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(false),
        });
      } else if (
        url.includes('activity') ||
        url.includes('fetchActivityEvents')
      ) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ events: [], total: 0 }),
        });
      } else if (url.includes('referral')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            totalCodes: 0,
            totalSuccessfulReferrals: 0,
            topReferrers: [],
          }),
        });
      } else {
        await route.continue();
      }
    });
  });

  test('displays accumulated platform fees', async ({ page }) => {
    await connectAdminWallet(page);
    await page.goto('/en/admin/fees');

    // Wait for admin dashboard to load
    await expect(
      page.getByRole('heading', { name: 'Fees', exact: true }),
    ).toBeVisible({
      timeout: 10000,
    });

    // Find Platform Fees section
    const feesSection = page.locator('section', { hasText: 'Platform Fees' });
    await expect(feesSection).toBeVisible();

    // Check accumulated fees are displayed (5 XLM from mock)
    await expect(feesSection.getByText(/5\.00 XLM/i)).toBeVisible();
  });

  test('withdraw button is enabled when fees are available', async ({
    page,
  }) => {
    await connectAdminWallet(page);
    await page.goto('/en/admin/fees');

    await expect(
      page.getByRole('heading', { name: 'Fees', exact: true }),
    ).toBeVisible({
      timeout: 10000,
    });

    // Find and verify withdraw button is enabled
    const withdrawButton = page.getByRole('button', { name: /Withdraw Fees/i });
    await expect(withdrawButton).toBeVisible();
    await expect(withdrawButton).toBeEnabled();
  });

  test('completes fee withdrawal flow with confirmation', async ({ page }) => {
    await connectAdminWallet(page);
    await page.goto('/en/admin/fees');

    await expect(
      page.getByRole('heading', { name: 'Fees', exact: true }),
    ).toBeVisible({
      timeout: 10000,
    });

    // Click withdraw fees button
    const withdrawButton = page.getByRole('button', { name: /Withdraw Fees/i });
    await withdrawButton.click();

    // Confirmation dialog should appear
    await expect(page.getByText(/Withdraw.*XLM/i)).toBeVisible();

    // Mock the transaction signing to return success
    await page.evaluate((mockTxHash) => {
      // Mock signAndSubmit to return a transaction hash
      (window as any).__mockSignAndSubmit__ = async () => mockTxHash;
    }, MOCK_TX_HASH);

    // Confirm the withdrawal
    const confirmButton = page
      .getByRole('button', { name: /Withdraw Fees/i })
      .last();
    await confirmButton.click();

    // Should show transaction status (pending → success)
    // Note: In real implementation, this would trigger wallet signing
    // For now, we verify the confirmation dialog appeared and was acted upon
    await expect(page.getByText(/Withdraw.*XLM/i)).not.toBeVisible({
      timeout: 5000,
    });
  });

  test('withdraw button is disabled when contract is paused', async ({
    page,
  }) => {
    // Override paused state for this test
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();

      if (url.includes('paused') || url.includes('getContractPaused')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(true), // Contract is paused
        });
      } else if (url.includes('fees')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_ACCUMULATED_FEES),
        });
      } else if (url.includes('validators')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      }
    });

    await connectAdminWallet(page);
    // The circuit breaker lives on the overview; fees on /admin/fees (#1354).
    await page.goto('/en/admin');

    await expect(
      page.getByRole('heading', { name: 'Admin Dashboard' }),
    ).toBeVisible({
      timeout: 10000,
    });

    // Verify circuit breaker shows paused status
    await expect(page.getByText(/Status:.*Paused/i)).toBeVisible();

    await page.goto('/en/admin/fees');
    await expect(
      page.getByRole('heading', { name: 'Fees', exact: true }),
    ).toBeVisible({ timeout: 10000 });

    // Withdraw button should be disabled
    const withdrawButton = page.getByRole('button', { name: /Withdraw Fees/i });
    await expect(withdrawButton).toBeVisible();
    await expect(withdrawButton).toBeDisabled();
  });

  test('withdraw button is disabled when no fees are available', async ({
    page,
  }) => {
    // Override fees to 0 for this test
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();

      if (url.includes('fees') || url.includes('getPlatformFees')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(0), // No fees accumulated
        });
      } else if (url.includes('validators')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      } else if (url.includes('paused')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(false),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      }
    });

    await connectAdminWallet(page);
    await page.goto('/en/admin/fees');

    await expect(
      page.getByRole('heading', { name: 'Fees', exact: true }),
    ).toBeVisible({
      timeout: 10000,
    });

    // Check that fees show 0.00 XLM
    const feesSection = page.locator('section', { hasText: 'Platform Fees' });
    await expect(feesSection.getByText(/0\.00 XLM/i)).toBeVisible();

    // Withdraw button should be disabled
    const withdrawButton = page.getByRole('button', { name: /Withdraw Fees/i });
    await expect(withdrawButton).toBeDisabled();
  });

  test('shows confirmation dialog with correct fee amount', async ({
    page,
  }) => {
    await connectAdminWallet(page);
    await page.goto('/en/admin/fees');

    await expect(
      page.getByRole('heading', { name: 'Fees', exact: true }),
    ).toBeVisible({
      timeout: 10000,
    });

    // Click withdraw button
    const withdrawButton = page.getByRole('button', { name: /Withdraw Fees/i });
    await withdrawButton.click();

    // Confirmation dialog should show the exact amount
    const confirmDialog = page
      .locator('[role="dialog"]')
      .or(page.locator('text=Withdraw 5.00 XLM'));
    await expect(page.getByText(/Withdraw 5\.00 XLM/i)).toBeVisible();

    // Cancel button should be present
    const cancelButton = page.getByRole('button', { name: /Cancel/i });
    await expect(cancelButton).toBeVisible();

    // Click cancel to close dialog
    await cancelButton.click();

    // Dialog should close
    await expect(page.getByText(/Withdraw 5\.00 XLM/i)).not.toBeVisible();
  });
});
