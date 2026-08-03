// @vitest-environment node
/**
 * tests/top-left-exits.test.ts — every way out lives in the TOP-LEFT.
 *
 * The reader's words, and the reason this file exists:
 *
 *   "when in focus mode the leave focus mode is in top right, it should be top
 *    left instead, similar for all other types of options, it should ALWAYS be
 *    on top left, maybe do a check"
 *
 * So: THE CONVENTION. A control that LEAVES somewhere — back, close, exit,
 * leave, dismiss, quit — is anchored to the top-left of whatever it leaves:
 * the window for a view, the sheet for a panel, the card for a dialog. Never
 * the top-right, never the bottom. The reader reaches for one corner in this
 * app and it is always the same one.
 *
 * This is the "check" they asked for, in the shape tests/styles.test.ts
 * already uses in this tree: a syntactic sweep over src/styles that points at
 * one declaration rather than at "somewhere in the stylesheets".
 *
 * WHAT IT CAN AND CANNOT SEE. It reads anchoring — `left` / `right` on a
 * positioned exit — because that is the form that is mechanically decidable.
 * An exit pushed to the right by `justify-content: space-between` or
 * `margin-left: auto` inside a header row is the same mistake and this file
 * cannot see it; the audit that came with this sweep lists those by hand, and
 * the fix for them is `order: -1` (see `.shelf-trash__close` in shelf.css) so
 * that visual order and tab order never disagree.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const STYLES_DIR = join(import.meta.dirname, '..', 'src', 'styles');

/** Strip comments so a rule quoted in prose cannot fail the suite. */
function stripComments(css: string): string {
  // Keep newlines so reported line numbers stay honest.
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, ' '),
  );
}

interface Block {
  file: string;
  line: number;
  selector: string;
  decls: Map<string, string>;
}

/**
 * Every rule block in src/styles, as selector + its own declarations.
 *
 * Hand-rolled for the same reason styles.test.ts rolls its own: this has to
 * split on `{`, `}` and `;` and nothing else, and the alternative is a
 * dependency whose whole job is to be more correct about `@supports` than
 * these files ever get. Nested at-rules leave their block on the stack, which
 * only means an `@media` selector shows up as a block with no declarations.
 */
function blocks(): Block[] {
  const out: Block[] = [];
  for (const file of readdirSync(STYLES_DIR).filter((n) => n.endsWith('.css')).sort()) {
    const css = stripComments(readFileSync(join(STYLES_DIR, file), 'utf8'));
    let selector = '';
    let selectorLine = 1;
    let buffer = '';
    let line = 1;
    let bufferLine = 1;
    let current: Block | null = null;
    const flush = (): void => {
      const text = buffer.trim();
      buffer = '';
      const colon = text.indexOf(':');
      if (colon <= 0 || current === null) return;
      current.decls.set(
        text.slice(0, colon).trim().toLowerCase(),
        text.slice(colon + 1).trim(),
      );
    };
    for (const char of css) {
      if (char === '\n') line += 1;
      if (buffer.trim() === '') bufferLine = line;
      if (char === '{') {
        selector = buffer.trim().replace(/\s+/g, ' ');
        selectorLine = bufferLine;
        buffer = '';
        current = { file, line: selectorLine, selector, decls: new Map() };
        out.push(current);
      } else if (char === '}') {
        flush();
        current = null;
      } else if (char === ';') {
        flush();
      } else {
        buffer += char;
      }
    }
  }
  return out;
}

/**
 * Class names that mean "this control leaves somewhere".
 *
 * Matched as whole WORDS inside a name, never as substrings: `back` loose
 * would catch `.nb-page-backdrop` and every `background`, and a gate that
 * fires on the wrong thing gets deleted rather than obeyed.
 */
const EXIT_WORDS = ['back', 'close', 'exit', 'leave', 'dismiss', 'quit'];

/** Is this selector naming an exit control? */
function isExit(selector: string): boolean {
  // Only look at the class/id segments, and only at whole segments: split the
  // selector into its name parts and compare each part's own words.
  const parts = selector.split(/[^a-z0-9_-]+/i).filter((p) => p.length > 0);
  return parts.some((part) => {
    const words = part.toLowerCase().split(/[-_]/);
    return words.some((word) => EXIT_WORDS.includes(word));
  });
}

const where = (b: Block, prop: string): string =>
  `${b.file}:${b.line} ${b.selector} { ${prop}: ${b.decls.get(prop) ?? ''} }`;

describe('every way out is anchored top-left', () => {
  const all = blocks();

  it('finds the exits it is meant to be watching', () => {
    // A gate nobody matches is a gate that passes forever. These two are the
    // app-level ways out; if a rename makes them invisible to this sweep, this
    // fails before the sweep below reports a clean bill of health.
    const names = all.filter((b) => isExit(b.selector)).map((b) => b.selector);
    expect(names).toEqual(expect.arrayContaining([expect.stringContaining('.nb-back-button')]));
    expect(names).toEqual(expect.arrayContaining([expect.stringContaining('.nb-focus-exit')]));
    expect(isExit('.nb-rail-panel-close')).toBe(true);
    expect(isExit('.shelf-trash__close')).toBe(true);
    // and does not fire on things that merely contain the letters
    expect(isExit('.nb-page-backdrop')).toBe(false);
    expect(isExit('.nb-thumb-strip')).toBe(false);
  });

  it('never anchors an exit to the right edge', () => {
    const offenders = all
      .filter((b) => isExit(b.selector))
      .filter((b) => b.decls.has('right') && !b.decls.has('left'))
      .map((b) => where(b, 'right'));
    expect(offenders).toEqual([]);
  });

  it('never parks an exit against the bottom edge', () => {
    const offenders = all
      .filter((b) => isExit(b.selector))
      .filter((b) => b.decls.has('bottom') && !b.decls.has('top'))
      .map((b) => where(b, 'bottom'));
    expect(offenders).toEqual([]);
  });

  it('pins the two app-level ways out to the top-left corner', () => {
    for (const selector of ['.nb-back-button', '.nb-focus-exit']) {
      const anchored = all.filter(
        (b) => b.selector === selector && b.decls.has('position'),
      );
      expect(anchored.length, `${selector} is never positioned`).toBeGreaterThan(0);
      for (const block of anchored) {
        expect(block.decls.get('position'), where(block, 'position')).toBe('fixed');
        expect(block.decls.get('left'), where(block, 'left')).toBe('var(--space-16)');
        expect(block.decls.has('right'), where(block, 'right')).toBe(false);
        expect(block.decls.get('top'), where(block, 'top')).toBe('var(--space-16)');
      }
    }
  });
});
