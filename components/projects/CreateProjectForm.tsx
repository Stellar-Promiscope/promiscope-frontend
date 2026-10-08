'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/hooks/useWallet';

const inputClass =
  'mt-1 w-full rounded-xl border border-[#d8e0d6] bg-white px-3.5 py-3 text-sm text-[#263b2e] outline-none focus:border-[#53866a] focus:ring-2 focus:ring-[#53866a]/15';

export default function CreateProjectForm({ locale }: { locale: string }) {
  const router = useRouter();
  const { publicKey, connect, isConnecting } = useWallet();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [milestones, setMilestones] = useState([{ title: '', detail: '' }]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!publicKey) {
      try {
        await connect();
      } catch {
        setError('Wallet connection was not completed.');
      }
      return;
    }
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const response = await fetch('/api/community/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.get('title'),
          organization: form.get('organization'),
          location: form.get('location'),
          category: form.get('category'),
          summary: form.get('summary'),
          commitment: form.get('commitment'),
          milestones,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'Could not publish this project.');
      router.push(`/${locale}/projects/${result.slug}`);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not publish this project.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-3xl border border-[#dce5da] bg-white p-5 sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-semibold">
            Have a community project to document?
          </h2>
          <p className="mt-1 text-sm leading-6 text-[#68766d]">
            Publish its commitment and milestones. Updates are linked to the
            wallet that created the record.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="rounded-full bg-[#245d49] px-5 py-3 text-sm font-semibold text-white hover:bg-[#194a39]"
        >
          {open
            ? 'Close form'
            : publicKey
              ? 'Create a project'
              : 'Connect wallet to start'}
        </button>
      </div>
      {open && (
        <form onSubmit={submit} className="mt-6 border-t border-[#edf0ea] pt-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Project name
              <input
                name="title"
                required
                maxLength={100}
                className={inputClass}
                placeholder="Repair the community library"
              />
            </label>
            <label className="text-sm font-medium">
              Organization or team
              <input
                name="organization"
                required
                maxLength={100}
                className={inputClass}
                placeholder="Community project team"
              />
            </label>
            <label className="text-sm font-medium">
              Location
              <input
                name="location"
                required
                maxLength={100}
                className={inputClass}
                placeholder="City, country or community"
              />
            </label>
            <label className="text-sm font-medium">
              Category
              <input
                name="category"
                required
                maxLength={60}
                className={inputClass}
                placeholder="Education, water, public works…"
              />
            </label>
            <label className="text-sm font-medium sm:col-span-2">
              Short summary
              <textarea
                name="summary"
                required
                maxLength={600}
                rows={2}
                className={inputClass}
                placeholder="Who benefits and what will change?"
              />
            </label>
            <label className="text-sm font-medium sm:col-span-2">
              Project commitment
              <textarea
                name="commitment"
                required
                maxLength={2000}
                rows={3}
                className={inputClass}
                placeholder="Describe what the team commits to deliver."
              />
            </label>
          </div>
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Milestones</h3>
              <button
                type="button"
                disabled={milestones.length >= 12}
                onClick={() =>
                  setMilestones([...milestones, { title: '', detail: '' }])
                }
                className="text-sm font-semibold text-[#2c6b4e] disabled:opacity-40"
              >
                Add milestone
              </button>
            </div>
            <div className="mt-3 space-y-3">
              {milestones.map((milestone, index) => (
                <div
                  key={index}
                  className="grid gap-3 rounded-2xl bg-[#f7f8f4] p-4 sm:grid-cols-2"
                >
                  <label className="text-xs font-semibold uppercase tracking-wide text-[#77837a]">
                    Milestone {index + 1}
                    <input
                      required
                      maxLength={120}
                      value={milestone.title}
                      onChange={(e) =>
                        setMilestones(
                          milestones.map((item, i) =>
                            i === index
                              ? { ...item, title: e.target.value }
                              : item,
                          ),
                        )
                      }
                      className={inputClass}
                      placeholder="Publish the design and cost estimate"
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-[#77837a]">
                    What will be delivered?
                    <input
                      maxLength={500}
                      value={milestone.detail}
                      onChange={(e) =>
                        setMilestones(
                          milestones.map((item, i) =>
                            i === index
                              ? { ...item, detail: e.target.value }
                              : item,
                          ),
                        )
                      }
                      className={inputClass}
                      placeholder="A specific, reviewable outcome"
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-4 text-xs leading-5 text-[#758179]">
            Publishing does not verify an organization or its claims. Evidence
            and community responses are public and remain attributed to wallet
            addresses.
          </p>
          {error && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || isConnecting}
            className="mt-5 rounded-full bg-[#245d49] px-6 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy
              ? 'Publishing…'
              : publicKey
                ? 'Publish project record'
                : isConnecting
                  ? 'Connecting…'
                  : 'Connect wallet and continue'}
          </button>
        </form>
      )}
    </section>
  );
}
