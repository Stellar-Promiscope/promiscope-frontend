/**
 * Client-side SEP-10 challenge transaction validation.
 *
 * Runs after the browser receives a challenge XDR from GET /api/auth/sep10 and
 * BEFORE any wallet adapter is asked to sign. A compromised edge, MITM, or
 * buggy challenge handler must not be able to coax the user into signing an
 * arbitrary transaction (payment, setOptions, invokeHostFunction, …) disguised
 * as an auth challenge.
 *
 * Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
 * ("Verifying the Challenge Transaction")
 *
 * This module is intentionally free of React and is dynamically imported from
 * WalletContext so @stellar/stellar-sdk stays off the initial page bundle.
 */

import {
  FeeBumpTransaction,
  Networks,
  Transaction,
  TransactionBuilder,
  WebAuth,
} from '@stellar/stellar-sdk';

/** Shown to the user when validation fails — never leak internal reasons. */
export const SEP10_VALIDATION_USER_ERROR =
  'Could not verify the login request from this site — please try again or contact support';

/** Reject challenges whose (maxTime − minTime) exceeds this (seconds). */
export const MAX_CHALLENGE_TIMEBOUNDS_SEC = 900;

/** Allow a small clock skew before treating minTime as "in the future". */
export const CLOCK_SKEW_ALLOWANCE_SEC = 60;

/**
 * buildChallengeTx uses 2 × BASE_FEE (200 stroops). Cap well above that so
 * legitimate challenges pass while blocking fee-inflated smuggled txs.
 */
export const MAX_CHALLENGE_FEE_STROOPS = 10_000;

export type Sep10ValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

export interface ValidateSep10ChallengeParams {
  challengeXdr: string;
  /** Connecting wallet public key (G…). */
  clientAccount: string;
  /**
   * Platform server signing account — must come from trusted client config
   * (e.g. NEXT_PUBLIC_SEP10_SERVER_ACCOUNT), never from the challenge itself.
   */
  serverAccount: string;
  /**
   * Expected home domain (e.g. promiscope.example) — must come from trusted client
   * config (NEXT_PUBLIC_SEP10_HOME_DOMAIN), never from the challenge itself.
   */
  homeDomain: string;
  networkPassphrase: string;
  /** Override "now" for deterministic unit tests (unix seconds). */
  nowSec?: number;
}

export interface Sep10ClientConfig {
  serverAccount: string;
  homeDomain: string;
  networkPassphrase: string;
}

/**
 * Reads the client-trusted SEP-10 expectations from build-time env.
 * Both values must be set independently of the challenge response.
 */
export function getSep10ClientConfig(): Sep10ClientConfig {
  return {
    serverAccount: process.env.NEXT_PUBLIC_SEP10_SERVER_ACCOUNT ?? '',
    homeDomain: process.env.NEXT_PUBLIC_SEP10_HOME_DOMAIN ?? '',
    networkPassphrase:
      process.env.NEXT_PUBLIC_NETWORK === 'mainnet'
        ? Networks.PUBLIC
        : Networks.TESTNET,
  };
}

function fail(reason: string): Sep10ValidationResult {
  return { valid: false, reason };
}

function manageDataValueToString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('utf8');
  }
  return null;
}

/**
 * Independently parse and verify a SEP-10 challenge XDR.
 * Returns a discriminated result — callers must not sign when `valid` is false.
 */
export function validateSep10Challenge(
  params: ValidateSep10ChallengeParams,
): Sep10ValidationResult {
  const {
    challengeXdr,
    clientAccount,
    serverAccount,
    homeDomain,
    networkPassphrase,
    nowSec,
  } = params;

  if (!challengeXdr || typeof challengeXdr !== 'string') {
    return fail('Challenge XDR is missing or not a string');
  }
  if (!serverAccount) {
    return fail('Expected server account is not configured');
  }
  if (!homeDomain) {
    return fail('Expected home domain is not configured');
  }
  if (!clientAccount) {
    return fail('Client account is missing');
  }

  let parsed: Transaction | FeeBumpTransaction;
  try {
    parsed = TransactionBuilder.fromXDR(challengeXdr, networkPassphrase);
  } catch (err) {
    return fail(
      `Failed to decode challenge XDR: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (
    typeof FeeBumpTransaction === 'function' &&
    parsed instanceof FeeBumpTransaction
  ) {
    return fail('Challenge must not be a fee-bump transaction');
  }
  // Duck-type fallback when FeeBumpTransaction is unavailable (e.g. partial
  // SDK mocks in unit tests) or across SDK shapes.
  if (
    parsed &&
    typeof parsed === 'object' &&
    'innerTransaction' in parsed &&
    (parsed as FeeBumpTransaction).innerTransaction
  ) {
    return fail('Challenge must not be a fee-bump transaction');
  }

  const tx = parsed as Transaction;

  // 1. Source account must be the trusted server signing key.
  if (tx.source !== serverAccount) {
    return fail(
      `Transaction source account does not match expected server account`,
    );
  }

  // 2. Sequence number must be exactly 0 (cannot be submitted as a live tx).
  const sequence = Number.parseInt(tx.sequence, 10);
  if (!Number.isFinite(sequence) || sequence !== 0) {
    return fail(`Transaction sequence number must be 0, got ${tx.sequence}`);
  }

  // 3. Time bounds: present, not unbounded, sane window, not far in the future.
  const timeBounds = tx.timeBounds;
  if (!timeBounds) {
    return fail('Challenge is missing time bounds');
  }

  const minTime = Number.parseInt(timeBounds.minTime, 10);
  const maxTime = Number.parseInt(timeBounds.maxTime, 10);
  if (!Number.isFinite(minTime) || !Number.isFinite(maxTime)) {
    return fail('Challenge time bounds are not numeric');
  }
  if (maxTime === 0) {
    return fail('Challenge time bounds must not be unbounded');
  }
  if (maxTime <= minTime) {
    return fail('Challenge time bounds window is empty or inverted');
  }

  const window = maxTime - minTime;
  if (window > MAX_CHALLENGE_TIMEBOUNDS_SEC) {
    return fail(
      `Challenge time bounds window (${window}s) exceeds cap of ${MAX_CHALLENGE_TIMEBOUNDS_SEC}s`,
    );
  }

  const now = nowSec ?? Math.floor(Date.now() / 1000);
  if (minTime > now + CLOCK_SKEW_ALLOWANCE_SEC) {
    return fail('Challenge minTime is too far in the future');
  }
  if (maxTime < now - CLOCK_SKEW_ALLOWANCE_SEC) {
    return fail('Challenge has expired');
  }

  // 4–5. Operations: first is "<homeDomain> auth" manageData from the client;
  // optional second is exactly web_auth_domain from the server. Nothing else.
  const ops = tx.operations;
  if (!ops || ops.length === 0) {
    return fail('Challenge has no operations');
  }
  if (ops.length > 2) {
    return fail(
      `Challenge has unexpected extra operations (count=${ops.length})`,
    );
  }

  const first = ops[0];
  if (first.type !== 'manageData') {
    return fail(`First operation must be manageData, got ${first.type}`);
  }
  if (first.source !== clientAccount) {
    return fail(
      'First manageData operation source must equal the connecting wallet',
    );
  }
  const expectedAuthName = `${homeDomain} auth`;
  if (first.name !== expectedAuthName) {
    return fail(
      `First manageData name must be "${expectedAuthName}", got "${first.name}"`,
    );
  }

  if (ops.length === 2) {
    const second = ops[1];
    if (second.type !== 'manageData') {
      return fail(
        `Second operation must be manageData (web_auth_domain), got ${second.type}`,
      );
    }
    if (second.name !== 'web_auth_domain') {
      return fail(
        `Second manageData must be web_auth_domain, got "${second.name}"`,
      );
    }
    if (second.source !== serverAccount) {
      return fail(
        'web_auth_domain operation source must be the server account',
      );
    }
    const webAuthValue = manageDataValueToString(second.value);
    if (webAuthValue !== homeDomain) {
      return fail(
        `web_auth_domain value must equal expected home domain "${homeDomain}"`,
      );
    }
  }

  // 6. Fee within expected bound.
  const fee = Number.parseInt(String(tx.fee), 10);
  if (!Number.isFinite(fee) || fee < 0 || fee > MAX_CHALLENGE_FEE_STROOPS) {
    return fail(
      `Challenge fee (${tx.fee}) exceeds max of ${MAX_CHALLENGE_FEE_STROOPS} stroops`,
    );
  }

  // Signatures: only the server may have signed already (exactly one signer).
  if (!tx.signatures || tx.signatures.length === 0) {
    return fail('Challenge is not signed by the server');
  }
  if (tx.signatures.length > 1) {
    return fail('Challenge has unexpected additional signatures');
  }
  if (!WebAuth.verifyTxSignedBy(tx, serverAccount)) {
    return fail('Challenge signature is not from the expected server account');
  }

  return { valid: true };
}
