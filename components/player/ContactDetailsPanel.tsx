'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2, Mail, Phone, Send } from 'lucide-react';
import { useWallet } from '@/hooks/useWallet';
import { useToast } from '@/components/ui/Toast';
import Input from '@/components/ui/Input';
import {
  defaultContactVaultClient,
  type ContactVaultMetadata,
  type VaultClient,
} from '@/lib/contactVaultClient';
import type { ContactDetails } from '@/types';

const MAX_FIELD_LENGTH = 320;

interface ContactDetailsPanelProps {
  /** Injected in tests; defaults to the same-origin vault client. */
  client?: VaultClient;
}

type FormState = { email: string; phone: string; telegram: string };

const EMPTY_FORM: FormState = { email: '', phone: '', telegram: '' };

/**
 * Settings panel where a PLAYER publishes the contact details that paying
 * scouts will receive (issue #1301).
 *
 * This is the write half of the off-chain vault that replaces the contract's
 * plaintext `pay_to_contact` return value. Without this panel there is no way
 * to create a vault row, the release endpoint always answers 404, and
 * every unlock silently falls back to the world-readable chain return
 * value — i.e. the paywall stays open. See
 * docs/contact-details-encryption.md.
 *
 * Two deliberate choices:
 *
 * - **Blind write.** The form never reads back what is stored; it only shows
 *   whether a row exists and when it last changed. Saving replaces all three
 *   fields wholesale. Fetching the plaintext back to prefill it would put PII
 *   in the DOM and would hand a fresh unlock to anyone who later uses this
 *   browser, defeating the per-unlock paywall.
 * - **No persistence.** Field values live in component state only and are
 *   wiped on save, on unmount, and on wallet disconnect. They are
 *   deliberately not written to sessionStorage/localStorage — the same rule
 *   lib/contactDetailsCache.ts enforces on the scout's read side.
 */
export default function ContactDetailsPanel({
  client = defaultContactVaultClient,
}: ContactDetailsPanelProps) {
  const t = useTranslations('settings.contact');
  const { publicKey, isAuthenticated } = useWallet();
  const { show } = useToast();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [meta, setMeta] = useState<ContactVaultMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadMeta = useCallback(async () => {
    if (!isAuthenticated || !publicKey) return;
    setLoading(true);
    try {
      setMeta(await client.getMetadata(publicKey));
    } catch {
      // Status is advisory; the form still works as a blind write, so a
      // failed read must not block saving.
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, [client, isAuthenticated, publicKey]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  // Never leave a player's plaintext sitting in a detached component's
  // state (e.g. right after a wallet switch or disconnect).
  useEffect(() => () => setForm(EMPTY_FORM), []);

  const setField = (field: keyof FormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const busy = saving || deleting;

  async function handleSave() {
    if (!publicKey || busy) return;

    const trimmed: ContactDetails = {
      email: form.email.trim(),
      phone: form.phone.trim(),
      telegram: form.telegram.trim(),
    };
    if (!trimmed.email && !trimmed.phone && !trimmed.telegram) {
      show({ message: t('need_one_channel'), variant: 'error' });
      return;
    }
    if (
      Object.values(trimmed).some((v) => (v ?? '').length > MAX_FIELD_LENGTH)
    ) {
      show({ message: t('too_long'), variant: 'error' });
      return;
    }

    setSaving(true);
    try {
      await client.save(publicKey, trimmed);
      // Drop the plaintext from component state as soon as the server has
      // it sealed — there is no reason to keep it around afterwards.
      setForm(EMPTY_FORM);
      show({ message: t('saved'), variant: 'success' });
      await loadMeta();
    } catch (err) {
      show({
        message: err instanceof Error ? err.message : t('save_error'),
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!publicKey || busy) return;
    setDeleting(true);
    try {
      await client.remove(publicKey);
      setForm(EMPTY_FORM);
      setMeta({ hasContactDetails: false, updatedAt: null });
      show({ message: t('deleted'), variant: 'success' });
    } catch (err) {
      show({
        message: err instanceof Error ? err.message : t('delete_error'),
        variant: 'error',
      });
    } finally {
      setDeleting(false);
    }
  }

  if (!isAuthenticated) {
    return <p className="text-sm text-gray-500">{t('connect_wallet')}</p>;
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-gray-400">
        {t('description')}
      </p>

      <p className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2 text-xs leading-relaxed text-gray-500">
        {t('encryption_note')}
      </p>

      {meta?.hasContactDetails ? (
        <p className="text-xs text-brand-green" role="status">
          {meta.updatedAt
            ? t('stored_at', {
                date: new Date(meta.updatedAt).toLocaleDateString(),
              })
            : t('stored')}
        </p>
      ) : (
        <p className="text-xs text-gray-500" role="status">
          {loading ? t('loading') : t('not_stored')}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="contact-email"
          label={t('email_label')}
          type="email"
          autoComplete="off"
          placeholder="you@example.com"
          maxLength={MAX_FIELD_LENGTH}
          value={form.email}
          onChange={(e) => setField('email')(e.target.value)}
          disabled={busy}
        />
        <Input
          id="contact-phone"
          label={t('phone_label')}
          type="tel"
          autoComplete="off"
          placeholder="+1 555 0100"
          maxLength={MAX_FIELD_LENGTH}
          value={form.phone}
          onChange={(e) => setField('phone')(e.target.value)}
          disabled={busy}
        />
        <Input
          id="contact-telegram"
          label={t('telegram_label')}
          type="text"
          autoComplete="off"
          placeholder="@yourhandle"
          maxLength={MAX_FIELD_LENGTH}
          value={form.telegram}
          onChange={(e) => setField('telegram')(e.target.value)}
          disabled={busy}
        />
      </div>

      <p className="text-xs text-gray-500">{t('replace_hint')}</p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-brand-green/40 bg-brand-green/10 px-5 py-2.5 text-sm font-semibold text-brand-green transition hover:bg-brand-green/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Mail size={15} />
          {saving ? t('saving') : t('save_button')}
        </button>

        {meta?.hasContactDetails && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-5 py-2.5 text-sm font-semibold text-red-400 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={15} />
            {deleting ? t('deleting') : t('delete_button')}
          </button>
        )}
      </div>

      <div className="flex items-start gap-3 border-t border-gray-800 pt-4 text-xs leading-relaxed text-gray-500">
        <Send size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{t('paywall_note')}</span>
      </div>
    </div>
  );
}
