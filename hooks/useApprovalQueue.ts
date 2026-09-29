'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from '@/hooks/useWallet';
import {
  approvalIdempotencyKey,
  dismissApprovalIntent,
  enqueueApprovalIntent,
  getApprovalIntents,
  isApprovalQueueAvailable,
  updateApprovalIntent,
  type ApprovalIntent,
} from '@/lib/approvalQueue';
import {
  buildApproveMilestone,
  getMilestoneHistory,
  getPlayer,
} from '@/lib/contract';
import { parseContractError } from '@/lib/contractErrorMessage';
import {
  isOnChainApproved,
  submitAndConfirmApproval,
} from '@/lib/confirmApprovalSubmission';

const SYNC_TAG = 'validator-approval-sync';

type QueuePlayer = { progressLevel?: number };
type QueueMilestone = { description?: string; validator?: string };

function supportsBackgroundSync(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'SyncManager' in window
  );
}

function contractReason(error: unknown): string {
  const message = parseContractError(error);
  if (/alreadyatlevel|already at level|error\s*6/i.test(message)) {
    return 'This player is already at the maximum level. The approval is no longer valid.';
  }
  if (/playernotfound|player not found|error\s*3/i.test(message)) {
    return 'The player could not be found. The approval is no longer valid.';
  }
  return message;
}

function isPermanentApprovalError(message: string): boolean {
  return /maximum level|no longer valid|player could not be found|not a valid/i.test(
    message,
  );
}

/**
 * Offline-first queue for unsigned approval intents. Flush is intentionally
 * manual: the validator clicks the batch button before any wallet prompt opens.
 */
export function useApprovalQueue(validatorAddress: string | null) {
  const { signAndSubmit } = useWallet();
  const [intents, setIntents] = useState<ApprovalIntent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [flushError, setFlushError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const validatorRef = useRef(validatorAddress);
  validatorRef.current = validatorAddress;

  const refresh = useCallback(async () => {
    if (!validatorAddress || !isApprovalQueueAvailable()) {
      setIntents([]);
      setLoaded(true);
      return;
    }
    try {
      const records = await getApprovalIntents();
      if (mountedRef.current && validatorRef.current === validatorAddress) {
        setIntents(
          records.filter((record) => record.validator === validatorAddress),
        );
      }
    } catch {
      if (mountedRef.current) setIntents([]);
    } finally {
      if (mountedRef.current) setLoaded(true);
    }
  }, [validatorAddress]);

  useEffect(() => {
    mountedRef.current = true;
    setLoaded(false);
    refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  const registerSync = useCallback(async () => {
    if (!supportsBackgroundSync()) return;
    try {
      const registration = (await navigator.serviceWorker
        .ready) as ServiceWorkerRegistration & {
        sync: { register(tag: string): Promise<void> };
      };
      await registration.sync.register(SYNC_TAG);
    } catch {
      // The online listener below is the fallback when registration fails.
    }
  }, []);

  const enqueue = useCallback(
    async (input: {
      playerId: string;
      milestone: string;
    }): Promise<ApprovalIntent> => {
      if (!validatorAddress) throw new Error('Wallet not connected');
      const intent = await enqueueApprovalIntent({
        ...input,
        validator: validatorAddress,
      });
      await refresh();
      await registerSync();
      return intent;
    },
    [refresh, registerSync, validatorAddress],
  );

  const enqueueMany = useCallback(
    async (items: Array<{ playerId: string; milestone: string }>) => {
      const queued: ApprovalIntent[] = [];
      for (const item of items) queued.push(await enqueue(item));
      return queued;
    },
    [enqueue],
  );

  const flush = useCallback(async () => {
    if (!validatorAddress || flushing || !navigator.onLine) return;
    setFlushing(true);
    setFlushError(null);

    try {
      const records = (await getApprovalIntents()).filter(
        (record) =>
          record.validator === validatorAddress &&
          (record.status === 'pending' || record.status === 'failed'),
      );

      for (const intent of records) {
        if (!navigator.onLine) break;
        await updateApprovalIntent(intent.idempotencyKey, {
          status: 'processing',
          retryCount: intent.retryCount + 1,
          errorReason: undefined,
        });
        await refresh();

        try {
          const history = (await getMilestoneHistory(intent.playerId)) as
            | QueueMilestone[]
            | undefined;
          const duplicate = (history ?? []).some(
            (milestone) =>
              milestone.description === intent.milestone &&
              milestone.validator === intent.validator,
          );
          if (duplicate) {
            await updateApprovalIntent(intent.idempotencyKey, {
              status: 'confirmed',
              errorReason: 'Already approved on-chain; duplicate skipped.',
            });
            continue;
          }

          const player = (await getPlayer(intent.playerId)) as QueuePlayer;
          if (player.progressLevel !== undefined && player.progressLevel >= 3) {
            throw new Error(
              'This player is already at the maximum level. The approval is no longer valid.',
            );
          }

          const result = await submitAndConfirmApproval({
            buildXdr: () =>
              buildApproveMilestone(
                intent.validator,
                intent.playerId,
                intent.milestone,
              ),
            signAndSubmit,
            playerId: intent.playerId,
            validatorAddress: intent.validator,
          });

          if (isOnChainApproved(result.phase)) {
            await updateApprovalIntent(intent.idempotencyKey, {
              status: 'confirmed',
              txHash: result.hash ?? undefined,
              errorReason:
                result.phase === 'event_lag' ? result.message : undefined,
            });
          } else {
            await updateApprovalIntent(intent.idempotencyKey, {
              status: 'failed',
              txHash: result.hash ?? undefined,
              errorReason: result.message,
            });
          }
        } catch (error) {
          const reason = contractReason(error);
          await updateApprovalIntent(intent.idempotencyKey, {
            status: isPermanentApprovalError(reason) ? 'invalid' : 'failed',
            errorReason: reason,
          });
        }
        await refresh();
      }
    } catch (error) {
      setFlushError(error instanceof Error ? error.message : String(error));
    } finally {
      setFlushing(false);
      await refresh();
    }
  }, [flushing, refresh, signAndSubmit, validatorAddress]);

  const dismiss = useCallback(
    async (idempotencyKey: string) => {
      await dismissApprovalIntent(idempotencyKey);
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    const handleOnline = () => {
      registerSync();
      refresh();
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'APPROVAL_SYNC_READY') refresh();
    };
    window.addEventListener('online', handleOnline);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleMessage);
    }
    return () => {
      window.removeEventListener('online', handleOnline);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleMessage);
      }
    };
  }, [refresh, registerSync]);

  const pending = intents.filter(
    (intent) => intent.status === 'pending' || intent.status === 'failed',
  );
  const terminal = intents.filter(
    (intent) => intent.status === 'confirmed' || intent.status === 'invalid',
  );

  return {
    intents,
    pending,
    terminal,
    loaded,
    flushing,
    flushError,
    enqueue,
    enqueueMany,
    flush,
    dismiss,
    refresh,
    createKey: approvalIdempotencyKey,
  };
}
