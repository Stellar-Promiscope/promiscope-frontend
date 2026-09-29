/**
 * Payment-proof gate for contact-detail release (issue #1301).
 *
 * The release route (`GET /api/contact/[playerId]`) serves decrypted
 * contact details ONLY when the requesting scout has a `player_contacted`
 * event for that player in the indexer — i.e. they actually paid on-chain.
 * This module encapsulates that check so the route stays thin and the rule
 * is unit-testable without HTTP.
 *
 * Indistinguishability note: callers must return 404 (not 403) whether the
 * vault row is missing OR the payment proof is missing, so an unpaid scout
 * cannot probe which players have uploaded contact details.
 */
import { fetchPlayerEvents } from './indexerClient';

export interface ContactAccessCheck {
  fetchEvents?: typeof fetchPlayerEvents;
  limit?: number;
}

/**
 * Returns true when the indexer holds a `player_contacted` event with
 * `scout === scoutWallet` for `playerId`. Paginates (the player may have
 * many events); caps pages so a pathological history can't hang the route.
 */
export async function hasPaidForContact(
  scoutWallet: string,
  playerId: string,
  opts: ContactAccessCheck = {},
): Promise<boolean> {
  const fetchEvents = opts.fetchEvents ?? fetchPlayerEvents;
  const limit = opts.limit ?? 200;
  let cursor: number | undefined;

  for (let page = 0; page < 10; page++) {
    const { events, nextCursor } = await fetchEvents(playerId, {
      type: 'player_contacted',
      limit,
      before: cursor,
    });
    if (
      events.some(
        (event) =>
          event.type === 'player_contacted' && event.scout === scoutWallet,
      )
    ) {
      return true;
    }
    if (nextCursor === null) return false;
    cursor = nextCursor;
  }
  return false;
}
