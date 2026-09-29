# Contact details: encrypted vault + payment-gated release (issue #1301)

> **Finding: contact details are publicly readable today, so the
> pay-to-contact gate is cosmetic until the contract stops returning PII.**
> `lib/contract.ts#payToContact` returns `ContactDetails`
> (`{email, phone, telegram}`) as the transaction's on-chain return value.
> Soroban return values cost nothing to observe: any account can
> `simulateTransaction(pay_to_contact)` for free, and contract instance
> storage is world-readable via `getLedgerEntries`. Either path yields the
> same plaintext without paying. Client-side hardening
> (`lib/contactDetailsCache.ts`: SWR in-memory only, `contact:*` key,
> 15-minute TTL, purge on modal-close/disconnect) limits _browser_ lingering
> but does nothing against chain reads.

## The fix: off-chain vault + indexer-gated release

Plaintext must never come from the chain. The new flow:

1. **Upload (player, authenticated):** the settings panel
   (`components/player/ContactDetailsPanel.tsx`) posts
   `{playerId, email?, phone?, telegram?}` to `POST /api/contact/vault`.
   The session wallet must equal the player id (the player id doubles as
   the player's wallet). The server seals the JSON with AES-256-GCM
   (`lib/contactVaultCrypto.ts`, `CONTACT_VAULT_KEY`) and stores ONLY
   `{iv, ciphertext}` in SQLite (`lib/contactVaultStore.ts`,
   `contact-vault.db`). The client is `lib/contactVaultClient.ts`.
2. **Pay (scout, on-chain, unchanged UX):** `pay_to_contact` still collects
   the fee and emits `player_contacted{scout, player_id}`. Its return value
   is now treated as **untrusted public output** and ignored.
3. **Release (scout, authenticated):** `GET /api/contact/:playerId` checks
   (a) session wallet, then (b) payment proof via
   `lib/contactAccess.ts#hasPaidForContact` (a `player_contacted` event with
   `scout === caller` for that player in the indexer). Only then does it
   unseal in memory and return plaintext over TLS with
   `private, no-store` (`lib/httpResponses.ts#privateJson`).
4. **Client:** `hooks/usePayToContact.unlock()` pays, then releases via
   `lib/contactReleaseClient.ts`, then seeds the existing memory-only SWR
   cache. `ContactModal` is unchanged.

### No read-your-own-plaintext

`GET /api/contact/vault` returns only `{hasContactDetails, updatedAt}` —
never the stored values, not even to the owner. Two reasons:

- It keeps the API's plaintext surface identical for owner and non-owner
  (both get metadata or 403), so there is no endpoint at all that a leaked
  session cookie can be pointed at to dump PII.
- A prefilled form would defeat the paywall. Each scout's unlock is gated
  on their own payment; if the owner's browser held a rendered copy, anyone
  who later sat down at that machine (or read the DOM) would get an
  "unlocked" address without paying.

The form is therefore a **blind write**: saving replaces all three fields
wholesale, and clearing a field before saving is how you remove a channel.
Inputs live in component state only, are wiped on save and unmount, and are
never written to `localStorage`/`sessionStorage` — the same rule
`lib/contactDetailsCache.ts` enforces on the scout's read side.

## Anti-oracle rule

The release endpoint returns **404 with the same body**
(`Contact details not available`) whether the vault row is missing OR the
payment proof is missing. A 403 would tell an unpaid scout "this row
exists, you just can't have it". Indexer outage is a distinct 503
(retryable) — never a 404 denial. Ownership errors on the _vault_ route are
403, because the player is managing their own row, not probing someone
else's.

## Migration

1. **Deploy the backend first.** The vault and release routes work
   alongside the legacy chain return value; the hook falls back to it only
   when the release endpoint answers 404.
2. **Roll out the settings panel and have players publish their details.**
   Until a player saves a row, the release endpoint 404s and their unlock
   takes the legacy fallback. This is the step that actually closes the
   gate — a deployed-but-unused vault is not a fix. Announce it in-app and
   nudge players who have unlocked activity; the panel lives under
   Settings → Contact details.
3. **Rotate anything already exposed.** Old on-chain PII is
   **unrecoverable**: anyone could already have simulated
   `pay_to_contact` for free, so any address/number that was ever stored
   on-chain should be considered public. Advise affected players to rotate
   exposed addresses and numbers when they re-save.
4. **Coordinate the contract change (other repo).** Until this lands, the
   chain still returns plaintext and a determined reader can still get it
   for free — the vault is the fix for the _product_, the contract change
   is the fix for the _chain_. `pay_to_contact` must stop returning
   `ContactDetails` (return a receipt/void) and store no contact bytes.
   After that, delete the hook's 404 fallback
   (`hooks/usePayToContact.ts`) and the mock-RPC plaintext
   (`docker/mock-rpc/server.js#pay_to_contact`,
   `e2e/fixtures/mock-contract.ts`).
5. **`CONTACT_VAULT_KEY` rotation:** generate (`openssl rand -hex 32`),
   decrypt each row with the old key, re-encrypt with the new key, swap
   env. There is no re-key endpoint — rotation is an offline maintenance
   script over `contact-vault.db`.

## Key handling

- `CONTACT_VAULT_KEY`: 32 bytes, hex (64 chars) or base64, server env only
  (see `.env.example`). Never shipped to the client bundle.
- No per-scout keys: the player is offline at pay time, so per-scout
  encryption is impossible without interaction. One platform data key keeps
  rotation to a single re-encryption pass.
- Tampered rows fail closed: AES-GCM auth failure throws, the route
  returns 500, and no partial plaintext is ever returned (tested).
- Add `CONTACT_VAULT_KEY` to the admin config-status checklist so a missing
  key surfaces as a visible misconfiguration rather than a 500 at request
  time.

## Tests

- `__tests__/api/contact/security.test.ts` — the two invariants: the raw
  SQLite bytes on disk (main file **and** `-wal`) contain no contact
  fragment, and every unauthenticated / unpaid / wrong-player / indexer-down
  request returns 404, 401, or 503 with zero PII. The only 200-with-plaintext
  case is a scout with a matching `player_contacted` proof.
- `__tests__/api/contact/route.test.ts` — vault crypto, the indistinguishable
  404s, tamper-fails-closed, ownership on POST/GET/DELETE.
- `__tests__/components/player/ContactDetailsPanel.test.tsx` — the player
  write path, including that nothing lands in browser storage.
- `__tests__/lib/contactVaultClient.test.ts` — request shapes and error
  propagation.
