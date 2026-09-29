/**
 * Thrown when user input fails validation before a contract call is built
 * or submitted (e.g. an invalid Stellar address, or an empty required field).
 *
 * Carries only the standard Error `message` — no extra fields. Callers should
 * catch this to show the validation message to the user without treating it
 * as an on-chain or network failure.
 *
 * @throws Used by `lib/contract.ts` helpers such as `buildRegisterPlayer`,
 *   `buildPayToContact`, and `buildLogTrialOffer` when pre-flight checks fail.
 *
 * @example
 * ```ts
 * try {
 *   await buildPayToContact(scoutKey, playerId);
 * } catch (err) {
 *   if (err instanceof ValidationError) {
 *     toast.error(err.message); // e.g. invalid scoutKey address
 *     return;
 *   }
 *   throw err;
 * }
 * ```
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Thrown when a write helper detects that the on-chain contract is paused
 * and therefore cannot accept mutating transactions.
 *
 * The `message` is always the fixed string `"ContractPaused"`. Callers (or
 * `parseContractError`) should map this to a user-facing maintenance notice
 * rather than a generic failure.
 *
 * @throws Raised before an RPC call when the contract pause flag is set, so
 *   the wallet is never prompted to sign a doomed transaction.
 *
 * @example
 * ```ts
 * try {
 *   await buildRegisterPlayer(wallet, vitals, ipfsHash);
 * } catch (err) {
 *   if (err instanceof ContractPausedError) {
 *     toast.error('The contract is temporarily paused. Try again later.');
 *     return;
 *   }
 *   throw err;
 * }
 * ```
 */
export class ContractPausedError extends Error {
  constructor() {
    super('ContractPaused');
    this.name = 'ContractPausedError';
  }
}

/**
 * Thrown when the deployed contract's self-reported interface version does
 * not match the version this frontend build was written against. See the
 * "Contract Version Compatibility" section in DEVELOPMENT.md for how this
 * is checked and what to do when it fires after a contract migration.
 *
 * Carries only the standard Error `message` describing the mismatch. Checked
 * by `hooks/useContractCompatibility.ts` and `assertContractCompatible` in
 * `lib/contract.ts`.
 *
 * @throws Raised by `assertContractCompatible()` (and thus every write helper
 *   that calls it) when compatibility status is `'incompatible'`.
 *
 * @example
 * ```ts
 * try {
 *   await assertContractCompatible();
 * } catch (err) {
 *   if (err instanceof ContractIncompatibleError) {
 *     // Prompt the user to refresh / upgrade the app build
 *     setCompatibilityError(err.message);
 *     return;
 *   }
 *   throw err;
 * }
 * ```
 */
export class ContractIncompatibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractIncompatibleError';
  }
}

/** Fixed message used by read paths and UI to identify archived Soroban state. */
export const ARCHIVED_ENTRY_MESSAGE =
  'This profile is archived on-chain — the owner can restore it by signing in.';

/** Thrown when Soroban asks for a RestoreFootprint transaction before a read. */
export class ArchivedEntryError extends Error {
  constructor(message = ARCHIVED_ENTRY_MESSAGE) {
    super(message);
    this.name = 'ArchivedEntryError';
  }
}
