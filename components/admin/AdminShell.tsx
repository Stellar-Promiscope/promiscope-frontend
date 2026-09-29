'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/hooks/useWallet';
import { useToast } from '@/components/ui/Toast';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import AdminNav from './AdminNav';

const ADMIN_ADDRESS = process.env.NEXT_PUBLIC_ADMIN_ADDRESS;

/**
 * Admin wallet guard + side nav shared by every /admin route through
 * app/[locale]/admin/layout.tsx (issue #1354). Renders nothing until the
 * connected wallet is confirmed as the admin, and redirects anyone else.
 */
export default function AdminShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const { publicKey } = useWallet();
  const router = useRouter();
  const { show } = useToast();

  useEffect(() => {
    if (!publicKey) return;
    if (publicKey !== ADMIN_ADDRESS) {
      show({
        message: 'Unauthorized: admin wallet required.',
        variant: 'error',
      });
      router.replace('/');
    }
  }, [publicKey, router, show]);

  if (!publicKey || publicKey !== ADMIN_ADDRESS) return null;

  return (
    <div className="max-w-5xl mx-auto flex flex-col md:flex-row gap-6">
      <AdminNav />
      <div className="flex-1 min-w-0">
        <ErrorBoundary>{children}</ErrorBoundary>
      </div>
    </div>
  );
}
