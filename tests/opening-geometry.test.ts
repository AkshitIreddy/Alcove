// @vitest-environment node
/**
 * tests/opening-geometry.test.ts — the "opening the book…" fallback and the
 * real spread must be the same size, and there are two copies of the numbers.
 *
 * ## Why there are two copies at all
 *
 * `styles/opening.css` draws the book the reader looks at while the spread
 * mounts. It is a Suspense fallback in App.tsx, so it has to be styled with
 * NOTHING from the book half loaded — that is the whole point of it, and it is
 * the bug it was written to fix: the rules used to live in editor.css, which is
 * imported by the very module the fallback stands in for, so on a cold open it
 * painted as an unstyled paragraph in the corner of a white window.
 *
 * Importing spread.css from App.tsx instead would put 29kB of the book's
 * stylesheet into the boot chunk that `lazy(() => import('./views/BookView'))`
 * exists to keep it out of. So the handful of numbers that decide where the
 * book sits are restated, and this file is the price of that: it reads both
 * stylesheets and fails if a value drifts on one side only.
 *
 * ## Why it matters that they match
 *
 * The fallback is not a spinner, it is the paper the spread lands on. Measured
 * (`scripts/probe-book-opening.mjs`), the spread's mount blocks the main thread
 * for the best part of two seconds, and the frame the reader sits in front of
 * is this one. It hands over to the real spread with no transition of any kind
 * — if the boxes agree, the words simply arrive on paper that was already
 * there; if they do not, the book jumps size at the worst possible moment, and
 * nothing else in the suite would notice.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const STYLES = join(import.meta.dirname, '..', 'src', 'styles');

const read = (file: string): string => readFileSync(join(STYLES, file), 'utf8');

/** Strip comments so a value quoted in prose cannot answer for the real one. */
const stripComments = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * One declaration, by exact selector and property.
 *
 * Deliberately exact-match on the selector text rather than anything
 * cascade-aware: this is a "did somebody edit one of the two lines" check, and
 * a real cascade resolver would be a much bigger thing that answers a question
 * nobody asked. Whitespace inside the value is collapsed, so reformatting a
 * long `min()` across lines is not a failure.
 */
function decl(css: string, selector: string, prop: string): string {
  const body = stripComments(css);
  // Every rule block whose selector list contains this selector as a whole
  // entry, so `.nb-spread .nb-page` never answers for `.nb-page`.
  const blocks = [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for (const [, selectors, decls] of blocks) {
    const list = selectors
      .split(',')
      .map((s) => s.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    if (!list.includes(selector)) continue;
    const hit = [...decls.matchAll(/([-a-z]+)\s*:\s*([^;]+)/g)].find(
      ([, name]) => name.trim() === prop,
    );
    if (hit) return hit[2].trim().replace(/\s+/g, ' ');
  }
  throw new Error(`no \`${prop}\` on \`${selector}\``);
}

const spread = read('spread.css');
const opening = read('opening.css');
const editor = read('editor.css');

describe('the opening fallback sits exactly where the spread will', () => {
  it('reserves the same window padding, rail lane included', () => {
    expect(decl(opening, '.nb-book-opening', 'padding')).toBe(
      decl(spread, '.nb-book-view', 'padding'),
    );
  });

  it('gives the book the same width at every viewport', () => {
    expect(decl(opening, '.nb-opening-stage', 'width')).toBe(
      decl(spread, '.nb-spread-stage', 'width'),
    );
  });

  it('leaves the same gap between the title plate and the board', () => {
    expect(decl(opening, '.nb-opening-header', 'margin-bottom')).toBe(
      decl(spread, '.nb-spread-header', 'margin-bottom'),
    );
  });

  it('draws the same board: padding, corners and outline', () => {
    for (const prop of ['padding', 'border-radius', 'border', 'background']) {
      expect(decl(opening, '.nb-opening-cover', prop)).toBe(
        decl(spread, '.nb-book-cover', prop),
      );
    }
  });

  it('insets the paper by the same margins', () => {
    expect(decl(opening, '.nb-opening-leaf', 'padding')).toBe(
      decl(spread, '.nb-spread .nb-sheet-paper', 'padding'),
    );
  });

  it('runs the same gutter down the middle', () => {
    expect(decl(opening, '.nb-opening-gutter', 'width')).toBe(
      // spread.css declares `width` twice in this block — a 132px first pass
      // kept above the 26px that wins — and `decl` returns the first. Both are
      // read the same way on both sides only if the same one is compared, so
      // this asserts against the LAST declaration, which is the one that paints.
      [...stripComments(spread).matchAll(/\.nb-spread-gutter\s*\{([^}]*)\}/g)]
        .flatMap(([, body]) => [...body.matchAll(/width\s*:\s*([^;]+)/g)])
        .map(([, value]) => value.trim())
        .at(-1),
    );
  });

  it('writes the caption on a plate at the title plate’s size', () => {
    // >= 20px is the Caveat floor (CLAUDE.md); tests/styles.test.ts gates the
    // 13px handwriting floor across the tree. This one only pins the two to
    // each other, so the caption plate and the title that replaces it are the
    // same object as far as the reader is concerned.
    expect(decl(opening, '.nb-opening-plate', 'font-size')).toBe(
      decl(spread, '.nb-book-title-plate', 'font-size'),
    );
  });
});

describe('the fallback owes the book half nothing', () => {
  it('is not styled from editor.css any more', () => {
    // The original defect: `.nb-book-opening` was defined in the stylesheet
    // that arrives WITH BookView, so the fallback for a chunk still in flight
    // had no rules at the moment it was needed.
    expect(stripComments(editor)).not.toMatch(/\.nb-book-opening\s*[,{]/);
  });

  it('animates transform and opacity only, because the main thread is jammed', () => {
    // Not a style preference here but a hard requirement: the spread's mount
    // holds the main thread for ~2s (probe-book-opening.mjs), so anything
    // needing layout, paint or JavaScript freezes on the reader's screen.
    // Compositor-driven transform/opacity keeps moving. Whatever else changes
    // in this file, that must not.
    const keyframes = [...stripComments(opening).matchAll(/@keyframes[^{]+\{([\s\S]*?)\n\}/g)];
    expect(keyframes.length).toBeGreaterThan(0);
    for (const [, body] of keyframes) {
      const props = [...body.matchAll(/([-a-z]+)\s*:/g)].map(([, p]) => p);
      expect(props.length).toBeGreaterThan(0);
      for (const prop of props) expect(['transform', 'opacity']).toContain(prop);
    }
  });
});
