import { NextRequest } from 'next/server';
import { runFraudFlagEvaluation } from '@/lib/fraudFlagsRunner';
import { FraudFlagsStore } from '@/lib/fraudFlagsStore';
import { privateJson } from '@/lib/httpResponses';

/**
 * Scheduled trigger for fraud-flag evaluation (issue #1007). This
 * deployment has no background-job infrastructure, so the realistic
 * mechanism investigated and picked here is a Vercel Cron Job (see
 * vercel.json's `crons` entry and docs/fraud-detection.md) hitting this
 * route on a fixed schedule, independent of any admin opening
 * FraudFlagsPanel.tsx.
 *
 * Authorization is deliberately NOT `requireAdminWallet` — a scheduled
 * invocation has no interactive admin session cookie to present. Vercel
 * Cron signs its requests with the `Authorization: Bearer ${CRON_SECRET}`
 * header (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs),
 * so this route checks that header against the CRON_SECRET env var instead.
 * Without CRON_SECRET configured, the route refuses all requests rather
 * than silently allowing unauthenticated evaluation runs.
 */
export async function GET(req: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret) {
    return privateJson(
      { error: 'CRON_SECRET is not configured' },
      { status: 500 },
    );
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${configuredSecret}`) {
    return privateJson({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await runFraudFlagEvaluation({
    mode: 'incremental',
    trigger: 'cron',
    timeBudgetMs: 45_000,
  });
  const evaluatedAt = result.evaluatedAt ?? Date.now();
  const eventsProcessed = result.eventsProcessed ?? 0;
  const durationMs = result.durationMs ?? 0;
  const run = FraudFlagsStore.getInstance().recordRun(
    'cron',
    result.flags,
    result.warnings,
    evaluatedAt,
    eventsProcessed,
    durationMs,
  );

  // At minimum-viable "proactive surfacing" absent any existing outbound
  // notification channel (email/Slack/push — none exist in this codebase
  // today, verified during investigation): a high-severity run is at least
  // observable in the cron invocation's own logs/response, and drives the
  // staleness/high-severity badge in the admin dashboard
  // (GET /api/admin/fraud-flags/status). A fuller integration (e.g. paging
  // an on-call channel when highSeverityCount crosses a threshold) is a
  // follow-up that requires picking a notification provider — out of scope
  // here; see docs/fraud-detection.md.
  return privateJson({
    evaluatedAt,
    flagCount: result.flags.length,
    highSeverityCount: run.highSeverityCount,
    eventsProcessed,
    durationMs,
    warnings: result.warnings,
  });
}

