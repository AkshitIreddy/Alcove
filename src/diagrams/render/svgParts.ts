/**
 * src/diagrams/render/svgParts.ts — the hand-drawn SVG vocabulary.
 *
 * Pure geometry helpers (no Solid, no DOM) shared by every diagram renderer:
 *   - wobbled node outlines (rect / cloud / circle) as pencil double-strokes,
 *     seeded per node id so a node keeps its exact wobble across re-renders,
 *   - pencil edges with a slight overshoot past the joints,
 *   - arrowheads drawn as two little V strokes,
 *   - a filter-free paper shadow (the SAME outline offset a few px, low alpha).
 */

import { fnv1a } from '../../art/noise';
import { doubleStroke, wobbleLine, wobblePath } from '../../art/wobble';
import type { DiagramPoint, DiagramShape } from '../types';

/** Round for compact path strings. */
function f(n: number): string {
  const r = Math.round(n * 100) / 100;
  return (Object.is(r, -0) ? 0 : r).toString();
}

/** Stable per-node wobble seed. */
export function nodeSeed(scope: string, id: string): number {
  return fnv1a(`${scope}::${id}`);
}

// ---------------------------------------------------------------------------
// Shape outlines (local coords: box top-left at 0,0)
// ---------------------------------------------------------------------------

export interface ShapeStrokes {
  /** Two wobble passes (render both at partial alpha). */
  passes: [string, string];
  /** First pass reused for the offset paper shadow + wash fill. */
  fill: string;
}

function rectBase(w: number, h: number): string {
  // Tiny corner insets so the wobble reads as hand-ruled, not die-cut.
  return `M 2 0 L ${f(w - 2)} 0 L ${f(w)} ${f(h / 2)} L ${f(w - 2)} ${f(h)} L 2 ${f(h)} L 0 ${f(h / 2)} Z`;
}

function ellipseBase(w: number, h: number): string {
  const rx = w / 2;
  const ry = h / 2;
  return (
    `M ${f(w)} ${f(ry)} ` +
    `A ${f(rx)} ${f(ry)} 0 1 1 0 ${f(ry)} ` +
    `A ${f(rx)} ${f(ry)} 0 1 1 ${f(w)} ${f(ry)} Z`
  );
}

function cloudBase(w: number, h: number, seed: number): string {
  // Bumpy perimeter: walk an ellipse, arc outward between successive points.
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2 - 2;
  const ry = h / 2 - 2;
  const perimeter = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  const bumps = Math.max(6, Math.min(14, Math.round(perimeter / 34)));
  const jitter = (i: number): number =>
    (((seed >>> (i % 13)) & 7) / 7 - 0.5) * 0.22;
  let d = '';
  for (let i = 0; i <= bumps; i++) {
    const a = (2 * Math.PI * i) / bumps - Math.PI / 2;
    const wob = 1 + (i === bumps ? jitter(0) : jitter(i));
    const x = cx + Math.cos(a) * rx * wob;
    const y = cy + Math.sin(a) * ry * wob;
    if (i === 0) {
      d = `M ${f(x)} ${f(y)}`;
    } else {
      // Arc radius a touch over half the chord so each hop puffs outward.
      const r = (perimeter / bumps) * 0.62;
      d += ` A ${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y)}`;
    }
  }
  return d + ' Z';
}

/**
 * Wobbled outline for a node shape in a w×h box (local coordinates).
 * Deterministic per (shape, w, h, seed).
 */
export function shapeStrokes(
  shape: DiagramShape,
  w: number,
  h: number,
  seed: number,
): ShapeStrokes {
  let base: string;
  let amplitude = 1.1;
  if (shape === 'cloud') {
    base = cloudBase(w, h, seed);
    amplitude = 0.8; // clouds are already bumpy
  } else if (shape === 'circle') {
    base = ellipseBase(w, h);
  } else {
    base = rectBase(w, h);
  }
  const passes = doubleStroke(base, {
    seed,
    amplitude,
    frequency: 0.022,
    samplesEveryPx: 4,
  });
  return { passes, fill: passes[0] };
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

export interface EdgeStrokes {
  passes: string[];
}

/**
 * Pencil double-stroke along a polyline, each segment overshooting its
 * joints by a few px (the "didn't quite lift the pencil" look).
 */
export function edgeStrokes(
  points: DiagramPoint[],
  seed: number,
  overshoot = 3,
): EdgeStrokes {
  const passes: string[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    const ux = dx / len;
    const uy = dy / len;
    // Overshoot both ends slightly, a bit more at interior joints.
    const startOver = i === 0 ? overshoot * 0.4 : overshoot;
    const endOver = i === points.length - 2 ? overshoot * 0.4 : overshoot;
    const x1 = a.x - ux * startOver;
    const y1 = a.y - uy * startOver;
    const x2 = b.x + ux * endOver;
    const y2 = b.y + uy * endOver;
    const segSeed = (seed + i * 0x85ebca6b) >>> 0;
    const [p1, p2] = [
      wobbleLine(x1, y1, x2, y2, { seed: segSeed, amplitude: 1.0, frequency: 0.018 }),
      wobbleLine(x1, y1, x2, y2, {
        seed: (segSeed ^ 0x9e3779b9) >>> 0,
        amplitude: 0.8,
        frequency: 0.024,
      }),
    ];
    passes.push(p1, p2);
  }
  return { passes };
}

/**
 * Arrowhead as two short drawn strokes forming a V at `tip`, pointing along
 * `angle` (radians, direction of travel).
 */
export function arrowheadStrokes(
  tip: DiagramPoint,
  angle: number,
  seed: number,
  size = 9,
): string[] {
  const spread = 0.46; // half-angle of the V
  const back = angle + Math.PI;
  const mk = (side: number, s: number): string => {
    const a = back + spread * side;
    const x = tip.x + Math.cos(a) * size;
    const y = tip.y + Math.sin(a) * size;
    return wobbleLine(tip.x, tip.y, x, y, {
      seed: s,
      amplitude: 0.5,
      frequency: 0.05,
      samplesEveryPx: 3,
    });
  };
  return [mk(1, seed), mk(-1, (seed ^ 0x51ed270b) >>> 0)];
}

/** Direction (radians) of the final segment of a polyline. */
export function endAngle(points: DiagramPoint[]): number {
  if (points.length < 2) return 0;
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// ---------------------------------------------------------------------------
// Timeline spine
// ---------------------------------------------------------------------------

/** Long wobbled vertical spine (single pass pair via doubleStroke). */
export function spineStrokes(
  x: number,
  y1: number,
  y2: number,
  seed: number,
): [string, string] {
  return doubleStroke(`M ${f(x)} ${f(y1)} L ${f(x)} ${f(y2)}`, {
    seed,
    amplitude: 1.4,
    frequency: 0.012,
    samplesEveryPx: 6,
  });
}

/** A drawn dot: tiny filled wobbly circle path. */
export function dotPath(cx: number, cy: number, r: number, seed: number): string {
  const base =
    `M ${f(cx + r)} ${f(cy)} ` +
    `A ${f(r)} ${f(r)} 0 1 1 ${f(cx - r)} ${f(cy)} ` +
    `A ${f(r)} ${f(r)} 0 1 1 ${f(cx + r)} ${f(cy)} Z`;
  return wobblePath(base, { seed, amplitude: 0.5, frequency: 0.08, samplesEveryPx: 2 });
}
