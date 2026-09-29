import { NextRequest, NextResponse } from 'next/server';
import { getSessionWallet } from '@/lib/session';
import { requireAdminWallet } from '@/lib/adminAuth';
import { MilestoneDisputeStore } from '@/lib/milestoneDisputeStore';
import { checkIsValidator } from '@/lib/contract';
import { createRequestLogger } from '@/lib/logger';
import {
  sanitizeTextInput,
  validateTextField,
  TEXT_FIELD_LIMITS,
} from '@/lib/inputValidation';

export const runtime = 'nodejs';

/** Allowed MIME types for evidence uploads. */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'application/pdf',
]);

/**
 * POST /api/disputes/:id/evidence
 *
 * Attaches evidence (an IPFS CID + optional text body) to a dispute.
 *
 * Access control:
 *   - The player who filed the dispute may post evidence while it is
 *     'pending', 'under_review', or 'escalated'.
 *   - The validator who approved the milestone may post evidence while
 *     it is 'pending' or 'under_review'. The first validator evidence
 *     submission transitions the dispute from 'pending' → 'under_review'.
 *   - Admins may record an 'admin_note' event at any time before a final
 *     decision (i.e., status !== 'upheld' | 'reversed').
 *   - Any other wallet gets 403.
 *
 * Body (JSON):
 *   ipfsHash     string  — IPFS CID of the uploaded evidence file
 *   ipfsMimeType string  — MIME type of the uploaded file
 *   body?        string  — optional accompanying text note (≤ 2000 chars)
 */
export async function POST(
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
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    ipfsHash,
    ipfsMimeType,
    body: textBody,
  } = body as Record<string, unknown>;

  // ── Input validation ──────────────────────────────────────────────────────

  if (typeof ipfsHash !== 'string' || !ipfsHash.trim()) {
    return NextResponse.json(
      { error: 'ipfsHash is required' },
      { status: 400 },
    );
  }
  if (typeof ipfsMimeType !== 'string' || !ALLOWED_MIME_TYPES.has(ipfsMimeType)) {
    return NextResponse.json(
      {
        error: `ipfsMimeType must be one of: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
      },
      { status: 400 },
    );
  }

  const rawText =
    typeof textBody === 'string' && textBody.trim() ? textBody : null;
  if (rawText !== null) {
    const validation = validateTextField('disputeReason', rawText);
    if (!validation.valid) {
      return NextResponse.json(
        { error: `body: ${validation.error}` },
        { status: 400 },
      );
    }
  }
  const sanitizedText = rawText !== null ? sanitizeTextInput(rawText) : null;

  // ── Load dispute ──────────────────────────────────────────────────────────

  const store = MilestoneDisputeStore.getInstance();
  const dispute = store.findById(id);

  if (!dispute) {
    return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
  }

  // ── Access control + role detection ──────────────────────────────────────

  const isAdmin = requireAdminWallet(req) !== null;
  const isPlayer = dispute.playerWallet === wallet;
  const isValidator = dispute.validatorWallet === wallet;

  if (!isAdmin && !isPlayer && !isValidator) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Terminal statuses: no more evidence after a final decision.
  if (dispute.status === 'upheld' || dispute.status === 'reversed') {
    return NextResponse.json(
      { error: 'Dispute is already decided; no further evidence can be added' },
      { status: 409 },
    );
  }

  // Validators may not post evidence on an already-escalated dispute.
  if (isValidator && !isAdmin && dispute.status === 'escalated') {
    return NextResponse.json(
      {
        error:
          'The response window for this dispute has elapsed. Contact the admin to request an extension.',
      },
      { status: 409 },
    );
  }

  // ── Verify the session validator is actually on-chain authorized ──────────
  // (Guards against a wallet that matched `validatorWallet` by coincidence
  //  but was later removed from the contract.)
  if (isValidator && !isAdmin) {
    try {
      const onChain = await checkIsValidator(wallet);
      if (!onChain) {
        return NextResponse.json(
          {
            error:
              'Your wallet is no longer an authorized validator on-chain and cannot respond to disputes.',
          },
          { status: 403 },
        );
      }
    } catch (err) {
      log.error('is_validator check failed', {
        wallet,
        reason: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        { error: 'Could not verify validator status — please try again' },
        { status: 503 },
      );
    }
  }

  // ── Determine event type ──────────────────────────────────────────────────

  type EventType = 'evidence_added' | 'validator_response' | 'admin_note';
  let eventType: EventType;

  if (isAdmin) {
    eventType = 'admin_note';
  } else if (isValidator) {
    eventType = 'validator_response';
  } else {
    eventType = 'evidence_added';
  }

  try {
    // Transition 'pending' → 'under_review' on first validator response.
    if (isValidator && !isAdmin && dispute.status === 'pending') {
      store.markUnderReview(id, wallet);
    }

    const event = store.addEvent(id, {
      type: eventType,
      actorWallet: wallet,
      body: sanitizedText,
      ipfsHash: ipfsHash.trim(),
      ipfsMimeType,
    });

    return NextResponse.json(event, { status: 201 });
  } catch (err) {
    log.error('Failed to add evidence', {
      disputeId: id,
      reason: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Failed to add evidence' },
      { status: 500 },
    );
  }
}
