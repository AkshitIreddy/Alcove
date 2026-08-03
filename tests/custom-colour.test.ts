/**
 * tests/custom-colour.test.ts — the pigment shelf and the reader's own colour.
 *
 * Three things are gated here, and each one is a failure this codebase has
 * already shipped once:
 *
 *  1. **Reachability.** A vocabulary that exists, validates and renders but
 *     that no menu reads is worth nothing. So the callout's tint list is
 *     asserted to BE the shelf, not merely to be near its size.
 *  2. **The mirror.** `art/customColour.ts` restates the eleven `--wash-*`
 *     families as hex, because an OffscreenCanvas on a worker thread cannot
 *     read a custom property. This file parses `styles/tokens.css` and fails
 *     on a single drifted channel.
 *  3. **Totality.** A normaliser that drops what it does not recognise turns a
 *     reader's own colour into amber, silently and permanently. Every path
 *     into `resolveWash` is walked, including the ones where the id is gone.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  CUSTOM_COLOUR_LIMIT,
  CUSTOM_WASH_ID,
  DEFAULT_WASH_ID,
  PALETTE_PAGE,
  PALETTE_REST,
  WASH_FAMILIES,
  WASH_SWATCHES,
  WASH_SWATCH_IDS,
  customColours,
  customWashFaces,
  forgetCustomColour,
  normaliseHex,
  rememberCustomColour,
  resetCustomColours,
  resolveWash,
  washSwatch,
} from '../src/art/customColour';
import { FLAT } from '../src/art/flat';
import { INK_FLOOR, WASH_BAND, lum, mixOklab, toOklch, washFaces } from '../src/art/palette';

const TOKENS = readFileSync(
  fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url)),
  'utf8',
);

/** `--wash-moss-deep: #4f6138;` → `#4f6138`, read out of the real stylesheet. */
function token(name: string): string {
  const found = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(TOKENS);
  expect(found, `tokens.css is missing --${name}`).not.toBeNull();
  return (found as RegExpExecArray)[1]!.toLowerCase();
}

/** WCAG relative luminance, for the contrast the tokens file promises. */
function relLum(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('the pigment shelf', () => {
  it('offers at least twenty colours', () => {
    // The reader's own words: "wherever colour is an option there are only
    // like 8, at least 20". This is that number, and it is asserted here
    // rather than described in a comment.
    expect(WASH_SWATCHES.length).toBeGreaterThanOrEqual(20);
  });

  it('has no duplicate id and no duplicate colour', () => {
    expect(new Set(WASH_SWATCH_IDS).size).toBe(WASH_SWATCHES.length);
    // Two rows of a picker that paint the same pixels are worse than one row.
    const painted = WASH_SWATCHES.map((s) => s.paint.base);
    expect(new Set(painted).size).toBe(WASH_SWATCHES.length);
  });

  it('crowds itself no more than styles/tokens.css already does', () => {
    // Uniqueness of hex is not enough — the first draft of this table had
    // amber / honey / lemon, three distinct hexes and one visible yellow. The
    // bar is DERIVED rather than chosen: the closest pair among the eleven
    // token families (coral and terracotta) is as tight as this palette is
    // allowed to get, and every added swatch is measured against it.
    const lab = (hex: string): readonly [number, number, number] => {
      const c = toOklch(hex);
      const rad = (c.h * Math.PI) / 180;
      return [c.L, Math.cos(rad) * c.C, Math.sin(rad) * c.C];
    };
    const gap = (a: string, b: string): number => {
      const [al, aa, ab] = lab(a);
      const [bl, ba, bb] = lab(b);
      return Math.hypot(al - bl, aa - ba, ab - bb);
    };

    let floor = Infinity;
    for (let i = 0; i < WASH_FAMILIES.length; i += 1) {
      for (let j = i + 1; j < WASH_FAMILIES.length; j += 1) {
        floor = Math.min(floor, gap(token(`wash-${WASH_FAMILIES[i]!}`), token(`wash-${WASH_FAMILIES[j]!}`)));
      }
    }
    expect(floor).toBeGreaterThan(0.02);

    const tight: string[] = [];
    for (let i = 0; i < WASH_SWATCHES.length; i += 1) {
      for (let j = i + 1; j < WASH_SWATCHES.length; j += 1) {
        const a = WASH_SWATCHES[i]!;
        const b = WASH_SWATCHES[j]!;
        if (gap(a.paint.base, b.paint.base) < floor - 1e-9) tight.push(`${a.id}/${b.id}`);
      }
    }
    expect(tight, `these read as one colour: ${tight.join(', ')}`).toEqual([]);
  });

  it('folds at PALETTE_PAGE and derives the remainder', () => {
    expect(PALETTE_PAGE).toBe(20);
    expect(PALETTE_REST).toBe(WASH_SWATCHES.length - PALETTE_PAGE);
  });

  it('keeps every colour a document could already be wearing in the first page', () => {
    // The six the callout shipped with. A document written before the shelf
    // existed must not have its tint hidden behind a "more" button.
    const first = WASH_SWATCH_IDS.slice(0, PALETTE_PAGE);
    for (const id of ['amber', 'terracotta', 'moss', 'lemon', 'sky', 'blush']) {
      expect(first, `${id} fell behind the fold`).toContain(id);
    }
  });

  it('mirrors styles/tokens.css exactly, channel for channel', () => {
    for (const family of WASH_FAMILIES) {
      const swatch = washSwatch(family);
      expect(swatch, `${family} is not on the shelf`).toBeDefined();
      expect(swatch!.paint.light).toBe(token(`wash-${family}-light`));
      expect(swatch!.paint.base).toBe(token(`wash-${family}`));
      expect(swatch!.paint.deep).toBe(token(`wash-${family}-deep`));
    }
  });

  it('paints the DOM through the theme, not around it', () => {
    // A family swatch must resolve through `var(--wash-…)` so a library theme
    // still retints it; the three light themes and `night` all override those
    // custom properties in styles/settings.css.
    for (const family of WASH_FAMILIES) {
      const css = washSwatch(family)!.css;
      expect(css.base).toBe(`var(--wash-${family})`);
      expect(css.light).toBe(`var(--wash-${family}-light)`);
    }
    // A mixed swatch mixes the SAME custom properties, so it moves with them.
    const fern = washSwatch('fern')!;
    expect(fern.css.base).toMatch(/^color-mix\(in oklab, var\(--wash-moss\) \d+%, var\(--wash-lime\)\)$/);
  });

  it('resolves a mixed swatch to the colour CSS will compute', () => {
    // `color-mix(in oklab, …)` is rectangular, and so is `mixOklab`. If these
    // two ever diverge a swatch chip disagrees with the block it paints.
    const fern = washSwatch('fern')!;
    const pct = fern.source.kind === 'mix' ? fern.source.pct : -1;
    expect(pct).toBeGreaterThan(0);
    expect(fern.paint.base).toBe(mixOklab(token('wash-lime'), token('wash-moss'), pct / 100));
  });

  it('is a picker, not a stylesheet: every face is paintable', () => {
    for (const swatch of WASH_SWATCHES) {
      for (const face of [swatch.css.light, swatch.css.base, swatch.css.deep]) {
        expect(face, `${swatch.id} has an unpaintable face`).toMatch(
          /^(#[0-9a-f]{6}|var\(--wash-[a-z]+(-light|-deep)?\)|color-mix\(in oklab, .+\))$/,
        );
      }
      for (const face of [swatch.paint.light, swatch.paint.base, swatch.paint.deep]) {
        expect(face).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});

/**
 * The callout is a Solid node view: importing it runs `delegateEvents` and
 * then ProseMirror's own module-scope DOM probing, neither of which survives
 * the node environment (jsdom is not installed — see vitest.config.ts). So
 * reachability is read out of the SOURCE instead, which is a weaker instrument
 * than a value comparison but a stronger one than a matching length: it fails
 * the moment somebody replaces the alias with a literal list, which is exactly
 * how the six-out-of-eleven drift happened in the first place.
 */
const CALLOUT_SRC = readFileSync(
  fileURLToPath(new URL('../src/editor/nodes/callout.tsx', import.meta.url)),
  'utf8',
);

const EDITOR_CSS = readFileSync(
  fileURLToPath(new URL('../src/styles/editor.css', import.meta.url)),
  'utf8',
);

describe('the shelf reaches the callout', () => {
  it('takes its tint list from the shelf rather than restating one', () => {
    expect(CALLOUT_SRC).toMatch(/CALLOUT_TINTS[^=]*=\s*WASH_SWATCH_IDS/);
    // …and the picker offers the swatches themselves, not a slice of names.
    expect(CALLOUT_SRC).toContain('WASH_SWATCHES');
  });

  it('paints the wash itself, so a colour needs no selector to exist', () => {
    // The whole point of writing --co-* onto the element: a twenty-fifth
    // pigment, and any colour a reader types, render with no CSS at all.
    expect(CALLOUT_SRC).toMatch(/--co-light: \$\{wash\.css\.light\}/);
    expect(CALLOUT_SRC).toMatch(/renderHTML\(\{ node, HTMLAttributes \}\)/);
  });

  it('strands no pigment in the stylesheet', () => {
    // The regression that started this: editor.css had eleven `[data-tint=…]`
    // rules and the node knew six ids. Every tint the stylesheet can paint
    // must be a tint the picker can offer.
    const inCss = [...EDITOR_CSS.matchAll(/\.nb-callout\[data-tint='([a-z-]+)'\]/g)].map(
      (m) => m[1]!,
    );
    expect(inCss.length).toBeGreaterThan(0);
    for (const id of inCss) {
      expect(WASH_SWATCH_IDS, `${id} is paintable but unreachable`).toContain(id);
    }
  });

  it('still defaults to the tint every existing callout is wearing', () => {
    expect(DEFAULT_WASH_ID).toBe('amber');
    expect(washSwatch(DEFAULT_WASH_ID)).toBeDefined();
  });
});

describe('a reader’s own colour', () => {
  it('normalises every spelling of a hex, and refuses everything else', () => {
    expect(normaliseHex('#7D915C')).toBe('#7d915c');
    expect(normaliseHex('7d915c')).toBe('#7d915c');
    expect(normaliseHex('  #ABC  ')).toBe('#aabbcc');
    expect(normaliseHex('#abc')).toBe('#aabbcc');

    for (const junk of [
      '',
      '#',
      'rebeccapurple',
      'rgb(1 2 3)',
      '#12345',
      '#1234567',
      '#gggggg',
      null,
      undefined,
      42,
      {},
      ['#abcdef'],
    ]) {
      expect(normaliseHex(junk), `${String(junk)} should not parse`).toBeNull();
    }
  });

  it('survives every way an id can go missing', () => {
    const mine = '#3f7a5c';

    // 1. the ordinary case
    expect(resolveWash(CUSTOM_WASH_ID, mine).hex).toBe(mine);
    // 2. a named swatch wins when it is named
    expect(resolveWash('moss', mine).id).toBe('moss');
    expect(resolveWash('moss', mine).hex).toBeNull();
    // 3. the id was dropped by something older, the hex survived
    expect(resolveWash('a-tint-nobody-has-heard-of', mine).hex).toBe(mine);
    expect(resolveWash(undefined, mine).hex).toBe(mine);
    expect(resolveWash(null, mine).hex).toBe(mine);
    // 4. only one field existed and the hex went into it
    expect(resolveWash(mine).hex).toBe(mine);
    expect(resolveWash('3F7A5C').hex).toBe(mine);
    // 5. and only then, the default
    expect(resolveWash(undefined, undefined).id).toBe(DEFAULT_WASH_ID);
    expect(resolveWash('custom', 'not a colour').id).toBe(DEFAULT_WASH_ID);
    expect(resolveWash({}, []).id).toBe(DEFAULT_WASH_ID);
  });

  it('never comes back as a colour the ink cannot sit on', () => {
    // The one rule the whole flat style rests on: FLAT.ink is the same brown
    // outline on every shape, so nothing may be dark enough to swallow it.
    for (const extreme of ['#000000', '#ffffff', '#010203', '#00ff00', '#ff00ff', '#7f7f7f']) {
      const faces = customWashFaces(extreme);
      expect(lum(faces.base), `${extreme} sank the outline`).toBeGreaterThanOrEqual(INK_FLOOR - 0.5);
      expect(contrast(faces.base, FLAT.ink)).toBeGreaterThan(1.7);
      // …and it may not out-shout the loudest pigment the app already draws.
      expect(toOklch(faces.base).C).toBeLessThanOrEqual(WASH_BAND.chromaMax + 0.002);
      // …and it must stay inside the band, so it reads as one of the family.
      expect(toOklch(faces.base).L).toBeGreaterThanOrEqual(WASH_BAND.baseMin - 0.01);
      expect(toOklch(faces.base).L).toBeLessThanOrEqual(WASH_BAND.baseMax + 0.01);
    }
  });

  it('keeps its hue — the only part of it the reader actually chose', () => {
    for (const hex of ['#3f7a5c', '#8e3d6b', '#2b4260', '#e2d4b2']) {
      const before = toOklch(hex);
      const after = toOklch(customWashFaces(hex).base);
      const turn = Math.abs(((after.h - before.h + 540) % 360) - 180);
      expect(turn, `${hex} changed hue`).toBeLessThan(1.5);
    }
  });

  it('hands back a light face a reader can still read ink on', () => {
    // tokens.css promises body ink at >= 8:1 on every `-light` wash, and a
    // custom colour has to keep that promise or the callout it paints becomes
    // unreadable. Measured against the same ink the page is written in.
    const worstToken = Math.min(
      ...WASH_FAMILIES.map((f) => contrast(token(`wash-${f}-light`), token('ink-sepia'))),
    );
    expect(worstToken).toBeGreaterThanOrEqual(8);
    for (const hex of ['#000000', '#00ff00', '#ff0000', '#0000ff', '#3f7a5c']) {
      expect(contrast(washFaces(hex).light, token('ink-sepia'))).toBeGreaterThanOrEqual(8);
    }
  });
});

describe('the ids a document persists', () => {
  it('gives every swatch a distinct, stable id', () => {
    // Ids are written into document JSON, so two swatches sharing one id — or
    // one being renamed — silently redresses every block already wearing it.
    // This is also what a cache key would have been built out of, had the two
    // caches involved needed one; see the note in `art/customColour.ts`.
    expect(new Set(WASH_SWATCH_IDS).size).toBe(WASH_SWATCH_IDS.length);
    expect(WASH_SWATCH_IDS).not.toContain(CUSTOM_WASH_ID);
    for (const id of WASH_SWATCH_IDS) expect(id).toMatch(/^[a-z][a-z-]*$/);
  });
});

describe('the reader’s saved colours', () => {
  it('dedupes, promotes and caps, and refuses what is not a colour', () => {
    resetCustomColours();
    for (const c of customColours()) forgetCustomColour(c);

    expect(rememberCustomColour('nonsense')).toBeNull();
    expect(customColours()).toHaveLength(0);

    expect(rememberCustomColour('#ABC')).toBe('#aabbcc');
    rememberCustomColour('#3f7a5c');
    expect([...customColours()]).toEqual(['#3f7a5c', '#aabbcc']);

    // Re-adding promotes rather than duplicating.
    rememberCustomColour('#aabbcc');
    expect([...customColours()]).toEqual(['#aabbcc', '#3f7a5c']);

    forgetCustomColour('#3f7a5c');
    expect([...customColours()]).toEqual(['#aabbcc']);

    for (let i = 0; i < CUSTOM_COLOUR_LIMIT + 8; i += 1) {
      rememberCustomColour(`#${i.toString(16).padStart(2, '0')}5c7a`);
    }
    expect(customColours().length).toBeLessThanOrEqual(CUSTOM_COLOUR_LIMIT);
  });
});
