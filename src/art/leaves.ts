/**
 * art/leaves.ts — the leaf, petal and bloom vocabulary used by `art/flora.ts`.
 *
 * Everything here is pure geometry + Canvas2D drawing: no DOM, no filters, no
 * randomness that is not seeded. A leaf is authored in **local leaf space**:
 * the petiole (attachment point) sits at the origin and the blade grows along
 * +x, so a caller places one with `translate(x, y); rotate(angle)`.
 *
 * ## The standard (docs/design/painterly-art-direction.md §1, §4)
 *
 * The reference painting has leaves **25–60px, large, overlapping, forming
 * masses**, at many depths — some lit, some in shade, some silhouetted — with
 * rim light on the edges facing the key. Our previous leaves were ~18px flat
 * washes with a pencil outline: correct as a diagram, cheap as a painting.
 *
 * A leaf here is therefore not "a fill and an outline". It is a stack of
 * passes, every one of which does a small amount of work:
 *
 *   1. **Form gradient** — base→tip, four stops, shadowed at the petiole.
 *   2. **Lateral gradient** — one flank darker than the other, so the blade
 *      reads as a curved surface catching light from one side rather than a
 *      flat cut-out. This is the single biggest painterly win per line.
 *   3. **Watercolour rim** — a wide inner stroke clipped to the blade.
 *   4. **Mottle** — 2–5 soft irregular patches of ± lightness. Nothing in
 *      nature is one colour.
 *   5. **Variegation** — optional pale blotches (pothos and friends).
 *   6. **Subsurface glow** — a warm translucent bloom near the tip on
 *      back-lit leaves, the "sun through a leaf" colour.
 *   7. **Fold shading** — for curled older leaves.
 *   8. **Venation** — midrib, secondaries with taper, tertiaries on big
 *      blades, and a pale halo along the midrib.
 *   9. **Specular patch** — an elongated soft highlight offset off-axis.
 *  10. **Edge damage** — bites and tears on a fraction of older leaves.
 *  11. **Rim light** — a bright thin arc along the edge facing the key.
 *  12. **Double-stroked pencil outline**, weighted heavier on the shade side.
 *
 * Blooms get the same treatment: layered petal rings (back ring darker and
 * larger, front ring lit and smaller), a visible centre disc with a texture of
 * anthers, a throat shadow, and a pollen highlight.
 */

import { clamp, lerp, mulberry32, type RandomFn } from './noise';
import type { Ctx2D } from './spines';

export interface Pt {
  x: number;
  y: number;
}

/**
 * The shape vocabulary. The first six are the original species shapes; the
 * rest were added for the rebuild, because a mass of foliage built from three
 * silhouettes reads as wallpaper — a real canopy mixes blade shapes.
 */
export type LeafShape =
  | 'heart'
  | 'oval'
  | 'lobed'
  | 'needle'
  | 'round'
  | 'petal'
  /** Big maple/grape-ish hand with 5 deep lobes — the canopy workhorse. */
  | 'palmate'
  /** Elm/nettle: oval with a saw-toothed margin. */
  | 'serrate'
  /** Ginkgo/nasturtium fan: wide at the tip, narrow at the petiole. */
  | 'fan'
  /** Long drooping banana/hosta strap with a wavy margin. */
  | 'strap'
  /** Deeply cut fern pinnule / cosmos foliage. */
  | 'pinnate';

export const LEAF_SHAPES: readonly LeafShape[] = [
  'heart',
  'oval',
  'lobed',
  'needle',
  'round',
  'petal',
  'palmate',
  'serrate',
  'fan',
  'strap',
  'pinnate',
];

/** Shapes that read well at 30px+ — the ones a canopy mass is built from. */
export const CANOPY_SHAPES: readonly LeafShape[] = [
  'palmate',
  'lobed',
  'serrate',
  'heart',
  'oval',
  'fan',
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
  /** Outline samples along the blade. Default 20 (28 for big blades). */
  steps?: number;
  /** Lobe count for `lobed`/`palmate`. Default 2.5 ⇒ ~5 visible lobes. */
  lobes?: number;
  /**
   * 0–1: how much of the tip has been eaten/torn away. A canopy in which no
   * leaf is damaged looks manufactured; ~15% damaged looks grown.
   */
  damage?: number;
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
      // Ivy: an oval envelope chewed into deep scallops. The modulation is
      // deliberately strong — at shelf scale a shallow scallop just reads as
      // a blurry oval, and the ivy leaf stops being recognisably ivy.
      const env = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.58)), 0.66);
      const cut = 0.72 + 0.28 * Math.cos(2 * Math.PI * lobes * u * 0.92 + 0.6);
      return env * cut;
    }
    case 'palmate': {
      // A maple/grape hand: broad and low, with a basal pair of shoulders, a
      // mid pair and an apex. Modulating hard along the midrib (the first
      // attempt) produced spiky snowflakes — real palmate lobes are shallow,
      // rounded and few, and the *envelope* does most of the work.
      const env = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.46)), 0.42);
      const wave = Math.cos(2 * Math.PI * (lobes * 0.8) * Math.pow(u, 0.95) + 0.5);
      const cut = 0.74 + 0.26 * Math.pow((wave + 1) / 2, 0.8);
      return env * cut;
    }
    case 'serrate': {
      // Oval, then a fine saw-tooth margin — small amplitude, high frequency.
      const env = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.72);
      const teeth = 0.92 + 0.08 * Math.cos(2 * Math.PI * 9 * u);
      return env * teeth;
    }
    case 'fan': {
      // Ginkgo: nothing at the stalk, widest right at the tip, faint notch.
      const env = Math.pow(u, 0.62);
      const notch = 1 - 0.22 * Math.exp(-Math.pow((u - 1) * 6, 2));
      return env * notch * 1.02;
    }
    case 'strap': {
      // Long parallel-sided blade with a softly wavy margin.
      const env = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.34)), 0.3);
      return env * (0.9 + 0.1 * Math.cos(2 * Math.PI * 3.5 * u));
    }
    case 'pinnate': {
      // Deeply cut down to a thread — cosmos/yarrow foliage.
      const env = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.62);
      const cut = 0.24 + 0.76 * Math.pow(Math.abs(Math.cos(Math.PI * 6.5 * u)), 0.5);
      return env * cut;
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
  if (shape === 'palmate') return 0.92;
  return 0;
}

/** Fraction of the blade that sits *behind* the petiole (base lobes). */
function backset(shape: LeafShape): number {
  if (shape === 'heart') return 0.12;
  if (shape === 'lobed') return 0.08;
  if (shape === 'palmate') return 0.2;
  return 0;
}

/** How many secondary veins suit this shape at this size. */
function veinCount(shape: LeafShape, len: number): number {
  if (shape === 'needle' || shape === 'round' || shape === 'strap') return 0;
  if (shape === 'palmate' || shape === 'lobed') return len > 30 ? 3 : 2;
  if (len > 42) return 5;
  if (len > 26) return 4;
  if (len > 15) return 3;
  return 2;
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
 * `drawLeaf` — reads as a leaf that has begun to roll up with age. `damage`
 * bites an irregular notch out of one flank.
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
  const damage = clamp(o.damage ?? 0, 0, 1);
  // Where the bite is, and how wide — stable per seed.
  const biteAt = 0.35 + rnd() * 0.5;
  const biteW = 0.09 + rnd() * 0.13;
  const biteSide = rnd() < 0.5 ? 1 : -1;

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
    let w = leafProfile(o.shape, t, lobes) * halfW;
    const jx = (): number => (rnd() * 2 - 1) * jitter;

    // Damage: a smooth notch bitten out of one flank.
    let wNear = w;
    let wFar = w;
    if (damage > 0.02) {
      const d = Math.exp(-Math.pow((t - biteAt) / biteW, 2)) * damage;
      if (biteSide > 0) wNear = w * (1 - d * 0.85);
      else wFar = w * (1 - d * 0.85);
    }
    void w;

    let np: Pt = { x: a.x + nx * wNear * (1 - curl), y: a.y + ny * wNear * (1 - curl) };
    let fp: Pt = { x: a.x - nx * wFar, y: a.y - ny * wFar };

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
  const palmate = o.shape === 'palmate' || o.shape === 'lobed';
  for (let i = 1; i <= count; i++) {
    const t = palmate ? 0.06 : 0.18 + (i / (count + 1)) * 0.62;
    const a = axisPoint(t, o.len, back, bend);
    // Palmate leaves radiate every vein from one point near the base, out to
    // the tip of a lobe; pinnate leaves step up the midrib.
    const tipT = palmate ? 0.72 + (i / (count + 1)) * 0.26 : Math.min(1, t + 0.22);
    const w = leafProfile(o.shape, palmate ? tipT : t, o.lobes ?? 2.5) * halfW * (palmate ? 1 : 0.78);
    for (const side of [1, -1]) {
      const tip = axisPoint(tipT, o.len, back, bend);
      out.push([
        { x: a.x, y: a.y },
        { x: (a.x + tip.x) / 2, y: a.y + side * w * (palmate ? 0.72 : 0.55) },
        { x: tip.x - o.len * 0.04, y: tip.y + side * w * (palmate ? 0.9 : 1) },
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

/**
 * Trace a polyline as a **tapered** stroke — a filled ribbon whose half-width
 * is `w(i)`. Canvas has no variable-width stroke and a constant one is the
 * loudest "vector clip-art" tell there is; every vein, twig and tendril in
 * this module goes through here instead.
 */
export function traceTapered(
  ctx: Ctx2D,
  pts: readonly Pt[],
  widthAt: (t: number) => number,
): void {
  const n = pts.length;
  if (n < 2) return;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)] as Pt;
    const b = pts[Math.min(n - 1, i + 1)] as Pt;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const m = Math.hypot(dx, dy) || 1;
    const w = Math.max(0.12, widthAt(i / (n - 1)));
    const p = pts[i] as Pt;
    left.push({ x: p.x - (dy / m) * w, y: p.y + (dx / m) * w });
    right.push({ x: p.x + (dy / m) * w, y: p.y - (dx / m) * w });
  }
  traceSmooth(ctx, left.concat(right.reverse()), true);
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
  /**
   * Variegation colour. When set, a few soft pale blotches are washed over
   * the blade (clipped to it) — what makes a pothos leaf read as a pothos
   * rather than a plain heart.
   */
  variegation?: string;
  /** Sun highlight along the near shoulder. Default: derived from fillTip. */
  sheen?: string;

  /* ---- painterly extras (all optional; a leaf is still legal without) ---- */

  /**
   * Direction the key light comes from, in **leaf-local radians**. The caller
   * computes `keyAngle - leafWorldAngle`. Drives the lateral gradient, the
   * specular patch and the rim.
   */
  lightAngle?: number;
  /** Rim-light colour on the edge facing the key. Omit ⇒ no rim pass. */
  rim?: string;
  /** Rim strength 0–1. Default 0.75. */
  rimStrength?: number;
  /** Shadow tone used for the lateral (form) gradient. Omit ⇒ derived. */
  shade?: string;
  /** Specular highlight colour (a wet-leaf catch). Omit ⇒ no specular. */
  specular?: string;
  /** Warm sub-surface colour for a back-lit blade. Omit ⇒ no glow. */
  translucent?: string;
  /** Mottle patches: ± lightness blotches. 0 disables. Default 0.5. */
  mottle?: number;
  /** Draw veins? Big blades want them, 8px moss blades do not. Default auto. */
  veins?: boolean;
  /**
   * Silhouette mode: skip every interior pass and fill flat. Used for the
   * darkest depth tier, where interior detail is invisible anyway and only
   * costs time and contrast.
   */
  flat?: boolean;
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
  // Detail budget. A 50px canopy blade earns every pass below; a 7px moss
  // blade earns almost none of them, and a mass contains thousands of the
  // latter — gating here is what keeps a lush shelf bakeable in reasonable
  // time without taking anything away from the leaves you can actually see.
  const big = o.len >= 22;
  const mid = o.len >= 13;
  const steps = o.steps ?? (o.len > 34 ? 28 : o.len > 14 ? 20 : 11);
  const opts: LeafGeometryOptions = { ...o, seed, steps };
  const outline = leafOutline(opts);
  const alpha = paint.alpha ?? 1;
  const lw = paint.lineWidth ?? 0.85;
  const back = backset(o.shape);
  const bend = o.bend ?? 0;
  const tip = axisPoint(1, o.len, back, bend);
  const halfW = o.width / 2;
  const rnd = mulberry32((seed * 0x9e3779b1) >>> 0);
  // Tight bounds for the full-blade gradient fills — filling a 3×len square
  // per pass is most of the cost of a leaf and none of the look.
  const bx = -o.len * back - 2;
  const by = -halfW - Math.abs(bend) - 2;
  const bw = o.len * (1 + back) + 4;
  const bh = halfW * 2 + Math.abs(bend) * 2 + 4;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  /* -- 1. form gradient: petiole (shaded) → body → tip (lit) --------------- */
  traceSmooth(ctx, outline, true);
  const g = ctx.createLinearGradient(-o.len * back, 0, tip.x, tip.y);
  g.addColorStop(0, paint.shade ?? paint.fillBase);
  g.addColorStop(0.22, paint.fillBase);
  g.addColorStop(0.72, paint.fillTip);
  g.addColorStop(1, paint.fillTip);
  ctx.fillStyle = g;
  ctx.fill();

  if (paint.flat) {
    // Silhouette tier: outline only, and only faintly, then out.
    ctx.strokeStyle = paint.ink;
    ctx.globalAlpha = alpha * 0.3;
    ctx.lineWidth = lw;
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Everything from here is clipped to the blade.
  ctx.save();
  traceSmooth(ctx, outline, true);
  ctx.clip();

  /* -- 2. lateral (form) gradient: the blade is a curved surface ----------- */
  // Perpendicular to the midrib, dark on the side away from the key.
  const la = paint.lightAngle ?? -0.8;
  const lx = Math.cos(la);
  const ly = Math.sin(la);
  if (paint.shade && mid) {
    const lg = ctx.createLinearGradient(
      o.len * 0.4 + lx * halfW * 1.5,
      ly * halfW * 1.5,
      o.len * 0.4 - lx * halfW * 1.5,
      -ly * halfW * 1.5,
    );
    lg.addColorStop(0, 'rgba(0,0,0,0)');
    lg.addColorStop(0.42, 'rgba(0,0,0,0)');
    lg.addColorStop(1, paint.shade);
    ctx.globalAlpha = alpha * 0.5;
    ctx.fillStyle = lg;
    ctx.fillRect(bx, by, bw, bh);
    ctx.globalAlpha = alpha;
  }

  /* -- 3. watercolour rim: wide inner stroke darkens the margin ------------ */
  traceSmooth(ctx, outline, true);
  ctx.strokeStyle = paint.ink;
  ctx.globalAlpha = alpha * 0.2;
  ctx.lineWidth = Math.max(2, o.width * 0.2);
  ctx.stroke();
  ctx.globalAlpha = alpha;

  /* -- 4. mottle: irregular patches of ± lightness ------------------------- */
  const mottle = paint.mottle ?? 0.5;
  if (mottle > 0.02 && big) {
    const patches = 2 + Math.floor(rnd() * 4);
    for (let i = 0; i < patches; i++) {
      const t = 0.15 + rnd() * 0.75;
      const a = axisPoint(t, o.len, back, bend);
      const side = rnd() < 0.5 ? 1 : -1;
      const w = leafProfile(o.shape, t, o.lobes ?? 2.5) * halfW;
      const up = rnd() < 0.5;
      ctx.globalAlpha = alpha * mottle * (0.08 + rnd() * 0.12);
      ctx.fillStyle = up ? (paint.sheen ?? paint.fillTip) : (paint.shade ?? paint.ink);
      ctx.beginPath();
      ctx.ellipse(
        a.x + (rnd() * 2 - 1) * o.len * 0.1,
        a.y + side * w * (0.1 + rnd() * 0.55),
        o.len * (0.1 + rnd() * 0.2),
        Math.max(1.2, w * (0.24 + rnd() * 0.42)),
        (rnd() * 2 - 1) * 0.8,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = alpha;
  }

  /* -- 5. variegation ------------------------------------------------------ */
  if (paint.variegation) {
    const vr = mulberry32((seed * 2654435761) >>> 0);
    ctx.fillStyle = paint.variegation;
    const blotches = 2 + Math.floor(vr() * 3);
    for (let i = 0; i < blotches; i++) {
      const t = 0.2 + vr() * 0.65;
      const a = axisPoint(t, o.len, back, bend);
      const side = vr() < 0.5 ? 1 : -1;
      const w = leafProfile(o.shape, t, o.lobes ?? 2.5) * halfW;
      ctx.globalAlpha = alpha * (0.3 + vr() * 0.3);
      ctx.beginPath();
      ctx.ellipse(
        a.x + (vr() * 2 - 1) * o.len * 0.08,
        a.y + side * w * (0.25 + vr() * 0.5),
        o.len * (0.1 + vr() * 0.16),
        Math.max(1, w * (0.28 + vr() * 0.36)),
        (vr() * 2 - 1) * 0.7,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = alpha;
  }

  /* -- 6. subsurface glow: sun coming through the blade -------------------- */
  if (paint.translucent && big) {
    const tg = ctx.createRadialGradient(
      o.len * 0.66,
      bend * 0.5,
      0,
      o.len * 0.66,
      bend * 0.5,
      o.len * 0.55,
    );
    tg.addColorStop(0, paint.translucent);
    tg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha * 0.42;
    ctx.fillStyle = tg;
    ctx.fillRect(bx, by, bw, bh);
    ctx.globalAlpha = alpha;
  }

  /* -- 7. fold shading for older, curled leaves ---------------------------- */
  const curl = clamp(o.curl ?? 0, 0, 0.75);
  if (curl > 0.05) {
    const axis = leafAxis(opts);
    const near = outline.slice(0, Math.floor(outline.length / 2));
    const fold = axis.concat([...near].reverse());
    traceSmooth(ctx, fold, true);
    ctx.fillStyle = paint.ink;
    ctx.globalAlpha = alpha * (0.12 + curl * 0.2);
    ctx.fill();
    ctx.globalAlpha = alpha;
  }

  /* -- 8. venation --------------------------------------------------------- */
  const wantVeins =
    paint.veins ?? (o.len > 12 && o.shape !== 'needle' && o.shape !== 'round');
  if (wantVeins) {
    const axis = leafAxis(opts);
    // Pale halo either side of the midrib: real leaves are lighter along it.
    if (big) {
      ctx.globalAlpha = alpha * 0.16;
      ctx.fillStyle = paint.sheen ?? paint.fillTip;
      traceTapered(ctx, axis, (t) => Math.max(0.5, o.width * 0.075 * (1 - t * 0.75)));
      ctx.fill();
    }
    // Midrib: a tapered ribbon, thick at the petiole.
    ctx.globalAlpha = alpha * 0.5;
    ctx.fillStyle = paint.vein;
    traceTapered(ctx, axis, (t) => Math.max(0.16, lw * 0.62 * (1 - t * 0.82)));
    ctx.fill();
    // Secondaries.
    const n = veinCount(o.shape, o.len);
    if (n > 0) {
      ctx.globalAlpha = alpha * 0.3;
      for (const v of leafVeins(opts, n)) {
        traceTapered(ctx, v, (t) => Math.max(0.12, lw * 0.4 * (1 - t * 0.7)));
        ctx.fill();
      }
    }
    // Tertiaries: short cross-hatches between secondaries on big blades only.
    if (o.len > 38) {
      ctx.globalAlpha = alpha * 0.14;
      for (let i = 0; i < 7; i++) {
        const t = 0.2 + rnd() * 0.6;
        const a = axisPoint(t, o.len, back, bend);
        const side = rnd() < 0.5 ? 1 : -1;
        const w = leafProfile(o.shape, t, o.lobes ?? 2.5) * halfW;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y + side * w * 0.25);
        ctx.quadraticCurveTo(
          a.x + o.len * 0.06,
          a.y + side * w * 0.55,
          a.x + o.len * 0.11,
          a.y + side * w * 0.8,
        );
        ctx.strokeStyle = paint.vein;
        ctx.lineWidth = lw * 0.3;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = alpha;
  }

  /* -- 9. sheen along the far shoulder ------------------------------------- */
  if (paint.sheen && big) {
    // Only the middle third of the flank facing the key, and softly — a full
    // pale stroke around the margin is what makes a leaf read as a sticker.
    const half = Math.floor(outline.length / 2);
    const flank = ly > 0 ? outline.slice(0, half) : outline.slice(half);
    const a0 = Math.floor(flank.length * 0.3);
    ctx.globalAlpha = alpha * 0.16;
    ctx.strokeStyle = paint.sheen;
    ctx.lineWidth = Math.max(1.2, o.width * 0.12);
    traceSmooth(ctx, flank.slice(a0, Math.floor(flank.length * 0.78)), false);
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  /* -- 10. specular: an elongated wet catch, off-axis ---------------------- */
  if (paint.specular && big) {
    const sx = o.len * 0.44 - lx * o.len * 0.1;
    const sy = bend * 0.34 - ly * halfW * 0.45;
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, o.len * 0.3);
    sg.addColorStop(0, paint.specular);
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(Math.atan2(bend, o.len) - 0.25);
    ctx.scale(1, 0.42);
    ctx.translate(-sx, -sy);
    ctx.globalAlpha = alpha * 0.5;
    ctx.fillStyle = sg;
    ctx.fillRect(bx - bw, by - bh, bw * 3, bh * 3);
    ctx.restore();
    ctx.globalAlpha = alpha;
  }

  ctx.restore(); // end clip

  /* -- 11. rim light on the edge facing the key ---------------------------- */
  if (paint.rim && o.len > 14) {
    // The lit flank is whichever half of the outline the light vector points
    // into. `near` is the +normal side; +normal ≈ (0,+1) rotated to the blade.
    const litNear = ly > 0;
    const half = Math.floor(outline.length / 2);
    const edge = litNear ? outline.slice(0, half) : outline.slice(half);
    ctx.save();
    // Clip so the rim sits *inside* the silhouette, never haloing outside it.
    traceSmooth(ctx, outline, true);
    ctx.clip();
    ctx.strokeStyle = paint.rim;
    ctx.globalAlpha = alpha * (paint.rimStrength ?? 0.75);
    ctx.lineWidth = Math.max(1, Math.min(2.6, o.width * 0.09));
    traceSmooth(ctx, edge, false);
    ctx.stroke();
    // A hotter, thinner core along the brightest third of that edge.
    const third = Math.floor(edge.length / 3);
    ctx.globalAlpha = alpha * (paint.rimStrength ?? 0.75) * 0.75;
    ctx.lineWidth = Math.max(0.6, o.width * 0.035);
    traceSmooth(ctx, edge.slice(third, third * 2 + 2), false);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = alpha;
  }

  /* -- 12. double-stroked pencil outline ----------------------------------- */
  ctx.strokeStyle = paint.ink;
  ctx.lineWidth = lw;
  ctx.globalAlpha = alpha * 0.3;
  traceSmooth(ctx, outline, true);
  ctx.stroke();
  // Heavier on the shaded flank only: a drawn line all the way round reads
  // as cartoon, a line that thickens into shadow reads as form.
  {
    const half = Math.floor(outline.length / 2);
    const shadeFlank = ly > 0 ? outline.slice(half) : outline.slice(0, half);
    ctx.globalAlpha = alpha * 0.4;
    ctx.lineWidth = lw * 1.5;
    traceSmooth(ctx, shadeFlank, false);
    ctx.stroke();
  }
  if (mid) {
    const outline2 = leafOutline({
      ...opts,
      seed: (seed ^ 0x9e3779b9) >>> 0,
      jitter: (o.jitter ?? 0.5) * 1.35,
    });
    ctx.lineWidth = lw * 0.7;
    ctx.globalAlpha = alpha * 0.3;
    traceSmooth(ctx, outline2, true);
    ctx.stroke();
  }

  ctx.restore();
}

/* ------------------------------- blossoms --------------------------------- */

export interface BlossomPaint {
  petalBase: string;
  petalTip: string;
  ink: string;
  centre: string;
  stamen: string;
  /** Darker ring behind the front petals. Omit ⇒ derived from petalBase. */
  petalBack?: string;
  /** Deep shadow in the flower's throat. Omit ⇒ no throat. */
  throat?: string;
  /** Rim light colour on petal edges facing the key. */
  rim?: string;
  /** Key direction in flower-local radians. */
  lightAngle?: number;
  /** Pollen highlight on the centre disc. */
  pollen?: string;
  /** Number of petals per ring. Default 5. */
  petals?: number;
  /** Draw a second, larger ring behind. Default true when r ≥ 7. */
  doubled?: boolean;
}

/**
 * A layered blossom centred on the origin. `open` ∈ [0,1] turns a tight bud
 * (0) into a fully-opened flower (1) — a cluster carries a mix of both.
 *
 * A flower at 20–40px needs structure, not five identical petals on a wheel:
 * a **back ring** (larger, darker, offset half a petal), a **throat shadow**,
 * a **front ring** (lit, rim-lit on the key side), a **centre disc** with a
 * ring of anthers and a pollen catch.
 */
export function drawBlossom(
  ctx: Ctx2D,
  r: number,
  open: number,
  seed: number,
  paint: BlossomPaint,
): void {
  const rnd: RandomFn = mulberry32(seed >>> 0);
  const petals = paint.petals ?? 5;
  const o = clamp(open, 0, 1);
  const doubled = paint.doubled ?? r >= 7;
  const la = paint.lightAngle ?? -0.8;
  ctx.save();
  const spin = rnd() * Math.PI * 2;
  ctx.rotate(spin);

  const drawRing = (
    scale: number,
    offset: number,
    base: string,
    tipC: string,
    rim: string | undefined,
    alpha: number,
  ): void => {
    for (let i = 0; i < petals; i++) {
      const a = ((i + offset) / petals) * Math.PI * 2 + (rnd() * 2 - 1) * 0.18;
      ctx.save();
      ctx.rotate(a);
      // Buds keep their petals furled: shorter, narrower, tilted forward.
      const len = r * scale * (0.66 + 0.44 * o) * (0.86 + rnd() * 0.28);
      const wid = r * scale * (0.62 + 0.72 * o) * (0.86 + rnd() * 0.3);
      drawLeaf(
        ctx,
        {
          shape: 'petal',
          len,
          width: wid,
          bend: (rnd() * 2 - 1) * r * 0.16,
          jitter: clamp(len * 0.035, 0.2, 0.6),
          seed: (seed * 31 + i + Math.round(offset * 7)) >>> 0,
          steps: 16,
        },
        {
          fillBase: base,
          fillTip: tipC,
          ink: paint.ink,
          vein: paint.ink,
          lineWidth: Math.max(0.5, len * 0.045),
          alpha,
          // Petal veins are radial creases — cheap and very legible at 20px+.
          veins: len > 7,
          mottle: 0.35,
          lightAngle: la - a - spin,
          rim,
          rimStrength: 0.55,
          shade: paint.petalBack,
        },
      );
      ctx.restore();
    }
  };

  // Back ring: bigger, darker, rotated half a petal so it peeks between.
  if (doubled && o > 0.45) {
    drawRing(
      1.22,
      0.5,
      paint.petalBack ?? paint.petalBase,
      paint.petalBase,
      undefined,
      0.95,
    );
  }

  // Throat: a soft dark well the front petals sit around.
  if (paint.throat && o > 0.4) {
    const tg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.62);
    tg.addColorStop(0, paint.throat);
    tg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
  }

  drawRing(1, 0, paint.petalBase, paint.petalTip, paint.rim, 1);

  // Centre disc + anthers, only once the flower has opened.
  if (o > 0.35) {
    const cr = r * (0.2 + 0.1 * o);
    const cg = ctx.createRadialGradient(-cr * 0.3, -cr * 0.3, 0, 0, 0, cr * 1.3);
    cg.addColorStop(0, paint.pollen ?? paint.centre);
    cg.addColorStop(0.6, paint.centre);
    cg.addColorStop(1, paint.stamen);
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(0, 0, cr, 0, Math.PI * 2);
    ctx.fill();
    // Anthers: little clubbed filaments radiating off the disc.
    const anthers = r > 9 ? 11 : 6;
    ctx.strokeStyle = paint.stamen;
    ctx.lineWidth = Math.max(0.4, r * 0.05);
    for (let i = 0; i < anthers; i++) {
      const a = (i / anthers) * Math.PI * 2 + rnd() * 0.4;
      const l = r * (0.26 + rnd() * 0.22) * o;
      const ex = Math.cos(a) * l;
      const ey = Math.sin(a) * l;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * cr * 0.6, Math.sin(a) * cr * 0.6);
      ctx.quadraticCurveTo(ex * 0.6, ey * 0.6 - r * 0.06, ex, ey);
      ctx.stroke();
      if (r > 8) {
        ctx.fillStyle = paint.pollen ?? paint.centre;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(ex, ey, Math.max(0.5, r * 0.05), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    // Pollen catch: the brightest point on the whole flower.
    if (paint.pollen && r > 7) {
      const pg = ctx.createRadialGradient(-cr * 0.3, -cr * 0.32, 0, -cr * 0.3, -cr * 0.32, cr * 0.5);
      pg.addColorStop(0, paint.pollen);
      pg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = pg;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(-cr * 0.3, -cr * 0.32, cr * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

/**
 * A bell/trumpet flower seen from the side — foxglove, morning glory, fuchsia.
 * Clusters built only from face-on discs read as a polka-dot pattern; a couple
 * of bells per cluster is what sells it as a plant.
 */
export function drawBellFlower(
  ctx: Ctx2D,
  r: number,
  open: number,
  seed: number,
  paint: BlossomPaint,
): void {
  const rnd = mulberry32(seed >>> 0);
  const o = clamp(open, 0.15, 1);
  const len = r * (1.5 + o * 0.5);
  const mouth = r * (0.5 + o * 0.65);
  ctx.save();
  // Body: a tapered tube flaring to the mouth.
  const body: Pt[] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const w = lerp(r * 0.18, mouth, Math.pow(t, 1.7)) * (1 + 0.06 * Math.sin(t * 9 + rnd() * 0.01));
    body.push({ x: t * len, y: -w });
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const w = lerp(r * 0.18, mouth, Math.pow(t, 1.7));
    body.push({ x: t * len, y: w });
  }
  traceSmooth(ctx, body, true);
  const g = ctx.createLinearGradient(0, -mouth, len, mouth);
  g.addColorStop(0, paint.petalBack ?? paint.petalBase);
  g.addColorStop(0.55, paint.petalBase);
  g.addColorStop(1, paint.petalTip);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Longitudinal creases.
  ctx.strokeStyle = paint.ink;
  ctx.globalAlpha = 0.16;
  ctx.lineWidth = Math.max(0.5, r * 0.06);
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(r * 0.14, i * r * 0.06);
    ctx.quadraticCurveTo(len * 0.6, i * mouth * 0.4, len, i * mouth * 0.42);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  // Mouth: a dark ellipse with a lit lower lip.
  ctx.beginPath();
  ctx.ellipse(len, 0, mouth * 0.36, mouth, 0, 0, Math.PI * 2);
  ctx.fillStyle = paint.throat ?? paint.ink;
  ctx.globalAlpha = 0.8;
  ctx.fill();
  ctx.globalAlpha = 1;
  // Scalloped lobes around the mouth.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    ctx.save();
    ctx.translate(len, 0);
    ctx.beginPath();
    ctx.ellipse(
      Math.cos(a) * mouth * 0.1,
      Math.sin(a) * mouth * 0.78,
      mouth * 0.3,
      mouth * 0.34,
      a,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = paint.petalTip;
    ctx.globalAlpha = 0.92;
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  if (paint.rim) {
    ctx.strokeStyle = paint.rim;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(0.7, r * 0.09);
    ctx.beginPath();
    ctx.moveTo(r * 0.2, -r * 0.2);
    ctx.quadraticCurveTo(len * 0.6, -mouth * 0.72, len, -mouth * 0.92);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = paint.ink;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = Math.max(0.5, r * 0.07);
  traceSmooth(ctx, body, true);
  ctx.stroke();
  ctx.restore();
}

/**
 * A many-floret dome — hydrangea, lilac, cow-parsley. One call paints 18–40
 * tiny florets over a shaded ball, which is how a real cluster reads at
 * distance: a *mass* with texture, not countable flowers.
 */
export function drawFloretDome(
  ctx: Ctx2D,
  r: number,
  seed: number,
  paint: BlossomPaint,
): void {
  const rnd = mulberry32(seed >>> 0);
  const la = paint.lightAngle ?? -0.8;
  ctx.save();
  // Shaded ball underneath, so gaps between florets read as depth.
  const bg = ctx.createRadialGradient(
    Math.cos(la) * r * 0.3,
    Math.sin(la) * r * 0.3,
    r * 0.1,
    0,
    0,
    r,
  );
  bg.addColorStop(0, paint.petalBase);
  bg.addColorStop(1, paint.petalBack ?? paint.ink);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.96, 0, Math.PI * 2);
  ctx.fill();

  const florets = Math.round(clamp(r * 1.6, 14, 46));
  for (let i = 0; i < florets; i++) {
    // Sunflower packing keeps them even but never gridded.
    const k = (i + 0.5) / florets;
    const rad = r * 0.92 * Math.sqrt(k) * (0.86 + rnd() * 0.24);
    const a = i * 2.399963 + rnd() * 0.3;
    const fx = Math.cos(a) * rad;
    const fy = Math.sin(a) * rad * 0.94;
    // Lit on the key side, shaded away from it.
    const lit = clamp((fx * Math.cos(la) + fy * Math.sin(la)) / r, -1, 1);
    const fr = r * (0.15 + rnd() * 0.1);
    ctx.save();
    ctx.translate(fx, fy);
    ctx.globalAlpha = 0.94;
    for (let p = 0; p < 4; p++) {
      const pa = (p / 4) * Math.PI * 2 + a;
      ctx.beginPath();
      ctx.ellipse(
        Math.cos(pa) * fr * 0.55,
        Math.sin(pa) * fr * 0.55,
        fr * 0.62,
        fr * 0.5,
        pa,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = lit > 0.15 ? paint.petalTip : lit < -0.3 ? (paint.petalBack ?? paint.petalBase) : paint.petalBase;
      ctx.fill();
    }
    ctx.fillStyle = paint.centre;
    ctx.beginPath();
    ctx.arc(0, 0, fr * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  // Rim along the key edge of the dome.
  if (paint.rim) {
    ctx.strokeStyle = paint.rim;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.9, la - 1.1, la + 1.1);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
