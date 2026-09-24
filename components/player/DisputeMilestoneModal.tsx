'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

const MIN_REASON_LENGTH = 10;

interface DisputeMilestoneModalProps {
  isOpen: boolean;
  onClose: () => void;
  milestoneDescription: string;
  onSubmit: (reason: string) => Promise<void>;
}

/**
 * Form for a player to flag a milestone decision for admin review (issue
 * #562). Purely off-chain — filing a dispute never touches the contract;
 * it only creates a moderation record via POST /api/disputes.
 */
export default function DisputeMilestoneModal({
  isOpen,
  onClose,
  milestoneDescription,
  onSubmit,
}: DisputeMilestoneModalProps) {
  const t = useTranslations('player.modals.dispute');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setReason('');
    setError(null);
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (reason.trim().length < MIN_REASON_LENGTH) {
      setError(t('reasonTooShort', { min: MIN_REASON_LENGTH }));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('title')}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-300">
          {t.rich('intro', {
            milestone: milestoneDescription,
            highlight: (chunks) => (
              <span className="font-medium text-white">{chunks}</span>
            ),
          })}
        </p>

        <div>
          <label
            htmlFor="dispute-reason"
            className="block text-sm font-medium text-gray-300 mb-1"
          >
            {t('reasonLabel')}
          </label>
          <textarea
            id="dispute-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            required
            minLength={MIN_REASON_LENGTH}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-brand-green focus:outline-none"
            placeholder={t('reasonPlaceholder')}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={handleClose}
            disabled={submitting}
          >
            {t('cancel')}
          </Button>
          <Button type="submit" isLoading={submitting} disabled={submitting}>
            {t('submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
