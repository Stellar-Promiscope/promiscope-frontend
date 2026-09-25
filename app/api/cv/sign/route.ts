import { NextRequest, NextResponse } from 'next/server';
import { getMilestoneHistory, getPlayer } from '@/lib/contract';
import { fetchPlayerEvents } from '@/lib/indexerClient';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { buildCvContent, canonicalizeCvContent } from '@/lib/cvVerification';
import { createCvToken, hashCanonicalCvContent } from '@/lib/cvSigning';
import type { Milestone, Player } from '@/types';

export const runtime = 'nodejs';

const RATE_LIMIT = 10;
const WINDOW_MS = 60 * 1000;
const MAX_INDEXER_PAGES = 10;

async function getLedgerReferences(playerId: string, milestones: Milestone[]) {
  const ledgerByMilestone = new Map<string, number>();
  let before: number | undefined;

  for (let page = 0; page < MAX_INDEXER_PAGES; page++) {
    const result = await fetchPlayerEvents(playerId, {
      type: 'milestone_approved',
      limit: 200,
      before,
    });
    for (const event of result.events) {
      const milestoneId = event.data.milestone_id;
      if (typeof milestoneId === 'string') {
        ledgerByMilestone.set(milestoneId, event.ledger);
      }
    }
    if (result.nextCursor === null) break;
    before = result.nextCursor;
  }

  return milestones
    .map((milestone) => ({
      milestoneId: milestone.id,
      ledger: ledgerByMilestone.get(milestone.id),
    }))
    .filter(
      (reference): reference is { milestoneId: string; ledger: number } =>
        typeof reference.ledger === 'number',
    )
    .sort((left, right) => left.milestoneId.localeCompare(right.milestoneId));
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rateLimit = await checkRateLimit(`cv-sign:${ip}`, {
    limit: RATE_LIMIT,
    windowMs: WINDOW_MS,
  });
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many CV export requests. Please try again shortly.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSec ?? 60) },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { playerId, contentHash } = (body ?? {}) as Record<string, unknown>;
  if (typeof playerId !== 'string' || !playerId || typeof contentHash !== 'string') {
    return NextResponse.json(
      { error: 'playerId and contentHash are required' },
      { status: 400 },
    );
  }

  try {
    const player = (await getPlayer(playerId)) as Player;
    const milestones = ((await getMilestoneHistory(playerId)) as Milestone[]) ?? [];
    const content = buildCvContent(player, milestones);
    const canonicalContent = canonicalizeCvContent(content);
    const currentHash = hashCanonicalCvContent(canonicalContent);

    if (currentHash !== contentHash) {
      return NextResponse.json(
        { error: 'Player data changed while the CV was being prepared.' },
        { status: 409 },
      );
    }

    const ledger = await getLedgerReferences(playerId, milestones);
    if (ledger.length !== milestones.length) {
      return NextResponse.json(
        { error: 'The ledger references are not ready yet. Please try again.' },
        { status: 503 },
      );
    }

    const payload = {
      playerId,
      contentHash: currentHash,
      exportedAt: Math.floor(Date.now() / 1000),
      ledger,
    };

    return NextResponse.json({
      token: createCvToken(payload),
      contentHash: currentHash,
      ledger,
    });
  } catch {
    return NextResponse.json(
      { error: 'Unable to verify the player data for export.' },
      { status: 502 },
    );
  }
}
