/**
 * Render helper that mounts components inside a real NextIntlClientProvider
 * loaded with the actual messages/*.json catalogues, so tests assert the
 * copy users see rather than raw translation keys. Test files using it must
 * call `jest.unmock('next-intl')` to opt out of the global key-echo mock in
 * jest.setup.ts. Excluded from testMatch via testPathIgnorePatterns.
 */
import React, { type ReactElement, type ReactNode } from 'react';
import {
  render as rtlRender,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import sw from '@/messages/sw.json';

const catalogues = { en, fr, sw };

export type TestLocale = keyof typeof catalogues;

export * from '@testing-library/react';

export function render(
  ui: ReactElement,
  {
    locale = 'en',
    ...options
  }: Omit<RenderOptions, 'wrapper'> & { locale?: TestLocale } = {},
): RenderResult {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider
        locale={locale}
        messages={catalogues[locale]}
        timeZone="UTC"
      >
        {children}
      </NextIntlClientProvider>
    );
  }
  return rtlRender(ui, { wrapper: Wrapper, ...options });
}
