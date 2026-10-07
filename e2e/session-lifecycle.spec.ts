/**
 * Session lifecycle E2E (issue #1299).
 *
 * Drives the real SEP-10 login → refresh → revoke chain through the UI and
 * asserts on the cookies and API responses underneath it, rather than on the
 * client-side helpers in isolation:
 *
 *   POST /api/auth/sep10   (login, issues `session` + `session_refresh`)
 *   POST /api/auth/refresh (rotation when the access token lapses)
 *   DELETE /api/auth/sep10 (disconnect — one session)
 *   POST /api/auth/logout-all   + DELETE /api/auth/sessions/:id (revocation)
 *
 * The wallet is mocked (e2e/fixtures/wallet-mock.ts) but every signature it
 * produces is real, so nothing in `app/api/auth/**` is stubbed out.
 *
 * Two scenarios are `test.fixme` for reasons documented on the tests
 * themselves — both are missing product behaviour, not missing harness
 * support.
 */
import { request } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, E2E_ALT_WALLET_SECRET } from './fixtures';
import { installMockFreighter } from './fixtures/wallet-mock';

/**
 * How often an authenticated tab re-checks its session with the server —
 * keep in sync with RECONCILIATION_INTERVAL_MS in context/WalletContext.tsx.
 */
const RECONCILE_MS = 60_000;

/**
 * Present only when the runner shortened the access-token TTL for the E2E
 * server (see e2e/README.md — `npm run test:e2e:sessions`). Unset, tokens
 * live the production-like 20 minutes, which is too long to wait out, and
 * the one scenario that needs a genuine server-side lapse skips itself.
 * Longer than 30s is treated as "not short enough to be worth waiting for".
 */
const TTL_OVERRIDE_SEC = Number(process.env.ACCESS_TOKEN_TTL_SEC ?? '');
const HAS_SHORT_TTL =
  Number.isFinite(TTL_OVERRIDE_SEC) &&
  TTL_OVERRIDE_SEC > 0 &&
  TTL_OVERRIDE_SEC <= 30;

function truncated(publicKey: string): string {
  return `${publicKey.slice(0, 4)}…${publicKey.slice(-4)}`;
}

/**
 * The connected wallet button, matched by its accessible name.
 *
 * The short address lands in the DOM as `<span>GBEJ</span>` + text `…` +
 * `<span>CQ3A</span>` (separate nodes around the ellipsis), so a plain text
 * locator for the joined form never matches even when connected. The button's
 * accessible name is a single string, so match on that instead.
 */
function connectedButton(page: Page, publicKey: string) {
  return page.getByRole('button', {
    name: `Disconnect Wallet — ${truncated(publicKey)}`,
    exact: true,
  });
}

/**
 * The signed-out CTA, matched exactly.
 *
 * `getByRole(..., { name: 'Connect Wallet' })` compares case-insensitively
 * and by *substring* by default, and the connected button's accessible name
 * is `Disconnect Wallet — GBEJ…CQ3A` — which contains "connect Wallet". A
 * bare name match therefore reports "still signed in" as signed out, so
 * every signed-out assertion below has to be exact.
 */
function connectButton(page: Page) {
  return page.getByRole('button', { name: 'Connect Wallet', exact: true });
}

/** Connects the mocked wallet through the real SEP-10 challenge/response. */
async function connect(page: Page, publicKey: string): Promise<void> {
  await page.goto('/en');
  await connectButton(page).click();
  await page.getByRole('button', { name: /freighter/i }).click();
  await expect(connectedButton(page, publicKey)).toBeVisible();
}

async function readCookie(context: BrowserContext, name: string) {
  return (await context.cookies()).find((cookie) => cookie.name === name);
}

/** Status of an API call made *from the page*, i.e. with the page's cookies. */
async function apiStatus(
  page: Page,
  path: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
): Promise<number> {
  return page.evaluate(
    ({ path, method }) => fetch(path, { method }).then((res) => res.status),
    { path, method },
  );
}

interface ListedSession {
  id: string;
  isCurrent: boolean;
}

/** GET /api/auth/sessions as seen by the page's own session. */
async function listSessions(page: Page): Promise<ListedSession[]> {
  const body = (await page.evaluate(
    (path: string) => fetch(path).then((res) => res.json()),
    '/api/auth/sessions',
  )) as { sessions?: ListedSession[] };
  return body.sessions ?? [];
}

test.describe.serial('SEP-10 session lifecycle', () => {
  test('login issues httpOnly, SameSite=Strict cookies scoped to / and /api/auth', async ({
    page,
    wallet,
  }) => {
    await connect(page, wallet.publicKey);

    const access = await readCookie(page.context(), 'session');
    const refresh = await readCookie(page.context(), 'session_refresh');

    expect(
      access,
      'POST /api/auth/sep10 must set a `session` cookie',
    ).toBeDefined();
    expect(access!.httpOnly).toBe(true);
    expect(access!.sameSite).toBe('Strict');
    expect(access!.path).toBe('/');
    // `secure` is only requested when NODE_ENV=production
    // (app/api/auth/sep10/route.ts), and this suite always drives `npm run
    // dev` over plain http on 127.0.0.1 — see e2e/README.md.
    expect(access!.secure).toBe(false);
    if (!HAS_SHORT_TTL) {
      expect(access!.expires * 1000).toBeGreaterThan(Date.now());
      expect(access!.expires * 1000).toBeLessThanOrEqual(
        Date.now() + 21 * 60 * 1000,
      );
    }

    expect(
      refresh,
      'a refresh cookie must be issued alongside it',
    ).toBeDefined();
    expect(refresh!.httpOnly).toBe(true);
    expect(refresh!.sameSite).toBe('Strict');
    // Scoped to the only route that reads it, so it isn't attached to every
    // API request the app makes.
    expect(refresh!.path).toBe('/api/auth');
    // The refresh token is the long-lived half of the pair.
    expect(refresh!.expires * 1000).toBeGreaterThan(access!.expires * 1000);

    // Neither token is reachable from JavaScript.
    const documentCookie = await page.evaluate(() => document.cookie);
    expect(documentCookie).not.toContain(access!.value);
    expect(documentCookie).not.toContain(refresh!.value);
  });

  test('a lapsed access token is rotated from the refresh cookie with no re-login', async ({
    page,
    wallet,
  }) => {
    await connect(page, wallet.publicKey);
    const before = await readCookie(page.context(), 'session');
    const refreshBefore = await readCookie(page.context(), 'session_refresh');
    expect(before).toBeDefined();

    // Drop the access token exactly the way the server does once its Max-Age
    // elapses: it stops being presented. The refresh cookie stays, as it
    // would in a real browser.
    await page.context().clearCookies({ name: 'session' });
    expect(await readCookie(page.context(), 'session')).toBeUndefined();
    expect(await apiStatus(page, '/api/auth/session')).toBe(401);

    // A plain reload must recover the session without a new SEP-10
    // challenge: WalletContext.restoreSession → POST /api/auth/refresh.
    await page.reload();
    await expect(connectButton(page)).toHaveCount(0);
    await expect(connectedButton(page, wallet.publicKey)).toBeVisible();

    const after = await readCookie(page.context(), 'session');
    const refreshAfter = await readCookie(page.context(), 'session_refresh');
    expect(after, 'refresh must reissue an access cookie').toBeDefined();
    // Both halves rotate, so whoever captured the pre-lapse pair no longer
    // holds the live token.
    expect(after!.value).not.toBe(before!.value);
    expect(refreshAfter!.value).not.toBe(refreshBefore!.value);
    expect(after!.httpOnly).toBe(true);
    expect(after!.sameSite).toBe('Strict');

    const session = (await page.evaluate(() =>
      fetch('/api/auth/session').then((res) => res.json()),
    )) as { authenticated: boolean; publicKey: string };
    expect(session.authenticated).toBe(true);
    expect(session.publicKey).toBe(wallet.publicKey);
  });

  test('an access token that lapses server-side is refreshed on tab refocus', async ({
    page,
    wallet,
  }) => {
    test.skip(
      !HAS_SHORT_TTL,
      'Needs a short ACCESS_TOKEN_TTL_SEC on the E2E server to make a token ' +
        'lapse (`npm run test:e2e:sessions`) — see e2e/README.md.',
    );

    await connect(page, wallet.publicKey);
    const before = await readCookie(page.context(), 'session');
    expect(before).toBeDefined();

    // Unlike the scenario above the cookie is still in the jar; what has
    // expired is the signed `exp` claim inside it, which is what the server
    // actually enforces.
    await page.waitForTimeout(TTL_OVERRIDE_SEC * 1000 + 1_000);
    expect(await apiStatus(page, '/api/auth/session')).toBe(401);

    // Returning to the tab triggers reconciliation immediately (the
    // `visibilitychange` listener in WalletContext), instead of waiting out
    // the 60s polling tick, and the user is never asked to re-authenticate.
    await page.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    );

    // Poll for the end state rather than for the cookie: the client learns
    // the token lapsed from its own GET /api/auth/session, then POSTs the
    // refresh, so the cookie is briefly mid-flight until that lands.
    await expect.poll(() => apiStatus(page, '/api/auth/session')).toBe(200);

    const after = await readCookie(page.context(), 'session');
    expect(after, 'refresh must reissue an access cookie').toBeDefined();
    expect(after!.value).not.toBe(before!.value);
    expect(after!.httpOnly).toBe(true);
    expect(after!.sameSite).toBe('Strict');
    await expect(connectedButton(page, wallet.publicKey)).toBeVisible();
    await expect(connectButton(page)).toHaveCount(0);
  });

  test('logging out in one tab signs the other tab out without a reload', async ({
    page,
    context,
    wallet,
  }) => {
    await connect(page, wallet.publicKey);

    // A second tab in the same browser: it shares cookies and localStorage
    // with the first, and — like a real browser that has Freighter
    // installed — it needs the extension present too, otherwise
    // restoreSession's `getPublicKey()` probe throws and the tab signs
    // itself out before any of this is observable.
    const secondTab = await context.newPage();
    await installMockFreighter(secondTab, { secret: wallet.keypair.secret() });
    await secondTab.goto('/en');
    await expect(connectedButton(secondTab, wallet.publicKey)).toBeVisible();

    // Disconnect from the first tab through the wallet menu.
    await connectedButton(page, wallet.publicKey).click();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();

    // The tab that asked is logged out and its cookies are cleared...
    await expect(connectButton(page)).toBeVisible();
    await expect.poll(() => readCookie(context, 'session')).toBeUndefined();
    await expect
      .poll(() => readCookie(context, 'session_refresh'))
      .toBeUndefined();

    // ...and the second tab follows without navigating and without asking the
    // server: disconnect() writes the SESSION_INVALIDATED_KEY that
    // WalletContext's `storage` listener watches for.
    await expect(connectButton(secondTab)).toBeVisible();
    await expect(connectedButton(secondTab, wallet.publicKey)).toHaveCount(0);
    expect(await apiStatus(secondTab, '/api/auth/session')).toBe(401);
  });

  test('revoking one device from ActiveSessions kills only that device', async ({
    browser,
    page,
  }) => {
    // A wallet of its own: SessionStore.revokeAllForWallet is wallet-scoped,
    // so this spec must never touch the account the rest of the suite shares.
    const wallet = await installMockFreighter(page, {
      secret: E2E_ALT_WALLET_SECRET,
    });

    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await installMockFreighter(otherPage, { secret: E2E_ALT_WALLET_SECRET });

    await connect(otherPage, wallet.publicKey);
    await connect(page, wallet.publicKey);
    await expect.poll(async () => (await listSessions(page)).length).toBe(2);

    await page.goto('/en/settings');
    await expect(page.getByText('This device')).toBeVisible();

    // Every row that isn't this device — more than one only if a previous
    // attempt leaked sessions, in which case they're dead ends worth
    // revoking too.
    const otherRows = page
      .locator('li')
      .filter({ hasText: 'Signed in' })
      .filter({ hasNotText: 'This device' });
    await expect(otherRows.first()).toBeVisible();

    const revokeCount = await otherRows.count();
    for (let i = 0; i < revokeCount; i++) {
      await otherRows.first().getByRole('button', { name: 'Revoke' }).click();
      // The row is removed from the list as soon as the DELETE succeeds
      // (ActiveSessions' optimistic setSessions), which is itself the
      // per-session revoke assertion.
      await expect(otherRows).toHaveCount(revokeCount - i - 1);
    }

    // The revoked device is dead — including its ability to renew itself.
    await expect
      .poll(() => apiStatus(otherPage, '/api/auth/session'))
      .toBe(401);
    expect(await apiStatus(otherPage, '/api/auth/refresh', 'POST')).toBe(401);

    // The device doing the revoking is untouched.
    expect(await apiStatus(page, '/api/auth/session')).toBe(200);
    await expect(connectedButton(page, wallet.publicKey)).toBeVisible();

    await otherContext.close();
  });

  test('"Log Out Everywhere" revokes sessions in other browser contexts too', async ({
    browser,
    page,
  }) => {
    // Dedicated wallet (see E2E_ALT_WALLET_SECRET): the campaign-wide
    // revoke here must not sign out sessions other specs are using.
    test.setTimeout(180_000);
    const wallet = await installMockFreighter(page, {
      secret: E2E_ALT_WALLET_SECRET,
    });

    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await installMockFreighter(otherPage, { secret: E2E_ALT_WALLET_SECRET });

    // Sign the "other device" in first so the caller's own session is the one
    // the settings page is looking at.
    await connect(otherPage, wallet.publicKey);
    await connect(page, wallet.publicKey);

    await expect
      .poll(async () => (await listSessions(page)).length)
      .toBeGreaterThanOrEqual(2);
    expect((await listSessions(page)).filter((s) => s.isCurrent)).toHaveLength(
      1,
    );

    await page.goto('/en/settings');
    await expect(page.getByText('This device')).toBeVisible();
    await page.getByRole('button', { name: 'Log Out Everywhere' }).click();
    await expect(
      page.getByText("You've been logged out of all devices."),
    ).toBeVisible();

    // The tab that asked is logged out immediately (the handler calls
    // disconnect() after the sweep), including its cookies.
    await expect(connectButton(page)).toBeVisible();
    await expect.poll(() => apiStatus(page, '/api/auth/sessions')).toBe(401);

    // The other context is dead server-side — and its refresh token can't
    // resurrect the session, because the row itself was revoked.
    await expect
      .poll(() => apiStatus(otherPage, '/api/auth/session'))
      .toBe(401);
    expect(await apiStatus(otherPage, '/api/auth/refresh', 'POST')).toBe(401);

    // It isn't left signed in with a stale UI either: its next reconciliation
    // tick (WalletContext) sees the 401, signs the tab out and says why —
    // the toast is the user-visible half of that, and it is only on screen
    // for 4s, so wait on it first and check the CTA afterwards (the
    // signed-out CTA is permanent, the toast is not). Asserted against the
    // real interval rather than a faked clock, so what's tested is exactly
    // what a user would hit.
    await expect(otherPage.getByText(/your session expired/i)).toBeVisible({
      timeout: RECONCILE_MS + 30_000,
    });
    await expect(connectButton(otherPage)).toBeVisible();

    await otherContext.close();
  });

  // Neither of the two scenarios below can pass against the current
  // implementation. They are kept as `fixme` so the intended behaviour stays
  // documented and the specs are ready the moment the product catches up.

  /**
   * Blocked on: refresh-token reuse detection.
   *
   * `session_refresh` is replaced on every rotation, but the server keeps no
   * record of the values it has already spent — lib/session.ts only signs and
   * verifies, and lib/sessionStore.ts only tracks revocation. A captured,
   * already-rotated token therefore mints a fresh pair for the same session
   * instead of being rejected. The doc comment on
   * app/api/auth/refresh/route.ts describes the intended "an intercepted,
   * already-rotated refresh token can't be reused" behaviour; enforcement is
   * what's missing.
   */
  test.fixme('replaying a rotated refresh token is rejected and revokes the session', async ({
    page,
    wallet,
  }) => {
    await connect(page, wallet.publicKey);
    const captured = (await readCookie(page.context(), 'session_refresh'))!
      .value;

    // Legitimate rotation: `captured` is now a spent token.
    expect(await apiStatus(page, '/api/auth/refresh', 'POST')).toBe(200);

    // Replay it from outside the browser, so the context's own (rotated)
    // cookie jar can't paper over the reuse.
    const attacker = await request.newContext({
      baseURL: new URL(page.url()).origin,
      extraHTTPHeaders: { Cookie: `session_refresh=${captured}` },
    });
    expect((await attacker.post('/api/auth/refresh')).status()).toBe(401);
    await attacker.dispose();

    // Reuse should be treated as compromise: every session for the wallet
    // revoked, not just the replayed one.
    expect(await apiStatus(page, '/api/auth/session')).toBe(401);
  });

  /**
   * Blocked on: a product decision about what an extension-side account
   * switch should do to an existing session.
   *
   * Today `WalletContext.restoreSession` compares the server's session
   * wallet against the address cached in localStorage and, on any difference,
   * throws into its catch block — which wipes the session and fires
   * `promiscope:session-expired`. The reconnected wallet reported by the
   * extension is probed but the result is discarded, so `sessionCookieWallet`
   * can never disagree with `publicKey` and `SessionMismatchWarning` is
   * unreachable. Consequence: switching accounts in Freighter signs the user
   * out with a "session expired" message rather than offering a re-link.
   *
   * No product answer yet on which of the two is wanted, so the assertion
   * below records the intended behaviour (change account → warning + one-click
   * re-link) without forcing an implementation.
   */
  test.fixme('switching accounts in the extension surfaces the mismatch warning', async ({
    page,
    wallet,
  }) => {
    await connect(page, wallet.publicKey);

    // The switch happens inside Freighter's own popup: the dApp gets no
    // event, it can only find out by asking the extension again.
    await wallet.switchAccount(E2E_ALT_WALLET_SECRET);
    await page.reload();

    await expect(
      page.getByRole('alert').filter({ hasText: /session mismatch/i }),
    ).toBeVisible();
    // The session's wallet is still the one that signed in, so the warning
    // must offer a way back rather than silently re-authenticating as the
    // new account.
    expect(await readCookie(page.context(), 'session')).toBeDefined();
  });
});
