# API Observability and SLOs

API route spans are created by `withRouteTelemetry` in `lib/telemetry.ts`. Each server span records the normalized route name, request ID, HTTP status class, and duration. The instrumented critical paths represent Pinata, IPFS gateway, and backend work as child spans. Wallet addresses, contact details, authorization values, and other sensitive attribute keys are redacted before they reach Sentry.

## Critical-path SLOs

| Route or measurement                  | SLO          | Alert threshold                                                                      |
| ------------------------------------- | ------------ | ------------------------------------------------------------------------------------ |
| `/api/auth/sep10` POST latency        | p95 < 800 ms | page when p95 is >= 800 ms for 15 minutes                                            |
| `/api/media/[cid]` time to first byte | p95 < 1.5 s  | page when p95 is >= 1.5 s for 15 minutes                                             |
| Critical API route errors             | < 1%         | page when the 5-minute rolling error rate is >= 1%; ticket at >= 0.5% for 30 minutes |

Sentry Performance provides the route duration and child-span distributions. Filter transactions by the normalized route name and use the `http.status_class` tag for RED error-rate calculations. The media gateway read-ahead span records `http.ttfb_ms`, so gateway fallback behavior and time to first byte can be compared independently from total route duration.

## Sampling and operations

Sentry traces are sampled at 10% in production and 100% in non-production environments where Sentry is enabled. Error events remain unsampled. Alerts should use the SLO windows above and group by normalized route, never by a URL containing a CID, wallet address, email, or other user-controlled identifier.

The admin health view can link to these Sentry Performance queries for p50/p95 route latency, dependency timing, and error rate. This keeps the health view's availability check separate from the latency and reliability objectives.
