# Promiscope Indexer

Off-chain event indexer for the Promiscope platform. Subscribes to Soroban contract events emitted by the Promiscope smart contract on Stellar, persists them for fast querying, and exposes an HTTP server for health checks and Prometheus-compatible metrics.

## Table of Contents

- [Purpose and Architecture](#purpose-and-architecture)
- [Setup and Installation](#setup-and-installation)
- [Environment Variables](#environment-variables)
- [Indexed Event Schema](#indexed-event-schema)
- [IndexerMetrics](#indexermetrics)
- [Querying Indexed Data](#querying-indexed-data)
- [HTTP API Reference](#http-api-reference)
- [Prometheus Scrape Config](#prometheus-scrape-config)
- [Deployment Topologies](#deployment-topologies)
- [Tests](#tests)

---

## Purpose and Architecture

The Promiscope smart contract emits on-chain events for every state change (player registration, milestone approvals, scout subscriptions, etc.). The indexer listens to these events via the Stellar Soroban RPC `getEvents` stream, decodes them, and stores them off-chain so the frontend can query historical data without hitting the RPC node for every page load.

```
Stellar Network
    │  Soroban RPC  getEvents
    ▼
┌─────────────────────────────┐
│  Event Listener / Poller    │  Polls ledger-by-ledger; tracks last
│  (eventPoller.ts)           │  indexed sequence + network head
│  updates ledgerTracker.ts   │  via ledgerTracker.ts
└────────────┬────────────────┘
             │  decoded EventType
             ├─────────────────────────────┐
             ▼                             ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│  IndexerMetrics             │  │  EventStore                 │
│  (metrics/IndexerMetrics.ts)│  │  (db/eventStore.ts)         │
│  In-process counters,       │  │  SQLite-backed persistence  │
│  latency EMA, health flag   │  │  for querying event history │
└────────────┬────────────────┘  └────────────┬────────────────┘
             │                                 │
             ▼                                 ▼
┌───────────────────────────────────────────────────────────────┐
│  HTTP Server (server.ts)                                       │
│  GET /health  GET /metrics  GET /events  GET /players          │
│  GET /players/:id/events  GET /validators/:addr/events         │
│  Port: 3001 (default)                                           │
└───────────────────────────────────────────────────────────────┘
```

Key design decisions:

- **Zero external dependencies** for metrics — plain TypeScript counters/gauges, no `prom-client`.
- **Singleton `IndexerMetrics`** — safe to import from multiple modules; one registry per process.
- **Fixed-size sliding window** (500 entries, 60 s) bounds memory growth while still producing meaningful rate and p95 latency values.
- **Ledger lag tracking** — `ledgerTracker` independently tracks the network head vs. last indexed ledger so the `/health` endpoint can report degraded state when the indexer falls behind.
- **`better-sqlite3` for event persistence** — a single embedded file database, not a separate DB server to run/deploy alongside a small indexer process. Synchronous API keeps the poll loop simple (no interleaved async writes to reason about).

---

## Setup and Installation

### Prerequisites

- Node.js ≥ 18
- Access to a Stellar Soroban RPC endpoint (testnet or mainnet)
- The deployed Promiscope contract address

This package is an npm workspace (declared in the repo root's `package.json`), so a single `npm install` at the repo root installs everything needed for both the frontend app and this package — there's no separate install step required here.

### Install

```bash
cd packages/indexer
npm install
```

### Build

```bash
# From the repo root
npm run build --workspace=packages/indexer

# Or from this package directory
cd packages/indexer
npm run build
# Output written to dist/
```

### Run

```bash
cd packages/indexer

# Default port 3001
npm start
# equivalent to: node dist/index.js

# Override port
PORT=9090 npm start
```

### Docker

```bash
docker build -t promiscope-indexer packages/indexer
docker run -p 3001:3001 promiscope-indexer
```

Or, as part of the full local stack (frontend + indexer + mocked RPC/API), see the "Docker Compose Quick Start" section in [DEVELOPMENT.md](../../DEVELOPMENT.md).

> **Note:** `package.json`/`tsconfig.json` here are a minimal scaffold added to make this package buildable/containerizable (see [#675](https://github.com/promiscope/promiscope-frontend/issues/675)). A fuller npm-package setup (proper `exports`, publishing config, a watch-mode dev script) is tracked separately as a companion packaging issue.

---

## Environment Variables

| Variable                  | Required | Default                                               | Description                                                                                                                                                          |
| ------------------------- | -------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                    | No       | `3001`                                                | HTTP server port for `/health` and `/metrics`                                                                                                                        |
| `SOROBAN_RPC_URL`         | Yes      | —                                                     | Soroban RPC endpoint, e.g. `https://soroban-testnet.stellar.org`                                                                                                     |
| `CONTRACT_ID`             | Yes      | —                                                     | Deployed Promiscope contract address (Strkey format)                                                                                                                   |
| `NETWORK_PASSPHRASE`      | No       | Testnet passphrase                                    | Stellar network passphrase used to decode event XDR                                                                                                                  |
| `POLL_INTERVAL_MS`        | No       | `5000`                                                | How often (ms) to poll for new ledgers                                                                                                                               |
| `START_LEDGER`            | No       | `0`                                                   | Ledger sequence to start indexing from (0 = latest)                                                                                                                  |
| `LOG_LEVEL`               | No       | `info`                                                | Log verbosity: `debug`, `info`, `warn`, `error`                                                                                                                      |
| `INDEXER_DB_PATH`         | No       | `./data/indexer.db` (`:memory:` when `NODE_ENV=test`) | Path to the SQLite event store file                                                                                                                                  |
| `INDEXER_DATABASE_URL`    | No       | —                                                     | Postgres connection string. When set, the shared Postgres store and leader election are used instead of SQLite (see [Deployment Topologies](#deployment-topologies)) |
| `INDEXER_LEADER_LOCK_KEY` | No       | `7319001`                                             | Advisory-lock key for leader election; change it only to run several independent indexers on one database                                                            |

Copy `.env.example` in the repo root and fill in the required values:

```bash
cp ../../.env.example ../../.env.local
```

---

## Indexed Event Schema

The indexer processes eight event types emitted by the Promiscope contract. All events carry a `ledger` sequence number and `timestamp` (Unix seconds) sourced from the Soroban event envelope.

`eventPoller.ts`'s `decodeEvent` assumes the common Soroban convention —
`topic[0]` is a Symbol equal to the event name, `value` is a Map/struct
holding the other fields below — since no Rust contract source lives in
this repository to confirm the wire format against. If the deployed
contract encodes events differently, only `decodeEvent` needs to change.

### `player_registered`

Emitted when a player calls `register_player`.

| Field       | Type     | Description                          |
| ----------- | -------- | ------------------------------------ |
| `player_id` | `string` | On-chain player identifier           |
| `wallet`    | `string` | Stellar public key of the player     |
| `ipfs_hash` | `string` | IPFS CID of the initial media upload |
| `ledger`    | `number` | Ledger sequence                      |
| `timestamp` | `number` | Unix timestamp (seconds)             |

### `profile_updated`

Emitted when a player calls `update_profile` (issue #1298 adds this event type so profile refreshes update the materialized players projection).

| Field       | Type     | Description                     |
| ----------- | -------- | ------------------------------- |
| `player_id` | `string` | On-chain player identifier      |
| `ipfs_hash` | `string` | IPFS CID of the refreshed media |
| `ledger`    | `number` | Ledger sequence                 |
| `timestamp` | `number` | Unix timestamp (seconds)        |

### `milestone_approved`

Emitted when a validator calls `approve_milestone`.

| Field          | Type     | Description                                  |
| -------------- | -------- | -------------------------------------------- |
| `player_id`    | `string` | Target player                                |
| `milestone_id` | `string` | Unique milestone identifier                  |
| `description`  | `string` | Human-readable milestone text                |
| `validator`    | `string` | Validator's Stellar public key               |
| `new_level`    | `number` | Player's progress level after approval (1–3) |
| `ledger`       | `number` | Ledger sequence                              |
| `timestamp`    | `number` | Unix timestamp (seconds)                     |

### `milestone_revoked`

Emitted when a validator or admin calls `revoke_milestone`.

| Field          | Type     | Description                   |
| -------------- | -------- | ----------------------------- |
| `player_id`    | `string` | Target player                 |
| `milestone_id` | `string` | Revoked milestone identifier  |
| `revoked_by`   | `string` | Stellar public key of revoker |
| `ledger`       | `number` | Ledger sequence               |
| `timestamp`    | `number` | Unix timestamp (seconds)      |

### `scout_subscribed`

Emitted when a scout calls `subscribe`.

| Field       | Type     | Description                                     |
| ----------- | -------- | ----------------------------------------------- |
| `scout`     | `string` | Scout's Stellar public key                      |
| `tier`      | `string` | Subscription tier (`basic` \| `pro` \| `elite`) |
| `expiry`    | `number` | Unix timestamp when subscription expires        |
| `fee_xlm`   | `string` | XLM amount paid (string to preserve precision)  |
| `ledger`    | `number` | Ledger sequence                                 |
| `timestamp` | `number` | Unix timestamp (seconds)                        |

### `player_contacted`

Emitted when a scout calls `pay_to_contact`.

| Field       | Type     | Description                       |
| ----------- | -------- | --------------------------------- |
| `scout`     | `string` | Scout's Stellar public key        |
| `player_id` | `string` | Player whose contact was unlocked |
| `fee_xlm`   | `string` | XLM fee paid                      |
| `ledger`    | `number` | Ledger sequence                   |
| `timestamp` | `number` | Unix timestamp (seconds)          |

### `trial_offer_logged`

Emitted when a scout calls `log_trial_offer` (advances player to Level 3).

| Field       | Type     | Description                   |
| ----------- | -------- | ----------------------------- |
| `scout`     | `string` | Scout's Stellar public key    |
| `player_id` | `string` | Player who received the offer |
| `details`   | `string` | Free-text trial offer details |
| `ledger`    | `number` | Ledger sequence               |
| `timestamp` | `number` | Unix timestamp (seconds)      |

### `fees_withdrawn`

Emitted when an admin calls `withdraw_fees`.

| Field        | Type     | Description                  |
| ------------ | -------- | ---------------------------- |
| `to`         | `string` | Recipient Stellar public key |
| `amount_xlm` | `string` | XLM amount withdrawn         |
| `ledger`     | `number` | Ledger sequence              |
| `timestamp`  | `number` | Unix timestamp (seconds)     |

---

## IndexerMetrics

`IndexerMetrics` (`src/metrics/IndexerMetrics.ts`) is a lightweight, zero-dependency singleton that tracks indexer health and performance. It is used by the event processing loop to record each outcome and by `server.ts` to serve the `/metrics` endpoint.

### Usage

```typescript
import { IndexerMetrics } from './metrics/IndexerMetrics';

const metrics = IndexerMetrics.getInstance();

// Record a successfully processed event
metrics.recordSuccess('player_registered', latencyMs, payloadBytes);

// Record a failed processing attempt
metrics.recordFailure(latencyMs);

// Record a retry (does not count as a new processed event)
metrics.recordRetry();

// Mark healthy after recovering from errors
metrics.markHealthy();

// Read a point-in-time snapshot
const snap = metrics.snapshot();
console.log(snap.ingestionRatePerSec, snap.latencyP95Ms, snap.isHealthy);
```

### What It Tracks

| Metric                  | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `totalProcessed`        | Cumulative events processed (successes + failures)  |
| `totalSuccesses`        | Cumulative successfully processed events            |
| `totalFailures`         | Cumulative failed processing attempts               |
| `totalRetries`          | Cumulative retry attempts                           |
| `totalBytesIngested`    | Cumulative payload bytes processed                  |
| `eventCounts`           | Per-`EventType` success counter                     |
| `lastProcessedAt`       | Unix ms timestamp of the last processed event       |
| `consecutiveErrors`     | Unbroken run of failures since last success         |
| `isHealthy`             | `false` when `consecutiveErrors ≥ 5`                |
| `ingestionRatePerSec`   | Events per second over the last 60 s sliding window |
| `errorRatePercent`      | `(failures / processed) × 100` (lifetime)           |
| `successRatePercent`    | `(successes / processed) × 100` (lifetime)          |
| `latencyAvgMs`          | Exponential moving average latency (α = 0.1)        |
| `latencyP95Ms`          | 95th-percentile latency over 60 s sliding window    |
| `throughputBytesPerSec` | Bytes per second over 60 s sliding window           |

### Singleton and Testing

```typescript
// In tests: reset between cases to isolate state
import { IndexerMetrics } from './metrics/IndexerMetrics';
afterEach(() => IndexerMetrics.resetInstance());

// Inject a mock clock for deterministic time-based tests
const mockNow = jest.fn(() => 1_000_000);
const metrics = IndexerMetrics.getInstance(mockNow);
```

---

## Querying Indexed Data

### Storage schema

`db/eventStore.ts` persists every successfully decoded event into a single SQLite `events` table:

| Column        | Type    | Description                                                             |
| ------------- | ------- | ----------------------------------------------------------------------- |
| `id`          | INTEGER | Autoincrement primary key                                               |
| `event_type`  | TEXT    | One of the 8 documented event types                                     |
| `player_id`   | TEXT    | `data.player_id` when present (NULL otherwise) — indexed                |
| `scout`       | TEXT    | `data.scout` when present (NULL otherwise)                              |
| `validator`   | TEXT    | `data.validator` when present (NULL otherwise)                          |
| `ledger`      | INTEGER | Ledger sequence — indexed, used for ordering and pagination             |
| `timestamp`   | INTEGER | Unix seconds, from the event envelope                                   |
| `data`        | TEXT    | Full decoded event payload as JSON (all type-specific fields live here) |
| `inserted_at` | INTEGER | Unix ms when the row was written, for operational debugging             |

Design rationale: `event_type`, `player_id`, `scout`, `validator`, and `ledger` are the fields queries actually filter or sort by, so they get real indexed columns (`idx_events_player_ledger`, `idx_events_type_ledger`, `idx_events_ledger`). Everything else — `milestone_id`, `description`, `new_level`, `fee_xlm`, `tier`, `expiry`, `details`, `amount_xlm`, `to`, `revoked_by`, `wallet`, `ipfs_hash` — stays in the `data` JSON blob rather than becoming 15+ mostly-NULL columns shared across 7 unrelated event shapes. If a second use case needs to filter/sort on one of those fields, promote it to a real column then (see the companion issue's guidance to scope this conservatively).

This schema is enough to reconstruct, per player: the current approved-milestone set (apply `milestone_approved` in ledger order, remove on a later `milestone_revoked` for the same `milestone_id` — see `lib/indexerClient.ts`'s `getMilestoneHistoryFromIndexer` on the frontend), subscription history (`scout_subscribed` events by `scout`), and contact-unlock history (`player_contacted` events by `player_id` or `scout`).

### Materialized players table (issue #1298)

Alongside `events`, `eventStore.ts` maintains a `players` table — one row per registered player — so scout discovery never runs an unpaginated `filter_players` simulation against Soroban (whose read-only CPU/memory/ledger-entry limits are exceeded once the registry grows to a few hundred players).

| Column           | Type    | Description                                                       |
| ---------------- | ------- | ----------------------------------------------------------------- |
| `player_id`      | TEXT    | Primary key                                                       |
| `wallet`         | TEXT    | Player's Stellar public key (NULL for skeleton rows)              |
| `name`           | TEXT    | Vitals — NULL when the event payload carried no vitals            |
| `age`            | INTEGER | Vitals                                                            |
| `position`       | TEXT    | Vitals — indexed                                                  |
| `region`         | TEXT    | Vitals — indexed                                                  |
| `nationality`    | TEXT    | Vitals                                                            |
| `ipfs_hash`      | TEXT    | Latest media CID                                                  |
| `progress_level` | INTEGER | 0–3 — indexed                                                     |
| `created_ledger` | INTEGER | Registration ledger (earliest known) — part of the pagination key |
| `created_at`     | INTEGER | Registration timestamp (unix seconds)                             |
| `updated_ledger` | INTEGER | Ledger of the last event that touched this row                    |

Projection rules (applied inside the same SQLite transaction as the event insert, and only for genuinely new events — the `event_id` unique index guarantees exactly-once application):

- `player_registered` upserts the row; vitals are extracted tolerantly from either a nested `vitals` object or flat payload fields (see the ASSUMPTION note on `eventPoller.decodeEvent` — no contract source lives in this repo to confirm the wire format). Missing vitals stay NULL and simply never match region/position filters.
- `profile_updated` refreshes `ipfs_hash` and any vitals present in the payload.
- `milestone_approved` sets `progress_level = MAX(current, new_level)`; `milestone_revoked` decrements it by one (floored at 0).
- A milestone for an unknown player creates a skeleton row that a later (replayed) registration backfills.

Queries paginate with **keyset cursor over `(created_ledger DESC, player_id DESC)`** — a stable, total order — so page cost stays proportional to page size and pages never skip or duplicate rows when new players register mid-pagination. Seed a local 10,000-player registry for benchmarking with:

```bash
npm run seed:players --workspace @promiscope/indexer -- --count 10000
time curl 'localhost:3001/players?limit=50&region=West%20Africa'
```

### HTTP API

The indexer exposes these endpoints from `server.ts`:

#### `GET /players`

Paginated, filterable scout-discovery query over the materialized players table (issue #1298). Replaces the dashboard's on-chain `filter_players` call; the frontend consumes it via `lib/indexerClient.ts#listPlayers` and `hooks/useInfinitePlayers`.

| Query param    | Required | Description                                                                                               |
| -------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `region`       | No       | Exact-match region. Empty/omitted = all regions. `400` if longer than 100 chars.                          |
| `position`     | No       | Exact-match position. Empty/omitted = all positions. `400` if longer than 100 chars.                      |
| `minLevel`     | No       | Minimum progress level, integer 0–3. `400` otherwise.                                                     |
| `cursor`       | No       | Opaque keyset cursor — pass the previous page's `nextCursor`. `400` if malformed.                         |
| `limit`        | No       | Page size, default 50, **capped at 50**. `400` if not a positive integer.                                 |
| `createdAfter` | No       | Only players created strictly after this unix-seconds timestamp (saved-search "new since viewed" counts). |

```bash
curl 'http://localhost:3001/players?region=West%20Africa&minLevel=1&limit=50'
```

```json
{
  "players": [
    {
      "id": "player-1",
      "wallet": "GVALIDATOR...",
      "vitals": {
        "name": "Ava Rodriguez",
        "age": 21,
        "position": "ST",
        "region": "West Africa",
        "nationality": "Ghana"
      },
      "ipfsHash": "QmHash",
      "progressLevel": 2,
      "milestones": [],
      "createdAt": 1700000000
    }
  ],
  "nextCursor": "MTIzNDU2Nzg5OnBsYXllci0x",
  "total": 8421
}
```

- Ordering: newest registration first (`created_ledger DESC, player_id DESC`).
- `nextCursor` is `null` on the last page; it is opaque — echo it back unchanged.
- `total` counts every row matching the filters, independent of the cursor — the dashboard shows it as "N players found" without fetching every page.
- `milestones` is always `[]`: the scout grid loads milestones in batch separately; profile pages verify against the chain via `getPlayer`.

#### `GET /events`

Query events across all players, optionally filtered.

| Query param | Required | Description                                                                                                            |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `type`      | No       | One of the 8 documented event types. `400` if unrecognized.                                                            |
| `player_id` | No       | Not applicable here — use `/players/:id/events` instead.                                                               |
| `limit`     | No       | Page size, default 50, capped at 200. `400` if not a positive integer.                                                 |
| `before`    | No       | Keyset cursor: only returns events with `ledger` strictly less than this value. Pass the previous page's `nextCursor`. |

```bash
curl 'http://localhost:3001/events?type=milestone_approved&limit=20'
```

```json
{
  "events": [
    {
      "id": 42,
      "type": "milestone_approved",
      "playerId": "player-1",
      "scout": null,
      "validator": "GVALIDATOR...",
      "ledger": 54321,
      "timestamp": 1700000000,
      "data": {
        "player_id": "player-1",
        "milestone_id": "m1",
        "description": "Scored 20 goals",
        "validator": "GVALIDATOR...",
        "new_level": 2,
        "ledger": 54321,
        "timestamp": 1700000000
      }
    }
  ],
  "nextCursor": 54100
}
```

`nextCursor` is `null` once there are no more matching events older than the current page.

#### `GET /players/:id/events`

Same filtering/pagination as `GET /events`, scoped to one player's events (matches on the `player_id` column).

```bash
curl 'http://localhost:3001/players/player-1/events?limit=50'
```

#### `GET /health`

JSON health check. Returns `200` whether healthy or degraded.

```bash
curl http://localhost:3001/health
```

```json
{
  "status": "ok",
  "role": "leader",
  "lastLedger": 54321,
  "uptime": 3600
}
```

| Field        | Type                       | Description                                                                 |
| ------------ | -------------------------- | --------------------------------------------------------------------------- |
| `status`     | `"ok"` \| `"degraded"`     | `"degraded"` when no ledger update in the last 60 s                         |
| `lastLedger` | `number`                   | Last indexed ledger sequence (0 = none yet)                                 |
| `uptime`     | `number`                   | Server uptime in seconds                                                    |
| `role`       | `"leader"` \| `"follower"` | Whether this replica holds the polling lock (always `"leader"` with SQLite) |

Followers don't poll, so they report the leader's progress from the shared checkpoint instead: `lastLedger` is the leader's checkpoint, plus `leaderLag` (network tip minus checkpoint, in ledgers) and `leaderCheckpointAgeMs`. A follower reports `"degraded"` when the checkpoint is older than 60 s.

#### `GET /metrics`

Prometheus text format (exposition format 0.0.4). Scrape this with Prometheus or `curl`.

```bash
curl http://localhost:3001/metrics
```

```
# HELP indexer_events_total Total events processed by type
# TYPE indexer_events_total counter
indexer_events_total{type="player_registered"} 42
indexer_events_total{type="milestone_approved"} 17
indexer_events_total{type="milestone_revoked"} 2
indexer_events_total{type="scout_subscribed"} 8
indexer_events_total{type="player_contacted"} 25
indexer_events_total{type="trial_offer_logged"} 3
indexer_events_total{type="fees_withdrawn"} 1
indexer_events_total{type="fees_withdrawn"} 1
# HELP indexer_processed_total Total events processed (all types)
# TYPE indexer_processed_total counter
indexer_processed_total 98
# HELP indexer_errors_total Total processing failures
# TYPE indexer_errors_total counter
indexer_errors_total 3
# HELP indexer_error_rate_percent Failure rate as a percentage
# TYPE indexer_error_rate_percent gauge
indexer_error_rate_percent 3.0612
# HELP indexer_latency_avg_ms Processing latency EMA in milliseconds
# TYPE indexer_latency_avg_ms gauge
indexer_latency_avg_ms 12.3400
# HELP indexer_latency_p95_ms Processing latency p95 (sliding window)
# TYPE indexer_latency_p95_ms gauge
indexer_latency_p95_ms 48.0000
# HELP indexer_ledger_lag Difference between network and last indexed ledger
# TYPE indexer_ledger_lag gauge
indexer_ledger_lag 2
# HELP indexer_healthy 1 if healthy, 0 if degraded
# TYPE indexer_healthy gauge
indexer_healthy 1
```

### Metric Reference

| Metric                       | Type    | Description                                 |
| ---------------------------- | ------- | ------------------------------------------- |
| `indexer_events_total{type}` | counter | Per-event-type success count                |
| `indexer_processed_total`    | counter | Total events processed                      |
| `indexer_errors_total`       | counter | Total failures                              |
| `indexer_error_rate_percent` | gauge   | Rolling failure rate                        |
| `indexer_latency_avg_ms`     | gauge   | EMA processing latency                      |
| `indexer_latency_p95_ms`     | gauge   | p95 latency over 60 s window                |
| `indexer_ledger_lag`         | gauge   | Network head minus last indexed ledger      |
| `indexer_healthy`            | gauge   | `1` = healthy, `0` = ≥ 5 consecutive errors |

---

## Prometheus Scrape Config

```yaml
scrape_configs:
  - job_name: promiscope_indexer
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:3001']
```

---

## Deployment Topologies

### Single replica (SQLite)

The default. One process polls RPC and serves reads from an embedded SQLite file (`INDEXER_DB_PATH`). It is always the leader. Suitable for dev and small deployments; there is no failover.

### N replicas (Postgres)

Set `INDEXER_DATABASE_URL` on every replica. All replicas share one Postgres database and serve the read API; exactly one — the leader — polls Soroban RPC.

- **Leader election:** each replica tries `pg_try_advisory_lock` on a dedicated connection. The lock is renewed (verified) on every poll cycle, and renewal must finish within one `POLL_INTERVAL_MS` lease. If the lock is lost or renewal fails, the replica stops polling immediately and becomes a follower.
- **Failover:** Postgres releases a session advisory lock as soon as the holder's connection closes, so when the leader dies a follower takes over on its next attempt — within one `POLL_INTERVAL_MS`. A graceful stop unlocks explicitly for an immediate hand-off.
- **Exactly-once storage:** events are inserted with `ON CONFLICT (event_id) DO NOTHING`, so a brief overlap between an old and a new leader cannot create duplicates.
- **Atomic checkpoint:** the event batch and the `checkpoint` row (`last_ledger`, `network_ledger`, `updated_at`) are written in one transaction, and the checkpoint never moves backwards. A new leader resumes from `last_ledger + 1`.
- **Observability:** `/health` includes `role`; `/metrics` exposes the `indexer_is_leader` gauge (sum across replicas should always be `1`).

The schema is created automatically on startup. See [`docker-compose.replicas.yml`](./docker-compose.replicas.yml) for a two-replica example:

```bash
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org CONTRACT_ID=C... \
  docker compose -f docker-compose.replicas.yml up --build
```

Put the replicas behind any HTTP load balancer for the read API.

---

## Tests

```bash
# Run indexer tests only (from repo root)
npx jest packages/indexer --no-coverage

# Run with coverage
npx jest packages/indexer --coverage
```

Test files live in:

- `src/__tests__/server.test.ts` — HTTP server endpoint tests, including `/players`, `/events` and `/players/:id/events`
- `src/__tests__/eventPoller.test.ts` — event decoding, poll-cycle ledger advancement, RPC/decode error handling, and event persistence, against a mocked RPC client and an in-memory `EventStore`
- `src/db/__tests__/eventStore.test.ts` — `EventStore` unit tests (schema, insert, type/player filters, ordering, keyset pagination)
- `src/db/__tests__/playersStore.test.ts` — materialized `players` projection + `getPlayers` filters/cursor pagination (issue #1298)
- `src/db/__tests__/playersPerf.test.ts` — performance guard: first page of 10k seeded players in under 1 s (issue #1298 acceptance)
- `src/metrics/__tests__/` — `IndexerMetrics` unit tests (singleton, counters, sliding window, p95, health flag)
- `src/__tests__/leaderElection.test.ts` — leader election and two replicas sharing a store: no duplicate events, takeover within the lease
- `src/db/__tests__/checkpointAtomicity.test.ts` — event batch + checkpoint atomicity for the SQLite and Postgres stores
- `src/__tests__/replicas.pg.integration.test.ts` — two replicas against a real Postgres; skipped unless `INDEXER_TEST_DATABASE_URL` is set

---

## Frontend Integration

`lib/indexerClient.ts` (root of the frontend app, not this package) is the reference client for this query API, configured via the server-only `INDEXER_API_URL_INTERNAL` (default `http://localhost:3001`); in the browser it calls the Next.js same-origin proxy at `/api/indexer/*` instead, since this server sends no CORS headers. `hooks/useMilestoneHistory.ts` reads a player's milestone history from `GET /players/:id/events` first, falling back to a direct Soroban contract simulation only if the indexer is unreachable — the intended data path this package exists to serve, and the pattern future hooks (activity feeds, subscription history) should follow instead of calling Horizon/Soroban RPC directly. See `lib/indexerClient.ts`'s `getMilestoneHistoryFromIndexer` for the event-log-to-milestone-list reconstruction.

For scout discovery (issue #1298), `lib/indexerClient.ts#listPlayers` fetches one page of `GET /players` and `hooks/useInfinitePlayers.ts` wires it to `useSWRInfinite` (50-player pages, opaque cursors) — the dashboard's `VirtualizedPlayerGrid` requests the next page when the user scrolls near the bottom. Unlike milestone history, discovery deliberately has **no** on-chain `filter_players` fallback: that simulation returns every matching player in one Vec and eventually exceeds Soroban's read-only limits, which is the failure this endpoint exists to prevent. Single-record reads stay on-chain (`getPlayer`), so profile pages remain authoritative and are badged "Verified on-chain". The dashboard also polls `GET /health` (proxied) to show a "results may be up to N ledgers behind" hint when the poller lags.
