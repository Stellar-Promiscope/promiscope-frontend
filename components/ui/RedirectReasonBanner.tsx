'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { REDIRECT_REASONS, isRedirectReason } from '@/lib/redirectReason';

interface RedirectReasonBannerProps {
  /** Raw `reason` query param value; renders nothing if not a known reason. */
  reason?: string | string[] | null;
}

/**
 * Persistent explanation for why a guard hook (useRequireWallet,
 * useRequireSubscription) redirected the user to this page. Unlike a toast,
 * it doesn't depend on rendering before the redirect completes.
 */
export default function RedirectReasonBanner({
  reason,
}: RedirectReasonBannerProps) {
  const t = useTranslations('common');
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !isRedirectReason(reason)) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full bg-amber-500/10 border border-amber-500/40 text-amber-800 dark:text-amber-200 px-4 py-3 rounded-xl flex items-center justify-between gap-4 mb-6"
    >
      <span className="text-sm">{REDIRECT_REASONS[reason]}</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t('dismiss')}
        className="shrink-0 text-amber-800/70 dark:text-amber-200/70 hover:text-amber-900 dark:hover:text-amber-100 text-sm font-medium"
      >
        Dismiss
      </button>
    </div>
  );
}
