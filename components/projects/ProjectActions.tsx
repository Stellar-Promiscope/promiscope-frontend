'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ProjectRecord } from '@/lib/projectRecordStore';
import { useWallet } from '@/hooks/useWallet';

const fieldClass =
  'mt-1 w-full rounded-xl border border-[#d8e0d6] bg-white px-3 py-2.5 text-sm text-[#263b2e] outline-none focus:border-[#53866a]';

export default function ProjectActions({
  project,
}: {
  project: ProjectRecord;
}) {
  const router = useRouter();
  const { publicKey, isAuthenticated, connect, isConnecting } = useWallet();
  const isOwner = Boolean(
    isAuthenticated && publicKey && publicKey === project.ownerWallet,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [responseText, setResponseText] = useState<Record<string, string>>({});

  async function requireWallet() {
    try {
      await connect();
    } catch {
      setError('Wallet connection was not completed.');
    }
  }

  async function request(url: string, method: string, payload: unknown) {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || 'The change could not be saved.');
    router.refresh();
  }

  async function submitUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAuthenticated) {
      await requireWallet();
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError('');
    try {
      await request(`/api/community/projects/${project.slug}`, 'POST', {
        body: form.get('body'),
        evidenceUrl: form.get('evidenceUrl'),
      });
      formElement.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Update failed.');
    } finally {
      setBusy(false);
    }
  }

  async function setMilestone(milestoneId: string, status: string) {
    setBusy(true);
    setError('');
    try {
      await request(`/api/community/projects/${project.slug}`, 'PATCH', {
        milestoneId,
        status,
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Milestone update failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitResponse(
    event: FormEvent<HTMLFormElement>,
    updateId: string,
  ) {
    event.preventDefault();
    if (!isAuthenticated) {
      await requireWallet();
      return;
    }
    const body = responseText[updateId]?.trim();
    if (!body) return;
    setBusy(true);
    setError('');
    try {
      await request(
        `/api/community/projects/${project.slug}/responses`,
        'POST',
        { updateId, body },
      );
      setResponseText((current) => ({ ...current, [updateId]: '' }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Response failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {isOwner && (
        <section className="rounded-3xl border border-[#dce5da] bg-white p-6">
          <h2 className="text-lg font-semibold">Owner tools</h2>
          <p className="mt-1 text-sm text-[#758179]">
            Update milestone status or publish a dated progress note.
          </p>
          <div className="mt-4 space-y-3">
            {project.milestones.map((milestone) => (
              <label key={milestone.id} className="block text-sm font-medium">
                {milestone.title}
                <select
                  disabled={busy}
                  value={milestone.status}
                  onChange={(event) =>
                    setMilestone(milestone.id, event.target.value)
                  }
                  className={fieldClass}
                >
                  <option value="planned">Planned</option>
                  <option value="in_progress">In progress</option>
                  <option value="completed">Completed</option>
                </select>
              </label>
            ))}
          </div>
          <form
            onSubmit={submitUpdate}
            className="mt-5 border-t border-[#edf0ea] pt-5"
          >
            <label className="block text-sm font-medium">
              Project update
              <textarea
                name="body"
                required
                maxLength={2000}
                rows={4}
                className={fieldClass}
                placeholder="What changed? Include dates, decisions, and delays."
              />
            </label>
            <label className="mt-3 block text-sm font-medium">
              Evidence link (optional)
              <input
                name="evidenceUrl"
                type="url"
                maxLength={500}
                className={fieldClass}
                placeholder="https://… or ipfs://…"
              />
            </label>
            <p className="mt-2 text-xs leading-5 text-[#758179]">
              A linked file is supporting material, not proof that its claims
              are true.
            </p>
            <button
              disabled={busy || isConnecting}
              className="mt-4 rounded-full bg-[#245d49] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Publish update'}
            </button>
          </form>
        </section>
      )}

      <section className="rounded-3xl border border-[#dce5da] bg-white p-6">
        <h2 className="text-lg font-semibold">Community responses</h2>
        <p className="mt-1 text-sm text-[#758179]">
          Ask a question about this project record. Responses are public and
          wallet-attributed.
        </p>
        {!isAuthenticated && (
          <button
            type="button"
            onClick={() => void requireWallet()}
            disabled={isConnecting}
            className="mt-4 rounded-full border border-[#cddbcf] px-4 py-2.5 text-sm font-semibold text-[#315e43]"
          >
            {isConnecting ? 'Connecting…' : 'Connect wallet to respond'}
          </button>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {project.updates.length === 0 && (
          <p className="mt-4 rounded-xl bg-[#f7f8f4] p-4 text-sm text-[#758179]">
            No progress updates yet.
          </p>
        )}
        <div className="mt-4 space-y-5">
          {project.updates.map((update) => (
            <article key={update.id} className="rounded-2xl bg-[#f7f8f4] p-4">
              <p className="text-xs text-[#78847b]">
                {new Date(update.createdAt).toLocaleString()} ·{' '}
                {update.authorWallet.slice(0, 6)}…
                {update.authorWallet.slice(-4)}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#405448]">
                {update.body}
              </p>
              {update.evidenceUrl && (
                <a
                  href={update.evidenceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block break-all text-sm font-medium text-[#286347] underline"
                >
                  Open supporting material
                </a>
              )}
              <div className="mt-4 space-y-2 border-l-2 border-[#d9e4d8] pl-3">
                {update.responses.map((response) => (
                  <div key={response.id} className="text-sm">
                    <p className="text-xs text-[#78847b]">
                      {new Date(response.createdAt).toLocaleString()} ·{' '}
                      {response.authorWallet.slice(0, 6)}…
                      {response.authorWallet.slice(-4)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-[#526259]">
                      {response.body}
                    </p>
                  </div>
                ))}
              </div>
              {isAuthenticated && (
                <form
                  onSubmit={(event) => submitResponse(event, update.id)}
                  className="mt-4 flex flex-col gap-2 sm:flex-row"
                >
                  <input
                    value={responseText[update.id] ?? ''}
                    onChange={(event) =>
                      setResponseText((current) => ({
                        ...current,
                        [update.id]: event.target.value,
                      }))
                    }
                    maxLength={1000}
                    required
                    className={`${fieldClass} mt-0 flex-1`}
                    placeholder="Ask a question or share feedback"
                  />
                  <button
                    disabled={busy}
                    className="rounded-full bg-[#e5efe5] px-4 py-2.5 text-sm font-semibold text-[#315e43] disabled:opacity-50"
                  >
                    Respond
                  </button>
                </form>
              )}
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
