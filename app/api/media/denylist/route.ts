/**
 * GET /api/media/denylist?cids=a,b,c — which of the given CIDs have been
 * removed by moderation (issue #1320). Used by the profile gallery to render
 * a "removed" placeholder instead of a broken image.
 */
import { NextRequest, NextResponse } from 'next/server';
import { MediaModerationStore } from '@/lib/mediaModerationStore';
import { isValidMediaCid } from '@/lib/mediaModeration';

const MAX_CIDS = 50;

export async function GET(req: NextRequest) {
  const cids = (req.nextUrl.searchParams.get('cids') ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(isValidMediaCid)
    .slice(0, MAX_CIDS);

  return NextResponse.json(
    { denylisted: MediaModerationStore.getInstance().filterDenylisted(cids) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
