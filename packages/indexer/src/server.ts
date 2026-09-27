import * as http from 'http';
import { IndexerMetrics } from './metrics/IndexerMetrics';
import { getLastLedgerInfo, getLedgerLag } from './ledgerTracker';
import { startEventPolling, isEventType } from './eventPoller';
import {
  EventStore,
  type QueryFilter,
  type WalletApprovalWindow,
} from './db/eventStore';
import type { EventType } from './metrics/IndexerMetrics';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

const startTime = Date.now();

function handleHealth(res: http.ServerResponse): void {
  const { lastLedger, timestamp } = getLastLedgerInfo();
  const now = Date.now();
  const stale = timestamp > 0 && now - timestamp > 60_000;
  const uptimeSec = Math.floor((now - startTime) / 1000);
  const body = JSON.stringify({
    status: stale ? 'degraded' : 'ok',
    lastLedger,
    uptime: uptimeSec,
  });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(body);
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
  ];

  res.writeHead(200, {
    'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
  });
  res.end(lines.join('\n') + '\n');
}

const PLAYER_EVENTS_PATH = /^\/players\/([^/]+)\/events$/;
const VALIDATOR_EVENTS_PATH = /^\/validators\/([^/]+)\/events$/;

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
  function sendEvent(record: {
    id: number;
    type: string;
    [k: string]: unknown;
  }): void {
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

  return { ok: true, filter };
}

function handleEventsQuery(
  url: URL,
  res: http.ServerResponse,
  playerId?: string,
): void {
  const parsed = parseQueryFilter(url.searchParams);
  if (!parsed.ok) {
    return sendJson(res, 400, { error: parsed.error });
  }

  const store = EventStore.getInstance();
  const result = playerId
    ? store.getEventsByPlayer(playerId, parsed.filter)
    : store.getEvents(parsed.filter);

  sendJson(res, 200, result);
}

function handleValidatorEventsQuery(
  url: URL,
  res: http.ServerResponse,
  validatorAddress: string,
): void {
  const parsed = parseQueryFilter(url.searchParams);
  if (!parsed.ok) {
    return sendJson(res, 400, { error: parsed.error });
  }

  const store = EventStore.getInstance();
  const result = store.getEvents({
    ...parsed.filter,
    validator: validatorAddress,
  });

  sendJson(res, 200, result);
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

  const store = EventStore.getInstance();
  try {
    const counts = store.getApprovalCountsForWallets(
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

export const server = http.createServer(
  (req: http.IncomingMessage, res: http.ServerResponse) => {
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
    if (
      req.method === 'POST' &&
      url.pathname === '/validators/approval-counts'
    ) {
      return handleApprovalCountsQuery(req, res);
    }
    const playerMatch = url.pathname.match(PLAYER_EVENTS_PATH);
    if (req.method === 'GET' && playerMatch) {
      return handleEventsQuery(url, res, decodeURIComponent(playerMatch[1]));
    }
    const validatorMatch = url.pathname.match(VALIDATOR_EVENTS_PATH);
    if (req.method === 'GET' && validatorMatch) {
      return handleValidatorEventsQuery(
        url,
        res,
        decodeURIComponent(validatorMatch[1]),
      );
    }

    res.writeHead(404);
    res.end('Not Found');
  },
);

export function startServer(): void {
  server.listen(PORT, () => {
    console.log(`Indexer server listening on port ${PORT}`);
  });

  // The poller needs SOROBAN_RPC_URL/CONTRACT_ID; a config error here is a
  // deploy-time misconfiguration, not a reason to bring the whole process
  // (and /health, which is useful for diagnosing exactly this) down.
  try {
    startEventPolling();
  } catch (err) {
    console.error('Failed to start event poller:', err);
  }
}
