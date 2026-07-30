/**
 * features/bookshelf/spineFactory.ts — spine texture pipeline.
 *
 * The Excalidraw pattern: bake once, draw forever. Spines are rendered
 * upright by art/spines.renderSpine into 2048² atlas pages (art/atlas
 * shelf-packing), one Pixi CanvasSource per page, sub-rect Textures per book.
 * Two buckets: lo-res (≈0.62×, effectively permanent — 2 pages hold ~1500
 * spines) and hi-res (2×, title text baked in, page-LRU capped at 4 pages
 * ≈ 64MB). Baking is chunked through requestIdleCallback (4 spines/slice)
 * prioritized by distance to the viewport, so a floor scrolled into view
 * shows lo-res instantly and sharpens within ~100ms.
 */

import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import { AtlasManager, type AtlasPage } from '../../art/atlas';
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

/** Lo-res bake scale: 232 world px → ~144 texture px (doc: 32×146-ish). */
export const LO_SCALE = 0.62;

/** Hi-res bake scale: 2× world px, covers max zoom 2.5 without blur. */
export const HI_SCALE = 2;

/** Spines baked per idle slice. */
const BAKES_PER_SLICE = 6;

/**
 * Hard cap on how long hi-res (titled) bakes wait for the handwriting fonts.
 * document.fonts.load can stall (headless first paint, cold font cache, or a
 * face that never resolves) and titles must not be held hostage: after this
 * timeout hi bakes proceed with the fallback face, and if the real fonts
 * land later the hi atlas is dropped so titles re-bake crisp.
 */
export const FONT_WAIT_MAX_MS = 2500;

interface QueueItem {
  book: Book;
  variant: SpineVariant;
  priority: number;
}

type IdleHandle = number;

function scheduleIdle(cb: () => void): { cancel: () => void } {
  if (typeof requestIdleCallback === 'function') {
    const id: IdleHandle = requestIdleCallback(() => cb(), { timeout: 120 });
    return { cancel: () => cancelIdleCallback(id) };
  }
  const id = setTimeout(cb, 16) as unknown as number;
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
  private readonly listeners = new Set<(bookIds: readonly string[]) => void>();
  private idle: { cancel: () => void } | null = null;
  private fontsReady = false;
  private destroyed = false;

  /** Degrade mode never bakes hi-res. */
  readonly hiEnabled: boolean;

  constructor(opts: { hiEnabled?: boolean } = {}) {
    this.hiEnabled = opts.hiEnabled ?? true;
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
  request(book: Book, variant: SpineVariant, priority: number): void {
    if (this.destroyed) return;
    if (variant === 'hi' && !this.hiEnabled) return;
    const key = `${variant}|${book.id}`;
    if ((variant === 'hi' ? this.hiTextures : this.loTextures).has(book.id)) return;
    const existing = this.queue.get(key);
    if (existing !== undefined) {
      existing.priority = Math.min(existing.priority, priority);
      return;
    }
    this.queue.set(key, { book, variant, priority });
    this.scheduleSlice();
  }

  destroy(): void {
    this.destroyed = true;
    this.idle?.cancel();
    this.idle = null;
    this.queue.clear();
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
      this.scheduleSlice();
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

  private scheduleSlice(): void {
    if (this.destroyed || this.idle !== null || this.queue.size === 0) return;
    this.idle = scheduleIdle(() => {
      this.idle = null;
      this.processSlice();
    });
  }

  private processSlice(): void {
    if (this.destroyed) return;
    const items = [...this.queue.values()]
      // Hi-res title text needs the handwriting fonts; hold hi bakes till then.
      .filter((it) => it.variant === 'lo' || this.fontsReady)
      .sort((a, b) => a.priority - b.priority)
      .slice(0, BAKES_PER_SLICE);
    if (items.length === 0) {
      // Everything pending is hi-res waiting on fonts; retry via preloadFonts.
      return;
    }
    const touchedSources = new Set<CanvasSource>();
    const bakedIds: string[] = [];
    for (const item of items) {
      this.queue.delete(`${item.variant}|${item.book.id}`);
      try {
        const source = this.bakeOne(item.book, item.variant);
        touchedSources.add(source);
        bakedIds.push(item.book.id);
      } catch {
        // A failed bake leaves the placeholder; never crash the loop.
      }
    }
    for (const source of touchedSources) source.update();
    if (bakedIds.length > 0) this.emit(bakedIds);
    this.scheduleSlice();
  }

  private bakeOne(book: Book, variant: SpineVariant): CanvasSource {
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
