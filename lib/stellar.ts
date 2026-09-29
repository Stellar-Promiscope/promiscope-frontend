import {
  SorobanRpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  StrKey,
} from '@stellar/stellar-sdk';

const DEFAULT_SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';

const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC ?? DEFAULT_SOROBAN_RPC_URL;
const NETWORK =
  process.env.NEXT_PUBLIC_NETWORK === 'mainnet'
    ? Networks.PUBLIC
    : Networks.TESTNET;

// Real testnet/mainnet RPC endpoints are always https, so this only ever
// allows http for a local/mocked RPC URL (e.g. Docker Compose's
// http://mock-rpc:8000) — production and testnet configs are unaffected.
export const rpc = new SorobanRpc.Server(RPC_URL, {
  allowHttp: RPC_URL.startsWith('http://'),
});

export function isValidStellarAddress(key: string): boolean {
  return StrKey.isValidEd25519PublicKey(key);
}

/**
 * Normalizes a Stellar public key for consistent storage and lookup.
 *
 * A checksum-valid key is round-tripped through StrKey to its canonical
 * form. Anything else is case-folded to upper-case rather than rejected:
 * callers that care about validity gate on {@link isValidStellarAddress}
 * first (see app/api/watchlist/route.ts), and the stores only need keys
 * that compare equal to dedupe reliably — throwing here would turn a
 * malformed value into a 500 instead of letting the caller's own
 * validation return a clean 4xx.
 */
export function normalizeStellarAddress(key: string): string {
  const canonical = key.trim().toUpperCase();
  if (StrKey.isValidEd25519PublicKey(canonical)) {
    return StrKey.encodeEd25519PublicKey(
      StrKey.decodeEd25519PublicKey(canonical),
    );
  }
  return canonical;
}

export { NETWORK, BASE_FEE, TransactionBuilder };

export class TransactionFailedError extends Error {
  constructor(hash: string) {
    super(`Transaction ${hash} failed on-chain`);
    this.name = 'TransactionFailedError';
  }
}

export class TransactionTimeoutError extends Error {
  constructor(hash: string, attempts: number) {
    super(`Transaction ${hash} was not confirmed after ${attempts} attempts`);
    this.name = 'TransactionTimeoutError';
  }
}

export interface PollTransactionOptions {
  /** Abort mid-poll (e.g. component unmount). */
  signal?: AbortSignal;
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const err = new Error('Polling aborted');
    err.name = 'AbortError';
    throw err;
  }
}

/**
 * Polls Soroban RPC until `hash` is included in a closed ledger (or fails).
 *
 * Defaults: 20 attempts × 2s ≈ 40s — ~8 Stellar ledger closes (~5s each),
 * enough for normal confirmation under mild congestion without hanging forever.
 */
export async function pollTransaction(
  hash: string,
  maxAttempts = 20,
  delayMs = 2000,
  options: PollTransactionOptions = {},
) {
  const { signal } = options;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    assertNotAborted(signal);
    const result = await rpc.getTransaction(hash);
    if (result.status !== 'NOT_FOUND') {
      if (result.status === 'FAILED') {
        throw new TransactionFailedError(hash);
      }
      return result;
    }
    if (attempt < maxAttempts - 1) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        const onAbort = () => {
          clearTimeout(timer);
          const err = new Error('Polling aborted');
          err.name = 'AbortError';
          reject(err);
        };
        if (signal) {
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    }
  }
  throw new TransactionTimeoutError(hash, maxAttempts);
}

/**
 * Signs the provided XDR using `signFn`, submits it via the RPC node, polls
 * until the transaction is confirmed, and returns the final transaction result.
 */
export const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';

/**
 * Fetches the native XLM balance for a Stellar account via Horizon.
 * Returns 0 for unfunded accounts (404). Returns a number rounded to 7 decimal places.
 */
export async function getXLMBalance(address: string): Promise<number> {
  const res = await fetch(`${HORIZON_URL}/accounts/${address}`);
  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`Horizon error: ${res.status}`);
  const { balances } = (await res.json()) as {
    balances: Array<{ asset_type: string; balance: string }>;
  };
  const native = balances.find((b) => b.asset_type === 'native');
  return native ? parseFloat(parseFloat(native.balance).toFixed(7)) : 0;
}

export async function signAndSubmitTx(
  xdrTx: string,
  signFn: (xdr: string) => Promise<string>,
) {
  const signedXdr = await signFn(xdrTx);
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK);
  const sendResult = await rpc.sendTransaction(tx);
  if (sendResult.status === 'ERROR') {
    throw new Error(`ContractError: ${JSON.stringify(sendResult)}`);
  }
  return pollTransaction(sendResult.hash);
}
