'use client';

import { useState, useRef } from 'react';
import { uploadToIPFS } from '@/lib/ipfs';
import type { AddEvidenceParams } from '@/lib/disputesClient';

const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'application/pdf',
];
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

interface Props {
  /** Called after the file has been uploaded to IPFS and params are ready. */
  onSubmit: (params: AddEvidenceParams) => Promise<void>;
  /** Label shown on the submit button (e.g. "Submit response", "Add evidence"). */
  submitLabel?: string;
  /** Whether this form is for a validator response (shows extra context). */
  isValidatorResponse?: boolean;
  disabled?: boolean;
}

/**
 * Shared evidence-attachment form used by both the player (adding supporting
 * evidence) and the validator (submitting their response) in a dispute thread.
 *
 * Flow:
 *   1. User selects a file. Client validates MIME + size.
 *   2. File is uploaded to IPFS via /api/ipfs/upload (same path as profile uploads).
 *   3. The resulting CID, MIME type, and optional text note are passed to `onSubmit`.
 */
export default function DisputeEvidenceForm({
  onSubmit,
  submitLabel = 'Submit evidence',
  isValidatorResponse = false,
  disabled = false,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    setSubmitError(null);
    const chosen = e.target.files?.[0] ?? null;
    if (!chosen) {
      setFile(null);
      return;
    }
    if (!ALLOWED_TYPES.includes(chosen.type)) {
      setFileError(
        'Unsupported file type. Allowed: JPEG, PNG, WebP, GIF, MP4, WebM, PDF.',
      );
      setFile(null);
      return;
    }
    if (chosen.size > MAX_FILE_BYTES) {
      setFileError('File must be under 50 MB.');
      setFile(null);
      return;
    }
    setFile(chosen);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setSubmitError(null);
    try {
      const cid = await uploadToIPFS(file);
      await onSubmit({
        ipfsHash: cid,
        ipfsMimeType: file.type,
        body: note.trim() || undefined,
      });
      setFile(null);
      setNote('');
      setSubmitted(true);
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Submission failed. Try again.',
      );
    } finally {
      setUploading(false);
    }
  }

  if (submitted) {
    return (
      <div
        role="status"
        className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-400"
      >
        ✓ Evidence submitted. The admin will review the updated timeline.
        <button
          type="button"
          className="ml-3 underline text-green-300 hover:text-green-200"
          onClick={() => setSubmitted(false)}
        >
          Add more
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-gray-700 bg-gray-900/60 p-4"
    >
      {isValidatorResponse && (
        <p className="text-xs text-amber-400/80">
          You are responding as the validator who approved this milestone. Your
          response will be visible to the player and the reviewing admin.
        </p>
      )}

      {/* File picker */}
      <div>
        <label
          htmlFor="evidence-file"
          className="mb-1 block text-xs font-medium text-gray-400"
        >
          Evidence file <span className="text-gray-500">(required)</span>
        </label>
        <input
          ref={inputRef}
          id="evidence-file"
          type="file"
          accept={ALLOWED_TYPES.join(',')}
          onChange={handleFileChange}
          disabled={uploading || disabled}
          className="block w-full text-sm text-gray-300 file:mr-3 file:rounded-lg
            file:border-0 file:bg-gray-800 file:px-3 file:py-1.5 file:text-xs
            file:font-medium file:text-gray-300 hover:file:bg-gray-700
            disabled:opacity-50"
        />
        {fileError && (
          <p role="alert" className="mt-1 text-xs text-red-400">
            {fileError}
          </p>
        )}
        {file && !fileError && (
          <p className="mt-1 text-xs text-gray-500">
            {file.name} ({(file.size / 1024).toFixed(1)} KB)
          </p>
        )}
        <p className="mt-1 text-xs text-gray-600">
          JPEG, PNG, WebP, GIF, MP4, WebM, PDF — max 50 MB
        </p>
      </div>

      {/* Optional note */}
      <div>
        <label
          htmlFor="evidence-note"
          className="mb-1 block text-xs font-medium text-gray-400"
        >
          Note{' '}
          <span className="text-gray-500">
            (optional, max {isValidatorResponse ? 'your response' : 'context'})
          </span>
        </label>
        <textarea
          id="evidence-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder={
            isValidatorResponse
              ? 'Explain your reasoning for the milestone approval…'
              : 'Add context about this evidence…'
          }
          disabled={uploading || disabled}
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2
            text-sm text-white placeholder-gray-500 focus:border-brand-green
            focus:outline-none disabled:opacity-50"
        />
        <p className="mt-0.5 text-right text-xs text-gray-600">
          {note.length}/2000
        </p>
      </div>

      {submitError && (
        <p role="alert" className="text-xs text-red-400">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={!file || uploading || disabled}
        className="self-start rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold
          text-black transition hover:bg-brand-green/80 disabled:cursor-not-allowed
          disabled:opacity-50"
      >
        {uploading ? 'Uploading…' : submitLabel}
      </button>
    </form>
  );
}
