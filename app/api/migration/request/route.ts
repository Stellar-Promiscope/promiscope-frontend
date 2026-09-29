/**
 * POST /api/migration/request
 *
 * Submits a wallet data-portability migration request (issue #1315).
 * The caller must be signed in as the *backup* (destination) wallet via
 * SEP-10 — this proves they control the key they want to migrate data to.
 *
 * Body: { fromWallet: string }
 *   fromWallet — the primary wallet whose off-chain data should be moved
 *
 * The server verifies that toWallet (the session wallet) is registered as
 * a backup wallet for fromWallet. A 72-hour cooling-off period starts
 * immediately. During cooling-off, the original owner can cancel the
 * request via POST /api/migration/cancel.
 *
 * Returns the created MigrationRequest record.
 *
 * Threat model (see issue #1315):
 *   - The backup wallet must authenticate with SEP-10 before submitting.
 *   - The 72-hour cooling-off gives the original owner time to cancel a
 *     fraudulent request (e.g. if the backup key was also compromised).
 *   - Rate limited to 3 requests per IP per hour to limit brute force.
 *   - Each fromWallet can only have one active (pending/approved) request
 *     at a time.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionWallet } from '@/lib/session';
import { MigrationStore } from '@/lib/migrationStore';
import { createRequestLogger } from '@/lib/logger';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const log = createRequestLogger(req);

  // Rate limit: 3 requests per IP per hour
  const rl = await checkRateLimit(`migration-request:${getClientIp(req)}`, {
    limit: 3,
    windowMs: 60 * 60 * 1000,
  });
  if (rl.limited) {
    return NextResponse.json(
      { error: 'Too many migration requests. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSec ?? 60) },
      },
    );
  }

  // Caller must be authenticated as the backup (destination) wallet
  const toWallet = getSessionWallet(req);
  if (!toWallet) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { fromWallet } = (body ?? {}) as Record<string, unknown>;

  if (typeof fromWallet !== 'string' || !fromWallet.trim()) {
    return NextResponse.json(
      { error: 'fromWallet is required' },
      { status: 400 },
    );
  }

  if (!/^G[A-Z2-7]{55}$/.test(fromWallet.trim())) {
    return NextResponse.json(
      { error: 'fromWallet must be a valid Stellar public key' },
      { status: 400 },
    );
  }

  if (fromWallet.trim() === toWallet) {
    return NextResponse.json(
      { error: 'fromWallet and toWallet must be different' },
      { status: 400 },
    );
  }

  // Generate a request id
  const id = crypto.randomUUID();

  try {
    const request = MigrationStore.getInstance().create(
      id,
      fromWallet.trim(),
      toWallet,
    );

    log.info('Migration request created', {
      id: request.id,
      fromWallet: request.fromWallet,
      toWallet: request.toWallet,
      executeAfter: request.executeAfter,
    });

    return NextResponse.json(request, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('Migration request rejected', { reason: message });
    return NextResponse.json({ error: message }, { status: 409 });
  }
}

/** GET /api/migration/request — list migration requests for the session wallet */
export async function GET(req: NextRequest) {
  const wallet = getSessionWallet(req);
  if (!wallet) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const requests = MigrationStore.getInstance().listForWallet(wallet);
  return NextResponse.json({ requests });
}
