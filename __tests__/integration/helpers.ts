/**
 * Integration test helpers for contract.int.test.ts.
 *
 * These utilities deal with real Stellar keypairs and the Soroban RPC —
 * they are only imported by the integration test suite (jest.integration.config.js),
 * never by the default unit-test run.
 */
import {
  Keypair,
  SorobanRpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
} from '@stellar/stellar-sdk';

/** Local quickstart network passphrase (stellar/quickstart --local). */
export const LOCAL_NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ??
  'Standalone Network ; February 2017';

/** Soroban RPC URL for the local quickstart node. */
export const RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC ?? 'http://localhost:8000/soroban/rpc';

/** Horizon URL for friendbot funding. */
export const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ?? 'http://localhost:8000';

/** How long (ms) to wait for a ledger to close before timing out in tests. */
export const TX_TIMEOUT_MS = 60_000;

/** SorobanRpc.Server pointed at the local quickstart node. */
export const rpcServer = new SorobanRpc.Server(RPC_URL, { allowHttp: true });

/**
 * Generate a fresh Stellar keypair and fund it via the local friendbot.
 * Returns the keypair so tests can use `.secret()` and `.publicKey()`.
 */
export async function generateFundedKeypair(): Promise<Keypair> {
  const keypair = Keypair.random();
  const res = await fetch(
    `${HORIZON_URL}/friendbot?addr=${keypair.publicKey()}`,
  );
  if (!res.ok) {
    throw new Error(
      `Friendbot funding failed for ${keypair.publicKey()}: HTTP ${res.status}`,
    );
  }
  return keypair;
}

/**
 * A signing function compatible with the `signFn` parameter of all
 * `lib/contract.ts` helpers. Signs with the given keypair and returns
 * the signed XDR string.
 */
export function makeSignFn(keypair: Keypair) {
  return async (xdrStr: string): Promise<string> => {
    const tx = TransactionBuilder.fromXDR(xdrStr, LOCAL_NETWORK_PASSPHRASE);
    tx.sign(keypair);
    return tx.toXDR();
  };
}

/**
 * Wait for the RPC to be healthy (up to 60 s). Throws on timeout.
 * Called in `beforeAll` so individual tests don't each poll.
 */
export async function waitForRpc(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const health = await rpcServer.getHealth();
      if (health.status === 'healthy') return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(
    `Soroban RPC at ${RPC_URL} did not become healthy within ${timeoutMs} ms`,
  );
}

/**
 * Poll until `hash` lands in a closed ledger or throw on timeout.
 * Re-exports the same semantics as lib/stellar.ts pollTransaction but uses
 * the integration-test RPC server (not the module-level one from lib/stellar).
 */
export async function pollTx(
  hash: string,
  maxAttempts = 30,
  delayMs = 2_000,
): Promise<SorobanRpc.Api.GetTransactionResponse> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await rpcServer.getTransaction(hash);
    if (result.status !== 'NOT_FOUND') {
      if (result.status === 'FAILED') {
        throw new Error(`Transaction ${hash} FAILED on-chain`);
      }
      return result;
    }
    if (i < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(
    `Transaction ${hash} not confirmed after ${maxAttempts} attempts`,
  );
}

/**
 * Read an environment variable that MUST be set, throwing a clear error
 * if it is missing (instead of surfacing "undefined" deep in the test).
 */
export function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(
      `Integration test requires ${name} to be set. ` +
        `Run scripts/deploy-test-contract.sh first, then source .env.integration.`,
    );
  }
  return val;
}
