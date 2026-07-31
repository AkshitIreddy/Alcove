/**
 * tests/art-materials.test.ts — the generated material library's contract.
 *
 * The library is the one part of the art pipeline that depends on files
 * existing on disk and decoding correctly at runtime, so the properties worth
 * pinning are the ones that make that dependency safe:
 *
 *  1. **It never hard-fails.** Every accessor returns `null` for a missing or
 *     still-loading tile, and the art code falls back to painting the material
 *     by hand. A corrupt WebP must cost texture quality and nothing else.
 *  2. **It is value-faithful.** `sampleMaterial` returns a patch whose mean
 *     luminance is the tint's luminance. The value-first themes in
 *     `docs/design/painted-rendering.md` only hold together if a pigment's
 *     designed value is the value that lands, and a tile brings its own
 *     exposure and its own composition to the party.
 *  3. **It is deterministic.** Same seed, same bytes — the brush engine's rule,
 *     and the reason a shelf looks identical across two runs.
 *  4. **The TypeScript manifest agrees with the JSON the bake script wrote.**
 *     They are two records of the same set and drift silently otherwise.
 *
 * Everything runs in Node with no image decoder: tiles are synthesised as raw
 * RGBA and pushed in through `registerMaterialPixels`, which is the same door
 * the browser loader uses after `createImageBitmap`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseColour, valueStats, type Rgb } from '../src/art/brush';
import {
  MATERIAL_MANIFEST,
  clearMaterialCache,
  drawMaterialRect,
  getMaterialTile,
  materialAverageColour,
  materialCount,
  materialDefaults,
  materialEntry,
  materialSlugs,
  materialsEnabled,
  materialsReady,
  pickMaterialSlug,
  pickMaterialTile,
  registerMaterialPixels,
  sampleMaterial,
  setMaterialsEnabled,
  type MaterialCategory,
} from '../src/art/materials';

/* --------------------------- synthetic tiles ------------------------------ */

/**
 * A deterministic stand-in for a generated tile.
 *
 * `kind` picks the structure so the tests exercise the two things the sampler
 * has to survive: a tile whose mean is nowhere near 0.5 (exposure), and a tile
 * with strong chroma (hue borrowing).
 */
function synthTile(size: number, kind: 'grain' | 'stripes' | 'dark' | 'bright' | 'colour'): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4);
  let s = 0x2545f491;
  const rnd = (): number => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let r: number;
      let g: number;
      let b: number;
      switch (kind) {
        case 'stripes': {
          const v = x % 8 < 4 ? 200 : 90;
          r = v;
          g = v;
          b = v;
          break;
        }
        case 'dark': {
          const v = 20 + rnd() * 50;
          r = v;
          g = v * 0.9;
          b = v * 0.8;
          break;
        }
        case 'bright': {
          const v = 200 + rnd() * 50;
          r = v;
          g = v;
          b = v * 0.95;
          break;
        }
        case 'colour': {
          r = 30 + rnd() * 40;
          g = 120 + rnd() * 60;
          b = 200 + rnd() * 50;
          break;
        }
        default: {
          const v = 90 + rnd() * 110;
          r = v;
          g = v * 0.96;
          b = v * 0.88;
        }
      }
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }
  return px;
}

function lum(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

const TINT = '#7a3f22';
const TINT_L = lum(parseColour(TINT));

beforeEach(() => {
  clearMaterialCache();
  setMaterialsEnabled(true);
});

afterEach(() => {
  clearMaterialCache();
  setMaterialsEnabled(true);
});

/* -------------------------------- manifest -------------------------------- */

describe('material manifest', () => {
  it('agrees with the JSON that scripts/prepare-assets.mjs wrote', () => {
    const raw = readFileSync(
      fileURLToPath(new URL('../public/materials/manifest.json', import.meta.url)),
      'utf8',
    );
    const json = JSON.parse(raw) as {
      materials: Array<{
        slug: string;
        category: string;
        role: string;
        size: number;
        mean: number;
        spread: number;
        saturation: number;
      }>;
    };
    const bySlug = new Map(json.materials.map((m) => [m.slug, m]));
    // Every tile the TypeScript manifest promises must actually have shipped.
    // The reverse is checked separately and more loosely: the bake script can
    // grow a new set before the art code has anything to do with it.
    for (const e of MATERIAL_MANIFEST) {
      const j = bySlug.get(e.slug);
      expect(j, `${e.slug} missing from manifest.json`).toBeDefined();
      expect(j!.category).toBe(e.category);
      expect(j!.role).toBe(e.role);
      expect(j!.size).toBe(e.size);
      // Statistics are copied from the JSON, not recomputed, and the tuned
      // `paint` numbers are derived from them — so a real divergence means the
      // tile behind a slug changed and every tuning decision is now based on a
      // different image. Two decimal places: re-running the bake script
      // re-encodes an already-encoded WebP and moves the mean by ~0.0007,
      // which is noise, while a swapped tile moves it by tenths.
      expect(j!.mean, e.slug).toBeCloseTo(e.mean, 2);
      expect(j!.spread, e.slug).toBeCloseTo(e.spread, 2);
      expect(j!.saturation, e.slug).toBeCloseTo(e.saturation, 2);
    }
  });

  it('serves every tile the bake script shipped', () => {
    const raw = readFileSync(
      fileURLToPath(new URL('../public/materials/manifest.json', import.meta.url)),
      'utf8',
    );
    const json = JSON.parse(raw) as { materials: Array<{ slug: string }> };
    const known = new Set(MATERIAL_MANIFEST.map((m) => m.slug));
    const orphans = json.materials.map((m) => m.slug).filter((s) => !known.has(s));
    // A shipped WebP nothing references is dead weight in the installer.
    expect(orphans, `unreferenced tiles in public/materials: ${orphans.join(', ')}`).toEqual([]);
  });

  it('indexes every entry by category with no orphans', () => {
    const cats: MaterialCategory[] = ['leather', 'cloth', 'paper', 'wood', 'marble', 'wallpaper'];
    const seen = new Set<string>();
    for (const c of cats) for (const s of materialSlugs(c)) seen.add(s);
    expect(seen.size).toBe(MATERIAL_MANIFEST.length);
    expect(materialSlugs()).toHaveLength(MATERIAL_MANIFEST.length);
    for (const e of MATERIAL_MANIFEST) expect(materialEntry(e.slug)).toBe(e);
    expect(materialEntry('no-such-tile')).toBeNull();
  });

  it('gives every category at least one member', () => {
    for (const c of ['leather', 'cloth', 'paper', 'wood', 'marble', 'wallpaper'] as MaterialCategory[]) {
      expect(materialSlugs(c).length, c).toBeGreaterThan(0);
    }
  });

  it('carries sane tuned paint defaults for every tile', () => {
    for (const e of MATERIAL_MANIFEST) {
      expect(e.paint.tilePx, e.slug).toBeGreaterThan(32);
      expect(e.paint.tilePx, e.slug).toBeLessThan(1024);
      expect(e.paint.contrast, e.slug).toBeGreaterThan(0.3);
      expect(e.paint.contrast, e.slug).toBeLessThan(2.5);
      expect(e.paint.colourMix, e.slug).toBeGreaterThanOrEqual(0);
      expect(e.paint.colourMix, e.slug).toBeLessThanOrEqual(1);
      // A `grain` tile that kept most of its own hue would override the
      // book's pigment, which is the whole thing this design avoids.
      if (e.role === 'grain') expect(e.paint.colourMix, e.slug).toBeLessThan(0.4);
    }
  });

  it('scales tuned repeats with the bake scale', () => {
    const one = materialDefaults('leather-morocco', 1);
    const two = materialDefaults('leather-morocco', 2);
    expect(two.tilePx).toBeCloseTo(one.tilePx * 2, 6);
    // Contrast and hue mix are properties of the tile, not of the zoom.
    expect(two.contrast).toBe(one.contrast);
    expect(two.colourMix).toBe(one.colourMix);
  });

  it('falls back to neutral defaults for an unknown slug', () => {
    const d = materialDefaults('not-a-tile', 1);
    expect(d.tilePx).toBeGreaterThan(0);
    expect(d.contrast).toBeGreaterThan(0);
  });
});

/* ------------------------------ graceful miss ----------------------------- */

describe('degrading when the library is not there', () => {
  it('returns null from every accessor with nothing loaded', () => {
    expect(materialCount()).toBe(0);
    expect(materialsReady()).toBe(false);
    expect(getMaterialTile('leather-morocco')).toBeNull();
    expect(pickMaterialTile('leather', 7)).toBeNull();
    expect(sampleMaterial('leather-morocco', 40, 40, { tint: TINT })).toBeNull();
    expect(materialAverageColour('leather-morocco')).toBeNull();
  });

  it('still picks a slug by category without any tile loaded', () => {
    // Picking is manifest-driven, so the *decision* is stable even before the
    // bytes arrive — which is what lets a caller ask for a specific tile and
    // get the same one once loading finishes.
    const slug = pickMaterialSlug('leather', 12345);
    expect(slug).not.toBeNull();
    expect(materialSlugs('leather')).toContain(slug);
  });

  it('returns null rather than throwing for an unknown category', () => {
    expect(pickMaterialSlug('glass' as MaterialCategory, 1)).toBeNull();
    expect(pickMaterialTile('glass' as MaterialCategory, 1)).toBeNull();
  });

  it('reports false from drawMaterialRect when there is nothing to draw', () => {
    // No canvas in Node either, so this exercises both misses at once.
    const fakeCtx = {} as unknown as CanvasRenderingContext2D;
    expect(drawMaterialRect(fakeCtx, 0, 0, 10, 10, { slug: 'vellum' })).toBe(false);
  });

  it('honours the master disable switch', () => {
    registerMaterialPixels('vellum', synthTile(64, 'grain'), 64);
    expect(getMaterialTile('vellum')).not.toBeNull();
    setMaterialsEnabled(false);
    expect(materialsEnabled()).toBe(false);
    expect(getMaterialTile('vellum')).toBeNull();
    expect(pickMaterialTile('paper', 3)).toBeNull();
    expect(materialsReady()).toBe(false);
    setMaterialsEnabled(true);
    expect(getMaterialTile('vellum')).not.toBeNull();
  });

  it('rejects malformed registrations instead of caching junk', () => {
    expect(registerMaterialPixels('vellum', new Uint8ClampedArray(4), 64)).toBeNull();
    expect(registerMaterialPixels('vellum', synthTile(64, 'grain'), 0)).toBeNull();
    // Unknown slug with no category/role supplied has nothing to file it under.
    expect(registerMaterialPixels('mystery', synthTile(64, 'grain'), 64)).toBeNull();
    expect(materialCount()).toBe(0);
    // …but supply them and it is accepted, so an experiment needs no rebake.
    const tile = registerMaterialPixels('mystery', synthTile(64, 'grain'), 64, {
      category: 'cloth',
      role: 'grain',
    });
    expect(tile?.slug).toBe('mystery');
  });
});

/* --------------------------- decode + mip chain --------------------------- */

describe('tile registration', () => {
  it('measures the tile it was handed', () => {
    const tile = registerMaterialPixels('leather-morocco', synthTile(64, 'grain'), 64)!;
    expect(tile.size).toBe(64);
    expect(tile.category).toBe('leather');
    expect(tile.role).toBe('grain');
    expect(tile.mean).toBeGreaterThan(0.2);
    expect(tile.mean).toBeLessThan(0.9);
    expect(tile.spread).toBeGreaterThan(0);
  });

  it('builds a mip chain down to 16px', () => {
    const tile = registerMaterialPixels('leather-morocco', synthTile(128, 'grain'), 128)!;
    expect(tile.levels.map((l) => l.size)).toEqual([128, 64, 32, 16]);
    for (const l of tile.levels) {
      expect(l.rgb.length).toBe(l.size * l.size * 3);
      expect(l.lum.length).toBe(l.size * l.size);
    }
  });

  it('averages, not decimates, when building mips', () => {
    // A 4-on/4-off stripe collapses toward the mean as levels halve. Point
    // sampling would keep the full 200/90 swing forever — and that is exactly
    // the aliasing that made craquelure crawl when the camera zoomed.
    const tile = registerMaterialPixels('cloth-ribbed', synthTile(64, 'stripes'), 64)!;
    const spreadOf = (i: number): number => {
      const l = tile.levels[i];
      let sum = 0;
      let sumSq = 0;
      for (let k = 0; k < l.lum.length; k++) {
        const v = l.lum[k] / 255;
        sum += v;
        sumSq += v * v;
      }
      const m = sum / l.lum.length;
      return Math.sqrt(Math.max(0, sumSq / l.lum.length - m * m));
    };
    expect(spreadOf(tile.levels.length - 1)).toBeLessThan(spreadOf(0));
  });

  it('reports an average colour once loaded', () => {
    registerMaterialPixels('paper-marbled', synthTile(64, 'colour'), 64);
    const c = materialAverageColour('paper-marbled')!;
    expect(c).not.toBeNull();
    // The synthetic tile is strongly blue; the average must say so.
    expect(c.b).toBeGreaterThan(c.r);
  });
});

/* ------------------------------- sampling --------------------------------- */

describe('sampleMaterial', () => {
  it('lands on the tint’s luminance whatever the tile’s exposure', () => {
    // The same tint through a very dark tile and a very bright one must come
    // out at the same value. This is the property the whole design rests on.
    for (const kind of ['dark', 'bright', 'grain', 'colour'] as const) {
      clearMaterialCache();
      registerMaterialPixels('leather-morocco', synthTile(64, kind), 64);
      const sf = sampleMaterial('leather-morocco', 60, 90, { tint: TINT, tilePx: 64 })!;
      expect(sf, kind).not.toBeNull();
      const st = valueStats(sf);
      expect(Math.abs(st.mean - TINT_L), `${kind} drifted to ${st.mean.toFixed(3)}`).toBeLessThan(0.03);
    }
  });

  it('keeps a grain tile’s hue out of the result', () => {
    // A vivid blue tile tinted to a warm brown must still be warm brown:
    // `grain` materials contribute structure, never colour.
    registerMaterialPixels('leather-morocco', synthTile(64, 'colour'), 64);
    const sf = sampleMaterial('leather-morocco', 40, 40, { tint: TINT, tilePx: 64, colourMix: 0 })!;
    let r = 0;
    let b = 0;
    for (let i = 0; i < sf.data.length; i += 4) {
      const a = sf.data[i + 3];
      r += sf.data[i] / a;
      b += sf.data[i + 2] / a;
    }
    expect(r).toBeGreaterThan(b);
  });

  it('lets a figure tile’s hue through when asked', () => {
    registerMaterialPixels('leather-morocco', synthTile(64, 'colour'), 64);
    const warm = sampleMaterial('leather-morocco', 40, 40, { tint: TINT, tilePx: 64, colourMix: 0 })!;
    const mixed = sampleMaterial('leather-morocco', 40, 40, { tint: TINT, tilePx: 64, colourMix: 0.9 })!;
    const blueness = (s: typeof warm): number => {
      let d = 0;
      for (let i = 0; i < s.data.length; i += 4) d += s.data[i + 2] - s.data[i];
      return d;
    };
    expect(blueness(mixed)).toBeGreaterThan(blueness(warm));
  });

  it('produces identical bytes for identical inputs', () => {
    registerMaterialPixels('vellum', synthTile(64, 'grain'), 64);
    const a = sampleMaterial('vellum', 48, 70, { tint: TINT, seed: 99, tilePx: 90 })!;
    const b = sampleMaterial('vellum', 48, 70, { tint: TINT, seed: 99, tilePx: 90 })!;
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it('crops a different piece of the sheet per seed', () => {
    registerMaterialPixels('vellum', synthTile(64, 'grain'), 64);
    const a = sampleMaterial('vellum', 48, 70, { tint: TINT, seed: 1, tilePx: 90 })!;
    const b = sampleMaterial('vellum', 48, 70, { tint: TINT, seed: 2, tilePx: 90 })!;
    let diff = 0;
    for (let i = 0; i < a.data.length; i += 4) diff += Math.abs(a.data[i] - b.data[i]);
    expect(diff).toBeGreaterThan(0);
  });

  it('scales structure with `strength` and flattens at zero', () => {
    registerMaterialPixels('vellum', synthTile(64, 'grain'), 64);
    const flat = valueStats(sampleMaterial('vellum', 64, 64, { tint: TINT, strength: 0, tilePx: 64 })!);
    const mild = valueStats(sampleMaterial('vellum', 64, 64, { tint: TINT, strength: 0.4, tilePx: 64 })!);
    const full = valueStats(sampleMaterial('vellum', 64, 64, { tint: TINT, strength: 1, tilePx: 64 })!);
    expect(flat.spread).toBeLessThan(0.01);
    expect(mild.spread).toBeGreaterThan(flat.spread);
    expect(full.spread).toBeGreaterThan(mild.spread);
  });

  it('wraps seamlessly rather than clamping at the tile edge', () => {
    // Sampling four repeats must not leave a visible discontinuity: the tile
    // is seamless and the sampler has to honour that or every book grows a
    // grid of hairlines.
    registerMaterialPixels('vellum', synthTile(32, 'grain'), 32);
    const sf = sampleMaterial('vellum', 128, 8, { tint: TINT, tilePx: 32, strength: 1, offsetX: 0, offsetY: 0 })!;
    const colMean = (x: number): number => {
      let s = 0;
      for (let y = 0; y < 8; y++) {
        const i = (y * 128 + x) * 4;
        const a = sf.data[i + 3];
        s += (0.2126 * sf.data[i] + 0.7152 * sf.data[i + 1] + 0.0722 * sf.data[i + 2]) / a;
      }
      return s / 8;
    };
    // The seam column (x=32) against its neighbours: no bigger a step than a
    // typical interior neighbour pair.
    const seamStep = Math.abs(colMean(31) - colMean(32));
    let interior = 0;
    for (let x = 5; x < 25; x++) interior += Math.abs(colMean(x) - colMean(x + 1));
    const typical = interior / 20;
    expect(seamStep).toBeLessThan(typical * 6 + 0.02);
  });

  it('honours an explicit tile object as well as a slug', () => {
    const tile = registerMaterialPixels('vellum', synthTile(64, 'grain'), 64)!;
    expect(sampleMaterial(tile, 20, 20, { tint: TINT })).not.toBeNull();
    setMaterialsEnabled(false);
    // Even handed the object directly, a disabled library paints nothing.
    expect(sampleMaterial(tile, 20, 20, { tint: TINT })).toBeNull();
  });

  it('applies a gradient weight to the patch alpha', () => {
    registerMaterialPixels('vellum', synthTile(64, 'grain'), 64);
    const sf = sampleMaterial('vellum', 40, 10, {
      tint: TINT,
      gradient: (x) => x / 40,
    })!;
    const alphaAt = (x: number): number => sf.data[(5 * 40 + x) * 4 + 3];
    expect(alphaAt(2)).toBeLessThan(alphaAt(38));
  });

  it('survives a degenerate request without throwing', () => {
    registerMaterialPixels('vellum', synthTile(64, 'grain'), 64);
    expect(sampleMaterial('vellum', 0, 0, { tint: TINT })).not.toBeNull();
    expect(sampleMaterial('vellum', 1, 1, { tint: TINT, tilePx: 0.0001 })).not.toBeNull();
    expect(sampleMaterial('vellum', 4, 4, { tint: TINT, strength: 99, contrast: -5 })).not.toBeNull();
  });
});

/* ------------------------------- picking ---------------------------------- */

describe('pickMaterialSlug', () => {
  it('is deterministic per seed', () => {
    for (const seed of [0, 1, 7, 42, 1337, 0xbeef, 0xffffffff]) {
      expect(pickMaterialSlug('wood', seed)).toBe(pickMaterialSlug('wood', seed));
    }
  });

  it('spreads adjacent seeds across the members of a category', () => {
    // A shelf hands consecutive books consecutive-ish seeds; a picker that
    // walked the list in order would print the same run of leathers every
    // time.
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(pickMaterialSlug('wood', 1000 + i)!);
    expect(seen.size).toBe(materialSlugs('wood').length);
  });

  it('falls back to a resident sibling when the chosen tile is absent', () => {
    const woods = materialSlugs('wood');
    // Load exactly one wood, then ask for a seed that would choose another.
    registerMaterialPixels(woods[woods.length - 1], synthTile(32, 'grain'), 32);
    let served = 0;
    for (let i = 0; i < 30; i++) if (pickMaterialTile('wood', i)) served++;
    expect(served).toBe(30);
  });
});
