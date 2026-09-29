<!-- Branch: issue/1295 -->
<!-- Title: fix(ipfs): stream /complete assembly to Pinata instead of buffering it -->

## Summary

`POST /api/ipfs/upload/complete` no longer concatenates a session's chunks into
one in-memory `Buffer`. It now streams chunk-by-chunk from the SQLite chunk
store through a lazily-built multipart body straight to Pinata
(`fetch(..., { body: stream, duplex: 'half' })`), computes the SHA-256 digest
on the fly, and verifies the gateway response by streaming it through the same
hash. Peak memory for a 100 MB `/complete` drops from an estimated 300–400 MB
to **~1–3 MB** (one 1 MB chunk + multipart framing at a time), well under the
64 MB budget the issue sets.

## Type

`fix`

## Scope

Backend only — Next.js route handler, `lib/` stores/helpers, tests, and one
design doc. No contract changes, no client (`hooks/`, `components/`) changes,
no public API/response-shape changes.

## Problem

`assembleFile()` built the whole file in memory and the route then made several
more full-size copies of it:

| Step                                                     | Allocation                                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `assembleFile()` → `Buffer.concat`                       | 100 MB                                                                                    |
| route → `new Uint8Array(buffer)` / `File` for `FormData` | another ~100 MB (possibly more, depending on the `File` implementation)                   |
| `verifyUploadedContent(cid, buffer)`                     | +100 MB for the re-downloaded gateway bytes, with `buffer` still alive for the comparison |

Pinata's `pinFileToIPFS` takes one complete file in a single multipart POST —
it has no chunked/resumable API — so the fix cannot remove the single-file
requirement; it can only stop materialising the file in this process.

## Solution

### `lib/streamingMultipart.ts` (new)

| Export                                                                        | Purpose                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `buildStreamingMultipartBody(boundary, filename, fileType, fileSize, chunks)` | Returns `{ stream: Readable, contentLength, contentType }`. The body is built lazily: preamble → each chunk in order → closing boundary. `chunks()` is only invoked on the first `read()`, so validation gates can still reject before any byte flows. |
| `streamFileBytes(chunks)`                                                     | Yields raw file bytes with no framing (used by tests and the Pinata test double).                                                                                                                                                                      |

`contentLength` is exact (`preamble + fileSize + epilogue`), so the request can
carry a correct `Content-Length` even though the body is a stream.

### `lib/chunkedUploadChunkStore.ts`

| Addition                                | Behaviour                                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `readChunk(sessionId, chunkIndex)`      | One chunk's bytes, or `null` when absent.                                                                      |
| `iterateChunks(sessionId, totalChunks)` | Generator yielding chunks in index order; throws on the first missing index. Peak residency is a single chunk. |

`readAllInOrder()` (the old `Buffer.concat` path) is untouched — it still backs
`assembleFile()`.

### `lib/chunkedUploadStore.ts`

`prepareStreamedAssembly(sessionId)` replaces `assembleFile()` on the route's
serve path. It:

1. Validates the session exists and that every index is present (same
   `incomplete` error as before).
2. Asserts the SQLite byte aggregate equals the declared `fileSize` (the
   issue-#1294 invariant). A mismatch throws `SizeMismatchError` after
   deleting both the chunk bytes and the metadata, so a poisoned session
   can't be retried into another giant-buffering attempt.
3. In a single pass over `iterateChunks()`, feeds a
   `crypto.createHash('sha256')` and keeps only the first 12 bytes for the
   magic-byte gate.

It returns `{ filename, fileType, totalBytes, sha256, header, chunks }`.
`assembleFile()` is kept as the buffered reference implementation that the
issue-#1294 size-mismatch tests assert against; no route calls it any more.

### `lib/uploadVerification.ts`

| Addition                                                        | Behaviour                                                                                                                                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sha256HexOfStream(stream)`                                     | Incremental SHA-256 over an async byte stream — nothing is retained after it is hashed.                                                                                     |
| `verifyUploadedDigest(cid, expectedDigest, fetchGatewayBytes?)` | Digest-based counterpart of `verifyUploadedContent()`; throws the same `UploadVerificationError`s so callers treat mismatches and unreachable-gateway failures identically. |
| `fetchGatewayStream(cid)`                                       | Streams the gateway response via `res.body` under the existing `VERIFY_TIMEOUT_MS` abort, wrapped into an async iterable.                                                   |

`verifyUploadedContent()` itself is **unchanged**, so the single-shot
`app/api/ipfs/upload/route.ts` keeps its exact previous behaviour — the
"keep behaviour identical for the single-shot route" option from the issue.

### `app/api/ipfs/upload/complete/route.ts`

Pipeline: `prepareStreamedAssembly()` → MIME prefix check → magic-byte gate on
the streamed header → `pinStreamedFileToIPFS()` → `verifyUploadedDigest()` →
`cleanupSession()`.

- `pinStreamedFileToIPFS()` sends the stream with global `fetch` and
  `duplex: 'half'`; the previous `axios` + `FormData` path would have buffered
  the whole body before sending. Pinata URL and auth headers are unchanged.
- Session-cleanup semantics are unchanged: cleanup only after success (or on a
  400-class validation failure); a Pinata or verification failure still
  preserves the session so a retry skips re-uploading chunks (covered by the
  existing 502 tests).
- `__pinStreamedFileToIPFSForTests` / `__gatewayStreamForTests` remain the test
  seams, now operating on streams.

## Files changed

```
 __tests__/api/ipfs/upload/complete.test.ts          |  85 ++++++-----
 __tests__/api/ipfs/upload/streamingComplete.test.ts | 134 ++++++++++++++++
 __tests__/api/ipfs/upload/streamingMemory.test.ts   | 108 ++++++++++++++
 app/api/ipfs/upload/complete/route.ts               | 151 +++++++++---------
 docs/chunked-video-upload.md                        |  25 +++-
 lib/chunkedUploadChunkStore.ts                      |  36 +++++
 lib/chunkedUploadStore.ts                           | 100 +++++++++++
 lib/streamingMultipart.ts                           |  75 ++++++++
 lib/uploadVerification.ts                           | 113 +++++++++++
 package.json                                        |   1 +
 10 files changed, 752 insertions(+), 76 deletions(-)
```

## Acceptance criteria

| Criterion                                                                                | Evidence                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Peak memory for a 100 MB complete is under 64 MB, measured in a test or benchmark script | `__tests__/api/ipfs/upload/streamingMemory.test.ts` seeds a real 100 MB / 100-chunk session into the SQLite chunk store, then samples live memory (`heapUsed + external`, GC forced) while `prepareStreamedAssembly()` hashes and the multipart stream is drained. Measured **1.4–3.4 MB** growth. Run via `npm run test:memory`.              |
| Pinata still receives exactly one complete file                                          | `complete.test.ts` drains the bytes the route actually streams to Pinata and asserts they equal the uploaded file byte-for-byte (one part, whole file). `streamingComplete.test.ts` asserts the multipart body has exactly one `filename="…"` part, chunks in index order, ends with the closing boundary, and totals exactly `contentLength`. |
| Integrity verification still detects a corrupted gateway response                        | Existing `post-upload integrity verification (issue #699)` tests kept and adapted to `__gatewayStreamForTests` (mismatched bytes → 502 + session preserved). `streamingComplete.test.ts` additionally covers digest equality, mismatch, and gateway failure.                                                                                   |
| Magic-byte and MIME validation still run before any bytes are pinned                     | Both gates run against `assembly.header`/`fileType` before `pinStreamedFileToIPFS()`, and `buildStreamingMultipartBody()` only calls `chunks()` on first read. `streamingComplete.test.ts` asserts a spoofed header returns 400 with the Pinata override never invoked.                                                                        |

## Validation

| Check                               | Command                                                                                                                                                                                                                | Result                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Chunked-upload + store suites       | `jest __tests__/api/ipfs/upload __tests__/lib/chunkedUploadStore.test.ts __tests__/lib/chunkedUploadStore.redis.test.ts __tests__/lib/uploadVerification.test.ts --maxWorkers=2`                                       | ✅ 11 suites, 74 tests passed                                                                            |
| Adjacent consumers (no regressions) | `jest __tests__/lib/offChainDataCollection.test.ts __tests__/lib/uploadVerification.test.ts __tests__/api/ipfs/upload/route.test.ts __tests__/api/data-export/route.test.ts __tests__/api/data-deletion/route.test.ts` | ✅ 5 suites, 24 tests passed                                                                             |
| Memory benchmark                    | `npm run test:memory` (`NODE_OPTIONS=--expose-gc`)                                                                                                                                                                     | ✅ 1 suite, 1 test; 1.4–3.4 MB growth vs the 64 MB budget                                                |
| Body-file contract                  | `node scripts/validate-pr-bodies.js`                                                                                                                                                                                   | ✅ all body files pass                                                                                   |
| Type check                          | `tsc --noEmit`                                                                                                                                                                                                         | ✅ 0 errors in touched files (43 repo-wide errors are pre-existing — verified identical count on `main`) |
| Lint                                | `npm run lint` (`next lint`)                                                                                                                                                                                           | ✅ exit 0, 0 errors (pre-existing warnings only)                                                         |
| Format                              | `prettier --check` on all 10 changed files                                                                                                                                                                             | ✅ all files clean                                                                                       |
| Env validation                      | `node scripts/validate-env.js`                                                                                                                                                                                         | ✅ exit 0 (dev hints only)                                                                               |

## Testing

```bash
# Targeted suites (chunked upload routes + chunk/metadata stores + verification)
./node_modules/.bin/jest __tests__/api/ipfs/upload \
  __tests__/lib/chunkedUploadStore.test.ts \
  __tests__/lib/chunkedUploadStore.redis.test.ts \
  __tests__/lib/uploadVerification.test.ts \
  --maxWorkers=2 --workerIdleMemoryLimit=512MB

# 100 MB / <64 MB memory benchmark (needs NODE_OPTIONS=--expose-gc)
npm run test:memory

# Adjacent consumers of the changed modules
./node_modules/.bin/jest __tests__/lib/offChainDataCollection.test.ts \
  __tests__/api/ipfs/upload/route.test.ts \
  __tests__/api/data-export/route.test.ts \
  __tests__/api/data-deletion/route.test.ts

npm run lint
node scripts/validate-env.js
node scripts/validate-pr-bodies.js
```

`package.json` gains one script: `test:memory` →
`cross-env NODE_OPTIONS=--expose-gc jest __tests__/api/ipfs/upload/streamingMemory.test.ts --runInBand`.

New tests in `streamingComplete.test.ts`: multipart framing/ordering/length,
digest verification (match, mismatch, unreachable gateway), streamed-vs-buffered
SHA-256 equality, and the magic-byte gate running before Pinata is called.
New test in `streamingMemory.test.ts`: the 100 MB budget check.

## Notes for reviewers

- **Behaviour is identical for the single-shot route.** `lib/uploadVerification.ts`'s
  `verifyUploadedContent()` and `app/api/ipfs/upload/route.ts` were not changed, so
  the whole-file endpoint keeps its buffered path. Only `/complete` streams.
- **`assembleFile()` is intentionally still present.** It is the buffered
  reference path the issue-#1294 tests (`__tests__/api/ipfs/upload/chunkSizeLimits.test.ts`,
  `__tests__/lib/chunkedUploadStore.test.ts`) assert against: that a size
  mismatch throws and cleans the session up. Removing it would drop that
  coverage; it is dead code on every route.
- **Measuring the benchmark.** Under a plain `npm test` there is no way to force
  GC, so retained garbage inflates the number (≈75–88 MB observed) even though
  nothing close to the file is live; the test then falls back to a looser
  256 MB smoke bound that a real full-file concat would still fail.
  `npm run test:memory` sets `NODE_OPTIONS=--expose-gc` so the harness measures
  the live set and enforces the issue's 64 MB budget.
- **Residency is bounded by one chunk, not by chunk count**, because
  `iterateChunks()` yields from a prepared `better-sqlite3` statement and each
  buffer is released before the next `read()`.
- **`Content-Length` is computed, not measured** (`preamble + fileSize + epilogue`),
  so an inconsistent session would surface as a truncated/over-long body at
  Pinata rather than a hang. `prepareStreamedAssembly()`'s size assertion runs
  first, so the declared `fileSize` is verified against stored bytes before the
  body is built.

## Out of scope / follow-ups

- The chunk store still lives in SQLite (issue #1175's documented
  shared-volume gap). Streaming the read path does not change where the bytes
  live; moving them to object storage remains a separate issue.
- Verification still re-downloads the pinned file from the gateway to confirm
  retrievability (issue #699's deliberate design). It is now constant-memory,
  but not zero-cost in bandwidth.
- `docs/chunked-video-upload.md` was updated; `docs/pr-bodies/README.md`'s Files
  table gains a row for this body file.

## PR Body Source

- Body file: `docs/pr-bodies/issue-1295.md`
- Branch naming: this directory's convention maps the first dash in the
  filename to a slash, so the file follows `issue-1295.md` ⇔ `issue/1295` and
  carries `<!-- Branch: issue/1295 -->` to satisfy
  `scripts/validate-pr-bodies.js`. The branch staged in this workspace is named
  `issue-1295` (no slash), so open the PR with `--head <fork>:issue-1295` — or
  rename/push it as `issue/1295` — rather than copy/pasting `issue/1295`.

```bash
title=$(sed -n 's/<!-- Title: \(.*\) -->/\1/p' \
    docs/pr-bodies/issue-1295.md | head -n1)

gh pr create \
  --repo scout-off/scout-off-frontend \
  --base main \
  --head <your-fork>:issue-1295 \
  --title "$title" \
  --body-file docs/pr-bodies/issue-1295.md
```
