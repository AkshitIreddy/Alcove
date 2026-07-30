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
import { clamp } from '../../art/noise';
import {
  deriveSpineParams,
  renderSpine,
  SPINE_BASE_HEIGHT,
  type Ctx2D,
  type SpineParams,
} from '../../art/spines';
import type { Book } from '../../data/types';

export type SpineVariant = 'lo' | 'hi';

/** Lo-res bake scale: 232 world px → ~144 texture px (doc: 32×146-ish). */
export const LO_SCALE = 0.62;

/** Hi-res bake scale: 2× world px, covers max zoom 2.5 without blur. */
export const HI_SCALE = 2;

/** Spines baked per idle slice. */
const BAKES_PER_SLICE = 4;

/**
 * The 12 curated palette duos from art/spines.ts (top, bottom), duplicated
 * here as HSL tuples because art/ does not export them. Used only for flat
 * placeholder tints and the DOM overlay cover — drift is cosmetic.
 */
const PALETTE_DUOS: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [38, 62, 52, 30, 58, 38], // amber
  [16, 55, 48, 10, 52, 34], // terracotta
  [95, 28, 42, 100, 30, 30], // moss
  [210, 26, 48, 214, 30, 34], // dusty blue
  [315, 24, 40, 320, 28, 28], // plum
  [44, 60, 46, 40, 55, 33], // ochre
  [130, 16, 52, 135, 18, 38], // sage
  [22, 60, 40, 18, 58, 28], // rust
  [28, 38, 52, 24, 36, 38], // clay
  [70, 30, 38, 66, 32, 27], // olive
  [200, 18, 42, 204, 20, 30], // slate
  [355, 32, 56, 350, 30, 42], // blush
];

function hslToRgbInt(h: number, s: number, l: number): number {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 100) / 100;
  const ll = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to255 = (v: number) => Math.round((v + m) * 255);
  return (to255(r) << 16) | (to255(g) << 8) | to255(b);
}

/** Flat placeholder tint (0xRRGGBB) for a spine before its bake lands. */
export function placeholderTint(params: SpineParams): number {
  const duo = PALETTE_DUOS[params.palette % PALETTE_DUOS.length];
  return hslToRgbInt(duo[0] + params.hueJitter, duo[1], duo[2]);
}

/** CSS colors for the DOM pulled-book cover (top → bottom gradient). */
export function paletteCss(params: SpineParams): { top: string; bottom: string } {
  const duo = PALETTE_DUOS[params.palette % PALETTE_DUOS.length];
  const f = (h: number, s: number, l: number) =>
    `hsl(${(((h + params.hueJitter) % 360) + 360) % 360} ${s}% ${l}%)`;
  return { top: f(duo[0], duo[1], duo[2]), bottom: f(duo[3], duo[4], duo[5]) };
}

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
  private readonly sources = new Map<number, CanvasSource>();
  private readonly loTextures = new Map<string, Texture>();
  private readonly hiTextures = new Map<string, Texture>();
  private readonly paramsCache = new Map<string, SpineParams>();
  private readonly queue = new Map<string, QueueItem>();
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
      onEvict: (page, keys) => this.handleEvict(page, keys, this.loTextures),
    });
    this.hiAtlas = new AtlasManager({
      maxPages: 4,
      padding: 2,
      onEvict: (page, keys) => this.handleEvict(page, keys, this.hiTextures),
    });
    this.preloadFonts();
  }

  onTexturesChanged(cb: (bookIds: readonly string[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getParams(book: Book): SpineParams {
    let params = this.paramsCache.get(book.id);
    if (params === undefined) {
      params = deriveSpineParams(book.spineSeed);
      this.paramsCache.set(book.id, params);
    }
    return params;
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

  private preloadFonts(): void {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (fonts === undefined) {
      this.fontsReady = true;
      return;
    }
    Promise.all([
      fonts.load('20px "Caveat Variable"'),
      fonts.load('20px Kalam'),
      fonts.load('20px "Patrick Hand"'),
    ])
      .catch(() => undefined)
      .then(() => {
        this.fontsReady = true;
        this.scheduleSlice();
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
    const h = Math.ceil(SPINE_BASE_HEIGHT * scale);
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

    const source = this.sourceFor(page);
    const texture = new Texture({
      source,
      frame: new Rectangle(rect.x, rect.y, rect.w, rect.h),
    });
    (variant === 'hi' ? this.hiTextures : this.loTextures).set(book.id, texture);
    return source;
  }

  private sourceFor(page: AtlasPage): CanvasSource {
    let source = this.sources.get(page.id);
    if (source === undefined) {
      source = new CanvasSource({
        resource: page.canvas as unknown as HTMLCanvasElement,
        autoGenerateMipmaps: true,
        label: `spine-atlas-${page.id}`,
      });
      this.sources.set(page.id, source);
    }
    return source;
  }

  private handleEvict(
    page: AtlasPage,
    keys: readonly string[],
    bucket: Map<string, Texture>,
  ): void {
    const source = this.sources.get(page.id);
    this.sources.delete(page.id);
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
