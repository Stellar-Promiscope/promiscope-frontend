import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import {
  useIndexerFreshness,
  isIndexerStale,
  markPendingIndexerWrite,
  resetPendingIndexerWrite,
  STALE_AFTER_MS,
  STALE_AFTER_LEDGERS,
} from '@/hooks/useIndexerFreshness';

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    SWRConfig,
    { value: { provider: () => new Map(), dedupingInterval: 0 } },
    children,
  );
}

function mockHealth(body: Record<string, unknown>) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  }) as jest.Mock;
}

beforeEach(() => resetPendingIndexerWrite());

describe('isIndexerStale', () => {
  const now = 1_000_000_000;
  test('fresh when recently updated and lag is low', () => {
    expect(
      isIndexerStale({ lastLedger: 1, lastUpdated: now, ledgerLag: 0 }, now),
    ).toBe(false);
  });
  test('stale past the time threshold', () => {
    expect(
      isIndexerStale(
        {
          lastLedger: 1,
          lastUpdated: now - STALE_AFTER_MS - 1,
          ledgerLag: 0,
        },
        now,
      ),
    ).toBe(true);
  });
  test('stale past the ledger-lag threshold', () => {
    expect(
      isIndexerStale(
        {
          lastLedger: 1,
          lastUpdated: now,
          ledgerLag: STALE_AFTER_LEDGERS + 1,
        },
        now,
      ),
    ).toBe(true);
  });
});

describe('useIndexerFreshness', () => {
  test('fetches /api/indexer/health and reports freshness', async () => {
    mockHealth({ lastLedger: 50, lastUpdated: Date.now(), ledgerLag: 2 });
    const { result } = renderHook(() => useIndexerFreshness(), { wrapper });
    await waitFor(() => expect(result.current.data?.lastLedger).toBe(50));
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/indexer/health',
      expect.anything(),
    );
    expect(result.current.stale).toBe(false);
  });

  test('pending write stays until the indexer passes the tx ledger', async () => {
    mockHealth({ lastLedger: 50, lastUpdated: Date.now(), ledgerLag: 0 });
    const { result } = renderHook(() => useIndexerFreshness(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    act(() => markPendingIndexerWrite(60));
    expect(result.current.pendingWrite).toBe(true);
  });

  test('pending write clears once the indexer has passed the tx ledger', async () => {
    mockHealth({ lastLedger: 50, lastUpdated: Date.now(), ledgerLag: 0 });
    const { result } = renderHook(() => useIndexerFreshness(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    act(() => markPendingIndexerWrite(45));
    await waitFor(() => expect(result.current.pendingWrite).toBe(false));
  });
});
