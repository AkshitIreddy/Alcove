/**
 * features/bookshelf/textures.ts — environment textures (wood, back panel,
 * rails, crown, shadow, paper, empty-floor doodles) as Pixi textures.
 *
 * All bitmap art bakes asynchronously through src/art (disk-cached inside
 * Tauri); consumers show flat token-colored placeholders until `onReady`
 * fires per kind, then crossfade the real bitmaps in. Tiny synchronous
 * gradient/doodle textures (wall shade, empty-floor hints) are baked inline
 * here — a few strokes on small canvases, no async round-trip needed.
 */

import { CanvasSource, ImageSource, Texture } from 'pixi.js';
import { bakePaperTile, bakeWallpaperTile } from '../../art/paper';
import { PROP_H, PROP_W, renderProp, type PropKind } from '../../art/props';
import type { Ctx2D } from '../../art/spines';
import {
  bakeBackPanel,
  bakeCrown,
  bakeShelfPlank,
  bakeShelfShadowStrip,
  bakeSideRail,
} from '../../art/wood';
import { doubleStroke } from '../../art/wobble';
import { fnv1a, mulberry32 } from '../../art/noise';
import { BOOK_ZONE_H, CROWN_H, CROWN_LIP, FLOOR_H, RAIL_W, SHELF_WIDTH } from './constants';

export type EnvKind =
  | 'plank'
  | 'shadow'
  | 'paper'
  | 'back'
  | 'rail'
  | 'crown'
  | 'wallpaper';

/** Flat placeholder tints (match the baked art's average tones). */
export const PLACEHOLDER_TINTS = {
  plank: 0x7d5e40,
  backdrop: 0xefe4cc,
  back: 0x604b35,
  rail: 0x7a5c3e,
  crown: 0x7d5e40,
} as const;

/** Number of distinct empty-floor doodle variants (see getEmptyDoodle). */
export const EMPTY_DOODLE_VARIANTS = 3;

/** World-px design size of the doodle textures. */
export const EMPTY_DOODLE_W = 200;
export const EMPTY_DOODLE_H = 130;

/** Deterministic doodle variant for a floor. */
export function doodleVariantFor(floorIndex: number): number {
  return fnv1a(`doodle|${floorIndex}`) % EMPTY_DOODLE_VARIANTS;
}

/**
 * Doodle "chalk pencil" tones — light warm strokes that read on the DARK
 * back panel (dark graphite vanishes against it). Opaque colors rather than
 * translucent white keep the look identical across renderers.
 */
const GRAPHITE_STROKE = '#c9bba1';
const GRAPHITE_SOFT = '#ab9d85';

function textureFromBitmap(bitmap: ImageBitmap, mipmaps: boolean): Texture {
  const source = new ImageSource({
    resource: bitmap,
    autoGenerateMipmaps: mipmaps,
  });
  return new Texture({ source });
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

/**
 * IMPORTANT: small synchronously-authored art (shade gradients, doodles) must
 * reach the GPU as an ImageBitmap (ImageSource), NOT as a live CanvasSource.
 * Direct canvas uploads deliver wrong pixels on some renderers (headless
 * SwiftShader garbles both alpha and content — the original "invisible
 * empty-shelf hint" bug), while the ImageBitmap path — used by every baked
 * env texture (planks, rails, crown) — renders correctly everywhere.
 * OffscreenCanvas.transferToImageBitmap() makes that conversion synchronous.
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
    return new Texture({
      source: new ImageSource({ resource: canvas.transferToImageBitmap() }),
    });
  }
  return new Texture({
    source: new CanvasSource({ resource: canvas as HTMLCanvasElement }),
  });
}

export class EnvTextures {
  plank: Texture | null = null;
  shadow: Texture | null = null;
  paper: Texture | null = null;
  back: Texture | null = null;
  rail: Texture | null = null;
  crown: Texture | null = null;
  wallpaper: Texture | null = null;

  private readonly doodles = new Map<number, Texture>();
  private readonly props = new Map<number, Texture>();
  private wallShade: Texture | null = null;
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
    void bakeBackPanel(SHELF_WIDTH, BOOK_ZONE_H, dpr)
      .then((bitmap) => this.deliver('back', textureFromBitmap(bitmap, true)))
      .catch(() => undefined);
    void bakeSideRail(RAIL_W, FLOOR_H, dpr)
      .then((bitmap) => this.deliver('rail', textureFromBitmap(bitmap, true)))
      .catch(() => undefined);
    void bakeCrown(SHELF_WIDTH + CROWN_LIP * 2, CROWN_H, dpr)
      .then((bitmap) => this.deliver('crown', textureFromBitmap(bitmap, true)))
      .catch(() => undefined);
    void bakeWallpaperTile(dpr)
      .then((bitmap) => this.deliver('wallpaper', textureFromBitmap(bitmap, true)))
      .catch(() => undefined);
  }

  onReady(cb: (kind: EnvKind) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * Soft horizontal shade gradient — translucent warm-dark at the left edge
   * fading to fully transparent. Rendered with NORMAL blending (do NOT use
   * multiply: the shelf canvas is transparent over the CSS paper body, so
   * multiply would darken against premultiplied backdrop pixels and read
   * as a heavy gray slab). Flanks the case as wall ambient occlusion and,
   * rotated, caps it above the crown. Shared 64×8 texture, baked once.
   */
  getWallShade(): Texture {
    if (this.wallShade !== null) return this.wallShade;
    const w = 64;
    const h = 8;
    const canvas = makeCanvas(w, h);
    const ctx = get2d(canvas);
    if (ctx) {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, 'rgba(122, 94, 58, 0.26)');
      g.addColorStop(0.4, 'rgba(128, 101, 64, 0.11)');
      g.addColorStop(1, 'rgba(132, 106, 70, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    this.wallShade = textureFromCanvas(canvas);
    return this.wallShade;
  }

  /**
   * Empty-floor doodle texture. Three quietly charming variants, deterministic
   * per floor via doodleVariantFor:
   *   0 — a leaning penciled ghost-book with a dust curl,
   *   1 — a little potted plant,
   *   2 — a lying two-book stack with the "~ empty shelf ~" label.
   * All graphite pencil linework, drawn once per variant per session.
   */
  getEmptyDoodle(dpr: number, variant: number): Texture {
    const v = ((variant % EMPTY_DOODLE_VARIANTS) + EMPTY_DOODLE_VARIANTS) % EMPTY_DOODLE_VARIANTS;
    const cached = this.doodles.get(v);
    if (cached !== undefined) return cached;

    const w = EMPTY_DOODLE_W;
    const h = EMPTY_DOODLE_H;
    const scale = Math.max(1, dpr);
    const canvas = makeCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
    const ctx = get2d(canvas);
    if (ctx) {
      ctx.scale(scale, scale);
      ctx.strokeStyle = GRAPHITE_STROKE;
      ctx.fillStyle = GRAPHITE_SOFT;
      ctx.lineWidth = 1.3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const rnd = mulberry32((0xe321 + v * 0x9d7) >>> 0);
      const wob = { seed: (0xd00d + v) >>> 0, amplitude: 1, frequency: 0.05 };
      const strokePath = (d: string): void => {
        const [a, b] = doubleStroke(d, { ...wob, seed: (wob.seed + Math.floor(rnd() * 1e4)) >>> 0 });
        ctx.stroke(new Path2D(a));
        ctx.stroke(new Path2D(b));
      };

      if (v === 0) {
        // Ghost book: an outlined spine leaning at ~8°, baseline y = h - 4.
        const bw = 34;
        const bh = 92;
        const x0 = w * 0.42;
        const yb = h - 4;
        const leanDx = 14;
        strokePath(
          `M ${x0} ${yb} L ${x0 + bw} ${yb} L ${x0 + bw + leanDx} ${yb - bh} L ${x0 + leanDx} ${yb - bh} Z`,
        );
        // A couple of faint band rules on the ghost spine.
        strokePath(`M ${x0 + leanDx * 0.75} ${yb - bh * 0.72} L ${x0 + bw + leanDx * 0.75} ${yb - bh * 0.72}`);
        // Dust curl beside it.
        ctx.strokeStyle = GRAPHITE_SOFT;
        strokePath(
          `M ${x0 - 38} ${yb - 8} C ${x0 - 30} ${yb - 22}, ${x0 - 16} ${yb - 20}, ${x0 - 20} ${yb - 10} C ${x0 - 23} ${yb - 4}, ${x0 - 32} ${yb - 5}, ${x0 - 30} ${yb - 12}`,
        );
        // Three tiny dust flecks.
        for (let i = 0; i < 3; i++) {
          const fx = x0 + bw + 26 + rnd() * 26;
          const fy = yb - 6 - rnd() * 18;
          ctx.beginPath();
          ctx.arc(fx, fy, 0.9 + rnd() * 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (v === 1) {
        // Potted plant: trapezoid pot, rim, three leaf arcs.
        const cx = w / 2;
        const yb = h - 4;
        strokePath(`M ${cx - 20} ${yb - 30} L ${cx + 20} ${yb - 30} L ${cx + 14} ${yb} L ${cx - 14} ${yb} Z`);
        strokePath(`M ${cx - 24} ${yb - 30} L ${cx + 24} ${yb - 30}`);
        const leaves = [
          `M ${cx} ${yb - 32} C ${cx - 4} ${yb - 52}, ${cx - 22} ${yb - 58}, ${cx - 26} ${yb - 74}`,
          `M ${cx} ${yb - 32} C ${cx + 2} ${yb - 56}, ${cx + 16} ${yb - 62}, ${cx + 24} ${yb - 78}`,
          `M ${cx} ${yb - 32} C ${cx - 1} ${yb - 50}, ${cx + 3} ${yb - 62}, ${cx - 2} ${yb - 80}`,
        ];
        for (const d of leaves) strokePath(d);
        // Leaf blobs at the tips.
        for (const [lx, ly] of [
          [cx - 26, yb - 74],
          [cx + 24, yb - 78],
          [cx - 2, yb - 80],
        ]) {
          strokePath(`M ${lx} ${ly} C ${lx - 7} ${ly - 8}, ${lx + 2} ${ly - 16}, ${lx + 4} ${ly - 6} C ${lx + 5} ${ly - 1}, ${lx + 2} ${ly + 2}, ${lx} ${ly}`);
        }
      } else {
        // Two lying books + label.
        const cx = w / 2;
        const yb = h - 4;
        strokePath(`M ${cx - 46} ${yb} L ${cx + 40} ${yb} L ${cx + 40} ${yb - 13} L ${cx - 46} ${yb - 13} Z`);
        strokePath(`M ${cx - 38} ${yb - 13} L ${cx + 46} ${yb - 13} L ${cx + 46} ${yb - 26} L ${cx - 38} ${yb - 26} Z`);
        strokePath(`M ${cx + 30} ${yb - 2} L ${cx + 30} ${yb - 11}`);
        ctx.font = '21px "Architects Daughter", "Segoe Print", cursive';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#d3c6ad';
        ctx.fillText('~ empty shelf ~', cx, h * 0.28);
        ctx.strokeStyle = GRAPHITE_SOFT;
        for (const [x0, x1] of [
          [w * 0.06, w * 0.2],
          [w * 0.8, w * 0.94],
        ]) {
          strokePath(`M ${x0} ${h * 0.28} L ${x1} ${h * 0.28}`);
        }
      }
    }
    const texture = textureFromCanvas(canvas);
    this.doodles.set(v, texture);
    return texture;
  }

  /**
   * Shelf-dressing prop texture (baked once per kind per session, ImageBitmap
   * path — see the makeCanvas note). `variant` seeds the small strokes so the
   * same kind can appear twice without reading as a stamp; only a few
   * variants per kind are ever baked (kind*8 + variant%8 cache slots).
   */
  getProp(dpr: number, kind: PropKind, variant: number): Texture {
    const v = ((variant % 8) + 8) % 8;
    const key = kind * 8 + v;
    const cached = this.props.get(key);
    if (cached !== undefined) return cached;
    const scale = Math.max(1, dpr);
    const canvas = makeCanvas(Math.ceil(PROP_W * scale), Math.ceil(PROP_H * scale));
    const ctx = get2d(canvas);
    if (ctx) {
      ctx.scale(scale, scale);
      renderProp(ctx as Ctx2D, kind, (0x9a75 + kind * 131 + v * 977) >>> 0);
    }
    const texture = textureFromCanvas(canvas);
    this.props.set(key, texture);
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
    this.wallShade?.destroy(true);
    for (const tex of this.doodles.values()) tex.destroy(true);
    this.doodles.clear();
    for (const tex of this.props.values()) tex.destroy(true);
    this.props.clear();
    this.plank = null;
    this.shadow = null;
    this.paper = null;
    this.back = null;
    this.rail = null;
    this.crown = null;
    this.wallpaper = null;
    this.wallShade = null;
  }

  private deliver(kind: EnvKind, texture: Texture): void {
    if (this.destroyed) {
      texture.destroy(true);
      return;
    }
    if (kind === 'plank') this.plank = texture;
    else if (kind === 'shadow') this.shadow = texture;
    else if (kind === 'paper') this.paper = texture;
    else if (kind === 'back') this.back = texture;
    else if (kind === 'rail') this.rail = texture;
    else if (kind === 'wallpaper') this.wallpaper = texture;
    else this.crown = texture;
    for (const cb of this.listeners) cb(kind);
  }
}
