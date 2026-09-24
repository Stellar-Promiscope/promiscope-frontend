import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let mockSearchParam: string | null = null;

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'reason' ? mockSearchParam : null),
    toString: () => '',
  }),
}));

jest.mock('@/hooks/useSubscription', () => ({
  useSubscription: jest.fn(),
}));

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({
    publicKey: 'GABC1234567890ABCDE1234567890ABCDE1234567890ABCDE123456',
  }),
}));

jest.mock('@/components/ui/ErrorBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: jest.fn() }),
}));

import ScoutSubscribePage from '@/app/[locale]/scout/subscribe/page';
import { useSubscription } from '@/hooks/useSubscription';

const mockUseSubscription = useSubscription as jest.Mock;

const FUTURE = Math.floor(Date.now() / 1000) + 86_400 * 30;
const PAST = Math.floor(Date.now() / 1000) - 86_400;

function noSub() {
  mockUseSubscription.mockReturnValue({
    subscription: null,
    isExpired: false,
    subscribe: jest.fn(),
    loading: false,
    error: null,
  });
}

function activeSub(tier = 'basic', expiresAt = FUTURE) {
  mockUseSubscription.mockReturnValue({
    subscription: { scout: 'GABC', tier, expiresAt },
    isExpired: false,
    subscribe: jest.fn(),
    loading: false,
    error: null,
  });
}

function expiredSub(tier = 'basic') {
  mockUseSubscription.mockReturnValue({
    subscription: { scout: 'GABC', tier, expiresAt: PAST },
    isExpired: true,
    subscribe: jest.fn(),
    loading: false,
    error: null,
  });
}

describe('ScoutSubscribePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParam = null;
  });

  describe('redirect reason banner', () => {
    it('shows the subscription-expired explanation when redirected here', () => {
      mockSearchParam = 'subscription-expired';
      expiredSub('basic');
      render(<ScoutSubscribePage />);
      expect(
        screen.getByText(
          'Your subscription has expired — please renew to continue.',
        ),
      ).toBeInTheDocument();
    });

    it('does not show a redirect-reason banner on a direct visit', () => {
      noSub();
      render(<ScoutSubscribePage />);
      expect(
        screen.queryByText(/please renew to continue/i),
      ).not.toBeInTheDocument();
    });
  });

  describe('active subscription banner', () => {
    it('renders banner when subscription is active', () => {
      activeSub('basic', FUTURE);
      render(<ScoutSubscribePage />);
      expect(
        screen.getByRole('status', { name: /active subscription/i }),
      ).toBeInTheDocument();
    });

    it('does not render banner when no subscription', () => {
      noSub();
      render(<ScoutSubscribePage />);
      expect(
        screen.queryByRole('status', { name: /active subscription/i }),
      ).not.toBeInTheDocument();
    });

    it('does not render banner when subscription is expired', () => {
      expiredSub('basic');
      render(<ScoutSubscribePage />);
      expect(
        screen.queryByRole('status', { name: /active subscription/i }),
      ).not.toBeInTheDocument();
    });

    it('shows tier name in banner', () => {
      activeSub('pro', FUTURE);
      render(<ScoutSubscribePage />);
      const banner = screen.getByRole('status', {
        name: /active subscription/i,
      });
      expect(banner).toHaveTextContent('Pro');
    });

    it('shows remaining days in banner', () => {
      activeSub('basic', FUTURE);
      render(<ScoutSubscribePage />);
      const banner = screen.getByRole('status', {
        name: /active subscription/i,
      });
      expect(banner).toHaveTextContent(/days remaining/i);
    });
  });

  describe('active tier card highlighting', () => {
    it('shows "Current Plan" badge on the active tier card', () => {
      activeSub('basic', FUTURE);
      render(<ScoutSubscribePage />);
      expect(screen.getByText('Current Plan')).toBeInTheDocument();
    });

    it('does not show "Current Plan" badge when no subscription', () => {
      noSub();
      render(<ScoutSubscribePage />);
      expect(screen.queryByText('Current Plan')).not.toBeInTheDocument();
    });
  });

  describe('dynamic CTA label', () => {
    it('shows "Subscribe" on all tiers when no subscription', () => {
      noSub();
      render(<ScoutSubscribePage />);
      const buttons = screen.getAllByRole('button', { name: /subscribe/i });
      expect(buttons).toHaveLength(2);
    });

    it('shows "Renew" on the current active tier', () => {
      activeSub('basic', FUTURE);
      render(<ScoutSubscribePage />);
      expect(
        screen.getByRole('button', { name: /renew/i }),
      ).toBeInTheDocument();
    });

    it('shows "Upgrade" on a higher tier when active subscription exists', () => {
      activeSub('basic', FUTURE);
      render(<ScoutSubscribePage />);
      expect(
        screen.getByRole('button', { name: /upgrade/i }),
      ).toBeInTheDocument();
    });

    it('shows "Renew" on same expired tier', () => {
      expiredSub('basic');
      render(<ScoutSubscribePage />);
      // Basic card should say Renew
      const buttons = screen.getAllByRole('button');
      const labels = buttons.map((b) => b.textContent);
      expect(labels).toContain('Renew');
    });

    it('shows "Subscribe" on lower tier than active (no downgrade label)', () => {
      // pro is active, basic is lower — should say Subscribe (no upgrade/renew)
      activeSub('pro', FUTURE);
      render(<ScoutSubscribePage />);
      expect(
        screen.getByRole('button', { name: /subscribe/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /renew/i }),
      ).toBeInTheDocument();
    });
  });

  describe('subscribe action', () => {
    it('calls subscribe with the selected tier', async () => {
      const mockSubscribe = jest.fn().mockResolvedValue(undefined);
      mockUseSubscription.mockReturnValue({
        subscription: null,
        isExpired: false,
        subscribe: mockSubscribe,
        loading: false,
        error: null,
      });

      render(<ScoutSubscribePage />);
      const [basicBtn] = screen.getAllByRole('button', { name: /subscribe/i });
      await userEvent.click(basicBtn);

      await waitFor(() => expect(mockSubscribe).toHaveBeenCalledWith('basic'));
    });

    it('shows error from hook', () => {
      mockUseSubscription.mockReturnValue({
        subscription: null,
        isExpired: false,
        subscribe: jest.fn(),
        loading: false,
        error: 'Insufficient fee',
      });

      render(<ScoutSubscribePage />);
      expect(screen.getByText('Insufficient fee')).toBeInTheDocument();
    });

    it('shows success message after subscribe', async () => {
      const mockSubscribe = jest.fn().mockResolvedValue(undefined);
      mockUseSubscription.mockReturnValue({
        subscription: null,
        isExpired: false,
        subscribe: mockSubscribe,
        loading: false,
        error: null,
      });

      render(<ScoutSubscribePage />);
      const [basicBtn] = screen.getAllByRole('button', { name: /subscribe/i });
      await userEvent.click(basicBtn);

      await waitFor(() =>
        expect(
          screen.getByText(/subscribed to basic successfully/i),
        ).toBeInTheDocument(),
      );
    });
  });
});
