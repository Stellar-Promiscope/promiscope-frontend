'use strict';

/**
 * Mock Soroban RPC server for local development.
 *
 * Implements just enough of the JSON-RPC surface that lib/stellar.ts and
 * lib/contract.ts talk to (getHealth, getNetwork, getLatestLedger,
 * getLedgerEntries, simulateTransaction, sendTransaction, getTransaction) to
 * let a contributor browse the app and exercise read + write flows against a
 * deployed-contract-shaped Promiscope without any real testnet, deployed
 * contract, or credentials.
 *
 * This is a *mock*, not a Soroban node: it does not execute contract code,
 * validate signatures, or persist ledger state across restarts. Canned
 * responses are keyed off the invoked contract function name, decoded
 * straight out of the submitted transaction's InvokeHostFunctionOp XDR — see
 * MOCK_RESPONSES below to add/adjust a method's fixture.
 */

const http = require('http');
const crypto = require('crypto');
const {
  xdr,
  nativeToScVal,
  scValToNative,
  Keypair,
  StrKey,
  SorobanDataBuilder,
  Networks,
} = require('@stellar/stellar-sdk');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8000;
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

let ledgerSeq = 1000;
const accountSequences = new Map(); // accountId -> bigint sequence
const submittedTransactions = new Map(); // hash -> { envelopeB64, functionName }

function getAccountSequence(accountId) {
  if (!accountSequences.has(accountId)) {
    accountSequences.set(accountId, 1000n);
  }
  return accountSequences.get(accountId);
}

function bumpAccountSequence(accountId) {
  const next = getAccountSequence(accountId) + 1n;
  accountSequences.set(accountId, next);
  return next;
}

// ── Canned per-method responses ──────────────────────────────────────────────
// Each entry is either a static value or a function of (args: native JS
// values decoded from the call's ScVal args) returning a native JS value.
// Whatever comes back is passed through nativeToScVal with no type hint, the
// same way a real contract's return value would be decoded generically by
// lib/contract.ts's simulateTx (which calls scValToNative with no ABI spec).
const MOCK_RESPONSES = {
  health: true,
  is_paused: false,
  get_contract_version: 1,
  get_platform_fees: 0,
  is_validator: true,
  get_validators: () => [
    {
      address: 'GBR6LYRKEFYV3MG322FYLED6PLOTEV77KCX6AZSR7V4RV7EJLIWOZJWQ',
      joinedAt: 1700000000,
    },
  ],
  get_player: (args) => mockPlayer(args[0] || 'player_mock_1'),
  filter_players: () => [
    mockPlayer('player_mock_1'),
    mockPlayer('player_mock_2'),
  ],
  get_milestone_history: () => [
    {
      id: 'milestone_mock_1',
      description: 'Scored 12 goals in the regional league (mock data)',
      evidenceHash: 'QmMockEvidenceHash111111111111111111111111',
      validator: 'GBR6LYRKEFYV3MG322FYLED6PLOTEV77KCX6AZSR7V4RV7EJLIWOZJWQ',
      timestamp: 1700000000,
    },
  ],
  get_subscription: (args) => ({
    scout:
      args[0] || 'GBR6LYRKEFYV3MG322FYLED6PLOTEV77KCX6AZSR7V4RV7EJLIWOZJWQ',
    tier: 'basic',
    expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
  }),
  register_player: () => `player_mock_${Date.now()}`,
  pay_to_contact: () => ({
    email: 'mock-player@example.com',
    phone: '+10000000000',
    telegram: '@mock_player',
  }),
};

const DEFAULT_MOCK_RESPONSE = true;

function mockPlayer(id) {
  return {
    id,
    wallet: 'GBR6LYRKEFYV3MG322FYLED6PLOTEV77KCX6AZSR7V4RV7EJLIWOZJWQ',
    vitals: {
      name: 'Mock Player',
      age: 19,
      position: 'Forward',
      region: 'West Africa',
      nationality: 'Nigeria',
    },
    ipfsHash: 'QmMockPlayerHighlightReel1111111111111111111',
    progressLevel: 1,
    milestones: [],
    createdAt: 1700000000,
  };
}

function resolveMockResponse(functionName, args) {
  const entry = Object.prototype.hasOwnProperty.call(
    MOCK_RESPONSES,
    functionName,
  )
    ? MOCK_RESPONSES[functionName]
    : DEFAULT_MOCK_RESPONSE;
  return typeof entry === 'function' ? entry(args) : entry;
}

// ── XDR helpers ───────────────────────────────────────────────────────────────

function scValToJs(scVal) {
  try {
    // Best-effort native decode of a single call argument for the fixture
    // functions above; falls back to undefined if it can't be decoded (e.g.
    // an Address arg), which is fine since most fixtures ignore args.
    return scValToNative(scVal);
  } catch {
    return undefined;
  }
}

function decodeInvocation(envelopeXdrB64) {
  const envelope = xdr.TransactionEnvelope.fromXDR(envelopeXdrB64, 'base64');
  const tx = envelope.v1().tx();
  const op = tx.operations()[0];
  const hostFn = op.body().invokeHostFunctionOp().hostFunction();
  const invoke = hostFn.invokeContract();
  const functionName = invoke.functionName().toString();
  const args = invoke.args().map(scValToJs);
  return { functionName, args, tx };
}

function buildAccountEntryXdr(accountId, sequence) {
  const entry = new xdr.AccountEntry({
    accountId: Keypair.fromPublicKey(accountId).xdrAccountId(),
    balance: xdr.Int64.fromString('1000000000000'), // 100,000 XLM in stroops
    seqNum: xdr.SequenceNumber.fromString(sequence.toString()),
    numSubEntries: 0,
    inflationDest: null,
    flags: 0,
    homeDomain: '',
    thresholds: Buffer.from([1, 0, 0, 0]),
    signers: [],
    ext: new xdr.AccountEntryExt(0),
  });
  return xdr.LedgerEntryData.account(entry).toXDR('base64');
}

function buildSimulateSuccessXdr(nativeValue) {
  const retval = nativeToScVal(nativeValue);
  return retval.toXDR('base64');
}

function buildTransactionMetaXdr(nativeValue) {
  const sorobanMeta = new xdr.SorobanTransactionMeta({
    ext: new xdr.SorobanTransactionMetaExt(0),
    events: [],
    returnValue: nativeToScVal(nativeValue),
    diagnosticEvents: [],
  });
  const metaV3 = new xdr.TransactionMetaV3({
    ext: new xdr.ExtensionPoint(0),
    txChangesBefore: [],
    operations: [],
    txChangesAfter: [],
    sorobanMeta,
  });
  return new xdr.TransactionMeta(3, metaV3).toXDR('base64');
}

function buildSuccessTransactionResultXdr() {
  const invokeResult = xdr.InvokeHostFunctionResult.invokeHostFunctionSuccess(
    Buffer.alloc(32),
  );
  const opResultTr = xdr.OperationResultTr.invokeHostFunction(invokeResult);
  const opResult = xdr.OperationResult.opInner(opResultTr);
  const txResultResult = xdr.TransactionResultResult.txSuccess([opResult]);
  const txResult = new xdr.TransactionResult({
    feeCharged: xdr.Int64.fromString('100'),
    result: txResultResult,
    ext: new xdr.TransactionResultExt(0),
  });
  return txResult.toXDR('base64');
}

// ── JSON-RPC method handlers ──────────────────────────────────────────────────

function handleGetHealth() {
  return { status: 'healthy', latestLedger: ledgerSeq, oldestLedger: 1 };
}

function handleGetNetwork() {
  return {
    friendbotUrl: undefined,
    passphrase: NETWORK_PASSPHRASE,
    protocolVersion: '21',
  };
}

function handleGetLatestLedger() {
  return {
    id: `mock-ledger-${ledgerSeq}`,
    sequence: ledgerSeq,
    protocolVersion: '21',
  };
}

function handleGetLedgerEntries(params) {
  const keys = params.keys || [];
  const entries = [];
  for (const keyB64 of keys) {
    try {
      const key = xdr.LedgerKey.fromXDR(keyB64, 'base64');
      if (key.switch().name === 'account') {
        const accountId = key.account().accountId().ed25519();
        // Re-derive the strkey address from the raw ed25519 bytes on the key.
        const address = StrKey.encodeEd25519PublicKey(accountId);
        const sequence = getAccountSequence(address);
        entries.push({
          key: keyB64,
          xdr: buildAccountEntryXdr(address, sequence),
          lastModifiedLedgerSeq: ledgerSeq,
        });
      }
    } catch (err) {
      console.warn('[mock-rpc] failed to decode ledger key, skipping', err);
    }
  }
  return { entries, latestLedger: ledgerSeq };
}

function handleSimulateTransaction(params) {
  ledgerSeq += 1;
  try {
    const { functionName, args } = decodeInvocation(params.transaction);
    const mockValue = resolveMockResponse(functionName, args);
    return {
      latestLedger: ledgerSeq,
      minResourceFee: '100000',
      cost: { cpuInsns: '0', memBytes: '0' },
      results: [{ xdr: buildSimulateSuccessXdr(mockValue), auth: [] }],
      transactionData: new SorobanDataBuilder().build().toXDR('base64'),
      events: [],
    };
  } catch (err) {
    console.error('[mock-rpc] simulateTransaction decode failed', err);
    return {
      latestLedger: ledgerSeq,
      error: `mock-rpc could not decode this invocation: ${err.message}`,
    };
  }
}

function handleSendTransaction(params) {
  ledgerSeq += 1;
  let functionName = 'unknown';
  let hash;
  try {
    const decoded = decodeInvocation(params.transaction);
    functionName = decoded.functionName;
    const sourceAddress = StrKey.encodeEd25519PublicKey(
      decoded.tx.sourceAccount().ed25519(),
    );
    bumpAccountSequence(sourceAddress);
    hash = crypto.createHash('sha256').update(params.transaction).digest('hex');
  } catch (err) {
    console.error('[mock-rpc] sendTransaction decode failed', err);
    hash = crypto.randomBytes(32).toString('hex');
  }

  submittedTransactions.set(hash, {
    envelopeB64: params.transaction,
    functionName,
  });

  return {
    status: 'PENDING',
    hash,
    latestLedger: ledgerSeq,
    latestLedgerCloseTime: Math.floor(Date.now() / 1000),
  };
}

function handleGetTransaction(params) {
  const record = submittedTransactions.get(params.hash);
  const now = Math.floor(Date.now() / 1000);
  if (!record) {
    return {
      status: 'NOT_FOUND',
      latestLedger: ledgerSeq,
      latestLedgerCloseTime: now,
      oldestLedger: 1,
      oldestLedgerCloseTime: now - 3600,
    };
  }

  const mockValue = resolveMockResponse(record.functionName, []);
  return {
    status: 'SUCCESS',
    latestLedger: ledgerSeq,
    latestLedgerCloseTime: now,
    oldestLedger: 1,
    oldestLedgerCloseTime: now - 3600,
    ledger: ledgerSeq,
    createdAt: now,
    applicationOrder: 1,
    feeBump: false,
    envelopeXdr: record.envelopeB64,
    resultXdr: buildSuccessTransactionResultXdr(),
    resultMetaXdr: buildTransactionMetaXdr(mockValue),
  };
}

const METHODS = {
  getHealth: handleGetHealth,
  getNetwork: handleGetNetwork,
  getLatestLedger: handleGetLatestLedger,
  getLedgerEntries: handleGetLedgerEntries,
  simulateTransaction: handleSimulateTransaction,
  sendTransaction: handleSendTransaction,
  getTransaction: handleGetTransaction,
};

// ── HTTP server ────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok' }));
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end();
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid JSON-RPC body' }));
    }

    const handler = METHODS[payload.method];
    res.writeHead(200, { 'Content-Type': 'application/json' });

    if (!handler) {
      return res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: payload.id,
          error: {
            code: -32601,
            message: `Method not found: ${payload.method}`,
          },
        }),
      );
    }

    try {
      const result = handler(payload.params || {});
      return res.end(
        JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }),
      );
    } catch (err) {
      console.error(`[mock-rpc] ${payload.method} failed`, err);
      return res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: payload.id,
          error: { code: -32603, message: String(err.message || err) },
        }),
      );
    }
  });
});

server.listen(PORT, () => {
  console.log(
    `[mock-rpc] listening on port ${PORT} (network: ${NETWORK_PASSPHRASE})`,
  );
});
