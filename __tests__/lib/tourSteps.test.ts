import {
  findVisibleStepIndex,
  getTourSteps,
  isTourTargetVisible,
  playerTourSteps,
  scoutTourSteps,
  validatorTourSteps,
} from '@/lib/tourSteps';
import type { TourStep } from '@/hooks/useOnboardingTour';

const ids = (steps: TourStep[]) => steps.map((s) => s.id);

describe('getTourSteps', () => {
  it('returns a different step list per role', () => {
    expect(ids(getTourSteps('player'))).toEqual(ids(playerTourSteps));
    expect(ids(getTourSteps('scout'))).toEqual(ids(scoutTourSteps));
    expect(ids(getTourSteps('validator'))).toEqual(ids(validatorTourSteps));
    expect(ids(getTourSteps('player'))).not.toEqual(ids(getTourSteps('scout')));
  });

  it('swaps Navbar targets for the hamburger button on mobile', () => {
    const wallet = getTourSteps('scout', { isMobile: true }).find(
      (s) => s.id === 'scout-wallet',
    );
    expect(wallet?.targetSelector).toBe('[aria-controls="mobile-nav"]');
    const desktop = getTourSteps('scout').find((s) => s.id === 'scout-wallet');
    expect(desktop?.targetSelector).toBe('[data-tour="wallet-button"]');
  });
});

describe('findVisibleStepIndex', () => {
  const steps = [
    { id: 'a', targetSelector: '#a' },
    { id: 'b', targetSelector: '#b' },
    { id: 'c', targetSelector: '#c' },
  ] as TourStep[];

  it('skips hidden targets in the direction of travel', () => {
    const visible = (sel: string) => sel !== '#b';
    expect(findVisibleStepIndex(steps, 1, 1, visible)).toBe(2);
    expect(findVisibleStepIndex(steps, 1, -1, visible)).toBe(0);
  });

  it('returns -1 when no remaining step is visible', () => {
    expect(findVisibleStepIndex(steps, 0, 1, () => false)).toBe(-1);
  });
});

describe('isTourTargetVisible', () => {
  it('rejects missing elements and elements without layout', () => {
    expect(isTourTargetVisible(null)).toBe(false);
    const el = document.createElement('div');
    document.body.appendChild(el);
    // jsdom has no layout: offsetParent is null and the rect is empty.
    expect(isTourTargetVisible(el)).toBe(false);
    el.remove();
  });
});
