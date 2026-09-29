'use client';
import dynamic from 'next/dynamic';

const FraudFlagsPanel = dynamic(
  () => import('@/components/admin/FraudFlagsPanel'),
  {
    ssr: false,
    loading: () => (
      <div className="bg-brand-card border border-gray-800 rounded-xl p-6 animate-pulse h-20" />
    ),
  },
);

/** /admin/fraud — flagged activity. */
export default function AdminFraudPage() {
  return (
    <div className="max-w-3xl flex flex-col gap-8">
      <h1 className="text-3xl font-bold text-white">Fraud Flags</h1>
      <FraudFlagsPanel />
    </div>
  );
}
