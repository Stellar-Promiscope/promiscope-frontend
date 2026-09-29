/**
 * jest.integration.config.js
 *
 * Separate Jest project for contract integration tests.
 *
 * This config is intentionally isolated from jest.config.js (the default
 * unit-test runner) so that:
 *   - `npm test` never accidentally runs the integration suite (which
 *     requires a live Soroban node and a deployed contract).
 *   - The integration suite uses a Node environment and a much longer
 *     per-test timeout than unit tests need.
 *   - Coverage collection is NOT enabled here — the unit suite owns that gate.
 *
 * TypeScript transformation is handled by the same next/jest Babel pipeline
 * used in jest.config.js — no ts-jest or extra devDependencies are needed.
 *
 * Usage:
 *   npm run test:integration          # after deploy-test-contract.sh
 *   npx jest --config=jest.integration.config.js
 *
 * CI: .github/workflows/contract-integration.yml runs this via
 *     `npm run test:integration`.
 */

'use strict';

const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const integrationConfig = {
  // Use Node environment — integration tests perform real network I/O against
  // the Soroban RPC, not browser DOM APIs. jsdom adds overhead here.
  testEnvironment: 'node',

  // Only pick up *.int.test.ts files under __tests__/integration/.
  // The .int.test. filename convention makes it trivial to grep/exclude
  // these in other tooling and ensures the default Jest run never picks
  // them up (the exclude is also in jest.config.js's testPathIgnorePatterns).
  testMatch: ['<rootDir>/__tests__/integration/**/*.int.test.ts'],

  // Path aliases — mirror the unit suite's moduleNameMapper so imports
  // such as `@/types` resolve correctly inside the integration helpers.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },

  // Load .env.integration (written by scripts/deploy-test-contract.sh) before
  // any test module is evaluated, making CONTRACT_ID, INT_ADMIN_SECRET, etc.
  // available via process.env without each test calling dotenv itself.
  globalSetup: '<rootDir>/__tests__/integration/globalSetup.ts',

  // Give each test file a generous timeout — contract round-trips on a local
  // quickstart node take 2–5 s each and there are several suites per file.
  testTimeout: 120_000,

  // Don't collect coverage — the unit suite owns that gate.
  collectCoverage: false,

  // Human-readable name shown in the Jest output header
  displayName: {
    name: 'contract-integration',
    color: 'cyan',
  },

  verbose: true,
};

// Wrap with next/jest so we inherit its TypeScript + ESM transform chain
// (the same Babel pipeline used by jest.config.js), then override
// transformIgnorePatterns to also handle Stellar SDK's ESM exports.
async function jestConfig() {
  const nextJestConfig = await createJestConfig(integrationConfig)();
  return {
    ...nextJestConfig,
    // Allow Stellar SDK ESM to be transformed (same override as jest.config.js
    // does for next-intl etc.)
    transformIgnorePatterns: [
      '/node_modules/(?!(next-intl|use-intl|@formatjs|intl-messageformat|@stellar/stellar-sdk)/)',
      '^.+\\.module\\.(css|sass|scss)$',
    ],
  };
}

module.exports = jestConfig;
