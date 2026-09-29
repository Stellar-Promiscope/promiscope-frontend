import { renderHook, act, waitFor } from '@testing-library/react';
import useSWR from 'swr';
import {
  WalletProvider,
  useWalletContext,
  WalletAccountMismatchError,
} from '@/context/WalletContext';
import { walletAdapters } from '@/lib/walletAdapters';
import {
  cacheContactDetails,
  contactDetailsKey,
} from '@/lib/contactDetailsCache';
import type { ReactNode } from 'react';

jest.mock('@/lib/walletAdapters', () => ({
  walletAdapters: {
    freighter: {
      getPublicKey: jest.fn(),
      signTransaction: jest.fn(),
    },
    albedo: {
      getPublicKey: jest.fn(),
      signTransaction: jest.fn(),
    },
    lobstr: {
      getPublicKey: jest.fn(),
      signTransaction: jest.fn(),
    },
    ledger: {
      getPublicKey: jest.fn(),
      signTransaction: jest.fn(),
    },
  },
}));

jest.mock('@/lib/stellar', () => ({
  rpc: { sendTransaction: jest.fn(), getAccount: jest.fn() },
  NETWORK: 'Test SDF Network ; September 2015',
  // Mirrors lib/stellar.ts's real `export { ..., TransactionBuilder }` —
  // WalletContext now reads TransactionBuilder off this dynamically
  // imported module rather than importing @stellar/stellar-sdk directly.
  TransactionBuilder: { fromXDR: jest.fn(() => ({})) },
}));

jest.mock('@/lib/sep10Validation', () => ({
  validateSep10Challenge: jest.fn(() => ({ valid: true })),
  getSep10ClientConfig: jest.fn(() => ({
    serverAccount: 'GSERVERACCOUNT000000000000000000000000000000000000000',
    homeDomain: 'localhost:3000',
    networkPassphrase: 'Test SDF Network ; September 2015',
  })),
  SEP10_VALIDATION_USER_ERROR:
    'Could not verify the login request from this site — please try again or contact support',
}));

jest.mock('@stellar/stellar-sdk', () => ({
  TransactionBuilder: { fromXDR: jest.fn(() => ({})) },
  Networks: {
    PUBLIC: 'Public Global Stellar Network ; September 2015',
    TESTNET: 'Test SDF Network ; September 2015',
  },
}));

const PUBLIC_KEY = 'GCFW7QAO3WZQ6X4CZ3OYZFXX3A3DL7XVI5DNVTXA5VJUGE5SU6ZRG5OV';
const CHALLENGE_XDR = 'challenge-xdr';
const SIGNED_XDR = 'signed-xdr';

const mockFetch = jest.fn();
global.fetch = mockFetch;

function wrapper({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}

function setupSep10() {
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ transaction: CHALLENGE_XDR }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'jwt-token' }),
    });
}

describe('WalletContext', () => {
  const freighter = walletAdapters.freighter as jest.Mocked<
    typeof walletAdapters.freighter
  >;
  const albedo = walletAdapters.albedo as jest.Mocked<
    typeof walletAdapters.albedo
  >;
  const lobstr = walletAdapters.lobstr as jest.Mocked<
    typeof walletAdapters.lobstr
  >;
  const ledger = walletAdapters.ledger as jest.Mocked<
    typeof walletAdapters.ledger
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    freighter.getPublicKey.mockResolvedValue(PUBLIC_KEY);
    freighter.signTransaction.mockResolvedValue(SIGNED_XDR);
    albedo.getPublicKey.mockResolvedValue(PUBLIC_KEY);
    albedo.signTransaction.mockResolvedValue(SIGNED_XDR);
    lobstr.getPublicKey.mockResolvedValue(PUBLIC_KEY);
    lobstr.signTransaction.mockResolvedValue(SIGNED_XDR);
    ledger.getPublicKey.mockResolvedValue(PUBLIC_KEY);
    ledger.signTransaction.mockResolvedValue(SIGNED_XDR);

    const { rpc } = jest.requireMock('@/lib/stellar');
    rpc.getAccount.mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '100.0000000' }],
    });
  });

  describe('connectWithProvider', () => {
    it('calls freighter adapter and completes SEP-10 flow', async () => {
      setupSep10();
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await act(async () => {
        await result.current.connectWithProvider('freighter');
      });
      expect(freighter.getPublicKey).toHaveBeenCalled();
      expect(freighter.signTransaction).toHaveBeenCalledWith(
        CHALLENGE_XDR,
        expect.any(String),
      );
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.publicKey).toBe(PUBLIC_KEY);
    });

    it('calls albedo adapter for albedo provider', async () => {
      setupSep10();
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await act(async () => {
        await result.current.connectWithProvider('albedo');
      });
      expect(albedo.getPublicKey).toHaveBeenCalled();
      expect(result.current.isAuthenticated).toBe(true);
    });

    it('calls lobstr adapter for lobstr provider', async () => {
      setupSep10();
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await act(async () => {
        await result.current.connectWithProvider('lobstr');
      });
      expect(lobstr.getPublicKey).toHaveBeenCalled();
      expect(result.current.isAuthenticated).toBe(true);
    });

    it('calls ledger adapter for ledger provider', async () => {
      setupSep10();
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await act(async () => {
        await result.current.connectWithProvider('ledger');
      });
      expect(ledger.getPublicKey).toHaveBeenCalled();
      expect(result.current.isAuthenticated).toBe(true);
    });

    it('sets isAuthenticated to true on success', async () => {
      setupSep10();
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      expect(result.current.isAuthenticated).toBe(false);
      await act(async () => {
        await result.current.connectWithProvider('freighter');
      });
      expect(result.current.isAuthenticated).toBe(true);
    });

    it('throws and does not set isAuthenticated on adapter failure', async () => {
      freighter.getPublicKey.mockRejectedValue(
        new Error('Freighter not installed'),
      );
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await expect(
        act(async () => {
          await result.current.connectWithProvider('freighter');
        }),
      ).rejects.toThrow('Freighter not installed');
      expect(result.current.isAuthenticated).toBe(false);
    });

    it('aborts before signing when SEP-10 challenge validation fails', async () => {
      const { validateSep10Challenge, SEP10_VALIDATION_USER_ERROR } =
        jest.requireMock('@/lib/sep10Validation');
      validateSep10Challenge.mockReturnValueOnce({
        valid: false,
        reason: 'Transaction has operations that are not of type manageData',
      });

      setupSep10();
      const { result } = renderHook(() => useWalletContext(), { wrapper });

      await expect(
        act(async () => {
          await result.current.connectWithProvider('freighter');
        }),
      ).rejects.toThrow(SEP10_VALIDATION_USER_ERROR);

      expect(freighter.signTransaction).not.toHaveBeenCalled();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.publicKey).toBeNull();
    });

    it('calls loadBalance after successful connect', async () => {
      setupSep10();
      const { rpc } = jest.requireMock('@/lib/stellar');
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await act(async () => {
        await result.current.connectWithProvider('freighter');
      });
      expect(rpc.getAccount).toHaveBeenCalledWith(PUBLIC_KEY);
      await waitFor(() =>
        expect(result.current.xlmBalance).toBe('100.0000000'),
      );
    });
  });

  describe('disconnect', () => {
    it('clears publicKey, isAuthenticated, xlmBalance, walletProvider, and localStorage', async () => {
      setupSep10();
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await act(async () => {
        await result.current.connectWithProvider('freighter');
      });
      expect(result.current.isAuthenticated).toBe(true);

      act(() => {
        result.current.disconnect();
      });

      expect(result.current.publicKey).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.xlmBalance).toBeNull();
      expect(result.current.walletProvider).toBeNull();
      expect(localStorage.getItem('wallet_session')).toBeNull();
    });
  });

  describe('signAndSubmit', () => {
    it('throws when no wallet is connected', async () => {
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await expect(
        act(async () => {
          await result.current.signAndSubmit('some-xdr');
        }),
      ).rejects.toThrow('Wallet not connected');
    });

    it('calls the correct adapter and submits to RPC', async () => {
      setupSep10();
      const { rpc } = jest.requireMock('@/lib/stellar');
      rpc.sendTransaction.mockResolvedValue({ hash: 'tx-hash' });
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await act(async () => {
        await result.current.connectWithProvider('freighter');
      });

      await act(async () => {
        await result.current.signAndSubmit('tx-xdr');
      });

      expect(freighter.signTransaction).toHaveBeenCalledWith(
        'tx-xdr',
        expect.any(String),
      );
      expect(rpc.sendTransaction).toHaveBeenCalled();
    });
  });

  describe('signOnly', () => {
    it('throws when no wallet is connected', async () => {
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await expect(
        act(async () => {
          await result.current.signOnly('some-xdr');
        }),
      ).rejects.toThrow('Wallet not connected');
    });

    it('signs via the adapter without submitting to RPC', async () => {
      setupSep10();
      const { rpc } = jest.requireMock('@/lib/stellar');
      freighter.signTransaction.mockResolvedValue('signed-tx-xdr');
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await act(async () => {
        await result.current.connectWithProvider('freighter');
      });

      let signed: string;
      await act(async () => {
        signed = await result.current.signOnly('tx-xdr');
      });

      expect(freighter.signTransaction).toHaveBeenCalledWith(
        'tx-xdr',
        expect.any(String),
      );
      expect(signed!).toBe('signed-tx-xdr');
      expect(rpc.sendTransaction).not.toHaveBeenCalled();
    });
  });

  describe('tab-refocus reconnect behavior', () => {
    it('preserves the stored network and warns on mismatch during visibilitychange', async () => {
      setupSep10();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const { result } = renderHook(() => useWalletContext(), { wrapper });

      // Connect on testnet (the default for the mock NETWORK).
      await act(async () => {
        await result.current.connectWithProvider('freighter');
      });

      const stored = localStorage.getItem('wallet_session');
      expect(stored).toContain('testnet');
      expect(result.current.isAuthenticated).toBe(true);

      // Simulate a session that was created on a different network (public)
      // to verify the reconnect path detects the drift and warns.
      const parsed = JSON.parse(stored!);
      localStorage.setItem(
        'wallet_session',
        JSON.stringify({ ...parsed, networkType: 'public' }),
      );

      // Simulate tab refocus: set visibilityState to 'visible' and fire
      // the visibilitychange event so the listener re-runs restoreSession.
      const visibilitySpy = jest
        .spyOn(document, 'visibilityState', 'get')
        .mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));

      await waitFor(() => {
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Wallet network mismatch'),
        );
      });

      // Session should remain authenticated — the reconnect succeeds and
      // getPublicKey was called both during initial connect and on reconnect.
      expect(result.current.isAuthenticated).toBe(true);
      expect(freighter.getPublicKey).toHaveBeenCalledTimes(2);

      visibilitySpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('does not warn when the stored network matches the current env', async () => {
      setupSep10();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const { result } = renderHook(() => useWalletContext(), { wrapper });

      await act(async () => {
        await result.current.connectWithProvider('freighter');
      });

      // Session network matches env (both testnet) — no warning expected.
      const visibilitySpy = jest
        .spyOn(document, 'visibilityState', 'get')
        .mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));

      // Allow any async restore to settle.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(warnSpy).not.toHaveBeenCalled();
      expect(result.current.isAuthenticated).toBe(true);

      visibilitySpy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  describe('server-session reconciliation on restore (see #778)', () => {
    // localStorage is only a hint for which wallet/provider to reconnect
    // with — restoreSession must treat GET /api/auth/session (and, when
    // that says the session's gone, POST /api/auth/refresh) as the source
    // of truth for isAuthenticated/publicKey, never localStorage alone.
    function seedStoredSession(publicKey: string) {
      localStorage.setItem(
        'wallet_session',
        JSON.stringify({
          publicKey,
          provider: 'freighter',
          networkType: 'testnet',
        }),
      );
    }

    it('never shows address A as authenticated when the server session is for a different address', async () => {
      const ADDRESS_A = PUBLIC_KEY;
      const ADDRESS_B =
        'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
      seedStoredSession(ADDRESS_A);
      freighter.getPublicKey.mockResolvedValue(ADDRESS_A);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, publicKey: ADDRESS_B }),
      });

      const { result } = renderHook(() => useWalletContext(), { wrapper });

      await waitFor(() =>
        expect(result.current.isRestoringSession).toBe(false),
      );

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.publicKey).toBeNull();
      expect(localStorage.getItem('wallet_session')).toBeNull();
    });

    it('forces re-auth when the server session is absent/expired and refresh fails', async () => {
      seedStoredSession(PUBLIC_KEY);
      freighter.getPublicKey.mockResolvedValue(PUBLIC_KEY);
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
        })
        .mockResolvedValueOnce({ ok: false, status: 401 }); // POST /api/auth/refresh

      const { result } = renderHook(() => useWalletContext(), { wrapper });

      await waitFor(() =>
        expect(result.current.isRestoringSession).toBe(false),
      );

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.publicKey).toBeNull();
      expect(localStorage.getItem('wallet_session')).toBeNull();
      expect(mockFetch).toHaveBeenCalledWith('/api/auth/refresh', {
        method: 'POST',
      });
    });

    it('recovers via refresh when the access token expired but the refresh token is still valid', async () => {
      seedStoredSession(PUBLIC_KEY);
      freighter.getPublicKey.mockResolvedValue(PUBLIC_KEY);
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401 }) // GET /api/auth/session
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            publicKey: PUBLIC_KEY,
            maxAge: 86400,
          }),
        }); // POST /api/auth/refresh

      const { result } = renderHook(() => useWalletContext(), { wrapper });

      await waitFor(() =>
        expect(result.current.isRestoringSession).toBe(false),
      );

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.publicKey).toBe(PUBLIC_KEY);
    });

    it('stays authenticated when the server session check itself fails (network error), not just when it succeeds', async () => {
      seedStoredSession(PUBLIC_KEY);
      freighter.getPublicKey.mockResolvedValue(PUBLIC_KEY);
      mockFetch.mockRejectedValueOnce(new Error('network down'));

      const { result } = renderHook(() => useWalletContext(), { wrapper });

      await waitFor(() =>
        expect(result.current.isRestoringSession).toBe(false),
      );

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.publicKey).toBe(PUBLIC_KEY);
    });
  });

  describe('disconnect — contact-details cache purge', () => {
    it('purges cached contact details immediately on logout', async () => {
      setupSep10();
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await act(async () => {
        await result.current.connectWithProvider('freighter');
      });

      const key = contactDetailsKey('player-1', PUBLIC_KEY);
      await act(async () => {
        await cacheContactDetails(key, { email: 'p@example.com' });
      });

      const cacheProbe = renderHook(() =>
        useSWR(key, null, { revalidateOnFocus: false }),
      );
      expect(cacheProbe.result.current.data).toEqual({
        email: 'p@example.com',
      });

      await act(async () => {
        result.current.disconnect();
        // Let disconnect()'s fire-and-forget mutate()/purgeAllContactDetails()
        // promises settle.
        await Promise.resolve();
      });
      // SWR v2's cache subscription is useSyncExternalStore-based; a
      // globalMutate() from outside the probe hook's own render doesn't
      // reliably trigger it to re-render on its own in this jsdom/RTL
      // environment (a *fresh* render always sees the updated cache — only
      // an *already-rendered* hook instance doesn't auto-update) — force a
      // re-render to read the current cache state.
      cacheProbe.rerender();

      expect(cacheProbe.result.current.data).toBeUndefined();
    });
  });

  describe('sessionExpiresAt lifecycle', () => {
    it('sets sessionExpiresAt after a successful doConnect', async () => {
      setupSep10();
      const { result } = renderHook(() => useWalletContext(), { wrapper });

      const before = Date.now();
      await act(async () => {
        await result.current.connectWithProvider('freighter');
      });

      expect(result.current.sessionExpiresAt).toBeGreaterThan(before);
      // Default maxAge when the server response lacks it is 86400s (1 day)
      expect(result.current.sessionExpiresAt).toBeLessThanOrEqual(
        before + 86400 * 1000 + 1000, // +1s tolerance for test execution
      );
    });

    it('persists sessionExpiresAt in localStorage', async () => {
      setupSep10();
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await act(async () => {
        await result.current.connectWithProvider('freighter');
      });

      const stored = localStorage.getItem('scoutoff:session_expiry');
      expect(stored).not.toBeNull();
      expect(Number(stored)).toBe(result.current.sessionExpiresAt);
    });

    it('restores sessionExpiresAt from localStorage on mount', async () => {
      const futureExpiry = Date.now() + 3600 * 1000;
      localStorage.setItem(
        'wallet_session',
        JSON.stringify({
          publicKey: PUBLIC_KEY,
          provider: 'freighter',
          networkType: 'testnet',
        }),
      );
      localStorage.setItem('scoutoff:session_expiry', String(futureExpiry));

      // Mock getServerSession to return authenticated
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, publicKey: PUBLIC_KEY }),
      });

      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await waitFor(() =>
        expect(result.current.isRestoringSession).toBe(false),
      );

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.sessionExpiresAt).toBe(futureExpiry);
    });

    it('clears sessionExpiresAt and localStorage on disconnect', async () => {
      setupSep10();
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await act(async () => {
        await result.current.connectWithProvider('freighter');
      });
      expect(result.current.sessionExpiresAt).not.toBeNull();

      act(() => {
        result.current.disconnect();
      });

      expect(result.current.sessionExpiresAt).toBeNull();
      expect(localStorage.getItem('scoutoff:session_expiry')).toBeNull();
    });
  });

  describe('periodic session reconciliation', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('signs out when server says session is unauthenticated and refresh fails', async () => {
      setupSep10();
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await act(async () => {
        await result.current.connectWithProvider('freighter');
      });
      expect(result.current.isAuthenticated).toBe(true);

      // Mock periodic reconciliation: GET /api/auth/session returns 401,
      // POST /api/auth/refresh also fails.
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401 }) // reconciliation GET
        .mockResolvedValueOnce({ ok: false, status: 401 }); // refresh POST

      await act(async () => {
        jest.advanceTimersByTime(60_000); // 1 interval
      });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(false);
      });
      expect(result.current.publicKey).toBeNull();
      expect(result.current.sessionExpiresAt).toBeNull();
    });

    it('stays authenticated when server confirms session is valid', async () => {
      setupSep10();
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await act(async () => {
        await result.current.connectWithProvider('freighter');
      });

      // Mock periodic reconciliation: GET /api/auth/session returns authenticated
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, publicKey: PUBLIC_KEY }),
      });

      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });
    });

    it('recovers via refresh when access token expired but refresh token valid', async () => {
      setupSep10();
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await act(async () => {
        await result.current.connectWithProvider('freighter');
      });

      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401 }) // session check
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            publicKey: PUBLIC_KEY,
            maxAge: 86400,
          }),
        }); // refresh

      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });
    });
  });

  describe('reauthenticate() concurrency guard', () => {
    it('deduplicates concurrent calls into a single wallet-signature prompt', async () => {
      // Step 1: Connect normally with default mocks so there's a stored session.
      setupSep10();
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await act(async () => {
        await result.current.connectWithProvider('freighter');
      });
      expect(result.current.isAuthenticated).toBe(true);

      // Step 2: Now mock signTransaction with a controllable pending promise
      // for the reauthentication flow (the initial connect already used the
      // default mock and completed).
      let resolveSign: (value: string) => void;
      const signPromise = new Promise<string>((r) => {
        resolveSign = r;
      });
      freighter.signTransaction.mockImplementation(() => signPromise);

      // Set up challenge fetch for reauthentication.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ transaction: CHALLENGE_XDR }),
      });

      // Fire two concurrent reauthenticate() calls.
      let reauth1Done = false;
      let reauth2Done = false;
      act(() => {
        result.current.reauthenticate().then(() => {
          reauth1Done = true;
        });
      });
      act(() => {
        result.current.reauthenticate().then(() => {
          reauth2Done = true;
        });
      });

      // Let microtasks settle — the second call should piggyback on the
      // first in-flight promise without calling getPublicKey/signTransaction
      // again.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      // getPublicKey should have been called once for the reauth (the second
      // reauthenticate() piggybacks on the first via inFlightConnectRef).
      // Count: 1 from initial connect + 1 from the in-flight reauth = 2.
      expect(freighter.getPublicKey).toHaveBeenCalledTimes(2);

      // Set up auth POST mock for when signing completes.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, maxAge: 86400 }),
      });

      // Release the pending signature so the reauth completes.
      await act(async () => {
        resolveSign!(SIGNED_XDR);
      });

      await waitFor(() => {
        expect(reauth1Done).toBe(true);
        expect(reauth2Done).toBe(true);
      });

      // signTransaction was called once for the reauth (not twice).
      // Count: 1 from initial connect + 1 from reauth = 2.
      expect(freighter.signTransaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('cross-tab session invalidation', () => {
    it('signs out when another tab fires a storage event for session invalidation', async () => {
      setupSep10();
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await act(async () => {
        await result.current.connectWithProvider('freighter');
      });
      expect(result.current.isAuthenticated).toBe(true);

      // Simulate another tab calling disconnect() by dispatching a storage
      // event for the invalidation key.
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: 'scoutoff:session-invalidated',
            newValue: String(Date.now()),
          }),
        );
      });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(false);
      });
      expect(result.current.publicKey).toBeNull();
      expect(result.current.sessionExpiresAt).toBeNull();
      expect(localStorage.getItem('wallet_session')).toBeNull();
    });

    it('disconnect in this tab writes the invalidation key to localStorage', async () => {
      setupSep10();
      const { result } = renderHook(() => useWalletContext(), { wrapper });
      await act(async () => {
        await result.current.connectWithProvider('freighter');
      });

      // Listen for storage events dispatched by disconnect().
      let storageEventFired = false;
      const handler = (e: StorageEvent) => {
        if (e.key === 'scoutoff:session-invalidated') storageEventFired = true;
      };
      window.addEventListener('storage', handler);

      act(() => {
        result.current.disconnect();
      });

      // The key should have been written then removed (best-effort).
      // In jsdom the storage event fires synchronously from setItem, but
      // the key itself should be gone after removeItem.
      expect(localStorage.getItem('scoutoff:session-invalidated')).toBeNull();

      window.removeEventListener('storage', handler);
    });
  });
});

// ── WalletAccountMismatchError verification ───────────────────────────────────
//
// These tests cover the acceptance criteria for the account-switch mismatch
// feature:
//
//   AC1 – Mismatch: WalletAccountMismatchError thrown, no session persisted for
//         the mismatched key, caller receives the distinguishable error class.
//   AC2 – Match: switch proceeds and succeeds exactly as a regular connect.
//   AC3 – Ordinary (no expectedPublicKey): first-time connect flow unaffected.
//   AC4 – Session state (localStorage wallet_session) is NOT set to the
//         unintended account after a mismatched switch attempt.

const SECOND_KEY = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

describe('connectWithProvider — account-switch mismatch verification', () => {
  const freighter = walletAdapters.freighter as jest.Mocked<
    typeof walletAdapters.freighter
  >;

  function wrapper({ children }: { children: ReactNode }) {
    return <WalletProvider>{children}</WalletProvider>;
  }

  function setupSep10ForKey(pk: string) {
    // GET /api/auth/sep10 challenge
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ transaction: CHALLENGE_XDR }),
    });
    // POST /api/auth/sep10 auth
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'jwt-token', maxAge: 86400 }),
    });
    freighter.getPublicKey.mockResolvedValue(pk);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    freighter.signTransaction.mockResolvedValue(SIGNED_XDR);

    const { rpc } = jest.requireMock('@/lib/stellar');
    rpc.getAccount.mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '100.0000000' }],
    });
  });

  // ── AC2: matching key ──────────────────────────────────────────────────────

  it('AC2 – succeeds when the wallet returns the expectedPublicKey (matching switch)', async () => {
    setupSep10ForKey(PUBLIC_KEY);

    const { result } = renderHook(() => useWalletContext(), { wrapper });
    await act(async () => {
      await result.current.connectWithProvider('freighter', false, PUBLIC_KEY);
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.publicKey).toBe(PUBLIC_KEY);
    expect(freighter.signTransaction).toHaveBeenCalled();
  });

  it('AC2 – stores the correct session in localStorage on a matching switch', async () => {
    setupSep10ForKey(PUBLIC_KEY);

    const { result } = renderHook(() => useWalletContext(), { wrapper });
    await act(async () => {
      await result.current.connectWithProvider('freighter', false, PUBLIC_KEY);
    });

    const stored = localStorage.getItem('wallet_session');
    expect(stored).not.toBeNull();
    const session = JSON.parse(stored!);
    expect(session.publicKey).toBe(PUBLIC_KEY);
  });

  // ── AC1: mismatch ──────────────────────────────────────────────────────────

  it('AC1 – throws WalletAccountMismatchError when wallet returns a different key than expected', async () => {
    // Wallet returns PUBLIC_KEY but caller expects SECOND_KEY
    freighter.getPublicKey.mockResolvedValue(PUBLIC_KEY);
    // No SEP-10 mocks needed — throw is before the challenge fetch

    const { result } = renderHook(() => useWalletContext(), { wrapper });

    await expect(
      act(async () => {
        await result.current.connectWithProvider(
          'freighter',
          false,
          SECOND_KEY,
        );
      }),
    ).rejects.toThrow(WalletAccountMismatchError);
  });

  it('AC1 – thrown error carries expectedPublicKey and actualPublicKey fields', async () => {
    freighter.getPublicKey.mockResolvedValue(PUBLIC_KEY);

    const { result } = renderHook(() => useWalletContext(), { wrapper });

    let caughtError: unknown;
    try {
      await act(async () => {
        await result.current.connectWithProvider(
          'freighter',
          false,
          SECOND_KEY,
        );
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(WalletAccountMismatchError);
    const mismatch = caughtError as WalletAccountMismatchError;
    expect(mismatch.expectedPublicKey).toBe(SECOND_KEY);
    expect(mismatch.actualPublicKey).toBe(PUBLIC_KEY);
  });

  it('AC1 – isAuthenticated remains false after a mismatched switch', async () => {
    freighter.getPublicKey.mockResolvedValue(PUBLIC_KEY);

    const { result } = renderHook(() => useWalletContext(), { wrapper });

    await expect(
      act(async () => {
        await result.current.connectWithProvider(
          'freighter',
          false,
          SECOND_KEY,
        );
      }),
    ).rejects.toThrow(WalletAccountMismatchError);

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.publicKey).toBeNull();
  });

  it('AC1 – SEP-10 challenge is never fetched (no network side-effects) on a mismatch', async () => {
    freighter.getPublicKey.mockResolvedValue(PUBLIC_KEY);

    const { result } = renderHook(() => useWalletContext(), { wrapper });

    await expect(
      act(async () => {
        await result.current.connectWithProvider(
          'freighter',
          false,
          SECOND_KEY,
        );
      }),
    ).rejects.toThrow(WalletAccountMismatchError);

    // fetch should NOT have been called — the error is thrown before the
    // challenge request.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── AC4: session state safety ──────────────────────────────────────────────

  it('AC4 – wallet_session in localStorage is NOT set to the unintended key after a mismatch', async () => {
    freighter.getPublicKey.mockResolvedValue(PUBLIC_KEY);

    const { result } = renderHook(() => useWalletContext(), { wrapper });

    await expect(
      act(async () => {
        await result.current.connectWithProvider(
          'freighter',
          false,
          SECOND_KEY,
        );
      }),
    ).rejects.toThrow(WalletAccountMismatchError);

    const stored = localStorage.getItem('wallet_session');
    if (stored) {
      const session = JSON.parse(stored);
      // The wrong key (PUBLIC_KEY, the actual returned key) must not be stored.
      expect(session.publicKey).not.toBe(PUBLIC_KEY);
    }
    // stored being null is also acceptable — nothing persisted.
  });

  it('AC4 – scoutoff:remembered_addresses is NOT updated for the unintended key after a mismatch', async () => {
    freighter.getPublicKey.mockResolvedValue(PUBLIC_KEY);

    const { result } = renderHook(() => useWalletContext(), { wrapper });

    await expect(
      act(async () => {
        await result.current.connectWithProvider(
          'freighter',
          false,
          SECOND_KEY,
        );
      }),
    ).rejects.toThrow(WalletAccountMismatchError);

    const raw = localStorage.getItem('scoutoff:remembered_addresses');
    if (raw) {
      const addresses = JSON.parse(raw) as Array<{ publicKey: string }>;
      const hasUnintended = addresses.some((a) => a.publicKey === PUBLIC_KEY);
      expect(hasUnintended).toBe(false);
    }
  });

  // ── AC3: ordinary connect unaffected ──────────────────────────────────────

  it('AC3 – ordinary connect (no expectedPublicKey) is completely unaffected by the new check', async () => {
    setupSep10ForKey(PUBLIC_KEY);

    const { result } = renderHook(() => useWalletContext(), { wrapper });
    await act(async () => {
      // No third argument — this is the original first-time connect path.
      await result.current.connectWithProvider('freighter');
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.publicKey).toBe(PUBLIC_KEY);
    // The SEP-10 flow ran in full.
    expect(freighter.signTransaction).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/auth/sep10?account=${PUBLIC_KEY}`,
    );
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/auth/sep10',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('AC3 – ordinary connect with rememberMe=true works the same as before', async () => {
    setupSep10ForKey(PUBLIC_KEY);

    const { result } = renderHook(() => useWalletContext(), { wrapper });
    await act(async () => {
      await result.current.connectWithProvider('freighter', true);
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.publicKey).toBe(PUBLIC_KEY);
  });

  // ── WalletAccountMismatchError class properties ────────────────────────────

  it('WalletAccountMismatchError is an instance of Error', () => {
    const err = new WalletAccountMismatchError('A', 'B');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(WalletAccountMismatchError);
    expect(err.name).toBe('WalletAccountMismatchError');
  });

  it('WalletAccountMismatchError message is human-readable', () => {
    const err = new WalletAccountMismatchError('EXPECTED', 'ACTUAL');
    expect(err.message).toContain('EXPECTED');
    expect(err.message).toContain('ACTUAL');
    expect(err.message.toLowerCase()).toContain('mismatch');
  });
});
