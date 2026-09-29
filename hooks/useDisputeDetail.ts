'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import {
  fetchDispute,
  addEvidence,
  type AddEvidenceParams,
} from '@/lib/disputesClient';
import type { DisputeWithEvents, DisputeEvent } from '@/types';

/** SWR key for a single dispute with its event timeline. */
export function disputeDetailKey(id: number | null): string | null {
  return id !== null ? `disputes:detail:${id}` : null;
}

/**
 * Provides a single dispute with its full event timeline.
 * Used by the admin timeline view and by the validator/player response forms.
 *
 * `submitEvidence` optimistically appends the returned event to the local
 * cache before revalidating, so the timeline updates instantly.
 */
export function useDisputeDetail(id: number | null) {
  const { data, error, isValidating, mutate } = useSWR<DisputeWithEvents>(
    disputeDetailKey(id),
    () => fetchDispute(id!),
    {
      dedupingInterval: 10_000,
      revalidateOnFocus: false,
      errorRetryCount: 2,
    },
  );

  const submitEvidence = useCallback(
    async (params: AddEvidenceParams): Promise<DisputeEvent> => {
      if (id === null) throw new Error('No dispute id');
      const event = await addEvidence(id, params);
      // Optimistically append to the timeline, then revalidate.
      mutate(
        (current) =>
          current
            ? { ...current, events: [...current.events, event] }
            : current,
        false,
      );
      await mutate();
      return event;
    },
    [id, mutate],
  );

  return {
    dispute: data ?? null,
    loading: isValidating && !data,
    error: error?.message ?? null,
    submitEvidence,
    refetch: () => mutate(),
  };
}
