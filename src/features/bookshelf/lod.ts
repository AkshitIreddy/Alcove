/**
 * features/bookshelf/lod.ts — semantic-zoom tier logic (pure).
 *
 * Tier 0 (zoom ≥ 0.7): full hi-res spines, hover enabled.
 * Tier 1 (0.22 ≤ zoom < 0.7): lo-res spine textures, hover off.
 * Tier 2 (zoom < 0.22): whole floors swap to cached render-texture stamps.
 *
 * Switches use ±0.03 hysteresis so the tier never flickers while the zoom
 * hovers near a threshold. Render-texture baking lives in floorStamps.ts
 * (this module stays Pixi-free so it can be tested in node).
 */

export type LodTier = 0 | 1 | 2;

/** Tier 0/1 boundary. */
export const LOD_T01 = 0.7;

/** Tier 1/2 boundary. */
export const LOD_T12 = 0.22;

/** Hysteresis band half-width around each boundary. */
export const LOD_HYSTERESIS = 0.03;

/** Crossfade duration between tier representations, ms. */
export const LOD_CROSSFADE_MS = 120;

/** Hysteresis-free tier for a zoom level (initial mount only). */
export function lodTierFor(zoom: number): LodTier {
  if (zoom >= LOD_T01) return 0;
  if (zoom >= LOD_T12) return 1;
  return 2;
}

/**
 * Hysteresis step: from `current`, move toward the tier that matches `zoom`,
 * but only after crossing a boundary by the hysteresis margin. Multi-step
 * jumps (2 → 0 on a fast zoom-in) resolve in one call.
 */
export function nextLodTier(current: LodTier, zoom: number): LodTier {
  let tier: LodTier = current;
  for (;;) {
    let next: LodTier = tier;
    if (tier === 0) {
      if (zoom < LOD_T01 - LOD_HYSTERESIS) next = 1;
    } else if (tier === 1) {
      if (zoom >= LOD_T01 + LOD_HYSTERESIS) next = 0;
      else if (zoom < LOD_T12 - LOD_HYSTERESIS) next = 2;
    } else {
      if (zoom >= LOD_T12 + LOD_HYSTERESIS) next = 1;
    }
    if (next === tier) return tier;
    tier = next;
  }
}
