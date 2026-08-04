/**
 * features/bookshelf/floorView.ts — one pooled Pixi container per floor.
 *
 * root (positioned at y = i*FLOOR_H) → content (floor-local), bottom → top:
 *   back panel (flat tint placeholder, baked board wall crossfades in)
 *   → plank (flat tint placeholder, wood bitmap crossfades in)
 *   → empty-floor doodle → hover mark layer → book sprites → selection marks
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
import {
  Container,
  Sprite,
  Texture,
  type NineSliceSprite,
  type RenderTexture,
} from 'pixi.js';
import { type SpineParams } from '../../art/spines';
import { spineArtWidth } from './spineFactory';
import { readShelfMeta } from '../../data/books';
import type { Book } from '../../data/types';
import {
  BOOK_BASELINE,
  BOOK_ZONE_H,
  FLOOR_H,
  PLANK_H,
  RAIL_W,
  SHELF_WIDTH,
} from './constants';
import { layoutFloor } from './layout';
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
import { placeholderTint, type SpineFactory } from './spineFactory';
import { makeFrameSprite, type ShelfMarks } from './glow';
import { fnv1a, mulberry32 } from '../../art/noise';

const DEG_TO_RAD = Math.PI / 180;

/** Hover lift per the doc: y -6 world px, rotation -0.015 rad, 0.18s. */
export const HOVER_LIFT = 6;
export const HOVER_TILT = -0.015;
export const HOVER_SECONDS = 0.18;

/**
 * How far the hover outline stands off the spine, world px per side.
 *
 * Small: the mark is meant to read as the book's own edge catching the light
 * of your attention, not as a box drawn around it. It sits BEHIND the books,
 * so this number is also exactly how much of the outline you ever see.
 */
export const HOVER_FRAME_PAD = 4;

/** Alpha of the flat contact ellipse under a hovered (lifted) book. */
export const HOVER_SHADOW_ALPHA = 0.2;

/**
 * Keyboard-selection mark (wave-2 item 8) — a cream-and-ink outline standing
 * further off the spine than the hover one, drawn OVER the books, plus the
 * caret on the plank. Two hard marks at different radii in different colours:
 * they read as different things when both land on the same book, and a mouse
 * drifting across the shelf never looks like it stole the keyboard selection.
 */
export const SELECT_FRAME_PAD = 8;

/**
 * Floor-local Y of the selection caret's top edge.
 *
 * Below where the selection frame's bottom edge lands (baseline + the pad +
 * half its line), because the two marks touching turns a bracket and a pointer
 * into one smudge.
 */
export const SELECT_CARET_Y = BOOK_BASELINE + 12;

/**
 * Everything an outline needs to sit around one spine. Kept as a plain object
 * because it is also the tween target — GSAP animates exactly these six, and a
 * nine-slice rebuilds its geometry from `width`/`height` per frame, which is
 * one buffer upload for one sprite and never a layout.
 */
interface FramePose {
  x: number;
  y: number;
  rotation: number;
  width: number;
  height: number;
  alpha: number;
}

function applyFramePose(frame: NineSliceSprite, pose: FramePose): void {
  frame.x = pose.x;
  frame.y = pose.y;
  frame.rotation = pose.rotation;
  frame.width = pose.width;
  frame.height = pose.height;
  frame.alpha = pose.alpha;
}

export interface WorldHooks {
  markDirty(): void;
  /** Motion scale: 1 normally, 0 under prefers-reduced-motion. */
  motion(): number;
  /** Register a tween for kill-on-destroy; returns it for chaining. */
  track<T extends gsap.core.Animation>(anim: T): T;
  /** The world's shared interaction-mark textures (hover, selection, shadow). */
  marks(): ShelfMarks;
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
  private railL: Sprite;
  private railR: Sprite;
  private railsWood = false;
  private plaque: Sprite | null = null;
  private shelfDetail: Sprite | null = null;
  /** DPR the world mounted this floor with (applyEnv needs it for detail). */
  private dprHint = 1;
  private hint: Sprite | null = null;
  private hoverFrame: NineSliceSprite | null = null;
  private hoverShadow: Sprite | null = null;
  private selectFrame: NineSliceSprite | null = null;
  private selectCaret: Sprite | null = null;
  private readonly hoverLayer = new Container();
  private readonly booksLayer = new Container();
  /** Above the books: the keyboard-selection outline, which must never hide. */
  private readonly markLayer = new Container();
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
      this.booksLayer,
      this.markLayer,
      this.railL,
      this.railR,
    );
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
    recentBookId: string | null = null,
  ): void {
    this.index = index;
    this.root.position.set(0, index * FLOOR_H);
    this.root.visible = true;
    this.tier = tier;
    this.dprHint = dpr;
    this.applyEnv(env, false);
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
      // Through the factory's own helper, not a second copy of the same
      // arithmetic: the row's layout width and the bake width have to be the
      // SAME number, or every sprite is resampled by a fraction of a pixel on
      // every frame — which is precisely the softness this pipeline was just
      // measured and fixed for.
      const widths = paramsList.map((params) => spineArtWidth((params as SpineParams).w));
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
        // WHERE it stands before HOW TALL it is, and in that order: under an
        // arcaded, gabled or ogee build the clear height is a function of x —
        // tall under a crown, a foot shorter at the pier beside it — so a
        // height asked for before the position is known is a height measured
        // against the wrong bay. (It was measured against no bay at all until
        // this landed: every book took the flat plank-to-plank gap and the
        // tall ones ran up through the arch heads.)
        factory.noteStand(book, centerX, w, leanDeg * DEG_TO_RAD);
        // Not spineArtHeight(params) directly: with authored art the sprite's
        // own proportions set the height, so the row keeps the generated
        // spread and the tall books nearly fill the opening.
        const height = factory.artHeight(book);
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
    this.updateHint(env, dpr);
  }

  /** Pull env art in (called on populate and again when bakes land). */
  applyEnv(env: EnvTextures, animate: boolean): void {
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

    if (env.back !== null && this.backWood === null) {
      this.backWood = new Sprite(env.back);
      this.backWood.position.set(0, 0);
      this.backWood.width = SHELF_WIDTH;
      this.backWood.height = BOOK_ZONE_H;
      this.content.addChildAt(this.backWood, this.content.getChildIndex(this.backBase) + 1);
      fadeIn(this.backWood);
    }

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
   * Hover: the lift and tilt (LOD0 only; the world enforces the tier gate), a
   * hard gilt outline hugging the spine, and a flat contact ellipse in the gap
   * the lift opens up. Transforms and alpha only — no filters, and nothing
   * that pretends to be light.
   */
  setHover(visual: BookVisual, on: boolean): void {
    const m = this.hooks.motion();
    const fade = HOVER_SECONDS * m;
    gsap.killTweensOf(visual.sprite);
    this.hooks.track(
      gsap.to(visual.sprite, {
        pixi: {
          y: on ? visual.baseY - HOVER_LIFT : visual.baseY,
          rotation: (on ? visual.baseRotation + HOVER_TILT : visual.baseRotation) / DEG_TO_RAD,
        },
        duration: fade,
        ease: 'power2.out',
        overwrite: true,
        onUpdate: () => this.hooks.markDirty(),
      }),
    );

    if (this.hoverFrame === null) {
      const marks = this.hooks.marks();
      this.hoverFrame = makeFrameSprite(marks.hoverFrame);
      const shadow = new Sprite(marks.contactShadow);
      shadow.anchor.set(0.5);
      shadow.alpha = 0;
      shadow.eventMode = 'none';
      this.hoverShadow = shadow;
      // Behind the books: only the sliver of outline standing proud of the
      // spine shows, which is the whole design — an edge, not a box.
      this.hoverLayer.addChild(this.hoverFrame, shadow);
    }
    const frame = this.hoverFrame;
    const shadow = this.hoverShadow as Sprite;
    gsap.killTweensOf(frame);
    gsap.killTweensOf(shadow);

    // The outline rides the lift on the same curve as the spine, so the two
    // never separate mid-tween.
    const pose: FramePose = {
      x: visual.centerX,
      y: visual.baseY - (on ? HOVER_LIFT : 0) + HOVER_FRAME_PAD,
      rotation: visual.baseRotation + (on ? HOVER_TILT : 0),
      width: visual.w + HOVER_FRAME_PAD * 2,
      height: visual.height + HOVER_FRAME_PAD * 2,
      alpha: on ? 1 : 0,
    };
    if (on) {
      // Appearing from nothing: park on the book's RESTING pose first, so the
      // outline grows out of the spine rather than flying in from wherever the
      // pointer was last. Already visible (a slide along the row) it keeps its
      // current pose and travels, which reads as one mark following the mouse.
      if (frame.alpha <= 0.02) {
        applyFramePose(frame, {
          ...pose,
          y: visual.baseY + HOVER_FRAME_PAD,
          rotation: visual.baseRotation,
          alpha: 0,
        });
      }
      shadow.position.set(visual.centerX, visual.baseY + 1);
      shadow.width = visual.w * 1.35;
      shadow.height = 9;
    }
    this.hooks.track(
      gsap.to(frame, {
        ...pose,
        duration: fade,
        ease: 'power2.out',
        overwrite: true,
        onUpdate: () => this.hooks.markDirty(),
      }),
    );
    this.hooks.track(
      gsap.to(shadow, {
        alpha: on ? HOVER_SHADOW_ALPHA : 0,
        duration: fade,
        overwrite: true,
        onUpdate: () => this.hooks.markDirty(),
      }),
    );
    if (m === 0) {
      applyFramePose(frame, pose);
      shadow.alpha = on ? HOVER_SHADOW_ALPHA : 0;
      this.hooks.markDirty();
    }
  }

  /**
   * Keyboard selection (wave-2 item 8): a cream-and-ink outline standing off
   * the spine, drawn OVER the books so no neighbour can bury it, plus the
   * caret on the plank. Deliberately does NOT move the spine — hover owns the
   * lift tween, so the two never fight and a mouse drifting over the shelf
   * cannot steal the keyboard selection.
   *
   * It sits further out and in a cooler colour than the hover outline, which
   * is what lets both land on one book and still read as two separate facts.
   */
  setSelected(visual: BookVisual | null, env: EnvTextures, dpr: number): void {
    if (this.selectFrame === null) {
      this.selectFrame = makeFrameSprite(this.hooks.marks().selectFrame);
      const caret = new Sprite(env.getSelectCaret(dpr));
      caret.anchor.set(0.5, 0);
      caret.width = SELECT_CARET_W;
      caret.height = SELECT_CARET_H;
      caret.alpha = 0;
      caret.eventMode = 'none';
      this.selectCaret = caret;
      this.markLayer.addChild(this.selectFrame, caret);
    }
    const frame = this.selectFrame;
    const caret = this.selectCaret as Sprite;
    const on = visual !== null;
    const m = this.hooks.motion();
    const fade = HOVER_SECONDS * m;
    gsap.killTweensOf(frame);
    gsap.killTweensOf(caret);

    if (visual !== null) {
      const pose: FramePose = {
        x: visual.centerX,
        y: visual.baseY + SELECT_FRAME_PAD,
        rotation: visual.baseRotation,
        width: visual.w + SELECT_FRAME_PAD * 2,
        height: visual.height + SELECT_FRAME_PAD * 2,
        alpha: 1,
      };
      // Arrow keys walk the selection along a row; a mark that travels tells
      // you which way you moved, where a blink leaves you hunting for it.
      const travelling = frame.alpha > 0.02;
      if (!travelling) applyFramePose(frame, { ...pose, alpha: 0 });
      caret.position.set(visual.centerX, SELECT_CARET_Y);
      this.hooks.track(
        gsap.to(frame, {
          ...pose,
          duration: travelling ? fade * 1.5 : fade,
          ease: travelling ? 'power3.out' : 'power2.out',
          overwrite: true,
          onUpdate: () => this.hooks.markDirty(),
        }),
      );
      if (m === 0) applyFramePose(frame, pose);
    } else {
      this.hooks.track(
        gsap.to(frame, {
          alpha: 0,
          duration: fade,
          overwrite: true,
          onUpdate: () => this.hooks.markDirty(),
        }),
      );
      if (m === 0) frame.alpha = 0;
    }

    this.hooks.track(
      gsap.to(caret, {
        alpha: on ? 1 : 0,
        duration: fade,
        overwrite: true,
        onUpdate: () => this.hooks.markDirty(),
      }),
    );
    if (m === 0) caret.alpha = on ? 1 : 0;
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
    this.root.destroy({ children: true });
  }

  /* ------------------------------ internals ------------------------------ */

  private clearHoverFx(): void {
    for (const fx of [
      this.hoverFrame,
      this.hoverShadow,
      this.selectFrame,
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
