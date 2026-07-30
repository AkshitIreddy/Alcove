/**
 * features/bookshelf/motes.ts — the idle dust-mote fx layer.
 *
 * A dozen soft-glow sprites drifting slowly upward in screen space. Cheap by
 * construction (transform/alpha only, one tiny shared texture) and disabled
 * entirely in degrade mode and under reduced motion.
 */

import { CanvasSource, Container, ImageSource, Sprite, Texture } from 'pixi.js';
import { mulberry32 } from '../../art/noise';

export const MOTE_COUNT = 12;

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
      };
      sprite.scale.set(mote.scale);
      sprite.alpha = 0;
      this.motes.push(mote);
      this.container.addChild(sprite);
    }
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const rnd = mulberry32(0x5eed + Math.floor(width));
    for (const mote of this.motes) {
      mote.x = rnd() * width;
      mote.y = rnd() * height;
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
      }
      const wob = Math.sin(mote.t * mote.wobbleFreq * Math.PI * 2 + mote.phase);
      mote.sprite.position.set(mote.x + wob * mote.wobbleAmp, mote.y);
      // Gentle twinkle.
      mote.sprite.alpha = mote.baseAlpha * (0.7 + 0.3 * Math.sin(mote.t * 0.9 + mote.phase));
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
