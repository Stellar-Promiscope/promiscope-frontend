/**
 * Admin API: player-media moderation queue (issue #1320).
 *
 * GET  — open reports aggregated per CID, plus the current denylist.
 * POST — { cid, decision: 'approve' | 'deny' | 'reinstate', reason?, unpin? }
 *   - approve:   resolves the reports and keeps the media.
 *   - deny:      resolves the reports and denylists the CID (/api/media then
 *                returns 451). With `unpin: true` the CID is also queued for
 *                Pinata unpinning through the superseded-media flow, so it
 *                gets the same 72-hour grace period and current-CID guard
 *                (see app/api/admin/ipfs-cleanup).
 *   - reinstate: removes the CID from the denylist.
 *
 * Every decision is written to the admin audit log.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminWallet } from '@/lib/adminAuth';
import { AdminAuditStore } from '@/lib/adminAuditStore';
import type { AdminAuditActionType } from '@/lib/adminAudit';
import { createRequestLogger } from '@/lib/logger';
import { MediaModerationStore } from '@/lib/mediaModerationStore';
import { recordSupersededCid } from '@/lib/supersededMediaStore';
import { isValidMediaCid } from '@/lib/mediaModeration';

const ACTION_BY_DECISION: Record<string, AdminAuditActionType> = {
  approve: 'media_approve',
  deny: 'media_deny',
  reinstate: 'media_reinstate',
};

export async function GET(req: NextRequest) {
  if (!requireAdminWallet(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const store = MediaModerationStore.getInstance();
  return NextResponse.json(
    { queue: store.getQueue(), denylist: store.getDenylist() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(req: NextRequest) {
  const adminWallet = requireAdminWallet(req);
  if (!adminWallet) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const log = createRequestLogger(req);

  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const cid = body?.cid;
  const decision = body?.decision;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  const playerId =
    typeof body?.playerId === 'string' ? (body.playerId as string) : null;

  if (!isValidMediaCid(cid)) {
    return NextResponse.json({ error: 'Invalid cid' }, { status: 400 });
  }
  if (typeof decision !== 'string' || !(decision in ACTION_BY_DECISION)) {
    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
  }
  if (decision === 'deny' && !reason) {
    return NextResponse.json(
      { error: 'A reason is required to deny media' },
      { status: 400 },
    );
  }

  const store = MediaModerationStore.getInstance();
  let resolvedReports = 0;
  let unpinQueued = false;

  if (decision === 'reinstate') {
    if (!store.reinstate(cid)) {
      return NextResponse.json(
        { error: 'CID is not denylisted' },
        { status: 404 },
      );
    }
  } else {
    resolvedReports = store.decide(
      cid,
      decision as 'approve' | 'deny',
      adminWallet,
      reason || 'approved',
    );
    if (decision === 'deny' && body?.unpin === true) {
      recordSupersededCid(cid, playerId ?? 'moderation');
      unpinQueued = true;
    }
  }

  try {
    AdminAuditStore.getInstance().insertEntry({
      actionType: ACTION_BY_DECISION[decision],
      adminWallet,
      target: cid,
      status: 'confirmed',
      timestamp: Math.floor(Date.now() / 1000),
      data: { reason: reason || null, playerId, resolvedReports, unpinQueued },
    });
  } catch (auditErr) {
    log.error('Failed to write media moderation decision to admin audit log', {
      reason: auditErr instanceof Error ? auditErr.message : String(auditErr),
    });
  }

  return NextResponse.json({ ok: true, resolvedReports, unpinQueued });
}
