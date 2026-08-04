// @vitest-environment node
/**
 * tests/control-contrast.test.ts — every control the stylesheets declare,
 * measured in every room the settings can build.
 *
 * ## Why this exists next to tests/contrast.test.ts
 *
 * `contrast.test.ts` gates a hand-written list of token PAIRS. That list is
 * only as good as the pairings somebody thought to add to it, and it shipped
 * carrying this row:
 *
 *     ['info', 'ink-sepia / wash-amber (solid fill — keep unused for type)', 0]
 *
 * — an UNGATED note politely asking the stylesheets not to do a thing, while
 * eight rules across six stylesheets were doing exactly that. The worst of them
 * was `.nbt-btn--primary`, the tour's "next" button: the primary advance
 * control on the first card a new reader ever sees, measured at
 *
 *     day   sepia 6.26  graphite 6.02  ink-blue 3.89
 *     night sepia 1.54  graphite 1.30  ink-blue 1.05
 *
 * with the BACK button beside it at 8.03:1. Nothing in the suite could see it,
 * because nothing in the suite read the stylesheets — and a contrast regression
 * is invisible to everything else this repo has. tsc is happy, the unit tests
 * are happy, the screenshot looks like a button.
 *
 * So this suite does not ask what SHOULD pair. `scripts/check-control-contrast
 * .mjs` reads the stylesheets and finds what DOES:
 *
 *   1. rules that declare a colour and a ground in the same block;
 *   2. state rules (`:hover`, `.is-active`) that repaint only the ground, with
 *      the colour peeled back from the base selector;
 *   3. descendants (`.card.is-active .blurb`) whose ground comes from the
 *      ancestor rule;
 *   4. SVG marks (`fill` / `stroke`) drawn on their own declared ground.
 *
 * ## The matrix
 *
 * The CLI can only reach the four stylesheet rooms x the three `[data-ink]`
 * remaps. The appearance vocabulary is TypeScript, so THIS file runs the real
 * one: 30 themes x 34 inks, each resolved exactly the way `apply.ts` does it —
 * the `[data-theme]` room, then the `[data-ink]` remap, then the inline custom
 * properties `appearanceTokens()` writes on <html>. Plus a paper sweep, because
 * a paper stock moves all four `--paper-*` rungs and re-solves the ink on top
 * of them.
 *
 * ## The rule the whole thing keeps finding
 *
 * A theme is a set of tokens that INVERT together. `--ink-sepia` and
 * `--paper-cream` swap ends of the value scale after dark; `--wash-amber`,
 * `--gilt-face` and `--accent` do not — they are fixed bright faces in all four
 * rooms. Pair an inverting ink with a non-inverting fill and it reads under a
 * window and vanishes under a lamp. That is one bug, found fourteen times.
 */
import { describe, expect, it } from 'vitest';

import {
  AA_LARGE,
  AA_TEXT,
  checkControls,
  collectPairs,
  collectRules,
  groupViolations,
  measurePair,
  stylesheetInkRemaps,
  themeInkMatrix,
} from '../scripts/check-control-contrast.mjs';
import { loadThemes } from '../scripts/check-contrast.mjs';
import {
  APP_THEMES,
  INKS,
  PAPERS,
  appearanceTokens,
} from '../src/features/settings/appearance';

type Tokens = Map<string, string>;

/* ------------------------------ the matrix -------------------------------- */

/**
 * One room, resolved the way `features/settings/apply.ts` resolves it:
 *
 *   1. `data-theme` = the theme's BASE — one of the four hand-tuned rooms in
 *      styles/settings.css;
 *   2. `data-ink` = the ink id, which remaps `--ink-sepia` for the three inks
 *      the stylesheet owns;
 *   3. the inline custom properties `appearanceTokens()` writes on <html>,
 *      which win over both. An empty value REMOVES the declaration rather than
 *      setting it to nothing — that is how a shipped room gets its stylesheet
 *      values back — so empties are skipped here too.
 */
function room(themeId: string, base: string, inkId: string, paperId: string | null): Tokens {
  const rooms = loadThemes() as Record<string, Tokens>;
  const tokens = new Map(rooms[base]);
  const remap = (stylesheetInkRemaps() as Map<string, Tokens>).get(inkId);
  if (remap) for (const [k, v] of remap) tokens.set(k, v);
  for (const [k, v] of Object.entries(appearanceTokens(themeId, inkId, paperId))) {
    if (v !== '') tokens.set(k, v);
  }
  return tokens;
}

/** Built once: `loadThemes()` and the remap parse both hit the disk. */
const ROOMS = loadThemes() as Record<string, Tokens>;
const REMAPS = stylesheetInkRemaps() as Map<string, Tokens>;

function buildRoom(themeId: string, base: string, inkId: string, paperId: string | null): Tokens {
  const tokens = new Map(ROOMS[base]);
  const remap = REMAPS.get(inkId);
  if (remap) for (const [k, v] of remap) tokens.set(k, v);
  for (const [k, v] of Object.entries(appearanceTokens(themeId, inkId, paperId))) {
    if (v !== '') tokens.set(k, v);
  }
  return tokens;
}

/**
 * The pairs, deduplicated by the VALUES being compared.
 *
 * ~250 declared pairs collapse to a few dozen distinct token pairings, and the
 * matrix is a thousand rooms wide — measuring the duplicates would turn a
 * two-second suite into a minute for no extra coverage. The first rule to
 * declare a pairing carries the blame for it, which is also the rule a reader
 * should be sent to.
 */
function distinctPairs(): ReturnType<typeof collectPairs> {
  const seen = new Map<string, unknown>();
  for (const pair of collectPairs()) {
    const key = `${pair.fg}|${pair.bg}|${pair.gate}`;
    if (!seen.has(key)) seen.set(key, pair);
  }
  return [...seen.values()] as ReturnType<typeof collectPairs>;
}

const PAIRS = collectPairs();
const UNIQUE = distinctPairs();

/** Every rule that declares a given pairing, so a fix cannot land on one of six. */
const SIBLINGS = new Map<string, string[]>();
for (const pair of PAIRS) {
  const key = `${pair.fg}|${pair.bg}|${pair.gate}`;
  const at = `${pair.file}:${pair.line} ${pair.selector}`;
  SIBLINGS.set(key, [...(SIBLINGS.get(key) ?? []), at]);
}

/**
 * The failure message names EVERY rule that declares the failing pairing.
 *
 * The matrix is measured on one representative per pairing, for speed — and a
 * report that also named only the representative would send a reader to fix
 * `.nb-pack-caveat` while five other rules kept the same 3.49:1. Dedupe the
 * work, never the blame.
 */
const report = (violations: ReturnType<typeof checkControls>['violations']): string[] =>
  groupViolations(violations).map((g) => {
    const rules = SIBLINGS.get(`${g.fg}|${g.bg}|${g.gate}`) ?? [`${g.file}:${g.line} ${g.selector}`];
    return (
      `{${g.prop}: ${g.fg}} on {${g.bg}} — ${g.worst.toFixed(2)}:1 under ${g.gate}:1 ` +
      `in ${g.combos.length} room(s) (worst: ${g.combos[0]}) — ${rules.join(' · ')}`
    );
  });

/* ============================ the sweep still sweeps ====================== */

describe('the sweep can still see the app', () => {
  /*
   * A gate that stops finding its subject goes green forever. This repo's
   * signature defect is authored-but-unreachable code, and a scanner that
   * quietly matches nothing is exactly that — so the reach is asserted before
   * anything is measured.
   */
  it('reads every stylesheet in src/, not only src/styles/', () => {
    const files = new Set(PAIRS.map((p) => p.file));
    expect(files.size).toBeGreaterThan(10);
    // The taste questionnaire keeps its stylesheet beside its feature. A sweep
    // that only globbed src/styles/ would have declared it clean unopened —
    // and it held three of the fourteen faults.
    expect([...files]).toContain('src/features/tutorial/taste.css');
  });

  it('finds all four kinds of pair', () => {
    const kinds = new Set(PAIRS.map((p) => p.kind));
    expect([...kinds].sort()).toEqual(['descendant', 'inherited', 'mark', 'text']);
  });

  it('finds the controls that were broken, by name', () => {
    const selectors = PAIRS.map((p) => `${p.file} ${p.selector}`);
    const must = [
      'src/styles/tutorial.css .nbt-btn--primary',
      'src/styles/tutorial.css .nbt-btn--primary.is-done',
      'src/styles/tutorial.css .nbt-choice-btn.is-picked',
      'src/styles/tutorial.css .nbt-choice-btn.is-picked .nbt-choice-sub',
      'src/styles/tutorial.css .nbt-task',
      'src/styles/tutorial.css .nbt-hint',
      'src/features/tutorial/taste.css .nbq-btn--primary',
      'src/styles/packs.css .nb-pack-tab.is-active',
      'src/styles/transfer.css .nb-tr-chip[data-active=\'true\']',
      'src/styles/studio.css .nb-pick-card.is-active .nb-pick-blurb',
      'src/styles/global.css ::selection',
    ];
    expect(must.filter((m) => !selectors.includes(m))).toEqual([]);
  });

  it('gates a real number of pairs', () => {
    expect(PAIRS.length).toBeGreaterThan(200);
    expect(UNIQUE.length).toBeGreaterThan(60);
  });
});

/* ============================== the gate has teeth ======================== */

describe('the gate has teeth', () => {
  /*
   * The measurement is asserted against the defect it was written for, using
   * the exact declaration that shipped. If a refactor ever makes this pass,
   * the sweep has stopped measuring rather than the app having got better.
   */
  const BROKEN = `
    .nbt-btn--primary { background: var(--wash-amber); color: var(--ink-sepia); }
  `;

  it('reports the shipped defect at the ratios that were measured off it', () => {
    const [rule] = collectRules(BROKEN, 'fixture.css');
    const pair = {
      fg: rule.decls.get('color'),
      bg: rule.decls.get('background'),
      gate: AA_TEXT,
    };
    const ratios = (inkId: string, base: string): number =>
      measurePair(buildRoom(base === 'night' ? 'night' : 'parchment', base, inkId, null), pair);

    // The numbers in the header of this file, to two decimals.
    expect(ratios('sepia', 'parchment')).toBeCloseTo(6.26, 1);
    expect(ratios('graphite', 'parchment')).toBeCloseTo(6.02, 1);
    expect(ratios('ink-blue', 'parchment')).toBeCloseTo(3.89, 1);
    expect(ratios('sepia', 'night')).toBeCloseTo(1.54, 1);
    expect(ratios('graphite', 'night')).toBeCloseTo(1.3, 1);
    expect(ratios('ink-blue', 'night')).toBeCloseTo(1.05, 1);
  });

  it('an inverting ink on a fixed-bright fill fails somewhere in the matrix', () => {
    // The one rule, stated as a property: --wash-amber, --gilt-face and
    // --accent are the same value in a lit room and a dark one; --ink-sepia is
    // not. Pairing them cannot be safe, whatever the day-time number says.
    for (const fill of ['--wash-amber', '--gilt-face']) {
      const worst = Math.min(
        ...[...themeInkMatrix().values()].map((tokens) =>
          measurePair(tokens as Tokens, {
            fg: 'var(--ink-sepia)',
            bg: `var(${fill})`,
            gate: AA_TEXT,
          }),
        ),
      );
      expect(worst).toBeLessThan(AA_TEXT);
    }
  });
});

/* =========================== the four shipped rooms ======================= */

describe('the four stylesheet rooms x the three stylesheet inks', () => {
  const { violations } = checkControls(themeInkMatrix(), PAIRS);

  it(`clears ${AA_TEXT}:1 for text and ${AA_LARGE}:1 for marks`, () => {
    expect(report(violations)).toEqual([]);
  });
});

/* ======================= every theme x every ink ========================== */

describe('every appearance theme x every ink', () => {
  const matrix = new Map<string, Tokens>();
  for (const theme of APP_THEMES) {
    for (const ink of INKS) {
      matrix.set(`${theme.id} / ${ink.id}`, buildRoom(theme.id, theme.base, ink.id, null));
    }
  }
  const { violations } = checkControls(matrix, UNIQUE);

  it('builds the whole matrix (30 themes x 34 inks)', () => {
    expect(matrix.size).toBe(APP_THEMES.length * INKS.length);
    expect(matrix.size).toBeGreaterThan(900);
  });

  it('clears every gate in every room', () => {
    expect(report(violations)).toEqual([]);
  });
});

/* ============================ every paper stock =========================== */

describe('every paper stock, on every room', () => {
  /*
   * A stock moves all four `--paper-*` rungs and the ink is re-solved against
   * the new ground, so it is its own axis. The ink is pinned to the three the
   * stylesheet owns plus the two derivation extremes — the cross of all three
   * axes is 25k rooms and buys nothing the two sweeps above have not covered.
   */
  const INK_SAMPLE = ['sepia', 'graphite', 'ink-blue', 'lilac', 'mustard'];
  const matrix = new Map<string, Tokens>();
  for (const theme of APP_THEMES) {
    for (const paper of PAPERS) {
      for (const inkId of INK_SAMPLE) {
        matrix.set(
          `${theme.id} / ${inkId} / ${paper.id}`,
          buildRoom(theme.id, theme.base, inkId, paper.id),
        );
      }
    }
  }
  const { violations } = checkControls(matrix, UNIQUE);

  it('covers every stock', () => {
    expect(matrix.size).toBe(APP_THEMES.length * PAPERS.length * INK_SAMPLE.length);
  });

  it('clears every gate on every stock', () => {
    expect(report(violations)).toEqual([]);
  });
});

/* --------------------------- keep `room` honest --------------------------- */

describe('the room builder agrees with apply.ts', () => {
  it('lets the inline appearance tokens win over the stylesheet room', () => {
    // 'midnight' is dressed over the night room but writes its own paper.
    const tokens = room('midnight', 'night', 'sepia', null);
    expect(tokens.get('--paper-cream')).not.toBe(ROOMS['night'].get('--paper-cream'));
  });

  it('leaves a shipped room on its own paper untouched', () => {
    const tokens = room('night', 'night', 'sepia', null);
    expect(tokens.get('--paper-cream')).toBe(ROOMS['night'].get('--paper-cream'));
  });

  it('lets a [data-ink] remap through when the vocabulary writes nothing', () => {
    const tokens = room('parchment', 'parchment', 'ink-blue', null);
    expect(tokens.get('--ink-sepia')).toBe('var(--ink-blue)');
  });
});
