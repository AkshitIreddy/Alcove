// @vitest-environment node
/**
 * tests/spread.test.ts — pure spread logic (src/views/spread.ts).
 *
 * Runs without DOM: ord↔spread math, the six-id window handed to FlipSurface
 * (incl. nulls at both ends of the book), flip gating + the auto-create
 * decision matrix, the blank-vs-ink doc probe, the starter doc's inherited
 * page style, and the arrow-key guard.
 */

import { describe, expect, it } from 'vitest';

import type { PageDoc } from '../src/data/types';
import {
  MAX_TRAILING_BLANK_PAGES,
  arrowFlipAction,
  canFlipSpread,
  docHasContent,
  isLastSpread,
  lastSpreadIndex,
  leftSlot,
  newPageDoc,
  prependBlocksToDoc,
  rightSlot,
  shouldAutoCreatePage,
  spreadCount,
  spreadOfSlot,
  spreadPageIds,
} from '../src/views/spread';

/** A book of n pages with ids p0..p(n-1). */
const book = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `p${i}`);

/* ─────────────────────────── ord ↔ spread math ────────────────────────── */

describe('slot math', () => {
  it('maps spread index to left/right slots (left = 2i, right = 2i + 1)', () => {
    expect(leftSlot(0)).toBe(0);
    expect(rightSlot(0)).toBe(1);
    expect(leftSlot(3)).toBe(6);
    expect(rightSlot(3)).toBe(7);
  });

  it('maps slots back to their spread', () => {
    expect(spreadOfSlot(0)).toBe(0);
    expect(spreadOfSlot(1)).toBe(0);
    expect(spreadOfSlot(2)).toBe(1);
    expect(spreadOfSlot(7)).toBe(3);
  });

  it('round-trips: every slot lands on the spread that shows it', () => {
    for (let slot = 0; slot < 20; slot += 1) {
      const spread = spreadOfSlot(slot);
      expect([leftSlot(spread), rightSlot(spread)]).toContain(slot);
    }
  });

  it('counts spreads (ceil of half), with an empty book still opening one', () => {
    expect(spreadCount(0)).toBe(1);
    expect(spreadCount(1)).toBe(1);
    expect(spreadCount(2)).toBe(1);
    expect(spreadCount(3)).toBe(2);
    expect(spreadCount(4)).toBe(2);
    expect(spreadCount(5)).toBe(3);
  });

  it('identifies the last spread', () => {
    expect(lastSpreadIndex(1)).toBe(0);
    expect(lastSpreadIndex(4)).toBe(1);
    expect(isLastSpread(4, 0)).toBe(false);
    expect(isLastSpread(4, 1)).toBe(true);
    expect(isLastSpread(4, 2)).toBe(true); // defensive: past the end counts
  });
});

/* ───────────────────────────── id windows ─────────────────────────────── */

describe('spreadPageIds', () => {
  it('1-page book: only the left leaf has a page; everything else is null', () => {
    expect(spreadPageIds(book(1), 0)).toEqual({
      left: 'p0',
      right: null,
      nextLeft: null,
      nextRight: null,
      prevLeft: null,
      prevRight: null,
    });
  });

  it('2-page book: full spread, no neighbours', () => {
    expect(spreadPageIds(book(2), 0)).toEqual({
      left: 'p0',
      right: 'p1',
      nextLeft: null,
      nextRight: null,
      prevLeft: null,
      prevRight: null,
    });
  });

  it('3-page book, first spread: next spread has only a left page', () => {
    expect(spreadPageIds(book(3), 0)).toEqual({
      left: 'p0',
      right: 'p1',
      nextLeft: 'p2',
      nextRight: null,
      prevLeft: null,
      prevRight: null,
    });
  });

  it('3-page book, last spread: prev pair present, right leaf blank', () => {
    expect(spreadPageIds(book(3), 1)).toEqual({
      left: 'p2',
      right: null,
      nextLeft: null,
      nextRight: null,
      prevLeft: 'p0',
      prevRight: 'p1',
    });
  });

  it('6-page book, middle spread: both neighbour pairs fully present', () => {
    expect(spreadPageIds(book(6), 1)).toEqual({
      left: 'p2',
      right: 'p3',
      nextLeft: 'p4',
      nextRight: 'p5',
      prevLeft: 'p0',
      prevRight: 'p1',
    });
  });

  it('empty book: all null', () => {
    expect(spreadPageIds([], 0)).toEqual({
      left: null,
      right: null,
      nextLeft: null,
      nextRight: null,
      prevLeft: null,
      prevRight: null,
    });
  });
});

/* ─────────────────────── flip gating + auto-create ────────────────────── */

describe('canFlipSpread', () => {
  it('prev needs a spread before this one', () => {
    expect(canFlipSpread(6, 0, 'prev', false)).toBe(false);
    expect(canFlipSpread(6, 1, 'prev', false)).toBe(true);
    expect(canFlipSpread(6, 2, 'prev', true)).toBe(true);
  });

  it('next is free while pages exist ahead', () => {
    expect(canFlipSpread(6, 0, 'next', false)).toBe(true);
    expect(canFlipSpread(6, 1, 'next', false)).toBe(true);
    expect(canFlipSpread(3, 0, 'next', false)).toBe(true);
  });

  it('next off the last spread while the blank allowance holds', () => {
    // Reported: the book refused to turn past a blank page, so a reader could
    // not deliberately leave one. Blanks are allowed now, and only bounded.
    expect(canFlipSpread(1, 0, 'next', false, 1)).toBe(true);
    expect(canFlipSpread(2, 0, 'next', false, 2)).toBe(true);
    // ...until the allowance runs out, which is what stops a held key from
    // appending pages without end.
    expect(canFlipSpread(5, 2, 'next', false, MAX_TRAILING_BLANK_PAGES)).toBe(false);
    expect(canFlipSpread(9, 4, 'next', false, MAX_TRAILING_BLANK_PAGES + 3)).toBe(false);
  });

  it('next on the last spread only when the right leaf holds ink', () => {
    // Once the allowance is spent the original rule governs again: ink on the
    // right leaf is what opens the next page.
    const spent = MAX_TRAILING_BLANK_PAGES;
    // 1-page book: right leaf is a cream blank face — book ends here.
    expect(canFlipSpread(1, 0, 'next', false, spent)).toBe(false);
    // 2-page book, right page empty: still no forward flip.
    expect(canFlipSpread(2, 0, 'next', false, spent)).toBe(false);
    // 2-page book, right page written on: forward flip auto-creates.
    expect(canFlipSpread(2, 0, 'next', true, spent)).toBe(true);
    expect(canFlipSpread(6, 2, 'next', true, spent)).toBe(true);
  });
});

describe('shouldAutoCreatePage', () => {
  it('fires only for a forward flip off the last spread with right-leaf ink', () => {
    expect(shouldAutoCreatePage(2, 0, 'next', true)).toBe(true);
    expect(shouldAutoCreatePage(6, 2, 'next', true)).toBe(true);
  });

  it('never fires backward, mid-book, or past the blank allowance', () => {
    const spent = MAX_TRAILING_BLANK_PAGES;
    expect(shouldAutoCreatePage(2, 0, 'prev', true)).toBe(false);
    expect(shouldAutoCreatePage(6, 0, 'next', true)).toBe(false); // pages ahead
    expect(shouldAutoCreatePage(2, 0, 'next', false, spent)).toBe(false);
    expect(shouldAutoCreatePage(1, 0, 'next', false, spent)).toBe(false);
  });

  it('fires for a blank right leaf while the allowance holds — the skipped page', () => {
    // The other half of the reported bug: turning past a blank has to land on
    // a page that exists, or the flip animates onto nothing.
    expect(shouldAutoCreatePage(1, 0, 'next', false, 0)).toBe(true);
    expect(shouldAutoCreatePage(2, 0, 'next', false, 1)).toBe(true);
  });
});

/* ─────────────────────────── doc content probe ────────────────────────── */

describe('docHasContent', () => {
  const doc = (content: unknown[]): PageDoc => ({ type: 'doc', content });

  it('empty and missing content are blank', () => {
    expect(docHasContent(null)).toBe(false);
    expect(docHasContent(undefined)).toBe(false);
    expect(docHasContent({ type: 'doc' })).toBe(false);
    expect(docHasContent(doc([]))).toBe(false);
  });

  it('empty paragraphs (fresh-page shape) are blank', () => {
    expect(docHasContent(doc([{ type: 'paragraph' }]))).toBe(false);
    expect(
      docHasContent(doc([{ type: 'paragraph' }, { type: 'paragraph', content: [] }])),
    ).toBe(false);
  });

  it('whitespace-only text is blank', () => {
    expect(
      docHasContent(
        doc([{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }]),
      ),
    ).toBe(false);
  });

  it('real text is ink', () => {
    expect(
      docHasContent(
        doc([{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }]),
      ),
    ).toBe(true);
  });

  it('non-paragraph blocks are ink even without text', () => {
    expect(docHasContent(doc([{ type: 'image' }]))).toBe(true);
    expect(docHasContent(doc([{ type: 'horizontalRule' }]))).toBe(true);
    expect(docHasContent(doc([{ type: 'paragraph' }, { type: 'table' }]))).toBe(true);
  });
});

/* ─────────────────────────────── new pages ────────────────────────────── */

describe('newPageDoc', () => {
  it('inherits the default page style from settings', () => {
    expect(newPageDoc('grid')).toEqual({
      type: 'doc',
      attrs: { pageStyle: 'grid' },
      content: [],
    });
    expect(newPageDoc('dotted').attrs).toEqual({ pageStyle: 'dotted' });
  });

  it('stamps the book line-spacing default when given, clamped to 24–64', () => {
    expect(newPageDoc('ruled', 30).attrs).toEqual({
      pageStyle: 'ruled',
      lineHeightPx: 30,
    });
    expect(newPageDoc('ruled', 5).attrs).toEqual({
      pageStyle: 'ruled',
      lineHeightPx: 24,
    });
    expect(newPageDoc('ruled', 999).attrs).toEqual({
      pageStyle: 'ruled',
      lineHeightPx: 64,
    });
    expect(newPageDoc('ruled', Number.NaN).attrs).toEqual({ pageStyle: 'ruled' });
  });
});

/* ─────────────────────── pagination overflow merge ────────────────────── */

describe('prependBlocksToDoc', () => {
  const para = (text: string): unknown => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  });

  it('prepends carried blocks before existing content', () => {
    const doc: PageDoc = { type: 'doc', attrs: { pageStyle: 'grid' }, content: [para('old')] };
    const merged = prependBlocksToDoc(doc, [para('carried-1'), para('carried-2')]);
    expect(merged.content).toEqual([para('carried-1'), para('carried-2'), para('old')]);
    // attrs survive, input untouched (pure)
    expect(merged.attrs).toEqual({ pageStyle: 'grid' });
    expect(doc.content).toEqual([para('old')]);
  });

  it('replaces a blank starter page instead of stacking above an empty paragraph', () => {
    const fresh: PageDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
    const merged = prependBlocksToDoc(fresh, [para('carried')]);
    expect(merged.content).toEqual([para('carried')]);
  });

  it('builds a fresh doc (with fallback attrs) when the page has no doc yet', () => {
    const merged = prependBlocksToDoc(null, [para('carried')], {
      pageStyle: 'dotted',
      lineHeightPx: 30,
    });
    expect(merged).toEqual({
      type: 'doc',
      attrs: { pageStyle: 'dotted', lineHeightPx: 30 },
      content: [para('carried')],
    });
    expect(prependBlocksToDoc(undefined, [para('x')]).attrs).toBeUndefined();
  });

  it('keeps real content even when it is a non-paragraph block', () => {
    const doc: PageDoc = { type: 'doc', content: [{ type: 'image' }] };
    expect(prependBlocksToDoc(doc, [para('carried')]).content).toEqual([
      para('carried'),
      { type: 'image' },
    ]);
  });
});

/* ───────────────────────────── keyboard guard ─────────────────────────── */

describe('arrowFlipAction', () => {
  it('maps arrows to flip directions when not typing', () => {
    expect(arrowFlipAction('ArrowRight', false)).toBe('next');
    expect(arrowFlipAction('ArrowLeft', false)).toBe('prev');
  });

  it('typing always wins — the caret keeps the arrows', () => {
    expect(arrowFlipAction('ArrowRight', true)).toBeNull();
    expect(arrowFlipAction('ArrowLeft', true)).toBeNull();
  });

  it('ignores every other key', () => {
    expect(arrowFlipAction('ArrowUp', false)).toBeNull();
    expect(arrowFlipAction('ArrowDown', false)).toBeNull();
    expect(arrowFlipAction('Enter', false)).toBeNull();
    expect(arrowFlipAction(' ', false)).toBeNull();
  });
});
