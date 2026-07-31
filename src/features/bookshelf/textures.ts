/**
 * features/bookshelf/textures.ts — environment textures (wood, back panel,
 * rails, crown, shadow, paper, empty-floor doodles) as Pixi textures.
 *
 * All bitmap art bakes asynchronously through src/art (disk-cached inside
 * Tauri); consumers show flat token-colored placeholders until `onReady`
 * fires per kind, then crossfade the real bitmaps in. Tiny synchronous
 * gradient/doodle textures (wall shade, empty-floor hints) are baked inline
 * here — a few strokes on small canvases, no async round-trip needed.
 */

import { CanvasSource, ImageSource, Rectangle, Texture } from 'pixi.js';
import {
  bakeThemedBackPanel,
  bakeThemedCrown,
  bakeThemedPlank,
  bakeThemedRail,
  renderBackdrop,
  renderPlate,
  renderShelfDetail,
} from '../../art/caseArt';
import { bakeCached } from '../../art/bake';
import { installArtRoutes } from './artRoutes';
import { libraryKey } from './libraryKey';
import { bakePaperTile, bakeWallpaperTile } from '../../art/paper';
import { PROP_H, PROP_W, renderProp, type PropKind } from '../../art/props';
import type { Ctx2D } from '../../art/spines';
import {
  getTheme,
  type BackdropId,
  type LibraryTheme,
  type ThemeId,
  type WallpaperSpec,
} from '../../art/themes';
import {
  bakeBackPanel,
  bakeCrown,
  bakeShelfPlank,
  bakeShelfShadowStrip,
  bakeSideRail,
} from '../../art/wood';
import { doubleStroke } from '../../art/wobble';
import { fnv1a, mulberry32 } from '../../art/noise';
import {
  BOOK_ZONE_H,
  CASE_SHADE_W,
  CROWN_H,
  CROWN_LIP,
  FLOOR_H,
  RAIL_W,
  SHELF_WIDTH,
} from './constants';

export type EnvKind =
  | 'plank'
  | 'shadow'
  | 'paper'
  | 'back'
  | 'rail'
  | 'crown'
  | 'wallpaper'
  | 'backdrop';

/**
 * The baked wall strip. Vertical features (dado rails, glazing bars, shoji
 * lattice) repeat on FLOOR_H, but a backdrop renderer also scatters one-off
 * marks — trowel sweeps, a ghost fresco, peeling lath — across whatever
 * height it is handed. Baking THREE floors at a time and tiling that keeps
 * the pitch correct while pushing the visible repeat three times further
 * apart, which is the difference between "a wall" and "a wallpaper sample".
 */
export const BACKDROP_STRIP_W = 640;
export const BACKDROP_STRIP_FLOORS = 3;

/** World-px height of the under-plank detail strip (drawers / bunting). */
export const SHELF_DETAIL_H = 34;

/* ------------------------------- case halo -------------------------------- */

/** How far the case's shadow reaches onto the wall, world px. */
export const CASE_HALO_PAD = CASE_SHADE_W;

/**
 * Width of the vertical edge slice: the whole falloff outside the case, plus
 * the cornice's overhang, plus a pad's worth of overlap INTO the case. The
 * overlap is deliberate — it is drawn behind an opaque back panel, so the
 * slice can never end in a visible seam against the case's own edge.
 */
export const CASE_HALO_EDGE_W = CASE_HALO_PAD * 2 + CROWN_LIP;

/** Rows lifted for the edge slice (any height works; it is constant in y). */
const HALO_EDGE_H = 8;

/** Extra canvas below the cornice so the vertical profile can settle. */
const HALO_TAIL = 220;

/** Gaussian radius in world px — a soft architectural shadow, not a line. */
const HALO_BLUR = 22;

/** Near-black warm, per the reference's deep surrounds. */
const HALO_INK = '34, 24, 15';
const HALO_ALPHA = 0.42;

/** Halos are pure low-frequency; half a world pixel is more than enough. */
const HALO_SCALE = 0.5;

/** The two frames the world draws the case's wall shadow from. */
export interface CaseHalo {
  /** The cornice's halo, ending exactly at y = 0 (world). */
  top: Texture;
  /** One floor's worth of vertical edge falloff; tiles down both sides. */
  edge: Texture;
}

/** A room to bake the case in. */
export interface ThemeRequest {
  themeId: ThemeId;
  wallpaper: WallpaperSpec;
  backdrop: BackdropId;
}

/**
 * Bake a multi-floor strip of the room's wall. Same disk cache as every other
 * themed part (art/bake.ts), keyed by theme x wall x wallpaper x size.
 */
function bakeWallStrip(
  theme: LibraryTheme,
  backdrop: BackdropId,
  dpr: number,
  wallpaper: WallpaperSpec,
): Promise<ImageBitmap> {
  const w = BACKDROP_STRIP_W;
  const h = FLOOR_H * BACKDROP_STRIP_FLOORS;
  const key =
    // `v2`: the wall now hangs a graded printed sheet from the generated
    // wallpaper library, so bakes persisted by the procedural-only recipe are
    // no longer valid.
    `wall|v2|${theme.id}|${backdrop}|${wallpaper.pattern}|${wallpaper.colourway}|${w}x${h}`;
  return bakeCached(key, dpr, async () => {
    const canvas = makeCanvas(Math.ceil(w * dpr), Math.ceil(h * dpr)) as OffscreenCanvas;
    const ctx = get2d(canvas);
    if (ctx === null) throw new Error('textures: wall strip 2d context unavailable');
    ctx.scale(dpr, dpr);
    renderBackdrop(ctx as Ctx2D, theme, backdrop, w, h, {
      seed: fnv1a(`${theme.id}|${backdrop}|wall`),
      floorH: FLOOR_H,
      wallpaper,
    });
    return canvas;
  });
}

/**
 * Fold a wall strip into a vertically mirrored tile.
 *
 * The strip is three floors tall and tiles horizontally, but nothing makes its
 * last row match its first — so tiling it in Y put a hard brightness step
 * across the whole frame every `FLOOR_H * 3` world px, which is exactly the
 * horizontal banding visible whenever the shelf is zoomed out. Stacking the
 * strip against a flipped copy of itself makes the vertical period seamless by
 * construction: every joint is now a mirror line through matching pixels.
 *
 * The cost is one extra `drawImage` per theme and double the texture height;
 * the alternative (authoring the wall recipe to wrap) lives in `wallpaper.ts`
 * and would still not fix the strip's *lighting* gradient, which is what the
 * step actually was.
 */
function mirrorTileY(bitmap: ImageBitmap): AnyCanvas {
  const w = bitmap.width;
  const h = bitmap.height;
  const canvas = makeCanvas(w, h * 2);
  const ctx = get2d(canvas);
  if (ctx === null) return canvas;
  ctx.drawImage(bitmap, 0, 0);
  ctx.save();
  ctx.translate(0, h * 2);
  ctx.scale(1, -1);
  ctx.drawImage(bitmap, 0, 0);
  ctx.restore();
  return canvas;
}

/*
 * Every bake below goes through `art/bake.ts`, which will hand the recipe to
 * the art worker when `artRoutes` recognises its cache key (see that module —
 * the case, the wall and the base wood are all routed). Nothing here has to
 * know about threads: a themed plank is still `bakeThemedPlank(...)`, it just
 * no longer costs this thread a second of brush work.
 */
installArtRoutes();

/** Identity of a baked room — same key ⇒ same case art. */
export function themeKeyOf(req: ThemeRequest): string {
  return libraryKey(req.themeId, req.wallpaper, req.backdrop);
}

/** Case wood stains (settings.shelfWoodStain). 'oak' = the baked base art. */
export type WoodStain = 'oak' | 'walnut' | 'cherry' | 'cream';

/** Wall patterns (settings.wallpaperPattern). 'plain' = paper only. */
export type WallpaperPattern = 'damask' | 'stars' | 'botanical' | 'plain';

/** The env kinds that receive a wood-stain tint pass. */
const STAINED_KINDS: ReadonlySet<EnvKind> = new Set(['plank', 'back', 'rail', 'crown']);

/** Flat placeholder tints (match the baked art's average tones). */
export const PLACEHOLDER_TINTS = {
  plank: 0x7d5e40,
  backdrop: 0xefe4cc,
  back: 0x604b35,
  rail: 0x7a5c3e,
  crown: 0x7d5e40,
} as const;

/** Number of distinct empty-floor doodle variants (see getEmptyDoodle). */
export const EMPTY_DOODLE_VARIANTS = 3;

/** World-px design size of the doodle textures. */
export const EMPTY_DOODLE_W = 200;
export const EMPTY_DOODLE_H = 130;

/** Deterministic doodle variant for a floor. */
export function doodleVariantFor(floorIndex: number): number {
  return fnv1a(`doodle|${floorIndex}`) % EMPTY_DOODLE_VARIANTS;
}

/**
 * Doodle "chalk pencil" tones — light warm strokes that read on the DARK
 * back panel (dark graphite vanishes against it). Opaque colors rather than
 * translucent white keep the look identical across renderers.
 */
const GRAPHITE_STROKE = '#c9bba1';
const GRAPHITE_SOFT = '#ab9d85';

function textureFromBitmap(bitmap: ImageBitmap, mipmaps: boolean): Texture {
  const source = new ImageSource({
    resource: bitmap,
    autoGenerateMipmaps: mipmaps,
  });
  return new Texture({ source });
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

/**
 * IMPORTANT: small synchronously-authored art (shade gradients, doodles) must
 * reach the GPU as an ImageBitmap (ImageSource), NOT as a live CanvasSource.
 * Direct canvas uploads deliver wrong pixels on some renderers (headless
 * SwiftShader garbles both alpha and content — the original "invisible
 * empty-shelf hint" bug), while the ImageBitmap path — used by every baked
 * env texture (planks, rails, crown) — renders correctly everywhere.
 * OffscreenCanvas.transferToImageBitmap() makes that conversion synchronous.
 */
function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function get2d(c: AnyCanvas): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null {
  return (c as OffscreenCanvas).getContext('2d');
}

function textureFromCanvas(canvas: AnyCanvas): Texture {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return new Texture({
      source: new ImageSource({ resource: canvas.transferToImageBitmap() }),
    });
  }
  return new Texture({
    source: new CanvasSource({ resource: canvas as HTMLCanvasElement }),
  });
}

/**
 * Stain a baked wood bitmap into a new canvas (cheap composite passes; no
 * SVG filters — the art-pipeline bake-once rule stays intact since the base
 * bitmap comes from the disk-cached bake).
 */
function applyStain(bitmap: ImageBitmap, stain: WoodStain): AnyCanvas {
  const canvas = makeCanvas(bitmap.width, bitmap.height);
  const ctx = get2d(canvas);
  if (!ctx) return canvas;
  ctx.drawImage(bitmap, 0, 0);
  if (stain === 'walnut') {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(96, 66, 40, 0.5)';
    ctx.fillRect(0, 0, bitmap.width, bitmap.height);
  } else if (stain === 'cherry') {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(173, 74, 48, 0.38)';
    ctx.fillRect(0, 0, bitmap.width, bitmap.height);
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = 'rgba(150, 40, 26, 0.14)';
    ctx.fillRect(0, 0, bitmap.width, bitmap.height);
  } else if (stain === 'cream') {
    // Painted case: a coat of cream over the wood, grain ghosting through.
    ctx.fillStyle = 'rgba(241, 231, 210, 0.72)';
    ctx.fillRect(0, 0, bitmap.width, bitmap.height);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.3;
    ctx.drawImage(bitmap, 0, 0);
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

export class EnvTextures {
  plank: Texture | null = null;
  shadow: Texture | null = null;
  paper: Texture | null = null;
  back: Texture | null = null;
  rail: Texture | null = null;
  crown: Texture | null = null;
  wallpaper: Texture | null = null;
  /** One floor-tall strip of the room's wall; tiled across the whole world. */
  backdropStrip: Texture | null = null;

  private readonly doodles = new Map<number, Texture>();
  private readonly props = new Map<number, Texture>();
  private readonly plaques = new Map<string, Texture>();
  private halo: CaseHalo | null = null;
  private shelfDetail: Texture | null = null;
  private starCharm: Texture | null = null;
  private ribbon: Texture | null = null;
  private trashDrawer: Texture | null = null;
  private selectCaret: Texture | null = null;
  private readonly listeners = new Set<(kind: EnvKind) => void>();
  private destroyed = false;

  /** Untinted bake results, kept so stains can re-derive without re-baking. */
  private readonly baseBitmaps = new Map<EnvKind, ImageBitmap>();
  /** Baked pattern tiles per wallpaper pattern ('plain' never enters). */
  private readonly wallpaperTiles = new Map<WallpaperPattern, Texture>();
  private stain: WoodStain = 'oak';
  private pattern: WallpaperPattern = 'damask';
  private loadDpr = 1;

  /* ------------------------------ theming -------------------------------- */
  /** The room currently baked in (null until the first setTheme). */
  private themeReq: ThemeRequest | null = null;
  private themeKey = '';
  /** Bumped on every setTheme so stale bakes drop on arrival. */
  private themeGen = 0;
  /** Resolves when every part of the current room has landed. */
  private themeSettled: Promise<void> = Promise.resolve();

  /** The theme the case is currently wearing (defaults to the athenaeum). */
  get theme(): LibraryTheme {
    return getTheme(this.themeReq?.themeId);
  }

  /** True once at least one themed part has been delivered. */
  get themed(): boolean {
    return this.themeKey !== '';
  }

  /**
   * World-px size the floor plate sprite should be drawn at. Themed rooms use
   * their own PlateSpec box (a paper tag is wider and taller than a brass
   * plate), so the engraved label keeps its designed size instead of being
   * squeezed into the legacy 132x22 plaque box.
   */
  get plateSize(): { w: number; h: number } {
    if (!this.themed) return { w: PLAQUE_W, h: PLAQUE_H };
    const { w, h } = this.theme.plate;
    // Keep the theme's own ASPECT (a paper tag is not a brass rectangle) but
    // never exceed the case's plaque footprint: the plate sits on a 40px
    // plank between the books, and a plate that outgrows that box starts
    // competing with the spines instead of labelling the floor.
    const k = Math.min(PLAQUE_W / w, PLAQUE_H / h, 1);
    return { w: Math.round(w * k), h: Math.round(h * k) };
  }

  /** Awaitable "the room is fully baked" (theme crossfade waits on this). */
  get themeReady(): Promise<void> {
    return this.themeSettled;
  }

  /**
   * Dress the case in a library theme: wood/joinery plank, side rail, cornice,
   * back panel and the room's wall strip, all baked through art/bake.ts's disk
   * cache (keyed by theme × wallpaper × backdrop), so the second visit to a
   * room is instant. Listeners fire per part as it lands.
   */
  setTheme(req: ThemeRequest): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    const key = themeKeyOf(req);
    if (key === this.themeKey) return this.themeSettled;
    this.themeKey = key;
    this.themeReq = req;
    const gen = ++this.themeGen;
    const dpr = this.loadDpr;
    const theme = getTheme(req.themeId);
    // Floor plates are drawn from the theme's PlateSpec — drop the cache.
    for (const tex of this.plaques.values()) tex.destroy(true);
    this.plaques.clear();
    this.shelfDetail?.destroy(true);
    this.shelfDetail = null;

    const land = (kind: EnvKind, bitmap: ImageBitmap): void => {
      if (this.destroyed || gen !== this.themeGen) return;
      const old = this[kind as 'plank' | 'back' | 'rail' | 'crown' | 'backdropStrip'];
      this.assign(kind, textureFromBitmap(bitmap, true));
      for (const cb of this.listeners) cb(kind);
      if (old !== null && old !== undefined && !old.destroyed) old.destroy(true);
    };

    const jobs: Array<Promise<unknown>> = [
      bakeThemedPlank(theme.id, SHELF_WIDTH, dpr).then((b) => land('plank', b)),
      bakeThemedRail(theme.id, FLOOR_H, dpr).then((b) => land('rail', b)),
      bakeThemedCrown(theme.id, SHELF_WIDTH + CROWN_LIP * 2, dpr).then((b) =>
        land('crown', b),
      ),
      bakeThemedBackPanel(theme.id, SHELF_WIDTH, BOOK_ZONE_H, dpr).then((b) =>
        land('back', b),
      ),
      bakeWallStrip(theme, req.backdrop, dpr, req.wallpaper).then((b) => {
        if (this.destroyed || gen !== this.themeGen) return;
        // Seamless in Y before it ever reaches a TilingSprite (see mirrorTileY).
        const old = this.backdropStrip;
        this.assign('backdrop', textureFromCanvas(mirrorTileY(b)));
        for (const cb of this.listeners) cb('backdrop');
        if (old !== null && !old.destroyed) old.destroy(true);
      }),
    ].map((p) => p.catch(() => undefined));

    this.themeSettled = Promise.all(jobs).then(() => undefined);
    return this.themeSettled;
  }

  /** Current stain (QA probes + world sync). */
  get currentStain(): WoodStain {
    return this.stain;
  }

  /** Current wallpaper pattern. */
  get currentPattern(): WallpaperPattern {
    return this.pattern;
  }

  /**
   * Kick off the async bakes. Shadow is skipped entirely in degrade mode.
   * `stain`/`pattern` (wave-2) pick the initial case theme; both can change
   * later via setStain/setWallpaper without re-running the disk bakes.
   */
  load(
    dpr: number,
    degrade: boolean,
    stain: WoodStain = 'oak',
    pattern: WallpaperPattern = 'damask',
  ): void {
    this.loadDpr = dpr;
    this.stain = stain;
    this.pattern = pattern;

    void bakeShelfPlank(SHELF_WIDTH, dpr)
      .then((bitmap) => this.deliverBitmap('plank', bitmap, true))
      .catch(() => undefined);
    if (!degrade) {
      void bakeShelfShadowStrip(dpr)
        .then((bitmap) => this.deliverBitmap('shadow', bitmap, false))
        .catch(() => undefined);
    }
    void bakePaperTile(dpr, 'aged')
      .then((bitmap) => this.deliverBitmap('paper', bitmap, true))
      .catch(() => undefined);
    void bakeBackPanel(SHELF_WIDTH, BOOK_ZONE_H, dpr)
      .then((bitmap) => this.deliverBitmap('back', bitmap, true))
      .catch(() => undefined);
    void bakeSideRail(RAIL_W, FLOOR_H, dpr)
      .then((bitmap) => this.deliverBitmap('rail', bitmap, true))
      .catch(() => undefined);
    void bakeCrown(SHELF_WIDTH + CROWN_LIP * 2, CROWN_H, dpr)
      .then((bitmap) => this.deliverBitmap('crown', bitmap, true))
      .catch(() => undefined);
    void bakeWallpaperTile(dpr)
      .then((bitmap) => this.deliverBitmap('wallpaper', bitmap, true))
      .catch(() => undefined);
  }

  /**
   * Switch the case wood stain: re-derive tinted textures from the cached
   * base bitmaps (no disk bake) and notify listeners per wood kind so live
   * sprites re-texture. Old textures are destroyed AFTER listeners ran.
   */
  setStain(stain: WoodStain): void {
    if (this.destroyed || this.themed || stain === this.stain) return;
    this.stain = stain;
    for (const kind of STAINED_KINDS) {
      const base = this.baseBitmaps.get(kind);
      if (base === undefined) continue;
      const old = this[kind as 'plank' | 'back' | 'rail' | 'crown'];
      this.assign(kind, this.stainedTexture(base, kind));
      for (const cb of this.listeners) cb(kind);
      old?.destroy(true);
    }
  }

  /**
   * Switch the wallpaper pattern. 'plain' clears the layer (wallpaper = null);
   * stars/botanical tiles are baked synchronously on first use. Listeners get
   * a 'wallpaper' notification either way.
   */
  setWallpaper(pattern: WallpaperPattern): void {
    if (this.destroyed || this.themed || pattern === this.pattern) return;
    this.pattern = pattern;
    this.wallpaper = pattern === 'plain' ? null : this.wallpaperTile(pattern);
    for (const cb of this.listeners) cb('wallpaper');
  }

  onReady(cb: (kind: EnvKind) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * The case's ambient occlusion on the wall — one blurred silhouette, cut
   * into the two pieces the world draws.
   *
   * ## The bug this replaces
   *
   * The old `getWallShade` was a 64×8 one-sided ramp: opaque at u=0, clear at
   * u=1. Every consumer placed it with its OPAQUE end flush against a sprite
   * boundary — the left strip's dark edge at `x = -CROWN_LIP`, the top strip's
   * at `y = -CROWN_H` — on the assumption that the case art would cover the
   * step. It does not: the baked cornice only fills about half of its 64px
   * box, so both steps sat exposed on the wall, and where two of them met at
   * the case's top corners they read as a pair of translucent rectangles with
   * dead-straight edges. That is exactly the reported "weird corner boxes,
   * shadowy transparent, repeating at the shelf corners". Measured on a 2×
   * capture of the top-left corner: a hard 8-level alpha step at x = -14 and
   * another at y = -64, both running the full length of their sprite.
   *
   * ## Why a blurred silhouette instead of a fixed gradient
   *
   * Because the shape of the shadow at a corner is not the product of two
   * edge gradients — it is the blur of the shape that casts it. Painting the
   * case's outline and running one Gaussian over it gets every edge, every
   * corner and the crown's overhang right *by construction*, with no
   * placement rule for a future caller to get wrong. The falloff is a true
   * convolution, so there is no step anywhere: the largest neighbouring-pixel
   * delta across the whole halo is under two alpha levels.
   *
   * ## The cut
   *
   * One bake, two frames of the same texture:
   *  - `top` — the crown's halo, ending exactly at y = 0;
   *  - `edge` — an 8-row slice taken from far below the cornice, where the
   *    profile has settled to a straight vertical edge. Floors tile it down
   *    the sides, and because it comes out of the same convolution it joins
   *    the top piece seamlessly at y = 0 rather than merely nearly.
   */
  getCaseHalo(dpr: number): CaseHalo | null {
    if (this.halo !== null) return this.halo;
    const s = HALO_SCALE * Math.max(1, Math.min(2, dpr));
    const w = SHELF_WIDTH + (CROWN_LIP + CASE_HALO_PAD) * 2;
    const h = CASE_HALO_PAD + CROWN_H + HALO_TAIL;
    const canvas = makeCanvas(Math.ceil(w * s), Math.ceil(h * s));
    const ctx = get2d(canvas);
    if (ctx === null) return null;
    ctx.scale(s, s);

    // The case's own outline, in this canvas's frame: the cornice board (which
    // overhangs by CROWN_LIP on each side) sitting on the body.
    ctx.fillStyle = `rgba(${HALO_INK}, ${HALO_ALPHA})`;
    if ('filter' in ctx) ctx.filter = `blur(${HALO_BLUR}px)`;
    const bodyX = CASE_HALO_PAD + CROWN_LIP;
    ctx.fillRect(CASE_HALO_PAD, CASE_HALO_PAD, SHELF_WIDTH + CROWN_LIP * 2, CROWN_H);
    ctx.fillRect(bodyX, CASE_HALO_PAD + CROWN_H, SHELF_WIDTH, HALO_TAIL);
    if ('filter' in ctx) ctx.filter = 'none';

    // Punch the case itself back out: the halo is what falls on the WALL, and
    // leaving the blurred silhouette under the case would double the tone
    // wherever a floor's own art is translucent.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.fillRect(CASE_HALO_PAD, CASE_HALO_PAD, SHELF_WIDTH + CROWN_LIP * 2, CROWN_H);
    ctx.fillRect(bodyX, CASE_HALO_PAD + CROWN_H, SHELF_WIDTH, HALO_TAIL);
    ctx.globalCompositeOperation = 'source-over';

    const source = new ImageSource({
      resource: (canvas as OffscreenCanvas).transferToImageBitmap(),
    });
    // Frames are in texture px; the design rects above are in world px.
    const px = (v: number): number => Math.round(v * s);
    const topH = CASE_HALO_PAD + CROWN_H;
    // Far enough below the cornice that the vertical edge has settled (the
    // blur reaches ~2 radii) and far enough above the canvas floor that the
    // bake's own bottom edge has not started to eat into it.
    const edgeY = topH + HALO_TAIL * 0.5;
    const halo: CaseHalo = {
      top: new Texture({ source, frame: new Rectangle(0, 0, px(w), px(topH)) }),
      edge: new Texture({
        source,
        frame: new Rectangle(0, px(edgeY), px(CASE_HALO_EDGE_W), px(HALO_EDGE_H)),
      }),
    };
    this.halo = halo;
    return halo;
  }

  /**
   * Empty-floor doodle texture. Three quietly charming variants, deterministic
   * per floor via doodleVariantFor:
   *   0 — a leaning penciled ghost-book with a dust curl,
   *   1 — a little potted plant,
   *   2 — a lying two-book stack with the "~ empty shelf ~" label.
   * All graphite pencil linework, drawn once per variant per session.
   */
  getEmptyDoodle(dpr: number, variant: number): Texture {
    const v = ((variant % EMPTY_DOODLE_VARIANTS) + EMPTY_DOODLE_VARIANTS) % EMPTY_DOODLE_VARIANTS;
    const cached = this.doodles.get(v);
    if (cached !== undefined) return cached;

    const w = EMPTY_DOODLE_W;
    const h = EMPTY_DOODLE_H;
    const scale = Math.max(1, dpr);
    const canvas = makeCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
    const ctx = get2d(canvas);
    if (ctx) {
      ctx.scale(scale, scale);
      ctx.strokeStyle = GRAPHITE_STROKE;
      ctx.fillStyle = GRAPHITE_SOFT;
      ctx.lineWidth = 1.3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const rnd = mulberry32((0xe321 + v * 0x9d7) >>> 0);
      const wob = { seed: (0xd00d + v) >>> 0, amplitude: 1, frequency: 0.05 };
      const strokePath = (d: string): void => {
        const [a, b] = doubleStroke(d, { ...wob, seed: (wob.seed + Math.floor(rnd() * 1e4)) >>> 0 });
        ctx.stroke(new Path2D(a));
        ctx.stroke(new Path2D(b));
      };

      if (v === 0) {
        // Ghost book: an outlined spine leaning at ~8°, baseline y = h - 4.
        const bw = 34;
        const bh = 92;
        const x0 = w * 0.42;
        const yb = h - 4;
        const leanDx = 14;
        strokePath(
          `M ${x0} ${yb} L ${x0 + bw} ${yb} L ${x0 + bw + leanDx} ${yb - bh} L ${x0 + leanDx} ${yb - bh} Z`,
        );
        // A couple of faint band rules on the ghost spine.
        strokePath(`M ${x0 + leanDx * 0.75} ${yb - bh * 0.72} L ${x0 + bw + leanDx * 0.75} ${yb - bh * 0.72}`);
        // Dust curl beside it.
        ctx.strokeStyle = GRAPHITE_SOFT;
        strokePath(
          `M ${x0 - 38} ${yb - 8} C ${x0 - 30} ${yb - 22}, ${x0 - 16} ${yb - 20}, ${x0 - 20} ${yb - 10} C ${x0 - 23} ${yb - 4}, ${x0 - 32} ${yb - 5}, ${x0 - 30} ${yb - 12}`,
        );
        // Three tiny dust flecks.
        for (let i = 0; i < 3; i++) {
          const fx = x0 + bw + 26 + rnd() * 26;
          const fy = yb - 6 - rnd() * 18;
          ctx.beginPath();
          ctx.arc(fx, fy, 0.9 + rnd() * 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (v === 1) {
        // Potted plant: trapezoid pot, rim, three leaf arcs.
        const cx = w / 2;
        const yb = h - 4;
        strokePath(`M ${cx - 20} ${yb - 30} L ${cx + 20} ${yb - 30} L ${cx + 14} ${yb} L ${cx - 14} ${yb} Z`);
        strokePath(`M ${cx - 24} ${yb - 30} L ${cx + 24} ${yb - 30}`);
        const leaves = [
          `M ${cx} ${yb - 32} C ${cx - 4} ${yb - 52}, ${cx - 22} ${yb - 58}, ${cx - 26} ${yb - 74}`,
          `M ${cx} ${yb - 32} C ${cx + 2} ${yb - 56}, ${cx + 16} ${yb - 62}, ${cx + 24} ${yb - 78}`,
          `M ${cx} ${yb - 32} C ${cx - 1} ${yb - 50}, ${cx + 3} ${yb - 62}, ${cx - 2} ${yb - 80}`,
        ];
        for (const d of leaves) strokePath(d);
        // Leaf blobs at the tips.
        for (const [lx, ly] of [
          [cx - 26, yb - 74],
          [cx + 24, yb - 78],
          [cx - 2, yb - 80],
        ]) {
          strokePath(`M ${lx} ${ly} C ${lx - 7} ${ly - 8}, ${lx + 2} ${ly - 16}, ${lx + 4} ${ly - 6} C ${lx + 5} ${ly - 1}, ${lx + 2} ${ly + 2}, ${lx} ${ly}`);
        }
      } else {
        // Two lying books + label.
        const cx = w / 2;
        const yb = h - 4;
        strokePath(`M ${cx - 46} ${yb} L ${cx + 40} ${yb} L ${cx + 40} ${yb - 13} L ${cx - 46} ${yb - 13} Z`);
        strokePath(`M ${cx - 38} ${yb - 13} L ${cx + 46} ${yb - 13} L ${cx + 46} ${yb - 26} L ${cx - 38} ${yb - 26} Z`);
        strokePath(`M ${cx + 30} ${yb - 2} L ${cx + 30} ${yb - 11}`);
        ctx.font = '21px "Architects Daughter", "Segoe Print", cursive';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#d3c6ad';
        ctx.fillText('~ empty shelf ~', cx, h * 0.28);
        ctx.strokeStyle = GRAPHITE_SOFT;
        for (const [x0, x1] of [
          [w * 0.06, w * 0.2],
          [w * 0.8, w * 0.94],
        ]) {
          strokePath(`M ${x0} ${h * 0.28} L ${x1} ${h * 0.28}`);
        }
      }
    }
    const texture = textureFromCanvas(canvas);
    this.doodles.set(v, texture);
    return texture;
  }

  /**
   * Shelf-dressing prop texture (baked once per kind per session, ImageBitmap
   * path — see the makeCanvas note). `variant` seeds the small strokes so the
   * same kind can appear twice without reading as a stamp; only a few
   * variants per kind are ever baked (kind*8 + variant%8 cache slots).
   */
  getProp(dpr: number, kind: PropKind, variant: number): Texture {
    const v = ((variant % 8) + 8) % 8;
    const key = kind * 8 + v;
    const cached = this.props.get(key);
    if (cached !== undefined) return cached;
    const scale = Math.max(1, dpr);
    const canvas = makeCanvas(Math.ceil(PROP_W * scale), Math.ceil(PROP_H * scale));
    const ctx = get2d(canvas);
    if (ctx) {
      ctx.scale(scale, scale);
      renderProp(ctx as Ctx2D, kind, (0x9a75 + kind * 131 + v * 977) >>> 0);
    }
    const texture = textureFromCanvas(canvas);
    this.props.set(key, texture);
    return texture;
  }

  /* -------------------- wave-2 shelf-life prop textures ------------------- */

  /**
   * Tiny gold star charm hung on pinned spines (favorites). ~18×18 world px,
   * warm gold fill with a graphite pencil outline and a little string loop.
   */
  getStarCharm(dpr: number): Texture {
    if (this.starCharm !== null) return this.starCharm;
    const w = 20;
    const h = 24;
    const scale = Math.max(1, dpr) * 2; // small art: bake crisp at 2×
    const canvas = makeCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
    const ctx = get2d(canvas);
    if (ctx) {
      ctx.scale(scale, scale);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // String loop from the spine top.
      ctx.strokeStyle = 'rgba(60, 48, 34, 0.75)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(w / 2, 0.8);
      ctx.quadraticCurveTo(w / 2 + 1.6, 3.2, w / 2, 6);
      ctx.stroke();
      // Five-point star.
      const cx = w / 2;
      const cy = 14.4;
      const rOut = 8.2;
      const rIn = 3.4;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? rOut : rIn;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const g = ctx.createLinearGradient(cx - rOut, cy - rOut, cx + rOut, cy + rOut);
      g.addColorStop(0, '#f4d06f');
      g.addColorStop(1, '#c9982e');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(84, 62, 26, 0.8)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // Catchlight.
      ctx.fillStyle = 'rgba(255, 246, 220, 0.85)';
      ctx.beginPath();
      ctx.arc(cx - 2.4, cy - 2.8, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    this.starCharm = textureFromCanvas(canvas);
    return this.starCharm;
  }

  /**
   * Continue-reading ribbon peeking out of the last-opened book's pages —
   * a warm terracotta strip with a notched tail and pencil edges.
   */
  getRibbon(dpr: number): Texture {
    if (this.ribbon !== null) return this.ribbon;
    const w = 12;
    const h = 34;
    const scale = Math.max(1, dpr) * 2;
    const canvas = makeCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
    const ctx = get2d(canvas);
    if (ctx) {
      ctx.scale(scale, scale);
      ctx.lineJoin = 'round';
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, '#b7563c');
      g.addColorStop(0.5, '#d17a5a');
      g.addColorStop(1, '#a34d34');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(1, 0);
      ctx.lineTo(w - 1, 0);
      ctx.lineTo(w - 1, h - 7);
      ctx.lineTo(w / 2, h - 1.5);
      ctx.lineTo(1, h - 7);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(64, 30, 20, 0.65)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Fold shadow at the top (where it leaves the pages).
      ctx.fillStyle = 'rgba(46, 20, 12, 0.28)';
      ctx.fillRect(1, 0, w - 2, 2.4);
    }
    this.ribbon = textureFromCanvas(canvas);
    return this.ribbon;
  }

  /**
   * Keyboard-selection caret (wave-2 item 8): a small penciled chevron that
   * sits on the plank beneath the selected spine. Deliberately unlike the
   * warm hover halo so a keyboard selection reads as its own thing — and,
   * being a fixed-size sprite, it never distorts across spine widths.
   */
  getSelectCaret(dpr: number): Texture {
    if (this.selectCaret !== null) return this.selectCaret;
    const w = SELECT_CARET_W;
    const h = SELECT_CARET_H;
    const scale = Math.max(1, dpr) * 2;
    const canvas = makeCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
    const ctx = get2d(canvas);
    if (ctx) {
      ctx.scale(scale, scale);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Doubled hand-drawn chevron pointing up at the book, with a pale
      // under-stroke so it reads on both light plank and dark back panel.
      const d = `M 2.5 ${h - 3} L ${w / 2} 3 L ${w - 2.5} ${h - 3}`;
      const [a, b] = doubleStroke(d, { seed: 0x5e1e, amplitude: 0.7, frequency: 0.12 });
      ctx.strokeStyle = 'rgba(255, 248, 228, 0.85)';
      ctx.lineWidth = 3.2;
      ctx.stroke(new Path2D(a));
      ctx.stroke(new Path2D(b));
      ctx.strokeStyle = 'rgba(58, 44, 28, 0.9)';
      ctx.lineWidth = 1.6;
      ctx.stroke(new Path2D(a));
      ctx.stroke(new Path2D(b));
    }
    this.selectCaret = textureFromCanvas(canvas);
    return this.selectCaret;
  }

  /**
   * Brass floor plaque with an engraved label. Cached per label text; the
   * cache is bounded (LRU-ish clear) since labels are user-editable.
   */
  getPlaque(dpr: number, label: string): Texture {
    const key = label;
    const cached = this.plaques.get(key);
    if (cached !== undefined) return cached;
    if (this.plaques.size > 48) {
      for (const tex of this.plaques.values()) tex.destroy(true);
      this.plaques.clear();
    }
    // Themed rooms draw their own plate material (brass · enamel · slate ·
    // wood-burnt · paper tag · tin) straight from the theme's PlateSpec.
    if (this.themed) {
      const theme = this.theme;
      const texture = this.renderThemedPlate(theme, dpr, label);
      this.plaques.set(key, texture);
      return texture;
    }
    const w = PLAQUE_W;
    const h = PLAQUE_H;
    const scale = Math.max(1, dpr) * 2;
    const canvas = makeCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
    const ctx = get2d(canvas);
    if (ctx) {
      ctx.scale(scale, scale);
      ctx.lineJoin = 'round';
      // Brass plate with slightly clipped corners.
      const inset = 1.5;
      const cut = 3;
      const plate = new Path2D(
        `M ${inset + cut} ${inset} L ${w - inset - cut} ${inset} L ${w - inset} ${inset + cut} ` +
          `L ${w - inset} ${h - inset - cut} L ${w - inset - cut} ${h - inset} ` +
          `L ${inset + cut} ${h - inset} L ${inset} ${h - inset - cut} L ${inset} ${inset + cut} Z`,
      );
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#e4c06a');
      g.addColorStop(0.45, '#c39a44');
      g.addColorStop(1, '#a67f30');
      ctx.fillStyle = g;
      ctx.fill(plate);
      ctx.strokeStyle = 'rgba(74, 54, 22, 0.8)';
      ctx.lineWidth = 1.2;
      ctx.stroke(plate);
      // Inner engraved rule.
      ctx.strokeStyle = 'rgba(94, 68, 26, 0.45)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(4.5, 3.5, w - 9, h - 7);
      // Screw dots.
      ctx.fillStyle = 'rgba(84, 60, 24, 0.75)';
      for (const sx of [6.5, w - 6.5]) {
        ctx.beginPath();
        ctx.arc(sx, h / 2, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      // Engraved label.
      ctx.font = '13px "Architects Daughter", "Segoe Print", cursive';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255, 240, 200, 0.55)';
      ctx.fillText(label, w / 2, h / 2 + 1.6, w - 22);
      ctx.fillStyle = 'rgba(62, 42, 14, 0.9)';
      ctx.fillText(label, w / 2, h / 2 + 0.6, w - 22);
    }
    const texture = textureFromCanvas(canvas);
    this.plaques.set(key, texture);
    return texture;
  }

  /**
   * Trash-drawer front: a wooden drawer face with a brass pull handle and a
   * small crumpled-paper doodle, drawn once. Lives under the last floor.
   */
  getTrashDrawer(dpr: number): Texture {
    if (this.trashDrawer !== null) return this.trashDrawer;
    const w = TRASH_DRAWER_W;
    const h = TRASH_DRAWER_H;
    const scale = Math.max(1, dpr);
    const canvas = makeCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
    const ctx = get2d(canvas);
    if (ctx) {
      ctx.scale(scale, scale);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      // Drawer face.
      // Drawn in a NEUTRAL near-white wood so the world can tint it to the
      // room's own timber (a multiply tint can only darken — art baked brown
      // could never become pale ash).
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#f4ece0');
      g.addColorStop(0.5, '#ddd0be');
      g.addColorStop(1, '#bdae99');
      ctx.fillStyle = g;
      ctx.fillRect(1, 1, w - 2, h - 2);
      // Doubled pencil outline + inner panel line.
      ctx.strokeStyle = 'rgba(50, 38, 26, 0.7)';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
      ctx.strokeStyle = 'rgba(40, 30, 20, 0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(7.5, 6.5, w - 15, h - 13);
      // Brass pull handle (arc) at center.
      const cx = w / 2;
      const hy = h / 2 + 3;
      ctx.strokeStyle = '#c9a23e';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, hy - 4, 11, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(74, 54, 22, 0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, hy - 4, 12.4, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      for (const bx of [cx - 10.4, cx + 10.4]) {
        ctx.fillStyle = '#b08c34';
        ctx.beginPath();
        ctx.arc(bx, hy - 3.4, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      // "waste paper" label, engraved-style, left of the handle.
      ctx.font = '12px "Architects Daughter", "Segoe Print", cursive';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(74, 56, 36, 0.78)';
      ctx.fillText('~ waste paper ~', cx, h - 11);
      // Crumpled-ball doodle right of the handle.
      ctx.strokeStyle = 'rgba(84, 64, 42, 0.55)';
      ctx.lineWidth = 1;
      const bx = w - 34;
      const by = h / 2 - 2;
      ctx.beginPath();
      ctx.arc(bx, by, 6.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx - 4, by - 2);
      ctx.lineTo(bx + 1, by + 1);
      ctx.lineTo(bx - 2, by + 3.4);
      ctx.moveTo(bx + 4, by - 3);
      ctx.lineTo(bx + 1.4, by + 0.4);
      ctx.stroke();
    }
    this.trashDrawer = textureFromCanvas(canvas);
    return this.trashDrawer;
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
    this.plank?.destroy(true);
    this.shadow?.destroy(true);
    this.paper?.destroy(true);
    this.back?.destroy(true);
    this.rail?.destroy(true);
    this.crown?.destroy(true);
    this.wallpaper?.destroy(true);
    this.backdropStrip?.destroy(true);
    this.halo?.top.destroy(true);
    this.halo?.edge.destroy(false);
    this.shelfDetail?.destroy(true);
    this.starCharm?.destroy(true);
    this.ribbon?.destroy(true);
    this.trashDrawer?.destroy(true);
    this.selectCaret?.destroy(true);
    for (const tex of this.doodles.values()) tex.destroy(true);
    this.doodles.clear();
    for (const tex of this.props.values()) tex.destroy(true);
    this.props.clear();
    for (const tex of this.plaques.values()) tex.destroy(true);
    this.plaques.clear();
    for (const [pattern, tex] of this.wallpaperTiles) {
      // The damask tile doubles as this.wallpaper (already destroyed above)
      // only when it is the active pattern; guard double-destroys.
      if (tex !== this.wallpaper && !tex.destroyed) tex.destroy(true);
      this.wallpaperTiles.delete(pattern);
    }
    this.baseBitmaps.clear();
    this.plank = null;
    this.shadow = null;
    this.paper = null;
    this.back = null;
    this.rail = null;
    this.crown = null;
    this.wallpaper = null;
    this.backdropStrip = null;
    this.halo = null;
    this.shelfDetail = null;
    this.starCharm = null;
    this.ribbon = null;
    this.trashDrawer = null;
    this.selectCaret = null;
  }

  /* ------------------------------ internals ------------------------------- */

  /** Store the base bake, derive the (possibly stained) texture, notify. */
  private deliverBitmap(kind: EnvKind, bitmap: ImageBitmap, mipmaps: boolean): void {
    if (this.destroyed) return;
    this.baseBitmaps.set(kind, bitmap);
    // A theme owns the case wood and the wall: keep the un-themed bakes as
    // fallbacks but never let a late arrival stomp the room's art.
    if (this.themed && kind !== 'paper' && kind !== 'shadow') return;
    if (kind === 'wallpaper') {
      const damask = textureFromBitmap(bitmap, mipmaps);
      this.wallpaperTiles.set('damask', damask);
      this.wallpaper =
        this.pattern === 'plain' ? null : this.wallpaperTile(this.pattern);
    } else if (STAINED_KINDS.has(kind)) {
      this.assign(kind, this.stainedTexture(bitmap, kind));
    } else {
      this.assign(kind, textureFromBitmap(bitmap, mipmaps));
    }
    for (const cb of this.listeners) cb(kind);
  }

  private assign(kind: EnvKind, texture: Texture): void {
    if (kind === 'plank') this.plank = texture;
    else if (kind === 'shadow') this.shadow = texture;
    else if (kind === 'paper') this.paper = texture;
    else if (kind === 'back') this.back = texture;
    else if (kind === 'rail') this.rail = texture;
    else if (kind === 'wallpaper') this.wallpaper = texture;
    else if (kind === 'backdrop') this.backdropStrip = texture;
    else this.crown = texture;
  }

  /**
   * The furniture hung under each shelf plank — apothecary drawers, cottage
   * bunting. Drawn at the TOP of a floor's book zone, i.e. on the underside of
   * the plank above. Returns null for rooms with a plain plank edge.
   */
  getShelfDetail(dpr: number): Texture | null {
    if (!this.themed) return null;
    const theme = this.theme;
    const kind = theme.shelfDetail ?? 'none';
    if (kind === 'none') return null;
    if (this.shelfDetail !== null) return this.shelfDetail;
    const w = SHELF_WIDTH;
    const h = SHELF_DETAIL_H;
    const scale = Math.max(1, dpr);
    const canvas = makeCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
    const ctx = get2d(canvas);
    if (ctx) {
      ctx.scale(scale, scale);
      renderShelfDetail(ctx as Ctx2D, theme, w, h, fnv1a(`${theme.id}|detail`));
    }
    this.shelfDetail = textureFromCanvas(canvas);
    return this.shelfDetail;
  }

  /**
   * The room's own floor plate, rendered synchronously into the shared
   * PLAQUE_W×PLAQUE_H design box (the sprite is sized to that box, so a
   * theme's larger paper tag simply draws smaller strokes inside it).
   */
  private renderThemedPlate(theme: LibraryTheme, dpr: number, label: string): Texture {
    const plate = theme.plate;
    const scale = Math.max(1, dpr) * 2;
    const canvas = makeCanvas(Math.ceil(plate.w * scale), Math.ceil(plate.h * scale));
    const ctx = get2d(canvas);
    if (ctx) {
      ctx.scale(scale, scale);
      renderPlate(ctx as Ctx2D, plate, label, fnv1a(`${theme.id}|plate|${label}`), theme);
    }
    return textureFromCanvas(canvas);
  }

  /** Wood texture for the current stain ('oak' = base bitmap untouched). */
  private stainedTexture(base: ImageBitmap, kind: EnvKind): Texture {
    if (this.stain === 'oak') return textureFromBitmap(base, kind !== 'shadow');
    return textureFromCanvas(applyStain(base, this.stain));
  }

  /** Pattern tile for stars/botanical/damask (damask needs its bake done). */
  private wallpaperTile(pattern: WallpaperPattern): Texture | null {
    if (pattern === 'plain') return null;
    const cached = this.wallpaperTiles.get(pattern);
    if (cached !== undefined) return cached;
    if (pattern === 'damask') return null; // bake not landed yet
    const tex = bakePatternTile(pattern, this.loadDpr);
    this.wallpaperTiles.set(pattern, tex);
    return tex;
  }
}

/* ------------------------- wallpaper pattern tiles ------------------------- */

/** Plaque design size, world px (drawn on the plank face). */
export const PLAQUE_W = 132;
export const PLAQUE_H = 22;

/** Trash-drawer front design size, world px. */
export const TRASH_DRAWER_W = 340;
export const TRASH_DRAWER_H = 56;

/** Keyboard-selection caret design size, world px. */
export const SELECT_CARET_W = 26;
export const SELECT_CARET_H = 16;

const PATTERN_INK = 'rgba(140, 110, 72, 0.16)';
const PATTERN_INK_SOFT = 'rgba(150, 122, 86, 0.10)';
const PATTERN_GOLD = 'rgba(196, 158, 82, 0.14)';

/**
 * Synchronously bake the stars/botanical wallpaper tiles — quiet penciled
 * patterns at whisper contrast matching the damask tile's tone. 256px tile,
 * seamless by construction (motifs placed on a wrap-aligned grid).
 */
function bakePatternTile(pattern: 'stars' | 'botanical', dpr: number): Texture {
  const s = 256;
  const scale = Math.max(1, dpr);
  const canvas = makeCanvas(Math.ceil(s * scale), Math.ceil(s * scale));
  const ctx = get2d(canvas);
  if (!ctx) return Texture.WHITE;
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const rnd = mulberry32(pattern === 'stars' ? 0x57a125 : 0xb07a41);

  if (pattern === 'stars') {
    // Scattered pencil stars + tiny dots on a wrap-aligned jittered grid.
    const cell = 64;
    for (let gy = 0; gy < s / cell; gy++) {
      for (let gx = 0; gx < s / cell; gx++) {
        const cx = gx * cell + cell * (0.3 + rnd() * 0.4);
        const cy = gy * cell + cell * (0.3 + rnd() * 0.4);
        const r = 5 + rnd() * 5;
        const big = rnd() < 0.4;
        ctx.strokeStyle = big ? PATTERN_INK : PATTERN_INK_SOFT;
        ctx.lineWidth = 1;
        // Four-point sparkle star.
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.quadraticCurveTo(cx + r * 0.18, cy - r * 0.18, cx + r, cy);
        ctx.quadraticCurveTo(cx + r * 0.18, cy + r * 0.18, cx, cy + r);
        ctx.quadraticCurveTo(cx - r * 0.18, cy + r * 0.18, cx - r, cy);
        ctx.quadraticCurveTo(cx - r * 0.18, cy - r * 0.18, cx, cy - r);
        ctx.closePath();
        ctx.stroke();
        if (big) {
          ctx.fillStyle = PATTERN_GOLD;
          ctx.beginPath();
          ctx.arc(cx, cy, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        // A companion dot drifting nearby.
        ctx.fillStyle = PATTERN_INK_SOFT;
        ctx.beginPath();
        ctx.arc(
          cx + (rnd() * 2 - 1) * 18,
          cy + (rnd() * 2 - 1) * 18,
          1,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  } else {
    // Botanical: gentle vine waves with leaf pairs, two columns per tile.
    ctx.strokeStyle = PATTERN_INK;
    ctx.lineWidth = 1;
    for (const colX of [s * 0.25, s * 0.75]) {
      // Vine: full-height sine wave (period = tile height → seamless wrap).
      ctx.beginPath();
      for (let y = 0; y <= s; y += 4) {
        const x = colX + Math.sin((y / s) * Math.PI * 2) * 14;
        if (y === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // Leaf pairs along the vine.
      for (let y = 16; y < s; y += 32) {
        const x = colX + Math.sin((y / s) * Math.PI * 2) * 14;
        const dir = ((y / 32) | 0) % 2 === 0 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 12 * dir, y - 8, x + 17 * dir, y - 1);
        ctx.quadraticCurveTo(x + 10 * dir, y + 5, x, y);
        ctx.stroke();
        // Gold berry at alternating nodes.
        if (((y / 32) | 0) % 3 === 0) {
          ctx.fillStyle = PATTERN_GOLD;
          ctx.beginPath();
          ctx.arc(x - 4 * dir, y + 5, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  return textureFromCanvas(canvas);
}
