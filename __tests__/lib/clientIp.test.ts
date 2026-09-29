import { getClientIp, _resetClientIpWarningsForTests } from '@/lib/clientIp';

describe('getClientIp (trusted-proxy aware IP extraction)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.VERCEL;
    delete process.env.TRUSTED_PROXY_COUNT;
    _resetClientIpWarningsForTests();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    _resetClientIpWarningsForTests();
  });

  describe('TRUSTED_PROXY_COUNT mode', () => {
    it('extracts the right-most untrusted hop when TRUSTED_PROXY_COUNT=1', () => {
      process.env.TRUSTED_PROXY_COUNT = '1';
      const req1 = {
        headers: new Headers({
          'x-forwarded-for': '203.0.113.1, 198.51.100.5',
        }),
      };
      expect(getClientIp(req1)).toBe('198.51.100.5');

      // Spoofing leftmost XFF value does not change extracted IP
      const req2 = {
        headers: new Headers({
          'x-forwarded-for': '1.2.3.4, 198.51.100.5',
        }),
      };
      expect(getClientIp(req2)).toBe('198.51.100.5');
    });

    it('extracts the right-most untrusted hop when TRUSTED_PROXY_COUNT=2', () => {
      process.env.TRUSTED_PROXY_COUNT = '2';
      const req = {
        headers: new Headers({
          'x-forwarded-for': 'spoofed.ip, 198.51.100.10, 172.16.0.1',
        }),
      };
      expect(getClientIp(req)).toBe('198.51.100.10');
    });

    it('handles fewer hops than TRUSTED_PROXY_COUNT by taking leftmost available hop', () => {
      process.env.TRUSTED_PROXY_COUNT = '3';
      const req = {
        headers: new Headers({
          'x-forwarded-for': '203.0.113.1, 198.51.100.1',
        }),
      };
      expect(getClientIp(req)).toBe('203.0.113.1');
    });
  });

  describe('Vercel mode', () => {
    beforeEach(() => {
      process.env.VERCEL = '1';
    });

    it('prefers req.ip when available', () => {
      const req = {
        ip: '203.0.113.50',
        headers: new Headers({
          'x-real-ip': '198.51.100.1',
          'x-forwarded-for': '1.1.1.1',
        }),
      };
      expect(getClientIp(req)).toBe('203.0.113.50');
    });

    it('uses x-real-ip when req.ip is absent', () => {
      const req = {
        headers: new Headers({
          'x-real-ip': '198.51.100.1',
          'x-forwarded-for': '1.1.1.1',
        }),
      };
      expect(getClientIp(req)).toBe('198.51.100.1');
    });

    it('falls back to x-forwarded-for when req.ip and x-real-ip are absent', () => {
      const req = {
        headers: new Headers({
          'x-forwarded-for': '203.0.113.99, 10.0.0.1',
        }),
      };
      expect(getClientIp(req)).toBe('203.0.113.99');
    });
  });

  describe('Direct exposure / Socket address fallback', () => {
    it('uses socket remoteAddress when neither Vercel nor TRUSTED_PROXY_COUNT is set', () => {
      const req = {
        headers: new Headers({
          'x-forwarded-for': 'spoofed.attacker.ip',
        }),
        socket: {
          remoteAddress: '192.168.1.100',
        },
      };
      expect(getClientIp(req)).toBe('192.168.1.100');
    });

    it('falls back to unknown and logs a warning at most once per process in production', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      Object.defineProperty(process.env, 'NODE_ENV', {
        value: 'production',
        configurable: true,
      });

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        const req = {
          headers: new Headers(),
        };

        expect(getClientIp(req)).toBe('unknown');
        expect(getClientIp(req)).toBe('unknown');
        expect(getClientIp(req)).toBe('unknown');

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain(
          'Unable to determine client IP',
        );
      } finally {
        Object.defineProperty(process.env, 'NODE_ENV', {
          value: originalNodeEnv,
          configurable: true,
        });
        warnSpy.mockRestore();
      }
    });
  });
});
