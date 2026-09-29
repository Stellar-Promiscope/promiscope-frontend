'use client';
import dynamic from 'next/dynamic';

const DisputedMilestonesPanel = dynamic(
  () => import('@/components/admin/DisputedMilestonesPanel'),
  {
    ssr: false,
    loading: () => (
      <div className="bg-brand-card border border-gray-800 rounded-xl p-6 animate-pulse h-20" />
    ),
  },
);

/** /admin/disputes — disputed milestones. */
export default function AdminDisputesPage() {
  return (
    <div className="max-w-3xl flex flex-col gap-8">
      <h1 className="text-3xl font-bold text-white">Disputes</h1>
      <DisputedMilestonesPanel />
    </div>
  );
}
