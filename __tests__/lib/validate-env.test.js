const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const scriptPath = path.join(__dirname, '../../scripts/validate-env.js');
const examplePath = path.join(__dirname, '../../.env.example');

describe('validate-env.js', () => {
  let originalExampleContent;

  beforeEach(() => {
    originalExampleContent = fs.readFileSync(examplePath, 'utf8');
  });

  afterEach(() => {
    fs.writeFileSync(examplePath, originalExampleContent);
  });

  it('exits with code 0 when all used env vars are declared in .env.example', () => {
    const result = spawnSync('node', [scriptPath], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('All');
    expect(result.stdout).toContain('match source and .env.example');
  });

  it('exits with code 1 and prints missing variables when some used vars are not declared', () => {
    // First, temporarily add a test used env var to a file
    const testFilePath = path.join(__dirname, '../../temp-test-file.ts');
    fs.writeFileSync(testFilePath, 'process.env.TEST_MISSING_VAR=value;');

    try {
      const result = spawnSync('node', [scriptPath], {
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Missing from lib/envManifest.json');
      expect(result.stderr).toContain('TEST_MISSING_VAR');
    } finally {
      fs.unlinkSync(testFilePath);
    }
  });
});
