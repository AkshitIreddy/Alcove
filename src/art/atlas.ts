/**
 * art/atlas.ts — sprite atlas pages for baked spines.
 *
 * 2048×2048 canvas pages, shelf-order packing (rows of similar-height rects,
 * left→right, top→bottom — spines arrive in shelf order so rows pack tight),
 * page-level LRU with a configurable cap (~4 pages/bucket per the doc).
 *
 * The manager owns geometry only: callers draw into `handle.page.canvas` at
 * `handle.rect` (renderSpine) and blit from it per frame. Space inside a page
 * is never reclaimed per-rect — when the budget is exceeded the whole
 * least-recently-used PAGE is dropped (evict callback fires so consumers can
 * destroy GPU textures) and its spines re-bake on demand.
 */

export interface AtlasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type AtlasCanvas = OffscreenCanvas | HTMLCanvasElement;

export interface AtlasPage {
  /** Monotonically increasing id — never reused, safe as a texture key. */
  readonly id: number;
  readonly canvas: AtlasCanvas;
  readonly size: number;
}

export interface AtlasHandle {
  readonly key: string;
  readonly page: AtlasPage;
  readonly rect: AtlasRect;
  /**
   * `rect` plus its gutter — the whole region this key reserved.
   *
   * Consumers need it to CLEAR before they draw. Wiping `rect` alone leaves
   * whatever the previous occupant painted in the gutter, and a gutter is not
   * dead pixels: every mip level of the page averages across it, so at any
   * minified zoom the stale ink bleeds back into the neighbour it was supposed
   * to be keeping out. (Clearing `rect` ±1 was fine while the padding *was* 1.)
   */
  readonly padded: AtlasRect;
}

export interface AtlasManagerOptions {
  /** Page edge in px. Default 2048. */
  pageSize?: number;
  /** LRU cap on live pages. Default 4. */
  maxPages?: number;
  /** Gutter around each rect to prevent sampling bleed. Default 1. */
  padding?: number;
  /** Canvas factory — injectable for tests/headless. Defaults to OffscreenCanvas. */
  createCanvas?: (size: number) => AtlasCanvas;
  /** Called when a page is evicted, with every key that lived on it. */
  onEvict?: (page: AtlasPage, keys: readonly string[]) => void;
}

interface Shelf {
  y: number;
  h: number;
  /** Next free x on this shelf. */
  x: number;
}

interface PageState {
  page: AtlasPage;
  shelves: Shelf[];
  /** Top of the unallocated region below the last shelf. */
  nextY: number;
  keys: Set<string>;
  lastUsed: number;
  /** Texels handed out so far (never reclaimed — see the file header). */
  reserved: number;
}

/** A shelf accepts a rect whose height fits within [h*..., h] tolerance. */
const SHELF_HEIGHT_SLACK = 1.35;

/** Per-page bookkeeping the budget report reads. */
export interface AtlasUsage {
  /** Page id. */
  id: number;
  /** Live rects on this page. */
  rects: number;
  /** Texels reserved by those rects, gutters included. */
  used: number;
  /** Texels the page has. */
  capacity: number;
  /** used / capacity, 0-1. */
  fill: number;
}

function defaultCreateCanvas(size: number): AtlasCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

export class AtlasManager {
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly padding: number;
  private readonly createCanvas: (size: number) => AtlasCanvas;
  private readonly onEvict: ((page: AtlasPage, keys: readonly string[]) => void) | undefined;

  private readonly pageStates: PageState[] = [];
  private readonly handles = new Map<string, AtlasHandle>();
  private tick = 0;
  private nextPageId = 0;

  constructor(opts: AtlasManagerOptions = {}) {
    this.pageSize = opts.pageSize ?? 2048;
    this.maxPages = Math.max(1, opts.maxPages ?? 4);
    this.padding = opts.padding ?? 1;
    this.createCanvas = opts.createCanvas ?? defaultCreateCanvas;
    this.onEvict = opts.onEvict;
  }

  /** Number of live pages. */
  get pageCount(): number {
    return this.pageStates.length;
  }

  /** Live pages (LRU metadata not exposed). */
  get pages(): readonly AtlasPage[] {
    return this.pageStates.map((s) => s.page);
  }

  /**
   * How full each live page is.
   *
   * Exists because raising a bake scale is a decision about MEMORY, and the
   * only honest way to make it is to know how many spines a page actually
   * holds rather than how many the arithmetic says it should.
   */
  usage(): AtlasUsage[] {
    const capacity = this.pageSize * this.pageSize;
    return this.pageStates.map((s) => ({
      id: s.page.id,
      rects: s.keys.size,
      used: s.reserved,
      capacity,
      fill: s.reserved / capacity,
    }));
  }

  /** Look up an existing handle; touches its page for LRU. */
  get(key: string): AtlasHandle | undefined {
    const handle = this.handles.get(key);
    if (handle) this.touch(handle.page.id);
    return handle;
  }

  has(key: string): boolean {
    return this.handles.has(key);
  }

  /**
   * Allocate a w×h rect for `key`. Returns the existing handle when one with
   * the same size is already live (touching its page). May evict the LRU page
   * when every page is full and the cap is reached — the evict callback fires
   * before the replacement page is created.
   */
  alloc(key: string, w: number, h: number): AtlasHandle {
    if (w <= 0 || h <= 0) throw new Error(`atlas: invalid rect ${w}x${h} for "${key}"`);
    const pw = w + this.padding * 2;
    const ph = h + this.padding * 2;
    if (pw > this.pageSize || ph > this.pageSize) {
      throw new Error(`atlas: rect ${w}x${h} exceeds page size ${this.pageSize}`);
    }

    const existing = this.handles.get(key);
    if (existing) {
      if (existing.rect.w === w && existing.rect.h === h) {
        this.touch(existing.page.id);
        return existing;
      }
      this.release(key);
    }

    // Try live pages in order.
    for (const state of this.pageStates) {
      const rect = this.placeInPage(state, pw, ph);
      if (rect) return this.commit(state, key, rect, w, h);
    }

    // Need a fresh page: under cap → grow, at cap → evict LRU first.
    if (this.pageStates.length >= this.maxPages) this.evictLru();
    const state = this.addPage();
    const rect = this.placeInPage(state, pw, ph);
    if (!rect) throw new Error(`atlas: rect ${w}x${h} does not fit an empty page`);
    return this.commit(state, key, rect, w, h);
  }

  /** Forget a handle. Its pixels stay until the page is evicted. */
  release(key: string): void {
    const handle = this.handles.get(key);
    if (!handle) return;
    this.handles.delete(key);
    const state = this.pageStates.find((s) => s.page.id === handle.page.id);
    state?.keys.delete(key);
  }

  /** Drop every page (fires the evict callback for each). */
  clear(): void {
    while (this.pageStates.length > 0) this.evictLru();
  }

  /* ------------------------------ internals ------------------------------ */

  private touch(pageId: number): void {
    const state = this.pageStates.find((s) => s.page.id === pageId);
    if (state) state.lastUsed = ++this.tick;
  }

  private addPage(): PageState {
    const page: AtlasPage = {
      id: this.nextPageId++,
      canvas: this.createCanvas(this.pageSize),
      size: this.pageSize,
    };
    const state: PageState = {
      page,
      shelves: [],
      nextY: 0,
      keys: new Set(),
      lastUsed: ++this.tick,
      reserved: 0,
    };
    this.pageStates.push(state);
    return state;
  }

  /**
   * Shelf-order packing: reuse a fitting shelf, else open a new one.
   *
   * First-fit, and deliberately not best-fit — they are the same function
   * here. A shelf's height is exactly the height of the rect that opened it,
   * so if two shelves both accept a rect of height `ph` (both heights inside
   * `[ph, ph·SLACK]`, i.e. within SLACK of each other), the later one must be
   * the TALLER: a shorter opener would have landed on the earlier shelf
   * instead of starting its own. The first shelf that fits is therefore always
   * the tightest one, and a best-fit scan was measured to change no placement.
   */
  private placeInPage(state: PageState, pw: number, ph: number): AtlasRect | null {
    for (const shelf of state.shelves) {
      if (ph <= shelf.h && ph * SHELF_HEIGHT_SLACK >= shelf.h && shelf.x + pw <= this.pageSize) {
        const rect: AtlasRect = { x: shelf.x, y: shelf.y, w: pw, h: ph };
        shelf.x += pw;
        return rect;
      }
    }
    if (state.nextY + ph <= this.pageSize) {
      const shelf: Shelf = { y: state.nextY, h: ph, x: pw };
      state.shelves.push(shelf);
      state.nextY += ph;
      return { x: 0, y: shelf.y, w: pw, h: ph };
    }
    return null;
  }

  private commit(
    state: PageState,
    key: string,
    padded: AtlasRect,
    w: number,
    h: number,
  ): AtlasHandle {
    const handle: AtlasHandle = {
      key,
      page: state.page,
      rect: { x: padded.x + this.padding, y: padded.y + this.padding, w, h },
      padded: { ...padded },
    };
    this.handles.set(key, handle);
    state.keys.add(key);
    state.lastUsed = ++this.tick;
    state.reserved += padded.w * padded.h;
    return handle;
  }

  private evictLru(): void {
    if (this.pageStates.length === 0) return;
    let lruIndex = 0;
    for (let i = 1; i < this.pageStates.length; i++) {
      const cur = this.pageStates[i] as PageState;
      const lru = this.pageStates[lruIndex] as PageState;
      if (cur.lastUsed < lru.lastUsed) lruIndex = i;
    }
    const [evicted] = this.pageStates.splice(lruIndex, 1);
    if (!evicted) return;
    const keys = [...evicted.keys];
    for (const key of keys) this.handles.delete(key);
    this.onEvict?.(evicted.page, keys);
  }
}
