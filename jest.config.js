const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // e2e/ holds Playwright specs (its own runner, see playwright.config.ts) —
  // Jest's default testMatch would otherwise pick up *.spec.ts under it too.
  // server/ is a separate Node.js service with its own package.json and its
  // own test runner (`node --test`, see server/package.json) — it isn't
  // part of the Next.js app and shouldn't be swept up by this config.
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/e2e/',
    '<rootDir>/server/',
    // setup-providers.tsx is a shared render helper, not a test file.
    // Without this pattern, jest's default testMatch would treat it as a
    // test suite with zero tests and emit a "your test suite must contain
    // at least one test" warning, breaking `npx jest --ci`.
    // Matches __tests__/setup-providers.tsx and any future non-test
    // helpers in the same dir (e.g. setup-providers-helpers.tsx).
    // Update this regex if you add another non-test helper at __tests__/.
    '<rootDir>/__tests__/setup-providers[^/]*\\.tsx',
    // Integration tests require a live Soroban node and a deployed contract.
    // They are run via jest.integration.config.js (`npm run test:integration`),
    // not as part of the default `npm test` unit suite.
    '<rootDir>/__tests__/integration/',
  ],
  // Issue #108: enforce minimum coverage thresholds
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  // Output coverage reports to the coverage/ directory
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'app/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
    'hooks/**/*.{ts,tsx}',
    'lib/**/*.{ts,tsx}',
    'context/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/*.stories.{ts,tsx}',
    '!**/node_modules/**',
  ],
};

// Wrap to override transformIgnorePatterns after next/jest applies its defaults
async function jestConfig() {
  const nextJestConfig = await createJestConfig(customJestConfig)();
  return {
    ...nextJestConfig,
    transformIgnorePatterns: [
      '/node_modules/(?!(next-intl|use-intl|@formatjs|intl-messageformat)/)',
      '^.+\\.module\\.(css|sass|scss)$',
    ],
    // Include .mjs so __tests__/scripts/a11y-audit.test.mjs is picked up
    // (issue #1124). Jest's default testMatch covers **/__tests__/**/*.[jt]s?(x)
    // which excludes .mjs; we extend it here without disturbing the existing set.
    testMatch: [
      '**/__tests__/**/*.[jt]s?(x)',
      '**/?(*.)+(spec|test).[jt]s?(x)',
      '**/__tests__/**/*.test.mjs',
      '**/?(*.)+(spec|test).mjs',
    ],
    moduleFileExtensions: [
      ...(nextJestConfig.moduleFileExtensions ?? [
        'js',
        'mjs',
        'cjs',
        'jsx',
        'ts',
        'tsx',
        'json',
        'node',
      ]),
      'mjs',
    ].filter((v, i, a) => a.indexOf(v) === i), // dedupe
  };
}

module.exports = jestConfig;
