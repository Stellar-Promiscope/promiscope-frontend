import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Use the real next-intl (jest.setup.ts stubs it) to render with fr messages.
jest.unmock('next-intl');

import { NextIntlClientProvider } from 'next-intl';
import fr from '@/messages/fr.json';
import ActiveSessions from '@/components/ActiveSessions';
import NotificationBell from '@/components/NotificationBell';
import NotificationPreferencesPanel from '@/components/NotificationPreferencesPanel';

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({
    publicKey: 'GTEST',
    isAuthenticated: true,
    disconnect: jest.fn(),
  }),
}));
jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: jest.fn() }),
}));
jest.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({
    notifications: [],
    unreadCount: 3,
    loading: false,
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  }),
}));
jest.mock('@/hooks/useNotificationPreferences', () => ({
  useNotificationPreferences: () => ({
    preferences: { milestoneApprovals: true, contactUnlocks: false },
    loading: false,
    update: jest.fn(),
  }),
}));

function renderFr(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );
}

describe('account and notification UI in fr', () => {
  it('pluralizes the unread-count label on the bell', () => {
    renderFr(<NotificationBell />);
    expect(
      screen.getByRole('button', {
        name: 'Notifications, 3 notifications non lues',
      }),
    ).toBeInTheDocument();
  });

  it('translates notification preference categories', () => {
    renderFr(<NotificationPreferencesPanel />);
    expect(
      screen.getByRole('switch', { name: 'Validations de jalons' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Déblocages de contact')).toBeInTheDocument();
  });

  it('translates active sessions with a localized device label', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sessions: [
          {
            id: 's1',
            deviceLabel: 'Chrome on Android',
            device: { browser: 'Chrome', os: 'Android' },
            createdAt: Date.now() - 60_000,
            lastSeenAt: Date.now() - 5 * 60_000,
            expiresAt: Date.now() + 60_000,
            isCurrent: true,
          },
        ],
      }),
    }) as jest.Mock;

    renderFr(<ActiveSessions />);

    expect(await screen.findByText('Chrome sur Android')).toBeInTheDocument();
    expect(screen.getByText('Cet appareil')).toBeInTheDocument();
    expect(
      screen.getByText(/Dernière activité il y a 5 minutes/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Révoquer' }),
    ).toBeInTheDocument();
  });
});
