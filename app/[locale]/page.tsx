import Link from 'next/link';
import {
  ArrowRight,
  ClipboardCheck,
  Eye,
  FileCheck2,
  MapPin,
} from 'lucide-react';
import { ProjectRecordStore } from '@/lib/projectRecordStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const steps = [
  {
    icon: ClipboardCheck,
    number: '01',
    title: 'Set a clear commitment',
    description:
      'Describe the project, its milestones, who is responsible, and what completion should look like.',
  },
  {
    icon: FileCheck2,
    number: '02',
    title: 'Share updates with evidence',
    description:
      'Project teams post progress, link supporting material, and explain context as work happens.',
  },
  {
    icon: Eye,
    number: '03',
    title: 'Review progress together',
    description:
      'Community members can ask questions and share responses alongside a specific update.',
  },
];

export default function HomePage({
  params,
}: {
  params: { locale: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const projects = ProjectRecordStore.getInstance().list().slice(0, 3);
  const featuredProject = projects[0];
  return (
    <div className="-mx-4 -mt-8 overflow-hidden bg-[#f6f5ef] text-[#182923]">
      <section className="relative isolate px-5 pb-20 pt-16 sm:px-10 sm:pb-28 sm:pt-24 lg:px-16">
        <div
          aria-hidden="true"
          className="absolute -right-24 -top-40 -z-10 h-[34rem] w-[34rem] rounded-full bg-[#d8e8dc] opacity-60 blur-3xl"
        />
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#bfd2c3] bg-white/70 px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#356b56]">
              <span className="h-2 w-2 rounded-full bg-[#4b8b69]" />
              Community-led project accountability
            </div>
            <h1 className="max-w-2xl text-5xl font-semibold leading-[1.04] tracking-[-0.045em] sm:text-6xl lg:text-[4.4rem]">
              Good work deserves to be{' '}
              <em className="font-serif text-[#38745d]">seen.</em>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-[#596860]">
              Promiscope helps communities follow local projects from promise to
              progress—with clear updates, supporting evidence, and a place for
              people to be heard.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/projects"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#245d49] px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#194a39] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#245d49]"
              >
                Explore projects <ArrowRight size={16} />
              </Link>
              <Link
                href="/organizations"
                className="inline-flex items-center justify-center rounded-full border border-[#b8c7bd] bg-white/60 px-6 py-3.5 text-sm font-semibold text-[#245d49] transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#245d49]"
              >
                For project teams
              </Link>
            </div>
            <p className="mt-4 text-xs text-[#7b8980]">
              Project records are public statements; Promiscope does not
              independently verify claims.
            </p>
          </div>

          <div className="relative mx-auto w-full max-w-lg">
            <div className="absolute -left-7 top-12 hidden h-24 w-24 rounded-full border border-[#c6d7c9] sm:block" />
            <div className="relative rounded-[2rem] border border-[#e0e5dc] bg-white p-5 shadow-[0_24px_70px_-36px_rgba(27,62,46,0.34)] sm:p-7">
              <div className="flex items-start justify-between gap-4 border-b border-[#edf0ea] pb-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.13em] text-[#728078]">
                    {featuredProject
                      ? featuredProject.category
                      : 'Project record preview'}
                  </p>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight">
                    {featuredProject?.title ?? 'Your project, clearly recorded'}
                  </h2>
                  <p className="mt-1 flex items-center gap-1 text-sm text-[#758179]">
                    <MapPin size={14} />{' '}
                    {featuredProject?.location ??
                      'Commitments · milestones · updates'}
                  </p>
                </div>
                <span className="rounded-full bg-[#e6f1e9] px-3 py-1.5 text-xs font-semibold capitalize text-[#317052]">
                  {featuredProject?.status ?? 'Start here'}
                </span>
              </div>
              <div className="py-5">
                <div className="flex items-end justify-between">
                  <span className="text-sm font-medium text-[#536159]">
                    Milestones complete
                  </span>
                  <span className="text-2xl font-semibold text-[#245d49]">
                    {featuredProject ? `${featuredProject.progress}%` : '—'}
                  </span>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[#e9eee8]">
                  <div
                    className="h-full rounded-full bg-[#4b8b69]"
                    style={{ width: `${featuredProject?.progress ?? 0}%` }}
                  />
                </div>
              </div>
              <div className="rounded-2xl bg-[#f5f7f2] p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#dcecdf] text-[#317052]">
                    <FileCheck2 size={17} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">
                      {featuredProject?.firstMilestoneTitle ??
                        'Clear milestones'}
                    </p>
                    <p className="mt-0.5 text-xs text-[#758179]">
                      {featuredProject
                        ? 'Owner-reported milestone status'
                        : 'Define specific outcomes to track'}
                    </p>
                  </div>
                </div>
                <p className="mt-3 border-l-2 border-[#8fb59a] pl-3 text-sm leading-6 text-[#596860]">
                  {featuredProject?.commitment ??
                    'Publish the commitment, then add updates and supporting links as work progresses.'}
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-[#758179]">
                <span>
                  {featuredProject
                    ? `${featuredProject.completedMilestones} of ${featuredProject.milestoneCount} complete`
                    : 'Wallet-attributed record'}
                </span>
                <span className="flex items-center gap-1">
                  <Eye size={13} /> Public record
                </span>
              </div>
            </div>
            <div className="absolute -bottom-5 -right-3 rounded-2xl border border-[#dce7dc] bg-white px-4 py-3 shadow-lg sm:-right-7">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#829087]">
                The record
              </p>
              <p className="mt-1 text-sm font-semibold text-[#245d49]">
                Promise → evidence → review
              </p>
            </div>
          </div>
        </div>
      </section>

      <section
        id="how-it-works"
        className="border-y border-[#e5e8df] bg-white px-5 py-16 sm:px-10 sm:py-20 lg:px-16"
      >
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#528067]">
              How Promiscope works
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              A shared record, built as the work happens.
            </h2>
            <p className="mt-4 text-base leading-7 text-[#647168]">
              Teams, funders, and community reviewers can follow the same
              project history and understand what has—and has not—been
              confirmed.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {steps.map(({ icon: Icon, number, title, description }) => (
              <article
                key={number}
                className="rounded-3xl border border-[#e5e9e1] bg-[#fbfcf9] p-6 sm:p-7"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e7f0e8] text-[#397457]">
                    <Icon size={20} />
                  </span>
                  <span className="font-mono text-xs text-[#9aa69d]">
                    {number}
                  </span>
                </div>
                <h3 className="mt-6 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-[#647168]">
                  {description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-16 sm:px-10 sm:py-20 lg:px-16">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#528067]">
                A clearer view of local work
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                Projects people can follow.
              </h2>
            </div>
            <Link
              href="/projects"
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#2b6b50] hover:text-[#194a39]"
            >
              Browse projects <ArrowRight size={16} />
            </Link>
          </div>
          {projects.length ? (
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/${params.locale}/projects/${project.slug}`}
                  className="group block rounded-3xl border border-[#e0e5dc] bg-white p-5 shadow-[0_12px_36px_-30px_rgba(27,62,46,0.4)] transition hover:-translate-y-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#245d49]"
                >
                  <p className="text-xs font-medium text-[#718078]">
                    {project.category} · {project.location}
                  </p>
                  <h3 className="mt-2 text-lg font-semibold">
                    {project.title}
                  </h3>
                  <p className="mt-2 text-sm text-[#647168]">
                    {project.organization}
                  </p>
                  <div className="mt-5 flex items-center justify-between text-xs text-[#647168]">
                    <span className="capitalize">{project.status}</span>
                    <span className="font-semibold text-[#2b6b50]">
                      {project.progress}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-[#edf0ea]">
                    <div
                      className="h-1.5 rounded-full bg-[#4b8b69]"
                      style={{ width: `${project.progress}%` }}
                    />
                  </div>
                  <p className="mt-4 flex items-center justify-between border-t border-[#edf0ea] pt-4 text-[11px] text-[#8a968e]">
                    <span>Open public record</span>
                    <ArrowRight
                      size={14}
                      className="transition-transform group-hover:translate-x-1"
                      aria-hidden="true"
                    />
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-8 rounded-3xl border border-dashed border-[#cbd8ca] bg-white/70 p-8 text-sm text-[#647168]">
              No projects have been published yet.{' '}
              <Link
                className="font-semibold text-[#245d49] underline"
                href={`/${params.locale}/projects`}
              >
                Create the first record.
              </Link>
            </p>
          )}
        </div>
      </section>

      <section className="px-5 pb-16 sm:px-10 sm:pb-20 lg:px-16">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 rounded-[2rem] bg-[#204e3d] px-7 py-9 text-white sm:flex-row sm:items-center sm:px-10 sm:py-11">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#b7d5bf]">
              For organizations and community teams
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              Make every update easier to follow.
            </h2>
            <p className="mt-3 text-sm leading-6 text-[#d6e4da]">
              Keep milestones, supporting evidence, reviewer feedback, and
              responses together in one project record.
            </p>
          </div>
          <Link
            href="/organizations"
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#204e3d] transition hover:bg-[#eaf2eb]"
          >
            See the workflow <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <footer className="border-t border-[#e3e7df] bg-[#f6f5ef] px-5 py-7 text-sm text-[#738078] sm:px-10 lg:px-16">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} Promiscope. Promises in view. Progress
            on record.
          </p>
          <p className="text-xs">
            A community project accountability platform.
          </p>
        </div>
      </footer>
    </div>
  );
}
