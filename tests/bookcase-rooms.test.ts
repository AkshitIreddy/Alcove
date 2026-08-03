// @vitest-environment node
/**
 * tests/bookcase-rooms.test.ts — a run of new bookcases looks like a run of
 * different rooms.
 *
 * `THEME_IDS` is grouped by FAMILY so the studio's picker reads as a palette,
 * which means consecutive ids are shades of one timber. `defaultThemeForOrd`
 * therefore strides rather than walking: a reader who made four cases in a row
 * used to get four browns and the fair impression that the feature did
 * nothing.
 *
 * The stride's correctness is a NUMBER-THEORY claim ("23 is coprime with 60,
 * so it still visits all sixty before repeating") written in a comment, and a
 * comment cannot notice when the table grows to 61 and the claim quietly stops
 * holding. These check the property instead of the sentence.
 */
import { describe, expect, it } from 'vitest';

import { THEME_IDS } from '../src/art/themes';
import { defaultThemeForOrd } from '../src/data/bookcases';

describe('a new bookcase opens somewhere else', () => {
  it('visits every room before repeating one', () => {
    // The whole point of a coprime stride. If someone changes the stride, or
    // the theme table's length, to a pair that shares a factor, this catches
    // it — the cycle would collapse to a fraction of the palette.
    const seen = new Set<string>();
    for (let ord = 0; ord < THEME_IDS.length; ord += 1) seen.add(defaultThemeForOrd(ord));
    expect(seen.size).toBe(THEME_IDS.length);
  });

  it('does not hand out neighbours in a row', () => {
    // The actual reader-facing complaint: four cases in a row, four browns.
    // Consecutive ordinals must land far apart in a table grouped by family.
    const near = [];
    for (let ord = 0; ord < THEME_IDS.length; ord += 1) {
      const a = THEME_IDS.indexOf(defaultThemeForOrd(ord));
      const b = THEME_IDS.indexOf(defaultThemeForOrd(ord + 1));
      const gap = Math.abs(a - b);
      // Distance the short way round the ring — 59 and 1 are both "adjacent".
      const ring = Math.min(gap, THEME_IDS.length - gap);
      if (ring < 4) near.push({ ord, a, b, ring });
    }
    expect(near, 'consecutive new bookcases land on neighbouring timbers').toEqual([]);
  });

  it('is total for junk, negatives and huge ordinals', () => {
    // It is called with a row count, and a row count has come back strange
    // before. Every answer must still be a real theme id.
    for (const ord of [0, -1, -7, 1e6, 2.7, -0.4, Number.MAX_SAFE_INTEGER]) {
      const id = defaultThemeForOrd(ord);
      expect(THEME_IDS, `ord ${ord} gave ${id}`).toContain(id);
    }
  });
});
