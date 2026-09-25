'use client';

import { useTranslations } from 'next-intl';

/**
 * Skip link for keyboard/screen-reader users to bypass the repeated Navbar
 * links and jump straight to a page's main content. Visually hidden until
 * focused. Render this as the first child of the page body/layout, and add
 * `id="main-content"` to the page's main landmark.
 */
export default function SkipToContent({
  targetId = 'main-content',
}: {
  targetId?: string;
}) {
  const t = useTranslations('common');

  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-brand-green focus:text-black focus:px-6 focus:py-3 focus:rounded-lg focus:font-semibold"
    >
      {t('skipToContent')}
    </a>
  );
}
