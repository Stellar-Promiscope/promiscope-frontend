'use client';
import dynamic from 'next/dynamic';

const AcademyManager = dynamic(
  () => import('@/components/admin/AcademyManager'),
  {
    ssr: false,
    loading: () => (
      <div className="bg-brand-card border border-gray-800 rounded-xl p-6 animate-pulse h-32" />
    ),
  },
);

/** /admin/academies — off-chain academy identities (issue #663; see docs/academy-validator-model.md). */
export default function AdminAcademiesPage() {
  return (
    <div className="max-w-3xl flex flex-col gap-8">
      <h1 className="text-3xl font-bold text-white">Academies</h1>
      <AcademyManager />
    </div>
  );
}
