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
  WALLPAPER_EDGES,
  WALLPAPER_FAMILIES,
  WALLPAPER_INKS,
  WALLPAPER_MOODS,
  WALLPAPER_PATTERNS,
  WALLPAPER_PRESETS,
  WALLPAPER_SCALES,
  WALLPAPER_TONES,
  getWallpaper,
  isWallpaperId,
  renderWallpaperTile,
  wallpaperAxisKey,
  wallpaperColours,
  wallpaperFamily,
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
  it('offers exactly fifty papers, all with unique ids', () => {
    // Exactly, not "at least": the number is the shape of the book, and the
    // fifty-five that preceded it were fifty-five because nobody was counting.
    expect(WALLPAPER_PRESETS.length).toBe(50);
    const ids = new Set(WALLPAPER_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(WALLPAPER_PRESETS.length);
  });

  it('every preset names a real value on every axis', () => {
    for (const preset of WALLPAPER_PRESETS) {
      expect(WALLPAPER_PATTERNS).toContain(preset.spec.pattern);
      expect(WALLPAPER_SCALES).toContain(preset.spec.scale);
      expect(WALLPAPER_DEPTHS).toContain(preset.spec.depth);
      expect(WALLPAPER_INKS).toContain(preset.spec.ink);
      if (preset.spec.tone !== undefined) expect(WALLPAPER_TONES).toContain(preset.spec.tone);
      if (preset.spec.edge !== undefined) expect(WALLPAPER_EDGES).toContain(preset.spec.edge);
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.blurb.length).toBeGreaterThan(0);
      expect(preset.family).toBe(wallpaperFamily(preset.spec.pattern));
    }
  });

  it('uses every pattern at least once — an unreachable motif is dead art', () => {
    const used = new Set(WALLPAPER_PRESETS.map((p) => p.spec.pattern));
    for (const pattern of WALLPAPER_PATTERNS) expect(used).toContain(pattern);
  });

  it('spreads evenly across the families, which is the point of the number', () => {
    // The complaint the rebalance answered: twelve geometrics against five
    // scenics, so the picker's geometry section scrolled and its scenic
    // section fitted on one row. Seven each, eight for the family carrying
    // four motifs. A drift of one is a mistake, not a decision.
    const counts = new Map<string, number>();
    for (const preset of WALLPAPER_PRESETS) {
      counts.set(preset.family, (counts.get(preset.family) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([...WALLPAPER_FAMILIES].sort());
    for (const n of counts.values()) {
      expect(n).toBeGreaterThanOrEqual(7);
      expect(n).toBeLessThanOrEqual(8);
    }
    // And no motif hogs its family either.
    const perPattern = new Map<string, number>();
    for (const preset of WALLPAPER_PRESETS) {
      perPattern.set(preset.spec.pattern, (perPattern.get(preset.spec.pattern) ?? 0) + 1);
    }
    for (const n of perPattern.values()) expect(n).toBeLessThanOrEqual(3);
  });

  it('tags every paper from the closed mood vocabulary, none of them rare', () => {
    const counts = new Map<string, number>();
    for (const preset of WALLPAPER_PRESETS) {
      expect(preset.tags.length).toBeGreaterThanOrEqual(2);
      for (const tag of preset.tags) {
        expect(WALLPAPER_MOODS).toContain(tag);
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    // A mood only one or two papers carry narrows a steered roll to a single
    // answer, which is a preset with extra steps. Every word has to be a real
    // filter, and every word in the vocabulary has to be used at all.
    for (const mood of WALLPAPER_MOODS) {
      expect(counts.get(mood) ?? 0).toBeGreaterThanOrEqual(4);
    }
  });

  it('never ships two papers that differ only in tone or edge', () => {
    // `features/bookshelf/world.ts` decides "is the reader looking at a
    // different paper" from the four ORIGINAL axes. Until it moves to
    // `wallpaperAxisKey`, two presets that agree on those four would swap the
    // stored spec without re-baking, and the wall would not change. Keeping
    // the four-axis projection unique makes that impossible to hit from the
    // picker, whatever the consumer does.
    const seen = new Set(
      WALLPAPER_PRESETS.map((p) => `${p.spec.pattern}.${p.spec.scale}.${p.spec.depth}.${p.spec.ink}`),
    );
    expect(seen.size).toBe(WALLPAPER_PRESETS.length);
  });

  it('keeps the retired ids pointing somewhere real', () => {
    // Five and a half dozen presets became fifty, and a saved id that resolves
    // to nothing highlights the plain wall — which reads as the reader's
    // choice having been discarded.
    for (const old of ['stripe-awning', 'herring-carved', 'damask-quiet', 'bird-gilt', 'moon-deep']) {
      expect(isWallpaperId(old)).toBe(true);
      expect(getWallpaper(old).id).not.toBe(DEFAULT_WALLPAPER_ID);
    }
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
      // The two colours added for the detail pass have the same job to do.
      expect(c.accent).not.toBe(c.face);
      expect(c.bloom).not.toBe(c.face);
    }
  });

  it('gives the element colour its own axis, independent of the ink', () => {
    // The whole point of `tone`: the same wash, a different berry. Before it
    // existed, changing the detail meant changing the motif's colour with it.
    setFlatScheme(null);
    const base: WallpaperSpec = { pattern: 'laurel', scale: 'medium', depth: 'flat', ink: 'paper' };
    const seen = new Set<string>();
    for (const tone of WALLPAPER_TONES) {
      const c = wallpaperColours({ ...base, tone });
      expect(c.face).toBe(wallpaperColours(base).face);
      seen.add(c.accent);
    }
    // Every tone has to actually land somewhere different, or it is a knob
    // with nothing behind it.
    expect(seen.size).toBe(WALLPAPER_TONES.length);
  });

  it('moves the outline, not a blur, when the edge sharpens', () => {
    setFlatScheme(null);
    const base: WallpaperSpec = { pattern: 'damask', scale: 'medium', depth: 'flat', ink: 'timber' };
    const inks = WALLPAPER_EDGES.map((edge) => wallpaperColours({ ...base, edge }).ink);
    expect(new Set(inks).size).toBe(WALLPAPER_EDGES.length);
    // Etched is the darkest line and blotted the palest — the order is the
    // control, not just the fact that they differ.
    const lum = (hex: string): number => Number.parseInt(hex.slice(1, 3), 16);
    for (let i = 1; i < inks.length; i++) expect(lum(inks[i]!)).toBeGreaterThan(lum(inks[i - 1]!));
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
      wallpaperTileKey({ ...base, tone: 'berry' }, 256),
      wallpaperTileKey({ ...base, edge: 'blotted' }, 256),
      wallpaperTileKey(base, 512),
      wallpaperTileKey(base, 256, 2),
    ]);
    expect(keys.size).toBe(9);
  });

  it('an axis absent from the key is an axis the disk cache eats', () => {
    // The guard that makes the rule enforceable rather than remembered: every
    // field of the spec has to move the key. A new axis added without touching
    // `wallpaperAxisKey` fails here rather than three months later, as a
    // reader whose new choice silently does nothing.
    const base = wallpaperSpec('damask-athenaeum');
    const full: Required<WallpaperSpec> = { ...base, tone: 'auto', edge: 'crisp' };
    const alt: Required<WallpaperSpec> = {
      pattern: 'toile',
      scale: 'petite',
      depth: 'carved',
      ink: 'cloth',
      tone: 'berry',
      edge: 'blotted',
    };
    for (const field of Object.keys(full) as (keyof WallpaperSpec)[]) {
      const nudged = { ...full, [field]: alt[field] };
      expect(wallpaperAxisKey(nudged)).not.toBe(wallpaperAxisKey(full));
      expect(wallpaperTileKey(nudged, 256)).not.toBe(wallpaperTileKey(full, 256));
    }
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
   * Measured rather than guessed: across all fifty presets at both sizes the
   * worst real tile is 1.05, and it only reaches that because the grand damask
   * puts a motif's widest point on the edge. 1.6 leaves half again as much room
   * as anything in the book actually uses.
   *
   * The control below no longer uses this ratio at all — see the note there.
   * Dividing by the busiest interior column pair is a fair test on a pattern
   * with wall showing through it and a useless one on a pattern that is nothing
   * but hard edges, and the parquet is the second kind.
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
      // Judged on the raw seam DIFFERENCE, not on the ratio the test above
      // uses, and that is the lesson of the parquet: `ratio` divides by the
      // busiest interior column pair, so on a pattern whose interior is full
      // of hard edges — a herringbone floor is nothing but hard edges — a
      // thoroughly broken seam still scores 0.4. Comparing the same quantity
      // on the same art before and after breaking it cancels the pattern's own
      // contrast out entirely, and the separation is then an order of
      // magnitude rather than a hair.
      //
      // Three insets, worst taken: a single one can land within a pixel of the
      // pattern's own row pitch and re-align by accident — 44px very nearly
      // cancels the scallop's 46.7px rows — which would make the control look
      // clean for a reason that has nothing to do with the module.
      for (const pattern of ['damask', 'herringbone', 'scallop', 'bird', 'arch'] as const) {
        const spec: WallpaperSpec = { pattern, scale: 'medium', depth: 'raised', ink: 'timber' };
        const clean = await probe(192, spec);
        let worst = 0;
        for (const inset of [23, 44, 61]) {
          const m = await probe(192, spec, inset);
          worst = Math.max(worst, m.seamX, m.seamY);
        }
        expect(worst).toBeGreaterThan(3);
        expect(worst).toBeGreaterThan(Math.max(clean.seamX, clean.seamY) * 3);
      }
    },
    60_000,
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
    'holds under the heaviest nib, which is the one that overruns a span',
    async () => {
      // `blotted` strokes at nearly twice the crisp weight, so every mark's
      // ink reaches further than the span that was measured for it. A span
      // that forgets the nib is a mark that fails to wrap — the one bug in the
      // emitter that produces a seam rather than a wobble.
      for (const pattern of WALLPAPER_PATTERNS) {
        const m = await probe(151, {
          pattern,
          scale: 'medium',
          depth: 'raised',
          ink: 'timber',
          tone: 'berry',
          edge: 'blotted',
        });
        expect(m.ratio).toBeLessThan(CLEAN);
      }
    },
    60_000,
  );

  it(
    'closes the phase of every motif that alternates by cell',
    async () => {
      // A harlequin's two colours, a honeycomb's capped cells, a bird's
      // facing, a laurel's mirror: each is a period-2 pattern laid on the
      // lattice, and an odd count puts the wrong phase against the seam. This
      // is the test for `PatternPlan.parity` — before it, the court harlequin
      // showed exactly one gold diamond per tile.
      for (const pattern of ['harlequin', 'honeycomb', 'bird', 'laurel'] as const) {
        for (const size of [123, 160, 211]) {
          const m = await probe(size, { pattern, scale: 'small', depth: 'low', ink: 'recess' });
          expect(m.ratio).toBeLessThan(CLEAN);
        }
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
