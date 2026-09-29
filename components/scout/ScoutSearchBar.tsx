'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getPlayer } from '@/lib/contract';
import EmptyState from '@/components/ui/EmptyState';
import type { Player } from '@/types';

function isStellarKey(v: string) {
  return /^G[A-Z2-7]{55}$/.test(v);
}

interface ScoutSearchBarProps {
  nameQuery: string;
  onNameQueryChange: (value: string) => void;
  /** Seconds left on a search rate limit, or null when not limited. */
  remainingSec: number | null;
  /** True once a name search has completed with no matches. */
  showNoNameMatches: boolean;
  /** Renders the player found by wallet-address lookup. */
  renderPlayer: (player: Player) => ReactNode;
}

/**
 * Wallet-address lookup and the typeahead player-name search input (#554)
 * for the scout dashboard. Name matching itself runs server-side through
 * useScout().searchByName; this component only owns the inputs.
 */
export default function ScoutSearchBar({
  nameQuery,
  onNameQueryChange,
  remainingSec,
  showNoNameMatches,
  renderPlayer,
}: ScoutSearchBarProps) {
  const [walletQuery, setWalletQuery] = useState('');
  const [searchResult, setSearchResult] = useState<
    Player | null | 'not-found' | 'invalid'
  >(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!walletQuery) {
      setSearchResult(null);
      return;
    }

    if (!isStellarKey(walletQuery)) {
      setSearchResult('invalid');
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const result = await getPlayer(walletQuery);
        setSearchResult(result ? (result as Player) : 'not-found');
      } catch {
        setSearchResult('not-found');
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [walletQuery]);

  return (
    <>
      <div
        className="bg-brand-card border border-gray-800 rounded-xl p-5 flex flex-col gap-3"
        data-tour="search-section"
      >
        <label
          className="text-sm font-medium text-gray-300"
          htmlFor="wallet-search"
        >
          Search by Wallet Address
        </label>
        <input
          id="wallet-search"
          className="input"
          placeholder="G... (56-character Stellar public key)"
          value={walletQuery}
          onChange={(e) => setWalletQuery(e.target.value.trim())}
          autoComplete="off"
          spellCheck={false}
        />
        {walletQuery && (
          <div className="mt-1">
            {searchLoading && (
              <p className="text-sm text-gray-400">Searching…</p>
            )}
            {!searchLoading && searchResult === 'invalid' && (
              <p className="text-sm text-red-400">
                Invalid Stellar address — must be a 56-character key starting
                with G.
              </p>
            )}
            {!searchLoading && searchResult === 'not-found' && (
              <EmptyState
                title="No players found"
                description="No player is registered with that wallet address."
              />
            )}
            {!searchLoading &&
              searchResult &&
              searchResult !== 'invalid' &&
              searchResult !== 'not-found' && (
                <div className="mt-2 max-w-sm">
                  {renderPlayer(searchResult)}
                </div>
              )}
          </div>
        )}
      </div>

      <div className="bg-brand-card border border-gray-800 rounded-xl p-5 flex flex-col gap-3">
        <label
          className="text-sm font-medium text-gray-300"
          htmlFor="name-search"
        >
          Search by Player Name
        </label>
        <input
          id="name-search"
          className="input"
          placeholder="e.g. Amara Diallo"
          value={nameQuery}
          onChange={(e) => onNameQueryChange(e.target.value)}
          autoComplete="off"
          disabled={remainingSec !== null}
        />
        {remainingSec !== null && (
          <p className="text-sm text-orange-400">
            Rate limited. Try again in {remainingSec}s.
          </p>
        )}
        {nameQuery && showNoNameMatches && (
          <EmptyState
            title="No players found"
            description={`No players match "${nameQuery}".`}
          />
        )}
      </div>
    </>
  );
}
