'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import useIsPaused from '@/hooks/useIsPaused';
import { CONTRACT_PAUSED_DISMISSED_KEY } from '@/lib/storageKeys';

const SESSION_KEY = CONTRACT_PAUSED_DISMISSED_KEY;
const SUPPORT_URL = 'https://discord.gg/stellar';

export default function ContractPausedBanner() {
  const paused = useIsPaused();
  const [dismissed, setDismissed] = useState(false);
  const pathname = usePathname() ?? '/';
  const locale = pathname.split('/')[1] || 'en';

  useEffect(() => {
    try {
      const val = sessionStorage.getItem(SESSION_KEY);
      setDismissed(val === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  useEffect(() => {
    if (!paused) {
      try {
        sessionStorage.removeItem(SESSION_KEY);
      } catch {}
      setDismissed(false);
    }
  }, [paused]);

  function handleDismiss() {
    try {
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {}
    setDismissed(true);
  }

  const visible = paused && !dismissed;

  return (
    <div aria-live="polite" style={{ minHeight: visible ? undefined : 0 }}>
      {visible && (
        <div className="w-full bg-yellow-300 text-black px-4 py-3 flex items-center justify-between gap-4 sticky top-0 z-40 border-b border-yellow-400">
          <div>
            <strong className="font-semibold">
              Promiscope is currently under maintenance.
            </strong>{' '}
            <span className="text-sm">
              Transactions are disabled.{' '}
              <a
                href={SUPPORT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-medium"
              >
                Get updates on Discord
              </a>{' '}
              <span>
                or{' '}
                <Link
                  href={`/${locale}/status`}
                  className="underline font-medium"
                >
                  check status
                </Link>
                .
              </span>
            </span>
          </div>
          <button
            onClick={handleDismiss}
            className="shrink-0 bg-black text-yellow-300 px-3 py-1 rounded-md font-medium"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
