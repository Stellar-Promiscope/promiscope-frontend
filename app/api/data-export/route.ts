import { NextRequest, NextResponse } from 'next/server';
import { getSessionWallet } from '@/lib/session';
import { collectUserData } from '@/lib/offChainDataCollection';
import { createRequestLogger } from '@/lib/logger';
import { privateJson } from '@/lib/httpResponses';

export const runtime = 'nodejs';

/**
 * GET /api/data-export
 *
 * Returns a compiled, authenticated JSON export of the requesting wallet's
 * off-chain data across every in-scope store. Delivered as a direct
 * authenticated response (the session cookie proves ownership) with
 * `Content-Disposition: attachment` and `Cache-Control: private, no-store`, so the
 * payload is never cached or retrievable by anyone without the session.
 *
 * On-chain data is explicitly excluded and explained in the payload's
 * `onChainExcluded` section (with a block-explorer link).
 */
export async function GET(req: NextRequest) {
  const wallet = getSessionWallet(req);
  if (!wallet) {
    return privateJson({ error: 'Unauthorized' }, { status: 401 });
  }

  const log = createRequestLogger(req);
  try {
    const payload = await collectUserData(wallet);
    const filename = `promiscope-data-export-${wallet}-${
      new Date().toISOString().split('T')[0]
    }.json`;

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie',
      },
    });
  } catch (err) {
    log.error('Failed to build data export', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return privateJson(
      { error: 'Failed to build data export' },
      { status: 500 },
    );
  }
}
