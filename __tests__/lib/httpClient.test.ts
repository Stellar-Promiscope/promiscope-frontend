/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import { isTimeoutError, pinTimeoutMs, upstreamStatus } from '@/lib/httpClient';

const ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = ['app', 'lib', 'components', 'hooks', 'context'];

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [full] : [];
  });
}

describe('lib/httpClient', () => {
  it('is the only module that calls axios.create (guard for #1353)', () => {
    const offenders = SCAN_DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d)))
      .filter((f) => !f.endsWith(path.join('lib', 'httpClient.ts')))
      .filter((f) => fs.readFileSync(f, 'utf8').includes('axios.create('))
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('scales the Pinata timeout with size and caps it', () => {
    expect(pinTimeoutMs(0)).toBe(30_000);
    expect(pinTimeoutMs(5 * 1024 * 1024)).toBe(35_000);
    expect(pinTimeoutMs(1024 * 1024 * 1024)).toBe(55_000);
  });

  it('maps timeouts to 504 and passes other upstream statuses through', () => {
    expect(isTimeoutError({ code: 'ECONNABORTED' })).toBe(true);
    expect(isTimeoutError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(upstreamStatus({ code: 'ECONNABORTED' })).toBe(504);
    expect(upstreamStatus({ response: { status: 404 } })).toBe(404);
    expect(upstreamStatus(new Error('boom'))).toBe(502);
  });
});
