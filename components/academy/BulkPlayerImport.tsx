'use client';

import { useRef, useState, useCallback, ChangeEvent, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useWallet } from '@/hooks/useWallet';
import useIsPaused from '@/hooks/useIsPaused';
import { buildRegisterPlayer } from '@/lib/contract';
import { parseContractError } from '@/lib/contractErrorMessage';
import {
  parseBulkImportFile,
  detectFormat,
  type BulkImportFileError,
  type ParsedRow,
} from '@/lib/bulkImportParser';
import {
  hashFileContent,
  getOrCreateSession,
  getSessionRows,
  updateRowStatus,
  deleteSession,
  cleanupExpiredSessions,
  type BulkImportRowState,
} from '@/lib/bulkImportStore';
import { AFRICAN_REGIONS } from '@/lib/regions';
import { FOOTBALL_POSITIONS } from '@/lib/positions';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import type { PlayerVitals } from '@/types';

// Bulk-imported players are registered without a highlight reel — per-player
// video upload is out of scope for this flow (see PR description). Players
// (or the academy, on their behalf) can add one later via the existing
// single-player profile update flow.
const NO_HIGHLIGHT_REEL_PLACEHOLDER = '';

type Phase = 'upload' | 'preview' | 'submitting' | 'done';

type RowSubmissionStatus =
  | 'pending'
  | 'signing'
  | 'success'
  | 'failed'
  | 'skipped';

/** A parser file error, or a FileReader failure surfaced the same way. */
type FileErrorState =
  | BulkImportFileError
  | { code: 'READ_FAILED'; params?: undefined };

interface RowSubmission {
  status: RowSubmissionStatus;
  txHash?: string | null;
  error?: string | null;
}

function regionLabel(value: string): string {
  return AFRICAN_REGIONS.find((r) => r.value === value)?.label ?? value;
}

function positionLabel(value: string): string {
  return FOOTBALL_POSITIONS.find((p) => p.value === value)?.label ?? value;
}

function explorerUrl(hash: string): string {
  const network =
    process.env.NEXT_PUBLIC_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
  return `https://stellar.expert/explorer/${network}/tx/${hash}`;
}

// ── Per-row status badge ─────────────────────────────────────────────────────

function StatusBadge({
  row,
  phase,
  submission,
}: {
  row: ParsedRow;
  phase: Phase;
  submission?: RowSubmission;
}) {
  const t = useTranslations('academy.bulkImport.status');
  if (!row.isValid) {
    const label =
      phase === 'upload' || phase === 'preview' ? t('invalid') : t('skipped');
    return (
      <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300">
        {label}
      </span>
    );
  }

  if (phase === 'upload' || phase === 'preview' || !submission) {
    return (
      <span className="inline-flex items-center rounded-full border border-brand-green/40 bg-brand-green/10 px-2.5 py-1 text-xs font-medium text-brand-green">
        {t('valid')}
      </span>
    );
  }

  switch (submission.status) {
    case 'pending':
      return (
        <span className="inline-flex items-center rounded-full border border-gray-600 bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-400">
          {t('waiting')}
        </span>
      );
    case 'signing':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-1 text-xs font-medium text-yellow-300">
          <Spinner size="sm" className="text-yellow-300" />
          {t('signing')}
        </span>
      );
    case 'success':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-green/40 bg-brand-green/10 px-2.5 py-1 text-xs font-medium text-brand-green">
          <span aria-hidden="true">✓</span> {t('registered')}
          {submission.txHash && (
            <a
              href={explorerUrl(submission.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:opacity-80"
            >
              {t('viewTx')}
            </a>
          )}
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300">
          <span aria-hidden="true">✕</span> {t('failed')}
        </span>
      );
    default:
      return null;
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BulkPlayerImport() {
  const t = useTranslations('academy.bulkImport');
  const { publicKey, signAndSubmit } = useWallet();
  const isPaused = useIsPaused();
  const tContractStatus = useTranslations('contract_status');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('upload');
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState<FileErrorState | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [submissions, setSubmissions] = useState<Record<number, RowSubmission>>(
    {},
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);

  // ── Pause / cancel controls ────────────────────────────────────────────────
  // Refs are used for the loop's hot path so it always reads the latest value
  // without requiring a re-render or suffering from stale closures.
  const pausedRef = useRef(false);
  const cancelledRef = useRef(false);
  const [isPausedBatch, setIsPausedBatch] = useState(false);

  // ── Resume banner ──────────────────────────────────────────────────────────
  const [resumedSessionInfo, setResumedSessionInfo] = useState<{
    completedRows: number;
    totalRows: number;
  } | null>(null);

  const validRows = rows.filter((r) => r.isValid && r.valid);
  const invalidRows = rows.filter((r) => !r.isValid);

  const succeededCount = Object.values(submissions).filter(
    (s) => s.status === 'success',
  ).length;
  const failedCount = Object.values(submissions).filter(
    (s) => s.status === 'failed',
  ).length;

  // On mount, clean up expired sessions
  useEffect(() => {
    cleanupExpiredSessions().catch(console.error);
  }, []);

  const resetAll = () => {
    setPhase('upload');
    setFileName('');
    setFileError(null);
    setRows([]);
    setSubmissions({});
    setFormError(null);
    setSessionId(null);
    setFileHash(null);
    setIsPausedBatch(false);
    pausedRef.current = false;
    cancelledRef.current = false;
    setResumedSessionInfo(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError(null);
    setFormError(null);

    const reader = new FileReader();
    reader.onload = async () => {
      const text = String(reader.result ?? '');
      const format = detectFormat(file.name, text);
      const result = parseBulkImportFile(text, format);

      if (result.fileError) {
        setFileError(result.fileError);
        setRows([]);
        setPhase('upload');
        return;
      }

      // Compute file hash for resume recognition
      const hash = await hashFileContent(text);
      setFileHash(hash);

      // Check for existing session (resume case)
      const session = await getOrCreateSession(hash, file.name);
      setSessionId(session.sessionId);
      setFileName(file.name);

      // Restore persisted row states
      const persistedRows = await getSessionRows(session.sessionId);
      const submissionsMap: Record<number, RowSubmission> = {};
      let completedCount = 0;
      persistedRows.forEach((rowState, rowNum) => {
        submissionsMap[rowNum] = {
          status: rowState.status as RowSubmissionStatus,
          txHash: rowState.txHash,
          error: rowState.error,
        };
        if (
          rowState.status === 'success' ||
          rowState.status === 'failed' ||
          rowState.status === 'skipped'
        ) {
          completedCount++;
        }
      });

      setRows(result.rows);
      setSubmissions(submissionsMap);
      setPhase('preview');

      // Show resume banner if there are previously completed/failed rows
      const validRowCount = result.rows.filter((r) => r.isValid).length;
      if (completedCount > 0 && validRowCount > 0) {
        setResumedSessionInfo({
          completedRows: completedCount,
          totalRows: validRowCount,
        });
      } else {
        setResumedSessionInfo(null);
      }
    };
    reader.onerror = () => {
      setFileError({ code: 'READ_FAILED' });
    };
    reader.readAsText(file);
  };

  // ── Sequential, one-signature-per-row submission ────────────────────────────
  //
  // This flow uses ONE connected signing wallet to submit N sequential
  // `register_player` transactions — one per valid row. Each transaction
  // requires its own individual wallet approval; there is no batch-signing
  // or auto-approval on-chain. If a row's transaction fails or is rejected,
  // that row is marked failed and the batch continues to the next row rather
  // than aborting, so one bad row (or one rejected prompt) doesn't cost the
  // admin the rest of an otherwise-good batch.
  //
  // The loop respects pause/cancel controls via refs. Pausing waits (polling
  // every 200ms) before the *next* row's signature prompt; in-flight
  // signatures are allowed to finish. Cancelling breaks the loop immediately
  // and records which rows were skipped so they can be retried on resume.
  const handleImport = async () => {
    if (!publicKey) {
      setFormError(t('walletNotConnected'));
      return;
    }
    if (isPaused) {
      setFormError(t('transactionsDisabled'));
      return;
    }
    if (validRows.length === 0) return;

    setFormError(null);
    setPhase('submitting');
    setResumedSessionInfo(null);

    // Reset pause/cancel flags for a fresh run
    pausedRef.current = false;
    cancelledRef.current = false;
    setIsPausedBatch(false);

    const initial: Record<number, RowSubmission> = {};
    for (const r of validRows) {
      // Skip rows that already succeeded
      if (submissions[r.rowNumber]?.status === 'success') {
        initial[r.rowNumber] = submissions[r.rowNumber];
        continue;
      }
      initial[r.rowNumber] = { status: 'pending' };
    }
    setSubmissions(initial);

    for (const r of validRows) {
      // Check for cancellation before starting the next row
      if (cancelledRef.current) break;

      // Wait while paused (poll every 200ms) — in-flight signatures finish
      while (pausedRef.current && !cancelledRef.current) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (cancelledRef.current) break;

      // Skip rows that already succeeded
      if (submissions[r.rowNumber]?.status === 'success') {
        continue;
      }

      const vitals = r.valid as NonNullable<ParsedRow['valid']>;

      setSubmissions((prev) => ({
        ...prev,
        [r.rowNumber]: { status: 'signing' },
      }));

      if (sessionId) {
        await updateRowStatus(sessionId, r.rowNumber, 'signing');
      }

      try {
        const payload: PlayerVitals = {
          name: vitals.name,
          age: vitals.age,
          position: vitals.position,
          region: vitals.region,
          nationality: vitals.nationality,
        };
        const xdr = await buildRegisterPlayer(
          publicKey,
          payload,
          NO_HIGHLIGHT_REEL_PLACEHOLDER,
        );
        // The admin may have hit Cancel while this row's transaction was
        // still being prepared — don't raise a wallet prompt for a row
        // they've already abandoned. The post-loop cancel handler resets
        // this row's "signing" state back to pending.
        if (cancelledRef.current) break;
        const result = await signAndSubmit(xdr);
        const hash =
          typeof result === 'string' ? result : ((result as any)?.hash ?? null);

        setSubmissions((prev) => ({
          ...prev,
          [r.rowNumber]: { status: 'success', txHash: hash },
        }));

        if (sessionId) {
          await updateRowStatus(sessionId, r.rowNumber, 'success', hash);
        }
      } catch (err) {
        const errorMsg = parseContractError(err);
        setSubmissions((prev) => ({
          ...prev,
          [r.rowNumber]: { status: 'failed', error: errorMsg },
        }));

        if (sessionId) {
          await updateRowStatus(
            sessionId,
            r.rowNumber,
            'failed',
            null,
            errorMsg,
          );
        }
      }
    }

    if (cancelledRef.current) {
      // Batch was cancelled — mark remaining pending rows as skipped so
      // they are recognized on resume and not silently lost.
      for (const r of validRows) {
        if (
          !cancelledRef.current &&
          submissions[r.rowNumber]?.status === 'success'
        ) {
          continue;
        }
        const current = submissions[r.rowNumber];
        if (
          current &&
          current.status !== 'success' &&
          current.status !== 'failed'
        ) {
          setSubmissions((prev) => ({
            ...prev,
            [r.rowNumber]: { status: 'pending' },
          }));
          if (sessionId) {
            await updateRowStatus(sessionId, r.rowNumber, 'pending');
          }
        }
      }
      setIsPausedBatch(false);
      setPhase('preview');
      setFormError(t('batchCancelled'));
    } else {
      setPhase('done');
    }
  };

  const handlePause = useCallback(() => {
    pausedRef.current = true;
    setIsPausedBatch(true);
  }, []);

  const handleResume = useCallback(() => {
    pausedRef.current = false;
    setIsPausedBatch(false);
  }, []);

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    pausedRef.current = false;
    setIsPausedBatch(false);
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">{t('title')}</h1>
        <p className="text-sm text-gray-400 mt-1">{t('intro')}</p>
      </div>

      {/* ── File upload ──────────────────────────────────────────────────── */}
      <section className="bg-brand-card border border-gray-800 rounded-xl p-6 space-y-4">
        <div>
          <label
            htmlFor="bulk-import-file"
            className="block text-sm font-medium text-gray-300"
          >
            {t('fileLabel')}
          </label>
          <p id="bulk-import-hint" className="text-xs text-gray-400 mt-1">
            {t('fileHint')}
          </p>
        </div>
        <input
          ref={fileInputRef}
          id="bulk-import-file"
          type="file"
          accept=".csv,.json,text/csv,application/json"
          onChange={handleFileChange}
          disabled={phase === 'submitting'}
          aria-describedby={
            [fileError ? 'bulk-import-file-error' : null, 'bulk-import-hint']
              .filter(Boolean)
              .join(' ') || undefined
          }
          aria-invalid={fileError ? true : undefined}
          className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-brand-green transition file:mr-4 file:py-1 file:px-4 file:rounded-lg file:border-0 file:bg-brand-green file:text-black file:font-medium hover:file:opacity-90 disabled:opacity-50"
        />
        {fileError && (
          <p
            id="bulk-import-file-error"
            role="alert"
            className="text-sm text-red-500"
          >
            {t(`fileErrors.${fileError.code}`, fileError.params)}
          </p>
        )}
        {fileName && !fileError && (
          <p className="text-sm text-gray-400">{t('loaded', { fileName })}</p>
        )}
      </section>

      {/* ── Staged preview / progress table ─────────────────────────────── */}
      {rows.length > 0 && (
        <section className="bg-brand-card border border-gray-800 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">
              {phase === 'preview' ? t('previewHeading') : t('progressHeading')}
            </h2>
            <p className="text-sm text-gray-400">
              {t('counts', {
                valid: validRows.length,
                invalid: invalidRows.length,
                total: rows.length,
              })}
            </p>
          </div>

          {/* ── Resume banner ─────────────────────────────────────────────── */}
          {resumedSessionInfo && phase === 'preview' && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200"
            >
              {t.rich('resumeBanner', {
                completed: resumedSessionInfo.completedRows,
                total: resumedSessionInfo.totalRows,
                strong: (chunks) => (
                  <span className="font-medium">{chunks}</span>
                ),
              })}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <caption className="sr-only">{t('tableCaption')}</caption>
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('columns.row')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('columns.name')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('columns.age')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('columns.nationality')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('columns.region')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('columns.position')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('columns.status')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.rowNumber}
                    className="border-b border-gray-800/60 align-top"
                  >
                    <td className="py-2 pr-4 text-gray-400">{row.rowNumber}</td>
                    <td className="py-2 pr-4 text-white">
                      {row.data.name || '—'}
                    </td>
                    <td className="py-2 pr-4 text-gray-300">
                      {row.data.age || '—'}
                    </td>
                    <td className="py-2 pr-4 text-gray-300">
                      {row.data.nationality || '—'}
                    </td>
                    <td className="py-2 pr-4 text-gray-300">
                      {row.valid
                        ? regionLabel(row.valid.region)
                        : row.data.region || '—'}
                    </td>
                    <td className="py-2 pr-4 text-gray-300">
                      {row.valid
                        ? positionLabel(row.valid.position)
                        : row.data.position || '—'}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-col gap-1">
                        <StatusBadge
                          row={row}
                          phase={phase}
                          submission={submissions[row.rowNumber]}
                        />
                        {row.errors.length > 0 && (
                          <ul className="text-xs text-red-400 list-disc list-inside">
                            {row.errors.map((err, i) => (
                              <li key={i}>
                                {t(`columns.${err.field}`)}:{' '}
                                {t(`rowErrors.${err.code}`, {
                                  field: t(`columns.${err.field}`),
                                  ...err.params,
                                })}
                              </li>
                            ))}
                          </ul>
                        )}
                        {submissions[row.rowNumber]?.status === 'failed' &&
                          submissions[row.rowNumber]?.error && (
                            <p className="text-xs text-red-400">
                              {submissions[row.rowNumber]?.error}
                            </p>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {formError && (
            <p role="alert" className="text-sm text-red-500">
              {formError}
            </p>
          )}

          {phase === 'done' && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-md border border-gray-700 bg-gray-900/50 p-3 text-sm text-gray-200"
            >
              {t('done', {
                succeeded: succeededCount,
                failed: failedCount,
                invalid: invalidRows.length,
              })}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {(phase === 'preview' || phase === 'submitting') && (
              <>
                {phase === 'submitting' && !isPausedBatch && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handlePause}
                  >
                    {t('pause')}
                  </Button>
                )}
                {phase === 'submitting' && isPausedBatch && (
                  <Button type="button" onClick={handleResume}>
                    {t('resume')}
                  </Button>
                )}
                {phase === 'submitting' && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleCancel}
                  >
                    {t('cancel')}
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={handleImport}
                  isLoading={phase === 'submitting' && !isPausedBatch}
                  disabled={
                    phase === 'submitting' ||
                    validRows.length === 0 ||
                    !publicKey
                  }
                  disabledReason={isPaused ? tContractStatus('paused_hint') : undefined}
                  title={!isPaused && !publicKey ? t('connectWalletTitle') : undefined}
                >
                  {phase === 'submitting'
                    ? isPausedBatch
                      ? t('paused')
                      : t('importing', {
                          done: succeededCount + failedCount,
                          total: validRows.length,
                        })
                    : t('importButton', { count: validRows.length })}
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                if (sessionId) {
                  await deleteSession(sessionId);
                }
                resetAll();
              }}
              disabled={phase === 'submitting'}
            >
              {phase === 'done' ? t('importAnother') : t('chooseAnother')}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
