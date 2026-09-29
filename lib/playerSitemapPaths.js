/**
 * Build-time player profile entries for next-sitemap (issue #1350).
 *
 * Player ids come from the indexer's `player_registered` events; `lastmod`
 * is the latest registration/milestone event for that player. Players whose
 * registration event is flagged `archived` or who are listed in
 * SITEMAP_PLAYER_DENYLIST (comma-separated ids) are left out.
 */
const LOCALES = ['en', 'fr', 'sw'];
const PAGE_LIMIT = 500;

async function fetchAllEvents(indexerUrl, type, fetchImpl) {
  const events = [];
  let before;
  for (;;) {
    const params = new URLSearchParams({ type, limit: String(PAGE_LIMIT) });
    if (before != null) params.set('before', String(before));
    const res = await fetchImpl(`${indexerUrl}/events?${params}`);
    if (!res.ok) throw new Error(`Indexer returned ${res.status}`);
    const page = await res.json();
    events.push(...(page.events ?? []));
    if (page.nextCursor == null) return events;
    before = page.nextCursor;
  }
}

async function getPlayerSitemapPaths({
  siteUrl,
  indexerUrl = process.env.NEXT_PUBLIC_INDEXER_API_URL ??
    'http://localhost:3001',
  denylist = (process.env.SITEMAP_PLAYER_DENYLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  fetchImpl = fetch,
} = {}) {
  let registered;
  let milestones;
  try {
    [registered, milestones] = await Promise.all([
      fetchAllEvents(indexerUrl, 'player_registered', fetchImpl),
      fetchAllEvents(indexerUrl, 'milestone_approved', fetchImpl),
    ]);
  } catch (err) {
    // Don't fail the whole build if the indexer is unreachable.
    console.warn(`[sitemap] skipping player URLs: ${err.message}`);
    return [];
  }

  const denied = new Set(denylist);
  const lastEvent = new Map();
  for (const e of registered) {
    if (!e.playerId || e.data?.archived === true || denied.has(e.playerId)) {
      continue;
    }
    lastEvent.set(e.playerId, e.timestamp);
  }
  for (const e of milestones) {
    const prev = lastEvent.get(e.playerId);
    if (prev != null && e.timestamp > prev)
      lastEvent.set(e.playerId, e.timestamp);
  }

  const paths = [];
  for (const [id, ts] of lastEvent) {
    const suffix = `/player/${encodeURIComponent(id)}`;
    const alternateRefs = LOCALES.map((locale) => ({
      href: `${siteUrl}/${locale}${suffix}`,
      hreflang: locale,
      hrefIsAbsolute: true,
    }));
    // Indexer timestamps are ledger close times in seconds.
    const lastmod = new Date(ts * 1000).toISOString();
    for (const locale of LOCALES) {
      paths.push({
        loc: `/${locale}${suffix}`,
        lastmod,
        changefreq: 'weekly',
        priority: 0.7,
        alternateRefs,
      });
    }
  }
  return paths;
}

module.exports = { getPlayerSitemapPaths, LOCALES };
