// @vitest-environment node
/**
 * tests/pagination.test.ts — the PageEditor pagination contract's pure math:
 *   1. trailingOverflowCount picks exactly the trailing blocks that must
 *      leave so the projected height fits pageCapacityPx,
 *   2. it always leaves at least one block on the page,
 *   3. contentOverflows catches what (2) therefore cannot: the lone block that
 *      is taller than the paper — the case PageEditor answers by SPLITTING it,
 *      and the case that used to make a long paragraph invisible,
 *   4. accumulateCarriedCaret keeps the caret's offset inside the carried
 *      blocks correct across a multi-pass drain,
 *   5. pageIsFull gates click-below-to-type when one more line won't fit.
 */
import { describe, expect, it } from 'vitest';

import {
  accumulateCarriedCaret,
  contentOverflows,
  pageIsFull,
  trailingOverflowCount,
} from '../src/editor/pagination';

describe('trailingOverflowCount', () => {
  it('returns 0 when everything already fits', () => {
    expect(trailingOverflowCount([32, 64, 96], 200, 20)).toBe(0);
    // exactly at capacity is still fitting
    expect(trailingOverflowCount([32, 64, 180], 200, 20)).toBe(0);
  });

  it('removes exactly the trailing blocks that overflow', () => {
    // capacity 200, padding 20 → last kept bottom must be ≤ 180
    expect(trailingOverflowCount([100, 150, 190, 240], 200, 20)).toBe(2);
    expect(trailingOverflowCount([100, 150, 179, 240], 200, 20)).toBe(1);
  });

  it('counts the surviving padding-bottom toward the projected height', () => {
    // Without padding the 190 block fits; with 20px padding it does not.
    expect(trailingOverflowCount([100, 190], 200, 0)).toBe(0);
    expect(trailingOverflowCount([100, 190], 200, 20)).toBe(1);
  });

  it('never removes the last remaining block', () => {
    expect(trailingOverflowCount([500], 200, 0)).toBe(0);
    // every block overflows → keep exactly one
    expect(trailingOverflowCount([300, 600, 900], 200, 0)).toBe(2);
  });

  it('is inert for degenerate inputs', () => {
    expect(trailingOverflowCount([], 200, 0)).toBe(0);
    expect(trailingOverflowCount([100, 300], 0, 0)).toBe(0);
    expect(trailingOverflowCount([100, 300], Number.NaN, 0)).toBe(0);
    // negative padding is ignored rather than shrinking the content
    expect(trailingOverflowCount([100, 190], 200, -50)).toBe(0);
  });
});

describe('contentOverflows', () => {
  it('is false while the content fits', () => {
    expect(contentOverflows([32, 64, 96], 200, 20)).toBe(false);
    expect(contentOverflows([32, 64, 180], 200, 20)).toBe(false); // exactly
  });

  it('catches the lone block the trailing drain may never peel', () => {
    // The pair the drain actually evaluates: nothing to remove, and yet the
    // page is over. Before contentOverflows existed this simply fell through
    // and the block stayed clipped by `overflow: hidden`.
    expect(trailingOverflowCount([900], 600, 32)).toBe(0);
    expect(contentOverflows([900], 600, 32)).toBe(true);
  });

  it('agrees with trailingOverflowCount wherever both can speak', () => {
    // With two or more blocks a count of 0 is the same comparison, so the two
    // can never disagree — that is what makes "count 0 AND overflowing" mean
    // "one block left" rather than "the drain gave up".
    const cases: Array<[number[], number, number]> = [
      [[100, 150, 190], 400, 20],
      [[100, 150, 390], 400, 20],
      [[100, 150, 380], 400, 20],
      [[100, 700], 400, 20],
    ];
    for (const [bottoms, capacity, padding] of cases) {
      if (trailingOverflowCount(bottoms, capacity, padding) === 0) {
        expect(contentOverflows(bottoms, capacity, padding)).toBe(
          bottoms.length === 1,
        );
      }
    }
  });

  it('is inert for degenerate inputs rather than splitting on a guess', () => {
    expect(contentOverflows([], 600, 32)).toBe(false);
    expect(contentOverflows([900], 0, 32)).toBe(false);
    expect(contentOverflows([900], Number.NaN, 32)).toBe(false);
    expect(contentOverflows([Number.NaN], 600, 32)).toBe(false);
    // A negative padding is ignored, not subtracted from the content.
    expect(contentOverflows([590], 600, -100)).toBe(false);
  });
});

describe('accumulateCarriedCaret', () => {
  it('leaves the caret behind when it sits above the cut', () => {
    expect(accumulateCarriedCaret(null, 40, 100, 60)).toBeNull();
  });

  it('carries the caret as an offset inside the removed content', () => {
    // Caret at 120, the cut starts at 100 → 20 tokens into what left.
    expect(accumulateCarriedCaret(null, 120, 100, 60)).toBe(20);
    // Exactly on the boundary counts as carried (offset 0).
    expect(accumulateCarriedCaret(null, 100, 100, 60)).toBe(0);
  });

  it('shifts an already-carried caret by each later pass, never re-finds it', () => {
    // Pass 2 takes an EARLIER block, which lands before the carried content.
    let offset = accumulateCarriedCaret(null, 120, 100, 60); // = 20
    offset = accumulateCarriedCaret(offset, 5, 0, 34); // earlier pass prepends
    expect(offset).toBe(54);
    // Even when the (now meaningless) head reads as "before the cut", a
    // carried caret must not be recomputed — its old position addresses a doc
    // that no longer exists.
    expect(accumulateCarriedCaret(54, 0, 999, 10)).toBe(64);
  });

  it('never shifts backwards on a nonsense removed size', () => {
    expect(accumulateCarriedCaret(20, 0, 0, -5)).toBe(20);
  });
});

describe('pageIsFull', () => {
  it('is false when pagination is off (no capacity)', () => {
    expect(pageIsFull(10_000, 32, undefined)).toBe(false);
  });

  it('is true when one more line cannot fit', () => {
    expect(pageIsFull(580, 32, 600)).toBe(true); // 580 + 32 > 600
    expect(pageIsFull(560, 32, 600)).toBe(false); // 560 + 32 ≤ 600
    expect(pageIsFull(568, 32, 600)).toBe(false); // exactly fits
  });

  it('treats a non-positive or non-finite capacity as unbounded', () => {
    expect(pageIsFull(580, 32, 0)).toBe(false);
    expect(pageIsFull(580, 32, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('ignores broken line heights instead of blocking typing', () => {
    expect(pageIsFull(300, Number.NaN, 600)).toBe(false);
    expect(pageIsFull(700, Number.NaN, 600)).toBe(true); // already over
  });
});
