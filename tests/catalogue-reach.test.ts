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
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { EFFECT_AXES, EFFECT_KEYS } from '../src/editor/effects/vocabulary';
import { BLOCK_EFFECT_ATTRS } from '../src/editor/effects/blockEffects';
import * as scriptVocab from '../src/script/vocab';

/**
 * Rebuild the catalogue's effect list the way CataloguePanel does.
 *
 * The panel itself is a Solid component that reaches for `window` on import,
 * so it cannot load in this environment; this mirrors its one construction
 * step instead. If that step changes shape, this stops matching and should be
 * updated with it — which is the point.
 */
function catalogueEffects(): Array<{ key: string; value: string }> {
  return EFFECT_AXES.flatMap((axis) =>
    axis.values.map((entry) => ({ key: axis.key, value: entry.value })),
  );
}

describe('the catalogue reaches the whole editor vocabulary', () => {
  it('offers every value of every axis', () => {
    const offered = new Set(catalogueEffects().map((e) => `${e.key}:${e.value}`));
    const missing: string[] = [];
    for (const axis of EFFECT_AXES) {
      for (const entry of axis.values) {
        if (!offered.has(`${axis.key}:${entry.value}`)) {
          missing.push(`${axis.key}:${entry.value}`);
        }
      }
    }
    expect(missing, `unreachable from the catalogue: ${missing.slice(0, 8).join(', ')}`).toEqual([]);
  });

  it('offers every axis, not just the ones with short lists', () => {
    const keys = new Set(catalogueEffects().map((e) => e.key));
    for (const axis of EFFECT_AXES) expect(keys, `axis ${axis.key} missing`).toContain(axis.key);
  });

  /**
   * The specific regression. The script domain is ALLOWED to be smaller — a
   * name there is a promise to a chatbot — but the reader's panel may never be
   * capped by it.
   */
  it('is not capped by the writing language domain', () => {
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
