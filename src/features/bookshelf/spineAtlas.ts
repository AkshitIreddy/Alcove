/**
 * features/bookshelf/spineAtlas.ts — the authored spine sprite library.
 *
 * This is the runtime half of the render reset (`docs/design/RESET-render-architecture.md`).
 * Where the app used to paint every book from a brush recipe — thousands of
 * CPU stamps per spine, offloaded to workers, chunked across idle frames,
 * packed into atlases built at runtime — it now loads two or three WebP pages
 * and hands out sub-rectangles.
 *
 * The art is generated offline by `scripts/gen-spinewall-cn.mjs` (SDXL under
 * ControlNet, composition dictated by an authored layout) and packed by
 * `scripts/pack-spines.py` into `public/spines/`. Nothing here paints
 * anything, and that is the entire point: the measured 4,977ms first paint and
 * 15,314ms main-thread block were that painting.
 *
 * ## Why frames carry pixel sizes rather than a normalised height
 *
 * The packer scales every sprite by the same factor, so a frame's `w`/`h` in
 * the atlas *are* the book's real proportions. A short book is short because
 * its sprite is short — no metadata, no reconstruction, and a row of mixed
 * heights reads as a shelf for free. `heightFraction` exposes that against the
 * tallest book in the library so callers can size in world units.
 */

import { Assets, Rectangle, Texture } from 'pixi.js';

/** One packed sprite. Mirrors an entry in `public/spines/manifest.json`. */
export interface SpineFrame {
  readonly id: string;
  /** Binding family — `leather`, `cloth`, `vivid`, `paper`, `pale`. */
  readonly style: string;
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface SpineManifest {
  readonly pageSize: number;
  readonly pages: number;
  readonly tallest: number;
  readonly frames: readonly SpineFrame[];
}

/**
 * Where the shipped atlas lives. Vite serves `public/` from the app root, and
 * Tauri bundles it the same way, so one path works in dev, in the browser
 * harness and in the packaged app.
 */
const BASE = 'spines';

export class SpineAtlas {
  private manifest: SpineManifest | null = null;
  private pages: Texture[] = [];
  /** Sub-rect textures, built lazily and cached by frame id. */
  private readonly textures = new Map<string, Texture>();
  private readonly byStyle = new Map<string, SpineFrame[]>();
  private loading: Promise<boolean> | null = null;

  /** True once the atlas is usable. */
  get ready(): boolean {
    return this.manifest !== null;
  }

  /** Tallest packed sprite in texture px — the denominator for `heightFraction`. */
  get tallest(): number {
    return this.manifest?.tallest ?? 1;
  }

  get frameCount(): number {
    return this.manifest?.frames.length ?? 0;
  }

  /**
   * Load the manifest and every page. Idempotent and safe to call from
   * several places at once; concurrent callers share one flight.
   *
   * Resolves `false` rather than throwing when the atlas is missing. A build
   * without generated art is a degraded shelf, not a broken app — callers fall
   * back to flat tinted spines, which is also what the e2e harness runs on.
   */
  load(): Promise<boolean> {
    if (this.loading !== null) return this.loading;
    this.loading = this.loadOnce().catch(() => false);
    return this.loading;
  }

  private async loadOnce(): Promise<boolean> {
    const res = await fetch(`${BASE}/manifest.json`);
    if (!res.ok) return false;
    const manifest = (await res.json()) as SpineManifest;
    if (!Array.isArray(manifest.frames) || manifest.frames.length === 0) return false;

    this.pages = await Promise.all(
      Array.from({ length: manifest.pages }, (_, i) => Assets.load<Texture>(`${BASE}/atlas-${i}.webp`)),
    );

    for (const frame of manifest.frames) {
      let list = this.byStyle.get(frame.style);
      if (list === undefined) {
        list = [];
        this.byStyle.set(frame.style, list);
      }
      list.push(frame);
    }
    this.manifest = manifest;
    return true;
  }

  /** Every style present in the shipped library. */
  styles(): readonly string[] {
    return [...this.byStyle.keys()];
  }

  /**
   * Deterministically choose a frame for a book.
   *
   * `seed` should be a stable hash of the book's identity, so the same book
   * keeps the same binding across restarts, theme changes and re-layouts —
   * a book whose spine changed every launch would read as a different book.
   *
   * `styles` is a preference list, not a filter: a theme asks for the families
   * that suit it, and if the library ships none of them we fall back to the
   * whole set rather than returning nothing.
   */
  pick(seed: number, styles?: readonly string[]): SpineFrame | null {
    const manifest = this.manifest;
    if (manifest === null) return null;

    let pool: readonly SpineFrame[] = manifest.frames;
    if (styles !== undefined && styles.length > 0) {
      const wanted: SpineFrame[] = [];
      for (const style of styles) {
        const list = this.byStyle.get(style);
        if (list !== undefined) wanted.push(...list);
      }
      if (wanted.length > 0) pool = wanted;
    }
    return pool[Math.abs(seed) % pool.length] ?? null;
  }

  /** How tall this book is relative to the tallest in the library, in (0, 1]. */
  heightFraction(frame: SpineFrame): number {
    return frame.h / this.tallest;
  }

  /**
   * The drawable texture for a frame.
   *
   * Sub-rect textures share the page's underlying GPU resource, so this is a
   * view rather than a copy and costs nothing beyond the first construction.
   */
  texture(frame: SpineFrame): Texture | undefined {
    const cached = this.textures.get(frame.id);
    if (cached !== undefined) return cached;
    const page = this.pages[frame.page];
    if (page === undefined) return undefined;
    const texture = new Texture({
      source: page.source,
      frame: new Rectangle(frame.x, frame.y, frame.w, frame.h),
    });
    this.textures.set(frame.id, texture);
    return texture;
  }

  destroy(): void {
    for (const texture of this.textures.values()) texture.destroy(false);
    this.textures.clear();
    this.byStyle.clear();
    this.pages = [];
    this.manifest = null;
    this.loading = null;
  }
}

/**
 * The process-wide library. One atlas serves every shelf, every studio
 * preview and every pulled-book overlay; there is no per-view state to keep.
 */
export const spineAtlas = new SpineAtlas();
