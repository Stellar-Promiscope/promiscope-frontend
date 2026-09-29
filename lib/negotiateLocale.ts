/**
 * Picks the best supported locale for an `Accept-Language` header
 * (RFC 9110 §12.5.4), issue #1325.
 *
 * - Entries are `tag;q=x`; q defaults to 1, is clamped to 0..1, and q=0
 *   entries are dropped.
 * - Entries are tried by q descending, keeping header order for ties.
 * - Each tag is matched exactly, then by its primary subtag (`fr-CA` → `fr`).
 * - `*` matches the fallback.
 *
 * Pure and dependency-free so it can run in the Edge runtime (middleware.ts).
 */
export function negotiateLocale(
  header: string | null | undefined,
  supported: readonly string[],
  fallback: string,
): string {
  if (!header) return fallback;

  const ranges = header
    .split(',')
    .map((part, index) => {
      const [rawTag, ...params] = part.trim().split(';');
      const tag = rawTag.trim().toLowerCase();
      let q = 1;
      for (const param of params) {
        const [key, value] = param.trim().split('=');
        if (key?.trim().toLowerCase() === 'q') {
          const parsed = Number(value?.trim());
          q = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
        }
      }
      return { tag, q, index };
    })
    .filter(({ tag, q }) => tag.length > 0 && q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);

  const lowerSupported = supported.map((l) => l.toLowerCase());

  for (const { tag } of ranges) {
    if (tag === '*') return fallback;

    const exact = lowerSupported.indexOf(tag);
    if (exact !== -1) return supported[exact];

    const primary = lowerSupported.indexOf(tag.split('-')[0]);
    if (primary !== -1) return supported[primary];
  }

  return fallback;
}
