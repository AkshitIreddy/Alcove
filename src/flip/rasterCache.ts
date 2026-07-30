/**
 * src/flip/rasterCache.ts — PageRasterCache: pre-rasterized page snapshots.
 *
 * The crux of the hybrid flip (design doc "SNAPSHOT PIPELINE"): pages are
 * captured to ImageBitmaps with html-to-image during idle time so that at
 * pointerdown the texture already exists and the GL overlay can appear the
 * same frame.
 *
 * - `toCanvas` with pixelRatio capped at 2 (1.5 when deviceMemory < 8).
 * - Font-embed CSS built ONCE via getFontEmbedCSS and reused per capture
 *   (the biggest per-capture cost).
 * - `.snapshotting` class added to the captured root during the clone so CSS
 *   can hide caret/selection UI; a `filter` drops chrome elements (drag
 *   handles, style switcher, anything marked data-snapshot-hide).
 * - Edit trigger: notifyEdited() debounces 300ms then rasterizes inside
 *   requestIdleCallback. ensureAdjacent() eagerly captures neighbours when
 *   a spread settles so both flip directions are instant.
 * - LRU cap 6 bitmaps; evicted/replaced bitmaps are close()d.
 * - Monotonic version stamps: invalidate()/notifyEdited() bump the page
 *   version; a flip may knowingly use a ≤300ms-stale frame (doc: accept
 *   stale — content is unreadable mid-flip and landings swap to live DOM).
 */

import { getFontEmbedCSS, toCanvas } from 'html-to-image';
import { LruMap, RASTER_CACHE_CAPACITY, snapshotPixelRatio } from './math';

/** Debounce window between an edit and its idle re-rasterization. */
export const RASTER_DEBOUNCE_MS = 300;

/** tokens.css --paper-cream — snapshot background must match resting CSS. */
const PAPER_CREAM = '#f7f1e3';

/** Marker class while capturing; flip.css hides caret/selection under it. */
const SNAPSHOTTING_CLASS = 'snapshotting';

/** Elements never included in snapshots (interactive chrome, not paper). */
const SNAPSHOT_EXCLUDE_SELECTOR =
  '.nb-drag-handle, .nb-style-switcher, [data-snapshot-hide]';

export interface RasterEntry {
  readonly bitmap: ImageBitmap;
  /** Page version at capture time (compare with `version()` for staleness). */
  readonly version: number;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

export interface PageRasterCacheOptions {
  /**
   * Resolve a pageId to its live snapshot root (the `.nb-sheet-paper` of a
   * mounted leaf). Return null for pages not currently in the DOM — ensure()
   * then resolves null and the flip falls back to plain paper (or an older
   * cached bitmap captured while the page was visible).
   */
  getElement(pageId: string): HTMLElement | null;
  /** LRU capacity override (default 6). */
  capacity?: number;
  /** pixelRatio override (default: device ratio capped per doc). */
  pixelRatio?: number;
}

function defaultPixelRatio(): number {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return snapshotPixelRatio(window.devicePixelRatio || 1, memory);
}

type IdleHandle = { cancel(): void };

/** requestIdleCallback with a setTimeout fallback (and cancellation). */
function whenIdle(fn: () => void): IdleHandle {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(() => fn(), { timeout: 1000 });
    return { cancel: () => cancelIdleCallback(id) };
  }
  const id = window.setTimeout(fn, 50);
  return { cancel: () => window.clearTimeout(id) };
}

export class PageRasterCache {
  private readonly entries: LruMap<string, RasterEntry>;
  private readonly versions = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<RasterEntry | null>>();
  private readonly debounceTimers = new Map<string, number>();
  private readonly idleHandles = new Set<IdleHandle>();
  private fontCss: Promise<string> | undefined;
  private readonly pixelRatio: number;
  private disposed = false;

  constructor(private readonly options: PageRasterCacheOptions) {
    this.pixelRatio = options.pixelRatio ?? defaultPixelRatio();
    this.entries = new LruMap(options.capacity ?? RASTER_CACHE_CAPACITY, (_id, entry) =>
      entry.bitmap.close(),
    );
  }

  /** Current edit version of a page (0 until first invalidation). */
  version(pageId: string): number {
    return this.versions.get(pageId) ?? 0;
  }

  /** Cached bitmap, if any (marks it most-recently-used). May be stale. */
  get(pageId: string): RasterEntry | undefined {
    return this.entries.get(pageId);
  }

  /**
   * Cached bitmap WITHOUT touching LRU order — consumers that merely
   * observe (the thumbnails strip) must not evict flip-critical neighbours.
   */
  peek(pageId: string): RasterEntry | undefined {
    return this.entries.peek(pageId);
  }

  /** Whether the cached bitmap matches the page's current version. */
  isFresh(pageId: string): boolean {
    const entry = this.entries.peek(pageId);
    return entry !== undefined && entry.version === this.version(pageId);
  }

  /**
   * Mark a page dirty without scheduling a capture (e.g. page deleted or
   * about to remount). The stale bitmap stays usable until re-captured.
   */
  invalidate(pageId: string): void {
    this.versions.set(pageId, this.version(pageId) + 1);
  }

  /** Drop a page's bitmap entirely (closes it). */
  drop(pageId: string): void {
    this.entries.delete(pageId);
  }

  /**
   * Edit trigger (doc policy): bump version, debounce 300ms, then rasterize
   * during idle time. Coalesces bursts of edits into one capture.
   */
  notifyEdited(pageId: string): void {
    if (this.disposed) return;
    this.invalidate(pageId);
    const existing = this.debounceTimers.get(pageId);
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      this.debounceTimers.delete(pageId);
      const handle = whenIdle(() => {
        this.idleHandles.delete(handle);
        void this.ensure(pageId);
      });
      this.idleHandles.add(handle);
    }, RASTER_DEBOUNCE_MS);
    this.debounceTimers.set(pageId, timer);
  }

  /**
   * Guarantee a bitmap exists (and is fresh) for `pageId`. Resolves the
   * cached entry when fresh, otherwise captures. Resolves null when the
   * page has no mounted element. Concurrent calls share one capture.
   */
  ensure(pageId: string): Promise<RasterEntry | null> {
    if (this.disposed) return Promise.resolve(null);
    if (this.isFresh(pageId)) return Promise.resolve(this.entries.get(pageId) ?? null);
    const pending = this.inflight.get(pageId);
    if (pending) return pending;
    const capture = this.capture(pageId).finally(() => this.inflight.delete(pageId));
    this.inflight.set(pageId, capture);
    return capture;
  }

  /**
   * Eagerly snapshot a settled spread and its neighbours (doc: the two pages
   * behind the right leaf and the two before the left leaf) so both flip
   * directions start instantly. Runs at idle; null/undefined ids are skipped.
   */
  ensureAdjacent(pageIds: ReadonlyArray<string | null | undefined>): void {
    if (this.disposed) return;
    for (const pageId of pageIds) {
      if (!pageId) continue;
      const handle = whenIdle(() => {
        this.idleHandles.delete(handle);
        void this.ensure(pageId);
      });
      this.idleHandles.add(handle);
    }
  }

  /** Cancel pending work and close every bitmap (call on book close). */
  dispose(): void {
    this.disposed = true;
    for (const timer of this.debounceTimers.values()) window.clearTimeout(timer);
    this.debounceTimers.clear();
    for (const handle of this.idleHandles) handle.cancel();
    this.idleHandles.clear();
    this.entries.clear();
    this.versions.clear();
  }

  /* ------------------------------ internals ------------------------------ */

  private async capture(pageId: string): Promise<RasterEntry | null> {
    const element = this.options.getElement(pageId);
    if (!element || !element.isConnected) return null;
    const versionAtStart = this.version(pageId);

    // Font-embed CSS is built once for the whole app lifetime and reused —
    // per the doc this removes the biggest per-capture cost.
    this.fontCss ??= getFontEmbedCSS(element).catch(() => '');
    const fontEmbedCSS = await this.fontCss;

    element.classList.add(SNAPSHOTTING_CLASS);
    let canvas: HTMLCanvasElement;
    try {
      canvas = await toCanvas(element, {
        pixelRatio: this.pixelRatio,
        backgroundColor: PAPER_CREAM,
        fontEmbedCSS,
        filter: (node: HTMLElement) =>
          typeof node.matches !== 'function' || !node.matches(SNAPSHOT_EXCLUDE_SELECTOR),
      });
    } catch {
      return null; // snapshot failure → caller falls back (doc: CSS path)
    } finally {
      element.classList.remove(SNAPSHOTTING_CLASS);
    }
    if (this.disposed) return null;

    const bitmap = await createImageBitmap(canvas);
    if (this.disposed) {
      bitmap.close();
      return null;
    }
    const entry: RasterEntry = {
      bitmap,
      version: versionAtStart,
      width: canvas.width,
      height: canvas.height,
      pixelRatio: this.pixelRatio,
    };
    this.entries.set(pageId, entry);
    return entry;
  }
}
