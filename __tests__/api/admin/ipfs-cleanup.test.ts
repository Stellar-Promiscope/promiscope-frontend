/** @jest-environment node */
import { GET, POST } from '@/app/api/admin/ipfs-cleanup/route';
import { NextRequest } from 'next/server';
import {
  UNPIN_GRACE_PERIOD_MS,
  __resetForTests,
  getAllRecords,
  recordSupersededCid,
} from '@/lib/supersededMediaStore';
import { createSessionToken } from '@/lib/session';
import { SessionStore } from '@/lib/sessionStore';

const ADMIN = 'GADMIN0000000000000000000000000000000000000000000000000';
const NON_ADMIN = 'GUSER00000000000000000000000000000000000000000000000000';
const NOW = new Date('2026-01-15T12:00:00Z').getTime();
const URL = 'http://localhost/api/admin/ipfs-cleanup';

const mockFetch = jest.fn();

function authHeaders(wallet?: string): Record<string, string> {
  if (wallet === undefined) return {};
  const sid = `sid-${Math.random()}`;
  SessionStore.getInstance().create(sid, wallet, Date.now() + 60_000);
  return {
    cookie: `session=${createSessionToken(wallet, 'access', 20 * 60, { sid })}`,
  };
}

function postRequest(wallet?: string, body?: unknown): NextRequest {
  return new NextRequest(URL, {
    method: 'POST',
    headers: { ...authHeaders(wallet), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Records a CID as superseded `ageMs` before NOW. */
function supersede(cid: string, playerId: string, ageMs: number) {
  jest.setSystemTime(NOW - ageMs);
  const record = recordSupersededCid(cid, playerId);
  jest.setSystemTime(NOW);
  return record;
}

function unpinnedCids(): string[] {
  return mockFetch.mock.calls.map(([url]) =>
    decodeURIComponent(String(url).split('/').pop()!),
  );
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  process.env.NEXT_PUBLIC_ADMIN_ADDRESS = ADMIN;
  process.env.PINATA_API_KEY = 'key';
  process.env.PINATA_SECRET = 'secret';
  SessionStore.resetInstance();
  __resetForTests();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
  delete process.env.NEXT_PUBLIC_ADMIN_ADDRESS;
  delete process.env.PINATA_API_KEY;
  delete process.env.PINATA_SECRET;
  SessionStore.resetInstance();
  __resetForTests();
});

describe('/api/admin/ipfs-cleanup', () => {
  it('rejects unauthenticated and non-admin callers on GET and POST', async () => {
    supersede('bafyOld', 'p1', UNPIN_GRACE_PERIOD_MS + 1);

    expect((await GET(new NextRequest(URL))).status).toBe(401);
    expect(
      (await GET(new NextRequest(URL, { headers: authHeaders(NON_ADMIN) })))
        .status,
    ).toBe(401);
    expect((await POST(postRequest())).status).toBe(401);
    expect((await POST(postRequest(NON_ADMIN))).status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('GET returns all tracked records for admins', async () => {
    supersede('bafyA', 'p1', 1_000);
    const res = await GET(
      new NextRequest(URL, { headers: authHeaders(ADMIN) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.records).toHaveLength(1);
    expect(body.records[0]).toMatchObject({ cid: 'bafyA', playerId: 'p1' });
  });

  it('does not unpin records still inside the grace period', async () => {
    supersede('bafyFresh', 'p1', UNPIN_GRACE_PERIOD_MS - 1_000);

    const res = await POST(postRequest(ADMIN));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unpinned: [], skipped: [], errors: [] });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(getAllRecords()[0].unpinnedAt).toBeNull();
  });

  it('unpins eligible records via Pinata and marks them done', async () => {
    supersede('bafyOld', 'p1', UNPIN_GRACE_PERIOD_MS + 1_000);

    const res = await POST(postRequest(ADMIN));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      unpinned: ['bafyOld'],
      skipped: [],
      errors: [],
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.pinata.cloud/pinning/unpin/bafyOld',
      expect.objectContaining({
        method: 'DELETE',
        headers: { pinata_api_key: 'key', pinata_secret_api_key: 'secret' },
      }),
    );
    expect(getAllRecords()[0].unpinnedAt).toBe(NOW);

    // Already-unpinned records are not retried on the next run.
    mockFetch.mockClear();
    const again = await POST(postRequest(ADMIN));
    expect((await again.json()).unpinned).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('a Pinata failure for one record does not abort the others', async () => {
    supersede('bafyBad', 'p1', UNPIN_GRACE_PERIOD_MS + 1_000);
    supersede('bafyGood', 'p2', UNPIN_GRACE_PERIOD_MS + 1_000);
    mockFetch.mockImplementation(async (url: string) =>
      url.endsWith('bafyBad')
        ? new Response('boom', { status: 500 })
        : new Response(null, { status: 200 }),
    );

    const body = await (await POST(postRequest(ADMIN))).json();
    expect(body.unpinned).toEqual(['bafyGood']);
    expect(body.errors).toEqual([
      { cid: 'bafyBad', error: 'Pinata responded 500: boom' },
    ]);

    const byCid = Object.fromEntries(
      getAllRecords().map((r) => [r.cid, r.unpinnedAt]),
    );
    expect(byCid.bafyBad).toBeNull();
    expect(byCid.bafyGood).toBe(NOW);
  });

  it('summarises unpinned, skipped, and failed counts', async () => {
    supersede('bafyLive', 'p1', UNPIN_GRACE_PERIOD_MS + 1_000);
    supersede('bafyGone', 'p2', UNPIN_GRACE_PERIOD_MS + 1_000);
    supersede('bafyErr', 'p3', UNPIN_GRACE_PERIOD_MS + 1_000);
    supersede('bafyFresh', 'p4', 1_000);
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('bafyErr')) throw new Error('network down');
      return new Response(null, { status: 200 });
    });

    const body = await (
      await POST(
        postRequest(ADMIN, {
          currentCids: [{ playerId: 'p1', cid: 'bafyLive' }],
        }),
      )
    ).json();

    expect(body.unpinned).toEqual(['bafyGone']);
    expect(body.skipped).toEqual(['bafyLive']);
    expect(body.errors).toEqual([{ cid: 'bafyErr', error: 'network down' }]);
    expect(unpinnedCids().sort()).toEqual(['bafyErr', 'bafyGone']);
  });

  it('reports every eligible record as failed when Pinata credentials are missing', async () => {
    delete process.env.PINATA_SECRET;
    supersede('bafyOld', 'p1', UNPIN_GRACE_PERIOD_MS + 1_000);

    const body = await (await POST(postRequest(ADMIN))).json();
    expect(body.unpinned).toEqual([]);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].cid).toBe('bafyOld');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
