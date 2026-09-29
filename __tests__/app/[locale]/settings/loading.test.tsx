import { render, screen } from '@testing-library/react';
import SettingsLoading from '@/app/[locale]/settings/loading';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    if (key === 'common.loading') return 'Loading...';
    return key;
  },
}));

describe('SettingsLoading', () => {
  it('exposes a status live region with a localized loading label', () => {
    render(<SettingsLoading />);

    const container = screen.getByRole('status');
    expect(container).toHaveAttribute('aria-busy', 'true');
    expect(container).toHaveAttribute('aria-label', 'Loading...');
  });

  it('renders skeleton sections matching the settings page layout', () => {
    render(<SettingsLoading />);

    // Header section
    const header = container?.querySelector('section');
    expect(header).toBeInTheDocument();

    // Multiple sections (notification, session, export, deletion)
    const sections = screen.getAllByRole('generic').filter(
      (el) => el.tagName === 'SECTION'
    );
    expect(sections.length).toBeGreaterThanOrEqual(4);
  });
});
