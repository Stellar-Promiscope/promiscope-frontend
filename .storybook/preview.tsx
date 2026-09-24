import type { Preview, Decorator } from '@storybook/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../messages/en.json';
import './tailwind.css';

// Primitives in components/ui read their accessible labels from the
// `common` namespace (#1342), so every story needs an intl provider.
const withIntl: Decorator = (Story) => (
  <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
    <Story />
  </NextIntlClientProvider>
);

// Toggles the same `.dark` class app/layout.tsx applies to <html>, so
// components using dark: variants (Issue #547 audit) render with the
// correct palette from .storybook/tailwind.css. Defaults to dark to match
// the app's previous Storybook look; use the "Theme" toolbar item to check
// stories against the light palette too.
const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme ?? 'dark';
  return (
    <div
      className={theme === 'dark' ? 'dark' : undefined}
      style={{
        backgroundColor: 'rgb(var(--bg))',
        color: 'var(--text)',
        minHeight: '100vh',
        padding: '1.5rem',
      }}
    >
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [withTheme, withIntl],
  globalTypes: {
    theme: {
      description: 'Light/dark theme',
      defaultValue: 'dark',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', icon: 'sun', title: 'Light' },
          { value: 'dark', icon: 'moon', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    options: {
      storySort: {
        order: ['Foundations', 'UI', 'Components', '*'],
      },
    },
    // Superseded by the Theme toolbar toggle above.
    backgrounds: { disable: true },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    nextjs: { appDirectory: true },
  },
};

export default preview;
