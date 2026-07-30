// @vitest-environment node
/**
 * tests/tutorial.test.ts — the guided tour's pure surfaces.
 *
 * The overlay component itself needs a DOM (jsdom is not installed, see
 * vitest.config.ts), so everything worth asserting lives in
 * src/features/tutorial/engine.ts: card placement, seeded pencil wobble,
 * spotlight path construction, the keyboard contract, and the navigation
 * rules that guarantee a missing target can never trap the user.
 */

import { describe, expect, it } from 'vitest';

import {
  applyInset,
  arrowHeadPath,
  arrowPath,
  arrowPoints,
  centerCard,
  chooseSide,
  clampToViewport,
  edgePointToward,
  firstStepIndex,
  holeOutlinePoints,
  holePath,
  inflateRect,
  intersectionArea,
  keyAction,
  placeCard,
  rectCenter,
  seedFrom,
  seededRandom,
  sideSpace,
  smoothPath,
  solidScrimPath,
  spotlightPath,
  stepIndexAfter,
  type Rect,
  type Size,
} from '../src/features/tutorial/engine';
import { TUTORIAL_STEPS, TUTORIAL_STEP_IDS } from '../src/features/tutorial/steps';

const VP: Size = { width: 1440, height: 900 };
const CARD: Size = { width: 348, height: 232 };

/** Every number in an SVG path must be finite — NaN silently blanks the path. */
function pathNumbersAreFinite(d: string): boolean {
  const numbers = d.match(/-?\d+(\.\d+)?/g) ?? [];
  return numbers.length > 0 && numbers.every((t) => Number.isFinite(Number(t)));
}

/* --------------------------------- rects ---------------------------------- */

describe('rect helpers', () => {
  it('inflates symmetrically and never inverts', () => {
    expect(inflateRect({ x: 10, y: 20, width: 100, height: 40 }, 6)).toEqual({
      x: 4,
      y: 14,
      width: 112,
      height: 52,
    });
    const collapsed = inflateRect({ x: 0, y: 0, width: 4, height: 4 }, -10);
    expect(collapsed.width).toBe(0);
    expect(collapsed.height).toBe(0);
  });

  it('applies fractional insets and clamps runaway values', () => {
    const base: Rect = { x: 0, y: 0, width: 1000, height: 500 };
    expect(applyInset(base, 0.1)).toEqual({ x: 100, y: 50, width: 800, height: 400 });
    expect(applyInset(base, { left: 0.25, right: 0.25 })).toEqual({
      x: 250,
      y: 0,
      width: 500,
      height: 500,
    });
    // Beyond 0.48 per side the rect would invert; it is clamped instead.
    const squeezed = applyInset(base, 5);
    expect(squeezed.width).toBeGreaterThanOrEqual(8);
    expect(squeezed.height).toBeGreaterThanOrEqual(8);
    expect(applyInset(base, undefined)).toBe(base);
  });

  it('slides a card back inside the viewport without resizing it', () => {
    const out = clampToViewport({ x: -80, y: 880, width: 348, height: 232 }, VP, 16);
    expect(out.width).toBe(348);
    expect(out.height).toBe(232);
    expect(out.x).toBe(16);
    expect(out.y).toBe(900 - 232 - 16);
  });

  it('centres an anchorless card slightly above optical centre', () => {
    const rect = centerCard(VP, CARD);
    expect(rect.x).toBeCloseTo((1440 - 348) / 2, 5);
    expect(rect.y).toBeLessThan((900 - 232) / 2);
    expect(rect.y).toBeGreaterThan(0);
  });
});

/* ------------------------------- placement -------------------------------- */

describe('card placement', () => {
  const anchor: Rect = { x: 660, y: 400, width: 120, height: 80 };

  it('measures free space on every side', () => {
    expect(sideSpace(anchor, VP)).toEqual({
      top: 400,
      bottom: 420,
      left: 660,
      right: 660,
    });
  });

  it('honours the preferred side when it fits', () => {
    expect(chooseSide(anchor, VP, CARD, 22, 'right')).toBe('right');
    expect(chooseSide(anchor, VP, CARD, 22, 'top')).toBe('top');
  });

  it('falls back to the roomiest side when the preference cannot fit', () => {
    // A rail pinned to the left edge: "left" is impossible, so go right.
    const rail: Rect = { x: 0, y: 120, width: 64, height: 600 };
    expect(chooseSide(rail, VP, CARD, 22, 'left')).toBe('right');
  });

  it('places the card on the chosen side, centred on the target', () => {
    const { rect, side } = placeCard(anchor, VP, CARD, { gap: 26, preferred: 'right' });
    expect(side).toBe('right');
    expect(rect.x).toBe(anchor.x + anchor.width + 26);
    expect(rectCenter(rect).y).toBeCloseTo(rectCenter(anchor).y, 5);
  });

  it('never puts the card outside the viewport, even in a corner', () => {
    const corner: Rect = { x: 1400, y: 860, width: 36, height: 36 };
    const { rect } = placeCard(corner, VP, CARD, { margin: 18 });
    expect(rect.x).toBeGreaterThanOrEqual(18);
    expect(rect.y).toBeGreaterThanOrEqual(18);
    expect(rect.x + rect.width).toBeLessThanOrEqual(VP.width - 18 + 0.001);
    expect(rect.y + rect.height).toBeLessThanOrEqual(VP.height - 18 + 0.001);
  });

  it('measures rect overlap', () => {
    const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(intersectionArea(a, { x: 50, y: 50, width: 100, height: 100 })).toBe(2500);
    expect(intersectionArea(a, { x: 200, y: 0, width: 10, height: 10 })).toBe(0);
    // Touching edges is not overlapping.
    expect(intersectionArea(a, { x: 100, y: 0, width: 10, height: 100 })).toBe(0);
  });

  it('never parks the card on top of the spotlight it points at', () => {
    // A wide spotlight hugging the right edge: "right" has no room, so the
    // clamped card would land back over the target. Placement must reject it.
    const wide: Rect = { x: 420, y: 200, width: 900, height: 460 };
    const { rect } = placeCard(wide, VP, CARD, { gap: 26, preferred: 'right' });
    expect(intersectionArea(rect, wide)).toBe(0);
  });

  it('finds the edge point of a rect facing a given direction', () => {
    const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(edgePointToward(rect, { x: 500, y: 50 })).toEqual({ x: 100, y: 50 });
    expect(edgePointToward(rect, { x: 50, y: -500 })).toEqual({ x: 50, y: 0 });
    // Degenerate: pointing at its own centre returns the centre.
    expect(edgePointToward(rect, { x: 50, y: 50 })).toEqual({ x: 50, y: 50 });
  });
});

/* ------------------------------- wobble ----------------------------------- */

describe('seeded wobble', () => {
  it('is deterministic and stays in [0, 1)', () => {
    const a = seededRandom(1234);
    const b = seededRandom(1234);
    const first = Array.from({ length: 50 }, () => a());
    const second = Array.from({ length: 50 }, () => b());
    expect(first).toEqual(second);
    for (const v of first) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    // Not a constant stream.
    expect(new Set(first).size).toBeGreaterThan(40);
  });

  it('survives a zero seed', () => {
    const rng = seededRandom(0);
    expect(Number.isFinite(rng())).toBe(true);
  });

  it('hashes step ids to distinct 32-bit seeds', () => {
    const seeds = TUTORIAL_STEP_IDS.map(seedFrom);
    expect(new Set(seeds).size).toBe(seeds.length);
    for (const s of seeds) {
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

/* -------------------------------- paths ----------------------------------- */

describe('pencil paths', () => {
  const from = { x: 100, y: 100 };
  const to = { x: 400, y: 260 };

  it('anchors the arrow exactly at both endpoints despite the wobble', () => {
    const pts = arrowPoints(from, to, seedFrom('endless-shelf'));
    expect(pts[0]).toEqual(from);
    expect(pts[pts.length - 1]).toEqual(to);
  });

  it('bows off the straight line in the middle', () => {
    const pts = arrowPoints(from, to, 42, { bow: 0.3, wobble: 0 });
    const mid = pts[Math.floor(pts.length / 2)];
    const straight = {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
    };
    expect(Math.hypot(mid.x - straight.x, mid.y - straight.y)).toBeGreaterThan(20);
  });

  it('renders a smooth quadratic chain with finite numbers', () => {
    const d = arrowPath(from, to, 7);
    expect(d.startsWith('M ')).toBe(true);
    expect(d).toContain('Q ');
    expect(pathNumbersAreFinite(d)).toBe(true);
  });

  it('degrades gracefully for 0/1/2 points', () => {
    expect(smoothPath([])).toBe('');
    expect(smoothPath([from])).toBe('M 100 100');
    expect(smoothPath([from, to])).toBe('M 100 100 L 400 260');
  });

  it('draws two barbs at the tip, pointing back along the stroke', () => {
    const pts = arrowPoints(from, to, 9);
    const head = arrowHeadPath(pts, 9, 14);
    expect(head.match(/M /g)?.length).toBe(2);
    expect(pathNumbersAreFinite(head)).toBe(true);
    expect(arrowHeadPath([from], 9)).toBe('');
  });

  it('traces a closed, wobbled ring that hugs the target rect', () => {
    const rect: Rect = { x: 200, y: 150, width: 240, height: 90 };
    const pts = holeOutlinePoints(rect, 18, seedFrom('left-rail'));
    expect(pts.length).toBeGreaterThan(20);
    for (const p of pts) {
      expect(p.x).toBeGreaterThan(rect.x - 8);
      expect(p.x).toBeLessThan(rect.x + rect.width + 8);
      expect(p.y).toBeGreaterThan(rect.y - 8);
      expect(p.y).toBeLessThan(rect.y + rect.height + 8);
    }
    const d = holePath(rect, 18, 3);
    expect(d.endsWith('Z')).toBe(true);
    expect(pathNumbersAreFinite(d)).toBe(true);
  });

  it('builds the scrim as an outer rect plus a hole subpath (evenodd)', () => {
    const hole: Rect = { x: 300, y: 200, width: 200, height: 120 };
    const d = spotlightPath(hole, VP, 18, 11);
    expect(d.startsWith('M 0 0 H 1440 V 900 H 0 Z')).toBe(true);
    expect(d.match(/M /g)?.length).toBeGreaterThanOrEqual(2);
    expect(d.endsWith('Z')).toBe(true);
    expect(pathNumbersAreFinite(d)).toBe(true);
  });

  it('falls back to a solid scrim with no hole', () => {
    expect(solidScrimPath(VP)).toBe('M 0 0 H 1440 V 900 H 0 Z');
  });

  it('is stable across calls for the same seed (no per-frame shimmer)', () => {
    const a = spotlightPath({ x: 10, y: 10, width: 50, height: 50 }, VP, 12, 99);
    const b = spotlightPath({ x: 10, y: 10, width: 50, height: 50 }, VP, 12, 99);
    expect(a).toBe(b);
    const c = spotlightPath({ x: 10, y: 10, width: 50, height: 50 }, VP, 12, 100);
    expect(c).not.toBe(a);
  });
});

/* ------------------------------ keyboard ---------------------------------- */

describe('keyboard contract', () => {
  it('maps advance keys', () => {
    for (const key of ['Enter', ' ', 'Spacebar', 'ArrowRight', 'ArrowDown', 'PageDown']) {
      expect(keyAction(key)).toBe('next');
    }
  });

  it('maps back keys', () => {
    for (const key of ['ArrowLeft', 'ArrowUp', 'Backspace', 'PageUp']) {
      expect(keyAction(key)).toBe('back');
    }
  });

  it('maps escape to skip and ignores everything else', () => {
    expect(keyAction('Escape')).toBe('skip');
    expect(keyAction('Esc')).toBe('skip');
    expect(keyAction('a')).toBeNull();
    expect(keyAction('Tab')).toBeNull();
  });
});

/* ----------------------------- navigation --------------------------------- */

describe('navigation never traps the user', () => {
  const steps = [
    { id: 'a' },
    { id: 'b', skipIfMissing: true },
    { id: 'c', skipIfMissing: true },
    { id: 'd' },
  ];
  const missing = (ids: string[]) => (s: { id: string }) => !ids.includes(s.id);

  it('walks forward one step when nothing is missing', () => {
    expect(stepIndexAfter(steps, 0, 1, () => true)).toBe(1);
    expect(stepIndexAfter(steps, 3, -1, () => true)).toBe(2);
  });

  it('steps over consecutive missing skip-if-missing steps', () => {
    expect(stepIndexAfter(steps, 0, 1, missing(['b', 'c']))).toBe(3);
    expect(stepIndexAfter(steps, 3, -1, missing(['b', 'c']))).toBe(0);
  });

  it('keeps a missing step that did NOT opt into skipping', () => {
    expect(stepIndexAfter(steps, 0, 1, missing(['a', 'b', 'c', 'd']))).toBe(3);
  });

  it('returns null off either end so the caller can finish the tour', () => {
    expect(stepIndexAfter(steps, 3, 1, () => true)).toBeNull();
    expect(stepIndexAfter(steps, 0, -1, () => true)).toBeNull();
    // Even a tour where every remaining step is missing terminates.
    expect(stepIndexAfter([{ id: 'x', skipIfMissing: true }], -1, 1, () => false)).toBeNull();
  });

  it('picks a playable first step', () => {
    expect(firstStepIndex(steps, () => true)).toBe(0);
    expect(firstStepIndex([{ id: 'z', skipIfMissing: true }, { id: 'y' }], () => false)).toBe(1);
  });
});

/* ------------------------------- content ---------------------------------- */

describe('tour script', () => {
  it('covers the eleven briefed beats in order', () => {
    expect(TUTORIAL_STEP_IDS).toEqual([
      'welcome',
      'endless-shelf',
      'pull-a-book',
      'left-rail',
      'writing',
      'block-menu',
      'page-turning',
      'make-it-yours',
      'ai-script',
      'quick-switcher',
      'youre-set',
    ]);
  });

  it('every step has unique id, title and body copy', () => {
    expect(new Set(TUTORIAL_STEP_IDS).size).toBe(TUTORIAL_STEPS.length);
    for (const step of TUTORIAL_STEPS) {
      expect(step.title.length).toBeGreaterThan(3);
      expect(step.body.length).toBeGreaterThan(20);
    }
  });

  it('selectors are syntactically plausible and insets are sane', () => {
    for (const step of TUTORIAL_STEPS) {
      for (const selector of step.targets ?? []) {
        expect(selector).toMatch(/^[.#[a-zA-Z]/);
        expect(selector.trim()).toBe(selector);
      }
      if (typeof step.inset === 'object') {
        for (const v of Object.values(step.inset)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(0.9);
        }
        // Opposing pairs must leave a real region behind, not invert it.
        expect((step.inset.top ?? 0) + (step.inset.bottom ?? 0)).toBeLessThan(0.92);
        expect((step.inset.left ?? 0) + (step.inset.right ?? 0)).toBeLessThan(0.92);
      }
    }
  });

  it('placement works for every step against a real-ish anchor', () => {
    const anchor: Rect = { x: 40, y: 300, width: 64, height: 300 };
    for (const step of TUTORIAL_STEPS) {
      const { rect } = placeCard(anchor, VP, CARD, { preferred: step.side });
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
    }
  });
});
