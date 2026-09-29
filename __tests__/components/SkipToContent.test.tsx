import React from 'react';
import { render, screen } from '@testing-library/react';
import SkipToContent from '@/components/SkipToContent';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) =>
    key === 'skipToContent' ? 'Skip to main content' : key,
}));

describe('SkipToContent', () => {
  it('is visually hidden by default and becomes visible on focus', () => {
    render(<SkipToContent />);

    const link = screen.getByRole('link', { name: 'Skip to main content' });

    expect(link).toHaveClass('sr-only');
    expect(link.className).toEqual(
      expect.stringContaining('focus:not-sr-only'),
    );
  });

  it('is focusable via keyboard', () => {
    render(<SkipToContent />);

    const link = screen.getByRole('link', { name: 'Skip to main content' });
    link.focus();

    expect(link).toHaveFocus();
  });

  it('defaults its href to #main-content', () => {
    render(<SkipToContent />);

    expect(
      screen.getByRole('link', { name: 'Skip to main content' }),
    ).toHaveAttribute('href', '#main-content');
  });

  it('uses the targetId prop for its href when provided', () => {
    render(<SkipToContent targetId="page-content" />);

    expect(
      screen.getByRole('link', { name: 'Skip to main content' }),
    ).toHaveAttribute('href', '#page-content');
  });
});
