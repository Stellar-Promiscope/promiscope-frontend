import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';
import { BRAND_NAME } from '@/lib/brand';

// Raster (PNG) Open Graph image for every page under [locale] that doesn't
// define its own. Facebook, LinkedIn, X, WhatsApp and Slack don't render SVG
// OG images, so this replaces the old /og-image.svg reference.
export const alt = 'Promiscope — Community project accountability';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({
  params,
}: {
  params: { locale: string };
}) {
  const t = await getTranslations({ locale: params.locale, namespace: 'meta' });

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '80px',
        background: 'linear-gradient(135deg, #f6f5ef 0%, #e8efe6 100%)',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
        fontSize: 92,
          fontWeight: 800,
        color: '#245d49',
        }}
      >
        {BRAND_NAME}
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 24,
          fontSize: 44,
          color: '#182923',
          lineHeight: 1.2,
        }}
      >
        {t('title').replace(/^Promiscope — /, '')}
      </div>
    </div>,
    size,
  );
}
