'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  ArrowLeft,
  Trash2,
  Shield,
  Bell,
  Download,
  LogOut,
  Laptop,
} from 'lucide-react';
import DataDeletionModal from '@/components/player/DataDeletionModal';
import NotificationPreferencesPanel from '@/components/NotificationPreferencesPanel';
import ActiveSessions from '@/components/ActiveSessions';
import PushNotificationToggle from '@/components/PushNotificationToggle';
import { useWallet } from '@/hooks/useWallet';
import { useToast } from '@/components/ui/Toast';

export default function SettingsPage({
  params,
}: {
  params: { locale: string };
}) {
  const locale = params.locale;
  const t = useTranslations('settings');
  const { isAuthenticated, disconnect } = useWallet();
  const { show } = useToast();
  const [showDeletionModal, setShowDeletionModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loggingOutAll, setLoggingOutAll] = useState(false);

  // "Log out of all devices" (see #1179): revokes every active
  // server-side session for the connected wallet, not just this browser's.
  // The server-side sweep in POST /api/auth/logout-all necessarily
  // includes the caller's own session, so this also runs the normal
  // client-side disconnect() to clear local state and cookies right away
  // rather than leaving the UI showing a now-dead session until the next
  // periodic reconciliation notices.
  const handleLogoutAllDevices = async () => {
    setLoggingOutAll(true);
    try {
      const res = await fetch('/api/auth/logout-all', { method: 'POST' });
      if (!res.ok) {
        throw new Error(`Logout failed: ${res.status}`);
      }
      disconnect();
      show({
        message: t('logout_all_success'),
        variant: 'success',
        duration: 6000,
      });
    } catch {
      show({
        message: t('logout_all_error'),
        variant: 'error',
        duration: 6000,
      });
    } finally {
      setLoggingOutAll(false);
    }
  };

  const handleExportData = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/data-export');
      if (!res.ok) {
        throw new Error(`Export failed: ${res.status}`);
      }
      const blob = await res.blob();
      const contentDisposition = res.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="?([^"]+)"?/);
      const filename =
        filenameMatch?.[1] ??
        `scoutoff-data-export-${new Date().toISOString().split('T')[0]}.json`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      show({
        message: t('data_export_success'),
        variant: 'success',
        duration: 6000,
      });
    } catch {
      show({
        message: t('data_export_error'),
        variant: 'error',
        duration: 6000,
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-10 pb-20">
      {/* Header */}
      <section className="relative overflow-hidden rounded-2xl border border-gray-800 bg-brand-card px-6 py-10 sm:px-8 lg:px-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(0,200,83,0.12),_transparent_50%)]" />
        <div className="relative flex flex-col gap-6">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-brand-green/30 bg-brand-green/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-brand-green">
            <Shield size={12} />
            {t('eyebrow')}
          </span>
          <div className="max-w-2xl">
            <h1 className="text-3xl font-bold text-white sm:text-4xl">
              {t('page_title')}
            </h1>
            <p className="mt-3 text-sm leading-7 text-gray-400 sm:text-base">
              {t('page_description')}
            </p>
          </div>
          <div className="flex justify-start">
            <Link
              href={`/${locale}`}
              className="inline-flex items-center gap-2 text-sm font-medium text-brand-green transition hover:text-green-400"
            >
              {t('back_to_home')}
              <ArrowLeft size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* Notification Preferences section */}
      <section className="px-1 sm:px-0">
        <div className="rounded-2xl border border-gray-800 bg-brand-card/70 p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-green/10 text-brand-green">
              <Bell size={18} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-white">
                Notification preferences
              </h2>
              <p className="mt-1 max-w-lg text-sm leading-relaxed text-gray-400">
                Choose which events send you an in-app notification.
              </p>
              <div className="mt-4">
                <NotificationPreferencesPanel />
              </div>
              <div className="mt-6 border-t border-gray-800 pt-4">
                <PushNotificationToggle />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Session Security section */}
      <section className="px-1 sm:px-0">
        <div className="rounded-2xl border border-gray-800 bg-brand-card/70 p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-500">
                <LogOut size={18} aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {t('logout_all_title')}
                </h2>
                <p className="mt-1 max-w-lg text-sm leading-relaxed text-gray-400">
                  {t('logout_all_description')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogoutAllDevices}
              disabled={!isAuthenticated || loggingOutAll}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-5 py-2.5 text-sm font-semibold text-red-400 transition hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LogOut size={15} />
              {loggingOutAll
                ? t('logout_all_in_progress')
                : t('logout_all_button')}
            </button>
          </div>

          {!isAuthenticated && (
            <p className="mt-4 text-xs text-gray-500">
              {t('connect_wallet_to_request')}
            </p>
          )}
        </div>
      </section>

      {/* Active Sessions section */}
      <section className="px-1 sm:px-0">
        <div className="rounded-2xl border border-gray-800 bg-brand-card/70 p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-green/10 text-brand-green">
              <Laptop size={18} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-white">
                Active sessions
              </h2>
              <p className="mt-1 max-w-lg text-sm leading-relaxed text-gray-400">
                Every device and browser currently signed in to your wallet.
                Revoke any session you don&apos;t recognize.
              </p>
              <div className="mt-4">
                <ActiveSessions />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Data Deletion section */}
      <section className="px-1 sm:px-0">
        <div className="rounded-2xl border border-gray-800 bg-brand-card/70 p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-500">
                <Trash2 size={18} aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {t('data_deletion_title')}
                </h2>
                <p className="mt-1 max-w-lg text-sm leading-relaxed text-gray-400">
                  {t('data_deletion_description')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowDeletionModal(true)}
              disabled={!isAuthenticated}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-5 py-2.5 text-sm font-semibold text-red-400 transition hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 size={15} />
              {t('data_deletion_button')}
            </button>
          </div>

          <div className="mt-6 border-t border-gray-800 pt-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-green/10 text-brand-green">
                  <Download size={18} aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">
                    {t('data_export_title')}
                  </h3>
                  <p className="mt-1 max-w-lg text-sm leading-relaxed text-gray-400">
                    {t('data_export_description')}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-gray-500">
                    {t('data_export_onchain_note')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleExportData}
                disabled={!isAuthenticated || exporting}
                className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-brand-green/40 bg-brand-green/10 px-5 py-2.5 text-sm font-semibold text-brand-green transition hover:bg-brand-green/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download size={15} />
                {exporting
                  ? t('data_export_exporting')
                  : t('data_export_button')}
              </button>
            </div>
          </div>

          {!isAuthenticated && (
            <p className="mt-4 text-xs text-gray-500">
              {t('connect_wallet_to_request')}
            </p>
          )}
        </div>
      </section>

      <DataDeletionModal
        isOpen={showDeletionModal}
        onClose={() => setShowDeletionModal(false)}
      />
    </div>
  );
}
