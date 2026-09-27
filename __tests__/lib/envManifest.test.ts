/** @jest-environment node */
import path from 'path';
import { ENV_MANIFEST, ENV_IGNORE } from '@/lib/envManifest';
const { findEnvUsages } = require('../../scripts/validate-env.js');

const ROOT = path.join(__dirname, '..', '..');
const byName = new Map(ENV_MANIFEST.map((v) => [v.name, v]));

describe('lib/envManifest (issue #1327)', () => {
  it('lists every process.env.X read in source (drift check)', () => {
    const used: Map<string, Set<string>> = findEnvUsages(ROOT);
    const unlisted = [...used.keys()].filter(
      (v) => !byName.has(v) && !ENV_IGNORE.includes(v),
    );
    expect(unlisted).toEqual([]);
  });

  it('marks the production-critical secrets as required secrets', () => {
    for (const name of [
      'SESSION_SECRET',
      'CRON_SECRET',
      'UPSTASH_REDIS_REST_TOKEN',
      'MEDIA_URL_SIGNING_SECRET',
      'TURNSTILE_SECRET_KEY',
    ]) {
      expect(byName.get(name)).toMatchObject({
        requiredIn: ['production'],
        secret: true,
      });
    }
    expect(byName.get('UPSTASH_REDIS_REST_URL')?.requiredIn).toEqual([
      'production',
    ]);
  });

  it('does not mark an unused variable as required', () => {
    expect(byName.has('STELLAR_SECRET_KEY')).toBe(false);
    const used: Map<string, Set<string>> = findEnvUsages(ROOT);
    const unusedRequired = ENV_MANIFEST.filter(
      (v) => v.requiredIn.length > 0 && !used.has(v.name),
    ).map((v) => v.name);
    expect(unusedRequired).toEqual([]);
  });
});
