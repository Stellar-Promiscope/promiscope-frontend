import { render, screen } from '@testing-library/react';
import AdminLoading from '@/app/[locale]/admin/loading';

describe('AdminLoading', () => {
  it('renders the AdminDashboardSkeleton component', () => {
    render(<AdminLoading />);

    // AdminDashboardSkeleton has a status role
    const container = screen.getByRole('status');
    expect(container).toBeInTheDocument();
    expect(container).toHaveAttribute('aria-busy', 'true');
  });
});
