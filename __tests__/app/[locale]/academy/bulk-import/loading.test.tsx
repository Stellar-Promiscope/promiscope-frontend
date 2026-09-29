import { render, screen } from '@testing-library/react';
import BulkImportLoading from '@/app/[locale]/academy/bulk-import/loading';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    if (key === 'common.loading') return 'Loading...';
    return key;
  },
}));

describe('BulkImportLoading', () => {
  it('exposes a status live region with a localized loading label', () => {
    render(<BulkImportLoading />);

    const container = screen.getByRole('status');
    expect(container).toHaveAttribute('aria-busy', 'true');
    expect(container).toHaveAttribute('aria-label', 'Loading...');
  });

  it('renders skeleton sections matching the bulk import page layout', () => {
    render(<BulkImportLoading />);

    // Page title
    const title = screen.getByRole('status').querySelector('div');
    expect(title).toBeInTheDocument();

    // Upload section and preview table
    const sections = screen.getAllByRole('generic').filter(
      (el) => el.tagName === 'SECTION'
    );
    expect(sections.length).toBeGreaterThanOrEqual(2);
  });
});
