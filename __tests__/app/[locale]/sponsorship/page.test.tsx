import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
// The default export of page.tsx is now a thin server wrapper; test the client
// component directly so React state and translations are exercised normally.
import SponsorshipClient from '@/app/[locale]/sponsorship/SponsorshipClient';
import { generateMetadata } from '@/app/[locale]/sponsorship/page';

// generateMetadata → buildPageMetadata → seoMetadata reads the request's
// x-pathname header (set by middleware in production). Stub next/headers so
// the canonical/alternates resolve outside a request scope.
const mockHeaders = new Map<string, string>();
jest.mock('next/headers', () => ({
  headers: jest.fn().mockImplementation(async () => ({
    get: (key: string) => mockHeaders.get(key) ?? null,
  })),
}));

// ── Mock next-intl/server for generateMetadata ────────────────────────────────
jest.mock('next-intl/server', () => ({
  getTranslations: jest.fn().mockImplementation(({ namespace }) => {
    const en: Record<string, Record<string, string>> = {
      sponsorship: {
        title: 'Fractionalized Player Sponsorship',
        metaDescription:
          'Support talented players from underserved regions through fractionalized XLM sponsorship on the Stellar blockchain. Promiscope connects fans and backers directly with scouted talent.',
      },
    };
    return Promise.resolve((key: string) => en[namespace]?.[key] ?? key);
  }),
}));

// ── Rendered component tests ───────────────────────────────────────────────────

describe('SponsorshipPage', () => {
  it('renders the translated sponsorship copy', () => {
    render(<SponsorshipClient />);

    // The global next-intl mock falls back to returning the translation key
    // itself for keys not explicitly stubbed, so we assert those keys render.
    expect(screen.getByText('badge')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'title' }),
    ).toBeInTheDocument();
    expect(screen.getByText('description')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'howItWorksTitle' }),
    ).toBeInTheDocument();
    expect(screen.getByText('howItWorksDescription')).toBeInTheDocument();
    expect(screen.getByText('notice')).toBeInTheDocument();
  });
});

// ── generateMetadata tests ─────────────────────────────────────────────────────

describe('generateMetadata — sponsorship page', () => {
  const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    mockHeaders.clear();
    process.env.NEXT_PUBLIC_APP_URL = 'https://promiscope.example';
  });

  afterAll(() => {
    process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL;
  });

  it('includes a description field sourced from the metaDescription i18n key', async () => {
    const metadata = await generateMetadata({
      params: { locale: 'en' },
    });

    expect(metadata.description).toBeDefined();
    expect(typeof metadata.description).toBe('string');
    expect((metadata.description as string).length).toBeGreaterThan(0);
  });

  it('sets the correct description for the English locale', async () => {
    const metadata = await generateMetadata({
      params: { locale: 'en' },
    });

    expect(metadata.description).toBe(
      'Support talented players from underserved regions through fractionalized XLM sponsorship on the Stellar blockchain. Promiscope connects fans and backers directly with scouted talent.',
    );
  });

  it('sets a title that includes the page title and brand name', async () => {
    const metadata = await generateMetadata({
      params: { locale: 'en' },
    });

    expect(metadata.title).toContain('Promiscope');
    expect(metadata.title).toContain('Fractionalized Player Sponsorship');
  });

  it('sets the canonical alternates URL for the given locale', async () => {
    mockHeaders.set('x-pathname', '/fr/sponsorship');

    const metadata = await generateMetadata({
      params: { locale: 'fr' },
    });

    expect(metadata.alternates?.canonical).toBe(
      'https://promiscope.example/fr/sponsorship',
    );
  });
});
