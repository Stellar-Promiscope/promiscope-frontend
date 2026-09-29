/**
 * @jest-environment node
 */
import { logger } from '../logger';

describe('logger', () => {
  let originalWrite: typeof process.stdout.write;
  let capturedOutput: string[];

  beforeEach(() => {
    capturedOutput = [];
    originalWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Buffer) => {
      capturedOutput.push(chunk.toString());
      return true;
    };
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    delete process.env.LOG_LEVEL;
  });

  describe('output shape', () => {
    test('logs valid JSON with level, msg, and timestamp', () => {
      logger.info('test message');

      expect(capturedOutput).toHaveLength(1);
      const log = JSON.parse(capturedOutput[0]);
      expect(log).toHaveProperty('level', 'info');
      expect(log).toHaveProperty('msg', 'test message');
      expect(log).toHaveProperty('ts');
      expect(log.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test('includes optional fields in output', () => {
      logger.info('test message', { ledger: 100, eventCount: 5 });

      const log = JSON.parse(capturedOutput[0]);
      expect(log.ledger).toBe(100);
      expect(log.eventCount).toBe(5);
    });

    test('supports all log levels', () => {
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(capturedOutput).toHaveLength(4);
      capturedOutput.forEach((output) => {
        const log = JSON.parse(output);
        expect(log).toHaveProperty('level');
        expect(log).toHaveProperty('msg');
        expect(log).toHaveProperty('ts');
      });
    });
  });

  describe('level filtering', () => {
    test('default level is info', () => {
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(capturedOutput).toHaveLength(3);
      const levels = capturedOutput.map((o) => JSON.parse(o).level);
      expect(levels).not.toContain('debug');
      expect(levels).toContain('info');
      expect(levels).toContain('warn');
      expect(levels).toContain('error');
    });

    test('LOG_LEVEL=debug shows all levels', () => {
      process.env.LOG_LEVEL = 'debug';
      // Re-import to pick up new env var
      jest.resetModules();
      const { logger: loggerDebug } = require('../logger');

      loggerDebug.debug('debug message');
      loggerDebug.info('info message');
      loggerDebug.warn('warn message');
      loggerDebug.error('error message');

      expect(capturedOutput).toHaveLength(4);
      const levels = capturedOutput.map((o) => JSON.parse(o).level);
      expect(levels).toContain('debug');
      expect(levels).toContain('info');
      expect(levels).toContain('warn');
      expect(levels).toContain('error');
    });

    test('LOG_LEVEL=warn shows warn and error only', () => {
      process.env.LOG_LEVEL = 'warn';
      jest.resetModules();
      const { logger: loggerWarn } = require('../logger');

      loggerWarn.debug('debug message');
      loggerWarn.info('info message');
      loggerWarn.warn('warn message');
      loggerWarn.error('error message');

      expect(capturedOutput).toHaveLength(2);
      const levels = capturedOutput.map((o) => JSON.parse(o).level);
      expect(levels).not.toContain('debug');
      expect(levels).not.toContain('info');
      expect(levels).toContain('warn');
      expect(levels).toContain('error');
    });

    test('LOG_LEVEL=error shows error only', () => {
      process.env.LOG_LEVEL = 'error';
      jest.resetModules();
      const { logger: loggerError } = require('../logger');

      loggerError.debug('debug message');
      loggerError.info('info message');
      loggerError.warn('warn message');
      loggerError.error('error message');

      expect(capturedOutput).toHaveLength(1);
      const levels = capturedOutput.map((o) => JSON.parse(o).level);
      expect(levels).not.toContain('debug');
      expect(levels).not.toContain('info');
      expect(levels).not.toContain('warn');
      expect(levels).toContain('error');
    });

    test('invalid LOG_LEVEL defaults to info', () => {
      process.env.LOG_LEVEL = 'invalid';
      jest.resetModules();
      const { logger: loggerInvalid } = require('../logger');

      loggerInvalid.debug('debug message');
      loggerInvalid.info('info message');

      expect(capturedOutput).toHaveLength(1);
      const levels = capturedOutput.map((o) => JSON.parse(o).level);
      expect(levels).not.toContain('debug');
      expect(levels).toContain('info');
    });
  });
});
