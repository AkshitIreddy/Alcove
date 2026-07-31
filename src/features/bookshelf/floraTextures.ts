/**
 * features/bookshelf/floraTextures.ts — the GPU half of the flora pipeline.
 *
 * Kept apart from `floraPlan.ts` on purpose: planning is pure geometry that
 * unit tests exercise in a node environment, while this module touches Pixi
 * (and therefore `navigator`).
 *
 * ## Three tiers, cheapest first
 *
 * 1. **Disk** — a previous session already painted this exact layer, so the
 *    PNG comes back from `appCacheDir` and nothing is painted at all. This is
 *    the warm-start path and it costs a file read.
 * 2. **Worker** — a cold layer is painted in `artOffload`, off the main
 *    thread. A potted specimen measured 5.1s of solid brush work; on the main
 *    thread that is five seconds of frozen window, and there is no way to
 *    slice it finer because the atom is one plant.
 * 3. **Inline** — no worker available: `bakeFloraLayer` on this thread,
 *    behind the shared bake pump, exactly as before.
 *
 * Whichever tier answers, the bitmap is written back into `art/bake.ts`'s
 * caches so the next request for the same layer is free — including the disk
 * cache, which the worker cannot reach itself (`@tauri-apps/plugin-fs` needs
 * the window's Tauri internals).
 */

import { ImageSource, Texture } from 'pixi.js';
import {
  bakeFloraLayer,
  floraLayerCacheKey,
  type FloraPlacement,
  type Rect,
} from '../../art/flora';
import { adoptBake, peekBake } from '../../art/bake';
import { artOffload } from './artOffload';

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

function toTexture(bitmap: ImageBitmap, bounds: Rect): BakedFlora {
  return {
    texture: new Texture({
      source: new ImageSource({ resource: bitmap, autoGenerateMipmaps: true }),
    }),
    bounds,
  };
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

  const bakeKey = floraLayerCacheKey(placements);
  const offload = artOffload();

  // Tier 2: a cold layer goes to a worker — but only when nothing already
  // holds these pixels, or we would pay the paint twice.
  if (offload.available && !(await peekBake(bakeKey, dpr))) {
    const painted = await offload.flora({ placements: [...placements], dpr });
    if (painted !== null) {
      if (painted.bitmap === null || painted.bounds === null) return null;
      // Hand the pixels to art/bake.ts so the memory + disk caches see them
      // and the next boot never repaints this layer.
      adoptBake(bakeKey, dpr, painted.bitmap);
      const entry = toTexture(painted.bitmap, painted.bounds);
      textureCache.set(key, entry);
      return entry;
    }
  }

  // Tier 1 (disk hit) and tier 3 (no worker) share this call: bakeCached
  // resolves straight from cache when one is warm and paints inline when not.
  const baked = await bakeFloraLayer(placements, dpr, { granulate: false });
  if (baked === null) return null;
  const entry = toTexture(baked.bitmap, baked.bounds);
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
