/**
 * Dependency-free JSON logger for the indexer.
 * Logs are written as JSON lines to stdout with level, message, timestamp, and optional fields.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getCurrentLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && envLevel in LEVEL_PRIORITY) {
    return envLevel as LogLevel;
  }
  return 'info';
}

const currentLevel = getCurrentLogLevel();

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

interface LogFields {
  [key: string]: unknown;
}

function log(level: LogLevel, msg: string, fields?: LogFields): void {
  if (!shouldLog(level)) {
    return;
  }

  const logEntry = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...(fields ?? {}),
  };

  process.stdout.write(JSON.stringify(logEntry) + '\n');
}

export const logger = {
  debug(msg: string, fields?: LogFields): void {
    log('debug', msg, fields);
  },
  info(msg: string, fields?: LogFields): void {
    log('info', msg, fields);
  },
  warn(msg: string, fields?: LogFields): void {
    log('warn', msg, fields);
  },
  error(msg: string, fields?: LogFields): void {
    log('error', msg, fields);
  },
};
