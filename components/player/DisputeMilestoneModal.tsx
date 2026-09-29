'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { TEXT_FIELD_LIMITS } from '@/lib/inputValidation';

const { min: MIN_REASON_LENGTH, max: MAX_REASON_LENGTH } = TEXT_FIELD_LIMITS.disputeReason;

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
  const tCounter = useTranslations('dispute_modal');

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
    if (reason.trim().length > MAX_REASON_LENGTH) {
      setError(
        `Please describe your dispute in at most ${MAX_REASON_LENGTH} characters.`,
      );
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

  const currentLength = reason.length;
  const isNearLimit = currentLength >= MAX_REASON_LENGTH * 0.9;

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
            maxLength={MAX_REASON_LENGTH}
            minLength={MIN_REASON_LENGTH}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-brand-green focus:outline-none"
            placeholder={t('reasonPlaceholder')}
          />
          <p
            className="text-xs text-gray-400 mt-1 text-right"
            aria-live={isNearLimit ? 'polite' : undefined}
          >
            {tCounter('character_count', { count: currentLength, max: MAX_REASON_LENGTH })}
          </p>
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
