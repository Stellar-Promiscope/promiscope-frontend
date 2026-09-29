import { NextRequest } from 'next/server';
import { getSessionWallet } from '@/lib/session';
import { ContactVaultStore } from '@/lib/contactVaultStore';
import { sealContactDetails } from '@/lib/contactVaultCrypto';
import { isValidStellarAddress, normalizeStellarAddress } from '@/lib/stellar';
import { createRequestLogger } from '@/lib/logger';
import { privateJson } from '@/lib/httpResponses';
import type { ContactDetails } from '@/types';

export const runtime = 'nodejs';

const MAX_FIELD_LENGTH = 320;

function isValidDetails(body: unknown): body is ContactDetails {
  if (!body || typeof body !== 'object') return false;
  const { email, phone, telegram } = body as Record<string, unknown>;
  const fields = [email, phone, telegram].filter(
    (f): f is string => typeof f === 'string' && f.trim().length > 0,
  );
  // At least one contact channel, mirroring the on-chain invariant
  // (types/index.ts#ContactDetails) so the vault never stores an empty row.
  if (fields.length === 0) return false;
  return fields.every((f) => f.length <= MAX_FIELD_LENGTH);
}

/**
 * GET /api/contact/vault?playerId=G...
 *
 * Ownership + existence metadata for the settings form, and NOTHING else.
 *
 * Deliberately does NOT return the stored contact details, not even to the
 * owner. Unsealing here would re-serve plaintext PII over the wire and
 * park it in the DOM, and the sealed box offers no advantage over the
 * release endpoint anyway: every unlock requires a fresh on-chain payment,
 * so a "remember my details" prefilled form would let anyone who later
 * borrows the player's browser (or reads the DOM) skip the paywall that the
 * scout must pay. The form is therefore blind-write: it shows whether a row
 * exists and when it was last changed, and re-submitting replaces the row
 * wholesale. See docs/contact-details-encryption.md#no-read-your-own-plaintext.
 */
export async function GET(req: NextRequest) {
  const wallet = getSessionWallet(req);
  if (!wallet) {
    return privateJson({ error: 'Unauthorized' }, { status: 401 });
  }

  const playerId = req.nextUrl.searchParams.get('playerId');
  if (!playerId) {
    return privateJson(
      { error: 'playerId query param is required' },
      { status: 400 },
    );
  }
  const normalizedPlayerId = normalizeStellarAddress(playerId);
  if (!isValidStellarAddress(normalizedPlayerId)) {
    return privateJson(
      { error: 'playerId must be a valid Stellar public key (G...)' },
      { status: 400 },
    );
  }
  // Ownership, same as POST/DELETE: a player manages their own row only.
  if (normalizeStellarAddress(wallet) !== normalizedPlayerId) {
    return privateJson(
      { error: 'You can only manage your own contact details' },
      { status: 403 },
    );
  }

  try {
    const record = ContactVaultStore.getInstance().get(normalizedPlayerId);
    if (!record) {
      return privateJson({
        hasContactDetails: false,
        updatedAt: null,
      });
    }
    // Which channels are set is not a secret (the player supplied it), but
    // it's also not needed — the form replaces all fields on save. Report
    // only existence and age.
    return privateJson({
      hasContactDetails: true,
      updatedAt: record.updatedAt,
    });
  } catch (err) {
    createRequestLogger(req).error('Failed to read contact vault metadata', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return privateJson(
      { error: 'Failed to load contact details status' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/contact/vault
 *
 * The player uploads their own contact details; the server seals them with
 * AES-256-GCM (lib/contactVaultCrypto.ts) before insert. Plaintext never
 * touches the database, the chain, or IPFS.
 *
 * Body: { playerId, email?, phone?, telegram? } — at least one channel.
 * Only the player themselves (their wallet IS their player id in this app,
 * or a verified session of it) may write their own row.
 */
export async function POST(req: NextRequest) {
  const wallet = getSessionWallet(req);
  if (!wallet) {
    return privateJson({ error: 'Unauthorized' }, { status: 401 });
  }

  const log = createRequestLogger(req);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return privateJson({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { playerId, ...details } = body as Record<string, unknown>;
  if (typeof playerId !== 'string' || playerId.length === 0) {
    return privateJson(
      { error: 'playerId must be a non-empty string' },
      { status: 400 },
    );
  }
  const normalizedPlayerId = normalizeStellarAddress(playerId);
  if (!isValidStellarAddress(normalizedPlayerId)) {
    return privateJson(
      { error: 'playerId must be a valid Stellar public key (G...)' },
      { status: 400 },
    );
  }
  // Ownership: a player may only vault their own contact details. The
  // player id doubles as the player's wallet (see lib/notifications.ts),
  // so the session wallet must match the row being written.
  if (normalizeStellarAddress(wallet) !== normalizedPlayerId) {
    return privateJson(
      { error: 'You can only manage your own contact details' },
      { status: 403 },
    );
  }
  if (!isValidDetails(details)) {
    return privateJson(
      {
        error:
          'At least one of email, phone, telegram must be a non-empty string (max 320 chars)',
      },
      { status: 400 },
    );
  }

  try {
    const sealed = sealContactDetails(JSON.stringify(details));
    ContactVaultStore.getInstance().upsert(
      normalizedPlayerId,
      normalizedPlayerId,
      sealed,
    );
    // Metadata only — never log contact values (lib/logger.ts redacts
    // contact-shaped keys as a backstop, but don't log them at all).
    log.info('Contact vault updated', { playerId: normalizedPlayerId });
    return privateJson({ success: true }, { status: 201 });
  } catch (err) {
    log.error('Failed to store contact details', {
      reason: err instanceof Error ? err.message : String(err),
    });
    const message =
      err instanceof Error &&
      err.message.includes('CONTACT_VAULT_KEY is not configured')
        ? 'Contact vault is not configured'
        : 'Failed to store contact details';
    return privateJson({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/contact/vault?playerId=G...
 *
 * Removes the caller's own vault row (account deletion / rotation).
 */
export async function DELETE(req: NextRequest) {
  const wallet = getSessionWallet(req);
  if (!wallet) {
    return privateJson({ error: 'Unauthorized' }, { status: 401 });
  }

  const log = createRequestLogger(req);
  const playerId = req.nextUrl.searchParams.get('playerId');
  if (!playerId) {
    return privateJson(
      { error: 'playerId query param is required' },
      { status: 400 },
    );
  }
  const normalizedPlayerId = normalizeStellarAddress(playerId);
  if (!isValidStellarAddress(normalizedPlayerId)) {
    return privateJson(
      { error: 'playerId must be a valid Stellar public key (G...)' },
      { status: 400 },
    );
  }
  if (normalizeStellarAddress(wallet) !== normalizedPlayerId) {
    return privateJson(
      { error: 'You can only manage your own contact details' },
      { status: 403 },
    );
  }

  try {
    const removed = ContactVaultStore.getInstance().remove(normalizedPlayerId);
    if (!removed) {
      return privateJson(
        { error: 'No contact details stored' },
        { status: 404 },
      );
    }
    log.info('Contact vault deleted', { playerId: normalizedPlayerId });
    return privateJson({ success: true });
  } catch (err) {
    log.error('Failed to delete contact details', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return privateJson(
      { error: 'Failed to delete contact details' },
      { status: 500 },
    );
  }
}
