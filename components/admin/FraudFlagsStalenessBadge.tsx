'use client';
import { useEffect, useState } from 'react';
import { fetchFraudFlagsStatus } from '@/lib/api';

/**
 * Minimal proactive-surfacing mechanism for issue #1007, absent any
 * existing outbound-notification channel (email/Slack/push) in this
 * codebase: a visible badge in the admin dashboard header showing when
 * fraud-flag evaluation last ran (manual or cron-triggered) and flipping
 * to a warning style once that run is older than STALE_THRESHOLD_MS —
 * distinguishing "checked recently, nothing found" from "hasn't been
 * checked in a while, may be stale" without requiring an admin to open
 * FraudFlagsPanel.tsx first.
 */
const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours

function formatAge(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function FraudFlagsStalenessBadge() {
  const [status, setStatus] = useState<{
    evaluatedAt: number | null;
    highSeverityCount: number;
    eventsProcessed?: number;
    durationMs?: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFraudFlagsStatus()
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch(() => {
        // Best-effort indicator — a failed status check shouldn't block or
        // clutter the rest of the admin dashboard.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status || status.evaluatedAt === null) return null;

  const age = Date.now() - status.evaluatedAt;
  const stale = age > STALE_THRESHOLD_MS;
  const hasHighSeverity = status.highSeverityCount > 0;

  const style = stale
    ? 'border-yellow-600 bg-yellow-950/30 text-yellow-400'
    : hasHighSeverity
      ? 'border-red-600 bg-red-950/30 text-red-400'
      : 'border-gray-700 bg-gray-900 text-gray-400';

  const durationSec =
    status.durationMs !== undefined && status.durationMs > 0
      ? `${(status.durationMs / 1000).toFixed(1)}s`
      : null;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${style}`}
      title="Fraud flag evaluation status"
    >
      Fraud flags: {formatAge(age)}
      {hasHighSeverity && ` · ${status.highSeverityCount} high`}
      {status.eventsProcessed !== undefined &&
        status.eventsProcessed > 0 &&
        ` · ${status.eventsProcessed} events`}
      {durationSec && ` (${durationSec})`}
      {stale && ' · stale'}
    </span>
  );
}
