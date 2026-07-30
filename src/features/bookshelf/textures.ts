/**
 * features/bookshelf/textures.ts — environment textures (wood, shadow, paper,
 * empty-shelf hint) as Pixi textures.
 *
 * All bitmap art bakes asynchronously through src/art (disk-cached inside
 * Tauri); consumers show flat token-colored placeholders until `onReady`
 * fires per kind, then crossfade the real bitmaps in.
 */

import { CanvasSource, ImageSource, Texture } from 'pixi.js';
import { bakePaperTile } from '../../art/paper';
import { bakeShelfPlank, bakeShelfShadowStrip } from '../../art/wood';
import { mulberry32 } from '../../art/noise';
import { SHELF_WIDTH } from './constants';

export type EnvKind = 'plank' | 'shadow' | 'paper';

/** Flat placeholder tints (match the baked art's average tones). */
export const PLACEHOLDER_TINTS = {
  plank: 0x7d5e40,
  backdrop: 0xefe4cc,
} as const;

function textureFromBitmap(bitmap: ImageBitmap, mipmaps: boolean): Texture {
  const source = new ImageSource({
    resource: bitmap,
    autoGenerateMipmaps: mipmaps,
  });
  return new Texture({ source });
}

export class EnvTextures {
  plank: Texture | null = null;
  shadow: Texture | null = null;
  paper: Texture | null = null;

  private emptyHint: Texture | null = null;
  private readonly listeners = new Set<(kind: EnvKind) => void>();
  private destroyed = false;

  /** Kick off the async bakes. Shadow is skipped entirely in degrade mode. */
  load(dpr: number, degrade: boolean): void {
    void bakeShelfPlank(SHELF_WIDTH, dpr)
      .then((bitmap) => this.deliver('plank', textureFromBitmap(bitmap, true)))
      .catch(() => undefined);
    if (!degrade) {
      void bakeShelfShadowStrip(dpr)
        .then((bitmap) => this.deliver('shadow', textureFromBitmap(bitmap, false)))
        .catch(() => undefined);
    }
    void bakePaperTile(dpr, 'aged')
      .then((bitmap) => this.deliver('paper', textureFromBitmap(bitmap, true)))
      .catch(() => undefined);
  }

  onReady(cb: (kind: EnvKind) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * The faint penciled "empty shelf" hint sprite texture (shared by every
   * empty floor). Baked synchronously — it is a few strokes and one line of
   * text on a small canvas.
   */
  getEmptyHint(dpr: number): Texture {
    if (this.emptyHint !== null) return this.emptyHint;
    const w = 320;
    const h = 72;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w * dpr);
    canvas.height = Math.ceil(h * dpr);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.strokeStyle = 'rgba(69, 65, 58, 0.34)';
      ctx.fillStyle = 'rgba(69, 65, 58, 0.4)';
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      ctx.font = '21px "Architects Daughter", "Segoe Print", cursive';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('~ empty shelf ~', w / 2, h * 0.42);
      // Two wobbled pencil ticks flanking the label.
      const rnd = mulberry32(0xe321);
      for (const [x0, x1] of [
        [w * 0.08, w * 0.26],
        [w * 0.74, w * 0.92],
      ]) {
        ctx.beginPath();
        const steps = 8;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const x = x0 + (x1 - x0) * t;
          const y = h * 0.46 + (rnd() * 2 - 1) * 1.6;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    const source = new CanvasSource({ resource: canvas });
    this.emptyHint = new Texture({ source });
    return this.emptyHint;
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
    this.plank?.destroy(true);
    this.shadow?.destroy(true);
    this.paper?.destroy(true);
    this.emptyHint?.destroy(true);
    this.plank = null;
    this.shadow = null;
    this.paper = null;
    this.emptyHint = null;
  }

  private deliver(kind: EnvKind, texture: Texture): void {
    if (this.destroyed) {
      texture.destroy(true);
      return;
    }
    if (kind === 'plank') this.plank = texture;
    else if (kind === 'shadow') this.shadow = texture;
    else this.paper = texture;
    for (const cb of this.listeners) cb(kind);
  }
}
