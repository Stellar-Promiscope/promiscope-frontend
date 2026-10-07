import { readFileSync } from 'fs';
import path from 'path';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, Sparkles } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';

interface ChangelogPageProps {
  params: {
    locale: string;
  };
}

type ChangelogSectionType = 'added' | 'improved' | 'fixed';

interface ChangelogEntry {
  title: string;
  date: string;
  sections: Array<{
    type: ChangelogSectionType;
    items: string[];
  }>;
}

function parseChangelogMarkdown(markdown: string): ChangelogEntry[] {
  const lines = markdown.split(/\r?\n/);
  const entries: ChangelogEntry[] = [];
  let currentEntry: ChangelogEntry | null = null;
  let currentSection: ChangelogEntry['sections'][number] | null = null;

  const flushEntry = () => {
    if (currentEntry && currentEntry.sections.length > 0) {
      entries.push(currentEntry);
    }
    currentEntry = null;
    currentSection = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (line.startsWith('## ')) {
      flushEntry();
      const match = line.match(/^##\s+(.+?)\s+-\s+(\d{4}-\d{2}-\d{2})$/);
      if (match) {
        currentEntry = {
          title: match[1].trim(),
          date: match[2],
          sections: [],
        };
      }
      continue;
    }

    if (line.startsWith('### ')) {
      if (!currentEntry) {
        continue;
      }
      const type = line.slice(4).trim().toLowerCase();
      if (type === 'added' || type === 'improved' || type === 'fixed') {
        currentSection = { type: type as ChangelogSectionType, items: [] };
        currentEntry.sections.push(currentSection);
      }
      continue;
    }

    if (line.startsWith('- ')) {
      if (currentEntry && currentSection) {
        currentSection.items.push(line.slice(2).trim());
      }
    }
  }

  flushEntry();
  return entries;
}

function loadChangelogEntries(): ChangelogEntry[] {
  const changelogPath = path.join(process.cwd(), 'content', 'changelog.md');
  try {
    const markdown = readFileSync(changelogPath, 'utf8');
    return parseChangelogMarkdown(markdown);
  } catch {
    return [];
  }
}

export async function generateMetadata({
  params,
}: ChangelogPageProps): Promise<Metadata> {
  const locale = params.locale;
  const t = await getTranslations({ locale, namespace: 'changelog' });

  const { buildPageMetadata } = await import('@/lib/seo');
  return buildPageMetadata({
    title: `${t('page_title')} | Promiscope`,
    description: t('page_description'),
    path: `/${locale}/changelog`,
  });
}

export default async function ChangelogPage({ params }: ChangelogPageProps) {
  const locale = params.locale;
  const t = await getTranslations({ locale, namespace: 'changelog' });
  const changelogEntries = loadChangelogEntries().sort((left, right) => {
    if (left.date === right.date) {
      return left.title.localeCompare(right.title);
    }
    return right.date.localeCompare(left.date);
  });

  return (
    <div className="flex flex-col gap-10 pb-20">
      <section className="relative overflow-hidden rounded-2xl border border-gray-800 bg-brand-card px-6 py-10 sm:px-8 lg:px-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(0,200,83,0.12),_transparent_50%)]" />
        <div className="relative flex flex-col gap-6">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-brand-green/30 bg-brand-green/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-brand-green">
            <Sparkles size={12} />
            {t('eyebrow')}
          </span>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <h1 className="text-3xl font-bold text-white sm:text-4xl">
                {t('page_title')}
              </h1>
              <p className="mt-3 text-sm leading-7 text-gray-400 sm:text-base">
                {t('page_description')}
              </p>
            </div>
            <p className="text-sm text-gray-400">{t('english_notice')}</p>
          </div>
          <div className="flex justify-start">
            <Link
              href={`/${locale}`}
              className="inline-flex items-center gap-2 text-sm font-medium text-brand-green transition hover:text-green-400"
            >
              {t('back_to_home')}
              <ArrowLeft size={15} />
            </Link>
          </div>
        </div>
      </section>

      <section className="px-1 sm:px-0">
        {changelogEntries.length === 0 ? (
          <EmptyState
            title={t('empty_title')}
            description={t('empty_description')}
          />
        ) : (
          <div className="space-y-8">
            {changelogEntries.map((entry) => (
              <article
                key={`${entry.date}-${entry.title}`}
                className="rounded-2xl border border-gray-800 bg-brand-card/70 p-6 shadow-sm"
              >
                <div className="flex flex-col gap-3 border-b border-gray-800 pb-4 sm:flex-row sm:items-baseline sm:justify-between">
                  <h2 className="text-xl font-semibold text-white">
                    <span>{entry.title}</span>
                    <span className="ml-3 text-gray-400">-</span>
                    <time className="ml-3 text-gray-400" dateTime={entry.date}>
                      {entry.date}
                    </time>
                  </h2>
                </div>

                <div className="mt-6 space-y-5">
                  {entry.sections.map((section) => (
                    <div key={`${entry.date}-${section.type}`}>
                      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">
                        {t(section.type)}
                      </h3>
                      <ul className="mt-3 space-y-3 text-sm leading-7 text-gray-300">
                        {section.items.map((item) => (
                          <li key={item} className="flex gap-3">
                            <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-green" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
