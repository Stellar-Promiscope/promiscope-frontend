import React from 'react';
import { useTranslations } from 'next-intl';

type SpinnerSize = 'sm' | 'md' | 'lg';

export const SPINNER_SIZE_PIXEL_MAP = {
  sm: 16,
  md: 24,
  lg: 40,
} as const;

const BASE_CLASSES = 'inline-flex items-center justify-center rounded-full';

const SIZE_CLASSES: Record<SpinnerSize, string> = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-10 h-10',
};

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
  className?: string;
  /** Overrides the translated "Loading" label. */
  loadingLabel?: string;
}

export default function Spinner({
  size = 'md',
  className,
  loadingLabel,
  ...rest
}: SpinnerProps) {
  const t = useTranslations('common');
  const label = loadingLabel ?? t('loading_status');
  const classes = [className, BASE_CLASSES, SIZE_CLASSES[size]]
    .filter(Boolean)
    .join(' ');

  return (
    <span role="status" aria-label={label} className={classes} {...rest}>
      <svg
        data-testid="spinner-svg"
        className="h-full w-full animate-spin text-current"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
