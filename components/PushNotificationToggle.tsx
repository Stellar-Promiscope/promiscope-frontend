'use client';

import { useWallet } from '@/hooks/useWallet';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useToast } from '@/components/ui/Toast';

/** Issue #558: explicit opt-in/out for milestone-approval push notifications. */
export default function PushNotificationToggle() {
  const { publicKey } = useWallet();
  const { status, enable, disable } = usePushNotifications(publicKey ?? null);
  const { show } = useToast();

  if (status === 'unsupported') {
    return (
      <p className="text-sm text-gray-400">
        Push notifications aren&apos;t supported in this browser.
      </p>
    );
  }

  if (status === 'denied') {
    return (
      <p className="text-sm text-gray-400">
        Notifications are blocked. Allow them in your browser&apos;s site
        settings to enable milestone alerts.
      </p>
    );
  }

  const subscribed = status === 'subscribed';

  const handleClick = async () => {
    try {
      if (subscribed) {
        await disable();
        show({ message: 'Push notifications turned off.', variant: 'info' });
      } else {
        await enable();
      }
    } catch (err) {
      show({ message: (err as Error).message, variant: 'error' });
    }
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-gray-200">
          Milestone approval alerts
        </p>
        <p className="text-xs text-gray-400">
          Get a browser notification when a coach or academy approves one of
          your milestones — even when the app is closed.
        </p>
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={status === 'loading' || !publicKey}
        aria-pressed={subscribed}
        className="shrink-0 px-4 py-1.5 rounded-lg border border-brand-green text-sm text-brand-green disabled:opacity-40 hover:bg-brand-green hover:text-black transition"
      >
        {subscribed ? 'Turn off' : 'Enable'}
      </button>
    </div>
  );
}
