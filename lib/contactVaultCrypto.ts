/**
 * Envelope encryption for player contact details (issue #1301).
 *
 * Finding: `pay_to_contact` returns `ContactDetails` as its on-chain return
 * value (`lib/contract.ts#payToContact`), and Soroban return values +
 * contract storage are world-readable — a free `simulateTransaction` by any
 * account, or a `getLedgerEntries` read of contract state, yields the same
 * plaintext without paying. The on-chain gate is therefore cosmetic until
 * the contract stops returning/storing PII.
 *
 * This module is the off-chain half of the fix: players upload contact
 * details to the backend vault (`POST /api/contact/vault`), where they are
 * encrypted with AES-256-GCM under a server-side key before touching disk.
 * Scouts retrieve them only through `GET /api/contact/:playerId`, which
 * requires (a) an authenticated session and (b) a `player_contacted` payment
 * proof in the indexer (see lib/contactAccess.ts). Plaintext exists only in
 * process memory during encrypt/decrypt — never on-chain, never in IPFS,
 * never in logs (lib/logger.ts already redacts contact-shaped keys).
 *
 * Key management: the 256-bit data key comes from `CONTACT_VAULT_KEY`
 * (hex or base64). It must be a long random value
 * (`openssl rand -hex 32`), stored only in the hosting environment, and
 * rotated by re-encrypting vault rows. Key handling is deliberately boring:
 * no per-scout keys (the player is offline at pay time, so per-scout
 * encryption is impossible without interaction), no key escrow in the
 * client bundle.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCMTypes,
} from 'crypto';

const ALGORITHM: CipherGCMTypes = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

// NOTE: this module avoids Buffer on purpose. @types/node >=22 types
// Buffer's backing as ArrayBufferLike (possibly SharedArrayBuffer), which
// is not assignable to the Uint8Array<ArrayBuffer> the node:crypto typings
// now demand (same root cause as lib/session.ts's timingSafeEqual note).
// Everything here is Uint8Array + base64 strings; runtime behaviour is
// identical.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function getVaultKey(): Uint8Array {
  const raw = process.env.CONTACT_VAULT_KEY;
  if (!raw) {
    throw new Error(
      'CONTACT_VAULT_KEY is not configured. Generate one with `openssl rand -hex 32` ' +
        'and set it in the hosting environment (see .env.example).',
    );
  }
  const trimmed = raw.trim();
  let key: Uint8Array;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    key = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      key[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
  } else {
    key = base64ToBytes(trimmed);
  }
  if (key.length !== 32) {
    throw new Error(
      'CONTACT_VAULT_KEY must decode to exactly 32 bytes (64 hex chars or 44 base64 chars).',
    );
  }
  return key;
}

export interface SealedContactDetails {
  /** base64 nonce — stored alongside the ciphertext, not secret. */
  iv: string;
  /** base64 AES-GCM ciphertext (auth tag appended). */
  ciphertext: string;
}

/** Encrypts contact-details JSON. Plaintext never leaves this call's scope. */
export function sealContactDetails(
  plaintextJson: string,
): SealedContactDetails {
  const key = getVaultKey();
  // `new Uint8Array(buffer)` copy (not Uint8Array.from): sidesteps the
  // @types/node-vs-DOM-lib generic mismatch documented in
  // lib/uploadVerification.ts — Buffer's ArrayBufferLike backing doesn't
  // satisfy the Uint8Array<ArrayBuffer> node:crypto typings demand.
  const iv = new Uint8Array(randomBytes(IV_BYTES));
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const head = new Uint8Array(cipher.update(plaintextJson, 'utf8'));
  const tail = new Uint8Array(cipher.final());
  const authTag = new Uint8Array(cipher.getAuthTag());
  return {
    iv: bytesToBase64(iv),
    // Auth tag appended so the store needs a single blob column.
    ciphertext: bytesToBase64(concatBytes(head, tail, authTag)),
  };
}

/**
 * Decrypts a vault row. Throws (never returns partial plaintext) when the
 * ciphertext was tampered with or the key is wrong — AES-GCM authentication
 * failure surfaces as an exception from `decipher.final()`.
 */
export function unsealContactDetails(sealed: SealedContactDetails): string {
  const key = getVaultKey();
  const iv = base64ToBytes(sealed.iv);
  const combined = base64ToBytes(sealed.ciphertext);
  if (iv.length !== IV_BYTES || combined.length < AUTH_TAG_BYTES) {
    throw new Error('Malformed sealed contact details.');
  }
  const ciphertext = combined.slice(0, combined.length - AUTH_TAG_BYTES);
  const authTag = combined.slice(combined.length - AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const head = new Uint8Array(decipher.update(ciphertext));
  const tail = new Uint8Array(decipher.final());
  return new TextDecoder().decode(concatBytes(head, tail));
}
