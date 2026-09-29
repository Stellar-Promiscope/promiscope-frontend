'use client';
import { useCallback, useState } from 'react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { parseContractError } from '@/lib/contractErrorMessage';

interface PendingAction {
  label: string;
  message: string;
  run: () => Promise<void>;
  onError?: (message: string) => void;
}

/**
 * Confirm-then-run flow for admin contract actions (issue #1354): shows a
 * ConfirmDialog, runs the action on confirm, and toasts a parsed contract
 * error on failure.
 */
export function useAdminConfirm() {
  const { show } = useToast();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [loading, setLoading] = useState(false);

  const confirm = useCallback((action: PendingAction) => {
    setPending(action);
  }, []);

  async function onConfirm() {
    if (!pending) return;
    setLoading(true);
    try {
      await pending.run();
    } catch (e) {
      const message = parseContractError(e);
      pending.onError?.(message);
      show({ message, variant: 'error' });
    } finally {
      setLoading(false);
      setPending(null);
    }
  }

  const dialog = pending ? (
    <ConfirmDialog
      isOpen
      title={pending.label}
      message={pending.message}
      confirmLabel={pending.label}
      loading={loading}
      onConfirm={onConfirm}
      onCancel={() => setPending(null)}
    />
  ) : null;

  return { confirm, dialog };
}
