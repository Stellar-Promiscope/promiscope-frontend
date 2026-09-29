import chatApi from './chatApi';
import { READ_RECEIPTS_ENABLED_KEY } from '@/lib/storageKeys';
import { walletScopedKey } from '@/lib/activeWallet';

/**
 * Read-receipt helpers layered on top of the chat API. Read state is only
 * broadcast to the sender when the recipient has not opted out via the
 * notification-preferences panel (see NOTIFICATION_PREF_READ_RECEIPTS_KEY).
 * The preference is per user, so it is stored per wallet as
 * `read_receipts_enabled:<wallet>` (#1343).
 */
export const NOTIFICATION_PREF_READ_RECEIPTS_KEY = READ_RECEIPTS_ENABLED_KEY;

export function readReceiptsEnabled(): boolean {
  const key = walletScopedKey(NOTIFICATION_PREF_READ_RECEIPTS_KEY);
  if (typeof window === 'undefined' || !key) return true;
  const stored = window.localStorage.getItem(key);
  return stored === null ? true : stored === 'true';
}

export function setReadReceiptsEnabled(enabled: boolean): void {
  const key = walletScopedKey(NOTIFICATION_PREF_READ_RECEIPTS_KEY);
  if (typeof window === 'undefined' || !key) return;
  window.localStorage.setItem(key, String(enabled));
}

export async function reportThreadRead(threadId: string): Promise<void> {
  if (!readReceiptsEnabled()) return;
  await chatApi.post(`/threads/${threadId}/read`);
}
