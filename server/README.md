# scout-off backend

The off-chain data API depicted in the root README's architecture diagram
("Node.js API — Off-chain data & chat history"). This is where non-blockchain
state lives — data that doesn't belong on-chain (referral codes today; chat
history and player/scout comments next) and shouldn't be stored as ad-hoc
files or stubs inside the Next.js app.

Frontend calls hit this service through the shared `api` axios instance in
`lib/api.ts` (`NEXT_PUBLIC_API_URL`). The chat client in
`lib/messaging/chatApi.ts` reuses that same instance.

## Planned: messaging API (canonical contract)

`lib/messaging/chatApi.ts` is the single chat client; the backend chat
implementation should target exactly these endpoints. The sender of a message
is **always** derived from the authenticated session on the server — clients
never send a `sender`/`senderId`, and the server must ignore one if present.

| Method | Path                    | Body       | Response        |
| ------ | ----------------------- | ---------- | --------------- |
| GET    | `/threads/:id/messages` | —          | `ChatMessage[]` |
| POST   | `/threads/:id/messages` | `{ body }` | `ChatMessage`   |
| POST   | `/threads/:id/read`     | —          | `204`           |

`ChatMessage` is `{ id, threadId, senderId, body, createdAt, status }`, where
`status` is `'sent' | 'delivered' | 'read'` and `senderId` is server-set.
The legacy `/chat/:roomId` routes are retired and must not be implemented.

## Stack

- Express for HTTP routing
- SQLite (via `better-sqlite3`) for storage — a real, transactional,
  file-backed database instead of hand-rolled JSON-file persistence
- Plain Node.js, no build step — run directly with `node`

## Running locally

```bash
cd server
npm install
cp .env.example .env   # adjust PORT / CORS_ORIGINS / DB_PATH if needed
npm start              # or `npm run dev` for auto-restart on file changes
```

The server listens on `PORT` (default `4000`) and creates its SQLite
database file at `DB_PATH` (default `server/data/scout-off.db`) on first
run — the `data/` directory is gitignored, same as the frontend's `.data/`.

Point the frontend at it by setting `NEXT_PUBLIC_API_URL=http://localhost:4000`
in the frontend's `.env.local` (see the root `DEVELOPMENT.md`).

## HTTP hardening

Every response carries `helmet`'s security headers (CSP is off, since this is
a JSON API) and no `X-Powered-By`. The rest is configured through env vars
(see `.env.example`):

| Variable                                                               | Default                 | Purpose                                                                                                                                    |
| ---------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `CORS_ORIGINS`                                                         | `http://localhost:3000` | Comma-separated origin allow-list. `CORS_ORIGIN` (a single origin) is still read for backward compatibility.                               |
| `CORS_ORIGIN_PATTERN`                                                  | none                    | Regex for extra allowed origins, such as Vercel preview deployments.                                                                       |
| `TRUST_PROXY_HOPS`                                                     | `0`                     | Number of reverse proxies in front of the server, so `req.ip` is the client's address.                                                     |
| `JSON_BODY_LIMIT`                                                      | `100kb`                 | Max JSON body size. Larger bodies get `413 {"error":"Request body too large"}`.                                                            |
| `RATE_LIMIT_WINDOW_MS`                                                 | `60000`                 | Rate-limit window.                                                                                                                         |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WRITE_MAX` / `RATE_LIMIT_TURNSTILE_MAX` | `300` / `30` / `10`     | Per-IP limits for all requests, for write methods (POST/PUT/PATCH/DELETE) and for Turnstile-protected routes. Exceeding one returns `429`. |
| `REDIS_URL`                                                            | none                    | When set, rate-limit counters are shared through Redis instead of kept in process memory.                                                  |
| `REQUEST_TIMEOUT_MS`                                                   | `30000`                 | `server.requestTimeout`: how long a client may take to send a full request.                                                                |

## Running tests

```bash
npm test
```

Uses Node's built-in test runner (`node --test`) against an ephemeral
in-process server and a temp-file SQLite database — no external services
required, nothing touches `server/data/`.

## API

| Method | Path                             | Body / Params                      | Description                                               |
| ------ | -------------------------------- | ---------------------------------- | --------------------------------------------------------- |
| GET    | `/health`                        | —                                  | Liveness check                                            |
| POST   | `/referrals/generate`            | `{ scoutWallet }`                  | Generate a new referral code owned by `scoutWallet`       |
| GET    | `/referrals/scout/:wallet`       | —                                  | List all codes generated by `wallet`                      |
| GET    | `/referrals/count/:wallet`       | —                                  | `{ totalCodes, successfulReferrals }` for `wallet`        |
| POST   | `/referrals/redeem`              | `{ code, usedBy }`                 | Redeem `code` on behalf of `usedBy`                       |
| POST   | `/academies`                     | `{ name, ownerWallet, createdBy }` | Create an academy; owner becomes its first member         |
| GET    | `/academies`                     | —                                  | List all academies with their members                     |
| GET    | `/academies/wallet/:wallet`      | —                                  | Look up the academy (if any) a wallet is registered under |
| POST   | `/academies/:id/members`         | `{ wallet, addedBy }`              | Register an additional signer wallet under an academy     |
| DELETE | `/academies/:id/members/:wallet` | —                                  | Remove a signer wallet's academy membership               |

The `/academies` endpoints are an off-chain grouping layer only — see
`docs/academy-validator-model.md` in the frontend app for how this relates
to on-chain validator authorization (short version: it doesn't grant any;
each member wallet must still be added as a validator on-chain separately).

Errors are returned as `{ error: string }` with an appropriate HTTP status
(`400` for invalid input, `404` for an invalid/already-redeemed code, `500`
for unexpected failures).

## Adding the next off-chain feature

This is the pattern future off-chain data (chat history, comments — see the
root README diagram) should follow rather than reinventing bespoke storage:

1. Add a table (and any indexes) to `src/db.js`.
2. Add a `src/<feature>Service.js` module with the business logic, built on
   prepared statements against `better-sqlite3`.
3. Add a `src/routes/<feature>.js` Express router and mount it in `src/app.js`.
4. Add typed helpers to the frontend's `lib/api.ts` using the shared `api`
   axios instance — no local Next.js API routes reading/writing files.

## Known limitations / follow-ups

- **Auth**: endpoints currently trust the wallet identity the frontend
  supplies (`scoutWallet` / `usedBy` in the request body), the same trust
  model already used by the existing chat helpers (`sender` is a plain
  parameter, not a verified session). A hardening pass to forward and verify
  the SEP-10-authenticated identity is a reasonable follow-up but is out of
  scope for this persistence migration.
- **Self-redemption**: this service intentionally mirrors the file-based
  store's current redemption behavior 1:1, including the lack of a
  self-redemption guard — that fix is tracked and implemented independently
  against `lib/referralStore.ts` (issue #676). Apply the equivalent guard
  here once that lands.
- **Rate limiting**: not yet wired into this service; the frontend's
  Next.js-route rate limiting (issue #677) doesn't carry over automatically
  now that requests go directly to this service. Worth adding here directly
  in a follow-up (e.g. `express-rate-limit`).
