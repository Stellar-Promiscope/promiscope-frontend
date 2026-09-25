'use client';
import { useState, useCallback, useEffect, useMemo } from 'react';
import type React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRequireWallet } from '@/hooks/useRequireWallet';
import { usePlayer } from '@/hooks/usePlayer';
import { useMilestoneHistory } from '@/hooks/useMilestoneHistory';
import { useMilestoneDisputes } from '@/hooks/useMilestoneDisputes';
import { useOnboardingTour } from '@/hooks/useOnboardingTour';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { buildExportPayload, downloadExportPayload } from '@/lib/dataExport';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import ProgressBar from '@/components/ProgressBar';
import AchievementBadges from '@/components/player/AchievementBadges';
import PlayerProfileForm from '@/components/player/PlayerProfileForm';
import UpdateProfileForm from '@/components/player/UpdateProfileForm';
import MilestoneTimeline from '@/components/player/MilestoneTimeline';
import DisputeMilestoneModal from '@/components/player/DisputeMilestoneModal';
import ArchiveProfileModal from '@/components/player/ArchiveProfileModal';
import BackupWalletModal from '@/components/player/BackupWalletModal';
import OfflineQueueBanner from '@/components/player/OfflineQueueBanner';
import OnboardingTour from '@/components/ui/OnboardingTour';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import { getTourSteps, PLAYER_TOUR_ID } from '@/lib/tourSteps';
import { useIsMobile } from '@/hooks/useIsMobile';
import { getEarnedBadgeIds, BADGE_DEFINITIONS } from '@/lib/badges';
import type { Milestone, Player, PlayerVitals } from '@/types';
import PullToRefresh from '@/components/ui/PullToRefresh';
import Spinner from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

const SEEN_BADGES_STORAGE_PREFIX = 'scoutoff_seen_badges_';

type TabId = 'register' | 'profile';

const TABS: { id: TabId; labelKey: string }[] = [
  { id: 'register', labelKey: 'tab_register' },
  { id: 'profile', labelKey: 'tab_profile' },
] as const;

function PlayerDashboardContent() {
  const { walletAddress: publicKey } = useRequireWallet();
  const { player, loading, isValidating, refetch, optimisticUpdate } =
    usePlayer(publicKey);
  const { milestones } = useMilestoneHistory(player?.id ?? null);
  const { disputes, file: fileDispute } = useMilestoneDisputes(publicKey);
  const [disputeTarget, setDisputeTarget] = useState<Milestone | null>(null);
  const t = useTranslations('player_dashboard');
  const router = useRouter();
  const { show: showToast } = useToast();

  const offlineQueue = useOfflineQueue();

  const isMobile = useIsMobile();
  const tourSteps = useMemo(
    () => getTourSteps('player', { isMobile }),
    [isMobile],
  );
  const tour = useOnboardingTour(
    PLAYER_TOUR_ID,
    tourSteps,
    publicKey ?? undefined,
  );

  const [successPlayerId, setSuccessPlayerId] = useState<string | null>(null);
  const [redirectCountdown, setRedirectCountdown] = useState(3);
  const [copyFeedback, setCopyFeedback] = useState<string>('');

  /** True while we're waiting for on-chain confirmation of a just-registered profile */
  const [isPendingConfirmation, setIsPendingConfirmation] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showBackupWalletModal, setShowBackupWalletModal] = useState(false);
  const [showDataExportSuccess, setShowDataExportSuccess] = useState(false);
  const [cvExportStatus, setCvExportStatus] = useState<
    'idle' | 'generating' | 'error'
  >('idle');

  const isRegistered = !!player;
  const dataExportEnabled = isFeatureEnabled('DATA_EXPORT');

  const [activeTab, setActiveTab] = useState<TabId>(
    isRegistered ? 'profile' : 'register',
  );

  const handleDownloadData = useCallback(async () => {
    if (!player) return;

    try {
      const payload = buildExportPayload(player, milestones);
      downloadExportPayload(payload);
      setShowDataExportSuccess(true);
      window.setTimeout(() => setShowDataExportSuccess(false), 3000);
    } catch {
      // Download failed silently — the user can try again
    }
  }, [player, milestones]);

  const handleExportCv = useCallback(async () => {
    if (!player) return;

    setCvExportStatus('generating');
    try {
      const {
        generatePlayerCvPdf,
        downloadPlayerCvPdf,
        CV_EXPORT_LARGE_MILESTONE_WARNING_THRESHOLD,
      } = await import('@/lib/cvExport');
      if (milestones.length > CV_EXPORT_LARGE_MILESTONE_WARNING_THRESHOLD) {
        showToast({
          message: `Your CV includes ${milestones.length} milestones and may take a moment to generate.`,
          variant: 'info',
        });
      }
      const bytes = await generatePlayerCvPdf(player, milestones);
      downloadPlayerCvPdf(bytes, player.vitals.name);
      setCvExportStatus('idle');
    } catch {
      setCvExportStatus('error');
      window.setTimeout(() => setCvExportStatus('idle'), 3000);
    }
  }, [player, milestones, showToast]);

  useEffect(() => {
    if (!loading) {
      setActiveTab(isRegistered ? 'profile' : 'register');
    }
  }, [loading, isRegistered]);

  /**
   * Toasts newly-earned achievement badges on the player's own dashboard.
   * The first time a wallet is seen, its currently-earned badges are
   * recorded silently (no toast) so returning players aren't flooded with
   * toasts for milestones they earned long before this feature shipped —
   * only badges earned after that baseline trigger a toast.
   */
  useEffect(() => {
    if (!player || !publicKey) return;

    const storageKey = `${SEEN_BADGES_STORAGE_PREFIX}${publicKey}`;
    const earnedIds = getEarnedBadgeIds(player);

    let seenIds: string[] = [];
    let hasStoredState = false;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        hasStoredState = true;
        seenIds = JSON.parse(stored);
      }
    } catch {
      return; // localStorage unavailable (e.g. private browsing) — skip
    }

    const newlyEarned = hasStoredState
      ? earnedIds.filter((id) => !seenIds.includes(id))
      : [];

    newlyEarned.forEach((id) => {
      showToast({
        message: `New badge earned: ${BADGE_DEFINITIONS[id].label}`,
        variant: 'success',
      });
    });

    if (!hasStoredState || newlyEarned.length > 0) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(earnedIds));
      } catch {
        // ignore write failures
      }
    }
  }, [player, publicKey, showToast]);

  useEffect(() => {
    if (!successPlayerId) return;

    setRedirectCountdown(3);
    const intervalId = window.setInterval(() => {
      setRedirectCountdown((current) => current - 1);
    }, 1000);
    const timerId = window.setTimeout(() => {
      router.push(`/player/${successPlayerId}`);
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timerId);
    };
  }, [router, successPlayerId]);

  const handleCopyPlayerId = useCallback(async () => {
    if (!successPlayerId) return;

    try {
      await navigator.clipboard.writeText(successPlayerId);
      setCopyFeedback('Copied');
      window.setTimeout(() => setCopyFeedback(''), 1500);
    } catch {
      setCopyFeedback('Unable to copy');
    }
  }, [successPlayerId]);

  const handleViewProfile = useCallback(() => {
    if (!successPlayerId) return;
    router.push(`/player/${successPlayerId}`);
  }, [router, successPlayerId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const idx = TABS.findIndex((t) => t.id === activeTab);
      let nextIndex = idx;
      if (e.key === 'ArrowRight') {
        nextIndex = (idx + 1) % TABS.length;
      } else if (e.key === 'ArrowLeft') {
        nextIndex = (idx - 1 + TABS.length) % TABS.length;
      }
      if (nextIndex !== idx) {
        e.preventDefault();
        setActiveTab(TABS[nextIndex].id);
      }
    },
    [activeTab],
  );

  /**
   * Called by PlayerProfileForm when registerPlayer resolves.
   * 1. Immediately populate the SWR cache with the submitted vitals (optimistic).
   * 2. Switch to the profile tab so the user sees their data right away.
   * 3. Trigger a background re-fetch; replace optimistic data with confirmed data.
   * 4. On error, discard optimistic data and show the register tab again.
   */
  const handleRegistrationSuccess = useCallback(
    async ({
      playerId,
      vitals,
      ipfsHash,
    }: {
      playerId: string;
      vitals: PlayerVitals;
      ipfsHash: string;
    }) => {
      if (!publicKey) return;

      // Build a minimal optimistic Player from the submitted form data
      const optimisticPlayer: Player = {
        id: playerId,
        wallet: publicKey,
        vitals,
        ipfsHash,
        progressLevel: 0,
        milestones: [],
        createdAt: Math.floor(Date.now() / 1000),
      };

      // 1. Show optimistic data immediately
      optimisticUpdate(optimisticPlayer);
      setSuccessPlayerId(playerId);
      setCopyFeedback('');
      setIsPendingConfirmation(true);
      setActiveTab('profile');

      // 2. Re-fetch confirmed on-chain data in the background
      try {
        await refetch();
      } catch {
        setSuccessPlayerId(null);
        // On error, discard the optimistic state so the user is not left with stale data
        refetch({ discardOptimistic: true }).catch(() => {});
        setActiveTab('register');
      } finally {
        setIsPendingConfirmation(false);
      }
    },
    [publicKey, optimisticUpdate, refetch],
  );

  if (!publicKey) {
    return null; // Redirect handled by useRequireWallet
  }

  if (loading) {
    return <p className="text-center text-gray-400 mt-20">LoadingΓÇª</p>;
  }

  return (
    <PullToRefresh onRefresh={refetch} isLoading={isValidating}>
      <OnboardingTour
        isVisible={tour.isVisible}
        currentStep={tour.currentStep}
        currentStepData={tour.currentStepData}
        steps={tour.steps}
        onNext={tour.nextStep}
        onPrev={tour.prevStep}
        onDismiss={tour.dismissTour}
        onSkip={tour.skipTour}
        onComplete={tour.completeTour}
        onGoToStep={tour.goToStep}
      />
      <div className="max-w-2xl mx-auto flex flex-col gap-8">
        <h1 className="text-3xl font-bold text-white">{t('title')}</h1>

        <div
          role="tablist"
          aria-label={t('title')}
          className="flex border-b border-gray-800"
        >
          {TABS.map((tab) => {
            const isDisabled = !isRegistered && tab.id === 'profile';
            return (
              <button
                key={tab.id}
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={activeTab === tab.id}
                aria-controls={`tabpanel-${tab.id}`}
                aria-disabled={isDisabled}
                tabIndex={activeTab === tab.id ? 0 : -1}
                disabled={isDisabled}
                onKeyDown={handleKeyDown}
                onClick={() => setActiveTab(tab.id)}
                className={[
                  'px-6 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-inset',
                  activeTab === tab.id
                    ? 'text-brand-green border-b-2 border-brand-green'
                    : isDisabled
                      ? 'text-gray-600 cursor-not-allowed'
                      : 'text-gray-400 hover:text-gray-200 border-b-2 border-transparent',
                ].join(' ')}
              >
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id="tabpanel-register"
          aria-labelledby="tab-register"
          hidden={activeTab !== 'register'}
          data-tour="registration-section"
        >
          {activeTab === 'register' && (
            <div className="bg-brand-card border border-gray-800 rounded-xl p-6">
              <h2 className="text-xl font-semibold text-white mb-6">
                Create Your Profile
              </h2>
              <PlayerProfileForm onSuccess={handleRegistrationSuccess} />
            </div>
          )}
        </div>

        <div
          role="tabpanel"
          id="tabpanel-profile"
          aria-labelledby="tab-profile"
          hidden={activeTab !== 'profile'}
        >
          {activeTab === 'profile' && isRegistered ? (
            <>
              {/* Pending-confirmation banner */}
              {/* Offline queue banner */}
              <OfflineQueueBanner
                pendingCount={offlineQueue.pendingCount}
                isProcessing={offlineQueue.status === 'processing'}
                onRetry={offlineQueue.processAll}
                failedActions={offlineQueue.failedActions}
                onDiscardFailed={offlineQueue.discardFailed}
                onDiscardAllFailed={offlineQueue.discardAllFailed}
              />

              {isPendingConfirmation && (
                <div
                  role="status"
                  aria-live="polite"
                  data-testid="pending-confirmation"
                  className="flex items-center gap-2 rounded-xl border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300"
                >
                  <Spinner size="sm" aria-hidden="true" />
                  <span>
                    Confirming on-chainΓÇª This may take a few seconds.
                  </span>
                </div>
              )}

              {successPlayerId && (
                <div
                  role="status"
                  aria-live="polite"
                  className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100"
                >
                  <div className="flex flex-col gap-3">
                    <p className="font-semibold text-white">
                      Registration complete! Redirecting to your profile in{' '}
                      {redirectCountdown > 0 ? redirectCountdown : 0} seconds.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-gray-300">
                        Player ID:{' '}
                        <span className="font-mono text-white">
                          {successPlayerId}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyPlayerId}
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/20"
                      >
                        {copyFeedback || 'Copy player ID'}
                      </button>
                      <button
                        type="button"
                        onClick={handleViewProfile}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white hover:bg-white/10"
                      >
                        View profile
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-brand-card border border-gray-800 rounded-xl p-6 flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl font-semibold text-white">
                    {player.vitals.name}
                  </h2>
                  <div className="flex items-center gap-2">
                    {player.archived && (
                      <span className="inline-flex items-center rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-1 text-xs font-medium text-yellow-300">
                        Archived
                      </span>
                    )}
                    {isPendingConfirmation && (
                      <span
                        aria-hidden="true"
                        className="inline-flex items-center gap-1.5 rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-1 text-xs font-medium text-yellow-300"
                      >
                        <Spinner size="sm" aria-hidden="true" />
                        Pending
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-gray-400 text-sm">
                  {player.vitals.position} ┬╖ {player.vitals.region}
                </p>
                <div data-tour="progress-section">
                  <ProgressBar level={player.progressLevel} />
                </div>
                <AchievementBadges player={player} />

                {/* Settings actions */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    onClick={() => setShowArchiveModal(true)}
                    className="text-xs text-gray-400 hover:text-gray-300 transition px-2 py-1.5 rounded hover:bg-gray-800/50"
                  >
                    {player.archived ? 'Restore profile' : 'Archive profile'}
                  </button>
                  <button
                    onClick={() => setShowBackupWalletModal(true)}
                    className="text-xs text-gray-400 hover:text-gray-300 transition px-2 py-1.5 rounded hover:bg-gray-800/50"
                  >
                    Recovery settings
                  </button>

                  {/* Export CV */}
                  <button
                    onClick={handleExportCv}
                    disabled={cvExportStatus === 'generating'}
                    className="text-xs text-gray-400 hover:text-brand-green transition px-2 py-1.5 rounded hover:bg-gray-800/50 flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 11l5 5 5-5M12 3v13"
                      />
                    </svg>
                    {cvExportStatus === 'generating'
                      ? 'Generating…'
                      : 'Export CV'}
                  </button>

                  {/* Download my data (behind feature flag) */}
                  {dataExportEnabled && (
                    <button
                      onClick={handleDownloadData}
                      className="text-xs text-gray-400 hover:text-brand-green transition px-2 py-1.5 rounded hover:bg-gray-800/50 flex items-center gap-1.5"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 11l5 5 5-5M12 3v13"
                        />
                      </svg>
                      {t('download_data')}
                    </button>
                  )}
                </div>

                {/* CV export error feedback */}
                {cvExportStatus === 'error' && (
                  <p
                    role="status"
                    aria-live="polite"
                    className="text-xs text-red-400"
                  >
                    Failed to generate CV. Please try again.
                  </p>
                )}

                {/* Download success feedback */}
                {showDataExportSuccess && (
                  <p
                    role="status"
                    aria-live="polite"
                    className="text-xs text-emerald-400"
                  >
                    {t('download_data_success')}
                  </p>
                )}
              </div>

              <div
                className="bg-brand-card border border-gray-800 rounded-xl p-6"
                data-tour="milestones-section"
              >
                <h3 className="font-semibold text-white mb-6">
                  {t('milestones')}
                </h3>
                <MilestoneTimeline
                  milestones={player.milestones}
                  currentLevel={player.progressLevel}
                  disputes={disputes}
                  onDisputeMilestone={setDisputeTarget}
                  playerId={player.id}
                />
              </div>

              <UpdateProfileForm player={player} onSuccess={refetch} />
            </>
          ) : activeTab === 'profile' ? (
            <div className="bg-brand-card border border-gray-800 rounded-xl p-6 text-center">
              <p className="text-gray-400">{t('register_prompt')}</p>
            </div>
          ) : null}
        </div>

        {isRegistered && player && (
          <>
            <ArchiveProfileModal
              player={player}
              isOpen={showArchiveModal}
              onClose={() => setShowArchiveModal(false)}
              onSuccess={(updated) => {
                optimisticUpdate(updated);
                refetch();
              }}
            />

            <BackupWalletModal
              player={player}
              isOpen={showBackupWalletModal}
              onClose={() => setShowBackupWalletModal(false)}
              onSuccess={(updated) => {
                optimisticUpdate(updated);
                refetch();
              }}
            />

            <DisputeMilestoneModal
              isOpen={disputeTarget !== null}
              onClose={() => setDisputeTarget(null)}
              milestoneDescription={disputeTarget?.description ?? ''}
              onSubmit={async (reason) => {
                if (!disputeTarget) return;
                await fileDispute({
                  playerId: player.id,
                  milestoneId: disputeTarget.id,
                  milestoneDescription: disputeTarget.description,
                  reason,
                });
              }}
            />
          </>
        )}
      </div>
    </PullToRefresh>
  );
}

export default function PlayerDashboard() {
  return (
    <ErrorBoundary>
      <PlayerDashboardContent />
    </ErrorBoundary>
  );
}
