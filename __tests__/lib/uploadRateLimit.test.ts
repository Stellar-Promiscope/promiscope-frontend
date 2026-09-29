/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { createRateLimiter, getClientIp } from '@/lib/uploadRateLimit';

const WINDOW_MS = 60_000;

describe('createRateLimiter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows up to `limit` requests in a window', () => {
    const check = createRateLimiter(3, WINDOW_MS);
    for (let i = 0; i < 3; i++) {
      expect(check('1.1.1.1')).toEqual({ limited: false });
    }
  });

  it('limits request `limit + 1` and returns retryAfterSec', () => {
    const check = createRateLimiter(2, WINDOW_MS);
    check('1.1.1.1');
    check('1.1.1.1');
    jest.advanceTimersByTime(10_000);
    expect(check('1.1.1.1')).toEqual({ limited: true, retryAfterSec: 50 });
  });

  it('resets after the window elapses', () => {
    const check = createRateLimiter(1, WINDOW_MS);
    check('1.1.1.1');
    expect(check('1.1.1.1').limited).toBe(true);
    jest.advanceTimersByTime(WINDOW_MS + 1);
    expect(check('1.1.1.1')).toEqual({ limited: false });
  });

  it('tracks IPs independently', () => {
    const check = createRateLimiter(1, WINDOW_MS);
    check('1.1.1.1');
    expect(check('2.2.2.2')).toEqual({ limited: false });
  });

  it('does not share state between limiter instances', () => {
    const a = createRateLimiter(1, WINDOW_MS);
    const b = createRateLimiter(1, WINDOW_MS);
    a('1.1.1.1');
    expect(a('1.1.1.1').limited).toBe(true);
    expect(b('1.1.1.1')).toEqual({ limited: false });
  });
});

describe('getClientIp', () => {
  const req = (headers: Record<string, string>) =>
    new NextRequest('http://localhost/api/upload', { headers });

  it('prefers the first x-forwarded-for entry', () => {
    expect(
      getClientIp(
        req({
          'x-forwarded-for': ' 10.0.0.1 , 10.0.0.2',
          'x-real-ip': '10.0.0.9',
        }),
      ),
    ).toBe('10.0.0.1');
  });

  it('falls back to x-real-ip', () => {
    expect(getClientIp(req({ 'x-real-ip': '10.0.0.9' }))).toBe('10.0.0.9');
  });

  it('returns "unknown" when no IP headers are present', () => {
    expect(getClientIp(req({}))).toBe('unknown');
  });
});
