import { act, renderHook } from '@testing-library/react';

const mockReplace = jest.fn();
let mockParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockParams,
}));

const mockShow = jest.fn();
jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: mockShow }),
}));

// Pass the value straight through so the debounced name search fires
// synchronously.
jest.mock('@/hooks/useDebounce', () => ({
  useDebounce: (v: unknown) => v,
}));

import {
  useScoutDashboardFilters,
  MAX_COMPARE_PLAYERS,
} from '@/hooks/useScoutDashboardFilters';

function setup(
  overrides: Partial<Parameters<typeof useScoutDashboardFilters>[0]> = {},
) {
  const props = {
    loading: false,
    isRateLimited: false,
    retryAfterSec: null,
    search: jest.fn(),
    searchByName: jest.fn(),
    ...overrides,
  };
  return {
    props,
    ...renderHook((p) => useScoutDashboardFilters(p), { initialProps: props }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = new URLSearchParams();
});

describe('useScoutDashboardFilters', () => {
  it('runs a name search for the (debounced) name query', () => {
    const { result, props } = setup();
    act(() => result.current.setNameQuery('Amara'));
    expect(props.searchByName).toHaveBeenLastCalledWith('Amara');
  });

  it('clears the name query when a structured filter search runs', () => {
    const { result, props } = setup();
    act(() => result.current.setNameQuery('Amara'));
    act(() => result.current.handleSearch({ position: 'FW' } as never));
    expect(result.current.nameQuery).toBe('');
    expect(props.search).toHaveBeenCalledWith({ position: 'FW' });
  });

  it('bumps resetKey and clears the name query on reset', () => {
    const { result } = setup();
    act(() => result.current.setNameQuery('x'));
    act(() => result.current.handleClearFilters());
    expect(result.current.resetKey).toBe(1);
    expect(result.current.nameQuery).toBe('');
  });

  it('starts the rate-limit countdown and warns', () => {
    const { result, rerender, props } = setup();
    rerender({ ...props, isRateLimited: true, retryAfterSec: 4 });
    expect(result.current.remainingSec).toBe(4);
    expect(mockShow).toHaveBeenCalledWith({
      message: 'Searching too fast — please wait 4s and try again.',
      variant: 'warning',
    });
  });

  it('syncs the compare selection to ?ids= and caps it', () => {
    mockParams = new URLSearchParams('ids=a,b');
    const { result } = setup();
    expect(result.current.compareIds).toEqual(['a', 'b']);

    act(() => result.current.toggleCompare('c'));
    expect(mockReplace).toHaveBeenLastCalledWith('?ids=a,b,c');

    act(() => result.current.toggleCompare('d'));
    act(() => result.current.toggleCompare('e'));
    expect(result.current.compareIds).toHaveLength(MAX_COMPARE_PLAYERS);
    expect(mockShow).toHaveBeenCalledWith({
      message: `Maximum ${MAX_COMPARE_PLAYERS} players for comparison`,
      variant: 'info',
    });
  });

  it('reports skeletons only until the first search completes', () => {
    const { result, rerender, props } = setup({ loading: true });
    expect(result.current.showSkeletons).toBe(true);
    rerender({ ...props, loading: false });
    expect(result.current.searchHasCompleted).toBe(true);
    expect(result.current.showSkeletons).toBe(false);
  });
});
