'use client';

import { useState } from 'react';
import { mutate as globalMutate } from 'swr';
import { useWallet } from '@/hooks/useWallet';
import { useDisputeQueue } from '@/hooks/useDisputeQueue';
import { useDisputeDetail } from '@/hooks/useDisputeDetail';
import { buildRevokeMilestone } from '@/lib/contract';
import { parseContractError } from '@/lib/contractErrorMessage';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import TruncatedAddress from '@/components/ui/TruncatedAddress';
import DisputeEvidenceForm from '@/components/player/DisputeEvidenceForm';
import type { MilestoneDispute, DisputeEvent, DisputeWithEvents } from '@/types';

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<
  string,
  { label: string; classes: string }
> = {
  pending: {
    label: 'Awaiting validator',
    classes: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  },
  under_review: {
    label: 'Under review',
    classes: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  },
  escalated: {
    label: 'Escalated',
    classes: 'bg-red-500/15 text-red-400 border-red-500/30',
  },
  upheld: {
    label: 'Upheld',
    classes: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
  },
  reversed: {
    label: 'Reversed',
    classes: 'bg-green-500/15 text-green-400 border-green-500/30',
  },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? {
    label: status,
    classes: 'bg-gray-700 text-gray-300',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.classes}`}
    >
      {s.label}
    </span>
  );
}

// ── Event icon ────────────────────────────────────────────────────────────────

function eventIcon(type: DisputeEvent['type']): string {
  switch (type) {
    case 'opened':            return '📋';
    case 'evidence_added':    return '📎';
    case 'validator_response': return '🛡️';
    case 'admin_note':        return '📝';
    case 'decided':           return '⚖️';
    case 'escalated':         return '🚨';
    default:                  return '•';
  }
}

function eventLabel(type: DisputeEvent['type']): string {
  switch (type) {
    case 'opened':            return 'Dispute filed';
    case 'evidence_added':    return 'Evidence added';
    case 'validator_response': return 'Validator response';
    case 'admin_note':        return 'Admin note';
    case 'decided':           return 'Decision recorded';
    case 'escalated':         return 'Escalated (no response)';
    default:                  return type;
  }
}

// ── IPFS evidence thumbnail ───────────────────────────────────────────────────

function EvidenceThumbnail({
  cid,
  mimeType,
}: {
  cid: string;
  mimeType: string;
}) {
  const gateway =
    process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? 'https://gateway.pinata.cloud/ipfs';
  const url = `${gateway}/${cid}`;

  if (mimeType.startsWith('image/')) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Evidence"
          className="mt-2 max-h-40 rounded-lg border border-gray-700 object-cover"
        />
      </a>
    );
  }
  if (mimeType.startsWith('video/')) {
    return (
      <video
        src={url}
        controls
        className="mt-2 max-h-40 w-full rounded-lg border border-gray-700"
      />
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 inline-flex items-center gap-1 text-xs text-brand-green underline"
    >
      📄 View file (IPFS)
    </a>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────────

function DisputeTimeline({ events }: { events: DisputeEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-xs text-gray-500 italic">No events yet.</p>
    );
  }
  return (
    <ol className="relative border-l border-gray-700 pl-4 flex flex-col gap-4">
      {events.map((ev) => (
        <li key={ev.id} className="relative">
          {/* dot */}
          <span className="absolute -left-[1.1rem] top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 border border-gray-700 text-xs">
            {eventIcon(ev.type)}
          </span>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-gray-200">
              {eventLabel(ev.type)}
            </span>
            <span className="text-gray-500">·</span>
            <TruncatedAddress address={ev.actorWallet} className="text-gray-500" />
            <span className="text-gray-500">·</span>
            <time className="text-gray-600">
              {new Date(ev.createdAt).toLocaleString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </time>
          </div>

          {ev.body && (
            <p className="mt-1 text-sm text-gray-300 whitespace-pre-wrap">
              {ev.body}
            </p>
          )}

          {ev.ipfsHash && ev.ipfsMimeType && (
            <EvidenceThumbnail cid={ev.ipfsHash} mimeType={ev.ipfsMimeType} />
          )}
        </li>
      ))}
    </ol>
  );
}

// ── Admin note form ───────────────────────────────────────────────────────────

function AdminNoteForm({
  disputeId,
  onAdded,
}: {
  disputeId: number;
  onAdded: () => void;
}) {
  const { submitEvidence } = useDisputeDetail(disputeId);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-gray-400 underline hover:text-white"
      >
        + Add admin note / evidence
      </button>
    );
  }
  return (
    <DisputeEvidenceForm
      submitLabel="Save note"
      onSubmit={async (params) => {
        await submitEvidence(params);
        onAdded();
        setOpen(false);
      }}
    />
  );
}

// ── Decision form ─────────────────────────────────────────────────────────────

type PendingAction = 'upheld' | 'reversed' | null;

function DecisionForm({
  dispute,
  onDecide,
}: {
  dispute: MilestoneDispute;
  onDecide: (
    id: number,
    decision: {
      status: 'upheld' | 'reversed';
      resolutionNote?: string;
      revokeTxHash?: string;
    },
  ) => Promise<MilestoneDispute>;
}) {
  const { publicKey, signAndSubmit } = useWallet();
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState<PendingAction>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!confirming) return;
    setWorking(true);
    setError(null);
    try {
      if (confirming === 'reversed') {
        if (!publicKey) throw new Error('Wallet not connected');
        const xdr = await buildRevokeMilestone(
          publicKey,
          dispute.playerId,
          dispute.milestoneId,
        );
        const txHash = await signAndSubmit(xdr);
        await globalMutate(`player:${dispute.playerId}`);
        await globalMutate(`milestones:${dispute.playerId}`);
        await onDecide(dispute.id, {
          status: 'reversed',
          resolutionNote: note.trim() || undefined,
          revokeTxHash: txHash,
        });
      } else {
        await onDecide(dispute.id, {
          status: 'upheld',
          resolutionNote: note.trim() || undefined,
        });
      }
      setConfirming(null);
    } catch (err) {
      setError(parseContractError(err));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-gray-800 pt-3 mt-1">
      <p className="text-xs font-medium text-gray-400">Admin decision</p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional resolution note…"
        rows={2}
        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2
          text-xs text-white placeholder-gray-500 focus:border-brand-green
          focus:outline-none"
      />
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          id={`dispute-uphold-${dispute.id}`}
          onClick={() => setConfirming('upheld')}
          className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium
            text-gray-300 hover:bg-gray-800 transition"
        >
          Uphold decision
        </button>
        <button
          type="button"
          id={`dispute-reverse-${dispute.id}`}
          onClick={() => setConfirming('reversed')}
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5
            text-xs font-medium text-red-400 hover:bg-red-500/20 transition"
        >
          Reverse &amp; revoke milestone
        </button>
      </div>

      <ConfirmDialog
        isOpen={confirming !== null}
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(null)}
        loading={working}
        title={
          confirming === 'reversed' ? 'Reverse milestone' : 'Uphold decision'
        }
        message={
          confirming === 'reversed'
            ? 'This will submit an on-chain revoke_milestone transaction (requires your wallet to be an authorized validator) and mark the dispute as reversed. This cannot be undone.'
            : 'This closes the dispute without changing the milestone. The original decision stands.'
        }
        confirmLabel={confirming === 'reversed' ? 'Reverse' : 'Uphold'}
      />
    </div>
  );
}

// ── Expanded dispute card ─────────────────────────────────────────────────────

function DisputeCard({
  dispute: summary,
  onDecide,
}: {
  dispute: MilestoneDispute;
  onDecide: (
    id: number,
    decision: {
      status: 'upheld' | 'reversed';
      resolutionNote?: string;
      revokeTxHash?: string;
    },
  ) => Promise<MilestoneDispute>;
}) {
  const [expanded, setExpanded] = useState(false);
  const { dispute, loading: detailLoading, refetch } = useDisputeDetail(
    expanded ? summary.id : null,
  );

  const isPending =
    summary.status === 'pending' ||
    summary.status === 'under_review' ||
    summary.status === 'escalated';

  return (
    <li className="rounded-xl border border-gray-800 bg-gray-900/40 overflow-hidden">
      {/* Summary header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex flex-wrap items-center justify-between gap-2 px-4 py-3
          text-left hover:bg-gray-800/40 transition"
        aria-expanded={expanded}
        id={`dispute-header-${summary.id}`}
      >
        <div className="flex flex-col gap-0.5 min-w-0">
          <p className="text-sm font-medium text-gray-100 truncate">
            {summary.milestoneDescription}
          </p>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <TruncatedAddress address={summary.playerWallet} />
            <span>·</span>
            <time>
              {new Date(summary.createdAt).toLocaleDateString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric',
              })}
            </time>
            {summary.status === 'pending' && (
              <>
                <span>·</span>
                <span className="text-amber-400/80">
                  Deadline{' '}
                  {new Date(summary.responseDeadline).toLocaleDateString(
                    undefined,
                    { month: 'short', day: 'numeric' },
                  )}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={summary.status} />
          <span className="text-gray-600 text-sm">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-800 px-4 py-4 flex flex-col gap-4">
          {/* Claim */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Player claim
            </p>
            <p className="text-sm text-gray-200">{summary.reason}</p>
          </div>

          {/* Parties */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-gray-500 mb-0.5">Player</p>
              <TruncatedAddress
                address={summary.playerWallet}
                className="text-gray-300"
              />
            </div>
            <div>
              <p className="text-gray-500 mb-0.5">Validator</p>
              <TruncatedAddress
                address={summary.validatorWallet}
                className="text-gray-300"
              />
            </div>
          </div>

          {/* Event timeline */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Timeline
            </p>
            {detailLoading ? (
              <p className="text-xs text-gray-500 animate-pulse">
                Loading timeline…
              </p>
            ) : dispute ? (
              <DisputeTimeline events={dispute.events} />
            ) : null}
          </div>

          {/* Admin actions */}
          {isPending && (
            <>
              <AdminNoteForm disputeId={summary.id} onAdded={refetch} />
              <DecisionForm dispute={summary} onDecide={onDecide} />
            </>
          )}

          {/* Decided summary */}
          {!isPending && summary.decidedAt && (
            <div className="rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-2 text-xs">
              <p className="text-gray-400">
                Decided{' '}
                <time>
                  {new Date(summary.decidedAt).toLocaleDateString(undefined, {
                    year: 'numeric', month: 'short', day: 'numeric',
                  })}
                </time>{' '}
                by <TruncatedAddress address={summary.decidedBy ?? ''} />
              </p>
              {summary.resolutionNote && (
                <p className="mt-1 text-gray-300">{summary.resolutionNote}</p>
              )}
              {summary.revokeTxHash && (
                <p className="mt-1 text-gray-500 break-all">
                  Revoke tx: {summary.revokeTxHash}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { value: undefined, label: 'All open' },
  { value: 'pending' as const, label: 'Pending' },
  { value: 'escalated' as const, label: 'Escalated' },
  { value: 'under_review' as const, label: 'Under review' },
] as const;

/**
 * Admin review panel for disputed milestones.
 *
 * Now shows a full threaded timeline for each dispute — player claim,
 * validator response, attached evidence, admin notes, and the final
 * decision record (with revoke tx hash when reversed).
 *
 * Reversing a dispute reuses the existing validator revoke_milestone flow;
 * the admin wallet must be an authorised validator on-chain.
 */
export default function DisputedMilestonesPanel() {
  const [activeTab, setActiveTab] = useState<
    'pending' | 'under_review' | 'escalated' | undefined
  >(undefined);

  const { disputes, loading, error, decide } = useDisputeQueue(activeTab);

  return (
    <section
      className="bg-brand-card border border-gray-800 rounded-xl p-6 flex flex-col gap-4"
      aria-labelledby="disputed-milestones-heading"
    >
      <div>
        <h2
          id="disputed-milestones-heading"
          className="text-lg font-semibold text-white"
        >
          Disputed Milestones
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          Each dispute shows a full evidence timeline. Validators are notified
          and have a response window. Escalated disputes missed that window.
        </p>
      </div>

      {/* Tab filter */}
      <div className="flex gap-1 border-b border-gray-800 pb-0.5">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => setActiveTab(tab.value as typeof activeTab)}
            className={`px-3 py-1 text-xs rounded-t-md transition font-medium ${
              activeTab === tab.value
                ? 'bg-gray-800 text-white border border-b-0 border-gray-700'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-400">
          Failed to load disputed milestones.
        </p>
      ) : disputes.length === 0 ? (
        <EmptyState
          title="No disputed milestones"
          description="Milestones flagged by players for review will appear here."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {disputes.map((dispute) => (
            <DisputeCard
              key={dispute.id}
              dispute={dispute}
              onDecide={decide}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
