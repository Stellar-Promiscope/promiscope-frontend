'use client';
import { useEffect, useId, useState, useRef } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { TourStep } from '@/hooks/useOnboardingTour';
import { findVisibleStepIndex, isTourTargetVisible } from '@/lib/tourSteps';

function selectorIsVisible(selector: string): boolean {
  return isTourTargetVisible(document.querySelector(selector));
}

interface OnboardingTourProps {
  isVisible: boolean;
  currentStep: number;
  currentStepData?: TourStep;
  steps: TourStep[];
  onNext: () => void;
  onPrev: () => void;
  onDismiss: () => void;
  onSkip: () => void;
  onComplete: () => void;
  /** Jump to a step; used to skip steps whose target is missing or hidden. */
  onGoToStep?: (index: number) => void;
}

export default function OnboardingTour({
  isVisible,
  currentStep,
  currentStepData,
  steps,
  onNext,
  onPrev,
  onDismiss,
  onSkip,
  onComplete,
  onGoToStep,
}: OnboardingTourProps) {
  const t = useTranslations('common');
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{
    top: number;
    left: number;
  }>({ top: 0, left: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const previousStepRef = useRef(currentStep);
  // Id of the step whose target has been confirmed visible; the popover is
  // only rendered for that step so it never points at nothing.
  const [shownStepId, setShownStepId] = useState<string | null>(null);

  useEffect(() => {
    if (!isVisible || !currentStepData) return;

    const direction = currentStep < previousStepRef.current ? -1 : 1;
    previousStepRef.current = currentStep;

    if (!selectorIsVisible(currentStepData.targetSelector)) {
      setShownStepId(null);
      if (process.env.NODE_ENV !== 'production') {
        console.debug(
          `[OnboardingTour] skipping step "${currentStepData.id}": target ${currentStepData.targetSelector} is missing or hidden`,
        );
      }
      const next = findVisibleStepIndex(
        steps,
        currentStep + direction,
        direction,
        selectorIsVisible,
      );
      if (next !== -1 && onGoToStep) onGoToStep(next);
      else if (direction === 1 || !onGoToStep) onComplete();
      else {
        // Nothing visible behind us; look forward instead.
        const forward = findVisibleStepIndex(
          steps,
          currentStep + 1,
          1,
          selectorIsVisible,
        );
        if (forward !== -1) onGoToStep(forward);
        else onComplete();
      }
      return;
    }
    setShownStepId(currentStepData.id);

    const updatePosition = () => {
      const target = document.querySelector(currentStepData.targetSelector);
      if (!target) return;

      const rect = target.getBoundingClientRect();
      setTargetRect(rect);

      // Calculate tooltip position
      const gap = 12;
      const position = currentStepData.position || 'bottom';

      let top = 0;
      let left = 0;

      if (position === 'bottom') {
        top = rect.bottom + gap;
        left = rect.left + rect.width / 2;
      } else if (position === 'top') {
        top = rect.top - gap;
        left = rect.left + rect.width / 2;
      } else if (position === 'left') {
        top = rect.top + rect.height / 2;
        left = rect.left - gap;
      } else if (position === 'right') {
        top = rect.top + rect.height / 2;
        left = rect.right + gap;
      }

      setTooltipPosition({ top, left });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, currentStepData]);

  const isShown =
    isVisible && !!currentStepData && shownStepId === currentStepData.id;

  // Move focus into the popover and close it on Escape.
  useEffect(() => {
    if (!isShown) return;
    tooltipRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isShown, shownStepId, onDismiss]);

  if (!isShown || !currentStepData) return null;

  const isLastStep = currentStep === steps.length - 1;
  const isFirstStep = currentStep === 0;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/70" onClick={onSkip} />

      {/* Highlight spotlight */}
      {targetRect && (
        <div
          className="fixed z-50 border-2 border-brand-green rounded-lg pointer-events-none shadow-lg"
          style={{
            top: `${targetRect.top - 4}px`,
            left: `${targetRect.left - 4}px`,
            width: `${targetRect.width + 8}px`,
            height: `${targetRect.height + 8}px`,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.7)',
          }}
        />
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="fixed z-50 bg-brand-card border border-gray-300 dark:border-gray-700 rounded-lg shadow-2xl max-w-xs p-4 pointer-events-auto"
        style={{
          top: `${tooltipPosition.top}px`,
          left: `${tooltipPosition.left}px`,
          transform: 'translateX(-50%)',
        }}
      >
        {/* Close button */}
        <button
          onClick={onDismiss}
          className="absolute top-3 right-3 p-1 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition"
          aria-label={t('close_tour')}
        >
          <X size={16} />
        </button>

        {/* Step counter */}
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Step {currentStep + 1} of {steps.length}
        </div>

        {/* Content */}
        <h3
          id={titleId}
          className="text-sm font-semibold text-gray-900 dark:text-white mb-2"
        >
          {currentStepData.title}
        </h3>
        <p className="text-xs text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
          {currentStepData.description}
        </p>

        {/* Navigation */}
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={onPrev}
            disabled={isFirstStep}
            className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-30 transition"
            aria-label={t('previous_step')}
          >
            <ChevronLeft size={16} />
          </button>

          <button
            onClick={onSkip}
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition px-2 py-1 rounded hover:bg-gray-200/50 dark:hover:bg-gray-700/50"
          >
            Skip tour
          </button>

          <div className="flex gap-2">
            {isLastStep ? (
              <button
                onClick={onComplete}
                className="px-3 py-1.5 rounded bg-brand-green text-black text-xs font-semibold hover:opacity-90 transition"
              >
                Done
              </button>
            ) : (
              <button
                onClick={onNext}
                className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition"
                aria-label={t('next_step')}
              >
                <ChevronRight size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
