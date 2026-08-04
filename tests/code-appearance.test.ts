/**
 * tests/code-appearance.test.ts — the code look, measured rather than admired.
 *
 * `tests/control-contrast.test.ts` reads the STYLESHEETS and gates what they
 * declare. That covers the shipped code look, because tokens.css authors it —
 * and it covers exactly one of the twenty-two, because the other twenty-one
 * exist only as arithmetic in `features/settings/codeAppearance.ts` and never
 * appear in a CSS file at all.
 *
 * This is the other half: every code theme, in every room, on a sample of
 * inks and stocks, with every colour it produces measured against the ground
 * it will really sit on. It is the same bargain `plugged-in.test.ts` makes
 * about the appearance derivation — if the arithmetic is what makes it safe
 * to offer a reader thirty rooms and twenty-two listings, then the arithmetic
 * is what has to be checked, not a screenshot of one of them.
 */

import { describe, expect, it } from 'vitest';

import {
  APP_THEMES,
  INKS,
  PAPERS,
  contrastRatio,
  pageGrounds,
} from '../src/features/settings/appearance';
import {
  CODE_FACE_SPECS,
  CODE_FRAMES,
  CODE_ROLES,
  CODE_THEMES,
  CODE_THEME_FAMILIES,
  CODE_THEME_ROLL,
  CODE_THEME_SHORTLIST,
  DEFAULT_CODE_THEME_ID,
  FALLBACK_CODE_THEME_ID,
  codeSwatch,
  codeTokens,
  resolveCodeFace,
  resolveCodeFrame,
  resolveCodeTheme,
} from '../src/features/settings/codeAppearance';
import {
  DEFAULT_CODE_LOOK,
  normalizeCodeLook,
} from '../src/features/settings/codeAppearancePrefs';

/** WCAG AA for text. The derivation aims at 4.6 so the gate has room in it. */
const AA_TEXT = 4.5;
/** WCAG AA for a non-text mark — a rule, an outline, a tick. */
const AA_MARK = 3;
/**
 * How far a themed PLATE has to sit from the page under it.
 *
 * Not a WCAG number: nothing is written across that boundary, so the question
 * is only "can you see that there is a card there". 1.35:1 is about the point
 * at which two flat fills stop reading as one — well under the text gates, and
 * enough to catch the real failure, which is a dark plate in a dark room.
 */
const PLATE_AGAINST_PAGE = 1.35;

/**
 * The sample the sweep runs over.
 *
 * Every code theme against every room is 22 x 30 = 660 combinations, and each
 * one solves ten colours through a 22-step binary search. Crossing that with
 * all 34 inks and all 24 stocks is 540k solves and buys nothing: the ink only
 * reaches the code through `--code-ink` (and only for the themes that do not
 * name their own), and the stock only reaches it through the paper rungs. So
 * both axes are sampled at their extremes — the two inks the derivation
 * stretches furthest, and the lightest and darkest stocks in the drawer —
 * which is where a failure would be if there were one.
 */
const INK_SAMPLE = ['sepia', 'graphite', 'ink-blue', 'lilac', 'mustard'];
const PAPER_SAMPLE: Array<string | null> = [null, 'kraft', 'papyrus', 'onion', 'blueprint'];

interface Row {
  readonly room: string;
  readonly tokens: Readonly<Record<string, string>>;
}

function sweep(): Row[] {
  const rows: Row[] = [];
  for (const codeTheme of CODE_THEMES) {
    for (const theme of APP_THEMES) {
      for (const ink of INK_SAMPLE) {
        for (const paper of PAPER_SAMPLE) {
          rows.push({
            room: `${codeTheme.id} · ${theme.id} / ${ink} / ${paper ?? 'as the room'}`,
            tokens: codeTokens(codeTheme.id, theme.id, ink, paper),
          });
        }
      }
    }
  }
  return rows;
}

const ROWS = sweep();

/** Worst offender per (token, gate) pair, so a failure names one row. */
function violations(
  pairs: ReadonlyArray<readonly [fg: string, bg: string, gate: number]>,
): string[] {
  const worst = new Map<string, { ratio: number; room: string; count: number }>();
  for (const row of ROWS) {
    for (const [fg, bg, gate] of pairs) {
      const a = row.tokens[fg];
      const b = row.tokens[bg];
      const ratio = contrastRatio(a, b);
      if (ratio >= gate) continue;
      const key = `${fg} on ${bg}`;
      const seen = worst.get(key);
      if (seen === undefined || ratio < seen.ratio) {
        worst.set(key, { ratio, room: row.room, count: (seen?.count ?? 0) + 1 });
      } else {
        seen.count += 1;
      }
    }
  }
  return [...worst.entries()]
    .map(
      ([key, hit]) =>
        `${key} — ${hit.ratio.toFixed(2)}:1 (worst: ${hit.room}), ${hit.count} row(s)`,
    )
    .sort();
}

describe('the sweep is the size it claims to be', () => {
  it('covers every code theme in every room', () => {
    expect(CODE_THEMES.length).toBeGreaterThanOrEqual(20);
    expect(ROWS.length).toBe(
      CODE_THEMES.length * APP_THEMES.length * INK_SAMPLE.length * PAPER_SAMPLE.length,
    );
    expect(ROWS.length).toBeGreaterThan(10_000);
  });

  it('produces every token for every row, and no empty ones', () => {
    const keys = Object.keys(ROWS[0].tokens).sort();
    expect(keys).toContain('--code-plate');
    expect(keys).toContain('--code-ink');
    for (const role of CODE_ROLES) expect(keys).toContain(`--code-${role}`);
    // Collected rather than asserted per row: `expect` is expensive enough
    // that 16,500 rows x 14 keys of it takes longer than the whole sweep.
    // Unlike `appearanceTokens`, nothing here may be blank — a code block has
    // no stylesheet room of its own to fall back to.
    const blank: string[] = [];
    for (const row of ROWS) {
      for (const key of keys) {
        const value = row.tokens[key];
        if (value === undefined || value === '') blank.push(`${key} in ${row.room}`);
      }
    }
    expect(blank).toEqual([]);
  });
});

describe('every code colour clears its gate, in every room', () => {
  it('the seven roles are readable on the plate', () => {
    expect(
      violations(CODE_ROLES.map((role) => [`--code-${role}`, '--code-plate', AA_TEXT])),
    ).toEqual([]);
  });

  it('comments are held to the SAME floor as the code', () => {
    // The genre's signature failure. Nearly every IDE theme ships a comment
    // colour under AA, and a comment is prose a human wrote for a human —
    // the last thing on the block that should be hard to read.
    expect(violations([['--code-comment', '--code-plate', AA_TEXT]])).toEqual([]);
  });

  it('the code ink is readable on the plate AND on the tab', () => {
    expect(
      violations([
        ['--code-ink', '--code-plate', AA_TEXT],
        ['--code-ink', '--code-tab', AA_TEXT],
      ]),
    ).toEqual([]);
  });

  it('the quiet colours are quiet, not invisible', () => {
    expect(
      violations([
        ['--code-punct', '--code-plate', AA_TEXT],
        ['--code-gutter', '--code-plate', AA_TEXT],
      ]),
    ).toEqual([]);
  });

  it('the outline is still an outline', () => {
    expect(violations([['--code-rim', '--code-plate', AA_MARK]])).toEqual([]);
  });
});

describe('the plate is a plate', () => {
  /**
   * A theme that names its own fill has to stay visible against the page it
   * lands on — a dark plate in a dark room is not a plate, it is a rectangle
   * you cannot see. The rungs are exempt: those ARE the page's own papers, and
   * a block set one rung into the sheet is meant to be a fold, not a card.
   */
  it('a themed plate never disappears into the page it lies on', () => {
    const failures: string[] = [];
    for (const codeTheme of CODE_THEMES) {
      if ('rung' in codeTheme.plate) continue;
      for (const theme of APP_THEMES) {
        for (const paper of PAPER_SAMPLE) {
          const plate = codeTokens(codeTheme.id, theme.id, 'sepia', paper)[
            '--code-plate'
          ];
          // The page the block is lying on, from the same source the real page
          // takes it from — not from the tokens the block itself produced.
          const page = pageGrounds(theme.id, paper).cream;
          const ratio = contrastRatio(plate, page);
          if (ratio < PLATE_AGAINST_PAGE) {
            failures.push(
              `${codeTheme.id} · ${theme.id} / ${paper ?? 'room'} — ${ratio.toFixed(2)}:1`,
            );
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('the tab is a different face from the plate', () => {
    const same: string[] = [];
    for (const row of ROWS) {
      if (row.tokens['--code-tab'] === row.tokens['--code-plate']) same.push(row.room);
    }
    expect(same).toEqual([]);
  });
});

/*
 * Derived here rather than imported: neither list has a reader in `src/`, and
 * `tests/plugged-in.test.ts` now watches this module — an export kept alive
 * only so a test can name it is exactly the shape that alarm exists to find.
 */
const CODE_THEME_IDS = CODE_THEMES.map((t) => t.id);
const CODE_THEME_TIERS = ['signature', 'shelf', 'niche', 'oddity'] as const;

describe('the vocabulary keeps the house rules', () => {
  it('every theme declares a family and a tier, and the order is derived', () => {
    const rank = (id: string): number => {
      const spec = resolveCodeTheme(id);
      return (
        CODE_THEME_FAMILIES.indexOf(spec.family) * 100 +
        CODE_THEME_TIERS.indexOf(spec.tier as (typeof CODE_THEME_TIERS)[number])
      );
    };
    const ranks = CODE_THEME_IDS.map(rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('ids are unique and labels are lowercase stationer words', () => {
    expect(new Set(CODE_THEME_IDS).size).toBe(CODE_THEME_IDS.length);
    for (const spec of CODE_THEMES) {
      expect(spec.label).toBe(spec.label.toLowerCase());
      expect(spec.blurb.length).toBeGreaterThan(10);
    }
  });

  it('the shortlist is the signatures, and the dice never roll an oddity', () => {
    expect(CODE_THEME_SHORTLIST.every((s) => s.tier === 'signature')).toBe(true);
    expect(CODE_THEME_SHORTLIST.length).toBeGreaterThanOrEqual(4);
    expect(CODE_THEME_ROLL.every((s) => s.tier !== 'oddity')).toBe(true);
  });

  it('the default and the fallback are two different constants', () => {
    // The carpentry's rule: merging them means a corrupt row paints the
    // handsome default and a reader cannot tell a fault from their own choice.
    expect(DEFAULT_CODE_THEME_ID).not.toBe(FALLBACK_CODE_THEME_ID);
    expect(resolveCodeTheme('nonsense').id).toBe(FALLBACK_CODE_THEME_ID);
    expect(resolveCodeTheme(null).id).toBe(FALLBACK_CODE_THEME_ID);
    expect(resolveCodeTheme(DEFAULT_CODE_THEME_ID).id).toBe(DEFAULT_CODE_THEME_ID);
  });

  it('no face offered for code is a handwriting face', () => {
    // CLAUDE.md's floor, applied to shape rather than size: a column of code
    // lines up because every character is the same width.
    for (const face of CODE_FACE_SPECS) {
      expect(face.stack.toLowerCase()).toContain('mono');
      expect(face.stack).not.toMatch(/Caveat|Patrick Hand|Kalam|Gochi|Shadows/i);
    }
    expect(resolveCodeFace('nonsense').id).toBe(CODE_FACE_SPECS[0].id);
  });

  it('frames resolve totally', () => {
    for (const frame of CODE_FRAMES) expect(resolveCodeFrame(frame)).toBe(frame);
    expect(CODE_FRAMES).toContain(resolveCodeFrame('nonsense'));
    expect(CODE_FRAMES).toContain(resolveCodeFrame(null));
  });
});

describe('the stored look is total', () => {
  it('junk out of SQLite gives a whole look, never a throw', () => {
    for (const junk of [null, undefined, 42, 'nope', [], { theme: 7 }]) {
      expect(() => normalizeCodeLook(junk)).not.toThrow();
      const look = normalizeCodeLook(junk);
      expect(CODE_THEME_IDS).toContain(look.theme);
      expect(CODE_FRAMES).toContain(look.frame);
    }
  });

  it('one bad field does not take the other four with it', () => {
    const look = normalizeCodeLook({
      theme: 'blueprint',
      frame: 'wobbly',
      face: 'nonsense',
      size: 'big',
      numbers: 'yes',
    });
    expect(look.theme).toBe('blueprint');
    expect(look.frame).toBe(resolveCodeFrame('wobbly'));
    expect(look.size).toBe(DEFAULT_CODE_LOOK.size);
    expect(look.numbers).toBe(DEFAULT_CODE_LOOK.numbers);
  });

  it('clamps the size into the range the slider offers', () => {
    expect(normalizeCodeLook({ size: 400 }).size).toBeLessThanOrEqual(20);
    expect(normalizeCodeLook({ size: -3 }).size).toBeGreaterThanOrEqual(12);
  });
});

describe('a picker chip cannot lie about the page', () => {
  it('the swatch is the same arithmetic the real block gets', () => {
    for (const spec of CODE_THEMES) {
      const swatch = codeSwatch(spec.id, 'parchment', 'sepia', null);
      const tokens = codeTokens(spec.id, 'parchment', 'sepia', null);
      expect(swatch.plate).toBe(tokens['--code-plate']);
      expect(swatch.keyword).toBe(tokens['--code-keyword']);
      expect(swatch.comment).toBe(tokens['--code-comment']);
    }
  });

  it('every stock in the drawer is still a stock this sweep could sample', () => {
    // The sample is a shortcut, and a shortcut that quietly names a stock the
    // app removed is worse than no shortcut at all.
    const known = new Set(PAPERS.map((p) => p.id));
    for (const id of PAPER_SAMPLE) if (id !== null) expect(known).toContain(id);
    const inks = new Set(INKS.map((i) => i.id));
    for (const id of INK_SAMPLE) expect(inks).toContain(id);
  });
});
