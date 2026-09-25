import type { PlayerFilter, SavedSearch } from '@/types';
import { fetchWithRetry } from '@/lib/fetchWithRetry';

/** Client for app/api/saved-searches — same-origin, cookie-authenticated. */

export async function fetchSavedSearches(): Promise<SavedSearch[]> {
  const res = await fetchWithRetry('/api/saved-searches');
  if (!res.ok) throw new Error('Failed to fetch saved searches');
  return res.json();
}

export class SavedSearchConflictError extends Error {
  readonly current?: SavedSearch;
  readonly currentVersion?: number;

  constructor(message: string, current?: SavedSearch, currentVersion?: number) {
    super(message);
    this.name = 'SavedSearchConflictError';
    this.current = current;
    this.currentVersion = currentVersion;
  }
}

// saveSearch/renameSavedSearch/removeSavedSearch deliberately use a bare
// `fetch`, not `fetchWithRetry`: these are mutations with no idempotency
// key, so an automatic retry after a lost response risks e.g. creating a
// duplicate saved search.
export async function saveSearch(
  name: string,
  filter: PlayerFilter,
): Promise<SavedSearch> {
  const res = await fetch('/api/saved-searches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, filter }),
  });
  if (!res.ok) throw new Error('Failed to save search');
  return res.json();
}

export async function renameSavedSearch(
  id: number,
  name: string,
  version?: number,
): Promise<SavedSearch> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (version !== undefined) {
    headers['If-Match'] = `"${version}"`;
  }
  const res = await fetch('/api/saved-searches', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ id, name }),
  });
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    throw new SavedSearchConflictError(
      'Saved search was modified elsewhere',
      body.current,
      body.currentVersion,
    );
  }
  if (!res.ok) throw new Error('Failed to rename saved search');
  return res.json();
}

export async function markSavedSearchViewed(
  id: number,
  version?: number,
): Promise<SavedSearch> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (version !== undefined) {
    headers['If-Match'] = `"${version}"`;
  }
  const res = await fetch('/api/saved-searches', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ id, markViewed: true }),
  });
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    throw new SavedSearchConflictError(
      'Saved search was modified elsewhere',
      body.current,
      body.currentVersion,
    );
  }
  if (!res.ok) throw new Error('Failed to mark saved search viewed');
  return res.json();
}

export async function removeSavedSearch(
  id: number,
  version?: number,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (version !== undefined) {
    headers['If-Match'] = `"${version}"`;
  }
  const res = await fetch('/api/saved-searches', {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ id }),
  });
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    throw new SavedSearchConflictError(
      'Saved search was modified elsewhere',
      body.current,
      body.currentVersion,
    );
  }
  if (!res.ok) throw new Error('Failed to remove saved search');
}
