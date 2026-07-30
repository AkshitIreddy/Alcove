/**
 * art/wobble.ts — pre-distorted vector linework.
 *
 * For icons, dividers, frames and any zoom-critical chrome: sample a clean
 * SVG path every few px (svg-path-properties), offset each sample along its
 * normal by seeded 1D simplex noise, rebuild as a Catmull-Rom → cubic bezier
 * path. The wobble is baked into the path DATA, not into pixels — the result
 * is plain crisp SVG at any zoom, with zero runtime filters.
 */

import { svgPathProperties } from 'svg-path-properties';
import { seededNoise1D } from './noise';

export interface WobbleOptions {
  /** PRNG seed — same seed ⇒ byte-identical output path. Default 1. */
  seed?: number;
  /** Peak perpendicular offset in px (doc range 0.8–1.5). Default 1.2. */
  amplitude?: number;
  /** Noise frequency per px of arc length (doc ~0.02/px). Default 0.02. */
  frequency?: number;
  /** Distance between samples in px (doc 3–5). Default 4. */
  samplesEveryPx?: number;
}

interface Pt {
  x: number;
  y: number;
}

/** Round to 2 decimals for compact, deterministic path strings. */
function f(n: number): string {
  const r = Math.round(n * 100) / 100;
  return (Object.is(r, -0) ? 0 : r).toString();
}

/**
 * Rebuild a sampled polyline as a smooth cubic-bezier path using the
 * standard Catmull-Rom → bezier conversion (tension 1/6).
 */
function catmullRomToBezier(pts: readonly Pt[], closed: boolean): string {
  const first = pts[0];
  if (!first) return '';
  if (pts.length < 3) {
    const last = pts[pts.length - 1] ?? first;
    return `M ${f(first.x)} ${f(first.y)} L ${f(last.x)} ${f(last.y)}`;
  }
  let out = `M ${f(first.x)} ${f(first.y)}`;
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    // For closed paths pts[0] ≈ pts[n-1], so the wrap neighbours skip the
    // duplicated endpoint (n-2 and 1) to keep tangents continuous.
    const p0 = pts[i - 1] ?? (closed ? pts[n - 2] : pts[i]);
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? (closed ? pts[1] : pts[i + 1]);
    if (!p0 || !p1 || !p2 || !p3) break;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    out += ` C ${f(c1x)} ${f(c1y)}, ${f(c2x)} ${f(c2y)}, ${f(p2.x)} ${f(p2.y)}`;
  }
  if (closed) out += ' Z';
  return out;
}

/**
 * Pre-distort a clean path: sample every `samplesEveryPx`, offset each sample
 * perpendicular to the local tangent by seeded 1D simplex noise, rebuild as a
 * smooth cubic path string. Deterministic for a given (d, opts).
 */
export function wobblePath(d: string, opts: WobbleOptions = {}): string {
  const seed = opts.seed ?? 1;
  const amplitude = opts.amplitude ?? 1.2;
  const frequency = opts.frequency ?? 0.02;
  const samplesEveryPx = opts.samplesEveryPx ?? 4;

  const props = new svgPathProperties(d);
  const total = props.getTotalLength();
  if (!(total > 0)) return d;

  const noise = seededNoise1D(seed);
  const steps = Math.max(2, Math.ceil(total / Math.max(0.5, samplesEveryPx)));
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const len = (total * i) / steps;
    const p = props.getPointAtLength(len);
    const t = props.getTangentAtLength(len);
    const mag = Math.hypot(t.x, t.y) || 1;
    // Unit normal (rotate tangent 90°).
    const nx = -t.y / mag;
    const ny = t.x / mag;
    const off = noise(len * frequency) * amplitude;
    pts.push({ x: p.x + nx * off, y: p.y + ny * off });
  }

  const closed = /z\s*$/i.test(d.trim());
  return catmullRomToBezier(pts, closed);
}

/**
 * Rough.js-style double stroke: two slightly-different wobble passes over the
 * same source path. Render both at partial alpha (≈0.55) for the sketchy
 * doubled-line look.
 */
export function doubleStroke(d: string, opts: WobbleOptions = {}): [string, string] {
  const seed = opts.seed ?? 1;
  const amplitude = opts.amplitude ?? 1.2;
  const first = wobblePath(d, { ...opts, seed });
  const second = wobblePath(d, {
    ...opts,
    seed: (seed ^ 0x9e3779b9) >>> 0,
    amplitude: amplitude * 0.85,
  });
  return [first, second];
}

/** Wobbled axis-aligned rectangle outline (closed path). */
export function wobbleRect(
  x: number,
  y: number,
  w: number,
  h: number,
  opts: WobbleOptions = {},
): string {
  const d = `M ${f(x)} ${f(y)} L ${f(x + w)} ${f(y)} L ${f(x + w)} ${f(y + h)} L ${f(x)} ${f(y + h)} Z`;
  return wobblePath(d, opts);
}

/** Wobbled straight line segment. */
export function wobbleLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  opts: WobbleOptions = {},
): string {
  const d = `M ${f(x1)} ${f(y1)} L ${f(x2)} ${f(y2)}`;
  return wobblePath(d, opts);
}
