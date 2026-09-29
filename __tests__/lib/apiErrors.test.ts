/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import { apiError, ApiErrorCode, parseApiError } from '@/lib/apiErrors';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import sw from '@/messages/sw.json';

function listRouteFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listRouteFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('apiError', () => {
  it('returns the coded error shape with status and headers', async () => {
    const res = apiError(ApiErrorCode.QUERY_TOO_LONG, 400, 'too long', {
      max: 100,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: 'QUERY_TOO_LONG',
        params: { max: 100 },
        message: 'too long',
      },
    });
  });

  it('parseApiError reads coded bodies and ignores legacy string errors', () => {
    expect(
      parseApiError({ error: { code: 'RATE_LIMITED', message: 'x' } }),
    ).toEqual({ code: 'RATE_LIMITED', params: undefined });
    expect(parseApiError({ error: 'Forbidden' })).toBeNull();
    expect(parseApiError(null)).toBeNull();
  });
});

describe('apiErrors translations', () => {
  it.each([
    ['en', en],
    ['fr', fr],
    ['sw', sw],
  ])('%s has a message for every ApiErrorCode', (_locale, messages) => {
    const catalogue = (messages as { apiErrors: Record<string, string> })
      .apiErrors;
    for (const code of Object.values(ApiErrorCode)) {
      expect(catalogue[code]).toEqual(expect.any(String));
    }
  });
});

describe('app/api never returns raw exception messages', () => {
  it('no response body is built from a caught error .message', () => {
    const apiDir = path.join(__dirname, '..', '..', 'app', 'api');
    const offenders: string[] = [];
    for (const file of listRouteFiles(apiDir)) {
      const source = fs.readFileSync(file, 'utf8');
      // `error: err.message` / `error: e instanceof Error ? e.message : ...`
      // inside a response payload. Logging via `reason:` is fine.
      // Curated domain errors (e.g. `instanceof UploadVerificationError`)
      // are allowed; generic `instanceof Error` passthroughs are not.
      if (
        /\berror:\s*(?:\w+\s+instanceof\s+Error\s*\?\s*)?\w+\.message\b/.test(
          source,
        )
      ) {
        offenders.push(path.relative(apiDir, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
