/**
 * art/spines.ts — seeded procedural book spines (L2).
 *
 * A book's entire look derives from a 32-bit seed (fnv1a of its id):
 * seed → mulberry32 → SpineParams (~100 bytes, the only persisted state).
 * renderSpine draws one spine onto a canvas in ~0.3ms with NO SVG filters:
 * the watercolor look comes from layered multiply gradients + a 2px inset
 * pigment-pooling edge, the pencil look from per-vertex jittered
 * double-stroked polylines, and granulation from one shared 256² noise tile
 * composited with 'overlay' at alpha 0.06.
 */

import { clamp, mulberry32, type RandomFn } from './noise';

/* --------------------------------- params -------------------------------- */

/** Horizontal rule across the spine. y is a fraction of spine height. */
export interface BandSpec {
  y: number;
  /** 0 = double-rule, 1 = thick band, 2 = gilt band. */
  kind: 0 | 1 | 2;
}

export interface SpineParams {
  /** The seed the params were derived from (kept for render-time jitter). */
  seed: number;
  /** Silhouette template 0–6: straight/taper-top/taper-bottom/banded/scalloped/rounded-top/waist. */
  silhouette: number;
  /** Index into the 12 curated warm pigment duos. */
  palette: number;
  /** Extra per-book hue rotation, ±6°. */
  hueJitter: number;
  /** 0–3 horizontal bands. */
  bands: BandSpec[];
  /**
   * Ornament stamp 0–11: diamond/laurel/star/blot/chevron/sun/moon/keyhole/
   * laurel-wreath/quill/tree/crescent-with-stars.
   */
  ornament: number;
  /** Cover texture: 0 = cloth, 1 = leather, 2 = paper. */
  texture: 0 | 1 | 2;
  /** Title face: 0 = Caveat, 1 = Kalam, 2 = Patrick Hand. */
  font: 0 | 1 | 2;
  /** Gilt (gold) bands/ornament/title. */
  gilt: boolean;
  /** Lean angle in degrees, ±1.2 — applied by the shelf compositor. */
  lean: number;
  /** Spine width in world px, 28–46 weighted toward 32–38. */
  w: number;
  /** Height jitter in world px, ±6 — applied by the shelf compositor. */
  hJitter: number;
  /** Two-tone binding: the head section is bound in the darker partner tone. */
  twoTone: boolean;
  /** Fraction of the height covered by the two-tone head section (0.26–0.48). */
  twoToneSplit: number;
  /** Striped head/tail bands (endbands) at the spine's top and bottom. */
  headTail: boolean;
}

/** Suggested base spine height in world px (book zone is 280). */
export const SPINE_BASE_HEIGHT = 232;

interface HSL {
  h: number;
  s: number;
  l: number;
}

/** 12 curated warm pigment duos (top/light, bottom/dark). */
const PALETTES: ReadonlyArray<readonly [HSL, HSL]> = [
  [{ h: 38, s: 62, l: 52 }, { h: 30, s: 58, l: 38 }], // amber
  [{ h: 16, s: 55, l: 48 }, { h: 10, s: 52, l: 34 }], // terracotta
  [{ h: 95, s: 28, l: 42 }, { h: 100, s: 30, l: 30 }], // moss
  [{ h: 210, s: 26, l: 48 }, { h: 214, s: 30, l: 34 }], // dusty blue
  [{ h: 315, s: 24, l: 40 }, { h: 320, s: 28, l: 28 }], // plum
  [{ h: 44, s: 60, l: 46 }, { h: 40, s: 55, l: 33 }], // ochre
  [{ h: 130, s: 16, l: 52 }, { h: 135, s: 18, l: 38 }], // sage
  [{ h: 22, s: 60, l: 40 }, { h: 18, s: 58, l: 28 }], // rust
  [{ h: 28, s: 38, l: 52 }, { h: 24, s: 36, l: 38 }], // clay
  [{ h: 70, s: 30, l: 38 }, { h: 66, s: 32, l: 27 }], // olive
  [{ h: 200, s: 18, l: 42 }, { h: 204, s: 20, l: 30 }], // slate
  [{ h: 355, s: 32, l: 56 }, { h: 350, s: 30, l: 42 }], // blush
];

const FONTS: readonly string[] = [
  '"Caveat Variable", "Caveat", cursive',
  '"Kalam", cursive',
  '"Patrick Hand", cursive',
];

const GOLD = '#c9a227';
const GRAPHITE = 'rgba(58, 50, 42, 0.55)';

/**
 * Derive the full parameter set for one book from its seed.
 * Pure and deterministic: same seed ⇒ structurally identical params.
 */
export function deriveSpineParams(seed: number): SpineParams {
  const rnd = mulberry32(seed >>> 0);
  const silhouette = Math.floor(rnd() * 7);
  const palette = Math.floor(rnd() * PALETTES.length);
  const hueJitter = (rnd() * 2 - 1) * 6;

  const bandCount = Math.floor(rnd() * 4); // 0–3
  const bands: BandSpec[] = [];
  // Always consume the same number of rnd() calls so the parameter stream
  // stays aligned regardless of bandCount.
  for (let i = 0; i < 3; i++) {
    const y = 0.12 + rnd() * 0.76;
    const kind = Math.floor(rnd() * 3) as 0 | 1 | 2;
    if (i < bandCount) bands.push({ y, kind });
  }
  bands.sort((a, b) => a.y - b.y);

  const ornament = Math.floor(rnd() * 12);
  const texture = Math.floor(rnd() * 3) as 0 | 1 | 2;
  const font = Math.floor(rnd() * 3) as 0 | 1 | 2;
  const gilt = rnd() < 0.3;
  const lean = (rnd() * 2 - 1) * 1.2;
  // Average of two uniforms ⇒ triangular distribution peaked at the middle
  // of 28–46, i.e. weighted toward 32–38.
  const w = 28 + ((rnd() + rnd()) / 2) * 18;
  const hJitter = (rnd() * 2 - 1) * 6;
  // New draws are APPENDED so every earlier parameter keeps its value for a
  // given seed (the rnd stream stays aligned with the original recipe).
  const twoTone = rnd() < 0.3;
  const twoToneSplit = 0.26 + rnd() * 0.22;
  const headTail = rnd() < 0.55;

  return {
    seed: seed >>> 0,
    silhouette,
    palette,
    hueJitter,
    bands,
    ornament,
    texture,
    font,
    gilt,
    lean,
    w,
    hJitter,
    twoTone,
    twoToneSplit,
    headTail,
  };
}

/**
 * Public alias for cover modules (the pulled-book overlay bakes a DOM/canvas
 * cover that must match the shelf spine exactly). Same seed ⇒ same params.
 */
export function getSpineParams(seed: number): SpineParams {
  return deriveSpineParams(seed);
}

/** CSS-usable palette of one spine, derived from its params. */
export interface SpinePaletteCss {
  /** Light/top pigment. */
  top: string;
  /** Dark/bottom pigment. */
  bottom: string;
  /** Deep ink used for bands/edges. */
  ink: string;
  /** Ornament/title color (gold when the book is gilt). */
  accent: string;
  /** The shared gilt gold. */
  gold: string;
}

/**
 * The canonical palette lookup for a book's params — exported so the cover
 * module (and the DOM overlay) never has to duplicate the pigment tables.
 */
export function getSpinePalette(params: SpineParams): SpinePaletteCss {
  const duo = PALETTES[params.palette % PALETTES.length] as readonly [HSL, HSL];
  const hue = params.hueJitter;
  return {
    top: hslStr(duo[0], hue),
    bottom: hslStr(duo[1], hue),
    ink: hslStr(duo[1], hue, -18),
    accent: params.gilt ? GOLD : hslStr(duo[1], hue, -24),
    gold: GOLD,
  };
}

/* --------------------------- granulation tile ---------------------------- */

export type Canvas2D = OffscreenCanvas | HTMLCanvasElement;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const GRANULATION_SIZE = 256;
let granulationTile: Canvas2D | null = null;

function makeCanvas(w: number, h: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function get2d(c: Canvas2D): Ctx2D {
  const ctx = (c as OffscreenCanvas).getContext('2d');
  if (!ctx) throw new Error('spines: 2d context unavailable');
  return ctx as Ctx2D;
}

/**
 * The shared 256² high-frequency granulation noise tile (module-level lazy).
 * Drawn everywhere with globalCompositeOperation 'overlay' at alpha 0.06 —
 * cheaper than another filter chain, reused by spines, wood and washes.
 */
export function getGranulationTile(): Canvas2D {
  if (granulationTile) return granulationTile;
  const c = makeCanvas(GRANULATION_SIZE, GRANULATION_SIZE);
  const ctx = get2d(c);
  const img = ctx.createImageData(GRANULATION_SIZE, GRANULATION_SIZE);
  const rnd = mulberry32(0xa57a57);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    // Mid-gray ± noise: gray 128 is neutral under 'overlay'.
    const v = Math.round(128 + (rnd() * 2 - 1) * 56);
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  granulationTile = c;
  return c;
}

/* ------------------------------ geometry --------------------------------- */

interface Pt {
  x: number;
  y: number;
}

/**
 * Silhouette outline (clockwise from top-left) in local coords, before
 * jittering. Templates 0–6.
 */
function silhouetteOutline(silhouette: number, w: number, h: number): Pt[] {
  const tl: Pt = { x: 0, y: 0 };
  const tr: Pt = { x: w, y: 0 };
  const br: Pt = { x: w, y: h };
  const bl: Pt = { x: 0, y: h };
  switch (silhouette) {
    case 1: // tapered top
      return [{ x: w * 0.08, y: 0 }, { x: w * 0.92, y: 0 }, br, bl];
    case 2: // tapered bottom
      return [tl, tr, { x: w * 0.94, y: h }, { x: w * 0.06, y: h }];
    case 3: // banded — slight bulge at mid height
      return [
        tl, tr,
        { x: w * 1.03, y: h * 0.5 },
        br, bl,
        { x: -w * 0.03, y: h * 0.5 },
      ];
    case 4: // scalloped top edge
      return [
        tl,
        { x: w * 0.25, y: h * 0.012 },
        { x: w * 0.5, y: -h * 0.008 },
        { x: w * 0.75, y: h * 0.012 },
        tr, br, bl,
      ];
    case 5: // rounded (chamfered) top corners
      return [
        { x: 0, y: h * 0.02 },
        { x: w * 0.14, y: 0 },
        { x: w * 0.86, y: 0 },
        { x: w, y: h * 0.02 },
        br, bl,
      ];
    case 6: // waist
      return [
        tl, tr,
        { x: w * 0.95, y: h * 0.5 },
        br, bl,
        { x: w * 0.05, y: h * 0.5 },
      ];
    default: // 0 straight
      return [tl, tr, br, bl];
  }
}

/**
 * Densify a closed polygon (subdivide each edge every ~`step` px) and jitter
 * every vertex by ±amp. The jitter sequence comes from `rnd`, so identical
 * seeds reproduce identical outlines.
 */
function densifyJitter(pts: readonly Pt[], step: number, amp: number, rnd: RandomFn): Pt[] {
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i] as Pt;
    const b = pts[(i + 1) % n] as Pt;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const segs = Math.max(1, Math.round(len / step));
    for (let k = 0; k < segs; k++) {
      const t = k / segs;
      out.push({
        x: a.x + (b.x - a.x) * t + (rnd() * 2 - 1) * amp,
        y: a.y + (b.y - a.y) * t + (rnd() * 2 - 1) * amp,
      });
    }
  }
  return out;
}

function tracePoly(ctx: Ctx2D, pts: readonly Pt[], close: boolean): void {
  ctx.beginPath();
  const first = pts[0];
  if (!first) return;
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i] as Pt;
    ctx.lineTo(p.x, p.y);
  }
  if (close) ctx.closePath();
}

/** Jittered open polyline between two points (for band rules etc.). */
function jitteredSegment(a: Pt, b: Pt, step: number, amp: number, rnd: RandomFn): Pt[] {
  const out: Pt[] = [];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const segs = Math.max(1, Math.round(len / step));
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    out.push({
      x: a.x + (b.x - a.x) * t + (rnd() * 2 - 1) * amp,
      y: a.y + (b.y - a.y) * t + (rnd() * 2 - 1) * amp,
    });
  }
  return out;
}

/* -------------------------------- colors --------------------------------- */

function hslStr(c: HSL, hueShift: number, dl = 0, ds = 0, alpha = 1): string {
  const h = ((c.h + hueShift) % 360 + 360) % 360;
  const s = clamp(c.s + ds, 0, 100);
  const l = clamp(c.l + dl, 0, 100);
  return alpha >= 1 ? `hsl(${h} ${s}% ${l}%)` : `hsl(${h} ${s}% ${l}% / ${alpha})`;
}

/* ------------------------------- ornaments ------------------------------- */

function strokePts(ctx: Ctx2D, pts: readonly Pt[], close: boolean): void {
  tracePoly(ctx, pts, close);
  ctx.stroke();
}

/**
 * The 12 procedural ornament stamps, drawn as simple wobbled paths:
 * 0 diamond, 1 laurel, 2 star, 3 blot, 4 chevron, 5 sun, 6 moon, 7 keyhole,
 * 8 laurel wreath, 9 quill, 10 tree, 11 crescent-with-stars.
 */
function drawOrnament(
  ctx: Ctx2D,
  kind: number,
  cx: number,
  cy: number,
  s: number,
  rnd: RandomFn,
): void {
  const j = (v: number) => v + (rnd() * 2 - 1) * s * 0.06;
  const pt = (x: number, y: number): Pt => ({ x: j(cx + x * s), y: j(cy + y * s) });

  switch (kind) {
    case 0: { // diamond
      strokePts(ctx, [pt(0, -1), pt(0.62, 0), pt(0, 1), pt(-0.62, 0)], true);
      break;
    }
    case 1: { // laurel — two mirrored arcs with leaf ticks
      for (const side of [-1, 1]) {
        const arc: Pt[] = [];
        for (let i = 0; i <= 6; i++) {
          const a = -Math.PI / 3 + (i / 6) * ((2 * Math.PI) / 3);
          arc.push(pt(side * (0.35 + 0.45 * Math.cos(a)) - side * 0.35, Math.sin(a)));
        }
        strokePts(ctx, arc, false);
        for (let i = 1; i <= 3; i++) {
          const a = -Math.PI / 4 + (i / 4) * (Math.PI / 2);
          const bx = side * (0.35 + 0.45 * Math.cos(a)) - side * 0.35;
          const by = Math.sin(a);
          strokePts(ctx, [pt(bx, by), pt(bx + side * 0.28, by - 0.12)], false);
        }
      }
      break;
    }
    case 2: { // star (5-point)
      const star: Pt[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 1 : 0.45;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        star.push(pt(Math.cos(a) * r, Math.sin(a) * r));
      }
      strokePts(ctx, star, true);
      break;
    }
    case 3: { // blot — irregular filled blob
      const blob: Pt[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = 0.55 + rnd() * 0.4;
        blob.push({ x: cx + Math.cos(a) * r * s, y: cy + Math.sin(a) * r * s });
      }
      tracePoly(ctx, blob, true);
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = prevAlpha * 0.8;
      ctx.fill();
      ctx.globalAlpha = prevAlpha;
      break;
    }
    case 4: { // chevron — two stacked zigzags
      for (const dy of [-0.22, 0.22]) {
        strokePts(
          ctx,
          [pt(-0.8, dy - 0.25), pt(-0.4, dy + 0.25), pt(0, dy - 0.25), pt(0.4, dy + 0.25), pt(0.8, dy - 0.25)],
          false,
        );
      }
      break;
    }
    case 5: { // sun — circle + 8 rays
      const circle: Pt[] = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        circle.push(pt(Math.cos(a) * 0.55, Math.sin(a) * 0.55));
      }
      strokePts(ctx, circle, true);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        strokePts(ctx, [pt(Math.cos(a) * 0.7, Math.sin(a) * 0.7), pt(Math.cos(a) * 1.05, Math.sin(a) * 1.05)], false);
      }
      break;
    }
    case 6: { // moon — crescent
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.85, -Math.PI * 0.55, Math.PI * 0.55, false);
      ctx.arc(cx + s * 0.42, cy, s * 0.62, Math.PI * 0.62, -Math.PI * 0.62, true);
      ctx.closePath();
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = prevAlpha * 0.8;
      ctx.fill();
      ctx.globalAlpha = prevAlpha;
      break;
    }
    case 7: { // keyhole
      const circle: Pt[] = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        circle.push(pt(Math.cos(a) * 0.42, -0.35 + Math.sin(a) * 0.42));
      }
      strokePts(ctx, circle, true);
      strokePts(ctx, [pt(-0.16, -0.05), pt(-0.3, 0.85), pt(0.3, 0.85), pt(0.16, -0.05)], true);
      break;
    }
    case 8: { // laurel wreath — full open-topped ring of leaf ticks
      for (const side of [-1, 1]) {
        const arc: Pt[] = [];
        for (let i = 0; i <= 8; i++) {
          // From the bottom (π/2) sweeping up each side, leaving the top open.
          const a = Math.PI / 2 + side * (i / 8) * (Math.PI * 0.82);
          arc.push(pt(Math.cos(a) * 0.85, Math.sin(a) * 0.85));
        }
        strokePts(ctx, arc, false);
        for (let i = 1; i <= 4; i++) {
          const a = Math.PI / 2 + side * (i / 5) * (Math.PI * 0.82);
          const bx = Math.cos(a) * 0.85;
          const by = Math.sin(a) * 0.85;
          strokePts(ctx, [pt(bx, by), pt(bx * 1.35, by * 1.35 - 0.08)], false);
          strokePts(ctx, [pt(bx, by), pt(bx * 0.68, by * 0.68 - 0.06)], false);
        }
      }
      // Ribbon knot at the bottom.
      strokePts(ctx, [pt(-0.18, 0.95), pt(0, 0.78), pt(0.18, 0.95)], false);
      break;
    }
    case 9: { // quill — curved feather shaft with barb ticks and a nib
      const shaft: Pt[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        shaft.push(pt(-0.75 + t * 1.5, 0.85 - t * 1.55 - Math.sin(t * Math.PI) * 0.32));
      }
      strokePts(ctx, shaft, false);
      for (let i = 2; i <= 7; i++) {
        const t = i / 8;
        const bx = -0.75 + t * 1.5;
        const by = 0.85 - t * 1.55 - Math.sin(t * Math.PI) * 0.32;
        strokePts(ctx, [pt(bx, by), pt(bx - 0.3, by - 0.22 + t * 0.1)], false);
      }
      // Nib tick at the writing end.
      strokePts(ctx, [pt(-0.75, 0.85), pt(-0.95, 1.02)], false);
      break;
    }
    case 10: { // tree — trunk, three branch tiers, root flare
      strokePts(ctx, [pt(0, 1), pt(0, -0.25)], false);
      for (const [ty, sp] of [
        [0.45, 0.72],
        [0.05, 0.55],
        [-0.35, 0.36],
      ] as const) {
        strokePts(ctx, [pt(-sp, ty + 0.35), pt(0, ty - 0.2), pt(sp, ty + 0.35)], false);
      }
      strokePts(ctx, [pt(-0.3, 1), pt(0, 0.82), pt(0.3, 1)], false);
      // Tiny crown dot.
      ctx.beginPath();
      ctx.arc(cx, cy - 0.62 * s, s * 0.08, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: { // 11 crescent-with-stars
      ctx.beginPath();
      ctx.arc(cx - s * 0.15, cy + s * 0.1, s * 0.62, -Math.PI * 0.5, Math.PI * 0.5, false);
      ctx.arc(cx + s * 0.17, cy + s * 0.1, s * 0.46, Math.PI * 0.55, -Math.PI * 0.55, true);
      ctx.closePath();
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = prevAlpha * 0.8;
      ctx.fill();
      ctx.globalAlpha = prevAlpha;
      // Three four-point sparkle stars around the crescent.
      for (const [sx, sy, sr] of [
        [0.45, -0.55, 0.2],
        [0.72, 0.05, 0.13],
        [0.28, 0.62, 0.16],
      ] as const) {
        strokePts(ctx, [pt(sx, sy - sr), pt(sx + sr * 0.4, sy), pt(sx, sy + sr), pt(sx - sr * 0.4, sy)], true);
      }
      break;
    }
  }
}

/* -------------------------------- render --------------------------------- */

export interface RenderSpineOptions {
  /**
   * Hi-res variant: adds the vertical title with per-glyph baseline wobble.
   * Lo-res LOD bakes skip text entirely (illegible at that size anyway).
   */
  hiRes?: boolean;
}

/**
 * Render one spine at (x, y) on `ctx`. hPx is the spine height in canvas px;
 * `scale` converts world px → canvas px (params.w * scale = drawn width).
 *
 * params.lean and params.hJitter are NOT applied here — spines are baked
 * upright into atlas rects; the shelf compositor applies lean/height when
 * placing the sprite.
 *
 * Layer order per the docs: base silhouette fill → two layered multiply
 * watercolor gradients → 2px inset pigment-pooling edge → texture → bands →
 * ornament stamp → title (hiRes) → shared granulation overlay → pencil edges.
 */
export function renderSpine(
  ctx: Ctx2D,
  params: SpineParams,
  x: number,
  y: number,
  hPx: number,
  scale: number,
  title: string,
  opts: RenderSpineOptions = {},
): void {
  const w = params.w * scale;
  const h = hPx;
  const duo = PALETTES[params.palette % PALETTES.length] as readonly [HSL, HSL];
  const [colA, colB] = duo;
  const hue = params.hueJitter;
  const rnd = mulberry32((params.seed ^ 0x51ab) >>> 0);

  ctx.save();
  ctx.translate(x, y);

  // --- silhouette fill path (jittered) ---
  const outline = silhouetteOutline(params.silhouette, w, h);
  const step = Math.max(4, 6 * scale);
  const fillPts = densifyJitter(outline, step, 0.6 * scale, rnd);
  tracePoly(ctx, fillPts, true);
  ctx.fillStyle = hslStr(colA, hue);
  ctx.fill();

  // Everything painterly happens clipped to the silhouette.
  ctx.save();
  tracePoly(ctx, fillPts, true);
  ctx.clip();

  // --- two layered multiply watercolor gradients ---
  const g1 = ctx.createLinearGradient(0, 0, 0, h);
  g1.addColorStop(0, hslStr(colA, hue, 8));
  g1.addColorStop(0.55, hslStr(colA, hue));
  g1.addColorStop(1, hslStr(colB, hue));
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = g1;
  ctx.fillRect(-w * 0.05, 0, w * 1.1, h);

  const g2 = ctx.createLinearGradient(0, 0, w, 0);
  g2.addColorStop(0, hslStr(colB, hue, -6));
  g2.addColorStop(0.18, hslStr(colA, hue, 10));
  g2.addColorStop(0.82, hslStr(colA, hue, 6));
  g2.addColorStop(1, hslStr(colB, hue, -8));
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = g2;
  ctx.fillRect(-w * 0.05, 0, w * 1.1, h);

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // --- two-tone binding: darker partner tone over the head section ---
  if (params.twoTone) {
    const splitY = params.twoToneSplit * h;
    const g3 = ctx.createLinearGradient(0, 0, 0, splitY);
    g3.addColorStop(0, hslStr(colB, hue, -2, 4, 0.92));
    g3.addColorStop(1, hslStr(colB, hue, -10, 2, 0.92));
    ctx.fillStyle = g3;
    ctx.fillRect(-w * 0.05, 0, w * 1.1, splitY);
    // Separating rule where the tones meet: gilt on gilt books, ink else.
    if (params.gilt) {
      ctx.fillStyle = GOLD;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(w * 0.04, splitY - 1.1 * scale, w * 0.92, 2.2 * scale);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = hslStr(colB, hue, -22, 0, 0.7);
    ctx.lineWidth = Math.max(0.7, 0.8 * scale);
    strokePts(
      ctx,
      jitteredSegment({ x: 0, y: splitY }, { x: w, y: splitY }, step, 0.4 * scale, rnd),
      false,
    );
  }

  // --- 2px inset pigment-pooling edge (stroke inside the clip) ---
  tracePoly(ctx, fillPts, true);
  ctx.lineWidth = 4 * scale; // clipped: only the inner ~2px shows
  ctx.strokeStyle = hslStr(colB, hue, -12, 0, 0.5);
  ctx.stroke();

  // --- texture pass (contrast raised: cloth/leather must read as materials) ---
  ctx.globalAlpha = 1;
  if (params.texture === 0) {
    // cloth: horizontal weave + a fainter vertical cross-weave
    ctx.strokeStyle = hslStr(colB, hue, -12, 0, 0.1);
    ctx.lineWidth = Math.max(0.5, 0.5 * scale);
    ctx.beginPath();
    const pitch = Math.max(2, 3 * scale);
    for (let yy = pitch / 2; yy < h; yy += pitch) {
      ctx.moveTo(0, yy);
      ctx.lineTo(w, yy);
    }
    ctx.stroke();
    ctx.strokeStyle = hslStr(colA, hue, 10, -6, 0.05);
    ctx.beginPath();
    const vPitch = Math.max(2, 2.4 * scale);
    for (let xx = vPitch / 2; xx < w; xx += vPitch) {
      ctx.moveTo(xx, 0);
      ctx.lineTo(xx, h);
    }
    ctx.stroke();
  } else if (params.texture === 1) {
    // leather: coarse mottle (granulation tile scaled up, multiplied) plus a
    // few soft diagonal creases.
    const tile = getGranulationTile();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.09;
    const ts = GRANULATION_SIZE * 2;
    for (let ty = 0; ty < h; ty += ts) {
      for (let tx = 0; tx < w; tx += ts) {
        ctx.drawImage(tile, tx, ty, ts, ts);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = hslStr(colB, hue, -14, 0, 0.08);
    ctx.lineWidth = Math.max(0.6, 0.7 * scale);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const cy0 = (0.12 + rnd() * 0.76) * h;
      ctx.moveTo(0, cy0);
      ctx.quadraticCurveTo(w * 0.5, cy0 + (rnd() * 2 - 1) * 8 * scale, w, cy0 + (rnd() * 2 - 1) * 5 * scale);
    }
    ctx.stroke();
  } else {
    // paper: sparse vertical fibre streaks
    ctx.strokeStyle = hslStr(colA, hue, 14, -10, 0.05);
    ctx.lineWidth = Math.max(0.5, 0.6 * scale);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const xx = (0.12 + rnd() * 0.76) * w;
      ctx.moveTo(xx, h * 0.05);
      ctx.lineTo(xx + (rnd() * 2 - 1) * 2 * scale, h * 0.95);
    }
    ctx.stroke();
  }

  // --- bands (embossed: every dark rule carries a catchlight rule above) ---
  const inkBand = hslStr(colB, hue, -18, 0, 0.8);
  const embossLight = hslStr(colA, hue, 26, -8, 0.5);
  for (const band of params.bands) {
    const by = band.y * h;
    if (band.kind === 0) {
      // embossed double-rule: light/dark pairs read as raised cords
      ctx.lineWidth = Math.max(0.7, 0.7 * scale);
      for (const dy of [-1.8 * scale, 1.8 * scale]) {
        ctx.strokeStyle = embossLight;
        strokePts(ctx, jitteredSegment({ x: w * 0.06, y: by + dy - 0.9 * scale }, { x: w * 0.94, y: by + dy - 0.9 * scale }, step, 0.35 * scale, rnd), false);
        ctx.strokeStyle = inkBand;
        strokePts(ctx, jitteredSegment({ x: w * 0.06, y: by + dy }, { x: w * 0.94, y: by + dy }, step, 0.4 * scale, rnd), false);
      }
    } else if (band.kind === 1) {
      // thick raised band: shaded fill, catchlight on top, shadow below
      ctx.fillStyle = hslStr(colB, hue, -8, 0, 0.65);
      ctx.fillRect(0, by - 3 * scale, w, 6 * scale);
      ctx.strokeStyle = embossLight;
      ctx.lineWidth = Math.max(0.6, 0.6 * scale);
      strokePts(ctx, jitteredSegment({ x: 0, y: by - 3.8 * scale }, { x: w, y: by - 3.8 * scale }, step, 0.35 * scale, rnd), false);
      ctx.strokeStyle = inkBand;
      ctx.lineWidth = Math.max(0.7, 0.7 * scale);
      for (const dy of [-3 * scale, 3 * scale]) {
        strokePts(ctx, jitteredSegment({ x: 0, y: by + dy }, { x: w, y: by + dy }, step, 0.4 * scale, rnd), false);
      }
    } else {
      // gilt band with an embossed shadow under the gold
      ctx.fillStyle = hslStr(colB, hue, -20, 0, 0.4);
      ctx.fillRect(w * 0.05, by + 1.2 * scale, w * 0.9, 1.2 * scale);
      ctx.fillStyle = GOLD;
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(w * 0.05, by - 1.4 * scale, w * 0.9, 2.8 * scale);
      ctx.globalAlpha = prevAlpha;
      ctx.fillStyle = 'rgba(255, 244, 214, 0.55)';
      ctx.fillRect(w * 0.08, by - 1.4 * scale, w * 0.84, 0.8 * scale);
      ctx.strokeStyle = hslStr(colB, hue, -20, 0, 0.5);
      ctx.lineWidth = Math.max(0.5, 0.5 * scale);
      strokePts(ctx, jitteredSegment({ x: w * 0.05, y: by }, { x: w * 0.95, y: by }, step, 0.3 * scale, rnd), false);
    }
  }

  // --- head/tail endbands: striped caps at the very top and bottom ---
  if (params.headTail) {
    const bandH = 4.2 * scale;
    const stripeW = Math.max(2.2 * scale, 3);
    const capColor = params.gilt ? GOLD : hslStr(colB, hue, -16);
    const creamColor = 'hsl(43 48% 88%)';
    for (const [cy0, edgeY] of [
      [0.6 * scale, 0],
      [h - bandH - 0.6 * scale, h],
    ] as const) {
      ctx.fillStyle = creamColor;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(w * 0.04, cy0, w * 0.92, bandH);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = capColor;
      for (let sx = w * 0.04; sx < w * 0.96; sx += stripeW * 2) {
        ctx.fillRect(sx, cy0, Math.min(stripeW, w * 0.96 - sx), bandH);
      }
      ctx.globalAlpha = 1;
      // Seat line where the endband meets the boards.
      ctx.strokeStyle = hslStr(colB, hue, -24, 0, 0.55);
      ctx.lineWidth = Math.max(0.6, 0.6 * scale);
      const seamY = edgeY === 0 ? cy0 + bandH : cy0;
      strokePts(ctx, jitteredSegment({ x: w * 0.03, y: seamY }, { x: w * 0.97, y: seamY }, step, 0.35 * scale, rnd), false);
    }
  }

  // --- ornament stamp ---
  const inkColor = params.gilt ? GOLD : hslStr(colB, hue, -24, 0, 0.85);
  ctx.strokeStyle = inkColor;
  ctx.fillStyle = inkColor;
  ctx.lineWidth = Math.max(1, 1.1 * scale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  drawOrnament(ctx, params.ornament, w / 2, h * 0.78, Math.min(w * 0.3, 11 * scale), rnd);

  // --- vertical title (hiRes only) ---
  if (opts.hiRes && title.length > 0) {
    const fontPx = clamp(w * 0.52, 10 * scale, 20 * scale);
    ctx.font = `${fontPx.toFixed(2)}px ${FONTS[params.font] as string}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = params.gilt ? GOLD : hslStr(colB, hue, -30, 0, 0.9);
    ctx.save();
    ctx.translate(w / 2, h * 0.12);
    ctx.rotate(Math.PI / 2);
    const trnd = mulberry32((params.seed ^ 0x7115) >>> 0);
    const maxLen = h * 0.58;
    let advance = 0;
    for (const ch of title) {
      const cw = ctx.measureText(ch).width;
      if (advance + cw > maxLen) break;
      // Per-glyph baseline wobble: rnd()*1.2 - 0.6 px (scaled).
      const wob = (trnd() * 1.2 - 0.6) * scale;
      ctx.fillText(ch, advance, wob);
      advance += cw;
    }
    ctx.restore();
  }

  // --- shared granulation overlay ---
  const tile = getGranulationTile();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.06;
  for (let ty = 0; ty < h; ty += GRANULATION_SIZE) {
    for (let tx = 0; tx < w; tx += GRANULATION_SIZE) {
      ctx.drawImage(tile, tx, ty);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // --- tiny wear highlights: rubbed edges and corner scuffs ---
  const wearInk = hslStr(colA, hue, 30, -18, 0.28);
  ctx.strokeStyle = wearInk;
  ctx.lineWidth = Math.max(0.6, 0.7 * scale);
  ctx.lineCap = 'round';
  const wearCount = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < wearCount; i++) {
    const edgeX = rnd() < 0.5 ? 1.2 * scale : w - 1.2 * scale;
    const wy = (0.08 + rnd() * 0.84) * h;
    const len = (6 + rnd() * 14) * scale;
    ctx.beginPath();
    ctx.moveTo(edgeX, wy);
    ctx.lineTo(edgeX + (rnd() * 2 - 1) * 0.8 * scale, wy + len);
    ctx.stroke();
  }
  // Corner scuffs at the tail (books get shelved bottom-first).
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = hslStr(colA, hue, 34, -16);
  for (const cxx of [1.5 * scale, w - 1.5 * scale]) {
    ctx.beginPath();
    ctx.arc(cxx, h - 2 * scale, (1.6 + rnd() * 1.4) * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.restore(); // end clip

  // --- pencil edges: per-vertex jittered, double-stroked, alpha 0.55 ---
  ctx.strokeStyle = GRAPHITE;
  ctx.lineWidth = Math.max(0.8, 0.9 * scale);
  ctx.lineJoin = 'round';
  const passA = densifyJitter(outline, step, 0.7 * scale, rnd);
  tracePoly(ctx, passA, true);
  ctx.stroke();
  const passB = densifyJitter(outline, step, 0.55 * scale, rnd);
  ctx.save();
  ctx.translate(0.5 * scale, -0.4 * scale);
  tracePoly(ctx, passB, true);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}
