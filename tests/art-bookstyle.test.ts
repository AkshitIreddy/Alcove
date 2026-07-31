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
import { MATERIAL_MANIFEST, materialEntry } from '../src/art/materials';
import {
  MAX_BOARD_STYLE,
  SPINE_PALETTES,
  bindingMaterialSlug,
  composeShelfRow,
  deriveSpineParams,
} from '../src/art/spines';

const SEEDS = [0, 1, 7, 42, 1337, 0xbeef, 0xfeedface, 0xffffffff];

/* ------------------------------- vocabulary ------------------------------- */

describe('studio vocabulary', () => {
  it('ships the seven binding materials the spec names', () => {
    // The painterly rebuild added 'marbled' to the original six — marbled
    // boards are one of the reference shelf's named materials, with their own
    // combed/Spanish-wave/stone grains in paintBindingMaterial.
    expect([...BINDING_MATERIALS].sort()).toEqual(
      ['cloth', 'leather', 'linen', 'marbled', 'paper', 'silk', 'vellum'].sort(),
    );
  });

  it('ships 20 pigments, 12 ornaments, 4 plates, 4 edges, 6 charms', () => {
    // 12 heritage duos + the 8 deep-range duos (oxblood … saffron) the
    // reference's rich, unsaturated darks are built from.
    expect(PIGMENT_COUNT).toBe(20);
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

/* ========================================================================== *
 *          the painted rebuild: value structure and row density              *
 * ========================================================================== *
 *
 * `docs/design/painted-rendering.md` Pillar 3 says a theme must declare a
 * value structure and a test must reject mid-tone mush. These two properties
 * are the ones the shelf kept regressing on, and they are cheap to pin:
 *
 *  - the row of pigments a shelf draws from spans a real value range, with a
 *    committed dark mass rather than a hump in the middle;
 *  - a composed row is DENSE — the books cover most of the plank, and no one
 *    hole is big enough to read as a missing shelf.
 */

describe('painted rebuild — value structure', () => {
  const luminance = (hex: string): number => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return 0.5;
    const n = parseInt(m[1] as string, 16);
    const to = (v: number): number => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * to((n >> 16) & 255) + 0.7152 * to((n >> 8) & 255) + 0.0722 * to(n & 255);
  };

  it('the pigment table commits to darks instead of sitting mid-tone', () => {
    const darks = SPINE_PALETTES.map(([, dark]) => dark);
    const lums = darks.map((d) => luminance(`#${hslHex(d.h, d.s, d.l)}`));
    const min = Math.min(...lums);
    const max = Math.max(...lums);
    // A real range, not a band: the darkest partner tone is genuinely dark and
    // the lightest is genuinely light.
    expect(min).toBeLessThan(0.06);
    expect(max).toBeGreaterThan(0.3);
    // And at least a third of the table is in the bottom of the range — the
    // "large areas of genuine dark" the art direction asks for.
    expect(lums.filter((l) => l < 0.12).length / lums.length).toBeGreaterThan(0.3);
  });

  it('derives a spread of binding materials, not one default', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 400; seed++) seen.add(deriveSpineParams(seed).material ?? 'x');
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  it('puts tooled foil on more than half the shelf', () => {
    let gilt = 0;
    for (let seed = 1; seed < 500; seed++) if (deriveSpineParams(seed).gilt) gilt++;
    expect(gilt / 499).toBeGreaterThan(0.45);
  });

  it('gives most books raised bands so the row has horizontal structure', () => {
    let corded = 0;
    for (let seed = 1; seed < 500; seed++) {
      if ((deriveSpineParams(seed).raisedBands ?? 0) > 0) corded++;
    }
    expect(corded / 499).toBeGreaterThan(0.4);
  });
});

describe('painted rebuild — row density', () => {
  const inputs = (n: number, base = 1): Array<{ id: string; seed: number; title: string }> =>
    Array.from({ length: n }, (_, i) => ({
      id: `b${i}`,
      seed: (base * 7919 + i * 2654435761) >>> 0,
      title: `Book ${i}`,
    }));

  it('fills the plank rather than pouring the slack into voids', () => {
    for (const seed of [1, 2, 3, 5, 8, 13]) {
      const width = 1160;
      const comp = composeShelfRow(inputs(26, seed), { width, seed });
      const covered = comp.placements.reduce(
        (s, p) => s + (p.pose === 'flat' ? 0 : p.width),
        0,
      );
      const flat = comp.placements.filter((p) => p.pose === 'flat');
      const flatSpan = flat.length
        ? Math.max(...flat.map((p) => p.x + p.width)) - Math.min(...flat.map((p) => p.x))
        : 0;
      // Books (upright footprints plus any flat stacks) own most of the run.
      expect((covered + flatSpan) / width).toBeGreaterThan(0.78);
      // …and no single hole reads as a missing shelf.
      const worst = comp.gaps.reduce((m, g) => Math.max(m, g.width), 0);
      expect(worst).toBeLessThan(width * 0.09);
    }
  });

  it('keeps the wild thickness range while packing tight', () => {
    const comp = composeShelfRow(inputs(30, 4), { width: 1200, seed: 4 });
    const uprights = comp.placements.filter((p) => p.pose !== 'flat');
    const widths = uprights.map((p) => p.params.w);
    expect(Math.max(...widths) / Math.min(...widths)).toBeGreaterThan(3);
    expect(comp.skylineVariation).toBeGreaterThan(0.15);
  });

  it('is deterministic after the repack', () => {
    const a = composeShelfRow(inputs(24, 9), { width: 900, seed: 9 });
    const b = composeShelfRow(inputs(24, 9), { width: 900, seed: 9 });
    expect(a.placements.map((p) => [p.id, Math.round(p.x), Math.round(p.width)])).toEqual(
      b.placements.map((p) => [p.id, Math.round(p.x), Math.round(p.width)]),
    );
  });
});

/* --------------------- generated covering materials ---------------------- */

describe('binding → generated tile', () => {
  const SLUGS = new Set(MATERIAL_MANIFEST.map((m) => m.slug));

  it('maps every binding to a tile that actually ships, or to nothing', () => {
    for (const material of BINDING_MATERIALS) {
      for (let boardStyle = 0; boardStyle <= MAX_BOARD_STYLE; boardStyle++) {
        const slug = bindingMaterialSlug(material, boardStyle);
        if (slug === null) continue;
        expect(SLUGS.has(slug), `${material}/${boardStyle} → ${slug}`).toBe(true);
      }
    }
  });

  it('leaves silk to the brush engine', () => {
    // Silk's identity is a satin sheen that slides as the eye moves. A static
    // tile cannot carry that, so the procedural version stays authoritative —
    // this is the one binding the library is deliberately not used for.
    for (let b = 0; b <= MAX_BOARD_STYLE; b++) {
      expect(bindingMaterialSlug('silk', b)).toBeNull();
    }
  });

  it('sends each binding to a tile of a sensible family', () => {
    const want: Partial<Record<(typeof BINDING_MATERIALS)[number], string>> = {
      leather: 'leather',
      cloth: 'cloth',
      linen: 'cloth',
      paper: 'paper',
      vellum: 'paper',
      marbled: 'marble',
    };
    for (const [material, category] of Object.entries(want)) {
      const slug = bindingMaterialSlug(material as (typeof BINDING_MATERIALS)[number], 0);
      expect(slug, material).not.toBeNull();
      expect(materialEntry(slug!)?.category, material).toBe(category);
    }
  });

  it('uses the board sub-style to choose which leather and which cloth', () => {
    // boardStyle already says *pebbled morocco* or *craquelure*, *ribbed rep*
    // or *slubby buckram*, and the library happens to contain exactly those
    // distinctions — so the sub-style has to reach the tile choice or the
    // studio control stops meaning anything.
    expect(bindingMaterialSlug('leather', 2)).not.toBe(bindingMaterialSlug('leather', 0));
    expect(bindingMaterialSlug('cloth', 1)).not.toBe(bindingMaterialSlug('cloth', 0));
  });

  it('is a pure function of its two arguments', () => {
    for (const material of BINDING_MATERIALS) {
      for (let b = 0; b <= MAX_BOARD_STYLE; b++) {
        expect(bindingMaterialSlug(material, b)).toBe(bindingMaterialSlug(material, b));
      }
    }
  });

  it('tolerates an out-of-range board style', () => {
    for (const material of BINDING_MATERIALS) {
      expect(() => bindingMaterialSlug(material, -3)).not.toThrow();
      expect(() => bindingMaterialSlug(material, 99)).not.toThrow();
    }
  });
});

/** hsl → #rrggbb, so the value test can work in the same space as the render. */
function hslHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = ln - c / 2;
  const to = (v: number): string =>
    Math.round(Math.min(255, Math.max(0, (v + m) * 255)))
      .toString(16)
      .padStart(2, '0');
  return `${to(r1)}${to(g1)}${to(b1)}`;
}
