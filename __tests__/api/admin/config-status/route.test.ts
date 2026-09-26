/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/admin/config-status/route';
import { createSessionToken } from '@/lib/session';
import { SessionStore } from '@/lib/sessionStore';

const ADMIN = 'GADMIN0000000000000000000000000000000000000000000000000';
const OTHER = 'GOTHER0000000000000000000000000000000000000000000000000';

let sidCounter = 0;

function makeRequest(wallet?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (wallet !== undefined) {
    const sid = `config-sid-${sidCounter++}`;
    SessionStore.getInstance().create(sid, wallet, Date.now() + 60 * 60 * 1000);
    headers['cookie'] =
      `session=${createSessionToken(wallet, 'access', 20 * 60, { sid })}`;
  }
  return new NextRequest('http://localhost/api/admin/config-status', {
    headers,
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_ADMIN_ADDRESS = ADMIN;
});

describe('GET /api/admin/config-status', () => {
  it('returns 401 without a session', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin wallet', async () => {
    const res = await GET(makeRequest(OTHER));
    expect(res.status).toBe(403);
  });

  it('returns presence flags for an admin', async () => {
    process.env.PINATA_SECRET = 'x';
    const res = await GET(makeRequest(ADMIN));
    expect(res.status).toBe(200);
    const body: { name: string; present: boolean }[] = await res.json();
    expect(body.find((v) => v.name === 'PINATA_SECRET')?.present).toBe(true);
    expect(JSON.stringify(body)).not.toContain('"x"');
  });
});
