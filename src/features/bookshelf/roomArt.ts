/**
 * features/bookshelf/roomArt.ts — the authored wall and wood.
 *
 * Companion to `spineAtlas.ts`, and the same correction applied to the two
 * surfaces the reader spends the most time looking at.
 *
 * The wall was a small procedurally-baked strip tiled across the viewport,
 * which is why panning showed pale horizontal banding — worst in the corners,
 * furthest from the case. The fix is not a better tile. It is a panel wide
 * enough that the repeat is never on screen: 1536px against a viewport that
 * is rarely wider, drawn at a scale where one copy covers the visible wall.
 *
 * The wood was a 512px material stretched across a whole bookcase, which is
 * most of what "the textures look low quality" was pointing at.
 *
 * Both are generated offline by `scripts/gen-room.mjs` and shipped by
 * `scripts/pack-room.py`. Nothing here paints.
 */

import { Assets, Texture } from 'pixi.js';

/** Surfaces shipped under `public/room/`. */
export type RoomSurface =
  | 'wall-plaster'
  | 'wood-oak-horizontal'
  | 'wood-oak-vertical'
  | 'wood-oak-dark';

const BASE = 'room';

class RoomArt {
  private readonly textures = new Map<RoomSurface, Texture>();
  private loading: Promise<boolean> | null = null;

  get ready(): boolean {
    return this.textures.size > 0;
  }

  /**
   * Load every surface. Idempotent; concurrent callers share one flight.
   *
   * Resolves `false` rather than throwing when the art is absent — a clone
   * that has not run the generation scripts, or the headless harness, falls
   * back to the procedural bake, which still works and merely looks worse.
   */
  load(): Promise<boolean> {
    if (this.loading !== null) return this.loading;
    this.loading = this.loadOnce().catch(() => false);
    return this.loading;
  }

  private async loadOnce(): Promise<boolean> {
    const res = await fetch(`${BASE}/manifest.json`);
    if (!res.ok) return false;
    const manifest = (await res.json()) as Record<string, { w: number; h: number }>;
    const names = Object.keys(manifest) as RoomSurface[];
    if (names.length === 0) return false;

    await Promise.all(
      names.map(async (name) => {
        try {
          this.textures.set(name, await Assets.load<Texture>(`${BASE}/${name}.webp`));
        } catch {
          // One missing surface must not cost us the others.
        }
      }),
    );
    return this.textures.size > 0;
  }

  get(name: RoomSurface): Texture | undefined {
    return this.textures.get(name);
  }

  destroy(): void {
    this.textures.clear();
    this.loading = null;
  }
}

/** Process-wide; one room serves every view. */
export const roomArt = new RoomArt();
