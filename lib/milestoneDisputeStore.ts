/**
 * milestoneDisputeStore — SQLite-backed persistence for player-raised
 * milestone disputes (issue #562, extended with evidence-exchange in
 * the dispute-resolution PR).
 *
 * Off-chain moderation record only: this store never calls the contract
 * itself. When an admin resolves a dispute as 'reversed', the actual
 * on-chain revoke happens through submitAndConfirmRevokeMilestone in
 * lib/contract.ts — the resulting tx hash is then recorded here via
 * `decide()`.
 *
 * Schema is versioned via lib/sqliteMigrations.ts:
 *   v1 — initial milestone_disputes table
 *   v2 — adds validatorWallet + responseDeadline columns to milestone_disputes
 *        and creates the dispute_events table
 *
 * Mirrors lib/adminAuditStore.ts's conventions: better-sqlite3, process-wide
 * singleton, DB bootstrap shared via lib/sqliteDb.ts.
 */
import type Database from 'better-sqlite3';
import { openSqliteDb } from './sqliteDb';
import type { Migration } from './sqliteMigrations';
import type {
  MilestoneDispute,
  MilestoneDisputeStatus,
  DisputeEvent,
  DisputeEventType,
  DisputeWithEvents,
} from '@/types';

// ── Response-window configuration ─────────────────────────────────────────────
/**
 * How long (in milliseconds) the validator has to respond after a dispute is
 * filed. Defaults to 7 days. Override via DISPUTE_RESPONSE_WINDOW_MS env var.
 */
export function getResponseWindowMs(): number {
  const val = parseInt(
    process.env.DISPUTE_RESPONSE_WINDOW_MS ?? '',
    10,
  );
  return Number.isFinite(val) && val > 0 ? val : 7 * 24 * 60 * 60 * 1000;
}

// ── Migration definitions ──────────────────────────────────────────────────────

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_milestone_disputes',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS milestone_disputes (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          player_id            TEXT NOT NULL,
          player_wallet        TEXT NOT NULL,
          milestone_id         TEXT NOT NULL,
          milestone_description TEXT NOT NULL,
          reason               TEXT NOT NULL,
          status               TEXT NOT NULL DEFAULT 'pending',
          created_at           INTEGER NOT NULL,
          decided_at           INTEGER,
          decided_by           TEXT,
          resolution_note      TEXT,
          revoke_tx_hash       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_milestone_disputes_player_wallet
          ON milestone_disputes(player_wallet);
        CREATE INDEX IF NOT EXISTS idx_milestone_disputes_status
          ON milestone_disputes(status);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_milestone_disputes_open
          ON milestone_disputes(milestone_id) WHERE status = 'pending';
      `);
    },
  },
  {
    version: 2,
    name: 'add_validator_and_events',
    up(db) {
      // Add new columns to the disputes table (ALTER TABLE … ADD COLUMN is safe
      // on existing rows — they get NULL defaults which we'll back-fill below).
      db.exec(`
        ALTER TABLE milestone_disputes ADD COLUMN validator_wallet TEXT NOT NULL DEFAULT '';
        ALTER TABLE milestone_disputes ADD COLUMN response_deadline INTEGER NOT NULL DEFAULT 0;

        CREATE TABLE IF NOT EXISTS dispute_events (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          dispute_id    INTEGER NOT NULL REFERENCES milestone_disputes(id),
          type          TEXT NOT NULL,
          actor_wallet  TEXT NOT NULL,
          body          TEXT,
          ipfs_hash     TEXT,
          ipfs_mime_type TEXT,
          created_at    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_dispute_events_dispute_id
          ON dispute_events(dispute_id);
      `);
    },
  },
];

// ── Row types (DB column names) ───────────────────────────────────────────────

interface DisputeRow {
  id: number;
  player_id: string;
  player_wallet: string;
  validator_wallet: string;
  milestone_id: string;
  milestone_description: string;
  reason: string;
  status: MilestoneDisputeStatus;
  created_at: number;
  response_deadline: number;
  decided_at: number | null;
  decided_by: string | null;
  resolution_note: string | null;
  revoke_tx_hash: string | null;
}

interface EventRow {
  id: number;
  dispute_id: number;
  type: DisputeEventType;
  actor_wallet: string;
  body: string | null;
  ipfs_hash: string | null;
  ipfs_mime_type: string | null;
  created_at: number;
}

// ── Row → domain object converters ────────────────────────────────────────────

function rowToDispute(row: DisputeRow): MilestoneDispute {
  return {
    id: row.id,
    playerId: row.player_id,
    playerWallet: row.player_wallet,
    validatorWallet: row.validator_wallet,
    milestoneId: row.milestone_id,
    milestoneDescription: row.milestone_description,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    responseDeadline: row.response_deadline,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    resolutionNote: row.resolution_note,
    revokeTxHash: row.revoke_tx_hash,
  };
}

function rowToEvent(row: EventRow): DisputeEvent {
  return {
    id: row.id,
    disputeId: row.dispute_id,
    type: row.type,
    actorWallet: row.actor_wallet,
    body: row.body,
    ipfsHash: row.ipfs_hash,
    ipfsMimeType: row.ipfs_mime_type,
    createdAt: row.created_at,
  };
}

// ── Input types ────────────────────────────────────────────────────────────────

export interface CreateDisputeInput {
  playerId: string;
  playerWallet: string;
  /** Stellar public key of the validator who approved the disputed milestone. */
  validatorWallet: string;
  milestoneId: string;
  milestoneDescription: string;
  reason: string;
}

export interface DecideDisputeInput {
  status: Exclude<MilestoneDisputeStatus, 'pending' | 'under_review' | 'escalated'>;
  decidedBy: string;
  resolutionNote: string | null;
  revokeTxHash: string | null;
}

export interface AddEventInput {
  type: DisputeEventType;
  actorWallet: string;
  body?: string | null;
  ipfsHash?: string | null;
  ipfsMimeType?: string | null;
}

// ── Domain errors ──────────────────────────────────────────────────────────────

/** Thrown by `create()` when the milestone already has an open dispute. */
export class DuplicateDisputeError extends Error {
  constructor(milestoneId: string) {
    super(`Milestone ${milestoneId} already has a pending dispute`);
    this.name = 'DuplicateDisputeError';
  }
}

/** Thrown when a disputed milestone is not found in the player's on-chain history. */
export class MilestoneNotFoundError extends Error {
  constructor(milestoneId: string, playerId?: string) {
    super(
      playerId
        ? `Milestone ${milestoneId} not found for player ${playerId}`
        : `Milestone ${milestoneId} not found`,
    );
    this.name = 'MilestoneNotFoundError';
  }
}

// ── Store ──────────────────────────────────────────────────────────────────────

export class MilestoneDisputeStore {
  private static _instance: MilestoneDisputeStore | null = null;

  private db: Database.Database;

  private constructor(db: Database.Database) {
    this.db = db;
  }

  static getInstance(): MilestoneDisputeStore {
    if (!MilestoneDisputeStore._instance) {
      MilestoneDisputeStore._instance = new MilestoneDisputeStore(
        openSqliteDb(
          'milestone-disputes.db',
          'MILESTONE_DISPUTES_DB_PATH',
          MIGRATIONS,
        ),
      );
    }
    return MilestoneDisputeStore._instance;
  }

  /** Closes the DB connection and clears the singleton. Use ONLY in tests. */
  static resetInstance(): void {
    if (MilestoneDisputeStore._instance) {
      MilestoneDisputeStore._instance.db.close();
    }
    MilestoneDisputeStore._instance = null;
  }

  // ── Disputes ──────────────────────────────────────────────────────────────

  create(input: CreateDisputeInput): MilestoneDispute {
    const existing = this.db
      .prepare(
        `SELECT id FROM milestone_disputes WHERE milestone_id = ? AND status = 'pending'`,
      )
      .get(input.milestoneId);
    if (existing) {
      throw new DuplicateDisputeError(input.milestoneId);
    }

    const now = Date.now();
    const deadline = now + getResponseWindowMs();

    const result = this.db
      .prepare(
        `INSERT INTO milestone_disputes
           (player_id, player_wallet, validator_wallet, milestone_id,
            milestone_description, reason, status, created_at, response_deadline)
         VALUES
           (@player_id, @player_wallet, @validator_wallet, @milestone_id,
            @milestone_description, @reason, 'pending', @created_at, @response_deadline)`,
      )
      .run({
        player_id: input.playerId,
        player_wallet: input.playerWallet,
        validator_wallet: input.validatorWallet,
        milestone_id: input.milestoneId,
        milestone_description: input.milestoneDescription,
        reason: input.reason,
        created_at: now,
        response_deadline: deadline,
      });

    const dispute = this.findById(Number(result.lastInsertRowid))!;

    // Record the 'opened' event so the timeline starts with the player's claim.
    this.addEvent(dispute.id, {
      type: 'opened',
      actorWallet: input.playerWallet,
      body: input.reason,
    });

    return dispute;
  }

  findById(id: number): MilestoneDispute | undefined {
    const row = this.db
      .prepare('SELECT * FROM milestone_disputes WHERE id = ?')
      .get(id) as DisputeRow | undefined;
    return row ? rowToDispute(row) : undefined;
  }

  /**
   * Returns a dispute with its full ordered event timeline.
   * Returns undefined when the dispute does not exist.
   */
  findByIdWithEvents(id: number): DisputeWithEvents | undefined {
    const dispute = this.findById(id);
    if (!dispute) return undefined;
    const events = this.getEvents(id);
    return { ...dispute, events };
  }

  listForWallet(playerWallet: string): MilestoneDispute[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM milestone_disputes WHERE player_wallet = ? ORDER BY created_at DESC',
      )
      .all(playerWallet) as DisputeRow[];
    return rows.map(rowToDispute);
  }

  /**
   * Returns all disputes where the validator's wallet matches — used to
   * notify validators of disputes they're involved in.
   */
  listForValidator(validatorWallet: string): MilestoneDispute[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM milestone_disputes WHERE validator_wallet = ? ORDER BY created_at DESC',
      )
      .all(validatorWallet) as DisputeRow[];
    return rows.map(rowToDispute);
  }

  /** Deletes every dispute owned by playerWallet. Returns the number of rows removed. */
  deleteForWallet(playerWallet: string): number {
    const result = this.db
      .prepare('DELETE FROM milestone_disputes WHERE player_wallet = ?')
      .run(playerWallet);
    return result.changes;
  }

  listAll(status?: MilestoneDisputeStatus): MilestoneDispute[] {
    const rows = status
      ? (this.db
          .prepare(
            'SELECT * FROM milestone_disputes WHERE status = ? ORDER BY created_at DESC',
          )
          .all(status) as DisputeRow[])
      : (this.db
          .prepare('SELECT * FROM milestone_disputes ORDER BY created_at DESC')
          .all() as DisputeRow[]);
    return rows.map(rowToDispute);
  }

  decide(id: number, input: DecideDisputeInput): MilestoneDispute {
    this.db
      .prepare(
        `UPDATE milestone_disputes
         SET status = @status, decided_at = @decided_at, decided_by = @decided_by,
             resolution_note = @resolution_note, revoke_tx_hash = @revoke_tx_hash
         WHERE id = @id`,
      )
      .run({
        id,
        status: input.status,
        decided_at: Date.now(),
        decided_by: input.decidedBy,
        resolution_note: input.resolutionNote,
        revoke_tx_hash: input.revokeTxHash,
      });

    // Record the decision event on the timeline.
    this.addEvent(id, {
      type: 'decided',
      actorWallet: input.decidedBy,
      body: input.resolutionNote,
    });

    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`Dispute ${id} not found`);
    }
    return updated;
  }

  /**
   * Transitions a dispute from 'pending' to 'under_review' when the
   * validator posts their response for the first time.
   */
  markUnderReview(id: number, validatorWallet: string): MilestoneDispute {
    this.db
      .prepare(
        `UPDATE milestone_disputes SET status = 'under_review'
         WHERE id = ? AND status = 'pending'`,
      )
      .run(id);
    const updated = this.findById(id);
    if (!updated) throw new Error(`Dispute ${id} not found`);
    return updated;
  }

  /**
   * Marks all disputes that have been 'pending' past their response deadline
   * as 'escalated', records a system event, and returns the number of rows
   * updated. Intended to be called by the cron route
   * /api/cron/escalate-disputes on a scheduled basis.
   */
  escalateUnanswered(now: number = Date.now()): number {
    const overdueRows = this.db
      .prepare(
        `SELECT id FROM milestone_disputes
         WHERE status = 'pending' AND response_deadline < ?`,
      )
      .all(now) as { id: number }[];

    if (overdueRows.length === 0) return 0;

    for (const { id } of overdueRows) {
      this.db
        .prepare(
          `UPDATE milestone_disputes SET status = 'escalated' WHERE id = ?`,
        )
        .run(id);
      this.addEvent(id, {
        type: 'escalated',
        actorWallet: 'system',
        body: 'Validator did not respond within the response window.',
      });
    }

    return overdueRows.length;
  }

  // ── Events ────────────────────────────────────────────────────────────────

  addEvent(disputeId: number, input: AddEventInput): DisputeEvent {
    const result = this.db
      .prepare(
        `INSERT INTO dispute_events
           (dispute_id, type, actor_wallet, body, ipfs_hash, ipfs_mime_type, created_at)
         VALUES
           (@dispute_id, @type, @actor_wallet, @body, @ipfs_hash, @ipfs_mime_type, @created_at)`,
      )
      .run({
        dispute_id: disputeId,
        type: input.type,
        actor_wallet: input.actorWallet,
        body: input.body ?? null,
        ipfs_hash: input.ipfsHash ?? null,
        ipfs_mime_type: input.ipfsMimeType ?? null,
        created_at: Date.now(),
      });

    const row = this.db
      .prepare('SELECT * FROM dispute_events WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as EventRow;
    return rowToEvent(row);
  }

  getEvents(disputeId: number): DisputeEvent[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM dispute_events WHERE dispute_id = ? ORDER BY created_at ASC',
      )
      .all(disputeId) as EventRow[];
    return rows.map(rowToEvent);
  }
}
