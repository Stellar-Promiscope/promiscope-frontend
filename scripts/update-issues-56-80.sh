#!/bin/bash
set -e
R="scout-off/scout-off-frontend"
u() { gh issue edit "$1" --repo "$R" --body "$2"; }

u 56 "## Description
Add a \`parseContractError\` utility to \`lib/contract.ts\` so all hooks can surface human-readable error messages.

## Tasks
- Add \`parseContractError(code: number): string\` to \`lib/contract.ts\`
- Map all 12 error codes from the README to descriptive strings
- Export the function for use in hooks and components

## Additional Requirements
- Return a generic \"Unknown contract error\" for unmapped codes
- The mapping should match the \`CONTRACT_ERRORS\` const in \`types/index.ts\`

## Acceptance Criteria
- [ ] All 12 error codes return the correct human-readable string
- [ ] Unmapped codes return the generic fallback string
- [ ] Function is exported and used in at least one hook"

u 57 "## Description
Add a \`getSubscription\` read function to \`lib/contract.ts\` for fetching a scout's active subscription.

## Tasks
- Add \`getSubscription(scout: string): Promise<Subscription | null>\`
- Return \`null\` when the scout has no subscription
- Return a \`Subscription\` object from \`types/index.ts\` otherwise

## Additional Requirements
- Follow the existing read function pattern in \`lib/contract.ts\`
- Include JSDoc with \`@param\` and \`@returns\` annotations

## Acceptance Criteria
- [ ] Returns correct \`Subscription\` object for a subscribed scout
- [ ] Returns \`null\` for a scout with no subscription
- [ ] JSDoc is present"

u 58 "## Description
Improve \`lib/ipfs.ts\` to retry with fallback gateways when the primary gateway fails.

## Tasks
- Update \`ipfsUrl(cid)\` to accept an optional \`fallbacks: string[]\` parameter
- If the primary gateway (\`NEXT_PUBLIC_IPFS_GATEWAY\`) returns 4xx/5xx, retry with each fallback in order
- Add an 8-second timeout per attempt using \`AbortController\`

## Additional Requirements
- Default fallback list: \`['https://ipfs.io/ipfs', 'https://dweb.link/ipfs']\`
- Log a warning to the console when falling back to a secondary gateway
- Export the fallback list as \`DEFAULT_IPFS_FALLBACKS\` for testing

## Acceptance Criteria
- [ ] Primary gateway is tried first
- [ ] Fallback gateway is used when primary returns 4xx/5xx
- [ ] Request times out after 8 seconds per attempt
- [ ] Console warning logged on fallback
- [ ] All fallbacks exhausted → throws an error"

u 59 "## Description
Add typed chat API helpers to \`lib/api.ts\` for the \`ChatThread\` component.

## Tasks
- Add \`getMessages(scoutID: string, playerID: string): Promise<ChatMessage[]>\`
- Add \`sendMessage(scoutID: string, playerID: string, text: string): Promise<ChatMessage>\`
- Both call the Node.js backend at \`NEXT_PUBLIC_API_URL\`

## Additional Requirements
- Include TypeScript request/response interfaces
- Handle 401 (unauthorized) by clearing the session and redirecting to home
- Handle 404 (conversation not found) by returning an empty array for \`getMessages\`

## Acceptance Criteria
- [ ] \`getMessages\` returns an array of \`ChatMessage\` objects
- [ ] \`sendMessage\` returns the newly created \`ChatMessage\`
- [ ] 401 response clears session and redirects
- [ ] 404 response returns empty array for \`getMessages\`
- [ ] TypeScript interfaces are exported"

u 60 "## Description
Add \`SubscriptionTier\` enum and \`Subscription\` interface to \`types/index.ts\`.

## Tasks
- Add \`export enum SubscriptionTier { Basic = 'basic', Pro = 'pro' }\`
- Add \`export interface Subscription { scout: string; tier: SubscriptionTier; expiresAt: number; }\`

## Additional Requirements
- \`expiresAt\` is a Unix timestamp (seconds)
- Add a JSDoc comment explaining each field

## Acceptance Criteria
- [ ] \`SubscriptionTier\` enum is exported with \`Basic\` and \`Pro\` values
- [ ] \`Subscription\` interface is exported with all three fields
- [ ] JSDoc comments are present on each field"

u 61 "## Description
Add a \`ContactDetails\` interface to \`types/index.ts\` representing the data unlocked after pay-to-contact.

## Tasks
- Add \`export interface ContactDetails { email?: string; phone?: string; telegram?: string; }\`

## Additional Requirements
- At least one field must be present (validated at the contract level, document this in JSDoc)
- Add a JSDoc comment on the interface explaining when it is returned

## Acceptance Criteria
- [ ] \`ContactDetails\` interface is exported
- [ ] All three fields are optional strings
- [ ] JSDoc comment is present"

u 62 "## Description
Add a \`TrialOffer\` interface to \`types/index.ts\` representing a scout's on-chain trial offer.

## Tasks
- Add \`export interface TrialOffer { scout: string; playerID: string; details: string; location: string; startDate: string; timestamp: number; }\`

## Additional Requirements
- \`timestamp\` is a Unix timestamp (seconds)
- \`startDate\` is an ISO 8601 date string
- Add JSDoc comments on each field

## Acceptance Criteria
- [ ] \`TrialOffer\` interface is exported with all six fields
- [ ] JSDoc comments are present on each field"

u 63 "## Description
Add a \`ValidatorInfo\` interface to \`types/index.ts\` representing an approved validator's on-chain record.

## Tasks
- Add \`export interface ValidatorInfo { address: string; addedAt: number; addedBy: string; }\`

## Additional Requirements
- \`addedAt\` is a Unix timestamp (seconds)
- \`addedBy\` is the admin wallet address that authorized this validator
- Add JSDoc comments on each field

## Acceptance Criteria
- [ ] \`ValidatorInfo\` interface is exported with all three fields
- [ ] JSDoc comments are present on each field"

u 64 "## Description
Add a \`ContractError\` interface and \`CONTRACT_ERRORS\` map to \`types/index.ts\` to centralise error code handling.

## Tasks
- Add \`export interface ContractError { code: number; message: string; }\`
- Add \`export const CONTRACT_ERRORS: Record<number, string>\` mapping all 12 error codes from the README

## Additional Requirements
- The map must cover all 12 codes (1–12) as documented in the README
- Export a helper \`isContractError(e: unknown): e is ContractError\` type guard

## Acceptance Criteria
- [ ] \`ContractError\` interface is exported
- [ ] \`CONTRACT_ERRORS\` map contains all 12 entries
- [ ] \`isContractError\` type guard is exported and works correctly"

u 65 "## Description
Add a \`ChatMessage\` interface to \`types/index.ts\` for the chat feature.

## Tasks
- Add \`export interface ChatMessage { id: string; from: string; to: string; text: string; timestamp: number; read: boolean; }\`

## Additional Requirements
- \`from\` and \`to\` are wallet addresses
- \`timestamp\` is a Unix timestamp (milliseconds, to match JS \`Date.now()\`)
- Add JSDoc comments on each field

## Acceptance Criteria
- [ ] \`ChatMessage\` interface is exported with all six fields
- [ ] JSDoc comments are present on each field"

u 66 "## Description
Add unit tests for the \`Navbar\` component to ensure correct rendering and navigation behaviour.

## Tasks
- Create \`__tests__/components/Navbar.test.tsx\`
- Mock \`useWallet\` to control connected/disconnected state
- Mock \`next/navigation\` for \`usePathname\`

## Additional Requirements
- Use \`@testing-library/react\` and \`@testing-library/user-event\`
- All tests must pass with \`npm run test\`

## Acceptance Criteria
- [ ] Renders the ScoutOff logo/link
- [ ] Shows \"Connect Wallet\" button when wallet is disconnected
- [ ] Shows truncated wallet address when wallet is connected
- [ ] Active route link has \`aria-current=\"page\"\`
- [ ] All tests pass"

u 67 "## Description
Add unit tests for the \`WalletButton\` component.

## Tasks
- Create \`__tests__/components/WalletButton.test.tsx\`
- Mock \`useWallet\` hook

## Additional Requirements
- Use \`@testing-library/user-event\` for click simulation

## Acceptance Criteria
- [ ] Renders \"Connect\" text when no wallet is connected
- [ ] Calls \`connect()\` when clicked in disconnected state
- [ ] Shows truncated wallet address when connected
- [ ] Calls \`disconnect()\` when clicked in connected state
- [ ] All tests pass"

u 68 "## Description
Add unit tests for the \`ProgressBar\` component.

## Tasks
- Create \`__tests__/components/ProgressBar.test.tsx\`

## Additional Requirements
- Test all four level values (0–3)

## Acceptance Criteria
- [ ] Level 0 renders a bar at 0% width
- [ ] Level 1 renders a bar at 33% width
- [ ] Level 2 renders a bar at 66% width
- [ ] Level 3 renders a bar at 100% width
- [ ] Correct colour class applied per level
- [ ] \`aria-valuenow\` attribute is set to the correct level value
- [ ] All tests pass"

u 69 "## Description
Add unit tests for the \`PlayerCard\` component.

## Tasks
- Create \`__tests__/components/PlayerCard.test.tsx\`
- Mock \`next/navigation\` for link behaviour

## Additional Requirements
- Provide a mock \`Player\` object covering all fields

## Acceptance Criteria
- [ ] Player name renders correctly
- [ ] Position and region render as Badges
- [ ] Level Badge renders with the correct variant
- [ ] Clicking the card navigates to \`/player/[id]\`
- [ ] Placeholder shown when no IPFS image CID is set
- [ ] All tests pass"

u 70 "## Description
Add unit tests for the \`Badge\` component.

## Tasks
- Create \`__tests__/components/Badge.test.tsx\`

## Acceptance Criteria
- [ ] Renders correct label text for each variant
- [ ] Applies correct Tailwind colour class for each level variant (0–3)
- [ ] Renders as an inline \`<span>\` element
- [ ] \`sm\` and \`md\` sizes produce different class names
- [ ] All tests pass"

u 71 "## Description
Add unit tests for the \`Modal\` component.

## Tasks
- Create \`__tests__/components/Modal.test.tsx\`
- Use \`@testing-library/user-event\` for keyboard and click events

## Acceptance Criteria
- [ ] Children render when \`isOpen=true\`
- [ ] Nothing renders when \`isOpen=false\`
- [ ] Clicking the backdrop calls \`onClose\`
- [ ] Pressing Escape calls \`onClose\`
- [ ] Focus is trapped inside the modal (Tab does not leave)
- [ ] All tests pass"

u 72 "## Description
Add unit tests for the \`Toast\` component and \`useToast\` hook.

## Tasks
- Create \`__tests__/components/Toast.test.tsx\`
- Use Jest fake timers for auto-dismiss testing

## Acceptance Criteria
- [ ] \`useToast().show()\` renders a toast in the DOM
- [ ] Correct icon/colour rendered per variant (success, error, info, warning)
- [ ] Toast auto-dismisses after 4 seconds (verified with \`jest.advanceTimersByTime\`)
- [ ] Manual close button removes the toast immediately
- [ ] All tests pass"

u 73 "## Description
Add unit tests for the \`MilestoneTimeline\` component.

## Tasks
- Create \`__tests__/components/MilestoneTimeline.test.tsx\`
- Provide mock \`Milestone\` array

## Acceptance Criteria
- [ ] Each milestone's description renders
- [ ] Each milestone's timestamp renders (formatted)
- [ ] Validator address is truncated to 8+4 chars
- [ ] EmptyState renders when \`milestones=[]\`
- [ ] All tests pass"

u 74 "## Description
Add unit tests for the \`ContactModal\` component.

## Tasks
- Create \`__tests__/components/ContactModal.test.tsx\`
- Mock \`usePayToContact\` hook

## Acceptance Criteria
- [ ] XLM fee is displayed
- [ ] Clicking Confirm calls \`payToContact\`
- [ ] Contact details (email, phone, Telegram) are shown on success
- [ ] \`InsufficientFee\` error shows the correct message
- [ ] \`SubscriptionExpired\` error shows the correct message with a renew link
- [ ] All tests pass"

u 75 "## Description
Add unit tests for the \`ApproveForm\` component.

## Tasks
- Create \`__tests__/components/ApproveForm.test.tsx\`
- Mock \`useValidator\` hook

## Acceptance Criteria
- [ ] Form fields are disabled when \`isValidator=false\`
- [ ] Submitting with empty fields shows validation errors
- [ ] Invalid evidence URL shows a validation error
- [ ] Submitting valid data calls \`approveMilestone\` with correct arguments
- [ ] Success toast is shown after the transaction confirms
- [ ] All tests pass"

u 76 "## Description
Add unit tests for the \`useWallet\` hook.

## Tasks
- Create \`__tests__/hooks/useWallet.test.ts\`
- Mock \`@stellar/freighter-api\`
- Mock \`localStorage\`

## Acceptance Criteria
- [ ] \`connect()\` sets the wallet address in state
- [ ] \`disconnect()\` clears the wallet address
- [ ] Session is restored from \`localStorage\` on mount
- [ ] Handles Freighter not installed (returns a clear error)
- [ ] All tests pass"

u 77 "## Description
Add unit tests for the \`usePlayer\` hook.

## Tasks
- Create \`__tests__/hooks/usePlayer.test.ts\`
- Mock \`lib/contract.ts\`

## Acceptance Criteria
- [ ] Fetches player data on mount when \`playerID\` is provided
- [ ] \`loading\` is \`true\` during the fetch
- [ ] \`error\` is set when the contract call fails
- [ ] Returns \`null\` for an unknown player ID
- [ ] All tests pass"

u 78 "## Description
Add unit tests for the \`useScout\` hook.

## Tasks
- Create \`__tests__/hooks/useScout.test.ts\`
- Mock \`lib/contract.ts\`

## Acceptance Criteria
- [ ] Calls \`filter_players\` with the correct filter arguments
- [ ] Returns an empty array when no players match
- [ ] Filter changes trigger a new contract call (debounced)
- [ ] \`ContractPaused\` error is surfaced in the \`error\` state
- [ ] All tests pass"

u 79 "## Description
Add unit tests for the \`useSubscription\` hook.

## Tasks
- Create \`__tests__/hooks/useSubscription.test.ts\`
- Mock \`lib/contract.ts\`

## Acceptance Criteria
- [ ] \`isExpired\` is \`true\` when \`expiresAt\` is in the past
- [ ] \`isExpired\` is \`false\` when \`expiresAt\` is in the future
- [ ] \`subscribe(tier)\` calls the contract write function
- [ ] \`InsufficientFee\` error is surfaced in the \`error\` state
- [ ] All tests pass"

u 80 "## Description
Add unit tests for the \`useIPFSUpload\` hook.

## Tasks
- Create \`__tests__/hooks/useIPFSUpload.test.ts\`
- Mock \`fetch\` (or \`XMLHttpRequest\`)

## Acceptance Criteria
- [ ] \`upload(file)\` posts to \`/api/ipfs/upload\`
- [ ] Returns the CID string on a 200 response
- [ ] \`uploading\` is \`true\` during the upload
- [ ] \`error\` is set on a non-200 response
- [ ] Files over 100 MB are rejected before the request is made
- [ ] All tests pass"

echo "Done 56-80"
