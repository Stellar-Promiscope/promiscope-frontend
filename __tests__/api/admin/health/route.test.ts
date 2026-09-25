/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/admin/health/route';
import { requireAdminWallet } from '@/lib/adminAuth';

jest.mock('@/lib/adminAuth', () => ({
  requireAdminWallet: jest.fn(() => 'GADMIN'),
}));

// Dependency checks are covered in __tests__/lib/healthChecks.test.ts.
jest.mock('@/lib/healthChecks', () => ({
  runDependencyChecks: jest.fn(async () => ({
    redis: { status: 'not_configured', latencyMs: 0 },
  })),
}));

const req = () => new NextRequest('http://localhost/api/admin/health');

const originalFetch = global.fetch;
const originalIndexerUrl = process.env.NEXT_PUBLIC_INDEXER_API_URL;
const originalApiUrlInternal = process.env.API_URL_INTERNAL;
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_INDEXER_API_URL = 'http://indexer.example.com';
  process.env.API_URL_INTERNAL = 'http://backend.example.com';
  delete process.env.NEXT_PUBLIC_API_URL;
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env.NEXT_PUBLIC_INDEXER_API_URL = originalIndexerUrl;
  process.env.API_URL_INTERNAL = originalApiUrlInternal;
  process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
});

describe('GET /api/admin/health', () => {
  it('rejects non-admin sessions with 401', async () => {
    (requireAdminWallet as jest.Mock).mockReturnValueOnce(null);
    global.fetch = jest.fn();
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('includes the per-dependency checks', async () => {
    global.fetch = jest
      .fn()
      .mockImplementation(async () => jsonResponse(200, { status: 'ok' }));
    const body = await (await GET(req())).json();
    expect(body.checks).toEqual({
      redis: { status: 'not_configured', latencyMs: 0 },
    });
  });

  it('reports ok for both subsystems when their /health endpoints succeed', async () => {
    global.fetch = jest
      .fn()
      .mockImplementation(async () => jsonResponse(200, { status: 'ok' }));

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.indexer).toEqual({ status: 'ok', detail: { status: 'ok' } });
    expect(body.backend).toEqual({ status: 'ok', detail: { status: 'ok' } });
    expect(typeof body.checkedAt).toBe('number');
  });

  it('reports degraded when a subsystem reports status: degraded', async () => {
    global.fetch = jest
      .fn()
      .mockImplementation(async () =>
        jsonResponse(200, { status: 'degraded' }),
      );

    const res = await GET(req());
    const body = await res.json();
    expect(body.indexer.status).toBe('degraded');
    expect(body.backend.status).toBe('degraded');
  });

  it('reports unreachable with the HTTP status when a subsystem responds non-ok', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(503, {}));

    const res = await GET(req());
    const body = await res.json();
    expect(body.indexer).toEqual({ status: 'unreachable', error: 'HTTP 503' });
  });

  it('reports unreachable with the error message when fetch throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await GET(req());
    const body = await res.json();
    expect(body.indexer).toEqual({
      status: 'unreachable',
      error: 'ECONNREFUSED',
    });
    expect(body.backend).toEqual({
      status: 'unreachable',
      error: 'ECONNREFUSED',
    });
  });

  it('reports "Request timed out" when the fetch aborts', async () => {
    global.fetch = jest.fn().mockImplementation(() => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });

    const res = await GET(req());
    const body = await res.json();
    expect(body.indexer).toEqual({
      status: 'unreachable',
      error: 'Request timed out',
    });
  });

  it('reports "Base URL not configured" when a base URL env var is missing', async () => {
    delete process.env.NEXT_PUBLIC_INDEXER_API_URL;
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { status: 'ok' }));

    const res = await GET(req());
    const body = await res.json();
    expect(body.indexer).toEqual({
      status: 'unreachable',
      error: 'Base URL not configured',
    });
  });

  it('falls back to NEXT_PUBLIC_API_URL when API_URL_INTERNAL is unset', async () => {
    delete process.env.API_URL_INTERNAL;
    process.env.NEXT_PUBLIC_API_URL = 'http://public-backend.example.com';
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { status: 'ok' }));
    global.fetch = fetchMock;

    const res = await GET(req());
    expect(res.status).toBe(200);
    const backendCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).startsWith('http://public-backend.example.com'),
    );
    expect(backendCall).toBeDefined();
  });

  it('handles a non-JSON response body gracefully, defaulting to ok', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response('not json', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const res = await GET(req());
    const body = await res.json();
    expect(body.indexer.status).toBe('ok');
  });
});
