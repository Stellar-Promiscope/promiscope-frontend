# ADR 0003: Multi-currency Contact Fee via Path Payments

- **Date:** 2026-09-26
- **Status:** Accepted
- **Deciders:** ScoutOff frontend maintainers (issue #1321)
- **Last revised:** 2026-09-26

## Context

Scouts must pay the `pay_to_contact` fee (and the subscription) in XLM. Many scouts and clubs hold USDC on Stellar instead. `useCurrencyPreference` only changes how prices are _displayed_; the payment itself is always XLM.

We considered three options:

1. **Swap and contract call in one transaction.** A `pathPaymentStrictReceive` (USDC → XLM) followed by the `invokeHostFunction` contract call. Not possible: a Soroban transaction may contain only one operation.
2. **Two sequential transactions.** Swap USDC → XLM into the scout's own account for the exact fee, then make the existing XLM contract call. No contract change needed. If the second step fails, the scout is left holding XLM, which is acceptable because it is their own money in their own account.
3. **Contract-level multi-asset fees.** The contract accepts a Stellar Asset Contract (SAC) token address for fees. This is the cleanest UX (one signature, no swap), but it needs a contract change, an upgrade, and a decision on how the treasury handles non-XLM balances.

## Decision

**Option 2**, implemented in `lib/pathPayment.ts` and `hooks/usePayToContact.ts` (`unlockWithAsset`), with the UI in `components/scout/ContactModal.tsx`.

- **Quote:** Horizon `GET /paths/strict-receive` with `source_assets=USDC:<issuer>`, `destination_asset_type=native`, and `destination_amount=<fee>`. We take the cheapest record. The UI shows "Pay ~12.34 USDC (converted to 50 XLM)".
- **Slippage:** the scout picks 0.5 / 1 / 2 / 5% (default 1%, maximum 5%). `sendMax = quote × (1 + slippage)`, rounded up to the next stroop. The network enforces it, because `pathPaymentStrictReceive` fails rather than spending more than `sendMax`.
- **Quote expiry:** quotes are valid for 60 s. After that the pay button is disabled until the scout refreshes. The swap transaction's time bounds also end when the quote expires, so a swap signed late is rejected on-chain.
- **Destination:** the swap pays the scout's own account, and only the exact fee (strict receive). Funds never leave the scout's control until the normal contract call.
- **Failure handling and recovery:** after a successful swap we record a _pending swap_ (`localStorage`, keyed by wallet + player, 24 h TTL). If the contract call then fails, the scout sees that the conversion already happened, and the modal offers "Retry payment" with plain XLM, with no second swap. The record is cleared when a contact payment succeeds.
- **Balance checks:** before swapping, we check the scout's USDC trustline balance against `sendMax`. The scout still needs a small XLM balance for the account reserve and network fees.

USDC defaults to Circle's issuer for the configured network and can be overridden with `NEXT_PUBLIC_USDC_ISSUER`.

## Consequences

- **Positive:** scouts holding only USDC (plus reserve XLM) can contact players with no contract change. The same helpers can be reused for the subscription fee.
- **Negative:** two signatures instead of one. The price can move between the quote and execution (bounded by slippage). A failed second step leaves XLM in the scout's wallet instead of their original USDC. That's recoverable, but it's a small FX exposure.
- **Neutral / deferred:**
  - **Fee-bump sponsorship:** both transactions are ordinary scout-signed transactions. If we introduce fee-bump sponsorship, the sponsor must wrap _both_ inner transactions, and should decline to sponsor a swap whose contract call it won't also sponsor. Otherwise it could be used to pay for arbitrary DEX trades.
  - **Subscription fee:** not wired up yet. `subscribe` can use `unlockWithAsset`'s pattern.
  - **Option 3** stays the long-term goal if the contract gains SAC fee support. It would replace the swap step entirely.
