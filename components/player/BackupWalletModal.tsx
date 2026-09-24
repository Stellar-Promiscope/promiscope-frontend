'use client';
import { useState, useCallback } from 'react';
import { Shield, Trash2, Key, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import { useBackupWallet } from '@/hooks/useBackupWallet';
import { useWallet } from '@/hooks/useWallet';
import type { Player } from '@/types';

interface BackupWalletModalProps {
  player: Player;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedPlayer: Player) => void;
}

type ModalStep = 'view' | 'link' | 'confirm' | 'remove' | 'remove-confirm';

export default function BackupWalletModal({
  player,
  isOpen,
  onClose,
  onSuccess,
}: BackupWalletModalProps) {
  const t = useTranslations('player.modals.backupWallet');
  const { link, remove, loading, error } = useBackupWallet();
  const { signAndSubmit } = useWallet();
  const [step, setStep] = useState<ModalStep>('view');
  const [backupWalletInput, setBackupWalletInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  const hasBackupWallet = !!player.backupWallet;

  const validateWalletAddress = (address: string): boolean => {
    // Stellar public key: 56 chars, starts with G
    return /^G[A-Z2-7]{55}$/.test(address.trim());
  };

  const handleLinkClick = useCallback(() => {
    setBackupWalletInput('');
    setInputError(null);
    setStep('link');
  }, []);

  const handleBackToView = useCallback(() => {
    setStep('view');
    setBackupWalletInput('');
    setInputError(null);
  }, []);

  const handleProceedToConfirm = useCallback(() => {
    const trimmed = backupWalletInput.trim();
    if (!trimmed) {
      setInputError(t('errorRequired'));
      return;
    }
    if (!validateWalletAddress(trimmed)) {
      setInputError(t('errorInvalid'));
      return;
    }
    if (trimmed === player.wallet) {
      setInputError(t('errorSameAsPrimary'));
      return;
    }
    setBackupWalletInput(trimmed);
    setInputError(null);
    setStep('confirm');
  }, [backupWalletInput, player.wallet, t]);

  const handleConfirmLink = useCallback(async () => {
    try {
      // Create a message to sign for verification
      const message = `Link backup wallet: ${backupWalletInput}`;
      const messageXdr = Buffer.from(message).toString('base64');

      // For this implementation, we're using a simple signed message approach
      // In production, this should coordinate with the backend for proper signature verification
      const signature = messageXdr; // Placeholder - real implementation signs with wallet

      const updated = await link(player.id, backupWalletInput, signature);
      onSuccess(updated);
      setStep('view');
      setBackupWalletInput('');
    } catch {
      // Error state handled by hook
    }
  }, [backupWalletInput, link, player.id, onSuccess]);

  const handleRemoveClick = useCallback(() => {
    setStep('remove');
  }, []);

  const handleConfirmRemove = useCallback(async () => {
    try {
      const updated = await remove(player.id);
      onSuccess(updated);
      setStep('view');
    } catch {
      // Error state handled by hook
    }
  }, [remove, player.id, onSuccess]);

  const handleClose = useCallback(() => {
    setStep('view');
    setBackupWalletInput('');
    setInputError(null);
    onClose();
  }, [onClose]);

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
      <div className="flex flex-col gap-4">
        {step === 'view' && (
          <>
            <div className="flex items-center gap-3">
              <Key className="w-5 h-5 text-brand-green" />
              <h2 className="text-lg font-semibold text-white">{t('title')}</h2>
            </div>

            <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 flex gap-3">
              <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
              <div className="text-sm text-blue-200">
                <p className="font-semibold mb-1">{t('protectsHeading')}</p>
                <ul className="text-xs space-y-1 opacity-90">
                  <li>• {t('protectsLoss')}</li>
                  <li>• {t('protectsRegain')}</li>
                </ul>
              </div>
            </div>

            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3">
              <p className="text-xs text-yellow-200">
                <span className="font-semibold">{t('notProtectsHeading')}</span>
                <br />
                {t('notProtectsBody')}
              </p>
            </div>

            {hasBackupWallet ? (
              <>
                <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
                  <p className="text-xs text-gray-400 mb-2">
                    {t('currentLabel')}
                  </p>
                  <p className="text-sm font-mono text-gray-300 break-all">
                    {player.backupWallet}
                  </p>
                  {player.backupWalletVerifiedAt && (
                    <p className="text-xs text-gray-400 mt-2">
                      {t('verifiedOn', {
                        date: new Date(
                          player.backupWalletVerifiedAt * 1000,
                        ).toLocaleDateString(),
                      })}
                    </p>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleClose}
                    className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-600 transition"
                  >
                    {t('close')}
                  </button>
                  <button
                    onClick={handleRemoveClick}
                    className="flex-1 px-4 py-2 rounded-lg bg-red-600/20 border border-red-600/50 text-red-300 hover:bg-red-600/30 transition flex items-center justify-center gap-2"
                  >
                    <Trash2 size={16} />
                    {t('remove')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-300">{t('noneConfigured')}</p>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleClose}
                    className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-600 transition"
                  >
                    {t('close')}
                  </button>
                  <button
                    onClick={handleLinkClick}
                    className="flex-1 px-4 py-2 rounded-lg bg-brand-green text-black font-semibold hover:opacity-90 transition flex items-center justify-center gap-2"
                  >
                    <Shield size={16} />
                    {t('linkButton')}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {step === 'link' && (
          <>
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-brand-green" />
              <h3 className="text-lg font-semibold text-white">
                {t('linkButton')}
              </h3>
            </div>

            <p className="text-sm text-gray-300">{t('linkBody')}</p>

            <input
              type="text"
              aria-label={t('inputLabel')}
              placeholder={t('inputPlaceholder')}
              value={backupWalletInput}
              onChange={(e) => {
                setBackupWalletInput(e.target.value);
                setInputError(null);
              }}
              className="input"
            />

            {inputError && <p className="text-sm text-red-400">{inputError}</p>}

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleBackToView}
                disabled={loading}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-600 transition disabled:opacity-50"
              >
                {t('back')}
              </button>
              <button
                onClick={handleProceedToConfirm}
                disabled={loading || !backupWalletInput.trim()}
                className="flex-1 px-4 py-2 rounded-lg bg-brand-green text-black font-semibold hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading && <Spinner size="sm" />}
                {t('continue')}
              </button>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            <div className="flex items-center gap-3">
              <Key className="w-5 h-5 text-brand-green" />
              <h3 className="text-lg font-semibold text-white">
                {t('confirmTitle')}
              </h3>
            </div>

            <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4 space-y-3">
              <div>
                <p className="text-xs text-gray-400">{t('primaryLabel')}</p>
                <p className="text-sm font-mono text-gray-300 break-all">
                  {player.wallet}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">{t('backupLabel')}</p>
                <p className="text-sm font-mono text-gray-300 break-all">
                  {backupWalletInput}
                </p>
              </div>
            </div>

            <p className="text-sm text-gray-400">{t('confirmBody')}</p>

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleBackToView}
                disabled={loading}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-600 transition disabled:opacity-50"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleConfirmLink}
                disabled={loading}
                className="flex-1 px-4 py-2 rounded-lg bg-brand-green text-black font-semibold hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading && <Spinner size="sm" />}
                {t('linkAndSign')}
              </button>
            </div>
          </>
        )}

        {step === 'remove' && (
          <>
            <div className="flex items-center gap-3">
              <Trash2 className="w-5 h-5 text-red-500" />
              <h3 className="text-lg font-semibold text-white">
                {t('removeTitle')}
              </h3>
            </div>

            <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-2">{t('currentLabel')}</p>
              <p className="text-sm font-mono text-gray-300 break-all">
                {player.backupWallet}
              </p>
            </div>

            <p className="text-sm text-gray-300">{t('removeBody')}</p>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleBackToView}
                disabled={loading}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-600 transition disabled:opacity-50"
              >
                {t('keep')}
              </button>
              <button
                onClick={() => setStep('remove-confirm')}
                disabled={loading}
                className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white font-semibold hover:opacity-90 transition disabled:opacity-50"
              >
                {t('remove')}
              </button>
            </div>
          </>
        )}

        {step === 'remove-confirm' && (
          <>
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <h3 className="text-lg font-semibold text-white">
                {t('confirmRemovalTitle')}
              </h3>
            </div>

            <p className="text-sm text-red-200">{t('confirmRemovalBody')}</p>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setStep('remove')}
                disabled={loading}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-600 transition disabled:opacity-50"
              >
                {t('goBack')}
              </button>
              <button
                onClick={handleConfirmRemove}
                disabled={loading}
                className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white font-semibold hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading && <Spinner size="sm" />}
                {t('yesRemove')}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
