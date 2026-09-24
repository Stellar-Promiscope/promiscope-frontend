'use client';

import { useTranslations } from 'next-intl';
import { useRequireWallet } from '@/hooks/useRequireWallet';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import AcademyOwnerRoster from '@/components/academy/AcademyOwnerRoster';

/**
 * Scoped academy-owner roster management (issue #1173).
 *
 * Access model: gated only to "any authenticated wallet" via
 * `useRequireWallet` (same as `/academy/bulk-import`), *not* to
 * `NEXT_PUBLIC_ADMIN_ADDRESS` like `/admin` — anyone can load this page,
 * but the server-side routes it talks to (`app/api/admin/academies/[id]/
 * members/**`, via `lib/academyAuth.ts`) only allow the request through
 * when the session wallet is the recorded `ownerWallet` of the academy
 * being modified, or the platform super-admin. A connected wallet that
 * owns no academy simply sees an empty state, enforced by
 * `AcademyOwnerRoster` querying `GET /api/admin/academies/mine`.
 */
function AcademyRosterPageContent() {
  const t = useTranslations('academy.rosterPage');
  const { walletAddress } = useRequireWallet();

  if (!walletAddress) {
    return null; // Redirect handled by useRequireWallet
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold text-white">{t('title')}</h1>
        <p className="text-sm text-gray-400 mt-1">{t('subtitle')}</p>
      </div>
      <AcademyOwnerRoster />
    </div>
  );
}

export default function AcademyRosterPage() {
  return (
    <ErrorBoundary>
      <AcademyRosterPageContent />
    </ErrorBoundary>
  );
}
