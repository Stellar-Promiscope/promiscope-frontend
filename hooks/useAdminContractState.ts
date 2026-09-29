'use client';
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import {
  getContractPaused,
  getPlatformFees,
  getValidators,
} from '@/lib/contract';
import type { ValidatorInfo } from '@/types';

/**
 * On-chain admin state (validators, accumulated fees, pause flag) shared by
 * the admin section routes (issue #1354). Only mounted under AdminShell, so
 * the connected wallet is already known to be the admin.
 */
export function useAdminContractState() {
  const { show } = useToast();
  const [validators, setValidators] = useState<ValidatorInfo[]>([]);
  const [fees, setFees] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    setFetchError(false);
    Promise.all([getValidators(), getPlatformFees(), getContractPaused()])
      .then(([v, f, p]) => {
        setValidators(v);
        setFees(f as number);
        setPaused(p as boolean);
      })
      .catch(() => {
        setFetchError(true);
        show({ message: 'Failed to load admin data.', variant: 'error' });
      })
      .finally(() => setLoading(false));
  }, [show]);

  useEffect(() => {
    reload();
  }, [reload]);

  return {
    validators,
    setValidators,
    fees,
    setFees,
    paused,
    setPaused,
    loading,
    fetchError,
    reload,
  };
}
