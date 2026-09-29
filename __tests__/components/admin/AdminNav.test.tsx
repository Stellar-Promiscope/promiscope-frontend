import { render, screen } from '@testing-library/react';
import AdminNav, { ADMIN_SECTIONS } from '@/components/admin/AdminNav';

let mockPathname = '/en/admin';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

describe('AdminNav (#1354)', () => {
  it('links every admin section to its own deep-linkable route', () => {
    render(<AdminNav />);
    for (const { href, label } of ADMIN_SECTIONS) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute(
        'href',
        href,
      );
    }
    // The pre-existing health page URL stays stable.
    expect(screen.getByRole('link', { name: 'Health' })).toHaveAttribute(
      'href',
      '/admin/health',
    );
  });

  it('marks only the current section as active, ignoring the locale prefix', () => {
    mockPathname = '/fr/admin/fees';
    render(<AdminNav />);
    expect(screen.getByRole('link', { name: 'Fees' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('marks the overview active on /admin', () => {
    mockPathname = '/en/admin';
    render(<AdminNav />);
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
