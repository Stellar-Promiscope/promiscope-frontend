/**
 * Server-side Cloudflare Turnstile verification for Next.js API routes —
 * the counterpart of server/src/middleware/turnstile.js. When
 * TURNSTILE_SECRET_KEY is unset the check is skipped, matching the
 * project's "leave blank to disable" convention (see ReferralPanel).
 */
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstileToken(
  token: unknown,
  ip?: string,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (typeof token !== 'string' || token.trim().length === 0) return false;

  try {
    const params = new URLSearchParams({ secret, response: token });
    if (ip && ip !== 'unknown') params.set('remoteip', ip);
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const result = (await res.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}
