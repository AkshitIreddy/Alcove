/**
 * features/bookshelf/textures.ts — the bookcase itself, drawn flat.
 *
 * Every part of the case (shelf board, recess, side post, cornice) is a
 * handful of flat fills and ink outlines from `art/flat.ts` via the shapes in
 * `art/flatShelf.ts`. Nothing here paints: no brush stamps, no wood grain, no
 * wallpaper, no lighting, no flora. Depth is a darker flat face beside a
 * lighter one, exactly as the app icon does it.
 *
 * A library theme is a colour scheme and nothing else, so `setTheme` re-bakes
 * the same four parts under `setFlatScheme` — same shapes, same ink, the
 * room's fills.
 *
 * ## The second axis: carpentry
 *
 * Colour is not the only thing a bookcase can differ in, and for a while it
 * was the only thing this file let it differ in — every room was the same
 * plank case in new hexes. `art/shelfDesign.ts` supplies the other half: a
 * BUILD (the silhouette — arch, valance, apothecary, colonnade…) and a
 * PATTERN worked into the timber faces. It is deliberately orthogonal to the
 * scheme, so the reader can keep their carpentry across a repaint, and it is
 * carried on `ThemeRequest.design` rather than on the scheme.
 *
 * Both axes are in every bake key. The disk cache validates nothing about a
 * hit, so a gothic case stored under a colour-only key would be served to a
 * reader who had since gone back to plain planks — forever, on any machine
 * that had ever drawn it.
 *
 * ## What this replaced, and why the surface did not change
 *
 * This module used to be a thin dispatcher onto a runtime painting stack —
 * seconds of brush work per room, disk-cached because it had to be. The public
 * shape stayed byte-for-byte identical through the restyle on purpose:
 * `world.ts` and `floorView.ts` are this class's only consumers, they are
 * large, and a renderer swap has no business rewriting them. Same fields, same
 * getters, same promises — different pixels.
 *
 * ## Parts that are now deliberately empty
 *
 * The wall belongs to `world.ts`, so `wallpaper` and `backdropStrip` stay null
 * here. It is no longer a flat fill — `art/wallpaperDesign.ts` bakes a
 * seamless tile onto the backdrop sprite — but that tile is a wall, not a part
 * of the case, and it is baked where it is used. The decorative extras the
 * painting era accumulated — shelf props, flora, star
 * charms, ribbons, empty-floor doodles, under-shelf drawers and bunting, and
 * the blurred case halo — return a 1×1 transparent texture or null. One
 * option per thing was the brief, and a flat case that is also festooned with
 * ornament is just the old mud in new colours.
 *
 * The trash-drawer front went further and is gone entirely: the trash is a
 * button on the shelf's left rail now, not a piece of furniture bolted under
 * the last floor.
 */

import { CanvasSource, ImageSource, Texture } from 'pixi.js';
import { bakeCached } from '../../art/bake';
import {
  FLAT,
  flatScheme,
  inkWidth,
  panel,
  setFlatScheme,
  stroke,
  type FlatCtx,
  type FlatScheme,
} from '../../art/flat';
import { drawCrown, drawPlank, drawPost, drawRecess } from '../../art/flatShelf';
import {
  DEFAULT_SHELF_DESIGN,
  resolveShelfDesign,
  shelfDesignTag,
  type ShelfDesign,
} from '../../art/shelfDesign';
import { schemeKey, themeKeyOf, type ThemeRequest } from './libraryKey';
import { getTheme, type ColourScheme, type LibraryTheme, type ThemeId } from '../../art/themes';
import { fnv1a } from '../../art/noise';
import {
  BOOK_ZONE_H,
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

/**
 * `ThemeRequest` and `themeKeyOf` are re-exported, not defined here.
 *
 * They moved to `libraryKey.ts` so a node test can load them: this file
 * imports Pixi, and "does every axis that changes a pixel reach the cache
 * key" is the one property in the art pipeline that has to be tested rather
 * than looked at (see `tests/design-cache-keys.test.ts`).
 */
export { themeKeyOf, type ThemeRequest } from './libraryKey';

/**
 * Flat placeholder tints shown until the FIRST bake lands.
 *
 * The house palette's own hexes, so on a cold start in the default room the
 * placeholder and the art it fades into are the same colour and the crossfade
 * is invisible. A library saved in another room shows these for the handful of
 * frames before its case arrives; a room swap does not go through them at all,
 * because the sprites already hold the outgoing room's art.
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
const FLAT_ART_VERSION = 'flat3';

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

/**
 * Bake one flat part, in one room's colours, through the shared disk cache.
 *
 * The scheme is applied around the draw and put straight back. It has to be
 * this close to the `draw` call: `flatScheme()` is module state, `bakeCached`
 * is async, and anything that awaited between the set and the draw would let a
 * second room's bake repaint the first one mid-flight.
 *
 * `key` MUST carry the room (see `roomTag`) — the disk cache validates nothing
 * about a hit, so a reef plank stored under a scheme-blind key would be served
 * to every room forever, on any machine that had ever visited the reef.
 */
function bakeFlatPart(
  key: string,
  scheme: FlatScheme,
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
    const previous = flatScheme();
    setFlatScheme(scheme);
    try {
      draw(ctx as FlatCtx, w, h);
    } finally {
      setFlatScheme(previous);
    }
    return canvas;
  });
}

/**
 * Short stable tag for a scheme, for cache keys.
 *
 * The hexes, not the theme id: editing a colour in `art/themes.ts` has to
 * invalidate the PNGs on disk, and an id-only tag would not notice.
 */
function roomTag(themeId: ThemeId, scheme: ColourScheme): string {
  return fnv1a(schemeKey(themeId, scheme)).toString(36);
}

/**
 * A room reduced to what a bake needs: its colours, its carpentry, and a tag
 * for each. Two tags rather than one composite because they are two
 * independent axes and reading a key should say which of them moved.
 */
interface Room {
  scheme: FlatScheme;
  tag: string;
  design: ShelfDesign;
  designTag: string;
}

function roomOf(req: ThemeRequest): Room {
  const design = resolveShelfDesign(req.design);
  return {
    scheme: req.scheme,
    tag: roomTag(req.themeId, req.scheme),
    design,
    designTag: shelfDesignTag(design),
  };
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
function bakeFlatPlank(room: Room, w: number, h: number, dpr: number): Promise<ImageBitmap> {
  const key = `${FLAT_ART_VERSION}|${room.tag}|${room.designTag}|plank|${w}x${h}`;
  return bakeFlatPart(key, room.scheme, w, h, dpr, (ctx) => {
    const pad = outlinePad(h);
    // No `frame` — the pad is ~2px, so the drawn rect and the true part
    // rectangle are the same thing to within less than a pattern cell.
    drawPlank(ctx, pad, pad, w - pad * 2, h - pad, 0x51a1, room.design);
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
function bakeFlatBack(room: Room, w: number, h: number, dpr: number): Promise<ImageBitmap> {
  const key = `${FLAT_ART_VERSION}|${room.tag}|${room.designTag}|recess|${w}x${h}`;
  return bakeFlatPart(key, room.scheme, w, h, dpr, (ctx) => {
    const over = Math.max(w, h) * 0.05 + 8;
    // `frame` is the VISIBLE opening, between the two uprights — arcades,
    // valances and compartment runs spring from it. Hand it the oversize rect
    // instead and the arches spring from 68px outside the bookcase.
    drawRecess(ctx, -over, -over, w + over * 2, h + over * 2, 0x9c31, room.design, {
      x: RAIL_W,
      y: 0,
      w: w - RAIL_W * 2,
      h,
    });
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
function bakeFlatRail(room: Room, w: number, h: number, dpr: number): Promise<ImageBitmap> {
  const key = `${FLAT_ART_VERSION}|${room.tag}|${room.designTag}|post|${w}x${h}`;
  return bakeFlatPart(key, room.scheme, w, h, dpr, (ctx) => {
    const pad = outlinePad(w);
    const over = w * 0.3 + inkWidth(w) + 2;
    // `frame` is the repeating TILE (one floor), NOT the overdrawn rectangle.
    // It is what phase-locks the pattern: omit it and the pattern is measured
    // from `-over`, which puts a visible stutter at every floor seam and lands
    // capitals and rungs ~14px high on every floor.
    drawPost(ctx, pad, -over, w - pad * 2, h + over * 2, 0x2f19, room.design, {
      x: 0,
      y: 0,
      w,
      h,
    });
  });
}

/**
 * The cornice board capping the case, gilt studs and all.
 *
 * Inset at the top and sides so the board's own outline reads against the
 * wall, but run PAST the bottom: the cornice's underside sits flush on the
 * case, and an inset there leaves a hairline of wall showing across the whole
 * top of the bookcase. (It does, visibly — that is what the first flat
 * specimen looked like.)
 *
 * The canvas stays exactly `h` tall, which crops that overrun away.
 *
 * What the box's BOTTOM edge means therefore matters: `drawCrown` draws the
 * underside's ink line on it, and that line is what closes the case's four
 * corners where the `CROWN_LIP` overhangs have wall behind them rather than
 * case. So the box ends exactly at the canvas — `h - pad`, with the join's own
 * bleed carrying the fill past it — and NOT at `h + pad`, which is where this
 * used to put it and which parked the line four pixels below the bitmap. That
 * is the whole of the "un-inked corner against the wall" defect.
 */
function bakeFlatCrown(room: Room, w: number, h: number, dpr: number): Promise<ImageBitmap> {
  const key = `${FLAT_ART_VERSION}|${room.tag}|${room.designTag}|crown|${w}x${h}`;
  return bakeFlatPart(key, room.scheme, w, h, dpr, (ctx) => {
    const pad = outlinePad(h);
    // Top and sides inset by `pad` so their outlines land on the bitmap; the
    // bottom edge IS the bitmap's, because that is the cornice's real
    // underside. This is the only part with transparency above it, so it is
    // the only one whose outline a build can really cut (battlements,
    // cresting, a pediment).
    drawCrown(ctx, pad, pad, w - pad * 2, h - pad, 0x7ab3, room.design);
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
   * `wallpaper` and `backdropStrip` were this class's attempt at the wall,
   * which `world.ts` now bakes for itself from the room's `WallpaperSpec`.
   * Every read site already guards for null — that was the degrade path — so
   * they simply never light up.
   */
  shadow: Texture | null = null;
  paper: Texture | null = null;
  wallpaper: Texture | null = null;
  backdropStrip: Texture | null = null;

  private readonly plaques = new Map<string, Texture>();
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

  private loadDpr = 1;

  /* ------------------------------ theming -------------------------------- */
  /** The room currently requested (null until the first setTheme). */
  private themeReq: ThemeRequest | null = null;
  private themeKey = '';
  /** Bumped on every setTheme so stale bakes drop on arrival. */
  private themeGen = 0;
  /** Resolves when every part of the current room has landed. */
  private themeSettled: Promise<void> = Promise.resolve();

  /** The preset the case is currently wearing (defaults to the athenaeum). */
  get theme(): LibraryTheme {
    return getTheme(this.themeReq?.themeId);
  }

  /**
   * The colours the case is currently DRAWN in, which is not the same thing —
   * a reader can borrow the shelf from one room and the books from another, so
   * this is the composed scheme rather than `theme.scheme`.
   */
  get scheme(): ColourScheme {
    return this.themeReq?.scheme ?? getTheme(null).scheme;
  }

  /** The carpentry the case is currently built in (QA probes + world sync). */
  get design(): ShelfDesign {
    return resolveShelfDesign(this.themeReq?.design);
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
   * A room is a colour scheme, so the four parts really are re-baked in its
   * hexes — same shapes, same ink, different fills. Revisiting a room is still
   * instant: the bake keys carry the scheme (see `roomTag`), so the disk cache
   * hits and the crossfade is over in a frame.
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

  /**
   * Kick off the case bakes.
   *
   * `degrade` no longer changes what is drawn — the flat case is the same four
   * parts at every quality level — but it is still accepted rather than
   * removed, because the caller computes it for the spine factory anyway.
   *
   * A `stain` and a `pattern` used to arrive here from `settings`, and both
   * had been inert since the flat restyle: one timber, and a wall owned by
   * `world.ts`. They are gone rather than still ignored — the reader now
   * changes the timber PATTERN and the wallpaper for real, per bookcase, in
   * the studio (`art/shelfDesign.ts`, `art/wallpaperDesign.ts`), and leaving
   * two dead knobs pointing at the same nouns is how the settings panel came
   * to offer choices the app could not honour.
   */
  load(dpr: number, degrade: boolean): void {
    void degrade;
    this.loadDpr = dpr;
    void this.bakeCase(this.themeGen);
  }

  onReady(cb: (kind: EnvKind) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
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

  /** Fire the four case parts, in the current room's colours. */
  private bakeCase(gen: number): Promise<void> {
    const dpr = this.loadDpr;
    // Snapshot the room here, not inside each bake: `setTheme` may land another
    // one while these are in flight, and a plank baked in the old scheme next
    // to a post baked in the new one is a two-tone bookcase.
    const room = roomOf(
      this.themeReq ?? {
        themeId: this.theme.id,
        scheme: this.scheme,
        design: DEFAULT_SHELF_DESIGN,
      },
    );
    const jobs: Array<Promise<unknown>> = [
      bakeFlatPlank(room, SHELF_WIDTH, PLANK_H, dpr).then((b) => this.landPart('plank', b, gen)),
      bakeFlatBack(room, SHELF_WIDTH, BOOK_ZONE_H, dpr).then((b) => this.landPart('back', b, gen)),
      bakeFlatRail(room, RAIL_W, FLOOR_H, dpr).then((b) => this.landPart('rail', b, gen)),
      bakeFlatCrown(room, SHELF_WIDTH + CROWN_LIP * 2, CROWN_H, dpr).then((b) =>
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

/** Keyboard-selection caret design size, world px. */
export const SELECT_CARET_W = 26;
export const SELECT_CARET_H = 16;
