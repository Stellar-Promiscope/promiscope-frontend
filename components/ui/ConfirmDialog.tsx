'use client';

import { useId, type ReactNode } from 'react';
import Modal from './Modal';
import Button from './Button';
import { useTranslations } from 'next-intl';

interface ConfirmDialogProps {
  isOpen: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
}

export default function ConfirmDialog({
  isOpen,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel,
  cancelLabel,
  loading = false,
}: ConfirmDialogProps) {
  const messageId = useId();
  const t = useTranslations('common');
  const handleConfirm = async () => {
    await onConfirm();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      ariaDescribedBy={messageId}
    >
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          {title}
        </h2>
        <p
          id={messageId}
          className="text-gray-700 dark:text-gray-300"
          aria-live="polite"
        >
          {message}
        </p>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel ?? t('cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={handleConfirm}
            isLoading={loading}
            disabled={loading}
          >
            {confirmLabel ?? t('confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
