/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/indexer/[...path]/route';
import { checkRateLimit } from '@/lib/rateLimit';

jest.mock('@/lib/rateLimit', () => ({
  checkRateLimit: jest.fn(),
  getClientIp: () => '203.0.113.1',
}));

const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<
  typeof checkRateLimit
>;
const originalFetch = global.fetch;
const originalInternalUrl = process.env.INDEXER_API_URL_INTERNAL;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function ctx(path: string) {
  return { params: { path: path.split('/') } };
}

beforeEach(() => {
  process.env.INDEXER_API_URL_INTERNAL = 'http://indexer.internal:3001';
  mockCheckRateLimit.mockResolvedValue({ limited: false });
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env.INDEXER_API_URL_INTERNAL = originalInternalUrl;
  jest.useRealTimers();
});

describe('/api/indexer proxy', () => {
  it('forwards allow-listed GETs with the query string and passes through JSON', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { events: [], nextCursor: null }));

    const req = new NextRequest(
      'http://localhost/api/indexer/players/p1/events?limit=5&type=milestone_approved',
    );
    const res = await GET(req, ctx('players/p1/events'));

    expect(global.fetch).toHaveBeenCalledWith(
      'http://indexer.internal:3001/players/p1/events?limit=5&type=milestone_approved',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('s-maxage');
    expect(await res.json()).toEqual({ events: [], nextCursor: null });
  });

  it('forwards the approval-counts POST body and passes through the status', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: 'bad' }));
    const body = JSON.stringify({ start: 0, end: 1, wallets: [] });

    const req = new NextRequest(
      'http://localhost/api/indexer/validators/approval-counts',
      { method: 'POST', body },
    );
    const res = await POST(req, ctx('validators/approval-counts'));

    expect(global.fetch).toHaveBeenCalledWith(
      'http://indexer.internal:3001/validators/approval-counts',
      expect.objectContaining({ method: 'POST', body }),
    );
    expect(res.status).toBe(400);
  });

  it('forwards the paginated GET /players discovery query (issue #1298)', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { players: [], nextCursor: null, total: 0 }),
      );

    const req = new NextRequest(
      'http://localhost/api/indexer/players?region=West%20Africa&minLevel=1&limit=50',
    );
    const res = await GET(req, ctx('players'));

    expect(global.fetch).toHaveBeenCalledWith(
      'http://indexer.internal:3001/players?region=West%20Africa&minLevel=1&limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      players: [],
      nextCursor: null,
      total: 0,
    });
  });

  it('forwards GET /health for the ledger-lag hint (issue #1298)', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { status: 'ok', lastLedger: 100, ledgerLag: 2 }),
      );

    const req = new NextRequest('http://localhost/api/indexer/health');
    const res = await GET(req, ctx('health'));

    expect(global.fetch).toHaveBeenCalledWith(
      'http://indexer.internal:3001/health',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(res.status).toBe(200);
  });

  it.each([
    ['GET', 'metrics'],
    ['GET', 'players/p1/events/extra'],
    ['GET', 'validators/approval-counts'],
    ['POST', 'events'],
  ])('rejects non-allow-listed %s %s with 404', async (method, path) => {
    global.fetch = jest.fn();
    const req = new NextRequest(`http://localhost/api/indexer/${path}`, {
      method,
    });
    const res = await (method === 'GET' ? GET : POST)(req, ctx(path));

    expect(res.status).toBe(404);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 429 when rate-limited', async () => {
    global.fetch = jest.fn();
    mockCheckRateLimit.mockResolvedValue({ limited: true, retryAfterSec: 30 });

    const req = new NextRequest('http://localhost/api/indexer/events');
    const res = await GET(req, ctx('events'));

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 504 when the indexer does not answer within 5 s', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    ) as unknown as typeof fetch;

    const req = new NextRequest('http://localhost/api/indexer/events');
    const pending = GET(req, ctx('events'));
    await jest.advanceTimersByTimeAsync(5000);
    const res = await pending;

    expect(res.status).toBe(504);
  });

  it('returns 502 when the indexer is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const req = new NextRequest('http://localhost/api/indexer/events');
    const res = await GET(req, ctx('events'));

    expect(res.status).toBe(502);
  });
});
