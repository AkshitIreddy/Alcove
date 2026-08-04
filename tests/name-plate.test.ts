// @vitest-environment node
/**
 * tests/name-plate.test.ts — a brand-new book is never hidden by the box you
 * name it in.
 *
 * THE BUG, twice. *"For some reason the new book is white."* Then, after a
 * first fix: *"A brand-new book STILL reads as a blank white slab."* Both
 * times the book was perfect — baked, bound, coloured — and what stood on the
 * plank was the inline title editor, which is cream with a dashed border and
 * was sized
 *
 *     along  = clamp(rect.height * 0.62, 84, rect.height * 0.9)
 *     across = Math.max(rect.width, 26)        // ← the whole spine, always
 *
 * The first fix shortened the LENGTH and left the width alone: over that 62%
 * the cloth was still covered edge to edge, so the first thing a reader ever
 * made appeared as a cream rectangle with two stubs of colour poking out.
 *
 * ## Why 2351 passing tests never saw it
 *
 * Because those four expressions lived inside a `<Show>` callback in
 * `BookshelfWorld.tsx` — a Solid component that reaches for `window` on
 * import — and nothing in node could evaluate them. The geometry now lives in
 * `features/bookshelf/namePlate.ts`, which is why the first half of this file
 * can exist at all; the second half is a source check that keeps it there,
 * because a component that quietly grows its own copy of the arithmetic again
 * is exactly how this came back the first time.
 *
 * The pixel half — that the shelf really renders what this module returns —
 * is `shots-now/new-book-is-a-book.mjs`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  MIN_FONT_PX,
  TAG_FONT_PX,
  TAG_H,
  TAG_W,
  TIE_LEN,
  namePlateBox,
  overlapsSpine,
  type SpineRect,
} from '../src/features/bookshelf/namePlate';

/**
 * Every spine the shelf can put under this thing.
 *
 * The widths are the honest range: `SPINE_THICKNESS_RANGE` is 8-58 world px
 * and the camera runs from well under 0.4 to 2.5, so 3px slivers and 145px
 * tomes are both reachable. The heights likewise span SPINE_FORMATS (134-300
 * world px) through the same zoom range.
 */
const anySpine = fc.record({
  x: fc.integer({ min: -200, max: 2200 }),
  y: fc.integer({ min: -200, max: 1400 }),
  width: fc.integer({ min: 3, max: 150 }),
  height: fc.integer({ min: 30, max: 760 }),
});

const anyStage = fc.record({
  width: fc.integer({ min: 480, max: 3840 }),
  height: fc.integer({ min: 360, max: 2160 }),
});

/** The plate's rect from the centre-anchored box the component spends. */
function plateRect(box: ReturnType<typeof namePlateBox>) {
  return {
    left: box.left - box.width / 2,
    right: box.left + box.width / 2,
    top: box.top - box.height / 2,
    bottom: box.top + box.height / 2,
  };
}

describe('the title editor never covers the book it names', () => {
  it('never overlaps the spine, at any thickness, at any zoom', () => {
    fc.assert(
      fc.property(anySpine, anyStage, (spine: SpineRect, stage) => {
        const box = namePlateBox(spine, stage);
        expect(overlapsSpine(spine, box)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('is the defect itself that fails: a full-width box over the spine', () => {
    // The old geometry, reconstructed. If `overlapsSpine` ever went soft this
    // would stop failing, and the property above would be worth nothing.
    const spine: SpineRect = { x: 703, y: 84, width: 34, height: 204 };
    const old = {
      side: 'right' as const,
      left: spine.x + spine.width / 2,
      top: spine.y + spine.height / 2,
      // Rotated -90°, so the old `boxW` (along) rendered as the box's HEIGHT.
      width: Math.max(spine.width, 26),
      height: Math.min(Math.max(spine.height * 0.62, 84), spine.height * 0.9),
      fontSize: 16,
      tie: { left: 0, top: 0, width: 0 },
    };
    expect(overlapsSpine(spine, old)).toBe(true);
  });

  it('stands clear of the spine by exactly the tie it draws', () => {
    fc.assert(
      fc.property(anySpine, anyStage, (spine: SpineRect, stage) => {
        const box = namePlateBox(spine, stage);
        const r = plateRect(box);
        const gap =
          box.side === 'right' ? r.left - (spine.x + spine.width) : spine.x - r.right;
        // The leader spans the gap and nothing else: a tie shorter than the
        // gap floats, a tie longer than it runs under the book.
        expect(gap).toBeCloseTo(TIE_LEN, 6);
        expect(box.tie.width).toBeCloseTo(TIE_LEN, 6);
        expect(box.tie.left).toBeCloseTo(
          box.side === 'right' ? spine.x + spine.width : spine.x - TIE_LEN,
          6,
        );
        // …and it leaves the spine at the book's own middle, where the tag is.
        expect(box.tie.top).toBeCloseTo(spine.y + spine.height / 2, 6);
      }),
      { numRuns: 500 },
    );
  });

  it('is centred on the book vertically, whatever the book is', () => {
    fc.assert(
      fc.property(anySpine, anyStage, (spine: SpineRect, stage) => {
        expect(namePlateBox(spine, stage).top).toBeCloseTo(
          spine.y + spine.height / 2,
          6,
        );
      }),
      { numRuns: 200 },
    );
  });
});

describe('the tag is legible, and stays on the stage', () => {
  it('never writes handwriting below the 13px floor', () => {
    fc.assert(
      fc.property(anySpine, anyStage, (spine: SpineRect, stage) => {
        expect(namePlateBox(spine, stage).fontSize).toBeGreaterThanOrEqual(MIN_FONT_PX);
      }),
      { numRuns: 200 },
    );
    expect(TAG_FONT_PX).toBeGreaterThanOrEqual(MIN_FONT_PX);
  });

  it('is one fixed size — it stands on the wall, not on the book', () => {
    fc.assert(
      fc.property(anySpine, anyStage, (spine: SpineRect, stage) => {
        const box = namePlateBox(spine, stage);
        expect(box.width).toBe(TAG_W);
        expect(box.height).toBe(TAG_H);
      }),
      { numRuns: 200 },
    );
  });

  it('goes right by default — a new book lands past its floor’s last slot', () => {
    const box = namePlateBox({ x: 400, y: 120, width: 20, height: 200 }, {
      width: 1440,
      height: 900,
    });
    expect(box.side).toBe('right');
    expect(box.left - TAG_W / 2).toBeGreaterThan(420);
  });

  it('flips left rather than hang off the right edge', () => {
    const spine = { x: 1380, y: 120, width: 22, height: 200 };
    const box = namePlateBox(spine, { width: 1440, height: 900 });
    expect(box.side).toBe('left');
    expect(plateRect(box).right).toBeLessThanOrEqual(spine.x);
    expect(plateRect(box).left).toBeGreaterThanOrEqual(0);
  });

  it('goes right when the caller does not say how wide the stage is', () => {
    // The component always passes the viewport; a probe or a board need not.
    const spine = { x: 900, y: 100, width: 30, height: 200 };
    const box = namePlateBox(spine);
    expect(box.side).toBe('right');
    expect(overlapsSpine(spine, box)).toBe(false);
  });

  it('stays right when there is nowhere to flip to', () => {
    // Hard against the left rail AND the right edge: a narrow window. There is
    // no good side, and the rule is "then do the ordinary thing" rather than
    // "then go off the left of the world", where nothing is clickable.
    const box = namePlateBox({ x: 20, y: 120, width: 22, height: 200 }, {
      width: 200,
      height: 900,
    });
    expect(box.side).toBe('right');
  });

  it('has no unreachable second layout hiding in it', () => {
    // The on-spine plate was designed, measured and dropped: a brand-new book
    // is one page long, `blendThickness` folds that in, and 95% of new books
    // come out too thin to carry 13px of handwriting AND show their cloth.
    // Shipping it anyway would have been this repo's signature defect —
    // authored, and reached by nobody.
    const sides = new Set<string>();
    fc.assert(
      fc.property(anySpine, anyStage, (spine: SpineRect, stage) => {
        sides.add(namePlateBox(spine, stage).side);
      }),
      { numRuns: 500 },
    );
    expect([...sides].sort()).toEqual(['left', 'right']);
  });
});

describe('the shelf spends this module rather than its own copy', () => {
  const source = readFileSync(
    new URL('../src/features/bookshelf/BookshelfWorld.tsx', import.meta.url),
    'utf8',
  );

  it('imports the geometry instead of recomputing it', () => {
    expect(source).toMatch(/from '\.\/namePlate'/);
    expect(source).toMatch(/namePlateBox\(state\(\)\.rect/);
  });

  it('sizes the editor from nothing but that box', () => {
    // The naming <Show> block, isolated. Every `px` in it has to come from
    // `box()`; the bug was four hand-rolled expressions right here, and the
    // fix is only a fix for as long as none of them grows back.
    const start = source.indexOf('<Show when={naming()}>');
    expect(start).toBeGreaterThan(0);
    const block = source.slice(start, source.indexOf('</Show>', start));
    const interpolations = [...block.matchAll(/\$\{([^}]*)\}px/g)].map((m) => m[1].trim());
    expect(interpolations.length).toBeGreaterThan(0);
    for (const expr of interpolations) {
      expect(expr, `"${expr}" is not read off the name-plate box`).toMatch(
        /^box\(\)\.[A-Za-z.]+$/,
      );
    }
    // And nothing in there may reach for the spine's own width again, which
    // is the single expression both regressions were made of.
    expect(block).not.toMatch(/rect\.(width|height)/);
  });
});
