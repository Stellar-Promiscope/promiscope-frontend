/**
 * lib/eventStream.ts — shared client-side SSE subscription manager.
 *
 * Architecture:
 *   - One `EventSource` per browser (across tabs) is ensured via the Web
 *     Locks API. The tab that holds the lock is the "leader" and owns the
 *     actual EventSource connection.
 *   - Follower tabs receive events over a BroadcastChannel.
 *   - Every hook calls `onEvent(type, handler)` to register interest.
 *     When an event arrives the handler calls `mutate(key)` on the SWR
 *     cache instead of polling.
 *   - The fallback poll interval for hooks grows to 5 minutes while the
 *     stream is healthy, and resets to its original interval on stream
 *     failure.
 *
 * Scaling note: a single indexer instance is assumed. Horizontal scaling
 * would need Redis pub/sub on the indexer side to fan out across instances.
 *
 * Usage:
 *   const unsubscribe = onEvent('milestone_approved', (evt) => mutate(key));
 *   // call unsubscribe() in useEffect cleanup
 */

const CHANNEL_NAME = 'promiscope:indexer-events';
const LOCK_NAME = 'promiscope:sse-leader';
const STREAM_URL = '/api/indexer/stream';
const HEARTBEAT_TIMEOUT_MS = 60_000; // leader re-connects if no message for 60 s

export type StreamEvent = {
  id: number;
  type: string;
  [key: string]: unknown;
};

type EventHandler = (event: StreamEvent) => void;
type TopicHandlers = Map<string, Set<EventHandler>>;

/** True while the leader's EventSource is open and healthy. */
let isStreamHealthy = false;

const handlers: TopicHandlers = new Map();

/** Dispatch a received event to all registered handlers for its type. */
function dispatch(event: StreamEvent): void {
  const set = handlers.get(event.type);
  if (set) {
    for (const h of set) {
      try {
        h(event);
      } catch (e) {
        console.error('[eventStream] handler error', e);
      }
    }
  }
  // Wildcard handlers registered under '*'
  const wildcard = handlers.get('*');
  if (wildcard) {
    for (const h of wildcard) {
      try {
        h(event);
      } catch (e) {
        console.error('[eventStream] wildcard handler error', e);
      }
    }
  }
}

/**
 * Register a handler for a specific event type (or `'*'` for all).
 * Returns an unsubscribe function — call it in useEffect cleanup.
 */
export function onEvent(type: string, handler: EventHandler): () => void {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type)!.add(handler);
  return () => {
    handlers.get(type)?.delete(handler);
    if (handlers.get(type)?.size === 0) handlers.delete(type);
  };
}

/** Current stream health — hooks use this to decide their fallback interval. */
export function isHealthy(): boolean {
  return isStreamHealthy;
}

// --- Leader logic ---

function buildStreamUrl(topics: string[], wallet?: string): string {
  const params = new URLSearchParams();
  if (topics.length > 0) params.set('topics', topics.join(','));
  if (wallet) params.set('wallet', wallet);
  return `${STREAM_URL}?${params.toString()}`;
}

let lastEventId: number | null = null;

function connectLeader(wallet?: string): void {
  const url = buildStreamUrl([], wallet);
  let source: EventSource;
  let heartbeatTimer: ReturnType<typeof setTimeout>;

  function scheduleReconnect(delayMs: number): void {
    isStreamHealthy = false;
    broadcastHealthStatus(false);
    setTimeout(() => connectLeader(wallet), delayMs);
  }

  function resetHeartbeatTimer(): void {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = setTimeout(() => {
      console.warn('[eventStream] heartbeat timeout — reconnecting');
      source.close();
      scheduleReconnect(1_000);
    }, HEARTBEAT_TIMEOUT_MS);
  }

  const headers: Record<string, string> = {};
  if (lastEventId !== null) {
    headers['Last-Event-ID'] = String(lastEventId);
  }

  // EventSource doesn't support custom headers natively; we use the URL
  // for Last-Event-ID fallback via query param as a polyfill for proxies
  // that strip the header, but prefer the standard header via a thin fetch
  // polyfill if available.
  source = new EventSource(
    lastEventId !== null ? `${url}&lastEventId=${lastEventId}` : url,
  );

  source.onopen = () => {
    isStreamHealthy = true;
    broadcastHealthStatus(true);
    resetHeartbeatTimer();
  };

  source.onmessage = (e: MessageEvent) => {
    resetHeartbeatTimer();
    try {
      const data = JSON.parse(e.data) as StreamEvent;
      if (typeof data.id === 'number') lastEventId = data.id;
      dispatch(data);
      broadcastEvent(data);
    } catch {
      // malformed event — ignore
    }
  };

  // Named event types (the indexer sends `event: <type>` frames)
  const eventTypes = [
    'player_registered',
    'milestone_approved',
    'milestone_revoked',
    'scout_subscribed',
    'player_contacted',
    'trial_offer_logged',
    'fees_withdrawn',
  ] as const;

  for (const type of eventTypes) {
    source.addEventListener(type, (e: Event) => {
      const msgEvent = e as MessageEvent;
      resetHeartbeatTimer();
      try {
        const data = JSON.parse(msgEvent.data) as StreamEvent;
        if (typeof data.id === 'number') lastEventId = data.id;
        dispatch(data);
        broadcastEvent(data);
      } catch {
        // malformed event — ignore
      }
    });
  }

  source.onerror = () => {
    clearTimeout(heartbeatTimer);
    source.close();
    scheduleReconnect(3_000);
  };
}

// --- BroadcastChannel (follower receives from leader) ---

let channel: BroadcastChannel | null = null;

type ChannelMessage =
  | { type: 'event'; payload: StreamEvent }
  | { type: 'health'; healthy: boolean };

function broadcastEvent(event: StreamEvent): void {
  channel?.postMessage({
    type: 'event',
    payload: event,
  } satisfies ChannelMessage);
}

function broadcastHealthStatus(healthy: boolean): void {
  channel?.postMessage({ type: 'health', healthy } satisfies ChannelMessage);
}

function setupFollower(): void {
  channel?.addEventListener('message', (e: MessageEvent<ChannelMessage>) => {
    const msg = e.data;
    if (msg.type === 'event') {
      dispatch(msg.payload);
    } else if (msg.type === 'health') {
      isStreamHealthy = msg.healthy;
    }
  });
}

// --- Initialization ---

let initialized = false;

/**
 * Call once at app startup (e.g. in a top-level useEffect in a provider).
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * @param wallet  optional wallet address to filter events server-side.
 */
export function initEventStream(wallet?: string): void {
  if (initialized) return;
  initialized = true;

  if (typeof window === 'undefined') return; // SSR guard

  channel = new BroadcastChannel(CHANNEL_NAME);
  setupFollower();

  // Try to acquire the leader lock. The callback runs only for the tab that
  // wins. Other tabs stay in follower mode (setupFollower handles them).
  if ('locks' in navigator) {
    navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, async () => {
      connectLeader(wallet);
      // Hold the lock indefinitely (returning never releases it).
      return new Promise<void>(() => {});
    });
  } else {
    // Fallback for browsers without Web Locks (very rare): every tab connects.
    connectLeader(wallet);
  }
}

/** Reset state — for tests only. */
export function _resetEventStream(): void {
  initialized = false;
  isStreamHealthy = false;
  lastEventId = null;
  handlers.clear();
  channel?.close();
  channel = null;
}
