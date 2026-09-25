/** @jest-environment node */
import { GET } from '@/app/api/admin/fraud-flags/status/route';
import { NextRequest } from 'next/server';
import { FraudFlagsStore } from '@/lib/fraudFlagsStore';
import { createSessionToken } from '@/lib/session';
import { SessionStore } from '@/lib/sessionStore';
import type { FraudFlag } from '@/types';

const ADMIN = 'GADMIN0000000000000000000000000000000000000000000000000';

function makeRequest(cookie?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) {
    const sid = `sid-${Math.random()}`;
    SessionStore.getInstance().create(sid, cookie, Date.now() + 60_000);
    headers['cookie'] =
      `session=${createSessionToken(cookie, 'access', 20 * 60, { sid })}`;
  }
  return new NextRequest('http://localhost/api/admin/fraud-flags/status', {
    headers,
  });
}

function flag(severity: FraudFlag['severity']): FraudFlag {
  return {
    id: 'f-1',
    category: 'referral',
    heuristic: 'test',
    severity,
    wallets: ['G1'],
    reason: 'test',
    evidence: {},
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_ADMIN_ADDRESS = ADMIN;
  SessionStore.resetInstance();
  FraudFlagsStore.resetInstance();
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_ADMIN_ADDRESS;
  SessionStore.resetInstance();
  FraudFlagsStore.resetInstance();
});

describe('GET /api/admin/fraud-flags/status', () => {
  it('returns 403 without an admin session cookie', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });

  it('returns default null status when no evaluation run has been persisted yet', async () => {
    const res = await GET(makeRequest(ADMIN));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.evaluatedAt).toBeNull();
    expect(body.highSeverityCount).toBe(0);
    expect(body.trigger).toBeNull();
    expect(body.eventsProcessed).toBe(0);
    expect(body.durationMs).toBe(0);
    expect(body.lastLedger).toBe(0);
  });

  it('returns the latest run stats and checkpoint sequence', async () => {
    const store = FraudFlagsStore.getInstance();
    store.saveCheckpoint(1500, 'e-1500');
    store.recordRun('cron', [flag('high')], [], 1_700_000_500, 240, 850);

    const res = await GET(makeRequest(ADMIN));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.evaluatedAt).toBe(1_700_000_500);
    expect(body.highSeverityCount).toBe(1);
    expect(body.trigger).toBe('cron');
    expect(body.eventsProcessed).toBe(240);
    expect(body.durationMs).toBe(850);
    expect(body.lastLedger).toBe(1500);
  });
});
