/**
 * POST /api/migration/cancel
 *
 * Cancels a pending wallet migration request.
 * Either the fromWallet or toWallet may cancel during the 72-hour
 * cooling-off period (so the original owner can cancel a fraudulent request
 * even if they no longer have access to the primary wallet, and the
 * requester can cancel if they made a mistake).
 *
 * Body: { requestId: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionWallet } from '@/lib/session';
import { MigrationStore } from '@/lib/migrationStore';
import { createRequestLogger } from '@/lib/logger';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const log = createRequestLogger(req);

  const wallet = getSessionWallet(req);
  if (!wallet) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { requestId } = (body ?? {}) as Record<string, unknown>;
  if (typeof requestId !== 'string' || !requestId.trim()) {
    return NextResponse.json(
      { error: 'requestId is required' },
      { status: 400 },
    );
  }

  const store = MigrationStore.getInstance();
  const migReq = store.get(requestId.trim());

  if (!migReq) {
    return NextResponse.json(
      { error: 'Migration request not found' },
      { status: 404 },
    );
  }

  // Only the fromWallet or toWallet may cancel
  if (migReq.fromWallet !== wallet && migReq.toWallet !== wallet) {
    return NextResponse.json(
      { error: 'Forbidden: you are not a party to this migration request' },
      { status: 403 },
    );
  }

  try {
    const updated = store.cancel(requestId.trim(), wallet);
    log.info('Migration request cancelled', {
      id: updated.id,
      cancelledBy: wallet,
    });
    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
