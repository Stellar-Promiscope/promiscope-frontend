'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import { usePayToContact } from '@/hooks/usePayToContact';
import { useContactFeeQuote } from '@/hooks/useContactFeeQuote';
import {
  computeSendMax,
  DEFAULT_SLIPPAGE_BPS,
  SLIPPAGE_OPTIONS_BPS,
} from '@/lib/pathPayment';

interface ContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  playerId: string;
  /**
   * The XLM contact fee. When set and details aren't unlocked yet, the modal
   * offers paying it in USDC via a path payment (issue #1321).
   */
  feeXlm?: number;
}

function trimAmount(amount: string): string {
  return parseFloat(amount).toFixed(2);
}

/** "Pay with USDC" step: live quote, slippage limit, expiry, pending-swap recovery. */
function UsdcPaymentPanel({
  playerId,
  feeXlm,
}: {
  playerId: string;
  feeXlm: number;
}) {
  const { unlock, unlockWithAsset, pendingSwap, loading, error } =
    usePayToContact(playerId);
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULT_SLIPPAGE_BPS);
  const {
    quote,
    error: quoteError,
    loading: quoteLoading,
    refresh,
    secondsLeft,
    expired,
  } = useContactFeeQuote(feeXlm, !pendingSwap);

  if (pendingSwap) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-400">
          A previous attempt already converted your payment into{' '}
          {pendingSwap.xlmAmount} XLM. Retry the contact payment without
          converting again.
        </p>
        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => unlock().catch(() => undefined)}
          disabled={loading}
          className="w-full rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
        >
          {loading ? 'Processing…' : `Retry payment (${feeXlm} XLM)`}
        </button>
      </div>
    );
  }

  const sendMax = quote
    ? computeSendMax(quote.sourceAmount, slippageBps)
    : null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-400">
        No XLM? Pay the contact fee in USDC. It is converted to XLM in a
        separate transaction first, then the contact payment is sent.
      </p>
      {quoteLoading && (
        <p className="text-sm text-gray-400">Getting a quote…</p>
      )}
      {quoteError && (
        <p className="text-sm text-red-400" role="alert">
          {quoteError}
        </p>
      )}
      {quote && sendMax && (
        <div className="space-y-1 text-sm">
          <p className="font-medium" data-testid="usdc-quote">
            Pay ~{trimAmount(quote.sourceAmount)} USDC (converted to {feeXlm}{' '}
            XLM)
          </p>
          <p className="text-gray-400">
            At most {sendMax} USDC with {slippageBps / 100}% slippage.{' '}
            {expired ? 'Quote expired.' : `Quote valid for ${secondsLeft}s.`}
          </p>
        </div>
      )}
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="usdc-slippage" className="text-gray-400">
          Max slippage
        </label>
        <select
          id="usdc-slippage"
          value={slippageBps}
          onChange={(e) => setSlippageBps(Number(e.target.value))}
          className="rounded border border-gray-700 bg-gray-900 px-2 py-1"
        >
          {SLIPPAGE_OPTIONS_BPS.map((bps) => (
            <option key={bps} value={bps}>
              {bps / 100}%
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={refresh}
          disabled={quoteLoading}
          className="ml-auto text-xs text-blue-500 hover:underline disabled:opacity-50"
        >
          Refresh quote
        </button>
      </div>
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() =>
          quote &&
          unlockWithAsset({ quote, slippageBps }).catch(() => undefined)
        }
        disabled={!quote || expired || loading}
        className="w-full rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
      >
        {loading ? 'Processing…' : 'Pay with USDC'}
      </button>
    </div>
  );
}

/**
 * Displays contact details already unlocked via usePayToContact's unlock()
 * — this component never triggers unlock() itself, so rendering it never
 * causes a second pay_to_contact charge. It reads the same session-bounded
 * cache entry (see lib/contactDetailsCache.ts) that the caller's unlock()
 * populated, keyed by (playerId, scout wallet).
 *
 * Closing the modal immediately purges the cached details — a player's
 * unlocked PII shouldn't keep sitting in memory just because a scout closed
 * the dialog without navigating away or logging out.
 */
export default function ContactModal({
  isOpen,
  onClose,
  playerId,
  feeXlm,
}: ContactModalProps) {
  const { contactDetails, loading, clear } = usePayToContact(playerId);

  function handleClose() {
    clear();
    onClose();
  }

  const handleCopy = (value: string) => {
    navigator.clipboard.writeText(value);
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
      <div className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">Player Contact Details</h2>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Spinner size="sm" />
            Confirming pay-to-contact transaction…
          </div>
        )}

        {!loading && !contactDetails && (
          <p className="text-sm text-gray-400">
            No contact details unlocked for this player yet.
          </p>
        )}

        {!contactDetails && feeXlm !== undefined && (
          <UsdcPaymentPanel playerId={playerId} feeXlm={feeXlm} />
        )}

        {contactDetails && (
          <div className="space-y-3">
            {contactDetails.email && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">
                  Email: {contactDetails.email}
                </span>
                <button
                  disabled={loading}
                  onClick={() => handleCopy(contactDetails.email!)}
                  className="text-xs text-blue-500 hover:underline ml-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Copy
                </button>
              </div>
            )}
            {contactDetails.phone && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">
                  Phone: {contactDetails.phone}
                </span>
                <button
                  disabled={loading}
                  onClick={() => handleCopy(contactDetails.phone!)}
                  className="text-xs text-blue-500 hover:underline ml-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Copy
                </button>
              </div>
            )}
            {contactDetails.telegram && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">
                  Telegram: {contactDetails.telegram}
                </span>
                <button
                  disabled={loading}
                  onClick={() => handleCopy(contactDetails.telegram!)}
                  className="text-xs text-blue-500 hover:underline ml-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Copy
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
