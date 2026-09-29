'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AFRICAN_REGIONS_GROUPED } from '@/lib/regions';
import { FOOTBALL_POSITIONS } from '@/lib/positions';
import Select from '@/components/ui/Select';
import type { PlayerFilter, ProgressLevel } from '@/types';

const DEBOUNCE_MS = 300;

const LEVEL_OPTIONS: { label: string; value: ProgressLevel }[] = [
  { label: 'All', value: 0 },
  { label: 'Verified', value: 1 },
  { label: 'Performance', value: 2 },
  { label: 'Elite', value: 3 },
];

interface FilterState {
  region: string;
  position: string;
  level: ProgressLevel;
}

const DEFAULTS: FilterState = { region: '', position: '', level: 0 };

function toPlayerFilter(state: FilterState): PlayerFilter {
  return {
    region: state.region || undefined,
    position: state.position || undefined,
    minLevel: state.level,
  };
}

export interface PlayerFilterFormProps {
  onSearch: (filter: PlayerFilter) => void;
  className?: string;
  /** Increment to imperatively reset all controls and retrigger the search with defaults. */
  resetKey?: number;
  /** When provided, renders a "Save search" control that persists the current filter under a name. */
  onSaveSearch?: (name: string, filter: PlayerFilter) => void;
  /** When true, disables all form controls (e.g., during rate limit countdown). */
  disabled?: boolean;
}

export default function PlayerFilterForm({
  onSearch,
  className = '',
  resetKey = 0,
  onSaveSearch,
  disabled = false,
}: PlayerFilterFormProps) {
  const t = useTranslations('scout_dashboard');
  const router = useRouter();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [filter, setFilter] = useState<FilterState>(() => ({
    region: searchParams.get('region') ?? DEFAULTS.region,
    position: searchParams.get('position') ?? DEFAULTS.position,
    level: Number(searchParams.get('level') ?? DEFAULTS.level) as ProgressLevel,
  }));

  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveSearchName, setSaveSearchName] = useState('');

  // Cancel pending debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, []);

  // Fire an initial search on mount to populate results (restores URL state too)
  useEffect(() => {
    onSearch(toPlayerFilter(filter));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateURL = useCallback(
    (next: FilterState) => {
      const params = new URLSearchParams();
      if (next.region) params.set('region', next.region);
      if (next.position) params.set('position', next.position);
      if (next.level > 0) params.set('level', String(next.level));
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router],
  );

  const scheduleSearch = useCallback(
    (next: FilterState) => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSearch(toPlayerFilter(next));
      }, DEBOUNCE_MS);
    },
    [onSearch],
  );

  const handleChange = useCallback(
    (field: keyof FilterState, raw: string) => {
      const value = field === 'level' ? (Number(raw) as ProgressLevel) : raw;
      const next = { ...filter, [field]: value } as FilterState;
      setFilter(next);
      updateURL(next);
      scheduleSearch(next);
    },
    [filter, updateURL, scheduleSearch],
  );

  const handleSaveSearch = useCallback(() => {
    if (!onSaveSearch) return;
    const name = saveSearchName.trim();
    if (!name) return;
    onSaveSearch(name, toPlayerFilter(filter));
    setSaveSearchName('');
    setShowSaveInput(false);
  }, [onSaveSearch, saveSearchName, filter]);

  const handleReset = useCallback(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    setFilter(DEFAULTS);
    updateURL(DEFAULTS);
    onSearch(toPlayerFilter(DEFAULTS));
  }, [onSearch, updateURL]);

  // When the parent increments resetKey, reset controls and immediately search defaults.
  const prevResetKey = useRef(resetKey);
  useEffect(() => {
    if (prevResetKey.current === resetKey) return;
    prevResetKey.current = resetKey;
    handleReset();
  }, [resetKey, handleReset]);

  return (
    <div
      role="search"
      aria-label="Filter players"
      className={`flex flex-wrap gap-4 items-end ${className}`}
    >
      {/* Region */}
      <Select
        id="filter-region"
        label="Region"
        className="w-44"
        value={filter.region}
        onChange={(e) => handleChange('region', e.target.value)}
        disabled={disabled}
      >
        <option value="">{t('all_regions')}</option>
        {Object.entries(AFRICAN_REGIONS_GROUPED).map(([group, regions]) => (
          <optgroup key={group} label={group}>
            {regions.map(({ label, value }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>

      {/* Position */}
      <Select
        id="filter-position"
        label="Position"
        className="w-40"
        value={filter.position}
        onChange={(e) => handleChange('position', e.target.value)}
        disabled={disabled}
      >
        <option value="">{t('any_position')}</option>
        {FOOTBALL_POSITIONS.map(({ label, value }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>

      {/* Min Level */}
      <Select
        id="filter-level"
        label="Min Level"
        className="w-36"
        value={String(filter.level)}
        onChange={(e) => handleChange('level', e.target.value)}
        disabled={disabled}
      >
        {LEVEL_OPTIONS.map(({ label, value }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>

      {/* Reset */}
      <button
        type="button"
        onClick={handleReset}
        disabled={disabled}
        className="px-4 py-2 rounded-lg border border-gray-700 text-sm text-gray-300 hover:border-brand-green hover:text-white transition disabled:opacity-40"
      >
        Reset Filters
      </button>

      {/* Save search */}
      {onSaveSearch &&
        (showSaveInput ? (
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="save-search-name"
                className="text-xs font-medium text-gray-400"
              >
                Search name
              </label>
              <input
                id="save-search-name"
                className="input w-40"
                value={saveSearchName}
                onChange={(e) => setSaveSearchName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSaveSearch();
                  }
                }}
                placeholder={t('save_search_placeholder')}
                autoFocus
              />
            </div>
            <button
              type="button"
              onClick={handleSaveSearch}
              disabled={!saveSearchName.trim()}
              className="px-4 py-2 rounded-lg border border-brand-green text-sm text-brand-green disabled:opacity-40 hover:bg-brand-green hover:text-black transition"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setShowSaveInput(false);
                setSaveSearchName('');
              }}
              className="px-3 py-2 rounded-lg border border-gray-700 text-sm text-gray-300 hover:border-gray-500 transition"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowSaveInput(true)}
            className="px-4 py-2 rounded-lg border border-gray-700 text-sm text-gray-300 hover:border-brand-green hover:text-white transition"
          >
            Save search
          </button>
        ))}
    </div>
  );
}
