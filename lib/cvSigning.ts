import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto';
import type { CvSigningPayload } from '@/lib/cvVerification';

function base64UrlEncode(value: string | Uint8Array): string {
  return Buffer.from(
    typeof value === 'string' ? value : new Uint8Array(value),
  ).toString('base64url');
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function getPrivateKey() {
  const secret = process.env.CV_SIGNING_SECRET;
  if (!secret) throw new Error('CV_SIGNING_SECRET is not configured');
  return createPrivateKey(secret);
}

function getPublicKey() {
  const configured = process.env.CV_SIGNING_PUBLIC_KEY;
  return configured ? createPublicKey(configured) : createPublicKey(getPrivateKey());
}

export function hashCanonicalCvContent(canonicalContent: string): string {
  return createHash('sha256').update(canonicalContent).digest('hex');
}

export function createCvToken(payload: CvSigningPayload): string {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(
    null,
    new Uint8Array(Buffer.from(encodedPayload)),
    getPrivateKey(),
  );
  return `${encodedPayload}.${base64UrlEncode(signature)}`;
}

export function verifyCvToken(token: string): CvSigningPayload | null {
  const [encodedPayload, encodedSignature, ...extra] = token.split('.');
  if (!encodedPayload || !encodedSignature || extra.length > 0) return null;

  try {
    const valid = verify(
      null,
      Buffer.from(encodedPayload),
      getPublicKey(),
      new Uint8Array(base64UrlDecode(encodedSignature)),
    );
    if (!valid) return null;

    const payload = JSON.parse(
      base64UrlDecode(encodedPayload).toString('utf8'),
    ) as CvSigningPayload;
    if (
      typeof payload.playerId !== 'string' ||
      typeof payload.contentHash !== 'string' ||
      typeof payload.exportedAt !== 'number' ||
      !Array.isArray(payload.ledger)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
