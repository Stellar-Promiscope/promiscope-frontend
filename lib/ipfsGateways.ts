/**
 * Ordered list of fallback IPFS gateways used when the primary gateway
 * returns a 4xx or 5xx response or times out.
 *
 * Shared by the client-side fetch fallback (lib/ipfs.ts) and the media proxy
 * route (app/api/media/[cid]/route.ts). Keep this module free of Node-only
 * APIs so both client and server code can import it. Every host listed here
 * must also appear in next.config.js `images.remotePatterns`.
 */
export const IPFS_FALLBACK_GATEWAYS: readonly string[] = [
  'https://ipfs.io/ipfs',
  'https://dweb.link/ipfs',
];
