'use client';
import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { useWallet } from '@/hooks/useWallet';
import { useToast } from '@/components/ui/Toast';
import { useSubmissionGuard } from '@/hooks/useSubmissionGuard';
import {
  payToContact,
  getSubscription,
  PLATFORM_CONTACT_FEE_XLM,
} from '@/lib/contract';
import { checkFraudThrottle } from '@/lib/api';
import { parseContractError } from '@/lib/contractErrorMessage';
import { isBlockedByCounterpart } from '@/lib/messaging/moderation';
import {
  cacheContactDetails,
  contactDetailsKey,
  purgeContactDetails,
} from '@/lib/contactDetailsCache';
import {
  defaultFetchContactRelease,
  type FetchContactRelease,
} from '@/lib/contactReleaseClient';
import type { ContactDetails } from '@/types';

/**
 * Pays to unlock a player's contact details and exposes the result through
 * a session-bounded, non-persistent cache. See
 * docs/contact-details-privacy.md and lib/contactDetailsCache.ts for the
 * storage policy this hook enforces — contact details never touch
 * localStorage/IndexedDB, live only in SWR's in-memory cache, and are
 * purged automatically after CONTACT_DETAILS_TTL_MS or immediately on
 * wallet disconnect.
 *
 * Release flow (issue #1301): the on-chain `pay_to_contact` return value is
 * world-readable (any account can `simulateTransaction` it for free, and
 * contract storage is readable via `getLedgerEntries`), so plaintext must
 * never come from the chain. After paying, the hook fetches the decrypted
 * details from the server-side release endpoint `GET /api/contact/:id`,
 * which verifies the `player_contacted` payment proof in the indexer before
 * unsealing the vault row. The chain's return value is intentionally
 * ignored — it is untrusted public output.
 *
 * Transitional fallback: players who have not uploaded to the vault yet
 * have no sealed row, and the release endpoint answers 404. Only then does
 * the hook fall back to the legacy chain return value (pre-#1301 contract
 * behaviour), so migration doesn't break unlocks mid-rollout. New uploads
 * must go to the vault; the fallback is removed once the contract stops
 * returning PII.
 *
 * `contactDetails` is keyed by (playerId, scout wallet), so any component
 * that calls this hook for the same player — e.g. ContactModal rendered
 * alongside the caller that triggered unlock() — reads the same cache
 * entry without needing to unlock again.
 */
export function usePayToContact(
  playerId: string,
  opts: { fetchRelease?: FetchContactRelease } = {},
) {
  const { publicKey, signOnly, xlmBalance, refreshBalance } = useWallet();
  const { show } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = publicKey ? contactDetailsKey(playerId, publicKey) : null;

  // No fetcher: this key is populated only by unlock() below via
  // cacheContactDetails(), never auto-fetched/revalidated by SWR — there is
  // no re-fetchable GET for already-unlocked PII, only the one-time
  // on-chain pay_to_contact call.
  const { data: contactDetails } = useSWR<ContactDetails>(key, null, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: false,
  });

  const submitGuarded = useSubmissionGuard<ContactDetails | undefined>();

  // Wraps the entire build/sign/submit attempt in useSubmissionGuard's
  // in-flight mutex (issue #1177) — a fast double-click or any re-invocation
  // of unlock() while one is already pending returns the SAME in-flight
  // promise instead of building/signing/submitting a second payToContact
  // transaction. See docs/payment-idempotency.md for what this does and
  // doesn't guarantee.
  const unlock = useCallback((): Promise<ContactDetails | undefined> => {
    return submitGuarded(async () => {
      function fail(msg: string): void {
        setError(msg);
        show({ message: msg, variant: 'error' });
      }

      if (!publicKey) {
        fail('Wallet not connected.');
        return undefined;
      }

      setLoading(true);
      setError(null);

      try {
        // ── 1. Block gate ────────────────────────────────────────────────────
        // pay_to_contact is submitted directly to the chain (lib/contract.ts)
        // and never touches the chat API, so it bypasses the block check that
        // stops blocked users from messaging — this is the only place that
        // check can happen before an unlock (and its fee) goes through.
        if (await isBlockedByCounterpart(playerId)) {
          fail('This player is not accepting new contact requests.');
          return undefined;
        }

        // ── 2. Subscription gate ────────────────────────────────────────────
        const subscription = await getSubscription(publicKey);
        const now = Date.now() / 1000;
        if (!subscription || subscription.expiresAt < now) {
          fail(
            'An active subscription is required to contact players. Please subscribe or renew.',
          );
          return undefined;
        }

        // ── 3. Balance gate ─────────────────────────────────────────────────
        const balance = parseFloat(xlmBalance ?? '0');
        if (balance < PLATFORM_CONTACT_FEE_XLM) {
          fail(
            `Insufficient XLM. You need at least ${PLATFORM_CONTACT_FEE_XLM} XLM to contact this player.`,
          );
          return undefined;
        }

        // ── 4. Sign, submit, then release from the vault ──────────────────────
        // The chain's return value is untrusted public output (issue #1301:
        // anyone can simulate pay_to_contact for free) — release the real
        // plaintext from the server vault, which checks payment proof.
        const chainDetails = await payToContact(publicKey, playerId, signOnly);
        await refreshBalance();
        let details: ContactDetails | undefined;
        const fetchRelease = opts.fetchRelease ?? defaultFetchContactRelease;
        const release = await fetchRelease(playerId);
        if (release.details && release.status === 200) {
          details = release.details;
        } else if (release.status === 404) {
          // No vault row yet (player hasn't uploaded) — transitional
          // fallback to the legacy chain return value. The release
          // endpoint answers 404 for both "no row" and "no payment proof"
          // so unpaid scouts can't probe which players uploaded; here the
          // scout just paid on-chain, so falling back leaks nothing extra.
          details = chainDetails;
        } else {
          throw new Error(`Contact release failed (status ${release.status})`);
        }
        if (!details) {
          fail('Contact details are not available for this player yet.');
          return undefined;
        }
        await cacheContactDetails(
          contactDetailsKey(playerId, publicKey),
          details,
        );
        return details;
      } catch (e: any) {
        fail(parseContractError(e));
        throw e;
      } finally {
        setLoading(false);
      }
    });
  }, [
    opts.fetchRelease,
    submitGuarded,
    publicKey,
    playerId,
    xlmBalance,
    signOnly,
    refreshBalance,
    show,
  ]);

  /** Purges this player's cached contact details immediately. */
  const clear = useCallback(() => {
    if (!key) return;
    purgeContactDetails(key);
  }, [key]);

  return { unlock, contactDetails, loading, error, clear };
}
