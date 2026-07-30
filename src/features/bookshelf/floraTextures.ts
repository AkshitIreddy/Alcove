/**
 * features/bookshelf/floraTextures.ts — the GPU half of the flora pipeline.
 *
 * Kept apart from `floraPlan.ts` on purpose: planning is pure geometry that
 * unit tests exercise in a node environment, while this module touches Pixi
 * (and therefore `navigator`). Baking goes through art/bake.ts, so a floor's
 * plants are rasterized once ever per recipe and read back from disk after.
 */

import { ImageSource, Texture } from 'pixi.js';
import { bakeFloraLayer, type FloraPlacement, type Rect } from '../../art/flora';

export interface BakedFlora {
  texture: Texture;
  bounds: Rect;
}

const textureCache = new Map<string, BakedFlora>();

function placementsKey(placements: readonly FloraPlacement[], dpr: number): string {
  return `${dpr}|${placements
    .map(
      (p) =>
        `${p.id}:${p.species}:${p.scale.toFixed(3)}:${p.flip ? 1 : 0}:${p.facing}:` +
        `${Math.round(p.anchor.x)},${Math.round(p.anchor.y)}`,
    )
    .join('|')}`;
}

/**
 * Bake one layer's placements into a Pixi texture (memory-cached here, disk
 * cached inside art/bake.ts). Returns null when nothing grows.
 */
export async function bakeFloraTexture(
  placements: readonly FloraPlacement[],
  dpr: number,
): Promise<BakedFlora | null> {
  if (placements.length === 0) return null;
  const key = placementsKey(placements, dpr);
  const hit = textureCache.get(key);
  if (hit !== undefined) return hit;
  const baked = await bakeFloraLayer(placements, dpr, { granulate: false });
  if (baked === null) return null;
  const entry: BakedFlora = {
    texture: new Texture({
      source: new ImageSource({ resource: baked.bitmap, autoGenerateMipmaps: true }),
    }),
    bounds: baked.bounds,
  };
  textureCache.set(key, entry);
  return entry;
}

/** Drop cached flora textures (theme switch / teardown). */
export function clearFloraTextures(): void {
  for (const entry of textureCache.values()) {
    if (!entry.texture.destroyed) entry.texture.destroy(true);
  }
  textureCache.clear();
}
