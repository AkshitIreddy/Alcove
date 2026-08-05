// @vitest-environment node
/**
 * tests/tooltip.test.ts — the geometry behind the app's own tooltip.
 *
 * `placeTip` is the whole reason the bubble is not a `::after` on the control:
 * it flips, it clamps, and it walks the nub back to the control after the
 * clamp. All three are arithmetic that happens to work at the one window size
 * a change is developed at and quietly fails at another — a rail button 20px
 * from the right edge, a menu opened at the bottom of the screen — so they are
 * pinned here rather than eyeballed once in a screenshot.
 *
 * Node environment: the function takes plain rectangles and returns numbers.
 * It touches no DOM, which is exactly what makes it testable.
 */
import { describe, expect, it } from 'vitest';
import { GAP as TIP_GAP, placeTip, type TipSide } from '../src/views/Tooltip';

/** The card's constants, restated only as the shape of an anchor. */
const anchorAt = (
  left: number,
  top: number,
  width = 40,
  height = 40,
): { left: number; top: number; right: number; bottom: number } => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

const CARD = { width: 200, height: 40 };
const SCREEN = { width: 1280, height: 800 };

/**
 * The gap between the control and the bubble, WRITTEN OUT.
 *
 * THE MUTATION THIS FILE USED TO SLEEP THROUGH: `GAP = 11` → `GAP = 40` in
 * src/views/Tooltip.tsx, and every one of these tests stayed green.
 *
 * The reason was a helper called `gapOf()`, which recovered the gap by calling
 * `placeTip` on a known anchor and subtracting that anchor's edge. So the four
 * expectations below read `640 + gapOf()` — placeTip measured against placeTip
 * — and the only number in the file that pins the module to a LOOK was not
 * pinned by anything. At 40 the nub (11px in tooltip.css, deliberately a shade
 * longer than the gap so its point just touches the control) no longer reaches
 * anything, and every bubble in the app floats a thumb's width off the button
 * it labels. That is not arithmetic, it is the thing you can see, and a test
 * that cannot see it is not testing the placement.
 *
 * So it is a literal, and the module's own constant is checked against it
 * below. If the design changes, both numbers move, deliberately, together.
 */
const GAP = 11;

describe('placeTip puts the bubble beside the control', () => {
  it('grows the bubble out of the control, one gap away', () => {
    // The constant first: everything after this is only meaningful if the
    // module and this file agree on what the gap actually is.
    expect(
      TIP_GAP,
      'GAP moved in Tooltip.tsx — is the nub in tooltip.css still a shade longer?',
    ).toBe(GAP);
  });

  it('honours the side it was asked for when there is room', () => {
    const anchor = anchorAt(600, 400);

    expect(placeTip(anchor, CARD, 'right', SCREEN)).toMatchObject({
      side: 'right',
      x: 640 + GAP,
    });
    expect(placeTip(anchor, CARD, 'left', SCREEN)).toMatchObject({
      side: 'left',
      x: 600 - GAP - CARD.width,
    });
    expect(placeTip(anchor, CARD, 'top', SCREEN)).toMatchObject({
      side: 'top',
      y: 400 - GAP - CARD.height,
    });
    expect(placeTip(anchor, CARD, 'bottom', SCREEN)).toMatchObject({
      side: 'bottom',
      y: 440 + GAP,
    });
  });

  it('centres the bubble on the control along the free axis', () => {
    const p = placeTip(anchorAt(100, 400), CARD, 'right', SCREEN);
    // Control centre 420, card is 40 tall -> top at 400.
    expect(p.y).toBe(400);

    const q = placeTip(anchorAt(600, 400), CARD, 'top', SCREEN);
    // Control centre 620, card is 200 wide -> left at 520.
    expect(q.x).toBe(520);
  });
});

describe('placeTip flips rather than running off the window', () => {
  it('flips right -> left against the right edge', () => {
    const p = placeTip(anchorAt(1220, 400), CARD, 'right', SCREEN);
    expect(p.side).toBe('left');
    expect(p.x + CARD.width).toBeLessThanOrEqual(1220);
  });

  it('flips top -> bottom against the top edge', () => {
    const p = placeTip(anchorAt(600, 4), CARD, 'top', SCREEN);
    expect(p.side).toBe('bottom');
    expect(p.y).toBeGreaterThan(44);
  });

  it('falls to the cross axis when neither side of the axis fits', () => {
    // A window barely wider than the card: right and left are both impossible.
    const narrow = { width: CARD.width + 30, height: 800 };
    const p = placeTip(anchorAt(60, 400), CARD, 'right', narrow);
    expect(p.side === 'top' || p.side === 'bottom').toBe(true);
  });

  it('never leaves the window, on any side, anywhere along an edge', () => {
    const sides: TipSide[] = ['top', 'right', 'bottom', 'left'];
    for (const side of sides) {
      for (const x of [0, 8, 300, 640, 1100, 1240]) {
        for (const y of [0, 8, 200, 400, 760, 790]) {
          const p = placeTip(anchorAt(x, y), CARD, side, SCREEN);
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.x + CARD.width).toBeLessThanOrEqual(SCREEN.width);
          expect(p.y + CARD.height).toBeLessThanOrEqual(SCREEN.height);
        }
      }
    }
  });

  it('survives a bubble wider than the window (lo must not exceed hi)', () => {
    const tiny = { width: 120, height: 90 };
    const p = placeTip(anchorAt(20, 20, 30, 30), { width: 260, height: 200 }, 'right', tiny);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
    expect(Number.isFinite(p.nub)).toBe(true);
  });
});

describe('the nub keeps pointing at the control after the clamp', () => {
  it('sits on the control centre when nothing was clamped', () => {
    const p = placeTip(anchorAt(600, 400), CARD, 'right', SCREEN);
    // Card top 400, control centre 420 -> 20px down the card's own edge.
    expect(p.nub).toBe(20);
  });

  it('walks along the card when the card was pushed off the control', () => {
    // A control hard against the top edge: the card is clamped down, so the
    // nub has to climb toward the card's top to keep pointing at the button.
    const high = placeTip(anchorAt(600, 0, 40, 40), CARD, 'right', SCREEN);
    const mid = placeTip(anchorAt(600, 400, 40, 40), CARD, 'right', SCREEN);
    expect(high.nub).toBeLessThan(mid.nub);
  });

  it('stays off the rounded corners at both ends', () => {
    for (const y of [0, 4, 12, 400, 780, 796]) {
      const p = placeTip(anchorAt(600, y), CARD, 'right', SCREEN);
      expect(p.nub).toBeGreaterThanOrEqual(10);
      expect(p.nub).toBeLessThanOrEqual(CARD.height - 10);
    }
    for (const x of [0, 4, 12, 600, 1250, 1276]) {
      const p = placeTip(anchorAt(x, 400), CARD, 'top', SCREEN);
      expect(p.nub).toBeGreaterThanOrEqual(10);
      expect(p.nub).toBeLessThanOrEqual(CARD.width - 10);
    }
  });

  it('measures the nub along the right axis for each side', () => {
    // Vertical sides measure down the card's height; horizontal ones measure
    // across its width. Folding those two the same way is how a nub ends up
    // hanging past the end of a 40px-tall card.
    const vertical = placeTip(anchorAt(600, 400), CARD, 'right', SCREEN);
    expect(vertical.nub).toBeLessThanOrEqual(CARD.height);

    const horizontal = placeTip(anchorAt(600, 400), CARD, 'top', SCREEN);
    expect(horizontal.nub).toBeGreaterThan(CARD.height);
  });
});

describe('placements are whole pixels', () => {
  it('rounds x, y and the nub, so nothing lands on a half-pixel seam', () => {
    const p = placeTip(anchorAt(601, 401, 37, 37), { width: 199, height: 39 }, 'right', SCREEN);
    expect(p.x).toBe(Math.round(p.x));
    expect(p.y).toBe(Math.round(p.y));
    expect(p.nub).toBe(Math.round(p.nub));
  });
});
