/**
 * __tests__/integration/globalSetup.ts
 *
 * Jest globalSetup module — runs once before any test file is loaded.
 *
 * Loads .env.integration (written by scripts/deploy-test-contract.sh) so
 * every test file sees NEXT_PUBLIC_CONTRACT_ID, INT_ADMIN_SECRET, etc.
 * in process.env without having to call dotenv themselves.
 *
 * If the file is missing the tests will still run, but the `requireEnv`
 * helper in helpers.ts will throw an informative error for each test that
 * needs one of those vars.
 */

import * as fs from 'fs';
import * as path from 'path';

export default async function globalSetup(): Promise<void> {
  const envFile = path.resolve(process.cwd(), '.env.integration');

  if (!fs.existsSync(envFile)) {
    console.warn(
      '\n⚠️  .env.integration not found. ' +
        'Run scripts/deploy-test-contract.sh before the integration suite.\n',
    );
    return;
  }

  // Parse the file manually (avoid requiring a dotenv dep for this one use).
  const lines = fs.readFileSync(envFile, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments and blank lines
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }

  console.log(
    `[integration] Loaded .env.integration — CONTRACT_ID=${process.env.NEXT_PUBLIC_CONTRACT_ID ?? '(not set)'}`,
  );
}
