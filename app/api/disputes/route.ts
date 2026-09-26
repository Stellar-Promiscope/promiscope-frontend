import { NextRequest, NextResponse } from 'next/server';
import { apiError, ApiErrorCode } from '@/lib/apiErrors';
import { getSessionWallet } from '@/lib/session';
import { requireAdminWallet } from '@/lib/adminAuth';
import {
  MilestoneDisputeStore,
  DuplicateDisputeError,
  MilestoneNotFoundError,
} from '@/lib/milestoneDisputeStore';
import { getPlayer, getMilestoneHistory } from '@/lib/contract';
import { createRequestLogger } from '@/lib/logger';
import { validateTextField } from '@/lib/inputValidation';
import type { Milestone, MilestoneDisputeStatus, Player } from '@/types';

export const runtime = 'nodejs';

const VALID_STATUSES: MilestoneDisputeStatus[] = [
  'pending',
  'upheld',
  'reversed',
];

/**
 * GET /api/disputes
 *
 * Admins (session wallet === NEXT_PUBLIC_ADMIN_ADDRESS) see the full review
 * queue, optionally filtered by `?status=`. Everyone else sees only their
 * own disputes.
 */
export async function GET(req: NextRequest) {
  const wallet = getSessionWallet(req);
  if (!wallet) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const log = createRequestLogger(req);
  const isAdmin = requireAdminWallet(req) !== null;
  const statusParam = req.nextUrl.searchParams.get('status');

  if (
    statusParam &&
    !VALID_STATUSES.includes(statusParam as MilestoneDisputeStatus)
  ) {
    return NextResponse.json(
      { error: 'Invalid status filter' },
      { status: 400 },
    );
  }

  try {
    const store = MilestoneDisputeStore.getInstance();
    const disputes = isAdmin
      ? store.listAll(statusParam as MilestoneDisputeStatus | undefined)
      : store.listForWallet(wallet);
    return NextResponse.json(disputes);
  } catch (err) {
    log.error('Failed to list disputes', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Failed to load disputes' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/disputes
 *
 * Files a new dispute for one of the caller's own milestones.
 * Body: { playerId, milestoneId, reason, milestoneDescription? }.
 * Confirms against on-chain contract state that the player exists, the session
 * wallet is the player's registered wallet, and the milestoneId exists in the
 * player's on-chain history. The stored milestoneDescription is pulled from
 * the on-chain milestone record rather than untrusted client input.
 */
export async function POST(req: NextRequest) {
  const wallet = getSessionWallet(req);
  if (!wallet) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const log = createRequestLogger(req);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { playerId, milestoneId, milestoneDescription, reason } =
    body as Record<string, unknown>;

  if (
    typeof playerId !== 'string' ||
    !playerId.trim() ||
    typeof milestoneId !== 'string' ||
    !milestoneId.trim() ||
    (milestoneDescription !== undefined &&
      typeof milestoneDescription !== 'string')
  ) {
    return NextResponse.json(
      { error: 'playerId and milestoneId are required' },
      { status: 400 },
    );
  }

  if (typeof reason !== 'string') {
    return NextResponse.json({ error: 'reason is required' }, { status: 400 });
  }

  const reasonValidation = validateTextField('disputeReason', reason);
  if (!reasonValidation.valid) {
    return NextResponse.json(
      { error: `reason: ${reasonValidation.error}` },
      { status: 400 },
    );
  }

  const trimmedPlayerId = playerId.trim();
  const trimmedMilestoneId = milestoneId.trim();

  try {
    let player: Player | null = null;
    try {
      player = await getPlayer(trimmedPlayerId);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.toLowerCase().includes('not found') ||
        errMsg.includes('PlayerNotFound')
      ) {
        return NextResponse.json(
          { error: 'Player not found' },
          { status: 404 },
        );
      }
      throw err;
    }

    if (!player) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }

    if (player.wallet !== wallet) {
      return NextResponse.json(
        {
          error:
            'Forbidden: player does not belong to the authenticated wallet',
        },
        { status: 403 },
      );
    }

    let history: Milestone[] = [];
    try {
      history = await getMilestoneHistory(trimmedPlayerId);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.toLowerCase().includes('not found') ||
        errMsg.includes('PlayerNotFound')
      ) {
        return NextResponse.json(
          { error: 'Player not found' },
          { status: 404 },
        );
      }
      throw err;
    }

    const milestone = history?.find((m) => String(m.id) === trimmedMilestoneId);

    if (!milestone) {
      return NextResponse.json(
        {
          error: `Milestone ${trimmedMilestoneId} not found for this player`,
        },
        { status: 404 },
      );
    }

    const dispute = MilestoneDisputeStore.getInstance().create({
      playerId: trimmedPlayerId,
      playerWallet: wallet,
      milestoneId: trimmedMilestoneId,
      milestoneDescription: milestone.description,
      reason: reason.trim(),
    });
    return NextResponse.json(dispute, { status: 201 });
  } catch (err) {
    if (err instanceof DuplicateDisputeError) {
      return apiError(
        ApiErrorCode.DISPUTE_ALREADY_PENDING,
        409,
        `Milestone ${trimmedMilestoneId} already has a pending dispute`,
        { milestoneId: trimmedMilestoneId },
      );
    }
    if (err instanceof MilestoneNotFoundError) {
      return apiError(
        ApiErrorCode.MILESTONE_NOT_FOUND,
        404,
        `Milestone ${trimmedMilestoneId} not found`,
        { milestoneId: trimmedMilestoneId },
      );
    }
    log.error('Failed to create dispute', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Failed to create dispute' },
      { status: 500 },
    );
  }
}
