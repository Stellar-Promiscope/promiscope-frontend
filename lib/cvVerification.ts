import type { Milestone, Player } from '@/types';

export interface CvContent {
  playerId: string;
  wallet: string;
  vitals: Player['vitals'];
  stats: Player['stats'] | null;
  progressLevel: Player['progressLevel'];
  milestones: Array<Pick<Milestone, 'id' | 'description' | 'evidenceHash' | 'validator' | 'timestamp'>>;
}

export interface CvLedgerReference {
  milestoneId: string;
  ledger: number;
}

export interface CvSigningPayload {
  playerId: string;
  contentHash: string;
  exportedAt: number;
  ledger: CvLedgerReference[];
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortValue(entry)]),
    );
  }
  return value;
}

export function canonicalizeCvContent(content: CvContent): string {
  return JSON.stringify(sortValue(content));
}

export function buildCvContent(
  player: Player,
  milestones: Milestone[],
): CvContent {
  return {
    playerId: player.id,
    wallet: player.wallet,
    vitals: player.vitals,
    stats: player.stats ?? null,
    progressLevel: player.progressLevel,
    milestones: [...milestones]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(({ id, description, evidenceHash, validator, timestamp }) => ({
        id,
        description,
        evidenceHash,
        validator,
        timestamp,
      })),
  };
}

export async function hashCvContent(content: CvContent): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizeCvContent(content));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
