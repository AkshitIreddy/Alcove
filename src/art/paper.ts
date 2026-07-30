/**
 * art/paper.ts — L0 paper ground: the tiled lit-fibre background, plus the
 * library-wallpaper pattern tile layered over it.
 *
 * One 512×512 world-px tile per DPR bucket, baked once through the #paper
 * filter (art/filters.ts) and tinted with a source-atop fill. Persisted via
 * the bake.ts disk cache, so cold start never pays the filter cost twice.
 * The wallpaper tile is pure Canvas2D (no filters): a very low-contrast
 * penciled damask lattice with starburst medallions, tiled with parallax
 * behind the case so the wall reads as a warm library rather than blank paper.
 */

import { bakeCached, rasterizeSvg } from './bake';
import { paperFilter, svgDoc } from './filters';
import { mulberry32 } from './noise';
import { doubleStroke } from './wobble';

/** Tile edge in world px (512×512 per the design doc). */
export const PAPER_TILE_SIZE = 512;

export type PaperTint = 'cream' | 'aged';

/** Tint fills from the doc: cream #f7f1e3, aged #efe4cc. */
export const PAPER_TINTS: Record<PaperTint, string> = {
  cream: '#f7f1e3',
  aged: '#efe4cc',
};

/** source-atop tint strength — keeps the lit-fibre relief visible. */
const TINT_ALPHA = 0.4;

/**
 * Bake (or fetch from cache) the paper ground tile for a DPR bucket.
 * The returned ImageBitmap is shared — do not close() it.
 */
export function bakePaperTile(dpr: number, tint: PaperTint): Promise<ImageBitmap> {
  return bakeCached(`paper|${tint}|${PAPER_TILE_SIZE}`, dpr, async () => {
    // Flood rect pushed through #paper; feDiffuseLighting replaces the fill,
    // so the rect color only defines the filter region.
    const inner = `<rect width="${PAPER_TILE_SIZE}" height="${PAPER_TILE_SIZE}" fill="${PAPER_TINTS[tint]}" filter="url(#paper)"/>`;
    const svg = svgDoc(PAPER_TILE_SIZE, PAPER_TILE_SIZE, inner, paperFilter(dpr));
    const canvas = await rasterizeSvg(svg, PAPER_TILE_SIZE, PAPER_TILE_SIZE, dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('paper: 2d context unavailable');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = TINT_ALPHA;
    ctx.fillStyle = PAPER_TINTS[tint];
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    return canvas;
  });
}

/* ------------------------------- wallpaper -------------------------------- */

/** Wallpaper pattern tile edge in world px (one damask cell = half a tile). */
export const WALLPAPER_TILE_SIZE = 256;

/** Sepia pencil inks for the wallpaper — kept faint on purpose. */
const WALLPAPER_INK = 'rgba(140, 110, 72, 0.16)';
const WALLPAPER_INK_SOFT = 'rgba(150, 122, 86, 0.10)';
const WALLPAPER_GOLD = 'rgba(196, 158, 82, 0.12)';

/**
 * Bake (or fetch from cache) the library-wallpaper pattern tile: a diamond
 * lattice with a small starburst medallion in each cell and quatrefoil dots
 * at the lattice crossings — all wobbled pencil strokes at whisper contrast.
 * The tile is transparent; it composites over the paper ground.
 */
export function bakeWallpaperTile(dpr: number): Promise<ImageBitmap> {
  return bakeCached(`wallpaper|damask|${WALLPAPER_TILE_SIZE}`, dpr, async () => {
    const s = WALLPAPER_TILE_SIZE;
    const dev = Math.ceil(s * dpr);
    const canvas = new OffscreenCanvas(dev, dev);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('paper: 2d context unavailable');
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const rnd = mulberry32(0xda3a5c);
    const stroke = (d: string, seedOffset: number): void => {
      const [a, b] = doubleStroke(d, {
        seed: (0x3a17 + seedOffset) >>> 0,
        amplitude: 0.7,
        frequency: 0.03,
      });
      ctx.stroke(new Path2D(a));
      ctx.stroke(new Path2D(b));
    };

    const half = s / 2;
    // Diamond lattice: two cells per tile so edges wrap seamlessly. Draw each
    // lattice line across the full tile (plus overshoot) at fixed offsets.
    ctx.strokeStyle = WALLPAPER_INK_SOFT;
    ctx.lineWidth = 1;
    let n = 0;
    for (const off of [-s, -half, 0, half, s]) {
      stroke(`M ${-8} ${off - 8} L ${s + 8} ${off + s + 8}`, n++);
      stroke(`M ${-8} ${off + s + 8} L ${s + 8} ${off - 8}`, n++);
    }

    // Starburst medallion at each cell center (2×2 per tile, wrap-aligned).
    const burst = (cx: number, cy: number, seedOffset: number): void => {
      const r = 17 + rnd() * 3;
      ctx.strokeStyle = WALLPAPER_INK;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.12;
        const r0 = i % 2 === 0 ? r : r * 0.55;
        stroke(
          `M ${cx + Math.cos(a) * 4} ${cy + Math.sin(a) * 4} L ${cx + Math.cos(a) * r0} ${cy + Math.sin(a) * r0}`,
          seedOffset + i,
        );
      }
      // Gold pin at the heart of the burst.
      ctx.fillStyle = WALLPAPER_GOLD;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
      ctx.fill();
    };
    burst(half / 2, half / 2, 100);
    burst(half + half / 2, half / 2, 120);
    burst(half / 2, half + half / 2, 140);
    burst(half + half / 2, half + half / 2, 160);

    // Quatrefoil dots at the lattice crossings (tile corners + center).
    ctx.fillStyle = WALLPAPER_INK;
    const dots: Array<[number, number]> = [
      [0, 0], [s, 0], [0, s], [s, s], [half, half],
      [half, 0], [0, half], [s, half], [half, s],
    ];
    for (const [cx, cy] of dots) {
      for (const [ox, oy] of [[-3.4, 0], [3.4, 0], [0, -3.4], [0, 3.4]] as const) {
        ctx.beginPath();
        ctx.arc(cx + ox, cy + oy, 1.15, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return canvas;
  });
}
