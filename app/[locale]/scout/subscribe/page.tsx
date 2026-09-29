'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import Button from '@/components/ui/Button';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import RedirectReasonBanner from '@/components/ui/RedirectReasonBanner';
import TransactionStatus from '@/components/ui/TransactionStatus';
import type { TxStatus } from '@/components/ui/TransactionStatus';
import useIsPaused from '@/hooks/useIsPaused';
import { useSubscription } from '@/hooks/useSubscription';
import { useWallet } from '@/hooks/useWallet';
import {
  redeemReferralCode,
  checkFraudThrottle,
  REFERRAL_THROTTLE_MESSAGE,
} from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { formatXlm } from '@/lib/formatXlm';
import XlmFiatDisplay from '@/components/ui/XlmFiatDisplay';
import { TIER_FEES_XLM } from '@/lib/feeSchedule';
import type { SubscriptionTier } from '@/types';
import { formatDate } from '@/lib/localeFormat';
import type { Locale } from '@/lib/locales';

// Copy lives in messages/*.json under scout.subscribe.tiers.<tier>
// (title, description, features.<featureKey>).
const TIERS: Array<{
  tier: SubscriptionTier;
  priceXlm: number;
  featureKeys: string[];
  recommended?: boolean;
}> = [
  {
    tier: 'basic',
    priceXlm: TIER_FEES_XLM.basic,
    featureKeys: ['browse', 'connect', 'pay_to_contact'],
  },
  {
    tier: 'pro',
    priceXlm: TIER_FEES_XLM.pro,
    featureKeys: ['all_basic', 'priority_discovery', 'faster_contact'],
    recommended: true,
  },
];

const TIER_ORDER: Record<SubscriptionTier, number> = {
  basic: 0,
  pro: 1,
  elite: 2,
};

function formatExpiry(timestamp: number, locale: Locale) {
  return formatDate(timestamp * 1000, locale);
}

function remainingDays(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now() / 1000) / 86400));
}

function SubscribeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isPaused = useIsPaused();
  const { publicKey } = useWallet();
  const {
    subscription,
    isExpired,
    subscribe,
    subscribeStatus,
    isConfirming,
    loading,
    error,
  } = useSubscription();
  const { show: showToast } = useToast();
  const t = useTranslations('scout.subscribe');
  const tCommon = useTranslations('common');
  const locale = useLocale() as Locale;
  const tierName = (tier: SubscriptionTier) => t(`tiers.${tier}.title`);
  const expiry = (timestamp: number) => formatExpiry(timestamp, locale);
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
  const [feePaid, setFeePaid] = useState<string | undefined>(undefined);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<SubscriptionTier | null>(
    null,
  );
  const [showTierChangeWarning, setShowTierChangeWarning] = useState(false);
  const [warningTier, setWarningTier] = useState<SubscriptionTier | null>(null);
  const redirectTimer = useRef<number | null>(null);
  const referralCode = searchParams.get('ref');
  const redirectReason = searchParams.get('reason');

  useEffect(() => {
    return () => {
      if (redirectTimer.current) {
        window.clearTimeout(redirectTimer.current);
      }
    };
  }, []);

  const statusMessage = useMemo(() => {
    if (loading && !subscription) {
      return t('status_loading');
    }

    if (!subscription) {
      return t('status_none');
    }

    if (isExpired) {
      return t('status_expired', {
        tier: tierName(subscription.tier).toUpperCase(),
        date: expiry(subscription.expiresAt),
      });
    }

    return t('status_active', {
      tier: tierName(subscription.tier).toUpperCase(),
      date: expiry(subscription.expiresAt),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t/locale drive tierName/expiry
  }, [subscription, isExpired, loading, t, locale]);

  function getCtaLabel(
    planTier: SubscriptionTier,
    isProcessing: boolean,
  ): string {
    if (isProcessing) {
      if (subscribeStatus === 'confirming') return t('cta_confirming');
      return t('cta_processing');
    }

    if (!subscription || isExpired) {
      // Expired: same tier = Renew, higher tier = Upgrade, no sub = Subscribe
      if (subscription && isExpired) {
        if (planTier === subscription.tier) return t('cta_renew');
        if (TIER_ORDER[planTier] > TIER_ORDER[subscription.tier])
          return t('cta_upgrade');
      }
      return t('cta_subscribe');
    }

    // Active subscription
    if (planTier === subscription.tier) return t('cta_renew');
    if (TIER_ORDER[planTier] > TIER_ORDER[subscription.tier])
      return t('cta_upgrade');
    return t('cta_subscribe');
  }

  async function handleSubscribe(tier: SubscriptionTier) {
    if (loading || isConfirming || isPaused) {
      return;
    }

    // Check if the scout has an active subscription to a different tier
    if (hasActiveSub && subscription.tier !== tier) {
      // Show warning before proceeding
      setWarningTier(tier);
      setShowTierChangeWarning(true);
      return;
    }

    // Proceed with subscription
    await proceedWithSubscription(tier);
  }

  async function proceedWithSubscription(tier: SubscriptionTier) {
    setSelectedTier(tier);
    setTxStatus('pending');
    setFeePaid(undefined);
    setSuccessMessage(null);
    setShowTierChangeWarning(false);
    setWarningTier(null);

    try {
      await subscribe(tier);
      if (referralCode && publicKey) {
        const throttled = await checkFraudThrottle(publicKey);
        if (throttled) {
          showToast({ message: REFERRAL_THROTTLE_MESSAGE, variant: 'error' });
        } else {
          redeemReferralCode(referralCode, publicKey).catch(() => {});
        }
      }
      const plan = TIERS.find((p) => p.tier === tier);
      setFeePaid(plan ? formatXlm(plan.priceXlm) : undefined);
      setSuccessMessage(t('success', { tier: tierName(tier) }));
      setTxStatus('success');
      redirectTimer.current = window.setTimeout(() => {
        router.push('/scout');
      }, 8000);
    } catch (err) {
      setTxStatus('error');
      console.error(err);
    } finally {
      setSelectedTier(null);
    }
  }

  const hasActiveSub = subscription && !isExpired;

  return (
    <div className="flex flex-col gap-8">
      <RedirectReasonBanner reason={redirectReason} />

      {/* Active subscription banner */}
      {hasActiveSub && (
        <div
          role="status"
          aria-label={t('active_banner_label')}
          className="rounded-xl border border-brand-green/40 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.10),_transparent)] px-5 py-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-brand-green px-3 py-1 text-xs font-semibold uppercase text-black">
              {tierName(subscription.tier)}
            </span>
            <span className="text-sm text-gray-200">
              {t.rich('active_until', {
                date: expiry(subscription.expiresAt),
                strong: (chunks) => (
                  <strong className="text-white">{chunks}</strong>
                ),
              })}
            </span>
          </div>
          <span className="text-sm text-emerald-400 font-medium">
            {t('days_remaining', {
              count: remainingDays(subscription.expiresAt),
            })}
          </span>
        </div>
      )}

      {referralCode && (
        <div className="rounded-xl border border-brand-green/40 bg-brand-green/10 px-5 py-3 text-sm text-brand-green">
          {t('referral_notice')}
        </div>
      )}

      <div className="flex flex-col gap-4">
        <div className="bg-brand-card border border-gray-800 rounded-xl p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">{t('title')}</h1>
              <p className="text-sm text-gray-400 mt-1">{t('subtitle')}</p>
            </div>
            <div className="rounded-2xl bg-gray-900 border border-gray-700 px-4 py-3 text-sm text-gray-200">
              {statusMessage}
            </div>
          </div>
        </div>

        {error && !txStatus && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        {successMessage && txStatus === 'success' && (
          <p
            role="status"
            aria-live="polite"
            className="text-sm text-brand-green"
          >
            {successMessage}
          </p>
        )}
        {txStatus && (
          <TransactionStatus
            status={txStatus}
            feePaid={feePaid}
            error={error ?? undefined}
            onHide={() => {
              setTxStatus(null);
              setSuccessMessage(null);
            }}
          />
        )}
      </div>

      {subscription && !isExpired && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-brand-green/40 bg-brand-green/10 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
        >
          <div>
            <span className="text-xs uppercase tracking-widest text-brand-green font-semibold">
              {t('active_subscription')}
            </span>
            <p className="text-white font-semibold mt-0.5">
              {t('plan_name', { tier: tierName(subscription.tier) })}
            </p>
          </div>
          <div className="text-sm text-gray-300">
            {t.rich('expires', {
              date: expiry(subscription.expiresAt),
              strong: (chunks) => (
                <span className="text-white font-medium">{chunks}</span>
              ),
            })}{' '}
            &middot;{' '}
            <span className="text-brand-green font-medium">
              {t('days_remaining', {
                count: remainingDays(subscription.expiresAt),
              })}
            </span>
          </div>
        </div>
      )}

      {/* Tier change warning modal */}
      {showTierChangeWarning && warningTier && hasActiveSub && subscription && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-brand-card p-6 shadow-xl">
            <div className="mb-6">
              <h3 className="text-xl font-bold text-white">
                {t('change_title')}
              </h3>
              <p className="mt-2 text-sm text-gray-300">
                {t.rich('change_description', {
                  from: tierName(subscription.tier).toUpperCase(),
                  to: tierName(warningTier).toUpperCase(),
                  strong: (chunks) => (
                    <span className="font-semibold text-white">{chunks}</span>
                  ),
                })}
              </p>
            </div>

            <div className="mb-6 rounded-xl border border-amber-800/40 bg-amber-900/20 p-4">
              <div className="flex items-start gap-3">
                <svg
                  className="mt-0.5 h-5 w-5 shrink-0 text-amber-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.998-.833-2.732 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-amber-200">
                    {t('notice_title')}
                  </p>
                  <p className="text-sm text-amber-100/80">
                    {t('notice_body', {
                      to: tierName(warningTier).toUpperCase(),
                      from: tierName(subscription.tier).toUpperCase(),
                      count: remainingDays(subscription.expiresAt),
                    })}
                  </p>
                  <p className="text-sm text-amber-100/60 mt-2">
                    {t('notice_replace', {
                      to: tierName(warningTier).toUpperCase(),
                      from: tierName(subscription.tier).toUpperCase(),
                    })}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowTierChangeWarning(false);
                  setWarningTier(null);
                }}
                className="sm:w-auto"
              >
                {tCommon('cancel')}
              </Button>
              <Button
                onClick={() => {
                  if (warningTier) {
                    proceedWithSubscription(warningTier);
                  }
                }}
                className="sm:w-auto"
                isLoading={loading && selectedTier === warningTier}
              >
                {t('confirm_change')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {TIERS.map((plan) => {
          const isRecommended = plan.recommended ?? false;
          const isSelected = selectedTier === plan.tier;
          const isActiveTier = hasActiveSub && subscription.tier === plan.tier;
          const ctaLabel = getCtaLabel(plan.tier, loading && isSelected);

          return (
            <div
              key={plan.tier}
              className={`bg-brand-card border rounded-xl p-6 shadow-sm transition ${
                isActiveTier
                  ? 'border-brand-green ring-2 ring-brand-green/50 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.08),_transparent)]'
                  : isRecommended
                    ? 'border-brand-green bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.08),_transparent)]'
                    : 'border-gray-800'
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.2em] text-gray-400">
                    {tierName(plan.tier)}
                  </p>
                  <div className="mt-3">
                    <XlmFiatDisplay xlmAmount={plan.priceXlm} />
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {isActiveTier && (
                    <span className="rounded-full bg-brand-green px-3 py-1 text-xs font-semibold uppercase text-black">
                      {t('current_plan')}
                    </span>
                  )}
                  {!isActiveTier && isRecommended && (
                    <span className="rounded-full bg-brand-green px-3 py-1 text-xs font-semibold uppercase text-black">
                      {t('recommended')}
                    </span>
                  )}
                </div>
              </div>

              <p className="mt-4 text-sm text-gray-300">
                {t(`tiers.${plan.tier}.description`)}
              </p>

              <ul className="mt-6 space-y-3">
                {plan.featureKeys.map((featureKey) => (
                  <li
                    key={featureKey}
                    className="flex gap-3 text-sm text-gray-300"
                  >
                    <span className="mt-1 h-2.5 w-2.5 rounded-full bg-brand-green" />
                    {t(`tiers.${plan.tier}.features.${featureKey}`)}
                  </li>
                ))}
              </ul>

              <Button
                className="mt-8 w-full"
                isLoading={loading && isSelected}
                onClick={() => handleSubscribe(plan.tier)}
                disabled={loading || isConfirming || isPaused}
                title={isPaused ? t('paused') : undefined}
              >
                {ctaLabel}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ScoutSubscribePage() {
  return (
    <ErrorBoundary>
      <Suspense fallback={null}>
        <SubscribeContent />
      </Suspense>
    </ErrorBoundary>
  );
}
