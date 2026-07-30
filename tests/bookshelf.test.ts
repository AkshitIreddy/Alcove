/**
 * tests/bookshelf.test.ts — pure-logic tests for the bookshelf world:
 * camera math (screen↔world, anchor-preserving zoom, clamp/rubber-band,
 * momentum), virtualizer windowing diff, and LOD tier hysteresis.
 * Node environment — no Pixi/DOM imports.
 */

import { describe, expect, it } from 'vitest';
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

  it('spreads a populated floor across the shelf (no left-cluster dead space)', () => {
    for (let floor = 0; floor < 12; floor++) {
      const items = mkItems([34, 40, 28, 46, 30, 38, 36, 33]);
      const placed = layoutFloor(items, floor);
      const first = placed[0];
      const last = placed[placed.length - 1];
      const span = last!.centerX - first!.centerX;
      expect(span).toBeGreaterThanOrEqual(SHELF_WIDTH * 0.45);
      // The row's midpoint sits reasonably near the case center.
      const mid = (first!.centerX + last!.centerX) / 2;
      expect(Math.abs(mid - SHELF_WIDTH / 2)).toBeLessThanOrEqual(SHELF_WIDTH * 0.2);
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
