// @vitest-environment node
/**
 * tests/art-wallpaper.test.ts — the wall's vocabulary, and the one property
 * that has sunk every previous version of it.
 *
 * The wall covers the whole viewport and is panned across, so a tile whose
 * opposite edges do not line up shows as a grid of pale bands sliding over the
 * shelf. That is not hypothetical: it is what the reader reported ("weird
 * tiling effect", "white bands in the corners") twice, and the fix both times
 * was to delete the pattern and go back to a flat tint. So the seam test here
 * is the point of the file and everything else is bookkeeping.
 *
 * ## How the pixels get made
 *
 * There is no canvas in node and no canvas package in this repo, so the tile is
 * RECORDED rather than rasterized here: `renderWallpaperTile` is handed a proxy
 * that captures every call and property set, and the resulting op list is
 * replayed onto a real 2D context inside headless Chromium — the same rasterizer
 * the app itself draws with. That keeps the whole thing dependency-free apart
 * from Playwright, which the e2e suite already needs, and it means the test
 * measures the browser's real antialiasing rather than a model of it.
 *
 * If Chromium cannot be launched (a machine with no browsers installed) the
 * seam suite skips rather than failing, and the structural tests still run.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { flatScheme, setFlatScheme, type FlatCtx } from '../src/art/flat';
import { getTheme } from '../src/art/themes';
import {
  DEFAULT_WALLPAPER_ID,
  WALLPAPER_DEPTHS,
  WALLPAPER_INKS,
  WALLPAPER_PATTERNS,
  WALLPAPER_PRESETS,
  WALLPAPER_SCALES,
  getWallpaper,
  isWallpaperId,
  renderWallpaperTile,
  wallpaperColours,
  wallpaperSpec,
  wallpaperTileKey,
  wallpaperTilePx,
  type WallpaperSpec,
} from '../src/art/wallpaperDesign';

/* ========================= the recording context ========================= */

type Op = ['c', string, unknown[]] | ['s', string, unknown];

/**
 * A stand-in for a 2D context that writes down what it was asked to do.
 *
 * A Proxy rather than a hand-written stub so the recorder cannot fall behind
 * the drawing code: a motif that starts using `ellipse` tomorrow is captured
 * without anyone remembering to add it here.
 */
function recorder(): { ops: Op[]; ctx: FlatCtx } {
  const ops: Op[] = [];
  const methods = new Map<string, (...args: unknown[]) => void>();
  const target = {} as Record<string, unknown>;
  const ctx = new Proxy(target, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      let fn = methods.get(prop);
      if (fn === undefined) {
        fn = (...args: unknown[]) => {
          ops.push(['c', prop, args]);
        };
        methods.set(prop, fn);
      }
      return fn;
    },
    set(_t, prop, value) {
      if (typeof prop === 'string') ops.push(['s', prop, value]);
      return true;
    },
  });
  return { ops, ctx: ctx as unknown as FlatCtx };
}

function recordTile(size: number, spec: WallpaperSpec): Op[] {
  const { ops, ctx } = recorder();
  renderWallpaperTile(ctx, size, spec);
  return ops;
}

/* ============================ the browser side =========================== */

/**
 * Replay an op list into a canvas, abut two copies of the result, and report
 * how different the seam is from the worst pair of neighbouring interior
 * columns (and rows).
 *
 * The ratio is the whole assertion: a tile sampled off a torus makes the pair
 * (last column, first column) just another adjacent pair, so the ratio lands
 * near 1. A tile whose content stops at the edge makes that pair the largest
 * jump in the image by a wide margin.
 *
 * `inset` reproduces exactly that failure without touching the module: draw the
 * tile that much larger and cut the middle out, so the result is the same art
 * with no wrap guarantee. It is the control that proves the metric has teeth.
 */
const PROBE = `
window.__probe = function (size, ops, inset) {
  const draw = (target) => {
    const drawSize = target + inset * 2;
    const c = document.createElement('canvas');
    c.width = drawSize; c.height = drawSize;
    const g = c.getContext('2d');
    for (const op of ops) {
      if (op[0] === 's') g[op[1]] = op[2];
      else g[op[1]].apply(g, op[2]);
    }
    if (inset === 0) return c;
    const out = document.createElement('canvas');
    out.width = target; out.height = target;
    out.getContext('2d').drawImage(c, inset, inset, target, target, 0, 0, target, target);
    return out;
  };
  const tile = draw(size);

  const pair = (img, a, b, axis) => {
    let sum = 0;
    const n = axis === 'x' ? img.height : img.width;
    for (let i = 0; i < n; i++) {
      const p = axis === 'x' ? ((i * img.width + a) * 4) : ((a * img.width + i) * 4);
      const q = axis === 'x' ? ((i * img.width + b) * 4) : ((b * img.width + i) * 4);
      sum += Math.abs(img.data[p] - img.data[q])
           + Math.abs(img.data[p + 1] - img.data[q + 1])
           + Math.abs(img.data[p + 2] - img.data[q + 2]);
    }
    return sum / (n * 3);
  };

  const abut = (w, h, dx, dy) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(tile, 0, 0);
    g.drawImage(tile, dx, dy);
    return g.getImageData(0, 0, w, h);
  };

  const wide = abut(size * 2, size, size, 0);
  const tall = abut(size, size * 2, 0, size);
  const seamX = pair(wide, size - 1, size, 'x');
  const seamY = pair(tall, size - 1, size, 'y');
  let intX = 0, intY = 0;
  for (let i = 1; i < size - 2; i++) {
    intX = Math.max(intX, pair(wide, i, i + 1, 'x'));
    intY = Math.max(intY, pair(tall, i, i + 1, 'y'));
  }
  // A flat pattern has no interior variation to compare against; there the
  // seam difference is judged in absolute terms instead.
  const rx = intX > 0.05 ? seamX / intX : seamX;
  const ry = intY > 0.05 ? seamY / intY : seamY;
  return { seamX, seamY, intX, intY, ratio: Math.max(rx, ry) };
};
`;

interface Probe {
  seamX: number;
  seamY: number;
  intX: number;
  intY: number;
  ratio: number;
}

let page: { evaluate: (fn: string) => Promise<unknown> } | null = null;
let browser: { close: () => Promise<void> } | null = null;

async function openBrowser(): Promise<boolean> {
  try {
    const { chromium } = (await import('playwright')) as {
      chromium: {
        launch: () => Promise<{
          close: () => Promise<void>;
          newPage: () => Promise<Record<string, (...a: never[]) => Promise<unknown>>>;
        }>;
      };
    };
    const b = await chromium.launch();
    const p = (await b.newPage()) as unknown as {
      setContent: (html: string) => Promise<void>;
      addScriptTag: (o: { content: string }) => Promise<unknown>;
      evaluate: (fn: string) => Promise<unknown>;
    };
    await p.setContent('<body></body>');
    await p.addScriptTag({ content: PROBE });
    browser = b;
    page = p;
    return true;
  } catch {
    return false;
  }
}

/**
 * Measure one tile. `inset > 0` renders it that much larger and cuts the middle
 * out — the control described on {@link PROBE}.
 */
async function probe(size: number, spec: WallpaperSpec, inset = 0): Promise<Probe> {
  const ops = recordTile(size + inset * 2, spec);
  const payload = JSON.stringify(ops);
  // Passed as source rather than as an argument: the op list is large, and a
  // single expression avoids Playwright serialising it twice.
  const result = await page!.evaluate(`window.__probe(${size}, ${payload}, ${inset})`);
  return result as Probe;
}

/* ============================ structural tests =========================== */

describe('wallpaper presets', () => {
  it('offers at least fifty papers, all with unique ids', () => {
    expect(WALLPAPER_PRESETS.length).toBeGreaterThanOrEqual(50);
    const ids = new Set(WALLPAPER_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(WALLPAPER_PRESETS.length);
  });

  it('every preset names a real value on every axis', () => {
    for (const preset of WALLPAPER_PRESETS) {
      expect(WALLPAPER_PATTERNS).toContain(preset.spec.pattern);
      expect(WALLPAPER_SCALES).toContain(preset.spec.scale);
      expect(WALLPAPER_DEPTHS).toContain(preset.spec.depth);
      expect(WALLPAPER_INKS).toContain(preset.spec.ink);
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.blurb.length).toBeGreaterThan(0);
    }
  });

  it('uses every pattern at least once — an unreachable motif is dead art', () => {
    const used = new Set(WALLPAPER_PRESETS.map((p) => p.spec.pattern));
    for (const pattern of WALLPAPER_PATTERNS) expect(used).toContain(pattern);
  });

  it('falls back to the plain wall for an id it does not know', () => {
    expect(getWallpaper('sakura-pavilion-1998').id).toBe(DEFAULT_WALLPAPER_ID);
    expect(getWallpaper(null).id).toBe(DEFAULT_WALLPAPER_ID);
    expect(getWallpaper(undefined).id).toBe(DEFAULT_WALLPAPER_ID);
    expect(isWallpaperId('sakura-pavilion-1998')).toBe(false);
    expect(isWallpaperId(DEFAULT_WALLPAPER_ID)).toBe(true);
    expect(wallpaperSpec(DEFAULT_WALLPAPER_ID).pattern).toBe('plain');
  });

  it('honours the four names settings.wallpaperPattern has been storing', () => {
    // The setting was live in the picker the whole time the wall was a flat
    // tint. Landing those readers on a bare wall would look like their choice
    // had been discarded.
    expect(getWallpaper('damask').spec.pattern).toBe('damask');
    expect(getWallpaper('stars').spec.pattern).toBe('star');
    expect(getWallpaper('botanical').spec.pattern).toBe('sprig');
    expect(getWallpaper('plain').id).toBe(DEFAULT_WALLPAPER_ID);
    expect(isWallpaperId('botanical')).toBe(true);
  });
});

describe('wallpaper colour', () => {
  afterAll(() => setFlatScheme(null));

  it('takes the ground straight from the live scheme', () => {
    for (const id of ['athenaeum', 'reef', 'apothecary'] as const) {
      setFlatScheme(getTheme(id).scheme);
      for (const preset of WALLPAPER_PRESETS) {
        expect(wallpaperColours(preset.spec).ground).toBe(flatScheme().wall);
      }
    }
  });

  it('never paints the motif in the ground colour — a repeat has to be visible', () => {
    setFlatScheme(null);
    for (const preset of WALLPAPER_PRESETS) {
      if (preset.spec.pattern === 'plain') continue;
      const c = wallpaperColours(preset.spec);
      expect(c.face).not.toBe(c.ground);
      expect(c.ink).not.toBe(c.ground);
    }
  });
});

describe('wallpaper cache key', () => {
  afterAll(() => setFlatScheme(null));

  it('carries the scheme tag, so a room change cannot serve stale art', () => {
    const spec = wallpaperSpec('damask-athenaeum');
    setFlatScheme(null);
    const house = wallpaperTileKey(spec, 256);
    setFlatScheme(getTheme('reef').scheme);
    expect(wallpaperTileKey(spec, 256)).not.toBe(house);
    setFlatScheme(null);
    expect(wallpaperTileKey(spec, 256)).toBe(house);
  });

  it('separates every axis, size and dpr', () => {
    const base = wallpaperSpec('damask-athenaeum');
    const keys = new Set([
      wallpaperTileKey(base, 256),
      wallpaperTileKey({ ...base, pattern: 'trellis' }, 256),
      wallpaperTileKey({ ...base, scale: 'petite' }, 256),
      wallpaperTileKey({ ...base, depth: 'flat' }, 256),
      wallpaperTileKey({ ...base, ink: 'gilt' }, 256),
      wallpaperTileKey(base, 512),
      wallpaperTileKey(base, 256, 2),
    ]);
    expect(keys.size).toBe(7);
  });
});

describe('wallpaper tile size', () => {
  it('stays in a bakeable range and grows with the scale', () => {
    for (const preset of WALLPAPER_PRESETS) {
      const px = wallpaperTilePx(preset.spec);
      expect(px).toBeGreaterThanOrEqual(96);
      expect(px).toBeLessThanOrEqual(768);
      expect(Number.isInteger(px)).toBe(true);
    }
    // dpr multiplies, so a HiDPI bake is a bigger texture and a different key.
    const spec = wallpaperSpec('damask-athenaeum');
    expect(wallpaperTilePx(spec, 2)).toBe(wallpaperTilePx(spec, 1) * 2);
  });
});

/* =============================== the seam =============================== */

const ready = await openBrowser();

afterAll(async () => {
  await browser?.close();
});

describe.skipIf(!ready)('wallpaper tiles are seamless', () => {
  beforeAll(() => setFlatScheme(null));
  afterAll(() => setFlatScheme(null));

  /**
   * The bar, and why it is not simply 1.
   *
   * A tile sampled off a torus has `size` adjacent column pairs and the seam is
   * one of them, so it can perfectly legitimately be the busiest — and for the
   * grand damask it is, because the lattice puts a motif centre exactly on the
   * edge and the motif's widest point lands there. Demanding `seam <= max
   * interior` would be demanding that the seam never win a fair draw.
   *
   * Measured rather than guessed: across all 55 presets at both sizes the worst
   * real tile is 1.28, and the cropped control (same art, edges deliberately not
   * lined up) is 2.6 to 5.2. 1.6 sits in that gap with room on both sides.
   */
  const CLEAN = 1.6;

  it.each(WALLPAPER_PRESETS.map((p) => [p.id, p.spec] as const))(
    '%s tiles without a seam',
    async (_id, spec) => {
      for (const size of [128, 192]) {
        const m = await probe(size, spec);
        expect(m.ratio).toBeLessThan(CLEAN);
      }
    },
    30_000,
  );

  it(
    'the same measurement catches a tile that does NOT wrap',
    async () => {
      // Same art, drawn larger and cropped, so nothing lines up across the
      // edge. If this passed, the test above would be measuring nothing.
      //
      // Three insets, worst taken: a single one can land within a pixel of the
      // pattern's own row pitch and re-align by accident — 44px very nearly
      // cancels the scallop's 46.7px rows — which would make the control look
      // clean for a reason that has nothing to do with the module.
      for (const pattern of ['damask', 'herringbone', 'scallop', 'bird'] as const) {
        const spec: WallpaperSpec = { pattern, scale: 'medium', depth: 'raised', ink: 'timber' };
        let worst = 0;
        for (const inset of [23, 44, 61]) {
          worst = Math.max(worst, (await probe(192, spec, inset)).ratio);
        }
        expect(worst).toBeGreaterThan(CLEAN);
      }
    },
    30_000,
  );

  it(
    'holds at an awkward tile size the lattice has to be refitted to',
    async () => {
      // Nothing about 137 divides anything. The lattice is fitted to the tile
      // rather than the tile to the lattice precisely so this works.
      for (const pattern of WALLPAPER_PATTERNS) {
        const m = await probe(137, { pattern, scale: 'small', depth: 'carved', ink: 'cloth' });
        expect(m.ratio).toBeLessThan(CLEAN);
      }
    },
    60_000,
  );

  it(
    'holds in every room, since the colours come from the live scheme',
    async () => {
      for (const id of ['blossom', 'reef', 'apothecary'] as const) {
        setFlatScheme(getTheme(id).scheme);
        for (const pattern of ['damask', 'toile', 'honeycomb'] as const) {
          const m = await probe(160, { pattern, scale: 'medium', depth: 'raised', ink: 'timber' });
          expect(m.ratio).toBeLessThan(CLEAN);
        }
      }
      setFlatScheme(null);
    },
    60_000,
  );
});
