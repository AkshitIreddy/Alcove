/**
 * art/leaves.ts — the leaf & petal shape vocabulary used by `art/flora.ts`.
 *
 * Everything here is pure geometry + Canvas2D drawing: no DOM, no filters, no
 * randomness that is not seeded. A leaf is authored in **local leaf space**:
 * the petiole (attachment point) sits at the origin and the blade grows along
 * +x, so a caller places one with `translate(x, y); rotate(angle)`.
 *
 * Look (per docs/design/library-themes.md §3): "double-stroked pencil outlines
 * with a soft wash fill, slight per-leaf hue jitter, and a few curled/darkened
 * older leaves for realism". That is implemented as, per leaf:
 *   1. a soft base→tip gradient wash,
 *   2. a clipped wide inner stroke = watercolour edge-darkening rim,
 *   3. two *different* wobbled outline passes at partial alpha = pencil,
 *   4. a wobbled midrib + a few side veins,
 *   5. optionally a folded/curled near side, shaded darker.
 */

import { clamp, mulberry32, type RandomFn } from './noise';
import type { Ctx2D } from './spines';

export interface Pt {
  x: number;
  y: number;
}

/** The five species shapes from the design doc, plus `petal` for blossoms. */
export type LeafShape = 'heart' | 'oval' | 'lobed' | 'needle' | 'round' | 'petal';

export const LEAF_SHAPES: readonly LeafShape[] = [
  'heart',
  'oval',
  'lobed',
  'needle',
  'round',
  'petal',
];

export interface LeafGeometryOptions {
  shape: LeafShape;
  /** Blade length, petiole → tip, in px. */
  len: number;
  /** Full blade width at its widest point, in px. */
  width: number;
  /** Signed lateral bend of the midrib at the tip, px (hand-drawn droop). */
  bend?: number;
  /** 0 = flat, up to ~0.7 = the near half folded over (an older leaf). */
  curl?: number;
  /** Peak hand-wobble applied to every outline sample, px. Default 0.5. */
  jitter?: number;
  /** Seed for the wobble. Same seed ⇒ identical outline. Default 1. */
  seed?: number;
  /** Outline samples along the blade. Default 20. */
  steps?: number;
  /** Lobe count for `lobed` (ivy-ish). Default 2.5 ⇒ ~5 visible lobes. */
  lobes?: number;
}

/* ------------------------------ profiles --------------------------------- */

/**
 * Half-width of the blade at `t` ∈ [0,1] along the midrib, as a fraction of
 * half the full width. 0 at the petiole and at the tip for pointed shapes.
 */
export function leafProfile(shape: LeafShape, t: number, lobes = 2.5): number {
  const u = clamp(t, 0, 1);
  switch (shape) {
    case 'heart':
      // Broad shoulders low down (peak ≈ t 0.28), long point.
      return Math.pow(Math.sin(Math.PI * Math.pow(u, 0.545)), 0.8);
    case 'lobed': {
      // Ivy: an oval envelope chewed into scallops.
      const env = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.62)), 0.75);
      return env * (0.72 + 0.28 * Math.cos(2 * Math.PI * lobes * u * 0.92 + 0.6));
    }
    case 'needle':
      // Thyme / fern pinna / grass blade: long, blunt-based, thin.
      return Math.pow(Math.sin(Math.PI * u), 0.35) * (1 - 0.16 * u);
    case 'round':
      // Moss / pennywort / geranium: a near-circular disc.
      return Math.sqrt(Math.max(0, 1 - (2 * u - 1) * (2 * u - 1)));
    case 'petal':
      // Blossom petal: rounded, still open near the tip.
      return Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 0.55);
    default:
      // oval — the workhorse; widest just past the middle.
      return Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 0.75);
  }
}

/** Shapes whose base is notched (the petiole sits in a valley). */
function notchDepth(shape: LeafShape): number {
  if (shape === 'heart') return 0.85;
  if (shape === 'lobed') return 0.6;
  return 0;
}

/** Fraction of the blade that sits *behind* the petiole (base lobes). */
function backset(shape: LeafShape): number {
  if (shape === 'heart') return 0.12;
  if (shape === 'lobed') return 0.08;
  return 0;
}

/* ------------------------------ geometry --------------------------------- */

/** Midrib point at t: the blade axis, bent by `bend` toward the tip. */
function axisPoint(t: number, len: number, back: number, bend: number): Pt {
  const x = len * (t * (1 + back) - back);
  return { x, y: bend * Math.pow(clamp(t, 0, 1), 1.7) };
}

/** The blade axis (midrib) as a polyline, petiole → tip. */
export function leafAxis(o: LeafGeometryOptions): Pt[] {
  const steps = o.steps ?? 20;
  const back = backset(o.shape);
  const bend = o.bend ?? 0;
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) pts.push(axisPoint(i / steps, o.len, back, bend));
  return pts;
}

/**
 * The closed blade outline, counter-clockwise from the petiole along the
 * "near" (+normal) side to the tip and back along the far side.
 *
 * `curl` narrows the near side, which — together with the fold shading in
 * `drawLeaf` — reads as a leaf that has begun to roll up with age.
 */
export function leafOutline(o: LeafGeometryOptions): Pt[] {
  const steps = o.steps ?? 20;
  const jitter = o.jitter ?? 0.5;
  const rnd = mulberry32((o.seed ?? 1) >>> 0);
  const back = backset(o.shape);
  const bend = o.bend ?? 0;
  const halfW = o.width / 2;
  const curl = clamp(o.curl ?? 0, 0, 0.75);
  const notch = notchDepth(o.shape);
  const lobes = o.lobes ?? 2.5;

  const near: Pt[] = [];
  const far: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = axisPoint(t, o.len, back, bend);
    const b = axisPoint(Math.min(1, t + 1 / steps), o.len, back, bend);
    const c = axisPoint(Math.max(0, t - 1 / steps), o.len, back, bend);
    const tx = b.x - c.x;
    const ty = b.y - c.y;
    const mag = Math.hypot(tx, ty) || 1;
    const nx = -ty / mag;
    const ny = tx / mag;
    const w = leafProfile(o.shape, t, lobes) * halfW;
    const jx = () => (rnd() * 2 - 1) * jitter;

    let np: Pt = { x: a.x + nx * w * (1 - curl), y: a.y + ny * w * (1 - curl) };
    let fp: Pt = { x: a.x - nx * w, y: a.y - ny * w };

    // Base notch: pull the first few samples back toward the petiole so the
    // two base lobes meet in a valley instead of a rounded stub.
    if (notch > 0 && t < 0.2) {
      const k = (1 - t / 0.2) * notch;
      np = { x: np.x * (1 - k), y: np.y * (1 - k) };
      fp = { x: fp.x * (1 - k), y: fp.y * (1 - k) };
    }

    near.push({ x: np.x + jx(), y: np.y + jx() });
    far.push({ x: fp.x + jx(), y: fp.y + jx() });
  }

  far.reverse();
  return near.concat(far);
}

/**
 * Conservative bounding radius of a leaf about its petiole. Deliberately an
 * over-estimate — `flora.ts` builds keep-out bounds from it, and over-covering
 * is the safe direction (flora must never reach a spine's title).
 */
export function leafBoundRadius(len: number, width: number): number {
  return Math.hypot(len, width * 0.5) + 1;
}

/** Side veins as polylines from the midrib outward (largest leaves only). */
export function leafVeins(o: LeafGeometryOptions, count: number): Pt[][] {
  const back = backset(o.shape);
  const bend = o.bend ?? 0;
  const halfW = o.width / 2;
  const out: Pt[][] = [];
  for (let i = 1; i <= count; i++) {
    const t = 0.18 + (i / (count + 1)) * 0.62;
    const a = axisPoint(t, o.len, back, bend);
    const w = leafProfile(o.shape, t, o.lobes ?? 2.5) * halfW * 0.78;
    for (const side of [1, -1]) {
      const tip = axisPoint(Math.min(1, t + 0.2), o.len, back, bend);
      out.push([
        { x: a.x, y: a.y },
        { x: (a.x + tip.x) / 2, y: a.y + side * w * 0.55 },
        { x: tip.x - o.len * 0.04, y: a.y + side * w },
      ]);
    }
  }
  return out;
}

/* ------------------------------- drawing --------------------------------- */

/** Trace a polyline as midpoint-quadratics — soft, hand-drawn curvature. */
export function traceSmooth(ctx: Ctx2D, pts: readonly Pt[], closed: boolean): void {
  if (pts.length < 2) return;
  const first = pts[0] as Pt;
  ctx.beginPath();
  if (closed) {
    const last = pts[pts.length - 1] as Pt;
    ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  } else {
    ctx.moveTo(first.x, first.y);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i] as Pt;
    const q = pts[i + 1] as Pt;
    ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
  }
  const last = pts[pts.length - 1] as Pt;
  if (closed) {
    ctx.quadraticCurveTo(last.x, last.y, (last.x + first.x) / 2, (last.y + first.y) / 2);
    ctx.closePath();
  } else {
    ctx.lineTo(last.x, last.y);
  }
}

export interface LeafPaint {
  /** Wash colour at the petiole (usually the deeper tone). */
  fillBase: string;
  /** Wash colour at the tip (usually a shade lighter/warmer). */
  fillTip: string;
  /** Pencil outline colour. */
  ink: string;
  /** Midrib/vein colour. */
  vein: string;
  /** Whole-leaf alpha. Default 1. */
  alpha?: number;
  /** Outline stroke width. Default 0.85. */
  lineWidth?: number;
}

/** HSL colour string helper shared with flora.ts. */
export function hsl(h: number, s: number, l: number, a = 1): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 100);
  const ll = clamp(l, 0, 100);
  return a >= 1 ? `hsl(${hh} ${ss}% ${ll}%)` : `hsl(${hh} ${ss}% ${ll}% / ${a})`;
}

/**
 * Draw one leaf in local leaf space (petiole at origin, blade along +x).
 * The caller owns the transform; this only saves/restores paint state.
 */
export function drawLeaf(ctx: Ctx2D, o: LeafGeometryOptions, paint: LeafPaint): void {
  const seed = (o.seed ?? 1) >>> 0;
  const outline = leafOutline({ ...o, seed });
  // A second, subtly different pass — rough.js's double-stroke trick.
  const outline2 = leafOutline({
    ...o,
    seed: (seed ^ 0x9e3779b9) >>> 0,
    jitter: (o.jitter ?? 0.5) * 1.35,
  });
  const alpha = paint.alpha ?? 1;
  const lw = paint.lineWidth ?? 0.85;
  const back = backset(o.shape);
  const tip = axisPoint(1, o.len, back, o.bend ?? 0);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. Soft wash: base → tip gradient.
  traceSmooth(ctx, outline, true);
  const g = ctx.createLinearGradient(-o.len * back, 0, tip.x, tip.y);
  g.addColorStop(0, paint.fillBase);
  g.addColorStop(1, paint.fillTip);
  ctx.fillStyle = g;
  ctx.fill();

  // 2. Watercolour rim: a wide stroke clipped to the blade darkens the edge.
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = paint.ink;
  ctx.globalAlpha = alpha * 0.22;
  ctx.lineWidth = Math.max(2, o.width * 0.22);
  ctx.stroke();
  ctx.restore();

  // 3. Fold shading for older, curled leaves.
  const curl = clamp(o.curl ?? 0, 0, 0.75);
  if (curl > 0.05) {
    const axis = leafAxis(o);
    const near = outline.slice(0, Math.floor(outline.length / 2));
    ctx.save();
    traceSmooth(ctx, outline, true);
    ctx.clip();
    ctx.beginPath();
    const fold = axis.concat([...near].reverse());
    traceSmooth(ctx, fold, true);
    ctx.fillStyle = paint.ink;
    ctx.globalAlpha = alpha * (0.1 + curl * 0.18);
    ctx.fill();
    ctx.restore();
  }

  // 4. Midrib + veins.
  const axis = leafAxis(o);
  ctx.strokeStyle = paint.vein;
  ctx.globalAlpha = alpha * 0.45;
  ctx.lineWidth = lw * 0.8;
  traceSmooth(ctx, axis.slice(0, Math.max(2, axis.length - 2)), false);
  ctx.stroke();
  if (o.len > 9 && o.shape !== 'needle' && o.shape !== 'round') {
    ctx.globalAlpha = alpha * 0.26;
    ctx.lineWidth = lw * 0.6;
    for (const v of leafVeins(o, o.len > 16 ? 3 : 2)) {
      traceSmooth(ctx, v, false);
      ctx.stroke();
    }
  }

  // 5. Double-stroked pencil outline.
  ctx.strokeStyle = paint.ink;
  ctx.lineWidth = lw;
  ctx.globalAlpha = alpha * 0.62;
  traceSmooth(ctx, outline, true);
  ctx.stroke();
  ctx.lineWidth = lw * 0.75;
  ctx.globalAlpha = alpha * 0.34;
  traceSmooth(ctx, outline2, true);
  ctx.stroke();

  ctx.restore();
}

/* ------------------------------- blossoms --------------------------------- */

export interface BlossomPaint {
  petalBase: string;
  petalTip: string;
  ink: string;
  centre: string;
  stamen: string;
}

/**
 * A five-petal blossom centred on the origin. `open` ∈ [0,1] turns a tight
 * bud (0) into a fully-opened flower (1) — a branch carries a mix of both.
 */
export function drawBlossom(
  ctx: Ctx2D,
  r: number,
  open: number,
  seed: number,
  paint: BlossomPaint,
): void {
  const rnd: RandomFn = mulberry32(seed >>> 0);
  const petals = 5;
  const o = clamp(open, 0, 1);
  ctx.save();
  ctx.rotate(rnd() * Math.PI * 2);
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2 + (rnd() * 2 - 1) * 0.16;
    ctx.save();
    ctx.rotate(a);
    // Buds keep their petals furled: shorter, narrower, tilted forward.
    const len = r * (0.55 + 0.45 * o) * (0.85 + rnd() * 0.3);
    const wid = r * (0.5 + 0.55 * o) * (0.85 + rnd() * 0.3);
    drawLeaf(
      ctx,
      {
        shape: 'petal',
        len,
        width: wid,
        bend: (rnd() * 2 - 1) * r * 0.12,
        jitter: 0.35,
        seed: (seed * 31 + i) >>> 0,
        steps: 14,
      },
      {
        fillBase: paint.petalBase,
        fillTip: paint.petalTip,
        ink: paint.ink,
        vein: paint.ink,
        lineWidth: 0.7,
      },
    );
    ctx.restore();
  }
  // Centre disc + a few stamens, only once the flower has opened.
  if (o > 0.35) {
    ctx.fillStyle = paint.centre;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.22 * o, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = paint.stamen;
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 5; i++) {
      const a = rnd() * Math.PI * 2;
      const l = r * (0.24 + rnd() * 0.16) * o;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * l, Math.sin(a) * l);
      ctx.stroke();
    }
  }
  ctx.restore();
}
