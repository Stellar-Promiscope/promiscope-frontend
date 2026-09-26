/** @jest-environment node */

// The route creates its own axios instance via axios.create() at module
// load time, so the mock's `get` must exist before the route module is
// imported below — same pattern as __tests__/lib/api.test.ts.
let mockGet: jest.Mock;

jest.mock('axios', () => {
  const get = jest.fn();
  const instance = { get };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => instance),
    },
  };
});

// The route now delegates rate limiting to the shared lib/rateLimit.ts
// (issue #658 — see lib/rateLimit.ts and __tests__/lib/rateLimit.test.ts
// for the Redis-backed/in-memory-fallback behavior itself). Here we only
// need *a* working per-key/window counter so this route's existing
// rate-limit tests still exercise real rate-limiting behavior, without
// re-testing lib/rateLimit's store selection logic. getClientIp is left as
// the real implementation since it's a small pure function this suite
// already exercises directly (the x-real-ip fallback test below).
jest.mock('@/lib/rateLimit', () => {
  const actual = jest.requireActual('@/lib/rateLimit');
  const state = new Map<string, { count: number; firstSeen: number }>();
  return {
    ...actual,
    checkRateLimit: jest.fn(
      async (key: string, opts: { limit: number; windowMs: number }) => {
        const now = Date.now();
        const entry = state.get(key);
        if (!entry || now - entry.firstSeen > opts.windowMs) {
          state.set(key, { count: 1, firstSeen: now });
          return { limited: false };
        }
        entry.count += 1;
        if (entry.count > opts.limit) {
          return {
            limited: true,
            retryAfterSec: Math.ceil(
              (opts.windowMs - (now - entry.firstSeen)) / 1000,
            ),
          };
        }
        return { limited: false };
      },
    ),
  };
});

import { GET } from '../../../../app/api/players/search/route';
import { NextRequest } from 'next/server';
import axios from 'axios';

beforeAll(() => {
  mockGet = (axios.create as jest.Mock).mock.results[0].value.get;
});

function makeRequest(name: string, ip?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (ip) headers['x-forwarded-for'] = ip;

  return new NextRequest(
    `http://localhost:3000/api/players/search?name=${encodeURIComponent(name)}`,
    { headers },
  );
}

describe('GET /api/players/search', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('proxies to the backend and returns its data', async () => {
    const mockData = [{ id: 'player-1', name: 'Alice' }];
    mockGet.mockResolvedValueOnce({ data: mockData });

    const res = await GET(makeRequest('Alice', 'ip-basic'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(mockData);
    expect(mockGet).toHaveBeenCalledWith('/players/search', {
      params: { name: 'Alice' },
    });
  });

  it('returns the backend error status when the backend call fails', async () => {
    mockGet.mockRejectedValueOnce({ response: { status: 503 } });

    const res = await GET(makeRequest('Alice', 'ip-backend-down'));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: { code: 'UPSTREAM_FAILED', message: 'Failed to search players' },
    });
  });

  it('rate limits after exceeding 20 requests from the same IP within the window', async () => {
    mockGet.mockResolvedValue({ data: [] });
    const ip = 'ip-rate-limited';

    let lastRes;
    for (let i = 0; i < 21; i++) {
      lastRes = await GET(makeRequest('a', ip));
    }

    expect(lastRes!.status).toBe(429);
    const body = await lastRes!.json();
    expect(body).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many search requests. Please slow down.',
      },
    });
    expect(lastRes!.headers.get('Retry-After')).toBeTruthy();
  });

  it('tracks rate limits per IP independently', async () => {
    mockGet.mockResolvedValue({ data: [] });

    for (let i = 0; i < 20; i++) {
      await GET(makeRequest('a', 'ip-A'));
    }
    // ip-A is now at the limit; a different IP should be unaffected.
    const res = await GET(makeRequest('a', 'ip-B'));

    expect(res.status).toBe(200);
  });

  it('falls back to the x-real-ip header when x-forwarded-for is absent', async () => {
    mockGet.mockResolvedValueOnce({ data: [] });
    const req = new NextRequest(
      'http://localhost:3000/api/players/search?name=Alice',
      { headers: { 'x-real-ip': 'ip-real' } },
    );

    const res = await GET(req);

    expect(res.status).toBe(200);
  });
});

describe('GET /api/players/search — server-side inputValidation parity (issue #1143)', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('returns 400 when the name param exceeds 100 characters', async () => {
    const res = await GET(makeRequest('a'.repeat(101), 'ip-toolong'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('QUERY_TOO_LONG');
    expect(body.error.params).toEqual({ max: 100 });
  });

  it('accepts a name at exactly 100 characters and proxies normally', async () => {
    mockGet.mockResolvedValueOnce({ data: [] });
    const res = await GET(makeRequest('a'.repeat(100), 'ip-atlimit'));
    expect(res.status).toBe(200);
    expect(mockGet).toHaveBeenCalledWith('/players/search', {
      params: { name: 'a'.repeat(100) },
    });
  });
});
