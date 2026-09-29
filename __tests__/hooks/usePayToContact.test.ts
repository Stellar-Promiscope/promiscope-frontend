'use client';

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { usePayToContact } from '@/hooks/usePayToContact';

const PUBLIC_KEY = 'G'.padEnd(56, 'X');

const mockUseWallet = jest.fn();
const mockShow = jest.fn();
const mockGetSubscription = jest.fn();
const mockPayToContact = jest.fn();
const mockRefreshBalance = jest.fn();
const mockCacheContactDetails = jest.fn();
const mockPurgeContactDetails = jest.fn();
const mockParseContractError = jest.fn();
const mockIsBlockedByCounterpart = jest.fn();

jest.mock('@/lib/messaging/moderation', () => ({
  isBlockedByCounterpart: (...args: unknown[]) =>
    mockIsBlockedByCounterpart(...args),
}));

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => mockUseWallet(),
}));

jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: mockShow }),
}));

jest.mock('@/lib/contract', () => ({
  getSubscription: (...args: unknown[]) => mockGetSubscription(...args),
  payToContact: (...args: unknown[]) => mockPayToContact(...args),
  PLATFORM_CONTACT_FEE_XLM: 1,
}));

jest.mock('@/lib/contactDetailsCache', () => ({
  cacheContactDetails: (...args: unknown[]) => mockCacheContactDetails(...args),
  contactDetailsKey: (playerId: string, wallet: string) =>
    `contact:${playerId}:${wallet}`,
  purgeContactDetails: (...args: unknown[]) => mockPurgeContactDetails(...args),
}));

// Release-endpoint stub: default is a vault hit returning decrypted PII.
// Individual tests override per-case (404 fallback, 503 failure).
const mockFetchRelease = jest.fn();

jest.mock('@/lib/contactReleaseClient', () => ({
  defaultFetchContactRelease: (...args: unknown[]) => mockFetchRelease(...args),
}));

jest.mock('@/lib/contractErrorMessage', () => ({
  parseContractError: (...args: unknown[]) => mockParseContractError(args[0]),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    SWRConfig,
    { value: { provider: () => new Map(), shouldRetryOnError: false } },
    children,
  );
}

const baseWallet = () => ({
  publicKey: PUBLIC_KEY,
  signOnly: jest.fn(),
  xlmBalance: '10',
  refreshBalance: mockRefreshBalance,
});

const baseSubscription = () => ({
  scout: PUBLIC_KEY,
  tier: 'basic',
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
});

describe('usePayToContact', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseWallet.mockReturnValue(baseWallet());
    mockGetSubscription.mockReset();
    mockPayToContact.mockReset();
    mockRefreshBalance.mockReset();
    mockCacheContactDetails.mockReset();
    mockPurgeContactDetails.mockReset();
    mockIsBlockedByCounterpart.mockReset();
    mockFetchRelease.mockReset();
    mockFetchRelease.mockResolvedValue({
      status: 200,
      details: { email: 'vault@example.com', phone: null, telegram: null },
    });
    mockParseContractError.mockImplementation((e: unknown) =>
      e instanceof Error ? e.message : 'unknown',
    );
    // Default happy path
    mockIsBlockedByCounterpart.mockResolvedValue(false);
    mockGetSubscription.mockResolvedValue(baseSubscription());
    mockPayToContact.mockResolvedValue({
      email: 'p@example.com',
      phone: null,
      telegram: null,
    });
    mockCacheContactDetails.mockResolvedValue(undefined);
    mockRefreshBalance.mockResolvedValue(undefined);
  });

  test('successful unlock: payToContact + cacheContactDetails + refreshBalance, no error', async () => {
    const { result } = renderHook(() => usePayToContact('p1'), { wrapper });

    await act(async () => {
      await result.current.unlock();
    });

    expect(mockPayToContact).toHaveBeenCalledTimes(1);
    expect(mockPayToContact).toHaveBeenCalledWith(
      PUBLIC_KEY,
      'p1',
      expect.any(Function),
    );
    // Vault release wins over the untrusted chain return value.
    expect(mockFetchRelease).toHaveBeenCalledWith('p1');
    expect(mockCacheContactDetails).toHaveBeenCalledWith(
      `contact:p1:${PUBLIC_KEY}`,
      { email: 'vault@example.com', phone: null, telegram: null },
    );
    expect(mockRefreshBalance).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  test('vault 404 falls back to the legacy chain return value (migration window)', async () => {
    mockFetchRelease.mockResolvedValueOnce({ status: 404 });
    const { result } = renderHook(() => usePayToContact('p1'), { wrapper });

    await act(async () => {
      await result.current.unlock();
    });

    expect(mockCacheContactDetails).toHaveBeenCalledWith(
      `contact:p1:${PUBLIC_KEY}`,
      { email: 'p@example.com', phone: null, telegram: null },
    );
    expect(result.current.error).toBeNull();
  });

  test('vault non-404 failure surfaces an error and caches nothing', async () => {
    mockFetchRelease.mockResolvedValueOnce({ status: 503 });
    const { result } = renderHook(() => usePayToContact('p1'), { wrapper });

    await act(async () => {
      await expect(result.current.unlock()).rejects.toThrow(
        'Contact release failed (status 503)',
      );
    });

    expect(mockCacheContactDetails).not.toHaveBeenCalled();
  });

  test('expired subscription: surfaces error, does not call payToContact or refreshBalance', async () => {
    // usePayToContact.fail() path on an expired subscription returns void;
    // no throw, so the await just resolves.
    mockGetSubscription.mockResolvedValueOnce({
      scout: PUBLIC_KEY,
      tier: 'basic',
      expiresAt: Math.floor(Date.now() / 1000) - 60,
    });

    const { result } = renderHook(() => usePayToContact('p1'), { wrapper });

    await act(async () => {
      await result.current.unlock();
    });

    expect(mockPayToContact).not.toHaveBeenCalled();
    expect(mockCacheContactDetails).not.toHaveBeenCalled();
    expect(mockRefreshBalance).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/subscription is required/i);
    expect(mockShow).toHaveBeenCalled();
  });

  test('insufficient balance: surfaces error, skips payToContact', async () => {
    mockUseWallet.mockReturnValue({ ...baseWallet(), xlmBalance: '0' });

    const { result } = renderHook(() => usePayToContact('p1'), { wrapper });

    await act(async () => {
      await result.current.unlock();
    });

    expect(mockPayToContact).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/insufficient xlm/i);
  });

  test('blocked by counterpart: surfaces error, skips subscription fetch and payToContact', async () => {
    mockIsBlockedByCounterpart.mockResolvedValueOnce(true);

    const { result } = renderHook(() => usePayToContact('p1'), { wrapper });

    await act(async () => {
      await result.current.unlock();
    });

    expect(mockIsBlockedByCounterpart).toHaveBeenCalledWith('p1');
    expect(mockGetSubscription).not.toHaveBeenCalled();
    expect(mockPayToContact).not.toHaveBeenCalled();
    expect(result.current.error).toBe(
      'This player is not accepting new contact requests.',
    );
    expect(mockShow).toHaveBeenCalled();
  });

  test('wallet not connected: surfaces error immediately, skips subscription fetch', async () => {
    mockUseWallet.mockReturnValue({ ...baseWallet(), publicKey: null });

    const { result } = renderHook(() => usePayToContact('p1'), { wrapper });

    await act(async () => {
      await result.current.unlock();
    });

    expect(mockGetSubscription).not.toHaveBeenCalled();
    expect(mockPayToContact).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/wallet not connected/i);
  });

  test('contract error from payToContact unmapped is re-thrown with parseContractError applied to error state', async () => {
    // Only this branch actually throws — the hook's catch block re-throws
    // after surfacing the parsed message via setError(), so the caller's
    // await rejects with the original error.
    mockPayToContact.mockRejectedValueOnce(new Error('ContractPaused'));
    mockParseContractError.mockReturnValueOnce(
      'Contract is paused. Try again later.',
    );

    const { result } = renderHook(() => usePayToContact('p1'), { wrapper });

    await act(async () => {
      await expect(result.current.unlock()).rejects.toThrow('ContractPaused');
    });

    expect(mockParseContractError).toHaveBeenCalled();
    expect(result.current.error).toBe('Contract is paused. Try again later.');
  });

  test('a rapid double-click on unlock() builds/signs/submits only one transaction (issue #1177)', async () => {
    let resolvePayToContact: (details: unknown) => void;
    mockPayToContact.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePayToContact = resolve;
      }),
    );

    const { result } = renderHook(() => usePayToContact('p1'), { wrapper });

    let first: Promise<unknown>;
    let second: Promise<unknown>;
    act(() => {
      // Both calls fire before payToContact's promise ever resolves —
      // simulates a fast double-click before the disabled state visually
      // registers.
      first = result.current.unlock();
      second = result.current.unlock();
    });

    await act(async () => {
      resolvePayToContact!({
        email: 'p@example.com',
        phone: null,
        telegram: null,
      });
      await Promise.all([first, second]);
    });

    expect(mockPayToContact).toHaveBeenCalledTimes(1);
    expect(mockCacheContactDetails).toHaveBeenCalledTimes(1);
    expect(mockRefreshBalance).toHaveBeenCalledTimes(1);
  });

  test('clear() calls purgeContactDetails with the same key unlock() targeted', async () => {
    const { result } = renderHook(() => usePayToContact('p1'), { wrapper });

    act(() => {
      result.current.clear();
    });

    expect(mockPurgeContactDetails).toHaveBeenCalledWith(
      `contact:p1:${PUBLIC_KEY}`,
    );
  });
});
