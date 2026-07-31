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
 *   handles, style switcher, anything marked data-snapshot-hide) and images
 *   that cannot inline (still-resolving media) fall back to a transparent
 *   placeholder rather than rejecting the whole capture.
 * - Inline SVG (diagrams) gets its class-based paint inlined for the duration
 *   of the capture — html-to-image does not carry stylesheet rules into an
 *   SVG subtree and unstyled shapes render BLACK (see svgSnapshot.ts).
 * - Those live-DOM writes are guarded so the host's edit watcher does not
 *   read them back as an edit and re-trigger the capture forever.
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
import { inlineSvgStyles } from './svgSnapshot';

/** Debounce window between an edit and its idle re-rasterization. */
export const RASTER_DEBOUNCE_MS = 300;

/** tokens.css --paper-cream — snapshot background must match resting CSS. */
const PAPER_CREAM = '#f7f1e3';

/** Marker class while capturing; flip.css hides caret/selection under it. */
const SNAPSHOTTING_CLASS = 'snapshotting';

/** Elements never included in snapshots (interactive chrome, not paper). */
const SNAPSHOT_EXCLUDE_SELECTOR =
  '.nb-drag-handle, .nb-style-switcher, .nb-page-full-hint, [data-snapshot-hide]';

/**
 * 1×1 transparent PNG — stand-in for images that fail to inline.
 *
 * `backgroundColor` fills the canvas with cream before the clone is drawn,
 * so a placeholder normally lands on paper. It is still the one deliberate
 * source of alpha in a snapshot, and the curl shader treats any transparent
 * texel as cream (see samplePage in flip/curl.ts) — never as black, which is
 * what sampling premultiplied .rgb alone used to give.
 */
const TRANSPARENT_PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABijPjAAAAAABJRU1ErkJggg==';

/**
 * Skip chrome and un-embeddable images. An `<img>` with an empty src (a
 * media node still resolving its asset) makes html-to-image's inline step
 * reject with a bare error Event; a rejected capture leaves NO cache entry,
 * so beginFlip's synchronous get() finds nothing and that face of the flip
 * renders blank cream for the whole gesture. Same recipe as the exporter
 * (script/exporters/capture.ts) and the offscreen staging (offscreenPages.ts).
 */
function snapshotFilter(node: HTMLElement): boolean {
  if (
    node instanceof HTMLImageElement &&
    (node.getAttribute('src') ?? '') === ''
  ) {
    return false;
  }
  return (
    typeof node.matches !== 'function' ||
    !node.matches(SNAPSHOT_EXCLUDE_SELECTOR)
  );
}

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
   * mounted leaf). Return null for pages not currently in the DOM — those
   * go through `captureOffscreen` when provided, otherwise ensure()
   * resolves null and the flip falls back to plain paper (or an older
   * cached bitmap captured while the page was visible).
   */
  getElement(pageId: string): HTMLElement | null;
  /**
   * Rasterize a page that has no mounted leaf (the adjacent spread, which
   * is never in the DOM at rest). The flip's back and revealed faces come
   * from this path — without it they fall back to blank cream. The returned
   * bitmap enters the same LRU/version bookkeeping as a live capture;
   * ownership passes to the cache (it will be close()d on eviction).
   */
  captureOffscreen?(pageId: string): Promise<ImageBitmap | null>;
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

  /**
   * Pages whose live DOM this cache is mutating right now. A capture toggles
   * `.snapshotting` on the sheet and inlines SVG paint styles inside it — all
   * attribute writes, which the host's edit watcher (FlipSurface's
   * MutationObserver) reads as "the user edited this page". That bumped the
   * version, which made the fresh entry instantly stale, which scheduled
   * another capture: a self-feeding loop that re-rasterized both live pages
   * forever, ~200-300ms of main thread every ~300ms, for as long as a book
   * was open. Everything downstream (flip smoothness, landing frames) was
   * starved by it. notifyEdited ignores a page while it is in here.
   */
  private readonly capturing = new Set<string>();

  /** Idle captures deferred by suspend(), replayed on resume(). */
  private readonly deferred = new Set<string>();
  private suspended = false;

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
    // Our own capture is mutating that page's DOM; treating it as an edit
    // would restart the capture we are in the middle of (see `capturing`).
    if (this.capturing.has(pageId)) return;
    this.invalidate(pageId);
    const existing = this.debounceTimers.get(pageId);
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      this.debounceTimers.delete(pageId);
      this.captureWhenIdle(pageId);
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
      this.captureWhenIdle(pageId);
    }
  }

  /**
   * Hold every idle capture until resume(). A capture is 200ms+ of synchronous
   * main-thread work (clone the sheet, embed fonts, rasterize an SVG the size
   * of a page); one landing in the middle of a turn stalls the tween and
   * stretches the landing's rAFs, which is what made a click-turn stutter and
   * made the post-landing frame hang around long enough to read as a flicker.
   * Requested pages are remembered and captured once the overlay is down.
   */
  suspend(): void {
    this.suspended = true;
  }

  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    if (this.disposed) return;
    const pending = [...this.deferred];
    this.deferred.clear();
    for (const pageId of pending) this.captureWhenIdle(pageId);
  }

  /** Cancel pending work and close every bitmap (call on book close). */
  dispose(): void {
    this.disposed = true;
    for (const timer of this.debounceTimers.values()) window.clearTimeout(timer);
    this.debounceTimers.clear();
    for (const handle of this.idleHandles) handle.cancel();
    this.idleHandles.clear();
    this.deferred.clear();
    this.capturing.clear();
    this.entries.clear();
    this.versions.clear();
  }

  /* ------------------------------ internals ------------------------------ */

  /** Queue one idle capture, or park it until resume() when suspended. */
  private captureWhenIdle(pageId: string): void {
    if (this.disposed) return;
    if (this.suspended) {
      this.deferred.add(pageId);
      return;
    }
    const handle = whenIdle(() => {
      this.idleHandles.delete(handle);
      if (this.suspended) {
        this.deferred.add(pageId);
        return;
      }
      void this.ensure(pageId);
    });
    this.idleHandles.add(handle);
  }

  private async capture(pageId: string): Promise<RasterEntry | null> {
    const element = this.options.getElement(pageId);
    if (
      element === null ||
      !element.isConnected ||
      element.clientWidth < 1 ||
      element.clientHeight < 1
    ) {
      // No live leaf for this page (adjacent spread, or mid-remount with no
      // layout yet) — stage it offscreen so the flip's back and revealed
      // faces still get real content instead of blank cream.
      return this.captureUnmounted(pageId);
    }
    const versionAtStart = this.version(pageId);

    // Font-embed CSS is built once for the whole app lifetime and reused —
    // per the doc this removes the biggest per-capture cost.
    this.fontCss ??= getFontEmbedCSS(element).catch(() => '');
    const fontEmbedCSS = await this.fontCss;

    // From here to the end of the rasterization we are writing to the live
    // page (the marker class, then every SVG's inline paint) — mutations the
    // edit watcher must not mistake for typing.
    this.capturing.add(pageId);
    element.classList.add(SNAPSHOTTING_CLASS);
    // Inline SVG loses class-based styling in html-to-image's clone and
    // renders BLACK; see svgSnapshot.ts.
    const restoreSvg = inlineSvgStyles(element);
    let canvas: HTMLCanvasElement;
    try {
      canvas = await toCanvas(element, {
        pixelRatio: this.pixelRatio,
        backgroundColor: PAPER_CREAM,
        fontEmbedCSS,
        imagePlaceholder: TRANSPARENT_PX,
        filter: snapshotFilter,
      });
    } catch (err) {
      // Snapshot failure → caller falls back (doc: CSS path). Warn rather
      // than swallow: a capture that keeps failing silently leaves the flip
      // with a blank face and no trace of why.
      console.warn('[rasterCache] snapshot capture failed for', pageId, err);
      return null;
    } finally {
      restoreSvg();
      element.classList.remove(SNAPSHOTTING_CLASS);
      // Release in a microtask, NOT synchronously: undoing our writes queues
      // one more MutationObserver notification, and that notification is
      // delivered before any microtask queued after it. Clearing the flag
      // here would hand the watcher our own teardown as a user edit and the
      // loop would start over.
      queueMicrotask(() => this.capturing.delete(pageId));
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

  /** Offscreen path for pages with no mounted leaf (see capture()). */
  private async captureUnmounted(pageId: string): Promise<RasterEntry | null> {
    const captureOffscreen = this.options.captureOffscreen;
    if (captureOffscreen === undefined) return null;
    const versionAtStart = this.version(pageId);
    let bitmap: ImageBitmap | null;
    try {
      bitmap = await captureOffscreen(pageId);
    } catch (err) {
      // Same reasoning as the mounted path: a silently failing neighbour
      // capture leaves the turning sheet's back face blank cream, which the
      // landing then replaces with real content — a visible flash with no
      // trace of why.
      console.warn('[rasterCache] offscreen staging failed for', pageId, err);
      return null;
    }
    if (bitmap === null) return null;
    if (this.disposed) {
      bitmap.close();
      return null;
    }
    const entry: RasterEntry = {
      bitmap,
      version: versionAtStart,
      width: bitmap.width,
      height: bitmap.height,
      pixelRatio: this.pixelRatio,
    };
    this.entries.set(pageId, entry);
    return entry;
  }
}
