/**
 * Data Export — assembles a portable JSON payload of all data the platform
 * holds about a player, for self-service download from the player dashboard.
 *
 * The export contains:
 *   - Player vitals (name, age, position, region, nationality)
 *   - Current progress level
 *   - Full milestone history (with IPFS hashes for evidence, not the media)
 *   - IPFS hash references (highlight reel, milestone evidence)
 *   - Account metadata (wallet, created date)
 *
 * Media files themselves are NOT included — only their IPFS CIDs / gateway
 * URLs are exported, so the file stays small and no personal media is
 * re-hosted.
 */

import type { Player, Milestone } from '@/types';

export interface DataExportPayload {
  /** Schema version — bump when adding/removing fields. */
  schemaVersion: 1;
  /** ISO 8601 timestamp of when this export was generated. */
  exportedAt: string;
  /** The player's identifier on the platform. */
  playerId: string;
  /** The player's Stellar wallet address. */
  wallet: string;
  /** Profile vitals as stored on-chain. */
  vitals: {
    name: string;
    age: number;
    position: string;
    region: string;
    nationality: string;
  };
  /** Current progress level (0 = Unverified … 3 = Elite Tier). */
  progressLevel: number;
  /** Unix timestamp (seconds) when the player registered. */
  createdAt: number;
  /** IPFS CID of the player's latest highlight reel. */
  ipfsHash: string;
  /** Resolved IPFS gateway URL for the highlight reel, if available. */
  ipfsUrl: string | null;
  /** Full milestone history (oldest first). */
  milestones: Array<{
    id: string;
    description: string;
    /** IPFS CID of the supporting evidence media. */
    evidenceHash: string;
    /** Resolved IPFS gateway URL for the evidence, if available. */
    evidenceUrl: string | null;
    /** Stellar address of the approving validator. */
    validator: string;
    /** Unix timestamp (seconds) when the milestone was approved. */
    timestamp: number;
  }>;
}

function resolveIpfsUrl(cid: string): string | null {
  if (!cid) return null;
  const gateway =
    process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? 'https://gateway.pinata.cloud/ipfs';
  return `${gateway}/${cid}`;
}

/**
 * Assembles the full data export payload for a given player.
 *
 * @param player - The full Player object (vitals, progress, etc.).
 * @param milestones - Full milestone history for the player.
 * @returns A structured JSON-serialisable payload.
 */
export function buildExportPayload(
  player: Player,
  milestones: Milestone[],
): DataExportPayload {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    playerId: player.id,
    wallet: player.wallet,
    vitals: {
      name: player.vitals.name,
      age: player.vitals.age,
      position: player.vitals.position,
      region: player.vitals.region,
      nationality: player.vitals.nationality,
    },
    progressLevel: player.progressLevel,
    createdAt: player.createdAt,
    ipfsHash: player.ipfsHash,
    ipfsUrl: resolveIpfsUrl(player.ipfsHash),
    milestones: milestones.map((m) => ({
      id: m.id,
      description: m.description,
      evidenceHash: m.evidenceHash,
      evidenceUrl: resolveIpfsUrl(m.evidenceHash),
      validator: m.validator,
      timestamp: m.timestamp,
    })),
  };
}

/**
 * Triggers a download of the export payload as a JSON file in the browser.
 *
 * @param payload - The export payload to download.
 * @param filename - Optional filename (defaults to
 *                   `promiscope-export-<playerId>-<date>.json`).
 */
export function downloadExportPayload(
  payload: DataExportPayload,
  filename?: string,
): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download =
    filename ??
    `promiscope-export-${payload.playerId}-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Small delay before releasing the blob URL so the browser can start
  // the download. Revoking immediately is safe in modern browsers, but
  // the timeout avoids edge cases where the download is interrupted.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
