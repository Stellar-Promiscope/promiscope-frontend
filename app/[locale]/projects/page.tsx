import Link from 'next/link';
import { ArrowLeft, ArrowRight, MapPin } from 'lucide-react';
import CreateProjectForm from '@/components/projects/CreateProjectForm';
import { ProjectRecordStore } from '@/lib/projectRecordStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default function ProjectsPage({
  params,
}: {
  params: { locale: string };
}) {
  const projects = ProjectRecordStore.getInstance().list();
  const { locale } = params;
  return (
    <main className="-mx-4 -mt-8 min-h-[80vh] bg-[#f6f5ef] px-5 py-12 text-[#182923] sm:px-10 sm:py-16 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <Link
          href={`/${locale}`}
          className="inline-flex items-center gap-2 text-sm font-medium text-[#52705e] hover:text-[#204e3d]"
        >
          <ArrowLeft size={16} /> Home
        </Link>
        <div className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#528067]">
            Project directory
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
            Follow the work.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-[#647168]">
            Public project commitments, milestones, dated progress updates, and
            community responses in one record.
          </p>
        </div>

        <CreateProjectForm locale={locale} />

        <section className="mt-10" aria-labelledby="published-projects">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[#728078]">
                Public records
              </p>
              <h2
                id="published-projects"
                className="mt-2 text-2xl font-semibold"
              >
                Published projects
              </h2>
            </div>
            <span className="text-sm text-[#78847b]">
              {projects.length} {projects.length === 1 ? 'project' : 'projects'}
            </span>
          </div>
          {projects.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-dashed border-[#cbd8ca] bg-white/70 p-8 text-center sm:p-12">
              <h3 className="text-lg font-semibold">No project records yet</h3>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#68766d]">
                Create the first record with a clear commitment and measurable
                milestones. A connected Stellar wallet identifies the publisher;
                it does not verify project claims.
              </p>
            </div>
          ) : (
            <div className="mt-5 grid gap-5 lg:grid-cols-3">
              {projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/${locale}/projects/${project.slug}`}
                  className="group block rounded-3xl border border-[#e0e5dc] bg-white p-6 shadow-[0_16px_40px_-34px_rgba(27,62,46,0.5)] transition hover:-translate-y-1 hover:shadow-[0_20px_44px_-30px_rgba(27,62,46,0.6)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#245d49]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="rounded-full bg-[#e5efe5] px-3 py-1.5 text-xs font-semibold capitalize text-[#31664b]">
                      {project.status}
                    </span>
                    <span className="text-xs text-[#78847b]">
                      {project.progress}% complete
                    </span>
                  </div>
                  <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-[#728078]">
                    {project.category}
                  </p>
                  <h3 className="mt-2 text-xl font-semibold tracking-tight">
                    {project.title}
                  </h3>
                  <p className="mt-1 text-sm font-medium text-[#506457]">
                    {project.organization}
                  </p>
                  <p className="mt-3 flex items-center gap-1.5 text-sm text-[#758179]">
                    <MapPin size={14} />
                    {project.location}
                  </p>
                  <p className="mt-4 min-h-12 text-sm leading-6 text-[#647168]">
                    {project.summary}
                  </p>
                  <div className="mt-5 h-1.5 rounded-full bg-[#edf0ea]">
                    <div
                      className="h-1.5 rounded-full bg-[#4b8b69]"
                      style={{ width: `${project.progress}%` }}
                    />
                  </div>
                  <div className="mt-5 flex items-center justify-between border-t border-[#edf0ea] pt-4 text-xs text-[#7e8981]">
                    <span>
                      {project.milestoneCount} milestones ·{' '}
                      {project.updateCount} updates
                    </span>
                    <ArrowRight
                      size={15}
                      aria-hidden="true"
                      className="transition-transform group-hover:translate-x-1"
                    />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
        <p className="mt-8 max-w-3xl text-xs leading-5 text-[#849087]">
          Records and responses are public. Wallet attribution shows which
          account submitted an entry; it does not establish a person’s identity
          or independently verify claims or evidence.
        </p>
      </div>
    </main>
  );
}
