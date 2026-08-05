/**
 * tests/spine-resolution.test.ts — the spine bake is sized in DEVICE pixels.
 *
 * The reader reported *"the resolution of the books feel very low when i look
 * at them in the shelf"*, and the measurement on the running app (see
 * `shots-now/measure-spines.mjs`) said why: a sprite is drawn at
 * `world px × zoom × renderer.resolution`, the bake scales were world-px
 * constants, so a 2× display asked for exactly twice the texels the bake had.
 *
 * These pin the arithmetic, because the failure is silent — nothing throws,
 * nothing warns, the shelf is just soft.
 */
import { describe, expect, it } from 'vitest';

import { AtlasManager, type AtlasCanvas } from '../src/art/atlas';
import {
  bakeDpr,
  HI_SCALE_BASE,
  hiAtlasPages,
  LO_SCALE_BASE,
  spineBakeScale,
  spineGutter,
  spineSampling,
} from '../src/features/bookshelf/spineScale';

const stubCanvas = (size: number): AtlasCanvas =>
  ({ width: size, height: size }) as unknown as AtlasCanvas;

describe('spine bake scale', () => {
  it('clamps the bake dpr the way the renderer clamps its resolution', () => {
    const raw = globalThis.devicePixelRatio;
    try {
      for (const [dpr, want] of [
        [1, 1],
        [1.25, 1.25],
        [1.5, 1.5],
        [2, 2],
        [3, 2],
        [0.5, 1],
        [Number.NaN, 1],
      ] as const) {
        Object.defineProperty(globalThis, 'devicePixelRatio', {
          value: dpr,
          configurable: true,
        });
        expect(bakeDpr()).toBeCloseTo(want, 6);
      }
      // Degrade mode runs the renderer at resolution 1; the bake follows.
      Object.defineProperty(globalThis, 'devicePixelRatio', { value: 2, configurable: true });
      expect(bakeDpr(true)).toBe(1);
    } finally {
      Object.defineProperty(globalThis, 'devicePixelRatio', {
        value: raw,
        configurable: true,
      });
    }
  });

  it('leaves a dpr-1 machine exactly where it was', () => {
    expect(spineBakeScale('lo', 1)).toBeCloseTo(0.62, 6);
    expect(spineBakeScale('hi', 1)).toBe(2);
    expect(spineGutter(1)).toBe(2);
    expect(hiAtlasPages(1)).toBe(4);
    // ...and lets a HiDPI one pay for its extra pixels.
    expect(spineBakeScale('hi', 2)).toBe(4);
    expect(spineGutter(2)).toBe(4);
    expect(hiAtlasPages(2)).toBe(5);
  });

  it('keeps every zoom a reader uses at or above 1 texel per device pixel', () => {
    // Tier 0 opens at 0.7 (lod.ts) and the shelf rests at 0.8; tier 1 runs
    // 0.22-0.7. Max zoom is 2.5 (camera.ts) and is allowed to be the one soft
    // spot — sharpening it means HI_SCALE_BASE 2.5, which is 1.56× the bake
    // area. (This comment used to say 6×, from an HI_SCALE_BASE of 5; that
    // double-counted the dpr `spineBakeScale` already applies. See the header
    // in spineScale.ts — the cost is real but it is not that.)
    for (const dpr of [1, 1.5, 2]) {
      expect(spineSampling('hi', 0.8, dpr)).toBeGreaterThanOrEqual(1);
      expect(spineSampling('hi', 1.6, dpr)).toBeGreaterThanOrEqual(1);
      expect(spineSampling('hi', 2.5, dpr)).toBeGreaterThanOrEqual(0.79);
      // Tier 1's own band, where the lo bucket is all there is.
      expect(spineSampling('lo', 0.5, dpr)).toBeGreaterThanOrEqual(1.2);
    }
  });

  it('is the same multiple of the drawn size on every display', () => {
    // The point of the change: the ratio no longer depends on the display.
    expect(spineSampling('hi', 1.2, 2)).toBeCloseTo(spineSampling('hi', 1.2, 1), 6);
    expect(spineSampling('hi', 1.2, 1.5)).toBeCloseTo(spineSampling('hi', 1.2, 1), 6);
    expect(spineSampling('lo', 0.4, 2)).toBeCloseTo(spineSampling('lo', 0.4, 1), 6);
  });

  it('never lets the bases drift apart from the dpr-1 history', () => {
    expect(LO_SCALE_BASE).toBeCloseTo(0.62, 6);
    expect(HI_SCALE_BASE).toBe(2);
  });

  it('samples independently of dpr, which is what sets the cost of max zoom', () => {
    // The arithmetic the header now spells out, pinned so nobody has to redo
    // it: sampling is HI_SCALE_BASE / zoom, with the dpr cancelling. This is
    // why softness at max zoom is not a retina problem, and why covering zoom
    // 2.5 needs HI_SCALE_BASE 2.5 (1.56× the area) rather than 5 (6.25×) —
    // which is the whole of the "2.5 makes max zoom exactly crisp" claim, and
    // it is the loop below that carries it. A line reading
    // `expect(2.5 / 2.5).toBe(1)` used to sit under this comment pretending to
    // be that claim; it asserted a division of two literals against a third,
    // named nothing out of `spineScale.ts`, and would have gone on passing
    // with HI_SCALE_BASE at any value on earth. Deleted rather than fixed,
    // because the loop already says it against the real constants.
    for (const dpr of [1, 1.25, 1.5, 2]) {
      for (const zoom of [0.8, 1.6, 2.5]) {
        expect(spineSampling('hi', zoom, dpr)).toBeCloseTo(HI_SCALE_BASE / zoom, 6);
        expect(spineSampling('lo', zoom, dpr)).toBeCloseTo(LO_SCALE_BASE / zoom, 6);
      }
    }
  });
});

describe('atlas packing under a bigger bake', () => {
  it('hands back the padded region so a bake can clear its own gutter', () => {
    const atlas = new AtlasManager({ pageSize: 128, padding: 4, createCanvas: stubCanvas });
    const h = atlas.alloc('a', 20, 30);
    expect(h.rect).toEqual({ x: 4, y: 4, w: 20, h: 30 });
    expect(h.padded).toEqual({ x: 0, y: 0, w: 28, h: 38 });
    // The gutter is on every side of the drawable rect.
    expect(h.rect.x - h.padded.x).toBe(4);
    expect(h.padded.x + h.padded.w - (h.rect.x + h.rect.w)).toBe(4);
    expect(h.padded.y + h.padded.h - (h.rect.y + h.rect.h)).toBe(4);
  });

  it('never leaves a taller shelf ahead of a shorter one that also fits', () => {
    // Why first-fit is already best-fit here: a shelf's height is its opener's
    // height, so a later shelf that accepts the same rect is always taller.
    // If this ever stops holding, `placeInPage` needs a real best-fit scan.
    const atlas = new AtlasManager({ pageSize: 4000, padding: 0, createCanvas: stubCanvas });
    /** Shelf y → height, read back off the rects that opened each row. */
    const shelves = new Map<number, number>();
    const note = (rect: { x: number; y: number; h: number }): void => {
      if (rect.x === 0) shelves.set(rect.y, rect.h);
    };
    for (const [i, h] of [90, 100, 74, 260, 200, 150, 300, 96, 220, 180].entries()) {
      note(atlas.alloc(`open-${i}`, 40, h).rect);
    }
    for (const probe of [60, 74, 80, 96, 150, 200, 210, 260]) {
      const fits = [...shelves]
        .filter(([, h]) => probe <= h && probe * 1.35 >= h)
        .sort((a, b) => a[1] - b[1]);
      const placed = atlas.alloc(`probe-${probe}`, 40, probe).rect;
      note(placed);
      if (fits.length > 0) expect(placed.y).toBe(fits[0]?.[0]);
    }
  });

  it('reports how full each page is, in texels including gutters', () => {
    const atlas = new AtlasManager({ pageSize: 100, padding: 0, createCanvas: stubCanvas });
    atlas.alloc('a', 50, 50);
    atlas.alloc('b', 50, 50);
    const [page] = atlas.usage();
    expect(page?.rects).toBe(2);
    expect(page?.used).toBe(5000);
    expect(page?.capacity).toBe(10000);
    expect(page?.fill).toBeCloseTo(0.5, 6);
  });
});
