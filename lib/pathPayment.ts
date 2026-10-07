/**
 * Paying XLM-denominated fees with another asset (USDC) via a Stellar path
 * payment — issue #1321, option 2 of docs/adr/0003-multi-currency-contact-fee.md.
 *
 * A Soroban transaction can only hold one operation, so the swap can't share
 * a transaction with the contract call. Instead:
 *   1. `pathPaymentStrictReceive` from the scout to *themselves*, receiving
 *      exactly the XLM fee and spending at most `sendMax` of the source asset
 *      (the quote plus the scout's slippage tolerance).
 *   2. The usual `pay_to_contact` contract call, paid in XLM.
 * If step 2 fails the scout simply keeps the XLM. The swap is recorded as a
 * pending swap so a retry skips straight to step 2 instead of converting again.
 */
import {
  Account,
  Asset,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  BASE_FEE,
  HORIZON_URL,
  NETWORK,
  pollTransaction,
  rpc,
} from '@/lib/stellar';

/** How long a Horizon quote stays usable. Also caps the swap tx's time bounds. */
export const QUOTE_TTL_MS = 60_000;
export const DEFAULT_SLIPPAGE_BPS = 100; // 1%
export const MAX_SLIPPAGE_BPS = 500; // 5%
export const SLIPPAGE_OPTIONS_BPS = [50, 100, 200, 500] as const;

const STROOPS_PER_UNIT = BigInt(10_000_000);

/** Circle's USDC issuers. Override with NEXT_PUBLIC_USDC_ISSUER. */
const USDC_ISSUER =
  process.env.NEXT_PUBLIC_USDC_ISSUER ||
  (process.env.NEXT_PUBLIC_NETWORK === 'mainnet'
    ? 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
    : 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');

export interface FeeAsset {
  code: string;
  issuer: string;
}

export const USDC: FeeAsset = { code: 'USDC', issuer: USDC_ISSUER };

interface HorizonPathAsset {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}

export interface PathQuote {
  sourceAsset: FeeAsset;
  /** Quoted source amount (7-dp string), before slippage. */
  sourceAmount: string;
  /** Exact XLM the scout receives (7-dp string). */
  destAmount: string;
  path: HorizonPathAsset[];
  expiresAt: number;
}

export class QuoteExpiredError extends Error {
  constructor() {
    super('The conversion quote has expired. Refresh it and try again.');
    this.name = 'QuoteExpiredError';
  }
}

export class NoPathError extends Error {
  constructor(asset: FeeAsset) {
    super(`No ${asset.code} → XLM conversion path is available right now.`);
    this.name = 'NoPathError';
  }
}

function toStroops(amount: string): bigint {
  const [whole, frac = ''] = amount.split('.');
  return (
    BigInt(whole || '0') * STROOPS_PER_UNIT +
    BigInt((frac + '0000000').slice(0, 7))
  );
}

function fromStroops(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_UNIT;
  const frac = (stroops % STROOPS_PER_UNIT).toString().padStart(7, '0');
  return `${whole}.${frac}`;
}

export function formatAmount(xlm: number): string {
  return xlm.toFixed(7);
}

/**
 * Max source amount the swap may spend: the quote plus `slippageBps`,
 * rounded up to the next stroop. Throws when slippage is out of bounds.
 */
export function computeSendMax(
  sourceAmount: string,
  slippageBps: number,
): string {
  if (
    !Number.isInteger(slippageBps) ||
    slippageBps < 0 ||
    slippageBps > MAX_SLIPPAGE_BPS
  ) {
    throw new RangeError(
      `Slippage must be between 0 and ${MAX_SLIPPAGE_BPS / 100}%`,
    );
  }
  const base = toStroops(sourceAmount);
  const scale = BigInt(10_000);
  const numerator = base * (scale + BigInt(slippageBps));
  return fromStroops((numerator + scale - BigInt(1)) / scale);
}

export function isQuoteExpired(quote: PathQuote, now = Date.now()): boolean {
  return now >= quote.expiresAt;
}

/**
 * Asks Horizon `/paths/strict-receive` for the cheapest way to receive
 * exactly `destAmountXlm` XLM by spending `asset`.
 */
export async function fetchStrictReceiveQuote(
  destAmountXlm: number,
  asset: FeeAsset = USDC,
  now = Date.now(),
): Promise<PathQuote> {
  const destAmount = formatAmount(destAmountXlm);
  const params = new URLSearchParams({
    source_assets: `${asset.code}:${asset.issuer}`,
    destination_asset_type: 'native',
    destination_amount: destAmount,
  });
  const res = await fetch(`${HORIZON_URL}/paths/strict-receive?${params}`);
  if (!res.ok) throw new Error(`Horizon error: ${res.status}`);
  const body = (await res.json()) as {
    _embedded?: {
      records?: Array<{ source_amount: string; path: HorizonPathAsset[] }>;
    };
  };
  const records = body._embedded?.records ?? [];
  if (records.length === 0) throw new NoPathError(asset);

  const best = records.reduce((a, b) =>
    toStroops(b.source_amount) < toStroops(a.source_amount) ? b : a,
  );
  return {
    sourceAsset: asset,
    sourceAmount: best.source_amount,
    destAmount,
    path: best.path,
    expiresAt: now + QUOTE_TTL_MS,
  };
}

function toSdkAsset(a: HorizonPathAsset): Asset {
  return a.asset_type === 'native'
    ? Asset.native()
    : new Asset(a.asset_code!, a.asset_issuer!);
}

/**
 * Builds the self-directed path payment for `quote`. The transaction's time
 * bounds end when the quote expires, so the network itself rejects a swap
 * signed against a stale quote.
 */
export function buildPathPaymentTx(
  account: Account,
  quote: PathQuote,
  slippageBps: number,
  now = Date.now(),
) {
  if (isQuoteExpired(quote, now)) throw new QuoteExpiredError();
  const sendMax = computeSendMax(quote.sourceAmount, slippageBps);
  const timeoutSec = Math.max(1, Math.floor((quote.expiresAt - now) / 1000));

  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: new Asset(quote.sourceAsset.code, quote.sourceAsset.issuer),
        sendMax,
        destination: account.accountId(),
        destAsset: Asset.native(),
        destAmount: quote.destAmount,
        path: quote.path.map(toSdkAsset),
      }),
    )
    .setTimeout(timeoutSec)
    .build();
}

/** Signs and submits the swap, waits for confirmation, and returns its hash. */
export async function swapToXlm(
  publicKey: string,
  quote: PathQuote,
  slippageBps: number,
  signFn: (xdr: string) => Promise<string>,
): Promise<string> {
  const account = await rpc.getAccount(publicKey);
  const tx = buildPathPaymentTx(
    new Account(account.accountId(), account.sequenceNumber()),
    quote,
    slippageBps,
  );
  const signed = TransactionBuilder.fromXDR(await signFn(tx.toXDR()), NETWORK);
  const sent = await rpc.sendTransaction(signed);
  if (sent.status === 'ERROR') {
    throw new Error(`Conversion failed: ${JSON.stringify(sent.errorResult)}`);
  }
  await pollTransaction(sent.hash);
  return sent.hash;
}

/** Balance of a non-native asset (0 when the account or trustline is missing). */
export async function getAssetBalance(
  address: string,
  asset: FeeAsset,
): Promise<number> {
  const res = await fetch(`${HORIZON_URL}/accounts/${address}`);
  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`Horizon error: ${res.status}`);
  const { balances } = (await res.json()) as {
    balances: Array<{
      asset_code?: string;
      asset_issuer?: string;
      balance: string;
    }>;
  };
  const line = balances.find(
    (b) => b.asset_code === asset.code && b.asset_issuer === asset.issuer,
  );
  return line ? parseFloat(line.balance) : 0;
}

// ── Pending-swap recovery ────────────────────────────────────────────────────

/** A completed swap whose contract call hasn't succeeded yet. */
export interface PendingSwap {
  txHash: string;
  xlmAmount: number;
  createdAt: number;
}

const PENDING_SWAP_TTL_MS = 24 * 60 * 60 * 1000;

function pendingSwapKey(wallet: string, playerId: string): string {
  return `promiscope_pending_contact_swap:${wallet}:${playerId}`;
}

export function savePendingSwap(
  wallet: string,
  playerId: string,
  swap: PendingSwap,
): void {
  try {
    localStorage.setItem(
      pendingSwapKey(wallet, playerId),
      JSON.stringify(swap),
    );
  } catch {
    // Storage unavailable — recovery is best-effort; the XLM is still in the wallet.
  }
}

export function getPendingSwap(
  wallet: string,
  playerId: string,
  now = Date.now(),
): PendingSwap | null {
  try {
    const raw = localStorage.getItem(pendingSwapKey(wallet, playerId));
    if (!raw) return null;
    const swap = JSON.parse(raw) as PendingSwap;
    if (now - swap.createdAt > PENDING_SWAP_TTL_MS) {
      clearPendingSwap(wallet, playerId);
      return null;
    }
    return swap;
  } catch {
    return null;
  }
}

export function clearPendingSwap(wallet: string, playerId: string): void {
  try {
    localStorage.removeItem(pendingSwapKey(wallet, playerId));
  } catch {
    // ignore
  }
}
