import { privateJson } from '@/lib/httpResponses';
import { NextRequest } from 'next/server';
import { getSessionStatus, isSessionOwner } from '@/lib/chunkedUploadStore';
import { getSessionWallet } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * GET /api/ipfs/upload/status?sessionId=...
 *
 * Reports which chunks a session has already received, so a client
 * resuming after an interruption knows exactly where to continue instead
 * of restarting from byte zero.
 */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return privateJson({ error: 'sessionId is required' }, { status: 400 });
  }

  if (!(await isSessionOwner(sessionId, getSessionWallet(req)))) {
    // 404 rather than 403 so a foreign caller can't probe session existence.
    return privateJson(
      { error: 'Upload session not found or expired' },
      { status: 404 },
    );
  }

  const status = await getSessionStatus(sessionId);
  if (!status) {
    return privateJson(
      { error: 'Upload session not found or expired' },
      { status: 404 },
    );
  }

  return privateJson(status);
}
