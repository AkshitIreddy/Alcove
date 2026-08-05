// @vitest-environment node
/**
 * tests/catalogue-reach.test.ts — can a reader actually reach the vocabulary?
 *
 * The page-side vocabulary grew to 472 values across eleven axes and none of
 * the growth was reachable: the catalogue panel built its list from
 * `src/script/vocab.ts` (the writing language's domain, five tapes) while
 * `BlockEffects` accepted `src/editor/effects/vocabulary.ts` (the editor's,
 * fifty). Everything validated, everything rendered, and forty-five values per
 * axis could not be picked from any menu in the app.
 *
 * Nothing failed. A count of the vocabulary said 472 and a count of what a
 * reader could apply said 43, and no test compared the two.
 *
 * These do. They are deliberately about REACHABILITY rather than about counts:
 * a number here would just be a third place to update.
 *
 * ...AND THE WAY THE FIRST TWO OF THEM USED TO BE VACUOUS, which is worth as
 * many lines as the regression itself, because the shape recurs.
 *
 * They were written against a local helper:
 *
 *     function catalogueEffects() {
 *       return EFFECT_AXES.flatMap((axis) =>
 *         axis.values.map((entry) => ({ key: axis.key, value: entry.value })));
 *     }
 *
 * — a MIRROR of `enumEffects` in CataloguePanel.tsx, written here because the
 * panel is a Solid component that cannot be imported into a node test. The two
 * tests then asked whether every entry of `EFFECT_AXES` appears in a set built
 * from `EFFECT_AXES`. `missing` was provably always `[]`; the panel's own file
 * was never opened; the mirror could not drift out of step with itself.
 *
 * Proved rather than argued: put the ORIGINAL BUG back — `enumEffects`
 * returning `axis.values.slice(0, 5).map(...)`, five values per axis where the
 * editor takes fifty, which is precisely the defect the header above describes
 * — and this file stayed 17/17 green, along with 223 tests in four other
 * files. Nothing in the suite could see it.
 *
 * So the panel is now READ. Not imported, not mirrored: opened as source, its
 * construction step located by name, and asserted on where it stands. That is
 * weaker than calling it and stronger than restating it, and it is the most a
 * node test can honestly do with a component it cannot load.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { EFFECT_AXES, EFFECT_KEYS } from '../src/editor/effects/vocabulary';
import { BLOCK_EFFECT_ATTRS } from '../src/editor/effects/blockEffects';
import * as scriptVocab from '../src/script/vocab';

const ROOT = join(import.meta.dirname, '..');
const PANEL_PATH = join(ROOT, 'src', 'views', 'rail', 'CataloguePanel.tsx');

/**
 * The panel's CODE, with its prose taken out.
 *
 * It has to be the code. This file's own header quotes `.slice(0, 5)` and the
 * panel's docblocks discuss "five tapes" and "fifty of each" at length — a
 * check run over the comments would be answered by the comments, which is the
 * same species of nothing as the mirror it replaces.
 */
function panelSource(): string {
  return readFileSync(PANEL_PATH, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * The `{…}` block that follows `marker`, matched by brace depth.
 *
 * Good enough for this one file because nothing it is pointed at holds a brace
 * inside a string or a template literal; if that ever changes, the block comes
 * back short and the guards on each caller fail loudly rather than quietly
 * passing on an empty string.
 */
function blockAfter(src: string, marker: string): string {
  const at = src.indexOf(marker);
  if (at < 0) {
    throw new Error(
      `CataloguePanel.tsx no longer contains \`${marker}\` — this test reads the ` +
        `panel's construction by name, so it must be renamed here too rather ` +
        `than left to pass on a file it can no longer find.`,
    );
  }
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces after \`${marker}\` in CataloguePanel.tsx`);
}

describe('the catalogue reaches the whole editor vocabulary', () => {
  it('turns every value of an axis into a tile, and never a prefix of them', () => {
    const body = blockAfter(panelSource(), 'function enumEffects(');

    // The vacuous-pass guard, first. An extractor that came back empty would
    // make every assertion below pass by having nothing to look at — which is
    // exactly the failure this whole file is being repaired for.
    expect(body.length, 'enumEffects body came back empty').toBeGreaterThan(120);
    expect(body, 'this is not enumEffects').toContain("axis.shelf === 'colour'");

    // THE REGRESSION, as the one line of code it lives in. `axis.values.map`
    // is the whole list; `axis.values.slice(0, 5).map` was the bug, and reads
    // identically at a glance.
    expect(body, "the panel must map the axis's WHOLE value list").toMatch(
      /return\s+axis\.values\.map\(/,
    );
    for (const narrowing of ['.slice(', '.filter(', '.splice(', 'CAP', 'limit']) {
      expect(
        body,
        `enumEffects narrows the axis with \`${narrowing}\` — every value it drops ` +
          `is a value the editor accepts and no menu in the app can reach`,
      ).not.toContain(narrowing);
    }

    // …and each tile carries the editor's own key, value and word for it. The
    // hand-written label map this replaced was the second place to forget.
    expect(body).toContain('key: axis.key');
    expect(body).toContain('value: entry.value');
    expect(body).toContain('label: entry.label');
  });

  it('feeds it every axis, and turns every spec into a tile', () => {
    const src = panelSource();

    // Every axis, spread whole. A hand-picked subset here would hide four
    // hundred values just as completely as a slice inside enumEffects.
    expect(src, 'EFFECTS must be built from every axis').toMatch(
      /\.\.\.EFFECT_AXES\.flatMap\(enumEffects\)/,
    );

    // …and the panel's entry list must draw one tile per spec. A spec that
    // reaches EFFECTS and never reaches `out` is unreachable by another route.
    const loop = blockAfter(src, 'for (const spec of EFFECTS)');
    expect(loop.length).toBeGreaterThan(120);
    expect(loop, 'the EFFECTS loop no longer pushes a tile').toContain('out.push(');
    expect(
      loop,
      'the EFFECTS loop skips specs — which spec, and can the reader reach it another way?',
    ).not.toContain('continue');
  });

  /**
   * The specific regression, and now BOTH halves of it.
   *
   * The script domain is ALLOWED to be smaller — a name there is a promise to
   * a chatbot — but the reader's panel may never be capped by it. The size
   * comparison below was the only thing here, and it compares two vocabularies
   * to each other without ever looking at the panel: it would have gone on
   * passing for as long as the editor's lists were the longer ones, no matter
   * which of the two the panel had its import pointed at. The import IS the
   * bug, so the import is what is checked.
   */
  it('is not capped by the writing language domain', () => {
    const src = panelSource();
    expect(src, 'the panel must read the EDITOR vocabulary').toMatch(
      /import \{[^}]*EFFECT_AXES[^}]*\} from '[^']*editor\/effects\/vocabulary'/,
    );
    expect(
      src,
      "the panel is reading src/script/vocab — that is the writing language's " +
        'domain, deliberately small, and it caps the reader at five tapes',
    ).not.toMatch(/from '[^']*script\/vocab'/);

    const byKey = new Map(EFFECT_AXES.map((a) => [a.key, a.values.length]));
    const pairs: Array<[string, readonly string[]]> = [
      ['tape', scriptVocab.TAPE_VALUES],
      ['washi', scriptVocab.WASHI_VALUES],
      ['frame', scriptVocab.FRAME_VALUES],
      ['paper', scriptVocab.BLOCK_PAPER_VALUES],
      ['underline', scriptVocab.UNDERLINE_VALUES],
      ['ink', scriptVocab.BLOCK_INK_VALUES],
    ];
    for (const [key, scriptValues] of pairs) {
      expect(byKey.get(key) ?? 0, `${key} should exceed the script domain`).toBeGreaterThan(
        scriptValues.length,
      );
    }
  });

  /*
   * The one cap that is NOT a cap, said out loud so nobody removes it thinking
   * it is the bug: the render wraps each run in `<Capped limit={CAP}>`, which
   * shows twenty and offers "37 more" (DesignStrip.Capped — open() returns
   * `props.each` whole). That is a reveal, and a reveal keeps the value
   * reachable. Only a narrowing of the LIST makes a value unreachable, which
   * is why the checks above are scoped to the construction and not to the file.
   */
  it('caps the runs with a reveal, never with a cut', () => {
    const src = panelSource();
    expect(src, 'the runs are no longer wrapped in <Capped limit={CAP}>').toMatch(
      /<Capped[\s\S]{0,400}?limit=\{CAP\}/,
    );
    const strip = readFileSync(join(ROOT, 'src', 'views', 'rail', 'DesignStrip.tsx'), 'utf8');
    // The head is the CAP; `open()` hands back the untouched list behind it.
    expect(
      strip,
      'DesignStrip.Capped no longer returns the whole list when open — if it now ' +
        'truncates, the catalogue caps the reader at CAP values per axis and the ' +
        'checks above are looking at the wrong end of the pipe',
    ).toMatch(/open\(\)\s*\?\s*props\.each\s*:/);
  });
});

describe('everything the catalogue offers, the editor accepts', () => {
  /**
   * The other direction, and the one that would ship a dead button: a panel
   * offering an attribute BlockEffects does not carry renders a chip that does
   * nothing when clicked.
   */
  it('has an attribute for every axis the panel can set', () => {
    for (const axis of EFFECT_AXES) {
      expect(BLOCK_EFFECT_ATTRS, `no attribute for axis ${axis.key}`).toContain(axis.key);
    }
  });

  it('keeps EFFECT_KEYS aligned with the axes', () => {
    for (const axis of EFFECT_AXES) expect(EFFECT_KEYS).toContain(axis.key);
  });
});

describe('everything the editor accepts, the stylesheet paints', () => {
  /*
   * THE LAST LINK, and the one that had been missing twice.
   *
   * The tests above walk the chain panel → vocabulary → attribute and stop
   * there. But an attribute is only a promise: BlockEffects writes
   * `data-font="copperplate"` onto the block exactly as designed, and if no
   * rule reads it the block looks precisely as it did before. Nothing errors,
   * because an attribute nobody styles is not a mistake in CSS — it is
   * ordinary markup.
   *
   * It has now happened twice. First the `color` axis: fifty pigments, no
   * rules, all inert (see scripts/gen-tints.mjs). Then the entire "lettering"
   * shelf — hand, ink, size, ranging, 122 values — same way, and the only
   * evidence was a reader noticing every specimen looked the same.
   *
   * So: every value of every axis must be named by a selector in the
   * stylesheets. Per VALUE, not per axis — one rule for `data-font='hand'`
   * would otherwise vouch for the other forty-nine.
   */
  const CSS_DIR = join(import.meta.dirname, '..', 'src', 'styles');
  const css = readdirSync(CSS_DIR)
    .filter((n) => n.endsWith('.css'))
    .map((n) => readFileSync(join(CSS_DIR, n), 'utf8'))
    .join('\n');

  /*
   * The only values allowed to have no rule of their own, and why.
   *
   * `tape` and `washi` both open on `top`, and the bare `[data-tape]` /
   * `[data-washi]` rules set the default geometry — a strip across the top —
   * which IS that value. A `[data-tape='top']` rule would only restate it, and
   * restating a default is how a default drifts.
   *
   * Written as an allowlist rather than "the first value of any axis is
   * exempt": that looser rule would have excused `underline: squiggle`, whose
   * bare rule sets `position: relative` and paints nothing at all.
   */
  const PAINTED_BY_THE_DEFAULT_RULE = new Set(['tape:top', 'washi:top']);

  it.each(EFFECT_AXES.map((axis) => [axis.key, axis] as const))(
    'paints every value of %s',
    (key, axis) => {
      const unpainted = axis.values
        .map((entry) => entry.value)
        .filter((value) => !PAINTED_BY_THE_DEFAULT_RULE.has(`${key}:${value}`))
        .filter((value) => !css.includes(`[data-${key}='${value}']`));
      expect(
        unpainted,
        `${unpainted.length} of ${axis.values.length} ${key} values have no rule. ` +
          `If this axis is generated, re-run its script (scripts/gen-lettering.mjs, ` +
          `scripts/gen-tints.mjs); otherwise the values are inert.`,
      ).toEqual([]);
    },
  );

  it('would notice if a whole axis lost its rules', () => {
    // Guards the check itself: if the quoting convention above ever changes,
    // `css.includes` silently matches nothing and every axis "passes" empty.
    expect(css).toContain(`[data-font='copperplate']`);
    expect(css).toContain(`[data-color='amber']`);
  });
});
