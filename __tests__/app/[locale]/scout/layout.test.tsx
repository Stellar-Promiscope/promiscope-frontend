import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ScoutLayout, { metadata } from '@/app/[locale]/scout/layout';

describe('ScoutLayout', () => {
  it('renders its children unchanged', () => {
    render(
      <ScoutLayout>
        <p>Scout section content</p>
      </ScoutLayout>,
    );

    expect(screen.getByText('Scout section content')).toBeInTheDocument();
  });

  it('exposes SEO metadata for the scout dashboard', () => {
    expect(metadata.title).toBe('Scout Dashboard — Promiscope');
    expect(metadata.openGraph?.url).toBe('https://promiscope.example/scout');
  });
});
