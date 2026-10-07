<!-- Branch: fix/1003-upload-resume-persistence -->
<!-- Title: fix(#1003): persist chunked upload resume state across page reloads -->

## Summary

Persist resumable upload session metadata in `localStorage` so a page reload or accidental navigation does not lose the user’s in-flight chunked upload state. The upload hook can resume the existing session when the server still has the data and the stored metadata matches the file being re-selected.

## Problem

Resumable chunked-upload state was stored only in a React `useRef` inside
`hooks/useChunkedUpload.ts`. A `useRef` value is cleared whenever the
component unmounts — including on page reloads — so any upload that was
interrupted (network drop, accidental navigation, browser crash) could not
be resumed after the user returned to the page.

The server-side `lib/chunkedUploadStore.ts` keeps sessions alive for **2
hours** after creation, meaning the bytes already uploaded were preserved on
the server, but the client had no way to learn that a resumable session
existed.

`File` objects cannot be serialized to `localStorage`, but the metadata
needed to resume — `sessionId`, `filename`, `fileSize`, `fileType`,
`totalChunks` — can be.

## Solution

### `lib/uploadResumeStore.ts` (new)

A thin `localStorage` wrapper with a TTL guard matching the server's 2-hour
session lifetime:

| Export                   | Purpose                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `UPLOAD_RESUME_KEY`      | `'promiscope:upload-resume'` — single storage key                                     |
| `SESSION_TTL_MS`         | `2 * 60 * 60 * 1000` — mirrors `chunkedUploadStore.ts`                               |
| `PersistedUploadState`   | Interface: `sessionId`, `filename`, `fileSize`, `fileType`, `totalChunks`, `savedAt` |
| `saveResumeState(state)` | Writes a `PersistedUploadState` to `localStorage`                                    |
| `loadResumeState()`      | Reads + TTL-checks; auto-clears and returns `null` when expired                      |
| `clearResumeState()`     | Removes the stored entry                                                             |

All three functions guard against SSR (`typeof window === 'undefined'`) and
swallow `localStorage` errors (quota exceeded, blocked in private browsing)
so the upload still works on every environment — it just can't be resumed
after a reload in those edge cases.

### `hooks/useChunkedUpload.ts` (updated)

The existing public API (`upload`, `resume`, `canResume`, `error`, `progress`,
`phase`, `uploading`) is **unchanged** — no existing call sites or tests
require modification.

New additions:

| Addition                                         | Behaviour                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `persistedSession: PersistedUploadState \| null` | Populated on mount via `loadResumeState()`. Non-null when a previous upload was interrupted and its session is still within the 2 hr TTL.                                                                                                                                                                                               |
| `promptResume(file)`                             | Validates that the re-supplied `file` matches the stored session (name **and** size), calls `GET /api/ipfs/upload/status` to confirm the server-side session still exists, then resumes from the last received chunk. Returns `{ cid: null, error }` on mismatch or expiry — with the stored state cleared so a fresh upload can begin. |

Additional lifecycle hooks wired into `runUpload`:

- **On `ChunkedUploadError`**: calls `saveResumeState(...)` and updates `persistedSession` state.
- **On successful completion**: calls `clearResumeState()` and sets `persistedSession` to `null`.
- **On mount**: `useEffect` runs `loadResumeState()` once; expired sessions are cleared automatically by `loadResumeState`'s TTL check.

### `app/api/ipfs/upload/status/route.ts`

Already existed — `GET /api/ipfs/upload/status?sessionId=...` returns
`{ receivedChunks: number[], totalChunks: number }` or 404 when the session
is unknown/expired. `promptResume` uses this to fail fast and surface a
user-friendly error before attempting to resume a gone session.

## Files changed

| File                                                   | Change                                                                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `lib/uploadResumeStore.ts`                             | **New** — localStorage-backed resume state persistence                                                                 |
| `hooks/useChunkedUpload.ts`                            | **Updated** — `persistedSession` state + `promptResume` function; `saveResumeState`/`clearResumeState` lifecycle calls |
| `app/api/ipfs/upload/status/route.ts`                  | No change (already complete)                                                                                           |
| `docs/pr-bodies/fix-1003-upload-resume-persistence.md` | **New** — this document                                                                                                |

## Validation

| Check                                      | Result                                  |
| ------------------------------------------ | --------------------------------------- |
| `node scripts/validate-pr-bodies.js`       | ✅ contract passes on this body file    |
| `__tests__/hooks/useChunkedUpload.test.ts` | ✅ existing API contract remains intact |

## Testing

The existing `__tests__/hooks/useChunkedUpload.test.ts` suite covers the
unchanged public API. New behaviour to cover in follow-up tests:

- `persistedSession` is populated on mount from a mocked `localStorage`.
- `promptResume` returns an error when filename/size mismatch.
- `promptResume` returns an error when the status endpoint returns 404.
- `persistedSession` is cleared after a successful upload.
- `saveResumeState` is called when a `ChunkedUploadError` is thrown.
- `SESSION_TTL_MS` expired entries are auto-cleared on `loadResumeState`.

## Backwards compatibility

- Existing tests: ✅ No changes to `upload`, `resume`, `canResume`, `error`,
  `progress`, `phase`, `uploading`.
- SSR safe: ✅ All `localStorage` access guarded by `typeof window` checks.
- Graceful degradation: ✅ `localStorage` failures are swallowed — upload
  still works without persistence.
- No new dependencies.
