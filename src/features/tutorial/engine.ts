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
 * Perimeter samples of a rounded rect with per-corner pencil wobble — the
 * spotlight hole is drawn as a hand-traced ring, never a CSS border-radius.
 */
export function holeOutlinePoints(
  rect: Rect,
  radius: number,
  seed: number,
  wobble = 2.2,
): Point[] {
  const rng = seededRandom(seed ^ 0x1f2e3d4c);
  const r = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  const x0 = rect.x;
  const y0 = rect.y;
  const x1 = rect.x + rect.width;
  const y1 = rect.y + rect.height;
  const points: Point[] = [];
  const push = (x: number, y: number): void => {
    points.push({
      x: x + (rng() * 2 - 1) * wobble,
      y: y + (rng() * 2 - 1) * wobble,
    });
  };
  // How many samples an edge gets — long edges wobble more often, so a big
  // spotlight does not read as a machine-straight line.
  const along = (length: number): number =>
    Math.max(1, Math.min(14, Math.round(length / 34)));
  // Corner arc: 4 samples sweeping a quarter turn.
  const corner = (cx: number, cy: number, startAngle: number): void => {
    for (let i = 0; i <= 3; i += 1) {
      const a = startAngle + (i / 3) * (Math.PI / 2);
      push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  };
  const edgeX = Math.max(0, x1 - x0 - r * 2);
  const edgeY = Math.max(0, y1 - y0 - r * 2);

  // Top edge, left -> right
  const nTop = along(edgeX);
  for (let i = 0; i < nTop; i += 1) push(x0 + r + (edgeX * i) / nTop, y0);
  corner(x1 - r, y0 + r, -Math.PI / 2); // top-right
  const nRight = along(edgeY);
  for (let i = 0; i < nRight; i += 1) push(x1, y0 + r + (edgeY * i) / nRight);
  corner(x1 - r, y1 - r, 0); // bottom-right
  const nBottom = along(edgeX);
  for (let i = 0; i < nBottom; i += 1) push(x1 - r - (edgeX * i) / nBottom, y1);
  corner(x0 + r, y1 - r, Math.PI / 2); // bottom-left
  const nLeft = along(edgeY);
  for (let i = 0; i < nLeft; i += 1) push(x0, y1 - r - (edgeY * i) / nLeft);
  corner(x0 + r, y0 + r, Math.PI); // top-left

  return points;
}

/** Closed path around the spotlight hole (for the pencil ring). */
export function holePath(
  rect: Rect,
  radius: number,
  seed: number,
  wobble?: number,
): string {
  return smoothPath(holeOutlinePoints(rect, radius, seed, wobble), true);
}

/**
 * The scrim: a full-viewport rect with the hole subtracted. Fill it with
 * `fill-rule: evenodd` and everything but the target dims.
 */
export function spotlightPath(
  hole: Rect,
  vp: Size,
  radius: number,
  seed: number,
): string {
  const outer = `M 0 0 H ${n(vp.width)} V ${n(vp.height)} H 0 Z`;
  return `${outer} ${holePath(hole, radius, seed)}`;
}

/** Scrim with no hole at all (anchorless steps dim the whole world). */
export function solidScrimPath(vp: Size): string {
  return `M 0 0 H ${n(vp.width)} V ${n(vp.height)} H 0 Z`;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export type TutorialAction = 'next' | 'back' | 'skip';

/** Keyboard contract: Enter/Space/→/↓ advance, ←/↑/Backspace go back, Esc skips. */
export function keyAction(key: string): TutorialAction | null {
  switch (key) {
    case 'Enter':
    case ' ':
    case 'Spacebar':
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
      return 'next';
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'Backspace':
    case 'PageUp':
      return 'back';
    case 'Escape':
    case 'Esc':
      return 'skip';
    default:
      return null;
  }
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
