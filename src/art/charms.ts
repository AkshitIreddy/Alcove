/**
 * art/charms.ts — the delight layer of the Book Studio (library-themes §4).
 *
 * Six charms — ribbon marker, tassel, pressed flower, brass clasp, wax seal,
 * dangling tag — each drawn TWICE: once spine-side (the sliver you see on the
 * shelf) and once cover-side (the pull-out / open book). A book with a
 * crimson ribbon is recognisably that book in every context, which is the
 * whole point: the charm is the fastest identity cue a reader has.
 *
 * Everything here is plain canvas 2d, deterministic per `rnd`, and NEVER uses
 * an SVG filter (CLAUDE.md: filters live only in art/bake.ts). Callers
 * translate the context to the artwork origin first; charms draw inside a
 * w×h box and stay within it, so they survive being baked into an atlas rect.
 */

import { clamp, type RandomFn } from './noise';
import type { Ctx2D } from './spines';

/* --------------------------------- kinds --------------------------------- */

/** The charm vocabulary. 'none' is a first-class value (most books have none). */
export const CHARMS = [
  'none',
  'ribbon',
  'tassel',
  'pressed-flower',
  'clasp',
  'wax-seal',
  'tag',
] as const;

export type CharmKind = (typeof CHARMS)[number];

/** Display labels for the studio panel (index-aligned with CHARMS). */
export const CHARM_LABELS: Readonly<Record<CharmKind, string>> = {
  none: 'None',
  ribbon: 'Ribbon marker',
  tassel: 'Tassel',
  'pressed-flower': 'Pressed flower',
  clasp: 'Brass clasp',
  'wax-seal': 'Wax seal',
  tag: 'Dangling tag',
};

/** Charms that actually draw something (studio "surprise me" pool). */
export const CHARM_KINDS_WITH_ART: readonly CharmKind[] = CHARMS.filter(
  (c): c is Exclude<CharmKind, 'none'> => c !== 'none',
);

export function isCharmKind(value: unknown): value is CharmKind {
  return typeof value === 'string' && (CHARMS as readonly string[]).includes(value);
}

/* -------------------------------- colours -------------------------------- */

/** Eight ribbon/twine/wax colourways. Index is what gets persisted. */
export const CHARM_COLORS: readonly string[] = [
  '#9c2b2b', // crimson
  '#2f5d4a', // forest
  '#2b4260', // navy
  '#e2d4b2', // cream
  '#c9a227', // gold
  '#6b3f63', // plum
  '#a5552b', // rust
  '#2e6b73', // teal
];

export const CHARM_COLOR_LABELS: readonly string[] = [
  'Crimson',
  'Forest',
  'Navy',
  'Cream',
  'Gold',
  'Plum',
  'Rust',
  'Teal',
];

/** Wrap-safe lookup into CHARM_COLORS. */
export function charmColorCss(index: number): string {
  const n = CHARM_COLORS.length;
  const i = ((Math.trunc(index) % n) + n) % n;
  return CHARM_COLORS[i] as string;
}

const BRASS_HI = '#f0d68d';
const BRASS = '#b8912f';
const BRASS_LO = '#6f5312';
const GOLD_HI = '#ffe9a8';
const GOLD = '#c9a227';
const GOLD_LO = '#8f6f14';
const KRAFT = '#d6bd91';
const KRAFT_LO = '#a8895c';
const INK = 'rgba(52, 44, 36, 0.75)';

/* ----------------------------- colour helpers ---------------------------- */

/**
 * Parse `#rgb`, `#rrggbb` **and** the `rgb(r g b [/ a])` form that `mixHex`
 * itself emits. That second case matters: `shadeHex(mixHex(a, b, t), …)` is a
 * natural thing to write, and before this parsed rgb() it fell through to the
 * grey fallback — which is exactly how wax seals ended up looking like pewter
 * coins and ribbon fold-backs like grey tape.
 */
function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.trim();
  if (raw.startsWith('rgb')) {
    const nums = raw.match(/-?\d*\.?\d+/g);
    if (nums && nums.length >= 3) {
      return [Number(nums[0]), Number(nums[1]), Number(nums[2])];
    }
    return [128, 128, 128];
  }
  const h = raw.replace('#', '');
  const full =
    h.length === 3
      ? `${h[0] as string}${h[0] as string}${h[1] as string}${h[1] as string}${h[2] as string}${h[2] as string}`
      : h;
  const n = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbCss(r: number, g: number, b: number, a = 1): string {
  const cl = (v: number): number => Math.round(clamp(v, 0, 255));
  return a >= 1 ? `rgb(${cl(r)} ${cl(g)} ${cl(b)})` : `rgb(${cl(r)} ${cl(g)} ${cl(b)} / ${a})`;
}

/** Mix two hex colours (t = 0 → a, 1 → b). */
export function mixHex(a: string, b: string, t: number, alpha = 1): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbCss(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t, alpha);
}

/** Lighten (amt > 0) or darken (amt < 0) a hex colour by amt in [-1, 1]. */
export function shadeHex(hex: string, amt: number, alpha = 1): string {
  return amt >= 0 ? mixHex(hex, '#ffffff', amt, alpha) : mixHex(hex, '#000000', -amt, alpha);
}

/* -------------------------------- options -------------------------------- */

export interface CharmOptions {
  /** Ribbon / twine / wax colour (usually charmColorCss(style.charmColor)). */
  color: string;
  /** Detail scale: canvas px per world px. */
  scale: number;
  /** Deterministic jitter source (same seed ⇒ same charm). */
  rnd: RandomFn;
  /** Gold hardware instead of antique brass (books that are gilt). */
  gilt?: boolean;
}

interface Metal {
  hi: string;
  mid: string;
  lo: string;
}

function metal(gilt: boolean | undefined): Metal {
  return gilt ? { hi: GOLD_HI, mid: GOLD, lo: GOLD_LO } : { hi: BRASS_HI, mid: BRASS, lo: BRASS_LO };
}

/* ------------------------------ tiny drawing ----------------------------- */

interface Pt {
  x: number;
  y: number;
}

function fillPath(ctx: Ctx2D, pts: readonly Pt[], style: string): void {
  const first = pts[0];
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo((pts[i] as Pt).x, (pts[i] as Pt).y);
  ctx.closePath();
  ctx.fillStyle = style;
  ctx.fill();
}

function strokePath(ctx: Ctx2D, pts: readonly Pt[], style: string, width: number): void {
  const first = pts[0];
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo((pts[i] as Pt).x, (pts[i] as Pt).y);
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** Wobbled closed blob (wax seals, pressed petals). */
function blobPath(cx: number, cy: number, r: number, n: number, wobble: number, rnd: RandomFn): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 + (rnd() * 2 - 1) * wobble);
    pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  return pts;
}

/** A soft drop shadow under a charm (charms sit ON the binding, not in it). */
function softShadow(ctx: Ctx2D, x: number, y: number, w: number, h: number, alpha: number): void {
  const g = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, `rgba(30, 22, 14, ${alpha})`);
  g.addColorStop(1, 'rgba(30, 22, 14, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - w * 0.4, y - h * 0.4, w * 1.8, h * 1.8);
}

/* ------------------------------ shared pieces ---------------------------- */

/**
 * A length of ribbon as a swept strip with a shaded fold and a V-notched tail.
 * (x0,y0) is the top centre, (x1,y1) the bottom centre; `wTop`/`wBot` widths.
 *
 * `sway` bows the ribbon sideways at its midpoint: a ribbon that falls dead
 * straight reads as a plastic stick, and that is exactly what the first pass
 * of this looked like on a cover. The bow, plus a twist in the shading
 * gradient, is what makes it read as cloth.
 */
function ribbonStrip(
  ctx: Ctx2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  wTop: number,
  wBot: number,
  color: string,
  s: number,
  notch = true,
  sway = 0.22,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.max(1e-3, Math.hypot(dx, dy));
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const bow = sway * len * 0.32;

  // Sample the centre line as a quadratic bow, and widen along it.
  const STEPS = 14;
  const centre = (t: number): Pt => {
    const b = 4 * t * (1 - t); // 0 at the ends, 1 at the middle
    return {
      x: x0 + dx * t + nx * bow * b,
      y: y0 + dy * t + ny * bow * b,
    };
  };
  const halfAt = (t: number): number => (wTop + (wBot - wTop) * t) * 0.5;

  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const c = centre(t);
    const hw = halfAt(t);
    left.push({ x: c.x - nx * hw, y: c.y - ny * hw });
    right.push({ x: c.x + nx * hw, y: c.y + ny * hw });
  }

  const tail = centre(1);
  const notchDepth = notch ? Math.min(wBot * 0.8, len * 0.2) : 0;
  const body: Pt[] = [
    ...left,
    { x: tail.x - ux * notchDepth, y: tail.y - uy * notchDepth },
    ...right.reverse(),
  ];

  // Cross-ribbon shading (silk catches the light along one edge only).
  const g = ctx.createLinearGradient(
    x0 - nx * wTop * 0.5,
    y0 - ny * wTop * 0.5,
    x0 + nx * wTop * 0.5,
    y0 + ny * wTop * 0.5,
  );
  g.addColorStop(0, shadeHex(color, -0.38));
  g.addColorStop(0.3, shadeHex(color, 0.26));
  g.addColorStop(0.58, color);
  g.addColorStop(1, shadeHex(color, -0.46));
  const first = body[0] as Pt;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < body.length; i++) ctx.lineTo((body[i] as Pt).x, (body[i] as Pt).y);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();

  // Specular thread and shaded edge, both following the bow.
  const rail = (off: number, style: string, width: number): void => {
    const pts: Pt[] = [];
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const c = centre(t);
      const hw = halfAt(t) * off;
      pts.push({ x: c.x + nx * hw, y: c.y + ny * hw });
    }
    strokePath(ctx, pts, style, width);
  };
  rail(0.24, shadeHex(color, 0.55, 0.5), Math.max(0.7, wTop * 0.16));
  rail(-0.96, shadeHex(color, -0.58, 0.55), Math.max(0.5, 0.7 * s));
  rail(0.96, shadeHex(color, -0.4, 0.4), Math.max(0.4, 0.5 * s));
}

/** Cord + knot + thread skirt. (cx, cy) is where the skirt starts. */
function tasselBody(ctx: Ctx2D, cx: number, cy: number, size: number, color: string, rnd: RandomFn): void {
  const knotR = size * 0.26;
  // Knot: a small wrapped ball.
  const g = ctx.createRadialGradient(cx - knotR * 0.35, cy - knotR * 0.4, knotR * 0.1, cx, cy, knotR);
  g.addColorStop(0, shadeHex(color, 0.4));
  g.addColorStop(1, shadeHex(color, -0.3));
  ctx.beginPath();
  ctx.ellipse(cx, cy, knotR, knotR * 1.15, 0, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  // Two wrap lines round the knot.
  for (const dy of [-knotR * 0.25, knotR * 0.3]) {
    strokePath(
      ctx,
      [
        { x: cx - knotR * 0.92, y: cy + dy },
        { x: cx + knotR * 0.92, y: cy + dy },
      ],
      shadeHex(color, -0.5, 0.55),
      Math.max(0.5, knotR * 0.14),
    );
  }
  // Skirt: a fan of threads, slightly splayed and uneven.
  const skirtTop = cy + knotR * 0.9;
  const skirtLen = size * 0.95;
  const threads = 9;
  for (let i = 0; i < threads; i++) {
    const t = i / (threads - 1);
    const spread = (t - 0.5) * size * 0.92;
    const len = skirtLen * (0.72 + rnd() * 0.34);
    strokePath(
      ctx,
      [
        { x: cx + spread * 0.28, y: skirtTop },
        { x: cx + spread * 0.8, y: skirtTop + len * 0.55 },
        { x: cx + spread, y: skirtTop + len },
      ],
      i % 3 === 0 ? shadeHex(color, -0.34) : i % 3 === 1 ? color : shadeHex(color, 0.24),
      Math.max(0.55, size * 0.075),
    );
  }
}

/** A pressed, translucent flower: petals + centre + stem + two leaves. */
function pressedFlower(
  ctx: Ctx2D,
  cx: number,
  cy: number,
  r: number,
  stemTo: Pt,
  color: string,
  rnd: RandomFn,
): void {
  const petal = mixHex(color, '#f6ecd8', 0.62);
  const petalDeep = mixHex(color, '#f6ecd8', 0.34);

  // Stem, drawn first so the flower head sits on top of it.
  strokePath(
    ctx,
    [
      { x: cx, y: cy },
      { x: (cx + stemTo.x) / 2 + r * 0.25, y: (cy + stemTo.y) / 2 },
      stemTo,
    ],
    'rgba(105, 118, 70, 0.85)',
    Math.max(0.6, r * 0.14),
  );
  // Two leaves off the stem.
  for (const [t, side] of [
    [0.34, 1],
    [0.62, -1],
  ] as const) {
    const lx = cx + (stemTo.x - cx) * t + r * 0.16;
    const ly = cy + (stemTo.y - cy) * t;
    ctx.beginPath();
    ctx.ellipse(lx + side * r * 0.42, ly + r * 0.1, r * 0.44, r * 0.17, side * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(122, 138, 82, 0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(80, 92, 50, 0.55)';
    ctx.lineWidth = Math.max(0.4, r * 0.05);
    ctx.stroke();
  }

  // Five pressed petals — flattened, slightly translucent, uneven.
  ctx.globalAlpha = 0.9;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd() * 0.22;
    const px = cx + Math.cos(a) * r * 0.52;
    const py = cy + Math.sin(a) * r * 0.52;
    ctx.beginPath();
    ctx.ellipse(px, py, r * 0.56, r * 0.32, a, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 === 0 ? petal : petalDeep;
    ctx.fill();
    ctx.strokeStyle = mixHex(color, '#4a3a2a', 0.4, 0.45);
    ctx.lineWidth = Math.max(0.35, r * 0.045);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Dried centre.
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.24, 0, Math.PI * 2);
  ctx.fillStyle = '#a8863c';
  ctx.fill();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    strokePath(
      ctx,
      [
        { x: cx, y: cy },
        { x: cx + Math.cos(a) * r * 0.3, y: cy + Math.sin(a) * r * 0.3 },
      ],
      'rgba(120, 92, 40, 0.6)',
      Math.max(0.3, r * 0.05),
    );
  }
}

/** Brass strap + catch plate. Horizontal band centred on (cy). */
function claspBand(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  m: Metal,
  s: number,
  plate: boolean,
): void {
  softShadow(ctx, x, y + h * 0.5, w, h, 0.16);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, m.lo);
  g.addColorStop(0.22, m.hi);
  g.addColorStop(0.5, m.mid);
  g.addColorStop(0.82, shadeHex(m.mid, -0.28));
  g.addColorStop(1, m.lo);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // Engraved centre line + rivets.
  strokePath(
    ctx,
    [
      { x, y: y + h * 0.5 },
      { x: x + w, y: y + h * 0.5 },
    ],
    shadeHex(m.lo, -0.2, 0.5),
    Math.max(0.5, 0.6 * s),
  );
  const rr = Math.min(h * 0.24, w * 0.06);
  for (const rx of [x + w * 0.14, x + w * 0.86]) {
    ctx.beginPath();
    ctx.arc(rx, y + h * 0.5, rr, 0, Math.PI * 2);
    ctx.fillStyle = m.hi;
    ctx.fill();
    ctx.strokeStyle = shadeHex(m.lo, -0.1, 0.7);
    ctx.lineWidth = Math.max(0.4, 0.5 * s);
    ctx.stroke();
  }
  // Outline.
  ctx.strokeStyle = shadeHex(m.lo, -0.3, 0.75);
  ctx.lineWidth = Math.max(0.5, 0.7 * s);
  ctx.strokeRect(x, y, w, h);

  if (plate) {
    // The catch: a rounded tongue sticking out of the strap.
    const pw = w * 0.3;
    const ph = h * 1.75;
    const px = x + w * 0.5 - pw * 0.5;
    const py = y + h * 0.5 - ph * 0.5;
    const pg = ctx.createLinearGradient(px, py, px, py + ph);
    pg.addColorStop(0, m.hi);
    pg.addColorStop(0.45, m.mid);
    pg.addColorStop(1, m.lo);
    ctx.beginPath();
    const r = Math.min(pw, ph) * 0.28;
    ctx.moveTo(px + r, py);
    ctx.arcTo(px + pw, py, px + pw, py + ph, r);
    ctx.arcTo(px + pw, py + ph, px, py + ph, r);
    ctx.arcTo(px, py + ph, px, py, r);
    ctx.arcTo(px, py, px + pw, py, r);
    ctx.closePath();
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.strokeStyle = shadeHex(m.lo, -0.25, 0.8);
    ctx.lineWidth = Math.max(0.5, 0.7 * s);
    ctx.stroke();
    // Keyhole slot.
    ctx.beginPath();
    ctx.ellipse(px + pw * 0.5, py + ph * 0.5, pw * 0.16, ph * 0.14, 0, 0, Math.PI * 2);
    ctx.fillStyle = shadeHex(m.lo, -0.5, 0.85);
    ctx.fill();
  }
}

/** Blob of sealing wax with a pressed sigil and a gloss catchlight. */
function waxSeal(ctx: Ctx2D, cx: number, cy: number, r: number, color: string, s: number, rnd: RandomFn): void {
  softShadow(ctx, cx - r, cy - r * 0.6, r * 2, r * 1.6, 0.22);
  // Pull every colourway toward real sealing wax — deep, warm and saturated.
  // At 0.28 the mix left pale colourways looking like pressed tin coins.
  const wax = mixHex(color, '#8a1c18', 0.42);
  const outer = blobPath(cx, cy, r, 16, 0.13, rnd);
  fillPath(ctx, outer, shadeHex(wax, -0.18));
  // Domed body.
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.36, r * 0.06, cx, cy, r * 1.02);
  g.addColorStop(0, shadeHex(wax, 0.42));
  g.addColorStop(0.55, wax);
  g.addColorStop(1, shadeHex(wax, -0.42));
  const inner = blobPath(cx, cy, r * 0.9, 14, 0.09, rnd);
  fillPath(ctx, inner, 'rgba(0,0,0,0)');
  ctx.beginPath();
  const f = inner[0] as Pt;
  ctx.moveTo(f.x, f.y);
  for (let i = 1; i < inner.length; i++) ctx.lineTo((inner[i] as Pt).x, (inner[i] as Pt).y);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();

  // Pressed sigil: a ring with six radiating spokes. Deliberately coarse —
  // a fine six-point star turned to grey mush at shelf scale.
  const sig = r * 0.56;
  for (const [dx, dy, col, wdt] of [
    [0.7 * s, 0.7 * s, shadeHex(wax, 0.45, 0.7), 1],
    [0, 0, shadeHex(wax, -0.62, 0.9), 1.25],
  ] as const) {
    ctx.save();
    ctx.translate(dx, dy);
    ctx.beginPath();
    ctx.arc(cx, cy, sig * 0.94, 0, Math.PI * 2);
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(0.9, r * 0.11 * wdt);
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI + 0.2;
      strokePath(
        ctx,
        [
          { x: cx - Math.cos(a) * sig * 0.6, y: cy - Math.sin(a) * sig * 0.6 },
          { x: cx + Math.cos(a) * sig * 0.6, y: cy + Math.sin(a) * sig * 0.6 },
        ],
        col,
        Math.max(0.8, r * 0.09 * wdt),
      );
    }
    ctx.restore();
  }

  // Gloss catchlight.
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.36, cy - r * 0.46, r * 0.28, r * 0.14, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 240, 230, 0.26)';
  ctx.fill();
}

/** Kraft tag with a punched hole, a twine loop and two ink strokes. */
function kraftTag(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  s: number,
  rnd: RandomFn,
): void {
  softShadow(ctx, x, y + h * 0.15, w, h, 0.18);
  const chamfer = Math.min(w * 0.34, h * 0.22);
  const body: Pt[] = [
    { x: x + w * 0.5, y },
    { x: x + w, y: y + chamfer },
    { x: x + w, y: y + h },
    { x, y: y + h },
    { x, y: y + chamfer },
  ];
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, shadeHex(KRAFT, 0.14));
  g.addColorStop(1, shadeHex(KRAFT, -0.12));
  fillPath(ctx, body, 'rgba(0,0,0,0)');
  ctx.beginPath();
  const f = body[0] as Pt;
  ctx.moveTo(f.x, f.y);
  for (let i = 1; i < body.length; i++) ctx.lineTo((body[i] as Pt).x, (body[i] as Pt).y);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = shadeHex(KRAFT_LO, -0.2, 0.7);
  ctx.lineWidth = Math.max(0.5, 0.7 * s);
  ctx.stroke();

  // Punched hole with a reinforcing ring.
  const holeR = Math.min(w * 0.11, h * 0.09);
  ctx.beginPath();
  ctx.arc(x + w * 0.5, y + chamfer * 0.85, holeR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(46, 38, 30, 0.72)';
  ctx.fill();

  // Twine through the hole, up and off the top.
  strokePath(
    ctx,
    [
      { x: x + w * 0.5, y: y + chamfer * 0.85 },
      { x: x + w * 0.5 + (rnd() * 2 - 1) * w * 0.1, y: y - h * 0.42 },
      { x: x + w * 0.34, y: y - h * 0.86 },
    ],
    mixHex(color, '#d9c9a4', 0.35),
    Math.max(0.6, 0.9 * s),
  );

  // Two "handwriting" ink strokes on the face.
  for (let i = 0; i < 2; i++) {
    const ly = y + h * (0.55 + i * 0.22);
    strokePath(
      ctx,
      [
        { x: x + w * 0.18, y: ly },
        { x: x + w * (0.5 + rnd() * 0.12), y: ly - h * 0.03 },
        { x: x + w * (0.72 + rnd() * 0.1), y: ly },
      ],
      INK,
      Math.max(0.5, 0.7 * s),
    );
  }
}

/* ------------------------------- spine side ------------------------------ */

/**
 * The vertical band a charm occupies on the spine, as fractions of the spine
 * height, so the title/ornament layout can keep clear of it. `null` = the
 * charm sits in the ornament panel (wax seal) or takes no exclusive space.
 */
export function charmSpineReserve(kind: CharmKind): { y0: number; y1: number } | null {
  switch (kind) {
    case 'ribbon':
      return { y0: 0.79, y1: 1 };
    case 'tassel':
      return { y0: 0, y1: 0.32 };
    case 'pressed-flower':
      return { y0: 0, y1: 0.23 };
    case 'clasp':
      return { y0: 0.46, y1: 0.59 };
    case 'tag':
      return { y0: 0, y1: 0.31 };
    default:
      return null;
  }
}

/** True when the charm replaces the ornament stamp (they share the panel). */
export function charmTakesOrnamentSlot(kind: CharmKind): boolean {
  return kind === 'wax-seal';
}

/**
 * Draw a charm on a spine. The context must already be translated to the
 * spine's top-left; `w`/`h` are the spine's canvas-px size. Everything stays
 * inside the box so the sprite can be atlas-packed.
 */
export function drawSpineCharm(
  ctx: Ctx2D,
  kind: CharmKind,
  w: number,
  h: number,
  opts: CharmOptions,
): void {
  if (kind === 'none') return;
  const { color, rnd } = opts;
  const s = Math.max(0.4, opts.scale);
  const m = metal(opts.gilt);

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  switch (kind) {
    case 'ribbon': {
      // A length of ribbon hanging past the tail — what you actually see of a
      // marker on a shelf. Sits off-centre and bows, so it reads as free cloth.
      const rw = clamp(w * 0.34, 4.2 * s, 10 * s);
      const cx = w * 0.6;
      ribbonStrip(ctx, cx, h * 0.79, cx + rw * 0.42, h * 0.995, rw * 0.9, rw * 1.05, color, s, true, 0.34);
      // The slot it emerges from.
      strokePath(
        ctx,
        [
          { x: cx - rw * 0.62, y: h * 0.793 },
          { x: cx + rw * 0.62, y: h * 0.793 },
        ],
        'rgba(30, 24, 18, 0.4)',
        Math.max(0.5, 0.7 * s),
      );
      break;
    }
    case 'tassel': {
      const cx = w * 0.64;
      // Cord looping over the head.
      strokePath(
        ctx,
        [
          { x: cx - w * 0.3, y: h * 0.01 },
          { x: cx - w * 0.06, y: h * 0.05 },
          { x: cx, y: h * 0.1 },
        ],
        shadeHex(color, -0.15),
        Math.max(0.9, 1.4 * s),
      );
      tasselBody(ctx, cx, h * 0.145, Math.min(w * 0.62, 17 * s), color, rnd);
      break;
    }
    case 'pressed-flower': {
      // Tucked in the pages so only the head of the flower shows at the top.
      const cx = w * 0.42;
      pressedFlower(
        ctx,
        cx,
        h * 0.082,
        Math.min(w * 0.42, 12 * s),
        { x: cx + w * 0.26, y: h * 0.2 },
        color,
        rnd,
      );
      break;
    }
    case 'clasp': {
      const bandH = clamp(h * 0.062, 6 * s, 13 * s);
      claspBand(ctx, -w * 0.02, h * 0.525 - bandH / 2, w * 1.04, bandH, m, s, true);
      break;
    }
    case 'wax-seal': {
      waxSeal(ctx, w * 0.5, h * 0.775, Math.min(w * 0.44, 16 * s), color, s, rnd);
      break;
    }
    default: {
      // tag
      const tw = clamp(w * 0.62, 12 * s, 22 * s);
      const th = tw * 1.35;
      kraftTag(ctx, w * 0.5 - tw / 2, h * 0.115, tw, th, color, s, rnd);
      // Twine wrapped round the head of the spine.
      strokePath(
        ctx,
        [
          { x: 0, y: h * 0.038 },
          { x: w * 0.5, y: h * 0.052 },
          { x: w, y: h * 0.034 },
        ],
        mixHex(color, '#d9c9a4', 0.35),
        Math.max(0.6, 0.9 * s),
      );
      break;
    }
  }

  ctx.restore();
}

/* ------------------------------- cover side ------------------------------ */

/**
 * Draw the SAME charm at cover scale. Context translated to the cover's
 * top-left; `w`/`h` are the cover's canvas-px size. Charms hug the fore-edge
 * (right side) because that is where they physically live on a closed book.
 */
export function drawCoverCharm(
  ctx: Ctx2D,
  kind: CharmKind,
  w: number,
  h: number,
  opts: CharmOptions,
): void {
  if (kind === 'none') return;
  const { color, rnd } = opts;
  const s = Math.max(0.4, opts.scale);
  const m = metal(opts.gilt);

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  switch (kind) {
    case 'ribbon': {
      // Emerges from under the fore-edge and drapes off the bottom corner.
      // Wide enough to read as cloth: the first pass was two thin sticks.
      const rw = w * 0.095;
      ribbonStrip(ctx, w * 0.88, h * 0.46, w * 0.8, h * 0.99, rw * 0.92, rw * 1.12, color, s, true, 0.3);
      // A short second length folded back over itself, for depth.
      ribbonStrip(
        ctx, w * 0.88, h * 0.46, w * 0.965, h * 0.73,
        rw * 0.8, rw * 0.62, shadeHex(color, -0.2), s, false, -0.3,
      );
      // Shadow where it leaves the block.
      strokePath(
        ctx,
        [
          { x: w * 0.88 - rw * 0.66, y: h * 0.457 },
          { x: w * 0.88 + rw * 0.66, y: h * 0.457 },
        ],
        'rgba(28, 22, 16, 0.4)',
        Math.max(0.8, 1.2 * s),
      );
      break;
    }
    case 'tassel': {
      const cx = w * 0.84;
      strokePath(
        ctx,
        [
          { x: cx - w * 0.17, y: h * 0.025 },
          { x: cx - w * 0.03, y: h * 0.1 },
          { x: cx, y: h * 0.18 },
        ],
        shadeHex(color, -0.15),
        Math.max(1.4, 2.6 * s),
      );
      tasselBody(ctx, cx, h * 0.235, Math.min(w * 0.2, 52 * s), color, rnd);
      break;
    }
    case 'pressed-flower': {
      const cx = w * 0.76;
      const cy = h * 0.72;
      pressedFlower(ctx, cx, cy, Math.min(w * 0.13, 38 * s), { x: cx - w * 0.16, y: cy + h * 0.15 }, color, rnd);
      break;
    }
    case 'clasp': {
      // The strap runs off the fore-edge, never past it.
      const bandH = Math.max(11 * s, h * 0.055);
      claspBand(ctx, w * 0.62, h * 0.5 - bandH / 2, w * 0.38, bandH, m, s, true);
      break;
    }
    case 'wax-seal': {
      waxSeal(ctx, w * 0.74, h * 0.78, Math.min(w * 0.15, 44 * s), color, s, rnd);
      break;
    }
    default: {
      // tag, hung on twine from the top fore-edge corner
      const tw = w * 0.21;
      const th = tw * 1.4;
      ctx.save();
      ctx.translate(w * 0.8, h * 0.19);
      ctx.rotate(0.13);
      kraftTag(ctx, -tw / 2, 0, tw, th, color, s, rnd);
      ctx.restore();
      strokePath(
        ctx,
        [
          { x: w * 0.99, y: h * 0.045 },
          { x: w * 0.9, y: h * 0.075 },
          { x: w * 0.77, y: h * 0.14 },
        ],
        mixHex(color, '#d9c9a4', 0.35),
        Math.max(1, 1.7 * s),
      );
      break;
    }
  }

  ctx.restore();
}
