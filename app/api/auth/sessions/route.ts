import { NextRequest, NextResponse } from 'next/server';
import { createRequestLogger, withRequestId } from '@/lib/logger';
import { getSessionId, getSessionWallet } from '@/lib/session';
import { SessionStore } from '@/lib/sessionStore';
import { labelUserAgent, parseUserAgent } from '@/lib/userAgentLabel';

// better-sqlite3 (via lib/sessionStore.ts) is a native addon and needs the
// Node.js runtime, not edge.
export const runtime = 'nodejs';

export interface ActiveSessionSummary {
  id: string;
  /** English "browser on OS" label; kept for non-UI consumers. */
  deviceLabel: string;
  /** Parsed parts so the UI can translate the label; null if unknown. */
  device?: { browser: string | null; os: string | null } | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  isCurrent: boolean;
}

/**
 * GET /api/auth/sessions
 *
 * Lists every currently-active (not revoked, not expired) session for the
 * caller's wallet — the "Active sessions" view in app/[locale]/settings
 * (issue #1187), built on top of the session store #1179 introduced for
 * "log out of all devices". Only the fields a user needs to recognize
 * "is this session me" are returned: a coarse device/browser label derived
 * from the User-Agent header (see lib/userAgentLabel.ts — no precise
 * geolocation or IP is stored or exposed at all), plus login/last-active
 * timestamps. `isCurrent` lets the UI mark and protect the caller's own row.
 */
export async function GET(req: NextRequest) {
  const log = createRequestLogger(req);

  const wallet = getSessionWallet(req);
  if (!wallet) {
    return withRequestId(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      log.requestId,
    );
  }

  const currentSid = getSessionId(req);
  const now = Date.now();
  const sessions: ActiveSessionSummary[] = SessionStore.getInstance()
    .listForWallet(wallet)
    .filter((row) => row.revokedAt === null && row.expiresAt > now)
    .map((row) => ({
      id: row.id,
      deviceLabel: labelUserAgent(row.userAgent),
      device: parseUserAgent(row.userAgent),
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      expiresAt: row.expiresAt,
      isCurrent: row.id === currentSid,
    }));

  return withRequestId(NextResponse.json({ sessions }), log.requestId);
}
