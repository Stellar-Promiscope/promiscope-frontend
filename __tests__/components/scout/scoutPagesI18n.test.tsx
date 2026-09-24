import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Use the real next-intl (jest.setup.ts stubs it) to render with sw messages.
jest.unmock('next-intl');

import { NextIntlClientProvider } from 'next-intl';
import sw from '@/messages/sw.json';
import PlayerCompareView from '@/components/scout/PlayerCompareView';
import PlayerStatsCard from '@/components/player/PlayerStatsCard';
import type { Player } from '@/types';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));
jest.mock('next/image', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/player/MilestoneTimeline', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({
    subscription: null,
    isExpired: false,
    subscribe: jest.fn(),
    subscribeStatus: 'idle',
    isConfirming: false,
    loading: false,
    error: null,
  }),
}));
jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({ publicKey: 'GTEST' }),
}));
jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: jest.fn() }),
}));

import ScoutSubscribePage from '@/app/[locale]/scout/subscribe/page';

function renderSw(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="sw" messages={sw} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );
}

const player: Player = {
  id: 'p1',
  wallet: 'GWALLET1',
  vitals: {
    name: 'Amani',
    age: 19,
    position: 'GK',
    region: 'East Africa',
    nationality: 'Kenyan',
  },
  stats: { goals: 0, assists: 1, appearances: 12, clean_sheets: 4 },
  ipfsHash: '',
  progressLevel: 1,
  milestones: [],
  createdAt: 1_690_000_000,
} as Player;

describe('scout surfaces in sw', () => {
  it('renders the subscription page in Swahili', () => {
    renderSw(<ScoutSubscribePage />);
    expect(
      screen.getByRole('heading', { name: 'Usajili wa skauti' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Hakuna usajili unaotumika.')).toBeInTheDocument();
    expect(screen.getByText('Vinjari wasifu wa wachezaji')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Jisajili' })).toHaveLength(2);
  });

  it('shares stat labels between the compare view and the stats card', () => {
    renderSw(
      <>
        <PlayerCompareView players={[player]} />
        <PlayerStatsCard stats={player.stats} position="GK" />
      </>,
    );
    expect(screen.getAllByText('Mechi bila kufungwa')).toHaveLength(2);
    expect(screen.getAllByText('Mabao')).toHaveLength(2);
    expect(screen.getByText('hatua 0')).toBeInTheDocument();
  });
});
