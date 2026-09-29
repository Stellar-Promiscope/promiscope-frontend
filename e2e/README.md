# E2E tests (Playwright)

This is the base Playwright setup plus a shared wallet-mocking harness, so
happy-path E2E tests that require a signed transaction (wallet connect,
player registration, validator approve/revoke, pay-to-contact, admin actions)
don't have to skip the auth layer or hand-roll their own wallet stub per test
file.

## Specs

| Spec                                                    | What it covers                                                                                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `landing-page.spec.ts`                                  | Smoke test for the home page: hero heading visible, Player/Scout Dashboard nav links present, Scout Dashboard navigates to `/en/scout`. No wallet mock required. |
| `wallet-connect-registration.spec.ts`                   | Freighter connect + optional real testnet player registration (see below).                                                                                       |
| `player-registration.spec.ts`                           | Player registration with mocked Soroban RPC.                                                                                                                     |
| `scout-pay-to-contact.spec.ts`                          | Scout pay-to-contact flow.                                                                                                                                       |
| `validator-milestones.spec.ts`                          | Validator milestone approve/revoke.                                                                                                                              |
| `admin-access.spec.ts` / `admin-fee-withdrawal.spec.ts` | Admin gated flows.                                                                                                                                               |
| `session-lifecycle.spec.ts`                             | SEP-10 login → refresh → revoke lifecycle, across tabs and browser contexts (see below).                                                                         |

## Running

```bash
npx playwright install --with-deps chromium   # once, to fetch the browser
npm run test:e2e                              # headless (all specs)
npx playwright test e2e/landing-page.spec.ts  # landing smoke only
npx playwright test --ui                      # Playwright's UI mode, for debugging
npm run test:e2e:sessions                     # session lifecycle only, short token TTL (see below)
```

`playwright.config.ts` boots the Next.js dev server itself (`webServer`) on
`E2E_PORT` (default `3100`) with the env it needs to run standalone —
including a throwaway `SEP10_SERVER_KEY`/`SESSION_SECRET` and the
`NEXT_PUBLIC_SEP10_SERVER_ACCOUNT`/`NEXT_PUBLIC_SEP10_HOME_DOMAIN` pair the
browser-side challenge validator (lib/sep10Validation.ts) demands before it
will hand a login transaction to the wallet — so no `.env.local` setup is
required just to run the suite. `reuseExistingServer` is on outside of CI, so
if you already have `npm run dev` running on that port it'll be reused.

Each run gets its own session registry (`SESSIONS_DB_PATH` under the system
temp dir, keyed by PID) so specs that count or revoke sessions start from an
empty table instead of inheriting `data/sessions.db` rows from a previous run.

## Session lifecycle specs (#1299)

`session-lifecycle.spec.ts` drives the whole authenticated life of a session
through the UI — real SEP-10 login, silent refresh, per-device revoke, "log out
everywhere" — and asserts on the cookies and API responses underneath it:

| Scenario                                      | What it pins down                                                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Login cookie shape                            | `session` (`Path=/`) and `session_refresh` (`Path=/api/auth`) are both `HttpOnly`, `SameSite=Strict`, and JS-invisible.                       |
| Lapsed access token                           | A missing/expired access cookie is rotated from the refresh cookie on reload — the user is never asked to sign again, and both tokens change. |
| Server-side lapse (short TTL only, see below) | An access token whose `exp` has passed is refreshed on tab refocus, not just on the 60s reconciliation tick.                                  |
| Cross-tab logout                              | Disconnecting in one tab signs a second tab out with no reload and no navigation, via `SESSION_INVALIDATED_KEY`.                              |
| Per-device revoke                             | `ActiveSessions` revoking one row kills that device's cookie _and_ its ability to refresh — while leaving this one alive.                     |
| Log out everywhere                            | Revokes sessions belonging to other browser contexts too, and they sign themselves out on their next tick with a "session expired" notice.    |

Two scenarios are `test.fixme` because the behaviour they describe isn't
implemented yet; the comments above each test say exactly what's missing:

- **Refresh-token replay detection** — rotation replaces the refresh token but
  nothing records which values have been spent, so a captured pre-rotation
  token is accepted again instead of being treated as a compromise.
- **Extension-side account switch** — `WalletContext.restoreSession` discards
  the address the extension reports and hard-signs-out on any difference, so
  `SessionMismatchWarning` can't currently be reached. Needs a product
  decision on what switching accounts should do to the live session.

Neither blocks the rest of the suite: run the file directly to see the
scenarios that do pass.

### Shortening token lifetimes

A production-like access token lives 20 minutes, which is a long time to wait
to watch one lapse. `ACCESS_TOKEN_TTL_SEC` (and
`DEFAULT_REFRESH_TTL_SEC` / `REMEMBER_ME_REFRESH_TTL_SEC` — see
`.env.example`) override those lifetimes in development and test only; in
production the compiled-in defaults always win, so a stray value can't mint a
five-second session in a deployment.

```bash
npm run test:e2e:sessions                # = ACCESS_TOKEN_TTL_SEC=10, this spec only
ACCESS_TOKEN_TTL_SEC=10 npm run test:e2e # whole suite with 10s access tokens
```

`npm run test:e2e:sessions` is also the _only_ way to run the server-side
lapse scenario — without an override that one skips itself, with an explicit
message, rather than pretending 20 minutes have passed. Note that specs whose
assertions depend on a long-lived access token (cookie expiry windows) relax
those assertions when a short TTL is in effect.

CI runs both forms: the full suite, then this spec alone with
`--retries=0` (the script itself pins `--workers=1` — the scenarios share one
wallet and one dev server, so parallel workers just contend and time out),
so a session-lifecycle failure can't be papered over by a retry.

## The wallet-mocking harness

`fixtures/wallet-mock.ts` mocks the actual `window.freighter` /
`window.postMessage` protocol that `@stellar/freighter-api` (and therefore
`lib/walletAdapters.ts`) speaks — not `lib/walletAdapters.ts` itself. The app
code under test is untouched; from its point of view a real Freighter
extension is installed and responding.

Import `test`/`expect` from `./fixtures` (not `@playwright/test` directly) in
any spec that needs a wallet:

```ts
import { test, expect } from './fixtures';

test('does something that needs a connected wallet', async ({
  page,
  wallet,
}) => {
  await page.goto('/en');
  await page.getByRole('button', { name: 'Connect Wallet' }).click();
  await page.getByRole('button', { name: /freighter/i }).click();
  // wallet.publicKey / wallet.keypair are available for assertions
});
```

The `wallet` fixture is installed on `page` before any navigation happens, so
it's live for the very first `getPublicKey()`/`isConnected()` call the app
makes. Supported behaviors, settable per-test via `wallet.setBehavior(...)`:

| Behavior        | Effect                                                        |
| --------------- | ------------------------------------------------------------- |
| `'approve'`     | Default. Connects, and signs any transaction for real.        |
| `'reject'`      | Simulates the user declining the connection/signature prompt. |
| `'uninstalled'` | Simulates the extension not being present at all.             |

Signing is not faked: `signTransaction` requests are relayed (via
`page.exposeFunction`) to a real `Keypair.sign()` call in Node, against the
deterministic test keypair in `fixtures/index.ts`
(`E2E_TEST_WALLET_SECRET`/`E2E_WALLET_SECRET`). Every "signed" transaction the
mock produces has a genuinely valid signature for that account.

A second deterministic keypair, `E2E_ALT_WALLET_SECRET` (override with
`E2E_ALT_WALLET_SECRET`), exists for specs that need a wallet _identity_ of
their own. Use it when a test revokes or invalidates sessions: revocation is
wallet-scoped (`SessionStore.revokeAllForWallet`), so a spec that logs out the
shared test account would pull the rug out from under any spec running
concurrently against it. Install it yourself instead of using the `wallet`
fixture:

```ts
const wallet = await installMockFreighter(page, {
  secret: E2E_ALT_WALLET_SECRET,
});
```

`wallet.switchAccount(secret)` moves the mock to a different account the way a
user would inside Freighter's own popup — it changes both the address the mock
reports and the key it signs with, and it lives in Node rather than in the
page, so it survives a navigation (the init script asks Node for the active
account on every `REQUEST_PUBLIC_KEY`/`SUBMIT_TRANSACTION` rather than
capturing one at install time).

### Only Freighter is mocked today

`lib/walletAdapters.ts`'s `albedo` and `lobstr` adapters are unimplemented
stubs (`throw new Error('... adapter not configured')`) — there's no real
interface for those two to mock yet. `installMockFreighter` is written so a
sibling `installMockAlbedo`/`installMockLobstr` can be added the same way
once those adapters exist: intercept whatever transport they end up using
(most likely `window.postMessage` again, or a direct `window.albedo` global),
sign for real with the same kind of exposed Node function, and expose it
through the same `wallet` fixture shape
(`publicKey`/`keypair`/`setBehavior`/`switchAccount`)
so specs don't need to change based on provider.

### Extending to new flows

`wallet-connect-registration.spec.ts` is the first real flow using the
harness. For a new one (e.g. validator approve/revoke, pay-to-contact, an
admin action):

1. Use the `wallet` fixture from `./fixtures` to get connected.
2. If the flow depends on off-chain infra you don't want live in every test
   run (IPFS uploads, the backend API in `server/`), mock it with
   `page.route('**/api/...', ...)` the way the registration spec mocks
   `/api/ipfs/upload` — keep the wallet signing real, mock everything else
   that isn't the point of the test.
3. If the flow ends in an on-chain submission, decide whether it needs to
   actually reach testnet (see below) or whether asserting the signed XDR
   was produced and submitted is enough for that test's purpose.

## Reaching real testnet

SEP-10 connect/auth (`app/api/auth/sep10/route.ts`) never touches the
network — the challenge is built and verified locally with `WebAuth`, so the
"connects via a real SEP-10 challenge" test runs fully offline and
deterministically in CI.

Actually submitting a contract call (e.g. `register_player`) requires a
contract deployed on testnet and a funded source account, which this
repo/sandbox doesn't provision automatically. The registration spec's
on-chain assertion is gated behind `E2E_CONTRACT_ID` and skips with an
explicit message when it isn't set, rather than mocking the Soroban RPC call
away and silently calling that "reaching testnet". To run it for real:

```bash
# 1. Fund the deterministic test wallet once (idempotent)
curl "https://friendbot.stellar.org/?addr=<publicKey printed by the skipped test>"

# 2. Deploy/initialize the contract per the root DEVELOPMENT.md, then:
E2E_CONTRACT_ID=<deployed contract id> npm run test:e2e
```

If you need the suite to drive a different account (e.g. one you've already
funded), override the secret: `E2E_WALLET_SECRET=S... npm run test:e2e`.
