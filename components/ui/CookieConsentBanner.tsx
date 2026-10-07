'use client';

import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { COOKIE_CONSENT_KEY } from '@/lib/storageKeys';
import { useTranslations } from 'next-intl';

const CONSENT_STORAGE_KEY = COOKIE_CONSENT_KEY;
const CONSENT_ACCEPTED = 'accepted';
const CONSENT_DECLINED = 'declined';

export type ConsentChoice = typeof CONSENT_ACCEPTED | typeof CONSENT_DECLINED;

function getStoredConsent(): ConsentChoice | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (stored === CONSENT_ACCEPTED || stored === CONSENT_DECLINED) {
      return stored;
    }
  } catch {
    // localStorage unavailable (private browsing, etc.)
  }
  return null;
}

function setStoredConsent(choice: ConsentChoice) {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, choice);
  } catch {
    // Ignore storage errors
  }
}

export function hasConsent(): boolean {
  return getStoredConsent() === CONSENT_ACCEPTED;
}

interface CookieConsentBannerProps {
  onConsentChange?: (accepted: boolean) => void;
}

export default function CookieConsentBanner({
  onConsentChange,
}: CookieConsentBannerProps) {
  const t = useTranslations('common');
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    // Only show banner if no stored choice exists
    const stored = getStoredConsent();
    if (stored === null) {
      // Small delay so the banner slides in after page paint
      const timer = setTimeout(() => {
        setVisible(true);
        setAnimating(true);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleChoice = useCallback(
    (choice: ConsentChoice) => {
      setStoredConsent(choice);
      setAnimating(false);
      // Wait for exit animation
      setTimeout(() => {
        setVisible(false);
        onConsentChange?.(choice === CONSENT_ACCEPTED);
      }, 300);
    },
    [onConsentChange],
  );

  const handleAccept = useCallback(
    () => handleChoice(CONSENT_ACCEPTED),
    [handleChoice],
  );

  const handleDecline = useCallback(
    () => handleChoice(CONSENT_DECLINED),
    [handleChoice],
  );

  // Programmatic reopen (called from footer link)
  const reopen = useCallback(() => {
    try {
      localStorage.removeItem(CONSENT_STORAGE_KEY);
    } catch {
      // ignore
    }
    setVisible(true);
    setAnimating(true);
  }, []); // Expose reopen on the window object for the footer link
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__promiscopeReopenConsent =
        reopen;
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as unknown as Record<string, unknown>)
          .__promiscopeReopenConsent;
      }
    };
  }, [reopen]);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t('cookie_consent')}
      className={`fixed bottom-0 left-0 right-0 z-50 transition-all duration-300 ease-out ${
        animating ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'
      }`}
    >
      <div className="mx-auto max-w-6xl px-4 pb-4 sm:px-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 rounded-2xl border border-gray-700 bg-brand-card/95 p-5 shadow-2xl backdrop-blur-md sm:p-6">
          {/* Icon */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-green/10 text-brand-green">
            <ShieldCheck size={20} aria-hidden="true" />
          </div>

          {/* Message */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white">
              Cookie & Tracking Consent
            </p>
            <p className="mt-1 text-xs leading-relaxed text-gray-400">
              We use Vercel Analytics to understand how our platform is used and
              Sentry for error monitoring. We never use third-party advertising
              trackers. Your data stays private — see our{' '}
              <a
                href="/privacy"
                className="text-brand-green underline underline-offset-2 hover:text-green-400"
              >
                Privacy Policy
              </a>{' '}
              for details.
            </p>
          </div>

          {/* Actions */}
          <div className="flex shrink-0 items-center gap-3 self-end sm:self-center">
            <button
              type="button"
              onClick={handleDecline}
              className="rounded-lg border border-gray-600 px-4 py-2 text-xs font-medium text-gray-300 transition hover:border-gray-500 hover:text-white"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={handleAccept}
              className="rounded-lg bg-brand-green px-4 py-2 text-xs font-semibold text-black transition hover:opacity-90"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={handleDecline}
              aria-label={t('close_consent_banner')}
              className="ml-1 rounded-lg p-2 text-gray-500 transition hover:text-gray-300"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Opens the consent banner programmatically.
 * Called from the footer "Cookie Settings" link via a client component.
 */
export function reopenConsentBanner() {
  const fn = (window as unknown as Record<string, unknown>)
    .__promiscopeReopenConsent as (() => void) | undefined;
  fn?.();
}
