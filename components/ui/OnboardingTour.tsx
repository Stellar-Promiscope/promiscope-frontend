'use client';
import { useEffect, useState, useRef } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { TourStep } from '@/hooks/useOnboardingTour';

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
}: OnboardingTourProps) {
  const t = useTranslations('common');
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{
    top: number;
    left: number;
  }>({ top: 0, left: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isVisible || !currentStepData) return;

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
  }, [isVisible, currentStepData]);

  if (!isVisible || !currentStepData) return null;

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
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
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
