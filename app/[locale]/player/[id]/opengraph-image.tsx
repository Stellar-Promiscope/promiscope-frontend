import { ImageResponse } from 'next/og';
import { fetchPlayerProfile } from '@/lib/api';
import { getProgressBadgeLabel } from '@/lib/progress';
import type { Player } from '@/types';

// axios (via fetchPlayerProfile) relies on server-only env vars and Node
// networking, so this route runs on the Node.js runtime rather than the
// edge default for next/og image routes.
export const runtime = 'nodejs';

export const alt = 'Promiscope Player Profile';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Mirrors PROGRESS_LEVELS in lib/progress.ts — Tailwind class colors can't
// be used inside ImageResponse (no CSS pipeline in the Satori renderer), so
// the equivalent hex values are duplicated here for the badge background.
const LEVEL_BADGE_COLOR: Record<number, string> = {
  0: '#4B5563', // gray-600
  1: '#60A5FA', // blue-400
  2: '#FBBF24', // amber-400
  3: '#34D399', // emerald-400
};

const GRADIENT = 'linear-gradient(135deg, #0f172a 0%, #0a0f1e 100%)';

export default async function Image({ params }: { params: { id: string } }) {
  let player: Player | null = null;

  try {
    player = await fetchPlayerProfile(params.id);
  } catch {
    player = null;
  }

  if (!player) {
    return fallbackImage();
  }

  const badgeColor =
    LEVEL_BADGE_COLOR[player.progressLevel] ?? LEVEL_BADGE_COLOR[0];
  const badgeLabel = getProgressBadgeLabel(player.progressLevel);
  const subtitle = [player.vitals.position, player.vitals.region]
    .filter(Boolean)
    .join('  ·  ');

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px',
        background: GRADIENT,
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div
          style={{
            display: 'flex',
            width: 20,
            height: 20,
            borderRadius: 999,
            background: '#00C853',
            marginRight: 12,
          }}
        />
        <div
          style={{
            display: 'flex',
            fontSize: 28,
            fontWeight: 700,
            color: '#f9fafb',
          }}
        >
          Promiscope
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            fontSize: 72,
            fontWeight: 700,
            lineHeight: 1.1,
            color: '#f9fafb',
          }}
        >
          {player.vitals.name}
        </div>
        {subtitle && (
          <div
            style={{
              display: 'flex',
              fontSize: 32,
              color: '#9CA3AF',
              marginTop: 16,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px 28px',
            borderRadius: 999,
            background: badgeColor,
            color: '#0A0F1E',
            fontSize: 28,
            fontWeight: 700,
          }}
        >
          {badgeLabel}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 24,
            color: '#6B7280',
            marginLeft: 20,
          }}
        >
          Progress Level {player.progressLevel}
        </div>
      </div>
    </div>,
    { width: size.width, height: size.height },
  );
}

function fallbackImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: GRADIENT,
      }}
    >
      <div
        style={{
          display: 'flex',
          width: 96,
          height: 96,
          borderRadius: 999,
          background: '#00C853',
          marginBottom: 32,
        }}
      />
      <div
        style={{
          display: 'flex',
          fontSize: 64,
          fontWeight: 700,
          color: '#f9fafb',
        }}
      >
        Promiscope
      </div>
      <div
        style={{
          display: 'flex',
          fontSize: 28,
          color: '#9CA3AF',
          marginTop: 16,
        }}
      >
        Verified Player Profiles
      </div>
    </div>,
    { width: size.width, height: size.height },
  );
}
