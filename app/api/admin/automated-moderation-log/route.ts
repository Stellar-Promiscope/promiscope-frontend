import { NextRequest, NextResponse } from 'next/server';
import { AdminAuditStore } from '@/lib/adminAuditStore';
import type { AdminAuditActionType } from '@/lib/adminAudit';
import { createRequestLogger, withRequestId } from '@/lib/logger';
import { privateJson } from '@/lib/httpResponses';

// Automated moderation entries are persisted in the shared admin audit log
// but aren't part of its closed `AdminAuditActionType` union (they're an
// internal, system-generated category rather than an operator action). The
// prefix is kept greppable and the concrete category is carried in `data`.
const AUTOMATED_MODERATION_ACTION_TYPE =
  'automated_moderation' as AdminAuditActionType;

/**
 * POST /api/admin/automated-moderation-log
 *
 * Records an automated moderation decision (auto-block, auto-flag, etc.)
 * for admin review. Called by the chat API server when it makes an
 * automated moderation decision.
 *
 * This is fire-and-forget: the moderation action itself has already been
 * applied before this logging call, so a network failure here doesn't
 * delay or block the moderation action.
 *
 * Per privacy considerations, message content is NOT stored — only
 * metadata (user IDs, thread ID, rule that triggered, timestamp).
 */
export async function POST(request: NextRequest): Promise<Response> {
  const log = createRequestLogger(request);
  try {
    const body = await request.json();
    const {
      id,
      category,
      rule,
      severity,
      userId,
      threadId,
      timestamp,
      context,
    } = body;

    // Validate required fields
    if (!id || !category || !rule || !severity || !userId || !timestamp) {
      return privateJson({ error: 'Missing required fields' }, { status: 400 });
    }

    const adminStore = AdminAuditStore.getInstance();

    // Record in the admin audit store under the automated-moderation action
    // type; the specific category lives in `data` for the admin UI to filter on.
    adminStore.insertEntry({
      actionType: AUTOMATED_MODERATION_ACTION_TYPE,
      adminWallet: 'system',
      target: threadId ?? userId,
      amountStroops: null,
      txHash: id,
      status: 'confirmed',
      timestamp,
      data: {
        category,
        rule,
        severity,
        userId,
        context: context ?? {},
      },
    });

    return privateJson({ success: true }, { status: 201 });
  } catch (error) {
    log.error('Failed to record automated moderation entry', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return withRequestId(
      privateJson({ error: 'Internal server error' }, { status: 500 }),
      log.requestId,
    );
  }
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function badRequest(error: string): Response {
  return privateJson({ error }, { status: 400 });
}

/**
 * GET /api/admin/automated-moderation-log?userId=&from=&to=&before=&limit=
 *
 * Returns automated moderation decisions for admin review, newest first.
 * The userId filter runs in the store query (not after LIMIT), and
 * `nextCursor` is passed back as `before` to fetch the next page.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const log = createRequestLogger(request);
  const params = new URL(request.url).searchParams;
  const userId = params.get('userId') || undefined;

  const parseNumberParam = (name: string): number | undefined | null => {
    const raw = params.get(name);
    if (raw === null || raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const from = parseNumberParam('from');
  if (from === null) return badRequest('from must be a number');
  const to = parseNumberParam('to');
  if (to === null) return badRequest('to must be a number');
  const before = parseNumberParam('before');
  if (before === null || (before !== undefined && !Number.isInteger(before))) {
    return badRequest('before must be an integer');
  }
  const limitParam = parseNumberParam('limit');
  const limit = limitParam === undefined ? DEFAULT_LIMIT : limitParam;
  if (
    limit === null ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_LIMIT
  ) {
    return badRequest(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }

  try {
    const adminStore = AdminAuditStore.getInstance();
    const { entries, nextCursor } = adminStore.getEntries({
      actionType: AUTOMATED_MODERATION_ACTION_TYPE,
      dataUserId: userId,
      from,
      to,
      before,
      limit,
    });

    return privateJson({ entries, nextCursor }, { status: 200 });
  } catch (error) {
    log.error('Failed to fetch automated moderation entries', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return withRequestId(
      privateJson({ error: 'Internal server error' }, { status: 500 }),
      log.requestId,
    );
  }
}
