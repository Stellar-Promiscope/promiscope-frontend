import { render, screen, fireEvent, act } from '@testing-library/react';
import ContractPausedBanner from '@/components/ContractPausedBanner';

// Required by next/link — the banner renders an internal /<locale>/status link.
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

// usePathname from next/navigation is read by the banner to derive locale.
jest.mock('next/navigation', () => ({
  usePathname: () => '/en/player',
}));

const mockUseIsPaused = jest.fn();

jest.mock('@/hooks/useIsPaused', () => ({
  __esModule: true,
  default: () => mockUseIsPaused(),
}));

describe('ContractPausedBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    mockUseIsPaused.mockReturnValue(false);
  });

  test('renders nothing while contract is not paused', () => {
    mockUseIsPaused.mockReturnValue(false);
    const { container } = render(<ContractPausedBanner />);
    expect(container.firstChild).not.toBeNull();
    // Wrapper exists but its visible children are emptied.
    expect(screen.queryByText(/under maintenance/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
  });

  test('renders the maintenance banner when paused and not dismissed', () => {
    mockUseIsPaused.mockReturnValue(true);
    render(<ContractPausedBanner />);

    expect(
      screen.getByText(/Promiscope is currently under maintenance/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /dismiss/i }),
    ).toBeInTheDocument();
    // The external Discord link survives.
    expect(screen.getByRole('link', { name: /discord/i })).toHaveAttribute(
      'href',
      'https://discord.gg/stellar',
    );
  });

  test('dismiss button writes sessionStorage and hides the banner immediately', () => {
    mockUseIsPaused.mockReturnValue(true);
    render(<ContractPausedBanner />);

    const dismiss = screen.getByRole('button', { name: /dismiss/i });
    act(() => {
      fireEvent.click(dismiss);
    });

    expect(sessionStorage.getItem('promiscope:contractPausedDismissed')).toBe(
      '1',
    );
    expect(screen.queryByText(/under maintenance/i)).toBeNull();
  });

  test('banner stays hidden on remount while still paused + dismissed', () => {
    mockUseIsPaused.mockReturnValue(true);
    sessionStorage.setItem('promiscope:contractPausedDismissed', '1');

    render(<ContractPausedBanner />);
    expect(screen.queryByText(/under maintenance/i)).toBeNull();
  });

  test('clearing sessionStorage flag (when contract un-pauses) restores visibility', () => {
    mockUseIsPaused.mockReturnValue(true);
    sessionStorage.setItem('promiscope:contractPausedDismissed', '1');

    const { rerender } = render(<ContractPausedBanner />);
    expect(screen.queryByText(/under maintenance/i)).toBeNull();

    // Simulate contract un-pausing: the effect clears the session flag.
    mockUseIsPaused.mockReturnValue(false);
    rerender(<ContractPausedBanner />);

    // Now re-pause should NOT inherit a stale "dismissed" state.
    mockUseIsPaused.mockReturnValue(true);
    rerender(<ContractPausedBanner />);
    expect(
      sessionStorage.getItem('promiscope:contractPausedDismissed'),
    ).toBeNull();
    expect(
      screen.getByText(/Promiscope is currently under maintenance/i),
    ).toBeInTheDocument();
  });

  test('locale-aware status link uses the active locale from pathname', () => {
    mockUseIsPaused.mockReturnValue(true);
    render(<ContractPausedBanner />);

    const statusLink = screen.getByRole('link', { name: /check status/i });
    expect(statusLink.getAttribute('href')).toBe('/en/status');
  });
});
