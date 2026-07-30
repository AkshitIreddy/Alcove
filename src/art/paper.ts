/**
 * art/paper.ts — L0 paper ground: the tiled lit-fibre background.
 *
 * One 512×512 world-px tile per DPR bucket, baked once through the #paper
 * filter (art/filters.ts) and tinted with a source-atop fill. Persisted via
 * the bake.ts disk cache, so cold start never pays the filter cost twice.
 */

import { bakeCached, rasterizeSvg } from './bake';
import { paperFilter, svgDoc } from './filters';

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
