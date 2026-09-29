/**
 * Gateway fetch + HTTP byte-range forwarding for the IPFS media proxy.
 *
 * Failover strategy: before committing a response to the client we read a
 * bounded prefix from the upstream body (read-ahead probe). If the gateway
 * stalls or the stream errors during that probe, we try the next gateway
 * without having sent any bytes to the client. Once the probe succeeds we
 * stream the buffered prefix followed by the remainder of the upstream body.
 * If the remainder fails mid-stream the composite stream errors cleanly so
 * the client player can retry — there is no silent truncation.
 */

import { withOutboundSpan } from '@/lib/telemetry';

export const READ_AHEAD_BYTES = 65536;
export const READ_AHEAD_TIMEOUT_MS = 10000;
/** Minimum bytes to read during probe when data is available (proves stream health). */
export const READ_AHEAD_MIN_BYTES = 1024;

export interface ParsedByteRange {
  start: number;
  end: number | null;
}

export function parseByteRangeHeader(
  rangeHeader: string | null,
): ParsedByteRange | null {
  if (!rangeHeader) return null;
  const trimmed = rangeHeader.trim();
  const match = /^bytes=(\d+)-(\d*)$/i.exec(trimmed);
  if (!match) return null;

  const start = Number.parseInt(match[1], 10);
  if (!Number.isFinite(start) || start < 0) return null;

  const endPart = match[2];
  if (endPart === '') {
    return { start, end: null };
  }

  const end = Number.parseInt(endPart, 10);
  if (!Number.isFinite(end) || end < start) return null;
  return { start, end };
}

export function formatByteRangeHeader(range: ParsedByteRange): string {
  if (range.end === null) {
    return `bytes=${range.start}-`;
  }
  return `bytes=${range.start}-${range.end}`;
}

type ReadAheadResult = {
  prefix: Uint8Array[];
  reader: ReadableStreamDefaultReader<Uint8Array>;
};

async function readAheadWithTimeout(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  timeoutMs: number,
): Promise<ReadAheadResult | 'error'> {
  const reader = body.getReader();
  const prefix: Uint8Array[] = [];
  let totalRead = 0;
  const deadline = Date.now() + timeoutMs;

  try {
    while (totalRead < maxBytes) {
      if (Date.now() > deadline) {
        await reader.cancel();
        return 'error';
      }

      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;

      prefix.push(value);
      totalRead += value.length;

      if (totalRead >= READ_AHEAD_MIN_BYTES) break;
    }

    return { prefix, reader };
  } catch {
    try {
      await reader.cancel();
    } catch {
      // ignore cancel errors
    }
    return 'error';
  }
}

function createCompositeStream(
  prefix: Uint8Array[],
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expectedLength?: number,
): ReadableStream<Uint8Array> {
  let prefixIdx = 0;
  let prefixOffset = 0;
  let bytesSent = 0;

  return new ReadableStream({
    async pull(controller) {
      while (prefixIdx < prefix.length) {
        const chunk = prefix[prefixIdx];
        const slice = chunk.subarray(prefixOffset);
        if (slice.length === 0) {
          prefixIdx += 1;
          prefixOffset = 0;
          continue;
        }
        controller.enqueue(slice);
        bytesSent += slice.length;
        prefixIdx += 1;
        prefixOffset = 0;
        return;
      }

      try {
        const { done, value } = await reader.read();
        if (done) {
          if (
            expectedLength !== undefined &&
            !Number.isNaN(expectedLength) &&
            bytesSent < expectedLength
          ) {
            controller.error(
              new Error('Upstream stream closed before Content-Length'),
            );
            return;
          }
          controller.close();
          return;
        }

        if (value) {
          controller.enqueue(value);
          bytesSent += value.length;
        }
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}

export interface GatewayMediaResult {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  status: number;
  contentRange?: string;
  contentLength?: string;
  acceptRanges: string;
}

export async function fetchMediaFromGateways(options: {
  cid: string;
  gateways: string[];
  rangeHeader: string | null;
}): Promise<GatewayMediaResult | null> {
  const { cid, gateways, rangeHeader } = options;
  let lastError: unknown = null;

  for (const gateway of gateways) {
    try {
      const headers: HeadersInit = {};
      if (rangeHeader) {
        headers.Range = rangeHeader;
      }

      const upstream = await withOutboundSpan(
        'ipfs.gateway.fetch',
        {
          dependency: 'ipfs-gateway',
          gateway_index: gateways.indexOf(gateway),
        },
        () => fetch(`${gateway}/${encodeURIComponent(cid)}`, { headers }),
      );
      if (!upstream.ok || !upstream.body) {
        lastError = new Error(`Gateway ${gateway} returned ${upstream.status}`);
        continue;
      }

      const contentType =
        upstream.headers.get('content-type') ?? 'application/octet-stream';

      const readAhead = await withOutboundSpan(
        'ipfs.gateway.read-ahead',
        {
          dependency: 'ipfs-gateway',
          operation: 'read-ahead',
        },
        async (span) => {
          const startedAt = performance.now();
          const result = await readAheadWithTimeout(
            upstream.body!,
            READ_AHEAD_BYTES,
            READ_AHEAD_TIMEOUT_MS,
          );
          span.setAttribute(
            'http.ttfb_ms',
            Math.round(performance.now() - startedAt),
          );
          return result;
        },
      );

      if (readAhead === 'error') {
        lastError = new Error(
          `Gateway ${gateway} stalled or failed during read-ahead`,
        );
        continue;
      }

      const { prefix, reader } = readAhead;
      const contentRange = upstream.headers.get('content-range');
      const contentLength = upstream.headers.get('content-length');
      const acceptRanges = upstream.headers.get('accept-ranges') ?? 'bytes';

      let expectedLength: number | undefined;
      if (contentLength) {
        const parsed = Number.parseInt(contentLength, 10);
        if (Number.isFinite(parsed)) {
          expectedLength = parsed;
        }
      }

      const body = createCompositeStream(prefix, reader, expectedLength);

      return {
        body,
        contentType,
        status: upstream.status,
        contentRange: contentRange ?? undefined,
        contentLength: contentLength ?? undefined,
        acceptRanges,
      };
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) {
    throw lastError;
  }
  return null;
}
