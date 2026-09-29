'use client';

import { useCallback, useEffect, useState } from 'react';
import { subscribeToPush, unsubscribeFromPush } from '@/lib/api';

export type PushStatus =
  | 'unsupported'
  | 'denied'
  | 'subscribed'
  | 'unsubscribed'
  | 'loading';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function isSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    !!VAPID_PUBLIC_KEY
  );
}

/**
 * Issue #558: opt-in Web Push for validator milestone approvals.
 *
 * Never requests permission on its own — `enable()` must be called from an
 * explicit user action. `disable()` unsubscribes locally and tells the
 * backend to drop the subscription (browser permission itself can only be
 * revoked from browser settings).
 */
export function usePushNotifications(wallet: string | null) {
  const [status, setStatus] = useState<PushStatus>('loading');

  useEffect(() => {
    if (!isSupported()) {
      setStatus('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setStatus('denied');
      return;
    }
    let cancelled = false;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!cancelled) setStatus(sub ? 'subscribed' : 'unsubscribed');
      })
      .catch(() => {
        if (!cancelled) setStatus('unsubscribed');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    if (!wallet || !isSupported()) return;
    setStatus('loading');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'unsubscribed');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
        }));
      await subscribeToPush(wallet, sub.toJSON());
      setStatus('subscribed');
    } catch {
      setStatus('unsubscribed');
      throw new Error('Could not enable push notifications');
    }
  }, [wallet]);

  const disable = useCallback(async () => {
    if (!isSupported()) return;
    setStatus('loading');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        if (wallet) await unsubscribeFromPush(wallet, sub.endpoint);
        await sub.unsubscribe();
      }
      setStatus('unsubscribed');
    } catch {
      setStatus('subscribed');
      throw new Error('Could not disable push notifications');
    }
  }, [wallet]);

  return { status, enable, disable };
}
