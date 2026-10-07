import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import HomePage from '@/app/[locale]/page';

jest.mock('next-intl/server', () => ({
  getTranslations: jest.fn(
    async ({ namespace }: { namespace?: string } = {}) => {
      return (key: string) => {
        if (namespace === 'footer') {
          const translations: Record<string, string> = {
            changelog: 'Changelog',
          };
          return translations[key] ?? key;
        }
        return key;
      };
    },
  ),
}));

describe('HomePage', () => {
  it('renders the hero heading and calls to action for players and scouts', async () => {
    const Page = await HomePage({ params: { locale: 'en' } });
    render(Page);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /Discover Football Talent/i,
      }),
    ).toBeInTheDocument();

    expect(screen.getByRole('link', { name: "I'm a Player" })).toHaveAttribute(
      'href',
      '/player',
    );
    expect(screen.getByRole('link', { name: "I'm a Scout" })).toHaveAttribute(
      'href',
      '/scout',
    );
  });

  it('renders a feature card for every entry in the features list', async () => {
    const Page = await HomePage({ params: { locale: 'en' } });
    render(Page);

    expect(screen.getByText('Tamper-Proof Profiles')).toBeInTheDocument();
    expect(screen.getByText('On-Chain Milestones')).toBeInTheDocument();
    expect(screen.getByText('Direct Scout Access')).toBeInTheDocument();
    expect(screen.getByText('Powered by Stellar')).toBeInTheDocument();
  });

  it('shows the redirect-reason banner when reason is present in searchParams', async () => {
    const Page = await HomePage({
      params: { locale: 'en' },
      searchParams: { reason: 'wallet-required' },
    });
    render(Page);

    expect(
      screen.getByText('You need to connect your wallet to view that page.'),
    ).toBeInTheDocument();
  });

  it('does not show a redirect-reason banner on a direct visit', async () => {
    const Page = await HomePage({ params: { locale: 'en' } });
    render(Page);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders the footer with the current year, external links, and changelog link', async () => {
    const Page = await HomePage({ params: { locale: 'en' } });
    render(Page);

    const year = new Date().getFullYear().toString();
    expect(screen.getByText(new RegExp(year))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/jhayniffy/promiscope',
    );
    expect(screen.getByRole('link', { name: 'Changelog' })).toHaveAttribute(
      'href',
      '/en/changelog',
    );
  });
});
