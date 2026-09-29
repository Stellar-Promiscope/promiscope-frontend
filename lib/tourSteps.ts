import type { TourStep } from '@/hooks/useOnboardingTour';

export const SCOUT_TOUR_ID = 'scout_dashboard';
export const PLAYER_TOUR_ID = 'player_dashboard';
export const VALIDATOR_TOUR_ID = 'validator_dashboard';

export type TourRole = 'player' | 'scout' | 'validator';

export const scoutTourSteps: TourStep[] = [
  {
    id: 'scout-welcome',
    title: 'Welcome to Scout Dashboard',
    description:
      'Find and evaluate players from across the world. Start by connecting your wallet and setting up your subscription.',
    targetSelector: 'h1',
    position: 'bottom',
  },
  {
    id: 'scout-wallet',
    title: 'Connect Your Wallet',
    description:
      'Your wallet securely stores your identity and subscription details. Make sure to connect it to get started.',
    targetSelector: '[data-tour="wallet-button"]',
    // The wallet button lives in the collapsed hamburger menu on mobile.
    mobileTargetSelector: '[aria-controls="mobile-nav"]',
    position: 'bottom',
  },
  {
    id: 'scout-subscription',
    title: 'Manage Your Subscription',
    description:
      'Your current subscription tier and remaining days are shown here. Renew before it expires to keep browsing.',
    targetSelector: '[data-tour="subscription-status"]',
    position: 'bottom',
  },
  {
    id: 'scout-search',
    title: 'Search Players',
    description:
      'Search by wallet address or player name to find specific scouts. Use filters to narrow down your results.',
    targetSelector: '[data-tour="search-section"]',
    position: 'bottom',
  },
  {
    id: 'scout-filter',
    title: 'Filter & Discover',
    description:
      'Use position, region, and other filters to discover players that match your criteria. You can now explore the dashboard.',
    targetSelector: '[data-tour="filter-section"]',
    position: 'top',
  },
];

export const playerTourSteps: TourStep[] = [
  {
    id: 'player-welcome',
    title: 'Welcome to Player Dashboard',
    description:
      'Showcase your achievements and build your professional profile. Start by connecting your wallet.',
    targetSelector: 'h1',
    position: 'bottom',
  },
  {
    id: 'player-wallet',
    title: 'Connect Your Wallet',
    description:
      'Your wallet is your identity on the blockchain. Connect it to register as a player and track your progress.',
    targetSelector: '[data-tour="wallet-button"]',
    // The wallet button lives in the collapsed hamburger menu on mobile.
    mobileTargetSelector: '[aria-controls="mobile-nav"]',
    position: 'bottom',
  },
  {
    id: 'player-registration',
    title: 'Register as a Player',
    description:
      'Complete your profile with your details and experience. This helps scouts discover you.',
    targetSelector: '[data-tour="registration-section"]',
    position: 'bottom',
  },
  {
    id: 'player-progress',
    title: 'Understand Progress Levels',
    description:
      'Your progress bar shows your registration status. Complete all sections to reach 100% and maximize visibility.',
    targetSelector: '[data-tour="progress-section"]',
    position: 'bottom',
  },
  {
    id: 'player-milestones',
    title: 'Track Your Milestones',
    description:
      'Record your achievements and milestones over time. This builds your credibility with scouts and teams.',
    targetSelector: '[data-tour="milestones-section"]',
    position: 'top',
  },
];

export const validatorTourSteps: TourStep[] = [
  {
    id: 'validator-welcome',
    title: 'Welcome to Validator Dashboard',
    description:
      'Review and approve player milestones submitted for verification. Start by connecting your wallet.',
    targetSelector: 'h1',
    position: 'bottom',
  },
  {
    id: 'validator-wallet',
    title: 'Connect Your Wallet',
    description:
      'Your wallet proves you are a registered validator. Approvals are signed with it.',
    targetSelector: '[data-tour="wallet-button"]',
    mobileTargetSelector: '[aria-controls="mobile-nav"]',
    position: 'bottom',
  },
  {
    id: 'validator-queue',
    title: 'Review Pending Milestones',
    description:
      'Milestones awaiting your review appear here. Check the evidence before approving or rejecting.',
    targetSelector: '[data-tour="validator-queue"]',
    position: 'top',
  },
];

const STEPS_BY_ROLE: Record<TourRole, TourStep[]> = {
  player: playerTourSteps,
  scout: scoutTourSteps,
  validator: validatorTourSteps,
};

export const TOUR_ID_BY_ROLE: Record<TourRole, string> = {
  player: PLAYER_TOUR_ID,
  scout: SCOUT_TOUR_ID,
  validator: VALIDATOR_TOUR_ID,
};

/**
 * Returns the tour steps for `role`, dropping steps behind a disabled feature
 * flag and swapping in mobile-specific targets (or dropping steps that have
 * none) when `isMobile`.
 */
export function getTourSteps(
  role: TourRole,
  {
    isMobile = false,
    flags = {},
  }: { isMobile?: boolean; flags?: Record<string, boolean> } = {},
): TourStep[] {
  return STEPS_BY_ROLE[role]
    .filter((step) => !step.flag || flags[step.flag] === true)
    .filter((step) => !isMobile || !step.desktopOnly)
    .map((step) =>
      isMobile && step.mobileTargetSelector
        ? { ...step, targetSelector: step.mobileTargetSelector }
        : step,
    );
}

/** True when `el` is rendered and takes up space in the layout. */
export function isTourTargetVisible(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  // offsetParent is null for display:none (and position:fixed elements, so
  // fall back to the bounding box for those).
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Index of the first step at or after `from` (moving in `direction`) whose
 * target is visible, or -1 when there is none.
 */
export function findVisibleStepIndex(
  steps: TourStep[],
  from: number,
  direction: 1 | -1,
  isVisible: (selector: string) => boolean,
): number {
  for (let i = from; i >= 0 && i < steps.length; i += direction) {
    if (isVisible(steps[i].targetSelector)) return i;
  }
  return -1;
}
