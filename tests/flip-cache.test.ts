// @vitest-environment node
/**
 * tests/flip-cache.test.ts — PageRasterCache's scheduling state machine.
 *
 * Two behaviours here were live defects, and both are invisible in a
 * screenshot but obvious in a timeline:
 *
 * 1. A capture writes to the live page (the `.snapshotting` marker class, and
 *    now inline SVG paint). The host watches that same page for edits, so the
 *    capture's own writes came back as "the user typed", which invalidated the
 *    entry the capture had just produced, which scheduled another capture —
 *    forever. Measured in the running app: 200-300ms of main thread every
 *    ~300ms for as long as a book was open, which is what starved the turn
 *    animation and stretched the landing frames into a visible flicker.
 * 2. Nothing stopped a capture from landing in the middle of a flip.
 *
 * jsdom is not installed (see vitest.config.ts), so the DOM surface the cache
 * touches is faked here — it is small and entirely mechanical.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Captures never reach a real renderer; toCanvas is the seam. */
const captureHooks: { onCapture?: () => void } = {};

vi.mock('html-to-image', () => ({
  getFontEmbedCSS: async () => '',
  toCanvas: async () => {
    // Fires while the marker class is on the element — exactly when the
    // host's MutationObserver would deliver our own write back to us.
    captureHooks.onCapture?.();
    return { width: 100, height: 100 } as unknown as HTMLCanvasElement;
  },
}));

const { PageRasterCache } = await import('../src/flip/rasterCache');

/** Minimal stand-in for a mounted `.nb-sheet-paper`. */
function fakeSheet(): HTMLElement {
  const classes = new Set<string>();
  return {
    isConnected: true,
    clientWidth: 800,
    clientHeight: 1000,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
    },
    querySelectorAll: () => [] as unknown as NodeListOf<Element>,
  } as unknown as HTMLElement;
}

const fakeBitmap = (): ImageBitmap =>
  ({ width: 100, height: 100, close: () => {} }) as unknown as ImageBitmap;

/** Run every pending timer and let the promise chain settle. */
async function flush(): Promise<void> {
  await vi.runAllTimersAsync();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  captureHooks.onCapture = undefined;
  vi.stubGlobal('window', {
    devicePixelRatio: 1,
    // Forward at call time so vitest's fake timers apply.
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => clearTimeout(id),
  });
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('createImageBitmap', async () => fakeBitmap());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PageRasterCache — capture does not re-trigger itself', () => {
  it('ignores edit notifications raised by its own DOM writes', async () => {
    const cache = new PageRasterCache({ getElement: () => fakeSheet() });
    // The watcher fires while the capture holds the page.
    captureHooks.onCapture = () => cache.notifyEdited('p1');

    await cache.ensure('p1');
    await flush();

    // Fresh: the capture's own writes must not have bumped the version.
    expect(cache.isFresh('p1')).toBe(true);
    // …and no follow-up capture may be pending.
    await flush();
    expect(cache.isFresh('p1')).toBe(true);
    cache.dispose();
  });

  it('still invalidates on a genuine edit once the capture is done', async () => {
    const cache = new PageRasterCache({ getElement: () => fakeSheet() });
    await cache.ensure('p1');
    await flush();
    expect(cache.isFresh('p1')).toBe(true);

    cache.notifyEdited('p1');
    expect(cache.isFresh('p1')).toBe(false); // version bumped immediately
    await flush();
    expect(cache.isFresh('p1')).toBe(true); // debounce + idle re-rasterized it
    cache.dispose();
  });
});

describe('PageRasterCache — suspension during a flip', () => {
  it('defers idle captures while suspended and replays them on resume', async () => {
    const staged: string[] = [];
    const cache = new PageRasterCache({
      getElement: () => null, // adjacent pages are never mounted
      captureOffscreen: async (pageId) => {
        staged.push(pageId);
        return fakeBitmap();
      },
    });

    cache.suspend();
    cache.ensureAdjacent(['a', 'b', null, undefined]);
    await flush();
    expect(staged).toEqual([]); // no main-thread work during the turn

    cache.resume();
    await flush();
    expect(staged.sort()).toEqual(['a', 'b']);
    cache.dispose();
  });

  it('parks a capture that was already queued when the flip began', async () => {
    const staged: string[] = [];
    const cache = new PageRasterCache({
      getElement: () => null,
      captureOffscreen: async (pageId) => {
        staged.push(pageId);
        return fakeBitmap();
      },
    });

    cache.ensureAdjacent(['a']); // queued at idle…
    cache.suspend(); // …then a flip starts before it runs
    await flush();
    expect(staged).toEqual([]);

    cache.resume();
    await flush();
    expect(staged).toEqual(['a']);
    cache.dispose();
  });

  it('resume() is a no-op when nothing was suspended', async () => {
    const staged: string[] = [];
    const cache = new PageRasterCache({
      getElement: () => null,
      captureOffscreen: async (pageId) => {
        staged.push(pageId);
        return fakeBitmap();
      },
    });
    cache.resume();
    cache.ensureAdjacent(['a']);
    await flush();
    expect(staged).toEqual(['a']);
    cache.dispose();
  });
});
