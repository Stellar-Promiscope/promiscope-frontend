import { NextRequest } from 'next/server';
import { getSessionWallet } from '@/lib/session';
import { ContactVaultStore } from '@/lib/contactVaultStore';
import { unsealContactDetails } from '@/lib/contactVaultCrypto';
import { hasPaidForContact } from '@/lib/contactAccess';
import { isValidStellarAddress, normalizeStellarAddress } from '@/lib/stellar';
import { createRequestLogger } from '@/lib/logger';
import { privateJson } from '@/lib/httpResponses';
import type { ContactDetails } from '@/types';

export const runtime = 'nodejs';

/**
 * GET /api/contact/[playerId]
 *
 * Release endpoint for sealed player contact details (issue #1301). Serves
 * decrypted details ONLY when BOTH hold:
 *   1. the caller is authenticated (session wallet), and
 *   2. the indexer holds a `player_contacted` event with
 *      `scout === caller` for this player (on-chain payment proof).
 *
 * Indistinguishability: a missing vault row and a missing payment proof
 * both return 404 with the same body, so an unpaid scout cannot probe
 * which players have uploaded details. Never 403 here — 403 would be an
 * oracle ("this row exists, you just can't have it").
 *
 * Plaintext exists only in this handler's memory during unseal; the
 * response carries `private, no-store` via privateJson so it is never
 * cached. The client keeps it in the existing memory-only SWR cache
 * (lib/contactDetailsCache.ts).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { playerId: string } },
) {
  const scoutWallet = getSessionWallet(req);
  if (!scoutWallet) {
    return privateJson({ error: 'Unauthorized' }, { status: 401 });
  }

  const log = createRequestLogger(req);
  const normalizedPlayerId = normalizeStellarAddress(params.playerId ?? '');
  if (!isValidStellarAddress(normalizedPlayerId)) {
    return privateJson(
      { error: 'playerId must be a valid Stellar public key (G...)' },
      { status: 400 },
    );
  }

  try {
    // Cheap negative first: no vault row means nothing to release. Still
    // 404 (same body as the unpaid case below) — never reveal which of
    // "no row" / "no payment" caused the denial.
    const sealed = ContactVaultStore.getInstance().get(normalizedPlayerId);
    if (!sealed) {
      return privateJson(
        { error: 'Contact details not available' },
        { status: 404 },
      );
    }

    let paid: boolean;
    try {
      paid = await hasPaidForContact(scoutWallet, normalizedPlayerId);
    } catch (err) {
      // Indexer down is not a denial — it is an unknown. Fail closed with
      // a retryable 503 rather than a 404 that the client would treat as
      // "nothing to unlock".
      log.error('Contact release indexer check failed', {
        reason: err instanceof Error ? err.message : String(err),
      });
      return privateJson(
        { error: 'Payment verification unavailable, try again' },
        { status: 503 },
      );
    }
    if (!paid) {
      log.info('Contact release denied: no payment proof', {
        playerId: normalizedPlayerId,
      });
      return privateJson(
        { error: 'Contact details not available' },
        { status: 404 },
      );
    }

    const details = JSON.parse(unsealContactDetails(sealed)) as ContactDetails;
    log.info('Contact details released', { playerId: normalizedPlayerId });
    return privateJson(details);
  } catch (err) {
    log.error('Failed to release contact details', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return privateJson(
      { error: 'Failed to load contact details' },
      { status: 500 },
    );
  }
}
