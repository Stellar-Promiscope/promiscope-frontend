# Promiscope Frontend

Promiscope is a community project accountability platform concept for following project commitments, evidence, and progress. The home, project directory, and organization pages are an early visual preview with fictional example projects; project submission and review flows are not connected yet. Existing account and dashboard integrations still reflect the prior product domain.

## Architecture and tree

The app is a localized Next.js application. Server and client pages live under `app/[locale]/`; same-origin API handlers live under `app/api/`. Shared interface components are in `components/`, cross-page state in `context/`, hooks in `hooks/`, and Stellar/API helpers in `lib/`. Translations are in `messages/` (`en`, `fr`, `sw`), static assets in `public/`, unit tests in `__tests__/`, and browser flows in `e2e/`.

The Next.js app calls the Express service in `server/` for legacy API workflows. The standalone event indexer is in `packages/indexer/`. Wallet and contract access use Stellar/Soroban; media upload uses server-side Pinata credentials. Redis is used for shared rate limits and upload state in multi-instance deployments.

## Configuration

Copy `.env.example` to `.env.local`. Treat that file as the full environment-variable reference; values are grouped by service:

| Group | Main variables | Purpose |
| --- | --- | --- |
| Stellar | `NEXT_PUBLIC_NETWORK`, `NEXT_PUBLIC_HORIZON_URL`, `NEXT_PUBLIC_SOROBAN_RPC`, `NEXT_PUBLIC_CONTRACT_ID` | Network and contract access |
| API | `NEXT_PUBLIC_API_URL`, `API_URL_INTERNAL`, `BACKEND_SERVICE_TOKEN` | Browser and server-side backend connections |
| Media and storage | `PINATA_API_KEY`, `PINATA_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Uploads, rate limits, and resumable uploads |
| Operations | `SENTRY_DSN`, `CRON_SECRET`, `SESSION_SECRET` | Monitoring and protected server functions |

Keep secrets server-side: never expose them through `NEXT_PUBLIC_` variables. Local development can leave optional integrations blank; production settings and feature-specific variables are documented inline in `.env.example`.

## Development

Use Node.js 24 or later. Run `npm install`, then `npm run dev`. Check with `npm run typecheck`, `npm run lint`, and `npm test`; browser tests run with `npm run test:e2e`. Update English, French, and Swahili strings together when shared UI copy changes. Keep demo records clearly identified as examples.

See [DEVELOPMENT.md](DEVELOPMENT.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [SECURITY.md](SECURITY.md) for setup and contribution details.
