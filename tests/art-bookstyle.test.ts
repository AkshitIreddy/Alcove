/**
 * tests/art-bookstyle.test.ts — the Book Studio's merge contract.
 *
 * `resolveBookStyle` is the one door every book's look goes through, and it
 * takes user data straight out of a `cover_meta` JSON blob. So the three
 * things worth pinning down are: it is deterministic, it never throws on
 * garbage, and an explicit override always beats the theme (library-themes §4:
 * "a user's favourite red leather book keeps its identity in every room").
 */

import { describe, expect, it } from 'vitest';

import {
  CHARMS,
  CHARM_COLORS,
  CHARM_COLOR_LABELS,
  CHARM_LABELS,
  isCharmKind,
} from '../src/art/charms';
import {
  BINDING_MATERIALS,
  EDGE_LABELS,
  EDGE_TREATMENTS,
  MATERIAL_LABELS,
  MAX_RAISED_BANDS,
  ORNAMENT_COUNT,
  ORNAMENT_LABELS,
  ORNAMENT_NONE,
  PIGMENT_COUNT,
  PIGMENT_LABELS,
  SPINE_FORMATS,
  SPINE_FORMAT_IDS,
  SPINE_HEIGHT_RANGE,
  SPINE_THICKNESS_RANGE,
  TITLE_FONTS,
  TITLE_PLATES,
  TITLE_PLATE_LABELS,
  bookStyleToOverrides,
  formatForHeight,
  heightForFormat,
  normalizeBookStyleOverrides,
  normalizeThemeDefaults,
  randomBookStyleOverrides,
  resolveBookStyle,
  thicknessFromPageCount,
  type BookStyle,
} from '../src/art/bookStyle';

const SEEDS = [0, 1, 7, 42, 1337, 0xbeef, 0xfeedface, 0xffffffff];

/* ------------------------------- vocabulary ------------------------------- */

describe('studio vocabulary', () => {
  it('ships the six binding materials the spec names', () => {
    expect([...BINDING_MATERIALS].sort()).toEqual(
      ['cloth', 'leather', 'linen', 'paper', 'silk', 'vellum'].sort(),
    );
  });

  it('ships 12 pigments, 12 ornaments, 4 plates, 4 edges, 6 charms', () => {
    expect(PIGMENT_COUNT).toBe(12);
    expect(ORNAMENT_COUNT).toBe(12);
    expect(TITLE_PLATES).toHaveLength(4);
    expect(EDGE_TREATMENTS).toHaveLength(4);
    expect(CHARMS.filter((c) => c !== 'none')).toHaveLength(6);
    expect(MAX_RAISED_BANDS).toBe(5);
  });

  it('has a display label for every value the studio can show', () => {
    expect(PIGMENT_LABELS).toHaveLength(PIGMENT_COUNT);
    expect(ORNAMENT_LABELS).toHaveLength(ORNAMENT_COUNT);
    expect(CHARM_COLOR_LABELS).toHaveLength(CHARM_COLORS.length);
    for (const m of BINDING_MATERIALS) expect(MATERIAL_LABELS[m]).toBeTruthy();
    for (const p of TITLE_PLATES) expect(TITLE_PLATE_LABELS[p]).toBeTruthy();
    for (const e of EDGE_TREATMENTS) expect(EDGE_LABELS[e]).toBeTruthy();
    for (const c of CHARMS) expect(CHARM_LABELS[c]).toBeTruthy();
    const all = [
      ...PIGMENT_LABELS,
      ...ORNAMENT_LABELS,
      ...CHARM_COLOR_LABELS,
      ...Object.values(MATERIAL_LABELS),
    ];
    expect(all.every((l) => l.trim().length > 0)).toBe(true);
  });

  it('every charm kind round-trips through its guard', () => {
    for (const c of CHARMS) expect(isCharmKind(c)).toBe(true);
    expect(isCharmKind('sticker')).toBe(false);
    expect(isCharmKind(undefined)).toBe(false);
  });
});

/* ------------------------------- determinism ------------------------------ */

describe('resolveBookStyle determinism', () => {
  it('is byte-identical for the same inputs', () => {
    for (const seed of SEEDS) {
      const a = resolveBookStyle(seed, { materials: ['silk'] }, { pigment: 3 });
      const b = resolveBookStyle(seed, { materials: ['silk'] }, { pigment: 3 });
      expect(JSON.stringify(a.style)).toBe(JSON.stringify(b.style));
      expect(JSON.stringify(a.spine)).toBe(JSON.stringify(b.spine));
      expect(JSON.stringify(a.cover)).toBe(JSON.stringify(b.cover));
    }
  });

  it('different seeds produce different books', () => {
    const styles = new Set(SEEDS.map((s) => JSON.stringify(resolveBookStyle(s).style)));
    expect(styles.size).toBeGreaterThan(SEEDS.length - 2);
  });

  it('adding an unrelated theme field does not reshuffle untouched knobs', () => {
    // The theme-bias PRNG draws a fixed number of values in a fixed order, so
    // a theme that only speaks about charms must not move the pigment.
    for (const seed of SEEDS) {
      const bare = resolveBookStyle(seed, {}).style;
      const withCharms = resolveBookStyle(seed, { charms: ['ribbon'] }).style;
      expect(withCharms.pigment).toBe(bare.pigment);
      expect(withCharms.material).toBe(bare.material);
      expect(withCharms.raisedBands).toBe(bare.raisedBands);
      expect(withCharms.charm).toBe('ribbon');
    }
  });
});

/* --------------------------------- ranges --------------------------------- */

describe('resolveBookStyle stays inside every documented range', () => {
  it('clamps everything over many seeds', () => {
    for (let seed = 0; seed < 400; seed++) {
      const { style, spine, cover } = resolveBookStyle(seed);
      expect(BINDING_MATERIALS).toContain(style.material);
      expect(style.pigment).toBeGreaterThanOrEqual(0);
      expect(style.pigment).toBeLessThan(PIGMENT_COUNT);
      expect(Math.abs(style.hueJitter)).toBeLessThanOrEqual(12);
      expect(style.raisedBands).toBeGreaterThanOrEqual(0);
      expect(style.raisedBands).toBeLessThanOrEqual(MAX_RAISED_BANDS);
      expect(Number.isInteger(style.raisedBands)).toBe(true);
      expect(style.headTailStyle).toBeGreaterThanOrEqual(0);
      expect(style.headTailStyle).toBeLessThanOrEqual(2);
      expect(style.ornament).toBeGreaterThanOrEqual(ORNAMENT_NONE);
      expect(style.ornament).toBeLessThan(ORNAMENT_COUNT);
      expect(TITLE_PLATES).toContain(style.titlePlate);
      expect([0, 1, 2]).toContain(style.titleFont);
      expect(style.wear).toBeGreaterThanOrEqual(0);
      expect(style.wear).toBeLessThanOrEqual(1);
      expect(EDGE_TREATMENTS).toContain(style.edge);
      expect(SPINE_FORMAT_IDS).toContain(style.format);
      expect(style.height).toBeGreaterThanOrEqual(SPINE_HEIGHT_RANGE.min);
      expect(style.height).toBeLessThanOrEqual(SPINE_HEIGHT_RANGE.max);
      expect(style.thickness).toBeGreaterThanOrEqual(SPINE_THICKNESS_RANGE.min);
      expect(style.thickness).toBeLessThanOrEqual(SPINE_THICKNESS_RANGE.max);
      expect(CHARMS).toContain(style.charm);
      expect(style.charmColor).toBeGreaterThanOrEqual(0);
      expect(style.charmColor).toBeLessThan(CHARM_COLORS.length);
      // The projections must agree with the merged style.
      expect(spine.material).toBe(style.material);
      expect(spine.w).toBe(style.thickness);
      expect(cover.material).toBe(style.material);
      expect(cover.charm).toBe(style.charm);
      expect(cover.wear).toBe(style.wear);
    }
  });

  it('uses the whole material and format vocabulary across seeds', () => {
    const materials = new Set<string>();
    const formats = new Set<string>();
    for (let seed = 0; seed < 3000; seed++) {
      const s = resolveBookStyle(seed).style;
      materials.add(s.material);
      formats.add(s.format);
    }
    expect(materials.size).toBe(BINDING_MATERIALS.length);
    expect(formats.size).toBe(SPINE_FORMAT_IDS.length);
  });

  it('gives a shelf real height variety, not a row of identical rectangles', () => {
    const heights = Array.from({ length: 400 }, (_, i) => resolveBookStyle(i).style.height);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(70);
  });
});

/* ------------------------------- overrides -------------------------------- */

describe('overrides always beat the theme', () => {
  const loudTheme = {
    spineDefaults: {
      materials: ['silk'],
      pigments: [11],
      giltChance: 1,
      raisedBands: [5, 5],
      headTailChance: 1,
      ornaments: [7],
      ornamentChance: 1,
      titlePlates: ['gilt'],
      titleFonts: [2],
      wear: [0.9, 0.9],
      edges: ['marbled'],
      charms: ['tassel'],
      charmChance: 1,
      charmColors: [5],
    },
  };

  it('wins on every single field', () => {
    const over: Partial<BookStyle> = {
      material: 'vellum',
      pigment: 2,
      hueJitter: -9,
      raisedBands: 1,
      bandGilt: false,
      headTail: false,
      headTailStyle: 2,
      ornament: ORNAMENT_NONE,
      titlePlate: 'label',
      titleFont: 0,
      wear: 0.05,
      edge: 'speckled',
      height: 200,
      thickness: 40,
      gilt: false,
      charm: 'wax-seal',
      charmColor: 1,
      cornerProtectors: true,
      insetPlate: false,
    };
    const { style } = resolveBookStyle(0xabc123, loudTheme, over);
    for (const [k, v] of Object.entries(over)) {
      expect(style[k as keyof BookStyle]).toBe(v);
    }
  });

  it('the theme still applies where the book has no opinion', () => {
    const { style } = resolveBookStyle(99, loudTheme, { pigment: 4 });
    expect(style.pigment).toBe(4);
    expect(style.material).toBe('silk');
    expect(style.edge).toBe('marbled');
    expect(style.charm).toBe('tassel');
    expect(style.raisedBands).toBe(5);
  });

  it('reads a bare defaults object as happily as a whole theme', () => {
    const wrapped = resolveBookStyle(5, loudTheme).style;
    const bare = resolveBookStyle(5, loudTheme.spineDefaults).style;
    expect(bare).toEqual(wrapped);
  });
});

/* ------------------------------ tolerant JSON ----------------------------- */

const GARBAGE: unknown[] = [
  undefined,
  null,
  0,
  -1,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  '',
  'leather',
  true,
  [],
  [1, 2, 3],
  {},
  { material: 'unobtainium', pigment: 99, wear: 'lots', raisedBands: [] },
  { material: null, ornament: Number.NaN, height: Number.POSITIVE_INFINITY },
  { charm: 'ribbon', charmColor: -4, titleFont: 9.7, edge: 42 },
  { spineDefaults: 'nope' },
  { spineDefaults: { materials: 'leather', pigments: 'red', wear: [2, -5] } },
  { __proto__: { material: 'silk' } },
  { toString: null },
];

describe('total on garbage', () => {
  it('never throws, whatever the cover_meta blob contains', () => {
    for (const theme of GARBAGE) {
      for (const over of GARBAGE) {
        expect(() => resolveBookStyle(12345, theme, over)).not.toThrow();
      }
    }
  });

  it('produces a fully valid style from garbage', () => {
    for (const junk of GARBAGE) {
      const { style } = resolveBookStyle(7, junk, junk);
      expect(BINDING_MATERIALS).toContain(style.material);
      expect(Number.isFinite(style.height)).toBe(true);
      expect(Number.isFinite(style.wear)).toBe(true);
      expect(Number.isFinite(style.thickness)).toBe(true);
      expect(CHARMS).toContain(style.charm);
    }
  });

  it('drops invalid discrete values instead of coercing them into meaning', () => {
    expect(normalizeBookStyleOverrides({ material: 'unobtainium' })).toBeNull();
    expect(normalizeBookStyleOverrides({ pigment: 99 })).toBeNull();
    expect(normalizeBookStyleOverrides({ edge: 'sparkly' })).toBeNull();
    expect(normalizeBookStyleOverrides('nope')).toBeNull();
    expect(normalizeBookStyleOverrides({})).toBeNull();
  });

  it('clamps continuous sliders instead of dropping them', () => {
    expect(normalizeBookStyleOverrides({ wear: 9 })?.wear).toBe(1);
    expect(normalizeBookStyleOverrides({ wear: -3 })?.wear).toBe(0);
    expect(normalizeBookStyleOverrides({ hueJitter: 500 })?.hueJitter).toBe(12);
    expect(normalizeBookStyleOverrides({ height: 5 })?.height).toBe(SPINE_HEIGHT_RANGE.min);
    expect(normalizeBookStyleOverrides({ thickness: 9e9 })?.thickness).toBe(
      SPINE_THICKNESS_RANGE.max,
    );
  });

  it('normalizeThemeDefaults returns {} for anything unusable', () => {
    for (const junk of [null, 1, 'x', [], { spineDefaults: 7 }]) {
      expect(normalizeThemeDefaults(junk)).toEqual({});
    }
  });

  it('accepts the alias field names a theme module might use', () => {
    const d = normalizeThemeDefaults({
      materialBias: ['linen'],
      pigmentRamp: [1, 2],
      wearRange: [0.2, 0.4],
      edgeTreatments: ['gilt'],
      fonts: [1],
    });
    expect(d.materials).toEqual(['linen']);
    expect(d.pigments).toEqual([1, 2]);
    expect(d.wear).toEqual([0.2, 0.4]);
    expect(d.edges).toEqual(['gilt']);
    expect(d.titleFonts).toEqual([1]);
  });
});

/* --------------------------------- format --------------------------------- */

describe('format ↔ height', () => {
  it('every format band sits inside the legal height range', () => {
    for (const id of SPINE_FORMAT_IDS) {
      const span = SPINE_FORMATS[id];
      expect(span.min).toBeGreaterThanOrEqual(SPINE_HEIGHT_RANGE.min);
      expect(span.max).toBeLessThanOrEqual(SPINE_HEIGHT_RANGE.max);
      expect(span.min).toBeLessThan(span.max);
      expect(formatForHeight(heightForFormat(id))).toBe(id);
    }
  });

  it('a lone format override picks that band, and height still wins over it', () => {
    const byFormat = resolveBookStyle(3, {}, { format: 'pocket' }).style;
    expect(byFormat.format).toBe('pocket');
    expect(byFormat.height).toBe(heightForFormat('pocket'));

    const byHeight = resolveBookStyle(3, {}, { format: 'pocket', height: 275 }).style;
    expect(byHeight.height).toBe(275);
    expect(byHeight.format).toBe('folio');
  });

  it('the reported format never contradicts the height', () => {
    for (let seed = 0; seed < 300; seed++) {
      const { style } = resolveBookStyle(seed);
      expect(style.format).toBe(formatForHeight(style.height));
    }
  });
});

/* -------------------------------- thickness ------------------------------- */

describe('thickness from page count', () => {
  it('grows with the page count but stays on the shelf', () => {
    const t10 = thicknessFromPageCount(10) as number;
    const t400 = thicknessFromPageCount(400) as number;
    expect(t10).toBeLessThan(t400);
    for (const n of [1, 10, 100, 1000, 100000]) {
      const t = thicknessFromPageCount(n) as number;
      expect(t).toBeGreaterThanOrEqual(SPINE_THICKNESS_RANGE.min);
      expect(t).toBeLessThanOrEqual(SPINE_THICKNESS_RANGE.max);
    }
  });

  it('is ignored for a nonsense page count', () => {
    for (const n of [0, -5, Number.NaN, undefined]) {
      expect(thicknessFromPageCount(n as number)).toBeUndefined();
    }
  });

  it('an explicit thickness override still wins', () => {
    const { style } = resolveBookStyle(4, {}, { thickness: 24 }, { pageCount: 900 });
    expect(style.thickness).toBe(24);
  });
});

/* --------------------------------- studio --------------------------------- */

describe('studio helpers', () => {
  it('freezing a style and re-resolving reproduces it exactly', () => {
    for (const seed of SEEDS) {
      const first = resolveBookStyle(seed, { materials: ['linen'] }).style;
      const frozen = bookStyleToOverrides(first);
      // Re-resolve with NO theme: the frozen blob must carry the whole look.
      const second = resolveBookStyle(seed, {}, frozen).style;
      expect(second).toEqual(first);
    }
  });

  it('"surprise me" is deterministic and always legal', () => {
    for (const seed of SEEDS) {
      const a = randomBookStyleOverrides(seed);
      const b = randomBookStyleOverrides(seed);
      expect(a).toEqual(b);
      const { style } = resolveBookStyle(seed, {}, a);
      expect(BINDING_MATERIALS).toContain(style.material);
      expect(style.wear).toBeGreaterThanOrEqual(0);
      expect(style.wear).toBeLessThanOrEqual(1);
      expect(SPINE_FORMAT_IDS).toContain(style.format);
    }
  });

  it('"surprise me" actually reaches the whole vocabulary', () => {
    const materials = new Set<string>();
    const charms = new Set<string>();
    const plates = new Set<string>();
    for (let seed = 0; seed < 600; seed++) {
      const o = randomBookStyleOverrides(seed);
      if (o.material) materials.add(o.material);
      if (o.charm) charms.add(o.charm);
      if (o.titlePlate) plates.add(o.titlePlate);
    }
    expect(materials.size).toBe(BINDING_MATERIALS.length);
    expect(charms.size).toBe(CHARMS.length);
    expect(plates.size).toBe(TITLE_PLATES.length);
  });

  it('exposes three title faces, all real font families', () => {
    expect(TITLE_FONTS).toHaveLength(3);
    expect(TITLE_FONTS.every((f) => f.length > 0)).toBe(true);
  });
});
