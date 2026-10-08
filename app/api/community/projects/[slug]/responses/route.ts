import { NextRequest } from 'next/server';
import { getSessionWallet } from '@/lib/session';
import { ProjectRecordStore } from '@/lib/projectRecordStore';
import { privateJson } from '@/lib/httpResponses';
import { checkRateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const wallet = getSessionWallet(req);
  if (!wallet)
    return privateJson(
      { error: 'Connect a Stellar wallet to respond.' },
      { status: 401 },
    );
  const rate = await checkRateLimit(`project-response:${wallet}`, {
    limit: 30,
    windowMs: 60 * 60 * 1000,
  });
  if (rate.limited)
    return privateJson(
      { error: 'Response limit reached. Try again later.' },
      { status: 429 },
    );
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const updateId = typeof body?.updateId === 'string' ? body.updateId : '';
  const content = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!updateId || !content || content.length > 1000) {
    return privateJson(
      { error: 'Choose an update and write a response of 1–1,000 characters.' },
      { status: 400 },
    );
  }
  try {
    const project = ProjectRecordStore.getInstance().addResponse(
      params.slug,
      wallet,
      updateId,
      content,
    );
    return project
      ? privateJson(project, { status: 201 })
      : privateJson({ error: 'Project update not found.' }, { status: 404 });
  } catch {
    return privateJson(
      { error: 'Could not publish your response.' },
      { status: 500 },
    );
  }
}
