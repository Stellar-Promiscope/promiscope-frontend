import { test as base, expect } from '@playwright/test';
import { installMockFreighter } from './wallet-mock';
import type { MockWallet } from './wallet-mock';

/**
 * Deterministic, testnet-only keypair used across the E2E suite. It holds no
 * real value and is safe to commit — override with E2E_WALLET_SECRET if you
 * need the suite to drive a funded/deployed-contract account (see
 * e2e/README.md).
 */
export const E2E_TEST_WALLET_SECRET =
  process.env.E2E_WALLET_SECRET ??
  'SBNYKPD5APY4SOASUVEICEPBSPWG6MJK5PMJKNOLES2PVZDLZ2ITUZWZ';

/**
 * Second deterministic, testnet-only keypair — same safety as
 * `E2E_TEST_WALLET_SECRET` (holds no value, safe to commit). Specs that need
 * two distinct wallet identities use it, most importantly as a *dedicated*
 * account for the revocation scenarios in e2e/session-lifecycle.spec.ts:
 * `SessionStore.revokeAllForWallet` is wallet-scoped, so revoking the test
 * account's sessions in one spec must not knock out a session another spec
 * is midway through (the suite otherwise shares one wallet).
 */
export const E2E_ALT_WALLET_SECRET =
  process.env.E2E_ALT_WALLET_SECRET ??
  'SCWOMSHI7P4S2RX2LBKPRAUW7CS55JNWGQBZBRJPGXON7XBANX7OI5SP';

type Fixtures = {
  wallet: MockWallet;
};

/**
 * Extends Playwright's `test` with a `wallet` fixture: a mocked Freighter
 * provider (see wallet-mock.ts) already installed on `page` before it
 * navigates anywhere. Import `test`/`expect` from this module instead of
 * `@playwright/test` directly in any spec that needs a connected wallet.
 */
export const test = base.extend<Fixtures>({
  wallet: async ({ page }, use) => {
    const wallet = await installMockFreighter(page, {
      secret: E2E_TEST_WALLET_SECRET,
    });
    await use(wallet);
  },
});

export { expect };
export type { MockWallet, WalletBehavior } from './wallet-mock';
