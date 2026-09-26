'use client';

/**
 * usePayToContact's USDC path (issue #1321): swap first, then the contract
 * call, with pending-swap recovery when the second step fails.
 */
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { usePayToContact } from '@/hooks/usePayToContact';
import { getPendingSwap, QUOTE_TTL_MS, USDC } from '@/lib/pathPayment';

const PUBLIC_KEY = 'G'.padEnd(56, 'X');
const PLAYER = 'player-1';

const mockUseWallet = jest.fn();
const mockShow = jest.fn();
const mockPayToContact = jest.fn();
const mockSwapToXlm = jest.fn();
const mockGetAssetBalance = jest.fn();

jest.mock('@/lib/messaging/moderation', () => ({
  isBlockedByCounterpart: async () => false,
}));
jest.mock('@/hooks/useWallet', () => ({ useWallet: () => mockUseWallet() }));
jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: mockShow }),
}));
jest.mock('@/lib/contract', () => ({
  getSubscription: async () => ({
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  }),
  payToContact: (...args: unknown[]) => mockPayToContact(...args),
  PLATFORM_CONTACT_FEE_XLM: 50,
}));
jest.mock('@/lib/contactDetailsCache', () => ({
  cacheContactDetails: jest.fn(),
  contactDetailsKey: (p: string, w: string) => `contact:${p}:${w}`,
  purgeContactDetails: jest.fn(),
}));
jest.mock('@/lib/contractErrorMessage', () => ({
  parseContractError: (e: unknown) =>
    e instanceof Error ? e.message : String(e),
}));
jest.mock('@/lib/pathPayment', () => ({
  ...jest.requireActual('@/lib/pathPayment'),
  swapToXlm: (...args: unknown[]) => mockSwapToXlm(...args),
  getAssetBalance: (...args: unknown[]) => mockGetAssetBalance(...args),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    SWRConfig,
    { value: { provider: () => new Map() } },
    children,
  );
}

const quote = (expiresAt = Date.now() + QUOTE_TTL_MS) => ({
  sourceAsset: USDC,
  sourceAmount: '12.3400000',
  destAmount: '50.0000000',
  path: [],
  expiresAt,
});

let xlmBalance = '1';

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  xlmBalance = '1';
  mockUseWallet.mockImplementation(() => ({
    publicKey: PUBLIC_KEY,
    signOnly: jest.fn(),
    xlmBalance,
    refreshBalance: jest.fn(),
  }));
  mockGetAssetBalance.mockResolvedValue(100);
  mockSwapToXlm.mockResolvedValue('swaphash');
  mockPayToContact.mockResolvedValue({ email: 'p@example.com' });
});

describe('usePayToContact — pay with USDC', () => {
  it('converts USDC to the exact XLM fee, then pays, then clears the pending swap', async () => {
    const { result } = renderHook(() => usePayToContact(PLAYER), { wrapper });

    await act(async () => {
      await result.current.unlockWithAsset({
        quote: quote(),
        slippageBps: 100,
      });
    });

    expect(mockSwapToXlm).toHaveBeenCalledWith(
      PUBLIC_KEY,
      expect.objectContaining({ destAmount: '50.0000000' }),
      100,
      expect.any(Function),
    );
    expect(mockPayToContact).toHaveBeenCalled();
    expect(mockSwapToXlm.mock.invocationCallOrder[0]).toBeLessThan(
      mockPayToContact.mock.invocationCallOrder[0],
    );
    expect(getPendingSwap(PUBLIC_KEY, PLAYER)).toBeNull();
  });

  it('never swaps on an expired quote', async () => {
    const { result } = renderHook(() => usePayToContact(PLAYER), { wrapper });

    await act(async () => {
      await result.current
        .unlockWithAsset({ quote: quote(Date.now() - 1), slippageBps: 100 })
        .catch(() => undefined);
    });

    expect(mockSwapToXlm).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/expired/i);
  });

  it('refuses when the USDC balance is below sendMax', async () => {
    mockGetAssetBalance.mockResolvedValue(12.4);
    const { result } = renderHook(() => usePayToContact(PLAYER), { wrapper });

    await act(async () => {
      await result.current.unlockWithAsset({
        quote: quote(),
        slippageBps: 100,
      });
    });

    expect(mockSwapToXlm).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/12\.4634000 USDC/);
  });

  it('keeps a pending swap when the contract call fails, and a retry skips the conversion', async () => {
    mockPayToContact.mockRejectedValueOnce(new Error('ContractPaused'));
    const { result, rerender } = renderHook(() => usePayToContact(PLAYER), {
      wrapper,
    });

    await act(async () => {
      await result.current
        .unlockWithAsset({ quote: quote(), slippageBps: 100 })
        .catch(() => undefined);
    });

    expect(result.current.error).toMatch(/converted to XLM/);
    expect(result.current.pendingSwap).toMatchObject({ txHash: 'swaphash' });
    expect(getPendingSwap(PUBLIC_KEY, PLAYER)).not.toBeNull();

    // The swap landed, so the wallet now holds the fee in XLM.
    xlmBalance = '51';
    rerender();
    await act(async () => {
      await result.current.unlock();
    });

    expect(mockSwapToXlm).toHaveBeenCalledTimes(1);
    expect(mockPayToContact).toHaveBeenCalledTimes(2);
    expect(result.current.pendingSwap).toBeNull();
    expect(getPendingSwap(PUBLIC_KEY, PLAYER)).toBeNull();
  });
});
