'use client';
import { useState } from 'react';
import { useSavedSearchNewCount } from '@/hooks/useSavedSearches';
import type { PlayerFilter, SavedSearch } from '@/types';

/** Badge showing how many players matching a saved search appeared since it was last viewed (#1149). */
function SavedSearchNewBadge({
  filter,
  lastViewedAt,
}: {
  filter: PlayerFilter;
  lastViewedAt: number;
}) {
  const newCount = useSavedSearchNewCount(filter, lastViewedAt);
  if (newCount === 0) return null;
  return (
    <span className="shrink-0 rounded-full bg-brand-green/20 px-2 py-0.5 text-xs font-medium text-brand-green">
      {newCount} new
    </span>
  );
}

interface SavedSearchesMenuProps {
  searches: SavedSearch[];
  onApply: (search: SavedSearch) => void;
  onRename: (id: number, name: string) => void;
  onRemove: (search: SavedSearch) => void;
}

/** Apply, rename and delete saved searches (#551); renders nothing when empty. */
export default function SavedSearchesMenu({
  searches,
  onApply,
  onRename,
  onRemove,
}: SavedSearchesMenuProps) {
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  if (searches.length === 0) return null;

  function commitRename(id: number) {
    const trimmed = renameValue.trim();
    if (trimmed) {
      onRename(id, trimmed);
    }
    setRenamingId(null);
  }

  return (
    <div className="bg-brand-card border border-gray-800 rounded-xl p-5 flex flex-col gap-3">
      <h2 className="text-sm font-medium text-gray-300">Saved Searches</h2>
      <ul className="flex flex-col gap-2">
        {searches.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-3 text-sm text-gray-200"
          >
            {renamingId === s.id ? (
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <input
                  className="input flex-1 min-w-0"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitRename(s.id);
                    }
                    if (e.key === 'Escape') {
                      setRenamingId(null);
                    }
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => commitRename(s.id)}
                  disabled={!renameValue.trim()}
                  className="px-3 py-1 rounded-lg border border-brand-green text-xs text-brand-green disabled:opacity-40 hover:bg-brand-green hover:text-black transition"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setRenamingId(null)}
                  className="px-3 py-1 rounded-lg border border-gray-700 text-xs text-gray-300 hover:border-gray-500 transition"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <span className="flex items-center gap-2 truncate">
                  <span className="truncate">{s.name}</span>
                  <SavedSearchNewBadge
                    filter={s.filter}
                    lastViewedAt={s.lastViewedAt}
                  />
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onApply(s)}
                    className="px-3 py-1 rounded-lg border border-brand-green text-xs text-brand-green hover:bg-brand-green hover:text-black transition"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRenameValue(s.name);
                      setRenamingId(s.id);
                    }}
                    className="px-3 py-1 rounded-lg border border-gray-700 text-xs text-gray-300 hover:border-yellow-500 hover:text-yellow-400 transition"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(s)}
                    className="px-3 py-1 rounded-lg border border-gray-700 text-xs text-gray-300 hover:border-red-500 hover:text-red-400 transition"
                  >
                    Remove
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
