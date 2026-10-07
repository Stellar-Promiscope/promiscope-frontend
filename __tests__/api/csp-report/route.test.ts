/** @jest-environment node */
import { POST, GET } from '../../../app/api/csp-report/route';
import { NextRequest } from 'next/server';
import { _resetRateLimitStoreForTests } from '@/lib/rateLimit';
import {
  MAX_BODY_BYTES,
  _resetCspReportSamplingForTests,
} from '@/lib/cspReport';

let ipCounter = 0;

function makeRequest(
  body: unknown,
  contentType = 'application/csp-report',
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest('http://localhost:3000/api/csp-report', {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'user-agent': 'jest-test-agent',
      // Unique IP per request so tests don't share rate-limit budget.
      'x-forwarded-for': `10.0.0.${++ipCounter}`,
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/csp-report', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    _resetRateLimitStoreForTests();
    _resetCspReportSamplingForTests();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  function loggedLines() {
    return consoleLogSpy.mock.calls.map((c) => JSON.parse(c[0]));
  }

  it('accepts application/csp-report content and logs a normalized violation', async () => {
    const report = {
      'csp-report': {
        'document-uri': 'https://promiscope.example/player/1',
        'violated-directive': 'script-src',
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'https://evil.com/script.js',
        'source-file': 'https://promiscope.example/app.js',
        'line-number': 12,
        disposition: 'enforce',
        'script-sample': 'should not be logged',
      },
    };
    const res = await POST(makeRequest(report, 'application/csp-report'));

    expect(res.status).toBe(204);
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const [line] = loggedLines();
    expect(line).toMatchObject({
      level: 'info',
      message: 'CSP violation report received',
      userAgent: 'jest-test-agent',
      report: {
        documentUri: 'https://promiscope.example/player/1',
        violatedDirective: 'script-src',
        effectiveDirective: 'script-src-elem',
        blockedUri: 'https://evil.com/script.js',
        sourceFile: 'https://promiscope.example/app.js',
        lineNumber: 12,
        disposition: 'enforce',
      },
    });
    expect(JSON.stringify(line)).not.toContain('should not be logged');
    expect(typeof line.requestId).toBe('string');
  });

  it('accepts application/json content type as well', async () => {
    const report = { 'violated-directive': 'default-src' };
    const res = await POST(
      makeRequest(report, 'application/json; charset=utf-8'),
    );

    expect(res.status).toBe(204);
    expect(loggedLines()[0].report.violatedDirective).toBe('default-src');
  });

  it('accepts the Reporting API application/reports+json format', async () => {
    const reports = [
      {
        type: 'csp-violation',
        url: 'https://promiscope.example/',
        body: {
          documentURL: 'https://promiscope.example/',
          blockedURL: 'https://evil.com/a.js',
          effectiveDirective: 'script-src-elem',
          disposition: 'report',
          lineNumber: 3,
        },
      },
      { type: 'deprecation', body: { id: 'x' } },
    ];
    const res = await POST(makeRequest(reports, 'application/reports+json'));

    expect(res.status).toBe(204);
    const lines = loggedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].report).toEqual({
      documentUri: 'https://promiscope.example/',
      blockedUri: 'https://evil.com/a.js',
      effectiveDirective: 'script-src-elem',
      disposition: 'report',
      lineNumber: 3,
    });
  });

  it('strips query strings and fragments from URIs', async () => {
    const report = {
      'csp-report': {
        'document-uri': 'https://promiscope.example/p?token=secret#frag',
        'blocked-uri': 'https://cdn.example.com/v.mp4?sig=abc123&exp=1',
        'source-file': 'https://promiscope.example/app.js?v=1',
      },
    };
    await POST(makeRequest(report));

    const [line] = loggedLines();
    expect(line.report.documentUri).toBe('https://promiscope.example/p');
    expect(line.report.blockedUri).toBe('https://cdn.example.com/v.mp4');
    expect(line.report.sourceFile).toBe('https://promiscope.example/app.js');
    expect(JSON.stringify(line)).not.toMatch(/sig=|token=/);
  });

  it('truncates long string fields to 512 characters', async () => {
    const report = {
      'csp-report': { 'violated-directive': 'x'.repeat(2000) },
    };
    await POST(makeRequest(report));

    expect(loggedLines()[0].report.violatedDirective).toHaveLength(512);
  });

  it('logs identical repeated reports only once per window', async () => {
    const report = { 'csp-report': { 'blocked-uri': 'https://evil.com' } };
    await POST(makeRequest(report));
    await POST(makeRequest(report));

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
  });

  it('returns 413 when content-length exceeds the limit', async () => {
    const res = await POST(
      makeRequest({}, 'application/json', {
        'content-length': String(MAX_BODY_BYTES + 1),
      }),
    );

    expect(res.status).toBe(413);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('returns 413 when the streamed body exceeds the limit', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(MAX_BODY_BYTES) });
    const res = await POST(makeRequest(big, 'application/json'));

    expect(res.status).toBe(413);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('silently returns 204 without logging once the IP is rate-limited', async () => {
    const report = { 'csp-report': { 'blocked-uri': 'https://evil.com' } };
    const headers = { 'x-forwarded-for': '203.0.113.9' };
    for (let i = 0; i < 20; i++) {
      await POST(makeRequest(report, 'application/csp-report', headers));
    }
    _resetCspReportSamplingForTests();
    consoleLogSpy.mockClear();

    const res = await POST(
      makeRequest(report, 'application/csp-report', headers),
    );

    expect(res.status).toBe(204);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('returns 415 for an unsupported content type', async () => {
    const res = await POST(makeRequest({ foo: 'bar' }, 'text/plain'));

    expect(res.status).toBe(415);
    expect(await res.text()).toBe('Unsupported Media Type');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('returns 204 even when the JSON body is malformed', async () => {
    const res = await POST(
      makeRequest('not valid json{{{', 'application/json'),
    );

    expect(res.status).toBe(204);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
    expect(line.level).toBe('error');
    expect(line.message).toBe('Failed to process CSP report');
    expect(line.reason).toMatch(/not valid JSON|Unexpected token/);
  });
});

describe('GET /api/csp-report', () => {
  it('returns 405 Method Not Allowed', async () => {
    const res = await GET();

    expect(res.status).toBe(405);
    expect(await res.text()).toBe('Method Not Allowed');
  });
});
