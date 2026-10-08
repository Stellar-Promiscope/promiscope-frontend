import { NextRequest, NextResponse } from 'next/server';
import { getSessionWallet } from '@/lib/session';
import { ProjectRecordStore } from '@/lib/projectRecordStore';
import { privateJson } from '@/lib/httpResponses';
import { checkRateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json(ProjectRecordStore.getInstance().list(), {
      headers: {
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Project records are temporarily unavailable.' },
      { status: 503 },
    );
  }
}

export async function POST(req: NextRequest) {
  const wallet = getSessionWallet(req);
  if (!wallet)
    return privateJson(
      { error: 'Connect a Stellar wallet to publish a project.' },
      { status: 401 },
    );

  const rate = await checkRateLimit(`project-create:${wallet}`, {
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (rate.limited)
    return privateJson(
      { error: 'Project creation limit reached. Try again later.' },
      { status: 429 },
    );

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return privateJson(
      { error: 'Send project details as JSON.' },
      { status: 400 },
    );
  }
  const data = body as Record<string, unknown>;
  const text = (key: string, max: number, required = true) => {
    const value = data[key];
    if (
      typeof value !== 'string' ||
      (required && !value.trim()) ||
      value.trim().length > max
    )
      return null;
    return value.trim();
  };
  const title = text('title', 100);
  const organization = text('organization', 100);
  const location = text('location', 100);
  const category = text('category', 60);
  const summary = text('summary', 600);
  const commitment = text('commitment', 2000);
  const rawMilestones = data.milestones;
  if (
    !title ||
    !organization ||
    !location ||
    !category ||
    !summary ||
    !commitment ||
    !Array.isArray(rawMilestones) ||
    rawMilestones.length < 1 ||
    rawMilestones.length > 12
  ) {
    return privateJson(
      {
        error:
          'Complete every project field and add between 1 and 12 milestones.',
      },
      { status: 400 },
    );
  }
  const milestones: { title: string; detail: string }[] = [];
  for (const item of rawMilestones) {
    if (!item || typeof item !== 'object')
      return privateJson(
        { error: 'Each milestone needs a title and description.' },
        { status: 400 },
      );
    const milestone = item as Record<string, unknown>;
    if (
      typeof milestone.title !== 'string' ||
      !milestone.title.trim() ||
      milestone.title.trim().length > 120 ||
      typeof milestone.detail !== 'string' ||
      milestone.detail.trim().length > 500
    ) {
      return privateJson(
        {
          error:
            'Milestone titles are required (120 characters max); descriptions may be up to 500 characters.',
        },
        { status: 400 },
      );
    }
    milestones.push({
      title: milestone.title.trim(),
      detail: milestone.detail.trim(),
    });
  }

  try {
    const project = ProjectRecordStore.getInstance().create({
      title,
      organization,
      location,
      category,
      summary,
      commitment,
      ownerWallet: wallet,
      milestones,
    });
    return privateJson(project, { status: 201 });
  } catch {
    return privateJson(
      { error: 'Could not publish this project. Please try again.' },
      { status: 500 },
    );
  }
}
