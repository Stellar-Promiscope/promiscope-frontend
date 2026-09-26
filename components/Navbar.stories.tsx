import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent } from '@storybook/test';
import { SWRConfig } from 'swr';
import { NextIntlClientProvider } from 'next-intl';
import { ToastProvider } from './ui/Toast';
import { ThemeProvider } from '@/context/ThemeContext';
import { WalletProvider } from '@/context/WalletContext';
import Navbar from './Navbar';
import enMessages from '@/messages/en.json';
import frMessages from '@/messages/fr.json';
import swMessages from '@/messages/sw.json';

const DEMO_WALLET =
  'GABCDEFGHIJKLMNOPQRSTUVWX234567890123456789012345678901234';
const WALLET_SESSION_KEY = 'wallet_session';

const messages = {
  en: enMessages,
  fr: frMessages,
  sw: swMessages,
};

type Locale = keyof typeof messages;

function StoryProviders({
  locale,
  authenticated,
  children,
}: {
  locale: Locale;
  authenticated: boolean;
  children: React.ReactNode;
}) {
  if (typeof window !== 'undefined') {
    if (authenticated) {
      localStorage.setItem(
        WALLET_SESSION_KEY,
        JSON.stringify({
          publicKey: DEMO_WALLET,
          provider: 'albedo',
          networkType: 'testnet',
        }),
      );
    } else {
      localStorage.removeItem(WALLET_SESSION_KEY);
    }
  }

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages[locale]}
      timeZone="UTC"
    >
      <SWRConfig value={{ provider: () => new Map() }}>
        <ToastProvider>
          <ThemeProvider>
            <WalletProvider key={`${locale}-${authenticated}`}>
              {children}
            </WalletProvider>
          </ThemeProvider>
        </ToastProvider>
      </SWRConfig>
    </NextIntlClientProvider>
  );
}

const meta: Meta<typeof Navbar> = {
  title: 'Components/Navbar',
  component: Navbar,
  tags: ['autodocs'],
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: '/en',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Navbar>;

export const LoggedOut: Story = {
  render: () => (
    <StoryProviders locale="en" authenticated={false}>
      <Navbar />
    </StoryProviders>
  ),
};

export const LoggedIn: Story = {
  render: () => (
    <StoryProviders locale="en" authenticated>
      <Navbar />
    </StoryProviders>
  ),
};

export const FrenchLabels: Story = {
  render: () => (
    <StoryProviders locale="fr" authenticated={false}>
      <Navbar />
    </StoryProviders>
  ),
};

export const SwahiliLabels: Story = {
  render: () => (
    <StoryProviders locale="sw" authenticated={false}>
      <Navbar />
    </StoryProviders>
  ),
};

export const OpenMobileMenu: Story = {
  parameters: { testRunner: { viewport: { width: 375, height: 812 } } },
  render: () => (
    <StoryProviders locale="en" authenticated={true}>
      <Navbar />
    </StoryProviders>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const menuButton = await canvas.findByRole('button', {
      name: /open navigation menu/i,
    });
    await userEvent.click(menuButton);
  },
};
