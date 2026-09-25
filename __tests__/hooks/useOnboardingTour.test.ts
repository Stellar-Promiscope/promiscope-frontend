import { renderHook, act } from '@testing-library/react';
import { useOnboardingTour, type TourStep } from '@/hooks/useOnboardingTour';

const STEPS: TourStep[] = [
  {
    id: 'step-1',
    title: 'Step One',
    description: 'First step',
    targetSelector: '[data-tour="one"]',
  },
  {
    id: 'step-2',
    title: 'Step Two',
    description: 'Second step',
    targetSelector: '[data-tour="two"]',
  },
  {
    id: 'step-3',
    title: 'Step Three',
    description: 'Third step',
    targetSelector: '[data-tour="three"]',
  },
];

const TOUR_ID = 'test-tour';
const WALLET = 'GWALLETADDRESS';

function storageKey(wallet?: string) {
  return `scout_tour_${TOUR_ID}_${wallet || 'anon'}`;
}

describe('useOnboardingTour', () => {
  // jest.setup.ts clears localStorage before each test already.

  // ── Initialization ─────────────────────────────────────────────────────

  it('shows the tour for first-time users with no stored state', () => {
    const { result } = renderHook(() =>
      useOnboardingTour(TOUR_ID, STEPS, WALLET),
    );
    expect(result.current.isVisible).toBe(true);
    expect(result.current.currentStep).toBe(0);
    expect(result.current.isDismissed).toBe(false);
    expect(result.current.isCompleted).toBe(false);
  });

  it('uses "anon" as the storage key suffix when no wallet address is provided', () => {
    localStorage.setItem(
      storageKey(undefined),
      JSON.stringify({ isDismissed: true, isCompleted: false }),
    );
    const { result } = renderHook(() => useOnboardingTour(TOUR_ID, STEPS));
    expect(result.current.isDismissed).toBe(true);
    expect(result.current.isVisible).toBe(false);
  });

  it('restores isDismissed from localStorage and keeps the tour hidden', () => {
    localStorage.setItem(
      storageKey(WALLET),
      JSON.stringify({ isDismissed: true, isCompleted: false }),
    );
    const { result } = renderHook(() =>
      useOnboardingTour(TOUR_ID, STEPS, WALLET),
    );
    expect(result.current.isDismissed).toBe(true);
    expect(result.current.isCompleted).toBe(false);
    expect(result.current.isVisible).toBe(false);
  });

  it('restores isCompleted from localStorage and keeps the tour hidden', () => {
    localStorage.setItem(
      storageKey(WALLET),
      JSON.stringify({ isDismissed: false, isCompleted: true }),
    );
    const { result } = renderHook(() =>
      useOnboardingTour(TOUR_ID, STEPS, WALLET),
    );
    expect(result.current.isCompleted).toBe(true);
    expect(result.current.isVisible).toBe(false);
  });

  it('shows the tour again when stored state has neither dismissed nor completed flags set', () => {
    localStorage.setItem(
      storageKey(WALLET),
      JSON.stringify({ isDismissed: false, isCompleted: false }),
    );
    const { result } = renderHook(() =>
      useOnboardingTour(TOUR_ID, STEPS, WALLET),
    );
    expect(result.current.isVisible).toBe(true);
  });

  it('exposes the steps array and the current step data', () => {
    const { result } = renderHook(() =>
      useOnboardingTour(TOUR_ID, STEPS, WALLET),
    );
    expect(result.current.steps).toBe(STEPS);
    expect(result.current.currentStepData).toEqual(STEPS[0]);
  });

  // ── nextStep ───────────────────────────────────────────────────────────

  it('advances to the next step', () => {
    const { result } = renderHook(() =>
      useOnboardingTour(TOUR_ID, STEPS, WALLET),
    );
    act(() => result.current.nextStep());
    expect(result.current.currentStep).toBe(1);
    expect(result.current.currentStepData).toEqual(STEPS[1]);
    expect(result.current.isCompleted).toBe(false);
    expect(result.current.isVisible).toBe(true);
  });

  it('marks the tour completed and hides it after advancing past the last step', () => {
    const { result } = renderHook(() =>
      useOnboardingTour(TOUR_ID, STEPS, WALLET),
    );
    act(() => result.current.nextStep()); // -> step 1
    act(() => result.current.nextStep()); // -> step 2 (last index)
    act(() => result.current.nextStep()); // advances past last -> completed

    expect(result.current.isCompleted).toBe(true);
    expect(result.current.isVisible).toBe(false);
    expect(result.current.currentStep).toBe(STEPS.length - 1);

    const stored = JSON.parse(localStorage.getItem(storageKey(WALLET))!);
    expect(stored.isCompleted).toBe(true);
  });

  it('does not advance currentStep past the last index even after completion', () => {
    const { result } = renderHook(() =>
      useOnboardingTour(TOUR_ID, STEPS, WALLET),
    );
    act(() => result.current.nextStep());
    act(() => result.current.nextStep());
    act(() => result.current.nextStep());
    act(() => result.current.nextStep());
    expect(result.current.currentStep).toBe(STEPS.length - 1);
  });

  // ── prevStep ───────────────────────────────────────────────────────────

  it('moves back to the previous step', () => {
    const { result } = renderHook(() =>
      useOnboardingTour(TOUR_ID, STEPS, WALLET),
    );
    act(() => result.current.nextStep());
    act(() => result.current.nextStep());
    expect(result.current.currentStep).toBe(2);
    act(() => result.current.prevStep());
    expect(result.current.currentStep).toBe(1);
  });

  it('does not move before the first step', () => {
    const { result } = renderHook(() =>
      useOnboardingTour(TOUR_ID, STEPS, WALLET),
    );
    act(() => result.current.prevStep());
    expect(result.current.currentStep).toBe(0);
  });

  // ── dismissTour / skipTour ─────────────────────────────────────────────

  it('dismisses the tour and persists the dismissed flag', () => {
    const { result } = renderHook(() =>
      useOnboardingTour(TOUR_ID, STEPS, WALLET),
    );
    act(() => result.current.dismissTour());
    expect(result.current.isDismissed).toBe(true);
    expect(result.current.isVisible).toBe(false);

    const stored = JSON.parse(localStorage.getItem(storageKey(WALLET))!);
    expect(stored.isDismissed).toBe(true);
  });

  it('skipTour behaves the same as dismissTour', () => {
    const { result } = renderHook(() =>
      useOnboardingTour(TOUR_ID, STEPS, WALLET),
    );
    act(() => result.current.skipTour());
    expect(result.current.isDismissed).toBe(true);
    expect(result.current.isVisible).toBe(false);
  });

  // ── completeTour ───────────────────────────────────────────────────────

  it('completes the tour explicitly and persists the completed flag', () => {
    const { result } = renderHook(() =>
      useOnboardingTour(TOUR_ID, STEPS, WALLET),
    );
    act(() => result.current.completeTour());
    expect(result.current.isCompleted).toBe(true);
    expect(result.current.isVisible).toBe(false);

    const stored = JSON.parse(localStorage.getItem(storageKey(WALLET))!);
    expect(stored.isCompleted).toBe(true);
  });

  // ── resetTour ──────────────────────────────────────────────────────────

  it('resets the tour: clears storage and shows it again from step 0', () => {
    const { result } = renderHook(() =>
      useOnboardingTour(TOUR_ID, STEPS, WALLET),
    );
    act(() => result.current.completeTour());
    expect(localStorage.getItem(storageKey(WALLET))).not.toBeNull();

    act(() => result.current.resetTour());

    expect(localStorage.getItem(storageKey(WALLET))).toBeNull();
    expect(result.current.currentStep).toBe(0);
    expect(result.current.isVisible).toBe(true);
    expect(result.current.isDismissed).toBe(false);
    expect(result.current.isCompleted).toBe(false);
  });

  // ── storageKey / wallet changes ────────────────────────────────────────

  it('re-derives storage per wallet: switching wallets re-initializes from that wallet key', () => {
    localStorage.setItem(
      storageKey('WALLET_A'),
      JSON.stringify({ isDismissed: true, isCompleted: false }),
    );

    const { result, rerender } = renderHook(
      ({ wallet }: { wallet?: string }) =>
        useOnboardingTour(TOUR_ID, STEPS, wallet),
      { initialProps: { wallet: 'WALLET_A' } },
    );
    expect(result.current.isDismissed).toBe(true);

    // Switching wallets re-runs the init effect against WALLET_B's storage
    // key, which has no stored entry, so the "first-time user" branch fires
    // and isVisible flips back to true. Note the hook merges into the
    // previous state object rather than resetting it, so isDismissed (set
    // while on WALLET_A) is left untouched here — that's existing hook
    // behavior, not something this test asserts is ideal.
    rerender({ wallet: 'WALLET_B' });
    expect(result.current.isVisible).toBe(true);
  });
});

describe('useOnboardingTour — progress persistence', () => {
  it('persists the current step per wallet and resumes from it', () => {
    const { result, unmount } = renderHook(() =>
      useOnboardingTour(TOUR_ID, STEPS, WALLET),
    );
    act(() => result.current.goToStep(2));
    unmount();

    const { result: resumed } = renderHook(() =>
      useOnboardingTour(TOUR_ID, STEPS, WALLET),
    );
    expect(resumed.current.currentStep).toBe(2);
    expect(resumed.current.isVisible).toBe(true);

    const { result: otherWallet } = renderHook(() =>
      useOnboardingTour(TOUR_ID, STEPS, 'GOTHERWALLET'),
    );
    expect(otherWallet.current.currentStep).toBe(0);
  });
});
