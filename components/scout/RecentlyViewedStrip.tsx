import Link from 'next/link';
import type { RecentlyViewedEntry } from '@/types';

/** Recently viewed players on the scout dashboard; renders nothing when empty. */
export default function RecentlyViewedStrip({
  entries,
}: {
  entries: RecentlyViewedEntry[];
}) {
  if (entries.length === 0) return null;
  return (
    <div className="bg-brand-card border border-gray-800 rounded-xl p-5 flex flex-col gap-3">
      <h2 className="text-sm font-medium text-gray-300">Recently Viewed</h2>
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li
            key={entry.playerId}
            className="flex items-center justify-between gap-3 text-sm text-gray-200"
          >
            <Link
              href={`/player/${entry.playerId}`}
              className="text-brand-green hover:underline truncate"
            >
              {entry.name}
            </Link>
            <span className="text-xs text-gray-500 shrink-0">
              {entry.position}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
