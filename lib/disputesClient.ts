/** Client for app/api/disputes — same-origin, cookie-authenticated. */
import type {
  MilestoneDispute,
  MilestoneDisputeStatus,
  DisputeWithEvents,
  DisputeEvent,
} from '@/types';
import { fetchWithRetry } from '@/lib/fetchWithRetry';

export interface CreateDisputeParams {
  playerId: string;
  milestoneId: string;
  milestoneDescription: string;
  reason: string;
}

export interface AddEvidenceParams {
  ipfsHash: string;
  ipfsMimeType: string;
  body?: string;
}

export async function fetchMyDisputes(): Promise<MilestoneDispute[]> {
  const res = await fetchWithRetry('/api/disputes');
  if (!res.ok) throw new Error('Failed to fetch disputes');
  return res.json();
}

export async function fetchDisputeQueue(
  status?: MilestoneDisputeStatus,
): Promise<MilestoneDispute[]> {
  const url = status ? `/api/disputes?status=${status}` : '/api/disputes';
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error('Failed to fetch dispute queue');
  return res.json();
}

/** Fetch a single dispute with its full event timeline. */
export async function fetchDispute(id: number): Promise<DisputeWithEvents> {
  const res = await fetchWithRetry(`/api/disputes/${id}`);
  if (res.status === 403) throw new Error('Forbidden');
  if (res.status === 404) throw new Error('Dispute not found');
  if (!res.ok) throw new Error('Failed to fetch dispute');
  return res.json();
}

// Mutations deliberately use a bare `fetch`, not `fetchWithRetry`:
// they are non-idempotent operations where automatic retries risk
// duplicates or double-effects.

export async function createDispute(
  params: CreateDisputeParams,
): Promise<MilestoneDispute> {
  const res = await fetch('/api/disputes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    // #1323: migrated routes return { error: { code, message } }.
    const error = body?.error;
    throw new Error(
      (typeof error === 'string' ? error : error?.message) ??
        'Failed to create dispute',
    );
  }
  return res.json();
}

export async function decideDispute(
  id: number,
  decision: {
    status: 'upheld' | 'reversed';
    resolutionNote?: string;
    revokeTxHash?: string;
  },
): Promise<MilestoneDispute> {
  const res = await fetch(`/api/disputes/${id}/decide`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? 'Failed to decide dispute');
  }
  return res.json();
}

/** Attach evidence (IPFS CID + optional note) to a dispute. */
export async function addEvidence(
  id: number,
  params: AddEvidenceParams,
): Promise<DisputeEvent> {
  const res = await fetch(`/api/disputes/${id}/evidence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? 'Failed to add evidence');
  }
  return res.json();
}
