'use client';
import { useState, FormEvent, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useTrialOffer } from '@/hooks/useTrialOffer';
import TransactionStatus, {
  type TxStatus,
} from '@/components/ui/TransactionStatus';
import Button from '@/components/ui/Button';
import type { TrialOfferType } from '@/types';

const OFFER_TYPES: TrialOfferType[] = ['trial', 'loan', 'transfer'];

interface TrialOfferFormProps {
  playerId: string;
  onSuccess?: () => void;
}

export default function TrialOfferForm({
  playerId,
  onSuccess,
}: TrialOfferFormProps) {
  const t = useTranslations('trial_offer');
  const { logTrialOffer, loading, error, txHash } = useTrialOffer();

  const [clubName, setClubName] = useState('');
  const [offerType, setOfferType] = useState<TrialOfferType>('trial');
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!clubName.trim()) errs.clubName = t('club_name_required');
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setTxStatus('pending');
    try {
      await logTrialOffer(playerId, {
        clubName: clubName.trim(),
        offerType,
        message: message.trim() || undefined,
      });
      setTxStatus('success');
      setClubName('');
      setOfferType('trial');
      setMessage('');
      onSuccess?.();
    } catch {
      setTxStatus('error');
    }
  }

  const handleHideStatus = useCallback(() => {
    setTxStatus(null);
  }, []);

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
      aria-label={t('form_label')}
    >
      {/* Club name */}
      <div className="flex flex-col gap-1">
        <label htmlFor="tof-club" className="text-sm font-medium text-gray-300">
          {t('club_name')} *
        </label>
        <input
          id="tof-club"
          type="text"
          value={clubName}
          onChange={(e) => {
            setClubName(e.target.value);
            if (fieldErrors.clubName)
              setFieldErrors((p) => ({ ...p, clubName: '' }));
          }}
          disabled={loading}
          className={`input${fieldErrors.clubName ? ' border-red-500' : ''}`}
          placeholder={t('club_name_placeholder')}
        />
        {fieldErrors.clubName && (
          <p role="alert" className="text-sm text-red-500">
            {fieldErrors.clubName}
          </p>
        )}
      </div>

      {/* Offer type */}
      <div className="flex flex-col gap-1">
        <label htmlFor="tof-type" className="text-sm font-medium text-gray-300">
          {t('offer_type')} *
        </label>
        <select
          id="tof-type"
          value={offerType}
          onChange={(e) => setOfferType(e.target.value as TrialOfferType)}
          disabled={loading}
          className="input"
        >
          {OFFER_TYPES.map((value) => (
            <option key={value} value={value}>
              {t(`offer_type_${value}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Optional message */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="tof-message"
          className="text-sm font-medium text-gray-300"
        >
          {t('message')}{' '}
          <span className="text-gray-400 font-normal">({t('optional')})</span>
        </label>
        <textarea
          id="tof-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={loading}
          className="input resize-none"
          rows={3}
          placeholder={t('message_hint')}
        />
      </div>

      <TransactionStatus
        status={txStatus}
        txHash={txHash}
        error={error}
        onHide={handleHideStatus}
      />

      <Button
        type="submit"
        isLoading={loading}
        disabled={loading}
        className="w-full"
      >
        {loading ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
