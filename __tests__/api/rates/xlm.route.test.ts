/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/rates/xlm/route';
import { getXlmRate, resetXlmRateCache } from '@/lib/xlmRate';

const originalFetch = global.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function request(vs?: string) {
  const qs = vs === undefined ? '' : `?vs=${vs}`;
  return new NextRequest(`http://localhost/api/rates/xlm${qs}`);
}

beforeEach(() => {
  resetXlmRateCache();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('GET /api/rates/xlm', () => {
  it('rejects currencies outside SUPPORTED_CURRENCIES', async () => {
    global.fetch = jest.fn();
    const res = await GET(request('xof'));
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns the CoinGecko rate with CDN cache headers', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { stellar: { eur: 0.25 } }));

    const res = await GET(request('EUR'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=300',
    );
    const body = await res.json();
    expect(body).toMatchObject({
      rate: 0.25,
      stale: false,
      source: 'coingecko',
    });
    expect(typeof body.updatedAt).toBe('string');
  });

  it('serves a cache hit without contacting upstream again', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { stellar: { usd: 0.4 } }));

    await GET(request('usd'));
    const res = await GET(request('usd'));
    expect((await res.json()).rate).toBe(0.4);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the Stellar DEX mid-price when CoinGecko fails', async () => {
    global.fetch = jest.fn().mockImplementation(async (url: string) =>
      url.includes('coingecko')
        ? jsonResponse(429, {})
        : jsonResponse(200, {
            bids: [{ price: '0.39' }],
            asks: [{ price: '0.41' }],
          }),
    );

    const body = await (await GET(request('usd'))).json();
    expect(body).toMatchObject({ stale: false, source: 'stellar-dex' });
    expect(body.rate).toBeCloseTo(0.4);
  });

  it('returns the last known value marked stale when every upstream fails', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { stellar: { gbp: 0.2 } }))
      .mockResolvedValue(jsonResponse(500, {}));

    const t0 = Date.now();
    await getXlmRate('gbp', t0);
    const stale = await getXlmRate('gbp', t0 + 61_000);
    expect(stale).toMatchObject({
      rate: 0.2,
      stale: true,
      source: 'coingecko',
    });
  });

  it('returns 503 when nothing is known and upstream fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    const res = await GET(request('usd'));
    expect(res.status).toBe(503);
  });
});
