import { NextRequest } from 'next/server';

let hasWarnedUnknownIp = false;

/**
 * Resets the warning flag for tests.
 */
export function _resetClientIpWarningsForTests(): void {
  hasWarnedUnknownIp = false;
}

export type ClientIpRequest =
  | NextRequest
  | Request
  | {
      headers: Headers;
      ip?: string;
      socket?: { remoteAddress?: string };
      conn?: { remoteAddress?: string };
    };

/**
 * Extracts the client IP address in a trusted-proxy-aware manner.
 *
 * Precedence:
 * 1. If process.env.VERCEL is set, prefer platform IP (req.ip / x-real-ip / x-forwarded-for).
 * 2. Else if TRUSTED_PROXY_COUNT=N is set (N > 0), take xff[xff.length - N].
 * 3. Else use socket address if available, falling back to x-real-ip / x-forwarded-for / 'unknown',
 *    with a warning logged at most once per process in production when falling back to 'unknown'.
 */
export function getClientIp(req: ClientIpRequest): string {
  // 1. Vercel mode: platform overwrites/provides headers
  if (process.env.VERCEL) {
    if ('ip' in req && typeof req.ip === 'string' && req.ip.trim()) {
      return req.ip.trim();
    }
    const realIp = req.headers.get('x-real-ip');
    if (realIp && realIp.trim()) {
      return realIp.trim();
    }
    const forwarded = req.headers.get('x-forwarded-for');
    if (forwarded && forwarded.trim()) {
      const parts = forwarded
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length > 0) {
        return parts[0];
      }
    }
    return getSocketOrUnknown(req);
  }

  // 2. TRUSTED_PROXY_COUNT mode: count right-most trusted hops
  const rawProxyCount = process.env.TRUSTED_PROXY_COUNT;
  if (rawProxyCount !== undefined && rawProxyCount !== '') {
    const trustedProxyCount = parseInt(rawProxyCount, 10);
    if (!isNaN(trustedProxyCount) && trustedProxyCount > 0) {
      const forwarded = req.headers.get('x-forwarded-for');
      if (forwarded && forwarded.trim()) {
        const parts = forwarded
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (parts.length > 0) {
          const index = Math.max(0, parts.length - trustedProxyCount);
          return parts[index];
        }
      }
      const realIp = req.headers.get('x-real-ip');
      if (realIp && realIp.trim()) {
        return realIp.trim();
      }
      return getSocketOrUnknown(req);
    }
  }

  // 3. Untrusted / Direct exposure fallback
  const socketIp = getSocketAddress(req);
  if (socketIp) {
    return socketIp;
  }

  const realIp = req.headers.get('x-real-ip');
  if (realIp && realIp.trim()) {
    return realIp.trim();
  }

  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded && forwarded.trim()) {
    const parts = forwarded
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      return parts[0];
    }
  }

  return getSocketOrUnknown(req);
}

function getSocketAddress(req: ClientIpRequest): string | null {
  if ('ip' in req && typeof req.ip === 'string' && req.ip.trim()) {
    return req.ip.trim();
  }
  if (
    'socket' in req &&
    req.socket &&
    typeof req.socket.remoteAddress === 'string' &&
    req.socket.remoteAddress.trim()
  ) {
    return req.socket.remoteAddress.trim();
  }
  if (
    'conn' in req &&
    req.conn &&
    typeof req.conn.remoteAddress === 'string' &&
    req.conn.remoteAddress.trim()
  ) {
    return req.conn.remoteAddress.trim();
  }
  return null;
}

function getSocketOrUnknown(req: ClientIpRequest): string {
  const socketIp = getSocketAddress(req);
  if (socketIp) {
    return socketIp;
  }

  if (process.env.NODE_ENV === 'production' && !hasWarnedUnknownIp) {
    hasWarnedUnknownIp = true;
    console.warn(
      '[clientIp] Unable to determine client IP address; falling back to "unknown". Check proxy configuration.',
    );
  }
  return 'unknown';
}
