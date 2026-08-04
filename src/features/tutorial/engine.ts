/**
 * src/features/tutorial/engine.ts — the guided tour's pure brain.
 *
 * Everything here is DOM-free and deterministic so the unit suite (node
 * environment — jsdom is not installed) can cover the hard parts: where the
 * speech card lands, which way the pencil arrow bows, the shape of the
 * spotlight hole, and how navigation skips steps whose target vanished.
 *
 * Hand-drawn look comes from a seeded xorshift RNG: the same step always
 * wobbles the same way (no jitter-per-frame shimmer), but every step looks
 * like a different pencil stroke.
 */

// ---------------------------------------------------------------------------
// Geometry primitives
// ---------------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Which side of the target the speech card sits on. */
export type Side = 'top' | 'bottom' | 'left' | 'right';

/**
 * Fractional inset applied to a resolved target rect, so a step can spotlight
 * a *patch* of a full-viewport element (e.g. one book on the shelf canvas).
 * Values are fractions of the rect's width/height, clamped to [0, 0.9]; a pair
 * that would invert the rect is caught by the 8px floor in `applyInset`.
 */
export interface Inset {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/** Round to 2dp and stringify — keeps generated path data short + stable. */
function n(value: number): string {
  const r = Math.round(value * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function inflateRect(rect: Rect, pad: number): Rect {
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    width: Math.max(0, rect.width + pad * 2),
    height: Math.max(0, rect.height + pad * 2),
  };
}

/**
 * Per-side padding in px. Symmetric `pad` cannot express "reach 44px left to
 * swallow the drag-handle gutter but stay tight on the other three sides",
 * which is exactly what a step highlighting one editor block needs.
 */
export interface PadBox {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/** Grow a rect by a different amount on each side. Never inverts. */
export function inflateBox(rect: Rect, pad: PadBox | undefined): Rect {
  if (pad === undefined) return rect;
  const top = pad.top ?? 0;
  const right = pad.right ?? 0;
  const bottom = pad.bottom ?? 0;
  const left = pad.left ?? 0;
  return {
    x: rect.x - left,
    y: rect.y - top,
    width: Math.max(0, rect.width + left + right),
    height: Math.max(0, rect.height + top + bottom),
  };
}

/** Shrink a rect by fractional insets. Never collapses below 8×8. */
export function applyInset(rect: Rect, inset: Inset | number | undefined): Rect {
  if (inset === undefined) return rect;
  const f =
    typeof inset === 'number'
      ? { top: inset, right: inset, bottom: inset, left: inset }
      : inset;
  const top = clamp(f.top ?? 0, 0, 0.9) * rect.height;
  const bottom = clamp(f.bottom ?? 0, 0, 0.9) * rect.height;
  const left = clamp(f.left ?? 0, 0, 0.9) * rect.width;
  const right = clamp(f.right ?? 0, 0, 0.9) * rect.width;
  return {
    x: rect.x + left,
    y: rect.y + top,
    width: Math.max(8, rect.width - left - right),
    height: Math.max(8, rect.height - top - bottom),
  };
}

/**
 * Trim a spotlight to the visible viewport.
 *
 * A target can genuinely run off screen — the shelf band on a zoomed-in case,
 * a rail taller than a short window — and a ring drawn around it then has one
 * or two edges beyond the glass, which reads as a broken frame rather than a
 * box. Trimming keeps every highlight a closed rounded rect. A target that is
 * almost entirely off screen is left alone: there is nothing useful to frame,
 * and the caller's own visibility test will have rejected it anyway.
 */
export function clipRectToViewport(rect: Rect, vp: Size, margin = 6): Rect {
  const x0 = Math.max(rect.x, margin);
  const y0 = Math.max(rect.y, margin);
  const x1 = Math.min(rect.x + rect.width, vp.width - margin);
  const y1 = Math.min(rect.y + rect.height, vp.height - margin);
  if (x1 - x0 < 24 || y1 - y0 < 24) return rect;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Slide (never resize) a rect so it sits inside the viewport with a margin. */
export function clampToViewport(rect: Rect, vp: Size, margin = 12): Rect {
  const maxX = Math.max(margin, vp.width - rect.width - margin);
  const maxY = Math.max(margin, vp.height - rect.height - margin);
  return {
    ...rect,
    x: clamp(rect.x, margin, maxX),
    y: clamp(rect.y, margin, maxY),
  };
}

// ---------------------------------------------------------------------------
// Card placement
// ---------------------------------------------------------------------------

const SIDES: readonly Side[] = ['bottom', 'top', 'right', 'left'];

/** Free space between the target rect and the viewport edge, per side. */
export function sideSpace(anchor: Rect, vp: Size): Record<Side, number> {
  return {
    top: anchor.y,
    bottom: vp.height - (anchor.y + anchor.height),
    left: anchor.x,
    right: vp.width - (anchor.x + anchor.width),
  };
}

/**
 * Pick the side for the card: the preferred side when it fits, otherwise the
 * side with the most room. Always returns a side (never throws) so a target
 * pinned to a corner still gets a placement.
 */
export function chooseSide(
  anchor: Rect,
  vp: Size,
  card: Size,
  gap = 22,
  preferred?: Side,
): Side {
  const space = sideSpace(anchor, vp);
  const need = (side: Side): number =>
    side === 'top' || side === 'bottom' ? card.height + gap : card.width + gap;
  if (preferred !== undefined && space[preferred] >= need(preferred)) {
    return preferred;
  }
  let best: Side = SIDES[0];
  let bestScore = -Infinity;
  for (const side of SIDES) {
    const score = space[side] - need(side);
    if (score > bestScore) {
      bestScore = score;
      best = side;
    }
  }
  return best;
}

/** Overlapping area of two rects (0 when they miss each other). */
export function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Unclamped card rect for a given side. */
function rawCardRect(anchor: Rect, card: Size, side: Side, gap: number): Rect {
  const center = rectCenter(anchor);
  if (side === 'top') {
    return {
      x: center.x - card.width / 2,
      y: anchor.y - gap - card.height,
      ...card,
    };
  }
  if (side === 'bottom') {
    return {
      x: center.x - card.width / 2,
      y: anchor.y + anchor.height + gap,
      ...card,
    };
  }
  if (side === 'left') {
    return { x: anchor.x - gap - card.width, y: center.y - card.height / 2, ...card };
  }
  return { x: anchor.x + anchor.width + gap, y: center.y - card.height / 2, ...card };
}

/**
 * Where the card goes, and which side of the target it ended up on.
 *
 * Clamping a card back inside the viewport can drag it on top of the very
 * thing it points at (a wide spotlight near the right edge, say). So every
 * side is costed by how much of the target its *clamped* rect would cover;
 * the preferred side, then `chooseSide`'s answer, break ties. The card
 * therefore never sits on the spotlight while another side is free.
 */
export function placeCard(
  anchor: Rect,
  vp: Size,
  card: Size,
  options: { gap?: number; margin?: number; preferred?: Side } = {},
): { rect: Rect; side: Side } {
  const gap = options.gap ?? 22;
  const margin = options.margin ?? 16;
  const fallback = chooseSide(anchor, vp, card, gap, options.preferred);
  let best: { rect: Rect; side: Side } | null = null;
  let bestScore = Infinity;
  for (const side of SIDES) {
    const rect = clampToViewport(rawCardRect(anchor, card, side, gap), vp, margin);
    const tieBreak = side === options.preferred ? 0 : side === fallback ? 0.5 : 1;
    const score = intersectionArea(rect, anchor) + tieBreak;
    if (score < bestScore) {
      bestScore = score;
      best = { rect, side };
    }
  }
  // SIDES is non-empty, so `best` is always assigned; the fallback keeps TS
  // (and a future refactor) honest.
  return best ?? {
    rect: clampToViewport(rawCardRect(anchor, card, fallback, gap), vp, margin),
    side: fallback,
  };
}

// ---------------------------------------------------------------------------
// The side sheet's lane
// ---------------------------------------------------------------------------

/**
 * A hand's width between the sheet's edge and anything stepping aside for it.
 * The same gap `rail.css` gives the back arrow and the settings seal, so the
 * three things that clear a sheet clear it by the same amount.
 */
export const LANE_GAP = 14;

/**
 * Slide a card out of the strip a side sheet is standing in.
 *
 * THE REPORTED BUG: the In-and-out step asks the reader to open a sheet, and
 * then parks its own card exactly where that sheet arrives — the tour layer is
 * `--z-toasts` (400) and a rail sheet is `--z-menus` (300), so the card is not
 * hidden BY the sheet, it is sitting ON it. Measured on the running app: card
 * at x=134 across a sheet spanning 68..408. Every word the step had just
 * written about the rows in that sheet was covering them.
 *
 * `views/rail/panelPush.ts` already publishes where the sheet's right side
 * lands (`--nb-panel-edge`), which is the number the back arrow reads to get
 * out of the same lane. The tour reads it too and never writes it.
 *
 * Three things it will not do. It will not pull the card LEFT (a card that
 * already clears the sheet is where the placement wanted it). It will not push
 * the card off the right of the window — a card half over a sheet is bad, a
 * card off screen is worse — so it stops at the last position that still fits
 * and takes whatever clearance that buys. And with nothing open (`edge` 0) it
 * is the identity, which is every step of the tour but a handful.
 */
export function clearPanelLane(
  rect: Rect,
  vp: Size,
  edge: number,
  gap = LANE_GAP,
  margin = 12,
): Rect {
  if (!(edge > 0)) return rect;
  const want = edge + gap;
  if (rect.x >= want) return rect;
  const maxX = Math.max(margin, vp.width - rect.width - margin);
  const x = Math.min(want, maxX);
  return x > rect.x ? { ...rect, x } : rect;
}

/**
 * Would a pencil arrow between these two points have to cross the sheet?
 *
 * It would be drawn OVER it — the tour layer is above the rail's — so the
 * reader gets a stroke scrawled across the panel they were just told to read.
 * The ring around the target already says "this thing"; the arrow is the part
 * that has to stand down, exactly as it does when the run is too short to read
 * as a gesture.
 */
export function crossesPanelLane(from: Point, to: Point, edge: number): boolean {
  if (!(edge > 0)) return false;
  // Two pixels of tolerance, because the commonest arrow of all is the one
  // from a card standing beside the sheet to the SHEET — its far end lands on
  // the sheet's own boundary, and an exact comparison would call touching the
  // edge "crossing it" and delete the arrow the reader most needs.
  const inside = (p: Point): boolean => p.x < edge - 2;
  return inside(from) !== inside(to);
}

/** Card with no target: a little above optical centre of the viewport. */
export function centerCard(vp: Size, card: Size): Rect {
  return clampToViewport(
    {
      x: (vp.width - card.width) / 2,
      y: (vp.height - card.height) / 2 - vp.height * 0.04,
      width: card.width,
      height: card.height,
    },
    vp,
  );
}

/**
 * Point on `rect`'s perimeter nearest `toward`, biased to the edge facing it.
 * Used for both ends of the pencil arrow (card edge → target edge).
 */
export function edgePointToward(rect: Rect, toward: Point): Point {
  const c = rectCenter(rect);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  // Scale the direction vector until it hits the rect boundary.
  const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

// ---------------------------------------------------------------------------
// Seeded wobble
// ---------------------------------------------------------------------------

/** xorshift32 — deterministic, fast, good enough for pencil jitter. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  if (s === 0) s = 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

/** Turn a step id into a stable 32-bit seed. */
export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Paths — pencil arrow + spotlight hole
// ---------------------------------------------------------------------------

/**
 * Emit a smooth path through `points` as a chain of quadratic segments
 * (each point is a control point, midpoints are the on-curve joins). Reads
 * like one confident pencil stroke rather than a polyline.
 */
export function smoothPath(points: readonly Point[], close = false): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${n(points[0].x)} ${n(points[0].y)}`;
  if (points.length === 2) {
    return `M ${n(points[0].x)} ${n(points[0].y)} L ${n(points[1].x)} ${n(points[1].y)}`;
  }
  const parts: string[] = [];
  if (close) {
    const first = points[0];
    const last = points[points.length - 1];
    parts.push(`M ${n((last.x + first.x) / 2)} ${n((last.y + first.y) / 2)}`);
    for (let i = 0; i < points.length; i += 1) {
      const cur = points[i];
      const next = points[(i + 1) % points.length];
      parts.push(
        `Q ${n(cur.x)} ${n(cur.y)} ${n((cur.x + next.x) / 2)} ${n((cur.y + next.y) / 2)}`,
      );
    }
    parts.push('Z');
    return parts.join(' ');
  }
  parts.push(`M ${n(points[0].x)} ${n(points[0].y)}`);
  for (let i = 1; i < points.length - 1; i += 1) {
    const cur = points[i];
    const next = points[i + 1];
    parts.push(
      `Q ${n(cur.x)} ${n(cur.y)} ${n((cur.x + next.x) / 2)} ${n((cur.y + next.y) / 2)}`,
    );
  }
  const last = points[points.length - 1];
  parts.push(`L ${n(last.x)} ${n(last.y)}`);
  return parts.join(' ');
}

export interface ArrowOptions {
  /** Perpendicular bow as a fraction of the run length. */
  bow?: number;
  /** How many sample points along the stroke. */
  segments?: number;
  /** Max perpendicular pencil wobble, in px. */
  wobble?: number;
}

/** Sample a bowed, hand-wobbled stroke from `from` to `to`. */
export function arrowPoints(
  from: Point,
  to: Point,
  seed: number,
  options: ArrowOptions = {},
): Point[] {
  const segments = Math.max(3, Math.round(options.segments ?? 9));
  const bow = options.bow ?? 0.2;
  const wobble = options.wobble ?? 1.7;
  const rng = seededRandom(seed);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  // Unit perpendicular; flip per-seed so arrows don't all curve the same way.
  const flip = rng() < 0.5 ? -1 : 1;
  const px = (-dy / dist) * flip;
  const py = (dx / dist) * flip;
  const bowAmount = dist * bow;
  const points: Point[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    // Parabolic bow: zero at both ends, max in the middle.
    const arc = Math.sin(Math.PI * t) * bowAmount;
    // Endpoints stay exact so the arrow always touches card and target.
    const edge = i === 0 || i === segments ? 0 : 1;
    const jx = (rng() * 2 - 1) * wobble * edge;
    const jy = (rng() * 2 - 1) * wobble * edge;
    points.push({
      x: from.x + dx * t + px * arc + jx,
      y: from.y + dy * t + py * arc + jy,
    });
  }
  return points;
}

/** The stroke path for a pencil arrow. */
export function arrowPath(
  from: Point,
  to: Point,
  seed: number,
  options: ArrowOptions = {},
): string {
  return smoothPath(arrowPoints(from, to, seed, options));
}

/**
 * Two short barbs at the arrow's tip, angled off the incoming direction.
 * Returned as one path so it can share the stroke style.
 */
export function arrowHeadPath(
  points: readonly Point[],
  seed: number,
  length = 13,
): string {
  if (points.length < 2) return '';
  const tip = points[points.length - 1];
  const prev = points[points.length - 2];
  const angle = Math.atan2(tip.y - prev.y, tip.x - prev.x);
  const rng = seededRandom(seed ^ 0x5bf03635);
  const spread = 0.42 * Math.PI;
  const parts: string[] = [];
  for (const dir of [-1, 1]) {
    const a = angle + Math.PI + dir * spread + (rng() * 2 - 1) * 0.12;
    const len = length * (0.86 + rng() * 0.3);
    const end = { x: tip.x + Math.cos(a) * len, y: tip.y + Math.sin(a) * len };
    const mid = {
      x: (tip.x + end.x) / 2 + (rng() * 2 - 1) * 1.2,
      y: (tip.y + end.y) / 2 + (rng() * 2 - 1) * 1.2,
    };
    parts.push(
      `M ${n(tip.x)} ${n(tip.y)} Q ${n(mid.x)} ${n(mid.y)} ${n(end.x)} ${n(end.y)}`,
    );
  }
  return parts.join(' ');
}

/**
 * A straight rounded rectangle, corners as true quarter-circle arcs.
 *
 * The spotlight used to be a hand-traced ring: perimeter samples with a
 * seeded wobble, smoothed into quadratics. On a 60px rail button that reads
 * as charm; on a 900px page it reads as a broken line with dented corners and
 * edges that drift a couple of pixels off the thing they are supposed to be
 * framing. Every highlight is now a plain rounded rect — the hand-drawn voice
 * of this app lives in the card, the arrow and the icons, not in a frame whose
 * whole job is to say "exactly this box".
 */
export function roundedRectPath(rect: Rect, radius: number): string {
  const w = Math.max(0, rect.width);
  const h = Math.max(0, rect.height);
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const x0 = rect.x;
  const y0 = rect.y;
  const x1 = rect.x + w;
  const y1 = rect.y + h;
  if (r === 0) {
    return `M ${n(x0)} ${n(y0)} H ${n(x1)} V ${n(y1)} H ${n(x0)} Z`;
  }
  return [
    `M ${n(x0 + r)} ${n(y0)}`,
    `H ${n(x1 - r)}`,
    `A ${n(r)} ${n(r)} 0 0 1 ${n(x1)} ${n(y0 + r)}`,
    `V ${n(y1 - r)}`,
    `A ${n(r)} ${n(r)} 0 0 1 ${n(x1 - r)} ${n(y1)}`,
    `H ${n(x0 + r)}`,
    `A ${n(r)} ${n(r)} 0 0 1 ${n(x0)} ${n(y1 - r)}`,
    `V ${n(y0 + r)}`,
    `A ${n(r)} ${n(r)} 0 0 1 ${n(x0 + r)} ${n(y0)}`,
    'Z',
  ].join(' ');
}

/** Closed path around the spotlight hole (also the ring stroke). */
export function holePath(rect: Rect, radius: number): string {
  return roundedRectPath(rect, radius);
}

/**
 * The scrim: a full-viewport rect with the hole subtracted. Fill it with
 * `fill-rule: evenodd` and everything but the target dims.
 */
export function spotlightPath(hole: Rect, vp: Size, radius: number): string {
  const outer = `M 0 0 H ${n(vp.width)} V ${n(vp.height)} H 0 Z`;
  return `${outer} ${roundedRectPath(hole, radius)}`;
}

/** Scrim with no hole at all (anchorless steps dim the whole world). */
export function solidScrimPath(vp: Size): string {
  return `M 0 0 H ${n(vp.width)} V ${n(vp.height)} H 0 Z`;
}

// ---------------------------------------------------------------------------
// Beats
// ---------------------------------------------------------------------------

/**
 * How long the green "you did it" state holds on an ordinary step before the
 * tour walks on. Long enough to read the line and see the tick draw; short
 * enough that finishing a step feels like it moved you forward.
 */
export const CELEBRATE_MS = 1500;

/** With motion off there is no tick to watch draw, so do not sit there. */
export const CELEBRATE_SNAP_MS = 450;

/**
 * How long to hold before advancing, given the step's own `dwell` and the
 * motion preference.
 *
 * THE REPORTED BUG: a step whose whole lesson is a PANEL ("open the studio —
 * the palette on the shelf rail") went green the instant the panel appeared,
 * and 1.2s later the tour advanced and `dismissStale` shut the panel again.
 * Measured: visible at 488ms, gone at 1696ms. The reader was asked to open a
 * drawer and then had it closed in their face before they could look in it.
 *
 * A step that teaches a surface therefore names its own `dwell`, and that
 * number is READING TIME, not movement — so, exactly as `styles/motion.ts`
 * says of `LINGER_MS`, it is never multiplied by the motion scale and does not
 * collapse to nothing when animation is switched off. Someone who turned
 * animation off still needs the same beat to read a panel.
 *
 * Only the default beat, which exists to let a bit of choreography play, is
 * scaled.
 */
export function celebrateDelay(dwell: number | undefined, motion: number): number {
  if (dwell !== undefined) return Math.max(CELEBRATE_SNAP_MS, dwell);
  if (motion <= 0) return CELEBRATE_SNAP_MS;
  return CELEBRATE_MS * Math.max(0.6, motion);
}

/**
 * The countdown ring: how much of the beat is still to run, 1 → 0.
 *
 * THE POINT OF THE RING IS THAT IT IS TRUE. The tour walks on by itself and
 * never said so, which reads either as a bug or as the app taking the screen
 * away — so the card now shows the beat draining. That only helps if the ring
 * and the timeout are the SAME number: `celebrateDelay` is called once, its
 * answer is handed to `setTimeout` and to this, and nothing anywhere writes a
 * second duration. A ring animating for a designed 1.5s beside a timer that
 * fires at 5s would be a more confident lie than saying nothing.
 *
 * Clamped at both ends because `now` comes from the rAF clock: a frame can land
 * a hair before the timer was armed, and a tab that was backgrounded lands
 * whole seconds after it should have fired.
 */
export function advanceRemaining(now: number, started: number, total: number): number {
  if (!(total > 0)) return 0;
  const left = 1 - (now - started) / total;
  return left < 0 ? 0 : left > 1 ? 1 : left;
}

/** Radius of the countdown ring, in its own 26×26 viewBox. */
export const ADVANCE_RING_RADIUS = 9.4;

/** Its circumference — the dash length that draws the whole circle. */
export const ADVANCE_RING_LENGTH = 2 * Math.PI * ADVANCE_RING_RADIUS;

/**
 * Dash offset that leaves `remaining` of the ring drawn. Full circle at 1,
 * nothing at 0, so the arc empties as the beat runs out.
 */
export function ringOffset(remaining: number, length = ADVANCE_RING_LENGTH): number {
  const r = remaining < 0 ? 0 : remaining > 1 ? 1 : remaining;
  return length * (1 - r);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export type TutorialAction = 'next' | 'back' | 'skip';

/**
 * Keyboard contract: Enter advances, Esc leaves. That is the whole list.
 *
 * The tour used to swallow Space, the arrow keys, Backspace and PageUp/Down
 * as navigation. Every one of those is a key the reader needs for the thing
 * the tour is asking them to do: Space types a word break on the "write
 * something" step, ← → turn the page on the page-turning step, Backspace
 * fixes a typo. A guided tour that eats the keys it is teaching is worse than
 * no tour, so navigation now belongs to the buttons — plus Enter, which the
 * card's own focused button owns anyway, and Esc, which must always work.
 */
export function keyAction(key: string): TutorialAction | null {
  switch (key) {
    case 'Enter':
      return 'next';
    case 'Escape':
    case 'Esc':
      return 'skip';
    default:
      return null;
  }
}

/**
 * Is this element one the reader is typing into? Enter and Esc belong to the
 * editor, the quick switcher and any text field while the caret is inside
 * one — the tour must keep its hands off entirely.
 */
export function isTypingTarget(el: {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
} | null): boolean {
  if (el === null || el === undefined) return false;
  if (el.isContentEditable === true) return true;
  const tag = (el.tagName ?? '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return typeof el.closest === 'function' && el.closest('[contenteditable="true"]') !== null;
}

/** Minimal shape `stepIndexAfter` needs — the full step lives in steps.ts. */
export interface SkippableStep {
  readonly id: string;
  /** When true and the target is absent, the step is stepped over entirely. */
  readonly skipIfMissing?: boolean;
}

/**
 * Index of the next/previous step, skipping any `skipIfMissing` step whose
 * target is gone. Returns null when walking off either end (caller finishes
 * the tour) — this is what guarantees a missing element can never trap the
 * user on a dead step.
 */
export function stepIndexAfter<T extends SkippableStep>(
  steps: readonly T[],
  current: number,
  direction: 1 | -1,
  isPresent: (step: T) => boolean,
): number | null {
  let i = current + direction;
  while (i >= 0 && i < steps.length) {
    const step = steps[i];
    if (step.skipIfMissing !== true || isPresent(step)) return i;
    i += direction;
  }
  return null;
}

/**
 * First playable index at tour start (same skip rule, walking forward from
 * before the beginning). Null means every step was skipped.
 */
export function firstStepIndex<T extends SkippableStep>(
  steps: readonly T[],
  isPresent: (step: T) => boolean,
): number | null {
  return stepIndexAfter(steps, -1, 1, isPresent);
}
