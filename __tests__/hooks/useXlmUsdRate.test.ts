/**
 * Unit tests for hooks/useXlmUsdRate.ts
 *
 * Covers:
 * - Basic fetch success/loading/error state transitions
 * - The /api/rates/xlm proxy URL, lowercased currency codes, and the
 *   stale/updatedAt/source metadata
 * - HTTP error, malformed-payload, and network-error failure paths
 * - The module-level `rateCache` Map: reused across hook instances and
 *   respects the 5-minute TTL
 * - The module-level `inFlight` Map: concurrent mounts share one fetch
 * - The `mountedRef` guard: no state updates (or warnings) after unmount
 * - convertXlmToFiat / formatFiat pure-function helpers
 *
 * IMPORTANT: rateCache and inFlight are module-level singletons shared by
 * every call to useXlmUsdRate in this process, so every test below uses a
 * currency code unique to that test (e.g. 'TCUR_CACHE') to avoid leaking
 * cached rates or in-flight promises into unrelated tests. Only the tests
 * that intentionally exercise cache-sharing reuse the same code across
 * multiple renderHook calls within a single test.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useXlmUsdRate,
  convertXlmToFiat,
  formatFiat,
} from '@/hooks/useXlmUsdRate';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

async function flushPromises(times = 8) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

function mockRateResponse(vsCurrency: string, rate: number) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ rate: rate }),
  });
}

function mockHttpError(status: number) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({}),
  });
}

function mockMalformedPayload(body: Record<string, unknown>) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => body,
  });
}

function mockNetworkFailure(error: unknown) {
  (global.fetch as jest.Mock).mockRejectedValueOnce(error);
}

beforeEach(() => {
  global.fetch = jest.fn();
});

// ── Basic success ─────────────────────────────────────────────────────────────

describe('useXlmUsdRate — basic fetch', () => {
  it('starts in a loading state, then resolves rate/loading/error', async () => {
    mockRateResponse('usd', 0.42);

    const { result } = renderHook(() => useXlmUsdRate());

    expect(result.current.loading).toBe(true);
    expect(result.current.rate).toBeNull();
    expect(result.current.error).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.rate).toBe(0.42);
    expect(result.current.error).toBeNull();

    // Same request also verifies the default currency ('USD') produces the
    // correctly-formed rate proxy URL.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/rates\/xlm\?vs=usd$/),
      expect.objectContaining({ cache: 'no-cache' }),
    );
  });
});

// ── Currency-code mapping ──────────────────────────────────────────────────────

describe('useXlmUsdRate — currency mapping', () => {
  it.each([
    ['EUR', 'eur'],
    ['GBP', 'gbp'],
    ['NGN', 'ngn'],
    ['KES', 'kes'],
    ['ZAR', 'zar'],
    ['JPY', 'jpy'],
    ['CAD', 'cad'],
    ['AUD', 'aud'],
    ['BRL', 'brl'],
  ])('requests the proxy with %s as vs=%s', async (code, vsCurrency) => {
    mockRateResponse(vsCurrency, 7);

    const { result } = renderHook(() => useXlmUsdRate(code));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.rate).toBe(7);
    expect(global.fetch).toHaveBeenLastCalledWith(
      expect.stringContaining(`vs=${vsCurrency}`),
      expect.anything(),
    );
  });

  it('falls back to a lowercased currency code when unmapped', async () => {
    mockRateResponse('xof', 650);

    const { result } = renderHook(() => useXlmUsdRate('XOF'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.rate).toBe(650);
    expect(global.fetch).toHaveBeenLastCalledWith(
      expect.stringContaining('vs=xof'),
      expect.anything(),
    );
  });
});

// ── Failure paths ──────────────────────────────────────────────────────────────

describe('useXlmUsdRate — failure paths', () => {
  it('sets an error and clears loading when the response is not ok', async () => {
    mockHttpError(500);

    const { result } = renderHook(() => useXlmUsdRate('TCUR_HTTP_ERR'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.rate).toBeNull();
    expect(result.current.error).toBe('Rate service returned 500');
  });

  it('sets an error when the rate is not a number', async () => {
    mockMalformedPayload({ rate: 'abc' });

    const { result } = renderHook(() => useXlmUsdRate('TCUR_MISSING'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.rate).toBeNull();
    expect(result.current.error).toBe('Invalid rate in response');
  });

  it('sets an error when the payload has no `rate` key at all', async () => {
    mockMalformedPayload({});

    const { result } = renderHook(() => useXlmUsdRate('TCUR_NO_STELLAR'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Invalid rate in response');
  });

  it('exposes stale/updatedAt/source metadata from the proxy', async () => {
    mockMalformedPayload({
      rate: 0.3,
      updatedAt: '2026-01-01T00:00:00.000Z',
      stale: true,
      source: 'stellar-dex',
    });

    const { result } = renderHook(() => useXlmUsdRate('TCUR_STALE'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current).toMatchObject({
      rate: 0.3,
      stale: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
      source: 'stellar-dex',
      error: null,
    });
  });

  it('sets an error when the reported rate is zero or negative', async () => {
    mockMalformedPayload({ rate: 0 });

    const { result } = renderHook(() => useXlmUsdRate('TCUR_ZERO'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.rate).toBeNull();
    expect(result.current.error).toBe('Invalid rate in response');
  });

  it('surfaces the error message from a rejected fetch', async () => {
    mockNetworkFailure(new Error('network unreachable'));

    const { result } = renderHook(() => useXlmUsdRate('TCUR_NETERR'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.rate).toBeNull();
    expect(result.current.error).toBe('network unreachable');
  });

  it('falls back to a generic message when the rejection has no `message`', async () => {
    mockNetworkFailure('boom');

    const { result } = renderHook(() => useXlmUsdRate('TCUR_STRERR'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Failed to fetch rate');
  });
});

// ── Module-level rate cache ────────────────────────────────────────────────────

describe('useXlmUsdRate — shared rate cache', () => {
  it('reuses a fresh cached rate for a later hook instance without an extra fetch', async () => {
    mockRateResponse('tcur_cache', 2.5);

    const first = renderHook(() => useXlmUsdRate('TCUR_CACHE'));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current.rate).toBe(2.5);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    first.unmount();

    // A brand-new instance for the same currency should read the cache
    // synchronously (via the lazy useState initializer) with no fetch.
    const second = renderHook(() => useXlmUsdRate('TCUR_CACHE'));
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.rate).toBe(2.5);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps separate cache entries per currency code', async () => {
    mockRateResponse('tcura', 1);
    mockRateResponse('tcurb', 2);

    const a = renderHook(() => useXlmUsdRate('TCURA'));
    await waitFor(() => expect(a.result.current.loading).toBe(false));

    const b = renderHook(() => useXlmUsdRate('TCURB'));
    await waitFor(() => expect(b.result.current.loading).toBe(false));

    expect(a.result.current.rate).toBe(1);
    expect(b.result.current.rate).toBe(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('refetches once the cached rate is older than the 5-minute TTL', async () => {
    jest.useFakeTimers();
    try {
      mockRateResponse('tcur_ttl', 1.1);

      const first = renderHook(() => useXlmUsdRate('TCUR_TTL'));
      await act(async () => {
        await flushPromises();
      });
      expect(first.result.current.rate).toBe(1.1);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      first.unmount();

      act(() => {
        jest.advanceTimersByTime(FIVE_MINUTES_MS + 1);
      });

      mockRateResponse('tcur_ttl', 9.9);
      const second = renderHook(() => useXlmUsdRate('TCUR_TTL'));

      // Stale cache is ignored — hook starts loading again.
      expect(second.result.current.loading).toBe(true);

      await act(async () => {
        await flushPromises();
      });

      expect(second.result.current.rate).toBe(9.9);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('still serves the cached rate just before the TTL boundary', async () => {
    jest.useFakeTimers();
    try {
      mockRateResponse('tcur_ttl2', 3.3);

      const first = renderHook(() => useXlmUsdRate('TCUR_TTL2'));
      await act(async () => {
        await flushPromises();
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      first.unmount();

      act(() => {
        jest.advanceTimersByTime(FIVE_MINUTES_MS - 1000);
      });

      const second = renderHook(() => useXlmUsdRate('TCUR_TTL2'));
      expect(second.result.current.loading).toBe(false);
      expect(second.result.current.rate).toBe(3.3);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ── In-flight request de-duplication ───────────────────────────────────────────

describe('useXlmUsdRate — in-flight de-duplication', () => {
  it('shares a single fetch across concurrent hook instances for the same currency', async () => {
    let resolveFetch!: (value: unknown) => void;
    (global.fetch as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const a = renderHook(() => useXlmUsdRate('TCUR_INFLIGHT'));
    const b = renderHook(() => useXlmUsdRate('TCUR_INFLIGHT'));

    expect(a.result.current.loading).toBe(true);
    expect(b.result.current.loading).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch({
        ok: true,
        status: 200,
        json: async () => ({ rate: 3.3 }),
      });
      await flushPromises();
    });

    expect(a.result.current.rate).toBe(3.3);
    expect(b.result.current.rate).toBe(3.3);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('lets a fresh mount after the in-flight request fails start a new fetch', async () => {
    let rejectFetch!: (error: unknown) => void;
    (global.fetch as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFetch = reject;
        }),
    );

    const first = renderHook(() => useXlmUsdRate('TCUR_INFLIGHT_FAIL'));

    await act(async () => {
      rejectFetch(new Error('rpc down'));
      await flushPromises();
    });

    expect(first.result.current.error).toBe('rpc down');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    mockRateResponse('tcur_inflight_fail', 4.4);
    const second = renderHook(() => useXlmUsdRate('TCUR_INFLIGHT_FAIL'));
    await waitFor(() => expect(second.result.current.loading).toBe(false));

    expect(second.result.current.rate).toBe(4.4);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

// ── mountedRef unmount guard ────────────────────────────────────────────────────

describe('useXlmUsdRate — unmount safety', () => {
  it('does not warn about updating state on an unmounted component', async () => {
    let resolveFetch!: (value: unknown) => void;
    (global.fetch as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { unmount } = renderHook(() => useXlmUsdRate('TCUR_UNMOUNT'));
    unmount();

    await act(async () => {
      resolveFetch({
        ok: true,
        status: 200,
        json: async () => ({ rate: 4.4 }),
      });
      await flushPromises();
    });

    const unmountWarnings = consoleError.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && /unmounted component/i.test(msg),
    );
    expect(unmountWarnings).toHaveLength(0);

    consoleError.mockRestore();
  });

  it('still populates the shared cache after unmount for a later mount to read', async () => {
    let resolveFetch!: (value: unknown) => void;
    (global.fetch as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { unmount } = renderHook(() => useXlmUsdRate('TCUR_UNMOUNT_CACHE'));
    unmount();

    await act(async () => {
      resolveFetch({
        ok: true,
        status: 200,
        json: async () => ({ rate: 5.5 }),
      });
      await flushPromises();
    });

    const { result } = renderHook(() => useXlmUsdRate('TCUR_UNMOUNT_CACHE'));
    expect(result.current.rate).toBe(5.5);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

// ── convertXlmToFiat ────────────────────────────────────────────────────────────

describe('convertXlmToFiat', () => {
  it('returns null when the rate is null', () => {
    expect(convertXlmToFiat(100, null)).toBeNull();
  });

  it('multiplies the XLM amount by the rate', () => {
    expect(convertXlmToFiat(10, 0.5)).toBe(5);
  });

  it('returns 0 for a 0 XLM amount', () => {
    expect(convertXlmToFiat(0, 1.23)).toBe(0);
  });

  it('handles a 0 rate distinctly from a null rate', () => {
    expect(convertXlmToFiat(10, 0)).toBe(0);
  });
});

// ── formatFiat ──────────────────────────────────────────────────────────────────

describe('formatFiat', () => {
  it('formats USD with a $ symbol and 2 decimal places by default', () => {
    expect(formatFiat(12.3)).toBe('$12.30');
  });

  it.each([
    ['EUR', '€'],
    ['GBP', '£'],
    ['NGN', '₦'],
    ['KES', 'KSh'],
    ['ZAR', 'R'],
    ['JPY', '¥'],
    ['CAD', 'CA$'],
    ['AUD', 'A$'],
    ['BRL', 'R$'],
  ])('formats %s with the %s symbol', (currency, symbol) => {
    expect(formatFiat(9, currency)).toBe(`${symbol}9.00`);
  });

  it('falls back to "<CODE> " prefix for unknown currencies', () => {
    expect(formatFiat(9, 'XOF')).toBe('XOF 9.00');
  });

  it('pads to 2 decimal places for whole and single-decimal amounts', () => {
    expect(formatFiat(1, 'USD')).toBe('$1.00');
    expect(formatFiat(1.2, 'USD')).toBe('$1.20');
  });

  it('truncates/rounds beyond 2 decimal places', () => {
    expect(formatFiat(1.239, 'USD')).toBe('$1.24');
  });
});
