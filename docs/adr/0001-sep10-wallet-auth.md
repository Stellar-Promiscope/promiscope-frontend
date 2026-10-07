# ADR 0001: SEP-10 Wallet Authentication

- **Date:** 2024-06-15
- **Status:** Accepted
- **Deciders:** Promiscope engineering team
- **Last revised:** 2024-06-15

## Context

The app requires authenticated sessions for scouts, players, validators, and
admins. Users already have a Stellar wallet (Freighter, Albedo, Lobstr, or
Ledger) for on-chain interactions — player registration, milestone approval,
subscription payments, and pay-to-contact. Adding a separate username/password
system would require:

- Password hashing, storage, and rotation infrastructure.
- Email or phone verification for account recovery.
- A separate session/JWT management layer.

The user's Stellar public key is their natural identity: it's used as the
primary key for on-chain contract calls, admin authorization checks
(`NEXT_PUBLIC_ADMIN_ADDRESS`), and pay-to-contact flows. Any auth system
should prove ownership of that key without introducing a parallel identity
system.

Alternatives considered:

1. **Raw wallet signing** — Ask the user to sign an arbitrary message and
   verify the signature server-side. No standard for challenge format; each
   wallet extension has a different signing API.
2. **OAuth / social login** — Requires third-party provider, email, and adds
   a non-Stellar identity that must be mapped to a Stellar key.
3. **JWT with API key** — Separate credential; no proof of wallet ownership.

## Decision

Use SEP-10 (Stellar Ecosystem Proposal 10 — Web Auth) to authenticate users.
The flow is:

1. Client requests a challenge transaction: `GET /api/auth/sep10?account=<pk>`
2. User signs the challenge XDR with their wallet extension.
3. Client posts the signed XDR: `POST /api/auth/sep10`
4. Server verifies the signature via `@stellar/stellar-sdk`'s `WebAuth` class.
5. On success, an httpOnly `SameSite=Strict` cookie named `session` is set
   containing the Stellar public key.

The session cookie is read by API routes via `getSessionWallet(req)` from
`lib/session.ts` and by the frontend via `GET /api/auth/session`. Origin
validation uses a server-side allow-list (`SEP10_ALLOWED_ORIGINS` environment
variable) — never from request `Host` or `X-Forwarded-Proto` headers — to
prevent self-referential origin bypass attacks (issue #659).

Key implementation files:

- `app/api/auth/sep10/route.ts` — GET (challenge), POST (verify), DELETE (logout)
- `context/WalletContext.tsx` — Client-side connect/disconnect/session-restore
- `lib/session.ts` — Cookie reader utility
- `app/api/auth/session/route.ts` — Session status endpoint (rate-limited)

## Consequences

**Positive:**

- The Stellar public key is the user's identity end-to-end — no mapping layer.
- Sessions are XSS-proof (httpOnly cookie) and CSRF-proof (SameSite=Strict).
- No password infrastructure to maintain, rotate, or audit.
- Users authenticate with the same wallet they use for on-chain actions.

**Negative:**

- Users must install a Stellar wallet extension (Freighter, etc.), adding
  setup friction for non-crypto-native users.
- SEP-10 depends on the Stellar network being reachable; offline access to
  authenticated routes is not possible.

**Neutral:**

- Wallet extensions evolve independently; the abstraction in
  `WalletContext.tsx` isolates the app from individual wallet API changes.
- If Lobstr or Ledger support is added, it slots into the existing adapter
  pattern without changing the auth protocol.
