/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PlayerProfileLayout, {
  generateMetadata,
} from '@/app/[locale]/player/[id]/layout';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPlayer = {
  id: 'player-abc-123',
  wallet: 'GA7QYNF7S3QZSTARF3Q7ZTH4I3VY6LFX3XKXZ7T3WX4N5O6P7Q8R9S0T',
  vitals: {
    name: 'Alex Okafor',
    age: 22,
    position: 'Forward',
    region: 'West Africa',
    nationality: 'Nigeria',
  },
  ipfsHash: 'QmTest123456789',
  progressLevel: 2,
  milestones: [
    {
      id: 'm1',
      description: 'Scored 15 goals in season',
      evidenceHash: 'QmEvidenceHash',
      validator: 'GA7QYNF7S3QZSTARF3Q7ZTH4I3VY6LFX3XKXZ7T3WX4N5O6P7Q8R9S0T',
      timestamp: 1700000000,
    },
  ],
  createdAt: 1690000000,
} as const;

const mockFetchPlayerProfile = jest.fn();

jest.mock('@/lib/api', () => ({
  fetchPlayerProfile: (...args: unknown[]) => mockFetchPlayerProfile(...args),
}));

jest.mock('next/script', () => {
  const MockScript = ({
    id,
    type,
    dangerouslySetInnerHTML,
  }: {
    id?: string;
    type?: string;
    dangerouslySetInnerHTML?: { __html: string };
  }) => (
    <script
      id={id}
      type={type}
      dangerouslySetInnerHTML={dangerouslySetInnerHTML}
    />
  );
  MockScript.displayName = 'MockScript';
  return MockScript;
});

const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

describe('PlayerProfileLayout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'https://promiscope.example';
    process.env.NEXT_PUBLIC_NETWORK = 'testnet';
  });

  afterAll(() => {
    process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL;
  });

  describe('layout rendering', () => {
    it('renders JSON-LD when player data is fetched successfully', async () => {
      mockFetchPlayerProfile.mockResolvedValue(mockPlayer);

      const element = await PlayerProfileLayout({
        children: <p>Profile content</p>,
        params: { locale: 'en', id: 'player-abc-123' },
      });

      const { container } = render(<>{element}</>);

      const script = container.querySelector(
        'script#player-person-jsonld[type="application/ld+json"]',
      );
      expect(script).toBeInTheDocument();

      const jsonLd = JSON.parse(script!.textContent || script!.innerHTML);

      expect(jsonLd['@context']).toBe('https://schema.org');
      expect(jsonLd['@type']).toBe('Person');
      expect(jsonLd.name).toBe('Alex Okafor');
      expect(jsonLd.nationality).toBe('Nigeria');
      expect(jsonLd.description).toContain('Forward');
      expect(jsonLd.description).toContain('West Africa');
      expect(jsonLd.description).toContain('Level 2');
      expect(jsonLd.url).toBe('https://promiscope.example/en/player/player-abc-123');
      expect(jsonLd.identifier).toBe('player-abc-123');
      expect(jsonLd.sameAs).toEqual(
        expect.arrayContaining([
          expect.stringContaining('stellar.expert'),
          'https://promiscope.example/en/player/player-abc-123',
        ]),
      );
      expect(screen.getByText('Profile content')).toBeInTheDocument();
    });

    it('renders children without JSON-LD when fetch fails', async () => {
      mockFetchPlayerProfile.mockRejectedValue(new Error('Network error'));

      const element = await PlayerProfileLayout({
        children: <p>Profile content</p>,
        params: { locale: 'fr', id: 'unknown' },
      });

      const { container } = render(<>{element}</>);

      expect(
        container.querySelector(
          'script#player-person-jsonld[type="application/ld+json"]',
        ),
      ).toBeNull();
      expect(screen.getByText('Profile content')).toBeInTheDocument();
    });

    it('renders children without JSON-LD when player is null', async () => {
      mockFetchPlayerProfile.mockResolvedValue(null);

      const element = await PlayerProfileLayout({
        children: <p>Not found</p>,
        params: { locale: 'en', id: 'ghost' },
      });

      const { container } = render(<>{element}</>);

      expect(
        container.querySelector(
          'script#player-person-jsonld[type="application/ld+json"]',
        ),
      ).toBeNull();
    });
  });

  describe('generateMetadata', () => {
    it('returns player-specific metadata when data is available', async () => {
      mockFetchPlayerProfile.mockResolvedValue(mockPlayer);

      const metadata = await generateMetadata({
        children: null,
        params: { locale: 'en', id: 'player-abc-123' },
      });

      expect(metadata.title).toBe('Alex Okafor — Player Profile — Promiscope');
      expect(metadata.description).toContain('Forward');
      expect(metadata.description).toContain('West Africa');
      expect(metadata.openGraph?.title).toContain('Alex Okafor');
      expect(metadata.openGraph?.url).toBe(
        'https://promiscope.example/en/player/player-abc-123',
      );
      expect(metadata.openGraph?.type).toBe('profile');
    });

    it('returns empty metadata when fetch fails', async () => {
      mockFetchPlayerProfile.mockRejectedValue(new Error('fail'));

      const metadata = await generateMetadata({
        children: null,
        params: { locale: 'fr', id: 'unknown' },
      });

      expect(metadata).toEqual({});
    });
  });
});
