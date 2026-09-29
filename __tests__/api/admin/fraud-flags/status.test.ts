/** @jest-environment node */
import { GET } from '@/app/api/admin/fraud-flags/status/route';
import { NextRequest } from 'next/server';
import { FraudFlagsStore } from '@/lib/fraudFlagsStore';
import { createSessionToken } from '@/lib/session';
import { SessionStore } from '@/lib/sessionStore';
import type { FraudFlag } from '@/types';

const ADMIN = 'GADMIN0000000000000000000000000000000000000000000000000';
const NON_ADMIN = 'GUSER00000000000000000000000000000000000000000000000000';
const NOW = new Date('2026-01-15T12:00:00Z').getTime();

function makeRequest(wallet?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (wallet !== undefined) {
    const sid = `sid-${Math.random()}`;
    SessionStore.getInstance().create(sid, wallet, Date.now() + 60_000);
    headers['cookie'] =
      `session=${createSessionToken(wallet, 'access', 20 * 60, { sid })}`;
  }
  return new NextRequest('http://localhost/api/admin/fraud-flags/status', {
    headers,
  });
}

function flag(severity: FraudFlag['severity'], id: string): FraudFlag {
  return {
    id,
    category: 'referral',
    heuristic: 'test',
    severity,
    wallets: ['GSOMEONE'],
    reason: 'test reason',
    evidence: {},
  };
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  process.env.NEXT_PUBLIC_ADMIN_ADDRESS = ADMIN;
  SessionStore.resetInstance();
  FraudFlagsStore.resetInstance();
});

afterEach(() => {
  jest.useRealTimers();
  delete process.env.NEXT_PUBLIC_ADMIN_ADDRESS;
  SessionStore.resetInstance();
  FraudFlagsStore.resetInstance();
});

describe('GET /api/admin/fraud-flags/status', () => {
  it('rejects unauthenticated callers with 403', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });

  it('rejects non-admin callers with 403', async () => {
    const res = await GET(makeRequest(NON_ADMIN));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
  });

  it('returns the no-runs-yet state when nothing has been evaluated', async () => {
    const res = await GET(makeRequest(ADMIN));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      evaluatedAt: null,
      highSeverityCount: 0,
      trigger: null,
    });
  });

  it('returns the expected fields for a recent run', async () => {
    FraudFlagsStore.getInstance().recordRun(
      'cron',
      [flag('high', 'a'), flag('high', 'b'), flag('low', 'c')],
      [],
      NOW - 60_000,
    );

    const res = await GET(makeRequest(ADMIN));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      evaluatedAt: NOW - 60_000,
      highSeverityCount: 2,
      trigger: 'cron',
    });
  });

  it('reports the stale last-run timestamp so the badge can flag it', async () => {
    const staleAt = NOW - 7 * 24 * 60 * 60 * 1000;
    FraudFlagsStore.getInstance().recordRun('manual', [], [], staleAt);

    const res = await GET(makeRequest(ADMIN));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.evaluatedAt).toBe(staleAt);
    expect(body.trigger).toBe('manual');
    expect(body.highSeverityCount).toBe(0);
  });

  it('returns only the most recent run when several exist', async () => {
    const store = FraudFlagsStore.getInstance();
    store.recordRun('manual', [flag('high', 'x')], [], NOW - 120_000);
    store.recordRun('cron', [], [], NOW - 10_000);

    const body = await (await GET(makeRequest(ADMIN))).json();
    expect(body).toEqual({
      evaluatedAt: NOW - 10_000,
      highSeverityCount: 0,
      trigger: 'cron',
    });
  });
});
