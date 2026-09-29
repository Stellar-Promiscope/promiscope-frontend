/** @jest-environment node */
/**
 * Peak-memory benchmark for the streamed /complete pipeline (issue #1295).
 *
 * The old implementation concatenated the whole file into one Buffer, copied
 * it into a Uint8Array and a File, and kept a second full copy alive while
 * re-downloading from the gateway — roughly 300-400 MB peak RSS for a
 * 100 MB upload. The streamed pipeline must stay far below the 64 MB budget
 * the issue sets: a 100 MB file must never be resident all at once.
 *
 * This seeds a real 100 MB / 100-chunk session into the SQLite chunk store,
 * then measures live-memory growth across `prepareStreamedAssembly()` (the
 * hashing pass) plus draining the multipart body that would be handed to
 * `fetch(..., { duplex: 'half' })`.
 *
 * Run the strict budget check with:
 *   npm run test:memory
 * (`NODE_OPTIONS=--expose-gc` lets the harness force a GC at each sample so
 * it measures the *live* set instead of uncollected garbage. Under a plain
 * `npm test` there is no way to force GC, so this file falls back to a
 * looser smoke bound — see `hasGc` below.)
 */
import {
  initSession,
  writeChunk,
  prepareStreamedAssembly,
  cleanupSession,
  CHUNK_SIZE_BYTES,
} from '@/lib/chunkedUploadStore';
import { buildStreamingMultipartBody } from '@/lib/streamingMultipart';

/** 100 chunks x 1 MB = the 100 MB /init cap. */
const TOTAL_CHUNKS = 100;
const FILE_SIZE = TOTAL_CHUNKS * CHUNK_SIZE_BYTES;

/** Budget from the issue: peak memory for a 100 MB complete must be < 64 MB. */
const PEAK_MEMORY_BUDGET_MB = 64;
/** Fallback bound when GC can't be forced (garbage retention makes the live
 *  set unobservable, but a full-file concat would still blow past this). */
const NO_GC_SMOKE_BOUND_MB = 256;

const hasGc = typeof (globalThis as { gc?: () => void }).gc === 'function';

/** Bytes of live heap + Buffer backing stores, in MB. */
function liveMb(): number {
  if (hasGc) (globalThis as unknown as { gc: () => void }).gc();
  const { heapUsed, external } = process.memoryUsage();
  return (heapUsed + external) / (1024 * 1024);
}

describe('issue #1295: 100 MB complete stays under the memory budget', () => {
  it('streams a 100 MB assembly without ever holding the whole file', async () => {
    const { sessionId } = await initSession({
      filename: 'big.mp4',
      fileType: 'video/mp4',
      fileSize: FILE_SIZE,
      totalChunks: TOTAL_CHUNKS,
    });

    // Seed one 1 MB chunk per index; the same source buffer is reused, so
    // seeding itself only ever holds 1 MB.
    const source = Buffer.alloc(CHUNK_SIZE_BYTES, 0x5a);
    for (let i = 0; i < TOTAL_CHUNKS; i++) {
      await writeChunk(sessionId, i, source);
    }

    // Baseline AFTER seeding: this measures /complete's own footprint.
    const baseline = liveMb();
    let peak = baseline;

    const assembly = await prepareStreamedAssembly(sessionId);
    expect(assembly.totalBytes).toBe(FILE_SIZE);

    const { stream, contentLength } = buildStreamingMultipartBody(
      'bench-boundary',
      assembly.filename,
      assembly.fileType,
      assembly.totalBytes,
      assembly.chunks,
    );

    let received = 0;
    let seen = 0;
    for await (const piece of stream as unknown as AsyncIterable<Uint8Array>) {
      received += piece.length;
      // Sample every ~10 chunks: enough to catch any accumulation without
      // paying for a forced GC per 1 MB piece.
      if (++seen % 10 === 0) peak = Math.max(peak, liveMb());
    }
    peak = Math.max(peak, liveMb());

    // Exactly one complete file, nothing lost between framing and chunks.
    expect(received).toBe(contentLength);
    expect(received).toBeGreaterThanOrEqual(FILE_SIZE);

    const growthMb = peak - baseline;
    // eslint-disable-next-line no-console
    console.log(
      `[#1295] 100 MB complete live-memory growth: ${growthMb.toFixed(1)} MB ` +
        `(budget ${PEAK_MEMORY_BUDGET_MB} MB, gc forced: ${hasGc})`,
    );
    expect(growthMb).toBeLessThan(
      hasGc ? PEAK_MEMORY_BUDGET_MB : NO_GC_SMOKE_BOUND_MB,
    );

    await cleanupSession(sessionId);
  }, 120_000);
});
