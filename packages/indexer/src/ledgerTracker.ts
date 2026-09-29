/**
 * ledgerTracker — tracks the last indexed ledger sequence and the latest
 * network ledger for lag computation.
 */

interface LedgerInfo {
  lastLedger: number;
  timestamp: number; // Unix ms of last update
  networkLedger: number; // Latest ledger seen on-chain (0 = unknown)
}

/**
 * Replica role (issue #1319). A single-replica (SQLite) deployment is
 * always the leader; with Postgres only the advisory-lock holder is.
 */
export type ReplicaRole = 'leader' | 'follower';

let role: ReplicaRole = 'leader';

export function setRole(next: ReplicaRole): void {
  role = next;
}

export function getRole(): ReplicaRole {
  return role;
}

const state: LedgerInfo = {
  lastLedger: 0,
  timestamp: 0,
  networkLedger: 0,
};

export function updateLastLedger(sequence: number): void {
  state.lastLedger = sequence;
  state.timestamp = Date.now();
}

export function updateNetworkLedger(sequence: number): void {
  state.networkLedger = sequence;
}

export function getLastLedgerInfo(): LedgerInfo {
  return { ...state };
}

/** Returns networkLedger - lastLedger (0 if unknown). */
export function getLedgerLag(): number {
  if (state.networkLedger === 0 || state.lastLedger === 0) return 0;
  return Math.max(0, state.networkLedger - state.lastLedger);
}

/** Resets ledger state. Use ONLY in tests. */
export function resetLedgerState(): void {
  state.lastLedger = 0;
  state.timestamp = 0;
  state.networkLedger = 0;
  role = 'leader';
}
