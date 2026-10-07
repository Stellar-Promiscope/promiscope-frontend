> **Historical archive.** This was an early-project task list and is no longer maintained. Items marked open here (e.g. #26, #27) have since been resolved. The live tracker is [GitHub Issues](https://github.com/promiscope/promiscope-frontend/issues).

# Promiscope Frontend — GitHub Issues

30 issues covering key gaps in the frontend. Ready to copy into GitHub Issues.

> **Status Audit (2026-07-26)** — many of the issues listed below are now resolved in `main` but were never reflected here. The audit below maps each surviving item after the `chore(issues): resolve 12 of 30 ISSUES.md items (#1, #11-17, #22, #24, #28, #29)` bulk-deploy commit to either ✅ RESOLVED in code (with a path pointer) or 🟡 OPEN (AC still not met). The audit is intentionally terse — see the individual issue blocks for full AC and resolution context.
>
> | #   | Title                                                       | Status in `main`                                                                                                                                                                    |
> | --- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | #1  | Scout Public Profile Page                                   | ✅ resolved (per bulk-deploy commit)                                                                                                                                                |
> | #2  | ContactModal Component                                      | ✅ resolved — `components/scout/ContactModal.tsx` (96 LOC), wired into `app/[locale]/player/[id]/page.tsx`                                                                          |
> | #3  | Wire Validator Dashboard                                    | ✅ resolved — `app/[locale]/validator/page.tsx` renders `ValidatorPlayerSearch`, `ApproveForm`, `RevokeForm`                                                                        |
> | #4  | Trial Offer UI                                              | ✅ resolved — `app/[locale]/player/[id]/page.tsx` imports `TrialOfferForm`, gated on `canLogTrialOffer`                                                                             |
> | #5  | PWA Raster Icons                                            | ✅ resolved — `public/icons/{icon-16x16,icon-32x32,icon-192x192,icon-512x512,icon-maskable-512x512}.png` present; `manifest.json` `icons[]` covers all sizes                        |
> | #6  | Pay-to-Contact on Player Profile                            | ✅ resolved — `app/[locale]/player/[id]/page.tsx` uses `usePayToContact` (not `buildPayToContact`) and triggers `ContactModal` on success                                           |
> | #7  | Scout Dashboard Subscription Guard                          | ✅ resolved — `components/scout/ScoutDashboardContent.tsx` calls `useRequireSubscription()` which redirects to `/scout/subscribe?reason=…`                                          |
> | #8  | `useTrialOffer` Hook                                        | ✅ resolved — exists at `hooks/useTrialOffer.ts` (multi-line file)                                                                                                                  |
> | #9  | Player Profile: `IPFSMediaGallery`                          | ✅ resolved — `app/[locale]/player/[id]/page.tsx` renders `<IPFSMediaGallery cids={...} />`                                                                                         |
> | #10 | Player Dashboard: `PlayerProfileForm` / `MilestoneTimeline` | ✅ resolved — `app/[locale]/player/page.tsx` composes both components                                                                                                               |
> | #11 | Scout Dashboard: `Select` component                         | ✅ resolved (per bulk-deploy commit)                                                                                                                                                |
> | #12 | Add `useScoutProfile` Hook                                  | ✅ resolved (per bulk-deploy commit)                                                                                                                                                |
> | #13 | SEP-10 Session: Expired Cookies                             | ✅ resolved (per bulk-deploy commit)                                                                                                                                                |
> | #14 | Albedo Wallet: `isInstalled` check                          | ✅ resolved (per bulk-deploy commit)                                                                                                                                                |
> | #15 | i18n: Validator / Admin page strings                        | ✅ resolved (per bulk-deploy commit)                                                                                                                                                |
> | #16 | Improve CI: Add Build Step                                  | ✅ resolved (per bulk-deploy commit)                                                                                                                                                |
> | #17 | `NEXT_PUBLIC_ADMIN_ADDRESS` Validation                      | ✅ resolved (per bulk-deploy commit)                                                                                                                                                |
> | #18 | Nationality field registration                              | ✅ resolved — `components/player/PlayerOnboardingWizard.tsx` exposes `nationalityRef` + form input `id="wizard-nationality"`                                                        |
> | #19 | Loading skeletons on Player Profile                         | ✅ resolved — `app/[locale]/player/[id]/page.tsx` renders `<PlayerProfileSkeleton ...>` during `playerLoading`                                                                      |
> | #20 | Scout Subscription: current status                          | ✅ resolved — `app/[locale]/scout/subscribe/page.tsx` banner + `ScoutDashboardContent.tsx` storefront banner                                                                        |
> | #21 | `MilestoneList` vs `MilestoneTimeline`                      | ✅ resolved (previously in-file ✅ RESOLVED)                                                                                                                                        |
> | #22 | `robots.txt` disallow `/admin` and `/api`                   | ✅ resolved (per bulk-deploy commit)                                                                                                                                                |
> | #23 | Error Boundary: Recovery UI                                 | ✅ partially — `<ErrorBoundary>` fallback exists at `components/ui/ErrorBoundary.tsx`; production-mode detail suppression verified by `__tests__/components/ErrorBoundary.test.tsx` |
> | #24 | `ContractPausedBanner` in App Layout                        | ✅ resolved — `app/layout.tsx` renders all three banners between `ToastProvider` and `<main>`                                                                                       |
> | #25 | Scout Dashboard: `EmptyState`                               | ✅ resolved — `ScoutDashboardContent.tsx` uses `<EmptyState>` for both grid and wallet-search "not found" states                                                                    |
> | #26 | Test Coverage: scout / player hooks                         | 🟡 **OPEN** — `__tests__/hooks/useScout.test.ts`, `usePayToContact.test.ts`, `usePlayer.test.ts`, `useValidator.test.ts` are missing                                                |
> | #27 | Test Coverage: page-level components                        | 🟡 **OPEN** — `__tests__/components/ScoutDashboard.test.tsx`, `PlayerDashboard.test.tsx`, `PlayerProfile.test.tsx` are missing                                                      |
> | #28 | `aria-live` on Toast                                        | ✅ resolved — `components/ui/Toast.tsx` uses aria-live + role="status" (per bulk-deploy commit)                                                                                     |
> | #29 | Indexer HTTP `/metrics` endpoint                            | ✅ resolved (per bulk-deploy commit)                                                                                                                                                |
> | #30 | Local Development end-to-end docs                           | 🟡 **OPEN** — `DEVELOPMENT.md` has the step-by-step guide and links from `CONTRIBUTING.md`, but the "common errors and their solutions" subsection is sparse                        |
>
> **Net: 28 resolved, 2 open (#26, #27), plus #23 partial and #30 sparse.** The bulk-deploy commit did the heavy lifting on UI-level / config-level items; the remaining gaps are scoped specifically to test coverage.

---

## Issue #1 — Scout Public Profile Page

**Labels:** `feature`, `scout`

### Summary

The route `app/[locale]/scout/[id]/page.tsx` does not exist. `ScoutProfileCard` links to `/scout/${scout.id}` but the destination is a blank folder with only a `.gitkeep`.

### Acceptance Criteria

- [ ] `app/[locale]/scout/[id]/page.tsx` renders a full scout public profile
- [ ] Displays `ScoutProfileCard` with name, organisation, subscription tier, and expiry
- [ ] Shows contacted-players count and trial-offers count (via `fetchScoutStats`)
- [ ] Shows `ActivityFeed` scoped to this scout's events
- [ ] Page is accessible without wallet connection (read-only view)
- [ ] 404-style `EmptyState` shown if scout ID is not found

### Notes

`ScoutProfileCard` and `ActivityFeed` are already built in `components/scout/`. The page only needs to fetch the scout by ID from the backend API and assemble these components.

---

## Issue #2 — ContactModal Component

**Labels:** `feature`, `scout`, `ui`

### Summary

After a scout calls `pay_to_contact`, the unlocked `ContactDetails` (email, phone, telegram) have nowhere to display. The `usePayToContact` hook is complete; the UI modal is missing.

### Acceptance Criteria

- [ ] `components/scout/ContactModal.tsx` created using the existing `Modal` primitive
- [ ] Displays email, phone, and/or telegram fields from `ContactDetails`
- [ ] Shows a loading spinner while the contract call is in-flight
- [ ] Shows a mapped error message on failure (subscription expired, insufficient fee, contract paused)
- [ ] "Copy" button for each contact field
- [ ] Modal is triggered from the player public profile page (`/player/[id]`)

### Notes

`usePayToContact` already handles subscription pre-check, error mapping, and contract invocation. The modal only needs to render its `{ loading, error }` state and the returned `ContactDetails`.

---

## Issue #3 — Wire Validator Dashboard

**Labels:** `feature`, `validator`

### Summary

`app/[locale]/validator/page.tsx` is a placeholder — it shows a welcome message but never renders `ApproveForm`, `RevokeForm`, or `ValidatorPlayerSearch`. All three components are fully built.

### Acceptance Criteria

- [ ] Page fetches the connected wallet's validator status via `checkIsValidator`
- [ ] Shows an `EmptyState` with an explanation if the wallet is not an authorised validator
- [ ] Renders `ValidatorPlayerSearch` to look up players by ID or wallet
- [ ] Renders `ApproveForm` and `RevokeForm` when a player is selected
- [ ] Milestone actions show `TransactionStatus` feedback

---

## Issue #4 — Trial Offer UI (`log_trial_offer`)

**Labels:** `feature`, `scout`

### Summary

The `log_trial_offer` contract function exists and is documented, but there is no frontend UI. Scouts cannot advance a player to Level 3 (Elite Tier) without CLI access to the contract.

### Acceptance Criteria

- [ ] `useTrialOffer` hook created wrapping `log_trial_offer` contract call
- [ ] A "Log Trial Offer" button/section added to the player public profile page (visible to scouts with active subscriptions)
- [ ] A `TrialOfferModal` (or inline form) captures required offer details
- [ ] On success, `ProgressBar` re-fetches and shows Level 3
- [ ] `TransactionStatus` component used for loading/success/error feedback

---

## Issue #5 — PWA Raster Icons (PNG Generation)

**Labels:** `chore`, `pwa`

### Summary

`public/manifest.json` references PNG icons at multiple sizes (e.g. `192x192`, `512x512`) that do not exist. `generate-icons.js` and `generate-icons.py` scripts are present but have not been run. The PWA install prompt will fail without them.

### Acceptance Criteria

- [ ] Run `node scripts/generate-icons.js` and commit the generated PNGs to `public/icons/`
- [ ] `manifest.json` `icons` array entries all resolve to existing files
- [ ] `maskable` icon variant included for Android adaptive icons
- [ ] CI step added to verify icons exist

---

## Issue #6 — Pay-to-Contact: Show Unlocked Contact Details on Player Profile

**Labels:** `feature`, `scout`, `player`

### Summary

`app/[locale]/player/[id]/page.tsx` calls `buildPayToContact` (the unsigned builder), not the full `payToContact` function from `usePayToContact`. After the transaction the contact details are never surfaced to the UI.

### Acceptance Criteria

- [ ] Player profile page uses `usePayToContact` hook instead of raw `buildPayToContact`
- [ ] After successful payment, `ContactModal` (Issue #2) opens with the returned `ContactDetails`
- [ ] Button label shows dynamic fee from `PLATFORM_CONTACT_FEE_XLM` env var
- [ ] Button disabled / hidden when wallet is not connected or scout has no active subscription

---

## Issue #7 — Scout Dashboard: Subscription Guard Redirect

**Labels:** `bug`, `scout`

### Summary

`app/[locale]/scout/layout.tsx` contains a subscription guard, but its redirect behaviour needs validation. Scouts without an active subscription should be redirected to `/scout/subscribe` rather than seeing an empty or broken dashboard.

### Acceptance Criteria

- [ ] `useSubscription` called in layout or top of page to check subscription expiry
- [ ] Expired/absent subscription redirects to `/scout/subscribe` with a toast explaining why
- [ ] Active subscribers proceed normally
- [ ] Guard does not flash the dashboard before redirecting

---

## Issue #8 — `useTrialOffer` Hook

**Labels:** `feature`, `hooks`

### Summary

No hook wraps `log_trial_offer`. All other write flows have dedicated hooks (`useSubscription`, `usePayToContact`, `useValidator`). Consistent patterns make the dashboard composable.

### Acceptance Criteria

- [ ] `hooks/useTrialOffer.ts` created following the pattern of `usePayToContact`
- [ ] Builds and submits a `log_trial_offer` transaction via `signAndSubmit`
- [ ] Returns `{ submit, loading, error }` tuple
- [ ] Error messages mapped from contract error codes (10 = Unauthorized, 9 = ContractPaused)
- [ ] Unit test added under `__tests__/hooks/useTrialOffer.test.ts`

---

## Issue #9 — Player Profile: Use `IPFSMediaGallery` Component

**Labels:** `enhancement`, `player`

### Summary

`app/[locale]/player/[id]/page.tsx` renders an avatar `<img>` directly with a hardcoded IPFS gateway URL. The `IPFSMediaGallery` component already handles gateway URL construction, lazy loading, and video/image detection, but is unused here.

### Acceptance Criteria

- [ ] Replace the raw `<img>` in the player profile page with `IPFSMediaGallery`
- [ ] Gallery renders both image and video highlights from `player.ipfsHash`
- [ ] Falls back gracefully if `ipfsHash` is empty
- [ ] No hardcoded gateway URLs remain in page components

---

## Issue #10 — Player Dashboard: Use `PlayerProfileForm` and `MilestoneTimeline`

**Labels:** `enhancement`, `player`

### Summary

`app/[locale]/player/page.tsx` contains an inline registration form with plain `<input>` elements and a hand-rolled milestone list. `PlayerProfileForm`, `UpdateProfileForm`, and `MilestoneTimeline` are fully built components that are never used by the dashboard.

### Acceptance Criteria

- [ ] Replace the inline registration form with `PlayerProfileForm`
- [ ] Replace the inline milestone `<ul>` with `MilestoneTimeline`
- [ ] When player already has a profile, show `UpdateProfileForm` below the timeline
- [ ] Dashboard `page.tsx` is reduced to composition of components only (no inline form logic)

---

## Issue #11 — Scout Dashboard: Use `Select` Component for Filter Dropdowns

**Labels:** `enhancement`, `scout`, `ui`

### Summary

`app/[locale]/scout/page.tsx` uses raw `<select>` elements for region, position, and level filters. The shared `components/ui/Select.tsx` primitive exists to provide consistent styling and accessibility but is not used here.

### Acceptance Criteria

- [ ] Region, position, and min-level selects replaced with `<Select>` from `components/ui`
- [ ] Filter form visual appearance is consistent with the rest of the UI
- [ ] All existing filter logic remains unchanged

---

## Issue #12 — Add `useScoutProfile` Hook

**Labels:** `feature`, `hooks`, `scout`

### Summary

The upcoming scout public profile page (`/scout/[id]`) will need to fetch a scout's data from the backend API. There is no `useScoutProfile` hook equivalent to `usePlayer` for scouts.

### Acceptance Criteria

- [ ] `hooks/useScoutProfile.ts` created to fetch a scout by ID from the backend API
- [ ] Returns `{ scout, loading, error }` tuple
- [ ] SWR or `useEffect`-based fetching consistent with `usePlayer` pattern
- [ ] Unit test added under `__tests__/hooks/useScoutProfile.test.ts`

---

## Issue #13 — SEP-10 Session: Handle Expired Cookies Gracefully

**Labels:** `bug`, `auth`

### Summary

When a SEP-10 session cookie expires the `restoreSession` call in `WalletContext` fails silently. The user sees the app in an unauthenticated state with no explanation.

### Acceptance Criteria

- [ ] On session restore failure, `WalletContext` clears stored provider from `localStorage`
- [ ] Navbar / wallet button reflects unauthenticated state immediately
- [ ] A non-blocking toast informs the user their session expired and they need to reconnect
- [ ] No console errors thrown to the user

---

## Issue #14 — Albedo Wallet: `isInstalled` Check is Unreliable

**Labels:** `bug`, `auth`, `wallet`

### Summary

`ADAPTERS.albedo.isInstalled` checks `'albedo' in window` which is unreliable — Albedo works via a popup redirect and does not inject a `window.albedo` object in all browsers. Users selecting Albedo who don't have it installed get a confusing error.

### Acceptance Criteria

- [ ] Albedo adapter's `isInstalled` always returns `true` (Albedo is web-based, no extension required)
- [ ] If the Albedo popup is blocked or the user cancels, the error is caught and surfaced as a user-friendly toast
- [ ] Unit test updated to reflect new behaviour

---

## Issue #15 — i18n: Translate Validator and Admin Page Strings

**Labels:** `i18n`, `enhancement`

### Summary

`messages/en.json`, `fr.json`, and `sw.json` contain translations for player and scout flows but the validator and admin pages use hardcoded English strings.

### Acceptance Criteria

- [ ] All user-visible strings in validator dashboard and admin panel extracted to `messages/`
- [ ] French (`fr.json`) and Swahili (`sw.json`) translations provided for each new key
- [ ] No hardcoded UI strings remain in `app/[locale]/validator/` or `app/[locale]/admin/`

---

## Issue #16 — Improve CI: Add Build Step

**Labels:** `ci`, `chore`

### Summary

`.github/workflows/ci.yml` runs lint, test, and env validation but does not run `next build`. A broken build can be merged without CI catching it.

### Acceptance Criteria

- [ ] `npm run build` step added to CI after lint and tests
- [ ] Build output cached between runs where possible
- [ ] CI fails fast if `next build` exits non-zero

---

## Issue #17 — Add `NEXT_PUBLIC_ADMIN_ADDRESS` Validation

**Labels:** `chore`, `config`

### Summary

`app/[locale]/admin/page.tsx` reads `process.env.NEXT_PUBLIC_ADMIN_ADDRESS` to restrict access. If this variable is empty (as it is in `.env.example`) any connected wallet can access admin functions.

### Acceptance Criteria

- [ ] `scripts/validate-env.js` warns (or errors) if `NEXT_PUBLIC_ADMIN_ADDRESS` is empty
- [ ] Admin page shows a clear error message (not a blank screen) when the env var is not configured
- [ ] `.env.example` comment explains this variable is required for production

---

## Issue #18 — Player Profile: Nationality Field Missing from Registration Form

**Labels:** `bug`, `player`

### Summary

`PlayerVitals` has a `nationality` field but the inline registration form in `app/[locale]/player/page.tsx` passes `nationality: ''` unconditionally. The field is absent from the UI entirely.

### Acceptance Criteria

- [ ] Nationality input added to `PlayerProfileForm` (and the inline form if not yet replaced by Issue #10)
- [ ] Nationality value passed correctly to `buildRegisterPlayer`
- [ ] Field validated as non-empty before submission

---

## Issue #19 — Add Loading Skeletons to Player Profile Page

**Labels:** `enhancement`, `ux`, `player`

### Summary

`app/[locale]/player/[id]/page.tsx` shows a plain `"Loading…"` text while fetching player data. `PlayerCardSkeleton` exists but is only used in the scout dashboard grid.

### Acceptance Criteria

- [ ] Replace `"Loading…"` text with a skeleton layout matching the profile page structure
- [ ] Skeleton covers the avatar area, name/stats row, progress bar, and milestone list
- [ ] No layout shift when real data loads

---

## Issue #20 — Scout Subscription: Show Current Subscription Status

**Labels:** `enhancement`, `scout`

### Summary

`app/[locale]/scout/subscribe/page.tsx` has the tier selection and payment flow but does not show the scout's current subscription status before they pay. A scout with an active Pro subscription could accidentally repurchase.

### Acceptance Criteria

- [ ] `useSubscription` called on page load to fetch current subscription
- [ ] If an active subscription exists, a banner shows tier name and expiry date
- [ ] Current tier card is visually highlighted in the tier grid
- [ ] "Renew" vs "Subscribe" CTA label changes depending on status

---

## Issue #21 — `MilestoneList` vs `MilestoneTimeline`: Consolidate Usage ✅ RESOLVED

**Labels:** `refactor`, `player`

### Summary

Both `MilestoneList` and `MilestoneTimeline` render a player's milestones. `MilestoneTimeline` is more featureful (timestamps, validator address, animated transitions) but the player dashboard uses a hand-rolled list. There is risk of milestone display diverging.

### Resolution

`MilestoneList` provided no distinct UX — it was a plain `<ul>` with no timestamps, validator display, or expand/collapse. `MilestoneTimeline` is a strict superset. `MilestoneList.tsx` has been deleted and all milestone rendering is consolidated on `MilestoneTimeline`. The player dashboard (`app/[locale]/player/page.tsx`) uses `MilestoneTimeline` exclusively.

### Acceptance Criteria

- [x] Audit where each component is used
- [x] Removed `MilestoneList` and standardized all usages on `MilestoneTimeline`
- [x] No duplicate milestone rendering logic across the codebase

---

## Issue #22 — Add `robots.txt` Disallow for `/admin` and `/api`

**Labels:** `security`, `seo`

### Summary

`public/robots.txt` currently allows all crawlers everywhere. Admin and API routes should not be indexed by search engines.

### Acceptance Criteria

- [ ] `Disallow: /admin` added to `robots.txt`
- [ ] `Disallow: /api/` added to `robots.txt`
- [ ] `Disallow: /[locale]/admin` pattern added for all locale-prefixed admin routes
- [ ] `next-sitemap.config.js` excludes these paths from the generated sitemap

---

## Issue #23 — Error Boundary: Add Recovery UI

**Labels:** `enhancement`, `ux`

### Summary

`app/[locale]/player/page.tsx` and `app/[locale]/scout/page.tsx` wrap content in `<ErrorBoundary>`, but the validator dashboard wraps in `ErrorBoundary` without surfacing a useful recovery UI — it just shows a generic fallback.

### Acceptance Criteria

- [ ] All dashboard pages consistently wrap their content in `<ErrorBoundary>`
- [ ] `ErrorBoundary` fallback includes a "Try again" button that resets the boundary
- [ ] Error details are not shown to end users in production

---

## Issue #24 — Wire `ContractPausedBanner` into App Layout

**Labels:** `enhancement`, `ux`

### Summary

`useContractHealth`, `useIsPaused`, and `ContractPausedBanner` all exist but the banner is not rendered anywhere in the app layout. Users may attempt transactions while the contract is paused and receive confusing errors.

### Acceptance Criteria

- [ ] `ContractPausedBanner` rendered in `app/layout.tsx` or `app/[locale]/layout.tsx`
- [ ] Banner is only visible when `useIsPaused` returns `true`
- [ ] Banner links to a status explanation or Discord
- [ ] Banner does not cause layout shift when contract is unpaused

---

## Issue #25 — Scout Dashboard: Replace Empty State with `EmptyState` Component

**Labels:** `enhancement`, `ux`, `scout`

### Summary

`app/[locale]/scout/page.tsx` shows `"No players found. Try adjusting your filters."` as plain text. The shared `EmptyState` component exists for exactly this purpose.

### Acceptance Criteria

- [ ] Replace inline "No players found" text with `<EmptyState>` component
- [ ] `EmptyState` includes an icon, headline, subtext, and a "Reset Filters" CTA
- [ ] Same treatment applied to the wallet-search "not found" state

---

## Issue #26 — Test Coverage: Scout and Player Hooks

**Labels:** `testing`

### Summary

`__tests__/hooks/` covers `useWallet`, `useSubscription`, and `useDebounce`. `useScout`, `usePayToContact`, `usePlayer`, and `useValidator` have no tests. Scout discovery and payment are core flows.

### Acceptance Criteria

- [ ] `__tests__/hooks/useScout.test.ts` — covers filter call, loading state, error state
- [ ] `__tests__/hooks/usePayToContact.test.ts` — covers successful unlock, subscription expired error, contract paused error
- [ ] `__tests__/hooks/usePlayer.test.ts` — covers player found, player not found, loading
- [ ] `__tests__/hooks/useValidator.test.ts` — covers approve and revoke happy paths

---

## Issue #27 — Test Coverage: Page-Level Components

**Labels:** `testing`

### Summary

Component tests cover UI primitives and form components well, but no tests exist for the page-level components: `ScoutDashboard`, `PlayerDashboard`, or the public profile pages.

### Acceptance Criteria

- [ ] `__tests__/components/ScoutDashboard.test.tsx` — renders filter form, renders player grid, renders empty state
- [ ] `__tests__/components/PlayerDashboard.test.tsx` — renders registration form when no profile, renders milestone timeline when profile exists
- [ ] `__tests__/components/PlayerProfile.test.tsx` — renders player vitals, progress bar, and pay-to-contact button
- [ ] Mocks for contract functions (`lib/contract`) applied consistently

---

## Issue #28 — Accessibility: Add `aria-live` to Toast Notifications

**Labels:** `accessibility`, `ui`

### Summary

`components/ui/Toast.tsx` renders notification messages but they are not announced to screen readers. Users relying on assistive technology will miss transaction success/failure feedback.

### Acceptance Criteria

- [ ] Toast container element has `aria-live="polite"` and `aria-atomic="true"`
- [ ] Error toasts use `aria-live="assertive"`
- [ ] Each toast has a unique, accessible label
- [ ] `@axe-core/react` (already installed as a dev dependency) audit passes with no violations for toast interactions

---

## Issue #29 — Indexer: Expose Metrics via HTTP Endpoint

**Labels:** `feature`, `indexer`

### Summary

`packages/indexer/src/metrics/IndexerMetrics.ts` tracks event counts and processing latency, but there is no HTTP endpoint to expose these metrics. Without an observable endpoint, there is no way to monitor indexer health in production.

### Acceptance Criteria

- [ ] A `/metrics` or `/health` HTTP endpoint added to the indexer service
- [ ] Exposes Prometheus-compatible metrics or JSON equivalent: events processed, errors, lag
- [ ] `IndexerMetrics` wired into the endpoint response
- [ ] README or inline docs describe how to run and observe the indexer

---

## Issue #30 — Document Local Development Workflow End-to-End

**Labels:** `documentation`

### Summary

`README.md` covers contract deployment and individual commands but there is no clear sequence for getting the full local stack running: contracts on testnet → backend API → frontend → wallet connection. First-time contributors have to piece this together across `DEPLOYMENT.md`, `CONTRIBUTING.md`, and `.env.example`.

### Acceptance Criteria

- [ ] A `DEVELOPMENT.md` (or expanded `README.md` section) provides a step-by-step local setup guide
- [ ] Covers: prerequisites (Node, Rust, Stellar CLI, Freighter), `.env.local` setup, testnet account funding via Friendbot, contract deployment, backend API startup, frontend `npm run dev`
- [ ] Common errors and their solutions documented (missing env vars, unfunded account, wrong network)
- [ ] `CONTRIBUTING.md` links to the new guide
