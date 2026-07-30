/**
 * features/bookshelf/floorView.ts — one pooled Pixi container per floor.
 *
 * root (positioned at y = i*FLOOR_H) → content (floor-local):
 *   shadow strip (9-slice, under the plank) → plank (flat tint placeholder,
 *   wood bitmap crossfades in) → empty-shelf hint → book sprites.
 * At LOD2 `content` hides and a single stamp sprite (floor render texture)
 * shows instead, crossfaded over 120ms.
 *
 * Spines bake upright; lean and height jitter are applied here at composition
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
  FLOOR_H,
  PLANK_H,
  SHELF_WIDTH,
  slotCenterX,
} from './constants';
import type { LodTier } from './lod';
import { LOD_CROSSFADE_MS } from './lod';
import { placeholderTint, type SpineFactory } from './spineFactory';
import { PLACEHOLDER_TINTS, type EnvTextures } from './textures';

const DEG_TO_RAD = Math.PI / 180;

/** Hover lift per the doc: y -6 world px, rotation -0.015 rad, 0.18s. */
export const HOVER_LIFT = 6;
export const HOVER_TILT = -0.015;
export const HOVER_SECONDS = 0.18;

export interface WorldHooks {
  markDirty(): void;
  /** Motion scale: 1 normally, 0 under prefers-reduced-motion. */
  motion(): number;
  /** Register a tween for kill-on-destroy; returns it for chaining. */
  track<T extends gsap.core.Animation>(anim: T): T;
}

export interface BookVisual {
  book: Book;
  params: SpineParams;
  sprite: Sprite;
  /** Floor-local resting position/rotation (hover returns here). */
  baseY: number;
  baseRotation: number;
  /** World-px center x within the floor. */
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

  private readonly plankBase: Sprite;
  private plankWood: Sprite | null = null;
  private shadow: NineSliceSprite | null = null;
  private hint: Sprite | null = null;
  private readonly booksLayer = new Container();
  private stampSprite: Sprite | null = null;
  private tier: LodTier = 0;

  constructor(private readonly hooks: WorldHooks) {
    this.root.addChild(this.content);
    this.plankBase = new Sprite(Texture.WHITE);
    this.plankBase.tint = PLACEHOLDER_TINTS.plank;
    this.plankBase.position.set(0, BOOK_ZONE_H);
    this.plankBase.width = SHELF_WIDTH;
    this.plankBase.height = PLANK_H;
    this.content.addChild(this.plankBase, this.booksLayer);
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
    for (const v of this.visuals) {
      gsap.killTweensOf(v.sprite);
      v.sprite.destroy();
    }
    this.visuals = [];
    this.booksLayer.removeChildren();

    if (books !== undefined) {
      for (const book of books) {
        const params = factory.getParams(book);
        const sprite = new Sprite(Texture.WHITE);
        sprite.anchor.set(0.5, 1);
        const centerX = slotCenterX(book.slot);
        const height = SPINE_BASE_HEIGHT + params.hJitter;
        const visual: BookVisual = {
          book,
          params,
          sprite,
          baseY: BOOK_BASELINE,
          baseRotation: params.lean * DEG_TO_RAD,
          centerX,
          height,
        };
        sprite.position.set(centerX, BOOK_BASELINE);
        sprite.rotation = visual.baseRotation;
        this.applyTexture(visual, factory);
        this.booksLayer.addChild(sprite);
        this.visuals.push(visual);
      }
    }
    this.updateHint(env, dpr);
  }

  /** Pull env art in (called on populate and again when bakes land). */
  applyEnv(env: EnvTextures, degrade: boolean, animate: boolean): void {
    const m = this.hooks.motion();
    if (env.plank !== null && this.plankWood === null) {
      this.plankWood = new Sprite(env.plank);
      this.plankWood.position.set(0, BOOK_ZONE_H);
      this.plankWood.width = SHELF_WIDTH;
      this.plankWood.height = PLANK_H;
      this.content.addChildAt(this.plankWood, this.content.getChildIndex(this.plankBase) + 1);
      if (animate && m > 0) {
        this.plankWood.alpha = 0;
        this.hooks.track(
          gsap.to(this.plankWood, {
            alpha: 1,
            duration: 0.4 * m,
            onUpdate: () => this.hooks.markDirty(),
          }),
        );
      }
    }
    if (!degrade && env.shadow !== null && this.shadow === null) {
      this.shadow = new NineSliceSprite({
        texture: env.shadow,
        leftWidth: SHADOW_STRIP.inset,
        rightWidth: SHADOW_STRIP.inset,
        topHeight: 8,
        bottomHeight: 8,
      });
      this.shadow.width = SHELF_WIDTH;
      this.shadow.height = SHADOW_STRIP.h;
      this.shadow.position.set(0, FLOOR_H - 2);
      this.content.addChildAt(this.shadow, 0);
      if (animate && m > 0) {
        this.shadow.alpha = 0;
        this.hooks.track(
          gsap.to(this.shadow, {
            alpha: 1,
            duration: 0.4 * m,
            onUpdate: () => this.hooks.markDirty(),
          }),
        );
      }
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
    this.stampSprite.height = FLOOR_H;
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

  /** Hover lift (LOD0 only; the world enforces the tier gate). */
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
  }

  /** Return to the pool: detach from data but keep env sprites for reuse. */
  reset(): void {
    for (const v of this.visuals) {
      gsap.killTweensOf(v.sprite);
      v.sprite.destroy();
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
    if (empty && this.hint === null) {
      this.hint = new Sprite(env.getEmptyHint(dpr));
      this.hint.anchor.set(0.5, 0.5);
      this.hint.position.set(SHELF_WIDTH / 2, BOOK_ZONE_H - 56);
      this.hint.width = 320;
      this.hint.height = 72;
      this.content.addChild(this.hint);
    }
    if (this.hint !== null) this.hint.visible = empty;
  }
}
