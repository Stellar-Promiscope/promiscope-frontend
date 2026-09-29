import { NextRequest } from 'next/server';
import { getSessionWallet } from '@/lib/session';
import {
  SavedSearchStore,
  SavedSearchConflictError,
} from '@/lib/savedSearchStore';
import { createRequestLogger } from '@/lib/logger';
import { sanitizeTextInput } from '@/lib/inputValidation';
import type { PlayerFilter } from '@/types';
import { privateJson } from '@/lib/httpResponses';

// Saved-search name is a short user-authored label — cap at 100 characters.
const SAVED_SEARCH_NAME_MAX = 100;

export const runtime = 'nodejs';

/**
 * Parses an integer version from an ETag or If-Match header value,
 * stripping optional weak validator prefix and surrounding quotes.
 */
function parseVersionHeader(header: string | null): number | undefined {
  if (!header) return undefined;
  const cleaned = header.replace(/^W\//i, '').replace(/^"(.*)"$/, '$1').trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * GET /api/saved-searches
 *
 * Lists the authenticated scout's saved searches. Returns an ETag header
 * reflecting the maximum version among the scout's saved searches.
 */
export async function GET(req: NextRequest) {
  const scoutWallet = getSessionWallet(req);
  if (!scoutWallet) {
    return privateJson({ error: 'Unauthorized' }, { status: 401 });
  }

  const log = createRequestLogger(req);
  try {
    const entries = SavedSearchStore.getInstance().list(scoutWallet);
    const maxVersion = entries.reduce(
      (max, e) => Math.max(max, e.version ?? 1),
      0,
    );
    return privateJson(entries, {
      headers: { ETag: `"${maxVersion}"` },
    });
  } catch (err) {
    log.error('Failed to list saved searches', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return privateJson(
      { error: 'Failed to load saved searches' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/saved-searches
 *
 * Saves a search for the authenticated scout. Body: { name, filter }.
 */
export async function POST(req: NextRequest) {
  const scoutWallet = getSessionWallet(req);
  if (!scoutWallet) {
    return privateJson({ error: 'Unauthorized' }, { status: 401 });
  }

  const log = createRequestLogger(req);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return privateJson({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { name, filter } = body as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim().length === 0) {
    return privateJson(
      { error: 'name must be a non-empty string' },
      { status: 400 },
    );
  }
  if (!filter || typeof filter !== 'object') {
    return privateJson({ error: 'filter must be an object' }, { status: 400 });
  }

  const sanitizedName = sanitizeTextInput(name);
  if (sanitizedName.length > SAVED_SEARCH_NAME_MAX) {
    return privateJson(
      { error: `name must be at most ${SAVED_SEARCH_NAME_MAX} characters` },
      { status: 400 },
    );
  }

  try {
    const entry = SavedSearchStore.getInstance().add(
      scoutWallet,
      sanitizedName,
      filter as PlayerFilter,
    );
    return privateJson(entry, { status: 201 });
  } catch (err) {
    log.error('Failed to save search', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return privateJson({ error: 'Failed to save search' }, { status: 500 });
  }
}

/**
 * PATCH /api/saved-searches
 *
 * Renames a saved search and/or marks it viewed for the authenticated scout.
 * Body: { id, name?, markViewed? } — at least one of `name`/`markViewed`
 * must be present. `markViewed: true` resets the "new since last viewed"
 * baseline to now.
 */
export async function PATCH(req: NextRequest) {
  const scoutWallet = getSessionWallet(req);
  if (!scoutWallet) {
    return privateJson({ error: 'Unauthorized' }, { status: 401 });
  }

  const log = createRequestLogger(req);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return privateJson({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { id, name, markViewed } = body as Record<string, unknown>;
  if (typeof id !== 'number') {
    return privateJson({ error: 'id must be a number' }, { status: 400 });
  }
  if (name === undefined && markViewed === undefined) {
    return privateJson(
      { error: 'name or markViewed must be provided' },
      { status: 400 },
    );
  }

  const ifMatch = req.headers.get('if-match');
  let expectedVersion = parseVersionHeader(ifMatch);
  if (
    expectedVersion === undefined &&
    typeof (body as Record<string, unknown>).version === 'number'
  ) {
    expectedVersion = (body as Record<string, unknown>).version as number;
  }

  if (
    ifMatch === null &&
    (body as Record<string, unknown>).version === undefined
  ) {
    log.warn(
      'PATCH /api/saved-searches missing If-Match header; update applied without optimistic concurrency check',
    );
  }

  try {
    const store = SavedSearchStore.getInstance();
    let updated = null;

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return privateJson(
          { error: 'name must be a non-empty string' },
          { status: 400 },
        );
      }
      const sanitizedName = sanitizeTextInput(name);
      if (sanitizedName.length > SAVED_SEARCH_NAME_MAX) {
        return privateJson(
          {
            error: `name must be at most ${SAVED_SEARCH_NAME_MAX} characters`,
          },
          { status: 400 },
        );
      }
      updated = store.rename(scoutWallet, id, sanitizedName, expectedVersion);
      if (!updated) {
        return privateJson(
          { error: 'Saved search not found' },
          { status: 404 },
        );
      }
    }

    if (markViewed === true) {
      updated = store.markViewed(scoutWallet, id, expectedVersion);
      if (!updated) {
        return privateJson(
          { error: 'Saved search not found' },
          { status: 404 },
        );
      }
    }

    return privateJson(updated, {
      headers: {
        ETag: `"${updated?.version ?? 1}"`,
      },
    });
  } catch (err) {
    if (err instanceof SavedSearchConflictError) {
      return privateJson(
        {
          error: 'conflict',
          message: 'Saved search was modified elsewhere',
          current: err.current,
          currentVersion: err.currentVersion,
        },
        {
          status: 409,
          headers: { ETag: `"${err.currentVersion}"` },
        },
      );
    }
    log.error('Failed to update saved search', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return privateJson(
      { error: 'Failed to update saved search' },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/saved-searches
 *
 * Full update for a saved search. Accepts If-Match or version for concurrency
 * protection and delegates to PATCH logic.
 */
export async function PUT(req: NextRequest) {
  return PATCH(req);
}

/**
 * DELETE /api/saved-searches
 *
 * Removes a saved search for the authenticated scout. Body: { id }.
 * Accepts If-Match or version for optimistic-concurrency protection.
 */
export async function DELETE(req: NextRequest) {
  const scoutWallet = getSessionWallet(req);
  if (!scoutWallet) {
    return privateJson({ error: 'Unauthorized' }, { status: 401 });
  }

  const log = createRequestLogger(req);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return privateJson({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { id } = body as Record<string, unknown>;
  if (typeof id !== 'number') {
    return privateJson({ error: 'id must be a number' }, { status: 400 });
  }

  const ifMatch = req.headers.get('if-match');
  let expectedVersion = parseVersionHeader(ifMatch);
  if (
    expectedVersion === undefined &&
    typeof (body as Record<string, unknown>).version === 'number'
  ) {
    expectedVersion = (body as Record<string, unknown>).version as number;
  }

  if (
    ifMatch === null &&
    (body as Record<string, unknown>).version === undefined
  ) {
    log.warn(
      'DELETE /api/saved-searches missing If-Match header; delete applied without optimistic concurrency check',
    );
  }

  try {
    const removed = SavedSearchStore.getInstance().remove(
      scoutWallet,
      id,
      expectedVersion,
    );
    if (!removed) {
      return privateJson({ error: 'Saved search not found' }, { status: 404 });
    }
    return privateJson({ success: true });
  } catch (err) {
    if (err instanceof SavedSearchConflictError) {
      return privateJson(
        {
          error: 'conflict',
          message: 'Saved search was modified elsewhere',
          current: err.current,
          currentVersion: err.currentVersion,
        },
        {
          status: 409,
          headers: { ETag: `"${err.currentVersion}"` },
        },
      );
    }
    log.error('Failed to remove saved search', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return privateJson(
      { error: 'Failed to remove saved search' },
      { status: 500 },
    );
  }
}
