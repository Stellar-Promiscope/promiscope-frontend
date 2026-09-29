# API Telemetry Coverage

Critical API handlers use `withRouteTelemetry` from `lib/telemetry.ts`:

- `/api/auth/sep10` (GET, POST, DELETE)
- `/api/auth/refresh` (POST)
- `/api/ipfs/upload` (POST)
- `/api/ipfs/upload/complete` (POST)
- `/api/media/[cid]` (GET)
- `/api/players/search` (GET)

The wrapper preserves the handler response and records route duration, status class, and request ID. Outbound dependency spans use stable dependency and operation names rather than user-controlled URLs. See [observability-slos.md](observability-slos.md) for the latency and error-rate objectives.
