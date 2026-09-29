import { NextRequest, NextResponse } from 'next/server';
import { MilestoneDisputeStore } from '@/lib/milestoneDisputeStore';
import { createRequestLogger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /api/cron/escalate-disputes
 *
 * Scheduled cron job (e.g. daily) that marks every 'pending' dispute whose
 * response deadline has elapsed as 'escalated', records a system event on
 * each dispute's timeline, and returns a count.
 *
 * Auth: requires the standard CRON_SECRET header, consistent with the
 * existing cron routes under app/api/cron/. Vercel Cron sends this
 * automatically; local testing can pass it explicitly.
 *
 * Vercel cron schedule (add to vercel.json):
 *   { "path": "/api/cron/escalate-disputes", "schedule": "0 2 * * *" }
 * (runs at 02:00 UTC daily)
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const log = createRequestLogger(req);
  try {
    const store = MilestoneDisputeStore.getInstance();
    const count = store.escalateUnanswered();
    log.info('Escalated unanswered disputes', { count });
    return NextResponse.json({ escalated: count });
  } catch (err) {
    log.error('Failed to escalate disputes', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Failed to escalate disputes' },
      { status: 500 },
    );
  }
}
