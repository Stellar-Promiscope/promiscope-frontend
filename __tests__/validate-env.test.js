const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { validateEnvVars, parseEnvExample } = require('../scripts/validate-env.js');

describe('validate-env.js', () => {
  let tempDir;

  beforeEach(() => {
    // Create a temporary directory for test fixtures
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-env-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('parseEnvExample', () => {
    it('should extract variable names from .env.example content', () => {
      const exampleContent = `
NEXT_PUBLIC_API_URL=http://localhost:3000
DATABASE_URL=postgresql://localhost/mydb
SECRET_KEY=
ANOTHER_VAR=value
`;
      const vars = parseEnvExample(exampleContent);
      expect(vars).toContain('NEXT_PUBLIC_API_URL');
      expect(vars).toContain('DATABASE_URL');
      expect(vars).toContain('SECRET_KEY');
      expect(vars).toContain('ANOTHER_VAR');
    });

    it('should handle comments and empty lines in .env.example', () => {
      const exampleContent = `
# This is a comment
NEXT_PUBLIC_API_URL=http://localhost:3000

# Another comment
DATABASE_URL=postgresql://localhost/mydb
`;
      const vars = parseEnvExample(exampleContent);
      expect(vars.size).toBe(2);
      expect(vars).toContain('NEXT_PUBLIC_API_URL');
      expect(vars).toContain('DATABASE_URL');
    });
  });

  describe('validateEnvVars', () => {
    it('should detect missing env var used in source but not in .env.example', () => {
      // Create fixture source file with env var usage
      const sourceFile = path.join(tempDir, 'source.ts');
      fs.writeFileSync(sourceFile, `
const apiUrl = process.env.NEXT_PUBLIC_API_URL;
const secret = process.env.MISSING_SECRET_VAR;
`);

      // Create fixture .env.example with only one var declared
      const envExampleFile = path.join(tempDir, '.env.example');
      fs.writeFileSync(envExampleFile, `
NEXT_PUBLIC_API_URL=http://localhost:3000
`);

      const result = validateEnvVars(tempDir, envExampleFile);

      expect(result.missing).toContain('MISSING_SECRET_VAR');
      expect(result.missing.length).toBe(1);
      expect(result.used).toContain('NEXT_PUBLIC_API_URL');
      expect(result.used).toContain('MISSING_SECRET_VAR');
    });

    it('should return empty missing array when all env vars are declared', () => {
      // Create fixture source file
      const sourceFile = path.join(tempDir, 'source.ts');
      fs.writeFileSync(sourceFile, `
const apiUrl = process.env.NEXT_PUBLIC_API_URL;
const dbUrl = process.env.DATABASE_URL;
`);

      // Create fixture .env.example with all vars declared
      const envExampleFile = path.join(tempDir, '.env.example');
      fs.writeFileSync(envExampleFile, `
NEXT_PUBLIC_API_URL=http://localhost:3000
DATABASE_URL=postgresql://localhost/mydb
`);

      const result = validateEnvVars(tempDir, envExampleFile);

      expect(result.missing).toEqual([]);
      expect(result.used.size).toBe(2);
    });

    it('should ignore system variables like NODE_ENV', () => {
      // Create source file using NODE_ENV
      const sourceFile = path.join(tempDir, 'source.ts');
      fs.writeFileSync(sourceFile, `
if (process.env.NODE_ENV === 'production') {
  // do something
}
`);

      // Create .env.example without NODE_ENV
      const envExampleFile = path.join(tempDir, '.env.example');
      fs.writeFileSync(envExampleFile, '');

      const result = validateEnvVars(tempDir, envExampleFile);

      // NODE_ENV should not appear in missing or used
      expect(result.missing).not.toContain('NODE_ENV');
      expect(result.used.has('NODE_ENV')).toBe(false);
    });

    it('should scan multiple source files', () => {
      // Create multiple fixture source files
      const sourceFile1 = path.join(tempDir, 'file1.ts');
      fs.writeFileSync(sourceFile1, `
const var1 = process.env.API_URL;
`);

      const sourceFile2 = path.join(tempDir, 'file2.tsx');
      fs.writeFileSync(sourceFile2, `
const var2 = process.env.DATABASE_URL;
`);

      // Create .env.example
      const envExampleFile = path.join(tempDir, '.env.example');
      fs.writeFileSync(envExampleFile, `
API_URL=http://localhost
DATABASE_URL=postgresql://localhost
`);

      const result = validateEnvVars(tempDir, envExampleFile);

      expect(result.used).toContain('API_URL');
      expect(result.used).toContain('DATABASE_URL');
      expect(result.missing.length).toBe(0);
    });

    it('should not scan TypeScript files in node_modules', () => {
      // Create source file with env var
      const sourceFile = path.join(tempDir, 'source.ts');
      fs.writeFileSync(sourceFile, `
const apiUrl = process.env.DECLARED_VAR;
`);

      // Create node_modules directory with a file using undefined env var
      const nodeModulesDir = path.join(tempDir, 'node_modules');
      fs.mkdirSync(nodeModulesDir);
      const nodeModuleFile = path.join(nodeModulesDir, 'package.ts');
      fs.writeFileSync(nodeModuleFile, `
const secret = process.env.UNDECLARED_IN_NODEMODULES;
`);

      // Create .env.example
      const envExampleFile = path.join(tempDir, '.env.example');
      fs.writeFileSync(envExampleFile, `
DECLARED_VAR=value
`);

      const result = validateEnvVars(tempDir, envExampleFile);

      // Should not detect UNDECLARED_IN_NODEMODULES because it's in node_modules
      expect(result.missing).not.toContain('UNDECLARED_IN_NODEMODULES');
    });

    it('should handle duplicate env var usage across files', () => {
      // Create two files using the same env var
      const sourceFile1 = path.join(tempDir, 'file1.ts');
      fs.writeFileSync(sourceFile1, `
const apiUrl = process.env.API_URL;
`);

      const sourceFile2 = path.join(tempDir, 'file2.ts');
      fs.writeFileSync(sourceFile2, `
const apiUrl2 = process.env.API_URL;
`);

      // Create .env.example
      const envExampleFile = path.join(tempDir, '.env.example');
      fs.writeFileSync(envExampleFile, `
API_URL=http://localhost
`);

      const result = validateEnvVars(tempDir, envExampleFile);

      // API_URL should appear only once in used set
      expect(result.used.size).toBe(1);
      expect(result.used).toContain('API_URL');
      expect(result.missing.length).toBe(0);
    });
  });

  describe('CLI exit codes', () => {
    it('should exit with code 0 when all env vars are declared', () => {
      // Create source file
      const sourceFile = path.join(tempDir, 'source.ts');
      fs.writeFileSync(sourceFile, `
const apiUrl = process.env.API_URL;
`);

      // Create .env.example
      const envExampleFile = path.join(tempDir, '.env.example');
      fs.writeFileSync(envExampleFile, `
API_URL=http://localhost
`);

      // Create validate script that runs against our temp dir
      const testScript = path.join(tempDir, 'validate-test.js');
      fs.writeFileSync(testScript, `
const { validateEnvVars } = require('${path.join(__dirname, '../scripts/validate-env.js')}');
const result = validateEnvVars('${tempDir}', '${envExampleFile}');
if (result.missing.length) {
  console.error('Missing:', result.missing.join(', '));
  process.exit(1);
}
console.log('✓ All env vars declared');
process.exit(0);
`);

      const exitCode = execSync(`node ${testScript}`, { encoding: 'utf8' });
      // execSync returns the output, exit code 0 means success
      expect(exitCode).toContain('All env vars declared');
    });

    it('should exit with non-zero code when env vars are missing', () => {
      // Create source file with missing env var
      const sourceFile = path.join(tempDir, 'source.ts');
      fs.writeFileSync(sourceFile, `
const secret = process.env.MISSING_VAR;
`);

      // Create .env.example without the missing var
      const envExampleFile = path.join(tempDir, '.env.example');
      fs.writeFileSync(envExampleFile, '');

      // Create validate script
      const testScript = path.join(tempDir, 'validate-test.js');
      fs.writeFileSync(testScript, `
const { validateEnvVars } = require('${path.join(__dirname, '../scripts/validate-env.js')}');
const result = validateEnvVars('${tempDir}', '${envExampleFile}');
if (result.missing.length) {
  console.error('Missing:', result.missing.join(', '));
  process.exit(1);
}
console.log('✓ All env vars declared');
process.exit(0);
`);

      let exitCode;
      try {
        execSync(`node ${testScript}`, { encoding: 'utf8' });
        exitCode = 0;
      } catch (error) {
        exitCode = error.status;
      }

      expect(exitCode).toBe(1);
    });
  });

  describe('Integration with real script execution', () => {
    it('should report missing vars when invoked as a CLI script', () => {
      // Create fixture structure
      const sourceFile = path.join(tempDir, 'app.ts');
      fs.writeFileSync(sourceFile, `
const apiUrl = process.env.MISSING_API_URL;
`);

      const envExampleFile = path.join(tempDir, '.env.example');
      fs.writeFileSync(envExampleFile, `
SOME_OTHER_VAR=value
`);

      // Create a test runner script that mimics CLI usage
      const testScript = path.join(tempDir, 'run-validate.js');
      fs.writeFileSync(testScript, `
const path = require('path');
const { validateEnvVars } = require('${path.join(__dirname, '../scripts/validate-env.js')}');

const result = validateEnvVars('${tempDir}', '${envExampleFile}');
const missing = result.missing;

if (missing.length) {
  console.error('Missing from .env.example:', missing.join(', '));
  process.exit(1);
}
console.log('✓ All env vars declared');
process.exit(0);
`);

      let stderr = '';
      let exitCode = 0;

      try {
        execSync(`node ${testScript}`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch (error) {
        stderr = error.stderr || '';
        exitCode = error.status;
      }

      expect(exitCode).toBe(1);
      expect(stderr).toContain('MISSING_API_URL');
    });
  });
});
