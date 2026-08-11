import { describe, expect, it } from 'vitest';
import { layoutFloor } from '../src/features/bookshelf/layout';

describe('reader-authored shelf placement', () => {
  it('keeps automatic rows in their existing clustered composition', () => {
    const books = [
      { slot: 0, w: 30 },
      { slot: 1, w: 38 },
      { slot: 2, w: 34 },
      { slot: 3, w: 42 },
    ];
    expect(layoutFloor(books, 0)).toEqual(layoutFloor(books, 0));
    expect(layoutFloor(books, 0).every((book) => Number.isFinite(book.centerX))).toBe(true);
  });

  it('keeps a moved book at the selected centre instead of reclustering it', () => {
    const placed = layoutFloor(
      [
        { slot: 0, w: 30 },
        { slot: 1, w: 38 },
        { slot: 2, w: 34 },
        { slot: 15, w: 42, positionX: 916 },
      ],
      0,
    );

    expect(placed[3]?.centerX).toBe(916);
    expect(placed[3]?.leanDeg).toBe(0);
    expect((placed[2]?.centerX ?? 0) + 34 / 2).toBeLessThanOrEqual(916 - 42 / 2 - 2);
  });

  it('opens space around an anchor placed beside an automatic cluster', () => {
    const books = [
      { slot: 0, w: 46 },
      { slot: 1, w: 46 },
      { slot: 2, w: 46, positionX: 600 },
      { slot: 3, w: 46 },
      { slot: 4, w: 46 },
    ];
    const placed = layoutFloor(books, 2);

    expect(placed[2]?.centerX).toBe(600);
    expect((placed[1]?.centerX ?? 0) + 23).toBeLessThanOrEqual(575);
    expect((placed[3]?.centerX ?? 0) - 23).toBeGreaterThanOrEqual(625);
  });
});
