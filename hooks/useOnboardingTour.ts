import { useState, useEffect, useCallback } from 'react';

export interface TourStep {
  id: string;
  title: string;
  description: string;
  targetSelector: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** Selector used instead of `targetSelector` on narrow viewports. */
  mobileTargetSelector?: string;
  /** Omit the step on narrow viewports. */
  desktopOnly?: boolean;
  /** Only include the step when this feature flag is enabled. */
  flag?: string;
}

interface TourState {
  currentStep: number;
  isVisible: boolean;
  isDismissed: boolean;
  isCompleted: boolean;
}

const STORAGE_PREFIX = 'scout_tour_';

export function useOnboardingTour(
  tourId: string,
  steps: TourStep[],
  walletAddress?: string,
) {
  const [state, setState] = useState<TourState>({
    currentStep: 0,
    isVisible: false,
    isDismissed: false,
    isCompleted: false,
  });

  const storageKey = `${STORAGE_PREFIX}${tourId}_${walletAddress || 'anon'}`;

  // Initialize tour state from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      const savedStep =
        typeof parsed.currentStep === 'number'
          ? Math.min(Math.max(parsed.currentStep, 0), steps.length - 1)
          : 0;
      if (parsed.isDismissed || parsed.isCompleted) {
        setState((prev) => ({
          ...prev,
          isDismissed: parsed.isDismissed,
          isCompleted: parsed.isCompleted,
        }));
      } else {
        // Resume where this wallet left off rather than restarting.
        setState((prev) => ({
          ...prev,
          currentStep: savedStep,
          isVisible: true,
        }));
      }
    } else {
      // Show tour for first-time users
      setState((prev) => ({ ...prev, isVisible: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const saveTourState = useCallback(
    (newState: TourState) => {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          isDismissed: newState.isDismissed,
          isCompleted: newState.isCompleted,
          currentStep: newState.currentStep,
        }),
      );
    },
    [storageKey],
  );

  const nextStep = useCallback(() => {
    setState((prev) => {
      const newStep = prev.currentStep + 1;
      const newState = {
        ...prev,
        currentStep: Math.min(newStep, steps.length - 1),
      };

      if (newStep >= steps.length) {
        newState.isCompleted = true;
        newState.isVisible = false;
      }
      saveTourState(newState);

      return newState;
    });
  }, [steps.length, saveTourState]);

  const prevStep = useCallback(() => {
    setState((prev) => {
      const newState = {
        ...prev,
        currentStep: Math.max(prev.currentStep - 1, 0),
      };
      saveTourState(newState);
      return newState;
    });
  }, [saveTourState]);

  /** Jump directly to `index` (used to skip steps whose target is hidden). */
  const goToStep = useCallback(
    (index: number) => {
      setState((prev) => {
        const newState = {
          ...prev,
          currentStep: Math.min(Math.max(index, 0), steps.length - 1),
        };
        saveTourState(newState);
        return newState;
      });
    },
    [steps.length, saveTourState],
  );

  const dismissTour = useCallback(() => {
    setState((prev) => {
      const newState = {
        ...prev,
        isDismissed: true,
        isVisible: false,
      };
      saveTourState(newState);
      return newState;
    });
  }, [saveTourState]);

  const skipTour = useCallback(() => {
    dismissTour();
  }, [dismissTour]);

  const completeTour = useCallback(() => {
    setState((prev) => {
      const newState = {
        ...prev,
        isCompleted: true,
        isVisible: false,
      };
      saveTourState(newState);
      return newState;
    });
  }, [saveTourState]);

  const resetTour = useCallback(() => {
    localStorage.removeItem(storageKey);
    setState({
      currentStep: 0,
      isVisible: true,
      isDismissed: false,
      isCompleted: false,
    });
  }, [storageKey]);

  const currentStepData = steps[state.currentStep];

  return {
    ...state,
    currentStep: state.currentStep,
    currentStepData,
    steps,
    nextStep,
    prevStep,
    goToStep,
    dismissTour,
    skipTour,
    completeTour,
    resetTour,
  };
}
