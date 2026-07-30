/**
 * Procedural hand-drawn stickers — 8 little SVG friends rendered inline.
 *
 * Pure string generation, deterministic per sticker id (seeded wobble), no
 * runtime SVG filters (CLAUDE.md: filters are bake-only). The wobble comes
 * from jittered control points + round strokes, which reads as pencil-drawn
 * without any feTurbulence. Colors are CSS custom properties so stickers
 * follow the token palette (inline SVG inherits page CSS variables).
 */

export const STICKER_IDS = [
  'star',
  'bee',
  'leaf',
  'heart',
  'sparkle',
  'cat',
  'sun',
  'flower',
] as const;

export type StickerId = (typeof STICKER_IDS)[number];

export function isStickerId(value: unknown): value is StickerId {
  return (
    typeof value === 'string' && (STICKER_IDS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Seeded wobble helpers (self-contained on purpose — the editor must not
// depend on src/art internals)
// ---------------------------------------------------------------------------

type Rng = () => number;

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Pt {
  x: number;
  y: number;
}

function n2(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}

function jitterPoints(points: readonly Pt[], rng: Rng, amp: number): Pt[] {
  return points.map((p) => ({
    x: p.x + (rng() - 0.5) * 2 * amp,
    y: p.y + (rng() - 0.5) * 2 * amp,
  }));
}

/**
 * Closed wobbly outline: jittered vertices joined with quadratic curves
 * through midpoints — the classic "confident but human" pencil line.
 */
function wobblyLoop(points: readonly Pt[], rng: Rng, amp = 0.7): string {
  const pts = jitterPoints(points, rng, amp);
  const count = pts.length;
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const start = mid(pts[count - 1], pts[0]);
  let d = `M ${n2(start.x)} ${n2(start.y)}`;
  for (let i = 0; i < count; i += 1) {
    const control = pts[i];
    const end = mid(control, pts[(i + 1) % count]);
    d += ` Q ${n2(control.x)} ${n2(control.y)} ${n2(end.x)} ${n2(end.y)}`;
  }
  return `${d} Z`;
}

/** Open wobbly stroke through the given points. */
function wobblyStroke(points: readonly Pt[], rng: Rng, amp = 0.6): string {
  const pts = jitterPoints(points, rng, amp);
  let d = `M ${n2(pts[0].x)} ${n2(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const control = pts[i];
    const end = {
      x: (pts[i].x + pts[i + 1].x) / 2,
      y: (pts[i].y + pts[i + 1].y) / 2,
    };
    d += ` Q ${n2(control.x)} ${n2(control.y)} ${n2(end.x)} ${n2(end.y)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${n2(last.x)} ${n2(last.y)}`;
  return d;
}

function ring(cx: number, cy: number, r: number, segments: number, rotate = 0): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a = rotate + (i / segments) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

function starPoints(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  spikes: number,
  rotate = -Math.PI / 2,
): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < spikes * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rotate + (i / (spikes * 2)) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

const STROKE = 'stroke-linecap="round" stroke-linejoin="round"';

function path(
  d: string,
  fill: string,
  stroke: string,
  width = 1.6,
): string {
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" ${STROKE}/>`;
}

function svg(body: string, label: string): string {
  return (
    `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" ` +
    `role="img" aria-label="${label}" class="nb-sticker-art">${body}</svg>`
  );
}

// ---------------------------------------------------------------------------
// The eight stickers
// ---------------------------------------------------------------------------

function drawStar(rng: Rng): string {
  const body = path(
    wobblyLoop(starPoints(16, 16.5, 13, 5.6, 5), rng, 0.8),
    'var(--wash-amber)',
    'var(--wash-amber-deep)',
  );
  return svg(body, 'star sticker');
}

function drawBee(rng: Rng): string {
  const wingL = path(
    wobblyLoop(ring(10.5, 8, 4.6, 8), rng, 0.5),
    'var(--wash-sky-light)',
    'var(--ink-graphite-soft)',
    1.2,
  );
  const wingR = path(
    wobblyLoop(ring(21.5, 8, 4.6, 8), rng, 0.5),
    'var(--wash-sky-light)',
    'var(--ink-graphite-soft)',
    1.2,
  );
  // Plump oval body.
  const bodyPts: Pt[] = [];
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    bodyPts.push({ x: 16 + Math.cos(a) * 9.5, y: 19 + Math.sin(a) * 7 });
  }
  const body = path(
    wobblyLoop(bodyPts, rng, 0.55),
    'var(--wash-amber)',
    'var(--ink-graphite)',
  );
  const stripe1 = path(
    wobblyStroke([{ x: 12, y: 12.6 }, { x: 11.4, y: 19 }, { x: 12.2, y: 25.2 }], rng, 0.4),
    'none',
    'var(--ink-graphite)',
    1.8,
  );
  const stripe2 = path(
    wobblyStroke([{ x: 17.6, y: 12.2 }, { x: 17.2, y: 19 }, { x: 17.8, y: 25.6 }], rng, 0.4),
    'none',
    'var(--ink-graphite)',
    1.8,
  );
  const smile = path(
    wobblyStroke([{ x: 22.4, y: 19.6 }, { x: 23.6, y: 20.6 }, { x: 24.8, y: 19.8 }], rng, 0.25),
    'none',
    'var(--ink-graphite)',
    1.2,
  );
  return svg(wingL + wingR + body + stripe1 + stripe2 + smile, 'bee sticker');
}

function drawLeaf(rng: Rng): string {
  const outline: Pt[] = [
    { x: 16, y: 3.5 },
    { x: 23.5, y: 8.5 },
    { x: 26, y: 17 },
    { x: 21.5, y: 24.5 },
    { x: 16, y: 28.5 },
    { x: 10.5, y: 24.5 },
    { x: 6, y: 17 },
    { x: 8.5, y: 8.5 },
  ];
  const blade = path(
    wobblyLoop(outline, rng, 0.9),
    'var(--wash-moss-light)',
    'var(--wash-moss-deep)',
  );
  const vein = path(
    wobblyStroke(
      [
        { x: 16, y: 5.5 },
        { x: 15.6, y: 12 },
        { x: 16.3, y: 20 },
        { x: 16, y: 27 },
      ],
      rng,
      0.45,
    ),
    'none',
    'var(--wash-moss-deep)',
    1.3,
  );
  const rib1 = path(
    wobblyStroke([{ x: 15.8, y: 12.5 }, { x: 12, y: 15 }, { x: 9.6, y: 17.5 }], rng, 0.4),
    'none',
    'var(--wash-moss-deep)',
    1.1,
  );
  const rib2 = path(
    wobblyStroke([{ x: 16.1, y: 16.5 }, { x: 19.8, y: 18.6 }, { x: 22.3, y: 20.4 }], rng, 0.4),
    'none',
    'var(--wash-moss-deep)',
    1.1,
  );
  return svg(blade + vein + rib1 + rib2, 'leaf sticker');
}

function drawHeart(rng: Rng): string {
  const outline: Pt[] = [
    { x: 16, y: 10 },
    { x: 12.5, y: 5.5 },
    { x: 7.5, y: 5.5 },
    { x: 4.5, y: 10.5 },
    { x: 6, y: 16.5 },
    { x: 11, y: 22 },
    { x: 16, y: 27.5 },
    { x: 21, y: 22 },
    { x: 26, y: 16.5 },
    { x: 27.5, y: 10.5 },
    { x: 24.5, y: 5.5 },
    { x: 19.5, y: 5.5 },
  ];
  const body = path(
    wobblyLoop(outline, rng, 0.8),
    'var(--wash-blush)',
    'var(--wash-blush-deep)',
  );
  const shine = path(
    wobblyStroke([{ x: 8.6, y: 9.4 }, { x: 8, y: 11.2 }, { x: 8.7, y: 13.2 }], rng, 0.3),
    'none',
    'var(--wash-blush-light)',
    1.6,
  );
  return svg(body + shine, 'heart sticker');
}

function drawSparkle(rng: Rng): string {
  // Four-point twinkle: long vertical, shorter horizontal, concave sides.
  const big = path(
    wobblyLoop(starPoints(15, 17, 12, 3.4, 4, 0), rng, 0.6),
    'var(--wash-lemon)',
    'var(--wash-amber-deep)',
    1.4,
  );
  const small = path(
    wobblyLoop(starPoints(25, 7, 4.4, 1.5, 4, 0), rng, 0.4),
    'var(--wash-lemon-light)',
    'var(--wash-amber-deep)',
    1.1,
  );
  return svg(big + small, 'sparkle sticker');
}

function drawCat(rng: Rng): string {
  const head: Pt[] = [
    { x: 6.5, y: 6 }, // left ear tip
    { x: 11, y: 9.5 },
    { x: 16, y: 8.6 },
    { x: 21, y: 9.5 },
    { x: 25.5, y: 6 }, // right ear tip
    { x: 26.5, y: 13.5 },
    { x: 27, y: 19 },
    { x: 22.5, y: 25 },
    { x: 16, y: 27 },
    { x: 9.5, y: 25 },
    { x: 5, y: 19 },
    { x: 5.5, y: 13.5 },
  ];
  const face = path(
    wobblyLoop(head, rng, 0.7),
    'var(--paper-cream)',
    'var(--ink-graphite)',
  );
  const eyeL = `<circle cx="12" cy="17" r="1.15" fill="var(--ink-graphite)"/>`;
  const eyeR = `<circle cx="20" cy="17" r="1.15" fill="var(--ink-graphite)"/>`;
  const nose = path(
    wobblyLoop(
      [
        { x: 16, y: 19.4 },
        { x: 17.2, y: 20.2 },
        { x: 16, y: 21.2 },
        { x: 14.8, y: 20.2 },
      ],
      rng,
      0.2,
    ),
    'var(--wash-blush)',
    'var(--wash-blush-deep)',
    0.9,
  );
  const whiskers =
    path(
      wobblyStroke([{ x: 9.4, y: 20 }, { x: 6.4, y: 19.4 }, { x: 3.8, y: 18.6 }], rng, 0.3),
      'none',
      'var(--ink-graphite-soft)',
      1,
    ) +
    path(
      wobblyStroke([{ x: 9.4, y: 21.8 }, { x: 6.6, y: 22 }, { x: 4, y: 22.4 }], rng, 0.3),
      'none',
      'var(--ink-graphite-soft)',
      1,
    ) +
    path(
      wobblyStroke([{ x: 22.6, y: 20 }, { x: 25.6, y: 19.4 }, { x: 28.2, y: 18.6 }], rng, 0.3),
      'none',
      'var(--ink-graphite-soft)',
      1,
    ) +
    path(
      wobblyStroke([{ x: 22.6, y: 21.8 }, { x: 25.4, y: 22 }, { x: 28, y: 22.4 }], rng, 0.3),
      'none',
      'var(--ink-graphite-soft)',
      1,
    );
  return svg(face + eyeL + eyeR + nose + whiskers, 'cat sticker');
}

function drawSun(rng: Rng): string {
  let rays = '';
  const rayCount = 9;
  for (let i = 0; i < rayCount; i += 1) {
    const a = (i / rayCount) * Math.PI * 2 + 0.3;
    const from = {
      x: 16 + Math.cos(a) * 9.6,
      y: 16 + Math.sin(a) * 9.6,
    };
    const to = {
      x: 16 + Math.cos(a) * 14.2,
      y: 16 + Math.sin(a) * 14.2,
    };
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    rays += path(
      wobblyStroke([from, mid, to], rng, 0.4),
      'none',
      'var(--wash-amber-deep)',
      1.5,
    );
  }
  const disc = path(
    wobblyLoop(ring(16, 16, 7.6, 10), rng, 0.5),
    'var(--wash-lemon)',
    'var(--wash-amber-deep)',
  );
  const smile = path(
    wobblyStroke([{ x: 13, y: 17.8 }, { x: 16, y: 19.6 }, { x: 19, y: 17.8 }], rng, 0.25),
    'none',
    'var(--wash-amber-deep)',
    1.2,
  );
  return svg(rays + disc + smile, 'sun sticker');
}

function drawFlower(rng: Rng): string {
  let petals = '';
  const petalCount = 6;
  for (let i = 0; i < petalCount; i += 1) {
    const a = (i / petalCount) * Math.PI * 2 - Math.PI / 2;
    const cx = 16 + Math.cos(a) * 7.8;
    const cy = 15.4 + Math.sin(a) * 7.8;
    // Petal: oval pointing outward.
    const pts = ring(0, 0, 1, 8).map((_, j) => {
      const t = (j / 8) * Math.PI * 2;
      const rx = 5.2;
      const ry = 3.6;
      const x = Math.cos(t) * rx;
      const y = Math.sin(t) * ry;
      return {
        x: cx + x * Math.cos(a) - y * Math.sin(a),
        y: cy + x * Math.sin(a) + y * Math.cos(a),
      };
    });
    petals += path(
      wobblyLoop(pts, rng, 0.5),
      'var(--wash-blush-light)',
      'var(--wash-blush-deep)',
      1.2,
    );
  }
  const center = path(
    wobblyLoop(ring(16, 15.4, 4, 9), rng, 0.4),
    'var(--wash-amber)',
    'var(--wash-amber-deep)',
    1.3,
  );
  const stemDot = path(
    wobblyStroke([{ x: 16, y: 24.4 }, { x: 15.7, y: 27 }, { x: 16.2, y: 29 }], rng, 0.3),
    'none',
    'var(--wash-moss-deep)',
    1.5,
  );
  return svg(petals + center + stemDot, 'flower sticker');
}

const DRAWERS: Record<StickerId, (rng: Rng) => string> = {
  star: drawStar,
  bee: drawBee,
  leaf: drawLeaf,
  heart: drawHeart,
  sparkle: drawSparkle,
  cat: drawCat,
  sun: drawSun,
  flower: drawFlower,
};

const cache = new Map<StickerId, string>();

/**
 * Full inline-SVG markup for a sticker. Deterministic (seeded by id) and
 * memoized — every star wobbles identically, like a rubber stamp.
 */
export function stickerSvg(id: StickerId): string {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const markup = DRAWERS[id](mulberry32(fnv1a(`sticker:${id}`)));
  cache.set(id, markup);
  return markup;
}
