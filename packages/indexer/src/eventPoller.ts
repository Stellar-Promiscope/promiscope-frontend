import { createHash } from 'crypto';
import { SorobanRpc, Networks, xdr } from '@stellar/stellar-sdk';
import {
  decodeSorobanEvent,
  type EventType as SharedEventType,
} from '@promiscope/contract-events';
import { IndexerMetrics, type EventType } from './metrics/IndexerMetrics';
import {
  setRole,
  updateLastLedger,
  updateNetworkLedger,
} from './ledgerTracker';
import { EventStore, type IndexerStore } from './db/eventStore';
import type { LeaderElector } from './leaderElection';
import { logger } from './logger';

/**
 * Polls Soroban RPC's getEvents for new Promiscope contract events and feeds
 * them into ledgerTracker and IndexerMetrics — the module described but
 * never implemented in README.md's "Event Listener / Poller" section.
 *
 * Config (env vars, all per README.md):
 *   SOROBAN_RPC_URL, CONTRACT_ID (required)
 *   NETWORK_PASSPHRASE, POLL_INTERVAL_MS, START_LEDGER (optional, defaulted)
 */

export const EVENT_TYPES: readonly EventType[] = [
  'player_registered',
  'profile_updated',
  'milestone_approved',
  'milestone_revoked',
  'scout_subscribed',
  'player_contacted',
  'trial_offer_logged',
  'fees_withdrawn',
  'unknown',
];

export function isEventType(name: unknown): name is EventType {
  return (
    typeof name === 'string' &&
    (EVENT_TYPES as readonly string[]).includes(name)
  );
}

export interface PollerConfig {
  rpcUrl: string;
  contractId: string;
  networkPassphrase: string;
  pollIntervalMs: number;
  startLedger: number;
  contractVersion: number;
}

/** Reads and validates poller config from process.env. */
export function loadConfigFromEnv(): PollerConfig {
  const rpcUrl = process.env.SOROBAN_RPC_URL;
  const contractId = process.env.CONTRACT_ID;
  if (!rpcUrl) throw new Error('SOROBAN_RPC_URL is required');
  if (!contractId) throw new Error('CONTRACT_ID is required');

  return {
    rpcUrl,
    contractId,
    networkPassphrase: process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET,
    pollIntervalMs: process.env.POLL_INTERVAL_MS
      ? parseInt(process.env.POLL_INTERVAL_MS, 10)
      : 5000,
    startLedger: process.env.START_LEDGER
      ? parseInt(process.env.START_LEDGER, 10)
      : 0,
    contractVersion: process.env.CONTRACT_VERSION
      ? parseInt(process.env.CONTRACT_VERSION, 10)
      : 1,
  };
}

/**
 * Minimal surface of SorobanRpc.Server this module needs. A real
 * SorobanRpc.Server instance satisfies this structurally, and tests can
 * supply a lightweight mock instead of standing up a real RPC connection.
 */
export interface RpcClient {
  getEvents(request: {
    startLedger?: number;
    filters: Array<{ type?: 'contract'; contractIds?: string[] }>;
    limit?: number;
  }): Promise<{ latestLedger: number; events: RawEvent[] }>;
  getLatestLedger(): Promise<{ sequence: number }>;
}

export interface RawEvent {
  ledger: number;
  ledgerClosedAt: string;
  topic: xdr.ScVal[];
  value: xdr.ScVal;
  /**
   * Soroban RPC's own globally-unique id for this event (conventionally
   * `<ledgerSeq>-<eventIndexInLedger>`), when the node/SDK response
   * includes one. Preferred over the content hash fallback in
   * `decodeEvent` when present, since it's authoritative rather than
   * derived. Optional because it isn't part of the minimal `RpcClient`
   * contract this module was written against (see the ASSUMPTION note on
   * `decodeEvent`) and test mocks may omit it.
   */
  id?: string;
}

export interface DecodedEvent {
  type: EventType;
  contractVersion: number;
  ledger: number;
  timestamp: number;
  data: Record<string, unknown>;
  /**
   * Stable, content-derived identifier for the underlying on-chain event —
   * NOT a timestamp-of-observation. Two `decodeEvent` calls over the same
   * raw event (e.g. because a poll cycle re-fetched an already-processed
   * ledger range) always produce the same `eventId`, which
   * `EventStore.insertEvent` uses to make ingestion idempotent (issue
   * #1180: exactly-once notification delivery). See `computeEventId`.
   */
  eventId: string;
}

export function createRpcClient(config: PollerConfig): RpcClient {
  const allowHttp = new URL(config.rpcUrl).protocol === 'http:';
  return new SorobanRpc.Server(config.rpcUrl, {
    allowHttp,
  }) as unknown as RpcClient;
}

export function decodeEvent(raw: RawEvent, contractVersion = 1): DecodedEvent {
  const decoded = decodeSorobanEvent({
    topic: raw.topic ?? [],
    value: raw.value,
    contractVersion,
  });
  const timestamp = Math.floor(new Date(raw.ledgerClosedAt).getTime() / 1000);

  return {
    type: decoded.type as SharedEventType,
    contractVersion: decoded.version,
    ledger: raw.ledger,
    timestamp,
    data: {
      ...decoded.data,
      contractVersion: decoded.version,
      ledger: raw.ledger,
      timestamp,
    },
    eventId: computeEventId(decoded.type, raw),
  };
}

/**
 * Derives a stable, content-based identifier for a raw event — the fix for
 * issue #1180 (no exactly-once guarantee across overlapping poll cycles).
 *
 * The poller's cursor (`ledgerTracker`/`startEventPolling`'s local `cursor`
 * variable) lives only in process memory, so a restart, a misconfigured
 * `START_LEDGER`, or two poller instances running concurrently can all
 * cause the same ledger range to be fetched from Soroban RPC more than
 * once. Without a stable id, each re-fetch of the same on-chain event would
 * turn into a brand-new `events` row (a fresh AUTOINCREMENT id), which is
 * exactly the duplicate-notification bug the issue describes.
 *
 * Preference order:
 *  1. `raw.id` — Soroban RPC's own globally-unique per-event id, when the
 *     node/SDK response includes one. Authoritative: two fetches of the
 *     same on-chain event always report the same id.
 *  2. A SHA-256 digest of the event's ledger + topic + value (all
 *     deterministic, content-derived fields — never a fetch/observation
 *     timestamp). Re-fetching the same raw event yields byte-identical
 *     XDR for `topic`/`value`, so the digest — and therefore `eventId` —
 *     is identical across polls. This is the fallback used by every
 *     existing test mock, which doesn't set `raw.id`.
 */
function computeEventId(name: EventType, raw: RawEvent): string {
  if (raw.id) {
    return `${name}:${raw.id}`;
  }
  const topicKey = raw.topic.map((t) => t.toXDR('base64')).join('|');
  const valueKey = raw.value ? raw.value.toXDR('base64') : '';
  const digest = createHash('sha256')
    .update(`${raw.ledger}:${topicKey}:${valueKey}`)
    .digest('hex')
    .slice(0, 24);
  return `${name}:${raw.ledger}:${digest}`;
}

/**
 * Heuristics for detecting that a `startLedger` is outside the Soroban RPC
 * node's event retention window.
 *
 * Soroban RPC typically returns an error message containing the phrase
 * "start is before oldest ledger" or similar when the requested startLedger
 * predates the oldest ledger the node still has events for. The exact
 * message text varies across node versions; we check the most common forms.
 *
 * This function is intentionally conservative: a false-negative (not
 * detecting a retention error) falls back to ordinary retry behaviour, which
 * is the existing (safe) default. A false-positive would cause the poller to
 * skip forward unnecessarily — so we only match known, specific phrases.
 */
export function isRetentionWindowError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('start is before oldest ledger') ||
    msg.includes('startledger must be within the ledger retention window') ||
    msg.includes('outside the ledger retention window') ||
    msg.includes('ledger not found') ||
    msg.includes('start ledger is before') ||
    // Soroban RPC JSON-RPC error code -32600 is used for "invalid request",
    // which the node returns for out-of-window startLedger on some builds.
    (err as { code?: number }).code === -32600
  );
}

const MAX_ERROR_LENGTH = 200;

let lastPollError: string | null = null;

/**
 * Most recent poll-cycle error message, or null once a cycle succeeds.
 * URLs are redacted (an RPC URL can embed an API key) and the message is
 * truncated, so it's safe to expose on /health.
 */
export function getLastPollError(): string | null {
  return lastPollError;
}

function recordPollError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  lastPollError = message
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .slice(0, MAX_ERROR_LENGTH);
}

/** Clears the last poll error. Use ONLY in tests. */
export function resetLastPollError(): void {
  lastPollError = null;
}

/**
 * Fetches and processes one batch of events starting at `cursorLedger`
 * (or the current network tip, if `cursorLedger` is 0 — START_LEDGER's
 * documented "0 = latest" semantics). Returns the ledger to resume from on
 * the next call.
 *
 * Exported (in addition to startEventPolling) so tests can exercise a
 * single poll cycle directly against a mocked RpcClient, without needing
 * to drive setTimeout scheduling.
 *
 * Recovery strategy for retention window expiry (issue #1000):
 *   When getEvents fails with an error indicating the requested startLedger
 *   is before the node's oldest retained ledger, the poller skips forward to
 *   the current network tip (the safest point we *know* the node can serve).
 *   This creates a gap in indexed history, which is recorded in
 *   IndexerMetrics.recordRetentionWindowGap() so operators and downstream
 *   consumers are aware.  The alternative — halting and alerting — is noted
 *   in docs/adr/ as a follow-up option for deployments where gaps are
 *   unacceptable.
 */
export async function pollOnce(
  config: PollerConfig,
  rpc: RpcClient,
  metrics: IndexerMetrics,
  cursorLedger: number,
  store: IndexerStore,
): Promise<number> {
  const cycleStart = Date.now();

  try {
    const latest = await rpc.getLatestLedger();
    updateNetworkLedger(latest.sequence);

    const effectiveStart = cursorLedger > 0 ? cursorLedger : latest.sequence;

    let res: { latestLedger: number; events: RawEvent[] };
    try {
      res = await rpc.getEvents({
        startLedger: effectiveStart,
        filters: [{ type: 'contract', contractIds: [config.contractId] }],
        limit: 100,
      });
    } catch (getEventsErr) {
      // Distinguish retention window expiry from ordinary transient errors.
      if (isRetentionWindowError(getEventsErr)) {
        // Skip forward to the current network tip.  This is the earliest
        // point we know the node has events for (it just reported it).
        // We record the gap so it is observable.
        const skipTo = latest.sequence;
        const durationMs = Date.now() - cycleStart;
        logger.warn(
          "Cursor is outside the node's retention window, skipping forward",
          {
            ledger: effectiveStart,
            skipTo,
            durationMs,
          },
        );
        metrics.recordRetentionWindowGap(effectiveStart, skipTo);
        metrics.recordFailure(durationMs);
        metrics.reportCursor(skipTo);
        return skipTo;
      }
      // Ordinary transient RPC failure — retry the same range next cycle.
      recordPollError(getEventsErr);
      metrics.recordFailure(Date.now() - cycleStart);
      metrics.reportCursor(cursorLedger);
      return cursorLedger;
    }

    let nextCursor = cursorLedger > 0 ? cursorLedger : effectiveStart;
    const decodedBatch: Array<{ event: DecodedEvent; decodeMs: number }> = [];

    for (const raw of res.events) {
      const eventStart = Date.now();
      try {
        const event = decodeEvent(raw, config.contractVersion);
        // Serialise up front: an event the store can't persist must be
        // skipped on its own (as before batching), not fail the whole
        // batch and pin the cursor on this range forever.
        JSON.stringify(event.data);
        decodedBatch.push({ event, decodeMs: Date.now() - eventStart });
      } catch {
        // Malformed or unrecognized event from our own contract — a real
        // processing failure, not a transient RPC error, but still must
        // not stop the loop from advancing past it.
        metrics.recordFailure(Date.now() - eventStart);
      }

      if (raw.ledger >= nextCursor) {
        nextCursor = raw.ledger + 1;
      }
    }

    if (res.events.length === 0) {
      nextCursor = Math.max(nextCursor, res.latestLedger + 1);
    }

    // Events and checkpoint commit together (issue #1319): if the write
    // fails, neither lands and the same range is retried next cycle.
    const writeStart = Date.now();
    try {
      await store.insertBatch(
        decodedBatch.map((d) => d.event),
        {
          lastLedger: Math.max(nextCursor - 1, 0),
          networkLedger: latest.sequence,
        },
      );
    } catch {
      metrics.recordFailure(Date.now() - cycleStart);
      metrics.reportCursor(cursorLedger);
      return cursorLedger;
    }
    const writeMs = Date.now() - writeStart;
    for (const { event, decodeMs } of decodedBatch) {
      metrics.recordSuccess(
        event.type,
        decodeMs + writeMs,
        JSON.stringify(event.data).length,
      );
    }

    updateLastLedger(Math.max(nextCursor - 1, 0));
    lastPollError = null;
    metrics.markHealthy();
    metrics.reportCursor(nextCursor);

    const durationMs = Date.now() - cycleStart;
    logger.info('Poll completed', {
      ledger: effectiveStart,
      eventCount: res.events.length,
      durationMs,
    });

    return nextCursor;
  } catch (err) {
    // RPC-level failure on getLatestLedger — retry the same range next cycle.
    recordPollError(err);
    metrics.recordFailure(Date.now() - cycleStart);
    metrics.reportCursor(cursorLedger);
    return cursorLedger;
  }
}

export interface EventPollerHandle {
  /** Cancels the next cycle and resolves once the in-flight one settles. */
  stop(): Promise<void>;
  /** False once stop() has been called. */
  isRunning(): boolean;
}

/**
 * Starts the recurring poll loop on a POLL_INTERVAL_MS cadence. Each cycle
 * runs pollOnce and schedules the next one only after it settles, so a slow
 * or hanging RPC call can't cause overlapping cycles to pile up.
 */
export function startEventPolling(
  config: PollerConfig = loadConfigFromEnv(),
  rpc: RpcClient = createRpcClient(config),
  metrics: IndexerMetrics = IndexerMetrics.getInstance(),
  store: IndexerStore = EventStore.getInstance(),
  elector: LeaderElector | null = null,
): EventPollerHandle {
  let cursor = config.startLedger;
  let wasLeader = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  function tick(): void {
    inFlight = (async () => {
      try {
        // Without an elector (single replica) this process is always leader.
        const isLeader = elector ? await elector.tick() : true;
        setRole(isLeader ? 'leader' : 'follower');

        if (isLeader) {
          if (!wasLeader) {
            // Fresh start or takeover: resume from the shared checkpoint.
            const checkpoint = await store.getCheckpoint();
            if (checkpoint && checkpoint.lastLedger + 1 > cursor) {
              cursor = checkpoint.lastLedger + 1;
            }
          }
          wasLeader = true;
          if (!stopped) {
            cursor = await pollOnce(config, rpc, metrics, cursor, store);
          }
        } else {
          // Lost (or never held) the lock: stop polling immediately.
          wasLeader = false;
        }
      } catch (err) {
        console.error('[eventPoller] poll cycle failed:', err);
        metrics.recordFailure(0);
      }
      if (!stopped) {
        timer = setTimeout(tick, config.pollIntervalMs);
      }
    })();
  }

  tick();

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      void elector?.release();
      await inFlight;
    },
    isRunning(): boolean {
      return !stopped;
    },
  };
}
