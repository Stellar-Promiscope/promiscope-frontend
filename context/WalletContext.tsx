'use client';
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
} from 'react';
import { mutate } from 'swr';
import { walletAdapters } from '@/lib/walletAdapters';
import type { WalletProvider as WalletProviderAlias } from '@/lib/walletAdapters';
import { purgeAllContactDetails } from '@/lib/contactDetailsCache';
import { getServerSession, refreshSession } from '@/lib/sessionClient';
import { clearUserCaches } from '@/lib/pwaCacheConfig';
import {
  WALLET_SESSION_KEY,
  REMEMBERED_ADDRESSES_KEY,
  SESSION_EXPIRY_KEY,
  SESSION_INVALIDATED_KEY,
} from '@/lib/storageKeys';

// @stellar/stellar-sdk and lib/stellar.ts (which also pulls it in) are
// dynamically imported inside the functions below that actually need them
// (loadBalance, doConnect, signAndSubmit, signOnly) rather than statically
// here — WalletProvider is mounted at the root layout, so a static import
// would put the whole SDK (and its sodium-native/crypto deps) on every
// page's critical path just to compute a couple of constants and support
// features most visitors never touch. This mirrors NETWORK's own
// computation in lib/stellar.ts without needing the SDK's `Networks` enum
// for it.
const CURRENT_NETWORK_TYPE: 'testnet' | 'public' =
  process.env.NEXT_PUBLIC_NETWORK === 'mainnet' ? 'public' : 'testnet';

// ── Wallet provider types ─────────────────────────────────────────────────────

export type WalletProvider = WalletProviderAlias;

/** Stored wallet provider info used by WalletButton etc. */
export interface WalletProviderInfo {
  provider: WalletProvider;
  label: string;
  icon: string;
  /**
   * Set when the provider is listed but not yet backed by a working
   * adapter (see lib/walletAdapters.ts). The UI must render these as
   * disabled/"coming soon" rather than wiring them up to connect —
   * their adapter throws unconditionally if invoked.
   */
  comingSoon?: boolean;
}

export const WALLET_PROVIDERS: WalletProviderInfo[] = [
  { provider: 'freighter', label: 'Freighter', icon: '🔶' },
  { provider: 'albedo', label: 'Albedo', icon: '✨' },
  { provider: 'lobstr', label: 'LOBSTR', icon: '🌐', comingSoon: true },
  { provider: 'ledger', label: 'Ledger', icon: '💎' },
];

/** Official install page for each wallet provider, used by the "Install" prompt. */
export const WALLET_INSTALL_URLS: Record<WalletProvider, string> = {
  freighter: 'https://freighter.app',
  albedo: 'https://albedo.link',
  lobstr: 'https://lobstr.co',
  ledger: 'https://www.ledger.com/stellar-wallet',
};

/** Checks whether a given wallet provider's extension/app is installed/available. */
export async function isWalletInstalled(
  provider: WalletProvider,
): Promise<boolean> {
  if (provider === 'ledger') {
    try {
      const { default: TransportWebHID } =
        await import('@ledgerhq/hw-transport-webhid');
      return TransportWebHID.isSupported();
    } catch {
      return false;
    }
  }
  if (provider === 'albedo') {
    // Albedo is a web-based wallet (https://albedo.link) — it always works
    // as long as popups are allowed. Probing `getPublicKey()` here would
    // trigger an unexpected Albedo popup on page load, so we just claim
    // it's installed. Per-wallet popup-block / user-cancel errors are
    // surfaced as friendly toasts in lib/walletAdapters.ts's
    // `mapAlbedoError` on the actual connect attempt.
    return true;
  }
  try {
    await walletAdapters[provider].getPublicKey();
    return true;
  } catch {
    return false;
  }
}

// Storage keys (incl. the cross-tab session-invalidation signal key, whose
// set-then-remove fires `storage` events in other tabs) live in
// lib/storageKeys.ts.

// ── Periodic session reconciliation cadence ───────────────────────────────────
// GET /api/auth/session is rate-limited to 30 requests per IP per 10 seconds
// (app/api/auth/session/route.ts:19-20).  With a 60-second polling interval
// and at most ~5 tabs open simultaneously, the worst-case burst is 5 req/60s
// ≈ 0.83 req/10s — well under the 30/10s ceiling.  The tab-refocus
// (visibilitychange) check is instant and doesn't count toward this cadence
// since it's a one-off, not a recurring timer.
const RECONCILIATION_INTERVAL_MS = 60_000; // 60 seconds

// ── Session types ─────────────────────────────────────────────────────────────

interface StoredSession {
  publicKey: string;
  provider: WalletProvider;
  networkType: 'testnet' | 'public';
}

/** A previously-used wallet address, stored for the account switcher. */
export interface RememberedAddress {
  publicKey: string;
  provider: WalletProvider;
  /** When this address was last used (ISO string). */
  lastUsed: string;
}

// ── Session persistence helpers ───────────────────────────────────────────────

function getStoredSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(WALLET_SESSION_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as StoredSession;
  } catch {
    return null;
  }
}

function setStoredSession(
  publicKey: string,
  provider: WalletProvider,
  networkType: 'testnet' | 'public',
) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(
      WALLET_SESSION_KEY,
      JSON.stringify({ publicKey, provider, networkType }),
    );
  }
}

function removeStoredSession() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(WALLET_SESSION_KEY);
  }
}

// ── Session expiry helpers ────────────────────────────────────────────────────

function getSessionExpiry(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const val = localStorage.getItem(SESSION_EXPIRY_KEY);
    if (!val) return null;
    const ts = parseInt(val, 10);
    return Number.isNaN(ts) ? null : ts;
  } catch {
    return null;
  }
}

function setSessionExpiry(expiresAtMs: number) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(SESSION_EXPIRY_KEY, String(expiresAtMs));
  }
}

function removeSessionExpiry() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(SESSION_EXPIRY_KEY);
  }
}

// ── Account-switch mismatch sentinel ─────────────────────────────────────────
//
// Thrown by doConnect/connectWithProvider when the caller provided an
// expectedPublicKey that does not match the key actually returned by the wallet
// adapter.  AccountSwitcher (and any future caller with a specific target address)
// can `instanceof`-check this to distinguish a mismatch from a generic failure
// and surface an actionable "switch your wallet's active account" message.
//
// The class is exported so tests and UI can import it without pulling in the
// full WalletContext bundle.
export class WalletAccountMismatchError extends Error {
  /** The address the user intended to switch to. */
  readonly expectedPublicKey: string;
  /** The address the wallet extension actually returned. */
  readonly actualPublicKey: string;

  constructor(expectedPublicKey: string, actualPublicKey: string) {
    super(
      `Wallet account mismatch: expected ${expectedPublicKey}, got ${actualPublicKey}. ` +
        'Please switch the active account inside your wallet extension and try again.',
    );
    this.name = 'WalletAccountMismatchError';
    this.expectedPublicKey = expectedPublicKey;
    this.actualPublicKey = actualPublicKey;
    // Maintain proper prototype chain in transpiled environments.
    Object.setPrototypeOf(this, WalletAccountMismatchError.prototype);
  }
}

// ── Remembered addresses helpers ──────────────────────────────────────────────

export function getRememberedAddresses(): RememberedAddress[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(REMEMBERED_ADDRESSES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a: unknown) =>
        typeof a === 'object' &&
        a !== null &&
        typeof (a as RememberedAddress).publicKey === 'string' &&
        typeof (a as RememberedAddress).provider === 'string',
    );
  } catch {
    return [];
  }
}

export function addRememberedAddress(addr: RememberedAddress) {
  const existing = getRememberedAddresses();
  const filtered = existing.filter((a) => a.publicKey !== addr.publicKey);
  filtered.push(addr);
  // Keep at most 10 remembered addresses
  const trimmed = filtered.slice(-10);
  localStorage.setItem(REMEMBERED_ADDRESSES_KEY, JSON.stringify(trimmed));
}

export function removeRememberedAddress(publicKey: string) {
  const existing = getRememberedAddresses();
  const filtered = existing.filter((a) => a.publicKey !== publicKey);
  localStorage.setItem(REMEMBERED_ADDRESSES_KEY, JSON.stringify(filtered));
}

export function clearAllRememberedAddresses(): void {
  // Clear the remembered addresses list on disconnect to prevent the
  // account switcher from leaking wallet addresses between sessions
  // on shared computers. Per docs/disconnect-state-policy.md, this
  // per-wallet state should not persist after logout.
  if (typeof window !== 'undefined') {
    localStorage.removeItem(REMEMBERED_ADDRESSES_KEY);
  }
}

// ── Context value ─────────────────────────────────────────────────────────────

interface WalletContextValue {
  publicKey: string | null;
  isAuthenticated: boolean;
  isConnecting: boolean;
  connectingProvider: WalletProvider | null;
  isRestoringSession: boolean;
  xlmBalance: string | null;
  balanceError: string | null;
  isLoadingBalance: boolean;
  walletProvider: WalletProvider | null;
  walletProviderInfo: WalletProviderInfo | null;
  showWalletModal: boolean;
  openWalletModal: () => void;
  closeWalletModal: () => void;
  connectWithProvider: (
    provider: WalletProvider,
    rememberMe?: boolean,
    expectedPublicKey?: string,
  ) => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Re-authenticate the current session (used before expiry). */
  reauthenticate: () => Promise<void>;
  signAndSubmit: (xdr: string) => Promise<string>;
  signOnly: (xdr: string) => Promise<string>;
  refreshBalance: () => Promise<void>;
  /** When the current session expires (epoch ms), or null if unknown. */
  sessionExpiresAt: number | null;
  /** The wallet address that the current session cookie authenticated. */
  sessionCookieWallet: string | null;
  /** Whether the connected wallet differs from the session cookie's wallet. */
  sessionMismatch: boolean;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingProvider, setConnectingProvider] =
    useState<WalletProvider | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [xlmBalance, setXlmBalance] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [walletProvider, setWalletProvider] = useState<WalletProvider | null>(
    null,
  );
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const [sessionCookieWallet, setSessionCookieWallet] = useState<string | null>(
    null,
  );

  // ── Concurrency guard: de-duplicate concurrent doConnect calls ──────────
  // Multiple callers (e.g. reauthenticate from SessionExpiryWarning and a
  // manual WalletButton click) can race into doConnect simultaneously.  We
  // model this on the in-flight dedup pattern from hooks/useXlmUsdRate.ts:
  // the first caller creates the promise, subsequent callers piggyback on
  // the same promise, and it is cleaned up on settlement.
  const inFlightConnectRef = useRef<Promise<void> | null>(null);

  // ── Session cookie wallet reconciliation ──────────────────────────────────
  // Compare the currently-connected wallet address with the identity the
  // session cookie actually authenticated. If they differ, the session is
  // stale and we need to prompt re-authentication.
  const sessionMismatch = useMemo(() => {
    if (!sessionCookieWallet || !publicKey) return false;
    return sessionCookieWallet !== publicKey;
  }, [sessionCookieWallet, publicKey]);

  // The wallet address the current session cookie authenticated is captured
  // directly by `restoreSession` below, from the same GET /api/auth/session
  // it already performs — see the `setSessionCookieWallet` call there. A
  // fresh user-initiated `doConnect` deliberately does not touch it: the
  // just-authenticated `publicKey` is the cookie's identity by construction,
  // so `sessionMismatch` stays false without an extra round-trip.

  const walletProviderInfo: WalletProviderInfo | null = walletProvider
    ? (WALLET_PROVIDERS.find((wp) => wp.provider === walletProvider) ?? null)
    : null;

  const loadBalance = useCallback(async (address: string) => {
    setIsLoadingBalance(true);
    setBalanceError(null);
    try {
      const { rpc } = await import('@/lib/stellar');
      const account = await rpc.getAccount(address);
      const native = (
        (account as any).balances as Array<{
          asset_type: string;
          balance: string;
        }>
      ).find((b) => b.asset_type === 'native');
      setXlmBalance(native ? native.balance : '0.0000000');
    } catch (err: unknown) {
      setXlmBalance(null);
      setBalanceError(
        err instanceof Error ? err.message : 'Failed to load balance',
      );
    } finally {
      setIsLoadingBalance(false);
    }
  }, []);

  const refreshBalance = useCallback(async () => {
    if (publicKey) await loadBalance(publicKey);
  }, [publicKey, loadBalance]);

  // Restore session from localStorage on mount AND on tab-refocus.
  //
  // Per Issue #13: if the stored session is unusable (provider API throws,
  // wallet extension has been uninstalled, etc.) we don't leave the app in
  // an unauthenticated state with no explanation — we:
  //   1. Probe the provider by attempting to read the public key.
  //   2. If the probe throws (extension uninstalled, network reset, etc.)
  //      clear the stale localStorage entry and dispatch a CustomEvent
  //      that the ToastProvider listens for, so a reconnect-needed toast
  //      surfaces without coupling WalletContext to a Toast hook (which
  //      would require a circular layout dependency).
  //   3. Always flip `isRestoringSession` to false in `finally`, so
  //      callers like useRequireWallet are unblocked even when restore
  //      fails.
  //
  // Per Issue #967: The stored session now includes `networkType` so the
  // reconnect triggered by tab-refocus (visibilitychange → visible) can
  // detect and warn about silent network drift, then re-apply the stored
  // network preference rather than defaulting to the env default.
  const restoreSession = useCallback(async () => {
    let session: StoredSession | null = null;
    try {
      session = getStoredSession();
      if (!session) return;
      const { publicKey: pk, provider, networkType } = session;

      // Detect silent network drift: if the stored session was created on
      // a different network than the current env default, warn so the user
      // isn't surprised, but still honour the stored preference.
      if (networkType && networkType !== CURRENT_NETWORK_TYPE) {
        console.warn(
          `Wallet network mismatch: session prefers ${networkType}, env defaults to ${CURRENT_NETWORK_TYPE}. Using stored network.`,
        );
      }

      // Re-probe the provider to confirm the session is still valid (e.g.
      // the extension wasn't uninstalled). Skip the probe for web-based
      // wallets — Albedo is opened via popup and probing `getPublicKey()`
      // here would trigger an unexpected confirmation popup on every page
      // load, contradicting the very reason `isWalletInstalled` claims
      // it's installed without probing. Albedo failures surface on the
      // next actual connect attempt instead.
      if (provider !== 'albedo') {
        await walletAdapters[provider].getPublicKey();
      }

      // Per #778: localStorage is only a hint for which wallet/provider to
      // reconnect with — it is never proof of authentication. Reconcile
      // against the server's session cookie before trusting this address.
      // A `null` result means the check itself was inconclusive (network
      // error) — treated as "assume still valid" rather than forcing a
      // logout on a transient blip, since it's neither an explicit mismatch
      // nor an explicit expiry.
      const serverSession = await getServerSession();
      // The address the server cookie actually authenticated, for the
      // `sessionMismatch` guard. `null` when the check was inconclusive
      // (network error) — `sessionMismatch` then stays false, matching the
      // "assume still valid" stance above.
      let cookieWallet: string | null = null;
      if (serverSession && !serverSession.authenticated) {
        const refreshed = await refreshSession();
        if (!refreshed.authenticated || refreshed.publicKey !== pk) {
          throw new Error(
            'Server session expired or absent, and refresh failed',
          );
        }
        // Refresh rotated the cookie to a valid session for `pk`.
        cookieWallet = refreshed.publicKey ?? pk;
      } else if (
        serverSession?.authenticated &&
        serverSession.publicKey &&
        serverSession.publicKey !== pk
      ) {
        // The server's session belongs to a different address than the one
        // localStorage remembers — never show `pk` as authenticated based
        // on the stale local hint alone.
        throw new Error('Server session address does not match stored address');
      } else if (serverSession?.authenticated) {
        cookieWallet = serverSession.publicKey ?? null;
      }

      setSessionCookieWallet(cookieWallet);
      setPublicKey(pk);
      setIsAuthenticated(true);
      setWalletProvider(provider);

      // Restore session expiry from localStorage so SessionExpiryWarning
      // can schedule its timer. If the stored expiry is already past, the
      // reconciliation loop (below) will detect the expired server cookie
      // and sign the user out shortly.
      const storedExpiry = getSessionExpiry();
      if (storedExpiry && storedExpiry > Date.now()) {
        setSessionExpiresAt(storedExpiry);
      } else {
        setSessionExpiresAt(null);
      }

      try {
        await loadBalance(pk);
      } catch {
        // Balance load failure is non-fatal — session itself is valid.
      }
    } catch {
      if (!session) return;
      removeStoredSession();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('scoutoff:session-expired', {
            detail: {
              message:
                'Your session expired. Please reconnect your wallet to continue.',
            },
          }),
        );
      }
    } finally {
      setIsRestoringSession(false);
    }
  }, [loadBalance]);

  // Run on mount and on every tab-refocus (visibilitychange → visible).
  useEffect(() => {
    restoreSession();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        restoreSession();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [restoreSession]);

  // ── Periodic session reconciliation ─────────────────────────────────────
  // While authenticated, poll GET /api/auth/server periodically to detect
  // server-side session expiry (e.g. access token TTL elapsed, cookie
  // cleared by user) that the client can't observe via wallet extension
  // availability alone.  The interval is 60s — see RECONCILIATION_INTERVAL_MS
  // header comment for the rate-limit math.
  //
  // On tab refocus (visibilitychange → visible) we also reconcile immediately
  // (handled by the restoreSession effect above), which doesn't count toward
  // the polling cadence.
  useEffect(() => {
    if (!isAuthenticated) return;

    const reconcileWithServer = async () => {
      const serverSession = await getServerSession();
      if (serverSession && !serverSession.authenticated) {
        // Server says the session is gone.  Try a refresh first — the
        // access token may have just elapsed while the refresh token is
        // still valid.
        const refreshed = await refreshSession();
        if (!refreshed.authenticated) {
          // Refresh failed — sign out locally.
          setPublicKey(null);
          setIsAuthenticated(false);
          setSessionExpiresAt(null);
          setWalletProvider(null);
          removeStoredSession();
          removeSessionExpiry();
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('scoutoff:session-expired', {
                detail: {
                  message:
                    'Your session expired. Please reconnect your wallet to continue.',
                },
              }),
            );
          }
        } else if (
          refreshed.publicKey &&
          publicKey &&
          refreshed.publicKey !== publicKey
        ) {
          // Refresh returned a different address — force re-auth.
          setPublicKey(null);
          setIsAuthenticated(false);
          setSessionExpiresAt(null);
          setWalletProvider(null);
          removeStoredSession();
          removeSessionExpiry();
        }
      }
    };

    const intervalId = setInterval(
      reconcileWithServer,
      RECONCILIATION_INTERVAL_MS,
    );
    return () => clearInterval(intervalId);
  }, [isAuthenticated, publicKey]);

  // ── Cross-tab session invalidation listener ─────────────────────────────
  // When another tab calls disconnect(), it writes then removes
  // SESSION_INVALIDATED_KEY from localStorage.  The browser fires a
  // `storage` event in every other same-origin tab, which we listen for
  // here to sign the user out without requiring a visibilitychange event.
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === SESSION_INVALIDATED_KEY) {
        // Another tab logged out — reconcile our state against the server.
        setPublicKey(null);
        setIsAuthenticated(false);
        setSessionExpiresAt(null);
        setWalletProvider(null);
        removeStoredSession();
        removeSessionExpiry();
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const openWalletModal = useCallback(() => setShowWalletModal(true), []);
  const closeWalletModal = useCallback(() => setShowWalletModal(false), []);

  const doConnect = useCallback(
    async (
      provider: WalletProvider,
      rememberMe = false,
      expectedPublicKey?: string,
    ) => {
      setIsConnecting(true);
      setConnectingProvider(provider);
      try {
        // Keep the SDK (and SEP-10 validation which imports it) off the
        // critical path of every page — load both only when connecting.
        const [
          { NETWORK },
          {
            validateSep10Challenge,
            getSep10ClientConfig,
            SEP10_VALIDATION_USER_ERROR,
          },
        ] = await Promise.all([
          import('@/lib/stellar'),
          import('@/lib/sep10Validation'),
        ]);
        const pk = await walletAdapters[provider].getPublicKey();

        // ── Account-switch mismatch guard ────────────────────────────────────
        // When the caller knows which account they expect (e.g. AccountSwitcher),
        // verify the wallet adapter returned that exact key.  Wallet extension
        // APIs cannot be forced to switch their active account from a dApp; if
        // there's a mismatch we must abort cleanly without persisting any session
        // data for the unintended account.
        if (expectedPublicKey && pk !== expectedPublicKey) {
          throw new WalletAccountMismatchError(expectedPublicKey, pk);
        }

        // SEP-10 Auth Flow
        const challengeRes = await fetch(`/api/auth/sep10?account=${pk}`);
        if (!challengeRes.ok) throw new Error('Failed to fetch auth challenge');
        const { transaction } = await challengeRes.json();

        // Client-side challenge verification (SEP-10 "Verifying the Challenge
        // Transaction") — never ask a wallet to sign until we independently
        // confirm this XDR is a well-formed auth challenge for this account
        // and domain. Server-side verifyChallengeTxSigners alone cannot protect
        // the user if the browser was handed an arbitrary transaction.
        const sep10Config = getSep10ClientConfig();
        const validation = validateSep10Challenge({
          challengeXdr: transaction,
          clientAccount: pk,
          serverAccount: sep10Config.serverAccount,
          homeDomain: sep10Config.homeDomain,
          networkPassphrase: NETWORK,
        });
        if (!validation.valid) {
          console.error(
            'SEP-10 challenge validation failed:',
            validation.reason,
          );
          throw new Error(SEP10_VALIDATION_USER_ERROR);
        }

        const signedXdr = await walletAdapters[provider].signTransaction(
          transaction,
          NETWORK,
        );

        const authRes = await fetch('/api/auth/sep10', {
          method: 'POST',
          body: JSON.stringify({ signedXdr, publicKey: pk, rememberMe }),
          headers: { 'Content-Type': 'application/json' },
        });

        if (!authRes.ok) throw new Error('Authentication failed');

        // Read maxAge from server response so frontend knows when session expires
        const authData = await authRes.json();
        const maxAge: number =
          authData.maxAge ?? (rememberMe ? 2592000 : 86400);
        const expiresAt = Date.now() + maxAge * 1000;

        setPublicKey(pk);
        setIsAuthenticated(true);
        setWalletProvider(provider);
        setSessionExpiresAt(expiresAt);
        setSessionExpiry(expiresAt);
        setStoredSession(pk, provider, CURRENT_NETWORK_TYPE);
        setShowWalletModal(false);
        clearUserCaches();

        // Remember this address for account switcher
        addRememberedAddress({
          publicKey: pk,
          provider,
          lastUsed: new Date().toISOString(),
        });

        await loadBalance(pk);
      } catch (error) {
        // WalletAccountMismatchError is an expected, user-facing outcome —
        // not an unexpected failure — so we don't log it as an error.
        if (!(error instanceof WalletAccountMismatchError)) {
          console.error('Connection/Auth error:', error);
        }
        setPublicKey(null);
        setIsAuthenticated(false);
        setXlmBalance(null);
        throw error;
      } finally {
        setIsConnecting(false);
        setConnectingProvider(null);
      }
    },
    [loadBalance],
  );

  const connect = useCallback(async () => {
    const session = getStoredSession();
    if (session) {
      await doConnect(session.provider);
    } else {
      openWalletModal();
    }
  }, [doConnect, openWalletModal]);

  const connectWithProvider = useCallback(
    async (
      provider: WalletProvider,
      rememberMe = false,
      expectedPublicKey?: string,
    ) => {
      await doConnect(provider, rememberMe, expectedPublicKey);
    },
    [doConnect],
  );

  // Re-authenticate the current session.  Concurrent calls (e.g. the user
  // manually reconnecting while SessionExpiryWarning's auto-flow is also
  // mid-reauth) are de-duplicated into a single in-flight doConnect promise,
  // modelling the pattern from hooks/useXlmUsdRate.ts's inFlight Map.
  const reauthenticate = useCallback(async () => {
    const session = getStoredSession();
    if (!session) {
      openWalletModal();
      return;
    }
    if (inFlightConnectRef.current) {
      return inFlightConnectRef.current;
    }
    const promise = doConnect(session.provider).finally(() => {
      inFlightConnectRef.current = null;
    });
    inFlightConnectRef.current = promise;
    return promise;
  }, [doConnect, openWalletModal]);

  const disconnect = useCallback(() => {
    // DELETE /api/auth/sep10 clears the session cookies AND revokes the
    // session row server-side (see #1179), so a copy of the cookie
    // captured before this call stops working immediately rather than
    // remaining valid until its natural expiry. Fire-and-forget: the
    // client-side cleanup below must not wait on (or be blocked by) the
    // network round trip.
    //
    // Per docs/disconnect-state-policy.md: on shared computers (common for
    // scouts working from academy or club machines), we must clear all
    // per-wallet state that shouldn't leak to the next wallet that connects.
    Promise.resolve(fetch('/api/auth/sep10', { method: 'DELETE' })).catch(
      () => {},
    );
    setPublicKey(null);
    setIsAuthenticated(false);
    setXlmBalance(null);
    setBalanceError(null);
    setWalletProvider(null);
    setSessionExpiresAt(null);
    removeStoredSession();
    removeSessionExpiry();
    clearAllRememberedAddresses();
    // Unlocked contact details (and any other cached data) must not survive
    // logout — see lib/contactDetailsCache.ts. The explicit purge below is
    // belt-and-suspenders on top of this blanket wipe: it also cancels any
    // pending auto-purge timers, which the blanket mutate alone wouldn't do.
    mutate(() => true, undefined, { revalidate: false });
    purgeAllContactDetails();
    clearUserCaches();

    // Cross-tab propagation: writing then removing a localStorage key fires
    // the browser's native `storage` event in every other same-origin tab.
    // Other tabs' WalletContext listens for this key and calls
    // handleSessionInvalidated() below.
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(SESSION_INVALIDATED_KEY, String(Date.now()));
        localStorage.removeItem(SESSION_INVALIDATED_KEY);
      } catch {
        // localStorage may be full or disabled — best-effort.
      }
    }
  }, []);

  const signAndSubmit = useCallback(
    async (xdr: string): Promise<string> => {
      if (!publicKey) throw new Error('Wallet not connected');
      if (!walletProvider) throw new Error('No wallet provider selected');
      const { NETWORK, rpc, TransactionBuilder } =
        await import('@/lib/stellar');
      const signedXdr = await walletAdapters[walletProvider].signTransaction(
        xdr,
        NETWORK,
      );
      const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK);
      const result = await rpc.sendTransaction(
        tx as Parameters<typeof rpc.sendTransaction>[0],
      );
      return (result as { hash: string }).hash;
    },
    [publicKey, walletProvider],
  );

  /**
   * Signs an XDR transaction without submitting it — the wallet-adapter
   * "signFn" callback shape that lib/contract.ts's lower-level
   * signAndSubmitTx/payToContact expect, for callers that need the
   * contract's decoded return value (e.g. unlocked ContactDetails), which
   * signAndSubmit above discards.
   */
  const signOnly = useCallback(
    async (xdr: string): Promise<string> => {
      if (!publicKey) throw new Error('Wallet not connected');
      if (!walletProvider) throw new Error('No wallet provider selected');
      const { NETWORK } = await import('@/lib/stellar');
      return walletAdapters[walletProvider].signTransaction(xdr, NETWORK);
    },
    [publicKey, walletProvider],
  );

  const value = useMemo(
    () => ({
      publicKey,
      isAuthenticated,
      isConnecting,
      connectingProvider,
      isRestoringSession,
      xlmBalance,
      balanceError,
      isLoadingBalance,
      walletProvider,
      walletProviderInfo,
      showWalletModal,
      openWalletModal,
      closeWalletModal,
      connectWithProvider,
      connect,
      disconnect,
      reauthenticate,
      signAndSubmit,
      signOnly,
      refreshBalance,
      sessionExpiresAt,
      sessionCookieWallet,
      sessionMismatch,
    }),
    [
      publicKey,
      isAuthenticated,
      isConnecting,
      connectingProvider,
      isRestoringSession,
      xlmBalance,
      balanceError,
      isLoadingBalance,
      walletProvider,
      walletProviderInfo,
      showWalletModal,
      openWalletModal,
      closeWalletModal,
      connectWithProvider,
      connect,
      disconnect,
      reauthenticate,
      signAndSubmit,
      signOnly,
      refreshBalance,
      sessionExpiresAt,
      sessionCookieWallet,
      sessionMismatch,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWalletContext() {
  const ctx = useContext(WalletContext);
  if (!ctx)
    throw new Error('useWalletContext must be used inside WalletProvider');
  return ctx;
}
