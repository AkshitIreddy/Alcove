/**
 * features/bookshelf/floorView.ts — one pooled Pixi container per floor.
 *
 * root (positioned at y = i*FLOOR_H) → content (floor-local), bottom → top:
 *   wall shade strips (AO cast on the paper wall beside the case)
 *   → back panel (flat tint placeholder, baked board wall crossfades in)
 *   → under-plank shadow (cast by the plank/crown ABOVE, at the zone top)
 *   → plank (flat tint placeholder, wood bitmap crossfades in)
 *   → empty-floor doodle → hover glow layer → book sprites
 *   → side rails (the case frame, in front so shelves read as slotted in).
 * Because the whole case lives in `content`, LOD2 stamps inherit it and the
 * far-zoom tower still reads as a bookcase.
 * At LOD2 `content` hides and a single stamp sprite (floor render texture)
 * shows instead, crossfaded over 120ms.
 *
 * Spines bake upright; layout position, lean (seeded cluster layout in
 * layout.ts + params.lean) and height jitter are applied here at composition
 * time (per art/spines.ts contract).
 */

import gsap from 'gsap';
import { Container, Rectangle, Sprite, Texture, type RenderTexture } from 'pixi.js';
import { SHADOW_STRIP } from '../../art/wood';
import { SPINE_THICKNESS_RANGE, type SpineParams } from '../../art/spines';
import { readShelfMeta } from '../../data/books';
import type { Book } from '../../data/types';
import {
  BOOK_BASELINE,
  BOOK_ZONE_H,
  CASE_SHADE_W,
  FLOOR_H,
  PLANK_H,
  RAIL_W,
  SHELF_WIDTH,
  TOP_SHADOW_H,
  underPlankShadowSlices,
} from './constants';
import { layoutFloor, LAYOUT_MARGIN_X } from './layout';
import { PROP_H, PROP_KINDS, PROP_W, type PropKind } from '../../art/props';
import type { LodTier } from './lod';
import { LOD_CROSSFADE_MS } from './lod';
import {
  doodleVariantFor,
  PLACEHOLDER_TINTS,
  SELECT_CARET_H,
  SELECT_CARET_W,
  SHELF_DETAIL_H,
  type EnvTextures,
} from './textures';
import { placeholderTint, spineArtHeight, type SpineFactory } from './spineFactory';
import { fnv1a, mulberry32 } from '../../art/noise';

const DEG_TO_RAD = Math.PI / 180;

/** Hover lift per the doc: y -6 world px, rotation -0.015 rad, 0.18s. */
export const HOVER_LIFT = 6;
export const HOVER_TILT = -0.015;
export const HOVER_SECONDS = 0.18;

/** Warm halo behind the hovered book (add-blended glow sprite). */
export const HOVER_GLOW_ALPHA = 0.34;
export const HOVER_GLOW_TINT = 0xffd98f;

/**
 * Keyboard-selection halo (wave-2 item 8) — a cooler, tighter glow plus a
 * penciled caret on the plank, so it never reads as a mouse hover and the
 * two can coexist (mouse moving does not steal the keyboard selection).
 */
export const SELECT_GLOW_ALPHA = 0.42;
export const SELECT_GLOW_TINT = 0xbcd9f2;

/**
 * World-px width of the darker pool baked into each END of the under-plank
 * shadow strip (art/wood.ts paints a radial at cx = 0 and cx = w with radius
 * `inset * 1.6`, in world units, so this is DPR-independent). +2 covers the
 * radial's antialiased tail.
 *
 * WHY THIS EXISTS — the "corner boxes" bug: the strip used to be drawn with a
 * NineSliceSprite whose left/right inset was SHADOW_STRIP.inset (16). Two
 * things went wrong at once.
 *   1. Nine-slice insets are TEXTURE pixels, but the strip is baked at
 *      `dpr` scale, so 16 meant 16 world px at DPR 1 and only 8 at DPR 2 —
 *      the slice geometry silently changed with the display.
 *   2. Either way the inset was narrower than the 25.6 px pool, so most of
 *      each pool sat inside the CENTRE slice, which is then stretched from
 *      ~72 texels to ~1148 world px (≈12x). The pool smeared into a soft
 *      ~140 px translucent rectangle at both ends of every floor — the
 *      "weird shadowy corner boxes, repeating at shelf corners".
 * Measured before the fix (alpha under the plank edge, DPR 1): 126 at x=0
 * decaying to the flat 96 only by x≈140. After: flat 96 by x≈28, matching
 * the bake.
 */
export const SHADOW_CAP_W = Math.ceil(SHADOW_STRIP.inset * 1.6) + 2;

export interface WorldHooks {
  markDirty(): void;
  /** Motion scale: 1 normally, 0 under prefers-reduced-motion. */
  motion(): number;
  /** Register a tween for kill-on-destroy; returns it for chaining. */
  track<T extends gsap.core.Animation>(anim: T): T;
  /** Shared soft radial glow texture (motes/pull-out shadow/hover halo). */
  glow(): Texture;
}

export interface BookVisual {
  book: Book;
  params: SpineParams;
  sprite: Sprite;
  /** Floor-local resting position/rotation (hover returns here). */
  baseY: number;
  baseRotation: number;
  /** World-px center x within the floor (seeded cluster layout). */
  centerX: number;
  /** World-px composed height (base + jitter). */
  height: number;
  /**
   * World-px effective spine width: params.w × auto-thickness from the
   * cached page count (wave-2 item 5). Layout/hit-testing/ghosts use this;
   * the bake stays at params.w and stretches slightly (invisible for wood
   * grain-free procedural spines).
   */
  w: number;
  /** Pin star charm child sprite, present while the book is pinned. */
  charm: Sprite | null;
  /** Continue-reading ribbon child sprite (last-opened book only). */
  ribbon: Sprite | null;
}

/** Plaque geometry on the plank (floor-local, world px). */
export const PLAQUE_CENTER_X = SHELF_WIDTH / 2;
export const PLAQUE_CENTER_Y = BOOK_ZONE_H + PLANK_H / 2 + 1;

export class FloorView {
  readonly root = new Container();
  readonly content = new Container();

  index = -1;
  /** Floor data state: undefined = still loading, [] = known empty. */
  loaded = false;
  visuals: BookVisual[] = [];

  private readonly backBase: Sprite;
  private backWood: Sprite | null = null;
  private readonly plankBase: Sprite;
  private plankWood: Sprite | null = null;
  /**
   * Under-plank shadow rig — three sprites, never a nine-slice (see
   * SHADOW_CAP_W). `shadow` is the pool-free middle: horizontally uniform, so
   * stretching it across the shelf is exact. `shadowCapL`/`shadowCapR` carry
   * the baked corner pools at their true world width, so they cannot smear.
   */
  private shadow: Sprite | null = null;
  private shadowCapL: Sprite | null = null;
  private shadowCapR: Sprite | null = null;
  /** Source the three shadow frames were cut from (re-cut when it changes). */
  private shadowSource: Texture | null = null;
  private shadeL: Sprite | null = null;
  private shadeR: Sprite | null = null;
  private railL: Sprite;
  private railR: Sprite;
  private railsWood = false;
  private plaque: Sprite | null = null;
  private shelfDetail: Sprite | null = null;
  /** DPR the world mounted this floor with (applyEnv needs it for detail). */
  private dprHint = 1;
  private hint: Sprite | null = null;
  private hoverGlow: Sprite | null = null;
  private hoverShadow: Sprite | null = null;
  private selectGlow: Sprite | null = null;
  private selectCaret: Sprite | null = null;
  private readonly hoverLayer = new Container();
  private readonly propsLayer = new Container();
  private readonly booksLayer = new Container();
  /** Flora growing inside the book zone — behind the spines (§3). */
  private readonly floraBack = new Container();
  /** Flora on the case furniture — over the rails, never over a book. */
  private readonly floraRail = new Container();
  private floraBackSprite: Sprite | null = null;
  private floraRailSprite: Sprite | null = null;
  private stampSprite: Sprite | null = null;
  private tier: LodTier = 0;

  constructor(private readonly hooks: WorldHooks) {
    this.root.addChild(this.content);

    this.backBase = new Sprite(Texture.WHITE);
    this.backBase.tint = PLACEHOLDER_TINTS.back;
    this.backBase.position.set(0, 0);
    this.backBase.width = SHELF_WIDTH;
    this.backBase.height = BOOK_ZONE_H;

    this.plankBase = new Sprite(Texture.WHITE);
    this.plankBase.tint = PLACEHOLDER_TINTS.plank;
    this.plankBase.position.set(0, BOOK_ZONE_H);
    this.plankBase.width = SHELF_WIDTH;
    this.plankBase.height = PLANK_H;

    this.railL = new Sprite(Texture.WHITE);
    this.railL.tint = PLACEHOLDER_TINTS.rail;
    this.railL.position.set(0, 0);
    this.railL.width = RAIL_W;
    this.railL.height = FLOOR_H;

    this.railR = new Sprite(Texture.WHITE);
    this.railR.tint = PLACEHOLDER_TINTS.rail;
    this.railR.position.set(SHELF_WIDTH - RAIL_W, 0);
    this.railR.width = RAIL_W;
    this.railR.height = FLOOR_H;

    this.content.addChild(
      this.backBase,
      this.plankBase,
      this.hoverLayer,
      this.propsLayer,
      this.floraBack,
      this.booksLayer,
      this.railL,
      this.railR,
      this.floraRail,
    );
    this.floraBack.eventMode = 'none';
    this.floraRail.eventMode = 'none';
    this.root.eventMode = 'none';
  }

  /* ------------------------------ lifecycle ------------------------------ */

  populate(
    index: number,
    books: readonly Book[] | undefined,
    env: EnvTextures,
    factory: SpineFactory,
    tier: LodTier,
    dpr: number,
    degrade: boolean,
    recentBookId: string | null = null,
  ): void {
    this.index = index;
    this.root.position.set(0, index * FLOOR_H);
    this.root.visible = true;
    this.tier = tier;
    this.dprHint = dpr;
    this.floraBack.visible = tier === 0;
    this.floraRail.visible = tier === 0;
    this.applyEnv(env, degrade, false);
    this.setBooks(books, factory, dpr, env, recentBookId);
    // Representation matches the tier immediately on (re)mount — no fade.
    this.content.visible = tier !== 2;
    this.content.alpha = 1;
    if (this.stampSprite !== null) this.stampSprite.visible = false;
  }

  /**
   * Update book data (store page landed) without changing tier state.
   * `recentBookId` marks the continue-reading book (page ribbon).
   */
  setBooks(
    books: readonly Book[] | undefined,
    factory: SpineFactory,
    dpr: number,
    env: EnvTextures,
    recentBookId: string | null = null,
  ): void {
    this.loaded = books !== undefined;
    this.clearHoverFx();
    for (const v of this.visuals) {
      gsap.killTweensOf(v.sprite);
      v.sprite.destroy({ children: true });
    }
    this.visuals = [];
    this.booksLayer.removeChildren();

    if (books !== undefined && books.length > 0) {
      const paramsList = books.map((book) => factory.getParams(book));
      // Thickness comes from resolveBookStyle (seeded class ↔ page count blend
      // + any studio override); the factory has already folded it into
      // params.w. Clamp only to the legal spine range — the old [22, 64] band
      // here is exactly what flattened every row into a picket fence.
      const widths = paramsList.map((params) =>
        Math.min(
          SPINE_THICKNESS_RANGE.max,
          Math.max(SPINE_THICKNESS_RANGE.min, Math.round((params as SpineParams).w)),
        ),
      );
      const placed = layoutFloor(
        widths.map((w, i) => ({ slot: (books[i] as Book).slot, w })),
        this.index,
      );
      for (let i = 0; i < books.length; i++) {
        const book = books[i] as Book;
        const params = paramsList[i] as SpineParams;
        const w = widths[i] as number;
        const place = placed[i];
        const sprite = new Sprite(Texture.WHITE);
        sprite.anchor.set(0.5, 1);
        const centerX = place !== undefined ? place.centerX : SHELF_WIDTH / 2;
        const leanDeg = params.lean + (place !== undefined ? place.leanDeg : 0);
        const height = spineArtHeight(params);
        // Rotation is around the bottom-center anchor, which lifts one bottom
        // corner off the plank by (w/2)·sin θ — sink the book by that much so
        // leaners stay grounded (the other corner tucks into the plank).
        const sink = (w / 2) * Math.abs(Math.sin(leanDeg * DEG_TO_RAD));
        const visual: BookVisual = {
          book,
          params,
          sprite,
          baseY: BOOK_BASELINE + sink,
          baseRotation: leanDeg * DEG_TO_RAD,
          centerX,
          height,
          w,
          charm: null,
          ribbon: null,
        };
        sprite.position.set(centerX, visual.baseY);
        sprite.rotation = visual.baseRotation;
        // Wave-2 decorations, parented to the spine so hover lifts/leans
        // carry them along. Local transforms are set in applyTexture.
        if (readShelfMeta(book)?.pinned === true) {
          const charm = new Sprite(env.getStarCharm(dpr));
          charm.anchor.set(0.5, 0);
          sprite.addChild(charm);
          visual.charm = charm;
        }
        if (recentBookId !== null && book.id === recentBookId) {
          const ribbon = new Sprite(env.getRibbon(dpr));
          ribbon.anchor.set(0.5, 0);
          sprite.addChild(ribbon);
          visual.ribbon = ribbon;
        }
        this.applyTexture(visual, factory);
        this.booksLayer.addChild(sprite);
        this.visuals.push(visual);
      }
    }
    this.placeProps(env, dpr);
    this.updateHint(env, dpr);
  }

  /**
   * Deterministic shelf dressing: 0–2 small props (plant/hourglass/candle/
   * globe/book stack) in the wide gaps between book clusters on some floors.
   * Baked sprites only; part of `content`, so LOD2 stamps inherit them.
   */
  private placeProps(env: EnvTextures, dpr: number): void {
    for (const child of this.propsLayer.removeChildren()) child.destroy();
    if (this.visuals.length === 0) return;
    const rnd = mulberry32(fnv1a(`props|${this.index}`));

    // Candidate spans: rail→first, wide inter-book gaps, last→rail.
    const MIN_GAP = 68;
    interface Span {
      x0: number;
      x1: number;
    }
    const spans: Span[] = [];
    const first = this.visuals[0] as BookVisual;
    const last = this.visuals[this.visuals.length - 1] as BookVisual;
    if (first.centerX - first.w / 2 - LAYOUT_MARGIN_X >= MIN_GAP) {
      spans.push({ x0: LAYOUT_MARGIN_X, x1: first.centerX - first.w / 2 });
    }
    for (let i = 1; i < this.visuals.length; i++) {
      const a = this.visuals[i - 1] as BookVisual;
      const b = this.visuals[i] as BookVisual;
      const x0 = a.centerX + a.w / 2;
      const x1 = b.centerX - b.w / 2;
      if (x1 - x0 >= MIN_GAP) spans.push({ x0, x1 });
    }
    if (SHELF_WIDTH - LAYOUT_MARGIN_X - (last.centerX + last.w / 2) >= MIN_GAP) {
      spans.push({ x0: last.centerX + last.w / 2, x1: SHELF_WIDTH - LAYOUT_MARGIN_X });
    }

    let placed = 0;
    for (const span of spans) {
      if (placed >= 2) break;
      // Not every gap gets a prop — some floors stay plain.
      if (rnd() >= 0.5) {
        rnd(); // keep the stream length stable whether or not we place
        rnd();
        rnd();
        continue;
      }
      const kind = Math.floor(rnd() * PROP_KINDS) as PropKind;
      const variant = Math.floor(rnd() * 8);
      const scale = 0.8 + rnd() * 0.25;
      const sprite = new Sprite(env.getProp(dpr, kind, variant));
      sprite.anchor.set(0.5, 1);
      sprite.width = PROP_W * scale;
      sprite.height = PROP_H * scale;
      const mid = (span.x0 + span.x1) / 2;
      const halfW = (PROP_W * scale) / 2;
      const x = Math.min(Math.max(mid, span.x0 + halfW), span.x1 - halfW);
      sprite.position.set(x, BOOK_BASELINE + 1);
      this.propsLayer.addChild(sprite);
      placed++;
    }
    this.hooks.markDirty();
  }

  /** Pull env art in (called on populate and again when bakes land). */
  applyEnv(env: EnvTextures, degrade: boolean, animate: boolean): void {
    const m = this.hooks.motion();
    const fadeIn = (sprite: Sprite): void => {
      if (animate && m > 0) {
        sprite.alpha = 0;
        this.hooks.track(
          gsap.to(sprite, {
            alpha: 1,
            duration: 0.4 * m,
            onUpdate: () => this.hooks.markDirty(),
          }),
        );
      }
    };

    // Wall AO strips flanking the case (synchronous translucent gradient,
    // normal blending per the getWallShade contract).
    if (this.shadeL === null) {
      const tex = env.getWallShade();
      this.shadeR = new Sprite(tex);
      this.shadeR.position.set(SHELF_WIDTH, 0);
      this.shadeR.width = CASE_SHADE_W;
      this.shadeR.height = FLOOR_H;
      this.shadeL = new Sprite(tex);
      // Mirrored: dark edge hugs the case's left side.
      this.shadeL.width = CASE_SHADE_W;
      this.shadeL.height = FLOOR_H;
      this.shadeL.scale.x = -this.shadeL.scale.x;
      this.shadeL.position.set(0, 0);
      this.content.addChildAt(this.shadeL, 0);
      this.content.addChildAt(this.shadeR, 0);
    }

    if (env.back !== null && this.backWood === null) {
      this.backWood = new Sprite(env.back);
      this.backWood.position.set(0, 0);
      this.backWood.width = SHELF_WIDTH;
      this.backWood.height = BOOK_ZONE_H;
      this.content.addChildAt(this.backWood, this.content.getChildIndex(this.backBase) + 1);
      fadeIn(this.backWood);
    }

    // Under-plank shadow: cast by the shelf above onto this floor's zone top.
    if (!degrade) this.syncUnderPlankShadow(env, fadeIn);

    if (env.plank !== null && this.plankWood === null) {
      this.plankWood = new Sprite(env.plank);
      this.plankWood.position.set(0, BOOK_ZONE_H);
      this.plankWood.width = SHELF_WIDTH;
      this.plankWood.height = PLANK_H;
      this.content.addChildAt(this.plankWood, this.content.getChildIndex(this.plankBase) + 1);
      fadeIn(this.plankWood);
    }

    // Under-plank furniture from the theme (apothecary drawers, cottage
    // bunting) — drawn on the underside of the plank ABOVE this floor.
    const detail = env.getShelfDetail(this.dprHint);
    if (detail !== null && this.shelfDetail === null) {
      this.shelfDetail = new Sprite(detail);
      this.shelfDetail.position.set(0, 0);
      this.shelfDetail.width = SHELF_WIDTH;
      this.shelfDetail.height = SHELF_DETAIL_H;
      this.shelfDetail.eventMode = 'none';
      this.content.addChildAt(this.shelfDetail, this.content.getChildIndex(this.hoverLayer));
      fadeIn(this.shelfDetail);
    } else if (this.shelfDetail !== null) {
      if (detail === null) {
        this.shelfDetail.destroy();
        this.shelfDetail = null;
      } else if (this.shelfDetail.texture !== detail) {
        this.shelfDetail.texture = detail;
      }
    }

    if (env.rail !== null && !this.railsWood) {
      this.railsWood = true;
      this.railL.texture = env.rail;
      this.railL.tint = 0xffffff;
      this.railL.width = RAIL_W;
      this.railL.height = FLOOR_H;
      // Right rail mirrors the grain/shading toward the case center.
      this.railR.texture = env.rail;
      this.railR.tint = 0xffffff;
      this.railR.width = RAIL_W;
      this.railR.height = FLOOR_H;
      this.railR.scale.x = -Math.abs(this.railR.scale.x);
      this.railR.position.set(SHELF_WIDTH, 0);
      fadeIn(this.railL);
      fadeIn(this.railR);
    }
  }

  /**
   * Build (or re-cut) the three-piece under-plank shadow.
   *
   * The baked strip is `SHADOW_STRIP.w × SHADOW_STRIP.h` world px rasterised
   * at some DPR, with a darker radial pool SHADOW_CAP_W wide at each end. We
   * cut it into three frames and place them at their true world widths:
   *
   *   ├── cap L ──┼──────────── middle (stretched) ────────────┼── cap R ──┤
   *   0        CAP_W                                  W-CAP_W           W
   *
   * The middle frame is horizontally uniform by construction, so stretching
   * it ~1148 px wide is exact — no smear, no seam, no DPR dependence. The
   * caps are drawn 1:1 in world px and so keep the pool the size the bake
   * intended. Vertically every piece maps its full 26-px height onto
   * TOP_SHADOW_H, which the old nine-slice did NOT (its 10/8 row insets were
   * texture px, so the falloff curve changed shape with the display DPR).
   *
   * Idempotent: re-cuts only when `env.shadow` is a different Texture (theme
   * or stain swap destroys the old one).
   */
  private syncUnderPlankShadow(env: EnvTextures, fadeIn: (s: Sprite) => void): void {
    const src = env.shadow;
    if (src === null || src === this.shadowSource) return;

    // `source.width` is in logical units (pixelWidth / resolution), which is
    // what Texture frames are measured in.
    const srcH = src.source.height;
    const [mid, capL, capR] = underPlankShadowSlices(
      src.source.width,
      SHADOW_STRIP.w,
      SHADOW_CAP_W,
    );
    const cut = (s: { x: number; w: number }): Texture =>
      new Texture({ source: src.source, frame: new Rectangle(s.x, 0, s.w, srcH) });

    const place = (existing: Sprite | null, texture: Texture, x: number, w: number): Sprite => {
      if (existing !== null) {
        const old = existing.texture;
        existing.texture = texture;
        // Only the derived frame is ours to free; the shared source is not.
        if (old !== texture) old.destroy(false);
        return existing;
      }
      const sprite = new Sprite(texture);
      sprite.eventMode = 'none';
      sprite.position.set(x, 0);
      sprite.width = w;
      sprite.height = TOP_SHADOW_H;
      this.content.addChildAt(sprite, this.content.getChildIndex(this.plankBase));
      fadeIn(sprite);
      return sprite;
    };

    this.shadow = place(this.shadow, cut(mid), mid.destX, mid.destW);
    this.shadowCapL = place(this.shadowCapL, cut(capL), capL.destX, capL.destW);
    this.shadowCapR = place(this.shadowCapR, cut(capR), capR.destX, capR.destW);
    this.shadowSource = src;
    this.hooks.markDirty();
  }

  /**
   * Brass floor plaque on the plank (wave-2 item 2). Idempotent: creates the
   * sprite on first call, re-textures on label change. Lives in `content`,
   * so LOD2 stamps inherit it and the far-zoom tower shows the plates.
   */
  setPlaque(env: EnvTextures, dpr: number, label: string): void {
    const tex = env.getPlaque(dpr, label);
    if (this.plaque === null) {
      this.plaque = new Sprite(tex);
      this.plaque.anchor.set(0.5);
      this.plaque.position.set(PLAQUE_CENTER_X, PLAQUE_CENTER_Y);
      this.content.addChildAt(this.plaque, this.content.getChildIndex(this.hoverLayer));
    } else if (this.plaque.texture !== tex) {
      this.plaque.texture = tex;
    }
    const size = env.plateSize;
    this.plaque.width = size.w;
    this.plaque.height = size.h;
    this.hooks.markDirty();
  }

  /* -------------------------------- flora -------------------------------- */

  /**
   * Attach one of the two baked flora layers at its world-space bounds. Flora
   * is decoration only: it fades in, never intercepts pointer events, and is
   * hidden below LOD0 (docs/design/library-themes.md §5) so far-zoom towers
   * stay cheap and read by silhouette alone.
   */
  setFlora(
    layer: 'back' | 'rail',
    texture: Texture | null,
    bounds: { x: number; y: number; w: number; h: number } | null,
  ): void {
    const parent = layer === 'back' ? this.floraBack : this.floraRail;
    const current = layer === 'back' ? this.floraBackSprite : this.floraRailSprite;
    if (texture === null || bounds === null) {
      if (current !== null) {
        gsap.killTweensOf(current);
        current.destroy();
        if (layer === 'back') this.floraBackSprite = null;
        else this.floraRailSprite = null;
        this.hooks.markDirty();
      }
      return;
    }
    let sprite = current;
    const fresh = sprite === null;
    if (sprite === null) {
      sprite = new Sprite(texture);
      sprite.eventMode = 'none';
      parent.addChild(sprite);
      if (layer === 'back') this.floraBackSprite = sprite;
      else this.floraRailSprite = sprite;
    } else if (sprite.texture !== texture) {
      sprite.texture = texture;
    }
    sprite.position.set(bounds.x, bounds.y);
    sprite.width = bounds.w;
    sprite.height = bounds.h;
    parent.visible = this.tier === 0;
    if (fresh) {
      const m = this.hooks.motion();
      if (m > 0) {
        sprite.alpha = 0;
        this.hooks.track(
          gsap.to(sprite, {
            alpha: 1,
            duration: 0.5 * m,
            onUpdate: () => this.hooks.markDirty(),
          }),
        );
      }
    }
    this.hooks.markDirty();
  }

  /** Drop both flora layers (theme switch, floor recycle). */
  clearFlora(): void {
    this.setFlora('back', null, null);
    this.setFlora('rail', null, null);
  }

  /** True when this floor already carries baked flora. */
  get hasFlora(): boolean {
    return this.floraBackSprite !== null || this.floraRailSprite !== null;
  }

  /**
   * Re-point existing wood sprites at the (re-stained) env textures. applyEnv
   * only ADDS missing sprites; this handles in-place texture swaps after
   * EnvTextures.setStain re-derives the case wood.
   */
  refreshEnv(env: EnvTextures): void {
    if (this.backWood !== null && env.back !== null && this.backWood.texture !== env.back) {
      this.backWood.texture = env.back;
    }
    if (this.plankWood !== null && env.plank !== null && this.plankWood.texture !== env.plank) {
      this.plankWood.texture = env.plank;
    }
    if (this.railsWood && env.rail !== null && this.railL.texture !== env.rail) {
      this.railL.texture = env.rail;
      this.railR.texture = env.rail;
    }
    // Re-cut the shadow frames if the strip texture itself was replaced —
    // otherwise the three sprites keep pointing at a destroyed source.
    if (this.shadow !== null) this.syncUnderPlankShadow(env, () => undefined);
    this.hooks.markDirty();
  }

  /** Re-pick textures for specific books (bakes landed / page evicted). */
  refreshTextures(factory: SpineFactory, bookIds?: ReadonlySet<string>): void {
    for (const visual of this.visuals) {
      if (bookIds !== undefined && !bookIds.has(visual.book.id)) continue;
      this.applyTexture(visual, factory);
    }
  }

  /**
   * Tier transition. `stamp` must be provided when entering tier 2 (world
   * bakes it first). Crossfades 120ms between live content and the stamp.
   */
  applyTier(tier: LodTier, stamp: RenderTexture | null, factory: SpineFactory): void {
    const prev = this.tier;
    this.tier = tier;
    // Flora (and its LOD2-stamp cost) drops out above LOD0 — §5 acceptance.
    this.floraBack.visible = tier === 0;
    this.floraRail.visible = tier === 0;
    if (tier !== 2) this.refreshTextures(factory);
    if (prev === tier) {
      if (tier === 2 && stamp !== null) this.showStamp(stamp);
      return;
    }
    const m = this.hooks.motion();
    const fade = (LOD_CROSSFADE_MS / 1000) * m;
    if (tier === 2) {
      if (stamp !== null) this.showStamp(stamp);
      if (this.stampSprite === null) return;
      const stampSprite = this.stampSprite;
      const content = this.content;
      if (fade === 0) {
        content.visible = false;
        stampSprite.alpha = 1;
        this.hooks.markDirty();
        return;
      }
      stampSprite.alpha = 0;
      content.visible = true;
      this.hooks.track(
        gsap.to(stampSprite, { alpha: 1, duration: fade, onUpdate: () => this.hooks.markDirty() }),
      );
      this.hooks.track(
        gsap.to(content, {
          alpha: 0,
          duration: fade,
          onUpdate: () => this.hooks.markDirty(),
          onComplete: () => {
            content.visible = false;
            content.alpha = 1;
            this.hooks.markDirty();
          },
        }),
      );
    } else if (prev === 2) {
      const stampSprite = this.stampSprite;
      this.content.visible = true;
      if (stampSprite === null || fade === 0) {
        if (stampSprite !== null) stampSprite.visible = false;
        this.content.alpha = 1;
        this.hooks.markDirty();
        return;
      }
      this.content.alpha = 0;
      this.hooks.track(
        gsap.to(this.content, { alpha: 1, duration: fade, onUpdate: () => this.hooks.markDirty() }),
      );
      this.hooks.track(
        gsap.to(stampSprite, {
          alpha: 0,
          duration: fade,
          onUpdate: () => this.hooks.markDirty(),
          onComplete: () => {
            stampSprite.visible = false;
            this.hooks.markDirty();
          },
        }),
      );
    } else {
      this.hooks.markDirty();
    }
  }

  /** Attach/update the LOD2 stamp sprite. */
  showStamp(stamp: RenderTexture): void {
    if (this.stampSprite === null) {
      this.stampSprite = new Sprite(stamp);
      this.root.addChild(this.stampSprite);
    } else {
      this.stampSprite.texture = stamp;
    }
    this.stampSprite.visible = true;
    this.stampSprite.width = SHELF_WIDTH;
    // Slight vertical overlap: stamp heights round to whole texels, and at
    // far zoom a sub-pixel gap between neighboring floor stamps reads as a
    // bright wall-colored seam across the case.
    this.stampSprite.height = FLOOR_H + 1.5;
    this.hooks.markDirty();
  }

  /**
   * Drop the stamp sprite's reference to its RenderTexture (the cache is
   * about to destroy it). Safe while invisible or mid-crossfade.
   */
  detachStamp(): void {
    if (this.stampSprite === null) return;
    gsap.killTweensOf(this.stampSprite);
    this.stampSprite.visible = false;
    this.stampSprite.texture = Texture.EMPTY;
    this.hooks.markDirty();
  }

  /**
   * Hover lift (LOD0 only; the world enforces the tier gate) plus a warm
   * glow halo and contact shadow behind/below the book so the lift reads.
   * All sprite transforms/alpha — no filters.
   */
  setHover(visual: BookVisual, on: boolean): void {
    const m = this.hooks.motion();
    gsap.killTweensOf(visual.sprite);
    this.hooks.track(
      gsap.to(visual.sprite, {
        pixi: {
          y: on ? visual.baseY - HOVER_LIFT : visual.baseY,
          rotation: (on ? visual.baseRotation + HOVER_TILT : visual.baseRotation) / DEG_TO_RAD,
        },
        duration: HOVER_SECONDS * m,
        ease: 'power2.out',
        overwrite: true,
        onUpdate: () => this.hooks.markDirty(),
      }),
    );

    if (this.hoverGlow === null) {
      this.hoverGlow = new Sprite(this.hooks.glow());
      this.hoverGlow.anchor.set(0.5);
      this.hoverGlow.blendMode = 'add';
      this.hoverGlow.tint = HOVER_GLOW_TINT;
      this.hoverGlow.alpha = 0;
      this.hoverShadow = new Sprite(this.hooks.glow());
      this.hoverShadow.anchor.set(0.5);
      this.hoverShadow.tint = 0x2e241a;
      this.hoverShadow.alpha = 0;
      this.hoverLayer.addChild(this.hoverGlow, this.hoverShadow);
    }
    const glow = this.hoverGlow;
    const shadow = this.hoverShadow as Sprite;
    gsap.killTweensOf(glow);
    gsap.killTweensOf(shadow);
    if (on) {
      glow.position.set(visual.centerX, visual.baseY - visual.height * 0.52);
      glow.width = visual.w * 3.4;
      glow.height = visual.height * 1.3;
      shadow.position.set(visual.centerX, visual.baseY + 3);
      shadow.width = visual.w * 2.1;
      shadow.height = 14;
    }
    const fade = HOVER_SECONDS * m;
    this.hooks.track(
      gsap.to(glow, {
        alpha: on ? HOVER_GLOW_ALPHA : 0,
        duration: fade,
        overwrite: true,
        onUpdate: () => this.hooks.markDirty(),
      }),
    );
    this.hooks.track(
      gsap.to(shadow, {
        alpha: on ? 0.26 : 0,
        duration: fade,
        overwrite: true,
        onUpdate: () => this.hooks.markDirty(),
      }),
    );
    if (m === 0) {
      glow.alpha = on ? HOVER_GLOW_ALPHA : 0;
      shadow.alpha = on ? 0.26 : 0;
      this.hooks.markDirty();
    }
  }

  /**
   * Keyboard-selection halo (wave-2 item 8): a cool glow behind the book plus
   * a penciled caret on the plank under it. Deliberately does NOT move the
   * spine — hover owns the lift tween, so the two never fight and a mouse
   * drifting over the shelf cannot steal the keyboard selection.
   */
  setSelected(visual: BookVisual | null, env: EnvTextures, dpr: number): void {
    if (this.selectGlow === null) {
      const glow = new Sprite(this.hooks.glow());
      glow.anchor.set(0.5);
      glow.blendMode = 'add';
      glow.tint = SELECT_GLOW_TINT;
      glow.alpha = 0;
      const caret = new Sprite(env.getSelectCaret(dpr));
      caret.anchor.set(0.5, 0);
      caret.width = SELECT_CARET_W;
      caret.height = SELECT_CARET_H;
      caret.alpha = 0;
      this.selectGlow = glow;
      this.selectCaret = caret;
      this.hoverLayer.addChild(glow, caret);
    }
    const glow = this.selectGlow;
    const caret = this.selectCaret as Sprite;
    const on = visual !== null;
    if (visual !== null) {
      glow.position.set(visual.centerX, visual.baseY - visual.height * 0.5);
      glow.width = visual.w * 3;
      glow.height = visual.height * 1.24;
      caret.position.set(visual.centerX, BOOK_BASELINE + 5);
    }
    const m = this.hooks.motion();
    const fade = HOVER_SECONDS * m;
    gsap.killTweensOf(glow);
    gsap.killTweensOf(caret);
    for (const [sprite, target] of [
      [glow, on ? SELECT_GLOW_ALPHA : 0],
      [caret, on ? 1 : 0],
    ] as Array<[Sprite, number]>) {
      this.hooks.track(
        gsap.to(sprite, {
          alpha: target,
          duration: fade,
          overwrite: true,
          onUpdate: () => this.hooks.markDirty(),
        }),
      );
      if (m === 0) sprite.alpha = target;
    }
    this.hooks.markDirty();
  }

  /** Return to the pool: detach from data but keep env sprites for reuse. */
  reset(): void {
    this.clearHoverFx();
    for (const v of this.visuals) {
      gsap.killTweensOf(v.sprite);
      v.sprite.destroy({ children: true });
    }
    this.visuals = [];
    this.booksLayer.removeChildren();
    for (const child of this.propsLayer.removeChildren()) child.destroy();
    this.clearFlora();
    gsap.killTweensOf(this.content);
    if (this.stampSprite !== null) {
      gsap.killTweensOf(this.stampSprite);
      this.stampSprite.visible = false;
      // Stamp render textures belong to the FloorStampCache; just detach.
      this.stampSprite.texture = Texture.EMPTY;
    }
    this.content.visible = true;
    this.content.alpha = 1;
    this.root.visible = false;
    this.index = -1;
    this.loaded = false;
  }

  destroy(): void {
    this.reset();
    // The three shadow sprites own derived frame Textures cut from the shared
    // strip source; free the frames (never the source, which EnvTextures owns).
    for (const s of [this.shadow, this.shadowCapL, this.shadowCapR]) {
      if (s !== null && !s.destroyed) s.texture.destroy(false);
    }
    this.shadow = null;
    this.shadowCapL = null;
    this.shadowCapR = null;
    this.shadowSource = null;
    this.root.destroy({ children: true });
  }

  /* ------------------------------ internals ------------------------------ */

  private clearHoverFx(): void {
    for (const fx of [
      this.hoverGlow,
      this.hoverShadow,
      this.selectGlow,
      this.selectCaret,
    ]) {
      if (fx === null) continue;
      gsap.killTweensOf(fx);
      fx.alpha = 0;
    }
  }

  private applyTexture(visual: BookVisual, factory: SpineFactory): void {
    const texture = factory.pick(visual.book, this.tier);
    if (texture !== undefined && !texture.destroyed) {
      visual.sprite.texture = texture;
      visual.sprite.tint = 0xffffff;
    } else {
      visual.sprite.texture = Texture.WHITE;
      visual.sprite.tint = placeholderTint(visual.params);
    }
    visual.sprite.width = visual.w;
    visual.sprite.height = visual.height;
    this.layoutDecor(visual);
    this.hooks.markDirty();
  }

  /**
   * Position/scale the charm + ribbon children in the spine sprite's LOCAL
   * space. The sprite's scale maps texture px → world px, so local sizes are
   * divided back out; decor then renders at a stable world size and rides
   * every hover lift / lean / pull transform for free. Children also inherit
   * the parent tint (placeholder phase) — counter-tint is not worth it for
   * the ~100ms placeholder window.
   */
  private layoutDecor(visual: BookVisual): void {
    const sx = visual.sprite.scale.x;
    const sy = visual.sprite.scale.y;
    if (sx === 0 || sy === 0) return;
    const charm = visual.charm;
    if (charm !== null) {
      charm.width = 20 / sx;
      charm.height = 24 / sy;
      charm.position.set((-visual.w * 0.16) / sx, (-visual.height + 2) / sy);
    }
    const ribbon = visual.ribbon;
    if (ribbon !== null) {
      ribbon.width = 11 / sx;
      ribbon.height = 32 / sy;
      ribbon.position.set((visual.w * 0.17) / sx, (-visual.height - 5) / sy);
    }
  }

  private updateHint(env: EnvTextures, dpr: number): void {
    const empty = this.loaded && this.visuals.length === 0;
    if (empty) {
      const variant = doodleVariantFor(this.index);
      const tex = env.getEmptyDoodle(dpr, variant);
      if (this.hint === null) {
        this.hint = new Sprite(tex);
        this.hint.anchor.set(0.5, 1);
        this.content.addChildAt(this.hint, this.content.getChildIndex(this.booksLayer));
      } else {
        this.hint.texture = tex;
      }
      // Doodles stand on the plank, drifting a little per floor.
      const rnd = mulberry32(fnv1a(`hint|${this.index}`));
      this.hint.position.set(SHELF_WIDTH * (0.3 + rnd() * 0.4), BOOK_BASELINE + 2);
      this.hint.width = 200;
      this.hint.height = 130;
    }
    if (this.hint !== null) this.hint.visible = empty;
  }
}
