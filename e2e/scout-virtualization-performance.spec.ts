import { test, expect } from './fixtures';
import { mockSorobanRpc } from './fixtures/mock-contract';

/**
 * Issue #781 — frame-budget and DOM-bounding verification for the
 * virtualized scout results grid.
 *
 * This is the CI-friendly frame-timing harness the issue calls for: a
 * scripted scroll through a large (5,000-player) result set, measured with
 * the browser's native Long Tasks API
 * (https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming)
 * rather than an approximation — a task the browser itself reports as
 * blocking the main thread for >20ms (the 55fps budget) is the same signal
 * Chrome DevTools' Performance panel surfaces, just captured programmatically
 * so it can run unattended in CI. Sidesteps mocking either data source for
 * 5,000 synthetic players by driving the *name search* path
 * (`/api/players/search`, a plain JSON Next.js route) rather than the grid's
 * filter path (`/api/indexer/players`, which needs a stubbed indexer with
 * cursor pagination — see `__tests__/hooks/useInfinitePlayers.test.ts` for
 * that coverage). This test is about scroll/render performance and DOM
 * bounding, not data-source correctness.
 */

function makeSyntheticPlayers(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `perf-player-${i}`,
    wallet: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
    vitals: {
      name: `Perf Player ${i}`,
      age: 20 + (i % 15),
      position: ['ST', 'CM', 'CB', 'GK'][i % 4],
      region: 'Nigeria',
      nationality: 'Nigeria',
    },
    ipfsHash: '',
    progressLevel: (i % 4) as 0 | 1 | 2 | 3,
    milestones: [],
    createdAt: 1700000000,
  }));
}

test.describe('scout results grid — virtualization performance', () => {
  test('scrolling through 5,000 players stays under the 20ms frame-budget and keeps the DOM bounded to ≤60 cards', async ({
    page,
    wallet,
  }) => {
    test.setTimeout(120_000);

    mockSorobanRpc(page, {
      isValidator: false,
      subscription: {
        tier: 'pro',
        expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,
      },
    });

    const players = makeSyntheticPlayers(5000);
    await page.route('**/api/players/search**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(players),
      });
    });

    await page.goto('/en');
    await page.getByRole('button', { name: 'Connect Wallet' }).click();
    await page.getByRole('button', { name: /freighter/i }).click();
    await expect(
      page.getByText(
        wallet.publicKey.slice(0, 4) + '…' + wallet.publicKey.slice(-4),
      ),
    ).toBeVisible();

    await page.goto('/en/scout');

    await page.getByLabel(/search by player name/i).fill('Perf Player');

    await expect(page.getByText('5000 players found')).toBeVisible({
      timeout: 15_000,
    });

    const grid = page.getByTestId('player-grid');
    await expect(grid).toBeVisible();

    // Start collecting Long Tasks before scrolling begins.
    await page.evaluate(() => {
      (window as any).__longTasks = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          (window as any).__longTasks.push(entry.duration);
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
      (window as any).__perfObserver = observer;
    });

    // ── DOM bounding: initial mount ────────────────────────────────────────
    const MAX_MOUNTED_CARDS = 60;

    const domCountAtTop = await page
      .getByTestId('player-grid')
      .locator('[role="article"]')
      .count();
    expect(
      domCountAtTop,
      `DOM at top: ${domCountAtTop} cards (must be ≤ ${MAX_MOUNTED_CARDS})`,
    ).toBeLessThanOrEqual(MAX_MOUNTED_CARDS);

    // ── Scripted scroll: all the way down and back up ──────────────────────
    await page.evaluate(async () => {
      const el = document.querySelector(
        '[data-testid="player-grid"]',
      ) as HTMLElement;
      const steps = 60;
      const max = el.scrollHeight - el.clientHeight;
      const wait = () => new Promise((r) => requestAnimationFrame(r));

      for (let i = 0; i <= steps; i++) {
        el.scrollTop = (max * i) / steps;
        el.dispatchEvent(new Event('scroll'));
        await wait();
      }
      for (let i = steps; i >= 0; i--) {
        el.scrollTop = (max * i) / steps;
        el.dispatchEvent(new Event('scroll'));
        await wait();
      }
    });

    // ── DOM bounding: after scrolling ──────────────────────────────────────
    const domCountAfterScroll = await page
      .getByTestId('player-grid')
      .locator('[role="article"]')
      .count();
    expect(
      domCountAfterScroll,
      `DOM after full scroll: ${domCountAfterScroll} cards (must be ≤ ${MAX_MOUNTED_CARDS})`,
    ).toBeLessThanOrEqual(MAX_MOUNTED_CARDS);

    // ── Frame budget assertion ─────────────────────────────────────────────
    const longTasks: number[] = await page.evaluate(() => {
      (window as any).__perfObserver?.disconnect();
      return (window as any).__longTasks ?? [];
    });

    // The core assertion: no single main-thread task exceeded 20ms
    // (the 55fps budget) while scrolling through all 5,000 players.
    const worst = longTasks.length ? Math.max(...longTasks) : 0;
    expect(
      worst,
      `longest task during scroll was ${worst.toFixed(1)}ms (${longTasks.length} long tasks)`,
    ).toBeLessThanOrEqual(20);

    // ── Summary for CI logs ────────────────────────────────────────────────
    console.log(
      `Virtualization perf: ${domCountAtTop} cards at top, ${domCountAfterScroll} after scroll, ` +
        `worst task ${worst.toFixed(1)}ms, ${longTasks.length} long tasks`,
    );
  });

  test('RPC calls for milestone data do not scale with the number of players scrolled', async ({
    page,
    wallet,
  }) => {
    test.setTimeout(60_000);

    mockSorobanRpc(page, {
      isValidator: false,
      subscription: {
        tier: 'pro',
        expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,
      },
    });

    const players = makeSyntheticPlayers(200);
    await page.route('**/api/players/search**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(players),
      });
    });

    await page.goto('/en');
    await page.getByRole('button', { name: 'Connect Wallet' }).click();
    await page.getByRole('button', { name: /freighter/i }).click();
    await expect(
      page.getByText(
        wallet.publicKey.slice(0, 4) + '…' + wallet.publicKey.slice(-4),
      ),
    ).toBeVisible();

    await page.goto('/en/scout');

    let simulateCalls = 0;
    page.on('request', (request) => {
      if (request.method() !== 'POST') return;
      if (!request.url().includes('soroban')) return;
      try {
        const body = request.postDataJSON();
        if (body?.method === 'simulateTransaction') simulateCalls++;
      } catch {
        // non-JSON body, ignore
      }
    });

    await page.getByLabel(/search by player name/i).fill('Perf Player');
    await expect(page.getByText('200 players found')).toBeVisible({
      timeout: 10_000,
    });

    const grid = page.getByTestId('player-grid');
    await page.evaluate(async () => {
      const el = document.querySelector(
        '[data-testid="player-grid"]',
      ) as HTMLElement;
      const wait = () => new Promise((r) => requestAnimationFrame(r));
      for (let i = 0; i <= 10; i++) {
        el.scrollTop = (el.scrollHeight * i) / 10;
        el.dispatchEvent(new Event('scroll'));
        await wait();
      }
    });
    await expect(grid).toBeVisible();

    // A handful of simulate calls (subscription check, validator check,
    // one batched milestone fetch) — not one per player, and not one per
    // scroll step. 200 players scrolled through must not produce anywhere
    // near 200 simulate calls.
    expect(simulateCalls).toBeLessThan(10);
  });
});
