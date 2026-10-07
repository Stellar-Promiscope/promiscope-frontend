/**
 * Shared types for player-media moderation (issue #1320). Split out from
 * lib/mediaModerationStore.ts (server-only, imports better-sqlite3) so client
 * components can use the same shapes.
 *
 * The denylist only covers Promiscope surfaces (the /api/media proxy and the
 * profile gallery). A denylisted CID can still be fetched from any public
 * IPFS gateway.
 */

export const MEDIA_REPORT_REASONS = [
  'nudity',
  'violence',
  'impersonation',
  'copyright',
  'other',
] as const;

export type MediaReportReason = (typeof MEDIA_REPORT_REASONS)[number];

export const MEDIA_REPORT_REASON_LABELS: Record<MediaReportReason, string> = {
  nudity: 'Nudity or sexual content',
  violence: 'Violence or gore',
  impersonation: 'Impersonation',
  copyright: 'Copyright infringement',
  other: 'Other',
};

export function isMediaReportReason(
  value: unknown,
): value is MediaReportReason {
  return (
    typeof value === 'string' &&
    (MEDIA_REPORT_REASONS as readonly string[]).includes(value)
  );
}

/** CIDv0 (Qm…) / CIDv1 (b…) plus an optional file extension, as stored on profiles. */
const CID_PATTERN = /^[A-Za-z0-9]{46,100}(\.[A-Za-z0-9]{1,8})?$/;

export function isValidMediaCid(value: unknown): value is string {
  return typeof value === 'string' && CID_PATTERN.test(value);
}

export type MediaModerationDecision = 'approve' | 'deny';

/** One CID awaiting review, with its duplicate reports aggregated. */
export interface MediaModerationQueueItem {
  cid: string;
  playerId: string | null;
  reportCount: number;
  reasons: Partial<Record<MediaReportReason, number>>;
  /** Free-text details from reporters (most recent first, capped). */
  details: string[];
  firstReportedAt: number;
  lastReportedAt: number;
}

export interface MediaDenylistEntry {
  cid: string;
  reason: string;
  decidedBy: string;
  decidedAt: number;
}
