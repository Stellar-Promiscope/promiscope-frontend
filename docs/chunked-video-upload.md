# Chunked/resumable video upload: design

Design notes for issue #664 — resumable, chunked highlight-reel uploads,
implemented in `lib/chunkedUploadStore.ts`, `app/api/ipfs/upload/{init,chunk,status,complete}`,
`lib/ipfs.ts`'s `uploadToIPFSChunked`, `hooks/useChunkedUpload.ts`, and
`components/ui/VideoUpload.tsx`.

## Problem

`VideoUpload` uploaded a player's highlight-reel video as one request via
`uploadToIPFS`/`app/api/ipfs/upload`. A dropped connection partway through a
multi-megabyte upload meant starting completely over — a poor fit for the
low-bandwidth, high-latency mobile connections this product targets, and
there was no upload progress indicator at all.

## Design

**Chunking is a browser <-> this Next.js app concern only.** Pinata's
`pinFileToIPFS` endpoint (the only Pinata API this codebase integrates)
takes a complete file in one multipart POST — it has no chunked/resumable
upload API of its own. So the flow is:

```
Browser                          Next.js app                      Pinata
  │  POST /api/ipfs/upload/init      │                               │
  ├──────────────────────────────────▶  creates a session, returns   │
  │  ◀── { sessionId } ───────────────  sessionId                    │
  │                                   │                               │
  │  POST /api/ipfs/upload/chunk      │                               │
  │  (sessionId, chunkIndex, chunk)   │  writes chunk to a temp file  │
  ├──────────────────────────────────▶  keyed by sessionId+index      │
  │  ◀── repeat per chunk ─────────────                               │
  │                                   │                               │
  │  POST /api/ipfs/upload/complete   │  streams all chunks,          │
  ├──────────────────────────────────▶  validates (MIME + magic       │
  │                                   │  bytes), then makes ONE        │
  │                                   │  pinFileToIPFS call ──────────▶
  │  ◀── { cid } ──────────────────────  forwards Pinata's response   │
```

- **Chunk size**: 1 MB (`CHUNK_SIZE_BYTES` in `lib/ipfs.ts`) — small enough
  that a single chunk completes (or fails) quickly on a weak connection,
  without multiplying request overhead the way much smaller chunks would.
- **Per-chunk retry**: each chunk gets up to 4 retries with exponential
  backoff (500ms, 1s, 2s, 4s) before the whole upload gives up — handles the
  common case of a brief connection blip without surfacing anything to the
  user.
- **Resumability**: if a chunk still fails after exhausting retries,
  `uploadToIPFSChunked` throws a `ChunkedUploadError` carrying the
  `sessionId` and how many chunks succeeded. `useChunkedUpload` catches
  this, keeps the `File` handle and `sessionId` in a ref, and exposes
  `resume()` — calling it hits `GET /api/ipfs/upload/status` to see which
  chunks the server already has, then uploads only what's missing.
  `VideoUpload` surfaces this as a "Resume upload" link next to the error.
- **Validation stays where it can actually run**: MIME-prefix and
  size-limit checks happen at `/init` (before any bandwidth is spent on
  chunks); the magic-byte signature check is deferred to `/complete`, since
  the file's signature only lives in the first chunk's leading bytes, not
  in every chunk. Both checks are the same logic `app/api/ipfs/upload`
  already used (extracted to `lib/fileSignature.ts` so it isn't duplicated).
  Client-side `validateFile` in `VideoUpload.tsx` is unchanged.
- **`/complete` assembles by streaming, not concatenating (issues #1294,
  #1295)**: the old `assembleFile()` path did `Buffer.concat` over every
  chunk and then made further full-size copies (`Uint8Array`, `File`, plus a
  second copy from the gateway re-download during verification) — ~300-400 MB
  peak RSS for a 100 MB upload, so a few concurrent completes could OOM a
  1 GB serverless function. `/complete` now uses
  `prepareStreamedAssembly()` in `lib/chunkedUploadStore.ts`: it validates
  the session, asserts the SQLite byte aggregate equals the declared
  `fileSize` (issue #1294 — a client used to be able to declare 1 MB and
  stream gigabytes into the chunk store), and computes the sha256 plus the
  leading 12 bytes for the magic-byte gate in a single pass that reads one
  chunk at a time. It then hands `lib/streamingMultipart.ts` a generator
  yielding one chunk at a time, which builds the `pinFileToIPFS` multipart
  body lazily and sends it with `fetch(..., { body: stream, duplex: 'half' })`,
  so Pinata still receives exactly one complete file. Integrity verification
  streams the gateway response through the same hash
  (`verifyUploadedDigest`) instead of buffering it. Peak residency is one
  chunk (~1 MB). `assembleFile()` is retained as the buffered reference path
  that the issue-#1294 size-mismatch tests assert against; no route calls it.
  Memory is measured by `__tests__/api/ipfs/upload/streamingMemory.test.ts`,
  run with `npm run test:memory`, which seeds a real 100 MB / 100-chunk
  session and asserts live-memory growth stays under the issue's 64 MB
  budget (currently ~3 MB).
- **Chunk-store persistence (fixed in issue #1175)**: `lib/chunkedUploadStore.ts`
  used to keep an in-memory session map and write each chunk to a given
  instance's own `os.tmpdir()` — correct only for a single, long-running
  Node process, not a stateless multi-instance/serverless deployment. It now
  splits into two shared-storage pieces, mirroring `lib/rateLimit.ts`'s
  Redis-with-in-memory-fallback pattern for the metadata half:
  - **Session metadata** (which chunks a session has received, its expiry)
    is backed by Upstash Redis when `UPSTASH_REDIS_REST_URL` /
    `UPSTASH_REDIS_REST_TOKEN` are configured, with an in-memory,
    single-instance-only fallback when they're not — same tradeoff
    `lib/rateLimit.ts` documents for its own counter.
  - **Chunk bytes** are larger binary payloads than a Redis counter, so
    they go to `lib/chunkedUploadChunkStore.ts` — a `better-sqlite3` table
    with a `BLOB` column, following this repo's existing SQLite-store
    convention (`lib/sqliteDb.ts`). This requires the SQLite database file
    itself to live on storage reachable from every instance (a shared
    volume) — see `CHUNKED_UPLOAD_DB_PATH` in `.env.example`. On a
    stateless serverless deployment with no shared volume at all, this
    would need to move to object storage instead; that's an explicit,
    documented gap, not a silent one.
    Either way, `GET /api/ipfs/upload/status` and a chunk landing on any
    instance now answer correctly regardless of which instance received an
    earlier chunk in the same session.
- **Rate limiting**: `/init` and `/complete` share the whole-file route's
  scale (20/min); `/chunk` gets a much higher ceiling (600/min) since one
  legitimate upload issues many small chunk requests — sized generously
  above what even a large file at the 1 MB chunk size would need in a
  minute.
- **The whole-file `/api/ipfs/upload` route is untouched** and still used
  for direct single-shot uploads; chunking is additive, not a replacement.
- **Uploading vs. processing phases** (issue #688): `/complete`'s
  concatenate-validate-pin step is a single request with no chunk-level
  progress of its own, so surfacing it as "Uploading... 100%" would look
  stuck. `uploadToIPFSChunked` reports an `onPhaseChange('processing')`
  transition right before calling `/complete`; `useChunkedUpload` exposes it
  as `phase`, and `VideoUpload` swaps the percentage label for an
  indeterminate "Processing…" state so the two phases read distinctly.

## What this doesn't do

- No persistence across a full page reload/tab close. `sessionId` and the
  `File` handle live only in React state for the lifetime of the component
  — resumability covers "the same page session recovers from a dropped
  connection," not "close the tab and come back tomorrow." True
  cross-reload resumability would need persisting `sessionId` plus a way to
  verify a re-selected file is the same one (e.g. a content hash), which
  is a larger feature left as a follow-up if it's actually needed.
- No change to the Pinata integration itself — it's still `pinFileToIPFS`
  with API-key/secret auth, called once per completed upload.
