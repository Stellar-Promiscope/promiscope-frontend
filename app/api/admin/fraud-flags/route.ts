import { NextRequest } from 'next/server';
import { requireAdminWallet } from '@/lib/adminAuth';
import { runFraudFlagEvaluation } from '@/lib/fraudFlagsRunner';
import { FraudFlagsStore } from '@/lib/fraudFlagsStore';
import { FraudFlagDismissalStore } from '@/lib/fraudFlagDismissalStore';
import { computeFraudFlagDismissalKey } from '@/lib/fraudDetection';
import type { FraudFlag } from '@/types';
import { privateJson } from '@/lib/httpResponses';

const DEFAULT_FRAUD_FLAGS_MIN_INTERVAL_MS = 30_000;

export async function GET(req: NextRequest) {
  const sessionWallet = requireAdminWallet(req);

  if (!sessionWallet) {
    return privateJson({ error: 'Forbidden' }, { status: 403 });
  }

  const dismissedKeys =
    FraudFlagDismissalStore.getInstance().getDismissedKeys();
  const filterVisibleFlags = (flags: FraudFlag[]) =>
    dismissedKeys.size === 0
      ? flags
      : flags.filter(
          (flag) => !dismissedKeys.has(computeFraudFlagDismissalKey(flag)),
        );

  const minIntervalMs = Number(
    process.env.FRAUD_FLAGS_MIN_INTERVAL_MS ??
      process.env.NEXT_PUBLIC_FRAUD_FLAGS_MIN_INTERVAL_MS ??
      DEFAULT_FRAUD_FLAGS_MIN_INTERVAL_MS,
  );
  const latestRun = FraudFlagsStore.getInstance().getLatestRun();

  if (
    Number.isFinite(minIntervalMs) &&
    minIntervalMs > 0 &&
    latestRun &&
    Date.now() - latestRun.evaluatedAt < minIntervalMs
  ) {
    return privateJson({
      flags: filterVisibleFlags(latestRun.flags),
      warnings: [
        ...latestRun.warnings,
        `Fraud flag evaluation is rate-limited; showing the last cached result from ${new Date(latestRun.evaluatedAt).toLocaleString()}.`,
      ],
      evaluatedAt: latestRun.evaluatedAt,
      eventsProcessed: latestRun.eventsProcessed,
      durationMs: latestRun.durationMs,
    });
  }

  const { flags, warnings, eventsProcessed, durationMs } =
    await runFraudFlagEvaluation();
  const evaluatedAt = Date.now();
  // Every flag is still computed and persisted in full (docs/fraud-detection.md,
  // issue #1171) — the run history and staleness badge stay accurate to what
  // was actually evaluated. Dismissals only filter what's *rendered* below,
  // so a worsening pattern (a different or higher-severity key, see
  // computeFraudFlagDismissalKey) is never hidden by a stale dismissal of an
  // earlier, milder finding.
  FraudFlagsStore.getInstance().recordRun(
    'manual',
    flags,
    warnings,
    evaluatedAt,
    eventsProcessed ?? 0,
    durationMs ?? 0,
  );

  return privateJson({
    flags: filterVisibleFlags(flags),
    warnings,
    evaluatedAt,
    eventsProcessed: eventsProcessed ?? 0,
    durationMs: durationMs ?? 0,
  });
}

export async function POST(req: NextRequest) {
  const sessionWallet = requireAdminWallet(req);

  if (!sessionWallet) {
    return privateJson({ error: 'Forbidden' }, { status: 403 });
  }

  const dismissedKeys =
    FraudFlagDismissalStore.getInstance().getDismissedKeys();
  const filterVisibleFlags = (flags: FraudFlag[]) =>
    dismissedKeys.size === 0
      ? flags
      : flags.filter(
          (flag) => !dismissedKeys.has(computeFraudFlagDismissalKey(flag)),
        );

  const result = await runFraudFlagEvaluation({
    mode: 'incremental',
    trigger: 'manual',
    timeBudgetMs: 45_000,
  });

  return privateJson({
    flags: filterVisibleFlags(result.flags),
    warnings: result.warnings,
    evaluatedAt: result.evaluatedAt ?? Date.now(),
    eventsProcessed: result.eventsProcessed ?? 0,
    durationMs: result.durationMs ?? 0,
  });
}

