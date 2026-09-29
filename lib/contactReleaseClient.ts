import type { ContactDetails } from '@/types';

/**
 * Release-endpoint client, injectable for tests. The default hits the
 * same-origin route; tests stub it. Kept behind this indirection (rather
 * than calling global fetch inline) so jsdom unit tests don't need a fetch
 * polyfill and so release failures stay distinguishable from chain errors.
 */
export type FetchContactRelease = (
  playerId: string,
) => Promise<{ status: number; details?: ContactDetails }>;

export const defaultFetchContactRelease: FetchContactRelease = async (
  playerId,
) => {
  const res = await fetch(`/api/contact/${encodeURIComponent(playerId)}`);
  if (res.ok)
    return {
      status: res.status,
      details: (await res.json()) as ContactDetails,
    };
  return { status: res.status };
};
