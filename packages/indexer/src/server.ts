import * as http from 'http';
import { IndexerMetrics } from './metrics/IndexerMetrics';
import { getLastLedgerInfo, getLedgerLag, getRole } from './ledgerTracker';
import {
  startEventPolling,
  isEventType,
  getLastPollError,
  loadConfigFromEnv,
  createRpcClient,
  type EventPollerHandle,
} from './eventPoller';
import {
  EventStore,
  decodePlayerCursor,
  type PlayerQueryFilter,
  type PlayerRecord,
  type EventRecord,
  type QueryFilter,
  type WalletApprovalWindow,
} from './db/eventStore';
import { createPgPoolFromEnv, getStore, initStore } from './db';
import { LeaderElector } from './leaderElection';
import type { EventType } from './metrics/IndexerMetrics';
import { logger } from './logger';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

const startTime = Date.now();

/** How long a fresh indexer may report `starting` before it's `unhealthy`. */
const STARTUP_GRACE_MS = 120_000;
/** A last successful poll older than this marks the indexer `degraded`. */
const STALE_AFTER_MS = 60_000;
const MAX_LEDGER_LAG = process.env.HEALTH_MAX_LEDGER_LAG
  ? parseInt(process.env.HEALTH_MAX_LEDGER_LAG, 10)
  : 100;
const SHUTDOWN_TIMEOUT_MS = 10_000;

export type HealthStatus = 'starting' | 'ok' | 'degraded' | 'unhealthy';

export interface HealthInput {
  now: number;
  startedAt: number;
  lastIngestedAt: number; // 0 = never
  pollerRunning: boolean;
  pollerHealthy: boolean; // false after repeated consecutive RPC failures
  ledgerLag: number;
}

/**
 * Health state machine (issue #1334): starting → ok → degraded → unhealthy.
 * `unhealthy` means the poller isn't running, keeps failing, or hasn't
 * ingested anything by the end of the startup grace period.
 */
export function computeHealthStatus(input: HealthInput): HealthStatus {
  if (!input.pollerRunning || !input.pollerHealthy) return 'unhealthy';
  if (input.lastIngestedAt === 0) {
    return input.now - input.startedAt < STARTUP_GRACE_MS
      ? 'starting'
      : 'unhealthy';
  }
  if (
    input.now - input.lastIngestedAt > STALE_AFTER_MS ||
    input.ledgerLag > MAX_LEDGER_LAG
  ) {
    return 'degraded';
  }
  return 'ok';
}

let poller: EventPollerHandle | null = null;
let pollerStartError: string | null = null;

/** Records the running poller (or why it failed to start) for /health. */
export function setPollerState(
  handle: EventPollerHandle | null,
  startError: string | null = null,
): void {
  poller = handle;
  pollerStartError = startError;
}

function isPollerRunning(): boolean {
  return poller?.isRunning() ?? false;
}

async function handleHealth(res: http.ServerResponse): Promise<void> {
  const role = getRole();
  const now = Date.now();

  if (role === 'follower') {
    // Followers don't poll; report the leader's progress from the shared
    // checkpoint instead of this process's (idle) ledgerTracker.
    const checkpoint = await getStore().getCheckpoint();
    const checkpointAgeMs = checkpoint ? now - checkpoint.updatedAt : null;
    return sendJson(res, 200, {
      status:
        checkpointAgeMs !== null && checkpointAgeMs <= STALE_AFTER_MS
          ? 'ok'
          : 'degraded',
      role,
      lastLedger: checkpoint?.lastLedger ?? 0,
      leaderLag: checkpoint
        ? Math.max(0, checkpoint.networkLedger - checkpoint.lastLedger)
        : null,
      leaderCheckpointAgeMs: checkpointAgeMs,
      uptime: Math.floor((now - startTime) / 1000),
    });
  }

  const { lastLedger, timestamp } = getLastLedgerInfo();
  const pollerRunning = isPollerRunning();
  const ledgerLag = getLedgerLag();
  const status = computeHealthStatus({
    now,
    startedAt: startTime,
    lastIngestedAt: timestamp,
    pollerRunning,
    pollerHealthy: IndexerMetrics.getInstance().snapshot().isHealthy,
    ledgerLag,
  });
  sendJson(res, status === 'unhealthy' ? 503 : 200, {
    status,
    role,
    lastLedger,
    lastUpdated: timestamp > 0 ? timestamp : null,
    ledgerLag,
    pollerRunning,
    lastError: pollerStartError ?? getLastPollError(),
    uptime: Math.floor((now - startTime) / 1000),
  });
}

function handleMetrics(res: http.ServerResponse): void {
  const snap = IndexerMetrics.getInstance().snapshot();
  const lag = getLedgerLag();

  const lines: string[] = [
    '# HELP indexer_events_total Total events processed by type',
    '# TYPE indexer_events_total counter',
    ...Object.entries(snap.eventCounts).map(
      ([type, count]) => `indexer_events_total{type="${type}"} ${count}`,
    ),
    '# HELP indexer_unknown_events_total Total events with an unknown topic or contract version',
    '# TYPE indexer_unknown_events_total counter',
    `indexer_unknown_events_total ${snap.unknownEvents}`,
    '# HELP indexer_processed_total Total events processed (all types)',
    '# TYPE indexer_processed_total counter',
    `indexer_processed_total ${snap.totalProcessed}`,
    '# HELP indexer_errors_total Total processing failures',
    '# TYPE indexer_errors_total counter',
    `indexer_errors_total ${snap.totalFailures}`,
    '# HELP indexer_error_rate_percent Failure rate as a percentage',
    '# TYPE indexer_error_rate_percent gauge',
    `indexer_error_rate_percent ${snap.errorRatePercent.toFixed(4)}`,
    '# HELP indexer_latency_avg_ms Processing latency EMA in milliseconds',
    '# TYPE indexer_latency_avg_ms gauge',
    `indexer_latency_avg_ms ${snap.latencyAvgMs.toFixed(4)}`,
    '# HELP indexer_latency_p95_ms Processing latency p95 in milliseconds (sliding window)',
    '# TYPE indexer_latency_p95_ms gauge',
    `indexer_latency_p95_ms ${snap.latencyP95Ms.toFixed(4)}`,
    '# HELP indexer_ledger_lag Difference between network ledger and last indexed ledger',
    '# TYPE indexer_ledger_lag gauge',
    `indexer_ledger_lag ${lag}`,
    '# HELP indexer_healthy 1 if indexer is healthy, 0 otherwise',
    '# TYPE indexer_healthy gauge',
    `indexer_healthy ${snap.isHealthy ? 1 : 0}`,
    '# HELP indexer_poller_running 1 if the event poller is running, 0 otherwise',
    '# TYPE indexer_poller_running gauge',
    `indexer_poller_running ${isPollerRunning() ? 1 : 0}`,
    '# HELP indexer_is_leader 1 if this replica holds the polling leader lock, 0 otherwise',
    '# TYPE indexer_is_leader gauge',
    `indexer_is_leader ${getRole() === 'leader' ? 1 : 0}`,
  ];

  res.writeHead(200, {
    'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
  });
  res.end(lines.join('\n') + '\n');
}

const PLAYER_EVENTS_PATH = /^\/players\/([^/]+)\/events$/;
const VALIDATOR_EVENTS_PATH = /^\/validators\/([^/]+)\/events$/;

/**
 * Max length for a region/position filter value — guards against absurd
 * query strings; real values are short slugs/labels ("West Africa", "ST").
 */
const MAX_FILTER_VALUE_LENGTH = 100;

/**
 * GET /stream?topics=<comma-separated>&wallet=<address>
 *
 * Server-Sent Events endpoint. Pushes decoded contract events to the client
 * as they are ingested. Supports:
 *
 *   - `topics`      comma-separated list of event types to filter on;
 *                   omit or leave blank to receive all topics.
 *   - `wallet`      only receive events that involve this wallet address
 *                   (playerId, scout, or validator field).
 *   - `Last-Event-ID` HTTP header: the client's last received event id
 *                   (the DB row id). On reconnect, any events whose id >
 *                   Last-Event-ID are replayed before live streaming begins.
 *
 * Heartbeats (`: heartbeat\n\n`) are sent every 25 s so proxies and load
 * balancers don't close idle connections.
 *
 * Scaling note: fan-out is in-process. A horizontally-scaled deployment
 * would replace the EventStore subscriber registry with Redis pub/sub.
 */
function handleStream(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): void {
  const topicsParam = url.searchParams.get('topics') ?? '';
  const topics = topicsParam
    ? topicsParam
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  const wallet = url.searchParams.get('wallet') ?? null;

  // Last-Event-ID resume: replay missed events before entering live mode.
  const lastEventIdHeader = req.headers['last-event-id'];
  const lastEventId =
    typeof lastEventIdHeader === 'string' && lastEventIdHeader !== ''
      ? parseInt(lastEventIdHeader, 10)
      : null;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const store = EventStore.getInstance();

  // Helper: serialise one EventRecord as an SSE message.
  function sendEvent(record: EventRecord): void {
    const payload = JSON.stringify(record);
    res.write(`id: ${record.id}\nevent: ${record.type}\ndata: ${payload}\n\n`);
  }

  // Replay missed events if Last-Event-ID was provided.
  if (lastEventId !== null && !Number.isNaN(lastEventId)) {
    const filter = {
      ...(topics.length > 0 && {
        type: topics[0] as import('./db/eventStore').QueryFilter['type'],
      }),
      limit: 200,
    };
    // Fetch recent events and replay those with id > lastEventId.
    const { events } = store.getEvents(filter);
    const missed = events
      .filter((e) => e.id > lastEventId)
      .sort((a, b) => a.id - b.id);
    for (const event of missed) {
      const walletMatch =
        !wallet ||
        event.playerId === wallet ||
        event.scout === wallet ||
        event.validator === wallet;
      const topicMatch = topics.length === 0 || topics.includes(event.type);
      if (topicMatch && walletMatch) {
        sendEvent(event);
      }
    }
  }

  // Subscribe to live events.
  const unsubscribe = store.subscribe(topics, wallet, (record) => {
    sendEvent(record);
  });

  // Heartbeat every 25 s.
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25_000);

  // Cleanup on client disconnect.
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Parses and validates the shared `type`/`limit`/`before` query params for the event endpoints. */
function parseQueryFilter(
  searchParams: URLSearchParams,
): { ok: true; filter: QueryFilter } | { ok: false; error: string } {
  const filter: QueryFilter = {};

  const type = searchParams.get('type');
  if (type !== null) {
    if (!isEventType(type)) {
      return { ok: false, error: `Unknown event type: ${type}` };
    }
    filter.type = type as EventType;
  }

  const limitParam = searchParams.get('limit');
  if (limitParam !== null) {
    const limit = Number(limitParam);
    if (!Number.isInteger(limit) || limit <= 0) {
      return { ok: false, error: 'limit must be a positive integer' };
    }
    filter.limit = limit;
  }

  const beforeParam = searchParams.get('before');
  if (beforeParam !== null) {
    const before = Number(beforeParam);
    if (!Number.isInteger(before) || before < 0) {
      return {
        ok: false,
        error: 'before must be a non-negative integer ledger sequence',
      };
    }
    filter.before = before;
  }

  const afterParam = searchParams.get('after');
  if (afterParam !== null) {
    const after = Number(afterParam);
    if (!Number.isInteger(after) || after < 0) {
      return {
        ok: false,
        error: 'after must be a non-negative integer ledger sequence',
      };
    }
    filter.after = after;
  }

  return { ok: true, filter };
}

async function handleEventsQuery(
  url: URL,
  res: http.ServerResponse,
  playerId?: string,
): Promise<void> {
  const parsed = parseQueryFilter(url.searchParams);
  if (!parsed.ok) {
    return sendJson(res, 400, { error: parsed.error });
  }

  const store = getStore();
  const result = playerId
    ? await store.getEventsByPlayer(playerId, parsed.filter)
    : await store.getEvents(parsed.filter);

  sendJson(res, 200, result);
}

async function handleValidatorEventsQuery(
  url: URL,
  res: http.ServerResponse,
  validatorAddress: string,
): Promise<void> {
  const parsed = parseQueryFilter(url.searchParams);
  if (!parsed.ok) {
    return sendJson(res, 400, { error: parsed.error });
  }

  const result = await getStore().getEvents({
    ...parsed.filter,
    validator: validatorAddress,
  });

  sendJson(res, 200, result);
}

/**
 * Parses and validates query params for GET /players (issue #1298):
 * `region`, `position`, `minLevel` (0–3), `cursor` (opaque keyset token from
 * a previous page), `createdAfter` (unix seconds), `limit` (positive
 * integer; values above 50 are capped by the store per the endpoint's
 * `limit ≤ 50` contract).
 */
function parsePlayersQuery(searchParams: URLSearchParams):
  | {
      ok: true;
      filter: PlayerQueryFilter;
    }
  | { ok: false; error: string } {
  const filter: PlayerQueryFilter = {};

  const region = searchParams.get('region');
  if (region !== null) {
    if (region.length > MAX_FILTER_VALUE_LENGTH) {
      return { ok: false, error: 'region is too long' };
    }
    if (region !== '') filter.region = region;
  }

  const position = searchParams.get('position');
  if (position !== null) {
    if (position.length > MAX_FILTER_VALUE_LENGTH) {
      return { ok: false, error: 'position is too long' };
    }
    if (position !== '') filter.position = position;
  }

  const minLevelParam = searchParams.get('minLevel');
  if (minLevelParam !== null) {
    const minLevel = Number(minLevelParam);
    if (!Number.isInteger(minLevel) || minLevel < 0 || minLevel > 3) {
      return {
        ok: false,
        error: 'minLevel must be an integer between 0 and 3',
      };
    }
    filter.minLevel = minLevel;
  }

  const limitParam = searchParams.get('limit');
  if (limitParam !== null) {
    const limit = Number(limitParam);
    if (!Number.isInteger(limit) || limit <= 0) {
      return { ok: false, error: 'limit must be a positive integer' };
    }
    filter.limit = limit;
  }

  const cursor = searchParams.get('cursor');
  if (cursor !== null) {
    if (decodePlayerCursor(cursor) === null) {
      return { ok: false, error: 'cursor is not a valid pagination cursor' };
    }
    filter.cursor = cursor;
  }

  const createdAfterParam = searchParams.get('createdAfter');
  if (createdAfterParam !== null) {
    const createdAfter = Number(createdAfterParam);
    if (!Number.isInteger(createdAfter) || createdAfter < 0) {
      return {
        ok: false,
        error: 'createdAfter must be a non-negative integer timestamp',
      };
    }
    filter.createdAfter = createdAfter;
  }

  return { ok: true, filter };
}

/**
 * Maps a materialized row to the frontend's `Player` shape (vitals nested
 * under one key, `milestones` always an empty array — the scout grid loads
 * milestones in batch via useMilestonesBatch, never from discovery).
 */
function toApiPlayer(record: PlayerRecord) {
  return {
    id: record.id,
    wallet: record.wallet,
    vitals: {
      name: record.name,
      age: record.age,
      position: record.position,
      region: record.region,
      nationality: record.nationality,
    },
    ipfsHash: record.ipfsHash,
    progressLevel: record.progressLevel,
    milestones: [],
    createdAt: record.createdAt,
  };
}

/** GET /players — paginated, filterable scout-discovery query. */
function handlePlayersQuery(url: URL, res: http.ServerResponse): void {
  const parsed = parsePlayersQuery(url.searchParams);
  if (!parsed.ok) {
    return sendJson(res, 400, { error: parsed.error });
  }

  try {
    const result = EventStore.getInstance().getPlayers(parsed.filter);
    sendJson(res, 200, {
      players: result.players.map(toApiPlayer),
      nextCursor: result.nextCursor,
      total: result.total,
    });
  } catch (err) {
    // getPlayers throws only for a malformed cursor (re-validated here as
    // defense in depth — the parse above already rejected obvious garbage).
    sendJson(res, 400, {
      error: err instanceof Error ? err.message : 'Invalid query',
    });
  }
}

const MAX_BODY_BYTES = 64 * 1024; // generous for a few hundred wallet+since pairs

/** Reads and JSON-parses a request body, capped at MAX_BODY_BYTES to bound memory use. */
function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(
          chunks.length
            ? JSON.parse(
                Buffer.concat(chunks as unknown as Uint8Array[]).toString(
                  'utf8',
                ),
              )
            : {},
        );
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * POST /validators/approval-counts — the academy-scoped rollup's building
 * block (issue #1172). Body: `{ start, end, wallets: [{ wallet, since }] }`.
 * Returns `{ range: { start, end }, counts: { [wallet]: number } }`.
 *
 * Grouping by academy itself doesn't happen here: the indexer has no
 * knowledge of academy_members (that lives in the separate server/ service's
 * own SQLite DB), so callers (app/api/admin/academies/rollup) pass the
 * member-wallet list they already resolved from server/ and sum the
 * per-wallet counts this returns into per-academy totals themselves.
 */
async function handleApprovalCountsQuery(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, {
      error: err instanceof Error ? err.message : 'Invalid request body',
    });
  }

  const { start, end, wallets } = (body ?? {}) as Record<string, unknown>;

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return sendJson(res, 400, {
      error: 'start and end must be numeric unix-ms timestamps',
    });
  }
  if ((start as number) > (end as number)) {
    return sendJson(res, 400, { error: 'start must be <= end' });
  }
  if (!Array.isArray(wallets)) {
    return sendJson(res, 400, { error: 'wallets must be an array' });
  }

  const parsedWallets: WalletApprovalWindow[] = [];
  for (const entry of wallets) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof (entry as Record<string, unknown>).wallet !== 'string' ||
      !Number.isFinite((entry as Record<string, unknown>).since)
    ) {
      return sendJson(res, 400, {
        error: 'each wallet entry must be { wallet: string, since: number }',
      });
    }
    parsedWallets.push({
      wallet: (entry as Record<string, unknown>).wallet as string,
      since: (entry as Record<string, unknown>).since as number,
    });
  }

  try {
    const counts = await getStore().getApprovalCountsForWallets(
      { start: start as number, end: end as number },
      parsedWallets,
    );
    return sendJson(res, 200, {
      range: { start, end },
      counts,
    });
  } catch (err) {
    return sendJson(res, 400, {
      error: err instanceof Error ? err.message : 'Query failed',
    });
  }
}

/** Decodes a percent-encoded path segment, returning null if it is malformed. */
function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch (err) {
    if (err instanceof URIError) return null;
    throw err;
  }
}

function handleUnexpectedError(res: http.ServerResponse, err: unknown): void {
  logger.error('Unhandled indexer request error', { err });
  if (!res.headersSent) {
    sendJson(res, 500, { error: 'internal server error' });
  } else {
    res.end();
  }
}

function route(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void | Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') {
    return handleHealth(res);
  }
  if (req.method === 'GET' && url.pathname === '/metrics') {
    return handleMetrics(res);
  }
  if (req.method === 'GET' && url.pathname === '/events') {
    return handleEventsQuery(url, res);
  }
  if (req.method === 'GET' && url.pathname === '/stream') {
    return handleStream(req, res, url);
  }
  // Exact match — must precede the /players/:id/events regex below (which
  // wouldn't match it anyway, but the ordering documents the intent).
  if (req.method === 'GET' && url.pathname === '/players') {
    return handlePlayersQuery(url, res);
  }
  if (req.method === 'POST' && url.pathname === '/validators/approval-counts') {
    handleApprovalCountsQuery(req, res).catch((err) =>
      handleUnexpectedError(res, err),
    );
    return;
  }
  const playerMatch = url.pathname.match(PLAYER_EVENTS_PATH);
  if (req.method === 'GET' && playerMatch) {
    const playerId = safeDecode(playerMatch[1]);
    if (playerId === null) {
      return sendJson(res, 400, { error: 'invalid path encoding' });
    }
    return handleEventsQuery(url, res, playerId);
  }
  const validatorMatch = url.pathname.match(VALIDATOR_EVENTS_PATH);
  if (req.method === 'GET' && validatorMatch) {
    const validatorId = safeDecode(validatorMatch[1]);
    if (validatorId === null) {
      return sendJson(res, 400, { error: 'invalid path encoding' });
    }
    return handleValidatorEventsQuery(url, res, validatorId);
  }

  res.writeHead(404);
  res.end('Not Found');
}

export const server = http.createServer(
  (req: http.IncomingMessage, res: http.ServerResponse) => {
    Promise.resolve()
      .then(() => route(req, res))
      .catch((err) => handleUnexpectedError(res, err));
  },
);

/**
 * Graceful shutdown (issue #1333): stop accepting connections, let the
 * in-flight poll batch finish (bounded by SHUTDOWN_TIMEOUT_MS), then flush
 * and close the event store.
 */
export async function shutdown(signal: string): Promise<void> {
  logger.info(`Indexer shutting down (${signal})`);
  server.close();
  if (poller) {
    await Promise.race([
      poller.stop(),
      new Promise<void>((resolve) =>
        setTimeout(resolve, SHUTDOWN_TIMEOUT_MS).unref(),
      ),
    ]);
  }
  EventStore.getInstance().close();
}

export async function startServer(): Promise<void> {
  // With INDEXER_DATABASE_URL every replica shares one Postgres store and
  // serves reads; only the advisory-lock holder polls (issue #1319).
  const store = await initStore();
  server.listen(PORT, () => {
    logger.info(`Indexer server listening on port ${PORT}`);
  });

  // The poller needs SOROBAN_RPC_URL/CONTRACT_ID; a config error here is a
  // deploy-time misconfiguration, not a reason to bring the whole process
  // (and /health, which is useful for diagnosing exactly this) down.
  try {
    const config = loadConfigFromEnv();
    const pool = createPgPoolFromEnv();
    const elector = pool
      ? new LeaderElector(pool, {
          lockKey: process.env.INDEXER_LEADER_LOCK_KEY
            ? parseInt(process.env.INDEXER_LEADER_LOCK_KEY, 10)
            : undefined,
          leaseMs: config.pollIntervalMs,
        })
      : null;
    setPollerState(
      startEventPolling(
        config,
        createRpcClient(config),
        IndexerMetrics.getInstance(),
        store,
        elector,
      ),
    );
  } catch (err) {
    logger.error('Failed to start event poller', { err });
    setPollerState(
      null,
      err instanceof Error ? err.message : 'Failed to start event poller',
    );
  }

  const onSignal = (signal: NodeJS.Signals) => {
    shutdown(signal)
      .catch((err) => logger.error('Error during shutdown', { err }))
      .finally(() => process.exit(0));
  };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
}
