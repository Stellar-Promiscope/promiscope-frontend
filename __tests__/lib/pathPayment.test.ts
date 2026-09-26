/** @jest-environment node */
import { Account, Keypair, Networks, Transaction } from '@stellar/stellar-sdk';
import {
  buildPathPaymentTx,
  computeSendMax,
  fetchStrictReceiveQuote,
  getAssetBalance,
  isQuoteExpired,
  NoPathError,
  QUOTE_TTL_MS,
  QuoteExpiredError,
  USDC,
  type PathQuote,
} from '@/lib/pathPayment';

const SCOUT = Keypair.random().publicKey();

function mockHorizon(body: unknown, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

function quote(overrides: Partial<PathQuote> = {}): PathQuote {
  return {
    sourceAsset: USDC,
    sourceAmount: '12.3400000',
    destAmount: '50.0000000',
    path: [],
    expiresAt: 1_000_000 + QUOTE_TTL_MS,
    ...overrides,
  };
}

describe('fetchStrictReceiveQuote (mocked Horizon /paths/strict-receive)', () => {
  it('requests an exact XLM amount and picks the cheapest path', async () => {
    mockHorizon({
      _embedded: {
        records: [
          { source_amount: '12.5000000', path: [] },
          {
            source_amount: '12.3400000',
            path: [
              {
                asset_type: 'credit_alphanum4',
                asset_code: 'EURC',
                asset_issuer: SCOUT,
              },
            ],
          },
          { source_amount: '13.0000000', path: [] },
        ],
      },
    });

    const q = await fetchStrictReceiveQuote(50, USDC, 1_000_000);

    const url = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(url.pathname).toBe('/paths/strict-receive');
    expect(url.searchParams.get('source_assets')).toBe(`USDC:${USDC.issuer}`);
    expect(url.searchParams.get('destination_asset_type')).toBe('native');
    expect(url.searchParams.get('destination_amount')).toBe('50.0000000');
    expect(q).toMatchObject({
      sourceAmount: '12.3400000',
      destAmount: '50.0000000',
      expiresAt: 1_000_000 + QUOTE_TTL_MS,
    });
    expect(q.path).toHaveLength(1);
  });

  it('throws NoPathError when Horizon finds no path', async () => {
    mockHorizon({ _embedded: { records: [] } });
    await expect(fetchStrictReceiveQuote(50)).rejects.toBeInstanceOf(
      NoPathError,
    );
  });

  it('surfaces Horizon errors', async () => {
    mockHorizon({}, 503);
    await expect(fetchStrictReceiveQuote(50)).rejects.toThrow('503');
  });
});

describe('slippage bounds', () => {
  it('adds slippage and rounds up to the next stroop', () => {
    expect(computeSendMax('12.3400000', 100)).toBe('12.4634000');
    expect(computeSendMax('0.0000001', 50)).toBe('0.0000002');
    expect(computeSendMax('10', 0)).toBe('10.0000000');
  });

  it('rejects slippage outside 0–5%', () => {
    expect(() => computeSendMax('10', -1)).toThrow(RangeError);
    expect(() => computeSendMax('10', 501)).toThrow(RangeError);
    expect(() => computeSendMax('10', 1.5)).toThrow(RangeError);
  });
});

describe('quote expiry', () => {
  it('expires after QUOTE_TTL_MS', () => {
    const q = quote();
    expect(isQuoteExpired(q, q.expiresAt - 1)).toBe(false);
    expect(isQuoteExpired(q, q.expiresAt)).toBe(true);
  });

  it('refuses to build a swap from an expired quote', () => {
    const q = quote();
    expect(() =>
      buildPathPaymentTx(new Account(SCOUT, '1'), q, 100, q.expiresAt),
    ).toThrow(QuoteExpiredError);
  });
});

describe('buildPathPaymentTx', () => {
  it('builds a self-directed strict-receive payment bounded by sendMax and the quote expiry', () => {
    const now = 1_000_000;
    const tx = buildPathPaymentTx(new Account(SCOUT, '1'), quote(), 100, now);
    const parsed = new Transaction(tx.toXDR(), Networks.TESTNET);

    expect(parsed.operations).toHaveLength(1);
    const op = parsed.operations[0] as unknown as Record<string, any>;
    expect(op.type).toBe('pathPaymentStrictReceive');
    expect(op.destination).toBe(SCOUT);
    expect(op.destAsset.isNative()).toBe(true);
    expect(op.destAmount).toBe('50.0000000');
    expect(op.sendAsset.getCode()).toBe('USDC');
    expect(op.sendMax).toBe('12.4634000');
    // Time bounds end when the quote does (60s), so a stale swap is rejected on-chain.
    const maxTime = Number(parsed.timeBounds!.maxTime);
    expect(maxTime - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(60);
  });
});

describe('getAssetBalance', () => {
  it('reads the matching trustline from Horizon', async () => {
    mockHorizon({
      balances: [
        { asset_type: 'native', balance: '2.5' },
        { asset_code: 'USDC', asset_issuer: USDC.issuer, balance: '20.1' },
      ],
    });
    await expect(getAssetBalance(SCOUT, USDC)).resolves.toBe(20.1);
  });

  it('returns 0 for an unfunded account', async () => {
    mockHorizon({}, 404);
    await expect(getAssetBalance(SCOUT, USDC)).resolves.toBe(0);
  });
});
