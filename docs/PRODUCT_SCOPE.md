# Promiscope Product Scope

## Active accountability flow

The current project workflow lives in the frontend repository:

- `app/[locale]/projects/` lists public records and renders each project.
- `app/api/community/projects/` serves the public read and authenticated write API.
- `lib/projectRecordStore.ts` stores projects, milestones, updates, and responses in SQLite.
- Wallet-authenticated creators publish projects and manage milestone status and progress updates. Other signed-in wallets can respond to updates.

Evidence is currently represented by HTTPS or IPFS links. Promiscope does not upload or verify the referenced material. Milestone progress is reported by the project owner. Stellar SEP-10 provides wallet attribution; project data and review responses are off-chain and are not yet anchored to Soroban.

## Storage and deployment

The flow is suitable for local development and a single application instance with a durable disk. Set `PROJECT_RECORDS_DB_PATH` to a persistent SQLite file. Docker Compose creates a named `project-records` volume. Do not deploy this store on an ephemeral filesystem or share the SQLite file among multiple app instances. Moving the records API into the backend's SQLite/PostgreSQL driver is a prerequisite for horizontally scaled deployment.

## Legacy areas

The pre-pivot player, scout, validator, and sponsorship routes in the frontend remain legacy interfaces. `promiscope-backend/` and `promiscope-contracts/` still implement those previous workflows. They are not used by the new project record API. Do not describe their player profiles, scouting milestones, or contact payments as accountability features.

## First-run workflow

1. Configure `SESSION_SECRET` and `SEP10_SERVER_KEY` for wallet authentication.
2. Set a durable path for `PROJECT_RECORDS_DB_PATH` when running outside local development.
3. Start the frontend with `npm run dev` or `docker compose up --build`.
4. Connect a Stellar wallet, publish a commitment with at least one milestone, then add an owner update and a response from another wallet.

## Near-term engineering work

The next scaling step is a backend-owned API and portable database migrations. The public contributor backlog is tracked here:

- [Backend accountability API](https://github.com/Stellar-Promiscope/promiscope-backend/issues/13) and [frontend API integration](https://github.com/Stellar-Promiscope/promiscope-frontend/issues/1).
- [Translate the accountability interface](https://github.com/Stellar-Promiscope/promiscope-frontend/issues/2), [managed evidence uploads](https://github.com/Stellar-Promiscope/promiscope-frontend/issues/3), and [community reporting/moderation](https://github.com/Stellar-Promiscope/promiscope-frontend/issues/4).
- [Design optional privacy-safe Soroban commitments](https://github.com/Stellar-Promiscope/promiscope-contracts/issues/1) after the off-chain data model is stable.
