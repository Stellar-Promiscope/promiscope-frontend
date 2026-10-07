'use client';

import { useEffect, useRef, useState } from 'react';
import {
  decodeHorizonOperation,
  type EventType,
} from '@promiscope/contract-events';

export type { EventType } from '@promiscope/contract-events';

export interface FeedEvent {
  id: string;
  type: EventType;
  version: number;
  createdAt: string | number;
  payload?: Record<string, unknown>;
}

const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID ?? '';
const POLL_INTERVAL = 30_000;

// Reconnect tuning for the SSE path: exponential backoff between attempts,
// capped at MAX_RECONNECT_DELAY_MS, giving up on SSE (and falling back to
// polling) after MAX_RECONNECT_ATTEMPTS consecutive failures.
export const MAX_RECONNECT_ATTEMPTS = 5;
export const BASE_RECONNECT_DELAY_MS = 1_000;
export const MAX_RECONNECT_DELAY_MS = 30_000;

// Maximum number of forward pages to drain in a single poll cycle when a
// burst of more than `limit` new operations has landed between polls.
// Guards against an unbounded loop while still not dropping events.
export const MAX_PAGES_PER_POLL = 10;
const PAGE_LIMIT = 20;

/** Map a raw Horizon operation through the shared versioned event schema. */
function toFeedEvent(op: Record<string, unknown>): FeedEvent | null {
  const raw = op as {
    id?: string;
    type?: string;
    created_at?: string;
    transaction_hash?: string;
    [key: string]: unknown;
  };
  if (!raw.id) return null;

  if (raw.type !== 'invoke_host_function') return null;
  const decoded = decodeHorizonOperation({ operation: raw });

  return {
    id: String(raw.id),
    type: decoded.type,
    version: decoded.version,
    createdAt: raw.created_at ?? new Date().toISOString(),
    payload: { ...decoded.data, txHash: raw.transaction_hash },
  };
}

/**
 * Fetch a page of operations from Horizon.
 *
 * Cursor direction semantics (Horizon docs):
 *   order=asc  + cursor=X  →  paging_token > X  (records *newer* than X)
 *   order=desc + cursor=X  →  paging_token < X  (records *older* than X)
 *
 * For the initial bootstrap fetch we use order=desc with no cursor to get
 * the most-recent PAGE_LIMIT operations.  nextCursor is set to records[0]
 * (the newest record in a desc page), which becomes the starting point for
 * all subsequent forward-advancing polls.
 *
 * For all subsequent polls we use order=asc + cursor=<last seen paging_token>
 * so that Horizon returns only operations that arrived *after* the cursor —
 * i.e., genuinely new records.  nextCursor advances to records[last].paging_token
 * so each successive poll picks up from where the previous one left off.
 */
export async function fetchOperations(
  cursor?: string,
): Promise<{ events: FeedEvent[]; nextCursor: string }> {
  // When no cursor is provided this is the initial bootstrap fetch: use
  // order=desc so we get the PAGE_LIMIT most-recent operations straight away.
  // When a cursor IS provided we've already bootstrapped and want forward
  // progress, so we switch to order=asc (paging_token > cursor).
  const order = cursor ? 'asc' : 'desc';
  const params = new URLSearchParams({ order, limit: String(PAGE_LIMIT) });
  if (cursor) params.set('cursor', cursor);
  const url = `${HORIZON_URL}/accounts/${CONTRACT_ID}/operations?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Horizon ${resp.status}`);
  const json = await resp.json();
  const records: Record<string, unknown>[] = json?._embedded?.records ?? [];

  // Under order=desc the newest record is first; that token is the correct
  // forward-pagination anchor for the subsequent order=asc polls.
  // Under order=asc the newest record is last; advance to its token so the
  // next poll resumes from that point.
  let nextCursor: string;
  if (records.length > 0) {
    if (!cursor) {
      // Bootstrap (desc): newest record is at index 0.
      nextCursor = String(
        (records[0] as { paging_token?: unknown }).paging_token ?? '',
      );
    } else {
      // Forward-advance (asc): newest record is at the end.
      nextCursor = String(
        (records[records.length - 1] as { paging_token?: unknown })
          .paging_token ?? '',
      );
    }
  } else {
    nextCursor = cursor ?? '';
  }

  // Under order=desc the records arrive newest-first, which is the natural
  // display order for the feed.  Under order=asc they arrive oldest-first;
  // reverse so the caller always receives them in newest-first order.
  const ordered = cursor ? [...records].reverse() : records;
  const events = ordered.flatMap((r) => {
    const ev = toFeedEvent(r);
    return ev ? [ev] : [];
  });
  return { events, nextCursor };
}

export function useContractEvents(contractId?: string) {
  const contract = contractId ?? CONTRACT_ID;
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [isLive, setIsLive] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  // 'now' is a sentinel meaning "no cursor yet — next call is the bootstrap fetch".
  const cursorRef = useRef<string>('now');

  /** Prepend genuinely new events, newest first. */
  function mergeEvents(incoming: FeedEvent[]) {
    const novel = incoming.filter((e) => !seenRef.current.has(e.id));
    if (novel.length === 0) return;
    novel.forEach((e) => seenRef.current.add(e.id));
    setEvents((prev) => [...novel, ...prev].slice(0, 50));
  }

  useEffect(() => {
    if (!contract) return;

    let cancelled = false;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectAttempts = 0;

    // ── Polling fallback ────────────────────────────────────────────────────
    function startPolling() {
      if (pollTimer) return;
      setIsLive(false);

      async function poll() {
        try {
          // cursorRef.current === 'now' means this is the first poll call:
          // pass undefined so fetchOperations does the bootstrap desc fetch.
          // After that, cursorRef holds a real paging_token and fetchOperations
          // uses order=asc to discover strictly newer operations.
          const isBootstrap = cursorRef.current === 'now';
          const cursor = isBootstrap ? undefined : cursorRef.current;

          // Drain forward pages until we've caught up (handles bursts where
          // more than PAGE_LIMIT new operations arrived between polls).
          let pageCursor = cursor;
          for (let page = 0; page < MAX_PAGES_PER_POLL; page++) {
            const { events: incoming, nextCursor } =
              await fetchOperations(pageCursor);
            if (cancelled) return;

            // Always advance the cursor, even on an empty page.
            cursorRef.current = nextCursor;
            mergeEvents(incoming);

            // Stop paging if:
            //   (a) This is the bootstrap fetch — we only do one desc page to
            //       seed the feed; subsequent polls will advance forward from
            //       the cursor we just captured.
            //   (b) The page was not full — we've caught up to the chain tip.
            if (isBootstrap || incoming.length < PAGE_LIMIT) break;

            // Full page returned on a forward poll → more records may exist.
            pageCursor = nextCursor;
          }
        } catch {
          // network errors — silent
        }
      }

      poll();
      pollTimer = setInterval(poll, POLL_INTERVAL);
    }

    // ── SSE path, with bounded exponential-backoff reconnect ────────────────
    function connectSSE() {
      if (cancelled) return;

      const url = `${HORIZON_URL}/accounts/${contract}/operations?cursor=now`;
      es = new EventSource(url);

      es.addEventListener('message', (ev) => {
        try {
          const op = JSON.parse((ev as MessageEvent).data) as Record<
            string,
            unknown
          >;
          const feedEv = toFeedEvent(op);
          if (feedEv) mergeEvents([feedEv]);
        } catch {
          // malformed frame — ignore
        }
      });

      es.addEventListener('open', () => {
        reconnectAttempts = 0;
        setIsLive(true);
      });

      es.addEventListener('error', () => {
        setIsLive(false);
        es?.close();
        es = null;

        if (cancelled) return;

        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          // SSE has failed too many times in a row — stop retrying it and
          // fall back to the polling path instead of staying silently dead.
          startPolling();
          return;
        }

        const delay = Math.min(
          BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempts,
          MAX_RECONNECT_DELAY_MS,
        );
        reconnectAttempts += 1;
        reconnectTimer = setTimeout(connectSSE, delay);
      });
    }

    if (typeof EventSource !== 'undefined') {
      connectSSE();
    } else {
      startPolling();
    }

    return () => {
      cancelled = true;
      es?.close();
      es = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pollTimer) clearInterval(pollTimer);
      setIsLive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract]);

  return { events, isLive };
}
