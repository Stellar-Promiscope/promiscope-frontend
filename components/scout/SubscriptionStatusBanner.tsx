'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Subscription } from '@/types';

/** Scout subscription tier and days remaining, with a renew link when expiring. */
export default function SubscriptionStatusBanner({
  subscription,
}: {
  subscription: Subscription;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const daysRemaining = Math.floor(
    (subscription.expiresAt - now / 1000) / 86400,
  );
  const tierLabel =
    subscription.tier.charAt(0).toUpperCase() + subscription.tier.slice(1);

  if (daysRemaining <= 0) {
    return (
      <div
        data-tour="subscription-status"
        className="flex items-center gap-3 rounded-xl border border-red-500 bg-brand-card px-4 py-3 text-sm"
      >
        <span className="text-red-400">Subscription expired</span>
        <Link
          href="/scout/subscribe"
          className="ml-auto text-brand-green underline hover:opacity-80 transition"
        >
          Renew
        </Link>
      </div>
    );
  }

  if (daysRemaining <= 7) {
    return (
      <div
        data-tour="subscription-status"
        className="flex items-center gap-3 rounded-xl border border-orange-400 bg-brand-card px-4 py-3 text-sm text-gray-200"
      >
        <span>
          {tierLabel} — expires in {daysRemaining} day
          {daysRemaining !== 1 ? 's' : ''}
        </span>
        <Link
          href="/scout/subscribe"
          className="ml-auto text-brand-green underline hover:opacity-80 transition"
        >
          Renew
        </Link>
      </div>
    );
  }

  return (
    <div
      data-tour="subscription-status"
      className="flex items-center gap-3 rounded-xl border border-brand-green bg-brand-card px-4 py-3 text-sm text-gray-200"
    >
      {tierLabel} — {daysRemaining} days remaining
    </div>
  );
}
