/**
 * features/bookshelf/glow.ts — the one shared soft-radial texture.
 *
 * This is what is left of `motes.ts`, whose `DustMotes` class drifted a dozen
 * of these upward through the lamp pools. The pools went with the deferred
 * lighting pass and the motes went with them; the texture stayed because three
 * interaction affordances still draw it: the hover halo, the move drop-target
 * hint and the contact shadow under a dragged book.
 *
 * Those three are the only additive sprites left in the shelf, and they are
 * feedback rather than art — if the flat language should reach them too, the
 * replacement is a hard-edged flat highlight and this file goes with it.
 */

import { CanvasSource, ImageSource, Texture } from 'pixi.js';

/**
 * Shared 64² radial soft-glow texture. Authored on an OffscreenCanvas and
 * shipped to the GPU as an ImageBitmap (ImageSource) — direct canvas uploads
 * deliver wrong pixels on some renderers (headless SwiftShader), turning soft
 * gradients into garbage; the ImageBitmap path renders correctly everywhere.
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
