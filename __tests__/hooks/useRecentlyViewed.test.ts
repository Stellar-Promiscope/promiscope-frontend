import { renderHook, act } from '@testing-library/react';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';

// These tests exercise the anonymous (localStorage-only) path — stub the
// wallet so the hook doesn't need a WalletProvider and stays on that path.
jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({ publicKey: null }),
}));

const STORAGE_KEY = 'promiscope_recently_viewed';

beforeEach(() => {
  localStorage.clear();
});

describe('useRecentlyViewed', () => {
  it('starts empty when nothing is stored', () => {
    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current.entries).toEqual([]);
  });

  it('records a visit, newest first', () => {
    const { result } = renderHook(() => useRecentlyViewed());

    act(() => {
      result.current.record({
        playerId: 'p1',
        name: 'Amara Diallo',
        position: 'ST',
      });
    });
    act(() => {
      result.current.record({
        playerId: 'p2',
        name: 'Kwame Boateng',
        position: 'GK',
      });
    });

    expect(result.current.entries.map((e) => e.playerId)).toEqual(['p2', 'p1']);
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useRecentlyViewed());

    act(() => {
      result.current.record({
        playerId: 'p1',
        name: 'Amara Diallo',
        position: 'ST',
      });
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].playerId).toBe('p1');
  });

  it('moves a re-viewed player back to the front instead of duplicating it', () => {
    const { result } = renderHook(() => useRecentlyViewed());

    act(() => {
      result.current.record({
        playerId: 'p1',
        name: 'Amara Diallo',
        position: 'ST',
      });
    });
    act(() => {
      result.current.record({
        playerId: 'p2',
        name: 'Kwame Boateng',
        position: 'GK',
      });
    });
    act(() => {
      result.current.record({
        playerId: 'p1',
        name: 'Amara Diallo',
        position: 'ST',
      });
    });

    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries.map((e) => e.playerId)).toEqual(['p1', 'p2']);
  });

  it('caps the list at 10 entries', () => {
    const { result } = renderHook(() => useRecentlyViewed());

    act(() => {
      for (let i = 0; i < 12; i++) {
        result.current.record({
          playerId: `p${i}`,
          name: `Player ${i}`,
          position: 'ST',
        });
      }
    });

    expect(result.current.entries).toHaveLength(10);
    expect(result.current.entries[0].playerId).toBe('p11');
  });

  it('loads previously stored entries on mount', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { playerId: 'p1', name: 'Amara Diallo', position: 'ST', viewedAt: 1 },
      ]),
    );

    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].playerId).toBe('p1');
  });

  it('recovers from corrupted storage', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json');
    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current.entries).toEqual([]);
  });
});
