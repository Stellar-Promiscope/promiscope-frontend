import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Check, Clock3, FileText, MapPin, MessageCircle } from 'lucide-react';
import { projectExamples } from '@/lib/projectExamples';

export function generateStaticParams() {
  return projectExamples.map(({ slug }) => ({ slug }));
}

function getProject(slug: string) {
  return projectExamples.find((project) => project.slug === slug);
}

export function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Metadata {
  const project = getProject(params.slug);
  return {
    title: project ? `${project.title} — Promiscope` : 'Project record — Promiscope',
    description: project?.summary,
  };
}

export default function ProjectRecordPage({
  params,
}: {
  params: { locale: string; slug: string };
}) {
  const project = getProject(params.slug);
  if (!project) notFound();

  return (
    <main className="-mx-4 -mt-8 min-h-screen bg-[#f6f5ef] px-5 py-10 text-[#182923] sm:px-10 sm:py-14 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <Link href={`/${params.locale}/projects`} className="inline-flex items-center gap-2 text-sm font-medium text-[#52705e] hover:text-[#204e3d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#245d49]"><ArrowLeft size={16} /> All projects</Link>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-[#e5efe5] px-3 py-1.5 text-xs font-semibold text-[#31664b]">Illustrative project record</span>
          <span className="text-xs text-[#78847b]">A design example · not a live project</span>
        </div>

        <section className="mt-5 grid gap-7 lg:grid-cols-[1fr_300px] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#528067]">{project.category}</p>
            <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">{project.title}</h1>
            <p className="mt-4 flex items-center gap-2 text-sm text-[#758179]"><MapPin size={16} />{project.location}</p>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[#647168]">{project.summary}</p>
          </div>
          <aside className="rounded-3xl border border-[#dfe6dc] bg-white p-5">
            <div className="flex items-center justify-between text-sm"><span className="font-medium text-[#526259]">Example progress</span><strong className="text-[#245d49]">{project.progress}%</strong></div>
            <div className="mt-3 h-2 rounded-full bg-[#edf0ea]"><div className="h-2 rounded-full bg-[#4b8b69]" style={{ width: `${project.progress}%` }} /></div>
            <p className="mt-3 text-xs leading-5 text-[#758179]">Progress values are fictional and show how a project summary could appear.</p>
          </aside>
        </section>

        <div className="mt-9 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-[#e0e5dc] bg-white p-6 sm:p-8">
              <div className="flex items-start gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#e6f1e9] text-[#317052]"><FileText size={19} /></span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#728078]">Project commitment</p>
                  <h2 className="mt-2 text-lg font-semibold">What this project set out to do</h2>
                  <p className="mt-3 text-sm leading-6 text-[#647168]">{project.commitment}</p>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-[#e0e5dc] bg-white p-6 sm:p-8">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-xs font-semibold uppercase tracking-wide text-[#728078]">Delivery plan</p><h2 className="mt-2 text-lg font-semibold">Milestones</h2></div>
                <span className="rounded-full bg-[#f2f4ef] px-3 py-1.5 text-xs text-[#65736a]">Example statuses</span>
              </div>
              <ol className="mt-6 space-y-3">
                {project.milestones.map((milestone, index) => (
                  <li key={milestone.title} className="flex gap-4 rounded-2xl bg-[#f8f9f6] p-4">
                    <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${milestone.state === 'complete' ? 'bg-[#dcecdf] text-[#2f6d4c]' : milestone.state === 'active' ? 'bg-[#f5ead7] text-[#936622]' : 'bg-[#e9ece8] text-[#778078]'}`}>
                      {milestone.state === 'complete' ? <Check size={15} /> : <span className="text-xs font-semibold">{String(index + 1).padStart(2, '0')}</span>}
                    </span>
                    <div className="min-w-0 flex-1"><p className="text-sm font-medium text-[#34483b]">{milestone.title}</p><p className="mt-1 text-xs capitalize text-[#7a867e]">{milestone.state}</p></div>
                    {milestone.state === 'active' && <Clock3 size={16} className="mt-1 text-[#ad8544]" aria-label="In progress" />}
                  </li>
                ))}
              </ol>
            </section>

            <section className="rounded-3xl border border-[#e0e5dc] bg-white p-6 sm:p-8">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-[#728078]">Updates and responses</p><h2 className="mt-2 text-lg font-semibold">A shared project history</h2></div>
              <ol className="mt-6 space-y-0">
                {project.updates.map((update, index) => (
                  <li key={update.title} className={`relative pb-7 pl-8 ${index < project.updates.length - 1 ? 'border-l border-[#dce5da]' : ''}`}>
                    <span className="absolute -left-[7px] top-1 h-3.5 w-3.5 rounded-full border-2 border-white bg-[#4b8b69] ring-1 ring-[#9fbea5]" />
                    <p className="text-xs font-medium text-[#7b887e]">{update.date}</p>
                    <h3 className="mt-2 text-sm font-semibold">{update.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-[#647168]">{update.detail}</p>
                    <div className="mt-3 rounded-2xl bg-[#f5f7f2] p-4">
                      <div className="flex items-center gap-2 text-xs font-semibold text-[#456a52]"><MessageCircle size={14} /> Community response · example</div>
                      <p className="mt-2 text-sm leading-6 text-[#647168]">{update.response}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-3xl border border-[#e0e5dc] bg-white p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#728078]">Evidence</p>
              <h2 className="mt-2 text-lg font-semibold">Materials linked to updates</h2>
              <div className="mt-5 flex items-start gap-3 rounded-2xl border border-dashed border-[#cfdacf] bg-[#f8f9f6] p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#52705e]"><FileText size={17} /></span>
                <div><p className="text-sm font-medium">Example attachment</p><p className="mt-1 text-xs leading-5 text-[#7b887e]">A live record could link a receipt, photo, or document to the update it supports.</p></div>
              </div>
              <p className="mt-4 text-xs leading-5 text-[#849087]">A file being present would not, by itself, establish that its claims are true.</p>
            </section>

            <section className="rounded-3xl border border-[#d9e4d8] bg-[#eaf1e8] p-6">
              <h2 className="text-sm font-semibold text-[#2f5740]">What community review means</h2>
              <p className="mt-3 text-sm leading-6 text-[#53695a]">People can ask questions about a specific update. The project team’s response stays alongside it, so readers can see what was asked and answered.</p>
            </section>

            <p className="rounded-2xl border border-[#e8e3d6] bg-[#fbf8ef] p-4 text-xs leading-5 text-[#7b735e]">Every project, organization, date, progress value, update, and response on this page is fictional. No community review or evidence verification has taken place.</p>
          </aside>
        </div>
      </div>
    </main>
  );
}
