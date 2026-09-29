import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import NotificationBell from '@/components/NotificationBell';
import { useWallet } from '@/hooks/useWallet';
import { useNotifications } from '@/hooks/useNotifications';
import type { Notification } from '@/types';

jest.mock('@/hooks/useWallet', () => ({
  useWallet: jest.fn(),
}));

jest.mock('@/hooks/useNotifications', () => ({
  useNotifications: jest.fn(),
}));

const mockUseWallet = useWallet as jest.Mock;
const mockUseNotifications = useNotifications as jest.Mock;

function makeNotification(overrides: Partial<Notification>): Notification {
  return {
    id: 1,
    category: 'milestone_approval',
    title: 'Milestone approved',
    message: 'Your milestone was approved.',
    createdAt: Math.floor(Date.now() / 1000),
    read: false,
    playerId: 'p1',
    ...overrides,
  };
}

function setup({
  unreadCount = 0,
  notifications = [] as Notification[],
  markRead = jest.fn(),
  markAllRead = jest.fn(),
} = {}) {
  mockUseWallet.mockReturnValue({
    publicKey: 'GABCDEF1234567890XYZ',
    isAuthenticated: true,
  });
  mockUseNotifications.mockReturnValue({
    notifications,
    unreadCount,
    loading: false,
    error: null,
    markRead,
    markAllRead,
  });
  return render(<NotificationBell />);
}

describe('NotificationBell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when the wallet is not authenticated', () => {
    mockUseWallet.mockReturnValue({ publicKey: null, isAuthenticated: false });
    mockUseNotifications.mockReturnValue({
      notifications: [],
      unreadCount: 0,
      loading: false,
      error: null,
      markRead: jest.fn(),
      markAllRead: jest.fn(),
    });
    const { container } = render(<NotificationBell />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows no badge when there are no unread notifications', () => {
    setup({ unreadCount: 0 });
    expect(
      screen.getByRole('button', { name: 'Notifications' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^\d+\+?$/)).not.toBeInTheDocument();
  });

  it('shows the exact unread count on the badge', () => {
    setup({ unreadCount: 3 });
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Notifications, 3 unread notifications',
      }),
    ).toBeInTheDocument();
  });

  it('caps the badge at "9+" once unread count exceeds the cap', () => {
    setup({ unreadCount: 42 });
    expect(screen.getByText('9+')).toBeInTheDocument();
  });

  it('clicking "Mark all as read" clears the badge immediately', async () => {
    const markAllRead = jest.fn().mockResolvedValue(undefined);
    const notifications = [
      makeNotification({ id: 1, read: false }),
      makeNotification({ id: 2, read: false }),
    ];
    const { rerender } = setup({
      unreadCount: 2,
      notifications,
      markAllRead,
    });

    const user = userEvent.setup({ delay: null });
    await user.click(
      screen.getByRole('button', {
        name: 'Notifications, 2 unread notifications',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Mark all as read' }));

    expect(markAllRead).toHaveBeenCalledTimes(1);

    // Simulate the hook reporting the cleared unread count post-mark-all-read.
    mockUseNotifications.mockReturnValue({
      notifications: notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
      loading: false,
      error: null,
      markRead: jest.fn(),
      markAllRead,
    });
    rerender(<NotificationBell />);

    expect(screen.queryByText('2')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Notifications' }),
    ).toBeInTheDocument();
  });
});
