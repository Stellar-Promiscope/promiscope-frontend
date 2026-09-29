'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  uploadToIPFSChunked,
  getChunkedUploadStatus,
  ChunkedUploadError,
  type ChunkedUploadPhase,
} from '@/lib/ipfs';
import {
  saveResumeState,
  loadResumeState,
  clearResumeState,
  type PersistedUploadState,
} from '@/lib/uploadResumeStore';

export type { PersistedUploadState };

export interface UploadOutcome {
  cid: string | null;
  error: string | null;
}

export interface UseChunkedUploadResult {
  /** Upload progress in [0, 100]. Only meaningful during the 'uploading' phase. */
  progress: number;
  /** 'uploading' (chunks in transit) vs 'processing' (server pinning to IPFS). */
  phase: ChunkedUploadPhase;
  uploading: boolean;
  error: string | null;
  /** Seconds until the rate limit expires, if the error was a 429 response. */
  retryAfterSec: number | null;
  /** True after an interrupted upload that can continue from its last chunk. */
  canResume: boolean;
  /** Starts a fresh chunked upload for `file`. */
  upload: (file: File) => Promise<UploadOutcome>;
  /** Continues the most recently interrupted upload from its last successful chunk. */
  resume: () => Promise<UploadOutcome>;
  /**
   * Persisted session recovered from localStorage on mount.
   * Non-null when a previous upload was interrupted and its metadata survived
   * a page reload (and the server-side 2 hr TTL has not yet elapsed).
   * Cleared automatically once `promptResume` completes (success or failure)
   * or when `clearResumeState` is called explicitly.
   */
  persistedSession: PersistedUploadState | null;
  /**
   * Validates that `file` matches the persisted session (name + size), checks
   * whether the server-side session still exists, then resumes from the last
   * successfully received chunk.
   *
   * Returns `{ cid: null, error: '...' }` when:
   * - There is no persisted session to resume.
   * - The provided file does not match the stored session (by name AND size).
   * - The server-side session has already expired (404 from /status).
   *
   * On mismatch the persisted state is cleared so a fresh upload can begin.
   */
  promptResume: (file: File) => Promise<UploadOutcome>;
}

/**
 * Drives lib/ipfs.ts's chunked/resumable upload for a single file, exposing
 * progress and a resume affordance for VideoUpload (issue #664 — chunked
 * uploads on unreliable mobile connections, paired with the
 * upload-progress-indicator issue this fulfils).
 *
 * `upload`/`resume` resolve with the outcome directly (`{ cid, error }`)
 * rather than requiring callers to read the hook's `error` state right
 * after awaiting — reading component-scope state immediately after an
 * await risks a stale closure from before the state update landed. The
 * `error`/`canResume` state is still exposed for rendering (e.g. showing a
 * persistent "Resume upload" button after the call site's own logic runs).
 *
 * Issue #1003: `persistedSession` and `promptResume` extend the hook with
 * cross-reload resume capability. Session metadata (sessionId, filename,
 * fileSize, fileType, totalChunks) is saved to localStorage when an upload
 * is interrupted and cleared on success or expiry. The File object itself
 * cannot be serialized — the caller must re-supply the file when resuming.
 */
export function useChunkedUpload(): UseChunkedUploadResult {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<ChunkedUploadPhase>('uploading');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfterSec, setRetryAfterSec] = useState<number | null>(null);
  const [canResume, setCanResume] = useState(false);
  const [persistedSession, setPersistedSession] =
    useState<PersistedUploadState | null>(null);

  const resumeStateRef = useRef<{ file: File; sessionId: string } | null>(null);

  // On mount: restore any persisted session from localStorage. loadResumeState
  // already handles TTL expiry and clears stale entries automatically.
  useEffect(() => {
    const stored = loadResumeState();
    setPersistedSession(stored);
  }, []);

  const runUpload = useCallback(
    async (file: File, resumeSessionId?: string): Promise<UploadOutcome> => {
      setUploading(true);
      setError(null);
      setRetryAfterSec(null);

      try {
        const cid = await uploadToIPFSChunked(file, {
          resumeSessionId,
          onProgress: (fraction) => setProgress(Math.round(fraction * 100)),
          onPhaseChange: setPhase,
        });
        resumeStateRef.current = null;
        setCanResume(false);
        setProgress(100);
        // Successful completion — clear the persisted session so a fresh
        // upload is not mistakenly offered as resumable after the next reload.
        clearResumeState();
        setPersistedSession(null);
        return { cid, error: null };
      } catch (err) {
        if (err instanceof ChunkedUploadError) {
          resumeStateRef.current = { file, sessionId: err.sessionId };
          setCanResume(true);
          setRetryAfterSec(err.retryAfterSec ?? null);
          // Persist resumable session metadata to localStorage so the user
          // can continue after a page reload (issue #1003).
          const state: PersistedUploadState = {
            sessionId: err.sessionId,
            filename: file.name,
            fileSize: file.size,
            fileType: file.type,
            totalChunks: err.totalChunks,
            savedAt: Date.now(),
          };
          saveResumeState(state);
          setPersistedSession(state);
        } else {
          resumeStateRef.current = null;
          setCanResume(false);
          setRetryAfterSec(null);
        }
        const message =
          (err as { response?: { status?: number } })?.response?.status === 503
            ? 'Video uploads are temporarily unavailable. Please try again later.'
            : err instanceof Error
              ? err.message
              : 'Upload failed. Please try again.';
        setError(message);
        return { cid: null, error: message };
      } finally {
        setUploading(false);
      }
    },
    [],
  );

  const upload = useCallback(
    (file: File) => {
      resumeStateRef.current = null;
      setCanResume(false);
      setProgress(0);
      return runUpload(file);
    },
    [runUpload],
  );

  const resume = useCallback(() => {
    const state = resumeStateRef.current;
    if (!state) return Promise.resolve({ cid: null, error: null });
    return runUpload(state.file, state.sessionId);
  }, [runUpload]);

  /**
   * Cross-reload resume: validates the supplied file against the persisted
   * session, confirms the server-side session still exists, then resumes.
   *
   * Validation is intentionally strict (name AND size) — a file with the
   * same name but a different byte-count is almost certainly a different
   * recording, and sending mismatched chunks would corrupt the assembly.
   */
  const promptResume = useCallback(
    async (file: File): Promise<UploadOutcome> => {
      const stored = loadResumeState();
      if (!stored) {
        return {
          cid: null,
          error: 'No interrupted upload session found.',
        };
      }

      // Validate that the re-supplied file matches the original session.
      if (file.name !== stored.filename || file.size !== stored.fileSize) {
        clearResumeState();
        setPersistedSession(null);
        return {
          cid: null,
          error:
            'Selected file does not match the interrupted upload. Starting fresh.',
        };
      }

      // Confirm the server-side session still exists before attempting to
      // resume — avoids a confusing error mid-stream if the session expired
      // between page reload and the user clicking "Resume".
      try {
        await getChunkedUploadStatus(stored.sessionId);
      } catch {
        // 404 or network error — the server-side session is gone.
        clearResumeState();
        setPersistedSession(null);
        return {
          cid: null,
          error: 'The upload session has expired. Please start a new upload.',
        };
      }

      // Session validated — wire up the in-memory ref so resume() also works,
      // then run the upload against the persisted sessionId.
      resumeStateRef.current = { file, sessionId: stored.sessionId };
      setCanResume(true);
      return runUpload(file, stored.sessionId);
    },
    [runUpload],
  );

  return {
    progress,
    phase,
    uploading,
    error,
    retryAfterSec,
    canResume,
    upload,
    resume,
    persistedSession,
    promptResume,
  };
}
