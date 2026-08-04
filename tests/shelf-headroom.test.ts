/**
 * tests/shelf-headroom.test.ts — a book may not stand through the carpentry.
 *
 * The reader's report: *"the books are cutting into the bookshelf design"*.
 * Under an arcaded, gabled, ogee or scalloped build the tall spines ran
 * straight up past the arch heads and into the board above, because every book
 * on the shelf was sized against `FLOOR_H - PLANK_H` — the flat plank-to-plank
 * gap, which is the right number for a plain plank case and wrong for the
 * fifty-one builds whose opening has a SHAPE.
 *
 * Three properties are pinned here, and they are the three that can rot
 * silently:
 *
 *  1. every build declares a headroom, and it is a real fraction;
 *  2. the clearance a build reports is the clearance its opening actually
 *     leaves — `openingHead` is the single source both the drawing and the
 *     layout read, so this is really a check that nobody has re-introduced a
 *     second copy of the arch geometry;
 *  3. a shelf of thirty dice-rolled books, laid out by the real layout against
 *     every one of the fifty-two builds, has NO book crossing the carpentry.
 *
 * (3) is the whole point. A per-build unit assertion says a number is
 * self-consistent; only running the layout says the app can actually reach it.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILDS,
  BUILD_IDS,
  clearHeightAt,
  clearHeightRange,
  openingHead,
  type BuildSpec,
} from '../src/art/shelfDesign';
import {
  FULL_BOOK_HEIGHT,
  OPENING_FRAME,
  bookClearHeight,
  fitBookHeight,
  shelfHeadroom,
} from '../src/features/bookshelf/bookFit';
import { layoutFloor } from '../src/features/bookshelf/layout';
import { SPINE_THICKNESS_RANGE } from '../src/art/spines';

const ALL: readonly BuildSpec[] = BUILD_IDS.map((id) => BUILDS[id]);

describe('every build declares its headroom', () => {
  it('has one, in (0, 1]', () => {
    for (const spec of ALL) {
      expect(typeof spec.headroom, spec.id).toBe('number');
      expect(spec.headroom, spec.id).toBeGreaterThan(0);
      expect(spec.headroom, spec.id).toBeLessThanOrEqual(1);
    }
  });

  it('leaves a book at least a third of the opening even at the piers', () => {
    // Not a style rule — a floor. A build that left less than this would be
    // handing the reader a case their books cannot stand in, which is a build
    // that should have been drawn differently rather than declared honestly.
    for (const spec of ALL) {
      const { min } = clearHeightRange(spec, OPENING_FRAME);
      expect(min / OPENING_FRAME.h, spec.id).toBeGreaterThan(0.33);
    }
  });
});

describe('the declaration and the drawing are one geometry', () => {
  it('puts the head exactly where the headroom says', () => {
    for (const spec of ALL) {
      const head = openingHead(spec, OPENING_FRAME);
      const expected =
        spec.opening === 'plain' || spec.opening === 'panelled'
          ? 0
          : OPENING_FRAME.h * (1 - spec.headroom);
      expect(head.depth, spec.id).toBeCloseTo(expected, 6);
    }
  });

  it('never lifts an arch clean through the head it springs from', () => {
    // `r` is inverted out of the depth, so the crown can reach the top of the
    // opening but not past it. If this ever fails the arcade is being drawn
    // into the board above and the clearance would read as taller than the bay.
    for (const spec of ALL) {
      const { min, max } = clearHeightRange(spec, OPENING_FRAME);
      expect(max, spec.id).toBeGreaterThanOrEqual(min);
      expect(max, spec.id).toBeLessThanOrEqual(OPENING_FRAME.h + 0.001);
    }
  });

  it('gives an arcade more room under the crown than at the pier', () => {
    for (const id of ['arch', 'gothic', 'refectory', 'chapel', 'valance'] as const) {
      const spec = BUILDS[id];
      const { min, max } = clearHeightRange(spec, OPENING_FRAME);
      expect(max - min, id).toBeGreaterThan(20);
      const head = openingHead(spec, OPENING_FRAME);
      const bayW = OPENING_FRAME.w / (head.arch?.bays ?? 1);
      const crown = clearHeightAt(spec, OPENING_FRAME, OPENING_FRAME.x + bayW * 0.5);
      const pier = clearHeightAt(spec, OPENING_FRAME, OPENING_FRAME.x + bayW);
      expect(crown, id).toBeCloseTo(max, 0);
      expect(pier, id).toBeCloseTo(min, 0);
    }
  });

  it('reports a flat band for the builds that hang one', () => {
    for (const id of ['faceFrame', 'schoolroom', 'crate', 'chinoiserie'] as const) {
      const { min, max } = clearHeightRange(BUILDS[id], OPENING_FRAME);
      expect(max, id).toBe(min);
    }
  });

  it('lets a plain case use the whole opening', () => {
    for (const id of ['plank', 'slab', 'campaign', 'vestry'] as const) {
      const { min } = clearHeightRange(BUILDS[id], OPENING_FRAME);
      expect(min, id).toBe(OPENING_FRAME.h);
    }
  });
});

/* -------------------------------------------------------------------------- */

/** Thirty spines, seeded the way `shots-now/dice-shelf.mjs` seeds its shelf. */
function diceWidths(run: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 30; i += 1) {
    let h = (0x811c9dc5 ^ (run * 7919 + i)) >>> 0;
    for (let k = 0; k < 4; k += 1) {
      h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
      h = (h + 0x9e3779b9) >>> 0;
    }
    const span = SPINE_THICKNESS_RANGE.max - SPINE_THICKNESS_RANGE.min;
    out.push(SPINE_THICKNESS_RANGE.min + (h % (span + 1)));
  }
  return out;
}

describe('a dice-rolled shelf clears the carpentry in every build', () => {
  it('never stands a book through a head, in any of the fifty-two', () => {
    const offenders: string[] = [];
    for (const spec of ALL) {
      for (let run = 0; run < 3; run += 1) {
        const widths = diceWidths(run);
        const placed = layoutFloor(
          widths.map((w, i) => ({ slot: i, w })),
          run,
        );
        for (let i = 0; i < widths.length; i += 1) {
          const w = widths[i] as number;
          const x = (placed[i] as { centerX: number }).centerX;
          const clear = bookClearHeight(spec, x, w / 2);
          // What the shelf will actually draw: the seeded skyline, trimmed.
          const height = fitBookHeight({
            nominal: 0.62 * 271.6 + ((i * 37) % 38) * 2.7,
            clear,
            snug: (i % 7) / 7,
          });
          if (height > clear + 0.001) offenders.push(`${spec.id}#${i}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('leaves a book that already fits completely alone', () => {
    // The regression guard for the plain plank case: nothing about a book that
    // clears its bay may move, or the fix for the arcades has quietly
    // re-proportioned every shelf in the app.
    for (const nominal of [150, 200, 260, 271.6]) {
      expect(fitBookHeight({ nominal, clear: 271.6, snug: 0.3 })).toBe(nominal);
    }
  });

  it('keeps the shelf worth looking at — the trimmed rows are not a fence', () => {
    // Trimming every tall book to exactly the clear height would give an
    // arcaded case a dead flat skyline, which is the "picket fence" the layout
    // has been fighting since it was written. The snug jitter is what stops it,
    // and this is the assertion that it is still doing something.
    const spec = BUILDS['gothic'];
    const heights = new Set<number>();
    const widths = diceWidths(0);
    const placed = layoutFloor(widths.map((w, i) => ({ slot: i, w })), 0);
    for (let i = 0; i < widths.length; i += 1) {
      const clear = bookClearHeight(spec, (placed[i] as { centerX: number }).centerX, 20);
      heights.add(Math.round(fitBookHeight({ nominal: 400, clear, snug: (i % 9) / 9 })));
    }
    expect(heights.size).toBeGreaterThan(6);
  });
});

describe('the frame a book is measured in is the frame the case is drawn in', () => {
  it('matches the rectangle textures.ts hands drawRecess', async () => {
    // A source read, not an import: `textures.ts` pulls in Pixi and this file
    // has to run in node. The two numbers are three lines apart in two modules
    // and nothing would look wrong if they drifted — the arches a book clears
    // would simply stop being the arches on screen.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../src/features/bookshelf/textures.ts', import.meta.url),
      'utf8',
    );
    expect(src).toMatch(/bakeFlatBack\(room,\s*SHELF_WIDTH,\s*BOOK_ZONE_H,\s*dpr\)/);
    expect(src.replace(/\s+/g, ' ')).toContain(
      'room.design, { x: RAIL_W, y: 0, w: w - RAIL_W * 2, h, }',
    );
    expect(OPENING_FRAME).toEqual({ x: 34, y: 0, w: 1200 - 68, h: 280 });
  });
});

describe('what the studio is told', () => {
  it('names the build and its clear height', () => {
    const flat = shelfHeadroom({ build: 'plank', pattern: 'none' });
    expect(flat.name).toBe('Plain Plank');
    // The whole opening less the hairline of air, which is exactly the height
    // the tallest seeded book has always been drawn at.
    expect(flat.min).toBeCloseTo(FULL_BOOK_HEIGHT, 6);
    expect(flat.varies).toBe(false);

    const arcade = shelfHeadroom({ build: 'gothic', pattern: 'none' });
    expect(arcade.varies).toBe(true);
    expect(arcade.max).toBeGreaterThan(arcade.min);
  });

  it('falls back rather than throwing on a junk design', () => {
    const junk = shelfHeadroom({ build: 'nope', pattern: 42 } as never);
    expect(junk.min).toBeGreaterThan(0);
  });
});
