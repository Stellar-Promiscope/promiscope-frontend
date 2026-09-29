import * as Sentry from '@sentry/nextjs';
import { createRequestLogger, getOrCreateRequestId } from '@/lib/logger';

export type TelemetryValue = string | number | boolean;

const STELLAR_ADDRESS_RE = /\bG[A-Z2-7]{55}\b/g;
const SENSITIVE_KEY_RE =
  /wallet|address|contact|email|phone|token|secret|cookie|authorization/i;

/** Redacts identifiers before they can become Sentry span attributes. */
export function redactTelemetryValue(
  key: string,
  value: TelemetryValue,
): TelemetryValue {
  if (SENSITIVE_KEY_RE.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    return value.replace(
      STELLAR_ADDRESS_RE,
      (address) => `${address.slice(0, 4)}...${address.slice(-4)}`,
    );
  }
  return value;
}

function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

function safeAttributes(
  attributes: Record<string, TelemetryValue>,
): Record<string, TelemetryValue> {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      redactTelemetryValue(key, value),
    ]),
  );
}

/** Wraps a Next route while preserving its response and error behavior. */
export function withRouteTelemetry<
  T extends (...args: never[]) => Response | Promise<Response>,
>(handler: T, name: string): T {
  const wrapped = ((request: Parameters<T>[0], context?: Parameters<T>[1]) => {
    const requestId = getOrCreateRequestId(request);
    const log = createRequestLogger(request);
    const startedAt = performance.now();

    return Sentry.startSpan(
      {
        op: 'http.server',
        name,
        attributes: safeAttributes({
          'http.request_id': requestId,
          'http.route': name,
        }),
      },
      async (span) => {
        try {
          const response = await handler(request, context);
          const durationMs = Math.round(performance.now() - startedAt);
          span.setAttribute('http.status_class', statusClass(response.status));
          span.setAttribute('http.duration_ms', durationMs);
          log.info('API route completed', {
            durationMs,
            status: response.status,
            statusClass: statusClass(response.status),
          });
          return response;
        } catch (error) {
          const durationMs = Math.round(performance.now() - startedAt);
          span.setAttribute('http.status_class', '5xx');
          span.setAttribute('http.duration_ms', durationMs);
          Sentry.captureException(error, {
            tags: { route: name, request_id: requestId },
          });
          log.error('API route failed', { durationMs });
          throw error;
        }
      },
    ) as ReturnType<T>;
  }) as T;

  return wrapped;
}

/** Creates a child span for Pinata, RPC, backend, indexer, or gateway work. */
export function withOutboundSpan<T>(
  name: string,
  attributes: Record<string, TelemetryValue>,
  operation: (span: Sentry.Span) => T | Promise<T>,
): T | Promise<T> {
  return Sentry.startSpan(
    {
      op: 'http.client',
      name,
      attributes: safeAttributes(attributes),
    },
    async (span) => {
      const startedAt = performance.now();
      try {
        const result = await operation(span);
        span.setAttribute(
          'http.duration_ms',
          Math.round(performance.now() - startedAt),
        );
        return result;
      } catch (error) {
        span.setAttribute('error', true);
        span.setAttribute(
          'http.duration_ms',
          Math.round(performance.now() - startedAt),
        );
        throw error;
      }
    },
  ) as T | Promise<T>;
}

export function telemetryFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  name: string,
  attributes: Record<string, TelemetryValue> = {},
): Promise<Response> {
  return withOutboundSpan(
    name,
    { ...attributes, 'http.method': init?.method ?? 'GET' },
    () => fetch(input, init),
  ) as Promise<Response>;
}
