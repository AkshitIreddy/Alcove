/**
 * tests/bookmarks.test.ts — the ribbon vocabulary.
 *
 * Three classes of bug this file exists to catch, all of which this codebase
 * has shipped before in one form or another:
 *
 *  1. A vocabulary that validates and renders but is UNREACHABLE, or one whose
 *     presets name an axis entry that does not exist — either way the reader
 *     never sees it and nothing throws.
 *  2. Two renderers folding the same design differently, so the picker
 *     previews one ribbon and the cover wears another.
 *  3. A resolver that throws on the blob a reader's disk actually holds.
 */
import { describe, expect, it } from 'vitest';

import {
  applyRibbonDesign,
  charmBottomFraction,
  DEFAULT_RIBBON,
  mergeBookmarksIntoMeta,
  mergeRibbonIntoMeta,
  mixHex,
  readBookmarks,
  readRibbonDesign,
  resolveRibbonDesign,
  ribbonCss,
  ribbonFromPreset,
  ribbonBox,
  ribbonParts,
  ribbonPresetOf,
  ribbonPresetsOf,
  ribbonSlotColor,
  ribbonSvg,
  RIBBON_CHARMS,
  RIBBON_CLOTHS,
  RIBBON_COLORS,
  RIBBON_FAMILIES,
  RIBBON_MATERIALS,
  RIBBON_PRESETS,
  RIBBON_TAILS,
  RIBBON_WEIGHTS,
  svgDataUri,
  toggleBookmark,
  type RibbonDesign,
} from '../src/views/bookmarks';

const ids = (list: readonly { id: string }[]): Set<string> =>
  new Set(list.map((item) => item.id));

describe('the ribbon vocabulary', () => {
  it('offers the reader more than a handful of colours', () => {
    // "colours are still very few (whereever colour is an option there are
    // only like 8), like atleast 20 with option for user to add their own."
    expect(RIBBON_CLOTHS.length).toBeGreaterThanOrEqual(20);
  });

  it('has no duplicate ids on any axis', () => {
    for (const list of [
      RIBBON_CLOTHS,
      RIBBON_WEIGHTS,
      RIBBON_TAILS,
      RIBBON_MATERIALS,
      RIBBON_CHARMS,
      RIBBON_PRESETS,
    ]) {
      expect(ids(list).size).toBe(list.length);
    }
  });

  it('never names an axis entry that does not exist', () => {
    const cloths = ids(RIBBON_CLOTHS);
    const weights = ids(RIBBON_WEIGHTS);
    const tails = ids(RIBBON_TAILS);
    const materials = ids(RIBBON_MATERIALS);
    const charms = ids(RIBBON_CHARMS);
    for (const preset of RIBBON_PRESETS) {
      const d = preset.design;
      expect(cloths, `${preset.id} cloth`).toContain(d.cloth);
      expect(weights, `${preset.id} weight`).toContain(d.weight);
      expect(tails, `${preset.id} tail`).toContain(d.tail);
      expect(materials, `${preset.id} material`).toContain(d.material);
      expect(charms, `${preset.id} charm`).toContain(d.charm);
      expect(['ink', 'gilt', 'cream']).toContain(d.charmTone);
    }
    // ...including the house ribbon, which is what every unset book wears.
    expect(cloths).toContain(DEFAULT_RIBBON.cloth);
    expect(RIBBON_PRESETS.map((p) => p.id)).toContain(DEFAULT_RIBBON.preset);
  });

  it('puts every preset on a shelf, and every shelf has stock', () => {
    let counted = 0;
    for (const family of RIBBON_FAMILIES) {
      const shelf = ribbonPresetsOf(family);
      expect(shelf.length, family).toBeGreaterThan(0);
      counted += shelf.length;
    }
    // No preset may name a family the picker does not show — it would exist,
    // resolve and render, and be unreachable from every row of the sheet.
    expect(counted).toBe(RIBBON_PRESETS.length);
  });

  it('draws every tail as a closed run along the top edge', () => {
    for (const tail of RIBBON_TAILS) {
      const first = tail.poly[0];
      const second = tail.poly[1];
      expect(first, tail.id).toEqual([0, 0]);
      expect(second, tail.id).toEqual([100, 0]);
      expect(tail.poly.length).toBeGreaterThanOrEqual(4);
      for (const [x, y] of tail.poly) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(100);
      }
      // A tail that eats more than half the ribbon stops reading as a ribbon.
      const highestCut = Math.min(...tail.poly.slice(2).map(([, y]) => y));
      expect(highestCut, tail.id).toBeGreaterThanOrEqual(55);
    }
  });
});

describe('resolveRibbonDesign', () => {
  const valid = (d: RibbonDesign): void => {
    expect(ids(RIBBON_CLOTHS)).toContain(d.cloth);
    expect(ids(RIBBON_WEIGHTS)).toContain(d.weight);
    expect(ids(RIBBON_TAILS)).toContain(d.tail);
    expect(ids(RIBBON_MATERIALS)).toContain(d.material);
    expect(ids(RIBBON_CHARMS)).toContain(d.charm);
  };

  it('is total: junk out of SQLite gives the house ribbon, never a throw', () => {
    for (const junk of [
      null,
      undefined,
      0,
      'moss',
      [],
      {},
      { cloth: 42 },
      { cloth: 'not-a-cloth', tail: 'not-a-tail' },
      { preset: 'no-such-preset' },
      { charmTone: 'neon' },
    ]) {
      const design = resolveRibbonDesign(junk);
      valid(design);
    }
    expect(resolveRibbonDesign(null)).toEqual(DEFAULT_RIBBON);
  });

  it('reads a preset as a complete answer and lets one axis be adjusted', () => {
    const gilded = ribbonFromPreset('gilded');
    expect(gilded.preset).toBe('gilded');
    const tweaked = resolveRibbonDesign({ preset: 'gilded', cloth: 'moss' });
    expect(tweaked.cloth).toBe('moss');
    expect(tweaked.weight).toBe(gilded.weight);
    expect(tweaked.tail).toBe(gilded.tail);
  });

  it('recognises a design that has come back round to a preset', () => {
    for (const preset of RIBBON_PRESETS) {
      expect(ribbonPresetOf(ribbonFromPreset(preset.id))).toBe(preset.id);
    }
    expect(
      ribbonPresetOf({ ...ribbonFromPreset('gilded'), cloth: 'oyster' }),
    ).toBeNull();
  });
});

describe('where the ribbon is kept', () => {
  it('round-trips through cover_meta without touching anything else', () => {
    const design = ribbonFromPreset('midnight');
    const meta = mergeRibbonIntoMeta(
      { palette: 'amber', cover: { frame: 3 } },
      design,
    );
    expect(meta?.palette).toBe('amber');
    expect(meta?.cover).toEqual({ frame: 3 });
    expect(readRibbonDesign({ coverMeta: meta })).toEqual(design);
  });

  it('clears cleanly, and an empty blob collapses to null', () => {
    expect(mergeRibbonIntoMeta({ ribbon: { cloth: 'moss' } }, null)).toBeNull();
    expect(mergeRibbonIntoMeta(null, null)).toBeNull();
    expect(readRibbonDesign({ coverMeta: null })).toEqual(DEFAULT_RIBBON);
  });

  it('still keeps bookmarks the way it always did', () => {
    const marks = readBookmarks({
      id: 'book-1',
      coverMeta: {
        bookmarks: [
          { pageId: 'p1', color: 'moss', addedAt: '2026-01-01T00:00:00.000Z' },
          { pageId: 'p1', color: 'sky' }, // duplicate page — dropped
          { pageId: '', color: 'sky' }, // no page — dropped
          { pageId: 'p2', color: 'neon' }, // unknown slot — house slot
          'nonsense',
        ],
      },
    });
    expect(marks).toHaveLength(2);
    expect(marks[0]?.color).toBe('moss');
    expect(marks[1]?.color).toBe('terracotta');

    const added = toggleBookmark(marks, 'p3', new Date(0));
    expect(added).toHaveLength(3);
    expect(added[2]?.color).toBe(RIBBON_COLORS[2]);
    expect(toggleBookmark(added, 'p3')).toHaveLength(2);
    expect(mergeBookmarksIntoMeta({ palette: 'moss' }, [])).toEqual({
      palette: 'moss',
    });
  });
});

describe('one drawing, both surfaces', () => {
  const sample: RibbonDesign = ribbonFromPreset('harvest');

  it('gives the cover the very drawing the picker previewed', () => {
    // Not "the two agree" — there is only one renderer, and this is what
    // holds it that way. If the cover ever grows its own painting path again,
    // this is the test that fails.
    const css = ribbonCss(sample);
    for (const slot of RIBBON_COLORS) {
      expect(css).toContain(svgDataUri(ribbonSvg(sample, { slot })));
    }
  });

  it('paints the cloth the design asked for', () => {
    const face = ribbonSlotColor(ribbonParts(sample), 'terracotta');
    expect(ribbonSvg(sample)).toContain(face);
    // The colour survives into the stylesheet, url-encoded (`#` → `%23`).
    expect(ribbonCss(sample)).toContain(face.replace('#', '%23'));
  });

  it('draws the ink outline the flat language asks for, inside its own box', () => {
    const parts = ribbonParts(sample);
    const box = ribbonBox(parts);
    const svg = ribbonSvg(sample);
    expect(svg).toContain('stroke="#4f3120"');
    expect(svg).toContain(`viewBox="0 0 ${box.w} ${box.h}"`);
    // A stroke centred on the outline is half outside it; the box is bigger
    // than the ribbon by exactly the room that half needs.
    expect(box.w).toBeGreaterThan(parts.weight.w);
    expect(box.h).toBeGreaterThan(parts.weight.h);
    // ...and it is a real SVG document, or a background-image would show
    // nothing at all while an inline one looked fine.
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('gives every drawing in one row its own clip id', () => {
    // A picker row puts eight of these in ONE document. Two `<clipPath>`
    // elements sharing an id means seven tiles wearing the first one's cut,
    // which looks like the vocabulary is broken rather than the markup.
    const clipId = (svg: string): string =>
      /<clipPath id="([^"]+)"/.exec(svg)?.[1] ?? '';
    const row = <T extends { id: string }>(
      list: readonly T[],
      draw: (item: T) => string,
    ): void => {
      const seen = new Set<string>();
      for (const item of list) {
        const id = clipId(draw(item));
        expect(id, item.id).not.toBe('');
        expect(seen.has(id), item.id).toBe(false);
        seen.add(id);
      }
    };
    row(RIBBON_TAILS, (t) => ribbonSvg({ ...sample, tail: t.id }));
    row(RIBBON_MATERIALS, (m) => ribbonSvg({ ...sample, material: m.id }));
    row(RIBBON_CHARMS, (c) => ribbonSvg({ ...sample, charm: c.id }));
    row(RIBBON_WEIGHTS, (w) => ribbonSvg({ ...sample, weight: w.id }));
    row(
      RIBBON_COLORS.map((id) => ({ id })),
      (slot) => ribbonSvg(sample, { slot: slot.id }),
    );
  });

  it('gives the six slots six different faces of one cloth', () => {
    const parts = ribbonParts(sample);
    const faces = RIBBON_COLORS.map((slot) => ribbonSlotColor(parts, slot));
    expect(new Set(faces).size).toBe(RIBBON_COLORS.length);
  });

  it('seats the charm above every tail, on cloth rather than in the cut', () => {
    const parts = ribbonParts(sample);
    for (const tail of RIBBON_TAILS) {
      const seat = charmBottomFraction(tail);
      const highestCut = Math.min(...tail.poly.slice(2).map(([, y]) => y)) / 100;
      // The charm's bottom edge clears the deepest reach of the cut.
      expect(1 - seat, tail.id).toBeLessThanOrEqual(highestCut);
      expect(seat).toBeGreaterThan(0);
      expect(seat).toBeLessThan(0.6);
      // ...and the drawing puts it there, rather than at a constant that was
      // right for whichever tail happened to be drawn first.
      const svg = ribbonSvg({ ...sample, tail: tail.id, charm: 'coin' });
      const cy = Number.parseFloat(/<circle cx="[\d.]+" cy="([\d.]+)"/.exec(svg)?.[1] ?? '0');
      const r = Number.parseFloat(/<circle [^>]*r="([\d.]+)"/.exec(svg)?.[1] ?? '0');
      const bottomOfCharm = cy + r;
      const cutStartsAt = 1 + parts.weight.h * highestCut;
      expect(bottomOfCharm, tail.id).toBeLessThanOrEqual(cutStartsAt + 0.01);
    }
  });

  it('draws no charm when there is no charm', () => {
    const bare: RibbonDesign = { ...sample, charm: 'none' };
    expect(ribbonCss(bare)).not.toContain('::after');
    expect(ribbonSvg(bare)).not.toContain('<circle');
  });

  it('sizes the drawing by the ribbon it is drawing', () => {
    const thread = ribbonSvg({ ...sample, weight: 'thread' }, { height: 60 });
    const sash = ribbonSvg({ ...sample, weight: 'broadsash' }, { height: 60 });
    const widthOf = (svg: string): number =>
      Number.parseFloat(/width="([\d.]+)"/.exec(svg)?.[1] ?? '0');
    expect(widthOf(sash)).toBeGreaterThan(widthOf(thread));
    expect(/height="60(\.0)?"/.test(thread)).toBe(true);
  });
});

describe('the generated stylesheet stays inside the flat language', () => {
  it('has no blur, no glow and no drop shadow anywhere in it', () => {
    for (const preset of RIBBON_PRESETS) {
      const css = ribbonCss(ribbonFromPreset(preset.id));
      expect(css, preset.id).not.toMatch(/blur|drop-shadow|filter:|mix-blend/);
      // The one box-shadow it writes is the removal of the inherited one.
      expect(css.match(/box-shadow:[^;]+/g) ?? []).toEqual(['box-shadow: none']);
    }
  });

  it('beats the stylesheet it is overriding on specificity, not on order', () => {
    const css = ribbonCss(DEFAULT_RIBBON);
    // spread.css carries `.nb-ribbon[data-color='…']`; a bare `.nb-ribbon…`
    // here would tie with it and leave the winner to import order.
    for (const line of css.split('\n')) {
      if (line.includes('.nb-ribbon')) expect(line.startsWith(':root ')).toBe(true);
    }
  });

  it('writes one face rule per slot plus a fallback', () => {
    const css = ribbonCss(DEFAULT_RIBBON);
    for (const slot of RIBBON_COLORS) {
      expect(css).toContain(`[data-color='${slot}']`);
    }
    expect(css).toContain(':not([data-color])');
  });

  it('applies without a DOM rather than throwing in a node test', () => {
    expect(() => applyRibbonDesign(DEFAULT_RIBBON)).not.toThrow();
  });
});

describe('mixHex', () => {
  it('mixes flat pigment, not light', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    // Out-of-range t clamps rather than producing a colour that is not one.
    expect(mixHex('#123456', '#654321', -3)).toBe('#123456');
    expect(mixHex('#123456', '#654321', 9)).toBe('#654321');
  });
});
