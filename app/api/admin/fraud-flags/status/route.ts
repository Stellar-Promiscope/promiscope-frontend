import { NextRequest, NextResponse } from 'next/server';
import { requireAdminWallet } from '@/lib/adminAuth';
import { FraudFlagsStore } from '@/lib/fraudFlagsStore';

/**
 * Lightweight companion to GET /api/admin/fraud-flags: returns the most
 * recently *persisted* evaluation's metadata without re-running the
 * heuristics, so the admin dashboard can show a staleness indicator (issue
 * #1007) without paying the cost of a full evaluation just to render a
 * badge. Populated by either an admin's on-demand panel load or the
 * scheduled cron trigger (app/api/cron/fraud-flags/route.ts) — whichever
 * ran most recently.
 */
export async function GET(req: NextRequest) {
  const sessionWallet = requireAdminWallet(req);

  if (!sessionWallet) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const latest = FraudFlagsStore.getInstance().getLatestRun();

  if (!latest) {
    return NextResponse.json({
      evaluatedAt: null,
      highSeverityCount: 0,
      trigger: null,
      eventsProcessed: 0,
      durationMs: 0,
      lastLedger: 0,
    });
  }

  const checkpoint = FraudFlagsStore.getInstance().getCheckpoint();

  return NextResponse.json({
    evaluatedAt: latest.evaluatedAt,
    highSeverityCount: latest.highSeverityCount,
    trigger: latest.trigger,
    eventsProcessed: latest.eventsProcessed ?? 0,
    durationMs: latest.durationMs ?? 0,
    lastLedger: checkpoint?.lastLedger ?? 0,
  });
}
