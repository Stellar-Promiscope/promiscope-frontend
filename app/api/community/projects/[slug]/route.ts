import { NextRequest, NextResponse } from 'next/server';
import { getSessionWallet } from '@/lib/session';
import {
  ProjectRecordStore,
  type MilestoneStatus,
} from '@/lib/projectRecordStore';
import { privateJson } from '@/lib/httpResponses';
import { checkRateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

type RouteContext = { params: { slug: string } };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const project = ProjectRecordStore.getInstance().get(params.slug);
    return project
      ? NextResponse.json(project, {
          headers: {
            'Cache-Control': 'public, max-age=15, stale-while-revalidate=30',
          },
        })
      : NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  } catch {
    return NextResponse.json(
      { error: 'Project records are temporarily unavailable.' },
      { status: 503 },
    );
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const wallet = getSessionWallet(req);
  if (!wallet)
    return privateJson(
      { error: 'Connect a Stellar wallet to publish an update.' },
      { status: 401 },
    );
  const rate = await checkRateLimit(`project-update:${wallet}`, {
    limit: 20,
    windowMs: 60 * 60 * 1000,
  });
  if (rate.limited)
    return privateJson(
      { error: 'Update limit reached. Try again later.' },
      { status: 429 },
    );

  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const content = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!content || content.length > 2000)
    return privateJson(
      { error: 'Write an update of 1–2,000 characters.' },
      { status: 400 },
    );

  let evidenceUrl: string | null = null;
  if (body?.evidenceUrl !== undefined && body.evidenceUrl !== '') {
    if (typeof body.evidenceUrl !== 'string' || body.evidenceUrl.length > 500) {
      return privateJson(
        { error: 'Evidence link must be a URL under 500 characters.' },
        { status: 400 },
      );
    }
    try {
      const parsed = new URL(body.evidenceUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'ipfs:')
        throw new Error('unsupported protocol');
      evidenceUrl = parsed.toString();
    } catch {
      return privateJson(
        { error: 'Evidence links must use HTTPS or IPFS.' },
        { status: 400 },
      );
    }
  }

  try {
    const project = ProjectRecordStore.getInstance().addUpdate(
      params.slug,
      wallet,
      content,
      evidenceUrl,
    );
    return project
      ? privateJson(project, { status: 201 })
      : privateJson(
          { error: 'Project not found or you are not its owner.' },
          { status: 404 },
        );
  } catch {
    return privateJson(
      { error: 'Could not publish the update.' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const wallet = getSessionWallet(req);
  if (!wallet)
    return privateJson(
      { error: 'Connect a Stellar wallet to update milestones.' },
      { status: 401 },
    );
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const milestoneId =
    typeof body?.milestoneId === 'string' ? body.milestoneId : '';
  const status = body?.status;
  if (
    !milestoneId ||
    !['planned', 'in_progress', 'completed'].includes(String(status))
  ) {
    return privateJson(
      { error: 'Choose a milestone and a valid status.' },
      { status: 400 },
    );
  }
  try {
    const project = ProjectRecordStore.getInstance().updateMilestone(
      params.slug,
      wallet,
      milestoneId,
      status as MilestoneStatus,
    );
    return project
      ? privateJson(project)
      : privateJson(
          {
            error: 'Project or milestone not found, or you are not its owner.',
          },
          { status: 404 },
        );
  } catch {
    return privateJson(
      { error: 'Could not update the milestone.' },
      { status: 500 },
    );
  }
}
