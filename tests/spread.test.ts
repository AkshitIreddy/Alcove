// @vitest-environment node
/**
 * tests/spread.test.ts — pure spread logic (src/views/spread.ts).
 *
 * Runs without DOM: ord↔spread math, the six-id window handed to FlipSurface
 * (incl. nulls at both ends of the book), flip gating + the auto-create
 * decision matrix, the blank-vs-ink doc probe, the starter doc's inherited
 * page style, and the spread fit.
 */

import { describe, expect, it } from 'vitest';

import type { PageDoc } from '../src/data/types';
import {
  MAX_TRAILING_BLANK_PAGES,
  MIN_SPREAD_SCALE,
  SPREAD_FIT_REST,
  canFlipSpread,
  docHasContent,
  fitSpreadToRoom,
  isLastSpread,
  lastSpreadIndex,
  leftSlot,
  newPageDoc,
  pagesToCreateOnFlip,
  prependBlocksToDoc,
  rightSlot,
  shouldAutoCreatePage,
  spreadCount,
  spreadOfSlot,
  spreadPageIds,
  visualScale,
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

describe('pagesToCreateOnFlip', () => {
  it('is zero wherever the flip creates nothing', () => {
    expect(pagesToCreateOnFlip(2, 0, 'prev', true)).toBe(0);
    expect(pagesToCreateOnFlip(6, 0, 'next', true)).toBe(0); // pages ahead
    expect(
      pagesToCreateOnFlip(2, 0, 'next', false, MAX_TRAILING_BLANK_PAGES),
    ).toBe(0);
  });

  it('appends one page off an even-length book', () => {
    // Slot 2 is the landing spread's left leaf and page 2 fills it.
    expect(pagesToCreateOnFlip(2, 0, 'next', true)).toBe(1);
    expect(pagesToCreateOnFlip(6, 2, 'next', true)).toBe(1);
  });

  it('appends TWO off an odd-length book, so the landing spread is not empty', () => {
    // The seeded welcome book is five pages: spread 2 shows page 5 alone, and
    // one appended page would fill the leaf being left behind rather than the
    // one being turned to. Measured in the running app before the fix: both
    // leaves of the landing spread mounted zero editors.
    expect(pagesToCreateOnFlip(5, 2, 'next', false, 0)).toBe(2);
    expect(pagesToCreateOnFlip(1, 0, 'next', false, 0)).toBe(2);
    expect(pagesToCreateOnFlip(3, 1, 'next', false, 0)).toBe(2);
  });

  it('never leaves the landing spread short, whatever the count', () => {
    for (let pageCount = 1; pageCount <= 12; pageCount += 1) {
      const spreadIndex = lastSpreadIndex(pageCount);
      const created = pagesToCreateOnFlip(pageCount, spreadIndex, 'next', true);
      expect(pageCount + created).toBeGreaterThan(leftSlot(spreadIndex + 1));
    }
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

/* ──────────────────── fitting the spread beside a sheet ───────────────── */

/**
 * The reported defect, in numbers: at 1440×900 the book view's content box is
 * 88..1420 and the stage is 1270px wide inside it, so the spread runs
 * 119..1389. A rail sheet is `min(340px, 78vw)` hinged at left:68, so its
 * right edge — `--nb-panel-edge` — lands at 408. Pushed by the sheet's WIDTH
 * the cover ended at 1729: 289px past the glass, with the dog-ear curl gone
 * with it. Every case below is a real window the app can be opened at.
 */
const GAP = 16;

/** The book view's content box for a window of `width` (padding 88 / 20). */
const roomAt = (width: number) => ({ left: 88, right: width - 20 });

/** Where flex centring puts a stage of `width` inside that room. */
const stageIn = (room: { left: number; right: number }, width: number) => {
  const centre = (room.left + room.right) / 2;
  return { left: centre - width / 2, right: centre + width / 2 };
};

describe('fitSpreadToRoom', () => {
  it('does nothing at all with no sheet open', () => {
    const room = roomAt(1440);
    expect(fitSpreadToRoom(stageIn(room, 1270), room, 0, GAP)).toEqual(
      SPREAD_FIT_REST,
    );
  });

  it('keeps the whole spread inside the window at 1440×900 — the report', () => {
    const room = roomAt(1440);
    const stage = stageIn(room, 1270);
    const fit = fitSpreadToRoom(stage, room, 408, GAP);

    const width = (stage.right - stage.left) * fit.scale;
    const centre = (stage.left + stage.right) / 2 + fit.shift;
    // Both edges, which is the whole assertion: clear of the sheet's gutter
    // on the left, inside the window on the right.
    expect(centre - width / 2).toBeGreaterThanOrEqual(408 + GAP - 1);
    expect(centre + width / 2).toBeLessThanOrEqual(room.right + 1);
    // …and it had to shrink to manage it. A translate alone cannot: the room
    // left is 996px and the book is 1270.
    expect(fit.scale).toBeLessThan(1);
  });

  it('shrinks only as far as it must — the room, over the book', () => {
    const room = roomAt(1440);
    const stage = stageIn(room, 1270);
    const fit = fitSpreadToRoom(stage, room, 408, GAP);
    expect(fit.scale).toBeCloseTo((room.right - (408 + GAP)) / 1270, 3);
  });

  it('holds at every window size the app can be opened at', () => {
    // width × the stage width the height formula gives there.
    const windows: Array<[number, number]> = [
      [1920, 1555],
      [1600, 1400],
      [1440, 1270],
      [1366, 1200],
      [1280, 1112],
      [1100, 950],
      [960, 828], // src-tauri/tauri.conf.json minWidth/minHeight
    ];
    for (const [width, stageWidth] of windows) {
      const room = roomAt(width);
      const stage = stageIn(room, stageWidth);
      const fit = fitSpreadToRoom(stage, room, 408, GAP);
      const drawn = stageWidth * fit.scale;
      const centre = (stage.left + stage.right) / 2 + fit.shift;
      expect({ width, right: centre + drawn / 2 <= room.right + 1 }).toEqual({
        width,
        right: true,
      });
      expect({ width, left: centre - drawn / 2 >= 408 + GAP - 1 }).toEqual({
        width,
        left: true,
      });
    }
  });

  it('re-centres without shrinking when the room left is big enough', () => {
    // An ultrawide window: the room the sheet leaves (424..2980) is still
    // wider than the book, so the book only slides to the middle of it. The
    // slide is half the sheet's width, not the whole of it — which is exactly
    // the number pushing by `--nb-panel-push` got wrong.
    const room = { left: 88, right: 3000 };
    const fit = fitSpreadToRoom(stageIn(room, 1400), room, 408, GAP);
    expect(fit.scale).toBe(1);
    expect(fit.shift).toBe(168);
    expect(fit.shift).toBeLessThan(340);
  });

  it('rounds the scale DOWN, so a fit computed to the edge never crosses it', () => {
    const room = { left: 0, right: 1000 };
    // 1000/1003 = 0.99700897…: rounding to 4 dp the ordinary way gives 0.997
    // and floors to the same, but the fifth digit is what decides whether the
    // right edge lands on the window or a hair past it.
    const fit = fitSpreadToRoom(stageIn(room, 1003), room, 0, 0);
    expect(fit.scale).toBe(0.997);
    expect(1003 * fit.scale).toBeLessThanOrEqual(1000);
    // The case that actually bites: 1000/1001 = 0.999000999… — near enough to
    // 1 that rounding up would snap it to 1 and overhang by a pixel.
    const tight = fitSpreadToRoom(stageIn(room, 1001), room, 0, 0);
    expect(tight.scale).toBeLessThan(1);
    expect(1001 * tight.scale).toBeLessThanOrEqual(1000);
  });

  it('snaps to exactly 1 rather than leaving a 0.9999 scale on the book', () => {
    const room = { left: 0, right: 1000 };
    expect(fitSpreadToRoom(stageIn(room, 1000.05), room, 0, 0).scale).toBe(1);
  });

  it('shifts by whole pixels — a leaf never lands on a half one', () => {
    const room = { left: 88.4, right: 1419.7 };
    const fit = fitSpreadToRoom(stageIn(room, 1270.3), room, 408.2, GAP);
    expect(Number.isInteger(fit.shift)).toBe(true);
  });

  it('floors the scale rather than shrinking the book to a dot', () => {
    // A window narrower than the sheet plus its gutter: the room goes
    // negative, and an unclamped ratio would flip the book inside out.
    const room = { left: 88, right: 380 };
    const fit = fitSpreadToRoom(stageIn(room, 300), room, 408, GAP);
    expect(fit.scale).toBe(MIN_SPREAD_SCALE);
    expect(fit.scale).toBeGreaterThan(0);
  });

  it('stands down for a stage that has not been laid out yet', () => {
    const room = roomAt(1440);
    expect(fitSpreadToRoom({ left: 0, right: 0 }, room, 408, GAP)).toEqual(
      SPREAD_FIT_REST,
    );
    expect(
      fitSpreadToRoom({ left: 0, right: Number.NaN }, room, 408, GAP),
    ).toEqual(SPREAD_FIT_REST);
    expect(
      fitSpreadToRoom(stageIn(room, 1270), room, Number.NaN, GAP),
    ).toEqual(SPREAD_FIT_REST);
  });
});

describe('visualScale', () => {
  it('is the ratio of drawn to laid-out pixels', () => {
    expect(visualScale(784, 1000)).toBeCloseTo(0.784, 6);
    expect(visualScale(2400, 1000)).toBeCloseTo(2.4, 6);
  });

  it('is 1 whenever nothing is scaling, so callers can multiply blindly', () => {
    expect(visualScale(640, 640)).toBe(1);
  });

  it('is 1 for every degenerate input rather than a division by zero', () => {
    expect(visualScale(640, 0)).toBe(1);
    expect(visualScale(0, 640)).toBe(1);
    expect(visualScale(Number.NaN, 640)).toBe(1);
    expect(visualScale(640, Number.NaN)).toBe(1);
    expect(visualScale(-10, 640)).toBe(1);
  });
});
