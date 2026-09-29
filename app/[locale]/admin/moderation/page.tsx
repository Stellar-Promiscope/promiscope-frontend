'use client';
import dynamic from 'next/dynamic';

const AutomatedModerationLog = dynamic(
  () => import('@/components/admin/AutomatedModerationLog'),
  {
    ssr: false,
    loading: () => (
      <div className="bg-brand-card border border-gray-800 rounded-xl p-6 animate-pulse h-48" />
    ),
  },
);

/** /admin/moderation — automated moderation log. */
export default function AdminModerationPage() {
  return (
    <div className="max-w-3xl flex flex-col gap-8">
      <h1 className="text-3xl font-bold text-white">Moderation</h1>
      <AutomatedModerationLog />
    </div>
  );
}
