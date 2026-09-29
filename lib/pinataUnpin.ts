import axios from 'axios';
import { getPinataCredentials } from './pinataConfig';

/**
 * Best-effort unpin of a CID from Pinata (issue #1005's cleanup path).
 * Uses the same PINATA_API_KEY/PINATA_SECRET credentials the pin routes
 * already use (app/api/ipfs/upload/route.ts, lib/pinJson.ts). Never throws
 * — a failed unpin (already unpinned, credentials missing, Pinata
 * unavailable) shouldn't block the rest of a cleanup batch; the caller
 * decides what to do with `ok: false`.
 */
export async function unpinFromPinata(
  cid: string,
): Promise<{ ok: boolean; error?: string }> {
  const credentials = getPinataCredentials();
  if (!credentials) {
    return { ok: false, error: 'Pinata credentials are not configured' };
  }

  try {
    await axios.delete(`https://api.pinata.cloud/pinning/unpin/${cid}`, {
      headers: {
        pinata_api_key: credentials.apiKey,
        pinata_secret_api_key: credentials.secret,
      },
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unpin request failed',
    };
  }
}
