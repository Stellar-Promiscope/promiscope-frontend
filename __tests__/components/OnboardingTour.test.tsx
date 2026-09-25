import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import OnboardingTour from '@/components/ui/OnboardingTour';
import type { TourStep } from '@/hooks/useOnboardingTour';

jest.mock('@/lib/tourSteps', () => {
  const actual = jest.requireActual('@/lib/tourSteps');
  return {
    ...actual,
    // jsdom has no layout, so decide visibility by a data attribute.
    isTourTargetVisible: (el: Element | null) =>
      !!el && el.getAttribute('data-hidden') !== 'true',
  };
});

const STEPS: TourStep[] = [
  { id: 's1', title: 'One', description: 'd1', targetSelector: '#one' },
  { id: 's2', title: 'Two', description: 'd2', targetSelector: '#two' },
  { id: 's3', title: 'Three', description: 'd3', targetSelector: '#three' },
];

function renderTour(currentStep: number, extra = {}) {
  const props = {
    isVisible: true,
    currentStep,
    currentStepData: STEPS[currentStep],
    steps: STEPS,
    onNext: jest.fn(),
    onPrev: jest.fn(),
    onDismiss: jest.fn(),
    onSkip: jest.fn(),
    onComplete: jest.fn(),
    onGoToStep: jest.fn(),
    ...extra,
  };
  render(
    <>
      <div id="one" />
      <div id="three" />
      <div id="two" data-hidden="true" />
      <OnboardingTour {...props} />
    </>,
  );
  return props;
}

describe('OnboardingTour', () => {
  it('shows the popover as a labelled dialog when the target is visible', () => {
    renderTour(0);
    expect(screen.getByRole('dialog', { name: 'One' })).toHaveFocus();
  });

  it('skips a step whose target is hidden and never shows it', () => {
    const props = renderTour(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(props.onGoToStep).toHaveBeenCalledWith(2);
  });

  it('completes the tour when no later step has a visible target', () => {
    const props = renderTour(1, {
      steps: STEPS.slice(0, 2),
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(props.onComplete).toHaveBeenCalled();
  });

  it('dismisses on Escape', () => {
    const props = renderTour(0);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onDismiss).toHaveBeenCalled();
  });
});
