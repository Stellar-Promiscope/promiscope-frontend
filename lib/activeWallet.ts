/**
 * Module-level record of the currently connected wallet, set by
 * WalletContext. Lets non-React helpers (e.g. lib/messaging/moderation.ts)
 * scope their localStorage keys per wallet without threading the address
 * through every call site, so one wallet on a shared device never reads or
 * writes another wallet's cached state (#1343).
 */
let activeWallet: string | null = null;

export function setActiveWallet(publicKey: string | null): void {
  activeWallet = publicKey;
}

export function getActiveWallet(): string | null {
  return activeWallet;
}

/** `${base}:${wallet}` for the active wallet, or null when none is connected. */
export function walletScopedKey(base: string): string | null {
  return activeWallet ? `${base}:${activeWallet}` : null;
}

/** Removes every `${base}:<wallet>` entry, for all wallets. */
export function removeWalletScopedKeys(base: string): void {
  if (typeof window === 'undefined') return;
  try {
    const prefix = `${base}:`;
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(prefix)) window.localStorage.removeItem(key);
    }
  } catch {
    // localStorage may be disabled — best-effort.
  }
}
