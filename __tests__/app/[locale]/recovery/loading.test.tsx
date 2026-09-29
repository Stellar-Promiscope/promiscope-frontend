import { render, screen } from '@testing-library/react';
import RecoveryLoading from '@/app/[locale]/recovery/loading';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    if (key === 'common.loading') return 'Loading...';
    return key;
  },
}));

describe('RecoveryLoading', () => {
  it('exposes a status live region with a localized loading label', () => {
    render(<RecoveryLoading />);

    const container = screen.getByRole('status');
    expect(container).toHaveAttribute('aria-busy', 'true');
    expect(container).toHaveAttribute('aria-label', 'Loading...');
  });

  it('renders skeleton sections matching the recovery page layout', () => {
    render(<RecoveryLoading />);

    // Page title
    const title = screen.getByRole('status').querySelector('div');
    expect(title).toBeInTheDocument();

    // Intro card and input section
    const sections = screen.getAllByRole('generic').filter(
      (el) => el.tagName === 'SECTION'
    );
    expect(sections.length).toBeGreaterThanOrEqual(2);
  });
});
