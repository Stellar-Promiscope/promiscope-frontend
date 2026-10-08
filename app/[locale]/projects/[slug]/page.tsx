import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Check, Circle, Clock3, MapPin } from 'lucide-react';
import ProjectActions from '@/components/projects/ProjectActions';
import { ProjectRecordStore } from '@/lib/projectRecordStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: { locale: string; slug: string } };

export function generateMetadata({ params }: Props): Metadata {
  const project = ProjectRecordStore.getInstance().get(params.slug);
  return {
    title: project
      ? `${project.title} — Promiscope`
      : 'Project record — Promiscope',
    description: project?.summary,
  };
}

export default function ProjectRecordPage({ params }: Props) {
  const project = ProjectRecordStore.getInstance().get(params.slug);
  if (!project) notFound();
  return (
    <main className="-mx-4 -mt-8 min-h-screen bg-[#f6f5ef] px-5 py-10 text-[#182923] sm:px-10 sm:py-14 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <Link
          href={`/${params.locale}/projects`}
          className="inline-flex items-center gap-2 text-sm font-medium text-[#52705e] hover:text-[#204e3d]"
        >
          <ArrowLeft size={16} /> All projects
        </Link>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-[#e5efe5] px-3 py-1.5 text-xs font-semibold capitalize text-[#31664b]">
            {project.status} record
          </span>
          <span className="text-xs text-[#78847b]">
            Published {new Date(project.createdAt).toLocaleDateString()}
          </span>
        </div>
        <section className="mt-5 grid gap-7 lg:grid-cols-[1fr_300px] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#528067]">
              {project.category} · {project.organization}
            </p>
            <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
              {project.title}
            </h1>
            <p className="mt-4 flex items-center gap-2 text-sm text-[#758179]">
              <MapPin size={16} />
              {project.location}
            </p>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[#647168]">
              {project.summary}
            </p>
          </div>
          <aside className="rounded-3xl border border-[#dfe6dc] bg-white p-5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-[#526259]">
                Milestones complete
              </span>
              <strong className="text-[#245d49]">{project.progress}%</strong>
            </div>
            <div className="mt-3 h-2 rounded-full bg-[#edf0ea]">
              <div
                className="h-2 rounded-full bg-[#4b8b69]"
                style={{ width: `${project.progress}%` }}
              />
            </div>
            <p className="mt-3 text-xs leading-5 text-[#758179]">
              Calculated from the milestone statuses published by the project
              owner.
            </p>
          </aside>
        </section>

        <div className="mt-9 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.8fr)]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-[#e0e5dc] bg-white p-6 sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#728078]">
                Project commitment
              </p>
              <h2 className="mt-2 text-lg font-semibold">
                What the team committed to deliver
              </h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[#647168]">
                {project.commitment}
              </p>
            </section>
            <section className="rounded-3xl border border-[#e0e5dc] bg-white p-6 sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#728078]">
                Delivery plan
              </p>
              <h2 className="mt-2 text-lg font-semibold">Milestones</h2>
              <ol className="mt-6 space-y-3">
                {project.milestones.map((milestone, index) => (
                  <li
                    key={milestone.id}
                    className="flex gap-4 rounded-2xl bg-[#f8f9f6] p-4"
                  >
                    <span
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${milestone.status === 'completed' ? 'bg-[#dcecdf] text-[#2f6d4c]' : milestone.status === 'in_progress' ? 'bg-[#f5ead7] text-[#936622]' : 'bg-[#e9ece8] text-[#778078]'}`}
                    >
                      {milestone.status === 'completed' ? (
                        <Check size={16} />
                      ) : milestone.status === 'in_progress' ? (
                        <Clock3 size={16} />
                      ) : (
                        <Circle size={14} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#34483b]">
                        {index + 1}. {milestone.title}
                      </p>
                      {milestone.detail && (
                        <p className="mt-1 text-sm leading-6 text-[#647168]">
                          {milestone.detail}
                        </p>
                      )}
                      <p className="mt-2 text-xs capitalize text-[#7a867e]">
                        {milestone.status.replace('_', ' ')}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
            <section className="rounded-3xl border border-[#e0e5dc] bg-white p-6 sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#728078]">
                Project history
              </p>
              <h2 className="mt-2 text-lg font-semibold">Progress updates</h2>
              {project.updates.length === 0 ? (
                <p className="mt-5 rounded-2xl bg-[#f8f9f6] p-4 text-sm text-[#758179]">
                  The project team has not published an update yet.
                </p>
              ) : (
                <ol className="mt-6 space-y-6">
                  {project.updates.map((update) => (
                    <li
                      key={update.id}
                      className="border-l-2 border-[#dce5da] pl-5"
                    >
                      <p className="text-xs text-[#78847b]">
                        {new Date(update.createdAt).toLocaleString()} ·{' '}
                        {update.authorWallet.slice(0, 6)}…
                        {update.authorWallet.slice(-4)}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#46584d]">
                        {update.body}
                      </p>
                      {update.evidenceUrl && (
                        <a
                          href={update.evidenceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-block break-all text-sm font-medium text-[#286347] underline"
                        >
                          Open supporting material
                        </a>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
          <aside className="space-y-6">
            <section className="rounded-3xl border border-[#e0e5dc] bg-white p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#728078]">
                Record authorship
              </p>
              <p className="mt-2 text-sm leading-6 text-[#647168]">
                The connected wallet is the project publisher. Wallet
                attribution does not confirm the holder’s identity or verify
                project claims.
              </p>
              <p className="mt-3 break-all font-mono text-xs text-[#78847b]">
                {project.ownerWallet}
              </p>
            </section>
            <ProjectActions project={project} />
            <p className="rounded-2xl border border-[#e8e3d6] bg-[#fbf8ef] p-4 text-xs leading-5 text-[#7b735e]">
              Promiscope records statements, updates, links, and responses.
              Evidence has not been independently verified, and milestone
              completion is reported by the project owner.
            </p>
          </aside>
        </div>
      </div>
    </main>
  );
}
