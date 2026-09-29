import { NextRequest } from 'next/server';
import { requireAdminWallet } from '@/lib/adminAuth';
import { MilestoneDisputeStore } from '@/lib/milestoneDisputeStore';
import { createRequestLogger } from '@/lib/logger';
import { sanitizeTextInput, TEXT_FIELD_LIMITS } from '@/lib/inputValidation';
import { privateJson } from '@/lib/httpResponses';

export const runtime = 'nodejs';

/**
 * PATCH /api/disputes/:id/decide
 *
 * Admin-only. Resolves a pending dispute.
 * Body: { status: 'upheld' | 'reversed', resolutionNote?: string, revokeTxHash?: string }.
 *
 * 'reversed' must include the tx hash of the on-chain revoke_milestone call
 * the admin panel already submitted (see components/admin/DisputedMilestonesPanel.tsx,
 * which reuses useValidator().revokeMilestone — this route never calls the
 * contract itself, it only records the outcome).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const adminWallet = requireAdminWallet(req);
  if (!adminWallet) {
    return privateJson({ error: 'Forbidden' }, { status: 403 });
  }

  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return privateJson({ error: 'Invalid dispute id' }, { status: 400 });
  }

  const log = createRequestLogger(req);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return privateJson({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { status, resolutionNote, revokeTxHash } = body as Record<
    string,
    unknown
  >;
  if (status !== 'upheld' && status !== 'reversed') {
    return privateJson(
      { error: "status must be 'upheld' or 'reversed'" },
      { status: 400 },
    );
  }
  if (
    status === 'reversed' &&
    (typeof revokeTxHash !== 'string' || !revokeTxHash.trim())
  ) {
    return privateJson(
      { error: 'revokeTxHash is required when reversing a dispute' },
      { status: 400 },
    );
  }

  // Validate free-text resolutionNote length server-side.
  const rawNote =
    typeof resolutionNote === 'string' && resolutionNote.trim()
      ? resolutionNote
      : null;
  if (rawNote !== null) {
    const sanitizedNote = sanitizeTextInput(rawNote);
    if (sanitizedNote.length > TEXT_FIELD_LIMITS.disputeReason.max) {
      return privateJson(
        {
          error: `resolutionNote must be at most ${TEXT_FIELD_LIMITS.disputeReason.max} characters`,
        },
        { status: 400 },
      );
    }
  }

  const store = MilestoneDisputeStore.getInstance();
  const existing = store.findById(id);
  if (!existing) {
    return privateJson({ error: 'Dispute not found' }, { status: 404 });
  }
  const decidableStatuses = ['pending', 'under_review', 'escalated'];
  if (!decidableStatuses.includes(existing.status)) {
    return privateJson(
      { error: 'Dispute has already been decided' },
      { status: 409 },
    );
  }

  try {
    const updated = store.decide(id, {
      status,
      decidedBy: adminWallet,
      resolutionNote: rawNote !== null ? sanitizeTextInput(rawNote) : null,
      revokeTxHash: typeof revokeTxHash === 'string' ? revokeTxHash : null,
    });
    return privateJson(updated);
  } catch (err) {
    log.error('Failed to decide dispute', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return privateJson({ error: 'Failed to decide dispute' }, { status: 500 });
  }
}
