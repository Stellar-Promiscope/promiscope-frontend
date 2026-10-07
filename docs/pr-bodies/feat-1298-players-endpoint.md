<!-- Branch: feat/1298-players-endpoint -->
<!-- Title: feat: back scout discovery with paginated indexer /players -->

## Summary

Scout discovery built its player list by simulating the contract's
`filter_players(region, position, min_level)` query (`lib/contract.ts#filterPlayers`, removed here).
That query returns **every** matching player in one unbounded `Vec`, so the simulation's cost grows
with the registry: Soroban's read-only simulation CPU / memory / ledger-entry limits are exceeded
once a few hundred players are registered, and the discovery tab then fails exactly when the
registry is big enough to be worth browsing. The page had no pagination at all either — one full
fetch per filter change, no server-side count, no way to load more.

- **What this PR changes:** the indexer materializes one `players` row per registered player and
  serves it through a new cursor-paginated, filterable `GET /players`; the scout dashboard reads
  that endpoint through a new `useInfinitePlayers` SWR-infinite hook (via the existing same-origin
  `/api/indexer/*` proxy) and renders each page into the existing virtualized grid.
- **Why this is needed:** per-request work becomes bounded (`limit ≤ 50`, default 50), filters
  become indexed SQL lookups instead of a full on-chain scan, and `total` comes from a server-side
  `COUNT(*)` so "N players found" is accurate without loading every page.

The contract's `filter_players` query itself is **unchanged** — it stays available for on-chain
integrations, and the root `README.md` now says the dashboard does not call it (issue #1298).

## Type

`feat` — new indexer endpoint + materialized table, plus a behavior change in the scout dashboard.
No Rust/Cargo contract changes are involved.

## Scope

**Included**

- `packages/indexer`: `players` table + projection inside the existing event transaction
  (`db/eventStore.ts`), `GET /players` (`server.ts`), new `profile_updated` event type
  (`eventPoller.ts`, `metrics/IndexerMetrics.ts`), `scripts/seedPlayers.ts`, and new
  store / perf / HTTP-route suites.
- Frontend: `hooks/useInfinitePlayers.ts` (new), `hooks/useScout.ts`, `hooks/useSavedSearches.ts`,
  `components/scout/VirtualizedPlayerGrid.tsx`, `components/scout/ScoutDashboardContent.tsx`,
  `lib/indexerClient.ts`, `lib/contract.ts`, `app/api/indexer/[...path]/route.ts` (allow-list),
  `app/[locale]/player/[id]/page.tsx`.
- i18n: `messages/en.json`, `messages/fr.json`, `messages/sw.json` (`results_behind`,
  `player_profile.verified_on_chain`).
- Docs: `packages/indexer/README.md` (materialized table, `GET /players`, seeding), root `README.md`.

**Not included / please note**

- There is deliberately **no on-chain fallback**: if the indexer is unreachable the dashboard shows
  its error state rather than silently falling back to the unbounded `filter_players` simulation
  this PR exists to remove.
- `region` / `position` filters are exact-match against the indexed columns (same semantics the
  contract query had); no fuzzy or case-insensitive matching was added.

## Related Issue

References: #1298 (follows #1297)

**Stacked branch — read before reviewing the diff.** This branch is cut from `9092429`, the
`issue-1297` trusted-proxy fix that is still open as PR #1449, because the #1298 work builds on it.
Until #1449 merges, any diff taken against `main` also contains that unrelated commit — 47 files /
3 commits instead of this PR's 2 commits (36 files, +2760 / −225 measured against `9092429`). No
rebase is needed afterwards: `9092429` simply becomes an ancestor of `main` and the diff collapses
to this PR's own two commits and 34-file feature scope.

## Files changed

Diff stat of the feature commit `c4488e1`: **34 files changed, +2568 / −225**.

| Area          | Key files                                                                                                       | Change                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Indexer store | `packages/indexer/src/db/eventStore.ts`                                                                         | `players` table + 4 indexes, event→row projection, `getPlayers()` keyset query with `total`                                          |
| Indexer API   | `packages/indexer/src/server.ts`                                                                                | `GET /players` — `region`, `position`, `minLevel` (0–3), `createdAfter`, `cursor`, `limit`; returns `{ players, nextCursor, total }` |
| Indexer tests | `db/__tests__/playersStore.test.ts`, `db/__tests__/playersPerf.test.ts`, `__tests__/server.test.ts`             | 400-line store suite, perf/large-registry suite, HTTP route + validation suite                                                       |
| Frontend      | `hooks/useInfinitePlayers.ts`, `hooks/useScout.ts`, `components/scout/VirtualizedPlayerGrid.tsx`                | New infinite hook; `useScout` re-pointed at it; grid exposes `loadMore` on scroll-to-end                                             |
| Wiring        | `components/scout/ScoutDashboardContent.tsx`, `hooks/useSavedSearches.ts`, `app/api/indexer/[...path]/route.ts` | Dashboard consumes `players`/`total`/`hasNextPage`/`loadMore`; `/players` + `/health` added to the proxy allow-list                  |
| Docs          | `packages/indexer/README.md`, `README.md`                                                                       | Table schema, projection rules, cursor semantics, seeding + benchmark recipe                                                         |

## Validation

Every command below was run on this branch at `c4488e1`; pre-existing failures were identified by
running the same command against the parent commit `9092429` in a separate `git worktree`.

| Check                     | Command                                   | Result                                                                                                    |
| ------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Lint                      | `npm run lint`                            | ✅ exit 0                                                                                                 |
| Types                     | `npm run type-check`                      | ✅ exit 0, 0 errors                                                                                       |
| Indexer tests             | `npm test --workspace @promiscope/indexer`  | ✅ 174/174 pass                                                                                           |
| Suites touched by this PR | `npx jest --ci` (8 suites)                | ✅ 81/81 pass                                                                                             |
| Full frontend suite       | `npm run test`                            | ⚠️ 3360 passed / 15 failed — every one of the 15 also fails at `9092429` (see below)                      |
| Accessibility (axe) gate  | `npx jest --ci --testPathPattern='a11y'`  | ✅ 87/87 pass (8 suites)                                                                                  |
| Production build          | `npm run build`                           | ✅ compiled; `Generating static pages (101/101)`; same Sentry/PWA warnings as `main`                      |
| Formatting                | `npm run format:check`                    | ⚠️ 9 pre-existing files (10 at `9092429`) — none of them is a file changed by this PR                     |
| Env validation            | `node scripts/validate-env.js`            | ⚠️ exit 1 on pre-existing `.env.example` drift (`VERCEL`, `TRUSTED_PROXY_COUNT`, `HEALTH_MAX_LEDGER_LAG`) |
| Locale key parity         | `node scripts/check-locale-keys.js`       | ✅ en / fr / sw                                                                                           |
| Body-file contract        | `node scripts/validate-pr-bodies.js`      | ✅                                                                                                        |
| E2E (Playwright)          | `npx playwright test e2e/`                | ⏭️ not run locally — needs the app plus a seeded indexer running; the CI e2e job covers it                |
| Contract tests            | `cd ../promiscope-contracts && cargo test` | N/A — no contract code is touched by this PR                                                              |

### Pre-existing failures (verified on the parent commit, not introduced here)

The parent commit `9092429` fails 17 tests / 3358 pass. After this change: 15 fail / 3360 pass — a
**strict subset**, so there are no new failures. The two differing cases are the
`DisputeMilestoneModal` character-counter assertions, which flipped to passing without any change to
that component (they are timing-flaky). All 15 remaining failures reproduce on the parent commit:

- 3 × `authenticated API routes` IPFS upload routes "never builds a JSON response without private caching headers" (`__tests__/lib/httpResponses.test.ts`)
- `BulkPlayerImport › disables import while the contract is paused`
- `PendingMilestoneQueue › populated list › disables Bulk Approve and shows a title when the contract is paused`
- `components/ui/Button` `aria-disabled` vs `disabled` (surfaced through the two suites above)
- 2 × `FeeRevenueChart` (`components/FeeRevenueChart.test.tsx`, `components/admin/FeeRevenueChart.test.tsx`)
- `lib/api – axios instance configuration › sets baseURL from NEXT_PUBLIC_API_URL…`
- `validate-env.js › exits with code 0 when all used env vars are declared in .env.example`
- 5 × `ScoutDashboardContent — screen reader announcements` (the dashboard's spinners and
  `ReferralPanel` also expose `role="status"`, so these tests' unscoped `getByRole('status')` queries
  match more than one node — a pre-existing test-scoping issue, see follow-ups)

## Testing

- **Indexer store** — `packages/indexer/src/db/__tests__/playersStore.test.ts` covers the projection
  rules (registration upsert, tolerant vitals extraction, `profile_updated` merge, milestone
  approve/revoke level arithmetic, skeleton rows), keyset pagination (page boundaries, `nextCursor`
  exhaustion, no skips or duplicates when rows are inserted mid-pagination), every filter
  combination, `total` accuracy under filters, and cursor tampering.
- **Indexer HTTP** — `packages/indexer/src/__tests__/server.test.ts` asserts `GET /players` success
  and each 400 path (`minLevel` out of range, non-positive `limit`, malformed `cursor`, over-long
  `region`/`position`).
- **Indexer perf** — `db/__tests__/playersPerf.test.ts` seeds a large registry and asserts page cost
  stays proportional to page size (the whole point of this change).
- **Frontend** — new `__tests__/hooks/useInfinitePlayers.test.ts` (page accumulation, cursor
  chaining, `hasNextPage` off the last cursor, `loadMore` no-op when exhausted, key reset on filter
  change, `invalidateScoutSearch`) and `__tests__/components/scout/VirtualizedPlayerGrid.test.tsx`
  (`loadMore` firing at scroll end, and **not** firing when exhausted or already loading). Updated
  `useScout.test.ts`, `useSavedSearches.test.ts`, `swrDeduplication.test.ts`, `lib/indexerClient.test.ts`,
  `lib/contract.test.ts`, `api/indexer/route.test.ts`, `components/ScoutDashboard.test.tsx` and
  `ScoutDashboardContent.test.tsx` for the new data source.
- **Manual smoke test** — `npm run seed:players --workspace @promiscope/indexer -- --count 10000`,
  then `time curl 'localhost:3001/players?limit=50&region=West%20Africa'` against a running indexer;
  the dashboard pages through the seeded registry in the virtualized grid with an accurate
  "N players found" count.
- **E2E** — `e2e/scout-virtualization-performance.spec.ts` updated to drive the new load-more flow.

## Checklist

- [x] I followed the repository contribution guidelines in `CONTRIBUTING.md` (`feat/1298-players-endpoint`
      branch naming, Conventional Commits, no `--no-verify`)
- [x] My code is formatted and linted
- [x] New or updated tests are included where applicable (11 suites touched, 7 new or extended)
- [x] All tests pass locally — modulo the 15 pre-existing failures above, all reproduced on the parent commit
- [x] Environment validation passes — the only reported issue is the pre-existing `.env.example` drift above
- [x] No secrets, credentials, or private keys are included
- [x] Documentation is updated if needed (`packages/indexer/README.md`, root `README.md`, this body)

## Notes for Reviewers

- **Endpoint contract** — `GET /players?region&position&minLevel&createdAfter&cursor&limit` returns
  `{ players, nextCursor, total }`. `limit` defaults to 50 and is silently capped at 50 (the same
  silent-cap convention the event endpoints already use for 200). A malformed `cursor` is a 400
  rather than a silent restart at page 0, so a client can't loop forever on a corrupt token.
- **Cursor design** — keyset over `(created_ledger DESC, player_id DESC)` instead of OFFSET. It is a
  total order on the `players` table, so page cost stays proportional to page size and pages never
  skip or duplicate rows when players register mid-pagination. `total` is a separate `COUNT(*)` over
  the same filter predicate — that is what lets the dashboard show an exact "N players found" from
  page 1 without loading the rest.
- **Projection is transactional** — the `players` upsert runs inside the same SQLite transaction as
  the event insert and only for genuinely new events (`event_id` unique index), so a replayed event
  range cannot double-apply a milestone delta.
- **`profile_updated` is a newly indexed event type** — it refreshes `ipfs_hash` and any vitals in the
  payload. Decoding follows the existing `decodeEvent` ASSUMPTION note (no contract source lives in
  this repo), so vitals are read from either a nested `vitals` object or flat fields and unknown
  shapes degrade to NULL columns rather than throwing; NULL vitals simply never match a filter.
- **Filters** are exact-match on the indexed columns (`region`, `position`, `progress_level`) — the
  same semantics the contract query had — and `minLevel` is validated to 0–3.
- **No on-chain fallback** — if the indexer is down the dashboard shows an error state; see "Not
  included" above. Flagging in case you'd prefer a degraded fallback in a follow-up.
- **Follow-ups worth separate issues:** (1) scope the five `ScoutDashboardContent` a11y queries to
  the `#search-results` region; (2) normalize region/position casing at ingestion so user-entered
  values reliably match; (3) migrate the remaining unbounded on-chain reads (`get_validators`,
  milestone history) to the indexer the same way.

## PR Body Source (optional — bulk-deploy workflow)

- Body file: `docs/pr-bodies/feat-1298-players-endpoint.md`
- The PR title must match the header above verbatim; the branch name must be
  `feat/1298-players-endpoint` to satisfy the filename-derived-branch check in
  `scripts/validate-pr-bodies.js`:

  ```bash
  title=$(sed -n 's/<!-- Title: \(.*\) -->/\1/p' \
      docs/pr-bodies/feat-1298-players-endpoint.md | head -n1)
  gh pr create \
    --repo promiscope/promiscope-frontend \
    --base main \
    --head Astrowlrd777:feat/1298-players-endpoint \
    --title "$title" \
    --body-file docs/pr-bodies/feat-1298-players-endpoint.md
  ```

Closes #1298
