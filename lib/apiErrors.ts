import { NextResponse } from 'next/server';

/**
 * Stable, machine-readable API error codes (issue #1323). Routes return
 * `{ error: { code, params?, message } }` via `apiError()`; the client maps
 * `code` to a translated string under the `apiErrors` namespace in
 * messages/*.json (see hooks/useApiErrorMessage.ts). `message` is English,
 * kept for logs and backward compatibility while routes are migrated.
 *
 * Never put a caught exception's `.message` in `message` — log it with the
 * request id instead.
 */
export const ApiErrorCode = {
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  QUERY_TOO_LONG: 'QUERY_TOO_LONG',
  UPSTREAM_FAILED: 'UPSTREAM_FAILED',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  UPLOAD_SESSION_NOT_FOUND: 'UPLOAD_SESSION_NOT_FOUND',
  CHUNK_INDEX_OUT_OF_RANGE: 'CHUNK_INDEX_OUT_OF_RANGE',
  UPLOAD_INCOMPLETE: 'UPLOAD_INCOMPLETE',
  DISPUTE_ALREADY_PENDING: 'DISPUTE_ALREADY_PENDING',
  MILESTONE_NOT_FOUND: 'MILESTONE_NOT_FOUND',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export type ApiErrorParams = Record<string, string | number>;

export interface ApiErrorBody {
  error: { code: ApiErrorCode; params?: ApiErrorParams; message: string };
}

export function apiError(
  code: ApiErrorCode,
  status: number,
  message: string,
  params?: ApiErrorParams,
  init?: ResponseInit,
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code, ...(params ? { params } : {}), message } },
    { ...init, status },
  );
}

/**
 * Extracts `{ code, params }` from a parsed error response body, or null for
 * a body that doesn't use the coded shape (e.g. a not-yet-migrated route's
 * `{ error: string }`).
 */
export function parseApiError(
  body: unknown,
): { code: string; params?: ApiErrorParams } | null {
  const error = (body as { error?: unknown } | null)?.error;
  if (error && typeof error === 'object' && 'code' in error) {
    const { code, params } = error as { code: unknown; params?: unknown };
    if (typeof code === 'string') {
      return { code, params: params as ApiErrorParams | undefined };
    }
  }
  return null;
}
