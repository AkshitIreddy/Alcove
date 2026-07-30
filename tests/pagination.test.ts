// @vitest-environment node
/**
 * tests/pagination.test.ts — the PageEditor pagination contract's pure math:
 *   1. trailingOverflowCount picks exactly the trailing blocks that must
 *      leave so the projected height fits pageCapacityPx,
 *   2. it always leaves at least one block on the page,
 *   3. pageIsFull gates click-below-to-type when one more line won't fit.
 */
import { describe, expect, it } from 'vitest';

import { pageIsFull, trailingOverflowCount } from '../src/editor/pagination';

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
