# Promiscope Frontend — Community Project Accountability on Stellar

Promiscope helps communities follow project commitments, milestones, progress updates, supporting evidence, and responses. The frontend uses Stellar SEP-10 wallet authentication to attribute publishing activity to a wallet address; project records are stored off-chain. A wallet address does not prove an organization's identity or that its claims are true. 

## Architecture and tree

The app is a localized Next.js application. Server and client pages live under `app/[locale]/`; same-origin API handlers live under `app/api/`. Shared interface components are in `components/`, cross-page state in `context/`, hooks in `hooks/`, and Stellar/API helpers in `lib/`. Translations are in `messages/` (`en`, `fr`, `sw`), static assets in `public/`, unit tests in `__tests__/`, and browser flows in `e2e/`.

The project accountability flow uses same-origin route handlers in `app/api/community/projects/` and a SQLite record store in `lib/projectRecordStore.ts`. Authenticated writes use the app's SEP-10 wallet session. Records are off-chain; no Soroban attestations are written. The Next.js app calls the Express service in `server/` for legacy API workflows. The standalone event indexer is in `packages/indexer/`.

## How the project uses Stellar

Stellar SEP-10 authenticates a connected wallet for project publishing and updates. The wallet address attributes activity to a pseudonymous account; it does not verify a person's identity or the accuracy of their claims. Project records and evidence links are stored off-chain in SQLite, and the current accountability flow does not transfer XLM or write to Soroban. A future Soroban integration could timestamp a hash of a published revision while keeping project details and evidence off-chain; that design is tracked in the [contracts issue tracker](https://github.com/Stellar-Promiscope/promiscope-contracts/issues/1) and is not implemented yet.

## Configuration

Copy `.env.example` to `.env.local`. Treat that file as the full environment-variable reference; values are grouped by service:

| Group                  | Main variables                                                                                         | Purpose                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Stellar                | `NEXT_PUBLIC_NETWORK`, `NEXT_PUBLIC_HORIZON_URL`, `NEXT_PUBLIC_SOROBAN_RPC`, `NEXT_PUBLIC_CONTRACT_ID` | Network and contract access                                      |
| API                    | `NEXT_PUBLIC_API_URL`, `API_URL_INTERNAL`, `BACKEND_SERVICE_TOKEN`                                     | Browser and server-side backend connections                      |
| Media and storage      | `PINATA_API_KEY`, `PINATA_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`                | Uploads, rate limits, and resumable uploads                      |
| Records and operations | `PROJECT_RECORDS_DB_PATH`, `SENTRY_DSN`, `CRON_SECRET`, `SESSION_SECRET`                               | Durable project data, monitoring, and protected server functions |

Keep secrets server-side: never expose them through `NEXT_PUBLIC_` variables. Local development can leave optional integrations blank. Project records use SQLite; deployments must mount durable storage and set `PROJECT_RECORDS_DB_PATH` to that volume. Run a single application writer against that SQLite file; ephemeral serverless filesystems and multiple app instances sharing a local file are not supported. All feature-specific variables are documented inline in `.env.example`.

## Development

Use Node.js 24 or later. Run `npm install`, then `npm run dev`. Check with `npm run typecheck`, `npm run lint`, and `npm test`; browser tests run with `npm run test:e2e`. Update English, French, and Swahili strings together when shared UI copy changes. Keep demo records clearly identified as examples.

See [DEVELOPMENT.md](DEVELOPMENT.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [SECURITY.md](SECURITY.md) for setup and contribution details.
See [PRODUCT_SCOPE.md](docs/PRODUCT_SCOPE.md) for the active workflow, legacy boundaries, and deployment limits.
