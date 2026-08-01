/**
 * tests/book-bindings.test.ts — the gate on `art/bookDesign.ts`.
 *
 * Fifty silhouettes × fifty coverings × fifty ornaments is a hundred and
 * twenty-five thousand pictures. Nobody is going to look at those, so the
 * questions that would otherwise be answered by looking get answered here
 * instead, over a large deterministic sample, against a real rasterizer
 * (`tests/support/flatRaster.ts`) drawing onto a MAGENTA ground:
 *
 *  1. **No holes.** A silhouette that fails to close leaves the ground showing
 *     through the middle of the book. Magenta is a colour the palette cannot
 *     produce, so "still showing the ground" is exactly "nothing was drawn
 *     here" with no chance of a legitimately drawn cream being mistaken for a
 *     hole.
 *
 *  2. **No ink off the bitmap.** Every shape is measured INWARD from the slot
 *     the shelf composer gave it, so a gable's peak lands on the top of the
 *     slot rather than above it. Anything drawn past a small allowance for the
 *     three deliberate overhangs (a yapp lip, a scroll's knobs, a ribbon) would
 *     be cropped by the atlas bake and read as a book with its head sawn off.
 *
 *  3. **The lettering band is never struck through.** The strong form: the same
 *     book is drawn twice, once dressed and once with its ornament, its cords
 *     and its endbands taken away, and the rectangle the caller reserved for
 *     the title must come out PIXEL IDENTICAL. The covering and the binding's
 *     own furniture are in both draws and cancel, so any difference inside that
 *     rectangle is tooling that has landed on the title.
 *
 * And the quality question the counts cannot answer — **is the fiftieth entry
 * actually a different picture from the first** — is asked directly: every
 * shape, every covering and every ornament is rendered in isolation and its
 * pixels hashed, and the hashes must all be distinct. An entry that differs
 * from its neighbour by a number rather than by a drawing fails here.
 *
 * Set `BOOK_SPECIMENS=1` to also write specimen boards to the scratchpad and
 * look at them; the assertions only catch the ones that are broken, never the
 * ones that are ugly.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BOOK_PRESETS,
  BOOK_PRESET_IDS,
  BOOK_TAGS,
  DECORATIONS,
  DECORATION_LABELS,
  DECORS,
  MATERIALS,
  MATERIAL_LOOKS,
  MATERIAL_LOOK_LABELS,
  SHAPES,
  SHAPE_LABELS,
  SPINE_SHAPES,
  bindingMaterialFor,
  bookDesignTag,
  bookLabelBox,
  bookPreset,
  bookSpineBoxes,
  drawBookSpine,
  isBookPresetId,
  materialLookFor,
  presetForSeed,
  resolveBookDesign,
  type BookDesign,
  type Decoration,
  type MaterialLook,
  type SpineShape,
} from '../src/art/bookDesign';
import { createRaster, encodePng, type Raster } from './support/flatRaster';

/* -------------------------------------------------------------------------- *
 *                                  the rig                                    *
 * -------------------------------------------------------------------------- */

/** A colour the warm-parchment palette cannot produce. */
const GROUND = '#ff00ff';

/** True shelf proportions: a spine is ~20–45 world px wide and ~200 tall. */
const W = 34;
const H = 200;
/** Room round the slot, so anything drawn outside it is visible rather than lost. */
const PAD = 26;

interface Shot {
  raster: Raster;
  design: BookDesign;
  /** The slot, in raster coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
}

function paint(
  design: BookDesign,
  opts: { w?: number; h?: number; reserved?: { y0: number; y1: number } | null } = {},
): Shot {
  const w = opts.w ?? W;
  const h = opts.h ?? H;
  const raster = createRaster(w + PAD * 2, h + PAD * 2, GROUND);
  drawBookSpine(raster.ctx as never, PAD, PAD, w, h, design, {
    reserved: opts.reserved ?? null,
    ownLabel: true,
    noContact: true,
  });
  return { raster, design, x: PAD, y: PAD, w, h };
}

/** A cheap order-sensitive hash of every pixel, for "are these two different?". */
function hashPixels(raster: Raster): string {
  let a = 0x811c9dc5;
  for (let i = 0; i < raster.data.length; i++) {
    a ^= raster.data[i] as number;
    a = Math.imul(a, 0x01000193);
  }
  return (a >>> 0).toString(36);
}

/** A design pinned to one preset, with everything else held still. */
function designOf(over: Partial<BookDesign> = {}): BookDesign {
  return { ...resolveBookDesign({ seed: 0x51e5, cloth: 3, accent: 11 }), ...over };
}

/* -------------------------------------------------------------------------- *
 *                             the three gates                                 *
 * -------------------------------------------------------------------------- */

/** Gate 1: the middle of the book is painted, and most of its box is too. */
function assertNoHoles(shot: Shot, what: string): void {
  const { raster, design } = shot;
  const { body } = bookSpineBoxes(design, shot.x, shot.y, shot.w, shot.h);
  // The core: the middle half of the width, and the middle three fifths of the
  // height. No end profile reaches a fifth of the way down, and no width
  // profile takes a quarter off a side, so every pixel of this is body.
  const x0 = Math.ceil(body.x + body.w * 0.28);
  const x1 = Math.floor(body.x + body.w * 0.72);
  const y0 = Math.ceil(body.y + body.h * 0.21);
  const y1 = Math.floor(body.y + body.h * 0.79);
  const holes: string[] = [];
  for (let y = y0; y <= y1 && holes.length < 4; y++) {
    for (let x = x0; x <= x1 && holes.length < 4; x++) {
      if (raster.isGround(x, y)) holes.push(`(${x - shot.x},${y - shot.y})`);
    }
  }
  expect(holes, `${what}: ground showing through the body at ${holes.join(' ')}`).toEqual([]);

  // …and the box as a whole is mostly covered, which catches a silhouette that
  // closed but collapsed.
  let covered = 0;
  let total = 0;
  for (let y = Math.ceil(body.y); y < body.y + body.h; y++) {
    for (let x = Math.ceil(body.x); x < body.x + body.w; x++) {
      total++;
      if (!raster.isGround(x, y)) covered++;
    }
  }
  expect(covered / Math.max(1, total), `${what}: only ${covered}/${total} of the body box drawn`)
    .toBeGreaterThan(0.62);
}

/** Gate 2: nothing is drawn beyond the slot plus the deliberate overhangs. */
function assertInsideBitmap(shot: Shot, what: string): void {
  const { raster } = shot;
  // A yapp lip stands 3% of the height above the head, a ribbon 4%, a scroll's
  // knobs 10% of the width to each side. Plus an ink line and a pixel of slack.
  const mx = shot.w * 0.14 + 4;
  const myTop = shot.h * 0.07 + 4;
  const myBottom = shot.h * 0.03 + 4;
  const strays: string[] = [];
  for (let y = 0; y < raster.height && strays.length < 4; y++) {
    for (let x = 0; x < raster.width && strays.length < 4; x++) {
      const outside =
        x < shot.x - mx ||
        x > shot.x + shot.w + mx ||
        y < shot.y - myTop ||
        y > shot.y + shot.h + myBottom;
      if (outside && !raster.isGround(x, y)) strays.push(`(${x - shot.x},${y - shot.y})`);
    }
  }
  expect(strays, `${what}: drew outside the slot at ${strays.join(' ')}`).toEqual([]);
}

/**
 * Gate 3: the reserved lettering rectangle is untouched by tooling.
 *
 * Drawn twice — dressed, and stripped of ornament, cords and endbands — with
 * the SAME reserved rectangle handed to both, so the covering and the shape's
 * own furniture are identical in the two and any difference is the tooling.
 */
function assertLabelBandClear(design: BookDesign, what: string): void {
  const probe = paint(design);
  const { decor } = bookSpineBoxes(design, probe.x, probe.y, probe.w, probe.h);
  const label = bookLabelBox(decor, design);
  // The whole rectangle, exactly as `spines.renderSpine` hands it over. Passing
  // only the y band made the painter fall back to guessing the plate's width
  // from a constant, so a rule sited just outside that constant — but inside
  // the plate this design actually draws — went through the title.
  const reserved = {
    y0: label.y,
    y1: label.y + label.h,
    x0: label.x,
    x1: label.x + label.w,
  };

  const dressed = paint(design, { reserved });
  const bare = paint({ ...design, decorations: ['plain'], bands: 0, headTail: null }, { reserved });

  const struck: string[] = [];
  const x0 = Math.ceil(label.x);
  const x1 = Math.floor(label.x + label.w);
  const y0 = Math.ceil(label.y);
  const y1 = Math.floor(label.y + label.h);
  for (let y = y0; y <= y1 && struck.length < 4; y++) {
    for (let x = x0; x <= x1 && struck.length < 4; x++) {
      const a = dressed.raster.at(x, y);
      const b = bare.raster.at(x, y);
      if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) {
        struck.push(`(${x - probe.x},${y - probe.y})`);
      }
    }
  }
  expect(struck, `${what}: tooling struck through the lettering band at ${struck.join(' ')}`)
    .toEqual([]);
}

/* -------------------------------------------------------------------------- *
 *                              the vocabularies                               *
 * -------------------------------------------------------------------------- */

describe('the three vocabularies', () => {
  it('ships fifty silhouettes, fifty coverings and fifty ornaments', () => {
    expect(SPINE_SHAPES).toHaveLength(50);
    expect(MATERIAL_LOOKS).toHaveLength(50);
    expect(DECORATIONS).toHaveLength(50);
    expect(new Set(SPINE_SHAPES).size).toBe(50);
    expect(new Set(MATERIAL_LOOKS).size).toBe(50);
    expect(new Set(DECORATIONS).size).toBe(50);
  });

  it('gives every entry a real name, a blurb and at least two moods', () => {
    const rows = [
      ...SPINE_SHAPES.map((id) => SHAPES[id]),
      ...MATERIAL_LOOKS.map((id) => MATERIALS[id]),
      ...DECORATIONS.map((id) => DECORS[id]),
    ];
    for (const row of rows) {
      expect(row.name.length, `${row.id} has no name`).toBeGreaterThan(2);
      expect(row.blurb.length, `${row.id} has no blurb`).toBeGreaterThan(24);
      // `plain` is genuinely one mood; everything else has to be steerable by
      // at least two, or the studio's chip row cannot reach it.
      const least = row.id === 'plain' ? 2 : 2;
      expect(row.tags.length, `${row.id} carries too few moods`).toBeGreaterThanOrEqual(least);
      for (const tag of row.tags) expect(BOOK_TAGS, `${row.id}: unknown mood ${tag}`).toContain(tag);
    }
  });

  it('gives every entry a name of its own', () => {
    for (const list of [
      SPINE_SHAPES.map((id) => SHAPES[id].name),
      MATERIAL_LOOKS.map((id) => MATERIALS[id].name),
      DECORATIONS.map((id) => DECORS[id].name),
    ]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it('keeps the three label maps aligned with their id lists', () => {
    expect(Object.keys(SHAPE_LABELS).sort()).toEqual([...SPINE_SHAPES].sort());
    expect(Object.keys(MATERIAL_LOOK_LABELS).sort()).toEqual([...MATERIAL_LOOKS].sort());
    expect(Object.keys(DECORATION_LABELS).sort()).toEqual([...DECORATIONS].sort());
  });

  it('spreads the moods, so no chip is a preset with extra steps', () => {
    const counts = new Map<string, number>();
    for (const row of [
      ...SPINE_SHAPES.map((id) => SHAPES[id]),
      ...MATERIAL_LOOKS.map((id) => MATERIALS[id]),
      ...DECORATIONS.map((id) => DECORS[id]),
    ]) {
      for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    // Every word the type offers has to be reachable, and none may be so rare
    // that steering by it collapses to one answer.
    for (const tag of BOOK_TAGS) {
      expect(counts.get(tag) ?? 0, `mood "${tag}" is carried by too few entries`)
        .toBeGreaterThanOrEqual(3);
    }
  });
});

/* -------------------------------------------------------------------------- *
 *                                the presets                                  *
 * -------------------------------------------------------------------------- */

describe('the named bindings', () => {
  it('names at least a hundred and fifty of them, uniquely', () => {
    expect(BOOK_PRESETS.length).toBeGreaterThanOrEqual(150);
    expect(new Set(BOOK_PRESET_IDS).size).toBe(BOOK_PRESETS.length);
    expect(new Set(BOOK_PRESETS.map((p) => p.label)).size).toBe(BOOK_PRESETS.length);
  });

  it('points every preset at real vocabulary, with a weight and moods', () => {
    for (const p of BOOK_PRESETS) {
      expect(SPINE_SHAPES, `${p.id}: unknown shape`).toContain(p.shape);
      expect(MATERIAL_LOOKS, `${p.id}: unknown material`).toContain(p.material);
      expect(p.decorations.length, `${p.id} has no decoration list`).toBeGreaterThan(0);
      for (const d of p.decorations) expect(DECORATIONS, `${p.id}: unknown mark`).toContain(d);
      // Two is the ceiling: the caller adds a title and usually an ornament on
      // top of whatever is here, and a 30px spine with five marks is a smudge.
      expect(p.decorations.length, `${p.id} carries too many marks`).toBeLessThanOrEqual(2);
      expect(p.weight, `${p.id} has no weight`).toBeGreaterThan(0);
      expect(p.tags.length, `${p.id} carries too few moods`).toBeGreaterThanOrEqual(2);
      expect(p.label.length).toBeGreaterThan(3);
    }
  });

  it('keeps the sixty-two original ids, so nobody is silently rebound', () => {
    const original = [
      'plain-wrapper', 'stitched-pamphlet', 'offprint', 'printed-wrapper', 'chapbook',
      'plain-cloth', 'gilt-quarto', 'lettered-cloth', 'banded-cloth', 'panelled-cloth',
      'blind-cloth', 'ruled-cloth', 'rep-cloth', 'ribbed-rep', 'corded-rep',
      'foot-tooled-octavo', 'hollow-octavo', 'scalloped-primer', 'diamond-primer',
      'tight-back-prize', 'presentation-binding', 'yapp-pocket', 'library-buckram',
      'college-buckram', 'reading-room-buckram', 'gilt-buckram', 'hollow-ledger',
      'plain-buckram', 'full-morocco', 'tooled-morocco', 'blind-calf', 'panelled-calf',
      'tree-calf', 'diced-russia', 'plain-calf', 'yapp-devotional', 'cathedral-morocco',
      'antique-vellum', 'limp-vellum', 'gilt-vellum', 'vellum-ties', 'corded-vellum',
      'marbled-boards', 'combed-marble', 'shell-marble', 'spanish-wave',
      'patterned-boards', 'diaper-paper', 'block-printed', 'ribbon-almanac',
      'half-morocco', 'half-calf', 'half-cloth', 'half-roan', 'sammelband', 'tooled-tail',
      'quarter-calf', 'quarter-cloth', 'quarter-vellum', 'marbled-quarter',
      'slipcased-set', 'slipcased-folio',
    ];
    expect(original).toHaveLength(62);
    for (const id of original) expect(isBookPresetId(id), `${id} was retired`).toBe(true);
  });

  it('reaches most of the named bindings from seeds alone', () => {
    const hit = new Set<string>();
    for (let seed = 0; seed < 40000; seed++) hit.add(presetForSeed(seed).id);
    expect(hit.size).toBe(BOOK_PRESETS.length);
  });

  it('resolves total: junk in gives the first binding, never a throw', () => {
    for (const junk of [null, undefined, '', 'nope', 42, {}]) {
      expect(bookPreset(junk as never).id).toBe(BOOK_PRESETS[0]?.id);
      expect(isBookPresetId(junk)).toBe(false);
    }
    const d = resolveBookDesign({ seed: -1, cloth: -9, accent: -9, bands: 99, wear: 5 });
    expect(d.cloth).toBeGreaterThanOrEqual(0);
    expect(d.accent).not.toBe(d.cloth);
    expect(d.bands).toBe(5);
    expect(d.wear).toBe(1);
  });

  it('keeps the studio round trip honest for every covering', () => {
    for (const look of MATERIAL_LOOKS) {
      const binding = bindingMaterialFor(look);
      expect(materialLookFor(binding), `${look} → ${binding} → nothing`).toBeTruthy();
    }
    // The seven studio chips must still land on seven different pictures.
    const looks = new Set(
      ['leather', 'cloth', 'paper', 'vellum', 'linen', 'silk', 'marbled'].map(materialLookFor),
    );
    expect(looks.size).toBe(7);
  });
});

/* -------------------------------------------------------------------------- *
 *                          the cache key carries it all                       *
 * -------------------------------------------------------------------------- */

describe('the binding tag is a complete key', () => {
  it('changes with the SHAPE, colours and covering held still', () => {
    const keys = new Set(
      SPINE_SHAPES.map((shape) => bookDesignTag(designOf({ shape }))),
    );
    expect(keys.size).toBe(SPINE_SHAPES.length);
  });

  it('changes with the COVERING, shape and colours held still', () => {
    const keys = new Set(
      MATERIAL_LOOKS.map((material) => bookDesignTag(designOf({ material }))),
    );
    expect(keys.size).toBe(MATERIAL_LOOKS.length);
  });

  it('changes with the PRESET, which is what carries the ornament', () => {
    const keys = new Set(
      BOOK_PRESETS.map((p) => bookDesignTag(resolveBookDesign({ seed: 7, preset: p.id }))),
    );
    expect(keys.size).toBe(BOOK_PRESETS.length);
  });
});

/* -------------------------------------------------------------------------- *
 *                       every entry is its own picture                        *
 * -------------------------------------------------------------------------- */

describe('no entry is a neighbour with a different number', () => {
  it('draws fifty different silhouettes', () => {
    const seen = new Map<string, SpineShape>();
    for (const shape of SPINE_SHAPES) {
      const design = designOf({ shape, material: 'smooth-cloth', decorations: ['plain'] });
      const key = hashPixels(paint(design).raster);
      const twin = seen.get(key);
      expect(twin, `"${shape}" draws exactly what "${twin}" draws`).toBeUndefined();
      seen.set(key, shape);
    }
  });

  it('draws fifty different coverings', () => {
    const seen = new Map<string, MaterialLook>();
    for (const material of MATERIAL_LOOKS) {
      const design = designOf({ shape: 'square', material, decorations: ['plain'] });
      const key = hashPixels(paint(design).raster);
      const twin = seen.get(key);
      expect(twin, `"${material}" draws exactly what "${twin}" draws`).toBeUndefined();
      seen.set(key, material);
    }
  });

  it('draws fifty different ornaments', () => {
    const seen = new Map<string, Decoration>();
    for (const mark of DECORATIONS) {
      // `label-plate` is the caller's own lettering-piece and draws nothing of
      // its own here, so it is measured with the plate left in.
      const design = designOf({ shape: 'square', material: 'smooth-cloth', decorations: [mark] });
      const raster = createRaster(W + PAD * 2, H + PAD * 2, GROUND);
      drawBookSpine(raster.ctx as never, PAD, PAD, W, H, design, { noContact: true });
      const key = hashPixels(raster);
      const twin = seen.get(key);
      expect(twin, `"${mark}" draws exactly what "${twin}" draws`).toBeUndefined();
      seen.set(key, mark);
    }
  });
});

/* -------------------------------------------------------------------------- *
 *                                 the sweep                                   *
 * -------------------------------------------------------------------------- */

/**
 * A deterministic walk over the three axes at once.
 *
 * Coprime strides rather than a nested loop: 50³ draws is far too many, and a
 * nested loop truncated to a budget only ever exercises the first few rows of
 * each table. This visits all fifty of every axis, in a different pairing each
 * time, and is the same sample on every machine and every run.
 */
function sweep(count: number): { shape: SpineShape; material: MaterialLook; mark: Decoration }[] {
  const out: { shape: SpineShape; material: MaterialLook; mark: Decoration }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      shape: SPINE_SHAPES[i % 50] as SpineShape,
      material: MATERIAL_LOOKS[(i * 7) % 50] as MaterialLook,
      mark: DECORATIONS[(i * 13) % 50] as Decoration,
    });
  }
  return out;
}

/*
 * These draw hundreds of books each and take tens of seconds, so every one
 * carries its own timeout. Vitest's default is 5s and the whole block was
 * failing on it — reported as six broken bindings when nothing was broken,
 * which is the worst kind of red: it hides the one failure that IS real.
 * The sweep is the point of the gate; slow is the correct trade, not a reason
 * to shrink the sample.
 */
const DRAW_TIMEOUT = 180_000;

describe('every combination survives being drawn', () => {
  const CASES = sweep(350);

  it('closes its silhouette — no ground showing through any book', () => {
    for (const c of CASES) {
      const design = designOf({ shape: c.shape, material: c.material, decorations: [c.mark] });
      assertNoHoles(paint(design), `${c.shape} / ${c.material} / ${c.mark}`);
    }
  }, DRAW_TIMEOUT);

  it('stays inside the slot the shelf gave it', () => {
    for (const c of CASES) {
      const design = designOf({ shape: c.shape, material: c.material, decorations: [c.mark] });
      assertInsideBitmap(paint(design), `${c.shape} / ${c.material} / ${c.mark}`);
    }
  }, DRAW_TIMEOUT);

  it('never strikes tooling through the reserved lettering band', () => {
    for (const c of CASES) {
      assertLabelBandClear(
        designOf({ shape: c.shape, material: c.material, decorations: [c.mark] }),
        `${c.shape} / ${c.material} / ${c.mark}`,
      );
    }
  }, DRAW_TIMEOUT);

  it('holds with the studio turned up: five cords, endbands, foil, wear', () => {
    for (const c of sweep(120)) {
      const design = designOf({
        shape: c.shape,
        material: c.material,
        decorations: [c.mark],
        gilt: true,
        bands: 5,
        bandGilt: true,
        headTail: 1,
        wear: 0.35,
      });
      const what = `${c.shape} / ${c.material} / ${c.mark} (dressed)`;
      assertNoHoles(paint(design), what);
      assertInsideBitmap(paint(design), what);
      assertLabelBandClear(design, what);
    }
  }, DRAW_TIMEOUT);

  it('holds at both ends of the width range a spine is baked at', () => {
    for (const w of [20, 45]) {
      for (const c of sweep(100)) {
        const design = designOf({ shape: c.shape, material: c.material, decorations: [c.mark] });
        const shot = paint(design, { w, h: w * 6 });
        assertNoHoles(shot, `${c.shape} / ${c.material} / ${c.mark} @${w}px`);
        assertInsideBitmap(shot, `${c.shape} / ${c.material} / ${c.mark} @${w}px`);
      }
    }
  }, DRAW_TIMEOUT);

  it('draws every NAMED binding without a hole or a stray mark', () => {
    for (const p of BOOK_PRESETS) {
      const design = resolveBookDesign({ seed: 0xbeef, preset: p.id, cloth: 5, accent: 19 });
      assertNoHoles(paint(design), p.id);
      assertInsideBitmap(paint(design), p.id);
      assertLabelBandClear(design, p.id);
    }
  }, DRAW_TIMEOUT);

  it('is deterministic — the same book is the same pixels', () => {
    for (const c of sweep(40)) {
      const design = designOf({ shape: c.shape, material: c.material, decorations: [c.mark] });
      expect(hashPixels(paint(design).raster)).toBe(hashPixels(paint(design).raster));
    }
  }, DRAW_TIMEOUT);
});

/* -------------------------------------------------------------------------- *
 *                             the specimen boards                             *
 * -------------------------------------------------------------------------- */

/**
 * Not an assertion — a way to LOOK.
 *
 * A gate proves nothing is broken and says nothing about whether anything is
 * handsome, and these tables were judged by opening these boards. Off by
 * default because a test suite should not write files.
 */
describe.runIf(process.env.BOOK_SPECIMENS === '1')('specimen boards', () => {
  const out = process.env.BOOK_SPECIMEN_DIR ?? join(process.cwd(), 'shots-now', 'bookdesign');

  function board(
    name: string,
    cells: readonly { design: BookDesign; }[],
    cols: number,
  ): void {
    const cw = W + 22;
    const ch = H + 30;
    const rows = Math.ceil(cells.length / cols);
    const raster = createRaster(cols * cw, rows * ch, '#efe6d6');
    cells.forEach((cell, i) => {
      const cx = (i % cols) * cw + 11;
      const cy = Math.floor(i / cols) * ch + 15;
      drawBookSpine(raster.ctx as never, cx, cy, W, H, cell.design, { noContact: false });
    });
    const file = join(out, `${name}.png`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, encodePng(raster));
  }

  it('writes one board per axis, plus the named bindings', () => {
    board(
      'shapes',
      SPINE_SHAPES.map((shape) => ({
        design: designOf({ shape, material: 'smooth-cloth', decorations: ['gilt-bands'] }),
      })),
      10,
    );
    board(
      'materials',
      MATERIAL_LOOKS.map((material) => ({
        design: designOf({ shape: 'square', material, decorations: ['plain'] }),
      })),
      10,
    );
    board(
      'decorations',
      DECORATIONS.map((mark) => ({
        design: designOf({ shape: 'square', material: 'smooth-cloth', decorations: [mark] }),
      })),
      10,
    );
    for (let page = 0; page * 60 < BOOK_PRESETS.length; page++) {
      board(
        `presets-${page + 1}`,
        BOOK_PRESETS.slice(page * 60, page * 60 + 60).map((p, i) => ({
          design: resolveBookDesign({ seed: 0x1000 + i * 977, preset: p.id }),
        })),
        10,
      );
    }
    expect(true).toBe(true);
  });
});
