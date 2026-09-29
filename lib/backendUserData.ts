import {
  createClient,
  BACKEND_READ_TIMEOUT_MS,
  BACKEND_WRITE_TIMEOUT_MS,
} from './httpClient';

/**
 * Server-only client for the Express backend's wallet-scoped export and
 * deletion endpoints (server/src/routes/users.js, issue #1352). Authenticates
 * with a service credential plus the wallet already verified from the
 * session cookie — never call this from the browser.
 */
const backend = createClient('backend-user-data', {
  timeoutMs: BACKEND_READ_TIMEOUT_MS,
  writeTimeoutMs: BACKEND_WRITE_TIMEOUT_MS,
  baseURL:
    process.env.API_URL_INTERNAL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:4000',
  headers: { 'Content-Type': 'application/json' },
});

export interface BackendUserData {
  referralCodes: unknown[];
  referralRedemptions: unknown[];
  academiesOwned: unknown[];
  academyMembership: unknown | null;
  academyMembersAdded: unknown[];
  milestoneSubmissions: unknown[];
  milestoneSubmissionsReviewed: unknown[];
}

export interface BackendDeletionResult {
  removed: Record<string, number>;
  anonymized: Record<string, number>;
}

export function isBackendUserDataConfigured(): boolean {
  return Boolean(process.env.BACKEND_SERVICE_TOKEN);
}

function authHeaders(wallet: string) {
  return {
    Authorization: `Bearer ${process.env.BACKEND_SERVICE_TOKEN}`,
    'X-Wallet': wallet,
  };
}

export async function fetchBackendUserData(
  wallet: string,
): Promise<BackendUserData> {
  const { data } = await backend.get('/users/me/export', {
    headers: authHeaders(wallet),
  });
  return data;
}

export async function deleteBackendUserData(
  wallet: string,
): Promise<BackendDeletionResult> {
  const { data } = await backend.delete('/users/me', {
    headers: authHeaders(wallet),
  });
  return data;
}
