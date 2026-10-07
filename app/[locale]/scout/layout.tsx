import type { Metadata } from 'next';
import { ReactNode } from 'react';

const ROOT_URL = 'https://promiscope.example';

export const metadata: Metadata = {
  title: 'Scout Dashboard — Promiscope',
  description:
    'Discover and connect with verified football players on Promiscope. Filter by region, position, and progress level.',
  openGraph: {
    title: 'Scout Dashboard — Promiscope',
    description:
      'Discover and connect with verified football players on Promiscope. Filter by region, position, and progress level.',
    url: `${ROOT_URL}/scout`,
    siteName: 'Promiscope',
    type: 'website',
    images: [
      {
        url: `${ROOT_URL}/og-image.svg`,
        width: 1200,
        height: 630,
        alt: 'Scout Dashboard — Promiscope',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Scout Dashboard — Promiscope',
    description:
      'Discover and connect with verified football players on Promiscope. Filter by region, position, and progress level.',
    images: [`${ROOT_URL}/og-image.svg`],
  },
};

export default function ScoutLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
