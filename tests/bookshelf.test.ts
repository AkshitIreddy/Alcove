/**
 * tests/bookshelf.test.ts — pure-logic tests for the bookshelf world:
 * camera math (screen↔world, anchor-preserving zoom, clamp/rubber-band,
 * momentum), virtualizer windowing diff, LOD tier hysteresis, and the
 * wave-2 shelf-life data layer (shelf meta, thickness, trash drawer flow,
 * sort orders, floor plaque names). Node environment — no Pixi/DOM imports.
 */

import { describe, expect, it } from 'vitest';
import {
  createBook,
  duplicateBook,
  emptyTrash,
  getBook,
  listBooksByFloorRange,
  listTrashedBooks,
  maxOccupiedFloor,
  mergeCoverMetaSection,
  nextFreeSlot,
  readShelfMeta,
  renameBook,
  restoreBook,
  setBookPinned,
  thicknessScale,
  touchBookOpened,
  TRASH_FLOOR,
  trashBook,
  updateBookPageCount,
} from '../src/data/books';
import { createPage, listPages } from '../src/data/pages';
import type { Book } from '../src/data/types';
import { resolveBookStyle } from '../src/art/bookStyle';
import { deriveSpineParams, PIGMENT_COUNT, SPINE_BASE_HEIGHT } from '../src/art/spines';
import { THEME_IDS, getTheme } from '../src/art/themes';
import { readBookStyleOverrides } from '../src/data/books';
import {
  coverOverridesFromStyle,
  spineArtHeight,
  themeSpineDefaults,
} from '../src/features/bookshelf/bookIdentity';
import { orderBooks } from '../src/features/bookshelf/data';
import {
  DEFAULT_LIBRARY_PREFS,
  mergeLibraryPrefs,
  resolveLibrary,
} from '../src/features/bookshelf/libraryPrefs';
import { libraryKey } from '../src/features/bookshelf/libraryKey';
import { parseFloorNames } from '../src/features/bookshelf/floorNames';
import {
  addWheelZoom,
  applyDragPosition,
  clampCamera,
  clampZoomBounds,
  createCamera,
  isOutOfBounds,
  lerpExp,
  LOG_MAX_ZOOM,
  LOG_MIN_ZOOM,
  MAX_ZOOM,
  MIN_CASE_VIEW_FRACTION,
  MIN_ZOOM,
  minZoomFor,
  momentumTick,
  MOMENTUM_KILL_SPEED,
  RUBBER_FACTOR,
  rubberBand,
  screenToWorld,
  weightedVelocity,
  worldToScreen,
  xBounds,
  zoomTick,
  type Viewport,
} from '../src/features/bookshelf/camera';
import {
  FLOOR_H,
  RAIL_W,
  SHELF_WIDTH,
  SLOT_MARGIN_X,
  X_SLACK,
  Y_MIN,
} from '../src/features/bookshelf/constants';
import {
  LAYOUT_MARGIN_X,
  layoutFloor,
  LEAN_MAX_DEG,
  MAX_LEANERS,
  type LayoutBookIn,
} from '../src/features/bookshelf/layout';
import {
  computeRange,
  diffWindow,
  Pool,
} from '../src/features/bookshelf/virtualizer';
import {
  LOD_HYSTERESIS,
  LOD_T01,
  LOD_T12,
  lodTierFor,
  nextLodTier,
} from '../src/features/bookshelf/lod';
import {
  BOOK_DRAG_DIST_PX,
  classifyDrag,
  classifyKeyZoom,
  classifyWheel,
  dragThresholdFor,
  PINCH_DELTA_MAX,
  PINCH_ZOOM_SENSITIVITY,
  PULL_COMPLETE_TRAVEL_PX,
  SHELF_DRAG_DIST_PX,
  WHEEL_ZOOM_SENSITIVITY,
  type WheelLike,
} from '../src/features/bookshelf/gestures';

const VP: Viewport = { width: 1280, height: 800 };

describe('camera: screen↔world', () => {
  it('round-trips a point through world and back', () => {
    const cam = createCamera(1.6, 123.4, 567.8);
    const screen = { x: 311, y: 209 };
    const world = screenToWorld(cam, screen);
    const back = worldToScreen(cam, world);
    expect(back.x).toBeCloseTo(screen.x, 10);
    expect(back.y).toBeCloseTo(screen.y, 10);
  });

  it('maps the camera origin to screen (0,0)', () => {
    const cam = createCamera(0.5, 50, 700);
    const screen = worldToScreen(cam, { x: 50, y: 700 });
    expect(screen.x).toBe(0);
    expect(screen.y).toBe(0);
  });

  it('scales distances by zoom', () => {
    const cam = createCamera(2, 0, 0);
    const a = worldToScreen(cam, { x: 10, y: 0 });
    const b = worldToScreen(cam, { x: 20, y: 0 });
    expect(b.x - a.x).toBeCloseTo(20, 10);
  });
});

describe('camera: anchor-preserving zoom', () => {
  it('keeps the world point under the cursor fixed across a wheel zoom', () => {
    const cam = createCamera(1, 100, 400);
    const cursor = { x: 640, y: 300 };
    const anchorWorld = screenToWorld(cam, cursor);
    addWheelZoom(cam, -480, cursor); // zoom in
    // Integrate the smoothing until it settles.
    for (let i = 0; i < 240; i++) zoomTick(cam, 1 / 60);
    expect(cam.zoom).toBeGreaterThan(1);
    const nowUnderCursor = screenToWorld(cam, cursor);
    expect(nowUnderCursor.x).toBeCloseTo(anchorWorld.x, 6);
    expect(nowUnderCursor.y).toBeCloseTo(anchorWorld.y, 6);
  });

  it('clamps the log-zoom target to [ln 0.06, ln 2.5]', () => {
    const cam = createCamera(1, 0, 0);
    addWheelZoom(cam, -1e9, { x: 0, y: 0 });
    expect(cam.logZoomTarget).toBe(LOG_MAX_ZOOM);
    addWheelZoom(cam, 1e9, { x: 0, y: 0 });
    expect(cam.logZoomTarget).toBe(LOG_MIN_ZOOM);
  });

  it('reaches the target instantly in reduced-motion mode', () => {
    const cam = createCamera(1, 0, 0);
    addWheelZoom(cam, -100, { x: 10, y: 10 });
    zoomTick(cam, 1 / 60, true);
    expect(Math.log(cam.zoom)).toBeCloseTo(cam.logZoomTarget, 9);
  });

  it('zoomTick reports quiescence once converged', () => {
    const cam = createCamera(1, 0, 0);
    expect(zoomTick(cam, 1 / 60)).toBe(false);
    addWheelZoom(cam, -200, { x: 0, y: 0 });
    expect(zoomTick(cam, 1 / 60)).toBe(true);
  });

  it('lerpExp is frame-rate independent over a fixed wall time', () => {
    // 60 steps of 1/60s must land where 6 steps of 1/6s land.
    let a = 0;
    for (let i = 0; i < 60; i++) a = lerpExp(a, 1, 1 / 60, 12);
    let b = 0;
    for (let i = 0; i < 6; i++) b = lerpExp(b, 1, 1 / 6, 12);
    expect(a).toBeCloseTo(b, 9);
  });
});

describe('camera: clamp & rubber band', () => {
  it('rubberBand passes through in-bounds values untouched', () => {
    expect(rubberBand(5, 0, 10)).toBe(5);
  });

  it('rubberBand applies the overshoot factor past a bound', () => {
    expect(rubberBand(-40, 0, 10)).toBeCloseTo(-40 * RUBBER_FACTOR, 10);
    expect(rubberBand(30, 0, 10)).toBeCloseTo(10 + 20 * RUBBER_FACTOR, 10);
  });

  it('applyDragPosition rubber-bands above the world top', () => {
    const cam = createCamera(1, 0, 0);
    applyDragPosition(cam, 0, Y_MIN - 100, VP);
    expect(cam.y).toBeCloseTo(Y_MIN - 100 * RUBBER_FACTOR, 10);
    expect(isOutOfBounds(cam, VP)).toBe(true);
  });

  it('clampCamera snaps back inside and reports the change', () => {
    const cam = createCamera(1, 0, Y_MIN - 50);
    expect(clampCamera(cam, VP)).toBe(true);
    expect(cam.y).toBe(Y_MIN);
    expect(clampCamera(cam, VP)).toBe(false);
  });

  it('never clamps downward travel (endless shelf)', () => {
    const cam = createCamera(1, 0, 1e9);
    clampCamera(cam, VP);
    expect(cam.y).toBe(1e9);
  });

  it('pins x centered when the viewport out-zooms the shelf', () => {
    const b = xBounds(VP, 0.1); // visible width 12800 >> shelf 1200
    expect(b.min).toBe(b.max);
    expect(b.min).toBeCloseTo((SHELF_WIDTH - VP.width / 0.1) / 2, 10);
  });

  it('gives a slack window when zoomed in past the shelf width', () => {
    const b = xBounds(VP, 2);
    expect(b.min).toBe(-X_SLACK);
    expect(b.max).toBeCloseTo(SHELF_WIDTH + X_SLACK - VP.width / 2, 10);
    expect(b.max).toBeGreaterThan(b.min);
  });
});

describe('camera: momentum', () => {
  it('decays exponentially and dies below the kill threshold', () => {
    const cam = createCamera(1, 300, 500);
    cam.vy = 600;
    let alive = true;
    let steps = 0;
    while (alive && steps < 10_000) {
      alive = momentumTick(cam, 1 / 60, VP);
      steps++;
    }
    expect(steps).toBeLessThan(10_000);
    expect(cam.vy).toBe(0);
    expect(cam.y).toBeGreaterThan(500); // travelled downward
  });

  it('kills velocity relative to zoom (8/zoom world px/s)', () => {
    const cam = createCamera(2, 300, 500);
    cam.vy = MOMENTUM_KILL_SPEED / cam.zoom - 1e-6;
    momentumTick(cam, 1 / 60, VP);
    expect(cam.vy).toBe(0);
  });

  it('stops dead at the top bound', () => {
    const cam = createCamera(1, 300, Y_MIN + 1);
    cam.vy = -2000;
    for (let i = 0; i < 100; i++) momentumTick(cam, 1 / 60, VP);
    expect(cam.y).toBe(Y_MIN);
    expect(cam.vy).toBe(0);
  });

  it('is inert with zero velocity', () => {
    const cam = createCamera(1, 300, 500);
    expect(momentumTick(cam, 1 / 60, VP)).toBe(false);
    expect(cam.y).toBe(500);
  });
});

describe('camera: weighted velocity', () => {
  it('averages per-sample velocities with 0.4/0.3/0.2/0.1 weights', () => {
    const v = weightedVelocity([
      { dx: 10, dy: 20, dt: 0.01 }, // 1000, 2000 px/s (weight 0.4)
      { dx: 5, dy: 10, dt: 0.01 }, // 500, 1000 px/s (weight 0.3)
      { dx: 0, dy: 0, dt: 0.01 }, // 0 (weight 0.2)
      { dx: -10, dy: -20, dt: 0.01 }, // -1000, -2000 (weight 0.1)
    ]);
    expect(v.x).toBeCloseTo(1000 * 0.4 + 500 * 0.3 + 0 - 1000 * 0.1, 6);
    expect(v.y).toBeCloseTo(2000 * 0.4 + 1000 * 0.3 + 0 - 2000 * 0.1, 6);
  });

  it('handles fewer than 4 samples by renormalizing', () => {
    const v = weightedVelocity([{ dx: 10, dy: 0, dt: 0.01 }]);
    expect(v.x).toBeCloseTo(1000, 6);
  });

  it('returns zero for no samples or zero-duration samples', () => {
    expect(weightedVelocity([])).toEqual({ x: 0, y: 0 });
    expect(weightedVelocity([{ dx: 5, dy: 5, dt: 0 }])).toEqual({ x: 0, y: 0 });
  });
});

describe('virtualizer: windowing', () => {
  it('computes the visible floor range with margin', () => {
    // cam.y = 0, viewport 800 @ zoom 1, margin 160: world y ∈ [-160, 960].
    const r = computeRange(0, 800, 1);
    expect(r.first).toBe(0); // -160 clamps to 0
    expect(r.last).toBe(3); // 960 / 320 = 3
  });

  it('clamps the first floor at 0 above the shelf', () => {
    const r = computeRange(-5000, 800, 1);
    expect(r.first).toBe(0);
    expect(r.last).toBe(0);
  });

  it('spans many floors at far zoom', () => {
    const r = computeRange(0, 800, 0.06);
    expect(r.last - r.first + 1).toBeGreaterThan(40);
  });

  it('moves the window when the camera scrolls', () => {
    const r = computeRange(10 * FLOOR_H, 800, 1);
    expect(r.first).toBe(9); // margin reaches half a floor up
    expect(r.last).toBe(13);
  });

  it('diffs mount/unmount sets against a new range', () => {
    const mounted = new Set([2, 3, 4, 5]);
    const diff = diffWindow(mounted, { first: 4, last: 7 });
    expect(diff.add).toEqual([6, 7]);
    expect(diff.remove.sort((a, b) => a - b)).toEqual([2, 3]);
  });

  it('is a no-op when the range is unchanged', () => {
    const mounted = new Set([1, 2, 3]);
    const diff = diffWindow(mounted, { first: 1, last: 3 });
    expect(diff.add).toEqual([]);
    expect(diff.remove).toEqual([]);
  });

  it('pool reuses released items and destroys beyond the cap', () => {
    let made = 0;
    let destroyed = 0;
    const pool = new Pool<number>(
      () => made++,
      () => undefined,
      () => destroyed++,
      2,
    );
    const a = pool.acquire();
    const b = pool.acquire();
    const c = pool.acquire();
    expect(made).toBe(3);
    pool.release(a);
    pool.release(b);
    pool.release(c); // over cap → destroyed
    expect(destroyed).toBe(1);
    pool.acquire();
    expect(made).toBe(3); // reused, not created
    pool.drain();
    expect(destroyed).toBe(2);
  });
});

describe('camera: viewport-aware min zoom', () => {
  it('keeps the case at ≥ ~30% of the viewport width', () => {
    const z = minZoomFor(VP);
    expect(SHELF_WIDTH * z).toBeGreaterThanOrEqual(VP.width * MIN_CASE_VIEW_FRACTION - 1e-9);
    expect(z).toBeCloseTo((VP.width * MIN_CASE_VIEW_FRACTION) / SHELF_WIDTH, 10);
  });

  it('never drops below the absolute MIN_ZOOM on tiny viewports', () => {
    expect(minZoomFor({ width: 120, height: 200 })).toBe(MIN_ZOOM);
  });

  it('still dips into LOD2 territory on small windows', () => {
    // A 640px window may zoom below the 0.22 stamp threshold.
    expect(minZoomFor({ width: 640, height: 480 })).toBeLessThan(0.22);
  });

  it('addWheelZoom honors a custom min log-zoom clamp', () => {
    const cam = createCamera(1, 0, 0);
    const minLog = Math.log(minZoomFor(VP));
    addWheelZoom(cam, 1e9, { x: 0, y: 0 }, undefined, minLog);
    expect(cam.logZoomTarget).toBeCloseTo(minLog, 12);
  });

  it('clampZoomBounds lifts a stale under-min zoom (resize/session restore)', () => {
    const cam = createCamera(0.06, 0, 0);
    cam.logZoomTarget = Math.log(0.06);
    expect(clampZoomBounds(cam, VP)).toBe(true);
    expect(cam.zoom).toBeCloseTo(minZoomFor(VP), 12);
    expect(cam.logZoomTarget).toBeCloseTo(Math.log(minZoomFor(VP)), 12);
    expect(clampZoomBounds(cam, VP)).toBe(false);
  });
});

describe('layout: seeded cluster layout', () => {
  const mkItems = (widths: readonly number[]): LayoutBookIn[] =>
    widths.map((w, i) => ({ slot: i, w }));

  it('books stay clear of the rails', () => {
    expect(LAYOUT_MARGIN_X).toBeGreaterThan(RAIL_W);
    // Legacy raw-slot fallback (spineScreenRect for unmounted floors) also
    // clears the rails.
    expect(SLOT_MARGIN_X).toBeGreaterThan(RAIL_W);
    for (let floor = 0; floor < 24; floor++) {
      const items = mkItems([34, 40, 28, 46, 30, 38, 36, 33, 44]);
      for (const [i, p] of layoutFloor(items, floor).entries()) {
        const item = items[i] as LayoutBookIn;
        expect(p.centerX - item.w / 2).toBeGreaterThanOrEqual(LAYOUT_MARGIN_X - 1e-6);
        expect(p.centerX + item.w / 2).toBeLessThanOrEqual(SHELF_WIDTH - LAYOUT_MARGIN_X + 1e-6);
      }
    }
  });

  it('is deterministic per (floor, items) and varies across floors', () => {
    const items = mkItems([34, 40, 28, 46, 30, 38]);
    const a = layoutFloor(items, 3);
    const b = layoutFloor(items, 3);
    expect(a).toEqual(b);
    const c = layoutFloor(items, 4);
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });

  it('preserves order and never overlaps book bodies', () => {
    for (let floor = 0; floor < 40; floor++) {
      const widths = Array.from({ length: 3 + (floor % 9) }, (_, i) => 28 + ((i * 7 + floor * 3) % 18));
      const items = mkItems(widths);
      const placed = layoutFloor(items, floor);
      for (let i = 1; i < placed.length; i++) {
        const prev = placed[i - 1];
        const cur = placed[i];
        const prevW = (items[i - 1] as LayoutBookIn).w;
        const curW = (items[i] as LayoutBookIn).w;
        expect(cur!.centerX).toBeGreaterThan(prev!.centerX);
        expect(cur!.centerX - prev!.centerX).toBeGreaterThanOrEqual((prevW + curW) / 2 + 0.99);
      }
    }
  });

  it('packs a populated floor and centres it (no islands, no dead side)', () => {
    // This used to assert the row SPANS at least 45% of the case. That was the
    // old aesthetic — spare width was poured into the gaps — and it is exactly
    // what made a lightly-filled floor read as islands of books floating apart.
    // Books now pack together and the surplus goes to the two ends.
    for (let floor = 0; floor < 12; floor++) {
      const items = mkItems([34, 40, 28, 46, 30, 38, 36, 33]);
      const placed = layoutFloor(items, floor);
      const first = placed[0];
      const last = placed[placed.length - 1];

      // Still centred: the concern the old assertion was really protecting.
      const mid = (first!.centerX + last!.centerX) / 2;
      expect(Math.abs(mid - SHELF_WIDTH / 2)).toBeLessThanOrEqual(SHELF_WIDTH * 0.2);

      // And packed: no two neighbours sit further apart than one capped gap.
      // Widths come from the INPUT items — LayoutBookOut carries only the
      // placement, not the geometry.
      for (let i = 1; i < placed.length; i++) {
        const a = placed[i - 1]!;
        const b = placed[i]!;
        const aw = items[i - 1]!.w;
        const bw = items[i]!.w;
        const edgeGap = b.centerX - bw / 2 - (a.centerX + aw / 2);
        expect(edgeGap).toBeLessThanOrEqual(40);
        expect(edgeGap).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('leans at most MAX_LEANERS books, within the lean magnitude bound', () => {
    for (let floor = 0; floor < 60; floor++) {
      const items = mkItems([34, 40, 28, 46, 30, 38, 36]);
      const placed = layoutFloor(items, floor);
      const leaners = placed.filter((p) => p.leanDeg !== 0);
      expect(leaners.length).toBeLessThanOrEqual(MAX_LEANERS);
      for (const p of placed) {
        expect(Math.abs(p.leanDeg)).toBeLessThanOrEqual(LEAN_MAX_DEG);
      }
    }
  });

  it('handles empty and single-book floors', () => {
    expect(layoutFloor([], 0)).toEqual([]);
    const one = layoutFloor([{ slot: 0, w: 40 }], 7);
    expect(one).toHaveLength(1);
    expect(one[0]!.centerX).toBeGreaterThanOrEqual(LAYOUT_MARGIN_X + 20);
    expect(one[0]!.centerX).toBeLessThanOrEqual(SHELF_WIDTH - LAYOUT_MARGIN_X - 20);
  });
});

describe('gestures: wheel decision matrix', () => {
  const wheel = (over: Partial<WheelLike>): WheelLike => ({
    deltaX: 0,
    deltaY: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...over,
  });

  it('plain wheel zooms to the cursor (primary expectation)', () => {
    const a = classifyWheel(wheel({ deltaY: 120 }));
    expect(a).toEqual({ kind: 'zoom', deltaY: 120, sensitivity: WHEEL_ZOOM_SENSITIVITY });
    const b = classifyWheel(wheel({ deltaY: -120 }));
    expect(b.kind).toBe('zoom');
  });

  it('ctrl+wheel (mouse notch) zooms at wheel sensitivity', () => {
    const a = classifyWheel(wheel({ deltaY: 120, ctrlKey: true }));
    expect(a).toEqual({ kind: 'zoom', deltaY: 120, sensitivity: WHEEL_ZOOM_SENSITIVITY });
  });

  it('touchpad pinch (ctrlKey wheel with small deltas) zooms at pinch sensitivity', () => {
    const a = classifyWheel(wheel({ deltaY: -6.4, ctrlKey: true }));
    expect(a).toEqual({ kind: 'zoom', deltaY: -6.4, sensitivity: PINCH_ZOOM_SENSITIVITY });
    // Boundary: exactly PINCH_DELTA_MAX is a mouse notch, not a pinch.
    const b = classifyWheel(wheel({ deltaY: PINCH_DELTA_MAX, ctrlKey: true }));
    expect(b).toMatchObject({ kind: 'zoom', sensitivity: WHEEL_ZOOM_SENSITIVITY });
  });

  it('meta+wheel zooms too (mac muscle memory in the webview)', () => {
    expect(classifyWheel(wheel({ deltaY: 120, metaKey: true })).kind).toBe('zoom');
  });

  it('shift+wheel pans vertically', () => {
    expect(classifyWheel(wheel({ deltaY: 90, shiftKey: true }))).toEqual({
      kind: 'pan',
      dx: 0,
      dy: 90,
    });
  });

  it('shift+wheel with browser-preswapped deltas still pans vertically', () => {
    // Chromium can report shift+wheel as deltaX with deltaY 0.
    expect(classifyWheel(wheel({ deltaX: 90, shiftKey: true }))).toEqual({
      kind: 'pan',
      dx: 0,
      dy: 90,
    });
  });

  it('sideways-dominant deltas (touchpad) pan horizontally', () => {
    expect(classifyWheel(wheel({ deltaX: 80, deltaY: 10 }))).toEqual({
      kind: 'pan',
      dx: 80,
      dy: 0,
    });
  });

  it('vertical-dominant mixed deltas still zoom', () => {
    expect(classifyWheel(wheel({ deltaX: 10, deltaY: 80 })).kind).toBe('zoom');
  });

  // settings.wheelMode = 'scroll' — the plain spin and shift+spin swap roles.
  it("scroll mode: a plain wheel pans the floors", () => {
    expect(classifyWheel(wheel({ deltaY: 120 }), 'scroll')).toEqual({
      kind: 'pan',
      dx: 0,
      dy: 120,
    });
  });

  it('scroll mode: shift+wheel zooms instead', () => {
    expect(classifyWheel(wheel({ deltaY: 120, shiftKey: true }), 'scroll')).toEqual({
      kind: 'zoom',
      deltaY: 120,
      sensitivity: WHEEL_ZOOM_SENSITIVITY,
    });
  });

  it('scroll mode: ctrl/pinch still zooms and sideways still pans sideways', () => {
    expect(classifyWheel(wheel({ deltaY: -6.4, ctrlKey: true }), 'scroll')).toEqual({
      kind: 'zoom',
      deltaY: -6.4,
      sensitivity: PINCH_ZOOM_SENSITIVITY,
    });
    expect(classifyWheel(wheel({ deltaX: 80, deltaY: 10 }), 'scroll')).toEqual({
      kind: 'pan',
      dx: 80,
      dy: 0,
    });
  });

  it("zoom mode is the default when no mode is passed", () => {
    expect(classifyWheel(wheel({ deltaY: 120 }))).toEqual(
      classifyWheel(wheel({ deltaY: 120 }), 'zoom'),
    );
  });
});

describe('gestures: drag decision matrix', () => {
  it('uses a wider threshold on a spine than on the shelf', () => {
    expect(dragThresholdFor(true)).toBe(BOOK_DRAG_DIST_PX);
    expect(dragThresholdFor(false)).toBe(SHELF_DRAG_DIST_PX);
    expect(BOOK_DRAG_DIST_PX).toBe(8);
    expect(BOOK_DRAG_DIST_PX).toBeGreaterThan(SHELF_DRAG_DIST_PX);
  });

  it('dragging a spine downward (toward the viewer) pulls', () => {
    expect(classifyDrag(true, 0, 10)).toBe('pull');
    expect(classifyDrag(true, 3, 30)).toBe('pull');
  });

  it('dragging a spine sideways/outward pulls', () => {
    expect(classifyDrag(true, 12, -4)).toBe('pull');
    expect(classifyDrag(true, -15, -9)).toBe('pull');
    expect(classifyDrag(true, 9, 0)).toBe('pull');
  });

  it('pushing a spine firmly upward pans (scroll-the-shelf gesture)', () => {
    expect(classifyDrag(true, 0, -12)).toBe('pan');
    expect(classifyDrag(true, 4, -20)).toBe('pan');
  });

  it('any drag starting on the wall/shelf pans', () => {
    expect(classifyDrag(false, 0, 40)).toBe('pan');
    expect(classifyDrag(false, 40, 0)).toBe('pan');
    expect(classifyDrag(false, -12, -12)).toBe('pan');
  });

  it('the auto-complete travel is comfortably past the pull threshold', () => {
    expect(PULL_COMPLETE_TRAVEL_PX).toBeGreaterThan(BOOK_DRAG_DIST_PX * 5);
  });
});

describe('gestures: keyboard zoom', () => {
  it('maps +/= to zoom in, -/_ to zoom out, 0 to reset', () => {
    expect(classifyKeyZoom({ key: '+' })).toBe('in');
    expect(classifyKeyZoom({ key: '=' })).toBe('in');
    expect(classifyKeyZoom({ key: '-' })).toBe('out');
    expect(classifyKeyZoom({ key: '_' })).toBe('out');
    expect(classifyKeyZoom({ key: '0' })).toBe('reset');
  });

  it('ignores unrelated keys', () => {
    expect(classifyKeyZoom({ key: 'a' })).toBeNull();
    expect(classifyKeyZoom({ key: '1' })).toBeNull();
    expect(classifyKeyZoom({ key: 'Enter' })).toBeNull();
  });

  it('ignores alt combos and keystrokes while editing text', () => {
    expect(classifyKeyZoom({ key: '+', altKey: true })).toBeNull();
    expect(classifyKeyZoom({ key: '0', editing: true })).toBeNull();
  });
});

/* ------------------------- wave-2 shelf & library life ------------------- */

function fakeBook(over: Partial<Book>): Book {
  return {
    id: 'b',
    title: 'T',
    floor: 0,
    slot: 0,
    spineSeed: 1,
    coverMeta: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('shelf meta: cover_meta.shelf section', () => {
  it('reads a valid section and drops junk fields', () => {
    const meta = readShelfMeta(
      fakeBook({
        coverMeta: {
          shelf: {
            pinned: true,
            lastOpenedAt: '2026-02-01T10:00:00.000Z',
            pageCount: 7.6,
            prevFloor: 2.2,
            prevSlot: -3,
            bogus: 'nope',
          },
        },
      }),
    );
    expect(meta).toEqual({
      pinned: true,
      lastOpenedAt: '2026-02-01T10:00:00.000Z',
      pageCount: 8,
      prevFloor: 2,
      prevSlot: 0,
    });
  });

  it('returns null for missing/invalid sections', () => {
    expect(readShelfMeta(fakeBook({}))).toBeNull();
    expect(readShelfMeta(fakeBook({ coverMeta: { shelf: 'x' } }))).toBeNull();
    expect(readShelfMeta(fakeBook({ coverMeta: { shelf: {} } }))).toBeNull();
    expect(readShelfMeta(null)).toBeNull();
  });

  it('mergeCoverMetaSection supports the shelf key alongside others', () => {
    const merged = mergeCoverMetaSection(
      { cover: { palette: 'amber' } },
      'shelf',
      { pinned: true },
    );
    expect(merged).toEqual({ cover: { palette: 'amber' }, shelf: { pinned: true } });
    // Clearing the section leaves the rest intact.
    expect(mergeCoverMetaSection(merged, 'shelf', null)).toEqual({
      cover: { palette: 'amber' },
    });
  });
});

describe('auto spine thickness', () => {
  it('is 1 for unknown page counts', () => {
    expect(thicknessScale(null)).toBe(1);
    expect(thicknessScale(undefined)).toBe(1);
    expect(thicknessScale(Number.NaN)).toBe(1);
  });

  it('grows with page count, clamped to [0.85, 1.45]', () => {
    expect(thicknessScale(0)).toBeCloseTo(0.85, 10);
    expect(thicknessScale(4)).toBeCloseTo(0.95, 10);
    expect(thicknessScale(25)).toBeCloseTo(1.1, 10);
    expect(thicknessScale(10_000)).toBe(1.45);
    expect(thicknessScale(9)).toBeGreaterThan(thicknessScale(4));
  });
});

describe('shelf sort orders (orderBooks)', () => {
  const a = fakeBook({ id: 'a', slot: 0 });
  const b = fakeBook({
    id: 'b',
    slot: 1,
    coverMeta: { shelf: { lastOpenedAt: '2026-03-01T00:00:00.000Z' } },
  });
  const c = fakeBook({
    id: 'c',
    slot: 2,
    coverMeta: { shelf: { pinned: true, lastOpenedAt: '2026-02-01T00:00:00.000Z' } },
  });

  it('manual keeps slot order', () => {
    expect(orderBooks([c, a, b], 'manual').map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('favorites puts pinned books first', () => {
    expect(orderBooks([a, b, c], 'favorites').map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });

  it('recent puts the newest-opened first, never-opened last by slot', () => {
    expect(orderBooks([a, b, c], 'recent').map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate the input array', () => {
    const input = [c, a, b];
    orderBooks(input, 'favorites');
    expect(input.map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('floor plaque names', () => {
  it('parses a valid blob, trimming and capping labels', () => {
    const map = parseFloorNames({
      '0': '  Sciences  ',
      '3': 'x'.repeat(80),
      '-1': 'trash',
      '2': 7,
      abc: 'nope',
      '5': '   ',
    });
    expect(map.get(0)).toBe('Sciences');
    expect(map.get(3)).toHaveLength(40);
    expect(map.has(-1)).toBe(false);
    expect(map.has(2)).toBe(false);
    expect(map.has(5)).toBe(false);
  });

  it('degrades corrupt blobs to an empty map', () => {
    expect(parseFloorNames(null).size).toBe(0);
    expect(parseFloorNames('junk').size).toBe(0);
    expect(parseFloorNames([1, 2]).size).toBe(0);
  });
});

describe('trash drawer flow (in-memory db)', () => {
  it('soft-deletes to floor -1, restores to the old spot, empties for real', async () => {
    const book = await createBook({ title: 'Doomed Diary', floor: 2, slot: 5 });
    await createPage({ bookId: book.id });

    // Trash: off the shelf, into the drawer, with restore bookkeeping.
    await trashBook(book.id);
    const trashed = await getBook(book.id);
    expect(trashed?.floor).toBe(TRASH_FLOOR);
    const meta = readShelfMeta(trashed);
    expect(meta?.prevFloor).toBe(2);
    expect(meta?.prevSlot).toBe(5);
    expect(typeof meta?.deletedAt).toBe('string');
    // The shelf query (floors >= 0) no longer sees it.
    const onShelf = await listBooksByFloorRange(0, 10);
    expect(onShelf.some((b) => b.id === book.id)).toBe(false);
    const drawer = await listTrashedBooks();
    expect(drawer.map((b) => b.id)).toContain(book.id);

    // Restore: back to floor 2 slot 5, bookkeeping cleared.
    await restoreBook(book.id);
    const restored = await getBook(book.id);
    expect(restored?.floor).toBe(2);
    expect(restored?.slot).toBe(5);
    expect(readShelfMeta(restored)?.deletedAt).toBeUndefined();

    // Empty: permanent delete removes book AND pages.
    await trashBook(book.id);
    const removed = await emptyTrash();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await getBook(book.id)).toBeNull();
    expect(await listPages(book.id)).toEqual([]);
  });

  it('trashing twice is a no-op and restore lands on a free slot', async () => {
    const one = await createBook({ title: 'One', floor: 4, slot: 1 });
    await trashBook(one.id);
    const before = readShelfMeta(await getBook(one.id));
    await trashBook(one.id); // no-op: prevFloor must not become -1
    expect(readShelfMeta(await getBook(one.id))?.prevFloor).toBe(before?.prevFloor);
    // Occupy the old slot; restore must land on the next free one.
    await createBook({ title: 'Squatter', floor: 4, slot: 1 });
    await restoreBook(one.id);
    const back = await getBook(one.id);
    expect(back?.floor).toBe(4);
    expect(back?.slot).toBe(2);
  });
});

describe('shelf-life book ops (in-memory db)', () => {
  it('pin, touch-opened, and page-count meta round-trip', async () => {
    const book = await createBook({ title: 'Ops', floor: 0, slot: 8 });
    await setBookPinned(book.id, true);
    expect(readShelfMeta(await getBook(book.id))?.pinned).toBe(true);
    await setBookPinned(book.id, false);
    expect(readShelfMeta(await getBook(book.id))?.pinned).toBe(false);

    await touchBookOpened(book.id);
    const opened = readShelfMeta(await getBook(book.id))?.lastOpenedAt;
    expect(typeof opened).toBe('string');

    await createPage({ bookId: book.id });
    await createPage({ bookId: book.id });
    await updateBookPageCount(book.id);
    expect(readShelfMeta(await getBook(book.id))?.pageCount).toBe(2);
  });

  it('duplicate copies pages and lands on the next free slot', async () => {
    const src = await createBook({ title: 'Original', floor: 6, slot: 3 });
    await createPage({ bookId: src.id });
    await createPage({ bookId: src.id });
    await createBook({ title: 'Neighbor', floor: 6, slot: 4 });
    const copy = await duplicateBook(src.id);
    expect(copy).not.toBeNull();
    expect(copy?.title).toBe('Original copy');
    expect(copy?.floor).toBe(6);
    expect(copy?.slot).toBe(5); // 3 and 4 taken
    expect(await listPages(copy!.id)).toHaveLength(2);
  });

  it('rename + nextFreeSlot + maxOccupiedFloor behave', async () => {
    const book = await createBook({ title: 'Old name', floor: 9, slot: 0 });
    await renameBook(book.id, 'New name');
    expect((await getBook(book.id))?.title).toBe('New name');
    expect(await nextFreeSlot(9, 0)).toBe(1);
    expect(await maxOccupiedFloor()).toBeGreaterThanOrEqual(9);
  });
});

describe('lod: tier hysteresis', () => {
  it('picks raw tiers without hysteresis for initial mount', () => {
    expect(lodTierFor(1)).toBe(0);
    expect(lodTierFor(0.5)).toBe(1);
    expect(lodTierFor(0.1)).toBe(2);
  });

  it('does not flicker inside the hysteresis band', () => {
    // Sitting exactly on the 0/1 boundary: neither direction switches.
    expect(nextLodTier(0, LOD_T01 - LOD_HYSTERESIS / 2)).toBe(0);
    expect(nextLodTier(1, LOD_T01 + LOD_HYSTERESIS / 2)).toBe(1);
    // And on the 1/2 boundary.
    expect(nextLodTier(1, LOD_T12 - LOD_HYSTERESIS / 2)).toBe(1);
    expect(nextLodTier(2, LOD_T12 + LOD_HYSTERESIS / 2)).toBe(2);
  });

  it('switches after crossing a boundary by the hysteresis margin', () => {
    expect(nextLodTier(0, LOD_T01 - LOD_HYSTERESIS - 0.001)).toBe(1);
    expect(nextLodTier(1, LOD_T01 + LOD_HYSTERESIS + 0.001)).toBe(0);
    expect(nextLodTier(1, LOD_T12 - LOD_HYSTERESIS - 0.001)).toBe(2);
    expect(nextLodTier(2, LOD_T12 + LOD_HYSTERESIS + 0.001)).toBe(1);
  });

  it('resolves multi-step jumps in one call', () => {
    expect(nextLodTier(2, 1.2)).toBe(0);
    expect(nextLodTier(0, 0.06)).toBe(2);
  });

  it('is stable at the extremes', () => {
    expect(nextLodTier(0, 2.5)).toBe(0);
    expect(nextLodTier(2, 0.06)).toBe(2);
  });
});

/* ==========================================================================
   Library themes + Book Studio wiring (docs/design/library-themes.md)
   ========================================================================== */

describe('library prefs: validated merge', () => {
  it('falls back to the default room for garbage', () => {
    expect(mergeLibraryPrefs(null)).toEqual(DEFAULT_LIBRARY_PREFS);
    expect(mergeLibraryPrefs('nope')).toEqual(DEFAULT_LIBRARY_PREFS);
    expect(mergeLibraryPrefs([1, 2, 3])).toEqual(DEFAULT_LIBRARY_PREFS);
    expect(mergeLibraryPrefs({ theme: 'atlantis' }).theme).toBe(
      DEFAULT_LIBRARY_PREFS.theme,
    );
  });

  it('keeps a valid room id', () => {
    expect(mergeLibraryPrefs({ theme: 'reef' }).theme).toBe('reef');
  });

  it('drops every retired control rather than carrying it forward', () => {
    // The wall accumulated four pickers over three passes — colourway,
    // backdrop, wallpaperPattern, wallDepth — plus floraDensity and
    // lightWarmth for dressing that is no longer drawn. All of them were
    // inert by the time the case went flat, and a blob written while they
    // existed has to load without reviving any of them.
    const prefs = mergeLibraryPrefs({
      theme: 'reef',
      colourway: 'midnight',
      backdrop: 'shoji',
      wallpaperPattern: 'constellation',
      wallDepth: 0.8,
      floraDensity: 2,
      lightWarmth: 0.9,
    });
    expect(prefs).toEqual({
      theme: 'reef',
      shelf: null,
      wall: null,
      timberHex: null,
      wallHex: null,
    });
  });

  it("keeps a colour of the reader's own, and refuses anything it cannot re-serialise", () => {
    // The two hexes are the door out of the sixty rooms (see LibraryPrefs).
    // Generous on the way in — any spelling of a hex — and null for anything
    // else, because null is already the value that means "follow the room".
    const own = mergeLibraryPrefs({ theme: 'reef', timberHex: '#A1B2C3', wallHex: 'fed' });
    expect(own.timberHex).toBe('#a1b2c3');
    expect(own.wallHex).toBe('#ffeedd');

    const junk = mergeLibraryPrefs({ theme: 'reef', timberHex: 'rebeccapurple', wallHex: 12 });
    expect(junk.timberHex).toBeNull();
    expect(junk.wallHex).toBeNull();
  });

  it('keeps a per-part pick, and drops one naming a retired room', () => {
    const mixed = mergeLibraryPrefs({ theme: 'reef', shelf: 'apothecary', wall: 'blossom' });
    expect(mixed.shelf).toBe('apothecary');
    expect(mixed.wall).toBe('blossom');
    // A part naming one of the ten retired rooms falls back to following the
    // preset rather than resolving to the default room, which would silently
    // repaint that one part.
    expect(mergeLibraryPrefs({ theme: 'reef', shelf: 'sakura' }).shelf).toBeNull();
  });

  it('composes the drawn scheme from two rooms', () => {
    const apothecary = getTheme('apothecary');
    const blossom = getTheme('blossom');
    const { scheme } = resolveLibrary(
      mergeLibraryPrefs({ theme: 'reef', shelf: 'apothecary', wall: 'blossom' }),
    );
    // Shelf fields from one room, wall from another, and the preset supplies
    // neither — it is only the default each part falls back to.
    expect(scheme.timber).toBe(apothecary.scheme.timber);
    expect(scheme.timberDark).toBe(apothecary.scheme.timberDark);
    expect(scheme.recess).toBe(apothecary.scheme.recess);
    expect(scheme.wall).toBe(blossom.scheme.wall);
  });

  it('gives a mixed room its own bake key', () => {
    const plain = resolveLibrary(mergeLibraryPrefs({ theme: 'reef' })).key;
    const mixed = resolveLibrary(
      mergeLibraryPrefs({ theme: 'reef', shelf: 'apothecary' }),
    ).key;
    // Or a case baked with reef timber would be served to a room wearing
    // apothecary's, for the rest of the session, off the bake cache.
    expect(mixed).not.toBe(plain);
    // Naming the preset explicitly is the same room, not a third key.
    expect(resolveLibrary(mergeLibraryPrefs({ theme: 'reef', shelf: 'reef' })).key).toBe(plain);
  });

  it('opens a library saved in a retired room in the default one', () => {
    // Ten of the fourteen rooms went with the carpentry data they described.
    expect(mergeLibraryPrefs({ theme: 'sakura' }).theme).toBe(DEFAULT_LIBRARY_PREFS.theme);
  });

  it('keys a room by its colour scheme, not just its id', () => {
    const a = resolveLibrary(mergeLibraryPrefs({ theme: 'blossom' }));
    expect(a.key).toBe(resolveLibrary(mergeLibraryPrefs({ theme: 'blossom' })).key);
    // Different scheme ⇒ different case art ⇒ the bake cache must miss.
    expect(a.key).not.toBe(resolveLibrary(mergeLibraryPrefs({ theme: 'reef' })).key);
    // Every colour that reaches the case is in the key, so editing one hex
    // cannot serve stale art out of the bake cache.
    for (const colour of Object.values(getTheme('blossom').scheme).flat(2)) {
      expect(a.key).toContain(colour as string);
    }
  });
});

/*
 * `warmthTint` had a suite here, and flora planning another (anchor
 * composition, density monotonicity, title keep-outs). Both went with the
 * painting era: there are no lamp pools left to tint, so the `lightWarmth`
 * pref and its studio slider are gone, and nothing grows on the case.
 */

describe('book studio: overrides win in every room', () => {
  const overrides = {
    material: 'silk' as const,
    pigment: 4,
    raisedBands: 5,
    charm: 'wax-seal' as const,
    edge: 'marbled' as const,
    wear: 0.7,
  };

  it('keeps a customized book identical across themes', () => {
    const a = resolveBookStyle(0xabcdef, themeSpineDefaults(getTheme('athenaeum')), overrides);
    const b = resolveBookStyle(0xabcdef, themeSpineDefaults(getTheme('reef')), overrides);
    expect(b.style.material).toBe('silk');
    expect(b.style.pigment).toBe(4);
    expect(b.style.raisedBands).toBe(5);
    expect(b.style.charm).toBe('wax-seal');
    expect(b.style.edge).toBe('marbled');
    expect(a.style.pigment).toBe(b.style.pigment);
  });

  it('lets the room bias an un-overridden book', () => {
    const seeds = [1, 7, 99, 4242, 31337];
    const pigments = (id: 'athenaeum' | 'reef'): number[] =>
      seeds.map(
        (s) => resolveBookStyle(s, themeSpineDefaults(getTheme(id))).style.pigment,
      );
    expect(pigments('athenaeum')).not.toEqual(pigments('reef'));
  });

  it('projects a style onto cover overrides consistently', () => {
    const { style, cover } = resolveBookStyle(
      0x1234,
      themeSpineDefaults(getTheme('apothecary')),
      overrides,
    );
    const projected = coverOverridesFromStyle(style);
    expect(projected.palette).toBe(style.pigment);
    expect(projected.charm).toBe(style.charm);
    expect(projected.edge).toBe(style.edge);
    expect(cover.palette).toBe(projected.palette);
    expect(cover.frame).toBe(projected.frame);
  });
});

describe('cover_meta.style section', () => {
  it('round-trips alongside the other cover_meta sections', () => {
    const withShelf = mergeCoverMetaSection(null, 'shelf', { pinned: true });
    const withStyle = mergeCoverMetaSection(withShelf, 'style', { pigment: 3 });
    expect(readBookStyleOverrides({ coverMeta: withStyle })).toEqual({ pigment: 3 });
    expect(readShelfMeta({ coverMeta: withStyle })).toEqual({ pinned: true });
    const cleared = mergeCoverMetaSection(withStyle, 'style', null);
    expect(readBookStyleOverrides({ coverMeta: cleared })).toBeNull();
    expect(readShelfMeta({ coverMeta: cleared })).toEqual({ pinned: true });
  });

  it('reads null for garbage', () => {
    expect(readBookStyleOverrides(null)).toBeNull();
    expect(readBookStyleOverrides({ coverMeta: { style: 'nope' } })).toBeNull();
    expect(readBookStyleOverrides({ coverMeta: { style: [1] } })).toBeNull();
  });
});

describe('spine art height', () => {
  it('uses the studio height when present', () => {
    const { spine } = resolveBookStyle(0x99, getTheme('athenaeum'), { height: 286 });
    expect(spineArtHeight(spine)).toBeCloseTo(286, 0);
  });

  it('falls back to the classic base height for pre-studio params', () => {
    const legacy = { ...deriveSpineParams(0x99), height: undefined };
    expect(spineArtHeight(legacy)).toBeCloseTo(SPINE_BASE_HEIGHT + legacy.hJitter, 5);
  });
});

describe('theme spine bias adapter', () => {
  it('maps a room cloth ramp onto real pigment indices', () => {
    for (const id of THEME_IDS) {
      const d = themeSpineDefaults(getTheme(id));
      // A theme's pigment ramp IS its cloth palette now — one entry per cloth.
      expect(d.pigments?.length).toBe(getTheme(id).scheme.cloths.length);
      for (const p of d.pigments ?? []) {
        expect(Number.isInteger(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(0);
        // The deep range (12–19) is a legal map target: oxblood, forest and
        // ink-blue ramps SHOULD land there, not collapse onto the heritage 12.
        expect(p).toBeLessThan(PIGMENT_COUNT);
      }
    }
  });

  it('turns the shared band dial into a cord range', () => {
    // Banding is dressing, not colour, so every room now shares one dial —
    // what still has to hold is that the dial becomes a RANGE, because a
    // constant would stamp the same binding on every book in the room.
    const range = themeSpineDefaults(getTheme('athenaeum')).raisedBands as
      | readonly number[]
      | undefined;
    expect(Array.isArray(range)).toBe(true);
    expect((range as readonly number[])[1]).toBeGreaterThan(
      (range as readonly number[])[0] as number,
    );
  });
});

describe('themed env keys', () => {
  it('keys a room by its scheme, and agrees with the prefs store', () => {
    const theme = getTheme('apothecary');
    const base = libraryKey(theme);
    expect(base).toBe(libraryKey({ ...theme }));
    expect(base).not.toBe(libraryKey(getTheme('blossom')));
    // A recoloured room is a different room as far as the bake cache is
    // concerned, even under the same id.
    const restained = {
      ...theme,
      scheme: { ...theme.scheme, timber: '#123456' },
    };
    expect(libraryKey(restained)).not.toBe(base);
    // The prefs store agrees with the texture cache on an UNMIXED room — its
    // key is the preset's key plus the three parts, all of which follow it.
    expect(resolveLibrary(mergeLibraryPrefs({ theme: 'apothecary' })).key).toContain(base);
  });
});

/*
 * `underPlankShadowSlices` had a suite here — the cut plan that kept the baked
 * under-plank ambient-occlusion strip's corner pools from smearing into the
 * "shadowy transparent corner boxes" the user reported. A blurred AO falloff is
 * a light model, so the strip went with the lighting pass, and the three-sprite
 * rig in `floorView.ts` and the pure cut function in `constants.ts` went with
 * it. There is nothing left to cut.
 */

/*
 * `artRoutes.routeFor` had a suite here, covering the cache keys the worker
 * could reproduce a case part from. Every one of those recipes was the painting
 * stack; the flat case is drawn inline (cheaper than posting a job) and the
 * router now has no routes to test.
 */

