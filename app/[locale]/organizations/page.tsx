import Link from 'next/link';
import { ArrowRight, Check, CircleHelp, FileCheck2, MessageSquareText } from 'lucide-react';

const benefits = [
  'Publish goals and milestones in plain language',
  'Add dated updates with photos, documents, and context',
  'Invite community reviewers to respond to specific updates',
  'Keep questions, responses, and decisions with the project record',
];

export default function OrganizationsPage() {
  return (
    <div className="-mx-4 -mt-8 min-h-[80vh] bg-[#f6f5ef] px-5 py-12 text-[#182923] sm:px-10 sm:py-16 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_0.85fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#528067]">For project teams and funders</p>
            <h1 className="mt-4 max-w-2xl text-4xl font-semibold leading-tight tracking-[-0.04em] sm:text-5xl">Make the project record useful to everyone involved.</h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-[#647168]">Promiscope is designed to make community project updates easier to follow, review, and respond to—without burying the story in spreadsheets and message threads.</p>
            <Link href="/projects" className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#245d49] px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-[#194a39]">View example records <ArrowRight size={16} /></Link>
          </div>
          <div className="rounded-[2rem] border border-[#e0e5dc] bg-white p-6 shadow-[0_24px_70px_-36px_rgba(27,62,46,0.34)] sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.13em] text-[#728078]">A project record can include</p>
            <ul className="mt-5 space-y-4">
              {benefits.map((benefit) => <li key={benefit} className="flex gap-3 text-sm leading-6 text-[#46584d]"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#e6f1e9] text-[#317052]"><Check size={13} /></span>{benefit}</li>)}
            </ul>
            <div className="mt-7 grid gap-3 border-t border-[#edf0ea] pt-6 sm:grid-cols-2">
              <div className="rounded-2xl bg-[#f5f7f2] p-4"><FileCheck2 size={18} className="text-[#397457]" /><p className="mt-3 text-sm font-semibold">Evidence stays connected</p><p className="mt-1 text-xs leading-5 text-[#758179]">Each update points to its supporting material.</p></div>
              <div className="rounded-2xl bg-[#f5f7f2] p-4"><MessageSquareText size={18} className="text-[#397457]" /><p className="mt-3 text-sm font-semibold">Feedback has a place</p><p className="mt-1 text-xs leading-5 text-[#758179]">Questions and responses remain part of the record.</p></div>
            </div>
          </div>
        </div>
        <div className="mt-12 flex gap-3 rounded-2xl border border-[#dce4da] bg-white/70 p-5 text-sm leading-6 text-[#647168]">
          <CircleHelp size={18} className="mt-0.5 shrink-0 text-[#528067]" />
          <p><strong className="text-[#30473a]">Early product direction:</strong> the pages currently show a design preview. Project creation, evidence review, and organization accounts are not connected yet.</p>
        </div>
      </div>
    </div>
  );
}
