'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useWallet } from '@/hooks/useWallet';
import { useNotifications } from '@/hooks/useNotifications';
import type { Notification } from '@/types';
import { formatRelativeTime } from '@/lib/localeFormat';
import type { Locale } from '@/lib/locales';

const MAX_BADGE_COUNT = 9;

function NotificationItem({
  notification,
  onRead,
}: {
  notification: Notification;
  onRead: (id: number) => void;
}) {
  const locale = useLocale() as Locale;
  return (
    <li>
      <button
        type="button"
        onClick={() => !notification.read && onRead(notification.id)}
        className="w-full text-left px-4 py-3 flex gap-2.5 hover:bg-gray-800/60 transition"
      >
        <span
          aria-hidden="true"
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
            notification.read ? 'bg-transparent' : 'bg-brand-green'
          }`}
        />
        <span className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-medium text-white">
            {notification.title}
          </span>
          <span className="text-xs text-gray-400 break-words">
            {notification.message}
          </span>
          <span className="text-[11px] text-gray-500">
            {formatRelativeTime(notification.createdAt * 1000, locale)}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * Navbar bell icon + dropdown panel for the notification center (issue
 * #557), with an unread-count badge capped at "9+" (issue #559).
 */
export default function NotificationBell() {
  const { publicKey, isAuthenticated } = useWallet();
  const { notifications, unreadCount, loading, markRead, markAllRead } =
    useNotifications(isAuthenticated ? publicKey : null);

  const t = useTranslations('notifications');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (!isAuthenticated) return null;

  const badgeLabel =
    unreadCount > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(unreadCount);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative p-2 rounded text-gray-300 hover:text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t('bell_label', { count: unreadCount })}
      >
        <Bell size={20} aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white"
          >
            {badgeLabel}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('title')}
          className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-brand-dark border border-gray-800 rounded-lg shadow-lg z-50 flex flex-col"
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800">
            <span className="text-sm font-semibold text-white">
              {t('title')}
            </span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllRead()}
                className="text-xs text-brand-green hover:text-green-400 transition"
              >
                {t('mark_all_read')}
              </button>
            )}
          </div>

          {loading && notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-500">
              {t('loading')}
            </p>
          ) : notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-500">
              {t('empty')}
            </p>
          ) : (
            <ul className="divide-y divide-gray-800">
              {notifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onRead={markRead}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
