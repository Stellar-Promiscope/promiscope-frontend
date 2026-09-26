/**
 * POST /api/media/report — report a player's profile media (issue #1320).
 *
 * Body: { cid, playerId?, reason, details?, turnstileToken? }
 *
 * Protected by Turnstile (when TURNSTILE_SECRET_KEY is set) and a per-IP rate
 * limit. Repeat reports from the same reporter for the same CID are
 * aggregated (202 with `duplicate: true`) rather than stacked.
 */
import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { verifyTurnstileToken } from '@/lib/turnstile';
import { getSessionWallet } from '@/lib/session';
import { createRequestLogger } from '@/lib/logger';
import { MediaModerationStore } from '@/lib/mediaModerationStore';
import { isMediaReportReason, isValidMediaCid } from '@/lib/mediaModeration';

const RATE_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 };
const MAX_DETAILS_LENGTH = 500;

/** Non-reversible reporter identity: the session wallet if signed in, else a salted IP hash. */
function reporterKey(req: NextRequest, ip: string): string {
  const wallet = getSessionWallet(req);
  const salt = process.env.SESSION_SECRET ?? 'media-report';
  return crypto
    .createHash('sha256')
    .update(`${salt}:${wallet ? `wallet:${wallet}` : `ip:${ip}`}`)
    .digest('hex');
}

export async function POST(req: NextRequest) {
  const log = createRequestLogger(req);
  const ip = getClientIp(req);

  const rate = await checkRateLimit(`media-report:${ip}`, RATE_LIMIT);
  if (rate.limited) {
    return NextResponse.json(
      { error: 'Too many reports. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rate.retryAfterSec ?? 600) },
      },
    );
  }

  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { cid, playerId, reason, details, turnstileToken } = body;
  if (!isValidMediaCid(cid)) {
    return NextResponse.json({ error: 'Invalid cid' }, { status: 400 });
  }
  if (!isMediaReportReason(reason)) {
    return NextResponse.json({ error: 'Invalid reason' }, { status: 400 });
  }
  if (playerId !== undefined && typeof playerId !== 'string') {
    return NextResponse.json({ error: 'Invalid playerId' }, { status: 400 });
  }
  if (
    details !== undefined &&
    (typeof details !== 'string' || details.length > MAX_DETAILS_LENGTH)
  ) {
    return NextResponse.json(
      { error: `details must be at most ${MAX_DETAILS_LENGTH} characters` },
      { status: 400 },
    );
  }

  if (!(await verifyTurnstileToken(turnstileToken, ip))) {
    return NextResponse.json(
      {
        error:
          'Bot-protection challenge failed. Please complete the challenge and try again.',
      },
      { status: 400 },
    );
  }

  try {
    const created = MediaModerationStore.getInstance().report({
      cid,
      playerId: (playerId as string | undefined) ?? null,
      reason,
      details: (details as string | undefined)?.trim() || null,
      reporterKey: reporterKey(req, ip),
    });
    return NextResponse.json(
      { ok: true, duplicate: !created },
      { status: created ? 201 : 202 },
    );
  } catch (err) {
    log.error('Failed to record media report', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Failed to record report' },
      { status: 500 },
    );
  }
}
