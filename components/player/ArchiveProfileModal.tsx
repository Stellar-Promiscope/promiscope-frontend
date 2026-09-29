'use client';
import { useState, useCallback } from 'react';
import { Archive, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import { useArchiveProfile } from '@/hooks/useArchiveProfile';
import type { Player } from '@/types';

interface ArchiveProfileModalProps {
  player: Player;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedPlayer: Player) => void;
}

export default function ArchiveProfileModal({
  player,
  isOpen,
  onClose,
  onSuccess,
}: ArchiveProfileModalProps) {
  const t = useTranslations('player.modals.archive');
  const { archive, unarchive, loading, error } = useArchiveProfile();
  const [confirmStep, setConfirmStep] = useState(false);
  const isArchived = player.archived ?? false;

  const handleConfirm = useCallback(async () => {
    try {
      const action = isArchived ? unarchive : archive;
      const updated = await action(player.id);
      onSuccess(updated);
      setConfirmStep(false);
      onClose();
    } catch {
      // Error state is handled by the hook
    }
  }, [isArchived, archive, unarchive, player.id, onSuccess, onClose]);

  const handleClose = useCallback(() => {
    setConfirmStep(false);
    onClose();
  }, [onClose]);

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
      <div className="flex flex-col gap-4">
        {!confirmStep ? (
          <>
            <div className="flex items-center gap-3">
              {isArchived ? (
                <RotateCcw className="w-5 h-5 text-brand-green" />
              ) : (
                <Archive className="w-5 h-5 text-yellow-500" />
              )}
              <h2 className="text-lg font-semibold text-white">
                {isArchived ? t('titleRestore') : t('titleArchive')}
              </h2>
            </div>

            {isArchived ? (
              <>
                <p className="text-sm text-gray-300">{t('restoreBody')}</p>
                <p className="text-xs text-gray-400">{t('dataPreserved')}</p>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-300">{t('archiveBody')}</p>
                <p className="text-xs text-gray-400">
                  {t('dataPreserved')} {t('directLinksNote')}
                </p>
              </>
            )}

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-600 transition"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmStep(true)}
                disabled={loading}
                className={`flex-1 px-4 py-2 rounded-lg font-semibold transition flex items-center justify-center gap-2 ${
                  isArchived
                    ? 'bg-brand-green text-black hover:opacity-90 disabled:opacity-50'
                    : 'bg-yellow-600 text-white hover:opacity-90 disabled:opacity-50'
                }`}
              >
                {loading && <Spinner size="sm" />}
                {isArchived ? t('restoreButton') : t('archiveButton')}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold text-white">
              {isArchived ? t('confirmTitleRestore') : t('confirmTitleArchive')}
            </h3>
            <p className="text-sm text-gray-300">
              {isArchived ? t('confirmRestore') : t('confirmArchive')}
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmStep(false)}
                disabled={loading}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-600 transition disabled:opacity-50"
              >
                {t('goBack')}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={loading}
                className={`flex-1 px-4 py-2 rounded-lg font-semibold transition flex items-center justify-center gap-2 ${
                  isArchived
                    ? 'bg-brand-green text-black hover:opacity-90 disabled:opacity-50'
                    : 'bg-red-600 text-white hover:opacity-90 disabled:opacity-50'
                }`}
              >
                {loading && <Spinner size="sm" />}
                {loading
                  ? t('processing')
                  : isArchived
                    ? t('yesRestore')
                    : t('yesArchive')}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
