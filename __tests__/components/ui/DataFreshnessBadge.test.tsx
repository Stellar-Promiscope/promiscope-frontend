import { render, screen } from '@testing-library/react';
import DataFreshnessBadge from '@/components/ui/DataFreshnessBadge';
import { useIndexerFreshness } from '@/hooks/useIndexerFreshness';

jest.mock('@/hooks/useIndexerFreshness', () => ({
  useIndexerFreshness: jest.fn(),
}));
const mockHook = useIndexerFreshness as jest.Mock;

const base = { error: undefined, isLoading: false };

describe('DataFreshnessBadge', () => {
  test('renders nothing before freshness data is available', () => {
    mockHook.mockReturnValue({
      ...base,
      data: undefined,
      stale: false,
      pendingWrite: false,
    });
    const { container } = render(<DataFreshnessBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  test('shows relative update time with a status role', () => {
    mockHook.mockReturnValue({
      ...base,
      data: {
        lastLedger: 10,
        lastUpdated: Date.now() - 3 * 60_000,
        ledgerLag: 0,
      },
      stale: false,
      pendingWrite: false,
    });
    render(<DataFreshnessBadge />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Updated 3 minutes ago');
    expect(badge).toHaveAttribute('data-stale', 'false');
  });

  test('uses the warning state when stale', () => {
    mockHook.mockReturnValue({
      ...base,
      data: {
        lastLedger: 10,
        lastUpdated: Date.now() - 10 * 60_000,
        ledgerLag: 0,
      },
      stale: true,
      pendingWrite: false,
    });
    render(<DataFreshnessBadge />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveAttribute('data-stale', 'true');
    expect(badge).toHaveTextContent('data may be out of date');
    expect(badge.className).toContain('text-yellow-400');
  });

  test('shows the post-write hint while a write is pending', () => {
    mockHook.mockReturnValue({
      ...base,
      data: { lastLedger: 10, lastUpdated: Date.now(), ledgerLag: 0 },
      stale: false,
      pendingWrite: true,
    });
    render(<DataFreshnessBadge />);
    expect(
      screen.getByText('Your change may take up to a minute to appear'),
    ).toBeInTheDocument();
  });
});
