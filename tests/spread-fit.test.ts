// @vitest-environment node
/**
 * tests/spread-fit.test.ts — the seam between the fit math and the book.
 *
 * `tests/spread.test.ts` proves `fitSpreadToRoom` returns the right numbers,
 * and `scripts/probe-spread-fit.mjs` proves the running app puts the book
 * where those numbers say. Between the two sits the thing this repo keeps
 * getting wrong: arithmetic that is correct, tested, and wired to nothing.
 * The bug being fixed here is that shape from the other end — the panel push
 * WAS wired, to a number (`--nb-panel-push`) that is the shelf's answer and
 * walks a finite book off the right of the window.
 *
 * These are deliberately source-level checks. They cannot tell you the book
 * looks right; they can tell you the fit is still plugged in, which is the
 * failure mode a passing unit suite otherwise hides. The probe is what looks.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const railCss = readFileSync(join(ROOT, 'src', 'styles', 'rail.css'), 'utf8');
const bookView = readFileSync(join(ROOT, 'src', 'views', 'BookView.tsx'), 'utf8');

/** Strip comments — every one of these rules is also DESCRIBED in prose. */
const stripComments = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** The declaration block whose selector list contains `selector`. */
function ruleFor(css: string, selector: string): string {
  const clean = stripComments(css);
  let at = 0;
  for (;;) {
    const open = clean.indexOf('{', at);
    if (open === -1) break;
    const close = clean.indexOf('}', open);
    if (close === -1) break;
    const selectors = clean.slice(at, open);
    if (selectors.includes(selector)) return clean.slice(open + 1, close);
    at = close + 1;
  }
  throw new Error(`no rule found for ${selector}`);
}

describe('the book carries the fit, not the shelf’s push', () => {
  const bookRule = ruleFor(railCss, '.nb-book-view .nb-book-cover');

  it('translates by the spread shift and scales by the spread fit', () => {
    expect(bookRule).toContain('var(--nb-spread-shift)');
    expect(bookRule).toContain('var(--nb-spread-fit)');
    expect(bookRule).toMatch(/scale\(\s*var\(--nb-spread-fit\)\s*\)/);
  });

  it('does NOT push the book by the sheet width — that is the reported bug', () => {
    // `--nb-panel-push` is the sheet's own width. The shelf's world can slide
    // by it because a room simply carries on; a 1270px book in a 1332px view
    // cannot, and did not: the right leaf ended 271px past a 1440px window.
    expect(bookRule).not.toContain('--nb-panel-push');
  });

  it('scales about the piece’s own centre, which is what the shift assumes', () => {
    // Header, cover and thumb strip are all centred on the stage and are all
    // different widths; anything but a centre origin fans them apart, and the
    // shift is computed against that same centre.
    expect(bookRule).toMatch(/transform-origin:\s*50%\s*50%/);
  });

  it('leaves the shelf’s own push alone', () => {
    const shelfCss = readFileSync(
      join(ROOT, 'src', 'styles', 'shelf.css'),
      'utf8',
    );
    expect(stripComments(shelfCss)).toContain('var(--nb-panel-push');
  });
});

describe('both fit properties have an identity default', () => {
  /**
   * A `var()` against a property nobody declared computes to the guaranteed
   * invalid value, which drops the WHOLE `transform` declaration. The book
   * would then paint exactly where it always did — which looks like the fix
   * working, right up until a panel opens and the book does not move at all.
   *
   * And the default has to be the identity: this rule is on the book whether
   * or not a sheet is out, so a default that is not "unmoved, unscaled" is a
   * permanently displaced book.
   */
  const root = ruleFor(railCss, ':root');
  const allRoots = stripComments(railCss)
    .split(/:root\s*\{/)
    .slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf('}')));

  it('declares them, at the identity', () => {
    const declared = allRoots.join('\n');
    expect(declared).toMatch(/--nb-spread-shift:\s*0px\s*;/);
    expect(declared).toMatch(/--nb-spread-fit:\s*1\s*;/);
  });

  it('declares them on :root and nowhere narrower', () => {
    // The consumers are `.nb-book-view` descendants and the publisher is the
    // view element itself; a default parked on some inner selector would be
    // shadowed by neither and inherited by only half of them.
    expect(root.length).toBeGreaterThan(0);
    expect(allRoots.some((chunk) => chunk.includes('--nb-spread-fit'))).toBe(
      true,
    );
  });
});

describe('BookView publishes what the stylesheet consumes', () => {
  it('writes both properties onto the view element', () => {
    expect(bookView).toContain("'--nb-spread-shift'");
    expect(bookView).toContain("'--nb-spread-fit'");
  });

  it('computes them with the tested arithmetic rather than in place', () => {
    expect(bookView).toContain('fitSpreadToRoom');
  });

  it('reads the sheet’s edge, which is the number panelPush publishes', () => {
    expect(bookView).toContain('--nb-panel-edge');
  });

  it('measures the page capacity in the same units the blocks are measured in', () => {
    // PageEditor compares `getBoundingClientRect()` distances (drawn px)
    // against `pageCapacityPx`. Once the spread carries a scale those are two
    // different units, and a page at 78% quietly holds a quarter more text
    // than it can show. See the docblock on `measureCapacity`.
    expect(bookView).toContain('visualScale(');
  });
});
