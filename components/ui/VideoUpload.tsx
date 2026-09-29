'use client';

import { useState, useEffect, useRef, ChangeEvent } from 'react';
import { useChunkedUpload } from '@/hooks/useChunkedUpload';
import { getChunkedUploadStatus } from '@/lib/ipfs';
import Spinner from '@/components/ui/Spinner';

/** Accepted MIME types for client-side validation */
export const ACCEPTED_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'image/jpeg',
  'image/png',
] as const;

/** Accepted file extensions label shown to users */
export const ACCEPTED_TYPES_LABEL = 'MP4, MOV, JPEG, PNG';

/** Maximum file size enforced on the client: 50 MB */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
export const MAX_FILE_SIZE_LABEL = '50 MB';

/**
 * Validate a File against accepted types and size limit.
 * Returns an error string, or null when the file is valid.
 */
export function validateFile(file: File): string | null {
  if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return `File type "${file.type || 'unknown'}" is not supported. Please upload ${ACCEPTED_TYPES_LABEL}.`;
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    return `File is too large (${sizeMB} MB). Maximum size is ${MAX_FILE_SIZE_LABEL}.`;
  }
  return null;
}

interface VideoUploadProps {
  onUpload: (cid: string) => void;
  /** Propagate a validation or upload error from outside (e.g. parent state) */
  error?: string;
  /** Called whenever client-side file validation produces an error (or null to clear) */
  onValidationError?: (error: string | null) => void;
  /**
   * Called the instant a new upload begins (a file has passed client-side
   * validation and is about to start uploading, or a resume is kicked off) —
   * fires *before* `onUpload`. Callers use this to immediately invalidate
   * any previously-accepted CID they're holding in form state, so a
   * still-in-flight replacement upload can never be shadowed by a stale CID
   * from an earlier, already-completed upload (see issue #1184).
   */
  onUploadStart?: () => void;
  /**
   * Mirrors this component's internal "an upload is currently in flight"
   * state to the parent, so a submit/continue button can be disabled for
   * the entire duration of an upload — not just while `onUpload` hasn't
   * fired yet, but from the very first byte.
   */
  onUploadingChange?: (uploading: boolean) => void;
}

export default function VideoUpload({
  onUpload,
  error,
  onValidationError,
  onUploadStart,
  onUploadingChange,
}: VideoUploadProps) {
  const [fileName, setFileName] = useState<string>('');
  const [localError, setLocalError] = useState<string | null>(null);
  const {
    progress,
    phase,
    uploading: isUploading,
    canResume,
    upload,
    resume,
    persistedSession,
    promptResume,
  } = useChunkedUpload();
  const isProcessing = isUploading && phase === 'processing';
  const lastAnnouncedProgressRef = useRef<number | null>(null);
  const [progressAnnouncement, setProgressAnnouncement] = useState('');

  // After a reload, an interrupted upload persisted by useChunkedUpload can be
  // resumed by re-selecting the same file (see #1003). Show how far it got.
  const [resumedChunks, setResumedChunks] = useState<number | null>(null);
  const persistedSessionId = persistedSession?.sessionId;
  useEffect(() => {
    setResumedChunks(null);
    if (!persistedSessionId) return;
    let cancelled = false;
    getChunkedUploadStatus(persistedSessionId)
      .then((status) => {
        if (!cancelled) setResumedChunks(status.receivedChunks.length);
      })
      .catch(() => {
        // Expired or unreachable — promptResume reports it on re-selection.
      });
    return () => {
      cancelled = true;
    };
  }, [persistedSessionId]);

  useEffect(() => {
    onUploadingChange?.(isUploading);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUploading]);

  useEffect(() => {
    if (!isUploading) {
      lastAnnouncedProgressRef.current = null;
      setProgressAnnouncement('');
      return;
    }
    if (isProcessing) {
      setProgressAnnouncement('Processing upload…');
      return;
    }
    const milestone = progress >= 100 ? 100 : Math.floor(progress / 10) * 10;
    if (
      milestone > 0 &&
      milestone !== lastAnnouncedProgressRef.current
    ) {
      lastAnnouncedProgressRef.current = milestone;
      setProgressAnnouncement(`Upload progress: ${milestone} percent.`);
    }
  }, [isUploading, isProcessing, progress]);

  const displayError = error ?? localError;
  const errorId = displayError ? 'video-upload-error' : undefined;

  const handleUploadResult = (
    cid: string | null,
    uploadError: string | null,
  ) => {
    if (cid) {
      setLocalError(null);
      onValidationError?.(null);
      onUpload(cid);
      return;
    }
    const message = uploadError ?? 'Upload failed. Please try again.';
    setLocalError(message);
    onValidationError?.(message);
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // ── Client-side validation ────────────────────────────────────────────────
    const validationError = validateFile(file);
    if (validationError) {
      setLocalError(validationError);
      onValidationError?.(validationError);
      // Reset so the user can pick again
      e.target.value = '';
      return;
    }

    // Clear any previous error
    setLocalError(null);
    onValidationError?.(null);
    setFileName(file.name);
    onUploadStart?.();

    const matchesPersisted =
      persistedSession &&
      !canResume &&
      file.name === persistedSession.filename &&
      file.size === persistedSession.fileSize;
    const outcome = matchesPersisted
      ? await promptResume(file)
      : await upload(file);
    handleUploadResult(outcome.cid, outcome.error);
  };

  const handleResume = async () => {
    onUploadStart?.();
    const outcome = await resume();
    handleUploadResult(outcome.cid, outcome.error);
  };

  return (
    <div className="space-y-1">
      <label
        htmlFor="video-upload-input"
        className="block text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        Highlight Reel
      </label>
      <p
        id="video-upload-hint"
        className="text-xs text-gray-500 dark:text-gray-400"
      >
        Accepted: {ACCEPTED_TYPES_LABEL} · Max {MAX_FILE_SIZE_LABEL}
      </p>
      {persistedSession && !canResume && !isUploading && (
        <p role="status" className="text-xs text-yellow-500">
          Resume upload
          {resumedChunks !== null &&
            ` (${resumedChunks} of ${persistedSession.totalChunks} chunks uploaded)`}
          : select {persistedSession.filename} again to continue.
        </p>
      )}
      <div className="relative">
        <input
          id="video-upload-input"
          type="file"
          accept={ACCEPTED_MIME_TYPES.join(',')}
          onChange={handleFileChange}
          disabled={isUploading}
          aria-describedby={
            [errorId, 'video-upload-hint'].filter(Boolean).join(' ') ||
            undefined
          }
          aria-invalid={displayError ? true : undefined}
          className={`w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-brand-green transition file:mr-4 file:py-1 file:px-4 file:rounded-lg file:border-0 file:bg-brand-green file:text-black file:font-medium hover:file:opacity-90 disabled:opacity-50 ${
            displayError ? 'border-red-500' : ''
          }`}
        />
        {isUploading && (
          <div className="absolute inset-0 bg-white/80 dark:bg-gray-900/80 flex items-center justify-center rounded-lg">
            <div className="flex items-center gap-2 text-brand-green">
              <Spinner size="sm" />
              <span className="text-sm">
                {isProcessing ? 'Processing…' : `Uploading... ${progress}%`}
              </span>
            </div>
          </div>
        )}
      </div>
      {isUploading && (
        <div
          role="progressbar"
          aria-valuenow={isProcessing ? undefined : progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={isProcessing ? 'Processing upload' : 'Upload progress'}
          className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden"
        >
          <div
            className={`h-full bg-brand-green motion-safe:transition-[width] motion-safe:duration-200 motion-reduce:transition-none ${
              isProcessing ? 'animate-pulse w-full' : ''
            }`}
            style={isProcessing ? undefined : { width: `${progress}%` }}
          />
        </div>
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {progressAnnouncement}
      </div>
      {displayError && (
        <p id={errorId} role="alert" className="text-sm text-red-500">
          {displayError}
        </p>
      )}
      {displayError && canResume && !isUploading && (
        <button
          type="button"
          onClick={handleResume}
          className="text-sm text-brand-green hover:opacity-80 transition underline"
        >
          Resume upload
        </button>
      )}
      {fileName && !isUploading && !displayError && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Uploaded: {fileName}
        </p>
      )}
    </div>
  );
}
