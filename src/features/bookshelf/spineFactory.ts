/**
 * features/bookshelf/spineFactory.ts — spine texture pipeline.
 *
 * The Excalidraw pattern: bake once, draw forever. Spines are rendered
 * upright by art/spines.renderSpine into 2048² atlas pages (art/atlas
 * shelf-packing), one Pixi CanvasSource per page, sub-rect Textures per book.
 * Two buckets: lo-res (≈0.62×, effectively permanent — 2 pages hold ~1500
 * spines) and hi-res (2×, title text baked in, page-LRU capped at 4 pages
 * ≈ 64MB).
 *
 * ## Where the painting happens
 *
 * Off the main thread, whenever that is possible. A painted spine is seconds
 * of brush work (`docs/design/painted-rendering.md`), which no amount of
 * slicing can make invisible — the atom is one spine. So the default path
 * ships the recipe to `artOffload` and the main thread's whole share becomes a
 * single `drawImage` of the returned `ImageBitmap` into the atlas page.
 *
 * The old inline path is still here, unchanged, as the fallback: no worker
 * support, a dead worker or a job that timed out all land on `bakeOneTimed`,
 * chunked through `requestIdleCallback` with a per-slice time budget and
 * prioritised by distance to the viewport.
 */

import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import { AtlasManager, type AtlasPage } from '../../art/atlas';
import { recordBakeSample } from '../../art/bake';
import { artOffload, type ArtOffload } from './artOffload';
import { installArtRoutes } from './artRoutes';
import { resolveBookStyle, type ResolvedBookStyle } from '../../art/bookStyle';
import { renderSpine, type Ctx2D, type SpineParams } from '../../art/spines';
import { getTheme, type LibraryTheme } from '../../art/themes';
import { readShelfMeta } from '../../data/books';
import type { Book } from '../../data/types';
import {
  bookStyleOverridesFor,
  spineArtHeight,
  themeSpineDefaults,
} from './bookIdentity';
import { paletteCss, placeholderTint } from './spinePalette';

export { paletteCss, placeholderTint, spineArtHeight };

export type SpineVariant = 'lo' | 'hi';

/**
 * Where a book sits in its shelf row, captured at request time and folded
 * into the bake. This is what lets a row read as one raking-light scene
 * rather than thirty identically-lit rectangles:
 *
 * - `rowPhase` — 0 at the far end from the key light → 1 right under it;
 * - `neighbourLeft/Right` — the adjacent spines' colours, for the reference's
 *   colour bleed across touching books (`null` = gap or end of run).
 *
 * All optional: callers without layout knowledge (studio previews) bake the
 * neutral mid-row defaults. Baked-in context goes stale when a book moves,
 * which is acceptable — a neighbour's hue bleed is a whisper, and the book
 * re-bakes on the next invalidation.
 */
export interface SpineRowContext {
  rowPhase?: number;
  depth?: number;
  neighbourLeft?: string | null;
  neighbourRight?: string | null;
}

/** Lo-res bake scale: 232 world px → ~144 texture px (doc: 32×146-ish). */
export const LO_SCALE = 0.62;

/** Hi-res bake scale: 2× world px, covers max zoom 2.5 without blur. */
export const HI_SCALE = 2;

/**
 * Time budget for one idle slice, in ms.
 *
 * This used to be a fixed count (6 spines per slice) — which is only a budget
 * if every spine costs the same, and they emphatically do not: a titled hi-res
 * spine measured at 1102ms on a software renderer while a lo-res one took 54ms.
 * Six of the former is a seven-second frozen window, and that (not the disk
 * cache) was the bulk of the startup freeze. A slice now bakes ONE spine, then
 * keeps going only while the budget and the idle deadline both allow, so the
 * worst case is a single spine no matter how expensive the recipe becomes.
 */
const SLICE_BUDGET_MS = 8;

/** Never bake more than this many in one slice even if they are all cheap. */
const SLICE_MAX_BAKES = 12;

/**
 * Cost of the most expensive spine seen so far, per variant. Used to stop a
 * slice BEFORE starting a bake that is likely to overrun the remaining budget,
 * rather than discovering it afterwards.
 */
const observedCost: Record<SpineVariant, number> = { lo: 4, hi: 12 };

/**
 * Hard cap on how long hi-res (titled) bakes wait for the handwriting fonts.
 * document.fonts.load can stall (headless first paint, cold font cache, or a
 * face that never resolves) and titles must not be held hostage: after this
 * timeout hi bakes proceed with the fallback face, and if the real fonts
 * land later the hi atlas is dropped so titles re-bake crisp.
 */
export const FONT_WAIT_MAX_MS = 2500;

/**
 * How many spine jobs may be outstanding in the worker pool at once.
 *
 * Two per thread: one painting, one already queued so a thread never idles
 * between jobs, and no more — the queue is re-sorted by distance to the
 * viewport on every request, and anything already handed to a worker has left
 * that ordering behind. A deep in-flight queue would mean panning the shelf
 * waits for spines the camera left three floors ago.
 */
const IN_FLIGHT_PER_WORKER = 2;

interface QueueItem {
  book: Book;
  variant: SpineVariant;
  priority: number;
  ctx?: SpineRowContext;
}

type IdleHandle = number;

/** Milliseconds of headroom the browser reports, or a pessimistic default. */
type Deadline = { timeRemaining: () => number } | null;

function scheduleIdle(cb: (deadline: Deadline) => void): { cancel: () => void } {
  if (typeof requestIdleCallback === 'function') {
    const id: IdleHandle = requestIdleCallback((d) => cb(d), { timeout: 120 });
    return { cancel: () => cancelIdleCallback(id) };
  }
  const id = setTimeout(() => cb(null), 16) as unknown as number;
  return { cancel: () => clearTimeout(id) };
}

function get2d(canvas: AtlasPage['canvas']): Ctx2D {
  const ctx = (canvas as OffscreenCanvas).getContext('2d');
  if (!ctx) throw new Error('spineFactory: 2d context unavailable');
  return ctx as Ctx2D;
}

/**
 * Owns both atlas buckets, the GPU sources, the bake queue, and the derived
 * SpineParams cache. Emits `onTexturesChanged(bookIds)` whenever textures for
 * those books became available OR were evicted (listeners re-pick + re-request).
 */
export class SpineFactory {
  private readonly loAtlas: AtlasManager;
  private readonly hiAtlas: AtlasManager;
  /**
   * GPU sources per atlas page, keyed `${variant}:${page.id}` — page ids are
   * PER-MANAGER counters, so lo page 0 and hi page 0 are different canvases.
   * (Keying by bare page.id once aliased every hi texture onto the lo canvas,
   * which is why baked spine titles never showed at LOD0.)
   */
  private readonly sources = new Map<string, CanvasSource>();
  private readonly loTextures = new Map<string, Texture>();
  private readonly hiTextures = new Map<string, Texture>();
  private readonly paramsCache = new Map<string, ResolvedBookStyle>();
  private readonly queue = new Map<string, QueueItem>();
  /** The room whose spine bias new/unstyled books inherit. */
  private theme: LibraryTheme = getTheme(null);
  /** Cache-busting salt so a theme change re-derives every book's params. */
  private styleEpoch = 0;
  /** Bumped whenever every baked spine is dropped; stale worker results die. */
  private bakeEpoch = 0;
  private readonly listeners = new Set<(bookIds: readonly string[]) => void>();
  private idle: { cancel: () => void } | null = null;
  private fontsReady = false;
  private destroyed = false;

  /* --------------------------- off-thread state -------------------------- */

  private readonly offload: ArtOffload;
  /** Queue keys currently being painted by a worker. */
  private readonly inFlight = new Set<string>();
  /**
   * Books whose textures landed since the last flush. Batched to one listener
   * call per frame: a worker pool answers in a burst, and forty separate
   * `onTexturesChanged` calls would re-pick and re-request the whole visible
   * shelf forty times for one frame's worth of new pixels.
   */
  private readonly landed = new Set<string>();
  private flushScheduled = false;
  /** Pages touched since the last flush (their GPU source needs an update). */
  private readonly dirtySources = new Set<CanvasSource>();

  /** Degrade mode never bakes hi-res. */
  readonly hiEnabled: boolean;

  constructor(opts: { hiEnabled?: boolean; offload?: ArtOffload } = {}) {
    this.hiEnabled = opts.hiEnabled ?? true;
    this.offload = opts.offload ?? artOffload();
    this.loAtlas = new AtlasManager({
      maxPages: 2,
      padding: 2,
      onEvict: (page, keys) => this.handleEvict('lo', page, keys, this.loTextures),
    });
    this.hiAtlas = new AtlasManager({
      maxPages: 4,
      padding: 2,
      onEvict: (page, keys) => this.handleEvict('hi', page, keys, this.hiTextures),
    });
    this.preloadFonts();
    // Route every OTHER baked recipe (the case, the wall, the base wood)
    // through the same threads, whoever asks for it.
    installArtRoutes();
    // Start fetching + compiling the worker bundle now: it overlaps the app's
    // own boot, so the first spine request finds threads already alive.
    this.offload.warmUp();
  }

  onTexturesChanged(cb: (bookIds: readonly string[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * Switch the room. Spine art is `seed → theme bias → per-book overrides`,
   * so every un-overridden book re-derives; books with explicit studio
   * overrides come back byte-identical (resolveBookStyle is deterministic and
   * overrides always win), which is exactly the "a favourite red leather book
   * keeps its identity in every room" rule.
   */
  setTheme(theme: LibraryTheme): void {
    if (this.destroyed || theme.id === this.theme.id) return;
    this.theme = theme;
    this.styleEpoch++;
    this.paramsCache.clear();
    this.invalidateAll();
  }

  /** Drop every baked spine (theme switch). Listeners re-request. */
  invalidateAll(): void {
    if (this.destroyed) return;
    const ids = new Set<string>();
    for (const bucket of [this.loTextures, this.hiTextures]) {
      for (const [bookId, tex] of bucket) {
        ids.add(bookId);
        tex.destroy(false);
      }
      bucket.clear();
    }
    this.loAtlas.clear();
    this.hiAtlas.clear();
    this.queue.clear();
    // Anything a worker is still painting belongs to the old room — let the
    // results arrive and be dropped rather than stalling on a cancel round-trip.
    this.bakeEpoch++;
    this.inFlight.clear();
    if (ids.size > 0) this.emit([...ids]);
  }

  /**
   * The book's fully-merged studio style — spine params, cover params and the
   * flat `style` the studio panel edits. Cached per book per theme epoch.
   */
  getStyle(book: Book): ResolvedBookStyle {
    const key = `${this.styleEpoch}|${book.id}`;
    let resolved = this.paramsCache.get(key);
    if (resolved === undefined) {
      resolved = resolveBookStyle(
        book.spineSeed,
        themeSpineDefaults(this.theme),
        bookStyleOverridesFor(book),
        { pageCount: readShelfMeta(book)?.pageCount },
      );
      this.paramsCache.set(key, resolved);
    }
    return resolved;
  }

  /** Drop one book's cached style (studio edit / rename). */
  invalidateStyle(bookId: string): void {
    this.paramsCache.delete(`${this.styleEpoch}|${bookId}`);
  }

  getParams(book: Book): SpineParams {
    return this.getStyle(book).spine;
  }

  /** Baked texture for a variant, or undefined (touches the page LRU). */
  get(bookId: string, variant: SpineVariant): Texture | undefined {
    const tex = (variant === 'hi' ? this.hiTextures : this.loTextures).get(bookId);
    if (tex !== undefined) {
      // Touch the owning atlas page so LRU tracks last-visible time.
      (variant === 'hi' ? this.hiAtlas : this.loAtlas).get(`${variant}|${bookId}`);
    }
    return tex;
  }

  /**
   * Best texture available for a tier: tier 0 prefers hi (requesting it if
   * missing); everything falls back lo → undefined (placeholder).
   */
  pick(book: Book, tier: number): Texture | undefined {
    if (tier === 0 && this.hiEnabled) {
      const hi = this.get(book.id, 'hi');
      if (hi !== undefined) return hi;
    }
    return this.get(book.id, 'lo');
  }

  /**
   * Drop a book's baked textures (title rename, spine reseed). The atlas
   * rects are released (pixels stay until page eviction) and listeners are
   * notified so live sprites fall back to placeholders + re-request.
   */
  invalidate(bookId: string): void {
    if (this.destroyed) return;
    this.invalidateStyle(bookId);
    let touched = false;
    for (const variant of ['lo', 'hi'] as const) {
      const bucket = variant === 'hi' ? this.hiTextures : this.loTextures;
      const tex = bucket.get(bookId);
      if (tex !== undefined) {
        bucket.delete(bookId);
        tex.destroy(false);
        touched = true;
      }
      (variant === 'hi' ? this.hiAtlas : this.loAtlas).release(`${variant}|${bookId}`);
      this.queue.delete(`${variant}|${bookId}`);
    }
    if (touched) this.emit([bookId]);
  }

  /** Queue a bake (idempotent). Lower priority = baked sooner. */
  request(book: Book, variant: SpineVariant, priority: number, ctx?: SpineRowContext): void {
    if (this.destroyed) return;
    if (variant === 'hi' && !this.hiEnabled) return;
    const key = `${variant}|${book.id}`;
    if ((variant === 'hi' ? this.hiTextures : this.loTextures).has(book.id)) return;
    const existing = this.queue.get(key);
    if (existing !== undefined) {
      existing.priority = Math.min(existing.priority, priority);
      if (ctx !== undefined) existing.ctx = ctx;
      return;
    }
    this.queue.set(key, { book, variant, priority, ctx });
    this.pump();
  }

  destroy(): void {
    this.destroyed = true;
    this.idle?.cancel();
    this.idle = null;
    this.queue.clear();
    this.inFlight.clear();
    this.landed.clear();
    this.dirtySources.clear();
    this.listeners.clear();
    // clear() fires onEvict per page, which destroys the GPU sources.
    this.loAtlas.clear();
    this.hiAtlas.clear();
    this.loTextures.clear();
    this.hiTextures.clear();
    this.paramsCache.clear();
  }

  /* ------------------------------ internals ------------------------------ */

  /**
   * Gate hi-res (titled) bakes on the handwriting fonts — but only briefly.
   * Two paths flip `fontsReady`:
   *   1. document.fonts.load resolves (the normal case, ~instant once the
   *      @fontsource CSS is parsed);
   *   2. the FONT_WAIT_MAX_MS timeout (headless/misbehaving font loader) —
   *      titles bake with the fallback face rather than never appearing, and
   *      when the real fonts do arrive the hi atlas is dropped + re-baked.
   */
  private preloadFonts(): void {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (fonts === undefined) {
      this.fontsReady = true;
      return;
    }
    let settled = false;
    let timedOut = false;
    const ready = (): void => {
      if (this.destroyed) return;
      this.fontsReady = true;
      this.pump();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      ready();
    }, FONT_WAIT_MAX_MS);
    Promise.all([
      fonts.load('20px "Caveat Variable"'),
      fonts.load('20px Kalam'),
      fonts.load('20px "Patrick Hand"'),
    ])
      .catch(() => undefined)
      .then(() => {
        settled = true;
        clearTimeout(timer);
        if (this.destroyed) return;
        if (timedOut && this.hiTextures.size > 0) {
          // Some titles were baked with the fallback face — redo them.
          this.hiAtlas.clear();
        }
        ready();
      });
  }

  /**
   * Move the queue forward.
   *
   * Worker first: hand as many top-ranked items to the pool as its in-flight
   * budget allows. Only what is left over — everything, when there is no pool —
   * goes to the idle-callback slice that paints on this thread.
   */
  private pump(): void {
    if (this.destroyed) return;
    this.dispatchToWorkers();
    this.scheduleSlice();
  }

  /** The queue in bake order (see {@link SpineFactory.rank}). */
  private ranked(): QueueItem[] {
    return [...this.queue.values()]
      // Hi-res title text needs the handwriting fonts; hold hi bakes till then.
      // The worker registers its own faces, so this gate only applies inline.
      .filter((it) => it.variant === 'lo' || this.fontsReady || this.offload.available)
      .sort((a, b) => SpineFactory.rank(a) - SpineFactory.rank(b));
  }

  private dispatchToWorkers(): void {
    if (!this.offload.available) return;
    this.offload.warmUp();
    if (!this.offload.available) return;
    const budget = Math.max(1, this.offload.size) * IN_FLIGHT_PER_WORKER;
    if (this.inFlight.size >= budget) return;
    for (const item of this.ranked()) {
      if (this.inFlight.size >= budget) break;
      const key = `${item.variant}|${item.book.id}`;
      this.queue.delete(key);
      this.inFlight.add(key);
      void this.paintOffThread(key, item);
    }
  }

  /**
   * One spine, painted in a worker and blitted here.
   *
   * The atlas rect is allocated on ARRIVAL rather than on dispatch: allocating
   * up front would reserve shelf space in the order jobs were sent and leave
   * holes wherever a job failed, and an eviction between dispatch and arrival
   * would hand back a rect on a page that no longer exists.
   */
  private async paintOffThread(key: string, item: QueueItem): Promise<void> {
    const epoch = this.bakeEpoch;
    const { book, variant, ctx: rowCtx } = item;
    const params = this.getParams(book);
    const scale = variant === 'hi' ? HI_SCALE : LO_SCALE;
    const w = Math.ceil(params.w * scale);
    const h = Math.ceil(spineArtHeight(params) * scale);

    let paint: Awaited<ReturnType<ArtOffload['spine']>> = null;
    try {
      paint = await this.offload.spine({
        params,
        title: book.title,
        w,
        h,
        scale,
        hiRes: variant === 'hi',
        rowPhase: rowCtx?.rowPhase,
        depth: rowCtx?.depth,
        neighbourLeft: rowCtx?.neighbourLeft ?? null,
        neighbourRight: rowCtx?.neighbourRight ?? null,
      });
    } catch {
      paint = null;
    }

    this.inFlight.delete(key);
    if (this.destroyed) {
      paint?.bitmap.close();
      return;
    }
    if (epoch !== this.bakeEpoch) {
      // The room changed while this was painting — the pixels are stale.
      paint?.bitmap.close();
      this.pump();
      return;
    }
    if (paint === null) {
      // No worker (or it failed): put the item back for the inline slice.
      if (!(variant === 'hi' ? this.hiTextures : this.loTextures).has(book.id)) {
        this.queue.set(key, item);
      }
      this.scheduleSlice();
      return;
    }

    recordBakeSample({
      what: `spine|${variant}|${book.title.slice(0, 40)}`,
      ms: paint.ms,
      kind: 'spine',
      at: performance.now() - paint.ms,
    });

    try {
      this.blit(book, variant, w, h, paint.bitmap);
    } catch {
      // Atlas full or context lost — the placeholder stays; never crash.
    } finally {
      paint.bitmap.close();
    }
    this.pump();
  }

  /** Place a finished spine bitmap into its atlas page. Sub-millisecond. */
  private blit(
    book: Book,
    variant: SpineVariant,
    w: number,
    h: number,
    bitmap: ImageBitmap,
  ): void {
    const atlas = variant === 'hi' ? this.hiAtlas : this.loAtlas;
    const handle = atlas.alloc(`${variant}|${book.id}`, w, h);
    const { rect, page } = handle;
    const ctx = get2d(page.canvas);
    ctx.clearRect(rect.x - 1, rect.y - 1, rect.w + 2, rect.h + 2);
    ctx.drawImage(bitmap as unknown as CanvasImageSource, rect.x, rect.y);

    const source = this.sourceFor(variant, page);
    const texture = new Texture({
      source,
      frame: new Rectangle(rect.x, rect.y, rect.w, rect.h),
    });
    (variant === 'hi' ? this.hiTextures : this.loTextures).set(book.id, texture);
    this.dirtySources.add(source);
    this.landed.add(book.id);
    this.scheduleFlush();
  }

  /**
   * Coalesce a burst of arrivals into one GPU upload + one listener call per
   * frame. rAF rather than a microtask: the upload should land with the frame
   * that will draw it, and a microtask flush would upload the same 2048² page
   * once per spine.
   */
  private scheduleFlush(): void {
    if (this.flushScheduled || this.destroyed) return;
    this.flushScheduled = true;
    const run = (): void => {
      this.flushScheduled = false;
      if (this.destroyed) return;
      for (const source of this.dirtySources) source.update();
      this.dirtySources.clear();
      if (this.landed.size > 0) {
        const ids = [...this.landed];
        this.landed.clear();
        this.emit(ids);
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  private scheduleSlice(): void {
    if (this.destroyed || this.idle !== null || this.queue.size === 0) return;
    // With a live pool the queue drains through `dispatchToWorkers`; an idle
    // slice would race it and paint the same spine on this thread.
    if (this.offload.available && this.inFlight.size > 0) return;
    this.idle = scheduleIdle((deadline) => {
      this.idle = null;
      this.processSlice(deadline);
    });
  }

  /**
   * Bake ordering. Two rules, both about what the user sees first:
   *   1. EVERY lo-res spine outranks EVERY hi-res one. Lo is what makes the
   *      shelf legible; hi only sharpens a title that is already readable, and
   *      costs an order of magnitude more. Interleaving them meant a shelf that
   *      was still half placeholder blocks while distant books sharpened.
   *   2. Within a variant, nearest-to-viewport first (the caller's priority).
   */
  private static rank(item: QueueItem): number {
    return (item.variant === 'hi' ? 1e6 : 0) + item.priority;
  }

  private processSlice(deadline: Deadline): void {
    if (this.destroyed) return;
    const items = [...this.queue.values()]
      // Hi-res title text needs the handwriting fonts; hold hi bakes till then.
      .filter((it) => it.variant === 'lo' || this.fontsReady)
      .sort((a, b) => SpineFactory.rank(a) - SpineFactory.rank(b));
    if (items.length === 0) {
      // Everything pending is hi-res waiting on fonts; retry via preloadFonts.
      return;
    }
    const touchedSources = new Set<CanvasSource>();
    const bakedIds: string[] = [];
    const started = performance.now();
    /** ms of headroom left in this slice, per the budget AND the browser. */
    const headroom = (): number =>
      Math.min(
        SLICE_BUDGET_MS - (performance.now() - started),
        deadline !== null ? deadline.timeRemaining() : Number.POSITIVE_INFINITY,
      );

    for (const item of items) {
      // Always bake at least one — otherwise a permanently busy thread would
      // starve the queue forever and the shelf would never leave placeholders.
      if (bakedIds.length > 0) {
        if (bakedIds.length >= SLICE_MAX_BAKES) break;
        if (headroom() < observedCost[item.variant]) break;
      }
      this.queue.delete(`${item.variant}|${item.book.id}`);
      const t0 = performance.now();
      try {
        const source = this.bakeOne(item.book, item.variant, item.ctx);
        touchedSources.add(source);
        bakedIds.push(item.book.id);
      } catch {
        // A failed bake leaves the placeholder; never crash the loop.
      }
      // Track the worst cost seen so the next slice can stop before it starts
      // a bake it cannot afford. Decays slowly so one pathological title does
      // not throttle the queue forever.
      const cost = performance.now() - t0;
      observedCost[item.variant] = Math.max(cost, observedCost[item.variant] * 0.9);
    }
    for (const source of touchedSources) source.update();
    if (bakedIds.length > 0) this.emit(bakedIds);
    this.scheduleSlice();
  }

  private bakeOne(book: Book, variant: SpineVariant, rowCtx?: SpineRowContext): CanvasSource {
    const t0 = performance.now();
    const source = this.bakeOneTimed(book, variant, rowCtx);
    recordBakeSample({
      what: `spine|${variant}|${book.title.slice(0, 40)}`,
      ms: performance.now() - t0,
      kind: 'spine',
      at: t0,
    });
    return source;
  }

  private bakeOneTimed(book: Book, variant: SpineVariant, rowCtx?: SpineRowContext): CanvasSource {
    const params = this.getParams(book);
    const scale = variant === 'hi' ? HI_SCALE : LO_SCALE;
    const w = Math.ceil(params.w * scale);
    // Bake at the book's OWN height so a duodecimo's ornament is not stretched
    // when the compositor sizes the sprite (studio height/format control).
    const h = Math.ceil(spineArtHeight(params) * scale);
    const atlas = variant === 'hi' ? this.hiAtlas : this.loAtlas;
    const handle = atlas.alloc(`${variant}|${book.id}`, w, h);
    const { rect, page } = handle;

    const ctx = get2d(page.canvas);
    ctx.save();
    // Clip to the padded rect so jittered strokes never bleed into neighbors.
    ctx.beginPath();
    ctx.rect(rect.x - 1, rect.y - 1, rect.w + 2, rect.h + 2);
    ctx.clip();
    ctx.clearRect(rect.x - 1, rect.y - 1, rect.w + 2, rect.h + 2);
    renderSpine(ctx, params, rect.x, rect.y, h, scale, book.title, {
      hiRes: variant === 'hi',
      rowPhase: rowCtx?.rowPhase,
      depth: rowCtx?.depth,
      neighbourLeft: rowCtx?.neighbourLeft ?? null,
      neighbourRight: rowCtx?.neighbourRight ?? null,
    });
    ctx.restore();

    const source = this.sourceFor(variant, page);
    const texture = new Texture({
      source,
      frame: new Rectangle(rect.x, rect.y, rect.w, rect.h),
    });
    (variant === 'hi' ? this.hiTextures : this.loTextures).set(book.id, texture);
    return source;
  }

  private sourceFor(variant: SpineVariant, page: AtlasPage): CanvasSource {
    const key = `${variant}:${page.id}`;
    let source = this.sources.get(key);
    if (source === undefined) {
      source = new CanvasSource({
        resource: page.canvas as unknown as HTMLCanvasElement,
        autoGenerateMipmaps: true,
        label: `spine-atlas-${key}`,
      });
      this.sources.set(key, source);
    }
    return source;
  }

  private handleEvict(
    variant: SpineVariant,
    page: AtlasPage,
    keys: readonly string[],
    bucket: Map<string, Texture>,
  ): void {
    const sourceKey = `${variant}:${page.id}`;
    const source = this.sources.get(sourceKey);
    this.sources.delete(sourceKey);
    const bookIds: string[] = [];
    for (const key of keys) {
      const sep = key.indexOf('|');
      const bookId = key.slice(sep + 1);
      const tex = bucket.get(bookId);
      if (tex !== undefined) {
        bucket.delete(bookId);
        tex.destroy(false);
        bookIds.push(bookId);
      }
    }
    source?.destroy();
    if (!this.destroyed && bookIds.length > 0) this.emit(bookIds);
  }

  private emit(bookIds: readonly string[]): void {
    for (const cb of this.listeners) cb(bookIds);
  }
}
