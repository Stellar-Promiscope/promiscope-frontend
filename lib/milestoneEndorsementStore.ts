/**
 * milestoneEndorsementStore — off-chain academy-quorum attestations for
 * already-on-chain-approved milestones (issue #1185).
 *
 * On-chain, `approve_milestone` records exactly one validator address per
 * milestone — there is no contract concept of "N validators signed off."
 * This design deliberately does not try to make additional academy members
 * call `approve_milestone` again for the same milestone: repeating that
 * call would be a genuinely new on-chain action (it advances the player's
 * `progressLevel` a further step, or fails once already at the max level),
 * which is exactly the kind of on-chain side effect this issue says a
 * quorum configuration must never cause. Instead, each academy member who
 * agrees a milestone is legitimate records a lightweight off-chain
 * endorsement here — including the original approving validator, whose own
 * approval is recorded as their first endorsement right after their
 * transaction confirms (see components/validator/ApproveForm.tsx). Quorum
 * is then "how many distinct academy-member wallets have endorsed," read
 * entirely from this table.
 *
 * DB bootstrap and schema follow lib/adminAuditStore.ts's conventions:
 * shared bootstrap via lib/sqliteDb.ts's openSqliteDb, schema applied
 * through lib/sqliteMigrations.ts's versioned migration runner (see
 * lib/migrations/milestoneEndorsementMigrations.ts), process-wide
 * singleton.
 */
import Database from 'better-sqlite3';
import { openSqliteDb } from './sqliteDb';
import { milestoneEndorsementMigrations } from './migrations/milestoneEndorsementMigrations';
import type { MilestoneEndorsement } from '@/types';

interface EndorsementRow {
  player_id: string;
  milestone_id: string;
  wallet: string;
  created_at: number;
}

function rowToEndorsement(row: EndorsementRow): MilestoneEndorsement {
  return {
    playerId: row.player_id,
    milestoneId: row.milestone_id,
    wallet: row.wallet,
    createdAt: row.created_at,
  };
}

export class MilestoneEndorsementStore {
  private static _instance: MilestoneEndorsementStore | null = null;

  private db: Database.Database;

  private constructor(db: Database.Database) {
    this.db = db;
  }

  static getInstance(): MilestoneEndorsementStore {
    if (!MilestoneEndorsementStore._instance) {
      const db = openSqliteDb(
        'milestone-endorsements.db',
        'MILESTONE_ENDORSEMENTS_DB_PATH',
        milestoneEndorsementMigrations,
      );
      MilestoneEndorsementStore._instance = new MilestoneEndorsementStore(db);
    }
    return MilestoneEndorsementStore._instance;
  }

  /** Closes the DB connection and clears the singleton. Use ONLY in tests. */
  static resetInstance(): void {
    if (MilestoneEndorsementStore._instance) {
      MilestoneEndorsementStore._instance.db.close();
    }
    MilestoneEndorsementStore._instance = null;
  }

  /**
   * Records `wallet`'s endorsement of a milestone. Idempotent — endorsing
   * twice (e.g. a double-click, or ApproveForm's own auto-recorded
   * endorsement racing a manual one) is a silent no-op via the table's
   * composite primary key, not an error.
   */
  add(playerId: string, milestoneId: string, wallet: string): void {
    this.db
      .prepare(
        `INSERT INTO milestone_endorsements (player_id, milestone_id, wallet, created_at)
         VALUES (@player_id, @milestone_id, @wallet, @created_at)
         ON CONFLICT (player_id, milestone_id, wallet) DO NOTHING`,
      )
      .run({
        player_id: playerId,
        milestone_id: milestoneId,
        wallet,
        created_at: Date.now(),
      });
  }

  /** Every distinct wallet that has endorsed this milestone, oldest first. */
  listFor(playerId: string, milestoneId: string): MilestoneEndorsement[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM milestone_endorsements
         WHERE player_id = ? AND milestone_id = ?
         ORDER BY created_at ASC`,
      )
      .all(playerId, milestoneId) as EndorsementRow[];
    return rows.map(rowToEndorsement);
  }

  /** Every endorsement made by `wallet`, oldest first (data export). */
  listForWallet(wallet: string): MilestoneEndorsement[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM milestone_endorsements WHERE wallet = ? ORDER BY created_at ASC',
      )
      .all(wallet) as EndorsementRow[];
    return rows.map(rowToEndorsement);
  }

  /** Deletes every endorsement made by `wallet` (data-deletion cascade). */
  deleteForWallet(wallet: string): number {
    return this.db
      .prepare('DELETE FROM milestone_endorsements WHERE wallet = ?')
      .run(wallet).changes;
  }

  close(): void {
    this.db.close();
  }
}
