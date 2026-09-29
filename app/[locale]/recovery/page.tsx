'use client';
import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  Key,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Clock,
} from 'lucide-react';
import { useWallet } from '@/hooks/useWallet';
import { useBackupWallet } from '@/hooks/useBackupWallet';
import Spinner from '@/components/ui/Spinner';
import type { MigrationRequest } from '@/lib/migrationStore';

type RecoveryStep =
  | 'intro'
  | 'connect'
  | 'verify'
  | 'success'
  | 'error'
  | 'migrate-intro'
  | 'migrate-pending'
  | 'migrate-complete';

export default function AccountRecoveryPage() {
  const t = useTranslations('recovery');
  const router = useRouter();
  const { publicKey, isConnecting, connect } = useWallet();
  const { claim, loading: claiming, error: claimError } = useBackupWallet();

  const [step, setStep] = useState<RecoveryStep>('intro');
  const [primaryWallet, setPrimaryWallet] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  // Migration flow state
  const [migrationRequest, setMigrationRequest] =
    useState<MigrationRequest | null>(null);
  const [migrationResult, setMigrationResult] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);

  const validateWalletAddress = (address: string): boolean => {
    return /^G[A-Z2-7]{55}$/.test(address.trim());
  };

  const handleProceedToConnect = useCallback(() => {
    const trimmed = primaryWallet.trim();
    if (!trimmed) {
      setInputError(t('errorEmptyAddress'));
      return;
    }
    if (!validateWalletAddress(trimmed)) {
      setInputError(t('errorInvalidAddress'));
      return;
    }
    setPrimaryWallet(trimmed);
    setInputError(null);
    setStep('connect');
  }, [primaryWallet, t]);

  const handleConnectBackupWallet = useCallback(async () => {
    try {
      await connect();
      setStep('verify');
    } catch (err) {
      setRecoveryError(
        err instanceof Error ? err.message : t('errorConnectFailed'),
      );
      setStep('error');
    }
  }, [connect, t]);

  const handleVerifyAndRecover = useCallback(async () => {
    if (!publicKey) {
      setRecoveryError(t('errorNotConnected'));
      setStep('error');
      return;
    }

    try {
      setRecoveryError(null);
      const result = await claim(primaryWallet, publicKey);

      // Success - redirect to player dashboard
      router.push(`/player/${result.playerId}`);
      setStep('success');
    } catch (err) {
      const message =
        err instanceof Error && err.message.includes('not found')
          ? t('errorNoAccountFound')
          : err instanceof Error
            ? err.message
            : t('errorRecoverFailed');
      setRecoveryError(message);
      setStep('error');
    }
  }, [publicKey, primaryWallet, claim, router, t]);

  const handleReset = useCallback(() => {
    setPrimaryWallet('');
    setInputError(null);
    setRecoveryError(null);
    setMigrationRequest(null);
    setMigrationResult(null);
    setMigrationError(null);
    setMigrating(false);
    setStep('intro');
  }, []);

  /** Submit a data-portability migration request (issue #1315). */
  const handleSubmitMigration = useCallback(async () => {
    if (!publicKey) return;
    setMigrationError(null);
    setMigrating(true);
    try {
      const res = await fetch('/api/migration/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromWallet: primaryWallet }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMigrationError(data.error ?? 'Failed to submit migration request');
        setMigrating(false);
        return;
      }
      setMigrationRequest(data as MigrationRequest);
      setStep('migrate-pending');
    } catch (err) {
      setMigrationError(
        err instanceof Error
          ? err.message
          : 'Failed to submit migration request',
      );
    } finally {
      setMigrating(false);
    }
  }, [publicKey, primaryWallet]);

  /** Cancel a pending migration request. */
  const handleCancelMigration = useCallback(async () => {
    if (!migrationRequest) return;
    setMigrationError(null);
    setMigrating(true);
    try {
      const res = await fetch('/api/migration/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: migrationRequest.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMigrationError(data.error ?? 'Failed to cancel migration');
        setMigrating(false);
        return;
      }
      handleReset();
    } catch (err) {
      setMigrationError(
        err instanceof Error ? err.message : 'Failed to cancel migration',
      );
    } finally {
      setMigrating(false);
    }
  }, [migrationRequest, handleReset]);

  /** Execute the migration after the cooling-off period. */
  const handleExecuteMigration = useCallback(async () => {
    if (!migrationRequest) return;
    setMigrationError(null);
    setMigrating(true);
    try {
      const res = await fetch('/api/migration/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: migrationRequest.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMigrationError(data.error ?? 'Migration failed');
        setMigrating(false);
        return;
      }
      setMigrationResult(data);
      setStep('migrate-complete');
    } catch (err) {
      setMigrationError(
        err instanceof Error ? err.message : 'Migration failed',
      );
    } finally {
      setMigrating(false);
    }
  }, [migrationRequest]);

  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <div className="space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex justify-center mb-4">
            <Key className="w-12 h-12 text-brand-green" />
          </div>
          <h1 className="text-3xl font-bold text-white">{t('title')}</h1>
          <p className="text-gray-400">{t('subtitle')}</p>
        </div>

        {step === 'intro' && (
          <div className="bg-brand-card border border-gray-800 rounded-xl p-6 space-y-6">
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white">
                {t('howItWorks')}
              </h2>
              <ol className="space-y-3 text-sm text-gray-300">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-green text-black flex items-center justify-center text-xs font-semibold">
                    1
                  </span>
                  <span>{t('step1')}</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-green text-black flex items-center justify-center text-xs font-semibold">
                    2
                  </span>
                  <span>{t('step2')}</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-green text-black flex items-center justify-center text-xs font-semibold">
                    3
                  </span>
                  <span>{t('step3')}</span>
                </li>
              </ol>
            </div>

            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3">
              <p className="text-xs text-yellow-200">
                <span className="font-semibold">{t('noteLabel')}</span>{' '}
                {t('noteText')}
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-300 mb-2 block">
                {t('primaryWalletLabel')}
              </label>
              <input
                type="text"
                placeholder={t('primaryWalletPlaceholder')}
                value={primaryWallet}
                onChange={(e) => {
                  setPrimaryWallet(e.target.value);
                  setInputError(null);
                }}
                className="input w-full"
              />
              {inputError && (
                <p className="text-sm text-red-400 mt-2">{inputError}</p>
              )}
            </div>

            <div className="flex gap-3">
              <Link
                href="/"
                className="flex-1 px-4 py-3 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-600 transition text-center"
              >
                {t('backToHome')}
              </Link>
              <button
                onClick={handleProceedToConnect}
                disabled={isConnecting || claiming}
                className="flex-1 px-4 py-3 rounded-lg bg-brand-green text-black font-semibold hover:opacity-90 transition disabled:opacity-50"
              >
                {t('next')}
              </button>
            </div>
          </div>
        )}

        {step === 'connect' && (
          <div className="bg-brand-card border border-gray-800 rounded-xl p-6 space-y-6">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-white">
                {t('connectBackupTitle')}
              </h2>
              <p className="text-sm text-gray-400">{t('connectBackupDesc')}</p>
            </div>

            <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-2">
                Primary wallet (to recover):
              </p>
              <p className="text-sm font-mono text-gray-300 break-all">
                {primaryWallet}
              </p>
            </div>

            <button
              onClick={handleConnectBackupWallet}
              disabled={isConnecting || claiming}
              className="w-full px-4 py-3 rounded-lg bg-brand-green text-black font-semibold hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isConnecting && <Spinner size="sm" />}
              {isConnecting ? t('connecting') : t('connectBackupButton')}
            </button>

            <button
              onClick={handleReset}
              className="w-full px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-600 transition"
            >
              {t('back')}
            </button>
          </div>
        )}

        {step === 'verify' && publicKey && (
          <div className="bg-brand-card border border-gray-800 rounded-xl p-6 space-y-6">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-white">
                {t('verifyTitle')}
              </h2>
              <p className="text-sm text-gray-400">{t('verifyDesc')}</p>
            </div>

            <div className="space-y-3">
              <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-2">
                  Primary wallet (lost access):
                </p>
                <p className="text-sm font-mono text-gray-300 break-all">
                  {primaryWallet}
                </p>
              </div>
              <div className="bg-gray-900/50 border border-brand-green rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-2">
                  Backup wallet (connected):
                </p>
                <p className="text-sm font-mono text-gray-300 break-all">
                  {publicKey}
                </p>
                <p className="text-xs text-brand-green mt-2">
                  {t('connected')}
                </p>
              </div>
            </div>

            <button
              onClick={handleVerifyAndRecover}
              disabled={claiming}
              className="w-full px-4 py-3 rounded-lg bg-brand-green text-black font-semibold hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {claiming && <Spinner size="sm" />}
              {claiming ? t('verifying') : t('recoverButton')}
            </button>

            <button
              onClick={handleReset}
              disabled={claiming}
              className="w-full px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-600 transition disabled:opacity-50"
            >
              {t('cancel')}
            </button>
          </div>
        )}

        {step === 'success' && (
          <div className="bg-brand-card border border-brand-green rounded-xl p-6 space-y-6">
            <div className="flex justify-center mb-4">
              <CheckCircle2 className="w-12 h-12 text-brand-green" />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-lg font-semibold text-white">
                {t('successTitle')}
              </h2>
              <p className="text-sm text-gray-400">{t('successRedirect')}</p>
            </div>

            {/* Data portability migration option (issue #1315) */}
            <div className="rounded-lg border border-brand-green/30 bg-brand-green/5 px-4 py-4">
              <p className="text-sm font-semibold text-white mb-1">
                Migrate your off-chain data
              </p>
              <p className="text-xs text-gray-400 mb-3">
                Move your watchlist, saved searches, notification preferences,
                and read state from your old wallet to this one. A 72-hour
                cooling-off period applies.
              </p>
              <button
                onClick={() => setStep('migrate-intro')}
                className="flex items-center gap-2 text-sm text-brand-green font-semibold hover:opacity-80 transition"
              >
                Start data migration
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <Spinner size="md" />
          </div>
        )}

        {/* ── Migration intro step ── */}
        {step === 'migrate-intro' && publicKey && (
          <div className="bg-brand-card border border-gray-800 rounded-xl p-6 space-y-6">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-white">
                Migrate off-chain data
              </h2>
              <p className="text-sm text-gray-400">
                This will move your watchlist, saved searches, notification
                preferences, read state, and recently viewed players from your
                old wallet to your new one.
              </p>
            </div>

            <div className="space-y-3">
              <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">From (old wallet)</p>
                <p className="text-sm font-mono text-gray-300 break-all">
                  {primaryWallet}
                </p>
              </div>
              <div className="bg-gray-900/50 border border-brand-green rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">
                  To (your current wallet)
                </p>
                <p className="text-sm font-mono text-gray-300 break-all">
                  {publicKey}
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3">
              <p className="text-xs text-yellow-200">
                <span className="font-semibold">72-hour cooling-off: </span>
                After submitting, the original wallet owner has 72 hours to
                cancel this request. The migration will not execute until this
                period elapses.
              </p>
            </div>

            <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-3">
              <p className="text-xs text-orange-200">
                <span className="font-semibold">
                  On-chain identity not transferred:{' '}
                </span>
                Your on-chain profile (registration, milestones, subscriptions)
                remains bound to the original wallet key. The ScoutOff contract
                does not yet support ownership transfer.{' '}
                <a
                  href="https://github.com/scout-off/scout-off-frontend/issues/1315"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Track progress here.
                </a>
              </p>
            </div>

            {migrationError && (
              <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-sm text-red-300">{migrationError}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleReset}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-600 transition"
              >
                Skip
              </button>
              <button
                onClick={handleSubmitMigration}
                disabled={migrating}
                className="flex-1 px-4 py-3 rounded-lg bg-brand-green text-black font-semibold hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {migrating && <Spinner size="sm" />}
                {migrating ? 'Submitting…' : 'Submit migration request'}
              </button>
            </div>
          </div>
        )}

        {/* ── Migration cooling-off / pending step ── */}
        {step === 'migrate-pending' && migrationRequest && (
          <div className="bg-brand-card border border-yellow-500/30 rounded-xl p-6 space-y-6">
            <div className="flex items-center gap-3">
              <Clock className="w-6 h-6 text-yellow-400 shrink-0" />
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Migration request submitted
                </h2>
                <p className="text-sm text-gray-400 mt-0.5">
                  Cooling-off period in progress
                </p>
              </div>
            </div>

            <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Request ID</span>
                <span className="font-mono text-xs text-gray-300 break-all max-w-[60%] text-right">
                  {migrationRequest.id}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Executable after</span>
                <span className="text-gray-300">
                  {new Date(migrationRequest.executeAfter).toLocaleString()}
                </span>
              </div>
            </div>

            <p className="text-sm text-gray-400">
              The original wallet owner has been notified. If no one cancels
              this request within 72 hours, you may execute the migration.
            </p>

            {migrationError && (
              <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-sm text-red-300">{migrationError}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleCancelMigration}
                disabled={migrating}
                className="flex-1 px-4 py-2 rounded-lg border border-red-700 text-red-300 hover:border-red-600 transition disabled:opacity-50"
              >
                {migrating ? <Spinner size="sm" /> : 'Cancel migration'}
              </button>
              <button
                onClick={handleExecuteMigration}
                disabled={
                  migrating || Date.now() < migrationRequest.executeAfter
                }
                title={
                  Date.now() < migrationRequest.executeAfter
                    ? `Available after ${new Date(migrationRequest.executeAfter).toLocaleString()}`
                    : undefined
                }
                className="flex-1 px-4 py-3 rounded-lg bg-brand-green text-black font-semibold hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {migrating && <Spinner size="sm" />}
                Execute migration
              </button>
            </div>
          </div>
        )}

        {/* ── Migration complete step ── */}
        {step === 'migrate-complete' && migrationResult && (
          <div className="bg-brand-card border border-brand-green rounded-xl p-6 space-y-6">
            <div className="flex justify-center mb-4">
              <CheckCircle2 className="w-12 h-12 text-brand-green" />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-lg font-semibold text-white">
                Migration complete
              </h2>
              <p className="text-sm text-gray-400">
                Your off-chain data has been moved to your new wallet.
              </p>
            </div>

            {/* Show migration counts */}
            {migrationResult.migration != null &&
              typeof migrationResult.migration === 'object' ? (
              <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4 text-sm space-y-1">
                {Object.entries(
                  ((migrationResult.migration as Record<string, unknown>).counts ?? {}) as Record<string, string | number | boolean>,
                ).map(([key, value]) => (
                  <div key={key} className="flex justify-between">
                    <span className="text-gray-400 capitalize">
                      {key.replace(/([A-Z])/g, ' $1')}
                    </span>
                    <span className="text-gray-300 font-mono">
                      {String(value)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-3">
              <p className="text-xs text-orange-200">
                <span className="font-semibold">Note: </span>
                Your on-chain identity (registration, milestones) remains on the
                original wallet. Contract-level transfer is not yet supported.{' '}
                <a
                  href="https://github.com/scout-off/scout-off-frontend/issues/1315"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Track progress.
                </a>
              </p>
            </div>

            <Link
              href="/"
              className="block w-full px-4 py-3 rounded-lg bg-brand-green text-black font-semibold text-center hover:opacity-90 transition"
            >
              Go to dashboard
            </Link>
          </div>
        )}

        {step === 'error' && (
          <div className="bg-brand-card border border-red-500/30 rounded-xl p-6 space-y-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {t('errorTitle')}
                </h2>
                <p className="text-sm text-gray-400 mt-1">{recoveryError}</p>
              </div>
            </div>

            <div className="space-y-2 text-sm text-gray-400">
              <p>
                <span className="font-semibold">{t('troubleshooting')}</span>
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li>{t('troubleshootingTip1')}</li>
                <li>{t('troubleshootingTip2')}</li>
                <li>{t('troubleshootingTip3')}</li>
              </ul>
            </div>

            <div className="flex gap-3">
              <Link
                href="/"
                className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-600 transition text-center"
              >
                {t('backToHome')}
              </Link>
              <button
                onClick={handleReset}
                className="flex-1 px-4 py-2 rounded-lg bg-brand-green text-black font-semibold hover:opacity-90 transition"
              >
                {t('tryAgain')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
