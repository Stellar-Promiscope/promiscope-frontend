/**
 * Seeds synthetic players into the materialized `players` table for local
 * performance verification of GET /players (issue #1298's "first page of
 * 10k seeded players in under 1 s locally" acceptance criterion).
 *
 * Rows are built through EventStore.insertEvent, i.e. the same projection
 * path real chain events take — the seeded DB is indistinguishable from a
 * polled one for query purposes.
 *
 * Usage (build first — the script ships in dist/):
 *   npm run build --workspace @scoutoff/indexer
 *   node packages/indexer/dist/scripts/seedPlayers.js [--count 10000] [--db /path/to/indexer.db]
 *
 * Then benchmark against a running indexer pointed at the same DB:
 *   time curl 'localhost:3001/players?limit=50&region=West%20Africa'
 *
 * `--db` defaults to INDEXER_DB_PATH, then packages/indexer/data/indexer.db.
 */
import { EventStore } from '../db/eventStore';
import type { DecodedEvent } from '../eventPoller';

const DEFAULT_COUNT = 10_000;

const REGIONS = [
  'West Africa',
  'East Africa',
  'North Africa',
  'Southern Africa',
  'Central Africa',
];
const POSITIONS = ['ST', 'CM', 'CB', 'GK', 'LW', 'RB'];

interface SeedArgs {
  count: number;
  dbPath: string | undefined;
}

export function parseArgs(argv: string[]): SeedArgs {
  let count = DEFAULT_COUNT;
  let dbPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--count') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error('--count must be a positive integer');
      }
      count = value;
    } else if (arg === '--db') {
      dbPath = argv[++i];
      if (!dbPath) throw new Error('--db requires a path');
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { count, dbPath };
}

/** Deterministic pseudo wallet (G + 55 base32 chars) for a seeded player. */
function seedWallet(i: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let out = 'G';
  for (let k = 0; k < 55; k++) {
    out += alphabet[(i + k * 7) % alphabet.length];
  }
  return out;
}

export function seedPlayers(count: number): { registered: number } {
  const store = EventStore.getInstance();
  let seq = 0;

  store.transaction(() => {
    for (let i = 0; i < count; i++) {
      const playerId = `seed-player-${String(i).padStart(6, '0')}`;
      const ledger = 1_000_000 + i;
      const timestamp = 1_700_000_000 + i;

      seq += 1;
      const registration: DecodedEvent = {
        type: 'player_registered',
        contractVersion: 1,
        ledger,
        timestamp,
        data: {
          player_id: playerId,
          wallet: seedWallet(i),
          ipfs_hash: '',
          vitals: {
            name: `Seed Player ${i}`,
            age: 16 + (i % 15),
            position: POSITIONS[i % POSITIONS.length],
            region: REGIONS[i % REGIONS.length],
            nationality: 'Nigeria',
          },
        },
        eventId: `seed:player_registered:${seq}`,
      };
      store.insertEvent(registration);

      // Spread across progress levels 0–3 (approvals set 1–3, matching the
      // contract's MAX(current, new_level) semantics).
      const level = i % 4;
      if (level > 0) {
        seq += 1;
        store.insertEvent({
          type: 'milestone_approved',
          contractVersion: 1,
          ledger: ledger + 1,
          timestamp: timestamp + 1,
          data: {
            player_id: playerId,
            milestone_id: `seed-m-${i}`,
            new_level: level,
          },
          eventId: `seed:milestone_approved:${seq}`,
        });
      }
    }
  });

  return { registered: store.getPlayers({ limit: 1 }).total };
}

function main(): void {
  const { count, dbPath } = parseArgs(process.argv.slice(2));
  if (dbPath) process.env.INDEXER_DB_PATH = dbPath;

  const started = Date.now();
  const { registered } = seedPlayers(count);
  const elapsed = Date.now() - started;

  const resolved =
    dbPath ?? process.env.INDEXER_DB_PATH ?? '(default or :memory: in test)';
  console.log(
    `Seeded ${registered} players into ${resolved} in ${elapsed} ms.`,
  );
  console.log('Benchmark with:');
  console.log(
    `  time curl 'localhost:3001/players?limit=50&region=${encodeURIComponent('West Africa')}'`,
  );
}

// Only run when executed directly (not when imported by tests).
if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
