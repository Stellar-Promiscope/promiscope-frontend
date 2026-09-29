import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import Navbar from '@/components/Navbar';
import { ToastProvider } from '@/components/ui/Toast';
import { WalletProvider } from '@/context/WalletContext';
import { ThemeProvider } from '@/context/ThemeContext';
import ContractIncompatibleBanner from '@/components/ContractIncompatibleBanner';
import ContractPausedBanner from '@/components/ContractPausedBanner';
import ConfigWarningBanner from '@/components/ConfigWarningBanner';
import ServiceWorkerUpdateBanner from '@/components/ServiceWorkerUpdateBanner';
import OfflineBanner from '@/components/OfflineBanner';
import SkipToContent from '@/components/SkipToContent';
import SessionExpiryWarning from '@/components/SessionExpiryWarning';
import CookieConsentGate from '@/components/ui/CookieConsentGate';
import A11yDevAudit from '@/components/A11yDevAudit';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { validateConfig } from '@/lib/config';
import { locales, defaultLocale } from '@/lib/locales';
import { getTextDirection } from '@/lib/rtl';
import { buildThemeBootstrapScript } from '@/lib/themeBootstrap';

// Analytics and Web Vitals reporting are disabled in tests to avoid
// polluting real analytics data and to keep jsdom-based test runs from
// touching PerformanceObserver APIs it doesn't fully implement.
const isTestEnv = process.env.NODE_ENV === 'test';

// Every relative metadata URL (OG images, canonical links) resolves against
// NEXT_PUBLIC_APP_URL, so previews work on staging and preview deployments.
// Localized title/description/Open Graph fields live in
// app/[locale]/layout.tsx; these English values are only the fallback for
// routes outside the [locale] segment.
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  ),
  title: 'ScoutOff — Decentralized Football Scouting',
  description:
    'Tamper-proof player profiles, verifiable milestones, and direct scout-to-player connections — powered by Stellar Soroban smart contracts.',
  openGraph: {
    siteName: 'ScoutOff',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

/**
 * Reads the active locale from the request.
 *
 * Root layouts in Next.js App Router cannot access `params.locale` from the
 * nested `[locale]` segment. Instead, we read the `x-pathname` header set by
 * the middleware and extract the locale from the path prefix (e.g.
 * `/en/player` → `en`). Falls back to `defaultLocale` when the header is
 * absent.
 */
async function getLocale(): Promise<string> {
  const headersList = await headers();
  const pathname = headersList.get('x-pathname') || '';
  // Extract locale from the first path segment (e.g. "/en/player" → "en")
  const match = pathname.match(/^\/([a-z]{2})(?:\/|$)/);
  if (match && locales.includes(match[1])) {
    return match[1];
  }
  return defaultLocale;
}

/**
 * Reads the per-request nonce injected by middleware.ts into the x-nonce
 * request header. The nonce is embedded in the CSP's script-src so this
 * inline theme script (and Next.js's own inline RSC scripts) are allowed
 * without 'unsafe-inline'.
 */
async function getNonce(): Promise<string> {
  const headersList = await headers();
  return headersList.get('x-nonce') ?? '';
}
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
  params?: { locale?: string };
}) {
  const locale = await getLocale();
  const nonce = await getNonce();
  const messages = await getMessages();

  // Runtime configuration check — fires on every request so a deployment
  // with missing env vars (e.g. NEXT_PUBLIC_CONTRACT_ID not set in the
  // hosting platform) surfaces a clear warning immediately instead of
  // failing deep inside a Soroban RPC call.
  const configWarnings = validateConfig();

  return (
    <html lang={locale} dir={getTextDirection(locale)} suppressHydrationWarning>
      <head>
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href="/icons/icon-32x32.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href="/icons/icon-16x16.png"
        />
        <link rel="manifest" href="/manifest.json" />
        {/* Keep in sync with brand.dark in tailwind.config.ts, --bg in app/globals.css, and theme_color/background_color in public/manifest.json */}
        <meta name="theme-color" content="#0a0f1e" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        {/*
          No-flash theme script: resolves stored-preference-or-system-preference
          and applies the `dark` class to <html> before first paint. Built in
          lib/themeBootstrap.ts from the same storage key ThemeContext uses
          (ThemeProvider re-applies the same result on mount, so this is
          purely to avoid a flash of the wrong theme).

          The nonce attribute must match the per-request nonce in the CSP
          (set by middleware.ts) so this inline script is allowed without
          'unsafe-inline'.
        */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: buildThemeBootstrapScript(),
          }}
        />
      </head>
      <body>
        <A11yDevAudit />
        <ThemeProvider>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <SkipToContent />
            <WalletProvider>
              <ToastProvider>
                <ConfigWarningBanner warnings={configWarnings} />
                <ServiceWorkerUpdateBanner />
                <OfflineBanner />
                <Navbar />
                <ContractIncompatibleBanner />
                <ContractPausedBanner />
                <SessionExpiryWarning />
                <main id="main-content" className="max-w-6xl mx-auto px-4 py-8">
                  {children}
                </main>
              </ToastProvider>
            </WalletProvider>
            {/* Inside the intl provider: the banner's labels are translated (#1342). */}
            {!isTestEnv && <CookieConsentGate />}
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
