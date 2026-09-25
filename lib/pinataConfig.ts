/** Pinata API credentials used by the IPFS pin/unpin routes. */
export interface PinataCredentials {
  apiKey: string;
  secret: string;
}

/** Error body returned by upload routes when Pinata is not configured. */
export const PINATA_NOT_CONFIGURED_ERROR = 'IPFS uploads are not configured';

/** Names of the Pinata env vars that are unset (empty when fully configured). */
export function getMissingPinataEnvVars(): string[] {
  return (['PINATA_API_KEY', 'PINATA_SECRET'] as const).filter(
    (name) => !process.env[name],
  );
}

/**
 * Reads Pinata credentials from the environment, or returns `null` when either
 * `PINATA_API_KEY` or `PINATA_SECRET` is unset.
 */
export function getPinataCredentials(): PinataCredentials | null {
  const apiKey = process.env.PINATA_API_KEY;
  const secret = process.env.PINATA_SECRET;
  if (!apiKey || !secret) return null;
  return { apiKey, secret };
}
