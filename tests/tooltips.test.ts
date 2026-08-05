// @vitest-environment node
/**
 * tests/tooltips.test.ts — no control borrows the operating system's bubble.
 *
 * The reader's words:
 *
 *   "the tooltips are the default ones, they need to have their own ui like
 *    the rest of the app"
 *
 * `src/views/Tooltip.tsx` is the replacement, and the app has used it for most
 * of a year. But `title=""` on an HTML element is still valid, still silent,
 * and still renders another app's grey box in another app's typeface on top of
 * a hand-drawn library — and six of them were still in the tree after the
 * tooltip was declared done: the page thumbnails, the ribbon markers, a
 * bookcase name, the clone-case chip, every card in every design picker, and
 * the tour's progress dots.
 *
 * Nothing failed, because nothing was looking. This looks.
 *
 * WHAT IT CAN AND CANNOT SEE. It reads JSX source for `title=` on a LOWERCASE
 * tag, which is the form that reaches the DOM. `title=` on a capitalised tag
 * is a component prop — `<RailPanel title="Catalogue">` names a panel, it does
 * not label a control — and is deliberately left alone. It cannot see a title
 * set through a spread or by an imperative `setAttribute`; neither appears in
 * this tree today, and if one does the fix is to widen this file, not to work
 * around it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (extname(entry.name) === '.tsx') out.push(full);
  }
  return out;
}

/** Strip comments so a `title=` quoted in prose cannot fail the suite. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

interface Hit {
  file: string;
  line: number;
  tag: string;
}

/**
 * Every `title=` that lands on a real DOM element.
 *
 * Finds the opening tag each attribute belongs to by scanning backwards for
 * the nearest unclosed `<`, which is enough for JSX as it is written here:
 * attributes sit inside their own tag and tags are not nested inside an
 * attribute except through braces, which this stops at.
 */
function nativeTitles(): Hit[] {
  const hits: Hit[] = [];
  for (const file of tsxFiles(SRC)) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const match of src.matchAll(/\btitle=/g)) {
      const before = src.slice(0, match.index);
      const open = before.lastIndexOf('<');
      if (open < 0) continue;
      const tag = /^<\s*([A-Za-z][\w.]*)/.exec(src.slice(open))?.[1];
      if (tag === undefined) continue;
      // A capitalised (or dotted) tag is a component; its `title` is a prop.
      if (tag[0] !== tag[0]?.toLowerCase()) continue;
      hits.push({
        file: relative(join(import.meta.dirname, '..'), file).replace(/\\/g, '/'),
        line: before.split('\n').length,
        tag,
      });
    }
  }
  return hits;
}

describe('the app draws its own tooltips', () => {
  it('has a tree to sweep at all', () => {
    /*
     * THE HOLE THIS FILLS. `nativeTitles()` walks `tsxFiles(SRC)` and reports
     * what it found; if that walk ever returns NOTHING — a moved `src/`, a
     * renamed extension, a `readdirSync` that stops recursing — the offender
     * list below is empty and the suite says the app draws its own tooltips
     * when in truth nobody looked at a single file.
     *
     * The test that used to stand here was meant to be exactly this guard, and
     * it was not one: it ran a RE-TYPED copy of the regex against a string
     * literal declared three lines above it. It never called `nativeTitles()`
     * and never opened a file in `src/`, so `SRC` could have pointed at an
     * empty directory and it would still have gone green. That is the whole
     * shape of a vacuous test — an anti-vacuity guard which is itself vacuous.
     *
     * Seventy-four `.tsx` files today. The floor is set well under that so a
     * component being deleted does not fail this, and well over zero so a
     * broken sweep does.
     */
    expect(
      tsxFiles(SRC).length,
      'the .tsx sweep found almost nothing — every assertion below is vacuous ' +
        'until this is explained (has src/ moved?)',
    ).toBeGreaterThan(50);
  });

  it('finds the attribute it is meant to be watching', () => {
    // A sweep that matches nothing passes forever. Prove the matcher fires on
    // the shape it is looking for, and does NOT fire on a component prop —
    // run through `nativeTitles`'s OWN reader rather than a re-typed copy of
    // its regex, so the two cannot drift apart. (They already had: this test
    // asserted a matcher that no file in the tree was ever passed through.)
    const probe = `
      <button title="x" />
      <RailPanel title="Catalogue" />
      <Foo.Bar title="y" />
    `;
    const tags = [...probe.matchAll(/\btitle=/g)].map((m) => {
      const open = probe.slice(0, m.index).lastIndexOf('<');
      return /^<\s*([A-Za-z][\w.]*)/.exec(probe.slice(open))?.[1];
    });
    expect(tags).toEqual(['button', 'RailPanel', 'Foo.Bar']);
  });

  it('never puts a native title on a DOM element', () => {
    const offenders = nativeTitles().map((h) => `${h.file}:${h.line} <${h.tag} title=…>`);
    expect(
      offenders,
      'use data-tooltip (see src/views/Tooltip.tsx) — a native title renders ' +
        "the operating system's grey bubble, not this app's",
    ).toEqual([]);
  });

  it('still has the tooltip layer those call sites depend on', () => {
    const tip = readFileSync(join(SRC, 'views', 'Tooltip.tsx'), 'utf8');
    expect(tip).toContain('data-tooltip');
    expect(tip).toContain('data-tooltip-clipped');
  });
});
