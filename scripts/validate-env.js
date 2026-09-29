#!/usr/bin/env node
// Checks that lib/envManifest.json (the single source of truth, issue #1327)
// covers every `process.env` variable read in source, and that .env.example (and
// server/.env.example) declare exactly the manifest's variables. Fails CI on
// drift.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manifest = require('../lib/envManifest.json');

const ENV_VAR_PATTERN = /process\.env\.([A-Z0-9_]+)/g;
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts)$/;
const TEST_FILE = /\.(test|spec|stories)\.[a-z]+$/;
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'coverage',
  '.git',
  'out',
  'public',
  '__tests__',
  'test',
  'storybook-static',
  'playwright-report',
]);

function walkDir(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, results);
    } else if (SOURCE_EXT.test(entry.name) && !TEST_FILE.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Map of env var name → source files (repo-relative) that read it. */
function findEnvUsages(dir = root) {
  const used = new Map();
  for (const file of walkDir(dir)) {
    const content = fs.readFileSync(file, 'utf8');
    for (const match of content.matchAll(ENV_VAR_PATTERN)) {
      const files = used.get(match[1]) ?? new Set();
      files.add(path.relative(dir, file));
      used.set(match[1], files);
    }
  }
  return used;
}

function declaredIn(envFile) {
  const content = fs.readFileSync(path.join(root, envFile), 'utf8');
  return new Set(content.match(/^[A-Z0-9_]+(?==)/gm) ?? []);
}

// Directory-scoped helpers (kept for programmatic use and unit tests).
const SYSTEM_VARS = new Set(['NODE_ENV']);

function parseEnvExample(exampleContent) {
  return new Set(exampleContent.match(/^[A-Z0-9_]+(?==)/gm) ?? []);
}

function extractUsedEnvVars(sourceDir) {
  const used = new Set();
  for (const name of findEnvUsages(sourceDir).keys()) {
    if (!SYSTEM_VARS.has(name)) used.add(name);
  }
  return used;
}

function validateEnvVars(sourceDir, envExamplePath) {
  const exampleContent = fs.readFileSync(envExamplePath, 'utf8');
  const declared = parseEnvExample(exampleContent);
  const used = extractUsedEnvVars(sourceDir);
  const missing = [...used].filter((v) => !declared.has(v));

  return { missing, used, declared };
}

function main() {
  const ignore = new Set(manifest.ignore);
  const byName = new Map(manifest.vars.map((v) => [v.name, v]));
  const errors = [];

  const used = findEnvUsages();
  const unlisted = [...used.keys()].filter(
    (v) => !byName.has(v) && !ignore.has(v),
  );
  if (unlisted.length) {
    errors.push(`Missing from lib/envManifest.json: ${unlisted.join(', ')}`);
  }

  const envFiles = new Set(['.env.example', 'server/.env.example']);
  for (const envFile of envFiles) {
    const declared = declaredIn(envFile);
    const expected = manifest.vars
      .filter((v) => (v.envFile ?? '.env.example') === envFile)
      .map((v) => v.name);
    const missing = expected.filter((v) => !declared.has(v));
    if (missing.length) {
      errors.push(`Missing from ${envFile}: ${missing.join(', ')}`);
    }
    const extra = [...declared].filter((v) => !byName.has(v) && !ignore.has(v));
    if (extra.length) {
      errors.push(
        `Declared in ${envFile} but not in lib/envManifest.json: ${extra.join(', ')}`,
      );
    }
  }

  if (errors.length) {
    errors.forEach((e) => console.error(e));
    process.exit(1);
  }
  console.log(
    `✓ All ${manifest.vars.length} manifest env vars match source and .env.example`,
  );

  // ── Production sanity warnings ─────────────────────────────────────────────
  // Don't process.exit — this is a deploy-time misconfig, not an env-shape
  // mismatch; ops should see it without a roll-back.
  if (process.env.NODE_ENV === 'production') {
    const missingInProd = manifest.vars.filter(
      (v) => v.requiredIn.includes('production') && !process.env[v.name],
    );
    for (const v of missingInProd) {
      console.error(`\n⚠ ${v.name} is unset in production. ${v.description}`);
    }
  }

  // Print empty declared variables in dev so contributors can spot them.
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.NODE_ENV !== 'test'
  ) {
    for (const v of manifest.vars) {
      if (!process.env[v.name] && v.name !== 'PORT') {
        console.log(`  dev hint: ${v.name} is currently empty`);
      }
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  findEnvUsages,
  validateEnvVars,
  parseEnvExample,
  extractUsedEnvVars,
  walkDir,
};
