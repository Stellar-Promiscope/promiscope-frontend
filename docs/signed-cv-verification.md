# Signed CV verification

Player CV exports are signed snapshots of on-chain player data. The browser
never receives the platform private key.

## Scheme

1. The client creates a deterministic JSON payload containing the player ID,
   wallet, on-chain vitals, stats, progress level, and sorted milestone fields.
   Object keys are recursively sorted and the JSON is hashed with SHA-256.
2. `POST /api/cv/sign` rate-limits the caller, re-reads the player and
   milestone history from Soroban, and rejects the request if its hash differs
   from the current chain state. It also resolves each milestone to the
   approval ledger sequence from the indexer.
3. The server signs `{ playerId, contentHash, exportedAt, ledger }` with the
   Ed25519 key in `CV_SIGNING_SECRET`. The token is a compact
   `base64url(payload).base64url(signature)` value.
4. The PDF stores the token in Subject and Keywords and prints a short token,
   verification URL, and QR code in its footer.
5. `/{locale}/verify/{token}` verifies the Ed25519 signature, re-fetches the
   current on-chain data, and recomputes the hash.

## Results

- **Matches chain**: the signature is valid and the current chain hash matches.
- **Signed but outdated**: the signature is valid and the original milestones
  are still present, but new milestones have since been approved.
- **Invalid**: the token was altered, the signed data was removed or changed,
  or the signature cannot be checked.

Set both Ed25519 PEM variables in production. `CV_SIGNING_PUBLIC_KEY` may be
left blank when the public key should be derived from the private key at
runtime. The indexer must be available when exporting a CV with milestones so
each signed milestone has a ledger reference.