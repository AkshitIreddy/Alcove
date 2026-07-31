/**
 * art/flat.ts — the app's one drawing vocabulary.
 *
 * Everything visible in the shelf world is built from the primitives here, in
 * the style of the app icon (`assets/brand/icon.svg`): flat colour, a thick
 * dark outline, corners that are always rounded, and edges that wobble just
 * enough to read as drawn by hand rather than by a rectangle function.
 *
 * ## Why this replaces the painting engine
 *
 * The previous approach tried to earn beauty from simulation — a brush engine
 * stamping thousands of dabs, procedural wood and foliage, a deferred
 * lighting pass, generated photoreal materials. It cost seconds of startup and
 * still read as cheap, because a half-simulated surface sits in the uncanny
 * gap between "drawing" and "photograph" and gets no credit from either.
 *
 * A flat illustration makes no such promise, so it never breaks it. The icon
 * already proved the style works at any size, and it costs a few dozen path
 * fills per floor instead of a million pixel writes.
 *
 * ## The rules, taken from the icon
 *
 * - **One outline colour.** Every shape is bounded by INK. Not a darker shade
 *   of itself — the same brown, everywhere. That single choice is most of why
 *   the icon reads as one drawing rather than a pile of clip art.
 * - **Outline weight scales with the shape**, roughly 1.5% of its short side,
 *   so a book spine and a whole bookcase feel drawn by the same pen.
 * - **Fills are flat.** No gradients, no texture, no lighting. Depth comes
 *   from a darker flat face (the icon's spine beside its cover) and one soft
 *   contact shadow — never from a light model.
 * - **Nothing is axis-true.** Every long edge bows by a hair.
 */

/* ----------------------------------------------------------------------------
   Palette
   -------------------------------------------------------------------------- */

/**
 * The whole app's colour vocabulary, lifted from the icon.
 *
 * Deliberately tiny. A short palette used consistently is what makes a set of
 * flat shapes look designed; the previous themes offered dozens of colourways
 * and every room ended up a slightly different mud.
 */
export const FLAT = {
  /** The one outline colour. Everything is drawn with this. */
  ink: '#4f3120',
  /** Softer ink for marks *inside* a shape (label ruling, small detail). */
  inkSoft: '#6b4a32',

  /** Book cloth / case body. */
  terracotta: '#c96f4a',
  terracottaDark: '#a8552f',
  /** Paper, labels, page block. */
  cream: '#f7f1e3',
  creamDeep: '#eee2c8',
  /** Gilt bands and small ornament. */
  gilt: '#e8b64c',
  giltPale: '#f0d9a8',
  /** The ribbon green. */
  moss: '#7d915c',
  mossDark: '#4f6138',

  /** Additional book cloths, same saturation and value as the terracotta. */
  slate: '#5f7d8c',
  slateDark: '#456170',
  plum: '#8a5a72',
  plumDark: '#6d4359',
  ochre: '#c9973f',
  ochreDark: '#a4762a',
  sage: '#8a9a6b',
  sageDark: '#6b7a4e',

  /** Case timber. */
  timber: '#c08a52',
  timberDark: '#9d6b3c',
  /** Inside the case, behind the books — always darker than the timber. */
  recess: '#7d5638',

  /** The wall. One flat colour; it is a backdrop, not a subject. */
  wall: '#e9e2d0',

  /** Contact shadow. Used at low alpha, never as a light model. */
  shadow: '#5d3a26',
} as const;

/** Every book-cloth colour, as [face, darker edge] pairs. */
export const CLOTHS: readonly (readonly [string, string])[] = [
  [FLAT.terracotta, FLAT.terracottaDark],
  [FLAT.slate, FLAT.slateDark],
  [FLAT.plum, FLAT.plumDark],
  [FLAT.ochre, FLAT.ochreDark],
  [FLAT.sage, FLAT.sageDark],
  [FLAT.moss, FLAT.mossDark],
];

/* ----------------------------------------------------------------------------
   Geometry
   -------------------------------------------------------------------------- */

/** The 2D context shape we draw into (canvas or offscreen). */
export type FlatCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Outline weight for a shape of the given short side.
 *
 * The icon strokes a 760px cover at 16px — about 2% — and the confidence of
 * that line is most of the style. A purely proportional rule fails on the
 * shelf, though: a book spine is ~25px wide, 2% of which is half a pixel, and
 * the first specimen came back looking like a watercolour of the icon rather
 * than the icon. So the FLOOR is what matters at shelf scale, and it is set
 * where a small object still reads as outlined.
 */
export function inkWidth(shortSide: number): number {
  return Math.max(2, Math.min(10, shortSide * 0.02));
}

/**
 * A deterministic wobble in [-1, 1] from an integer.
 *
 * Hand-drawn means *not straight*, but it must also mean *the same every
 * frame* — a shelf whose edges shimmered as you panned would be far worse
 * than one drawn with a ruler.
 */
function jitter(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Trace a rounded rectangle whose edges bow slightly outward.
 *
 * `bow` is the deflection at the middle of each side in pixels; the icon uses
 * roughly 0.5% of the side's length, which is invisible as a curve and
 * unmistakable as a feeling.
 */
export function wobbleRect(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  seed = 1,
  bow = Math.min(w, h) * 0.012,
): void {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  const b = (n: number): number => jitter(seed + n) * bow;

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  // top
  ctx.quadraticCurveTo(x + w / 2, y + b(1), x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  // right
  ctx.quadraticCurveTo(x + w + b(2), y + h / 2, x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  // bottom
  ctx.quadraticCurveTo(x + w / 2, y + h + b(3), x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  // left
  ctx.quadraticCurveTo(x + b(4), y + h / 2, x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* ----------------------------------------------------------------------------
   The three marks everything is made of
   -------------------------------------------------------------------------- */

/** Flat-filled, ink-outlined rounded rectangle. The workhorse. */
export function panel(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  opts: { radius?: number; seed?: number; ink?: string; width?: number } = {},
): void {
  const radius = opts.radius ?? Math.min(w, h) * 0.16;
  wobbleRect(ctx, x, y, w, h, radius, opts.seed ?? 1);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = opts.ink ?? FLAT.ink;
  ctx.lineWidth = opts.width ?? inkWidth(Math.min(w, h));
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/**
 * A hand-drawn line: rounded caps, a single bow, no dead-straight run.
 * Used for gilt bands, label ruling and plank edges.
 */
export function stroke(
  ctx: FlatCtx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colour: string,
  width: number,
  seed = 1,
): void {
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const bow = jitter(seed) * len * 0.006;
  // Deflect perpendicular to the line, so the bow reads the same whether the
  // stroke is horizontal, vertical or neither.
  const nx = -(y1 - y0) / (len || 1);
  const ny = (x1 - x0) / (len || 1);

  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(mx + nx * bow, my + ny * bow, x1, y1);
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/**
 * The one shadow in the app: a soft flat ellipse under an object.
 *
 * Not a light model, and deliberately not derived from any light direction —
 * it says "this sits on that" and nothing more. The icon uses exactly one,
 * at 28% opacity.
 */
export function contactShadow(
  ctx: FlatCtx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  alpha = 0.22,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = FLAT.shadow;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
