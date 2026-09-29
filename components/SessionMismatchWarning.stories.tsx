import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { ToastProvider } from './ui/Toast';

const messages = {
  session: {
    mismatchTitle: 'Session mismatch detected',
    mismatchMessage: 'The wallet address shown ({address}) differs from the identity your session is authenticated to.',
    mismatchExplanation: 'This may happen if you switched accounts in your wallet extension without logging out first.',
    reauthenticate: 'Re-authenticate',
    dismiss: 'Dismiss',
  },
};

// Story-only wrapper that reproduces SessionMismatchWarning UI with controllable props
function SessionMismatchWarningStory({
  show = true,
  publicKey = 'GCFW7QAO3WZQ6X4CZ3OYZFXX3A3DL7XVI5DNVTXA5VJUGE5SU6ZRG5OV',
}: {
  show?: boolean;
  publicKey?: string;
}) {
  const [isReauthenticating, setIsReauthenticating] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed || !show || !publicKey) return null;

  const handleReauthenticate = async () => {
    setIsReauthenticating(true);
    // Simulate async operation
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsReauthenticating(false);
  };

  return (
    <div
      role="alert"
      className="bg-red-500 text-white px-4 py-3 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
    >
      <div className="flex items-start gap-3">
        <svg
          className="w-5 h-5 shrink-0 mt-0.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <div>
          <p className="font-medium text-sm">Session mismatch detected</p>
          <p className="text-sm text-red-100 mt-1">
            The wallet address shown ({publicKey.slice(0, 8)}…) differs from the
            identity your session is authenticated to. This may happen if you
            switched accounts in your wallet extension without logging out
            first.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 w-full sm:w-auto">
        <button
          onClick={handleReauthenticate}
          disabled={isReauthenticating}
          className="flex-1 sm:flex-none bg-white text-red-600 hover:bg-red-50 px-4 py-2 rounded text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isReauthenticating ? 'Re-authenticating…' : 'Re-authenticate'}
        </button>
        <button
          onClick={() => setIsDismissed(true)}
          className="text-red-100 hover:text-white transition px-2"
          aria-label="Dismiss warning"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

const meta: Meta<typeof SessionMismatchWarningStory> = {
  title: 'Components/SessionMismatchWarning',
  component: SessionMismatchWarningStory,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="en" messages={messages}>
        <ToastProvider>
          <Story />
        </ToastProvider>
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SessionMismatchWarningStory>;

export const Default: Story = {
  name: 'Default',
  args: {
    show: true,
    publicKey: 'GCFW7QAO3WZQ6X4CZ3OYZFXX3A3DL7XVI5DNVTXA5VJUGE5SU6ZRG5OV',
  },
};

export const Hidden: Story = {
  name: 'Hidden (no mismatch)',
  args: {
    show: false,
  },
};

export const Dark: Story = {
  name: 'Dark theme',
  args: {
    show: true,
  },
  parameters: {
    themes: {
      default: 'dark',
    },
  },
};

export const Mobile: Story = {
  name: 'Mobile viewport',
  args: {
    show: true,
  },
  parameters: {
    viewport: {
      defaultViewport: 'iphone12',
    },
  },
};
