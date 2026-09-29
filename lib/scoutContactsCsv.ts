import { PROGRESS_LABELS, type ProgressLevel } from '@/types';

/**
 * A player the scout has paid to unlock contact details for, as returned by
 * `GET /scouts/:scoutId/contacts` (see `fetchScoutContacts` in lib/api.ts).
 * Fields are optional because older contact records may predate some of
 * them — the CSV simply leaves those cells blank.
 */
export interface ScoutContact {
  playerId: string;
  name?: string;
  position?: string;
  region?: string;
  progressLevel?: ProgressLevel;
  /** Unix timestamp (seconds or ms) when contact was unlocked. */
  unlockedAt?: number;
}

export const SCOUT_CONTACTS_CSV_HEADERS = [
  'Player Name',
  'Position',
  'Region',
  'Progress Level',
  'Contact Unlocked',
] as const;

function escapeCsvValue(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function formatUnlockDate(ts: number | undefined): string {
  if (ts === undefined || !Number.isFinite(ts)) return '';
  // Ledger timestamps are seconds; JS/API timestamps are ms.
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Builds a CSV (header row always included) from a scout's contacted players. */
export function buildScoutContactsCsv(contacts: ScoutContact[]): string {
  const rows = contacts.map((c) => [
    c.name ?? c.playerId,
    c.position ?? '',
    c.region ?? '',
    c.progressLevel !== undefined
      ? (PROGRESS_LABELS[c.progressLevel] ?? String(c.progressLevel))
      : '',
    formatUnlockDate(c.unlockedAt),
  ]);
  return [SCOUT_CONTACTS_CSV_HEADERS as readonly string[], ...rows]
    .map((row) => row.map((v) => escapeCsvValue(String(v))).join(','))
    .join('\r\n');
}
