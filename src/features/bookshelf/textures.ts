/**
 * features/bookshelf/textures.ts — the bookcase itself, drawn flat.
 *
 * Every part of the case (shelf board, recess, side post, cornice) is a
 * handful of flat fills and ink outlines from `art/flat.ts` via the shapes in
 * `art/flatShelf.ts`. Nothing here paints: no brush stamps, no wood grain, no
 * wallpaper, no lighting, no flora. Depth is a darker flat face beside a
 * lighter one, exactly as the app icon does it.
 *
 * ## What this replaced, and why the surface did not change
 *
 * This module used to be a thin dispatcher onto the painting stack
 * (`art/caseArt.ts`, `art/wood.ts`, `art/wallpaper.ts`, `art/props.ts`) —
 * seconds of brush work per room, disk-cached because it had to be. The public
 * shape stayed byte-for-byte identical through the restyle on purpose:
 * `world.ts` and `floorView.ts` are this class's only consumers, they are
 * large, and a renderer swap has no business rewriting them. Same fields, same
 * getters, same promises — different pixels.
 *
 * ## Parts that are now deliberately empty
 *
 * The wall is ONE flat colour, owned by `world.ts`, so `wallpaper` and
 * `backdropStrip` stay null and nothing tiles a pattern behind the case. The
 * decorative extras the painting era accumulated — shelf props, flora, star
 * charms, ribbons, empty-floor doodles, under-shelf drawers and bunting, and
 * the blurred case halo — return a 1×1 transparent texture or null. One
 * option per thing was the brief, and a flat case that is also festooned with
 * ornament is just the old mud in new colours.
 */

import { CanvasSource, ImageSource, Texture } from 'pixi.js';
import { bakeCached } from '../../art/bake';
import {
  FLAT,
  inkWidth,
  panel,
  stroke,
  wobbleRect,
  type FlatCtx,
} from '../../art/flat';
import { drawCrown, drawPlank, drawPost, drawRecess } from '../../art/flatShelf';
import { installArtRoutes } from './artRoutes';
import { libraryKey } from './libraryKey';
// Type only. `floorView.ts` still picks prop kinds from `art/props.ts`; this
// module no longer renders one, but the signature it calls must still name it.
import type { PropKind } from '../../art/props';
import {
  getTheme,
  type BackdropId,
  type LibraryTheme,
  type ThemeId,
  type WallpaperSpec,
} from '../../art/themes';
import { fnv1a } from '../../art/noise';
import {
  BOOK_ZONE_H,
  CASE_SHADE_W,
  CROWN_H,
  CROWN_LIP,
  FLOOR_H,
  PLANK_H,
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
 * Legacy wall-strip geometry, kept because the constants are exported API.
 *
 * The wall no longer has art of its own — `world.ts` fills it with one flat
 * colour — so nothing is baked at this size any more.
 */
export const BACKDROP_STRIP_W = 640;
export const BACKDROP_STRIP_FLOORS = 3;

/** World-px height of the under-plank detail strip (no longer drawn). */
export const SHELF_DETAIL_H = 34;

/* ------------------------------- case halo -------------------------------- */

/** How far the case's shadow used to reach onto the wall, world px. */
export const CASE_HALO_PAD = CASE_SHADE_W;

/** Width of the vertical edge slice the halo was cut into. */
export const CASE_HALO_EDGE_W = CASE_HALO_PAD * 2 + CROWN_LIP;

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

/*
 * `bake.ts` hands a recipe to the art worker when `artRoutes` recognises its
 * cache key. None of the flat keys below match a route — deliberately: the
 * worker's case renderers are the painting stack, and routing a flat part to
 * them would quietly resurrect the wood grain. Flat parts cost a few dozen
 * path fills, so there is nothing to offload anyway. The install stays because
 * spines still benefit from it and it is idempotent.
 */
installArtRoutes();

/** Identity of a baked room — same key ⇒ same case art. */
export function themeKeyOf(req: ThemeRequest): string {
  return libraryKey(req.themeId, req.wallpaper, req.backdrop);
}

/** Case wood stains (settings.shelfWoodStain). One flat timber now; inert. */
export type WoodStain = 'oak' | 'walnut' | 'cherry' | 'cream';

/** Wall patterns (settings.wallpaperPattern). The wall is plain now; inert. */
export type WallpaperPattern = 'damask' | 'stars' | 'botanical' | 'plain';

/**
 * Flat placeholder tints shown until a bake lands.
 *
 * These are the FLAT palette's own hexes rather than approximations of a
 * painted average, so the placeholder and the art it fades into are the same
 * colour and the crossfade is invisible.
 */
export const PLACEHOLDER_TINTS = {
  plank: 0xc08a52,
  backdrop: 0xe9e2d0,
  back: 0x7d5638,
  rail: 0xc08a52,
  crown: 0xc08a52,
} as const;

/** Number of distinct empty-floor doodle variants (none are drawn now). */
export const EMPTY_DOODLE_VARIANTS = 3;

/** World-px design size of the doodle textures. */
export const EMPTY_DOODLE_W = 200;
export const EMPTY_DOODLE_H = 130;

/** Deterministic doodle variant for a floor. */
export function doodleVariantFor(floorIndex: number): number {
  return fnv1a(`doodle|${floorIndex}`) % EMPTY_DOODLE_VARIANTS;
}

/**
 * Cache-key generation for the flat case.
 *
 * Every key below carries it. The disk cache (`art/bake.ts`) validates
 * nothing about a hit — a stale PNG from the painting era is indistinguishable
 * from a fresh one and would be served forever on any machine that has already
 * run the app. Bumping this is the escape hatch; it must move whenever the
 * flat recipes change.
 */
const FLAT_ART_VERSION = 'flat1';

function textureFromBitmap(bitmap: ImageBitmap, mipmaps: boolean): Texture {
  const source = new ImageSource({
    resource: bitmap,
    autoGenerateMipmaps: mipmaps,
  });
  return new Texture({ source });
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

/**
 * IMPORTANT: small synchronously-authored art (plaques, carets) must reach the
 * GPU as an ImageBitmap (ImageSource), NOT as a live CanvasSource. Direct
 * canvas uploads deliver wrong pixels on some renderers (headless SwiftShader
 * garbles both alpha and content — the original "invisible empty-shelf hint"
 * bug), while the ImageBitmap path — used by every baked env texture — renders
 * correctly everywhere. OffscreenCanvas.transferToImageBitmap() makes that
 * conversion synchronous.
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
    // The canvas MUST already have had a 2d context taken from it. Transfer
    // is not allowed otherwise, and the failure is a thrown InvalidStateError
    // at runtime rather than anything the type system can catch — so take one
    // here as well, which is a no-op when the caller already did.
    get2d(canvas);
    return new Texture({
      source: new ImageSource({ resource: canvas.transferToImageBitmap() }),
    });
  }
  return new Texture({
    source: new CanvasSource({ resource: canvas as HTMLCanvasElement }),
  });
}

/* ---------------------------- flat case parts ----------------------------- */

/**
 * How far a flat panel reaches OUTSIDE the rectangle it was asked for: half
 * its ink line, plus the outward bow `wobbleRect` puts in the middle of each
 * side. A part drawn flush to the canvas edge loses that much to the crop,
 * which reads as a hairline instead of the icon's confident pen — so parts
 * whose outline should be visible are inset by this and drawn that bit
 * smaller, and parts whose outline should NOT be visible are drawn oversize by
 * more than this so the line falls off the canvas entirely.
 */
function outlinePad(shortSide: number): number {
  return inkWidth(shortSide) / 2 + shortSide * 0.012 + 0.5;
}

/** Bake one flat part through the shared disk cache. */
function bakeFlatPart(
  key: string,
  w: number,
  h: number,
  dpr: number,
  draw: (ctx: FlatCtx, w: number, h: number) => void,
): Promise<ImageBitmap> {
  return bakeCached(key, dpr, async () => {
    const canvas = makeCanvas(Math.ceil(w * dpr), Math.ceil(h * dpr)) as OffscreenCanvas;
    const ctx = get2d(canvas);
    if (ctx === null) throw new Error(`textures: 2d context unavailable for ${key}`);
    ctx.scale(dpr, dpr);
    draw(ctx as FlatCtx, w, h);
    return canvas;
  });
}

/**
 * The shelf board each floor's books stand on.
 *
 * The bottom edge lands ON the canvas edge rather than inside it, so its ink
 * line is halved but the board still reaches the last row: the floor below
 * starts at exactly this texture's bottom, and an inset there opens a strip of
 * whatever happens to be behind the sprite. The underside line is worth
 * keeping — it is what the floor beneath sees of the board above it.
 */
function bakeFlatPlank(w: number, h: number, dpr: number): Promise<ImageBitmap> {
  return bakeFlatPart(`${FLAT_ART_VERSION}|plank|${w}x${h}`, w, h, dpr, (ctx) => {
    const pad = outlinePad(h);
    drawPlank(ctx, pad, pad, w - pad * 2, h - pad, 0x51a1);
  });
}

/**
 * The recess behind the books.
 *
 * Drawn oversize so its own rounded outline lands off-canvas: this is the
 * INSIDE of the case, and the posts either side, the board below and the one
 * above all draw their ink lines across its edges. Give it an outline of its
 * own and the case reads as a dark rectangle pasted onto a bookcase rather
 * than the space inside one.
 */
function bakeFlatBack(w: number, h: number, dpr: number): Promise<ImageBitmap> {
  return bakeFlatPart(`${FLAT_ART_VERSION}|recess|${w}x${h}`, w, h, dpr, (ctx) => {
    const over = Math.max(w, h) * 0.05 + 8;
    drawRecess(ctx, -over, -over, w + over * 2, h + over * 2, 0x9c31);
  });
}

/**
 * One floor's slice of a side post.
 *
 * Inset horizontally so both ink lines survive, but overdrawn vertically past
 * both ends: this texture repeats floor after floor, and rounding the post's
 * ends inside the tile would give the case a chain of pill shapes down each
 * side instead of two continuous uprights.
 */
function bakeFlatRail(w: number, h: number, dpr: number): Promise<ImageBitmap> {
  return bakeFlatPart(`${FLAT_ART_VERSION}|post|${w}x${h}`, w, h, dpr, (ctx) => {
    const pad = outlinePad(w);
    const over = w * 0.3 + inkWidth(w) + 2;
    drawPost(ctx, pad, -over, w - pad * 2, h + over * 2, 0x2f19);
  });
}

/**
 * The cornice board capping the case, gilt studs and all.
 *
 * Inset at the top and sides so the board's own outline reads against the
 * wall, but run PAST the bottom: the cornice's underside sits flush on the
 * case, and an inset there leaves a hairline of wall showing across the whole
 * top of the bookcase. (It does, visibly — that is what the first flat
 * specimen looked like.) The only outline lost is under the two 14px lips,
 * which nothing can see.
 */
function bakeFlatCrown(w: number, h: number, dpr: number): Promise<ImageBitmap> {
  return bakeFlatPart(`${FLAT_ART_VERSION}|crown|${w}x${h}`, w, h, dpr, (ctx) => {
    const pad = outlinePad(h);
    // Top edge inset by `pad`, bottom edge (and its ink line) pushed clear of
    // the canvas — hence a drawn height of h + pad rather than h - 2 * pad.
    drawCrown(ctx, pad, pad, w - pad * 2, h + pad, 0x7ab3);
  });
}

export class EnvTextures {
  plank: Texture | null = null;
  back: Texture | null = null;
  rail: Texture | null = null;
  crown: Texture | null = null;
  /**
   * Permanently null, and kept only because both consumers read them.
   *
   * `shadow` was an under-plank ambient-occlusion strip (a light model, which
   * this style does not have); `paper` had no reader even before the restyle;
   * `wallpaper` and `backdropStrip` were the wall, which is now one flat
   * colour filled by `world.ts`. Every read site already guards for null —
   * that was the degrade path — so they simply never light up.
   */
  shadow: Texture | null = null;
  paper: Texture | null = null;
  wallpaper: Texture | null = null;
  backdropStrip: Texture | null = null;

  private readonly plaques = new Map<string, Texture>();
  private trashDrawer: Texture | null = null;
  private selectCaret: Texture | null = null;
  /**
   * One shared 1×1 transparent texture, handed back by every getter whose art
   * the flat restyle retired. Its callers all set an explicit width/height, so
   * a real (non-zero) texture keeps their scale maths finite, and building it
   * ourselves rather than using `Texture.EMPTY` keeps the pixels defined on
   * every renderer — the same reason `makeCanvas` exists.
   */
  private blank: Texture | null = null;
  private readonly listeners = new Set<(kind: EnvKind) => void>();
  private destroyed = false;

  private stain: WoodStain = 'oak';
  private pattern: WallpaperPattern = 'damask';
  private loadDpr = 1;

  /* ------------------------------ theming -------------------------------- */
  /** The room currently requested (null until the first setTheme). */
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
   * World-px size the floor plate sprite should be drawn at.
   *
   * One flat plate design now, so this is simply the plaque's design box —
   * the per-theme PlateSpec (brass · enamel · slate · paper tag · tin) went
   * with the painting stack.
   */
  get plateSize(): { w: number; h: number } {
    return { w: PLAQUE_W, h: PLAQUE_H };
  }

  /** Awaitable "the room is fully baked" (theme crossfade waits on this). */
  get themeReady(): Promise<void> {
    return this.themeSettled;
  }

  /**
   * Dress the case in a library theme.
   *
   * The flat case has one palette, so every room now bakes the same four
   * parts and the cache serves the second room instantly. The method stays
   * because `world.ts` awaits it around the room crossfade, and because a
   * future themed flat palette belongs exactly here.
   */
  setTheme(req: ThemeRequest): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    const key = themeKeyOf(req);
    if (key === this.themeKey) return this.themeSettled;
    this.themeKey = key;
    this.themeReq = req;
    // Plates no longer vary by room, so the cache survives the swap — which
    // also means no live plaque sprite can be left holding a freed texture.
    this.themeSettled = this.bakeCase(++this.themeGen);
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
   * Kick off the case bakes.
   *
   * `degrade`, `stain` and `pattern` no longer change what is drawn: the flat
   * case is the same four parts at every quality level, in one timber, against
   * a plain wall. They are still accepted so the settings pipeline that feeds
   * them does not need to be unpicked.
   */
  load(
    dpr: number,
    degrade: boolean,
    stain: WoodStain = 'oak',
    pattern: WallpaperPattern = 'damask',
  ): void {
    void degrade;
    this.loadDpr = dpr;
    this.stain = stain;
    this.pattern = pattern;
    void this.bakeCase(this.themeGen);
  }

  /**
   * Switch the case wood stain. Inert: the flat palette has one timber, and
   * tinting it would break the "one outline colour, one set of fills" rule
   * that makes the case read as a single drawing.
   */
  setStain(stain: WoodStain): void {
    if (this.destroyed) return;
    this.stain = stain;
  }

  /**
   * Switch the wallpaper pattern. Inert: the wall is one flat colour, filled
   * by `world.ts`, and there is no tile layer left to swap.
   */
  setWallpaper(pattern: WallpaperPattern): void {
    if (this.destroyed) return;
    this.pattern = pattern;
  }

  onReady(cb: (kind: EnvKind) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * The case's shadow on the wall — gone.
   *
   * It was one blurred silhouette cut into a cornice frame and a tiling edge
   * slice. A Gaussian falloff is a light model, and the flat style has exactly
   * one shadow (`flat.contactShadow`, under an object that sits on a surface).
   * Both consumers already treat null as "no halo", which is the degrade path
   * they always had.
   */
  getCaseHalo(dpr: number): CaseHalo | null {
    void dpr;
    return null;
  }

  /**
   * Empty-floor doodle. Retired with the pencil vocabulary: the doodles were
   * chalk-toned strokes tuned for a dark painted back panel, and they read as
   * smudges against a flat recess.
   */
  getEmptyDoodle(dpr: number, variant: number): Texture {
    void dpr;
    void variant;
    return this.blankTexture();
  }

  /** Shelf-dressing props. Retired — the books are the subject. */
  getProp(dpr: number, kind: PropKind, variant: number): Texture {
    void dpr;
    void kind;
    void variant;
    return this.blankTexture();
  }

  /** Pinned-book star charm. Retired with the rest of the spine furniture. */
  getStarCharm(dpr: number): Texture {
    void dpr;
    return this.blankTexture();
  }

  /** Continue-reading ribbon. Retired with the rest of the spine furniture. */
  getRibbon(dpr: number): Texture {
    void dpr;
    return this.blankTexture();
  }

  /**
   * Keyboard-selection caret: a small chevron on the plank under the selected
   * spine. Two passes of `flat.stroke` — a cream one underneath so it reads on
   * the timber, the ink one over it — and nothing else. Being a fixed-size
   * sprite, it never distorts across spine widths.
   */
  getSelectCaret(dpr: number): Texture {
    if (this.selectCaret !== null) return this.selectCaret;
    const w = SELECT_CARET_W;
    const h = SELECT_CARET_H;
    const scale = Math.max(1, dpr) * 2; // small art: bake crisp at 2×
    const canvas = makeCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
    const ctx = get2d(canvas);
    if (ctx) {
      ctx.scale(scale, scale);
      const flat = ctx as FlatCtx;
      const arms: readonly (readonly [number, number, number, number])[] = [
        [2.5, h - 3, w / 2, 3],
        [w / 2, 3, w - 2.5, h - 3],
      ];
      for (const [x0, y0, x1, y1] of arms) {
        stroke(flat, x0, y0, x1, y1, FLAT.cream, 3.6, 0x5e1e);
      }
      for (const [x0, y0, x1, y1] of arms) {
        stroke(flat, x0, y0, x1, y1, FLAT.ink, 1.8, 0x5e1e);
      }
    }
    this.selectCaret = textureFromCanvas(canvas);
    return this.selectCaret;
  }

  /**
   * Floor plaque: a cream paper label with two gilt pins and a hand-written
   * line. Cached per label text; the cache is bounded (LRU-ish clear) since
   * labels are user-editable.
   */
  getPlaque(dpr: number, label: string): Texture {
    const key = label;
    const cached = this.plaques.get(key);
    if (cached !== undefined) return cached;
    if (this.plaques.size > 48) {
      for (const tex of this.plaques.values()) tex.destroy(true);
      this.plaques.clear();
    }
    const w = PLAQUE_W;
    const h = PLAQUE_H;
    const scale = Math.max(1, dpr) * 2;
    const canvas = makeCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
    const ctx = get2d(canvas);
    if (ctx) {
      ctx.scale(scale, scale);
      const flat = ctx as FlatCtx;
      const seed = fnv1a(`plate|${label}`);
      const pad = outlinePad(h);
      panel(flat, pad, pad, w - pad * 2, h - pad * 2, FLAT.cream, {
        radius: h * 0.34,
        seed,
      });
      // Two gilt pins, the one piece of ornament a label this small can carry.
      ctx.fillStyle = FLAT.gilt;
      for (const px of [7.5, w - 7.5]) {
        ctx.beginPath();
        ctx.arc(px, h / 2, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
      // 13px is the floor for a handwriting face (see CLAUDE.md); the plaque
      // is 22px tall, so the label sits at exactly that floor and no lower.
      ctx.font = '13px "Patrick Hand", "Segoe Print", cursive';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = FLAT.inkSoft;
      ctx.fillText(label, w / 2, h / 2 + 0.5, w - 24);
    }
    const texture = textureFromCanvas(canvas);
    this.plaques.set(key, texture);
    return texture;
  }

  /**
   * Trash-drawer front: a timber drawer face with an inset panel line, a gilt
   * pull and a hand-written label.
   *
   * NOTE for whoever owns `world.ts`: this used to be baked in a deliberately
   * pale neutral wood so a multiply tint could push it to the room's own
   * timber. There is one timber now, and it is baked in — a multiply tint on
   * top would only darken it. The tint should go with the theme wood it was
   * serving.
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
      const flat = ctx as FlatCtx;
      const pad = outlinePad(h);
      panel(flat, pad, pad, w - pad * 2, h - pad * 2, FLAT.timber, {
        radius: h * 0.2,
        seed: 0x7a5d,
      });
      // Inset panel line — the drawer's own frame, one ink line rather than a
      // bevel, the same trick the cornice uses for its lip.
      const inset = 8;
      wobbleRect(flat, inset, inset, w - inset * 2, h - inset * 2, h * 0.16, 0x7a61);
      ctx.strokeStyle = FLAT.inkSoft;
      ctx.lineWidth = Math.max(1, inkWidth(h) * 0.5);
      ctx.lineJoin = 'round';
      ctx.stroke();
      // Gilt pull across the upper half, label under it — a drawer front reads
      // as one because of that pairing, not because of any bevel.
      const pullW = 88;
      const pullH = 14;
      panel(flat, (w - pullW) / 2, h * 0.24, pullW, pullH, FLAT.gilt, {
        radius: pullH / 2,
        seed: 0x7a77,
        width: Math.max(1.4, inkWidth(pullH)),
      });
      ctx.font = '15px "Patrick Hand", "Segoe Print", cursive';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = FLAT.inkSoft;
      ctx.fillText('~ waste paper ~', w / 2, h * 0.72, w - 40);
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
    this.trashDrawer?.destroy(true);
    this.selectCaret?.destroy(true);
    this.blank?.destroy(true);
    for (const tex of this.plaques.values()) tex.destroy(true);
    this.plaques.clear();
    this.plank = null;
    this.shadow = null;
    this.paper = null;
    this.back = null;
    this.rail = null;
    this.crown = null;
    this.wallpaper = null;
    this.backdropStrip = null;
    this.trashDrawer = null;
    this.selectCaret = null;
    this.blank = null;
  }

  /* ------------------------------ internals ------------------------------- */

  /**
   * The furniture that used to hang under each shelf plank (apothecary
   * drawers, cottage bunting). Two of ten themes had it; none do now.
   */
  getShelfDetail(dpr: number): Texture | null {
    void dpr;
    return null;
  }

  /** Fire the four case parts; resolves when all of them have settled. */
  private bakeCase(gen: number): Promise<void> {
    const dpr = this.loadDpr;
    const jobs: Array<Promise<unknown>> = [
      bakeFlatPlank(SHELF_WIDTH, PLANK_H, dpr).then((b) => this.landPart('plank', b, gen)),
      bakeFlatBack(SHELF_WIDTH, BOOK_ZONE_H, dpr).then((b) => this.landPart('back', b, gen)),
      bakeFlatRail(RAIL_W, FLOOR_H, dpr).then((b) => this.landPart('rail', b, gen)),
      bakeFlatCrown(SHELF_WIDTH + CROWN_LIP * 2, CROWN_H, dpr).then((b) =>
        this.landPart('crown', b, gen),
      ),
    ].map((p) => p.catch(() => undefined));
    return Promise.all(jobs).then(() => undefined);
  }

  /**
   * Hand a baked part to its field and tell the world.
   *
   * The identity check is load-bearing: `load()` and `setTheme()` both request
   * the same keys now, and `bakeCached` memoizes, so both callers can be
   * handed the SAME ImageBitmap. Wrapping it in a second Texture and freeing
   * the first would tear the bitmap out from under a live sprite.
   */
  private landPart(kind: EnvKind, bitmap: ImageBitmap, gen: number): void {
    if (this.destroyed || gen !== this.themeGen) return;
    const old = this.textureFor(kind);
    if (old !== null && !old.destroyed && old.source.resource === bitmap) return;
    this.assign(kind, textureFromBitmap(bitmap, true));
    for (const cb of this.listeners) cb(kind);
    if (old !== null && !old.destroyed) old.destroy(true);
  }

  private textureFor(kind: EnvKind): Texture | null {
    if (kind === 'plank') return this.plank;
    if (kind === 'shadow') return this.shadow;
    if (kind === 'paper') return this.paper;
    if (kind === 'back') return this.back;
    if (kind === 'rail') return this.rail;
    if (kind === 'wallpaper') return this.wallpaper;
    if (kind === 'backdrop') return this.backdropStrip;
    return this.crown;
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

  /** The shared no-op texture (see the `blank` field). */
  private blankTexture(): Texture {
    if (this.blank !== null) return this.blank;
    // An untouched canvas is fully transparent, which is the whole point —
    // but it still has to be given a context before anyone can transfer an
    // ImageBitmap out of it. `OffscreenCanvas.transferToImageBitmap()` throws
    // InvalidStateError on a canvas that has never had one, which is not
    // something tsc or a unit test can see: it only shows up as four thrown
    // errors in the running app.
    const canvas = makeCanvas(1, 1);
    get2d(canvas);
    this.blank = textureFromCanvas(canvas);
    return this.blank;
  }
}

/** Plaque design size, world px (drawn on the plank face). */
export const PLAQUE_W = 132;
export const PLAQUE_H = 22;

/** Trash-drawer front design size, world px. */
export const TRASH_DRAWER_W = 340;
export const TRASH_DRAWER_H = 56;

/** Keyboard-selection caret design size, world px. */
export const SELECT_CARET_W = 26;
export const SELECT_CARET_H = 16;
