// @vitest-environment node
/**
 * tests/art-brush.test.ts — the brush engine (src/art/brush.ts).
 *
 * The engine rasterises into a plain Float32Array rather than a canvas, which
 * means these are not smoke tests: they assert on actual pixels. That matters,
 * because the properties the painted-rendering doc asks for — soft varied
 * edges, colour variation *inside* a shape, broken coverage — are exactly the
 * things a "does it throw" test would let regress.
 *
 * Two tests here are regression guards for bugs the contact sheet caught:
 *  - `scumble` silently deposited almost nothing at coverage > 0.25, because
 *    it thresholded raw 3-octave fbm (range ≈ 0.25–0.75) against `1 - coverage`.
 *  - `blockIn` produced a haze instead of an object, because strokes were
 *    clipped by their *centre* and a half-brush-width halo escaped.
 */

import { describe, expect, it } from 'vitest';

// Every test here rasterises real paint, so runtimes are dominated by pixel
// work and vary a lot with machine load. The 5s default is not a meaningful
// signal for this suite; assert on pixels, not on wall-clock.
const SLOW = 60_000;


import {
  addGrain,
  blockIn,
  blurDisc,
  brush,
  clipToMask,
  cloneSurface,
  compositeSurface,
  createSurface,
  dab,
  densifyShape,
  edgeVary,
  ellipseShape,
  fbm,
  fillSurface,
  getPixel,
  glaze,
  gradeSurface,
  hslToRgb,
  leafShape,
  luminance,
  makeKernel,
  maskCoverageAt,
  maskDistanceAt,
  mixRgb,
  parseColour,
  pathLength,
  pointInShape,
  PRESSURE,
  rasterizeShape,
  rectShape,
  resamplePath,
  rgbToHsl,
  roughenShape,
  scumble,
  shiftHsl,
  smoothPath,
  stroke,
  surfaceToRGBA8,
  toHex,
  valueHistogram,
  valueStats,
  withBrush,
  type Surface,
  type Vec2,
} from '../src/art/brush';

/* ------------------------------ measurements ------------------------------ */

/** Mean alpha inside a rectangle. */
function meanAlpha(s: Surface, x0: number, y0: number, x1: number, y1: number): number {
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      sum += s.data[(y * s.width + x) * 4 + 3];
      n++;
    }
  }
  return n ? sum / n : 0;
}

/** Standard deviation of luminance among pixels with alpha > 0.5. */
function colourVariance(s: Surface, x0: number, y0: number, x1: number, y1: number): number {
  const vals: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = getPixel(s, x, y);
      if (p.a > 0.5) vals.push(luminance(p));
    }
  }
  if (vals.length < 2) return 0;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
}

/** How many distinct alpha values appear along a horizontal scan — a proxy for edge softness. */
function edgeSteps(s: Surface, y: number): number {
  const seen = new Set<number>();
  for (let x = 0; x < s.width; x++) {
    const a = s.data[(y * s.width + x) * 4 + 3];
    if (a > 0.02 && a < 0.98) seen.add(Math.round(a * 40));
  }
  return seen.size;
}

const SQUARE: Vec2[] = rectShape(30, 30, 100, 100);

/* --------------------------------- colour --------------------------------- */

describe('colour', () => {
  it('parses every accepted notation', () => {
    expect(parseColour('#f00')).toEqual({ r: 1, g: 0, b: 0 });
    expect(parseColour('#ff0000')).toEqual({ r: 1, g: 0, b: 0 });
    const rgb = parseColour('rgb(255, 128, 0)');
    expect(rgb.r).toBeCloseTo(1, 5);
    expect(rgb.g).toBeCloseTo(128 / 255, 5);
    const hsl = parseColour('hsl(120, 100%, 50%)');
    expect(hsl.g).toBeCloseTo(1, 5);
    expect(hsl.r).toBeCloseTo(0, 5);
    // Objects pass through both ways.
    expect(parseColour({ h: 0, s: 1, l: 0.5 }).r).toBeCloseTo(1, 5);
    expect(parseColour({ r: 0.25, g: 0.5, b: 0.75 }).g).toBeCloseTo(0.5, 5);
  }, SLOW);

  it('round-trips RGB → HSL → RGB', () => {
    for (const hex of ['#7d2f28', '#5c7a35', '#c9b489', '#101828', '#ffffff', '#000000']) {
      const rgb = parseColour(hex);
      const back = hslToRgb(rgbToHsl(rgb));
      expect(back.r).toBeCloseTo(rgb.r, 4);
      expect(back.g).toBeCloseTo(rgb.g, 4);
      expect(back.b).toBeCloseTo(rgb.b, 4);
      expect(toHex(rgb)).toBe(hex.length === 7 ? hex : hex);
    }
  }, SLOW);

  it('shiftHsl moves value without changing hue family, mixRgb interpolates', () => {
    const base = '#5c7a35';
    const lighter = shiftHsl(base, 0, 0, 0.2);
    expect(luminance(lighter)).toBeGreaterThan(luminance(parseColour(base)));
    expect(Math.abs(rgbToHsl(lighter).h - rgbToHsl(parseColour(base)).h)).toBeLessThan(1);
    const mid = mixRgb(parseColour('#000000'), parseColour('#ffffff'), 0.5);
    expect(mid.r).toBeCloseTo(0.5, 5);
  }, SLOW);
});

/* --------------------------------- kernels -------------------------------- */

describe('stamp kernels', () => {
  it('every brush kind produces a bounded, non-empty, centre-weighted head', () => {
    for (const kind of ['soft', 'bristle', 'chalk', 'flat', 'blade', 'sponge', 'ink'] as const) {
      const k = makeKernel(kind, 33, 0.5, 0.6, 0);
      expect(k.size).toBe(33);
      let sum = 0;
      for (const a of k.alpha) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
        sum += a;
      }
      expect(sum).toBeGreaterThan(k.size); // not a blank head
      // Centre-weighted: the middle third carries far more than the corners.
      // (Per-pixel, not per-sample — chalk and sponge punch holes anywhere.)
      let core = 0;
      let rim = 0;
      for (let y = 0; y < 33; y++) {
        for (let x = 0; x < 33; x++) {
          const d = Math.hypot(x - 16, y - 16);
          if (d < 6) core += k.alpha[y * 33 + x];
          else if (d > 14) rim += k.alpha[y * 33 + x];
        }
      }
      expect(core / 113).toBeGreaterThan(rim / 570);
    }
  }, SLOW);

  it('is deterministic per (kind, size, hardness, grain, variant) and varies by variant', () => {
    const a = makeKernel('chalk', 21, 0.5, 0.7, 1);
    const b = makeKernel('chalk', 21, 0.5, 0.7, 1);
    expect(Array.from(a.alpha)).toEqual(Array.from(b.alpha));
    const c = makeKernel('chalk', 21, 0.5, 0.7, 2);
    expect(Array.from(a.alpha)).not.toEqual(Array.from(c.alpha));
  }, SLOW);

  it('soft heads fall off monotonically enough to read as a soft edge', () => {
    const k = makeKernel('soft', 41, 0.4, 0, 0);
    const c = 20;
    const centre = k.alpha[c * 41 + c];
    const mid = k.alpha[c * 41 + c + 10];
    const outer = k.alpha[c * 41 + c + 19];
    expect(centre).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(outer);
  }, SLOW);

  it('chalk and sponge heads are broken — they contain interior holes', () => {
    for (const kind of ['chalk', 'sponge'] as const) {
      const k = makeKernel(kind, 41, 0.5, 0.9, 0);
      let holes = 0;
      const c = 20;
      for (let y = c - 8; y <= c + 8; y++) {
        for (let x = c - 8; x <= c + 8; x++) if (k.alpha[y * 41 + x] < 0.25) holes++;
      }
      expect(holes).toBeGreaterThan(4);
    }
  }, SLOW);
});

/* ----------------------------------- dab ---------------------------------- */

describe('dab', () => {
  it('paints a soft-edged mark and never writes outside its footprint', () => {
    const s = createSurface(80, 80);
    dab(s, 40, 40, brush('soft', { size: 24, opacity: 1, colour: '#ffffff' }));
    expect(getPixel(s, 40, 40).a).toBeGreaterThan(0.5);
    // Well outside the stamp: untouched.
    expect(s.data[(5 * 80 + 5) * 4 + 3]).toBe(0);
    // The edge is a ramp, not a step.
    expect(edgeSteps(s, 40)).toBeGreaterThan(4);
  }, SLOW);

  it('is deterministic and additive over repeated strikes', () => {
    const a = createSurface(60, 60);
    const b = createSurface(60, 60);
    const br = brush('bristle', { size: 20, opacity: 0.3, colour: '#c04030' });
    for (let i = 0; i < 5; i++) {
      dab(a, 30, 30, br, { variant: i });
      dab(b, 30, 30, br, { variant: i });
    }
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    const one = createSurface(60, 60);
    dab(one, 30, 30, br, { variant: 0 });
    expect(getPixel(a, 30, 30).a).toBeGreaterThan(getPixel(one, 30, 30).a);
  }, SLOW);

  it('respects blend modes: multiply darkens, screen lightens', () => {
    const mul = createSurface(40, 40, '#808080');
    const scr = createSurface(40, 40, '#808080');
    dab(mul, 20, 20, brush('soft', { size: 20, opacity: 1, colour: '#404040', blend: 'multiply' }));
    dab(scr, 20, 20, brush('soft', { size: 20, opacity: 1, colour: '#404040', blend: 'screen' }));
    expect(luminance(getPixel(mul, 20, 20))).toBeLessThan(0.5);
    expect(luminance(getPixel(scr, 20, 20))).toBeGreaterThan(0.5);
  }, SLOW);
});

/* ---------------------------------- paths --------------------------------- */

describe('paths', () => {
  it('measures, smooths and resamples deterministically', () => {
    const pts: Vec2[] = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 40 },
    ];
    expect(pathLength(pts)).toBeCloseTo(70, 5);
    const samples = resamplePath(pts, 5);
    expect(samples.length).toBeGreaterThan(13);
    expect(samples[0].t).toBe(0);
    expect(samples[samples.length - 1].t).toBe(1);
    for (let i = 1; i < samples.length; i++) expect(samples[i].t).toBeGreaterThanOrEqual(samples[i - 1].t);
    // Smoothing keeps the endpoints and adds interior detail.
    const smooth = smoothPath(pts, 8);
    expect(smooth.length).toBeGreaterThan(pts.length);
    expect(smooth[0]).toEqual(pts[0]);
    expect(smooth[smooth.length - 1]).toEqual(pts[2]);
  }, SLOW);

  it('degenerate paths do not throw', () => {
    expect(resamplePath([], 4)).toEqual([]);
    expect(resamplePath([{ x: 3, y: 4 }], 4)).toHaveLength(1);
    const s = createSurface(20, 20);
    expect(() => stroke(s, [], brush('soft'))).not.toThrow();
    expect(() => stroke(s, [{ x: 5, y: 5 }], brush('soft'))).not.toThrow();
  }, SLOW);

  it('pressure curves stay in [0, 1] and taper where advertised', () => {
    for (const fn of Object.values(PRESSURE)) {
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const v = fn(t);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1.0001);
      }
    }
    expect(PRESSURE.arc(0)).toBeLessThan(PRESSURE.arc(0.5));
    expect(PRESSURE.arc(1)).toBeLessThan(PRESSURE.arc(0.5));
    expect(PRESSURE.flick(0)).toBeGreaterThan(PRESSURE.flick(1));
    expect(PRESSURE.swell(1)).toBeGreaterThan(PRESSURE.swell(0));
  }, SLOW);
});

/* --------------------------------- stroke --------------------------------- */

describe('stroke', () => {
  const line: Vec2[] = [
    { x: 20, y: 60 },
    { x: 100, y: 60 },
    { x: 180, y: 60 },
  ];

  it('tapers: the ends carry less paint than the middle', () => {
    const s = createSurface(200, 120);
    stroke(s, line, brush('soft', { size: 18, opacity: 0.5, colour: '#ffffff' }), {
      pressure: PRESSURE.arc,
      taper: 0.25,
      seed: 5,
    });
    const start = meanAlpha(s, 20, 45, 34, 75);
    const middle = meanAlpha(s, 93, 45, 107, 75);
    const end = meanAlpha(s, 166, 45, 180, 75);
    expect(middle).toBeGreaterThan(start * 1.5);
    expect(middle).toBeGreaterThan(end * 1.5);
  }, SLOW);

  it('varies colour along and across the line rather than laying one flat value', () => {
    const s = createSurface(200, 120, '#101010');
    stroke(s, line, brush('chalk', {
      size: 26,
      opacity: 0.4,
      colour: '#7d5a2f',
      jitter: { size: 0.3, opacity: 0.4, angle: 0.4, hue: 12, sat: 0.08, lum: 0.12, position: 1 },
    }), { seed: 9, passes: 2 });
    expect(colourVariance(s, 40, 50, 160, 72)).toBeGreaterThan(0.012);
  }, SLOW);

  it('is deterministic per seed and different across seeds', () => {
    const paint = (seed: number) => {
      const s = createSurface(200, 120);
      stroke(s, line, brush('bristle', { size: 20, opacity: 0.4, colour: '#3f6a2a' }), { seed });
      return s;
    };
    expect(Array.from(paint(3).data)).toEqual(Array.from(paint(3).data));
    expect(Array.from(paint(3).data)).not.toEqual(Array.from(paint(4).data));
  }, SLOW);

  it('gradient shifts colour along the stroke', () => {
    const s = createSurface(200, 120, '#000000');
    stroke(s, line, brush('soft', { size: 24, opacity: 0.7, colour: '#808080', jitter: { size: 0, opacity: 0, angle: 0, hue: 0, sat: 0, lum: 0, position: 0 } }), {
      seed: 2,
      taper: 0,
      pressure: PRESSURE.flat,
      passes: 1,
      wobble: 0,
      gradient: (t) => ({ dl: (t - 0.5) * 0.5 }),
    });
    expect(luminance(getPixel(s, 170, 60))).toBeGreaterThan(luminance(getPixel(s, 30, 60)));
  }, SLOW);
});

/* ------------------------------ shapes & masks ---------------------------- */

describe('shapes and masks', () => {
  it('rasterises coverage close to the true area with a correctly signed SDF', () => {
    const mask = rasterizeShape(SQUARE, 8);
    let sum = 0;
    for (const c of mask.coverage) sum += c;
    expect(sum).toBeGreaterThan(9600);
    expect(sum).toBeLessThan(10400);
    expect(maskCoverageAt(mask, 80, 80)).toBeCloseTo(1, 2);
    expect(maskCoverageAt(mask, 5, 5)).toBe(0);
    expect(maskDistanceAt(mask, 80, 80)).toBeLessThan(-40);
    expect(maskDistanceAt(mask, 135, 80)).toBeGreaterThan(0);
  }, SLOW);

  it('ellipse and leaf shapes are closed, non-degenerate and contain their centres', () => {
    const e = ellipseShape(50, 50, 30, 18, 40);
    expect(e).toHaveLength(40);
    expect(pointInShape(e, 50, 50)).toBe(true);
    expect(pointInShape(e, 50, 90)).toBe(false);
    const leaf = leafShape(60, 60, 90, 34, 0, 0.4, 0.1, 24);
    expect(pointInShape(leaf, 60, 60)).toBe(true);
    // Tip and base pinch to a point, so just off the long axis is outside.
    expect(pointInShape(leaf, 60 + 46, 60)).toBe(false);
  }, SLOW);

  it('leafShape has no kink at the widest point (smooth width profile)', () => {
    const leaf = leafShape(0, 0, 200, 60, 0, 0.42, 0, 200);
    // Sample half-widths along the blade; the second difference should stay small.
    const half = leaf.slice(0, 201).map((p) => Math.abs(p.y));
    let worst = 0;
    for (let i = 2; i < half.length - 2; i++) {
      worst = Math.max(worst, Math.abs(half[i - 1] - 2 * half[i] + half[i + 1]));
    }
    expect(worst).toBeLessThan(1.2);
  }, SLOW);

  it('roughenShape densifies coarse polygons so straight edges actually bend', () => {
    const a = roughenShape(SQUARE, 4, 11);
    expect(a).toEqual(roughenShape(SQUARE, 4, 11));
    expect(roughenShape(SQUARE, 4, 12)).not.toEqual(a);
    // A rectangle has 4 vertices; displacing only those leaves 4 straight
    // edges, so roughening must add points along them.
    expect(a.length).toBeGreaterThan(20);
    // The left edge is no longer a single x value.
    const leftXs = a.filter((p) => p.x < 60).map((p) => p.x);
    expect(Math.max(...leftXs) - Math.min(...leftXs)).toBeGreaterThan(1.5);
    // …but it has not exploded: everything stays within `amount` of the box.
    for (const p of a) {
      expect(p.x).toBeGreaterThan(30 - 4.01);
      expect(p.x).toBeLessThan(130 + 4.01);
      expect(p.y).toBeGreaterThan(30 - 4.01);
      expect(p.y).toBeLessThan(130 + 4.01);
    }
  }, SLOW);

  it('densifyShape bounds edge length and keeps the polygon closed', () => {
    const dense = densifyShape(SQUARE, 7);
    expect(dense.length).toBeGreaterThanOrEqual(56);
    for (let i = 0; i < dense.length; i++) {
      const a = dense[i];
      const b = dense[(i + 1) % dense.length];
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(7.001);
    }
    expect(pointInShape(dense, 80, 80)).toBe(true);
  }, SLOW);
});

/* --------------------------------- blockIn -------------------------------- */

describe('blockIn', () => {
  // Transparent ground on purpose: with an opaque ground every pixel has
  // alpha 1 and alpha stops being a probe for "where is the object".
  const paintBlock = (seed = 1) => {
    const s = createSurface(160, 160);
    const mask = blockIn(s, SQUARE, '#8a5a30', { seed });
    return { s, mask };
  };

  it('is solid in the core — REGRESSION: it used to leave a haze instead of an object', () => {
    const { s } = paintBlock();
    // Interior must be essentially opaque…
    expect(meanAlpha(s, 55, 55, 105, 105)).toBeGreaterThan(0.93);
    // …and far outside the silhouette must be untouched by the mass.
    expect(meanAlpha(s, 0, 0, 14, 14)).toBeLessThan(0.02);
  }, SLOW);

  it('varies colour inside the shape — the property ctx.fill cannot have', () => {
    const s = createSurface(160, 160, '#000000');
    blockIn(s, SQUARE, '#8a5a30', { seed: 1 });
    const painted = colourVariance(s, 45, 45, 115, 115);
    // A flat fill of the same colour, for reference.
    const flat = createSurface(160, 160, '#000000');
    fillSurface(flat, '#8a5a30');
    expect(colourVariance(flat, 45, 45, 115, 115)).toBeCloseTo(0, 6);
    expect(painted).toBeGreaterThan(0.02);
  }, SLOW);

  it('has soft, varied edges rather than one hard step', () => {
    const { s } = paintBlock();
    // A hard fill produces at most a couple of partial-alpha pixels per scan.
    let softScans = 0;
    for (let y = 40; y < 120; y += 4) if (edgeSteps(s, y) >= 3) softScans++;
    expect(softScans).toBeGreaterThan(10);
  }, SLOW);

  it('edge position wanders along the silhouette (no vector-perfect outline)', () => {
    const { s } = paintBlock();
    const edgeX: number[] = [];
    for (let y = 45; y < 115; y += 2) {
      for (let x = 10; x < 80; x++) {
        if (s.data[(y * s.width + x) * 4 + 3] > 0.5) {
          edgeX.push(x);
          break;
        }
      }
    }
    const mean = edgeX.reduce((a, b) => a + b, 0) / edgeX.length;
    const sd = Math.sqrt(edgeX.reduce((a, b) => a + (b - mean) ** 2, 0) / edgeX.length);
    expect(sd).toBeGreaterThan(0.6);
  }, SLOW);

  it('returns a usable mask and is deterministic per seed', () => {
    const { s, mask } = paintBlock(21);
    expect(maskCoverageAt(mask, 80, 80)).toBeGreaterThan(0.9);
    const again = paintBlock(21);
    expect(Array.from(s.data)).toEqual(Array.from(again.s.data));
    expect(Array.from(paintBlock(22).s.data)).not.toEqual(Array.from(s.data));
  }, SLOW);
});

/* --------------------------------- scumble -------------------------------- */

describe('scumble', () => {
  const run = (coverage: number, seed = 4) => {
    const s = createSurface(160, 160);
    const mask = rasterizeShape(SQUARE, 6);
    scumble(s, mask, brush('chalk', { size: 14, opacity: 0.5, colour: '#ffffff' }), { coverage, seed });
    return meanAlpha(s, 40, 40, 120, 120);
  };

  it('actually deposits paint — REGRESSION: coverage > 0.25 used to reject every stamp', () => {
    expect(run(0.5)).toBeGreaterThan(0.1);
    expect(run(0.9)).toBeGreaterThan(0.2);
  }, SLOW);

  it('the stamp budget, not the coverage math, is what limits a grainy brush', () => {
    // Same call with a non-grainy head must approach solid — proving the
    // sparseness of chalk above comes from its grain, which is the point of
    // chalk, and not from the pass silently under-emitting.
    const s = createSurface(160, 160);
    scumble(s, rasterizeShape(SQUARE, 6), brush('soft', { size: 14, opacity: 0.5, grain: 0, colour: '#ffffff' }), {
      coverage: 1,
      targetBuildup: 0.9,
      seed: 4,
    });
    expect(meanAlpha(s, 40, 40, 120, 120)).toBeGreaterThan(0.6);
  }, SLOW);

  it('targetBuildup controls how solid the deposit is where it lands', () => {
    const run = (targetBuildup: number) => {
      const s = createSurface(160, 160);
      scumble(s, rasterizeShape(SQUARE, 6), brush('soft', { size: 12, opacity: 0.4, grain: 0, colour: '#fff' }), {
        coverage: 1,
        targetBuildup,
        seed: 11,
      });
      return meanAlpha(s, 45, 45, 115, 115);
    };
    expect(run(0.85)).toBeGreaterThan(run(0.45) * 1.4);
  }, SLOW);

  it('weight aims a pass — the same call lights one side or the other', () => {
    const run = (weight: (x: number, y: number) => number) => {
      const s = createSurface(160, 160);
      scumble(s, rasterizeShape(SQUARE, 6), brush('chalk', { size: 12, opacity: 0.5, colour: '#ffffff' }), {
        coverage: 0.8,
        weight,
        seed: 12,
      });
      return { left: meanAlpha(s, 34, 40, 74, 120), right: meanAlpha(s, 86, 40, 126, 120) };
    };
    const lit = run((x) => Math.max(0, 1 - (x - 30) / 100));
    expect(lit.left).toBeGreaterThan(lit.right * 2);
    const shaded = run((x) => Math.max(0, (x - 30) / 100));
    expect(shaded.right).toBeGreaterThan(shaded.left * 2);
  }, SLOW);

  it('coverage is monotone', () => {
    const low = run(0.2);
    const mid = run(0.55);
    const high = run(0.95);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  }, SLOW);

  it('leaves the layer beneath showing through — it is broken, not solid', () => {
    const s = createSurface(160, 160, '#101010');
    const mask = rasterizeShape(SQUARE, 6);
    scumble(s, mask, brush('chalk', { size: 14, opacity: 0.45, colour: '#e8e0c8' }), { coverage: 0.55, seed: 8 });
    let dark = 0;
    let light = 0;
    for (let y = 45; y < 115; y++) {
      for (let x = 45; x < 115; x++) {
        const l = luminance(getPixel(s, x, y));
        if (l < 0.2) dark++;
        else if (l > 0.45) light++;
      }
    }
    expect(dark).toBeGreaterThan(200);
    expect(light).toBeGreaterThan(200);
  }, SLOW);

  it('stays inside the mask and is deterministic', () => {
    const paint = (seed: number) => {
      const s = createSurface(160, 160);
      scumble(s, rasterizeShape(SQUARE, 6), brush('sponge', { size: 12, opacity: 0.5, colour: '#fff' }), {
        coverage: 0.8,
        seed,
      });
      return s;
    };
    const s = paint(2);
    expect(meanAlpha(s, 0, 0, 12, 12)).toBe(0);
    expect(Array.from(paint(2).data)).toEqual(Array.from(s.data));
    expect(Array.from(paint(3).data)).not.toEqual(Array.from(s.data));
  }, SLOW);

  it('edgeBias pushes coverage toward the rim', () => {
    const measure = (edgeBias: number) => {
      const s = createSurface(160, 160);
      scumble(s, rasterizeShape(SQUARE, 6), brush('soft', { size: 10, opacity: 0.5, colour: '#fff' }), {
        coverage: 0.6,
        edgeBias,
        seed: 6,
      });
      const rim = meanAlpha(s, 32, 32, 46, 128) + meanAlpha(s, 114, 32, 128, 128);
      const core = meanAlpha(s, 66, 66, 94, 94) * 2;
      return rim / Math.max(1e-6, core);
    };
    expect(measure(0.9)).toBeGreaterThan(measure(0));
  }, SLOW);
});

/* ---------------------------------- glaze --------------------------------- */

describe('glaze', () => {
  it('multiply darkens and screen lifts, without disturbing alpha', () => {
    const base = createSurface(120, 120, '#7a7a7a');
    const mask = rasterizeShape(SQUARE, 4);
    const dark = cloneSurface(base);
    glaze(dark, mask, '#204060', 0.5, { blend: 'multiply', mottle: 0, seed: 1 });
    const light = cloneSurface(base);
    glaze(light, mask, '#ffd9a0', 0.5, { blend: 'screen', mottle: 0, seed: 1 });
    expect(luminance(getPixel(dark, 80, 80))).toBeLessThan(luminance(getPixel(base, 80, 80)));
    expect(luminance(getPixel(light, 80, 80))).toBeGreaterThan(luminance(getPixel(base, 80, 80)));
    expect(getPixel(dark, 80, 80).a).toBeCloseTo(1, 5);
  }, SLOW);

  it('respects the mask and the gradient', () => {
    const s = createSurface(160, 160, '#808080');
    const mask = rasterizeShape(SQUARE, 4);
    glaze(s, mask, '#000000', 1, {
      blend: 'normal',
      mottle: 0,
      gradient: (x) => Math.max(0, Math.min(1, (x - 30) / 100)),
      seed: 1,
    });
    // Outside the mask: untouched.
    expect(luminance(getPixel(s, 5, 5))).toBeCloseTo(luminance(parseColour('#808080')), 2);
    // Inside: darker on the right than the left.
    expect(luminance(getPixel(s, 120, 80))).toBeLessThan(luminance(getPixel(s, 36, 80)));
  }, SLOW);

  it('mottles — a wash is never perfectly even', () => {
    const even = createSurface(160, 160, '#808080');
    glaze(even, null, '#402010', 0.5, { blend: 'multiply', mottle: 0 });
    const mottled = createSurface(160, 160, '#808080');
    glaze(mottled, null, '#402010', 0.5, { blend: 'multiply', mottle: 0.45, mottleScale: 30, seed: 3 });
    expect(colourVariance(even, 20, 20, 140, 140)).toBeLessThan(0.002);
    expect(colourVariance(mottled, 20, 20, 140, 140)).toBeGreaterThan(0.01);
  }, SLOW);
});

/* -------------------------------- edgeVary -------------------------------- */

describe('edgeVary', () => {
  it('changes the boundary band and mostly leaves the interior alone', () => {
    const s = createSurface(160, 160);
    blockIn(s, SQUARE, '#8a5a30', { seed: 3 });
    const before = cloneSurface(s);
    edgeVary(s, SQUARE, { crisp: 0.4, lost: 0.35, band: 4, seed: 3 });

    const changed = (x0: number, y0: number, x1: number, y1: number) => {
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * s.width + x) * 4;
          if (Math.abs(s.data[i] - before.data[i]) > 0.01) n++;
        }
      }
      return n / ((x1 - x0) * (y1 - y0));
    };
    expect(changed(24, 24, 40, 136)).toBeGreaterThan(0.05); // left edge band
    expect(changed(64, 64, 96, 96)).toBeLessThan(0.02); // deep interior
  }, SLOW);

  it('produces both crisp and lost stretches, deterministically', () => {
    const paint = (seed: number) => {
      const s = createSurface(160, 160);
      blockIn(s, SQUARE, '#8a5a30', { seed: 3 });
      edgeVary(s, SQUARE, { crisp: 0.45, lost: 0.4, band: 4, seed });
      // Sharpness of each left-edge scanline: max alpha step.
      const steps: number[] = [];
      for (let y = 40; y < 120; y += 2) {
        let maxStep = 0;
        for (let x = 20; x < 60; x++) {
          const a0 = s.data[(y * s.width + x) * 4 + 3];
          const a1 = s.data[(y * s.width + x + 1) * 4 + 3];
          maxStep = Math.max(maxStep, Math.abs(a1 - a0));
        }
        steps.push(maxStep);
      }
      return { s, steps };
    };
    const { s, steps } = paint(3);
    expect(Math.max(...steps) - Math.min(...steps)).toBeGreaterThan(0.25);
    expect(Array.from(paint(3).s.data)).toEqual(Array.from(s.data));
  }, SLOW);
});

/* --------------------------- layers and finishing ------------------------- */

describe('layers and finishing', () => {
  it('compositeSurface places a layer at an offset and clips at the edges', () => {
    const dst = createSurface(60, 60);
    const src = createSurface(20, 20, '#ff0000');
    compositeSurface(dst, src, 10, 10);
    expect(getPixel(dst, 15, 15).r).toBeCloseTo(1, 3);
    expect(getPixel(dst, 5, 5).a).toBe(0);
    // Partly off-canvas must not throw or wrap.
    expect(() => compositeSurface(dst, src, -10, 55)).not.toThrow();
    expect(getPixel(dst, 0, 57).r).toBeCloseTo(1, 3);
  }, SLOW);

  it('clipToMask confines a layer to a silhouette with a feathered boundary', () => {
    const layer = createSurface(160, 160, '#ffffff');
    clipToMask(layer, rasterizeShape(SQUARE, 6), { feather: 2, noise: 0 });
    expect(getPixel(layer, 80, 80).a).toBeCloseTo(1, 2);
    expect(layer.data[(5 * 160 + 5) * 4 + 3]).toBeCloseTo(0, 3);
    // The transition is a ramp.
    expect(edgeSteps(layer, 80)).toBeGreaterThanOrEqual(2);
  }, SLOW);

  it('blurDisc softens locally and leaves the rest of the surface intact', () => {
    const s = createSurface(80, 80, '#000000');
    for (let y = 0; y < 80; y++) for (let x = 40; x < 80; x++) {
      const i = (y * 80 + x) * 4;
      s.data[i] = s.data[i + 1] = s.data[i + 2] = 1;
    }
    const before = cloneSurface(s);
    blurDisc(s, 40, 20, 8, 1);
    expect(Math.abs(getPixel(s, 40, 20).r - getPixel(before, 40, 20).r)).toBeGreaterThan(0.05);
    expect(getPixel(s, 40, 65).r).toBeCloseTo(getPixel(before, 40, 65).r, 5);
  }, SLOW);

  it('addGrain perturbs painted pixels only', () => {
    const s = createSurface(80, 80);
    dab(s, 40, 40, brush('soft', { size: 40, opacity: 1, colour: '#808080' }));
    const before = cloneSurface(s);
    addGrain(s, 0.2, 2, 5);
    expect(colourVariance(s, 30, 30, 50, 50)).toBeGreaterThan(colourVariance(before, 30, 30, 50, 50));
    expect(s.data[(2 * 80 + 2) * 4 + 3]).toBe(0);
  }, SLOW);

  it('gradeSurface widens the value range and preserves alpha', () => {
    // A mid-tone ramp — the exact "mush" the value-first pillar rejects.
    const s = createSurface(120, 120);
    for (let y = 0; y < 120; y++) {
      const v = 0.3 + (y / 119) * 0.3;
      for (let x = 0; x < 120; x++) {
        const i = (y * 120 + x) * 4;
        s.data[i] = s.data[i + 1] = s.data[i + 2] = v;
        s.data[i + 3] = 1;
      }
    }
    const before = valueStats(s);
    gradeSurface(s, { contrast: 1.8, pivot: 0.45, black: 0, tintStrength: 0, saturation: 1 });
    const after = valueStats(s);
    expect(after.spread).toBeGreaterThan(before.spread * 1.4);
    expect(after.min).toBeLessThan(before.min);
    expect(after.max).toBeGreaterThan(before.max);
    expect(getPixel(s, 60, 60).a).toBeCloseTo(1, 2);
  }, SLOW);

  it('valueHistogram and valueStats describe the value structure', () => {
    const s = createSurface(100, 100, '#7f7f7f');
    const hist = valueHistogram(s, 8);
    let sum = 0;
    for (const v of hist) sum += v;
    expect(sum).toBeCloseTo(1, 5);
    expect(hist[3] + hist[4]).toBeGreaterThan(0.9); // all mid-tone: the failure mode
    const stats = valueStats(s);
    expect(stats.mean).toBeCloseTo(0.5, 1);
    expect(stats.spread).toBeCloseTo(0, 3);
    expect(stats.darkMass).toBe(0);
    expect(stats.lightMass).toBe(0);

    // A committed value structure: a large near-black field with a small
    // near-white accent. This is what the histogram check is *for*.
    const c = createSurface(100, 100, '#0a0a0a');
    for (let i = 0; i < 40; i++) {
      dab(c, 50, 50, brush('soft', { size: 34, opacity: 1, hardness: 1, colour: '#ffffff' }), { variant: i % 8 });
    }
    const cs = valueStats(c);
    expect(cs.darkMass).toBeGreaterThan(0.4);
    expect(cs.lightMass).toBeGreaterThan(0.01);
    expect(cs.spread).toBeGreaterThan(stats.spread);
  }, SLOW);

  it('surfaceToRGBA8 round-trips colour and composites over a backdrop', () => {
    const s = createSurface(4, 4);
    dab(s, 2, 2, brush('soft', { size: 8, opacity: 1, hardness: 1, colour: '#ff0000' }));
    const raw = surfaceToRGBA8(s);
    expect(raw.length).toBe(64);
    expect(raw[(2 * 4 + 2) * 4]).toBeGreaterThan(200);
    const over = surfaceToRGBA8(createSurface(4, 4), '#0000ff');
    expect(over[2]).toBe(255);
    expect(over[3]).toBe(255);
  }, SLOW);
});

/* ------------------------------ engine hygiene ---------------------------- */

describe('engine hygiene', () => {
  it('withBrush derives without mutating the original', () => {
    const base = brush('chalk', { size: 20, colour: '#123456' });
    const derived = withBrush(base, { colour: '#654321', opacity: 0.9 });
    expect(base.opacity).not.toBe(0.9);
    expect(toHex(base.colour)).toBe('#123456');
    expect(toHex(derived.colour)).toBe('#654321');
    expect(derived.size).toBe(20);
  }, SLOW);

  it('fbm is deterministic and bounded', () => {
    for (let i = 0; i < 50; i++) {
      const v = fbm(i * 0.37, i * 0.11, 9);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(fbm(i * 0.37, i * 0.11, 9)).toBe(v);
    }
  }, SLOW);

  it('a full painted object is reproducible byte-for-byte', () => {
    const paint = () => {
      const s = createSurface(140, 160, '#181109');
      const poly = leafShape(70, 80, 120, 52, -Math.PI / 2.2, 0.4, 0.14, 30);
      const mask = blockIn(s, poly, '#3d5226', { seed: 77 });
      scumble(s, mask, brush('bristle', { size: 12, colour: '#9fbc4e', opacity: 0.22 }), { coverage: 0.4, seed: 78 });
      glaze(s, mask, '#ffd88f', 0.25, { blend: 'softlight', seed: 79 });
      edgeVary(s, poly, { crisp: 0.3, lost: 0.25, seed: 80 });
      addGrain(s, 0.05, 1.8, 81);
      gradeSurface(s);
      return s;
    };
    expect(Array.from(paint().data)).toEqual(Array.from(paint().data));
  }, SLOW);
});
