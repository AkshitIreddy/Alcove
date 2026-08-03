/**
 * features/bookshelf/spineScale.ts — how many texels a baked spine gets.
 *
 * Split out of `spineFactory.ts` for the same reason `libraryKey.ts` was split
 * out of `textures.ts`: the factory imports pixi.js, pixi.js touches
 * `navigator` at module scope, and a node test therefore cannot load a single
 * number out of it. The arithmetic here decides whether the shelf looks sharp,
 * so it needs to be pinned by a test rather than by a comment.
 *
 * ## The unit, which is the whole bug
 *
 * A spine sprite is drawn at `world px × camera.zoom × renderer.resolution`.
 * The bake scales were plain world-px multipliers, so on any display where the
 * renderer runs above resolution 1 — a 150%-scaled Windows laptop, a retina
 * panel — every spine was asked for more texels than it had been given, and
 * the reader saw exactly that: *"the resolution of the books feel very low
 * when i look at them in the shelf."*
 *
 * Measured on the running shelf before the change, at dpr 2, in texels per
 * device pixel (below 1 = magnified = blurry):
 *
 * | zoom | bucket | before | after |
 * |------|--------|--------|-------|
 * | 0.50 | lo     |  0.62  | 1.24  |
 * | 0.80 | hi     |  1.25  | 2.50  |
 * | 1.60 | hi     |  0.63  | 1.25  |
 * | 2.50 | hi     |  0.40  | 0.80  |
 *
 * Max zoom stays the one soft spot on a 2× display, deliberately: covering
 * 2.5 × 2 exactly would need scale 5, which is 6.25× the bake area of the
 * shipped scale-2 for the top sliver of the zoom range.
 */

/** Bake buckets: `lo` serves LOD tier 1, `hi` serves tier 0 (titles baked in). */
export type SpineVariant = 'lo' | 'hi';

/** Lo-res bake: device px per world px. 232 world px → ~144 texels at dpr 1. */
export const LO_SCALE_BASE = 0.62;

/** Hi-res bake: device px per world px. Covers max zoom 2.5 at dpr 1. */
export const HI_SCALE_BASE = 2;

/**
 * The dpr the bakes are sized against.
 *
 * Mirrors `world.ts`, which inits the renderer at `min(devicePixelRatio, 2)`
 * — or 1 when a software renderer put the shelf in degrade mode. Read from the
 * environment rather than passed down so no caller can forget it and quietly
 * halve the resolution again; every consumer takes an override for tests.
 */
export function bakeDpr(degraded = false): number {
  if (degraded) return 1;
  const raw = typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1;
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(Math.max(raw, 1), 2);
}

/** Device-pixel bake scale for a bucket. */
export function spineBakeScale(variant: SpineVariant, dpr: number): number {
  return (variant === 'hi' ? HI_SCALE_BASE : LO_SCALE_BASE) * dpr;
}

/**
 * Texels per device pixel a bucket delivers at a zoom. Below 1 the sprite is
 * magnified — the texture has fewer pixels than the screen is showing.
 */
export function spineSampling(variant: SpineVariant, zoom: number, dpr: number): number {
  return spineBakeScale(variant, dpr) / Math.max(zoom * dpr, 1e-6);
}

/**
 * Gutter texels around each atlas rect.
 *
 * The pad keeps one spine's edge out of its neighbour's mip levels, and a mip
 * texel is 2^k page texels — so a gutter that was enough at bake scale 2 is
 * half a gutter at scale 4.
 */
export function spineGutter(dpr: number): number {
  return Math.max(2, Math.round(2 * dpr));
}

/**
 * LRU page cap for the hi bucket.
 *
 * A 2048² page holds ~32 hi spines at dpr 2 (measured, `atlas-budget.mjs`)
 * against ~90 at dpr 1, because the rects are 4× the area — so the cap that
 * bounded MEMORY at dpr 1 would bound the visible SET on a retina display, and
 * a shelf with more visible books than atlas evicts and re-bakes on every pan.
 * The measured worst case is 121 books on hi-res at once (a packed six-floor
 * case at the bottom of tier 0), which needs five pages. Pages are still only
 * allocated as they fill: a normal library sits at one or two.
 */
export function hiAtlasPages(dpr: number): number {
  return dpr >= 1.5 ? 5 : 4;
}
