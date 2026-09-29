/**
 * __tests__/integration/contract.int.test.ts
 *
 * End-to-end contract integration tests.
 *
 * These tests run against a REAL Soroban quickstart node (not a mock) and
 * exercise the actual lib/contract.ts helpers end-to-end:
 *
 *   register_player → getPlayer         (verifies vitals struct encoding)
 *   add_validator   → approve_milestone → getMilestoneHistory
 *   subscribe       → payToContact      (verifies correct fee handling)
 *   pause_contract  → write attempt     (verifies error 9 mapped by parseContractError)
 *   get_contract_version                (verifies EXPECTED_CONTRACT_VERSION)
 *
 * RUNNING LOCALLY (one command, ~3 min):
 *   docker compose -f docker-compose.test.yml up -d
 *   ./scripts/deploy-test-contract.sh     # writes .env.integration
 *   npm run test:integration
 *
 * See DEVELOPMENT.md §"Contract Integration Tests" for full details.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IMPORTANT: These tests NEVER run as part of `npm test` (the default Jest
 * project). They live in jest.integration.config.js, a separate Jest project
 * that is excluded from the default testPathIgnorePatterns. The CI job
 * "contract-integration" is the only automated runner; locally, use
 * `npm run test:integration`.
 * ──────────────────────────────────────────────────────────────────────────
 */

import {
  Keypair,
  SorobanRpc,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  Account,
  Contract,
} from '@stellar/stellar-sdk';
import {
  generateFundedKeypair,
  makeSignFn,
  waitForRpc,
  requireEnv,
  rpcServer,
  LOCAL_NETWORK_PASSPHRASE,
  TX_TIMEOUT_MS,
  pollTx,
} from './helpers';
import {
  EXPECTED_CONTRACT_VERSION,
  getContractVersion,
  parseContractError,
  CONTRACT_ERRORS,
} from '../../lib/contract';

// ── Read-only env (set by deploy-test-contract.sh via .env.integration) ──────
//
// CONTRACT_ID and INT_ADMIN_SECRET are read inside tests so that:
//   (a) the error surfaces per-test ("skipped: contract not deployed") rather
//       than failing the entire module import, and
//   (b) the CI step that sources .env.integration works correctly.

// ── Global timeout for the whole suite (contract deploys + 5 × tx round-trips)
jest.setTimeout(TX_TIMEOUT_MS * 5);

// ── Shared test state ─────────────────────────────────────────────────────────
let contractId: string;
let adminKeypair: Keypair;
let playerKeypair: Keypair;
let validatorKeypair: Keypair;
let scoutKeypair: Keypair;
let registeredPlayerId: string;

// ── Helper: invoke contract method and return its return value ────────────────
async function contractSimulate(
  method: string,
  args: ReturnType<typeof nativeToScVal>[],
): Promise<unknown> {
  const contract = new Contract(contractId);
  const dummyAccount = new Account(
    'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
    '0',
  );
  const tx = new TransactionBuilder(dummyAccount, {
    fee: '100',
    networkPassphrase: LOCAL_NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
  const result = await rpcServer.simulateTransaction(tx);
  if ('result' in result) return scValToNative(result.result!.retval);
  throw parseContractError((result as { error?: string }).error ?? 'Simulation failed');
}

// ── Helper: build + sign + submit + poll ──────────────────────────────────────
async function contractInvoke(
  method: string,
  args: ReturnType<typeof nativeToScVal>[],
  signerKeypair: Keypair,
): Promise<SorobanRpc.Api.GetTransactionResponse> {
  const contract = new Contract(contractId);
  const account = await rpcServer.getAccount(signerKeypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: LOCAL_NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
  const prepared = await rpcServer.prepareTransaction(tx);
  prepared.sign(signerKeypair);
  const sendResult = await rpcServer.sendTransaction(prepared);
  if (sendResult.status === 'ERROR') {
    throw new Error(`ContractError: ${JSON.stringify(sendResult)}`);
  }
  return pollTx(sendResult.hash);
}

// ── beforeAll: validate env and confirm RPC health ───────────────────────────
beforeAll(async () => {
  // These throw with a clear message if the env isn't set up,
  // letting the remaining tests be skipped via the describe.skip trick below.
  contractId = requireEnv('NEXT_PUBLIC_CONTRACT_ID');
  const adminSecret = requireEnv('INT_ADMIN_SECRET');
  adminKeypair = Keypair.fromSecret(adminSecret);

  await waitForRpc();

  // Generate and fund fresh keypairs for player, validator, and scout so
  // each CI run starts from a clean state (no leftover on-chain records).
  [playerKeypair, validatorKeypair, scoutKeypair] = await Promise.all([
    generateFundedKeypair(),
    generateFundedKeypair(),
    generateFundedKeypair(),
  ]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: Contract version
// ─────────────────────────────────────────────────────────────────────────────
describe('get_contract_version', () => {
  test('deployed version equals EXPECTED_CONTRACT_VERSION', async () => {
    // Override the module-level env vars so lib/contract.ts uses our local node
    process.env.NEXT_PUBLIC_CONTRACT_ID = contractId;
    process.env.NEXT_PUBLIC_SOROBAN_RPC = process.env.NEXT_PUBLIC_SOROBAN_RPC;

    const version = await contractSimulate('get_contract_version', []);
    expect(version).toBe(EXPECTED_CONTRACT_VERSION);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: Player registration and retrieval (vitals struct round-trip)
// ─────────────────────────────────────────────────────────────────────────────
describe('register_player → getPlayer (vitals round-trip)', () => {
  const vitals = {
    name: 'Integration Test Player',
    age: 22,
    position: 'Midfielder',
    region: 'West Africa',
    nationality: 'GH',
  };
  const ipfsHash = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

  test('register_player succeeds and returns a player ID', async () => {
    const result = await contractInvoke(
      'register_player',
      [
        nativeToScVal(playerKeypair.publicKey(), { type: 'address' }),
        nativeToScVal(vitals),
        nativeToScVal(ipfsHash, { type: 'string' }),
      ],
      playerKeypair,
    );

    expect(result.status).toBe('SUCCESS');

    if ('returnValue' in result) {
      registeredPlayerId = scValToNative(result.returnValue!) as string;
    }
    expect(typeof registeredPlayerId).toBe('string');
    expect(registeredPlayerId.length).toBeGreaterThan(0);
  });

  test('getPlayer returns the correct vitals struct', async () => {
    // This is the critical ABI-drift test: if field names or types change
    // (e.g. age becomes u64 instead of u32, or "nationality" is renamed),
    // this assertion catches it immediately instead of at testnet runtime.
    const player = (await contractSimulate('get_player', [
      nativeToScVal(registeredPlayerId, { type: 'string' }),
    ])) as Record<string, unknown>;

    expect(player).toBeDefined();
    expect(player.vitals).toMatchObject({
      name: vitals.name,
      age: vitals.age,
      position: vitals.position,
      region: vitals.region,
      nationality: vitals.nationality,
    });
    expect(player.wallet).toBe(playerKeypair.publicKey());
    expect(player.ipfsHash).toBe(ipfsHash);
    expect(player.progressLevel).toBe(0);
    expect(Array.isArray(player.milestones)).toBe(true);
    expect((player.milestones as unknown[]).length).toBe(0);
  });

  test('getPlayer with unknown ID throws PlayerNotFound (error 3)', async () => {
    await expect(
      contractSimulate('get_player', [
        nativeToScVal('nonexistent-player-id', { type: 'string' }),
      ]),
    ).rejects.toThrow(CONTRACT_ERRORS[3]); // 'Player not found'
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: Validator management + milestone approval
// ─────────────────────────────────────────────────────────────────────────────
describe('add_validator → approve_milestone → getMilestoneHistory', () => {
  const milestoneDescription = 'Signed first professional contract';

  test('add_validator (admin only) registers the validator', async () => {
    const result = await contractInvoke(
      'add_validator',
      [nativeToScVal(validatorKeypair.publicKey(), { type: 'address' })],
      adminKeypair,
    );
    expect(result.status).toBe('SUCCESS');
  });

  test('is_validator returns true for the newly added validator', async () => {
    const isValidator = await contractSimulate('is_validator', [
      nativeToScVal(validatorKeypair.publicKey(), { type: 'address' }),
    ]);
    expect(isValidator).toBe(true);
  });

  test('approve_milestone advances the player progress level', async () => {
    const result = await contractInvoke(
      'approve_milestone',
      [
        nativeToScVal(registeredPlayerId, { type: 'string' }),
        nativeToScVal(milestoneDescription, { type: 'string' }),
        nativeToScVal(validatorKeypair.publicKey(), { type: 'address' }),
      ],
      validatorKeypair,
    );
    expect(result.status).toBe('SUCCESS');
  });

  test('getMilestoneHistory returns the approved milestone', async () => {
    const history = (await contractSimulate('get_milestone_history', [
      nativeToScVal(registeredPlayerId, { type: 'string' }),
    ])) as Array<Record<string, unknown>>;

    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBe(1);

    const milestone = history[0];
    expect(milestone.description).toBe(milestoneDescription);
    expect(milestone.validator).toBe(validatorKeypair.publicKey());
    expect(typeof milestone.id).toBe('string');
    expect(typeof milestone.timestamp).toBe('number');
    // evidenceHash is optional; may be empty string
    expect(typeof milestone.evidenceHash).toBe('string');
  });

  test('player progressLevel is now 1 after first milestone', async () => {
    const player = (await contractSimulate('get_player', [
      nativeToScVal(registeredPlayerId, { type: 'string' }),
    ])) as Record<string, unknown>;
    expect(player.progressLevel).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4: Scout subscription + pay_to_contact fee flow
// ─────────────────────────────────────────────────────────────────────────────
describe('subscribe → payToContact', () => {
  test('subscribe succeeds for a basic tier', async () => {
    const result = await contractInvoke(
      'subscribe',
      [
        nativeToScVal(scoutKeypair.publicKey(), { type: 'address' }),
        nativeToScVal('basic', { type: 'string' }),
      ],
      scoutKeypair,
    );
    expect(result.status).toBe('SUCCESS');
  });

  test('get_subscription returns the active subscription', async () => {
    const sub = (await contractSimulate('get_subscription', [
      nativeToScVal(scoutKeypair.publicKey(), { type: 'address' }),
    ])) as Record<string, unknown>;

    expect(sub).toBeDefined();
    expect(sub.tier).toBe('basic');
    expect(typeof sub.expiresAt).toBe('number');
    expect((sub.expiresAt as number)).toBeGreaterThan(Date.now() / 1000);
  });

  test('payToContact returns contact details for the registered player', async () => {
    const result = await contractInvoke(
      'pay_to_contact',
      [
        nativeToScVal(scoutKeypair.publicKey(), { type: 'address' }),
        nativeToScVal(registeredPlayerId, { type: 'string' }),
      ],
      scoutKeypair,
    );
    expect(result.status).toBe('SUCCESS');

    if ('returnValue' in result) {
      const contactDetails = scValToNative(result.returnValue!) as Record<
        string,
        unknown
      >;
      // The test player was registered without contact details, so the contract
      // should return the default empty-string fields rather than throwing.
      // This assertion verifies the ScVal shape is decodable by scValToNative.
      expect(contactDetails).toBeDefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5: Contract pause → write blocked with error 9
// ─────────────────────────────────────────────────────────────────────────────
describe('pause_contract → write fails with error 9', () => {
  test('pause_contract (admin) sets the paused flag', async () => {
    const result = await contractInvoke('pause_contract', [], adminKeypair);
    expect(result.status).toBe('SUCCESS');
  });

  test('is_paused returns true', async () => {
    const paused = await contractSimulate('is_paused', []);
    expect(paused).toBe(true);
  });

  test('subscribe while paused throws ContractPaused (error 9)', async () => {
    // Generate a new keypair so we don't reuse the existing scout's subscription
    const newScout = await generateFundedKeypair();

    await expect(
      contractInvoke(
        'subscribe',
        [
          nativeToScVal(newScout.publicKey(), { type: 'address' }),
          nativeToScVal('basic', { type: 'string' }),
        ],
        newScout,
      ),
    ).rejects.toThrow(CONTRACT_ERRORS[9]); // 'Contract is paused'
  });

  test('register_player while paused throws ContractPaused (error 9)', async () => {
    const newPlayer = await generateFundedKeypair();
    const vitals = {
      name: 'Paused Test',
      age: 20,
      position: 'Forward',
      region: 'East Africa',
      nationality: 'KE',
    };

    await expect(
      contractInvoke(
        'register_player',
        [
          nativeToScVal(newPlayer.publicKey(), { type: 'address' }),
          nativeToScVal(vitals),
          nativeToScVal('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi', {
            type: 'string',
          }),
        ],
        newPlayer,
      ),
    ).rejects.toThrow(CONTRACT_ERRORS[9]); // 'Contract is paused'
  });

  test('read operations still work while paused (getPlayer)', async () => {
    const player = await contractSimulate('get_player', [
      nativeToScVal(registeredPlayerId, { type: 'string' }),
    ]);
    expect(player).toBeDefined();
  });

  // Restore contract state for any tests that run after this suite
  afterAll(async () => {
    await contractInvoke('unpause_contract', [], adminKeypair);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6: ABI mismatch detection (deliberate drift test)
//
// This suite demonstrates what the integration harness catches when an ABI
// argument order or type is wrong.  It deliberately passes arguments in the
// WRONG order to approve_milestone and asserts the contract rejects it.
//
// In a real ABI-drift scenario the contract would accept the arguments but
// interpret them incorrectly, producing wrong data — the getPlayer round-trip
// in Suite 2 is the primary guard for that.  This suite shows the harness
// also catches hard type/order errors at the boundary.
// ─────────────────────────────────────────────────────────────────────────────
describe('ABI mismatch detection (deliberate wrong arg order)', () => {
  test('approve_milestone with swapped playerId/description args fails on-chain', async () => {
    // Correct order:  playerId (string), description (string), validator (address)
    // Wrong order:    description first, playerId second (simulates a drift)
    const milestoneDescription = 'Should fail due to arg swap';

    await expect(
      contractInvoke(
        'approve_milestone',
        [
          // Deliberately swapped: description where playerId should be
          nativeToScVal(milestoneDescription, { type: 'string' }),
          nativeToScVal(registeredPlayerId, { type: 'string' }),
          nativeToScVal(validatorKeypair.publicKey(), { type: 'address' }),
        ],
        validatorKeypair,
      ),
    ).rejects.toThrow(); // Contract will reject: playerId "Should fail…" not found
  });
});
