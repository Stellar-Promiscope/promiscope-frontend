import Link from 'next/link';
import { ArrowLeft, ArrowRight, MapPin } from 'lucide-react';
import { projectExamples } from '@/lib/projectExamples';

export default function ProjectsPage({ params }: { params: { locale: string } }) {
  const { locale } = params;
  return (
    <div className="-mx-4 -mt-8 min-h-[80vh] bg-[#f6f5ef] px-5 py-12 text-[#182923] sm:px-10 sm:py-16 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <Link href={`/${locale}`} className="inline-flex items-center gap-2 text-sm font-medium text-[#52705e] hover:text-[#204e3d]"><ArrowLeft size={16} /> Home</Link>
        <div className="mt-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#528067]">Project directory</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Follow the work.</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[#647168]">Each project record brings its commitments, updates, evidence, and community review together in one place.</p>
          </div>
          <span className="w-fit rounded-full border border-[#d4dfd4] bg-white px-3.5 py-2 text-xs font-semibold text-[#52705e]">Illustrative examples</span>
        </div>
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {projectExamples.map((project) => (
            <Link key={project.slug} href={`/${locale}/projects/${project.slug}`} className="group block overflow-hidden rounded-3xl border border-[#e0e5dc] bg-white shadow-[0_16px_40px_-34px_rgba(27,62,46,0.5)] transition hover:-translate-y-1 hover:shadow-[0_20px_44px_-30px_rgba(27,62,46,0.6)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#245d49]">
              <div className="flex h-36 items-end justify-between p-5" style={{ background: `linear-gradient(135deg, ${project.color}1c, ${project.color}55)` }}>
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/90 text-lg font-semibold" style={{ color: project.color }}>{project.letter}</span>
                <span className="rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-[#3c6852]">Example</span>
              </div>
              <div className="p-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#728078]">{project.category}</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight">{project.title}</h2>
                <p className="mt-2 flex items-center gap-1.5 text-sm text-[#758179]"><MapPin size={14} />{project.location}</p>
                <p className="mt-4 min-h-[4.5rem] text-sm leading-6 text-[#647168]">{project.summary}</p>
                <div className="mt-5 flex items-center justify-between text-xs text-[#647168]"><span>{project.status}</span><span className="font-semibold text-[#2b6b50]">{project.progress}%</span></div>
                <div className="mt-2 h-1.5 rounded-full bg-[#edf0ea]"><div className="h-1.5 rounded-full bg-[#4b8b69]" style={{ width: `${project.progress}%` }} /></div>
                <div className="mt-5 flex items-center justify-between border-t border-[#edf0ea] pt-4 text-xs text-[#7e8981]">
                  <span>Open illustrative record</span>
                  <ArrowRight size={15} aria-hidden="true" className="transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            </Link>
          ))}
        </div>
        <p className="mt-8 max-w-3xl text-xs leading-5 text-[#849087]">These fictional examples demonstrate the intended product experience. They do not represent real projects, organizations, or verified claims.</p>
      </div>
    </div>
  );
}
