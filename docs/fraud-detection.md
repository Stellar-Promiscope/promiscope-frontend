# Fraud / abuse detection: pay-to-contact & referrals

Design notes for the heuristics in `lib/fraudDetection.ts`, surfaced to
admins via `GET /api/admin/fraud-flags` and `components/admin/FraudFlagsPanel.tsx`.

## Scope

Deliberately narrow, per the originating issue: two systems, a handful of
concrete heuristics, no general-purpose fraud engine. If a third system
needs this later, it should get its own heuristics module and its own
review of what "abuse" means there — the patterns below are specific to how
referrals and pay-to-contact/subscriptions can be gamed, not a reusable
"anomaly score."

## Where this runs

Both heuristic sets are pure functions over already-fetched data — no I/O,
easy to unit test. The thing that actually gives them cross-wallet
visibility is what calls them: `app/api/admin/fraud-flags/route.ts` pulls
**every** referral code (`lib/referralStore.getAllCodes`) and the **global**
activity feed (`fetchActivityEvents`, paginated up to a bounded cap), then
runs the heuristics over the whole dataset in one pass. That's the
difference from the rate-limiting already tracked elsewhere in the backlog:
rate limiting looks at one wallet's request rate in isolation; this looks
for patterns _across_ wallets (one redeemer touching many scouts, a scout's
redemptions clustering around one other wallet, etc.) that no single
request could ever reveal.

This used to be computed only on demand — an admin loading the panel
triggering a fresh run, with no scheduled re-evaluation and no persistence
(issue #1007). That left an active abuse pattern able to run unnoticed for
as long as no admin happened to open the panel. Investigation and the
resulting design:

### Scheduling investigation (#1007)

- **No background-job/queue infrastructure exists in this repo.** No cron
  runner, no task queue, no `server/` worker process that polls anything on
  an interval. `hooks/useAdminAuditLog.ts` hit the same gap for
  reconciliation and worked around it with a client-side `setInterval`
  while the audit log is open — not applicable here, since the whole point
  is running _without_ an admin's session open.
- **This is a Next.js app deployed on Vercel** (see `next.config.js`,
  `next-pwa`, `@vercel/analytics`), which supports **Vercel Cron Jobs** —
  a scheduled HTTP GET against an API route, no extra infrastructure to
  stand up. That's the mechanism picked here: `vercel.json`'s `crons` entry
  hits `GET /api/cron/fraud-flags` hourly (`0 * * * *`). Hourly was chosen
  as a starting bound-on-staleness that's frequent enough to catch a
  fast-moving burst (`rapid_contact_burst`'s own window is 10 minutes) well
  within the "bounded time window" goal, without re-running a
  multi-thousand-event scan (`MAX_ACTIVITY_PAGES` in
  `lib/fraudFlagsRunner.ts`) so often that it's wasteful — retune once
  there's real traffic data, same as the heuristic thresholds themselves.
- `app/api/admin/fraud-flags/route.ts`'s work was genuinely read-only and
  side-effect-free, confirmed by `lib/fraudDetection.ts`'s own
  "pure function" design — safe to invoke on a schedule with no additional
  guardrails needed on that front. The gathering/analysis logic was
  extracted into `lib/fraudFlagsRunner.ts`'s `runFraudFlagEvaluation()` so
  both the admin route and the cron route call the exact same code path —
  no duplicated heuristic-calling logic to drift out of sync.
- **Authorization**: a scheduled invocation has no admin session cookie to
  present, so `app/api/cron/fraud-flags/route.ts` does **not** use
  `requireAdminWallet`. It instead checks
  `Authorization: Bearer ${CRON_SECRET}` — the header Vercel Cron
  automatically attaches to its own requests when a `CRON_SECRET` env var
  is configured (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
  The route refuses all requests if `CRON_SECRET` isn't configured, rather
  than falling open.
- **Persistence**: every run (manual or cron) is recorded by
  `lib/fraudFlagsStore.ts` (a `better-sqlite3` table, mirroring
  `lib/adminAuditStore.ts`'s conventions) with a timestamp, trigger
  (`'manual' | 'cron'`), and high-severity count.
  `GET /api/admin/fraud-flags` still runs a fresh evaluation on each admin
  page load (unchanged on-demand behavior) but now also persists that run
  and returns `evaluatedAt`, and `FraudFlagsPanel.tsx` displays "As of
  [time]". `GET /api/admin/fraud-flags/status` is a cheap read of the most
  recently persisted run (whichever of manual/cron ran last) without
  recomputation, used to drive a header-level staleness badge
  (`components/admin/FraudFlagsStalenessBadge.tsx`) that's visible without
  opening the panel at all, and flips to a "stale" style once the last run
  is older than 6 hours.
- **Incremental Evaluation & Checkpointing**: full-window scans over the entire
  event history grew with total history, threatening serverless function timeouts.
  Evaluation is now incremental: `fraudFlagsStore` maintains a `fraud_checkpoint`
  table (recording the last processed ledger sequence) and `fraud_wallet_aggregates`
  (rolling windows and state per wallet). Each run fetches only events after the
  checkpoint, updates aggregates, and evaluates heuristics ONLY for wallets that
  changed.
- **Time Budget & Chunking**: Serverless cron jobs enforce a time budget (default
  45s with a 3s safety margin). The runner processes events in chunks; if the
  budget is nearly exhausted, it saves the current checkpoint and wallet aggregates
  so the next scheduled cron invocation resumes smoothly from the exact ledger.
- **Run Stats & UI**: Every run persists `eventsProcessed` and `durationMs` in
  `fraud_flag_runs`. These stats are surfaced via `GET /api/admin/fraud-flags/status`
  and displayed in `FraudFlagsStalenessBadge.tsx` and `FraudFlagsPanel.tsx`.
- **Equivalence & Backtesting**: Incremental evaluation is provably equivalent to
  full evaluation across the entire backtest fixture (`lib/fraudBacktest.ts`), with
  automated equivalence testing and runtime benchmarks confirming execution cost
  scales with new events rather than total historical volume.
- **Alerting**: no outbound-notification mechanism (email, Slack, push)
  exists anywhere in this codebase today (verified — searched for
  webhook/notification-provider integrations before assuming one needed to
  be built). Building a full integration was judged out of scope for this
  issue; the staleness/high-severity badge above is the minimal
  proactive-surfacing mechanism in its place. A fuller version — e.g.
  paging an on-call Slack channel when a cron run's `highSeverityCount`
  crosses a threshold — is a follow-up that requires picking a
  notification provider and its own credentials/config, deliberately not
  bundled into this change.

## Heuristics

### Referral (self-dealing / wallet clustering)

| Heuristic                   | Signal                                                                 | False-positive guard                                                                       |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `self_redemption`           | Code redeemed by the same wallet that generated it                     | None needed — unambiguous by definition                                                    |
| `fast_redemption_pattern`   | ≥60% of a scout's redemptions land within 2 minutes of code generation | Requires ≥3 redemptions before judging a ratio                                             |
| `concentrated_redeemer`     | ≥50% of a scout's redemptions come from one other wallet               | Requires ≥5 redemptions                                                                    |
| `cross_scout_redeemer_ring` | One redeemer wallet has redeemed codes from ≥4 distinct scouts         | Threshold set above what an organic "signed up via a few friends' links" pattern would hit |

`cross_scout_redeemer_ring` is the one most directly aimed at "one actor
controls many different scout accounts" — it's keyed on the _redeemer_, not
the generator, so it catches a ring even when each individual scout's
redeemer mix looks unremarkable on its own (`concentrated_redeemer` wouldn't
catch that case, which is why both exist).

### Pay-to-contact (repeat abuse)

| Heuristic              | Signal                                            | False-positive guard                                                                            |
| ---------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `rapid_contact_burst`  | ≥8 pay-to-contact calls within a 10-minute window | Threshold set well above a human clicking through profiles by hand                              |
| `subscription_cycling` | ≥3 subscriptions averaging ≤1.5 contacts each     | Requires the repeated-cycle count; severity only reaches `high` at ≤1 avg contact and ≥5 cycles |

`subscription_cycling` is the direct answer to "pay-to-contact and
immediately churn subscriptions" from the issue. It's also the heuristic
with the highest genuine false-positive rate: a legitimately infrequent
scout looks identical to this data. That's why it defaults to `medium`
severity and only escalates with a stronger, repeated pattern — see
"False positives" below.

All thresholds are named constants at the top of `lib/fraudDetection.ts`,
not buried in conditionals, specifically so they can be retuned against
real production usage data (which doesn't exist yet — these are reasoned
starting points, not calibrated against real traffic) without re-reading
the heuristic logic.

## False positives

This is explicitly not a system that should ever auto-punish based on one
signal:

- **Busy scout / academy**: an academy generating dozens of legitimate
  referrals, or a scout doing a focused review session with several
  contacts in a row, is exactly the kind of power-user activity these
  heuristics must not routinely catch. That's why every heuristic requires
  a minimum volume before judging a _ratio_ (a single fast redemption or
  one burst of contacts proves nothing) and why the diversity-based
  heuristics (`cross_scout_redeemer_ring`, `concentrated_redeemer`) key on
  _concentration_, not raw volume — a high-volume, diverse pattern
  (many different redeemers, many different players contacted) is left
  alone regardless of scale.
- **`subscription_cycling` is the exception**: it cannot distinguish a
  gaming pattern from a genuinely low-usage scout using this data alone.
  It's kept at `medium` severity by default for that reason, and every flag
  carries its full evidence (subscription count, contacts per subscription,
  average gap) so an admin can tell the difference in seconds — a scout
  with 3 subscriptions 6 months apart is obviously not the same situation
  as 8 subscriptions with 2-week gaps.

## Action taken on a flag: alert-only

Every flag from this system is **alert-only** — surfaced in the admin
panel with full evidence, nothing is blocked, throttled, or reversed
automatically. Reasons:

1. **False-positive cost asymmetry.** Auto-blocking a real scout's
   pay-to-contact or referral redemption because of a heuristic match is a
   direct, immediate harm to a paying user; missing a genuine abuse case
   for a few extra hours until an admin reviews the queue is not. Given the
   false-positive risk discussed above (especially for `subscription_cycling`),
   that asymmetry rules out auto-throttling for v1.
2. **No production tuning data yet.** The thresholds above are reasoned
   defaults, not thresholds validated against real traffic. Shipping
   auto-enforcement on untuned thresholds is how you get a support queue
   full of legitimate users locked out.
3. **The existing self-redemption block (issue #676) already handles the
   one case where auto-blocking is safe** — because it has zero
   false-positive risk (`usedBy === scoutWallet` is unambiguous). Everywhere
   else here, that certainty doesn't exist, so the action stays
   admin-in-the-loop.

**What would change this:** if `cross_scout_redeemer_ring` or
`self_redemption`-adjacent patterns keep showing up with high confidence
after real tuning, a reasonable next step is auto-throttling _specifically
that heuristic_ (e.g., pausing further redemptions from a flagged redeemer
wallet pending review) rather than a blanket policy — and any such
throttle should be **admin-gated to unlock**, not time-expiring, so a false
positive doesn't quietly resolve itself without anyone having actually
looked at it. That's a deliberate future step, not part of this change.

## Extending this

To add a new heuristic: write a pure function taking the relevant
already-typed data (`ReferralCode[]` or `ActivityEvent[]`) and returning
`FraudFlag[]`, add it to `analyzeReferralAbuse`/`analyzePayToContactAbuse`,
and add a row to the tables above. To cover a third system, give it its own
`analyze*Abuse` function and its own false-positive discussion — don't
generalize the existing ones just to reuse them.
