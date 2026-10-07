# Promiscope

**Promises in view. Progress on record.** Promiscope is a community project accountability platform concept. It is intended to make project commitments, progress evidence, and community review easier to follow, with Stellar supporting transparent records where appropriate.

## Product status

The home, project directory, and organization pages are an early visual preview. Project cards are fictional examples; project creation, evidence submission, community review, and organization accounts are not connected yet. Existing dashboards, APIs, data models, and Soroban contracts still implement the former football scouting product. Do not treat those legacy workflows as live Promiscope functionality.

## Project structure

- `app/[locale]/` — localized Next.js pages (`en`, `fr`, `sw`), including the public preview and legacy dashboard routes.
- `components/` — shared navigation, wallet, accessibility, and interface components.
- `messages/` — English, French, and Swahili interface strings.
- `lib/` — Stellar, API, configuration, and shared application helpers.
- `public/` — static assets, PWA manifest, and brand images.
- `__tests__/` — Jest unit and component tests; `e2e/` contains Playwright flows.
- `../promiscope-backend/` and `../promiscope-contracts/` — the sibling backend and Soroban contract repositories; both are still legacy-domain implementations.

## Development

Use Node.js 24 or later. From this directory:

```sh
npm install
npm run dev          # Start the local Next.js app
npm run typecheck    # Check TypeScript types
npm run lint         # Run Next.js lint checks
npm test             # Run Jest tests
```

The frontend needs the environment values listed in `.env.example` for wallet and contract-backed features. Public preview pages use illustrative content and can be developed independently of those integrations.

## Contribution notes

Keep new user-facing language focused on community projects, commitments, evidence, and progress. Mark demo content clearly and never imply that an organization or update has been verified unless the workflow supports that claim. Follow the existing TypeScript and Tailwind patterns, update all three locale files when shared copy changes, and include a concise pull request summary with affected routes and screenshots for visual changes.

For security-sensitive changes, use the process in [SECURITY.md](SECURITY.md). See [the workspace AGENTS.md](../AGENTS.md) for repository-specific contributor instructions.
