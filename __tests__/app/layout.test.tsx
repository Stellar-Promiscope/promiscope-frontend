import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import RootLayout, { metadata } from '@/app/layout';

jest.mock('next-intl/server', () => ({
  getMessages: jest.fn().mockResolvedValue({ app_title: 'Promiscope' }),
}));

// The real `@/lib/locales` only lists 'en'/'fr'/'sw' (all LTR). To prove the
// `<html dir>` wiring actually branches on `lib/rtl.ts` (and not just on a
// hardcoded 'ltr'), this mock adds a hypothetical 'ar' (RTL) locale to the
// recognized-locale list used by `getLocale()` in app/layout.tsx, without
// touching the real `SUPPORTED_LOCALES` in lib/locales.ts (out of scope —
// see GitHub issue #1008).
jest.mock('@/lib/locales', () => ({
  locales: ['en', 'fr', 'sw', 'ar'],
  defaultLocale: 'en',
}));

jest.mock('next-intl', () => ({
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="intl-provider">{children}</div>
  ),
  useTranslations: () => (key: string) => key,
}));

jest.mock('@/components/Navbar', () => ({
  __esModule: true,
  default: () => <nav data-testid="navbar">Navbar</nav>,
}));

jest.mock('@/components/ContractPausedBanner', () => ({
  __esModule: true,
  default: () => <div data-testid="contract-paused-banner" />,
}));

jest.mock('@/components/ContractIncompatibleBanner', () => ({
  __esModule: true,
  default: () => <div data-testid="contract-incompatible-banner" />,
}));

jest.mock('@/components/ConfigWarningBanner', () => ({
  __esModule: true,
  default: ({ warnings }: { warnings: unknown[] }) =>
    warnings.length > 0 ? <div data-testid="config-warning-banner" /> : null,
}));

jest.mock('@/components/OfflineBanner', () => ({
  __esModule: true,
  default: () => <div data-testid="offline-banner" />,
}));

jest.mock('@/components/ServiceWorkerUpdateBanner', () => ({
  __esModule: true,
  default: () => <div data-testid="service-worker-update-banner" />,
}));

// Analytics/Web Vitals now mount from inside CookieConsentGate, gated
// behind cookie consent — RootLayout only decides whether to mount the
// gate at all (see isTestEnv below). Consent-gated mounting of Analytics/
// WebVitalsReporter is CookieConsentGate's own concern, not RootLayout's.
jest.mock('@/components/ui/CookieConsentGate', () => ({
  __esModule: true,
  default: () => <div data-testid="cookie-consent-gate" />,
}));

jest.mock('@/components/ui/Toast', () => ({
  __esModule: true,
  ToastProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="toast-provider">{children}</div>
  ),
  useToast: () => ({ show: jest.fn() }),
}));

jest.mock('@/context/WalletContext', () => ({
  __esModule: true,
  WalletProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="wallet-provider">{children}</div>
  ),
  useWalletContext: () => ({
    isAuthenticated: false,
    sessionExpiresAt: null,
    reauthenticate: jest.fn(),
  }),
}));

// ── next/headers mock (used by getLocale() in the root layout) ────────────────

let mockPathname = '';

jest.mock('next/headers', () => ({
  headers: jest.fn().mockImplementation(async () => ({
    get: (key: string) => {
      if (key === 'x-pathname') return mockPathname || null;
      return null;
    },
  })),
}));

describe('RootLayout', () => {
  // Rendering a top-level <html>/<body> tree via RTL's render() (which mounts
  // into a <div>) triggers a benign DOM-nesting warning from React; silence it.
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockPathname = '';
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders providers, navbar, banner, and children inside main content', async () => {
    mockPathname = '/en/';

    const element = await RootLayout({
      children: <p>Page content</p>,
      params: { locale: 'en' },
    });

    render(<>{element}</>);

    expect(screen.getByTestId('intl-provider')).toBeInTheDocument();
    expect(screen.getByTestId('wallet-provider')).toBeInTheDocument();
    expect(screen.getByTestId('toast-provider')).toBeInTheDocument();
    expect(screen.getByTestId('navbar')).toBeInTheDocument();
    expect(screen.getByTestId('contract-paused-banner')).toBeInTheDocument();
    expect(screen.getByText('Page content')).toBeInTheDocument();
    expect(screen.getByTestId('offline-banner')).toBeInTheDocument();

    // Translated skip link (useTranslations is mocked to return the key) is
    // the first focusable element in the document.
    const skipLink = screen.getByRole('link', { name: 'skipToContent' });
    expect(skipLink).toHaveAttribute('href', '#main-content');
    expect(
      document.body.querySelector(
        'a[href], button, input, select, textarea, [tabindex]',
      ),
    ).toBe(skipLink);
  });

  it('sets html lang to "fr" when x-pathname has /fr/ prefix', async () => {
    mockPathname = '/fr/scout';

    const element = await RootLayout({
      children: <p>Bonjour</p>,
      params: { locale: 'fr' },
    });

    const { container } = render(<>{element}</>);

    expect(container.querySelector('html')).toHaveAttribute('lang', 'fr');
    expect(container.querySelector('html')).toHaveAttribute('dir', 'ltr');
  });

  it('sets html lang to "sw" when x-pathname has /sw/ prefix', async () => {
    mockPathname = '/sw/player/abc';

    const element = await RootLayout({
      children: <p>Habari</p>,
      params: { locale: 'sw' },
    });

    const { container } = render(<>{element}</>);

    expect(container.querySelector('html')).toHaveAttribute('lang', 'sw');
    expect(container.querySelector('html')).toHaveAttribute('dir', 'ltr');
  });

  it('falls back to "en" when x-pathname header is absent', async () => {
    mockPathname = '';

    const element = await RootLayout({
      children: <p>Fallback</p>,
      params: { locale: 'en' },
    });

    const { container } = render(<>{element}</>);

    expect(container.querySelector('html')).toHaveAttribute('lang', 'en');
    expect(container.querySelector('html')).toHaveAttribute('dir', 'ltr');
  });

  it('falls back to "en" for unrecognized locale prefix', async () => {
    mockPathname = '/xx/player';

    const element = await RootLayout({
      children: <p>Unknown locale</p>,
      params: { locale: 'xx' },
    });

    const { container } = render(<>{element}</>);

    expect(container.querySelector('html')).toHaveAttribute('lang', 'en');
    expect(container.querySelector('html')).toHaveAttribute('dir', 'ltr');
  });

  it('sets html dir to "rtl" for a hypothetical RTL locale (ar) recognized via x-pathname', async () => {
    // 'ar' is not in the real SUPPORTED_LOCALES (see lib/locales.ts) but is
    // added to the recognized-locale list by the '@/lib/locales' mock above
    // so this test can exercise the RTL branch end-to-end without touching
    // real locale routing.
    mockPathname = '/ar/scout';

    const element = await RootLayout({
      children: <p>مرحبا</p>,
      params: { locale: 'ar' },
    });

    const { container } = render(<>{element}</>);

    expect(container.querySelector('html')).toHaveAttribute('lang', 'ar');
    expect(container.querySelector('html')).toHaveAttribute('dir', 'rtl');
  });

  it('sets html dir to "ltr" for the default "en" locale', async () => {
    mockPathname = '/en/scout';

    const element = await RootLayout({
      children: <p>Hello</p>,
      params: { locale: 'en' },
    });

    const { container } = render(<>{element}</>);

    expect(container.querySelector('html')).toHaveAttribute('lang', 'en');
    expect(container.querySelector('html')).toHaveAttribute('dir', 'ltr');
  });

  it('exposes SEO metadata for the app', () => {
    expect(metadata.title).toBe('Promiscope — Decentralized Football Scouting');
    expect(metadata.metadataBase).toBeInstanceOf(URL);
    expect(metadata.openGraph).toEqual({
      siteName: 'Promiscope',
      type: 'website',
    });
    // No hard-coded production origin or SVG OG image in the root metadata.
    expect(JSON.stringify(metadata)).not.toMatch(/promiscope\.app|\.svg/);
  });

  it('renders ConfigWarningBanner when config is invalid', async () => {
    mockPathname = '/en/';
    const prev = process.env.NEXT_PUBLIC_CONTRACT_ID;
    delete process.env.NEXT_PUBLIC_CONTRACT_ID;

    try {
      const element = await RootLayout({
        children: <p>Content</p>,
        params: { locale: 'en' },
      });

      render(<>{element}</>);

      expect(screen.getByTestId('config-warning-banner')).toBeInTheDocument();
    } finally {
      process.env.NEXT_PUBLIC_CONTRACT_ID = prev;
    }
  });

  it('hides ConfigWarningBanner when config is valid', async () => {
    mockPathname = '/en/';
    const prev = process.env.NEXT_PUBLIC_CONTRACT_ID;
    process.env.NEXT_PUBLIC_CONTRACT_ID = 'CCTOLI...test123';

    try {
      const element = await RootLayout({
        children: <p>Content</p>,
        params: { locale: 'en' },
      });

      render(<>{element}</>);

      expect(
        screen.queryByTestId('config-warning-banner'),
      ).not.toBeInTheDocument();
    } finally {
      process.env.NEXT_PUBLIC_CONTRACT_ID = prev;
    }
  });

  it('does not render CookieConsentGate (and therefore Analytics/Web Vitals) in the test environment', async () => {
    mockPathname = '/en/';

    const element = await RootLayout({
      children: <p>Content</p>,
      params: { locale: 'en' },
    });

    render(<>{element}</>);

    expect(screen.queryByTestId('cookie-consent-gate')).not.toBeInTheDocument();
  });

  it('renders CookieConsentGate outside the test environment', async () => {
    // Analytics/WebVitalsReporter now mount from *inside* CookieConsentGate,
    // gated behind cookie consent (see components/ui/CookieConsentGate.tsx)
    // — RootLayout's isTestEnv branch only decides whether to mount the
    // gate at all, so that's what this test exercises.
    mockPathname = '/en/';
    const prevNodeEnv = process.env.NODE_ENV;
    // @ts-expect-error NODE_ENV is typed readonly; reassigning to simulate a
    // production build is the standard way to exercise this branch.
    process.env.NODE_ENV = 'production';

    // Capture the already-loaded 'react' instance before resetting the
    // module registry below, then pin the next require() of it back to
    // this exact object. Without this, reloading '@/app/layout' after
    // resetModules() would instantiate a *second* copy of 'react' for
    // every hook-using component in its tree (e.g. A11yDevAudit) —
    // distinct from the one react-dom (bound at this file's top-level
    // import, unaffected by the reset) already set its hooks dispatcher
    // on, which surfaces as "Cannot read properties of null" from within
    // the hook call itself.
    const actualReact = jest.requireActual('react');

    let ProductionRootLayout: typeof RootLayout;
    try {
      jest.resetModules();
      jest.doMock('react', () => actualReact);
      ProductionRootLayout = require('@/app/layout').default;

      const element = await ProductionRootLayout({
        children: <p>Content</p>,
        params: { locale: 'en' },
      });

      render(<>{element}</>);

      expect(screen.getByTestId('cookie-consent-gate')).toBeInTheDocument();
    } finally {
      // @ts-expect-error see above
      process.env.NODE_ENV = prevNodeEnv;
      jest.resetModules();
    }
  });
});
