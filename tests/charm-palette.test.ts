/**
 * tests/charm-palette.test.ts — the charm colourways, held to the rules the
 * drawing actually needs rather than to a count.
 *
 * Three things go wrong with a colour table in this codebase and all three are
 * silent, so all three are pinned here:
 *
 *  1. an entry the ink cannot sit on (`FLAT.ink` is the same brown on every
 *     shape, so a colour darker than it stops having an edge);
 *  2. two entries a reader cannot tell apart, which makes a picker longer
 *     without making it richer;
 *  3. two modules folding one index differently, which is how a book came out
 *     one colour on the shelf and another in the hand.
 */
import { describe, expect, it } from 'vitest';
import {
  CHARM_COLORS,
  CHARM_COLOR_LABELS,
  CHARM_FLOOR,
  charmCloth,
  charmColorCss,
} from '../src/art/charms';
import { clothPair, lum, toOklch, INK_FLOOR } from '../src/art/palette';

/** OKLab distance — the same measure `art/customColour.ts` is scored on. */
function distance(a: string, b: string): number {
  const A = toOklch(a);
  const B = toOklch(b);
  const ar = (A.h * Math.PI) / 180;
  const br = (B.h * Math.PI) / 180;
  return Math.hypot(
    A.L - B.L,
    Math.cos(ar) * A.C - Math.cos(br) * B.C,
    Math.sin(ar) * A.C - Math.sin(br) * B.C,
  );
}

describe('the charm colourways', () => {
  it('offers at least twenty', () => {
    // The reader's own words: "wherever colour is an option there are only
    // like 8, at least 20 with option for user to add their own".
    expect(CHARM_COLORS.length).toBeGreaterThanOrEqual(20);
  });

  it('names every one of them', () => {
    expect(CHARM_COLOR_LABELS).toHaveLength(CHARM_COLORS.length);
    expect(new Set(CHARM_COLOR_LABELS).size).toBe(CHARM_COLOR_LABELS.length);
    for (const label of CHARM_COLOR_LABELS) expect(label.trim()).not.toBe('');
  });

  it('writes every entry as a canonical lowercase hex', () => {
    for (const hex of CHARM_COLORS) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(CHARM_COLORS).size).toBe(CHARM_COLORS.length);
  });

  it('keeps the eight persisted indices in their pinned order', () => {
    // The INDEX is what a book carries, so these eight may be recoloured but
    // never reordered. Their hue is the identity a reader recognises; their
    // lightness moved once, up onto the floor the art was already lifting
    // them to. Anything more than a few degrees of hue drift here has
    // restyled somebody's book.
    const pinned: [string, number][] = [
      ['Crimson', 25.1],
      ['Forest', 165.0],
      ['Navy', 255.5],
      ['Cream', 88.3],
      ['Gold', 89.7],
      ['Plum', 333.8],
      ['Rust', 46.3],
      ['Teal', 206.9],
    ];
    pinned.forEach(([label, hue], i) => {
      expect(CHARM_COLOR_LABELS[i]).toBe(label);
      const gap = Math.abs(toOklch(CHARM_COLORS[i] as string).h - hue) % 360;
      expect(gap > 180 ? 360 - gap : gap).toBeLessThan(5);
    });
  });

  it('leaves the one brown ink an edge to be on every entry', () => {
    // CHARM_FLOOR restates palette's own CLOTH_GAP, so check it against the
    // arithmetic rather than trusting the number: `clothPair` lifts anything
    // below the floor, so a table already above it comes back untouched.
    expect(CHARM_FLOOR).toBeGreaterThan(INK_FLOOR);
    for (const hex of CHARM_COLORS) {
      expect(lum(hex)).toBeGreaterThanOrEqual(CHARM_FLOOR - 0.5);
    }
  });

  it('is a fixed point of the cloth fold, so the swatch is what gets painted', () => {
    // This is the whole reason the eight were recoloured. The studio paints
    // its chip with the raw entry and the art paints a folded one; unless the
    // entry IS the face `clothPair` hands back, those are two colours.
    for (const hex of CHARM_COLORS) {
      const [face, edge] = clothPair(hex);
      expect(face).toBe(hex);
      expect(lum(face) - lum(edge)).toBeGreaterThan(12);
    }
  });

  it('never puts two colourways closer than the eight already were', () => {
    // The bar is measured, not chosen: forest and teal are the closest pair
    // among the originals, and nothing new may crowd the palette more than
    // the palette already crowds itself.
    const bar = distance(CHARM_COLORS[1] as string, CHARM_COLORS[7] as string);
    expect(bar).toBeGreaterThan(0.04);
    for (let i = 0; i < CHARM_COLORS.length; i++) {
      for (let j = i + 1; j < CHARM_COLORS.length; j++) {
        const d = distance(CHARM_COLORS[i] as string, CHARM_COLORS[j] as string);
        expect(
          d,
          `${CHARM_COLOR_LABELS[i]} and ${CHARM_COLOR_LABELS[j]} are ${d.toFixed(4)} apart`,
        ).toBeGreaterThanOrEqual(bar - 1e-9);
      }
    }
  });

  it('spans a range of VALUE, not only of hue', () => {
    // A palette of twenty-four mid-tones is one colour printed twenty-four
    // times. There has to be something pale enough to read as unbleached silk
    // and something deep enough to read as a dyed one.
    const brights = CHARM_COLORS.map(lum);
    expect(Math.min(...brights)).toBeLessThan(115);
    expect(Math.max(...brights)).toBeGreaterThan(190);
  });
});

describe('charmColorCss', () => {
  it('answers with the table entry for an index', () => {
    CHARM_COLORS.forEach((hex, i) => expect(charmColorCss(i)).toBe(hex));
  });

  it('wraps rather than clamping, in both directions', () => {
    const n = CHARM_COLORS.length;
    expect(charmColorCss(n)).toBe(CHARM_COLORS[0]);
    expect(charmColorCss(n + 5)).toBe(CHARM_COLORS[5]);
    expect(charmColorCss(-1)).toBe(CHARM_COLORS[n - 1]);
    expect(charmColorCss(2.7)).toBe(CHARM_COLORS[2]);
  });

  it("honours a reader's own hex instead of dropping it", () => {
    // The failure this guards is the quiet one: a normaliser that answers
    // "index 0" for a colour it did not recognise. A custom colour that
    // silently degrades to crimson is worse than no custom colour.
    for (const spelling of ['#3f7a5c', '3f7a5c', '  #3F7A5C  ']) {
      const out = charmColorCss(spelling);
      expect(out).toMatch(/^#[0-9a-f]{6}$/);
      expect(out).not.toBe(CHARM_COLORS[0]);
      // hue kept; only lightness may have been lifted
      expect(Math.abs(toOklch(out).h - toOklch('#3f7a5c').h)).toBeLessThan(3);
    }
  });

  it('clamps a colour the ink could not sit on rather than refusing it', () => {
    for (const hex of ['#000000', '#1a0033', '#4f3120']) {
      expect(lum(charmColorCss(hex))).toBeGreaterThanOrEqual(CHARM_FLOOR - 0.5);
    }
  });

  it('leaves a colour that is already legible exactly as typed', () => {
    expect(charmColorCss('#d4674c')).toBe('#d4674c');
  });

  it('is total for anything at all', () => {
    for (const junk of [null, undefined, NaN, Infinity, 'rebeccapurple', '', {}, []]) {
      expect(charmColorCss(junk)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('charmCloth', () => {
  it('folds an index to its own table entry and a darker face', () => {
    CHARM_COLORS.forEach((hex, i) => {
      const [face, dark] = charmCloth(i);
      expect(face).toBe(hex);
      expect(lum(dark)).toBeLessThan(lum(face));
    });
  });

  it('folds a custom hex by the same arithmetic', () => {
    const [face, dark] = charmCloth('#3f7a5c');
    expect(face).toBe(charmColorCss('#3f7a5c'));
    expect(lum(face) - lum(dark)).toBeGreaterThan(12);
  });
});
