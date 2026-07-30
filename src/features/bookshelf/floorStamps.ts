/**
 * features/bookshelf/floorStamps.ts — LOD2 floor render-texture cache.
 *
 * At far zoom each floor is drawn as ONE cached RenderTexture stamp (baked at
 * 256px width), so thousands of visible floors cost ~1 sprite each. LRU cap
 * 60 floors (≈15MB at 256×68 RGBA + mips).
 */

import { Matrix, RenderTexture, type Container, type Renderer } from 'pixi.js';
import { FLOOR_H, SHELF_WIDTH } from './constants';

/** Stamp width in device px per the design doc. */
export const STAMP_WIDTH = 256;

/** LRU cap on cached floor stamps. */
export const STAMP_CAP = 60;

export const STAMP_SCALE = STAMP_WIDTH / SHELF_WIDTH;
export const STAMP_HEIGHT = Math.ceil(FLOOR_H * STAMP_SCALE);

interface StampEntry {
  rt: RenderTexture;
  tick: number;
}

export class FloorStampCache {
  private readonly entries = new Map<number, StampEntry>();
  private tick = 0;

  /**
   * @param isPinned floors currently mounted/visible are never evicted (a
   * destroyed RenderTexture on a live sprite would crash the renderer); when
   * every entry is pinned the cache temporarily grows past the cap instead.
   */
  constructor(private readonly isPinned: (floor: number) => boolean = () => false) {}

  /** Cached stamp for a floor (touches LRU), or undefined. */
  get(floor: number): RenderTexture | undefined {
    const entry = this.entries.get(floor);
    if (entry === undefined) return undefined;
    entry.tick = ++this.tick;
    return entry.rt;
  }

  /**
   * Bake (or re-bake) a floor's stamp from its floor-local content container.
   * The container must be laid out in floor-local coords (0..SHELF_WIDTH ×
   * 0..FLOOR_H); its own world position is ignored via the render transform.
   */
  bake(renderer: Renderer, floor: number, content: Container): RenderTexture {
    let entry = this.entries.get(floor);
    if (entry === undefined) {
      this.evictIfNeeded();
      entry = {
        rt: RenderTexture.create({ width: STAMP_WIDTH, height: STAMP_HEIGHT }),
        tick: 0,
      };
      this.entries.set(floor, entry);
    }
    entry.tick = ++this.tick;
    const wasVisible = content.visible;
    const wasAlpha = content.alpha;
    content.visible = true;
    content.alpha = 1;
    // Vertical scale fills the WHOLE texel height: STAMP_HEIGHT is the
    // rounded-up FLOOR_H*STAMP_SCALE, and leaving the fractional last row
    // transparent paints a bright wall-colored seam between floor stamps at
    // far zoom. The ~1% aspect stretch is imperceptible at stamp size.
    renderer.render({
      container: content,
      target: entry.rt,
      transform: new Matrix(STAMP_SCALE, 0, 0, STAMP_HEIGHT / FLOOR_H, 0, 0),
      clear: true,
    });
    content.visible = wasVisible;
    content.alpha = wasAlpha;
    return entry.rt;
  }

  /** Drop a floor's stamp (contents changed — lo-res textures arrived). */
  invalidate(floor: number): void {
    const entry = this.entries.get(floor);
    if (entry === undefined) return;
    this.entries.delete(floor);
    entry.rt.destroy(true);
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.rt.destroy(true);
    this.entries.clear();
  }

  private evictIfNeeded(): void {
    if (this.entries.size < STAMP_CAP) return;
    let lruFloor = -1;
    let lruTick = Number.POSITIVE_INFINITY;
    for (const [floor, entry] of this.entries) {
      if (this.isPinned(floor)) continue;
      if (entry.tick < lruTick) {
        lruTick = entry.tick;
        lruFloor = floor;
      }
    }
    if (lruFloor >= 0) this.invalidate(lruFloor);
  }
}
