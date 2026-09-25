/**
 * CONTRACT WRITE PATTERN — source === signer invariant
 *
 * Every write function in this file MUST pass the same wallet address as both
 * the Stellar transaction source account (fee-payer) and the on-chain
 * authorization signer.  Allowing a different account to fee-bump a write
 * transaction would let a third party craft a transaction that authorises an
 * action on behalf of a signer they do not control.
 *
 * Enforcement: `buildTx` calls `assertSourceMatchesSigner` at entry; any
 * mismatch throws before an RPC call is made.  All public `build*` / action
 * helpers must therefore pass the same key as both arguments.
 */
import {
  SorobanRpc,
  Contract,
  nativeToScVal,
  scValToNative,
  xdr,
  TransactionBuilder as TB,
  Account,
  StrKey,
} from '@stellar/stellar-sdk';
import {
  rpc,
  NETWORK,
  BASE_FEE,
  signAndSubmitTx,
  isValidStellarAddress,
} from './stellar';
import {
  ArchivedEntryError,
  ValidationError,
  ContractIncompatibleError,
} from './errors';
import { CONTACT_FEE_XLM } from './feeSchedule';
import type {
  PlayerVitals,
  ValidatorInfo,
  ContactDetails,
  SubscriptionTier,
  TrialOfferDetails,
  TrialOfferType,
  Milestone,
} from '@/types';

function getContract() {
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID;

  if (!contractId) {
    throw new Error(
      'Missing NEXT_PUBLIC_CONTRACT_ID. Add it to .env.local (copy from .env.example). Example: NEXT_PUBLIC_CONTRACT_ID=CABC... Run node scripts/validate-env.js to verify your environment.',
    );
  }

  return new Contract(contractId);
}

/** XLM required to unlock a player's contact details via pay_to_contact (canonical value from feeSchedule). */
export const PLATFORM_CONTACT_FEE_XLM = CONTACT_FEE_XLM;

/** Human-readable messages for every on-chain error code (codes 1–12). */
export const CONTRACT_ERRORS: Record<number, string> = {
  1: 'Contract is already initialized',
  2: 'Contract is not initialized',
  3: 'Player not found',
  4: 'Unauthorized validator',
  5: 'Invalid milestone data',
  6: 'Player is already at this level',
  7: 'Insufficient fee',
  8: 'Subscription expired',
  9: 'Contract is paused',
  10: 'Unauthorized',
  11: 'No fees to withdraw',
  12: 'Arithmetic overflow',
};

/**
 * Extracts a numeric Soroban contract error code from an error message string.
 * Recognises patterns like `Error(Contract, #9)` and `ContractError(9)`.
 * Returns `null` when no code is found.
 */
export function parseContractError(message: string): Error {
  const match = message.match(
    /Error\(Contract,\s*#(\d+)\)|ContractError\((\d+)\)/,
  );
  if (match) {
    const code = parseInt(match[1] ?? match[2], 10);
    const human = CONTRACT_ERRORS[code];
    return new Error(human ?? `Contract error code ${code}`);
  }
  return new Error(message);
}

/** Lazily import Sentry so it is never loaded in test/development environments. */
async function captureContractError(
  error: unknown,
  context: Record<string, unknown>,
) {
  if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development')
    return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.withScope((scope) => {
    scope.setContext('contract', context);
    Sentry.captureException(error);
  });
}

// ── Contract-version compatibility ─────────────────────────────────────────────
//
// The deployed Soroban contract can be upgraded/migrated independently of this
// frontend. Without a check, a mismatched ABI (renamed method, reordered args,
// changed return shape) surfaces as an opaque simulation/build error deep
// inside a multi-step flow — after a user has already uploaded media and
// filled out a form.
//
// `checkContractCompatibility` reads the contract's self-reported interface
// version (if it exposes one) and compares it to `EXPECTED_CONTRACT_VERSION`.
// `assertContractCompatible` is called at the top of `buildTx`, so every
// write helper in this file (`buildRegisterPlayer`, `buildApproveMilestone`,
// etc.) short-circuits before any RPC round-trip when a mismatch is known.
//
// Contracts that don't expose a version query at all are treated as
// "unknown" — not blocked — so first-generation deployments keep working.
//
// Updating this when the contract changes:
//   1. Bump `EXPECTED_CONTRACT_VERSION` in the same PR that updates the
//      `buildTx`/`simulateTx` call shapes in this file to match a new
//      contract ABI.
//   2. If the contract exposes a version bump of its own (e.g. a new
//      `get_contract_version` return value), the two should move together.
//   3. See "Contract Version Compatibility" in DEVELOPMENT.md for the
//      end-to-end migration checklist.

/** Contract ABI/interface version this file's `build*`/`simulateTx` calls target. */
export const EXPECTED_CONTRACT_VERSION = 1;

/** How long a compatibility result is trusted before being re-checked. */
const COMPATIBILITY_CACHE_TTL_MS = 5 * 60 * 1000;

type TransactionSigner = (xdr: string) => Promise<string>;

export type CompatibilityStatus = 'compatible' | 'incompatible' | 'unknown';

export interface ContractCompatibility {
  status: CompatibilityStatus;
  /** The version the deployed contract reports, or `null` if it doesn't expose one. */
  deployedVersion: number | null;
  expectedVersion: number;
  /** User-facing explanation, set only when `status === 'incompatible'`. */
  message: string | null;
}

let compatibilityCache: {
  result: ContractCompatibility;
  checkedAt: number;
} | null = null;
let inFlightCompatibilityCheck: Promise<ContractCompatibility> | null = null;

/**
 * Reads the deployed contract's self-reported interface version via the
 * `get_contract_version` read-only method.
 *
 * Returns `null` — not a thrown error — when the contract doesn't implement
 * this method, or the query otherwise fails, so callers can treat "no
 * version info" as "unknown" rather than "broken".
 */
export async function getContractVersion(): Promise<number | null> {
  try {
    const result = await simulateTx('get_contract_version', []);
    return typeof result === 'number' ? result : null;
  } catch {
    return null;
  }
}

/**
 * Compares the deployed contract's version against {@link EXPECTED_CONTRACT_VERSION}.
 *
 * The result is cached for {@link COMPATIBILITY_CACHE_TTL_MS} so repeated calls
 * (e.g. on every write attempt) don't each incur an RPC round-trip. Concurrent
 * callers during a cache miss share a single in-flight request.
 *
 * @param force - Bypass the cache and re-check immediately. Useful right after
 *                a known contract migration, or from a manual "retry" action.
 */
export async function checkContractCompatibility(
  force = false,
): Promise<ContractCompatibility> {
  const now = Date.now();
  if (
    !force &&
    compatibilityCache &&
    now - compatibilityCache.checkedAt < COMPATIBILITY_CACHE_TTL_MS
  ) {
    return compatibilityCache.result;
  }

  if (!force && inFlightCompatibilityCheck) {
    return inFlightCompatibilityCheck;
  }

  inFlightCompatibilityCheck = (async () => {
    const deployedVersion = await getContractVersion();
    let result: ContractCompatibility;

    if (deployedVersion === null) {
      result = {
        status: 'unknown',
        deployedVersion: null,
        expectedVersion: EXPECTED_CONTRACT_VERSION,
        message: null,
      };
    } else if (deployedVersion === EXPECTED_CONTRACT_VERSION) {
      result = {
        status: 'compatible',
        deployedVersion,
        expectedVersion: EXPECTED_CONTRACT_VERSION,
        message: null,
      };
    } else {
      result = {
        status: 'incompatible',
        deployedVersion,
        expectedVersion: EXPECTED_CONTRACT_VERSION,
        message: `This app (expects contract v${EXPECTED_CONTRACT_VERSION}) is out of sync with the deployed contract (v${deployedVersion}). Please refresh the page or check for an app update before continuing — transactions are disabled until versions match.`,
      };
    }

    compatibilityCache = { result, checkedAt: Date.now() };
    return result;
  })();

  try {
    return await inFlightCompatibilityCheck;
  } finally {
    inFlightCompatibilityCheck = null;
  }
}

/** Clears the cached compatibility result, forcing the next check to hit the RPC again. */
export function clearContractCompatibilityCache(): void {
  compatibilityCache = null;
  inFlightCompatibilityCheck = null;
}

/**
 * Throws {@link ContractIncompatibleError} if the deployed contract is known
 * to be incompatible with this app build. Called at the top of `buildTx` so
 * every write helper short-circuits before building or simulating a
 * transaction. `'unknown'` and `'compatible'` both proceed — an unknown
 * result means the contract doesn't expose version info, which is treated
 * as "proceed with caution" rather than blocking every user.
 */
export async function assertContractCompatible(): Promise<void> {
  const { status, message } = await checkContractCompatibility();
  if (status === 'incompatible') {
    throw new ContractIncompatibleError(
      message ?? 'Deployed contract is incompatible with this app version.',
    );
  }
}

// ── Write helper (requires a real funded account) ─────────────────────────────

/** Enforces the source === signer invariant before any RPC call is made. */
function assertSourceMatchesSigner(
  sourcePublicKey: string,
  authSigner: string,
): void {
  if (sourcePublicKey !== authSigner) {
    throw new Error(
      `Source and signer must match: source=${sourcePublicKey} signer=${authSigner}`,
    );
  }
}

async function buildTx(
  method: string,
  args: xdr.ScVal[],
  sourcePublicKey: string,
  authSigner: string = sourcePublicKey,
  restoreSignFn?: TransactionSigner,
) {
  await assertContractCompatible();
  assertSourceMatchesSigner(sourcePublicKey, authSigner);
  const contract = getContract();
  const account = await rpc.getAccount(sourcePublicKey);
  const tx = new TB(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simulation = await rpc.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationRestore(simulation)) {
    if (!restoreSignFn) throw new ArchivedEntryError();

    const restoreTx = new TB(account, {
      fee: simulation.restorePreamble.minResourceFee,
      networkPassphrase: NETWORK,
    })
      .setSorobanData(simulation.restorePreamble.transactionData.build())
      .addOperation(xdr.Operation.restoreFootprint({}))
      .setTimeout(30)
      .build();

    await signAndSubmitTx(restoreTx.toXDR(), restoreSignFn);
  }

  try {
    const prepared = await rpc.prepareTransaction(tx);
    return prepared.toXDR();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw parseContractError(msg);
  }
}

// ── Read-only helper (uses a dummy account — no ledger lookup needed) ─────────
async function simulateTx(method: string, args: xdr.ScVal[]) {
  const contract = getContract();
  const dummyAccount = new Account(
    'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
    '0',
  );
  const tx = new TB(dummyAccount, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
  const result = await rpc.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationRestore(result)) {
    throw new ArchivedEntryError();
  }
  if ('result' in result) return scValToNative(result.result!.retval);
  const errMsg = (result as { error?: string }).error ?? 'Simulation failed';
  throw parseContractError(errMsg);
}

// ── Player ────────────────────────────────────────────────────────────────────

/**
 * Builds a `register_player` transaction XDR without signing or submitting it.
 *
 * Use this when you need the raw XDR for a multi-step signing flow. For the
 * common case of building, signing, and waiting for confirmation in a single
 * call, prefer {@link registerPlayer} instead.
 *
 * @param wallet   - The player's Stellar public key. Used as both the fee-payer
 *                   source account and the on-chain owner address for the new record.
 * @param vitals   - Player vital statistics (name, age, position, region, nationality).
 * @param ipfsHash - IPFS CID of the player's initial highlight-reel video.
 * @returns A Promise resolving to the XDR-encoded transaction string, ready for wallet signing.
 *
 * @throws {ContractError} AlreadyInitialized (1) — A player record already exists for this wallet.
 * @throws {ContractError} NotInitialized (2)     — The contract has not been deployed or initialized.
 * @throws {Error} If the RPC node cannot fetch the source account or prepare the transaction.
 */
export async function buildRegisterPlayer(
  wallet: string,
  vitals: PlayerVitals,
  ipfsHash: string,
  restoreSignFn?: TransactionSigner,
) {
  if (!isValidStellarAddress(wallet)) {
    throw new ValidationError(
      `wallet "${wallet}" is not a valid Stellar address`,
    );
  }
  return buildTx(
    'register_player',
    [
      nativeToScVal(wallet, { type: 'address' }),
      nativeToScVal(vitals),
      nativeToScVal(ipfsHash, { type: 'string' }),
    ],
    wallet,
    wallet,
    restoreSignFn,
  );
}

/**
 * Builds a transaction to update a player's IPFS media hash.
 *
 * @param wallet - The caller's wallet public key. Must match the player's registered wallet address.
 *                 Authorization is enforced on-chain; transactions from mismatched wallets will fail.
 * @param playerId - The unique identifier of the player to update.
 * @param ipfsHash - The new IPFS hash for the player's media content.
 * @returns A Promise that resolves to the XDR-encoded transaction string.
 *
 * @throws {ContractError} Throws error code 10 (Unauthorized) if the caller's wallet does not match
 *                         the player's registered wallet address. This check is performed on-chain
 *                         when the transaction is executed.
 */
export async function buildUpdateProfile(
  wallet: string,
  playerId: string,
  ipfsHash: string,
  restoreSignFn?: TransactionSigner,
) {
  return buildTx(
    'update_profile',
    [
      nativeToScVal(playerId, { type: 'string' }),
      nativeToScVal(ipfsHash, { type: 'string' }),
    ],
    wallet,
    wallet,
    restoreSignFn,
  );
}

/**
 * Fetches a single player record from the contract by its unique ID.
 *
 * Player IDs are opaque strings assigned by the contract at registration time
 * (returned by {@link registerPlayer}). They are distinct from the player's
 * Stellar wallet address.
 *
 * The returned object is deserialized from the on-chain Soroban value and
 * conforms to the {@link Player} interface:
 * - `id`            — The player's unique contract identifier.
 * - `wallet`        — The player's registered Stellar public key.
 * - `vitals`        — Name, age, position, region, and nationality.
 * - `ipfsHash`      — IPFS CID of the most recently uploaded highlight reel.
 * - `progressLevel` — Current level (0 = Unverified … 3 = Elite Tier).
 * - `milestones`    — Ordered array of approved {@link Milestone} records.
 * - `createdAt`     — Unix timestamp (seconds) of the registration ledger close.
 *
 * @param playerId - The unique player identifier string, as returned by
 *                   {@link registerPlayer} or stored in a `Player.id` field.
 * @returns A Promise resolving to the full {@link Player} record.
 *
 * @throws {ContractError} PlayerNotFound (3) — No player exists with the given `playerId`.
 * @throws {Error} If the RPC simulation request fails or returns an unexpected result.
 */
export async function getPlayer(playerId: string) {
  return simulateTx('get_player', [
    nativeToScVal(playerId, { type: 'string' }),
  ]);
}

// ── Validator ─────────────────────────────────────────────────────────────────

/**
 * Builds an `approve_milestone` transaction XDR without signing or submitting it.
 *
 * The transaction increments the target player's `progressLevel` by one step and
 * records the milestone description and the approving validator's address on-chain.
 * Authorization is enforced by the contract: the caller must be listed as an active
 * validator at the time the signed transaction is executed.
 *
 * @param validatorKey - Stellar public key of the validator approving the milestone.
 *                       Must be registered in the contract via {@link buildAddValidator}.
 * @param playerId     - Unique identifier of the player whose milestone is being approved.
 * @param milestone    - Description string for the milestone (e.g. `"Professional contract signed"`).
 * @returns A Promise resolving to the XDR-encoded transaction string, ready for wallet signing.
 *
 * @throws {ContractError} UnauthorizedValidator (4) — The `validatorKey` is not an authorized validator.
 * @throws {ContractError} PlayerNotFound (3)        — No player exists with the given `playerId`.
 * @throws {ContractError} AlreadyAtLevel (6)        — The player has already reached the maximum progress level.
 * @throws {Error} If the RPC node cannot fetch the source account or prepare the transaction.
 */
export async function buildApproveMilestone(
  validatorKey: string,
  playerId: string,
  milestone: string,
  restoreSignFn?: TransactionSigner,
) {
  if (!isValidStellarAddress(validatorKey)) {
    throw new ValidationError(
      `validatorKey "${validatorKey}" is not a valid Stellar address`,
    );
  }
  return buildTx(
    'approve_milestone',
    [
      nativeToScVal(playerId, { type: 'string' }),
      nativeToScVal(milestone, { type: 'string' }),
      nativeToScVal(validatorKey, { type: 'address' }),
    ],
    validatorKey,
    validatorKey,
    restoreSignFn,
  );
}

/**
 * Checks whether a Stellar address is currently registered as an authorized validator.
 *
 * This is a read-only simulation — no transaction is built or submitted.
 * Prefer this over filtering the result of {@link getValidators} when you only
 * need to test a single address, as it avoids fetching the full validator list.
 *
 * @param address - The Stellar public key to check.
 * @returns A Promise resolving to `true` if the address is an active validator,
 *          `false` otherwise.
 *
 * @throws {Error} If the RPC simulation request fails or returns an unexpected result.
 */
export async function checkIsValidator(address: string) {
  return simulateTx('is_validator', [
    nativeToScVal(address, { type: 'address' }),
  ]);
}

/**
 * Retrieves the full milestone history for a player.
 *
 * Returns all approved {@link Milestone} records in ascending chronological order
 * (oldest first, sorted by `timestamp`). The array is empty for players with no
 * approved milestones yet.
 *
 * @param playerId - Unique identifier of the player whose milestone history is requested.
 * @returns A Promise resolving to an ordered array of {@link Milestone} records.
 *          Each entry includes `id`, `description`, `evidenceHash`, `validator`, and
 *          `timestamp` fields.
 *
 * @throws {ContractError} PlayerNotFound (3) — No player exists with the given `playerId`.
 * @throws {Error} If the RPC simulation request fails or returns an unexpected result.
 */
export async function getMilestoneHistory(playerId: string) {
  return simulateTx('get_milestone_history', [
    nativeToScVal(playerId, { type: 'string' }),
  ]);
}

/**
 * Retrieves milestone history for multiple players in a single RPC round-trip.
 *
 * Calls the contract's `get_milestone_history_batch` method, which accepts a
 * vector of player IDs and returns a map of `playerId -> Milestone[]` in one
 * simulation. This exists specifically to avoid the N-RPC-calls-per-render
 * fan-out that comes from calling {@link getMilestoneHistory} once per
 * player card — callers that need milestone data for a whole visible batch
 * of players (e.g. a scout results grid) should call this instead of
 * `Promise.all`-ing individual `getMilestoneHistory` calls.
 *
 * If the deployed contract does not yet expose `get_milestone_history_batch`
 * (e.g. mid-rollout, before the contract-side method is deployed), this
 * falls back to fetching each player's history individually via
 * `Promise.all`, so callers keep working — just without the RPC-count win —
 * until the batch method is live.
 *
 * @param playerIds - Player IDs to fetch milestone history for. Duplicate
 *                     IDs are de-duplicated before the call. An empty array
 *                     short-circuits to `{}` without any RPC call.
 * @returns A Promise resolving to a map keyed by player ID, each value an
 *          ordered array of {@link Milestone} records (empty array for a
 *          player with no approved milestones).
 * @throws {Error} If the RPC simulation request fails for a reason other
 *                  than the batch method being unavailable.
 */
export async function getMilestoneHistoryBatch(
  playerIds: string[],
): Promise<Record<string, Milestone[]>> {
  const uniqueIds = Array.from(new Set(playerIds));
  if (uniqueIds.length === 0) return {};

  try {
    const result = await simulateTx('get_milestone_history_batch', [
      nativeToScVal(uniqueIds),
    ]);
    return (result ?? {}) as Record<string, Milestone[]>;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // A real on-chain error (e.g. contract paused) is already normalized to
    // one of CONTRACT_ERRORS' human-readable messages by parseContractError
    // — those should still surface to the caller. Anything else is treated
    // as "the deployed contract doesn't expose this batch method yet" and
    // falls back to per-player calls instead of breaking the page.
    if (Object.values(CONTRACT_ERRORS).includes(msg)) {
      throw err;
    }
    const entries = await Promise.all(
      uniqueIds.map(async (id) => [id, await getMilestoneHistory(id)] as const),
    );
    return Object.fromEntries(entries) as Record<string, Milestone[]>;
  }
}

/**
 * Retrieves the contract's self-reported health status.
 *
 * Executes the `health` read-only contract method via simulation. The returned
 * value is the raw deserialized Soroban response — a truthy result indicates the
 * contract is live and responding normally. Callers should treat a falsy or thrown
 * result as a signal that the contract may be degraded or unreachable.
 *
 * This function does not check the paused state; use {@link getContractPaused}
 * to determine whether write operations are currently blocked.
 *
 * @returns A Promise resolving to the health status value reported by the contract.
 *          A truthy result indicates normal operation.
 *
 * @throws {Error} If the RPC simulation request fails, the contract is not deployed,
 *                 or the response cannot be deserialized.
 */
export async function getContractHealth() {
  return simulateTx('health', []);
}

/**
 * Build and sign a `register_player` transaction, submit it, and wait for confirmation.
 *
 * @param wallet - The player's Stellar public key (source + auth).
 * @param vitals - Player vitals: name, age, position, region, nationality.
 * @param ipfsHash - IPFS CID of the player's initial highlight reel.
 * @param signFn - Wallet-agnostic signing callback; receives the unsigned XDR and returns the signed XDR.
 * @returns The new player ID string assigned by the contract.
 * @throws {ContractError} AlreadyInitialized (1) if the player is already registered.
 * @throws {ContractError} NotInitialized (2) if the contract has not been set up.
 */
export async function registerPlayer(
  wallet: string,
  vitals: PlayerVitals,
  ipfsHash: string,
  signFn: (xdr: string) => Promise<string>,
): Promise<string> {
  const xdrTx = await buildTx(
    'register_player',
    [
      nativeToScVal(wallet, { type: 'address' }),
      nativeToScVal(vitals),
      nativeToScVal(ipfsHash, { type: 'string' }),
    ],
    wallet,
    wallet,
    signFn,
  );
  const result = await signAndSubmitTx(xdrTx, signFn);
  if ('returnValue' in result)
    return scValToNative(result.returnValue!) as string;
  throw new Error(`ContractError: transaction did not return a value`);
}

/**
 * Build and sign an `update_profile` transaction, submit it, and wait for confirmation.
 *
 * @param wallet - The caller's wallet public key (must match the player's registered address).
 * @param playerId - The unique identifier of the player to update.
 * @param ipfsHash - The new IPFS hash for the player's media content.
 * @param signFn - Wallet-agnostic signing callback; receives the unsigned XDR and returns the signed XDR.
 */
export async function updateProfile(
  wallet: string,
  playerId: string,
  ipfsHash: string,
  signFn: (xdr: string) => Promise<string>,
): Promise<void> {
  const xdrTx = await buildTx(
    'update_profile',
    [
      nativeToScVal(playerId, { type: 'string' }),
      nativeToScVal(ipfsHash, { type: 'string' }),
    ],
    wallet,
    wallet,
    signFn,
  );
  await signAndSubmitTx(xdrTx, signFn);
}

// ── Scout ─────────────────────────────────────────────────────────────────────

/**
 * Contract error codes for scout payment flows.
 *
 * | Code | Name                | Description                                              |
 * |------|---------------------|----------------------------------------------------------|
 * |  7   | InsufficientFee     | The XLM fee sent is below the required amount for the    |
 * |      |                     | requested subscription tier or pay-to-contact action.    |
 * |  8   | SubscriptionExpired | The scout's active subscription has passed its expiry    |
 * |      |                     | timestamp and must be renewed before further access.     |
 * |  9   | ContractPaused      | The contract has been administratively paused; all write |
 * |      |                     | operations are blocked until it is unpaused.             |
 */
export const SCOUT_ERROR_CODES = {
  InsufficientFee: 7,
  SubscriptionExpired: 8,
  ContractPaused: 9,
} as const;

/**
 * Builds a `pay_to_contact` transaction XDR without signing or submitting it.
 *
 * Use this when you need the raw XDR for a multi-step signing flow. For the
 * common case of building, signing, waiting for confirmation, and receiving
 * the contact details in one call, prefer {@link payToContact} instead.
 *
 * @param scoutKey - The scout's Stellar public key. Used as both the fee-payer
 *                   source account and the on-chain authorization signer.
 * @param playerId - Unique identifier of the player whose contact details should be unlocked.
 * @returns A Promise resolving to the XDR-encoded transaction string, ready for wallet signing.
 *
 * @throws {ContractError} InsufficientFee (7)     — The XLM amount attached during preparation
 *                                                    is below the required fee for this action.
 * @throws {ContractError} SubscriptionExpired (8) — The scout's active subscription has expired
 *                                                    and must be renewed before contacting players.
 * @throws {ContractError} ContractPaused (9)      — All write operations are blocked while the
 *                                                    contract is administratively paused.
 * @throws {Error} If the RPC node cannot fetch the source account or prepare the transaction.
 */
export async function buildPayToContact(
  scoutKey: string,
  playerId: string,
  restoreSignFn?: TransactionSigner,
) {
  if (!isValidStellarAddress(scoutKey)) {
    throw new ValidationError(
      `scoutKey "${scoutKey}" is not a valid Stellar address`,
    );
  }
  return buildTx(
    'pay_to_contact',
    [
      nativeToScVal(scoutKey, { type: 'address' }),
      nativeToScVal(playerId, { type: 'string' }),
    ],
    scoutKey,
    scoutKey,
    restoreSignFn,
  );
}

/**
 * Builds a `log_trial_offer` transaction XDR without signing or submitting it.
 *
 * Records a scout's trial, loan, or transfer offer against a player on-chain,
 * creating an immutable offer log entry visible to both parties. The scout must
 * hold an active, non-expired subscription at the time the signed transaction
 * is executed.
 *
 * @param scoutKey - The scout's Stellar public key (source account + auth signer).
 * @param playerId - Unique identifier of the player receiving the offer.
 * @param details  - Offer details including `clubName`, `offerType` (`"trial"` | `"loan"` | `"transfer"`),
 *                   and an optional `message`.
 * @returns A Promise resolving to the XDR-encoded transaction string, ready for wallet signing.
 *
 * @throws {ContractError} PlayerNotFound (3)      — No player exists with the given `playerId`.
 * @throws {ContractError} SubscriptionExpired (8) — The scout's subscription has expired and
 *                                                    must be renewed before logging offers.
 * @throws {ContractError} ContractPaused (9)      — All write operations are blocked while the
 *                                                    contract is administratively paused.
 * @throws {Error} If the RPC node cannot fetch the source account or prepare the transaction.
 */
export async function buildLogTrialOffer(
  scoutKey: string,
  playerId: string,
  details: TrialOfferDetails,
  restoreSignFn?: TransactionSigner,
): Promise<string> {
  if (!isValidStellarAddress(scoutKey)) {
    throw new ValidationError(
      `scoutKey "${scoutKey}" is not a valid Stellar address`,
    );
  }
  if (!playerId.trim()) {
    throw new ValidationError('playerId must be a non-empty string');
  }
  return buildTx(
    'log_trial_offer',
    [
      nativeToScVal(scoutKey, { type: 'address' }),
      nativeToScVal(playerId, { type: 'string' }),
      nativeToScVal(details),
    ],
    scoutKey,
    scoutKey,
    restoreSignFn,
  );
}

/**
 * Builds, signs, and submits a `log_trial_offer` transaction, then polls the
 * Soroban Testnet RPC until the transaction is confirmed.
 *
 * This is the full end-to-end helper for recording a trial offer on-chain.
 * It reuses {@link buildLogTrialOffer} for construction (including input
 * validation) and {@link signAndSubmitTx} for signing, submission, and
 * confirmation polling — matching the patterns used by {@link payToContact}
 * and {@link subscribe}.
 *
 * @param scoutKey - The scout's Stellar public key (source account and auth
 *   signer). Must be a valid Ed25519 G-prefixed Stellar public key.
 * @param playerId - Unique identifier of the player receiving the offer.
 *   Must be a non-empty, non-whitespace string.
 * @param details - Structured on-chain record of the offer.
 *   `details.clubName` must be a non-empty string; `details.offerType` must
 *   be one of `"trial"`, `"loan"`, or `"transfer"`.
 * @param signFn - Wallet-agnostic signing callback that receives the unsigned
 *   transaction XDR and returns the signed XDR. For Testnet usage, pass the
 *   Freighter adapter's `signTransaction` (e.g. from `WalletContext`) or any
 *   compatible signer.
 * @returns A Promise that resolves when the trial offer is confirmed on-chain.
 *   Throws on validation failure, signing rejection, submission error, or
 *   confirmation timeout.
 *
 * @throws {TypeError} If `scoutKey` is not a valid Stellar Ed25519 public key.
 * @throws {TypeError} If `playerId` is empty or contains only whitespace.
 * @throws {TypeError} If `details.clubName` is empty or contains only whitespace.
 * @throws {TypeError} If `details.offerType` is not `"trial"`, `"loan"`, or
 *   `"transfer"`.
 * @throws {ContractError} SubscriptionExpired (8) — The scout's active
 *   subscription has passed its expiry timestamp and must be renewed before
 *   trial offers can be logged.
 * @throws {ContractError} ContractPaused (9) — All write operations are blocked
 *   while the contract is administratively paused; try again after it is
 *   unpaused.
 * @throws {Error} If `signFn` rejects (e.g. user dismissed the Freighter
 *   popup or the wallet is not connected).
 * @throws {Error} If the RPC node rejects the submitted transaction.
 * @throws {Error} If the transaction is not confirmed within the polling window
 *   (10 attempts × 1 500 ms).
 */
export async function logTrialOffer(
  scoutKey: string,
  playerId: string,
  details: TrialOfferDetails,
  signFn: (xdr: string) => Promise<string>,
): Promise<void> {
  const xdrTx = await buildLogTrialOffer(
    scoutKey,
    playerId,
    details,
    signFn,
  );
  await signAndSubmitTx(xdrTx, signFn);
}

/**
 * Subscribe a scout to a tier by signing and submitting the transaction.
 *
 * The function handles XLM fee approval by preparing the transaction through the RPC
 * node (which attaches the required fee footprint) before signing. The signed transaction
 * is then submitted to the network and polled until confirmed.
 *
 * @param scout - The scout's Stellar public key (source account + auth signer).
 * @param tier  - The subscription tier to purchase: `"basic"`, `"pro"`, or `"elite"`.
 * @param signFn - Wallet-agnostic signing callback; receives the unsigned XDR and returns the signed XDR.
 * @returns A Promise that resolves when the subscription transaction is confirmed.
 *
 * @throws {ContractError} InsufficientFee (7)     — The XLM amount attached is below the
 *                                                    required fee for the chosen tier.
 * @throws {ContractError} SubscriptionExpired (8) — An existing subscription has expired;
 *                                                    the contract requires a fresh purchase.
 * @throws {ContractError} ContractPaused (9)      — All write operations are blocked while
 *                                                    the contract is administratively paused.
 */
export async function subscribe(
  scout: string,
  tier: SubscriptionTier,
  signFn: (xdr: string) => Promise<string>,
): Promise<void> {
  const xdrTx = await buildTx(
    'subscribe',
    [
      nativeToScVal(scout, { type: 'address' }),
      nativeToScVal(tier, { type: 'string' }),
    ],
    scout,
    scout,
    signFn,
  );
  await signAndSubmitTx(xdrTx, signFn);
}

/**
 * Pay to unlock a player's contact details, signing and submitting the transaction.
 *
 * The function handles XLM fee approval by preparing the transaction through the RPC
 * node before signing. On success the contract returns the player's `ContactDetails` object.
 *
 * @param scout    - The scout's Stellar public key (source account + auth signer).
 * @param playerID - The unique player ID whose contact details should be unlocked.
 * @param signFn   - Wallet-agnostic signing callback; receives the unsigned XDR and returns the signed XDR.
 * @returns A Promise resolving to the player's {@link ContactDetails} (email, phone, telegram).
 *
 * @throws {ContractError} InsufficientFee (7)     — The XLM fee attached is below the
 *                                                    required amount for this action.
 * @throws {ContractError} SubscriptionExpired (8) — The scout's subscription has expired
 *                                                    and must be renewed before contacting players.
 * @throws {ContractError} ContractPaused (9)      — All write operations are blocked while
 *                                                    the contract is administratively paused.
 */
export async function payToContact(
  scout: string,
  playerID: string,
  signFn: (xdr: string) => Promise<string>,
): Promise<ContactDetails> {
  const xdrTx = await buildTx(
    'pay_to_contact',
    [
      nativeToScVal(scout, { type: 'address' }),
      nativeToScVal(playerID, { type: 'string' }),
    ],
    scout,
    scout,
    signFn,
  );
  const result = await signAndSubmitTx(xdrTx, signFn);
  if ('returnValue' in result) {
    return scValToNative(result.returnValue!) as ContactDetails;
  }
  throw new Error(`ContractError: payToContact did not return contact details`);
}

/**
 * Queries the contract for players matching all supplied filter criteria.
 *
 * All three parameters are required by the contract ABI. Pass an empty string
 * for `region` or `position` to match players regardless of that field. Pass
 * `0` for `minLevel` to include players at every progress level.
 *
 * This is a read-only simulation — no transaction is built or submitted.
 *
 * @param region   - Geographic region to filter by (e.g. `"West Africa"`).
 *                   Pass `""` to include players from all regions.
 * @param position - Playing position to filter by (e.g. `"Forward"`).
 *                   Pass `""` to include players of all positions.
 * @param minLevel - Minimum {@link ProgressLevel} a player must have reached
 *                   (0 = Unverified, 1 = Verified Identity, 2 = Performance Milestones,
 *                   3 = Elite Tier). Pass `0` to return players at all levels.
 * @returns A Promise resolving to an array of {@link Player} records that satisfy
 *          all three criteria. Returns an empty array when no players match.
 *
 * @throws {ContractError} ContractPaused (9) — All operations are blocked while the
 *                                               contract is administratively paused.
 * @throws {Error} If the RPC simulation request fails or returns an unexpected result.
 */
export async function filterPlayers(
  region: string,
  position: string,
  minLevel: number,
) {
  return simulateTx('filter_players', [
    nativeToScVal(region, { type: 'string' }),
    nativeToScVal(position, { type: 'string' }),
    nativeToScVal(minLevel, { type: 'u32' }),
  ]);
}

/**
 * Retrieve all validators currently authorized in the contract.
 *
 * @returns An array of ValidatorInfo objects containing validator address and join timestamp.
 */
export async function getValidators(): Promise<ValidatorInfo[]> {
  return simulateTx('get_validators', []);
}

/**
 * Build a transaction to add a new validator to the contract.
 * Only callable by the contract admin wallet.
 *
 * @param adminKey - The admin wallet's Stellar public key.
 * @param address - The Stellar public key of the validator to add.
 * @returns The prepared transaction XDR for signing.
 * @throws {ContractError} Unauthorized (10) if called by a non-admin wallet.
 */
export async function buildAddValidator(adminKey: string, address: string) {
  return buildTx(
    'add_validator',
    [nativeToScVal(address, { type: 'address' })],
    adminKey,
  );
}

/**
 * Build a transaction to remove a validator from the contract.
 * Only callable by the contract admin wallet.
 *
 * @param adminKey - The admin wallet's Stellar public key.
 * @param address - The Stellar public key of the validator to remove.
 * @returns The prepared transaction XDR for signing.
 * @throws {ContractError} Unauthorized (10) if called by a non-admin wallet.
 */
export async function buildRemoveValidator(adminKey: string, address: string) {
  return buildTx(
    'remove_validator',
    [nativeToScVal(address, { type: 'address' })],
    adminKey,
  );
}

/**
 * Builds a `revoke_milestone` transaction XDR without signing or submitting it.
 *
 * Revoking a milestone removes the milestone record from the player's history and
 * decrements their `progressLevel` by one step. This operation requires validator
 * or admin authorization; the contract rejects the signed transaction if the caller
 * is neither an active validator nor the contract admin.
 *
 * @param validatorKey - Stellar public key of the validator or admin initiating the
 *                       revocation. Must be registered via {@link buildAddValidator}
 *                       or be the contract's admin wallet.
 * @param playerId     - Unique identifier of the player whose milestone is being revoked.
 * @param milestoneId  - The `id` field of the {@link Milestone} record to revoke.
 * @returns A Promise resolving to the XDR-encoded transaction string, ready for wallet signing.
 *
 * @throws {ContractError} UnauthorizedValidator (4) — The `validatorKey` is neither an
 *                                                      authorized validator nor the contract admin.
 * @throws {ContractError} PlayerNotFound (3)        — No player exists with the given `playerId`.
 * @throws {ContractError} InvalidMilestone (5)      — No milestone with `milestoneId` exists
 *                                                      on the player's record.
 * @throws {Error} If the RPC node cannot fetch the source account or prepare the transaction.
 */
export async function buildRevokeMilestone(
  validatorKey: string,
  playerId: string,
  milestoneId: string,
  restoreSignFn?: TransactionSigner,
) {
  return buildTx(
    'revoke_milestone',
    [
      nativeToScVal(playerId, { type: 'string' }),
      nativeToScVal(milestoneId, { type: 'string' }),
    ],
    validatorKey,
    validatorKey,
    restoreSignFn,
  );
}

/**
 * Fetches the active subscription record for a scout.
 *
 * Returns `null` (via the `??` guard in callers) when the scout has never
 * subscribed or when their record has been cleared from contract storage.
 * Callers should compare `expiresAt` against `Date.now() / 1000` to determine
 * whether the subscription is still valid.
 *
 * This is a read-only simulation — no transaction is built or submitted.
 *
 * @param scout - The scout's Stellar public key.
 * @returns A Promise resolving to the scout's {@link Subscription} record
 *          (`{ scout, tier, expiresAt }`) or `null` if no record exists.
 *
 * @throws {Error} If the RPC simulation request fails or returns an unexpected result.
 */
export async function getSubscription(scout: string) {
  return simulateTx('get_subscription', [
    nativeToScVal(scout, { type: 'address' }),
  ]);
}

/**
 * Reads the contract's currently configured `pay_to_contact` fee, in XLM.
 *
 * {@link PLATFORM_CONTACT_FEE_XLM} is a build-time constant baked into the
 * frontend; the contract's actual fee configuration can change independently
 * of a frontend deploy. Callers displaying the fee to a scout immediately
 * before they confirm a `pay_to_contact` transaction should prefer this over
 * the static constant, and fall back to labeling the constant as an estimate
 * if this call fails.
 *
 * This is a read-only simulation — no transaction is built or submitted.
 *
 * @returns A Promise resolving to the current contact fee, in XLM.
 * @throws {Error} If the RPC simulation request fails or returns an unexpected result.
 */
export async function getContactFee(): Promise<number> {
  return simulateTx('get_contact_fee', []);
}

// ── Admin ─────────────────────────────────────────────────────────────────────

/**
 * Retrieves the total platform fees accumulated in the contract treasury.
 *
 * Fees are collected in XLM stroops (1 XLM = 10,000,000 stroops) every time a
 * scout completes a `pay_to_contact` or `subscribe` transaction. Only the admin
 * wallet can withdraw them via {@link buildWithdrawFees}.
 *
 * This is a read-only simulation — no transaction is built or submitted.
 *
 * @returns A Promise resolving to the total accumulated fees as a number (in stroops).
 *          Returns `0` when no fees have been collected yet.
 *
 * @throws {Error} If the RPC simulation request fails or returns an unexpected result.
 */
export async function getPlatformFees(): Promise<number> {
  return simulateTx('get_platform_fees', []);
}

/**
 * Builds a `withdraw_fees` transaction XDR without signing or submitting it.
 *
 * Admin-only operation. Transfers all accumulated platform fees from the contract
 * treasury to the admin wallet. The contract rejects the signed transaction if
 * the caller is not the registered admin or if there are no fees to withdraw.
 *
 * @param adminKey - The admin wallet's Stellar public key. Used as both the
 *                   fee-payer source account and the on-chain authorization signer.
 * @returns A Promise resolving to the XDR-encoded transaction string, ready for wallet signing.
 *
 * @throws {ContractError} Unauthorized (10)     — The `adminKey` does not match the contract's
 *                                                  registered admin wallet.
 * @throws {ContractError} NoFeesToWithdraw (11) — The contract treasury balance is zero;
 *                                                  there are no fees available to withdraw.
 * @throws {Error} If the RPC node cannot fetch the source account or prepare the transaction.
 */
export async function buildWithdrawFees(adminKey: string) {
  return buildTx(
    'withdraw_fees',
    [nativeToScVal(adminKey, { type: 'address' })],
    adminKey,
  );
}

/**
 * Builds a `pause_contract` transaction XDR without signing or submitting it.
 *
 * Admin-only operation. When the signed transaction is executed, all write
 * operations on the contract (subscriptions, pay-to-contact, milestone approvals,
 * and revocations) are blocked until the contract is unpaused via
 * {@link buildUnpauseContract}. Read-only calls such as {@link getPlayer} and
 * {@link filterPlayers} remain available while the contract is paused.
 *
 * @param adminKey - The admin wallet's Stellar public key. Used as both the
 *                   fee-payer source account and the on-chain authorization signer.
 * @returns A Promise resolving to the XDR-encoded transaction string, ready for wallet signing.
 *
 * @throws {ContractError} Unauthorized (10)  — The `adminKey` does not match the contract's
 *                                               registered admin wallet.
 * @throws {ContractError} ContractPaused (9) — The contract is already paused; calling pause
 *                                               again is a no-op error.
 * @throws {Error} If the RPC node cannot fetch the source account or prepare the transaction.
 */
export async function buildPauseContract(adminKey: string) {
  return buildTx('pause_contract', [], adminKey);
}

/**
 * Builds an `unpause_contract` transaction XDR without signing or submitting it.
 *
 * Admin-only operation. Reverses a previous {@link buildPauseContract} call,
 * re-enabling all write operations on the contract. If the contract is not
 * currently paused, the signed transaction will be rejected by the contract.
 *
 * @param adminKey - The admin wallet's Stellar public key. Used as both the
 *                   fee-payer source account and the on-chain authorization signer.
 * @returns A Promise resolving to the XDR-encoded transaction string, ready for wallet signing.
 *
 * @throws {ContractError} Unauthorized (10) — The `adminKey` does not match the contract's
 *                                              registered admin wallet.
 * @throws {Error} If the RPC node cannot fetch the source account or prepare the transaction.
 */
export async function buildUnpauseContract(adminKey: string) {
  return buildTx('unpause_contract', [], adminKey);
}

/**
 * Checks whether the contract is currently in a paused state.
 *
 * When the contract is paused all write operations are blocked and any attempt
 * to execute a write transaction will throw {@link ContractError} ContractPaused (9).
 * Read-only operations (e.g. {@link getPlayer}, {@link filterPlayers}) continue
 * to work normally while the contract is paused.
 *
 * Use this alongside {@link getContractHealth} when deciding whether to show
 * the maintenance banner or disable write-action buttons in the UI.
 *
 * This is a read-only simulation — no transaction is built or submitted.
 *
 * @returns A Promise resolving to `true` if the contract is paused and write
 *          operations are blocked, or `false` if the contract is operating normally.
 *
 * @throws {Error} If the RPC simulation request fails or returns an unexpected result.
 */
export async function getContractPaused(): Promise<boolean> {
  return simulateTx('is_paused', []);
}

/**
 * Result of a confirmed revoke milestone operation.
 * Includes both the transaction hash and the final on-chain state.
 */
export interface ConfirmedRevokeResult {
  hash: string;
  confirmed: boolean;
}

/**
 * Submit and confirm a revoke_milestone transaction with explicit polling.
 *
 * This differs from the raw signAndSubmit pattern: it returns only after
 * the transaction is confirmed on a closed ledger, making success/failure
 * states unambiguous.
 *
 * @param validatorKey - The validator's public key (source and signer)
 * @param playerId - The player whose milestone is being revoked
 * @param milestoneId - The milestone being revoked
 * @param signFn - The wallet signing function (from walletAdapter)
 * @returns A Promise resolving to confirmation details including transaction hash and status
 * @throws {TransactionFailedError} If the transaction fails on-chain
 * @throws {TransactionTimeoutError} If confirmation times out
 * @throws {Error} For other transaction errors
 */
export async function submitAndConfirmRevokeMilestone(
  validatorKey: string,
  playerId: string,
  milestoneId: string,
  signFn: (xdr: string) => Promise<string>,
): Promise<ConfirmedRevokeResult> {
  const xdr = await buildRevokeMilestone(
    validatorKey,
    playerId,
    milestoneId,
    signFn,
  );
  const result = await signAndSubmitTx(xdr, signFn);

  return {
    hash: (result as any).hash || '',
    confirmed: true,
  };
}
