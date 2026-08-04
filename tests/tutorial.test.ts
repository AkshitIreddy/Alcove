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
  CELEBRATE_MS,
  CELEBRATE_SNAP_MS,
  applyInset,
  arrowHeadPath,
  arrowPath,
  arrowPoints,
  celebrateDelay,
  centerCard,
  chooseSide,
  clampToViewport,
  edgePointToward,
  firstStepIndex,
  holePath,
  inflateBox,
  inflateRect,
  intersectionArea,
  isTypingTarget,
  keyAction,
  placeCard,
  rectCenter,
  roundedRectPath,
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
import {
  PANEL_DWELL_MS,
  SHORT_TOUR_STEP_IDS,
  TUTORIAL_STEPS,
  TUTORIAL_STEP_IDS,
  stepTargets,
  tourSteps,
} from '../src/features/tutorial/steps';
import { DISMISSIBLE, dismissStale, openSurfaceIds } from '../src/features/tutorial/dismiss';
import { SURFACE_FACTS, factHolds } from '../src/features/tutorial/probe';
import {
  TOUR_LAYER_SELECTOR,
  TOUR_STEP_ATTR,
  stepWatchVerdict,
} from '../src/features/tutorial/tourStep';
import {
  rememberTasteChosen,
  resetTasteStoreForTests,
} from '../src/features/tutorial/tasteStore';
import {
  TASTE_AXES,
  TASTE_QUESTIONS,
  type TasteAnswers,
} from '../src/features/tutorial/tasteProfile';

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

  it('grows a rect asymmetrically for the drag-handle gutter case', () => {
    const block: Rect = { x: 229, y: 179, width: 465, height: 64 };
    expect(inflateBox(block, { left: 46, right: 16, top: 10, bottom: 10 })).toEqual({
      x: 183,
      y: 169,
      width: 527,
      height: 84,
    });
    // The handle sits ~32px left of the text; the padded box must contain it.
    expect(inflateBox(block, { left: 46 }).x).toBeLessThan(197);
    expect(inflateBox(block, undefined)).toBe(block);
    expect(inflateBox(block, {})).toEqual(block);
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

  /* Every highlight is a straight rounded rect — see roundedRectPath's
     docblock for why the hand-traced ring had to go. */
  it('frames the target with exactly four straight edges and four arcs', () => {
    const rect: Rect = { x: 200, y: 150, width: 240, height: 90 };
    const d = roundedRectPath(rect, 14);
    expect(d.match(/A /g)?.length).toBe(4);
    expect(d.match(/[HV] /g)?.length).toBe(4);
    // No quadratics: nothing bows off the box.
    expect(d).not.toContain('Q ');
    expect(d.endsWith('Z')).toBe(true);
    expect(pathNumbersAreFinite(d)).toBe(true);
    // The edges ARE the rect's edges — the old wobble drifted off them.
    expect(d).toContain('M 214 150');
    expect(d).toContain('H 426');
  });

  it('clamps the corner radius so a thin target never turns into a lozenge', () => {
    const thin: Rect = { x: 0, y: 0, width: 200, height: 12 };
    const d = roundedRectPath(thin, 40);
    expect(d).toContain('A 6 6');
    // Degenerate radius falls back to a plain rectangle.
    expect(roundedRectPath({ x: 0, y: 0, width: 10, height: 10 }, 0)).toBe(
      'M 0 0 H 10 V 10 H 0 Z',
    );
  });

  it('builds the scrim as an outer rect plus a hole subpath (evenodd)', () => {
    const hole: Rect = { x: 300, y: 200, width: 200, height: 120 };
    const d = spotlightPath(hole, VP, 14);
    expect(d.startsWith('M 0 0 H 1440 V 900 H 0 Z')).toBe(true);
    expect(d.match(/M /g)?.length).toBeGreaterThanOrEqual(2);
    expect(d.endsWith('Z')).toBe(true);
    expect(pathNumbersAreFinite(d)).toBe(true);
    expect(d).toContain(holePath(hole, 14));
  });

  it('falls back to a solid scrim with no hole', () => {
    expect(solidScrimPath(VP)).toBe('M 0 0 H 1440 V 900 H 0 Z');
  });

  it('is deterministic — same rect, same path, no per-frame shimmer', () => {
    const rect: Rect = { x: 10, y: 10, width: 50, height: 50 };
    expect(spotlightPath(rect, VP, 12)).toBe(spotlightPath(rect, VP, 12));
    expect(spotlightPath(rect, VP, 12)).not.toBe(spotlightPath(rect, VP, 4));
  });
});

/* ------------------------------ keyboard ---------------------------------- */

describe('keyboard contract', () => {
  it('advances on Enter and nothing else', () => {
    expect(keyAction('Enter')).toBe('next');
  });

  /* The tour asks the reader to type, and to turn pages with ← →. Every key
     it used to swallow is a key one of its own steps needs. */
  it('never steals a key a step is teaching', () => {
    for (const key of [
      ' ',
      'Spacebar',
      'ArrowRight',
      'ArrowLeft',
      'ArrowUp',
      'ArrowDown',
      'PageUp',
      'PageDown',
      'Backspace',
      'Delete',
      '/',
      'a',
      'Tab',
    ]) {
      expect(keyAction(key)).toBeNull();
    }
  });

  it('maps escape to skip', () => {
    expect(keyAction('Escape')).toBe('skip');
    expect(keyAction('Esc')).toBe('skip');
  });

  it('recognises the fields whose keys the tour must not touch at all', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    // A block inside the page editor: contenteditable lives on the root.
    expect(isTypingTarget({ tagName: 'P', closest: () => ({}) })).toBe(true);
    expect(isTypingTarget({ tagName: 'P', closest: () => null })).toBe(false);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

/* -------------------------------- beats ----------------------------------- */

/*
 * THE REPORTED DEFECT, in one number: a step that asked the reader to open a
 * panel went green the instant the panel appeared and the tour advanced 1.2s
 * later — at which point dismiss.ts shut the panel again. Measured on the
 * running app: visible at 488ms, gone at 1696ms.
 */
describe('the beat before the tour walks on', () => {
  it('scales the ordinary celebration with the motion preference', () => {
    expect(celebrateDelay(undefined, 1)).toBe(CELEBRATE_MS);
    // Floored at 0.6 so "half the motion" is still long enough to read a line.
    expect(celebrateDelay(undefined, 0.5)).toBe(CELEBRATE_MS * 0.6);
    // Motion off: no tick to watch draw, so do not sit there.
    expect(celebrateDelay(undefined, 0)).toBe(CELEBRATE_SNAP_MS);
  });

  /* A dwell is READING time, and styles/motion.ts states the rule for those:
     someone who turned animation off still needs the same beat. */
  it('never scales a reading dwell, and never collapses it', () => {
    for (const motion of [0, 0.25, 0.5, 1, 2]) {
      expect(celebrateDelay(PANEL_DWELL_MS, motion), `motion ${motion}`).toBe(PANEL_DWELL_MS);
    }
    // A nonsense dwell still leaves the tick time to appear.
    expect(celebrateDelay(0, 1)).toBe(CELEBRATE_SNAP_MS);
  });

  it('holds a taught panel open far longer than the 1208ms that was reported', () => {
    expect(celebrateDelay(PANEL_DWELL_MS, 1)).toBeGreaterThan(1208 * 2);
    expect(celebrateDelay(undefined, 1)).toBeLessThan(celebrateDelay(PANEL_DWELL_MS, 1));
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
  it('walks the shelf, then the book, then the library, in order', () => {
    expect(TUTORIAL_STEP_IDS).toEqual([
      'welcome',
      'taste',
      'first-book',
      'shelf-moves',
      'shelf-dock',
      'shelf-studio',
      'open-a-book',
      'the-rail',
      'writing',
      'blocks',
      'pages',
      'page-style',
      'catalogue',
      'finding-in-book',
      'customize-open',
      'customize-do',
      'rail-actions',
      'ai-script',
      'quick-switch',
      'settings',
      'youre-set',
    ]);
  });

  /* The reader's report: "the tutorial did not show all the stuff in the
     sidebar in the notebook and also did not show the option in sidebar when
     bookshelf is open". Both rails are now walked, panel by panel, and this
     is the test that notices when a rail grows a tool the tour never mentions.
     Selectors are hints, not contracts — so this asserts on the tour's own
     coverage, naming each tool it must have pointed at. */
  it('points at both rails — every book panel and every shelf tool', () => {
    const selectors = TUTORIAL_STEPS.flatMap((s) =>
      stepTargets(s).map((t) => t.selector),
    ).join(' ');
    for (const tool of ['customize', 'page-style', 'catalogue', 'toc', 'focus', 'spec']) {
      expect(selectors).toContain(`data-tool="${tool}"`);
    }
    expect(selectors).toContain('.shelf-dock');
    expect(selectors).toContain('data-shelf-dock="studio"');
    // The panels themselves, matched only while open.
    for (const label of ['Page style', 'Catalogue', 'Table of contents', 'Customize this book']) {
      expect(selectors).toContain(`aria-label="${label}"`);
    }
  });

  it('every step has unique id, title and body copy', () => {
    expect(new Set(TUTORIAL_STEP_IDS).size).toBe(TUTORIAL_STEPS.length);
    for (const step of TUTORIAL_STEPS) {
      expect(step.title.length).toBeGreaterThan(3);
      expect(step.body.length).toBeGreaterThan(20);
    }
  });

  /* The brief: every step gets completion detection, and a step that cannot
     detect completion must not claim to. Only the greeting and the sign-off
     are allowed to have nothing to do — and they must have no task object at
     all, so the card renders the muted "just read" line instead of a tick. */
  it('asks for one detectable thing on every step but the two bookends', () => {
    const taskless = TUTORIAL_STEPS.filter((s) => s.task === undefined).map((s) => s.id);
    expect(taskless).toEqual(['welcome', 'youre-set']);
    const facts = new Set<string>();
    for (const step of TUTORIAL_STEPS) {
      if (step.task === undefined) continue;
      expect(step.task.ask.length).toBeGreaterThan(8);
      expect(step.task.done.length).toBeGreaterThan(4);
      // One fact per step: two steps sharing a fact would tick together.
      expect(facts.has(step.task.fact)).toBe(false);
      facts.add(step.task.fact);
    }
  });

  /* Plain and warm: say what the thing is, not what it is like. The similes
     the first script leaned on ("a bookshelf you can actually live in",
     "pages turn like paper") are what read oddly. */
  it('keeps the copy free of simile', () => {
    for (const step of TUTORIAL_STEPS) {
      const copy = `${step.title} ${step.body}`;
      expect(copy).not.toMatch(/\b(like an?|as if|as though|reads like|feels like)\b/i);
    }
  });

  /* "A step should close what the step before it opened, GENERALLY — not two
     special cases." The rule lives in dismiss.ts and reads the incoming step's
     own target list, so this asserts the two halves that make it work:
     a step that is about a surface points inside it, and a step that is not
     does not. Steps 10 and 12 of the reported build are the two cases. */
  it('lets each step declare, through its targets, what it needs kept open', () => {
    const targetsOf = (id: string): string[] =>
      stepTargets(TUTORIAL_STEPS.find((s) => s.id === id)!).map((t) => t.selector);
    // Talks about the open customize sheet → points at it → it survives.
    expect(targetsOf('customize-do').some((s) => s.includes('Customize this book'))).toBe(
      true,
    );
    // The step AFTER it points at a rail button instead, which is not inside
    // any sheet — so the sheet is put away on the way in.
    for (const after of ['rail-actions', 'ai-script']) {
      for (const selector of targetsOf(after)) {
        expect(selector).not.toContain('nb-rail-panel');
      }
    }
    // Same shape one step later: the quick-switcher bar, then Settings.
    expect(targetsOf('quick-switch')).toContain('.nb-qs-bar');
    for (const selector of targetsOf('settings')) {
      expect(selector).not.toContain('nb-qs');
    }
  });

  it('knows how to put away every surface a step can open', () => {
    const ids = DISMISSIBLE.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const kind of DISMISSIBLE) {
      expect(kind.open.length).toBeGreaterThan(3);
      // Either a control inside the surface, or the one key that always works.
      expect(kind.close === 'escape' || kind.close.startsWith('.')).toBe(true);
    }
    // Every sheet the tour asks a reader to open is covered by one of them.
    expect(ids).toContain('rail-panel'); // customize, page style, catalogue, toc, studio
    expect(ids).toContain('quick-switcher');
    expect(ids).toContain('settings');
    // DOM-free: in node both are inert rather than a throw, which is what lets
    // the overlay call them unconditionally on every step entry.
    expect(dismissStale(['.nb-rail-panel'])).toEqual([]);
    expect(openSurfaceIds()).toEqual([]);
  });

  it('normalises targets and keeps every selector plausible', () => {
    for (const step of TUTORIAL_STEPS) {
      for (const target of stepTargets(step)) {
        expect(target.selector).toMatch(/^[.#[a-zA-Z]/);
        expect(target.selector.trim()).toBe(target.selector);
        if (typeof target.inset === 'object') {
          for (const v of Object.values(target.inset)) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(0.9);
          }
          // Opposing pairs must leave a real region behind, not invert it.
          expect((target.inset.top ?? 0) + (target.inset.bottom ?? 0)).toBeLessThan(0.92);
          expect((target.inset.left ?? 0) + (target.inset.right ?? 0)).toBeLessThan(0.92);
        }
        for (const v of Object.values(target.padBox ?? {})) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(400);
        }
      }
    }
  });

  /* Two lengths, one script (the reader asked to be offered "bare minimum or
     full the rundown"). The short tour must be a genuine SUBSET in the same
     order — not a second list that drifts — or the reader who takes the short
     way is being shown a different app from the one the full tour describes. */
  it('offers a short tour that is a real subset of the full one', () => {
    const full = tourSteps('full').map((s) => s.id);
    const short = tourSteps('short').map((s) => s.id);
    expect(full).toEqual(TUTORIAL_STEP_IDS);
    expect(short).toEqual(SHORT_TOUR_STEP_IDS);
    expect(short.length).toBeGreaterThan(4);
    expect(short.length).toBeLessThan(full.length);
    // Subset...
    for (const id of short) expect(full).toContain(id);
    // ...and in the same order.
    expect(full.filter((id) => short.includes(id))).toEqual(short);
    // The bookends are in both: the greeting asks the question, and nobody
    // should reach the end of a tour without being told how to replay it.
    expect(short[0]).toBe('welcome');
    expect(short[short.length - 1]).toBe('youre-set');
  });

  /* The first-run gate. An empty case shows a "write my first one" invite; the
     reported bug is that dragging the shelf counted as progress and dumped the
     reader on "click a spine" with no spines. The step must wait for the book,
     must say what to do when the wrong thing is tried, and must never appear
     for a reader whose library already has books in it. */
  it('gates the first book, and only on an empty case', () => {
    const gate = TUTORIAL_STEPS.find((s) => s.id === 'first-book');
    expect(gate).toBeDefined();
    if (gate === undefined) return;
    expect(gate.skipIfMissing).toBe(true);
    expect(gate.task?.fact).toBe('first-book-made');
    // Not satisfiable by a shelf gesture — that is the whole point.
    expect(gate.task?.fact).not.toBe('shelf-moved');
    expect(gate.task?.nudge?.when).toBe('shelf-moved');
    expect((gate.task?.nudge?.say ?? '').length).toBeGreaterThan(12);
    // Every target matches the empty-case invite ONLY, or the step would fail
    // to skip itself and every reader would meet a gate they cannot pass.
    for (const target of stepTargets(gate)) {
      expect(target.selector.startsWith('.shelf-firstrun')).toBe(true);
    }
  });

  /* Nudges name a fact the probe can actually observe, and never the step's
     own fact (which would fire the aside at the same moment as the tick). */
  it('keeps every nudge honest', () => {
    for (const step of TUTORIAL_STEPS) {
      const nudge = step.task?.nudge;
      if (nudge === undefined) continue;
      expect(nudge.when).not.toBe(step.task?.fact);
      expect(nudge.say.length).toBeGreaterThan(12);
    }
  });

  /* The block-drag step's spotlight IS the editable column. Padding it would
     light paper that rejects the drop, which is the reported "stop sign on his
     cursor"; shrinking it back to one paragraph is what made the target too
     small to drag inside. Both regressions are one number. */
  it('frames the whole writing column on the block step, with no padding', () => {
    const blocks = TUTORIAL_STEPS.find((s) => s.id === 'blocks');
    expect(blocks).toBeDefined();
    const first = stepTargets(blocks!)[0];
    expect(first.selector).toBe('.nb-prose');
    expect(first.pad).toBe(0);
    expect(first.padBox).toBeUndefined();
    expect(first.inset).toBeUndefined();
  });

  /*
   * THE TASTE STEP, and the reason it is worth three assertions rather than a
   * glance at the id list above.
   *
   * `src/features/tutorial/tasteQuestionnaire.tsx` was written complete, unit
   * tested, and reachable from exactly one settings row: the app shell did not
   * render it and the tour had no step for it, so the four questions that dress
   * a reader's whole library never ran for a reader. The panel opens itself off
   * `data-tutorial-step` and matches on the literal string `taste` — there is no
   * import in either direction — so the id IS the wiring, and renaming it breaks
   * the feature silently and invisibly.
   */
  it("carries a step whose id is 'taste' — the questionnaire's whole contract", () => {
    const taste = TUTORIAL_STEPS.find((s) => s.id === 'taste');
    expect(
      taste,
      "no step carries id 'taste'; tasteQuestionnaire.tsx polls for exactly that string",
    ).toBeDefined();
    if (taste === undefined) return;

    // EARLY, and in BOTH lengths: the answers repaint the room, rebuild the
    // case and rehang the wall that every later step points at, so a reader who
    // meets it last has taken the tour of somebody else's library.
    expect(taste.short).toBe(true);
    const at = TUTORIAL_STEP_IDS.indexOf('taste');
    expect(at).toBeGreaterThan(0); // after the greeting, which picks the length
    expect(at).toBeLessThanOrEqual(2);
    expect(SHORT_TOUR_STEP_IDS.indexOf('taste')).toBe(1);
    for (const later of ['shelf-moves', 'shelf-studio', 'open-a-book', 'settings']) {
      expect(TUTORIAL_STEP_IDS.indexOf(later), later).toBeGreaterThan(at);
    }

    // Completion is "the library was dressed", never "the panel went away" —
    // and the step must not gate the tour: no skipIfMissing, so it is always
    // offered, and next walks past it like any other.
    expect(taste.task?.fact).toBe('taste-chosen');
    expect(taste.skipIfMissing).toBeUndefined();
  });

  /*
   * …and the fact behind it is really the store's marker. A step naming a fact
   * nothing observes ticks never or always, and both look like a working tour.
   */
  it("ticks 'taste-chosen' only once the library was actually dressed", async () => {
    resetTasteStoreForTests();
    // now = 0 on every call: the probe's DOM poll is inert without a document.
    expect(factHolds('taste-chosen', 0)).toBe(false);
    await rememberTasteChosen({
      room: 'reading-room',
      pitch: 'warm',
      paper: 'ruled',
      sound: 'house',
    } as TasteAnswers);
    expect(factHolds('taste-chosen', 0)).toBe(true);
    // "choose my look again" clears it, and the step is outstanding once more.
    resetTasteStoreForTests();
    expect(factHolds('taste-chosen', 0)).toBe(false);
  });

  /*
   * THE COUNT THE PANEL SAYS OUT LOUD.
   *
   * The questionnaire's header renders "question 1 of N" straight off
   * TASTE_QUESTIONS.length, and the tour step in front of it typed the number
   * into three sentences. An axis was added and the panel said five while the
   * step said four — the first three sentences a new reader ever reads, and one
   * of them was already wrong. Pinned against the vocabulary rather than
   * against a literal, so the next axis breaks this test instead of the copy.
   */
  it('counts the taste questions the way the panel counts them', () => {
    const words = [
      'zero', 'one', 'two', 'three', 'four', 'five',
      'six', 'seven', 'eight', 'nine', 'ten',
    ];
    // One question per axis, which is what makes either count a valid pin.
    expect(TASTE_QUESTIONS.length).toBe(TASTE_AXES.length);
    const word = words[TASTE_AXES.length];
    expect(word, 'add a word above if the questionnaire grows past ten').toBeDefined();

    const step = TUTORIAL_STEPS.find((s) => s.id === 'taste');
    expect(step).toBeDefined();
    if (step === undefined) return;
    for (const line of [step.title, step.body, step.task?.ask ?? '']) {
      expect(line.toLowerCase(), `no count in: ${line}`).toContain(word);
      for (const other of words.slice(2)) {
        if (other === word) continue;
        expect(line.toLowerCase(), `stale "${other}" in: ${line}`).not.toMatch(
          new RegExp(`\\b${other}\\b`),
        );
      }
    }
  });

  /*
   * OPENING A BOOK TAKES TWO PRESSES, and the tour has to say so.
   *
   * `PulledBookOverlay` docblock: "Pulling a book out brings it FORWARD. A
   * second click opens it" — the reader asked for that half-way state. The step
   * still said "click a spine and the book tips out of the case and opens", and
   * nothing anywhere mentioned the second press, so a reader who followed the
   * card exactly got a big cover and a task that would not go green.
   */
  it('tells the reader a book takes two presses, and names the state between', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'open-a-book');
    expect(step).toBeDefined();
    if (step === undefined) return;
    // The sentence that was wrong.
    expect(step.body).not.toMatch(/out of the case and opens/i);
    expect(step.body).toMatch(/press the cover/i);
    expect(step.hint ?? '').toMatch(/press the cover/i);
    expect(step.task?.ask ?? '').toMatch(/press the cover/i);
    // Completion is still the book being open, never merely out.
    expect(step.task?.fact).toBe('book-open');
    // ...and the half-way state gets a line of its own, on the fact that IS it,
    // so the card speaks up exactly while the book is standing there waiting.
    expect(step.task?.nudge?.when).toBe('book-pulled');
    expect(step.task?.nudge?.say ?? '').toMatch(/press the cover/i);
  });

  /*
   * A step whose fact means "a surface is on screen" ticks the moment that
   * surface APPEARS — which is when the reader starts looking at it. Walking on
   * is what closes it again (dismiss.ts), so those steps must buy reading time
   * or the tour opens a drawer and shuts it in the reader's face.
   */
  it('gives every step that teaches a panel time to read it', () => {
    const surface = new Set<string>(SURFACE_FACTS);
    const teaching = TUTORIAL_STEPS.filter(
      (s) => s.task !== undefined && surface.has(s.task.fact),
    );
    expect(teaching.map((s) => s.id)).toEqual([
      'shelf-studio',
      'page-style',
      'catalogue',
      'finding-in-book',
      'customize-open',
      'quick-switch',
      'settings',
    ]);
    for (const step of teaching) {
      expect(step.task?.dwell, `"${step.id}" would be shut 1.2s after opening`).toBe(
        PANEL_DWELL_MS,
      );
    }
    // A step that asks for a GESTURE has already been done by the time it
    // ticks, so it keeps the ordinary beat.
    for (const step of TUTORIAL_STEPS) {
      if (step.task === undefined || surface.has(step.task.fact)) continue;
      expect(step.task.dwell, `"${step.id}" does not teach a panel`).toBeUndefined();
    }
    // Every fact on the list is one a step actually names; a fact nobody uses
    // is a rule that quietly stops covering anything.
    const used = new Set(TUTORIAL_STEPS.map((s) => s.task?.fact));
    for (const fact of SURFACE_FACTS) expect(used.has(fact), fact).toBe(true);
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

/* --------------------- a panel riding a tour step -------------------------- */

/*
 * The taste questionnaire watches `data-tutorial-step` and puts itself on
 * screen for the `taste` step. It used to do ONLY that: never close. Answer one
 * question, press next, and all five stayed up over the shelf — card across the
 * tour's own next and skip, scrim across the control the new step was asking
 * for. The verdict below is the whole watcher, so a half of it cannot go
 * missing again without this failing.
 */
describe('a panel that rides a tour step', () => {
  const base = {
    here: 'taste',
    stepId: 'taste',
    open: false,
    mine: false,
    settled: false,
    openedForStep: false,
  };

  it('opens once, on its own step, for a reader who has not answered', () => {
    expect(stepWatchVerdict(base)).toBe('open');
    // …and not a second time on the same visit: that is what makes "I'll pick
    // later" a way out rather than a panel that reopens over the top of you.
    expect(stepWatchVerdict({ ...base, openedForStep: true })).toBe('leave-alone');
    expect(stepWatchVerdict({ ...base, open: true })).toBe('leave-alone');
    // A reader who finished it last week is never asked again.
    expect(stepWatchVerdict({ ...base, settled: true })).toBe('leave-alone');
  });

  it('closes itself the moment the tour is on any other step', () => {
    const up = { ...base, open: true, mine: true, openedForStep: true };
    expect(stepWatchVerdict({ ...up, here: 'first-book' })).toBe('close');
    // Including "no tour at all", which is what a closed tour reads as.
    expect(stepWatchVerdict({ ...up, here: '' })).toBe('close');
  });

  it('never takes away a panel the tour did not open', () => {
    // The settings sheet's "choose my look again" row: opened with no tour
    // running, which reads as `here: ''` and must not be closed instantly.
    const settingsRow = { ...base, here: '', open: true, mine: false };
    expect(stepWatchVerdict(settingsRow)).toBe('leave-alone');
    expect(stepWatchVerdict({ ...base, here: 'writing', open: false, mine: true })).toBe(
      'leave-alone',
    );
  });

  it('names the attribute the overlay actually writes', () => {
    // The contract is a string in two files; this is the one place both can be
    // checked against. TutorialOverlay renders `data-tutorial-step` on
    // `.nbt-layer`, which is what the selector has to find.
    expect(TOUR_LAYER_SELECTOR).toContain(TOUR_STEP_ATTR);
    expect(TOUR_LAYER_SELECTOR.startsWith('.nbt-layer')).toBe(true);
    expect(TOUR_STEP_ATTR).toBe('data-tutorial-step');
  });
});
