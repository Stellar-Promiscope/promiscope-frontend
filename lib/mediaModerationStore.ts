/**
 * mediaModerationStore — SQLite persistence for player-media reports and the
 * CID denylist (issue #1320).
 *
 *  - `media_reports`: one row per (reporter, CID) while open. A repeat report
 *    from the same reporter is ignored; reports from different reporters are
 *    aggregated per CID in the admin queue.
 *  - `media_denylist`: CIDs the /api/media proxy refuses to serve (451) and the
 *    gallery renders as "removed".
 *
 * Same bootstrap conventions as lib/adminAuditStore.ts (openSqliteDb +
 * versioned migrations, process-wide singleton, `:memory:` in tests).
 */
import Database from 'better-sqlite3';
import { openSqliteDb } from './sqliteDb';
import { mediaModerationMigrations } from './migrations/mediaModerationMigrations';
import type {
  MediaDenylistEntry,
  MediaModerationDecision,
  MediaModerationQueueItem,
  MediaReportReason,
} from './mediaModeration';

const MAX_DETAILS_PER_ITEM = 10;
const MAX_QUEUE_ITEMS = 200;

export interface NewMediaReport {
  cid: string;
  playerId: string | null;
  reason: MediaReportReason;
  details?: string | null;
  /** Stable, non-reversible reporter identity (e.g. hashed IP or wallet). */
  reporterKey: string;
}

export class MediaModerationStore {
  private static _instance: MediaModerationStore | null = null;

  private constructor(private db: Database.Database) {}

  static getInstance(): MediaModerationStore {
    if (!MediaModerationStore._instance) {
      MediaModerationStore._instance = new MediaModerationStore(
        openSqliteDb(
          'media-moderation.db',
          'MEDIA_MODERATION_DB_PATH',
          mediaModerationMigrations,
        ),
      );
    }
    return MediaModerationStore._instance;
  }

  /** Closes the DB connection and clears the singleton. Use ONLY in tests. */
  static resetInstance(): void {
    MediaModerationStore._instance?.db.close();
    MediaModerationStore._instance = null;
  }

  /**
   * Records a report. Returns false when this reporter already has an open
   * report for the CID (aggregated, not duplicated).
   */
  report(report: NewMediaReport): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO media_reports (cid, player_id, reason, details, reporter_key, created_at)
         VALUES (@cid, @player_id, @reason, @details, @reporter_key, @created_at)`,
      )
      .run({
        cid: report.cid,
        player_id: report.playerId,
        reason: report.reason,
        details: report.details || null,
        reporter_key: report.reporterKey,
        created_at: Date.now(),
      });
    return result.changes > 0;
  }

  /** Open reports aggregated per CID, most-reported first. Already-denylisted CIDs are excluded. */
  getQueue(): MediaModerationQueueItem[] {
    const rows = this.db
      .prepare(
        `SELECT r.cid, r.player_id, r.reason, r.details, r.created_at
         FROM media_reports r
         WHERE r.resolved_at IS NULL
           AND r.cid NOT IN (SELECT cid FROM media_denylist)
         ORDER BY r.created_at DESC`,
      )
      .all() as {
      cid: string;
      player_id: string | null;
      reason: MediaReportReason;
      details: string | null;
      created_at: number;
    }[];

    const byCid = new Map<string, MediaModerationQueueItem>();
    for (const row of rows) {
      let item = byCid.get(row.cid);
      if (!item) {
        item = {
          cid: row.cid,
          playerId: row.player_id,
          reportCount: 0,
          reasons: {},
          details: [],
          firstReportedAt: row.created_at,
          lastReportedAt: row.created_at,
        };
        byCid.set(row.cid, item);
      }
      item.reportCount += 1;
      item.reasons[row.reason] = (item.reasons[row.reason] ?? 0) + 1;
      item.playerId ??= row.player_id;
      if (row.details && item.details.length < MAX_DETAILS_PER_ITEM) {
        item.details.push(row.details);
      }
      item.firstReportedAt = Math.min(item.firstReportedAt, row.created_at);
      item.lastReportedAt = Math.max(item.lastReportedAt, row.created_at);
    }

    return [...byCid.values()]
      .sort(
        (a, b) =>
          b.reportCount - a.reportCount || b.lastReportedAt - a.lastReportedAt,
      )
      .slice(0, MAX_QUEUE_ITEMS);
  }

  /**
   * Resolves every open report for `cid`. `deny` also adds the CID to the
   * denylist. Returns the number of reports resolved.
   */
  decide(
    cid: string,
    decision: MediaModerationDecision,
    decidedBy: string,
    reason: string,
  ): number {
    const now = Date.now();
    const run = this.db.transaction((): number => {
      if (decision === 'deny') {
        this.db
          .prepare(
            `INSERT INTO media_denylist (cid, reason, decided_by, decided_at)
             VALUES (@cid, @reason, @decided_by, @decided_at)
             ON CONFLICT(cid) DO UPDATE SET reason = excluded.reason,
               decided_by = excluded.decided_by, decided_at = excluded.decided_at`,
          )
          .run({ cid, reason, decided_by: decidedBy, decided_at: now });
      }
      return this.db
        .prepare(
          `UPDATE media_reports SET resolved_at = @now, resolution = @decision
           WHERE cid = @cid AND resolved_at IS NULL`,
        )
        .run({ cid, now, decision }).changes;
    });
    return run();
  }

  /** Removes a CID from the denylist (reinstating it). Returns whether it was listed. */
  reinstate(cid: string): boolean {
    return (
      this.db.prepare('DELETE FROM media_denylist WHERE cid = ?').run(cid)
        .changes > 0
    );
  }

  isDenylisted(cid: string): boolean {
    return (
      this.db.prepare('SELECT 1 FROM media_denylist WHERE cid = ?').get(cid) !==
      undefined
    );
  }

  /** Returns the subset of `cids` that are denylisted. */
  filterDenylisted(cids: string[]): string[] {
    if (cids.length === 0) return [];
    const placeholders = cids.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT cid FROM media_denylist WHERE cid IN (${placeholders})`)
      .all(...cids) as { cid: string }[];
    return rows.map((r) => r.cid);
  }

  getDenylist(): MediaDenylistEntry[] {
    const rows = this.db
      .prepare(
        'SELECT cid, reason, decided_by, decided_at FROM media_denylist ORDER BY decided_at DESC',
      )
      .all() as {
      cid: string;
      reason: string;
      decided_by: string;
      decided_at: number;
    }[];
    return rows.map((r) => ({
      cid: r.cid,
      reason: r.reason,
      decidedBy: r.decided_by,
      decidedAt: r.decided_at,
    }));
  }
}
