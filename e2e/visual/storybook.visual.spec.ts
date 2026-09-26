import { test, expect } from '@playwright/test';

interface StoryIndexEntry {
  id: string;
  type: 'story' | 'docs';
  tags?: string[];
}

interface StoryIndex {
  entries: Record<string, StoryIndexEntry>;
}

/**
 * Screenshots every Storybook story and diffs it against the committed
 * baseline (`storybook.visual.spec.ts-snapshots/`). New stories get a new
 * baseline the first time this runs with `--update-snapshots`; existing
 * stories fail the run if their rendered output drifts beyond the
 * `maxDiffPixelRatio` tolerance configured in playwright.visual.config.ts.
 *
 * Reading the live `/index.json` (rather than hardcoding story IDs) means
 * new stories get visual coverage automatically without touching this file.
 */
test('storybook stories render consistently', async ({ page, baseURL }) => {
  const res = await page.request.get(`${baseURL}/index.json`);
  const { entries }: StoryIndex = await res.json();

  const storyIds = Object.values(entries)
    // Stories with a play function (auto-tagged `play-fn` by Storybook) are
    // interaction tests run by `test-storybook`; their end state (open
    // toasts, dismissed dialogs) isn't a stable screenshot, and each one's
    // static appearance is already covered by its sibling stories.
    .filter(
      (entry) => entry.type === 'story' && !entry.tags?.includes('play-fn'),
    )
    .map((entry) => entry.id)
    .sort();

  expect(
    storyIds.length,
    'expected at least one Storybook story',
  ).toBeGreaterThan(0);

  // This single test loops over every story, so its timeout has to scale with
  // the story count rather than use the file-level default — otherwise runs
  // fail partway through as more stories are added.
  test.setTimeout(storyIds.length * 5_000 + 30_000);

  for (const id of storyIds) {
    await test.step(id, async () => {
      await page.goto(`/iframe.html?id=${id}&viewMode=story`);
      // Not 'networkidle': Storybook's dev server keeps an HMR socket open,
      // so the network never truly goes idle and that wait can hang until
      // the test timeout. 'load' only covers the outer iframe document,
      // though — Storybook's dev server compiles each story on first
      // request, so 'load' can fire before React has mounted anything into
      // #storybook-root. toHaveScreenshot's own stability retry doesn't
      // save this: a still-blank/loading root is itself a stable frame, so
      // it can lock onto that instead of the real content. Wait for the
      // root to actually have a child before screenshotting.
      await page.waitForLoadState('load');
      try {
        await page.waitForSelector('#storybook-root > *', {
          state: 'attached',
          timeout: 10_000,
        });
      } catch {
        // The story mounted nothing into #storybook-root within the wait —
        // either it legitimately renders null for its current args, or it
        // threw and Storybook painted its error overlay outside the root.
        // Screenshot whatever's on the page anyway: a real regression shows
        // up as a diff against the baseline, which is a fast, actionable
        // failure — far better than letting one story stall the whole
        // suite until its (story-count-scaled) timeout fires.
      }
      await expect.soft(page).toHaveScreenshot(`${id}.png`, { fullPage: true });
    });
  }
});
