'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Turnstile from '@/components/ui/Turnstile';
import {
  MEDIA_REPORT_REASONS,
  MEDIA_REPORT_REASON_LABELS,
  type MediaReportReason,
} from '@/lib/mediaModeration';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

interface MediaReportButtonProps {
  cid: string;
  playerId?: string;
}

/** "Report" control for one gallery item (issue #1320). */
export default function MediaReportButton({
  cid,
  playerId,
}: MediaReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<MediaReportReason>('nudity');
  const [details, setDetails] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle',
  );
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (TURNSTILE_SITE_KEY && !token) return;
    setStatus('sending');
    setError(null);
    try {
      const res = await fetch('/api/media/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cid,
          playerId,
          reason,
          details: details.trim() || undefined,
          turnstileToken: token ?? undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (HTTP ${res.status})`);
      }
      setStatus('sent');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Request failed');
      // Turnstile tokens are single-use.
      setToken(null);
      setTurnstileKey((k) => k + 1);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute top-2 right-2 z-10 rounded-md bg-black/60 px-2 py-1 text-xs text-white hover:bg-black/80"
      >
        Report
      </button>
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Report this media"
      >
        {status === 'sent' ? (
          <p className="text-sm text-gray-300" role="status">
            Thanks — our moderators will review this media.
          </p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm text-gray-300">
              Reason
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as MediaReportReason)}
                className="rounded-md border border-gray-700 bg-gray-900 px-2 py-1.5 text-white"
              >
                {MEDIA_REPORT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {MEDIA_REPORT_REASON_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-gray-300">
              Details (optional)
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                maxLength={500}
                rows={3}
                className="rounded-md border border-gray-700 bg-gray-900 px-2 py-1.5 text-white"
              />
            </label>
            {TURNSTILE_SITE_KEY && (
              <Turnstile
                key={turnstileKey}
                siteKey={TURNSTILE_SITE_KEY}
                onVerify={setToken}
                onExpire={() => setToken(null)}
              />
            )}
            <p className="text-xs text-gray-500">
              Removal applies to Promiscope only. Content stored on IPFS may
              remain reachable through public gateways.
            </p>
            {error && (
              <p className="text-sm text-red-400" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={
                status === 'sending' || Boolean(TURNSTILE_SITE_KEY && !token)
              }
              className="rounded-lg bg-brand-green px-4 py-2 text-sm font-medium text-black hover:bg-brand-green/90 disabled:opacity-50"
            >
              {status === 'sending' ? 'Sending…' : 'Submit report'}
            </button>
          </form>
        )}
      </Modal>
    </>
  );
}
