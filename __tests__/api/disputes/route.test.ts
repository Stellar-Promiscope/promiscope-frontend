/** @jest-environment node */
import { GET, POST } from '@/app/api/disputes/route';
import { NextRequest } from 'next/server';
import { MilestoneDisputeStore } from '@/lib/milestoneDisputeStore';
import { createSessionToken } from '@/lib/session';
import { SessionStore } from '@/lib/sessionStore';
import { getPlayer, getMilestoneHistory } from '@/lib/contract';
import type { Milestone, Player } from '@/types';

jest.mock('@/lib/contract', () => ({
  getPlayer: jest.fn(),
  getMilestoneHistory: jest.fn(),
}));

const mockGetPlayer = getPlayer as jest.MockedFunction<typeof getPlayer>;
const mockGetMilestoneHistory = getMilestoneHistory as jest.MockedFunction<
  typeof getMilestoneHistory
>;

const ADMIN = 'GADMIN0000000000000000000000000000000000000000000000000';
const SCOUT = 'GSCOUT0000000000000000000000000000000000000000000000000';
const OTHER = 'GOTHER0000000000000000000000000000000000000000000000000';

let sidCounter = 0;

// getSessionWallet checks lib/sessionStore.ts in addition to the token's
// signature (see #1179) — a cookie with no matching, active store row is
// treated as unauthenticated. Register the sid alongside the token so it
// mirrors what a real SEP-10 login produces.
function makeRequest(
  url: string,
  init: { method?: string; cookie?: string; body?: unknown } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (init.cookie !== undefined) {
    const sid = `sid-${sidCounter++}`;
    SessionStore.getInstance().create(
      sid,
      init.cookie,
      Date.now() + 60 * 60 * 1000,
    );
    headers['cookie'] =
      `session=${createSessionToken(init.cookie, 'access', 20 * 60, { sid })}`;
  }
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(url, {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

const mockPlayer: Player = {
  id: 'p1',
  wallet: SCOUT,
  vitals: {
    name: 'Player One',
    age: 20,
    position: 'Midfielder',
    region: 'Europe',
    nationality: 'DE',
  },
  ipfsHash: 'ipfs_test',
  progressLevel: 2,
  milestones: [],
  createdAt: 1700000000,
};

const mockMilestones: Milestone[] = [
  {
    id: 'm1',
    description: 'Real on-chain description',
    evidenceHash: 'evidence_1',
    validator: ADMIN,
    timestamp: 1700000100,
  },
];

beforeEach(() => {
  process.env.NEXT_PUBLIC_ADMIN_ADDRESS = ADMIN;
  MilestoneDisputeStore.resetInstance();
  SessionStore.resetInstance();
  jest.clearAllMocks();

  mockGetPlayer.mockResolvedValue(mockPlayer);
  mockGetMilestoneHistory.mockResolvedValue(mockMilestones);
});

afterEach(() => {
  MilestoneDisputeStore.resetInstance();
  SessionStore.resetInstance();
  delete process.env.NEXT_PUBLIC_ADMIN_ADDRESS;
});

describe('GET /api/disputes', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await GET(makeRequest('http://localhost/api/disputes'));
    expect(res.status).toBe(401);
  });

  it('returns 400 for an invalid status filter', async () => {
    const res = await GET(
      makeRequest('http://localhost/api/disputes?status=bogus', {
        cookie: SCOUT,
      }),
    );
    expect(res.status).toBe(400);
  });

  it('scopes results to the requesting wallet for non-admins', async () => {
    MilestoneDisputeStore.getInstance().create({
      playerId: 'p1',
      playerWallet: SCOUT,
      milestoneId: 'm1',
      milestoneDescription: 'desc',
      reason: 'this is a valid reason',
    });
    MilestoneDisputeStore.getInstance().create({
      playerId: 'p2',
      playerWallet: OTHER,
      milestoneId: 'm2',
      milestoneDescription: 'desc',
      reason: 'this is a valid reason',
    });

    const res = await GET(
      makeRequest('http://localhost/api/disputes', { cookie: SCOUT }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].playerWallet).toBe(SCOUT);
  });

  it('returns the full queue for admins, optionally filtered by status', async () => {
    MilestoneDisputeStore.getInstance().create({
      playerId: 'p1',
      playerWallet: SCOUT,
      milestoneId: 'm1',
      milestoneDescription: 'desc',
      reason: 'this is a valid reason',
    });
    MilestoneDisputeStore.getInstance().create({
      playerId: 'p2',
      playerWallet: OTHER,
      milestoneId: 'm2',
      milestoneDescription: 'desc',
      reason: 'this is a valid reason',
    });

    const res = await GET(
      makeRequest('http://localhost/api/disputes', { cookie: ADMIN }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
  });

  it('filters the admin queue by status', async () => {
    const store = MilestoneDisputeStore.getInstance();
    const d = store.create({
      playerId: 'p1',
      playerWallet: SCOUT,
      milestoneId: 'm1',
      milestoneDescription: 'desc',
      reason: 'this is a valid reason',
    });
    store.decide(d.id, {
      status: 'upheld',
      decidedBy: ADMIN,
      resolutionNote: null,
      revokeTxHash: null,
    });
    store.create({
      playerId: 'p2',
      playerWallet: OTHER,
      milestoneId: 'm2',
      milestoneDescription: 'desc',
      reason: 'this is a valid reason',
    });

    const res = await GET(
      makeRequest('http://localhost/api/disputes?status=pending', {
        cookie: ADMIN,
      }),
    );
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].status).toBe('pending');
  });

  it('returns 500 when the store throws', async () => {
    jest.spyOn(MilestoneDisputeStore, 'getInstance').mockImplementation(() => {
      throw new Error('db down');
    });

    const res = await GET(
      makeRequest('http://localhost/api/disputes', { cookie: SCOUT }),
    );
    expect(res.status).toBe(500);

    jest.restoreAllMocks();
  });
});

describe('POST /api/disputes', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/disputes', {
        method: 'POST',
        body: {
          playerId: 'p1',
          milestoneId: 'm1',
          milestoneDescription: 'desc',
          reason: 'this is a valid reason',
        },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 for an invalid JSON body', async () => {
    const sid = `sid-${sidCounter++}`;
    SessionStore.getInstance().create(sid, SCOUT, Date.now() + 60 * 60 * 1000);
    const req = new NextRequest('http://localhost/api/disputes', {
      method: 'POST',
      headers: {
        cookie: `session=${createSessionToken(SCOUT, 'access', 20 * 60, { sid })}`,
        'content-type': 'application/json',
      },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for a missing playerId', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/disputes', {
        method: 'POST',
        cookie: SCOUT,
        body: {
          milestoneId: 'm1',
          milestoneDescription: 'desc',
          reason: 'this is a valid reason',
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when reason is shorter than 10 characters', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/disputes', {
        method: 'POST',
        cookie: SCOUT,
        body: {
          playerId: 'p1',
          milestoneId: 'm1',
          milestoneDescription: 'desc',
          reason: 'too short',
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when player does not exist', async () => {
    mockGetPlayer.mockResolvedValue(null as unknown as Player);

    const res = await POST(
      makeRequest('http://localhost/api/disputes', {
        method: 'POST',
        cookie: SCOUT,
        body: {
          playerId: 'unknown_player',
          milestoneId: 'm1',
          reason: 'this is a valid reason',
        },
      }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/player not found/i);
  });

  it('returns 404 when getPlayer throws player not found', async () => {
    mockGetPlayer.mockRejectedValue(new Error('Player not found'));

    const res = await POST(
      makeRequest('http://localhost/api/disputes', {
        method: 'POST',
        cookie: SCOUT,
        body: {
          playerId: 'unknown_player',
          milestoneId: 'm1',
          reason: 'this is a valid reason',
        },
      }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/player not found/i);
  });

  it('returns 403 when session wallet does not match the player record wallet', async () => {
    mockGetPlayer.mockResolvedValue({
      ...mockPlayer,
      wallet: OTHER,
    });

    const res = await POST(
      makeRequest('http://localhost/api/disputes', {
        method: 'POST',
        cookie: SCOUT,
        body: {
          playerId: 'p1',
          milestoneId: 'm1',
          reason: 'trying to dispute another player',
        },
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/forbidden/i);
  });

  it('returns 404 when milestoneId is not in player milestone history', async () => {
    mockGetMilestoneHistory.mockResolvedValue([
      {
        id: 'different_milestone',
        description: 'Other description',
        evidenceHash: 'ev_other',
        validator: ADMIN,
        timestamp: 1700000200,
      },
    ]);

    const res = await POST(
      makeRequest('http://localhost/api/disputes', {
        method: 'POST',
        cookie: SCOUT,
        body: {
          playerId: 'p1',
          milestoneId: 'non_existent_milestone',
          reason: 'this is a valid reason',
        },
      }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('MILESTONE_NOT_FOUND');
    expect(body.error.message).toMatch(
      /milestone non_existent_milestone not found/i,
    );
  });

  it('creates a dispute with the authentic on-chain description even if client supplies forged description', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/disputes', {
        method: 'POST',
        cookie: SCOUT,
        body: {
          playerId: 'p1',
          milestoneId: 'm1',
          milestoneDescription: 'Client supplied forged description',
          reason: 'this is a valid reason',
        },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      playerId: 'p1',
      playerWallet: SCOUT,
      milestoneId: 'm1',
      milestoneDescription: 'Real on-chain description',
      status: 'pending',
    });
  });

  it('creates a dispute and returns it with 201 for valid player and milestone', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/disputes', {
        method: 'POST',
        cookie: SCOUT,
        body: {
          playerId: 'p1',
          milestoneId: 'm1',
          reason: 'this is a valid reason for my milestone',
        },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      playerId: 'p1',
      playerWallet: SCOUT,
      milestoneId: 'm1',
      milestoneDescription: 'Real on-chain description',
      status: 'pending',
    });
  });

  it('returns 409 for a duplicate open dispute on the same milestone', async () => {
    MilestoneDisputeStore.getInstance().create({
      playerId: 'p1',
      playerWallet: SCOUT,
      milestoneId: 'm1',
      milestoneDescription: 'Real on-chain description',
      reason: 'this is a valid reason',
    });

    const res = await POST(
      makeRequest('http://localhost/api/disputes', {
        method: 'POST',
        cookie: SCOUT,
        body: {
          playerId: 'p1',
          milestoneId: 'm1',
          reason: 'another valid reason here',
        },
      }),
    );
    expect(res.status).toBe(409);
  });

  it('returns 500 when the store throws unexpectedly', async () => {
    jest.spyOn(MilestoneDisputeStore, 'getInstance').mockImplementation(() => {
      throw new Error('db down');
    });

    const res = await POST(
      makeRequest('http://localhost/api/disputes', {
        method: 'POST',
        cookie: SCOUT,
        body: {
          playerId: 'p1',
          milestoneId: 'm1',
          reason: 'this is a valid reason',
        },
      }),
    );
    expect(res.status).toBe(500);

    jest.restoreAllMocks();
  });
});

describe('POST /api/disputes — server-side inputValidation parity (issue #1143)', () => {
  it('returns 400 when reason exceeds 2000 characters (max enforced server-side)', async () => {
    const overlong = 'a'.repeat(2001);
    const res = await POST(
      makeRequest('http://localhost/api/disputes', {
        method: 'POST',
        cookie: SCOUT,
        body: {
          playerId: 'p1',
          milestoneId: 'm1',
          reason: overlong,
        },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/reason/i);
  });

  it('returns 400 when reason is exactly at the limit (2000 chars) but contains only control chars', async () => {
    // A string of 2000 null-bytes sanitizes to empty, which is below min=10
    const controlOnly = '\x00'.repeat(2000);
    const res = await POST(
      makeRequest('http://localhost/api/disputes', {
        method: 'POST',
        cookie: SCOUT,
        body: {
          playerId: 'p1',
          milestoneId: 'm1',
          reason: controlOnly,
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('accepts a reason at exactly the 2000-character limit', async () => {
    const atLimit = 'a'.repeat(2000);
    const res = await POST(
      makeRequest('http://localhost/api/disputes', {
        method: 'POST',
        cookie: SCOUT,
        body: {
          playerId: 'p1',
          milestoneId: 'm1',
          reason: atLimit,
        },
      }),
    );
    // 201 means the validation passed and the dispute was created
    expect(res.status).toBe(201);
  });
});
