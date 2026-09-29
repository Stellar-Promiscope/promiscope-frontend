import { render, screen } from '@testing-library/react';
import AcademyRosterLoading from '@/app/[locale]/academy/roster/loading';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    if (key === 'common.loading') return 'Loading...';
    return key;
  },
}));

describe('AcademyRosterLoading', () => {
  it('exposes a status live region with a localized loading label', () => {
    render(<AcademyRosterLoading />);

    const container = screen.getByRole('status');
    expect(container).toHaveAttribute('aria-busy', 'true');
    expect(container).toHaveAttribute('aria-label', 'Loading...');
  });

  it('renders skeleton sections matching the academy roster page layout', () => {
    render(<AcademyRosterLoading />);

    // Page title
    const title = screen.getByRole('status').querySelector('div');
    expect(title).toBeInTheDocument();

    // Academy selector and members list
    const sections = screen.getAllByRole('generic').filter(
      (el) => el.tagName === 'SECTION'
    );
    expect(sections.length).toBeGreaterThanOrEqual(2);
  });
});
