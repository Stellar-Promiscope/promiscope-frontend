'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ShieldCheck, Star } from 'lucide-react';
import { useWallet } from '@/hooks/useWallet';
import { usePlayer } from '@/hooks/usePlayer';
import { usePayToContact } from '@/hooks/usePayToContact';
import { useSubscription } from '@/hooks/useSubscription';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { PLATFORM_CONTACT_FEE_XLM, getContactFee } from '@/lib/contract';
import XlmFiatDisplay from '@/components/ui/XlmFiatDisplay';
import ProgressBar from '@/components/ProgressBar';
import AchievementBadges from '@/components/player/AchievementBadges';
import PlayerProfileSkeleton from '@/components/PlayerProfileSkeleton';
import PlayerStatsCard from '@/components/player/PlayerStatsCard';
import IPFSMediaGallery from '@/components/player/IPFSMediaGallery';
import TrialOfferForm from '@/components/scout/TrialOfferForm';
import ContactModal from '@/components/scout/ContactModal';
import BlockedStateMessage from '@/components/messaging/BlockedStateMessage';
import Button from '@/components/ui/Button';
import QRModal from '@/components/ui/QRModal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import TransactionStatus from '@/components/ui/TransactionStatus';
import type { TxStatus } from '@/components/ui/TransactionStatus';
import TruncatedAddress from '@/components/ui/TruncatedAddress';
import { useToast } from '@/components/ui/Toast';
import { ARCHIVED_ENTRY_MESSAGE } from '@/lib/errors';
import type { Player } from '@/types';

/**
 * Interactive player profile. Rendered by the server component in page.tsx
 * with `initialPlayer` so the first HTML already contains the profile;
 * wallet-dependent UI (contact, watchlist, trial offers) hydrates client-side.
 */
export default function PlayerProfileClient({
  initialPlayer,
}: {
  initialPlayer?: Player | null;
}) {
  const { id } = useParams<{ id: string }>();
  const { publicKey } = useWallet();
  const t = useTranslations('player_profile');
  const { show: showToast } = useToast();
  const {
    player,
    loading: playerLoading,
    error: playerError,
    refetch,
  } = usePlayer(id ?? null, initialPlayer ?? undefined);
  const { unlock, loading: contacting } = usePayToContact(id ?? '');
  const watchlist = useWatchlist(publicKey ?? null);
  const { record: recordRecentlyViewed } = useRecentlyViewed();
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const {
    subscription,
    isExpired,
    loading: subscriptionLoading,
  } = useSubscription();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [contactTxStatus, setContactTxStatus] = useState<TxStatus | null>(null);
  const [cvExportStatus, setCvExportStatus] = useState<
    'idle' | 'generating' | 'error'
  >('idle');
  const [liveFee, setLiveFee] = useState<number | null>(null);
  const [feeCheckStatus, setFeeCheckStatus] = useState<
    'idle' | 'checking' | 'ok' | 'error'
  >('idle');
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const milestones = player?.milestones ?? [];
  const profileUrl = typeof window !== 'undefined' ? window.location.href : '';

  // Re-check the live contact fee every time the confirmation dialog opens,
  // so a scout is never confirming against a stale, build-time constant.
  useEffect(() => {
    if (!confirmOpen) return;
    let cancelled = false;
    setLiveFee(null);
    setFeeCheckStatus('checking');
    getContactFee()
      .then((fee) => {
        if (cancelled) return;
        setLiveFee(fee);
        setFeeCheckStatus('ok');
      })
      .catch(() => {
        if (cancelled) return;
        setFeeCheckStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [confirmOpen]);

  // Record this profile visit for the scout's "recently viewed" dashboard
  // widget. Client-side only (localStorage) — no backend dependency.
  useEffect(() => {
    if (!player) return;
    recordRecentlyViewed({
      playerId: player.id,
      name: player.vitals.name,
      position: player.vitals.position,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player?.id]);

  const feeMismatch =
    feeCheckStatus === 'ok' &&
    liveFee !== null &&
    liveFee !== PLATFORM_CONTACT_FEE_XLM;
  const displayFee =
    feeCheckStatus === 'ok' && liveFee !== null
      ? liveFee
      : PLATFORM_CONTACT_FEE_XLM;

  const confirmMessage = (() => {
    if (!player) return '';
    if (feeCheckStatus === 'checking') {
      return `Unlock contact details for ${player.vitals.name}? Confirming the current fee before you sign…`;
    }
    if (feeMismatch) {
      return `Unlock contact details for ${player.vitals.name}? The live contact fee is now ${liveFee} XLM — different from the ${PLATFORM_CONTACT_FEE_XLM} XLM shown initially. Confirming will charge ${liveFee} XLM.`;
    }
    if (feeCheckStatus === 'error') {
      return `Unlock contact details for ${player.vitals.name}? Fee: ~${PLATFORM_CONTACT_FEE_XLM} XLM (estimate — could not confirm the live rate) will be deducted from your wallet.`;
    }
    return `Unlock contact details for ${player.vitals.name}? Fee: ${displayFee} XLM will be deducted from your wallet.`;
  })();

  async function handleConfirm() {
    setContactTxStatus('pending');
    try {
      await unlock();
      setContactTxStatus('success');
      setContactModalOpen(true);
    } catch {
      setContactTxStatus('error');
    }
    setConfirmOpen(false);
  }

  function handleDownload() {
    const payload = {
      playerId: player!.id,
      wallet: player!.wallet,
      progressLevel: player!.progressLevel,
      milestones: player!.milestones.map((m) => ({
        id: m.id,
        description: m.description,
        validator: m.validator,
        timestamp: m.timestamp,
      })),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `player-${player!.id}-milestones.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportCv() {
    if (!player) return;
    setCvExportStatus('generating');
    try {
      const {
        generatePlayerCvPdf,
        requestCvVerification,
        downloadPlayerCvPdf,
        CV_EXPORT_LARGE_MILESTONE_WARNING_THRESHOLD,
      } = await import('@/lib/cvExport');
      if (
        player.milestones.length > CV_EXPORT_LARGE_MILESTONE_WARNING_THRESHOLD
      ) {
        showToast({
          message: `Your CV includes ${player.milestones.length} milestones and may take a moment to generate.`,
          variant: 'info',
        });
      }
      const verification = await requestCvVerification(
        player,
        player.milestones,
      );
      const bytes = await generatePlayerCvPdf(
        player,
        player.milestones,
        verification,
      );
      downloadPlayerCvPdf(bytes, player.vitals.name);
      setCvExportStatus('idle');
    } catch {
      setCvExportStatus('error');
    }
  }

  const isScoutWithActiveSubscription = publicKey && subscription && !isExpired;
  const canLogTrialOffer =
    isScoutWithActiveSubscription && player && player.progressLevel < 3;

  if (playerLoading) {
    return <PlayerProfileSkeleton showContactButton={!!publicKey} />;
  }
  if (playerError === ARCHIVED_ENTRY_MESSAGE) {
    return (
      <p className="mx-auto mt-20 max-w-xl px-6 text-center text-yellow-300">
        {ARCHIVED_ENTRY_MESSAGE}
      </p>
    );
  }
  if (!player)
    return <p className="text-center text-gray-400 mt-20">Player not found.</p>;

  const isArchived = player.archived ?? false;

  return (
    <div className="print-area max-w-2xl mx-auto flex flex-col gap-8">
      {/* Back to Scout Dashboard */}
      <Link
        href="/scout"
        className="print-hidden self-start text-sm text-gray-400 hover:text-white transition flex items-center gap-1"
      >
        {t('back_to_scout_dashboard')}
      </Link>

      {/* Blocked State Message */}
      <BlockedStateMessage
        targetId={id ?? ''}
        targetType="player"
        action="contact"
      />

      {/* Archived Profile Banner */}
      {isArchived && (
        <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          <p className="font-semibold">This profile is currently private</p>
          <p className="text-xs text-yellow-300/80 mt-1">
            The player has archived their profile and it&apos;s not visible in
            search results.
          </p>
        </div>
      )}

      {/* Header */}
      <div className="relative bg-brand-card border border-gray-800 rounded-xl p-6 flex gap-6 items-start">
        {publicKey && publicKey !== player.wallet && (
          <button
            type="button"
            onClick={() => {
              const existing = watchlist.entries.find(
                (e) => e.playerId === player.id,
              );
              if (existing) {
                watchlist.remove(existing);
              } else {
                watchlist.add(player.id);
              }
            }}
            aria-pressed={watchlist.isWatched(player.id)}
            aria-label={
              watchlist.isWatched(player.id)
                ? 'Remove from watchlist'
                : 'Add to watchlist'
            }
            className="absolute top-4 right-4 inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition hover:text-yellow-400 focus:outline-none focus:ring-2 focus:ring-brand-green"
          >
            <Star
              className={
                watchlist.isWatched(player.id) ? 'text-yellow-400' : ''
              }
              fill={watchlist.isWatched(player.id) ? 'currentColor' : 'none'}
              size={20}
              aria-hidden="true"
            />
          </button>
        )}
        <div className="w-20 h-20 rounded-full bg-gray-700 overflow-hidden shrink-0">
          <IPFSMediaGallery cids={player.ipfsHash ? [player.ipfsHash] : []} />
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-white">
              {player.vitals.name}
            </h1>
            {/*
              Discovery lists come from the indexer (issue #1298); this
              profile page still reads through getPlayer's on-chain
              simulation, so surface that authority explicitly.
            */}
            <span
              data-testid="verified-on-chain"
              className="inline-flex items-center gap-1 rounded-full border border-brand-green bg-brand-green/10 px-2 py-0.5 text-xs font-medium text-brand-green"
            >
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {t('verified_on_chain')}
            </span>
          </div>
          <p className="text-gray-400 text-sm mt-1">
            {player.vitals.position} · {player.vitals.region} · Age{' '}
            {player.vitals.age}
          </p>
          <div className="mt-4">
            <ProgressBar level={player.progressLevel} />
          </div>
          <div className="mt-3">
            <AchievementBadges player={player} />
          </div>
        </div>
      </div>

      {/* Stats */}
      <PlayerStatsCard stats={player.stats} position={player.vitals.position} />

      {/* Milestones */}
      <div className="bg-brand-card border border-gray-800 rounded-xl p-6">
        <h2 className="font-semibold text-white mb-4">On-Chain Milestones</h2>
        {player.milestones.length === 0 ? (
          <p className="text-gray-400 text-sm">No milestones recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {player.milestones.map((m) => (
              <li
                key={m.id}
                className="text-sm text-gray-300 border-l-2 border-brand-green pl-3"
              >
                {m.description}
                <span
                  className="block text-xs text-gray-400 mt-0.5"
                  suppressHydrationWarning
                >
                  Validator:{' '}
                  <TruncatedAddress
                    address={m.validator}
                    className="text-gray-400"
                  />{' '}
                  · {new Date(m.timestamp * 1000).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Download milestones */}
      {player.milestones.length > 0 && (
        <button
          onClick={handleDownload}
          className="print-hidden self-start text-sm text-brand-green underline underline-offset-2 hover:opacity-80 transition"
        >
          Download Milestones
        </button>
      )}

      {/* Share via QR */}
      <button
        ref={shareButtonRef}
        onClick={() => setQrOpen(true)}
        className="print-hidden self-start text-sm text-gray-400 border border-gray-700 px-3 py-1.5 rounded-lg hover:border-gray-500 hover:text-white transition"
      >
        Share via QR
      </button>

      {/* Export CV */}
      <button
        onClick={handleExportCv}
        disabled={cvExportStatus === 'generating'}
        className="print-hidden self-start text-sm text-brand-green underline underline-offset-2 hover:opacity-80 transition disabled:opacity-50"
      >
        {cvExportStatus === 'generating' ? 'Generating CV…' : 'Export CV'}
      </button>
      {cvExportStatus === 'error' && (
        <p className="print-hidden text-xs text-red-400">
          Failed to generate CV. Please try again.
        </p>
      )}
      <QRModal
        isOpen={qrOpen}
        onClose={() => {
          setQrOpen(false);
          shareButtonRef.current?.focus();
        }}
        url={profileUrl}
      />

      {/* Pay to contact */}
      {publicKey && !isArchived && (
        <div className="print-hidden contents">
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={contacting}
            aria-label={`Pay ${displayFee} XLM to contact ${player.vitals.name}`}
            className="bg-brand-green text-black font-semibold py-3 rounded-xl hover:opacity-90 transition disabled:opacity-50"
          >
            {contacting ? (
              'Processing…'
            ) : (
              <span className="flex flex-col items-center gap-0.5">
                <span>Pay to Contact</span>
                <XlmFiatDisplay
                  xlmAmount={displayFee}
                  className="items-center"
                />
              </span>
            )}
          </button>
          {contactTxStatus && (
            <TransactionStatus
              status={contactTxStatus}
              feePaid={
                contactTxStatus === 'success' ? String(displayFee) : undefined
              }
              onHide={() => setContactTxStatus(null)}
            />
          )}
          <ConfirmDialog
            isOpen={confirmOpen}
            onConfirm={handleConfirm}
            onCancel={() => setConfirmOpen(false)}
            title="Contact Player"
            message={confirmMessage}
            confirmLabel={`Pay ${displayFee} XLM to contact`}
            cancelLabel="Cancel"
            loading={feeCheckStatus === 'checking' || contacting}
          />
          <ContactModal
            isOpen={contactModalOpen}
            onClose={() => setContactModalOpen(false)}
            playerId={id ?? ''}
          />
        </div>
      )}

      {/* Trial offer */}
      {publicKey && id && !isArchived && (
        <div className="print-hidden contents">
          {canLogTrialOffer ? (
            <div className="bg-brand-card border border-gray-800 rounded-xl p-6">
              <h2 className="font-semibold text-white mb-4">Log Trial Offer</h2>
              <TrialOfferForm playerId={id} onSuccess={refetch} />
            </div>
          ) : player.progressLevel === 3 ? (
            <div className="bg-brand-card border border-brand-green rounded-xl p-6">
              <p className="text-sm text-brand-green">
                ✓ This player is already at Elite Tier (Level 3).
              </p>
            </div>
          ) : !subscriptionLoading && !subscription ? (
            <div className="bg-brand-card border border-gray-700 rounded-xl p-6">
              <p className="text-sm text-gray-400">
                Subscribe to log trial offers and advance players to Elite Tier.
              </p>
            </div>
          ) : !subscriptionLoading && isExpired ? (
            <div className="bg-brand-card border border-gray-700 rounded-xl p-6">
              <p className="text-sm text-gray-400">
                Your subscription has expired. Renew your subscription to log
                trial offers.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
