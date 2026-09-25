# End-to-End Local Development Setup

This guide walks you from a freshly cloned repository to a fully running local stack: Stellar testnet contracts, backend API, Next.js frontend, and wallet connection. It assumes no prior project context. Target time: under 30 minutes.

---

## Docker Compose Quick Start (recommended for first-time contributors)

The full manual setup below (Stellar CLI, a live testnet contract deploy, a real backend API, Pinata credentials) is the most accurate way to develop against real infrastructure, but it's a lot to provision just to make a small frontend change. `docker-compose.yml` brings up a complete local stack — the frontend, the indexer, and mocked local versions of the Soroban RPC and backend API — with a single command and **no external credentials**.

```bash
docker compose up --build
```

Then open **http://localhost:3000**.

This starts four containers:

| Service    | Port | What it is                                                                        |
| ---------- | ---- | --------------------------------------------------------------------------------- |
| `frontend` | 3000 | This Next.js app, built and served in production mode against the mocks below     |
| `indexer`  | 3001 | `packages/indexer`'s HTTP server (`/health`, `/metrics`)                          |
| `mock-rpc` | 8000 | A local mock of the Soroban RPC endpoints `lib/stellar.ts`/`lib/contract.ts` call |
| `mock-api` | 4000 | A local mock of the backend REST API `lib/api.ts` calls (`NEXT_PUBLIC_API_URL`)   |

**What works out of the box:** browsing player profiles and lists, milestone history, validator lists, contract health/paused banners, scout dashboards and profiles, and full write flows (register a player, approve a milestone, subscribe, pay-to-contact) — `mock-rpc` decodes the real transaction XDR your wallet builds and returns a canned-but-valid response, including simulate → sign (with Freighter, pointed at a custom network matching `mock-rpc`'s passphrase) → submit → confirm.

**Known limitations of the mocks** (see `docker/mock-rpc/server.js` and `docker/mock-api/server.js` for exactly what's implemented):

- `mock-rpc` doesn't execute real contract logic or persist ledger state across restarts — it returns fixed/generated data keyed off which contract method was called, not the actual on-chain rules (e.g. it won't really enforce "only the admin can withdraw fees").
- `mock-api` responses are static fixtures; nothing you write through it is actually persisted.
- This compose stack builds and serves the frontend with `next build && next start` (production mode), not `next dev` — there's no hot-reloading. If you're actively editing frontend code, run `docker compose up mock-rpc mock-api` for just the mocks, then `npm run dev` locally with `.env.local` pointed at `http://localhost:8000` / `http://localhost:4000`; that gives you the credential-free mocks with normal hot-reload.

For anything that depends on real contract behavior or a real backend (integration testing before a release, verifying an actual Soroban migration), fall back to the manual setup below.

---

## Prerequisites

| Tool                         | Version / Requirement                                            | Check                            |
| ---------------------------- | ---------------------------------------------------------------- | -------------------------------- |
| **Node.js**                  | 24.x (matches CI — use `nvm use` if you have nvm)                | `node --version`                 |
| **npm**                      | 10.x or later (bundled with Node)                                | `npm --version`                  |
| **Rust** (stable)            | 1.70+                                                            | `rustc --version`                |
| **wasm32 target**            | `wasm32-unknown-unknown`                                         | `rustup target list --installed` |
| **Stellar CLI**              | Latest (`stellar --version` ≥ 22.0)                              | `stellar --version`              |
| **Freighter** (browser ext.) | [Freighter Wallet](https://www.freighter.app/) in Chrome/Firefox | Check extensions list            |
| **Git**                      | Any recent version                                               | `git --version`                  |

### Install missing prerequisites

```bash
# Rust + wasm32 target
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Stellar CLI (macOS/Linux)
cargo install stellar-cli --locked

# Stellar CLI (Windows)
# Download from https://github.com/stellar/stellar-cli/releases

# Freighter browser extension
# Install from https://www.freighter.app/
```

---

## Step-by-Step Setup

### 1. Clone repositories

The contracts live in a separate `scout-off-contracts` repository, expected as a sibling directory.

```bash
git clone https://github.com/scout-off/scout-off-frontend.git
git clone https://github.com/scout-off/scout-off-contracts.git
```

Your directory layout should be:

```
projects/
├── scout-off-frontend/
└── scout-off-contracts/
```

### 2. Install frontend dependencies

The project pins its Node.js version in `.nvmrc` (currently `24`). If you use [nvm](https://github.com/nvm-sh/nvm), run `nvm use` in the project root to switch to the pinned version automatically. If you don't have that version installed yet, run `nvm install` instead — it will read `.nvmrc` and install the correct version for you.

```bash
cd scout-off-frontend
# Switch to (or install) the pinned Node version from .nvmrc:
nvm use        # or: nvm install
npm install
```

This also installs Husky pre-commit hooks via the `prepare` script. If hooks are missing, run:

```bash
npm run prepare
```

### 3. Set up environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in the required values. At minimum you need these for local dev:

| Variable                    | Value                                       |
| --------------------------- | ------------------------------------------- |
| `NEXT_PUBLIC_NETWORK`       | `testnet`                                   |
| `NEXT_PUBLIC_HORIZON_URL`   | `https://horizon-testnet.stellar.org`       |
| `NEXT_PUBLIC_SOROBAN_RPC`   | `https://soroban-testnet.stellar.org`       |
| `NEXT_PUBLIC_API_URL`       | `http://localhost:4000`                     |
| `NEXT_PUBLIC_CONTRACT_ID`   | _Leave blank for now; fill in after step 6_ |
| `NEXT_PUBLIC_ADMIN_ADDRESS` | Your testnet wallet public key              |
| `PINATA_API_KEY`            | _Optional for local dev (IPFS uploads)_     |
| `PINATA_SECRET`             | _Optional for local dev (IPFS uploads)_     |
| `STELLAR_SECRET_KEY`        | Your testnet wallet secret key              |
| `NEXT_PUBLIC_APP_URL`       | `http://localhost:3000`                     |

Validate that all expected variables are declared:

```bash
node scripts/validate-env.js
```

Expected output: `✓ All N env vars declared in .env.example`

**SEP-10 origin allow-list:** `SEP10_ALLOWED_ORIGINS` can be left blank for local dev — `app/api/auth/sep10/route.ts` falls back to `http://<NEXT_PUBLIC_DOMAIN>` (default `http://localhost:3000`) when `NODE_ENV !== 'production'`. It **must** be set before deploying to any non-local environment: a comma-separated list of full origins allowed to call the SEP-10 POST endpoint, e.g. `SEP10_ALLOWED_ORIGINS=https://scoutoff.app,https://www.scoutoff.app`. In production, if this (and `NEXT_PUBLIC_BASE_URL`, honored as a convenience single-origin entry) are both unset, the route fails closed with `403` rather than trusting the request's own `Host` header.

### 4. Create and fund a Stellar testnet account

If you don't have a testnet keypair yet, generate one with Stellar CLI:

```bash
stellar keys generate --global deployer --network testnet
stellar keys address deployer
```

Copy the public key and fund it via Friendbot:

```
https://friendbot.stellar.org/?addr=<YOUR_PUBLIC_KEY>
```

Or use the CLI:

```bash
curl "https://friendbot.stellar.org/?addr=$(stellar keys address deployer)"
```

This deposits 10,000 testnet XLM into your account.

### 5. Build and deploy smart contracts

```bash
cd ../scout-off-contracts

# Build optimized WASM
cargo build --target wasm32-unknown-unknown --release
stellar contract optimize \
  --wasm target/wasm32-unknown-unknown/release/scout_off.wasm

# Deploy to testnet
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/scout_off.optimized.wasm \
  --source deployer \
  --network testnet
```

The deploy command outputs a **contract ID** (a 56-character string starting with `C`). Copy it.

### 6. Initialize the contract

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source deployer \
  --network testnet \
  -- initialize \
  --admin $(stellar keys address deployer) \
  --platform_token <TOKEN_ADDRESS> \
  --fee_config '{"contact_fee": "1", "subscription_tiers": [...]}'
```

For local development, you can use the native XLM token address: `CB64D3G7SM2RTH6JSGG34GIGZZRLPMURK7HJEID2ZMWHOWF65BV7D2XX`. Adjust `fee_config` per your contract's expected format.

### 7. Update .env.local with the contract ID

Back in the frontend directory, add your deployed contract ID to `.env.local`:

```env
NEXT_PUBLIC_CONTRACT_ID=<your-deployed-contract-id>
```

Run validation again:

```bash
node scripts/validate-env.js
```

### 8. Start the backend API

The frontend expects a backend API at `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`). This lives in `server/` in this same repo — see `server/README.md` for details. Start it in a separate terminal:

```bash
cd server
npm install
cp .env.example .env
npm start              # or `npm run dev` for auto-restart on file changes
```

The frontend will function without it for read-only operations; write operations (player registration, milestone approval, referrals) require the API for off-chain data. Off-chain, non-blockchain state (referral codes today; chat history and player/scout comments next, per the architecture diagram above) lives here — `server/README.md` documents the pattern to follow when adding the next such feature.

If you don't have the backend running, you can still browse the UI and interact with the contract directly via the Stellar SDK calls in the frontend hooks.

### 9. Start the frontend

```bash
cd scout-off-frontend
npm run dev
```

Open **http://localhost:3000** in your browser.

### 10. Connect Freighter wallet

1. Open the Freighter browser extension.
2. Switch the network to **Testnet** in Freighter settings.
3. In the browser, navigate to the app and click **Connect Wallet**.
4. Select **Freighter** and approve the connection.
5. The app will perform SEP-10 authentication — this requests a signature from your wallet.

---

## Common Errors

A reference for the errors new contributors hit most often — the
pages in this section also map to the ISSUES.md backlog. Run `npm test`,
`npm run lint`, and `npm run type-check` after any of the resolutions
below; the broader regression tests are the cheapest way to confirm
nothing else broke while fixing the local symptom.

### Error 1: Missing environment variable (`validate-env` failure)

```
Missing from .env.example: SOME_VAR_NAME
```

This means a `process.env.SOME_VAR_NAME` is referenced in source code (`.ts` / `.tsx` files) but is not declared in `.env.example`.

**Solution:**

- If it's a new variable you need: add it to `.env.example` and `.env.local` with a value.
- If it's a stale reference: search for the variable in the codebase and remove it, or add it to `.env.example`.

Do not skip this check — CI runs it on every PR.

### Error 2: Unfunded testnet account

**Symptom:** Any contract call fails with an error containing:

```
transaction submit failed
op_underfunded
Resource temporarily unavailable
```

Or wallet operations show `"account not found"` / `"insufficient balance"`.

**Solution:**

1. Verify your account exists on testnet: visit `https://horizon-testnet.stellar.org/accounts/<YOUR_PUBLIC_KEY>`.
2. If you get a 404, the account hasn't been created yet — fund it via Friendbot:
   ```
   https://friendbot.stellar.org/?addr=<YOUR_PUBLIC_KEY>
   ```
3. Wait ~5 seconds for the ledger to close, then retry.
4. **Note:** Friendbot has rate limits (1 request per ~30 seconds per account). If you hit the limit, wait and retry.

### Error 3: Wrong network (testnet vs. mainnet mismatch)

**Symptom:** App loads but contract calls return `"contract not found"` or the wallet shows an incorrect balance. The app may display "contract not initialized" even though you deployed it.

This happens when one component of the stack is on the wrong network.

**Checklist:**

1. `.env.local` → `NEXT_PUBLIC_NETWORK=testnet` (not `mainnet`)
2. `.env.local` → `NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org`
3. `.env.local` → `NEXT_PUBLIC_SOROBAN_RPC=https://soroban-testnet.stellar.org`
4. Freighter extension → switch network to **Testnet** in the extension dropdown
5. Contract deployed with `--network testnet` (check with `stellar contract invoke --id <CONTRACT_ID> --network testnet -- health`)

**Fix:** Align all three layers (env config, wallet extension, and contract deployment) to testnet. Restart the dev server after changing env vars:

```bash
# Ctrl+C to stop, then:
npm run dev
```

### Soroban state archival and player TTLs

Soroban persistent ledger entries are protected by a time-to-live (TTL). When
the TTL expires, the entry is archived and ordinary contract simulations can
no longer read it. `lib/contract.ts` detects the RPC `restorePreamble` response
and maps read attempts to `ArchivedEntryError`, so player pages explain that
the owner must sign in to restore the profile instead of showing a misleading
"Player not found" state.

Write helpers simulate before preparing. If the simulation requests a restore,
the helper builds a separate `RestoreFootprint` transaction using the returned
Soroban transaction data and minimum resource fee. The connected wallet signs
that transaction first; after confirmation, the original write is prepared and
submitted normally. This costs a network fee and the restoration fee, so the
frontend only performs it when Soroban says it is necessary.

The operational TTL strategy is deliberately two-tiered:

- The indexer should periodically identify active player records and submit a
   low-frequency `extendFootprintTtl` transaction for those footprints using a
   funded maintenance wallet. Extend only records that have recent profile or
   milestone activity; extending every historical record indefinitely creates a
   recurring XLM cost with no product value.
- The wallet restoration path remains the fallback for long-inactive players.
   It is user-authorized, pays only when a player is actually accessed or
   updated, and does not require the platform to hold player-wallet keys.

The indexer maintenance job must monitor its last successful ledger and XLM
balance. If it is unavailable, archival is expected behavior rather than a
silent data-loss condition: the next owner write can restore the footprint.

---

### Error 4: Husky pre-commit hook fails (`lint-staged` cannot parse a file)

**Symptom:** Running `git commit` prints something like:

```
husky > pre-commit (node v24.x.x)
npx: prettier: not found
× prettier --check failed:
[ERROR] Could not find parser for ".gitignore"
[ERROR] Could not find parser for "public/sw.js.map"
```

**Root cause:** `lint-staged` globs `*.{ts,tsx,js,mjs,json,md,...}` and
passes every staged file to `prettier --check`. Files Prettier doesn't
have a parser for (e.g. `.gitignore`, `.env`, sourcemaps, generated
`public/sw*.js`) need to be excluded via `.prettierignore` or they'd
break every commit even when nothing is wrong with the code.

**Solution:**

1. Open `.prettierignore` and confirm these entries are present:

   ```
   .gitignore
   .env
   .env.local
   .env.*.local
   public/sw.js
   public/sw.js.map
   public/workbox-*.js
   public/workbox-*.js.map
   ```

2. If a new generated file shows up that Prettier can't parse, append
   it to `.prettierignore` rather than disabling the lint-staged step.

3. For `.env`-shaped secrets specifically, never check `.env.local` —
   it's already in `.gitignore`. Only `.env.example` (the committed
   template) should pass through Prettier.

### Error 5: Service worker cache returned a stale page after a hot fix

**Symptom:** A critical fix was merged and deployed, but the browser
still shows the old, broken UI after a normal refresh. The network
panel shows `ServiceWorker` (not `Memory cache`) as the initiator for
`/_next/static/chunks/*` requests.

**Root cause:** Next.js's `next-pwa` plugin keeps serving the
previous build from the service worker's `precache` until the user
explicitly accepts the new version. This is by design — silent
`skipWaiting()` would interrupt in-flight requests on every deploy.

**Solution:**

1. The `ServiceWorkerUpdateBanner` component surfaces a polite prompt
   once `window.workbox`'s `waiting` event fires. Reload via that
   banner's button, **not** a regular refresh.
2. If the banner doesn't appear (e.g. you're on a tab that's been
   idle across the deploy), do a one-time workaround:
   DevTools → Application → Service Workers → **Unregister**, then
   hard-reload (`Ctrl+Shift+R` or `Cmd+Shift+R`).
3. For local development you can opt out of the service worker
   entirely by editing `next.config.js`'s `pwa` block — comment out
   or disable the plugin, restart `npm run dev`, and the public
   bundle will be served from the regular Next.js dev cache. Don't
   ship that config change: it's local-only.

### Error 6: `validate-pr-bodies` CI step fails on a docs-only PR

**Symptom:** The `lint` job fails on a docs-only PR with output like:

```
Validate docs/pr-bodies/ body-file contract
All 0 body file(s) in docs/pr-bodies/ pass the contract.
... but a required header / section is missing, e.g.:
docs/pr-bodies/fix-foo.md: missing <!-- Title: ... -->
```

**Root cause:** Every PR that touches `docs/pr-bodies/*.md` must keep the
file headers (`<!-- Branch: ... -->` + `<!-- Title: ... -->`) and the
required `## Summary` / `## Validation` sections intact — the CI guard
(`scripts/validate-pr-bodies.js`, run from the `lint` job in
`.github/workflows/ci.yml`) verifies this on every PR.

**Solution:**

1. Re-add the missing header / section. The template lives in
   `.github/PULL_REQUEST_TEMPLATE.md` under "PR Body Source" and is
   enforced by `scripts/validate-pr-bodies.js`.
2. Run the script locally before pushing:
   ```
   node scripts/validate-pr-bodies.js
   ```
   Exit code 0 means green; non-zero lists the offending files.
3. If you intentionally need a body file that breaks the convention
   (extremely rare — only for archival of a closed PR), call that out
   in the PR description and bypass via `[skip-docs-validation]` in
   the PR title so the maintainer can drop the guard once.

## Verification Checklist

After following all steps, verify the full stack is working:

```bash
# Env validation
node scripts/validate-env.js

# Frontend builds without errors
npm run dev
# Open http://localhost:3000 — should see landing page

# Contract is reachable
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- health

# Tests pass
npm run test

# Lint passes
npm run lint
```

---

## Referral Links (`?ref=CODE`)

The scout referral program passes a referral code between two independent parts of the app via a plain query string — there's no shared constant or type enforcing this contract, so it's easy to break by accident. This section documents the current, verified behavior end to end.

### Where the code is generated

`components/scout/ReferralPanel.tsx` (rendered inside the scout dashboard) lets a scout generate an invite link:

1. On "Generate Invite Link", it calls `generateReferralCode()` (`lib/api.ts`), which `POST`s to `app/api/referrals/generate/route.ts`.
2. The route requires an authenticated `session` cookie and calls `generateCode()` in `lib/referralStore.ts`, which creates a random code in the form `SCOUT-XXXXXX` and persists `{ code, scoutWallet, createdAt, usedBy: null, usedAt: null }` to a JSON-backed store.
3. `ReferralPanel` builds the shareable URL from the returned code:

   ```tsx
   const inviteUrl = `${baseUrl}/scout/subscribe?ref=${ref.code}`;
   ```

   `baseUrl` is derived from `window.location`, and the URL does **not** include a locale segment (e.g. `/en/...`) even though the app is served under `app/[locale]/...`.

### Where the code must be read and redeemed

`app/[locale]/scout/subscribe/page.tsx` is the sole consumer:

1. It reads the param with `useSearchParams().get('ref')` and shows a banner ("You were referred by a colleague! Your referral will be credited automatically when you subscribe.") whenever `ref` is present — this banner does **not** verify the code is real.
2. On successful subscription (`handleSubscribe`), if a `referralCode` was present it fires `redeemReferralCode(referralCode)` (`lib/api.ts`), which `POST`s to `app/api/referrals/redeem/route.ts`. That route calls `redeemCode(code, sessionCookie)` in `lib/referralStore.ts`, which looks up an unused code with a matching string and, if found, marks it `usedBy`/`usedAt`.

If a future contributor changes or removes the subscribe page's `ref` handling, referral codes will still be generated and shared but will never be redeemed — there is no other call site that consumes this param.

### Behavior on an invalid, expired, or malformed code

As implemented today, redemption failures are silent and have no effect on the subscribe flow:

- **Client:** the redeem call is fire-and-forget — `redeemReferralCode(referralCode).catch(() => {})` — so any failure (network error, invalid code, unauthenticated request) is swallowed with no UI feedback or retry.
- **Server:** `redeem/route.ts` does return `404 { error: 'Invalid or already redeemed code' }` when no matching unused code exists, but since the client discards the response body, this is never surfaced to the user.
- **Expiration:** codes never expire — there is no `expiresAt`/TTL field on a referral code and `redeemCode` never checks age.
- **Malformed input:** there is no format validation (e.g. a `SCOUT-` prefix check); any string is sent as-is, gated only by the "does an unused code with this exact string exist" lookup.
- **Self-referral:** `redeemCode` never compares the redeeming session against the code's `scoutWallet`, so nothing currently prevents a scout from redeeming their own generated code.

Net effect: the "You were referred" banner on `/scout/subscribe` renders based purely on the presence of `?ref=`, regardless of whether the code turns out to be valid — a bogus or already-used `ref` value shows the same "will be credited automatically" message as a real one, and the user is never told redemption failed.

---

## IPFS Media CDN Caching and Access Control

Public player profiles (`app/[locale]/player/[id]`) previously rendered `<img>`/`<video>` sources built directly from `NEXT_PUBLIC_IPFS_GATEWAY` — e.g. `https://gateway.pinata.cloud/ipfs/<cid>`. That meant every viewer hit Pinata directly, the raw gateway URL was visible in page HTML for anyone to hotlink or bulk-scrape, and there was no caching layer this platform controlled.

### How it works now

- `lib/mediaUrl.ts` exports `getMediaProxyUrl(cid)`, a client-safe helper that returns `/api/media/<cid>` — a same-origin path — instead of the raw gateway URL. `PlayerCard` and `IPFSMediaGallery` use this instead of reading `NEXT_PUBLIC_IPFS_GATEWAY` directly.
- `app/api/media/[cid]/route.ts` proxies the request server-side (trying `NEXT_PUBLIC_IPFS_GATEWAY` then the same fallback gateways as `lib/ipfs.ts`) and returns the media with `Cache-Control: public, max-age=31536000, immutable` (and the Vercel-specific `CDN-Cache-Control` header). Since IPFS CIDs are content-addressed, this is safe: the same CID always resolves to the same bytes.
- **Cache invalidation**: an updated profile gets a _new_ CID (see `buildUpdateProfile` in `lib/contract.ts`), which is a new proxy URL — there's nothing to invalidate for the old one, since it's still valid (and still immutable) content.
- **Anti-hotlinking / anti-scraping**: the route rejects requests carrying an explicit cross-site `Referer` header (same-origin and "no Referer" requests are allowed, since a legitimate direct navigation or privacy-stripped Referer can't be distinguished from same-site). It also applies a best-effort per-IP rate limit (120 req/min) to blunt bulk scraping.
- **Signed/expiring URLs**: `lib/mediaUrlSigning.ts` (server-only — never import from client code) exposes `signMediaUrl(cid, ttlSeconds)` / `verifyMediaUrlSignature(...)`, gated behind the `MEDIA_URL_SIGNING_SECRET` env var. When a request carries a valid `sig`/`exp` pair the route allows it regardless of Referer — useful for a future flow that needs a non-guessable, time-limited link (e.g. media unlocked via `pay_to_contact`). When the secret isn't set (the local/default case), the route falls back to referrer + rate-limit gating only, so this never blocks contributors who haven't configured it.

### What's intentionally out of scope here

- This is an origin-level (Next.js Route Handler) cache, not a managed CDN config. In production, put a real CDN (Vercel's Edge Network, or Cloudflare in front of the deployment) in front of this route so `Cache-Control`/`CDN-Cache-Control` actually get honored at the edge across regions/instances — the in-process rate limiter here is single-instance and should be replaced by the CDN's own rate limiting (or Upstash/Redis) before relying on it at scale.
- **Bandwidth/cost measurement**: this repo has no production traffic to measure against yet. Once deployed, compare Pinata's bandwidth/request dashboard before and after this change goes live — a meaningful drop in Pinata-side requests for repeatedly-viewed CIDs is the signal this is working; if the CDN in front of `/api/media` isn't caching (e.g. `x-vercel-cache: MISS` on repeat requests), the edge config needs adjusting, not this route.

---

## Versioned contract event schemas

Contract events are decoded through the shared `@scoutoff/contract-events`
workspace package. `schema/v1.ts` owns the v1 topic symbols and payload
decoders; both `packages/indexer` and `hooks/useContractEvents.ts` call that
package instead of maintaining independent topic heuristics. Indexed rows
store `contract_version` so historical events remain interpretable after a
contract upgrade.

When the contract event ABI changes:

1. Add `schema/v2.ts` with the new topic and `ScVal` payload definitions.
2. Extend the package dispatcher and select v2 using the emission contract
   version or ledger-range configuration. Do not change v1 decoders in place.
3. Capture real testnet topic/value XDR under
   `packages/contract-events/src/__fixtures__` and add golden tests for every
   event type in the new schema.
4. Deploy the indexer with the matching `CONTRACT_VERSION`, then verify the
   `contract_version` column and unknown-event metric before switching the
   frontend's expected version.

Unknown topics and unsupported versions are stored as `type="unknown"` with
their raw XDR payload and counted by `indexer_unknown_events_total`; they must
never stop polling or disappear silently. This preserves evidence for adding a
future decoder and makes schema drift observable.

## Indexer HTTP API (Issue #29)

`packages/indexer/` runs an HTTP server alongside the event poller. Two endpoints are exposed on the port configured by `PORT` (default `3001`):

| Endpoint                      | Format     | Purpose                                                                                                                                                                                                                                            |
| ----------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/health`                     | JSON       | Liveness probe. Returns `{ status, lastLedger, uptime }`. `status` flips to `"degraded"` when the poller hasn't seen a fresh ledger entry in 60s.                                                                                                  |
| `/metrics`                    | Prometheus | Pull-format counter/gauge metrics: `indexer_events_total{type=...}`, `indexer_processed_total`, `indexer_errors_total`, `indexer_error_rate_percent`, `indexer_latency_avg_ms`, `indexer_latency_p95_ms`, `indexer_ledger_lag`, `indexer_healthy`. |
| `/events`                     | JSON       | Query contract events. Supports `?type=...&limit=...&before=...`.                                                                                                                                                                                  |
| `/players/:id/events`         | JSON       | Same shape, scoped to a single player.                                                                                                                                                                                                             |
| `/validators/:address/events` | JSON       | Same shape, scoped to a single validator (filter by `validator` field on the event).                                                                                                                                                               |

### Quick verification

```bash
# Start the indexer (from repo root, against your testnet deploy):
npm run start --workspace=packages/indexer

# In another terminal, hit the endpoints:
curl -s http://localhost:3001/health | jq
curl -s http://localhost:3001/metrics | head -40
```

### Wiring into a metrics dashboard

- **Prometheus:** add `packages/indexer` to your Prometheus scrape config with `scrape_interval: 15s` and a target of `http://<indexer-host>:3001/metrics`. The metric names are stable and the `indexer_healthy` gauge is the canonical "is the indexer alive in production" signal.
- **Grafana:** the labels (`type=...`) on `indexer_events_total` let you chart per-event-type throughput directly. The `indexer_ledger_lag` gauge is the one to alert on — a sustained lag above ~50 means the indexer can't keep up with ledger close times.
- **Uptime monitors:** point them at `/health`. Anything non-200 OR `status: "degraded"` should page.

## Related Documentation

- [README.md](README.md) — project overview, architecture, and smart contract API
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution workflow and branch conventions
- [DEPLOYMENT.md](DEPLOYMENT.md) — production deployment notes (Vercel, analytics)
- [e2e/README.md](e2e/README.md) — Playwright E2E suite and wallet-mocking harness
- [docs/fraud-detection.md](docs/fraud-detection.md) — referral/pay-to-contact abuse heuristics and admin flag review
