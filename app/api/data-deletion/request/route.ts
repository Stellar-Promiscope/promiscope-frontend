import { NextRequest } from 'next/server';
import { getSessionWallet } from '@/lib/session';
import { deleteUserData } from '@/lib/offChainDataCollection';
import { createRequestLogger } from '@/lib/logger';
import { privateJson } from '@/lib/httpResponses';

export const runtime = 'nodejs';

/**
 * POST /api/data-deletion/request
 *
 * Cascade-deletes every off-chain record referencing the authenticated
 * wallet (see lib/offChainDataCollection.ts's `deleteUserData` for the full,
 * single-source-of-truth list of stores this covers — it's the same
 * registry GET /api/data-export reads from, so nothing exported here can
 * silently be left undeleted). A handful of records that must be retained
 * for platform integrity (e.g. an admin audit log entry the wallet appears
 * in) are anonymized rather than deleted; see
 * AdminAuditStore.anonymizeWallet's doc comment for why.
 *
 * On-chain data (registration, milestones, transaction history) is never
 * touched by this route — it's immutable and lives on the Stellar network,
 * matching DataDeletionModal's own on-chain/off-chain distinction.
 *
 * Authenticated via the existing session cookie (lib/session.ts): a request
 * can only ever delete the requesting wallet's own data, and success is
 * only reported back to the caller once the full cascade has actually
 * completed (deleteUserData is awaited in full below) — never optimistically.
 */
export async function POST(req: NextRequest) {
  const wallet = getSessionWallet(req);
  if (!wallet) {
    return privateJson({ error: 'Unauthorized' }, { status: 401 });
  }

  const log = createRequestLogger(req);
  try {
    const { removed, anonymized, failed } = await deleteUserData(wallet);
    const failedStores = Object.keys(failed ?? {});
    if (failedStores.length > 0) {
      // Partial deletion: never report success. Retrying is safe.
      log.error('Data deletion request partially failed', {
        removed,
        anonymized,
        failed,
      });
      return NextResponse.json(
        {
          error: `Some of your data could not be deleted (${failedStores.join(', ')}). Please try again.`,
          partial: true,
          removed,
          anonymized,
          failed: failedStores,
        },
        { status: 502 },
      );
    }
    log.info('Processed data deletion request', { removed, anonymized });
    return privateJson({ success: true, removed, anonymized });
  } catch (err) {
    log.error('Failed to process data deletion request', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return privateJson(
      { error: 'Failed to process data deletion request' },
      { status: 500 },
    );
  }
}
