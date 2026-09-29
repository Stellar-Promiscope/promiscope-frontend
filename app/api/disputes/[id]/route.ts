import { NextRequest, NextResponse } from 'next/server';
import { getSessionWallet } from '@/lib/session';
import { requireAdminWallet } from '@/lib/adminAuth';
import { MilestoneDisputeStore } from '@/lib/milestoneDisputeStore';
import { createRequestLogger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /api/disputes/:id
 *
 * Returns a single dispute with its full event timeline.
 *
 * Access control — only three parties may view a dispute:
 *   1. The player who filed it (session wallet === dispute.playerWallet)
 *   2. The validator who approved the milestone (session wallet === dispute.validatorWallet)
 *   3. Any admin (session wallet === NEXT_PUBLIC_ADMIN_ADDRESS)
 *
 * Returns 403 for any other authenticated wallet, 401 for unauthenticated.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const wallet = getSessionWallet(req);
  if (!wallet) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid dispute id' }, { status: 400 });
  }

  const log = createRequestLogger(req);

  try {
    const store = MilestoneDisputeStore.getInstance();
    const dispute = store.findByIdWithEvents(id);

    if (!dispute) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    const isAdmin = requireAdminWallet(req) !== null;
    const isPlayer = dispute.playerWallet === wallet;
    const isValidator = dispute.validatorWallet === wallet;

    if (!isAdmin && !isPlayer && !isValidator) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json(dispute);
  } catch (err) {
    log.error('Failed to fetch dispute', {
      id,
      reason: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Failed to fetch dispute' },
      { status: 500 },
    );
  }
}
