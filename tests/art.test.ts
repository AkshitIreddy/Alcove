// @vitest-environment node
/**
 * tests/art.test.ts — determinism and atlas packing sanity for the art
 * foundation library (src/art).
 *
 * These tests run in plain Node — nothing here touches canvas, DOM, or Tauri.
 * (The explicit node pragma opts out of vite-plugin-solid's jsdom default,
 * which is not installed.)
 */

import { describe, expect, it } from 'vitest';

import { clamp, fnv1a, lerp, mulberry32, seededNoise1D, seededNoise2D } from '../src/art/noise';
import { doubleStroke, wobbleLine, wobblePath, wobbleRect } from '../src/art/wobble';
import {
  BINDING_MATERIALS,
  MAX_RAISED_BANDS,
  PIGMENT_COUNT,
  SPINE_HEIGHT_RANGE,
  SPINE_THICKNESS_RANGE,
  deriveSpineParams,
  getSpineParams,
  getSpinePalette,
} from '../src/art/spines';
import { AtlasManager, type AtlasCanvas, type AtlasRect } from '../src/art/atlas';

/* ------------------------------- noise ----------------------------------- */

describe('noise primitives', () => {
  it('mulberry32 is deterministic per seed and in [0, 1)', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    const seqA = Array.from({ length: 16 }, () => a());
    const seqB = Array.from({ length: 16 }, () => b());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    const c = mulberry32(1235);
    expect(Array.from({ length: 16 }, () => c())).not.toEqual(seqA);
  });

  it('fnv1a matches known 32-bit FNV-1a vectors', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
    expect(fnv1a('book-42')).toBe(fnv1a('book-42'));
    expect(fnv1a('book-42')).not.toBe(fnv1a('book-43'));
  });

  it('seeded simplex wrappers are deterministic and bounded', () => {
    const n1a = seededNoise1D(7);
    const n1b = seededNoise1D(7);
    const n2a = seededNoise2D(7);
    const n2b = seededNoise2D(7);
    for (let i = 0; i < 32; i++) {
      const x = i * 0.37;
      expect(n1a(x)).toBe(n1b(x));
      expect(n2a(x, x * 0.5)).toBe(n2b(x, x * 0.5));
      expect(Math.abs(n1a(x))).toBeLessThanOrEqual(1);
    }
    expect(seededNoise1D(8)(1.5)).not.toBe(n1a(1.5));
  });

  it('helpers behave', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(-1, 0, 10)).toBe(0);
  });
});

/* ------------------------------ spine params ------------------------------ */

describe('deriveSpineParams', () => {
  it('same seed ⇒ structurally identical params', () => {
    const a = deriveSpineParams(0xbeef);
    const b = deriveSpineParams(0xbeef);
    expect(a).toEqual(b);
  });

  it('different seeds ⇒ different params', () => {
    const a = deriveSpineParams(1);
    const b = deriveSpineParams(2);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('respects the documented ranges over many seeds', () => {
    for (let seed = 0; seed < 500; seed++) {
      const p = deriveSpineParams(seed);
      expect(p.silhouette).toBeGreaterThanOrEqual(0);
      expect(p.silhouette).toBeLessThanOrEqual(6);
      expect(p.palette).toBeGreaterThanOrEqual(0);
      expect(p.palette).toBeLessThanOrEqual(PIGMENT_COUNT - 1);
      expect(Math.abs(p.hueJitter)).toBeLessThanOrEqual(6);
      expect(p.bands.length).toBeLessThanOrEqual(3);
      for (const band of p.bands) {
        expect(band.y).toBeGreaterThan(0);
        expect(band.y).toBeLessThan(1);
        expect([0, 1, 2]).toContain(band.kind);
      }
      expect(p.ornament).toBeGreaterThanOrEqual(0);
      expect(p.ornament).toBeLessThanOrEqual(11);
      expect([0, 1, 2]).toContain(p.texture);
      expect([0, 1, 2]).toContain(p.font);
      expect(typeof p.gilt).toBe('boolean');
      expect(Math.abs(p.lean)).toBeLessThanOrEqual(1.2);
      // Painterly rebuild: thickness is a multi-modal draw over the full
      // legal spine range (pamphlet slivers → tomes), not the old 28–46 band.
      expect(p.w).toBeGreaterThanOrEqual(SPINE_THICKNESS_RANGE.min);
      expect(p.w).toBeLessThanOrEqual(SPINE_THICKNESS_RANGE.max);
      expect(Math.abs(p.hJitter)).toBeLessThanOrEqual(6);
      expect(typeof p.twoTone).toBe('boolean');
      expect(p.twoToneSplit).toBeGreaterThanOrEqual(0.26);
      expect(p.twoToneSplit).toBeLessThanOrEqual(0.48);
      expect(typeof p.headTail).toBe('boolean');
    }
  });

  it('spans slivers to tomes and pocket to folio across seeds', () => {
    // The rebuild's reason to exist: a shelf mixes thickness classes and
    // bibliographic formats rather than stamping one rectangle. 500 seeds
    // must reach BOTH tails of both distributions, every binding material,
    // and keep the painterly fields inside their documented bands.
    let minW = Infinity;
    let maxW = -Infinity;
    let minH = Infinity;
    let maxH = -Infinity;
    const materials = new Set<string>();
    const palettes = new Set<number>();
    for (let seed = 0; seed < 500; seed++) {
      const p = deriveSpineParams(seed);
      minW = Math.min(minW, p.w);
      maxW = Math.max(maxW, p.w);
      minH = Math.min(minH, p.height);
      maxH = Math.max(maxH, p.height);
      materials.add(p.material);
      palettes.add(p.palette);
      expect(p.palette).toBeGreaterThanOrEqual(0);
      expect(p.palette).toBeLessThanOrEqual(PIGMENT_COUNT - 1);
      expect(p.height).toBeGreaterThanOrEqual(SPINE_HEIGHT_RANGE.min);
      expect(p.height).toBeLessThanOrEqual(SPINE_HEIGHT_RANGE.max);
      expect(p.raisedBands).toBeGreaterThanOrEqual(0);
      expect(p.raisedBands).toBeLessThanOrEqual(MAX_RAISED_BANDS);
      expect(p.pageBlock).toBeGreaterThanOrEqual(0.06);
      expect(p.pageBlock).toBeLessThanOrEqual(0.28);
      expect(Math.abs(p.proud)).toBeLessThanOrEqual(10);
    }
    expect(minW).toBeLessThanOrEqual(14); // pamphlet slivers appear
    expect(maxW).toBeGreaterThanOrEqual(46); // tomes appear
    expect(minH).toBeLessThanOrEqual(155); // pocket books appear
    expect(maxH).toBeGreaterThanOrEqual(266); // folios appear
    for (const m of BINDING_MATERIALS) expect(materials).toContain(m);
    // The deep range (12–19) is reachable from the raw seed, not only via
    // theme ramps — that is where the reference's rich darks come from.
    expect(Math.max(...palettes)).toBeGreaterThanOrEqual(12);
  });

  it('uses all 12 ornament stamps across many seeds', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 2000; seed++) seen.add(deriveSpineParams(seed).ornament);
    expect(seen.size).toBe(12);
  });

  it('getSpineParams is the public alias used by cover modules', () => {
    expect(getSpineParams(0xfeed)).toEqual(deriveSpineParams(0xfeed));
  });

  it('getSpinePalette exposes deterministic CSS colors for a book', () => {
    const params = deriveSpineParams(0xabcd);
    const a = getSpinePalette(params);
    const b = getSpinePalette(params);
    expect(a).toEqual(b);
    for (const v of [a.top, a.bottom, a.ink, a.accent]) {
      expect(v).toMatch(/^(hsl\(|#)/);
    }
    expect(a.gold).toMatch(/^#/);
    // Gilt books get the gold accent.
    const gilt = { ...params, gilt: true };
    expect(getSpinePalette(gilt).accent).toBe(getSpinePalette(gilt).gold);
    // The palette differs across palette indices.
    const other = deriveSpineParams(0xabcd);
    other.palette = (other.palette + 1) % 12;
    expect(getSpinePalette(other).top).not.toBe(a.top);
  });
});

/* -------------------------------- wobble ---------------------------------- */

describe('wobblePath', () => {
  const d = 'M 0 0 L 120 0 L 120 40';

  it('same options ⇒ byte-identical output', () => {
    const a = wobblePath(d, { seed: 5, amplitude: 1.2, frequency: 0.02, samplesEveryPx: 4 });
    const b = wobblePath(d, { seed: 5, amplitude: 1.2, frequency: 0.02, samplesEveryPx: 4 });
    expect(a).toBe(b);
    expect(a.startsWith('M ')).toBe(true);
    expect(a).toContain(' C ');
  });

  it('different seeds ⇒ different geometry', () => {
    const a = wobblePath(d, { seed: 5 });
    const b = wobblePath(d, { seed: 6 });
    expect(a).not.toBe(b);
  });

  it('doubleStroke returns two distinct deterministic passes', () => {
    const [p1, p2] = doubleStroke(d, { seed: 9 });
    const [q1, q2] = doubleStroke(d, { seed: 9 });
    expect(p1).toBe(q1);
    expect(p2).toBe(q2);
    expect(p1).not.toBe(p2);
  });

  it('wobbleRect closes the path, wobbleLine does not', () => {
    const rect = wobbleRect(0, 0, 60, 30, { seed: 3 });
    expect(rect.trim().endsWith('Z')).toBe(true);
    const line = wobbleLine(0, 0, 80, 0, { seed: 3 });
    expect(line.trim().endsWith('Z')).toBe(false);
    expect(wobbleLine(0, 0, 80, 0, { seed: 3 })).toBe(line);
  });

  it('wobble stays within amplitude bounds of the source line', () => {
    const amplitude = 1.5;
    const out = wobblePath('M 0 0 L 200 0', { seed: 11, amplitude });
    // Every y coordinate in the output must be within the noise amplitude
    // (plus a little slack for bezier control points).
    const nums = out
      .replace(/[MCZ,]/gi, ' ')
      .trim()
      .split(/\s+/)
      .map(Number);
    for (let i = 1; i < nums.length; i += 2) {
      expect(Math.abs(nums[i] as number)).toBeLessThanOrEqual(amplitude * 1.5);
    }
  });
});

/*
 * The SVG filter recipes (pencil / watercolour / paper) and their
 * resolution-scaling maths were tested here. `art/filters.ts` existed only to
 * feed `art/paper.ts` through a bake, and both went with the painting stack —
 * the flat style has no filters at all.
 */

/* --------------------------------- atlas ---------------------------------- */

const stubCanvas = (size: number): AtlasCanvas =>
  ({ width: size, height: size }) as unknown as AtlasCanvas;

function overlaps(a: AtlasRect, b: AtlasRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('AtlasManager', () => {
  it('packs rects in shelf order without overlap, within page bounds', () => {
    const atlas = new AtlasManager({ pageSize: 100, padding: 0, maxPages: 4, createCanvas: stubCanvas });
    const handles = [];
    for (let i = 0; i < 6; i++) handles.push(atlas.alloc(`spine-${i}`, 30, 40));

    // First shelf holds three 30-wide rects; the fourth opens a new shelf.
    expect(handles[0]?.rect).toEqual({ x: 0, y: 0, w: 30, h: 40 });
    expect(handles[1]?.rect).toEqual({ x: 30, y: 0, w: 30, h: 40 });
    expect(handles[2]?.rect).toEqual({ x: 60, y: 0, w: 30, h: 40 });
    expect(handles[3]?.rect).toEqual({ x: 0, y: 40, w: 30, h: 40 });

    for (const h of handles) {
      expect(h.rect.x).toBeGreaterThanOrEqual(0);
      expect(h.rect.y).toBeGreaterThanOrEqual(0);
      expect(h.rect.x + h.rect.w).toBeLessThanOrEqual(100);
      expect(h.rect.y + h.rect.h).toBeLessThanOrEqual(100);
    }
    for (let i = 0; i < handles.length; i++) {
      for (let k = i + 1; k < handles.length; k++) {
        const a = handles[i];
        const b = handles[k];
        if (a && b && a.page.id === b.page.id) {
          expect(overlaps(a.rect, b.rect)).toBe(false);
        }
      }
    }
  });

  it('re-alloc of the same key/size returns the same handle', () => {
    const atlas = new AtlasManager({ pageSize: 100, padding: 0, createCanvas: stubCanvas });
    const a = atlas.alloc('k', 20, 20);
    const b = atlas.alloc('k', 20, 20);
    expect(b).toBe(a);
    expect(atlas.get('k')).toBe(a);
    expect(atlas.pageCount).toBe(1);
  });

  it('opens a new page when the current one is full', () => {
    const atlas = new AtlasManager({ pageSize: 100, padding: 0, maxPages: 4, createCanvas: stubCanvas });
    atlas.alloc('a', 100, 100);
    const b = atlas.alloc('b', 100, 100);
    expect(atlas.pageCount).toBe(2);
    expect(b.page.id).not.toBe(atlas.get('a')?.page.id);
  });

  it('evicts the least-recently-used page at the cap and fires onEvict', () => {
    const evicted: { pageId: number; keys: readonly string[] }[] = [];
    const atlas = new AtlasManager({
      pageSize: 100,
      padding: 0,
      maxPages: 2,
      createCanvas: stubCanvas,
      onEvict: (page, keys) => evicted.push({ pageId: page.id, keys }),
    });
    const a = atlas.alloc('a', 100, 100); // page 0
    atlas.alloc('b', 100, 100); // page 1
    atlas.get('a'); // touch page 0 — page 1 is now LRU
    atlas.alloc('c', 100, 100); // must evict page 1 (with 'b')

    expect(evicted).toHaveLength(1);
    expect(evicted[0]?.keys).toEqual(['b']);
    expect(atlas.get('b')).toBeUndefined();
    expect(atlas.get('a')).toBe(a);
    expect(atlas.get('c')).toBeDefined();
    expect(atlas.pageCount).toBe(2);
  });

  it('applies padding as a gutter around the drawable rect', () => {
    const atlas = new AtlasManager({ pageSize: 64, padding: 2, createCanvas: stubCanvas });
    const h1 = atlas.alloc('p1', 20, 20);
    const h2 = atlas.alloc('p2', 20, 20);
    expect(h1.rect).toEqual({ x: 2, y: 2, w: 20, h: 20 });
    expect(h2.rect).toEqual({ x: 26, y: 2, w: 20, h: 20 });
    // Gutter: at least 2px apart on every side.
    expect(h2.rect.x - (h1.rect.x + h1.rect.w)).toBeGreaterThanOrEqual(2);
  });

  it('rejects rects larger than a page', () => {
    const atlas = new AtlasManager({ pageSize: 64, padding: 0, createCanvas: stubCanvas });
    expect(() => atlas.alloc('big', 65, 10)).toThrow();
    expect(() => atlas.alloc('zero', 0, 10)).toThrow();
  });
});
