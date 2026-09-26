import type { TestRunnerConfig } from '@storybook/test-runner';
import { getStoryContext } from '@storybook/test-runner';
import { checkA11y, configureAxe, injectAxe } from 'axe-playwright';

/**
 * `npm run test-storybook` (issue #1322): every story is rendered in real
 * Chromium, its play function (if any) runs, and a failing assertion fails
 * the run. Afterwards axe checks the story using the same `a11y` parameters
 * the Storybook a11y addon panel reads, so a story can tune or disable rules
 * with `parameters.a11y` (`{ disable: true }` or `{ config: { rules } }`).
 *
 * Axe only fails the run for stories with a play function, i.e. the
 * interactive components under test. Other stories log their violations
 * without failing, until the existing ones are fixed.
 */
const config: TestRunnerConfig = {
  async preVisit(page, context) {
    // Stories can request a viewport, e.g. mobile-only UI:
    // `parameters: { testRunner: { viewport: { width: 375, height: 812 } } }`.
    const storyContext = await getStoryContext(page, context);
    await page.setViewportSize(
      storyContext.parameters?.testRunner?.viewport ?? {
        width: 1280,
        height: 720,
      },
    );
    await injectAxe(page);
  },
  async postVisit(page, context) {
    const storyContext = await getStoryContext(page, context);
    const a11y = storyContext.parameters?.a11y;
    if (a11y?.disable) return;

    await configureAxe(page, { rules: a11y?.config?.rules });
    const enforce = storyContext.tags?.includes('play-fn') ?? false;
    try {
      await checkA11y(page, '#storybook-root', {
        detailedReport: true,
        detailedReportOptions: { html: true },
        axeOptions: a11y?.options,
      });
    } catch (err) {
      if (enforce) throw err;
      console.warn(`[a11y] ${context.id}: ${(err as Error).message}`);
    }
  },
};

export default config;
