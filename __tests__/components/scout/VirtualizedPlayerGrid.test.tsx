import React from 'react';
import { render, act, screen } from '@testing-library/react';
import VirtualizedPlayerGrid, {
  useVirtualizedRows,
  PLAYER_GRID_ROW_HEIGHT,
  MAX_MOUNTED_CARDS,
  type VirtualizedPlayerGridHandle,
} from '@/components/scout/VirtualizedPlayerGrid';

// ── ResizeObserver mock ──────────────────────────────────────────────────────
// jsdom does not implement ResizeObserver. We capture the callback passed by
// each instantiation so tests can manually trigger a resize or measurement.
let resizeCallbacks: ResizeObserverCallback[] = [];
let observeSpy: jest.Mock;
let disconnectSpy: jest.Mock;

beforeEach(() => {
  resizeCallbacks = [];
  observeSpy = jest.fn();
  disconnectSpy = jest.fn();
  global.ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
      resizeCallbacks.push(cb);
    }
    observe = observeSpy;
    unobserve = jest.fn();
    disconnect = disconnectSpy;
  } as unknown as typeof ResizeObserver;
});

function fireResize() {
  const cb = resizeCallbacks[0];
  act(() => {
    cb([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
  });
}

interface HarnessProps {
  items: string[];
  rowHeight: number;
  overscan?: number;
  onRender?: (result: ReturnType<typeof useVirtualizedRows<string>>) => void;
}

// A tiny host component so we can exercise the hook through real DOM
// mount/unmount/scroll/resize behaviour instead of relying on renderHook,
// matching how this repo tests hooks that need a real ref'd container.
function Harness({ items, rowHeight, overscan, onRender }: HarnessProps) {
  const result = useVirtualizedRows<string>({ items, rowHeight, overscan });
  onRender?.(result);
  return (
    <div
      ref={result.containerRef}
      data-testid="scroll-container"
      style={{ height: 100 }}
    >
      <div
        style={{ height: result.topSpacerHeight }}
        data-testid="top-spacer"
      />
      {result.visibleItems.map((item, i) => (
        <div key={result.startIndex + i}>{item}</div>
      ))}
      <div
        style={{ height: result.bottomSpacerHeight }}
        data-testid="bottom-spacer"
      />
    </div>
  );
}

describe('useVirtualizedRows', () => {
  it('renders only a windowed slice of items around the viewport', () => {
    const items = Array.from({ length: 100 }, (_, i) => `Item ${i}`);
    let latest: ReturnType<typeof useVirtualizedRows<string>> | undefined;

    render(
      <Harness
        items={items}
        rowHeight={20}
        onRender={(r) => {
          latest = r;
        }}
      />,
    );

    expect(observeSpy).toHaveBeenCalledTimes(1);
    expect(latest).toBeDefined();
    // clientHeight is 0 in jsdom by default, so with scrollTop 0 the
    // viewport-derived window still resolves to a bounded, valid range.
    expect(latest!.startIndex).toBe(0);
    expect(latest!.totalHeight).toBe(items.length * 20);
    expect(latest!.visibleItems.length).toBeLessThanOrEqual(items.length);
    expect(latest!.topSpacerHeight).toBe(0);
  });

  it('shifts the visible window forward as the container scrolls', () => {
    const items = Array.from({ length: 100 }, (_, i) => `Item ${i}`);
    let latest: ReturnType<typeof useVirtualizedRows<string>> | undefined;

    const { getByTestId } = render(
      <Harness
        items={items}
        rowHeight={20}
        overscan={2}
        onRender={(r) => {
          latest = r;
        }}
      />,
    );

    const container = getByTestId('scroll-container');
    Object.defineProperty(container, 'scrollTop', {
      value: 500,
      writable: true,
    });

    act(() => {
      container.dispatchEvent(new Event('scroll'));
    });

    // startIndex = floor(500 / 20) - overscan(2) = 25 - 2 = 23
    expect(latest!.startIndex).toBe(23);
    expect(latest!.topSpacerHeight).toBe(23 * 20);
  });

  it('updates the viewport height when a resize is observed', () => {
    const items = Array.from({ length: 50 }, (_, i) => `Item ${i}`);
    let latest: ReturnType<typeof useVirtualizedRows<string>> | undefined;

    const { getByTestId } = render(
      <Harness
        items={items}
        rowHeight={20}
        onRender={(r) => {
          latest = r;
        }}
      />,
    );

    const container = getByTestId('scroll-container');
    Object.defineProperty(container, 'clientHeight', {
      value: 200,
      configurable: true,
    });

    fireResize();

    // With viewportHeight now 200, more rows should be included in the
    // visible window (endIndex should extend beyond the default of 0).
    expect(latest!.endIndex).toBeGreaterThan(0);
  });

  it('never lets bottomSpacerHeight go negative when the window covers the full list', () => {
    const items = Array.from({ length: 3 }, (_, i) => `Item ${i}`);
    let latest: ReturnType<typeof useVirtualizedRows<string>> | undefined;

    render(
      <Harness
        items={items}
        rowHeight={20}
        overscan={10}
        onRender={(r) => {
          latest = r;
        }}
      />,
    );

    expect(latest!.bottomSpacerHeight).toBe(0);
    expect(latest!.endIndex).toBe(items.length);
  });

  it('cleans up the scroll listener and resize observer on unmount', () => {
    const items = Array.from({ length: 10 }, (_, i) => `Item ${i}`);
    const { unmount } = render(<Harness items={items} rowHeight={20} />);

    unmount();

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});

// ── VirtualizedPlayerGrid (grid-aware wrapper) ────────────────────────────────
//
// Covers issue #781's core acceptance criteria: mounted DOM stays bounded
// for a large item list (not monotonically growing like the old
// append-only "infinite scroll"), and scrolling shifts which items are
// mounted rather than accumulating them.

type TestItem = { id: string; label: string };

function makeItems(count: number): TestItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    label: `Item ${i}`,
  }));
}

describe('VirtualizedPlayerGrid', () => {
  it('keeps mounted DOM nodes bounded for a 500-item list instead of mounting everything', () => {
    const items = makeItems(500);
    render(
      <VirtualizedPlayerGrid<TestItem>
        items={items}
        getKey={(item) => item.id}
        renderItem={(item) => <div role="article">{item.label}</div>}
      />,
    );

    const mounted = screen.getAllByRole('article');
    // jsdom reports clientHeight 0, so only the default overscan window
    // renders — nowhere near the full 500-item list. The exact count isn't
    // the point; that it's small and bounded (not 500) is.
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(20);
  });

  it('keeps mounted DOM nodes bounded at MAX_MOUNTED_CARDS for a 5,000-item list', () => {
    const items = makeItems(5000);
    render(
      <VirtualizedPlayerGrid<TestItem>
        items={items}
        getKey={(item) => item.id}
        renderItem={(item) => <div role="article">{item.label}</div>}
      />,
    );

    const mounted = screen.getAllByRole('article');
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThanOrEqual(MAX_MOUNTED_CARDS);
  });

  it('unmounts off-screen items and mounts newly-visible ones when the container scrolls', () => {
    const items = makeItems(500);
    const { getByTestId } = render(
      <VirtualizedPlayerGrid<TestItem>
        items={items}
        getKey={(item) => item.id}
        renderItem={(item) => <div role="article">{item.label}</div>}
        estimatedRowHeight={20}
        overscan={1}
      />,
    );

    expect(screen.getByText('Item 0')).toBeInTheDocument();
    expect(screen.queryByText('Item 300')).not.toBeInTheDocument();

    const container = getByTestId('player-grid');
    Object.defineProperty(container, 'scrollTop', {
      value: 6000, // row 300 at rowHeight 20
      writable: true,
    });
    act(() => {
      container.dispatchEvent(new Event('scroll'));
    });

    expect(screen.queryByText('Item 0')).not.toBeInTheDocument();
    expect(screen.getByText('Item 300')).toBeInTheDocument();
  });

  it('scrollToItemIndex (imperative handle) scrolls the container to the right offset', () => {
    const items = makeItems(100);
    const ref = React.createRef<VirtualizedPlayerGridHandle>();
    const { getByTestId } = render(
      <VirtualizedPlayerGrid<TestItem>
        ref={ref}
        items={items}
        getKey={(item) => item.id}
        renderItem={(item) => <div role="article">{item.label}</div>}
        estimatedRowHeight={50}
      />,
    );

    act(() => {
      ref.current?.scrollToItemIndex(10);
    });

    // columns default to 1 in jsdom (matchMedia never matches the sm/lg
    // breakpoints), so item 10 is row 10.
    expect(getByTestId('player-grid').scrollTop).toBe(500);
  });

  it('uses the provided data-testid and renders items via renderItem/getKey', () => {
    const items = makeItems(3);
    render(
      <VirtualizedPlayerGrid<TestItem>
        items={items}
        getKey={(item) => item.id}
        renderItem={(item) => <div role="article">{item.label}</div>}
        data-testid="custom-grid"
      />,
    );

    expect(screen.getByTestId('custom-grid')).toBeInTheDocument();
    expect(screen.getByText('Item 0')).toBeInTheDocument();
  });

  it('exports MAX_MOUNTED_CARDS as a reasonable stated bound', () => {
    expect(MAX_MOUNTED_CARDS).toBe(60);
  });
});

// ── Variable-height row measurement ──────────────────────────────────────────

describe('VirtualizedPlayerGrid — variable-height rows', () => {
  it('exports PLAYER_GRID_ROW_HEIGHT as a reasonable default estimate', () => {
    expect(PLAYER_GRID_ROW_HEIGHT).toBeGreaterThan(200);
    expect(PLAYER_GRID_ROW_HEIGHT).toBeLessThan(500);
  });

  it('uses estimatedRowHeight as fallback when no measurement available', () => {
    const items = makeItems(10);
    const { getByTestId } = render(
      <VirtualizedPlayerGrid<TestItem>
        items={items}
        getKey={(item) => item.id}
        renderItem={(item) => <div role="article">{item.label}</div>}
        estimatedRowHeight={100}
      />,
    );

    // The grid rendered — with jsdom clientHeight 0, only a small window
    // is mounted, using the estimated height for spacer calculations.
    const grid = getByTestId('player-grid');
    expect(grid).toBeInTheDocument();
    expect(screen.getAllByRole('article').length).toBeGreaterThan(0);
  });
});

// ── Accessibility: virtualized-out cards are unmounted ────────────────────────

describe('VirtualizedPlayerGrid — accessibility', () => {
  it('virtualized-out cards are removed from the DOM (no stale tab stops)', () => {
    const items = makeItems(200);
    render(
      <VirtualizedPlayerGrid<TestItem>
        items={items}
        getKey={(item) => item.id}
        renderItem={(item) => (
          <div role="article" tabIndex={0}>
            {item.label}
          </div>
        )}
        estimatedRowHeight={20}
        overscan={1}
      />,
    );

    // Only a handful of items are mounted — items far from the viewport
    // are completely unmounted (removed from DOM), so they cannot appear
    // in the tab order or be announced by screen readers.
    const articles = screen.getAllByRole('article');
    expect(articles.length).toBeLessThan(items.length);
    expect(articles.length).toBeLessThanOrEqual(MAX_MOUNTED_CARDS);

    // Verify that a distant item is NOT in the DOM
    expect(screen.queryByText('Item 199')).not.toBeInTheDocument();
  });
});

// ── Infinite-scroll end detection (issue #1298) ───────────────────────────────

describe('VirtualizedPlayerGrid — onEndReached', () => {
  it('fires once when content is within the threshold of the bottom', () => {
    // jsdom reports clientHeight 0, so with 3 rows × 50 px = 150 px of
    // content and the default 240 px threshold, the "bottom" is reached
    // immediately on mount.
    const onEndReached = jest.fn();
    render(
      <VirtualizedPlayerGrid<TestItem>
        items={makeItems(3)}
        getKey={(item) => item.id}
        renderItem={(item) => <div role="article">{item.label}</div>}
        estimatedRowHeight={50}
        hasMore
        onEndReached={onEndReached}
      />,
    );

    expect(onEndReached).toHaveBeenCalledTimes(1);

    // Repeated scroll events while parked at the bottom must not re-fire it
    // (the latch) — a fetch in flight shouldn't be duplicated per tick.
    const container = screen.getByTestId('player-grid');
    act(() => {
      container.dispatchEvent(new Event('scroll'));
      container.dispatchEvent(new Event('scroll'));
    });
    expect(onEndReached).toHaveBeenCalledTimes(1);
  });

  it('never fires when hasMore is false', () => {
    const onEndReached = jest.fn();
    render(
      <VirtualizedPlayerGrid<TestItem>
        items={makeItems(3)}
        getKey={(item) => item.id}
        renderItem={(item) => <div role="article">{item.label}</div>}
        estimatedRowHeight={50}
        hasMore={false}
        onEndReached={onEndReached}
      />,
    );

    expect(onEndReached).not.toHaveBeenCalled();
  });

  it('does not fire while content still overflows the threshold', () => {
    const onEndReached = jest.fn();
    render(
      <VirtualizedPlayerGrid<TestItem>
        items={makeItems(10)}
        getKey={(item) => item.id}
        renderItem={(item) => <div role="article">{item.label}</div>}
        estimatedRowHeight={50} // 500 px total > 240 px threshold
        hasMore
        onEndReached={onEndReached}
      />,
    );

    expect(onEndReached).not.toHaveBeenCalled();

    // Scrolling near the bottom (500 px − 240 px threshold = 260 px) fires it.
    const container = screen.getByTestId('player-grid');
    Object.defineProperty(container, 'scrollTop', {
      value: 300,
      writable: true,
    });
    act(() => {
      container.dispatchEvent(new Event('scroll'));
    });
    expect(onEndReached).toHaveBeenCalledTimes(1);
  });

  it('re-arms after a new page is appended and fires again at the new bottom', () => {
    const onEndReached = jest.fn();
    const items = makeItems(3);
    const { rerender } = render(
      <VirtualizedPlayerGrid<TestItem>
        items={items}
        getKey={(item) => item.id}
        renderItem={(item) => <div role="article">{item.label}</div>}
        estimatedRowHeight={50}
        hasMore
        onEndReached={onEndReached}
      />,
    );
    expect(onEndReached).toHaveBeenCalledTimes(1);

    // Page 2 arrives: more items grow the scroll height past the threshold,
    // which releases the latch.
    rerender(
      <VirtualizedPlayerGrid<TestItem>
        items={makeItems(10)}
        getKey={(item) => item.id}
        renderItem={(item) => <div role="article">{item.label}</div>}
        estimatedRowHeight={50}
        hasMore
        onEndReached={onEndReached}
      />,
    );
    expect(onEndReached).toHaveBeenCalledTimes(1);

    // Scroll into the new bottom → second arrival fires again.
    const container = screen.getByTestId('player-grid');
    Object.defineProperty(container, 'scrollTop', {
      value: 400,
      writable: true,
    });
    act(() => {
      container.dispatchEvent(new Event('scroll'));
    });
    expect(onEndReached).toHaveBeenCalledTimes(2);
  });
});
