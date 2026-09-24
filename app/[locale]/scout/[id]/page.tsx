import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { Scout } from '@/types';
import { fetchScoutProfile } from '@/lib/api';
import ActivityFeed from '@/components/scout/ActivityFeed';
import ScoutProfileCard from '@/components/scout/ScoutProfileCard';
import EmptyState from '@/components/ui/EmptyState';

type PageProps = {
  params: {
    locale: string;
    id: string;
  };
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const t = await getTranslations({
    locale: params.locale,
    namespace: 'scout.profile',
  });
  return { title: t('meta_title'), description: t('meta_description') };
}

// Non-async so they can use useTranslations; the async page below only
// fetches data.
function ScoutNotFound() {
  const t = useTranslations('scout.profile');
  return (
    <div className="max-w-3xl mx-auto py-16 px-4">
      <EmptyState
        title={t('not_found_title')}
        description={t('not_found_description')}
      />
    </div>
  );
}

function ScoutProfileHeader() {
  const t = useTranslations('scout.profile');
  return (
    <div className="space-y-3">
      <h1 className="text-3xl font-bold text-white">{t('title')}</h1>
      <p className="text-sm text-gray-400">{t('description')}</p>
    </div>
  );
}

async function loadScoutProfile(scoutId: string): Promise<Scout | null> {
  try {
    return await fetchScoutProfile(scoutId);
  } catch {
    return null;
  }
}

export default async function ScoutProfilePage({ params }: PageProps) {
  const scout = await loadScoutProfile(params.id);

  if (!scout) return <ScoutNotFound />;

  return (
    <main className="max-w-5xl mx-auto py-10 px-4 flex flex-col gap-8">
      <ScoutProfileHeader />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          <ScoutProfileCard scout={scout} />
          <ActivityFeed scoutId={scout.id} />
        </div>
      </div>
    </main>
  );
}
