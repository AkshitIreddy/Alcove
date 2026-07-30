/**
 * features/bookshelf/motes.ts — the idle dust-mote fx layer.
 *
 * A dozen soft-glow sprites drifting slowly upward in screen space. Cheap by
 * construction (transform/alpha only, one tiny shared texture) and disabled
 * entirely in degrade mode and under reduced motion.
 */

import { CanvasSource, Container, ImageSource, Sprite, Texture } from 'pixi.js';
import { mulberry32 } from '../../art/noise';

/** Total motes; the first MOTE_POOL_COUNT cluster near the wall light pools. */
export const MOTE_COUNT = 18;
export const MOTE_POOL_COUNT = 7;

/** Normalized centers of the lamp-glow pools (match world.ts poolSpecs). */
const POOL_CENTERS: ReadonlyArray<readonly [number, number]> = [
  [0.18, 0.16],
  [0.86, 0.4],
  [0.5, 0.94],
];

interface Mote {
  sprite: Sprite;
  /** Base position; drift wobbles around it. */
  x: number;
  y: number;
  riseSpeed: number;
  wobbleAmp: number;
  wobbleFreq: number;
  phase: number;
  baseAlpha: number;
  scale: number;
  t: number;
  /** Seeded values setStyle scales from (so restyling never compounds). */
  seedAlpha: number;
  seedScale: number;
}

/**
 * Shared 64² radial soft-glow texture (also used by the pull-out shadow and
 * the hover halo). Authored on an OffscreenCanvas and shipped to the GPU as
 * an ImageBitmap (ImageSource) — direct canvas uploads deliver wrong pixels
 * on some renderers (headless SwiftShader), turning soft gradients into
 * garbage; the ImageBitmap path renders correctly everywhere.
 */
export function makeGlowTexture(): Texture {
  const size = 64;
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(size, size)
      : (() => {
          const c = document.createElement('canvas');
          c.width = size;
          c.height = size;
          return c;
        })();
  const ctx = (canvas as OffscreenCanvas).getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | null;
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255, 250, 235, 1)');
    g.addColorStop(0.5, 'rgba(255, 250, 235, 0.35)');
    g.addColorStop(1, 'rgba(255, 250, 235, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return new Texture({
      source: new ImageSource({ resource: canvas.transferToImageBitmap() }),
    });
  }
  return new Texture({
    source: new CanvasSource({ resource: canvas as HTMLCanvasElement }),
  });
}

export class DustMotes {
  readonly container = new Container();
  enabled = false;

  private readonly motes: Mote[] = [];
  private readonly texture: Texture;
  private width = 0;
  private height = 0;
  private twinkle = false;

  constructor(texture: Texture) {
    this.texture = texture;
    this.container.eventMode = 'none';
    const rnd = mulberry32(0xd057);
    for (let i = 0; i < MOTE_COUNT; i++) {
      const sprite = new Sprite(this.texture);
      sprite.anchor.set(0.5);
      const mote: Mote = {
        sprite,
        x: 0,
        y: 0,
        riseSpeed: 3 + rnd() * 6,
        wobbleAmp: 6 + rnd() * 14,
        wobbleFreq: 0.15 + rnd() * 0.3,
        phase: rnd() * Math.PI * 2,
        baseAlpha: 0.05 + rnd() * 0.1,
        scale: 0.08 + rnd() * 0.22,
        t: rnd() * 100,
        seedAlpha: 0,
        seedScale: 0,
      };
      mote.seedAlpha = mote.baseAlpha;
      mote.seedScale = mote.scale;
      sprite.scale.set(mote.scale);
      sprite.alpha = 0;
      this.motes.push(mote);
      this.container.addChild(sprite);
    }
  }

  /**
   * Re-style the drift from a theme's MoteSpec (docs/design/library-themes.md
   * §1): dust falls slowly and warm, pollen thicker and gold, silver sparkle
   * twinkles hard, petals drift big and slow. `density` is particles per
   * 1000x1000 world px — scaled here onto the fixed MOTE_COUNT pool by
   * modulating how many are visible and how bright they burn.
   */
  setStyle(style: {
    colour: number;
    /** Particles per 1000² world px, ~2 (thin) → ~26 (heavy). */
    density: number;
    /** Fall speed in world px/s; negative rises. */
    drift: number;
    twinkle?: boolean;
  }): void {
    const shown = Math.max(
      3,
      Math.min(MOTE_COUNT, Math.round((style.density / 14) * MOTE_COUNT)),
    );
    const weight = Math.min(1.9, Math.max(0.5, style.density / 10));
    this.twinkle = style.twinkle ?? false;
    for (let i = 0; i < this.motes.length; i++) {
      const mote = this.motes[i] as Mote;
      mote.sprite.tint = style.colour;
      mote.sprite.visible = i < shown;
      // Negative drift in the spec means "rises"; the pool always rises, so a
      // positive (falling) spec flips the sign of riseSpeed.
      mote.riseSpeed = -style.drift * (0.55 + (i % 5) * 0.18);
      mote.baseAlpha = mote.seedAlpha * weight;
      mote.scale = mote.seedScale * (0.8 + weight * 0.35);
      mote.sprite.scale.set(mote.scale);
    }
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const rnd = mulberry32(0x5eed + Math.floor(width));
    for (let i = 0; i < this.motes.length; i++) {
      const mote = this.motes[i] as Mote;
      if (i < MOTE_POOL_COUNT) {
        // Cluster near a lamp-glow pool so the light reads as dusty air.
        const pool = POOL_CENTERS[i % POOL_CENTERS.length] as readonly [number, number];
        mote.x = (pool[0] + (rnd() * 2 - 1) * 0.14) * width;
        mote.y = (pool[1] + (rnd() * 2 - 1) * 0.16) * height;
      } else {
        mote.x = rnd() * width;
        mote.y = rnd() * height;
      }
    }
  }

  update(dt: number): void {
    if (!this.enabled || this.width === 0) return;
    for (const mote of this.motes) {
      mote.t += dt;
      mote.y -= mote.riseSpeed * dt;
      if (mote.y < -12) {
        mote.y = this.height + 12;
        mote.x = (mote.x + 137) % this.width;
      } else if (mote.y > this.height + 12) {
        // Falling themes (petals, heavy dust) wrap the other way.
        mote.y = -12;
        mote.x = (mote.x + 211) % this.width;
      }
      const wob = Math.sin(mote.t * mote.wobbleFreq * Math.PI * 2 + mote.phase);
      mote.sprite.position.set(mote.x + wob * mote.wobbleAmp, mote.y);
      // Gentle twinkle — sparkle rooms pulse much harder than dusty ones.
      const depth = this.twinkle ? 0.72 : 0.3;
      const speed = this.twinkle ? 2.6 : 0.9;
      mote.sprite.alpha =
        mote.baseAlpha * (1 - depth + depth * (0.5 + 0.5 * Math.sin(mote.t * speed + mote.phase)));
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.container.visible = on;
    if (!on) for (const mote of this.motes) mote.sprite.alpha = 0;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
