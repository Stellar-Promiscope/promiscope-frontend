/**
 * @jest-environment node
 *
 * Tests for the extended MilestoneDisputeStore (dispute_events table,
 * escalation, validator-aware creation, event recording).
 */
import {
  MilestoneDisputeStore,
  DuplicateDisputeError,
  getResponseWindowMs,
  type CreateDisputeInput,
} from '@/lib/milestoneDisputeStore';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeInput(
  overrides: Partial<CreateDisputeInput> = {},
): CreateDisputeInput {
  return {
    playerId: 'player-1',
    playerWallet: 'GPLAYER',
    validatorWallet: 'GVALIDATOR',
    milestoneId: 'milestone-1',
    milestoneDescription: 'Scored a hat-trick',
    reason: 'Evidence is inconclusive',
    ...overrides,
  };
}

let store: MilestoneDisputeStore;

beforeEach(() => {
  MilestoneDisputeStore.resetInstance();
  store = MilestoneDisputeStore.getInstance();
});

afterEach(() => {
  MilestoneDisputeStore.resetInstance();
});

// ── Store singleton ────────────────────────────────────────────────────────────

describe('singleton', () => {
  it('returns the same instance on repeated calls', () => {
    expect(MilestoneDisputeStore.getInstance()).toBe(
      MilestoneDisputeStore.getInstance(),
    );
  });
});

// ── create() ──────────────────────────────────────────────────────────────────

describe('create()', () => {
  it('returns a dispute with status pending and all required fields', () => {
    const d = store.create(makeInput());
    expect(d).toMatchObject({
      playerId: 'player-1',
      playerWallet: 'GPLAYER',
      validatorWallet: 'GVALIDATOR',
      milestoneId: 'milestone-1',
      milestoneDescription: 'Scored a hat-trick',
      reason: 'Evidence is inconclusive',
      status: 'pending',
      decidedAt: null,
      decidedBy: null,
      resolutionNote: null,
      revokeTxHash: null,
    });
    expect(typeof d.id).toBe('number');
    expect(typeof d.createdAt).toBe('number');
    expect(typeof d.responseDeadline).toBe('number');
    expect(d.responseDeadline).toBeGreaterThan(d.createdAt);
  });

  it('automatically creates an opened event on the timeline', () => {
    const d = store.create(makeInput());
    const events = store.getEvents(d.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'opened',
      actorWallet: 'GPLAYER',
      body: 'Evidence is inconclusive',
    });
  });

  it('throws DuplicateDisputeError when the milestone already has a pending dispute', () => {
    store.create(makeInput());
    expect(() => store.create(makeInput())).toThrow(DuplicateDisputeError);
  });

  it('allows re-disputing a milestone once its prior dispute has been decided', () => {
    const first = store.create(makeInput());
    store.decide(first.id, {
      status: 'upheld',
      decidedBy: 'GADMIN',
      resolutionNote: 'No issue found',
      revokeTxHash: null,
    });
    const second = store.create(makeInput());
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('pending');
  });
});

// ── findById / findByIdWithEvents ─────────────────────────────────────────────

describe('findById()', () => {
  it('returns undefined for a non-existent id', () => {
    expect(store.findById(999)).toBeUndefined();
  });

  it('returns the matching dispute', () => {
    const d = store.create(makeInput());
    expect(store.findById(d.id)).toEqual(d);
  });
});

describe('findByIdWithEvents()', () => {
  it('returns undefined when dispute does not exist', () => {
    expect(store.findByIdWithEvents(999)).toBeUndefined();
  });

  it('returns the dispute with its events array', () => {
    const d = store.create(makeInput());
    const result = store.findByIdWithEvents(d.id);
    expect(result).toBeDefined();
    expect(result!.id).toBe(d.id);
    expect(Array.isArray(result!.events)).toBe(true);
    expect(result!.events.length).toBeGreaterThanOrEqual(1);
    expect(result!.events[0].type).toBe('opened');
  });
});

// ── listForWallet / listForValidator ──────────────────────────────────────────

describe('listForWallet()', () => {
  it('returns only disputes for that wallet, newest first', () => {
    store.create(makeInput({ playerWallet: 'GA', milestoneId: 'm1' }));
    store.create(makeInput({ playerWallet: 'GB', milestoneId: 'm2' }));
    store.create(makeInput({ playerWallet: 'GA', milestoneId: 'm3' }));
    expect(store.listForWallet('GA')).toHaveLength(2);
    expect(store.listForWallet('GB')).toHaveLength(1);
  });

  it('returns empty array for unknown wallet', () => {
    expect(store.listForWallet('GNOBODY')).toEqual([]);
  });
});

describe('listForValidator()', () => {
  it('returns disputes whose validatorWallet matches', () => {
    store.create(makeInput({ validatorWallet: 'GVAL1', milestoneId: 'm1' }));
    store.create(makeInput({ validatorWallet: 'GVAL2', milestoneId: 'm2' }));
    store.create(makeInput({ validatorWallet: 'GVAL1', milestoneId: 'm3' }));
    expect(store.listForValidator('GVAL1')).toHaveLength(2);
    expect(store.listForValidator('GVAL2')).toHaveLength(1);
    expect(store.listForValidator('GNONE')).toHaveLength(0);
  });
});

// ── listAll ───────────────────────────────────────────────────────────────────

describe('listAll()', () => {
  it('returns every dispute with no filter', () => {
    store.create(makeInput({ milestoneId: 'm1' }));
    store.create(makeInput({ milestoneId: 'm2' }));
    expect(store.listAll()).toHaveLength(2);
  });

  it('filters by status', () => {
    const d1 = store.create(makeInput({ milestoneId: 'm1' }));
    store.create(makeInput({ milestoneId: 'm2' }));
    store.decide(d1.id, {
      status: 'reversed',
      decidedBy: 'GADMIN',
      resolutionNote: null,
      revokeTxHash: 'txhash',
    });
    expect(store.listAll('reversed')).toHaveLength(1);
    expect(store.listAll('pending')).toHaveLength(1);
  });
});

// ── addEvent / getEvents ──────────────────────────────────────────────────────

describe('addEvent() / getEvents()', () => {
  it('adds an evidence_added event and returns it', () => {
    const d = store.create(makeInput());
    const ev = store.addEvent(d.id, {
      type: 'evidence_added',
      actorWallet: 'GPLAYER',
      body: 'See attached video',
      ipfsHash: 'bafyCID123',
      ipfsMimeType: 'video/mp4',
    });
    expect(ev).toMatchObject({
      disputeId: d.id,
      type: 'evidence_added',
      actorWallet: 'GPLAYER',
      body: 'See attached video',
      ipfsHash: 'bafyCID123',
      ipfsMimeType: 'video/mp4',
    });
    expect(typeof ev.id).toBe('number');
    expect(typeof ev.createdAt).toBe('number');
  });

  it('getEvents returns all events in chronological order (opened first)', () => {
    const d = store.create(makeInput());
    store.addEvent(d.id, {
      type: 'validator_response',
      actorWallet: 'GVALIDATOR',
      body: 'I approved this legitimately',
    });
    store.addEvent(d.id, {
      type: 'evidence_added',
      actorWallet: 'GPLAYER',
      ipfsHash: 'bafyCID',
      ipfsMimeType: 'image/jpeg',
    });
    const events = store.getEvents(d.id);
    expect(events).toHaveLength(3); // opened + validator_response + evidence_added
    expect(events[0].type).toBe('opened');
    expect(events[1].type).toBe('validator_response');
    expect(events[2].type).toBe('evidence_added');
  });

  it('events for different disputes are isolated', () => {
    const d1 = store.create(makeInput({ milestoneId: 'm1' }));
    const d2 = store.create(makeInput({ milestoneId: 'm2' }));
    store.addEvent(d2.id, {
      type: 'admin_note',
      actorWallet: 'GADMIN',
      body: 'Note on d2',
    });
    expect(store.getEvents(d1.id)).toHaveLength(1); // only opened
    expect(store.getEvents(d2.id)).toHaveLength(2); // opened + admin_note
  });
});

// ── markUnderReview ───────────────────────────────────────────────────────────

describe('markUnderReview()', () => {
  it('transitions a pending dispute to under_review', () => {
    const d = store.create(makeInput());
    expect(d.status).toBe('pending');
    const updated = store.markUnderReview(d.id, 'GVALIDATOR');
    expect(updated.status).toBe('under_review');
  });

  it('is a no-op on a non-pending dispute (already under_review)', () => {
    const d = store.create(makeInput());
    store.markUnderReview(d.id, 'GVALIDATOR');
    // Second call should not throw (WHERE clause simply matches 0 rows)
    expect(() => store.markUnderReview(d.id, 'GVALIDATOR')).not.toThrow();
    expect(store.findById(d.id)!.status).toBe('under_review');
  });
});

// ── decide ────────────────────────────────────────────────────────────────────

describe('decide()', () => {
  it('updates status, decidedAt, decidedBy, resolutionNote, revokeTxHash', () => {
    const d = store.create(makeInput());
    const decided = store.decide(d.id, {
      status: 'reversed',
      decidedBy: 'GADMIN',
      resolutionNote: 'Milestone revoked on-chain',
      revokeTxHash: 'abcd1234',
    });
    expect(decided.status).toBe('reversed');
    expect(decided.decidedBy).toBe('GADMIN');
    expect(decided.resolutionNote).toBe('Milestone revoked on-chain');
    expect(decided.revokeTxHash).toBe('abcd1234');
    expect(typeof decided.decidedAt).toBe('number');
  });

  it('records a decided event on the timeline', () => {
    const d = store.create(makeInput());
    store.decide(d.id, {
      status: 'upheld',
      decidedBy: 'GADMIN',
      resolutionNote: 'Stand by original decision',
      revokeTxHash: null,
    });
    const events = store.getEvents(d.id);
    const decided = events.find((e) => e.type === 'decided');
    expect(decided).toBeDefined();
    expect(decided!.actorWallet).toBe('GADMIN');
    expect(decided!.body).toBe('Stand by original decision');
  });

  it('throws when dispute id does not exist', () => {
    expect(() =>
      store.decide(999, {
        status: 'upheld',
        decidedBy: 'GADMIN',
        resolutionNote: null,
        revokeTxHash: null,
      }),
    ).toThrow('Dispute 999 not found');
  });

  it('can decide an under_review dispute', () => {
    const d = store.create(makeInput());
    store.markUnderReview(d.id, 'GVALIDATOR');
    const decided = store.decide(d.id, {
      status: 'upheld',
      decidedBy: 'GADMIN',
      resolutionNote: null,
      revokeTxHash: null,
    });
    expect(decided.status).toBe('upheld');
  });
});

// ── escalateUnanswered ────────────────────────────────────────────────────────

describe('escalateUnanswered()', () => {
  it('marks overdue pending disputes as escalated and returns the count', () => {
    // Create two disputes with a deadline in the past
    const past = Date.now() - 1000;
    const d1 = store.create(makeInput({ milestoneId: 'm1' }));
    const d2 = store.create(makeInput({ milestoneId: 'm2' }));
    // Manually push response_deadline into the past via raw SQL (test only)
    const db = (store as unknown as { db: { prepare: Function } }).db;
    db.prepare(
      `UPDATE milestone_disputes SET response_deadline = ? WHERE id IN (?, ?)`,
    ).run(past, d1.id, d2.id);

    const count = store.escalateUnanswered(Date.now());
    expect(count).toBe(2);
    expect(store.findById(d1.id)!.status).toBe('escalated');
    expect(store.findById(d2.id)!.status).toBe('escalated');
  });

  it('does not escalate disputes that are still within their window', () => {
    const d = store.create(makeInput());
    // responseDeadline is 7 days in the future by default
    const count = store.escalateUnanswered(Date.now());
    expect(count).toBe(0);
    expect(store.findById(d.id)!.status).toBe('pending');
  });

  it('does not escalate already-decided disputes', () => {
    const d = store.create(makeInput());
    store.decide(d.id, {
      status: 'upheld',
      decidedBy: 'GADMIN',
      resolutionNote: null,
      revokeTxHash: null,
    });
    const db = (store as unknown as { db: { prepare: Function } }).db;
    db.prepare(`UPDATE milestone_disputes SET response_deadline = 1 WHERE id = ?`).run(d.id);

    // Should not re-escalate already-decided disputes
    const count = store.escalateUnanswered(Date.now());
    expect(count).toBe(0);
    expect(store.findById(d.id)!.status).toBe('upheld');
  });

  it('records an escalated system event on each escalated dispute', () => {
    const d = store.create(makeInput());
    const db = (store as unknown as { db: { prepare: Function } }).db;
    db.prepare(`UPDATE milestone_disputes SET response_deadline = 1 WHERE id = ?`).run(d.id);

    store.escalateUnanswered(Date.now());
    const events = store.getEvents(d.id);
    const escalated = events.find((e) => e.type === 'escalated');
    expect(escalated).toBeDefined();
    expect(escalated!.actorWallet).toBe('system');
  });

  it('does not escalate under_review disputes (validator already responded)', () => {
    const d = store.create(makeInput());
    store.markUnderReview(d.id, 'GVALIDATOR');
    const db = (store as unknown as { db: { prepare: Function } }).db;
    db.prepare(`UPDATE milestone_disputes SET response_deadline = 1 WHERE id = ?`).run(d.id);

    // escalateUnanswered only targets 'pending' rows
    const count = store.escalateUnanswered(Date.now());
    expect(count).toBe(0);
    expect(store.findById(d.id)!.status).toBe('under_review');
  });
});

// ── getResponseWindowMs ───────────────────────────────────────────────────────

describe('getResponseWindowMs()', () => {
  it('defaults to 7 days when env var is not set', () => {
    const original = process.env.DISPUTE_RESPONSE_WINDOW_MS;
    delete process.env.DISPUTE_RESPONSE_WINDOW_MS;
    expect(getResponseWindowMs()).toBe(7 * 24 * 60 * 60 * 1000);
    process.env.DISPUTE_RESPONSE_WINDOW_MS = original;
  });

  it('reads a custom window from DISPUTE_RESPONSE_WINDOW_MS', () => {
    const original = process.env.DISPUTE_RESPONSE_WINDOW_MS;
    process.env.DISPUTE_RESPONSE_WINDOW_MS = '86400000'; // 1 day
    expect(getResponseWindowMs()).toBe(86_400_000);
    process.env.DISPUTE_RESPONSE_WINDOW_MS = original;
  });

  it('falls back to 7 days for invalid values', () => {
    const original = process.env.DISPUTE_RESPONSE_WINDOW_MS;
    process.env.DISPUTE_RESPONSE_WINDOW_MS = 'not-a-number';
    expect(getResponseWindowMs()).toBe(7 * 24 * 60 * 60 * 1000);
    process.env.DISPUTE_RESPONSE_WINDOW_MS = original;
  });
});
