import { buildCsp, originOf } from '@/lib/csp';

describe('originOf', () => {
  it('extracts origin from a full URL', () => {
    expect(originOf('https://soroban-testnet.stellar.org/rpc')).toBe(
      'https://soroban-testnet.stellar.org',
    );
  });

  it('handles URLs with ports', () => {
    expect(originOf('http://localhost:3001/api')).toBe('http://localhost:3001');
  });

  it('returns null for undefined', () => {
    expect(originOf(undefined)).toBeNull();
  });

  it('returns null for malformed URLs', () => {
    expect(originOf('not-a-url')).toBeNull();
  });
});

describe('buildCsp', () => {
  const baseEnv = {
    NEXT_PUBLIC_SOROBAN_RPC: 'https://soroban-testnet.stellar.org',
    NEXT_PUBLIC_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    NEXT_PUBLIC_API_URL: 'https://api.scoutoff.app',
    NEXT_PUBLIC_INDEXER_API_URL: 'https://indexer.scoutoff.app',
    NEXT_PUBLIC_IPFS_GATEWAY: 'https://gateway.pinata.cloud/ipfs',
    SENTRY_DSN: 'https://abc123@o12345.ingest.sentry.io/67890',
    NODE_ENV: 'production',
  };

  it('includes nonce in script-src', () => {
    const csp = buildCsp({ nonce: 'test-nonce-123', env: baseEnv });
    expect(csp).toContain("'nonce-test-nonce-123'");
  });

  it('uses strict-dynamic in production', () => {
    const csp = buildCsp({ nonce: 'abc', env: baseEnv });
    expect(csp).toContain("'strict-dynamic'");
  });

  it('does not contain unsafe-inline in production script-src', () => {
    const csp = buildCsp({ nonce: 'abc', env: baseEnv });
    const scriptSrcDirective = csp
      .split(';')
      .find((d) => d.trim().startsWith('script-src'));
    expect(scriptSrcDirective).toBeDefined();
    expect(scriptSrcDirective).not.toContain("'unsafe-inline'");
  });

  it('adds unsafe-inline and unsafe-eval in development', () => {
    const csp = buildCsp({
      nonce: 'abc',
      env: { ...baseEnv, NODE_ENV: 'development' },
    });
    expect(csp).toContain("'unsafe-inline'");
    expect(csp).toContain("'unsafe-eval'");
  });

  it('includes soroban and horizon in connect-src', () => {
    const csp = buildCsp({ nonce: 'abc', env: baseEnv });
    expect(csp).toContain('https://soroban-testnet.stellar.org');
    expect(csp).toContain('https://horizon-testnet.stellar.org');
  });

  it('includes api and indexer origins in connect-src', () => {
    const csp = buildCsp({ nonce: 'abc', env: baseEnv });
    expect(csp).toContain('https://api.scoutoff.app');
    expect(csp).toContain('https://indexer.scoutoff.app');
  });

  it('includes coingecko in connect-src', () => {
    const csp = buildCsp({ nonce: 'abc', env: baseEnv });
    expect(csp).toContain('https://api.coingecko.com');
  });

  it('includes sentry ingest origin in connect-src', () => {
    const csp = buildCsp({ nonce: 'abc', env: baseEnv });
    expect(csp).toContain('https://o12345.ingest.sentry.io');
  });

  it('includes frame-src for Turnstile', () => {
    const csp = buildCsp({ nonce: 'abc', env: baseEnv });
    expect(csp).toContain('frame-src https://challenges.cloudflare.com');
  });

  it('includes worker-src for PWA service worker', () => {
    const csp = buildCsp({ nonce: 'abc', env: baseEnv });
    expect(csp).toContain("worker-src 'self'");
  });

  it('includes all IPFS gateway fallbacks in img-src', () => {
    const csp = buildCsp({ nonce: 'abc', env: baseEnv });
    expect(csp).toContain('https://ipfs.io');
    expect(csp).toContain('https://cloudflare-ipfs.com');
    expect(csp).toContain('https://dweb.link');
  });

  it('falls back to testnet defaults when env vars missing', () => {
    const csp = buildCsp({
      nonce: 'abc',
      env: {
        NEXT_PUBLIC_SOROBAN_RPC: undefined,
        NEXT_PUBLIC_HORIZON_URL: undefined,
        NEXT_PUBLIC_API_URL: undefined,
        NEXT_PUBLIC_INDEXER_API_URL: undefined,
        NEXT_PUBLIC_IPFS_GATEWAY: undefined,
        SENTRY_DSN: undefined,
        NODE_ENV: 'production',
      },
    });
    expect(csp).toContain('https://soroban-testnet.stellar.org');
    expect(csp).toContain('https://horizon-testnet.stellar.org');
  });

  it('does not produce duplicate origins', () => {
    const csp = buildCsp({ nonce: 'abc', env: baseEnv });
    const connectSrc = csp
      .split(';')
      .find((d) => d.trim().startsWith('connect-src'))!;
    const origins = connectSrc.trim().split(/\s+/).slice(1);
    const unique = new Set(origins);
    expect(origins.length).toBe(unique.size);
  });

  it('includes report-uri directive', () => {
    const csp = buildCsp({ nonce: 'abc', env: baseEnv });
    expect(csp).toContain('report-uri /api/csp-report');
  });
});
