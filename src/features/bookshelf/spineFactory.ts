/**
 * features/bookshelf/spineFactory.ts — spine texture pipeline.
 *
 * The Excalidraw pattern: bake once, draw forever. Spines are rendered
 * upright by art/spines.renderSpine into 2048² atlas pages (art/atlas
 * shelf-packing), one Pixi CanvasSource per page, sub-rect Textures per book.
 * Two buckets: lo-res (≈0.62×, effectively permanent — 2 pages hold ~1500
 * spines) and hi-res (2×, sharper binding construction, page-LRU capped at 4
 * pages ≈ 64MB).
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
import type { ResolvedBookStyle } from '../../art/bookStyle';
import {
  renderSpine,
  SPINE_THICKNESS_RANGE,
  type Ctx2D,
  type SpineParams,
} from '../../art/spines';
import { getTheme, type LibraryTheme } from '../../art/themes';
import { readShelfMeta } from '../../data/books';
import { publishedBookBinding } from '../../data/designPrefs';
import type { Book } from '../../data/types';
import {
  bookStyleOverridesFor,
  resolveBookAppearance,
  spineArtHeight,
} from './bookIdentity';
import { paletteCss, placeholderTint } from './spinePalette';
import { fnv1a } from '../../art/noise';
import { FULL_BOOK_HEIGHT, bookClearHeight, fitBookHeight, type BookFit } from './bookFit';
import { BUILDS, DEFAULT_SHELF_DESIGN, type BuildSpec } from '../../art/shelfDesign';
import {
  bakeDpr,
  hiAtlasPages,
  spineBakeScale,
  spineGutter,
  type SpineVariant,
} from './spineScale';

export { paletteCss, placeholderTint, spineArtHeight };

export type { SpineVariant };

/**
 * Where a book STANDS, and how tall it may therefore be.
 *
 * The clear height inside a bay is not one number: it belongs to the case's
 * carpentry (`art/shelfDesign.BuildSpec.headroom`) and, under an arcade, to
 * the x the book stands at — tall under the crown of an arch, a foot shorter
 * at the pier beside it. `floorView` lays the row out and notes each book here
 * BEFORE asking how tall it is, and the cap is remembered so a book that later
 * moves — or a case that is rebuilt under it — drops the spine it baked at the
 * old height instead of stretching it.
 */
interface Stand {
  centerX: number;
  halfWidth: number;
  /** Clear height at that footprint, world px, air included. */
  cap: number;
}

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

/**
 * Bake scales live in `spineScale.ts` — device pixels per world pixel, and the
 * reason they are a module of their own is written up there.
 */
export {
  bakeDpr,
  HI_SCALE_BASE,
  LO_SCALE_BASE,
  spineBakeScale,
  spineSampling,
} from './spineScale';

/**
 * Time budget for one idle slice, in ms.
 *
 * This used to be a fixed count (6 spines per slice) — which is only a budget
 * if every spine costs the same, and they emphatically do not: a detailed
 * hi-res spine once measured at 1102ms on a software renderer while a lo-res
 * one took 54ms.
 * Six of the former is a seven-second frozen window, and that (not the disk
 * cache) was the bulk of the startup freeze. A slice now bakes ONE spine, then
 * keeps going only while the budget and the idle deadline both allow, so the
 * worst case is a single spine no matter how expensive the recipe becomes.
 */
const SLICE_BUDGET_MS = 8;

/** Never bake more than this many in one slice even if they are all cheap. */
const SLICE_MAX_BAKES = 12;

/**
 * How long the outgoing room's spines may be worn while their replacements
 * bake (`SpineFactory.armRetireWatchdog`).
 */
const RETIRE_MAX_MS = 6000;

/**
 * Cost of the most expensive spine seen so far, per variant. Used to stop a
 * slice BEFORE starting a bake that is likely to overrun the remaining budget,
 * rather than discovering it afterwards.
 */
const observedCost: Record<SpineVariant, number> = { lo: 4, hi: 12 };

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
  /** Per-book/variant authority captured when this request was queued. */
  generation: number;
  ctx?: SpineRowContext;
}

interface InFlightBake {
  /** `${variant}|${book.id}` — the atlas identity this job would replace. */
  key: string;
  /** Whole-room authority captured at dispatch. */
  epoch: number;
  /** Per-book/variant authority captured at request time. */
  generation: number;
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
/**
 * The world-px width a spine occupies: its thickness, rounded to a whole pixel
 * and clamped to the legal range.
 *
 * ONE function, because two callers need the identical answer and getting it
 * from two copies of the same arithmetic is a resolution bug waiting to happen.
 * `floorView` lays the row out with it and the factory bakes to it; if they
 * ever disagree by a pixel the sprite is resampled on every frame, which is
 * exactly the softness this pipeline was just measured and fixed for.
 */
export function spineArtWidth(w: number): number {
  return Math.min(
    SPINE_THICKNESS_RANGE.max,
    Math.max(SPINE_THICKNESS_RANGE.min, Math.round(w)),
  );
}

export class SpineFactory {
  private readonly loAtlas: AtlasManager;
  private readonly hiAtlas: AtlasManager;
  /**
   * GPU sources per atlas page, keyed `${variant}:${page.id}` — page ids are
   * PER-MANAGER counters, so lo page 0 and hi page 0 are different canvases.
   * (Keying by bare page.id once aliased every hi texture onto the lo canvas,
   * which is why high-detail binding art never showed at LOD0.)
   */
  private readonly sources = new Map<string, CanvasSource>();
  private readonly loTextures = new Map<string, Texture>();
  private readonly hiTextures = new Map<string, Texture>();
  /**
   * The OUTGOING room's spines, still worn by their books until each one's
   * replacement lands. See `invalidateAll` for why they are kept rather than
   * freed; `get()` falls back here and `retireOne` empties it a book at a time.
   */
  private readonly retiredLo = new Map<string, Texture>();
  private readonly retiredHi = new Map<string, Texture>();
  /** Fires if a retired generation is never fully replaced (`armRetireWatchdog`). */
  private retireTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Textures to free once the flush that replaces them has announced itself.
   * Freeing at retirement time would destroy a Texture a live sprite is still
   * pointing at, and Pixi nulls a destroyed texture's matrix — which surfaces
   * as `Cannot read properties of null (reading 'addressModeU')` on the next
   * render, taking the whole stage down for a frame.
   */
  private readonly freeAfterFlush: Texture[] = [];
  private readonly paramsCache = new Map<string, ResolvedBookStyle>();
  private readonly queue = new Map<string, QueueItem>();
  /** The room whose spine bias new/unstyled books inherit. */
  private theme: LibraryTheme = getTheme(null);
  /** Identity of the cloths currently baked in — see `setTheme`. */
  private clothKey: string = getTheme(null).id;
  /**
   * The carpentry the case is built in — the second half of how tall a book
   * is, and for a long time a half nothing here knew about.
   */
  private build: BuildSpec = BUILDS[DEFAULT_SHELF_DESIGN.build];
  /** Where each book stands, and the clear height it found there. */
  private readonly stands = new Map<string, Stand>();
  /** Cache-busting salt so a theme change re-derives every book's params. */
  private styleEpoch = 0;
  /** Bumped whenever every baked spine is dropped; stale worker results die. */
  private bakeEpoch = 0;
  /**
   * Per-book/variant authority, independent of the whole-room epoch above.
   *
   * A Studio edit invalidates one book while its old worker paint may still be
   * running. The old result must not become authoritative merely because the
   * room itself did not change. Keeping the counter on the atlas key also lets
   * lo and hi replacements settle independently.
   */
  private readonly bakeGenerations = new Map<string, number>();
  private readonly listeners = new Set<(bookIds: readonly string[]) => void>();
  private idle: { cancel: () => void } | null = null;
  private destroyed = false;

  /* --------------------------- off-thread state -------------------------- */

  private readonly offload: ArtOffload;
  /**
   * Worker jobs by unique dispatch id.
   *
   * This cannot be a Set of queue keys: after invalidation, the replacement is
   * allowed to run beside the stale job for the same key. A late old completion
   * must delete only its own record, never the replacement's.
   */
  private readonly inFlight = new Map<number, InFlightBake>();
  private nextFlightId = 1;
  /**
   * Books whose textures landed since the last flush. Batched to one listener
   * call per frame: a worker pool answers in a burst, and forty separate
   * `onTexturesChanged` calls would re-pick and re-request the whole visible
   * shelf forty times for one frame's worth of new pixels.
   */
  private readonly landed = new Set<string>();
  /**
   * Promises waiting for listed books to finish baking. Checked after every
   * flush and whenever the queue drains — the demo's temporal review caught
   * hi-res spines landing two seconds into a declared hold because nothing
   * here existed to gate on.
   */
  private readonly settleWaits: Array<{
    ids: Set<string>;
    hi: boolean;
    resolve: () => void;
  }> = [];
  private flushScheduled = false;
  /** Pages touched since the last flush (their GPU source needs an update). */
  private readonly dirtySources = new Set<CanvasSource>();

  /**
   * Every book the shelf has asked about.
   *
   * Needed because `invalidateAll` announces only books that had a baked
   * texture to drop, and on a fast atlas load there are none — the pages can
   * land before the first bake finishes. Without this the whole shelf would
   * sit on placeholders it never re-picked.
   */
  private readonly known = new Set<string>();

  /** Degrade mode never bakes hi-res. */
  readonly hiEnabled: boolean;

  /**
   * Device pixels per world pixel the bakes are sized against. One number for
   * the session: the renderer's own resolution never changes after `init`.
   */
  readonly dpr: number;

  /**
   * Gutter texels around each atlas rect, scaled with the bake.
   *
   * The pad exists so a mip level cannot average one spine's edge into its
   * neighbour's, and a mip texel is 2^k page texels — so a gutter that was
   * enough at bake scale 2 is half a gutter at scale 4.
   */
  private readonly gutter: number;

  constructor(opts: { hiEnabled?: boolean; offload?: ArtOffload; dpr?: number } = {}) {
    this.hiEnabled = opts.hiEnabled ?? true;
    // Degrade mode (software renderer) runs the renderer at resolution 1, and
    // it is also the mode where a 4× bake would be least affordable.
    this.dpr = opts.dpr ?? bakeDpr(!this.hiEnabled);
    this.gutter = spineGutter(this.dpr);
    this.offload = opts.offload ?? artOffload();
    this.loAtlas = new AtlasManager({
      maxPages: 2,
      padding: this.gutter,
      onEvict: (page, keys) => this.handleEvict('lo', page, keys, this.loTextures),
    });
    this.hiAtlas = new AtlasManager({
      maxPages: hiAtlasPages(this.dpr),
      padding: this.gutter,
      onEvict: (page, keys) => this.handleEvict('hi', page, keys, this.hiTextures),
    });
    // Start fetching + compiling the worker bundle now: it overlaps the app's
    // own boot, so the first spine request finds threads already alive.
    this.offload.warmUp();
  }

  onTexturesChanged(cb: (bookIds: readonly string[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * Resolves when every listed book has a live baked texture and nothing for
   * it remains queued or in-flight. When `hi` is true and hi-res is enabled,
   * both buckets must be settled — tier-0 views prefer hi, and waiting only
   * on lo still lets a decorated spine sharpen mid-hold.
   */
  whenReady(
    bookIds: readonly string[],
    opts?: { hi?: boolean; signal?: AbortSignal },
  ): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    const hi = opts?.hi === true && this.hiEnabled;
    const ids = [...new Set(bookIds)];
    if (
      opts?.signal?.aborted === true ||
      ids.length === 0 ||
      ids.every((id) => this.isSettled(id, hi))
    ) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let finished = false;
      let wait!: { ids: Set<string>; hi: boolean; resolve: () => void };
      const finish = (): void => {
        if (finished) return;
        finished = true;
        opts?.signal?.removeEventListener('abort', abort);
        resolve();
      };
      const abort = (): void => {
        const at = this.settleWaits.indexOf(wait);
        if (at >= 0) this.settleWaits.splice(at, 1);
        finish();
      };
      wait = { ids: new Set(ids), hi, resolve: finish };
      this.settleWaits.push(wait);
      opts?.signal?.addEventListener('abort', abort, { once: true });
      this.checkSettles();
    });
  }

  /**
   * Switch the room. Spine art is `seed → theme bias → per-book overrides`,
   * so every un-overridden book re-derives; books with explicit studio
   * overrides come back byte-identical (resolveBookStyle is deterministic and
   * overrides always win), which is exactly the "a favourite red leather book
   * keeps its identity in every room" rule.
   */
  setTheme(theme: LibraryTheme, clothKey?: string): void {
    if (this.destroyed) return;
    // The id is NOT sufficient. A reader can keep the preset and swap only
    // where the book cloths come from, which changes every spine's colour
    // without changing the room's name — comparing ids alone left the shelf
    // wearing the old cloths until something else happened to invalidate.
    const key = clothKey ?? theme.id;
    if (theme.id === this.theme.id && key === this.clothKey) return;
    this.theme = theme;
    this.clothKey = key;
    this.styleEpoch++;
    this.paramsCache.clear();
    this.invalidateAll();
  }

  /**
   * Retire every baked spine (theme switch). Listeners re-request; each book
   * keeps the art it is wearing until its own replacement lands.
   *
   * ## Retirement, not demolition
   *
   * This used to free everything on the spot: destroy both texture buckets,
   * `clear()` both atlases (whose `onEvict` destroys the GPU sources), then
   * announce — all synchronously, before a single new pixel had been drawn.
   * The announcement runs the listeners in the same tick, so `floorView`
   * re-picked, got `undefined`, and every book on every floor fell to
   * `Texture.WHITE + placeholderTint`. Measured on the demo recording: ten
   * frames, ~0.7s, of a shelf of flat untextured slabs — no construction,
   * tooling or gilt, and wearing the OUTGOING room's cloths because the
   * placeholder tint comes from the cached params. Then the whole shelf
   * repainted at once. The reader did not read that as "the room changed"; the
   * reader read it as the books disappearing.
   *
   * The old pixels were perfectly good until the new ones existed. So they
   * stay: the live buckets move to `retiredLo`/`retiredHi`, `get()` falls back
   * to them, and each book's retired texture is freed the moment its own
   * re-bake lands (`retireOne`, deferred past the flush so no sprite is ever
   * left holding a destroyed Texture). The reader sees bound spines
   * throughout, each turning into the new room's binding as it arrives.
   *
   * The atlases are deliberately NOT cleared: their handles are what keeps the
   * retired pixels valid, and a re-bake at the SAME size `alloc`s the very same
   * rect and paints straight over it, which costs nothing at all.
   *
   * What it does cost, measured rather than assumed: a book whose size changed
   * gets a fresh rect and abandons its old one, and `art/atlas.ts` never
   * reclaims space inside a page. A new build is a new headroom, so a preset
   * apply resizes most books at once — `scripts/probe-studio-repaint.mjs`
   * reports lo 1 → 1 pages and hi 1 → 2 across one swap, where clearing first
   * kept hi at 1. That is one page inside a bucket the LRU already caps
   * (`hiAtlasPages`), and it is the price of the books not vanishing.
   *
   * The announcement covers every book the shelf has ever ASKED about, not
   * just the ones holding a texture — that is what `known` is for, and it went
   * unread for a long time. `this.queue.clear()` below throws away pending
   * requests, and a book whose first bake had not landed yet has no texture to
   * report, so it was dropped in silence: nothing remembered it wanted a
   * spine, and it sat as a flat placeholder for the rest of the session. Same
   * defect as the stale-epoch branch in `paintOffThread`, one door along.
   */
  invalidateAll(): void {
    if (this.destroyed) return;
    const ids = new Set<string>(this.known);
    for (const variant of ['lo', 'hi'] as const) {
      const bucket = variant === 'hi' ? this.hiTextures : this.loTextures;
      for (const bookId of [...bucket.keys()]) {
        ids.add(bookId);
        this.retireActiveTexture(bookId, variant);
      }
      bucket.clear();
    }
    this.queue.clear();
    // Anything a worker is still painting belongs to the old room — let the
    // results arrive and be dropped rather than stalling on a cancel round-trip.
    this.bakeEpoch++;
    this.inFlight.clear();
    this.armRetireWatchdog();
    if (ids.size > 0) this.emit([...ids]);
    // A second invalidation can displace a retired generation before a landed
    // flush exists to free it. The emit above has synchronously repointed live
    // sprites; use the normal post-frame free list rather than demolishing a
    // Texture while Pixi may still be rendering it.
    if (this.freeAfterFlush.length > 0) this.scheduleFlush();
  }

  /**
   * Stop holding the outgoing room, whether or not it was replaced.
   *
   * A book that is off-screen is never re-requested, so without this its
   * retired texture would be worn for the life of the session — and the moment
   * the reader scrolls to it they would be looking at the previous room's
   * colours with nothing to say so. A placeholder is a worse picture but an
   * honest one, and the re-request that follows the announcement fixes it
   * within a frame or two.
   *
   * Generous, because the alternative failure is the exact bug this replaced:
   * a shelf of slabs. A large shelf's re-bake storm is comfortably inside it.
   */
  private armRetireWatchdog(): void {
    if (this.retiredLo.size + this.retiredHi.size === 0) return;
    if (this.retireTimer !== null) clearTimeout(this.retireTimer);
    this.retireTimer = setTimeout(() => {
      this.retireTimer = null;
      this.releaseRetired();
    }, RETIRE_MAX_MS);
  }

  /** Drop the whole retired generation, announcing before anything is freed. */
  private releaseRetired(): void {
    if (this.retireTimer !== null) {
      clearTimeout(this.retireTimer);
      this.retireTimer = null;
    }
    const ids = new Set<string>();
    const freeing: Texture[] = [];
    for (const held of [this.retiredLo, this.retiredHi]) {
      for (const [bookId, tex] of held) {
        ids.add(bookId);
        freeing.push(tex);
      }
      held.clear();
    }
    if (freeing.length === 0) return;
    // Announce FIRST — the listeners re-point their sprites synchronously, so
    // by the time these are freed nothing is holding one.
    if (!this.destroyed && ids.size > 0) this.emit([...ids]);
    for (const tex of freeing) {
      if (!tex.destroyed) tex.destroy(false);
    }
  }

  /**
   * One book's replacement has landed: it no longer needs the art it was
   * wearing. The free is DEFERRED to the end of the flush that announces the
   * new texture — until then the sprite is still pointing at the retired one,
   * and Pixi nulls a destroyed Texture's matrix out from under the renderer.
   */
  private retireOne(bookId: string, variant: SpineVariant): void {
    const held = variant === 'hi' ? this.retiredHi : this.retiredLo;
    const tex = held.get(bookId);
    if (tex === undefined) return;
    held.delete(bookId);
    this.deferTextureFree(tex);
    if (this.retiredLo.size + this.retiredHi.size === 0 && this.retireTimer !== null) {
      clearTimeout(this.retireTimer);
      this.retireTimer = null;
    }
  }

  /** Put a Texture on the post-announcement free list exactly once. */
  private deferTextureFree(texture: Texture): void {
    if (texture.destroyed || this.freeAfterFlush.includes(texture)) return;
    this.freeAfterFlush.push(texture);
  }

  /**
   * Move one currently published texture into the fallback generation.
   *
   * The live bucket is authority for NEW requests; the retired bucket is
   * ownership for pixels a sprite may still point at. Separating them lets an
   * invalidation request replacement art without destroying the old Texture
   * before `onTexturesChanged` has synchronously repointed every mounted
   * sprite. The atlas handle intentionally remains live so the retired frame
   * cannot be reused under the reader before its replacement arrives.
   */
  private retireActiveTexture(bookId: string, variant: SpineVariant): boolean {
    const bucket = variant === 'hi' ? this.hiTextures : this.loTextures;
    const held = variant === 'hi' ? this.retiredHi : this.retiredLo;
    const active = bucket.get(bookId);
    if (active === undefined) return false;
    bucket.delete(bookId);
    const prior = held.get(bookId);
    if (prior !== undefined && prior !== active) this.deferTextureFree(prior);
    held.set(bookId, active);
    return true;
  }

  /**
   * The book's fully-merged studio style — spine params, cover params and the
   * flat `style` the studio panel edits. Cached per book per theme epoch.
   */
  getStyle(book: Book): ResolvedBookStyle {
    this.known.add(book.id);
    // The binding is in the key as well as in the params: it is persisted
    // outside `cover_meta` (in `data/designPrefs.ts`, because a binding is not
    // a `BookStyle` field), so `bookStyleOverridesFor` cannot see it and the
    // epoch alone would keep serving the old preset's params.
    const pinned = publishedBookBinding(book.id);
    const key = `${this.styleEpoch}|${book.id}|${pinned ?? '-'}`;
    let resolved = this.paramsCache.get(key);
    if (resolved === undefined) {
      const base = resolveBookAppearance(
        book,
        this.theme,
        { pageCount: readShelfMeta(book)?.pageCount },
      );
      // `null` is not a default here — it means "let the seed choose", which
      // still gives the book one of the 62 bindings.
      resolved = { ...base, spine: { ...base.spine, binding: pinned } };
      this.paramsCache.set(key, resolved);
    }
    return resolved;
  }

  /**
   * Drop one book's cached style (studio edit / rename).
   *
   * The binding is part of the key and is not known here, so every entry for
   * this book at the current epoch goes rather than one computed key — a
   * targeted delete would miss precisely the case where the binding is what
   * changed.
   */
  invalidateStyle(bookId: string): void {
    const prefix = `${this.styleEpoch}|${bookId}|`;
    for (const key of this.paramsCache.keys()) {
      if (key.startsWith(prefix)) this.paramsCache.delete(key);
    }
  }

  getParams(book: Book): SpineParams {
    return this.getStyle(book).spine;
  }

  /**
   * Which room's params `getParams` is currently answering with.
   *
   * Read by `floorView` so a placeholder can be tinted in the room the reader
   * is actually looking at. A floor caches each book's params at layout time
   * and only `setBooks` re-derives them, so a shelf that fell back to
   * placeholders during a swap was painting them in the OUTGOING room's
   * pigment — the one moment the colour is guaranteed to be wrong.
   */
  get epoch(): number {
    return this.styleEpoch;
  }

  /**
   * Baked texture for a variant, or undefined (touches the page LRU).
   *
   * The fallback to the retired generation is the whole of what keeps a room
   * swap from emptying the shelf: between `invalidateAll` and this book's own
   * re-bake landing, the book is still wearing the outgoing room's spine and
   * that is a far better answer than a flat placeholder slab.
   */
  get(bookId: string, variant: SpineVariant): Texture | undefined {
    const atlas = variant === 'hi' ? this.hiAtlas : this.loAtlas;
    const tex = (variant === 'hi' ? this.hiTextures : this.loTextures).get(bookId);
    if (tex !== undefined) {
      // Touch the owning atlas page so LRU tracks last-visible time.
      atlas.get(`${variant}|${bookId}`);
      return tex;
    }
    const held = (variant === 'hi' ? this.retiredHi : this.retiredLo).get(bookId);
    if (held !== undefined && !held.destroyed) {
      atlas.get(`${variant}|${bookId}`);
      return held;
    }
    return undefined;
  }

  /**
   * The authored sprite for a book, or null when the library is absent or has
   * no frame to give.
   *
   * The choice is seeded from the book's own identity rather than its index,
   * so a book keeps its binding across restarts, re-layouts and theme
   * changes. `spineSeed` is folded in alongside the id so re-seeding a spine
   * from the studio actually picks a different book, which is the one case
   * where the binding *should* move.
   */
  /**
   * How tall this book stands, as a fraction of the opening.
   *
   * Derived straight from the book's own seed rather than from art. A shelf
   * only reads as a shelf when the tops of its books make an uneven line, and
   * the range is deliberately wide — half-height to full — because the first
   * flat specimen used a narrow band and the row looked like a fence.
   */
  heightFraction(book: Book): number {
    const h = fnv1a(`${book.id}|${book.spineSeed}|h`) >>> 0;
    // Bottom of the range is 0.62, not 0.5. A shelf wants an uneven skyline,
    // but half-height books read as paperbacks lost in a cabinet, and with the
    // range starting at 0.5 too many rows came out looking stubby against a
    // tall opening — the reference's volumes very nearly fill theirs.
    return 0.62 + ((h % 38) / 100);
  }

  /**
   * How snugly a trimmed book fills the room it has, 0–1 from its own seed.
   *
   * Only ever consulted for a book the case had to shorten. Trimming every
   * tall book in an arcaded bay to exactly the clear height would give the row
   * a dead flat top — the picket fence {@link heightFraction} exists to avoid
   * — so the trim lands somewhere in the top tenth instead.
   */
  private snug(book: Book): number {
    return ((fnv1a(`${book.id}|${book.spineSeed}|snug`) >>> 0) % 1000) / 1000;
  }

  /**
   * World-px height this book WANTS, before the case gets a say.
   *
   * Reported: *"books far too small relative to shelf height"* — in the
   * reference the volumes very nearly fill the opening. The old numbers made
   * that impossible: a 232px base against a 280px book zone is 83% before
   * jitter, and the studio's format band bottoms out at 150px, so a shelf of
   * seeded books averaged well under three quarters of the opening and the
   * case read as mostly empty air.
   *
   * An explicit studio height still wins — but only a genuinely explicit one.
   * `resolveBookStyle` fills `spine.height` in from the seeded format band for
   * every book, so testing the *resolved* value treats every seeded default as
   * a deliberate choice and the seeded proportions never get a look in. The
   * override record is the only place a real user decision lives.
   */
  nominalHeight(book: Book): number {
    return this.chosenHeight(book) ?? FULL_BOOK_HEIGHT * this.heightFraction(book);
  }

  /** The height the READER typed, or null when the seed is still choosing. */
  private chosenHeight(book: Book): number | null {
    const chosen = bookStyleOverridesFor(book)?.['height'];
    if (typeof chosen !== 'number' || !Number.isFinite(chosen)) return null;
    return spineArtHeight(this.getParams(book));
  }

  /**
   * World-px height to draw this book at — what it wants, trimmed to what the
   * case's carpentry actually leaves where it stands.
   *
   * This is the fix for *"the books are cutting into the bookshelf design"*.
   * Every height here used to be measured against the flat plank-to-plank gap,
   * which is the right number for a plain plank case and wrong for the
   * fifty-one builds whose opening has a shape; the tall spines simply ran up
   * through the arch heads. `bookFit` owns the arithmetic and
   * `art/shelfDesign` owns the clearance, so this is only the join.
   */
  artHeight(book: Book): number {
    return this.fitFor(book).applied;
  }

  /**
   * The whole story of one book's height: what it asked for, what the bay
   * gives, what it got. The studio prints it and the QA probes assert on it.
   */
  fitFor(book: Book): BookFit {
    const nominal = this.nominalHeight(book);
    const chosen = this.chosenHeight(book);
    const clear = this.stands.get(book.id)?.cap ?? FULL_BOOK_HEIGHT;
    // The reader's own way out: keep the height, accept the overlap. Reported
    // as untrimmed with the real clearance beside it, because the studio still
    // has to be able to say what is being overlapped.
    if (chosen !== null && bookStyleOverridesFor(book)?.['overlap'] === true) {
      return { nominal, clear, applied: nominal, trimmed: false };
    }
    const applied = fitBookHeight({ nominal, clear, snug: this.snug(book) });
    return { nominal, clear, applied, trimmed: applied < nominal - 0.001 };
  }

  /**
   * The carpentry the case is built in. Every book's cap moves with it, so
   * anything baked at the old one is dropped.
   */
  setBuild(build: BuildSpec): void {
    if (this.destroyed || build.id === this.build.id) return;
    this.build = build;
    const moved: string[] = [];
    for (const [bookId, stand] of this.stands) {
      const cap = bookClearHeight(build, stand.centerX, stand.halfWidth);
      if (Math.abs(cap - stand.cap) < 0.5) continue;
      this.stands.set(bookId, { ...stand, cap });
      moved.push(bookId);
    }
    for (const bookId of moved) this.dropBakes(bookId);
  }

  /**
   * Note where a book stands, before anyone asks how tall it is.
   *
   * `leanRad` matters: a book tipped seven degrees throws its top corner a
   * sixth of its own height sideways, which under an arcade can be the
   * difference between a crown and a pier. The footprint is widened by that
   * much rather than measured after the fact, because the height it would be
   * measured from is the answer we are computing.
   *
   * Announcing a changed cap is DEFERRED (`scheduleFlush`) rather than emitted
   * here: `floorView.setBooks` calls this in a loop while it is midway through
   * rebuilding its own sprites, and a synchronous `onTexturesChanged` would
   * re-enter that floor's refresh from inside it.
   */
  noteStand(book: Book, centerX: number, w: number, leanRad: number): void {
    if (this.destroyed) return;
    const halfWidth = w / 2 + Math.abs(Math.sin(leanRad)) * this.nominalHeight(book);
    const cap = bookClearHeight(this.build, centerX, halfWidth);
    const prev = this.stands.get(book.id);
    this.stands.set(book.id, { centerX, halfWidth, cap });
    if (prev !== undefined && Math.abs(prev.cap - cap) >= 0.5) this.dropBakes(book.id);
  }

  /**
   * Drop a book's baked spines because its SIZE changed, and tell the shelf on
   * the next frame. `invalidate` is the same thing with a synchronous
   * announcement, which is exactly what a caller mid-layout cannot take.
   */
  private dropBakes(bookId: string): void {
    for (const variant of ['lo', 'hi'] as const) {
      if (this.retireActiveTexture(bookId, variant)) {
        /*
         * A build-only change arrives after the previous room swap has
         * finished, so its active texture usually has NO older entry left in
         * `retired*`. Destroying the active one here therefore made `get()`
         * fall all the way through to Texture.WHITE until the resized bake
         * landed — the studio demo caught every visible book losing its
         * silhouettes, cords and gilt for two frames.
         *
         * Retire the pixels that are actually on screen, exactly as
         * `invalidateAll` does for a colour change. The atlas handle stays
         * live until `alloc()` sees the replacement size: same-size bakes may
         * paint in place; changed sizes release the old handle as part of the
         * allocation. Atlas pages never reclaim an individual rect, so the
         * held frame remains valid in either case.
         */
      }
      // The retired copy STAYS. It was baked against the old clear height, so
      // it is the wrong shape for the new stand — but the sprite is scaled to
      // the new height either way, so the reader sees the same book a per cent
      // or two out of proportion for a frame or two instead of a flat slab.
      this.queue.delete(`${variant}|${bookId}`);
    }
    this.armRetireWatchdog();
    this.landed.add(bookId);
    this.scheduleFlush();
  }

  /**
   * World-px width to draw this book at — the same clamp `floorView` lays the
   * row out with, so the bake and the sprite agree on the aspect ratio.
   *
   * `params.w` is not it: the row rounds to whole world px and clamps to the
   * legal spine range, and a bake sized off the unrounded value is resampled
   * by a hair on every frame for nothing.
   */
  artWidth(book: Book): number {
    return spineArtWidth(this.getParams(book).w);
  }

  /**
   * The exact texture size to bake this book at, in texels, plus the params to
   * draw with.
   *
   * One function, because the two bake paths (worker and inline) had a copy
   * each and they are the only thing standing between "the art is the shape
   * the book is" and a spine squashed by a quarter. It also closes the older
   * split: the sprite's height came from {@link artHeight} (the seeded
   * skyline) while the bake's came from `spineArtHeight(params)` (the
   * bibliographic format band), so every book WITHOUT an explicit studio
   * height — which is every book a reader has not edited, the Welcome book
   * included — was drawn at up to ±25% of the proportions it was painted at.
   */
  private bakeGeometry(
    book: Book,
    variant: SpineVariant,
  ): { params: SpineParams; scale: number; w: number; h: number } {
    const base = this.getParams(book);
    const worldW = this.artWidth(book);
    const worldH = this.artHeight(book);
    const scale = this.scaleFor(variant);
    return {
      params: { ...base, w: worldW },
      scale,
      w: Math.max(1, Math.ceil(worldW * scale)),
      h: Math.max(1, Math.ceil(worldH * scale)),
    };
  }

  /** Device-pixel bake scale for a bucket (see `spineScale.ts`). */
  scaleFor(variant: SpineVariant): number {
    return spineBakeScale(variant, this.dpr);
  }

  /**
   * Best texture available for a tier: tier 0 prefers hi, everything falls
   * back lo → undefined (placeholder).
   */
  pick(book: Book, tier: number): Texture | undefined {
    if (tier === 0 && this.hiEnabled) {
      const hi = this.get(book.id, 'hi');
      if (hi !== undefined) return hi;
    }
    return this.get(book.id, 'lo');
  }

  /**
   * Drop a book's baked textures (binding edit, spine reseed). The atlas
   * rects are released (pixels stay until page eviction) and listeners are
   * notified so live sprites fall back to placeholders + re-request.
   *
   * A PENDING request counts as something to announce, not just a landed
   * texture. Naming a brand-new book calls straight through to here while its
   * very first bake is usually still in the queue: the loop below deletes that
   * queue entry, and announcing only when a texture existed meant nobody was
   * ever told the book still wanted one. The book kept the flat placeholder it
   * was born with — a white rectangle where the reader's first book should be.
   */
  invalidate(bookId: string): void {
    if (this.destroyed) return;
    this.invalidateStyle(bookId);
    let touched = false;
    for (const variant of ['lo', 'hi'] as const) {
      const key = `${variant}|${bookId}`;
      // Revoke worker authority BEFORE announcing the invalidation. A listener
      // may synchronously request the replacement, and that request must see a
      // fresh generation even while the old job is still running.
      const painting = this.hasInFlight(key);
      this.bumpBakeGeneration(key);
      // Keep the exact Texture mounted sprites are wearing until its
      // replacement has landed and been announced. Destroying it here used to
      // null Pixi's texture matrix before listeners could repoint the sprite.
      if (this.retireActiveTexture(bookId, variant)) touched = true;
      if (this.queue.delete(key)) touched = true;
      // An in-flight-only book used to look untouched here, so no listener was
      // told to request its new generation. The old result then landed as if
      // nothing had changed. It is pending work and therefore material state.
      if (painting) touched = true;
    }
    if (touched) {
      this.armRetireWatchdog();
      this.emit([bookId]);
      if (this.freeAfterFlush.length > 0) this.scheduleFlush();
    }
  }

  /** Queue a bake (idempotent). Lower priority = baked sooner. */
  request(book: Book, variant: SpineVariant, priority: number, ctx?: SpineRowContext): void {
    if (this.destroyed) return;
    if (variant === 'hi' && !this.hiEnabled) return;
    const key = `${variant}|${book.id}`;
    if ((variant === 'hi' ? this.hiTextures : this.loTextures).has(book.id)) return;
    const generation = this.bakeGeneration(key);
    // Repeated render-loop requests are idempotent while the authoritative job
    // is already painting. A stale generation for the same key does NOT block
    // this path — that is precisely how a Studio replacement overtakes it.
    if (this.hasCurrentInFlight(key)) return;
    const existing = this.queue.get(key);
    if (existing !== undefined && existing.generation === generation) {
      existing.priority = Math.min(existing.priority, priority);
      if (ctx !== undefined) existing.ctx = ctx;
      return;
    }
    this.queue.set(key, { book, variant, priority, generation, ctx });
    this.pump();
  }

  destroy(): void {
    this.destroyed = true;
    // Resolve (and therefore detach abort listeners from) any room/demo gate.
    // A destroyed factory cannot make further progress, and leaving callers
    // pending turns a route change into a leaked transition promise.
    for (const wait of this.settleWaits.splice(0)) wait.resolve();
    this.idle?.cancel();
    this.idle = null;
    if (this.retireTimer !== null) {
      clearTimeout(this.retireTimer);
      this.retireTimer = null;
    }
    this.retiredLo.clear();
    this.retiredHi.clear();
    this.freeAfterFlush.length = 0;
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
    this.bakeGenerations.clear();
    this.stands.clear();
  }

  /* ------------------------------ internals ------------------------------ */

  /** Current per-book/variant authority. Missing keys begin at generation 0. */
  private bakeGeneration(key: string): number {
    return this.bakeGenerations.get(key) ?? 0;
  }

  /** Revoke every queued/in-flight result captured for the prior generation. */
  private bumpBakeGeneration(key: string): number {
    const next = this.bakeGeneration(key) + 1;
    this.bakeGenerations.set(key, next);
    return next;
  }

  /** Any physical worker job for this atlas key, including a revoked one. */
  private hasInFlight(key: string): boolean {
    for (const job of this.inFlight.values()) {
      if (job.key === key) return true;
    }
    return false;
  }

  /** A worker job that is still allowed to publish for the current authority. */
  private hasCurrentInFlight(key: string): boolean {
    const epoch = this.bakeEpoch;
    const generation = this.bakeGeneration(key);
    for (const job of this.inFlight.values()) {
      if (job.key === key && job.epoch === epoch && job.generation === generation) return true;
    }
    return false;
  }

  private isCurrentBake(key: string, epoch: number, generation: number): boolean {
    return epoch === this.bakeEpoch && generation === this.bakeGeneration(key);
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
      if (item.generation !== this.bakeGeneration(key)) {
        this.queue.delete(key);
        continue;
      }
      if (this.hasCurrentInFlight(key)) {
        this.queue.delete(key);
        continue;
      }
      this.queue.delete(key);
      const flightId = this.nextFlightId++;
      const epoch = this.bakeEpoch;
      this.inFlight.set(flightId, { key, epoch, generation: item.generation });
      void this.paintOffThread(key, item, flightId, epoch);
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
  private async paintOffThread(
    key: string,
    item: QueueItem,
    flightId: number,
    epoch: number,
  ): Promise<void> {
    const { book, variant, ctx: rowCtx } = item;
    const { params, scale, w, h } = this.bakeGeometry(book, variant);

    let paint: Awaited<ReturnType<ArtOffload['spine']>> = null;
    try {
      paint = await this.offload.spine({
        params,
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

    // Delete THIS dispatch only. A replacement for the same atlas key may have
    // started after invalidation and must remain visible to capacity/settle
    // checks when the revoked promise finally answers.
    this.inFlight.delete(flightId);
    if (this.destroyed) {
      paint?.bitmap.close();
      return;
    }
    if (!this.isCurrentBake(key, epoch, item.generation)) {
      // The room OR this exact book changed while it was painting. These pixels
      // have no publication authority, even if they happen to arrive last.
      //
      // A whole-room epoch change may still need this request put back: its
      // Book row remains current and only the room paint changed. A per-book
      // generation change must NOT put the old row back; invalidate() already
      // announced the replacement and its listener supplies the refreshed row.
      //
      // On a stocked shelf this healed itself and hid for a long time — any
      // pan or floor load re-requests every visible book. On a NEW library it
      // was the whole first impression: the room is dressed once at startup,
      // which bumps the epoch, and if that lands while the single Welcome
      // book is in flight then nothing ever asks again. It sat as a flat
      // placeholder rectangle for the life of the session, and adding a second
      // book was what appeared to "fix" it.
      // shots-now/welcome-bake.mjs is the regression test, and it deliberately
      // checks the one-book case.
      const generationStillCurrent = item.generation === this.bakeGeneration(key);
      if (
        generationStillCurrent &&
        !(variant === 'hi' ? this.hiTextures : this.loTextures).has(book.id) &&
        !this.queue.has(key) &&
        !this.hasCurrentInFlight(key)
      ) {
        this.queue.set(key, item);
      }
      paint?.bitmap.close();
      this.pump();
      return;
    }
    if (paint === null) {
      // No worker (or it failed): put the item back for the inline slice.
      if (
        !(variant === 'hi' ? this.hiTextures : this.loTextures).has(book.id) &&
        !this.queue.has(key) &&
        !this.hasCurrentInFlight(key)
      ) {
        this.queue.set(key, item);
      }
      this.scheduleSlice();
      return;
    }

    recordBakeSample({
      what: `spine|${variant}|${book.id.slice(0, 40)}`,
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
    const { rect, padded, page } = handle;
    const ctx = get2d(page.canvas);
    // The WHOLE reserved region, gutter included: stale ink left in a gutter is
    // averaged into every mip level and bleeds back out at minified zooms.
    ctx.clearRect(padded.x, padded.y, padded.w, padded.h);
    ctx.drawImage(bitmap as unknown as CanvasImageSource, rect.x, rect.y);

    const source = this.sourceFor(variant, page);
    const texture = new Texture({
      source,
      frame: new Rectangle(rect.x, rect.y, rect.w, rect.h),
    });
    (variant === 'hi' ? this.hiTextures : this.loTextures).set(book.id, texture);
    this.retireOne(book.id, variant);
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
      // Every book whose retired spine is on this list was announced by an
      // emit at or before this one, so no sprite is still pointing at one.
      this.drainFreeList();
      this.checkSettles();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  /** True when a bucket is live and nothing is still painting it. */
  private variantSettled(bookId: string, variant: SpineVariant): boolean {
    const key = `${variant}|${bookId}`;
    const bucket = variant === 'hi' ? this.hiTextures : this.loTextures;
    // A revoked worker may still be consuming CPU, but it can no longer alter
    // this texture. Settlement belongs to the current authority only.
    return bucket.has(bookId) && !this.queue.has(key) && !this.hasCurrentInFlight(key);
  }

  private isSettled(bookId: string, hi: boolean): boolean {
    if (!this.variantSettled(bookId, 'lo')) return false;
    return !hi || this.variantSettled(bookId, 'hi');
  }

  private checkSettles(): void {
    if (this.settleWaits.length === 0) return;
    for (let i = this.settleWaits.length - 1; i >= 0; i--) {
      const wait = this.settleWaits[i];
      let ready = true;
      for (const id of wait.ids) {
        if (!this.isSettled(id, wait.hi)) {
          ready = false;
          break;
        }
      }
      if (ready) {
        this.settleWaits.splice(i, 1);
        wait.resolve();
      }
    }
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
   *   1. EVERY lo-res spine outranks EVERY hi-res one. Lo establishes the
   *      binding; hi only sharpens its construction and costs an order of
   *      magnitude more. Interleaving them meant a shelf that was still half
   *      placeholder blocks while distant books sharpened.
   *   2. Within a variant, nearest-to-viewport first (the caller's priority).
   */
  private static rank(item: QueueItem): number {
    return (item.variant === 'hi' ? 1e6 : 0) + item.priority;
  }

  private processSlice(deadline: Deadline): void {
    if (this.destroyed) return;
    const items = [...this.queue.values()]
      .sort((a, b) => SpineFactory.rank(a) - SpineFactory.rank(b));
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
    // a bake it cannot afford. Decays slowly after one expensive binding.
      const cost = performance.now() - t0;
      observedCost[item.variant] = Math.max(cost, observedCost[item.variant] * 0.9);
    }
    for (const source of touchedSources) source.update();
    if (bakedIds.length > 0) this.emit(bakedIds);
    // The inline path does not go through `blit`, so it needs its own beat to
    // free the spines these bakes just replaced.
    if (bakedIds.length > 0) this.scheduleFlush();
    this.scheduleSlice();
  }

  /** Free the retired textures whose replacements have now been announced. */
  private drainFreeList(): void {
    if (this.freeAfterFlush.length === 0) return;
    for (const tex of this.freeAfterFlush) {
      if (!tex.destroyed) tex.destroy(false);
    }
    this.freeAfterFlush.length = 0;
  }

  private bakeOne(book: Book, variant: SpineVariant, rowCtx?: SpineRowContext): CanvasSource {
    const t0 = performance.now();
    const source = this.bakeOneTimed(book, variant, rowCtx);
    recordBakeSample({
      what: `spine|${variant}|${book.id.slice(0, 40)}`,
      ms: performance.now() - t0,
      kind: 'spine',
      at: t0,
    });
    return source;
  }

  private bakeOneTimed(book: Book, variant: SpineVariant, rowCtx?: SpineRowContext): CanvasSource {
    // Bake at the size the shelf DRAWS this book at, so a duodecimo's ornament
    // is not stretched when the compositor sizes the sprite.
    const { params, scale, w, h } = this.bakeGeometry(book, variant);
    const atlas = variant === 'hi' ? this.hiAtlas : this.loAtlas;
    const handle = atlas.alloc(`${variant}|${book.id}`, w, h);
    const { rect, padded, page } = handle;

    const ctx = get2d(page.canvas);
    ctx.save();
    // Clip to the padded rect so jittered strokes never bleed into neighbors.
    ctx.beginPath();
    ctx.rect(padded.x, padded.y, padded.w, padded.h);
    ctx.clip();
    ctx.clearRect(padded.x, padded.y, padded.w, padded.h);
    renderSpine(ctx, params, rect.x, rect.y, h, scale, {
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
    this.retireOne(book.id, variant);
    return source;
  }

  private sourceFor(variant: SpineVariant, page: AtlasPage): CanvasSource {
    const key = `${variant}:${page.id}`;
    let source = this.sources.get(key);
    if (source === undefined) {
      source = new CanvasSource({
        resource: page.canvas as unknown as HTMLCanvasElement,
        autoGenerateMipmaps: true,
        // Mips, but no BLEND between two of them.
        //
        // Trilinear is right for photographic texture and wrong for flat ink:
        // at the zoom the shelf rests at, the sampler sat at LOD ~0.3 and mixed
        // 30% of a half-resolution page into every pixel, which is a 30% blur
        // applied to art whose whole language is one hard outline. Measured on
        // the running shelf (mean |Laplacian| over the same crop): 10.09
        // trilinear → 11.41 with nearest mip selection, +13% edge energy for
        // nothing. The chain itself stays: without it, panning at tier 1
        // shimmers.
        mipmapFilter: 'nearest',
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
    // The retired generation lives on these same pages (see `invalidateAll` —
    // the atlases are not cleared on a room swap), so an eviction takes it with
    // it. Missing this would leave a book wearing a Texture whose GPU source
    // has just been destroyed, which is a renderer crash rather than a stale
    // picture.
    const retired = variant === 'hi' ? this.retiredHi : this.retiredLo;
    const freeing: Texture[] = [];
    for (const key of keys) {
      const sep = key.indexOf('|');
      const bookId = key.slice(sep + 1);
      let dropped = false;
      const tex = bucket.get(bookId);
      if (tex !== undefined) {
        bucket.delete(bookId);
        freeing.push(tex);
        dropped = true;
      }
      const held = retired.get(bookId);
      if (held !== undefined) {
        retired.delete(bookId);
        if (held !== tex) freeing.push(held);
        dropped = true;
      }
      if (dropped) bookIds.push(bookId);
    }
    // Announce while every outgoing Texture is still valid. FloorView
    // re-picks synchronously (another bucket or Texture.WHITE), so destruction
    // below cannot leave a mounted sprite pointing at a nulled Pixi matrix.
    if (!this.destroyed && bookIds.length > 0) this.emit(bookIds);
    for (const texture of freeing) {
      if (!texture.destroyed) texture.destroy(false);
    }
    source?.destroy();
  }

  private emit(bookIds: readonly string[]): void {
    for (const cb of this.listeners) cb(bookIds);
  }
}
