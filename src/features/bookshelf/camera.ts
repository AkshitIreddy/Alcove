/**
 * features/bookshelf/camera.ts — the shelf camera model.
 *
 * Pure math, no Pixi/GSAP imports: everything here is unit-testable in node.
 * Zoom lives in log space for a uniform feel; wheel zoom preserves the world
 * point under the cursor (anchor); panning has weighted-velocity momentum
 * with exponential decay; bounds are hard-clamped normally and rubber-banded
 * (0.25 overshoot factor) while dragging. All motion is integrated by
 * `zoomTick`/`momentumTick` called from the render loop.
 */

import { clamp } from '../../art/noise';
import { SHELF_WIDTH, X_SLACK, Y_MIN } from './constants';

export const MIN_ZOOM = 0.06;
export const MAX_ZOOM = 2.5;
export const LOG_MIN_ZOOM = Math.log(MIN_ZOOM);
export const LOG_MAX_ZOOM = Math.log(MAX_ZOOM);

/**
 * Zoom-out floor as a fraction of the viewport width: the case never shrinks
 * below ~30% of the screen, so min zoom is a sliver-proof bookcase tower
 * rather than a 7%-wide strip. On small windows this still dips into LOD2
 * territory (zoom < 0.22); on wide desktop viewports LOD1 covers min zoom.
 */
export const MIN_CASE_VIEW_FRACTION = 0.3;

/** Viewport-aware minimum zoom (≥ the absolute MIN_ZOOM, capped at 0.6). */
export function minZoomFor(vp: Viewport): number {
  return clamp((vp.width * MIN_CASE_VIEW_FRACTION) / SHELF_WIDTH, MIN_ZOOM, 0.6);
}

/** Wheel deltaY → log-zoom delta. */
export const WHEEL_SENSITIVITY = 0.0015;

/** Exponential smoothing constant for zoom convergence. */
export const ZOOM_SMOOTH_K = 12;

/** Momentum decay constant: v *= exp(-K*dt). */
export const MOMENTUM_DECAY_K = 3.5;

/** Momentum kill threshold in *screen* px/s (world threshold = this / zoom). */
export const MOMENTUM_KILL_SPEED = 8;

/** Rubber-band overshoot factor while dragging past a bound. */
export const RUBBER_FACTOR = 0.25;

/** Log-zoom convergence epsilon. */
export const ZOOM_EPSILON = 1e-3;

export interface Vec2 {
  x: number;
  y: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Captured when a wheel-zoom gesture starts; keeps that world point fixed. */
export interface ZoomAnchor {
  screen: Vec2;
  world: Vec2;
}

export interface CameraState {
  /** World coords of the viewport's top-left corner. */
  x: number;
  y: number;
  zoom: number;
  /** Where the smoothed zoom is heading, in ln(zoom) space. */
  logZoomTarget: number;
  /** Momentum velocity in world px/s. */
  vx: number;
  vy: number;
  /** Active wheel-zoom anchor, or null outside a zoom gesture. */
  anchor: ZoomAnchor | null;
}

export function createCamera(zoom = 1, x = 0, y = Y_MIN): CameraState {
  const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  return { x, y, zoom: z, logZoomTarget: Math.log(z), vx: 0, vy: 0, anchor: null };
}

/** Frame-rate independent exponential approach of a → b. */
export function lerpExp(a: number, b: number, dt: number, k: number): number {
  return b + (a - b) * Math.exp(-k * dt);
}

/** screen = (world - cam) * zoom */
export function worldToScreen(cam: CameraState, world: Vec2): Vec2 {
  return { x: (world.x - cam.x) * cam.zoom, y: (world.y - cam.y) * cam.zoom };
}

/** world = screen / zoom + cam */
export function screenToWorld(cam: CameraState, screen: Vec2): Vec2 {
  return { x: screen.x / cam.zoom + cam.x, y: screen.y / cam.zoom + cam.y };
}

/**
 * Start (or re-target) the zoom anchor at `cursor`. The anchor world point is
 * captured once per gesture; a cursor move of more than 1px re-captures.
 */
export function beginZoomAnchor(cam: CameraState, cursor: Vec2): void {
  const a = cam.anchor;
  if (
    a === null ||
    Math.abs(a.screen.x - cursor.x) > 1 ||
    Math.abs(a.screen.y - cursor.y) > 1
  ) {
    cam.anchor = {
      screen: { x: cursor.x, y: cursor.y },
      world: screenToWorld(cam, cursor),
    };
  }
}

/**
 * Accumulate a wheel step into the log-zoom target, anchored at `cursor`.
 * `minLogZoom` lets the world pass the viewport-aware floor (minZoomFor);
 * the default is the absolute bound.
 */
export function addWheelZoom(
  cam: CameraState,
  deltaY: number,
  cursor: Vec2,
  sensitivity: number = WHEEL_SENSITIVITY,
  minLogZoom: number = LOG_MIN_ZOOM,
): void {
  beginZoomAnchor(cam, cursor);
  cam.logZoomTarget = clamp(
    cam.logZoomTarget - deltaY * sensitivity,
    minLogZoom,
    LOG_MAX_ZOOM,
  );
}

/**
 * Re-clamp zoom (and its target) into the viewport-aware bounds — called on
 * resize and on session restore, where a stale zoom may undershoot the new
 * minimum. Returns true when anything changed.
 */
export function clampZoomBounds(cam: CameraState, vp: Viewport): boolean {
  const lo = Math.log(minZoomFor(vp));
  let changed = false;
  if (cam.logZoomTarget < lo) {
    cam.logZoomTarget = lo;
    changed = true;
  }
  if (Math.log(cam.zoom) < lo) {
    cam.zoom = Math.exp(lo);
    changed = true;
  }
  return changed;
}

/** Re-derive cam so the anchor's world point sits under its screen point. */
export function applyAnchor(cam: CameraState): void {
  const a = cam.anchor;
  if (a === null) return;
  cam.x = a.world.x - a.screen.x / cam.zoom;
  cam.y = a.world.y - a.screen.y / cam.zoom;
}

/**
 * One smoothing step of zoom → logZoomTarget. Returns true while still
 * converging (the caller keeps the frame loop dirty). When `instant` is set
 * (reduced motion) the target is reached in one step.
 */
export function zoomTick(cam: CameraState, dt: number, instant = false): boolean {
  const lz = Math.log(cam.zoom);
  if (Math.abs(lz - cam.logZoomTarget) < ZOOM_EPSILON) {
    if (cam.anchor !== null) {
      cam.zoom = Math.exp(cam.logZoomTarget);
      applyAnchor(cam);
      cam.anchor = null;
    }
    return false;
  }
  const next = instant ? cam.logZoomTarget : lerpExp(lz, cam.logZoomTarget, dt, ZOOM_SMOOTH_K);
  cam.zoom = Math.exp(next);
  applyAnchor(cam);
  return true;
}

export interface Bounds {
  min: number;
  max: number;
}

/**
 * Horizontal camera bounds: the shelf stays in view. When the viewport is
 * wider than the shelf (far zoom) the camera x is pinned so the shelf is
 * centered (min === max).
 */
export function xBounds(vp: Viewport, zoom: number): Bounds {
  const visW = vp.width / zoom;
  if (visW >= SHELF_WIDTH + X_SLACK * 2) {
    const centered = (SHELF_WIDTH - visW) / 2;
    return { min: centered, max: centered };
  }
  return { min: -X_SLACK, max: SHELF_WIDTH + X_SLACK - visW };
}

/** Vertical camera bounds: headroom above floor 0, endless downward. */
export function yBounds(): Bounds {
  return { min: Y_MIN, max: Number.POSITIVE_INFINITY };
}

/** Soft clamp: past a bound only `factor` of the overshoot is applied. */
export function rubberBand(
  v: number,
  min: number,
  max: number,
  factor: number = RUBBER_FACTOR,
): number {
  if (v < min) return min + (v - min) * factor;
  if (v > max) return max + (v - max) * factor;
  return v;
}

/**
 * Position the camera at the raw drag target with rubber-banding past the
 * world bounds (used while a drag is active).
 */
export function applyDragPosition(
  cam: CameraState,
  rawX: number,
  rawY: number,
  vp: Viewport,
): void {
  const bx = xBounds(vp, cam.zoom);
  const by = yBounds();
  cam.x = rubberBand(rawX, bx.min, bx.max);
  cam.y = rubberBand(rawY, by.min, by.max);
}

/** Hard clamp into bounds. Returns true when anything was out of bounds. */
export function clampCamera(cam: CameraState, vp: Viewport): boolean {
  const bx = xBounds(vp, cam.zoom);
  const by = yBounds();
  const cx = clamp(cam.x, bx.min, bx.max);
  const cy = clamp(cam.y, by.min, by.max);
  const changed = cx !== cam.x || cy !== cam.y;
  cam.x = cx;
  cam.y = cy;
  return changed;
}

/** True when the camera currently rests outside its hard bounds. */
export function isOutOfBounds(cam: CameraState, vp: Viewport): boolean {
  const bx = xBounds(vp, cam.zoom);
  const by = yBounds();
  return cam.x < bx.min || cam.x > bx.max || cam.y < by.min || cam.y > by.max;
}

/**
 * One momentum integration step. Velocity decays exponentially, dies below
 * the kill threshold, and is cancelled on the axis that hits a bound.
 * Returns true while momentum is still alive.
 */
export function momentumTick(cam: CameraState, dt: number, vp: Viewport): boolean {
  if (cam.vx === 0 && cam.vy === 0) return false;
  cam.x += cam.vx * dt;
  cam.y += cam.vy * dt;
  const decay = Math.exp(-MOMENTUM_DECAY_K * dt);
  cam.vx *= decay;
  cam.vy *= decay;
  if (Math.hypot(cam.vx, cam.vy) < MOMENTUM_KILL_SPEED / cam.zoom) {
    cam.vx = 0;
    cam.vy = 0;
  }
  const bx = xBounds(vp, cam.zoom);
  const by = yBounds();
  if (cam.x <= bx.min || cam.x >= bx.max) {
    cam.x = clamp(cam.x, bx.min, bx.max);
    cam.vx = 0;
  }
  if (cam.y <= by.min) {
    cam.y = by.min;
    cam.vy = 0;
  }
  return cam.vx !== 0 || cam.vy !== 0;
}

/** One pointer delta: screen px moved over `dt` seconds. */
export interface DragSample {
  dx: number;
  dy: number;
  dt: number;
}

/** Weights for the last 4 samples, most recent first. */
const VELOCITY_WEIGHTS = [0.4, 0.3, 0.2, 0.1] as const;

/**
 * Weighted average velocity (screen px/s) of up to the last 4 pointer deltas,
 * ordered most-recent-first (weights 0.4/0.3/0.2/0.1 per the design doc).
 */
export function weightedVelocity(samples: readonly DragSample[]): Vec2 {
  let vx = 0;
  let vy = 0;
  let total = 0;
  const n = Math.min(VELOCITY_WEIGHTS.length, samples.length);
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    if (s.dt <= 0) continue;
    const w = VELOCITY_WEIGHTS[i];
    vx += (s.dx / s.dt) * w;
    vy += (s.dy / s.dt) * w;
    total += w;
  }
  if (total === 0) return { x: 0, y: 0 };
  return { x: vx / total, y: vy / total };
}
