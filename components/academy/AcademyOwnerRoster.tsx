'use client';

/**
 * AcademyOwnerRoster (issue #1173)
 *
 * Scoped self-service roster management for an academy's recorded
 * `ownerWallet` — add/remove signer wallets on the academy/academies this
 * connected wallet owns, without needing the platform super-admin. This is
 * the academy-owner counterpart to `components/admin/AcademyManager.tsx`
 * (super-admin, any academy); the two share the same underlying
 * `app/api/admin/academies/[id]/members/**` routes, which now authorize
 * either role server-side (see lib/academyAuth.ts) — this component simply
 * can't reach (and never calls) the super-admin-only list/create routes.
 *
 * Deliberately does not offer academy creation — see
 * docs/academy-validator-model.md and the issue's scope note: "roster
 * add/remove only, matching what the super-admin can already do."
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/Toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import TruncatedAddress from '@/components/ui/TruncatedAddress';
import { checkIsValidator } from '@/lib/contract';
import {
  fetchMyAcademies,
  addAcademyMember,
  removeAcademyMember,
} from '@/lib/api';
import type { Academy } from '@/types';

function isStellarAddress(value: string): boolean {
  return value.startsWith('G') && value.length === 56;
}

type DialogState =
  | { action: 'add-member'; academyId: string; wallet: string }
  | { action: 'remove-member'; academyId: string; wallet: string }
  | null;

export default function AcademyOwnerRoster() {
  const t = useTranslations('academy.roster');
  const { show } = useToast();

  const [academies, setAcademies] = useState<Academy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [memberInputs, setMemberInputs] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<DialogState>(null);

  const [onChainStatus, setOnChainStatus] = useState<
    Record<string, boolean | null>
  >({});

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    fetchMyAcademies()
      .then(setAcademies)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const wallets = academies.flatMap((a) => a.members.map((m) => m.wallet));
    const unchecked = wallets.filter((w) => !(w in onChainStatus));
    if (unchecked.length === 0) return;

    unchecked.forEach((wallet) => {
      checkIsValidator(wallet)
        .then((isValidator) =>
          setOnChainStatus((s) => ({ ...s, [wallet]: Boolean(isValidator) })),
        )
        .catch(() => setOnChainStatus((s) => ({ ...s, [wallet]: null })));
    });
    // Only re-run when the set of known member wallets changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academies]);

  async function handleAddMember(academyId: string) {
    const wallet = (memberInputs[academyId] ?? '').trim();
    if (!isStellarAddress(wallet)) return;
    setActionLoading(true);
    try {
      const academy = await addAcademyMember(academyId, wallet);
      setAcademies((list) =>
        list.map((a) => (a.id === academyId ? academy : a)),
      );
      setMemberInputs((s) => ({ ...s, [academyId]: '' }));
      show({ message: t('addSuccess'), variant: 'success' });
    } catch (e: any) {
      show({
        message: e?.message ?? t('addFailed'),
        variant: 'error',
      });
    } finally {
      setActionLoading(false);
      setDialog(null);
    }
  }

  async function handleRemoveMember(academyId: string, wallet: string) {
    setActionLoading(true);
    try {
      await removeAcademyMember(academyId, wallet);
      setAcademies((list) =>
        list.map((a) =>
          a.id === academyId
            ? { ...a, members: a.members.filter((m) => m.wallet !== wallet) }
            : a,
        ),
      );
      show({ message: t('removeSuccess'), variant: 'success' });
    } catch (e: any) {
      show({
        message: e?.message ?? t('removeFailed'),
        variant: 'error',
      });
    } finally {
      setActionLoading(false);
      setDialog(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-400">{t('loading')}</p>;
  }

  if (error) {
    return (
      <p className="text-sm text-red-400">
        {t('loadFailed')}{' '}
        <button onClick={load} className="underline hover:text-red-300">
          {t('retry')}
        </button>
      </p>
    );
  }

  if (academies.length === 0) {
    return <p className="text-sm text-gray-400">{t('noAcademy')}</p>;
  }

  return (
    <>
      <section className="bg-brand-card border border-gray-800 rounded-xl p-6 flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-white">{t('heading')}</h2>
        <p className="text-xs text-gray-400">{t('description')}</p>
        <ul className="flex flex-col gap-6">
          {academies.map((academy) => (
            <li
              key={academy.id}
              className="border border-gray-800 rounded-lg p-4 flex flex-col gap-3"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-white font-semibold">{academy.name}</p>
                  <p className="text-xs text-gray-400">
                    {t('owner')}{' '}
                    <TruncatedAddress
                      address={academy.ownerWallet}
                      className="text-gray-400"
                    />
                  </p>
                </div>
                <span className="text-xs text-gray-400 shrink-0">
                  {t('signerCount', { count: academy.members.length })}
                </span>
              </div>

              {academy.members.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {academy.members.map((m) => (
                    <li
                      key={m.wallet}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <TruncatedAddress
                          address={m.wallet}
                          className="text-gray-300"
                        />
                        {onChainStatus[m.wallet] === false && (
                          <span
                            className="text-xs text-amber-400"
                            title={t('notOnChainTitle')}
                          >
                            {t('notOnChain')}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() =>
                          setDialog({
                            action: 'remove-member',
                            academyId: academy.id,
                            wallet: m.wallet,
                          })
                        }
                        className="text-red-400 hover:text-red-300 transition text-xs shrink-0"
                      >
                        {t('remove')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex gap-2">
                <input
                  className="input flex-1 text-sm"
                  aria-label={t('addInputLabel')}
                  placeholder={t('addPlaceholder')}
                  value={memberInputs[academy.id] ?? ''}
                  onChange={(e) =>
                    setMemberInputs((s) => ({
                      ...s,
                      [academy.id]: e.target.value,
                    }))
                  }
                />
                <button
                  disabled={
                    !isStellarAddress(memberInputs[academy.id] ?? '') ||
                    actionLoading
                  }
                  onClick={() =>
                    setDialog({
                      action: 'add-member',
                      academyId: academy.id,
                      wallet: (memberInputs[academy.id] ?? '').trim(),
                    })
                  }
                  className="px-4 py-2 rounded-lg bg-brand-green text-black text-sm font-semibold hover:opacity-90 transition disabled:opacity-40 shrink-0"
                >
                  {t('add')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {dialog && (
        <ConfirmDialog
          isOpen
          title={
            dialog.action === 'add-member'
              ? t('addDialogTitle')
              : t('removeDialogTitle')
          }
          message={
            dialog.action === 'add-member'
              ? t('addDialogMessage', { wallet: dialog.wallet })
              : t('removeDialogMessage', {
                  wallet: `${dialog.wallet.slice(0, 4)}…${dialog.wallet.slice(-4)}`,
                })
          }
          confirmLabel={
            dialog.action === 'add-member'
              ? t('addConfirm')
              : t('removeConfirm')
          }
          loading={actionLoading}
          onConfirm={() =>
            dialog.action === 'add-member'
              ? handleAddMember(dialog.academyId)
              : handleRemoveMember(dialog.academyId, dialog.wallet)
          }
          onCancel={() => setDialog(null)}
        />
      )}
    </>
  );
}
