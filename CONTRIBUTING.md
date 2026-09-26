# Contributing Guide

## Introduction

Thank you for contributing to the ScoutOff frontend. This repository is the Next.js frontend for the ScoutOff decentralized scouting platform. Contributions are welcome from anyone who wants to improve the code, tests, documentation, or developer experience.

The typical contribution workflow is:

1. Fork or clone the repository.
2. Create a feature branch.
3. Make changes and run local validation.
4. Open a pull request against `main`.

> This repository includes GitHub issue templates at `.github/ISSUE_TEMPLATE/` (for bug reports and feature requests) and a pull request template at `.github/PULL_REQUEST_TEMPLATE.md`, plus a PR process guide at `.github/PR_DOCUMENTATION.md` to help you provide the right details.

## Local Development Setup

> For a complete end-to-end guide covering contracts, backend, and wallet setup, see [DEVELOPMENT.md](DEVELOPMENT.md).

> **Optional:** This repository includes a [devcontainer configuration](.devcontainer/devcontainer.json) for VS Code and GitHub Codespaces. When opened in a devcontainer, the correct Node.js version and all dependencies are set up automatically. See [Developing inside a Container](https://code.visualstudio.com/docs/devcontainers/containers) to learn more.

### Prerequisites

- Git
- Node.js 20.x or later
- npm (comes bundled with Node.js)

### Clone the repository

```bash
git clone https://github.com/scout-off/scout-off-frontend.git
cd scout-off-frontend
```

### Install dependencies

```bash
npm install
```

### Install Husky hooks

Husky hooks are installed automatically by the `prepare` script during `npm install`. If the hooks are missing, run:

```bash
npm run prepare
```

### Set up `.env.local`

Copy the example file and fill in environment-specific values:

```bash
cp .env.example .env.local
```

### Start the development environment

```bash
npm run dev
```

Open `http://localhost:3000` in your browser.

## Environment Configuration

This project uses `.env.local` for local environment variables. The repository includes `.env.example` with the variables that must be declared.

### Required environment variables

Copy every key from `.env.example` into `.env.local` and provide values appropriate for your local setup.

- `NEXT_PUBLIC_CONTRACT_ID`
- `NEXT_PUBLIC_NETWORK`
- `NEXT_PUBLIC_HORIZON_URL`
- `NEXT_PUBLIC_SOROBAN_RPC`
- `PINATA_API_KEY`
- `PINATA_SECRET`
- `NEXT_PUBLIC_IPFS_GATEWAY`
- `NEXT_PUBLIC_API_URL`
- `PLATFORM_CONTACT_FEE_XLM`
- `NEXT_PUBLIC_ADMIN_ADDRESS`
- `NEXT_PUBLIC_APP_URL`

> Keep `.env.local` out of version control. Do not commit any secrets, API keys, or private credentials.

### Environment validation

The project includes a validation script that checks whether environment variables used in source code are declared in `.env.example`.

Run the validator with:

```bash
node scripts/validate-env.js
```

### Common validation errors

- `Missing from .env.example:` means a `process.env.*` value is used in `.ts` or `.tsx` files but is not declared in `.env.example`.
- Fix it by adding the missing variable name to `.env.example` or removing the unused environment reference.
- If the script cannot read `.env.example`, make sure the file exists in the repository root.

## Branch Naming Convention

Use clear, descriptive branch names based on the type of work.

- `feat/<description>` — new feature or user-facing improvement
- `fix/<description>` — bug fix
- `test/<description>` — test coverage or test infrastructure work
- `chore/<description>` — repository maintenance, tooling, or dependency updates

### Good examples

- `feat/player-profile-ipfs-upload`
- `fix/validator-approval-modal`
- `test/player-search-hook`
- `chore/update-dependencies`

### Bad examples

- `new-feature`
- `bugfix`
- `work`
- `temp`

## Commit Message Convention

This project enforces the [Conventional Commits](https://www.conventionalcommits.org/) format via commitlint. Every commit message must follow the pattern:

```
<type>(<scope>): <description>
```

Allowed types: `feat`, `fix`, `build`, `chore`, `ci`, `docs`, `perf`, `refactor`, `revert`, `style`, `test`.

### Good examples

- `feat: add player profile IPFS upload`
- `fix(scout-dashboard): correct pagination offset`
- `chore(deps): bump axios to 1.7.2`
- `test(hooks): add useSearchPlayers test`
- `docs: update CONTRIBUTING.md with commit format`

### Bad examples

- `fixed bug`
- `WIP`
- `Update file`
- `asdf`

## Development Workflow

1. Create a branch from `main`:

```bash
git checkout main
git pull origin main
git checkout -b feat/your-description
```

2. Make changes in your branch.
3. Run validation and tests locally.
4. Push your branch and open a pull request against `main`.

## Running Tests

The repository exposes the following test-related commands:

- `npm run dev` — start the local Next.js development server
- `npm run lint` — run ESLint
- `npm run test` — run Jest tests
- `npm run test:watch` — run Jest tests in watch mode
- `npm run test:coverage` — run Jest tests with coverage collection enabled
- `npm run typecheck` — run the TypeScript compiler in `--noEmit` mode to check for type errors (full repo, including tests)
- `npm run type-check` — same as above but excludes test and story files; runs as a standalone job in CI
- `npm run format` — format files with Prettier
- `npm run format:check` — check formatting with Prettier
- `npm run prepare` — install Husky hooks
- `npm run test:visual` — run Storybook visual regression checks against committed baselines
- `npm run test:visual:update` — regenerate visual regression baselines after an intentional UI change (see [docs/visual-regression.md](docs/visual-regression.md))
- `npm run test-storybook` — run Storybook interaction tests (play functions and axe a11y checks) against a running Storybook (`npm run storybook`)
- `npm run test-storybook:ci` — the same against the static build (`npm run build-storybook` first); this is what CI runs

### Storybook Interaction Tests

jsdom doesn't do real layout or focus, so behaviour like focus traps, keyboard navigation, stacking and gestures is tested in a real browser. You write it as a Storybook `play` function, and `@storybook/test-runner` runs it in Chromium in the `build-storybook` CI job. A failing assertion fails the job.

When you add or change an interactive component, add a story with a `play` function next to its visual stories. Name it with a `(play)` suffix:

```tsx
import { expect, fn, userEvent, waitFor, within } from '@storybook/test';

export const ConfirmCancelPlay: Story = {
  name: 'Confirm / cancel (play)',
  args: { isOpen: true, title: 'Remove?', message: '…', onCancel: fn() },
  play: async ({ args, canvasElement }) => {
    const dialog = within(await within(canvasElement).findByRole('dialog'));
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await expect(args.onCancel).toHaveBeenCalled();
  },
};
```

Guidelines:

- Assert **behaviour**, not markup: focus movement, handlers called, elements appearing or disappearing, layout (`getBoundingClientRect`).
- Query by role and accessible name. Use `within(canvasElement.ownerDocument.body)` for anything portalled outside the story root (tooltips, toasts).
- Use `fn()` args to assert callbacks. Use `waitFor` for timers and animations rather than fixed sleeps.
- For mobile-only UI, request a viewport: `parameters: { testRunner: { viewport: { width: 375, height: 812 } } }`.
- Stories with a `play` function are **excluded from visual regression**, because their end state isn't a stable screenshot. Keep a plain sibling story for the visual baseline.
- Every story is also checked with axe (`.storybook/test-runner.ts`). Violations **fail** stories that have a `play` function and are logged as warnings for other stories. Tune or disable rules per story with the `a11y` parameter (`parameters: { a11y: { config: { rules: [...] } } }`), the same one the Storybook a11y panel reads.

To run them locally:

```bash
npx playwright install chromium
npm run build-storybook && npm run test-storybook:ci
```

### Indexer Package Tests

To run only the off-chain event indexer tests, use:

```bash
npx jest packages/indexer --no-coverage
```

For full indexer setup, environment variables, and schema details, see [packages/indexer/README.md](packages/indexer/README.md).

### Smart Contract Tests

When your changes include contract integration, run the smart contract tests from the contracts repository:

```bash
cd ../scout-off-contracts && cargo test
```

Run smart contract tests when your frontend changes depend on on-chain contract behavior, contract IDs, or Soroban interaction logic.

## Husky Hooks

This project uses Husky to run checks before each commit and push.

### Pre-commit hook

The pre-commit hook at `.husky/pre-commit` executes `npx --no-install lint-staged` before each commit. It runs only against staged files, so it does not run the full test suite locally.

`lint-staged` runs:

- `eslint --fix` on staged `.js`, `.jsx`, `.ts`, and `.tsx` files
- `prettier --write` on staged `.json`, `.css`, `.md`, and `.mdx` files

### Pre-push hook

The pre-push hook at `.husky/pre-push` runs the full test suite via `npm test`. This ensures that no branch is pushed with broken tests.

### Commit-msg hook

The commit-msg hook at `.husky/commit-msg` runs `@commitlint/cli` with `@commitlint/config-conventional` to enforce the [Conventional Commits](https://www.conventionalcommits.org/) format.

### Bypassing hooks

Only bypass the pre-commit hook in an emergency, such as when an unrelated local issue prevents a commit:

```bash
git commit --no-verify
git push --no-verify
```

Do not use `--no-verify` for PRs targeting `main`.

## Pull Request Checklist

- [ ] Tests pass locally
- [ ] Environment validation passes (`node scripts/validate-env.js`)
- [ ] Lighthouse CI passes (performance ≥ 80)
- [ ] No secrets or credentials committed
- [ ] New features include tests where applicable
- [ ] Documentation updated where necessary
- [ ] Code follows project conventions and formatting

### Architecture Decision Records

Significant technical decisions (framework choices, library selection, protocol
selection, data-model changes) should be documented as an Architecture Decision
Record (ADR) in [`docs/adr/`](docs/adr/). Each ADR follows the template at
[`docs/adr/0000-template.md`](docs/adr/0000-template.md) and covers the
Context, Decision, and Consequences of the choice. ADRs are numbered
sequentially (e.g. `0001-sep10-wallet-auth.md`).

For PRs that introduce a significant decision, include the ADR in the same PR
or link to it in the PR description. Reviewers may request an ADR for any
decision whose rationale is non-obvious from the code alone.

### Code review assignment

This repository uses a [CODEOWNERS](.github/CODEOWNERS) file to automatically request
reviews from the appropriate maintainers when a PR touches specific directories.
For example, changes to `app/api/auth/`, `lib/contract.ts`, or `packages/indexer/`
will automatically request a review from the relevant team. No manual reviewer
assignment is needed — GitHub applies CODEOWNERS rules on PR creation.

## Security Guidelines

- Never commit secrets, private keys, API tokens, or credentials.
- Keep `.env.local` and any local secret files out of Git.
- Use `.env.example` as the template for required environment variables.
- When sharing setup instructions, only share variable names, not values.

## Additional Notes

- The frontend repository is configured for GitHub Actions in `.github/workflows/ci.yml`.
- `npm run lint`, `npm run test`, and `node scripts/validate-env.js` are all part of the CI validation path.
- Lighthouse CI runs on every PR as a `lighthouse` job — reports are uploaded as build artifacts.
- Storybook visual regression runs on every PR as the `visual-regression` job (`.github/workflows/visual-regression.yml`); see [docs/visual-regression.md](docs/visual-regression.md) for how to review a failing diff and update baselines for intentional changes.
- If Husky hooks are not active after cloning, run `npm run prepare`.
- For offline PR-body drafts used when opening cross-fork PRs against `scout-off/scout-off-frontend:main`, see [docs/pr-bodies/](docs/pr-bodies/) — each file matches a branch in the bulk-deploy stack and is passed to `gh pr create --body-file`.

Thank you for helping improve ScoutOff.
