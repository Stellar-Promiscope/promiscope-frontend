/**
 * Client for the player's own contact-details vault (issue #1301).
 *
 * Companion to lib/contactReleaseClient.ts, which is the scout's read side.
 * This module is the player's write side: upload/replace the sealed row via
 * `POST /api/contact/vault`, inspect its metadata via `GET`, and delete it
 * via `DELETE`.
 *
 * The request shape deliberately mirrors the server's redaction: the vault
 * route never returns plaintext (see the GET handler's rationale), so this
 * client has no way to read back what was written. `getMetadata` returns
 * only `{ hasContactDetails, updatedAt }`.
 *
 * Injectable for the same reason as the release client: jsdom unit tests
 * stub these functions instead of needing a fetch polyfill, and vault
 * failures stay distinguishable from each other in the UI.
 */
import type { ContactDetails } from '@/types';

/** Existence/age metadata for the caller's own row. Never contains PII. */
export interface ContactVaultMetadata {
  hasContactDetails: boolean;
  updatedAt: number | null;
}

export interface VaultClient {
  getMetadata: (playerId: string) => Promise<ContactVaultMetadata>;
  save: (playerId: string, details: ContactDetails) => Promise<void>;
  remove: (playerId: string) => Promise<void>;
}

async function readError(res: Response, fallback: string): Promise<string> {
  // The server always sends `{error}`; tolerate a non-JSON body anyway so a
  // proxy/HTML error page doesn't surface as "[object Object]".
  const body = await res.json().catch(() => null);
  if (body && typeof body === 'object' && typeof body.error === 'string') {
    return body.error;
  }
  return fallback;
}

export const defaultContactVaultClient: VaultClient = {
  async getMetadata(playerId) {
    const res = await fetch(
      `/api/contact/vault?playerId=${encodeURIComponent(playerId)}`,
    );
    if (!res.ok) {
      throw new Error(
        await readError(res, 'Failed to load contact details status'),
      );
    }
    return (await res.json()) as ContactVaultMetadata;
  },

  async save(playerId, details) {
    const res = await fetch('/api/contact/vault', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, ...details }),
    });
    if (!res.ok) {
      throw new Error(await readError(res, 'Failed to save contact details'));
    }
  },

  async remove(playerId) {
    const res = await fetch(
      `/api/contact/vault?playerId=${encodeURIComponent(playerId)}`,
      { method: 'DELETE' },
    );
    if (!res.ok) {
      throw new Error(await readError(res, 'Failed to delete contact details'));
    }
  },
};
