// @vitest-environment node
/**
 * tests/rulings.test.ts — the twenty-seven rulings, and the two ways a ruling
 * can be shipped without being reachable.
 *
 * This app kept exactly four page styles for its whole life and the reader
 * finally said so ("at least 20 here"). Adding twenty-three more is the easy
 * half; the half this repo has got wrong eight times is that an id can be added
 * to `PAGE_STYLES`, named in `editor/rulings.ts`, offered as a card in the
 * panel, saved into the document — and still paint nothing, because no rule in
 * `styles/rulings.css` ever matched it. Nothing warns. The card presses, the
 * attribute changes, the paper does not.
 *
 * So the load-bearing test here is the third one: every id must be painted on
 * BOTH surfaces, the page and the panel's thumbnail. It reads the stylesheet as
 * text, because the only thing that could check it at runtime is a browser.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_STYLES } from '../src/data/types';
import {
  RULINGS,
  RULING_FAMILY,
  RULING_ORDER,
  RULING_SHORTLIST,
  isRollable,
} from '../src/editor/rulings';

const CSS = readFileSync(
  join(import.meta.dirname, '..', 'src', 'styles', 'rulings.css'),
  'utf8',
);

/** Comments quote selectors; a claim in prose must not satisfy a check. */
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, (block) =>
  block.replace(/[^\n]/g, ' '),
);

describe('the rulings vocabulary', () => {
  it('offers the twenty the reader asked for, and then some', () => {
    // The number is the reader's, verbatim: "At least 20 here."
    expect(PAGE_STYLES.length).toBeGreaterThanOrEqual(20);
  });

  it('keeps the four this app shipped with', () => {
    // A ruling id is persisted per PAGE. Retiring one would silently re-rule
    // somebody's notebook, so growth is only ever additive.
    for (const original of ['ruled', 'grid', 'blank', 'dotted']) {
      expect(PAGE_STYLES as readonly string[]).toContain(original);
    }
  });

  it('names every id exactly once, and names nothing else', () => {
    expect(Object.keys(RULINGS).sort()).toEqual([...PAGE_STYLES].sort());
    expect(new Set(PAGE_STYLES).size).toBe(PAGE_STYLES.length);
    // Two rulings called the same thing is a panel with two identical cards.
    const names = Object.values(RULINGS).map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('paints every id on BOTH surfaces', () => {
    // The whole point of the file. A selector for one and not the other is a
    // thumbnail that lies, or a card that changes nothing.
    for (const id of PAGE_STYLES) {
      expect(CSS_CODE, `no page rule for '${id}'`).toContain(
        `.nb-page[data-style='${id}']`,
      );
      expect(CSS_CODE, `no thumbnail rule for '${id}'`).toContain(
        `.nb-pagestyle-thumb[data-style='${id}']`,
      );
    }
  });

  it('draws every ruling from the shared scale, never a hard-coded pitch', () => {
    // `--rule` is the one number the page and the thumb disagree about (the
    // line-height slider vs. a 10px miniature). A pattern that reached for
    // --page-line-height directly would be correct on the page and wrong on
    // every thumbnail — which is exactly what the old rail.css copies were.
    // Declarations (`--rule-image:`), not mentions — the shared surface rule
    // reads it back as `var(--rule-image, none)` and must not be counted.
    expect(CSS_CODE.split('--rule-image:').length - 1).toBe(PAGE_STYLES.length);
    const stray = CSS_CODE.split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => line.includes('--page-line-height'))
      // The one legitimate mention: where --rule is defined as the page's pitch.
      .filter(({ line }) => !line.includes('--rule:'));
    expect(stray.map((s) => s.n)).toEqual([]);
  });

  it('derives the picker order rather than hand-sorting it', () => {
    expect(RULING_ORDER.map((r) => r.id).sort()).toEqual([...PAGE_STYLES].sort());
    const rank = { signature: 0, shelf: 1, niche: 2, oddity: 3 } as const;
    for (let i = 1; i < RULING_ORDER.length; i += 1) {
      expect(
        rank[RULING_ORDER[i - 1].tier] <= rank[RULING_ORDER[i].tier],
        `${RULING_ORDER[i - 1].id} sorts before ${RULING_ORDER[i].id}`,
      ).toBe(true);
    }
    // `ruled` is what a page opens on and must stay the first card.
    expect(RULING_ORDER[0].id).toBe('ruled');
  });

  it('makes the shortlist the signature tier and nothing else', () => {
    // The rail panel shows RULING_SHORTLIST cards before its "more" control.
    // A seventh signature would push the sixth behind the control silently.
    const head = RULING_ORDER.slice(0, RULING_SHORTLIST);
    expect(head.every((row) => row.tier === 'signature')).toBe(true);
    expect(head).toHaveLength(6);
    // All four originals are reachable without expanding anything: a reader who
    // had grid paper yesterday must not have to go looking for it today.
    const ids = head.map((row) => row.id);
    for (const original of ['ruled', 'grid', 'blank', 'dotted']) {
      expect(ids).toContain(original);
    }
  });

  it('spreads the shortlist across families instead of one of them', () => {
    const families = new Set(
      RULING_ORDER.slice(0, RULING_SHORTLIST).map((row) => row.group),
    );
    expect(families.size).toBeGreaterThanOrEqual(4);
  });

  it('says every family out loud', () => {
    for (const row of RULING_ORDER) {
      expect(RULING_FAMILY[row.group], `${row.group} has no spoken name`).toBeTruthy();
    }
  });

  it('keeps paper that is not for prose out of any dice', () => {
    // Nothing rolls a ruling today; when something does, "surprise me" must not
    // hand somebody guitar tab.
    expect(isRollable('oddity')).toBe(false);
    expect(isRollable('signature')).toBe(true);
    expect(RULINGS.tab.tier).toBe('oddity');
    expect(RULINGS.storyboard.tier).toBe('oddity');
    expect(RULINGS.log.tier).toBe('oddity');
  });

  it('inks every ruling from the theme, never from a literal colour', () => {
    // tokens.css re-inks --paper-edge per theme; a hex or an rgb() in here is a
    // brown pencil line left on a night-blue page. (The pigment mixes live in
    // one block at the top and are themselves built from tokens.)
    expect(CSS_CODE).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(CSS_CODE).not.toMatch(/\brgba?\(/);
  });
});
