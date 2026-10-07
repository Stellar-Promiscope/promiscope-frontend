'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';

type ToastVariant = 'success' | 'error' | 'info' | 'warning';

/**
 * Sentinel CustomEvent types the WalletContext dispatches when a stored
 * session can't be rehydrated on mount. The ToastProvider listens for these
 * and surfaces a non-blocking toast — see Issue #13.
 */
export const SESSION_EXPIRED_EVENT = 'promiscope:session-expired';

interface SessionExpiredDetail {
  message: string;
}

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  message: string;
  variant: ToastVariant;
  /** Overrides the default 4000ms auto-dismiss timeout. */
  duration?: number;
  /** Optional secondary action (e.g. "Undo") rendered alongside the dismiss button. */
  action?: ToastAction;
}

interface ToastItem extends ToastOptions {
  id: string;
}

interface ToastContextValue {
  show: (toast: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_META: Record<
  ToastVariant,
  { border: string; iconClass: string; label: string }
> = {
  success: {
    border: 'border-brand-green',
    iconClass: 'text-brand-green',
    label: 'success',
  },
  error: {
    border: 'border-red-500',
    iconClass: 'text-red-500',
    label: 'error',
  },
  info: { border: 'border-sky-400', iconClass: 'text-sky-400', label: 'info' },
  warning: {
    border: 'border-yellow-400',
    iconClass: 'text-yellow-400',
    label: 'warning',
  },
};

function generateToastId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastTimers = useRef<Record<string, number>>({});

  // Listen for non-React signals (e.g. WalletContext's session-expired
  // CustomEvent, see Issue #13) and surface them as toasts. The provider
  // owns the handler so callers don't need to thread `useToast` through
  // every layer of the layout.
  useEffect(() => {
    function onSessionExpired(e: Event) {
      const detail = (e as CustomEvent<SessionExpiredDetail>).detail;
      const message =
        detail?.message ??
        'Your session expired. Please reconnect your wallet to continue.';
      show({ message, variant: 'warning' });
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () =>
      window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timeoutId = toastTimers.current[id];
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      delete toastTimers.current[id];
    }
  }, []);

  const show = useCallback(
    (toast: ToastOptions) => {
      const id = generateToastId();
      setToasts((current) => {
        const next = [...current, { id, ...toast }];
        if (next.length > 3) {
          const [oldest, ...rest] = next;
          const oldestTimer = toastTimers.current[oldest.id];
          if (oldestTimer) {
            window.clearTimeout(oldestTimer);
            delete toastTimers.current[oldest.id];
          }
          return rest;
        }
        return next;
      });

      toastTimers.current[id] = window.setTimeout(() => {
        removeToast(id);
      }, toast.duration ?? 4000);
    },
    [removeToast],
  );

  useEffect(() => {
    return () => {
      Object.values(toastTimers.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      toastTimers.current = {};
    };
  }, []);

  const contextValue = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {/*
        Per Issue #28:
          • The container has aria-live="polite" + aria-atomic="true" so all
            incoming toasts are announced as a single, complete region update.
          • Each <div role="status"> per toast carries its own aria-label =
            "<variant>: <message>", giving screen-reader users a unique,
            self-describing announcement.
          • Error toasts additionally flip aria-live to "assertive" so they
            interrupt the current reading (matching ToastProvider convention
            for transient failures that need user attention now).
      */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-end px-4 sm:px-6"
      >
        <div className="flex w-full max-w-sm flex-col gap-3">
          {toasts.map((toast) => {
            const meta = VARIANT_META[toast.variant];
            return (
              <div
                key={toast.id}
                role={
                  toast.variant === 'error' || toast.variant === 'warning'
                    ? 'alert'
                    : 'status'
                }
                aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
                aria-atomic="true"
                aria-label={t('notification_label', {
                  variant: t(meta.label),
                  message: toast.message,
                })}
                className={`pointer-events-auto flex items-start gap-3 rounded-xl border border-gray-200 dark:border-gray-800 border-l-4 bg-brand-card p-4 shadow-2xl ${meta.border}`}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/5 dark:bg-white/5">
                  <span
                    className={`${meta.iconClass} text-lg`}
                    aria-hidden="true"
                  >
                    {toast.variant === 'success' && '✓'}
                    {toast.variant === 'error' && '✕'}
                    {toast.variant === 'info' && 'ℹ'}
                    {toast.variant === 'warning' && '⚠'}
                  </span>
                </div>
                <div className="flex-1 text-sm leading-6 text-gray-700 dark:text-gray-200">
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {t(meta.label)}
                  </p>
                  <p>{toast.message}</p>
                </div>
                {toast.action && (
                  <button
                    type="button"
                    onClick={() => {
                      toast.action?.onClick();
                      removeToast(toast.id);
                    }}
                    className="ml-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 px-3 py-1.5 text-sm font-medium text-brand-green transition hover:bg-gray-200 dark:hover:bg-gray-800"
                  >
                    {toast.action.label}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeToast(toast.id)}
                  aria-label={t('close_notification')}
                  className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-400 transition hover:bg-gray-200 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
