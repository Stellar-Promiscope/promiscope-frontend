const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDbPath = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'promiscope-backend-logger-test-')),
  'test.db',
);
process.env.DB_PATH = tmpDbPath;

const {
  createRequestLogger,
  getOrCreateRequestId,
  REQUEST_ID_HEADER,
} = require('../src/logger');
const createApp = require('../src/app');

test.after(() => {
  fs.rmSync(path.dirname(tmpDbPath), { recursive: true, force: true });
});

// ── Request ID propagation ────────────────────────────────────────────────────

test('getOrCreateRequestId propagates an incoming x-request-id header', () => {
  const req = { headers: { [REQUEST_ID_HEADER]: 'incoming-id' } };
  assert.equal(getOrCreateRequestId(req), 'incoming-id');
});

test('getOrCreateRequestId generates a fresh id when there is no header', () => {
  const req = { headers: {} };
  const id = getOrCreateRequestId(req);
  assert.equal(typeof id, 'string');
  assert.ok(id.length > 0);
});

// ── Structured JSON and shared requestId ─────────────────────────────────────

test('createRequestLogger emits structured JSON lines sharing one requestId', () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const lines = { log: [], warn: [], error: [] };
  console.log = (line) => lines.log.push(line);
  console.warn = (line) => lines.warn.push(line);
  console.error = (line) => lines.error.push(line);

  try {
    const req = {
      headers: { [REQUEST_ID_HEADER]: 'shared-id' },
      originalUrl: '/referrals/generate?foo=bar',
    };
    const log = createRequestLogger(req);
    assert.equal(log.requestId, 'shared-id');

    log.info('starting', { safe: 'ok' });
    log.warn('careful', { secretToken: 'abc123' });
    log.error('boom');

    const info = JSON.parse(lines.log[0]);
    const warn = JSON.parse(lines.warn[0]);
    const error = JSON.parse(lines.error[0]);

    assert.equal(info.requestId, 'shared-id');
    assert.equal(info.route, '/referrals/generate');
    assert.equal(info.safe, 'ok');

    assert.equal(warn.requestId, 'shared-id');
    assert.equal(warn.secretToken, '[REDACTED]');

    assert.equal(error.requestId, 'shared-id');
    assert.equal(error.level, 'error');
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Capture a single console call made by fn(), return the parsed JSON line.
 * channel: 'log' | 'warn' | 'error'
 */
function captureOneLine(channel, fn) {
  const original = console[channel];
  let captured = null;
  console[channel] = (line) => {
    captured = line;
  };
  try {
    fn();
  } finally {
    console[channel] = original;
  }
  return JSON.parse(captured);
}

function makeReq(path = '/test') {
  return {
    headers: { [REQUEST_ID_HEADER]: 'test-req-id' },
    originalUrl: path,
  };
}

// ── Log level: info ───────────────────────────────────────────────────────────

test('info log writes to console.log with level "info" and the correct message', () => {
  const log = createRequestLogger(makeReq('/players'));
  const parsed = captureOneLine('log', () => log.info('player list fetched'));

  assert.equal(parsed.level, 'info');
  assert.equal(parsed.message, 'player list fetched');
  assert.equal(parsed.requestId, 'test-req-id');
  assert.equal(parsed.route, '/players');
});

test('info log includes a ISO-8601 timestamp', () => {
  const log = createRequestLogger(makeReq());
  const parsed = captureOneLine('log', () => log.info('ping'));

  assert.ok(typeof parsed.timestamp === 'string');
  assert.ok(
    !isNaN(Date.parse(parsed.timestamp)),
    'timestamp should be a valid date',
  );
});

test('info log passes through non-sensitive extra fields untouched', () => {
  const log = createRequestLogger(makeReq());
  const parsed = captureOneLine('log', () =>
    log.info('details', { playerId: 'p-1', region: 'Africa' }),
  );

  assert.equal(parsed.playerId, 'p-1');
  assert.equal(parsed.region, 'Africa');
});

// ── Log level: warn ───────────────────────────────────────────────────────────

test('warn log writes to console.warn with level "warn" and the correct message', () => {
  const log = createRequestLogger(makeReq('/subscriptions'));
  const parsed = captureOneLine('warn', () =>
    log.warn('rate limit approaching'),
  );

  assert.equal(parsed.level, 'warn');
  assert.equal(parsed.message, 'rate limit approaching');
  assert.equal(parsed.requestId, 'test-req-id');
  assert.equal(parsed.route, '/subscriptions');
});

test('warn log does NOT write to console.log or console.error', () => {
  const log = createRequestLogger(makeReq());
  let logCalled = false;
  let errorCalled = false;
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;
  console.log = () => {
    logCalled = true;
  };
  console.error = () => {
    errorCalled = true;
  };
  console.warn = () => {};
  try {
    log.warn('only warn');
  } finally {
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
  }
  assert.equal(logCalled, false);
  assert.equal(errorCalled, false);
});

// ── Log level: error ──────────────────────────────────────────────────────────

test('error log writes to console.error with level "error" and the correct message', () => {
  const log = createRequestLogger(makeReq('/ipfs/upload'));
  const parsed = captureOneLine('error', () => log.error('upload failed'));

  assert.equal(parsed.level, 'error');
  assert.equal(parsed.message, 'upload failed');
  assert.equal(parsed.requestId, 'test-req-id');
  assert.equal(parsed.route, '/ipfs/upload');
});

test('error log does NOT write to console.log or console.warn', () => {
  const log = createRequestLogger(makeReq());
  let logCalled = false;
  let warnCalled = false;
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = () => {
    logCalled = true;
  };
  console.warn = () => {
    warnCalled = true;
  };
  console.error = () => {};
  try {
    log.error('only error');
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
  assert.equal(logCalled, false);
  assert.equal(warnCalled, false);
});

// ── #897: explicit log level assertions ──────────────────────────────────────

test('info level: emits to console.log with level "info" and correct message', () => {
  const captured = [];
  const originalLog = console.log;
  console.log = (line) => captured.push(line);
  try {
    const req = {
      headers: { [REQUEST_ID_HEADER]: 'info-test' },
      originalUrl: '/test',
    };
    const log = createRequestLogger(req);
    log.info('user signed in', { userId: 'u1' });
    assert.equal(captured.length, 1);
    const parsed = JSON.parse(captured[0]);
    assert.equal(parsed.level, 'info');
    assert.equal(parsed.message, 'user signed in');
    assert.equal(parsed.userId, 'u1');
    assert.equal(parsed.requestId, 'info-test');
    assert.ok(parsed.timestamp, 'timestamp should be present');
  } finally {
    console.log = originalLog;
  }
});

test('warn level: emits to console.warn with level "warn" and correct message', () => {
  const captured = [];
  const originalWarn = console.warn;
  console.warn = (line) => captured.push(line);
  try {
    const req = {
      headers: { [REQUEST_ID_HEADER]: 'warn-test' },
      originalUrl: '/test',
    };
    const log = createRequestLogger(req);
    log.warn('rate limit approaching', { remaining: 5 });
    assert.equal(captured.length, 1);
    const parsed = JSON.parse(captured[0]);
    assert.equal(parsed.level, 'warn');
    assert.equal(parsed.message, 'rate limit approaching');
    assert.equal(parsed.remaining, 5);
  } finally {
    console.warn = originalWarn;
  }
});

test('error level: emits to console.error with level "error" and correct message', () => {
  const captured = [];
  const originalError = console.error;
  console.error = (line) => captured.push(line);
  try {
    const req = {
      headers: { [REQUEST_ID_HEADER]: 'error-test' },
      originalUrl: '/test',
    };
    const log = createRequestLogger(req);
    log.error('database connection failed', { code: 'ECONNREFUSED' });
    assert.equal(captured.length, 1);
    const parsed = JSON.parse(captured[0]);
    assert.equal(parsed.level, 'error');
    assert.equal(parsed.message, 'database connection failed');
    assert.equal(parsed.code, 'ECONNREFUSED');
  } finally {
    console.error = originalError;
  }
});

// ── #897: sensitive field redaction ──────────────────────────────────────────

test('redacts fields whose key matches the sensitive pattern (secret, token, password)', () => {
  const capturedWarn = [];
  const capturedLog = [];
  const originalWarn = console.warn;
  const originalLog = console.log;
  console.warn = (line) => capturedWarn.push(line);
  console.log = (line) => capturedLog.push(line);
  try {
    const req = { headers: {}, originalUrl: '/auth' };
    const log = createRequestLogger(req);
    log.warn('auth attempt', {
      secretToken: 'super-secret-value',
      password: 'hunter2',
      authorization: 'Bearer eyJhbGci',
      safeField: 'visible',
    });
    const parsed = JSON.parse(capturedWarn[0]);
    assert.equal(parsed.secretToken, '[REDACTED]');
    assert.equal(parsed.password, '[REDACTED]');
    assert.equal(parsed.authorization, '[REDACTED]');
    assert.equal(parsed.safeField, 'visible');
  } finally {
    console.warn = originalWarn;
    console.log = originalLog;
  }
});

test('does not redact safe fields that do not match the sensitive pattern', () => {
  const captured = [];
  const originalLog = console.log;
  console.log = (line) => captured.push(line);
  try {
    const req = { headers: {}, originalUrl: '/players' };
    const log = createRequestLogger(req);
    log.info('player fetched', {
      playerId: 'p123',
      region: 'Africa',
      level: 2,
    });
    const parsed = JSON.parse(captured[0]);
    assert.equal(parsed.playerId, 'p123');
    assert.equal(parsed.region, 'Africa');
    assert.equal(parsed.level, 2);
  } finally {
    console.log = originalLog;
  }
});

test('wallet address or key-like string in a sensitive-named field is redacted', () => {
  // Stellar wallet addresses start with G and are 56 chars; they may appear in
  // fields like 'authorization' or custom 'walletAddress' keys. If the field
  // key matches the sensitive pattern the value is always masked.
  const captured = [];
  const originalLog = console.log;
  console.log = (line) => captured.push(line);
  try {
    const req = { headers: {}, originalUrl: '/contact' };
    const log = createRequestLogger(req);
    // 'contact' matches the sensitive key pattern
    log.info('contact lookup', {
      contact: 'GCFW7QAO3WZQ6X4CZ3OYZFXX3A3DL7XVI5DNVTXA5VJUGE5SU6ZRG5OV',
    });
    const parsed = JSON.parse(captured[0]);
    assert.equal(parsed.contact, '[REDACTED]');
  } finally {
    console.log = originalLog;
  }
});

test('wallet address in a non-sensitive field name is NOT redacted (key-only matching)', () => {
  // The logger redacts by field key, not field value. A Stellar wallet address
  // stored under a non-sensitive key (e.g. 'playerWallet') should pass through.
  const captured = [];
  const originalLog = console.log;
  console.log = (line) => captured.push(line);
  try {
    const req = { headers: {}, originalUrl: '/players' };
    const log = createRequestLogger(req);
    log.info('player found', {
      playerWallet: 'GCFW7QAO3WZQ6X4CZ3OYZFXX3A3DL7XVI5DNVTXA5VJUGE5SU6ZRG5OV',
    });
    const parsed = JSON.parse(captured[0]);
    // Key 'playerWallet' does NOT match the sensitive pattern, so value is visible.
    assert.equal(
      parsed.playerWallet,
      'GCFW7QAO3WZQ6X4CZ3OYZFXX3A3DL7XVI5DNVTXA5VJUGE5SU6ZRG5OV',
    );
  } finally {
    console.log = originalLog;
  }
});

test('log output is valid JSON for all three levels', () => {
  const lines = { log: [], warn: [], error: [] };
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (line) => lines.log.push(line);
  console.warn = (line) => lines.warn.push(line);
  console.error = (line) => lines.error.push(line);
  try {
    const req = { headers: {}, path: '/test' };
    const log = createRequestLogger(req);
    log.info('msg');
    log.warn('msg');
    log.error('msg');
    assert.doesNotThrow(
      () => JSON.parse(lines.log[0]),
      'info line is valid JSON',
    );
    assert.doesNotThrow(
      () => JSON.parse(lines.warn[0]),
      'warn line is valid JSON',
    );
    assert.doesNotThrow(
      () => JSON.parse(lines.error[0]),
      'error line is valid JSON',
    );
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
  assert.equal(logCalled, false);
  assert.equal(warnCalled, false);
});

// ── Sensitive field redaction ─────────────────────────────────────────────────

test('redacts fields whose keys contain "secret"', () => {
  const log = createRequestLogger(makeReq());
  const parsed = captureOneLine('log', () =>
    log.info('auth attempt', { secret: 'my-secret-value' }),
  );
  assert.equal(parsed.secret, '[REDACTED]');
});

test('redacts fields whose keys contain "password"', () => {
  const log = createRequestLogger(makeReq());
  const parsed = captureOneLine('log', () =>
    log.info('login', { password: 'hunter2' }),
  );
  assert.equal(parsed.password, '[REDACTED]');
});

test('redacts fields whose keys contain "token"', () => {
  const log = createRequestLogger(makeReq());
  const parsed = captureOneLine('warn', () =>
    log.warn('token check', { authToken: 'Bearer abc123' }),
  );
  assert.equal(parsed.authToken, '[REDACTED]');
});

test('redacts fields whose keys contain "authorization"', () => {
  const log = createRequestLogger(makeReq());
  const parsed = captureOneLine('log', () =>
    log.info('header dump', { authorization: 'Bearer xyz' }),
  );
  assert.equal(parsed.authorization, '[REDACTED]');
});

test('redacts fields whose keys contain "signature" (e.g. Stellar XDR signatures)', () => {
  const log = createRequestLogger(makeReq());
  const parsed = captureOneLine('log', () =>
    log.info('sep10', { signature: 'AAAA...base64XDR' }),
  );
  assert.equal(parsed.signature, '[REDACTED]');
});

test('redacts fields whose keys contain "xdr" (signed Stellar transactions)', () => {
  const log = createRequestLogger(makeReq());
  const parsed = captureOneLine('log', () =>
    log.info('submit tx', { signedXdr: 'AAAA...base64XDR' }),
  );
  assert.equal(parsed.signedXdr, '[REDACTED]');
});

test('redacts fields whose keys contain "cookie"', () => {
  const log = createRequestLogger(makeReq());
  const parsed = captureOneLine('log', () =>
    log.info('request', { cookie: 'session=abc' }),
  );
  assert.equal(parsed.cookie, '[REDACTED]');
});

test('redacts fields whose keys contain "email"', () => {
  const log = createRequestLogger(makeReq());
  const parsed = captureOneLine('log', () =>
    log.info('contact unlock', { email: 'player@example.com' }),
  );
  assert.equal(parsed.email, '[REDACTED]');
});

test('redacts fields whose keys contain "phone"', () => {
  const log = createRequestLogger(makeReq());
  const parsed = captureOneLine('log', () =>
    log.info('contact unlock', { phone: '+1234567890' }),
  );
  assert.equal(parsed.phone, '[REDACTED]');
});

test('does NOT redact a safe field whose key has no sensitive pattern', () => {
  const log = createRequestLogger(makeReq());
  const parsed = captureOneLine('log', () =>
    log.info('scout search', { region: 'Africa', position: 'ST', minLevel: 2 }),
  );
  assert.equal(parsed.region, 'Africa');
  assert.equal(parsed.position, 'ST');
  assert.equal(parsed.minLevel, 2);
});

// ── Wallet address behaviour ──────────────────────────────────────────────────

test('a Stellar wallet address in a safe field (e.g. "walletAddress") is logged as-is', () => {
  // The logger redacts by *key name* pattern, not by value pattern.
  // A key like "walletAddress" does not match SENSITIVE_KEY_PATTERN, so the
  // value (a G… public key) passes through. This test documents that behaviour.
  const stellarPublicKey =
    'GCFW7QAO3WZQ6X4CZ3OYZFXX3A3DL7XVI5DNVTXA5VJUGE5SU6ZRG5OV';
  const log = createRequestLogger(makeReq());
  const parsed = captureOneLine('log', () =>
    log.info('player lookup', { walletAddress: stellarPublicKey }),
  );
  // Public key is NOT sensitive by key name — it is safe to log for tracing.
  assert.equal(parsed.walletAddress, stellarPublicKey);
});

test('a Stellar wallet address stored under a key matching "secret" is redacted', () => {
  // If a developer accidentally passes a *secret* key under a sensitive field
  // name, the redactor must catch it regardless of the value type.
  const stellarSecretKey =
    'SCZANGBA5YELKRYOVLV4OGJPJF5ZBQTHGCF5V6BLFA3XDVQNL3VQ2F5';
  const log = createRequestLogger(makeReq());
  const parsed = captureOneLine('log', () =>
    log.info('auth', { stellarSecret: stellarSecretKey }),
  );
  assert.equal(parsed.stellarSecret, '[REDACTED]');
});

// ── Route extraction ──────────────────────────────────────────────────────────

test('route strips the query string from originalUrl', () => {
  const req = {
    headers: { [REQUEST_ID_HEADER]: 'qr-id' },
    originalUrl: '/players/search?region=Africa&position=ST',
  };
  const log = createRequestLogger(req);
  const parsed = captureOneLine('log', () => log.info('search'));
  assert.equal(parsed.route, '/players/search');
});

test('route falls back to req.path when originalUrl is absent', () => {
  const req = {
    headers: {},
    path: '/health',
  };
  const log = createRequestLogger(req);
  const parsed = captureOneLine('log', () => log.info('health check'));
  assert.equal(parsed.route, '/health');
});

// ── Emit with no extra fields ─────────────────────────────────────────────────

test('logger works correctly when no extra fields object is provided', () => {
  const log = createRequestLogger(makeReq('/status'));
  // Should not throw
  const parsed = captureOneLine('log', () => log.info('status ok'));
  assert.equal(parsed.message, 'status ok');
  assert.equal(parsed.level, 'info');
});

// ── App-level request-id header propagation ───────────────────────────────────

test('the app echoes X-Request-Id back on the response, propagating an incoming one', async () => {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${baseUrl}/health`, {
      headers: { [REQUEST_ID_HEADER]: 'client-supplied-id' },
    });
    assert.equal(res.headers.get(REQUEST_ID_HEADER), 'client-supplied-id');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the app generates a fresh X-Request-Id when the client sends none', async () => {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${baseUrl}/health`);
    const id = res.headers.get(REQUEST_ID_HEADER);
    assert.equal(typeof id, 'string');
    assert.ok(id.length > 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
