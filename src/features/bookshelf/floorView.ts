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
import { Container, NineSliceSprite, Sprite, Texture, type RenderTexture } from 'pixi.js';
import { SHADOW_STRIP } from '../../art/wood';
import { SPINE_BASE_HEIGHT, type SpineParams } from '../../art/spines';
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
} from './constants';
import { layoutFloor, LAYOUT_MARGIN_X } from './layout';
import { PROP_H, PROP_KINDS, PROP_W, type PropKind } from '../../art/props';
import type { LodTier } from './lod';
import { LOD_CROSSFADE_MS } from './lod';
import { doodleVariantFor, PLACEHOLDER_TINTS, type EnvTextures } from './textures';
import { placeholderTint, type SpineFactory } from './spineFactory';
import { fnv1a, mulberry32 } from '../../art/noise';

const DEG_TO_RAD = Math.PI / 180;

/** Hover lift per the doc: y -6 world px, rotation -0.015 rad, 0.18s. */
export const HOVER_LIFT = 6;
export const HOVER_TILT = -0.015;
export const HOVER_SECONDS = 0.18;

/** Warm halo behind the hovered book (add-blended glow sprite). */
export const HOVER_GLOW_ALPHA = 0.34;
export const HOVER_GLOW_TINT = 0xffd98f;

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
}

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
  private shadow: NineSliceSprite | null = null;
  private shadeL: Sprite | null = null;
  private shadeR: Sprite | null = null;
  private railL: Sprite;
  private railR: Sprite;
  private railsWood = false;
  private hint: Sprite | null = null;
  private hoverGlow: Sprite | null = null;
  private hoverShadow: Sprite | null = null;
  private readonly hoverLayer = new Container();
  private readonly propsLayer = new Container();
  private readonly booksLayer = new Container();
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
      this.booksLayer,
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
    degrade: boolean,
  ): void {
    this.index = index;
    this.root.position.set(0, index * FLOOR_H);
    this.root.visible = true;
    this.tier = tier;
    this.applyEnv(env, degrade, false);
    this.setBooks(books, factory, dpr, env);
    // Representation matches the tier immediately on (re)mount — no fade.
    this.content.visible = tier !== 2;
    this.content.alpha = 1;
    if (this.stampSprite !== null) this.stampSprite.visible = false;
  }

  /** Update book data (store page landed) without changing tier state. */
  setBooks(
    books: readonly Book[] | undefined,
    factory: SpineFactory,
    dpr: number,
    env: EnvTextures,
  ): void {
    this.loaded = books !== undefined;
    this.clearHoverFx();
    for (const v of this.visuals) {
      gsap.killTweensOf(v.sprite);
      v.sprite.destroy();
    }
    this.visuals = [];
    this.booksLayer.removeChildren();

    if (books !== undefined && books.length > 0) {
      const paramsList = books.map((book) => factory.getParams(book));
      const placed = layoutFloor(
        paramsList.map((p, i) => ({ slot: (books[i] as Book).slot, w: p.w })),
        this.index,
      );
      for (let i = 0; i < books.length; i++) {
        const book = books[i] as Book;
        const params = paramsList[i] as SpineParams;
        const place = placed[i];
        const sprite = new Sprite(Texture.WHITE);
        sprite.anchor.set(0.5, 1);
        const centerX = place !== undefined ? place.centerX : SHELF_WIDTH / 2;
        const leanDeg = params.lean + (place !== undefined ? place.leanDeg : 0);
        const height = SPINE_BASE_HEIGHT + params.hJitter;
        // Rotation is around the bottom-center anchor, which lifts one bottom
        // corner off the plank by (w/2)·sin θ — sink the book by that much so
        // leaners stay grounded (the other corner tucks into the plank).
        const sink = (params.w / 2) * Math.abs(Math.sin(leanDeg * DEG_TO_RAD));
        const visual: BookVisual = {
          book,
          params,
          sprite,
          baseY: BOOK_BASELINE + sink,
          baseRotation: leanDeg * DEG_TO_RAD,
          centerX,
          height,
        };
        sprite.position.set(centerX, visual.baseY);
        sprite.rotation = visual.baseRotation;
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
    if (first.centerX - first.params.w / 2 - LAYOUT_MARGIN_X >= MIN_GAP) {
      spans.push({ x0: LAYOUT_MARGIN_X, x1: first.centerX - first.params.w / 2 });
    }
    for (let i = 1; i < this.visuals.length; i++) {
      const a = this.visuals[i - 1] as BookVisual;
      const b = this.visuals[i] as BookVisual;
      const x0 = a.centerX + a.params.w / 2;
      const x1 = b.centerX - b.params.w / 2;
      if (x1 - x0 >= MIN_GAP) spans.push({ x0, x1 });
    }
    if (SHELF_WIDTH - LAYOUT_MARGIN_X - (last.centerX + last.params.w / 2) >= MIN_GAP) {
      spans.push({ x0: last.centerX + last.params.w / 2, x1: SHELF_WIDTH - LAYOUT_MARGIN_X });
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
    const fadeIn = (sprite: Sprite | NineSliceSprite): void => {
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
    if (!degrade && env.shadow !== null && this.shadow === null) {
      this.shadow = new NineSliceSprite({
        texture: env.shadow,
        leftWidth: SHADOW_STRIP.inset,
        rightWidth: SHADOW_STRIP.inset,
        topHeight: 10,
        bottomHeight: 8,
      });
      this.shadow.width = SHELF_WIDTH;
      this.shadow.height = TOP_SHADOW_H;
      this.shadow.position.set(0, 0);
      this.content.addChildAt(this.shadow, this.content.getChildIndex(this.plankBase));
      fadeIn(this.shadow);
    }

    if (env.plank !== null && this.plankWood === null) {
      this.plankWood = new Sprite(env.plank);
      this.plankWood.position.set(0, BOOK_ZONE_H);
      this.plankWood.width = SHELF_WIDTH;
      this.plankWood.height = PLANK_H;
      this.content.addChildAt(this.plankWood, this.content.getChildIndex(this.plankBase) + 1);
      fadeIn(this.plankWood);
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
      glow.width = visual.params.w * 3.4;
      glow.height = visual.height * 1.3;
      shadow.position.set(visual.centerX, visual.baseY + 3);
      shadow.width = visual.params.w * 2.1;
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

  /** Return to the pool: detach from data but keep env sprites for reuse. */
  reset(): void {
    this.clearHoverFx();
    for (const v of this.visuals) {
      gsap.killTweensOf(v.sprite);
      v.sprite.destroy();
    }
    this.visuals = [];
    this.booksLayer.removeChildren();
    for (const child of this.propsLayer.removeChildren()) child.destroy();
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
    if (this.hoverGlow !== null) {
      gsap.killTweensOf(this.hoverGlow);
      this.hoverGlow.alpha = 0;
    }
    if (this.hoverShadow !== null) {
      gsap.killTweensOf(this.hoverShadow);
      this.hoverShadow.alpha = 0;
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
    visual.sprite.width = visual.params.w;
    visual.sprite.height = visual.height;
    this.hooks.markDirty();
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
