/**
 * art/wood.ts — procedural shelf wood (L1 environment art).
 *
 * Canvas 2D + simplex noise per the art-pipeline doc: anisotropic grain
 * computed in 4px bands then smooth-scaled (never per-pixel JS at full res),
 * ring quantization eased with ^1.8, plank palette #8a6a48→#6f5138, seeded
 * knots, wobbled graphite seams/front edge, granulation multiply, and two
 * radial-gradient multiply vignettes. Baked once per width×DPR and persisted
 * through the bake.ts disk cache.
 */

import * as P from './brush';
import { bakeCached } from './bake';
import { fnv1a, fract, lerp, mulberry32, seededNoise2D } from './noise';
import { getGranulationTile, type Canvas2D, type Ctx2D } from './spines';
import type { WoodSpec } from './themes';
import { doubleStroke } from './wobble';

/** Shelf plank height in world px (FLOOR_H 320 = plank 40 + book zone 280). */
export const PLANK_HEIGHT_WORLD = 40;

/** Approximate world-px length of one plank segment (seam spacing). */
const PLANK_SEGMENT_WORLD = 240;

/** Low-res band size in device px (compute noise coarse, smooth-scale up). */
const BAND_PX = 3;

/**
 * Long directional grain streaks — the pass that makes baked wood read as
 * brushed timber instead of noise mush. Draws `count` wavy strokes along the
 * grain axis at very low alpha in alternating light/dark inks.
 * Coordinates are world px; caller has ctx.scale(dpr, dpr) active.
 */
function grainStreaks(
  ctx: OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  vertical: boolean,
  count: number,
  seed: number,
): void {
  const rnd = mulberry32(seed >>> 0);
  const along = vertical ? h : w;
  const across = vertical ? w : h;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const dark = rnd() < 0.55;
    ctx.strokeStyle = dark
      ? `rgba(58, 42, 26, ${0.05 + rnd() * 0.07})`
      : `rgba(228, 200, 160, ${0.05 + rnd() * 0.06})`;
    ctx.lineWidth = 0.7 + rnd() * 1.4;
    const a0 = rnd() * across;
    const drift = (rnd() * 2 - 1) * 6;
    const start = -10 + rnd() * along * 0.35;
    const len = along * (0.35 + rnd() * 0.65);
    ctx.beginPath();
    let prevA = a0;
    const segs = 4;
    for (let s0 = 0; s0 <= segs; s0++) {
      const t = start + (len * s0) / segs;
      const a = a0 + (drift * s0) / segs + (rnd() * 2 - 1) * 1.6;
      if (s0 === 0) {
        ctx.moveTo(vertical ? a : t, vertical ? t : a);
      } else {
        const midT = start + (len * (s0 - 0.5)) / segs;
        const midA = (prevA + a) / 2 + (rnd() * 2 - 1) * 1.2;
        ctx.quadraticCurveTo(
          vertical ? midA : midT,
          vertical ? midT : midA,
          vertical ? a : t,
          vertical ? t : a,
        );
      }
      prevA = a;
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Richer than the original doc duo (#8a6a48→#6f5138): the flat look read as
// "cheap"; a wider light↔dark spread gives the grain visible depth.
const WOOD_LIGHT = { r: 0x96, g: 0x74, b: 0x4e }; // #96744e
const WOOD_DARK = { r: 0x5c, g: 0x42, b: 0x2b }; // #5c422b

/** Gold inlay ink used for the thin pinstripes on rails/planks/crown. */
const GOLD_INK = 'rgba(201, 162, 62, 0.5)';
const GOLD_INK_SOFT = 'rgba(214, 178, 88, 0.28)';

interface Knot {
  x: number;
  y: number;
  r: number;
}

/**
 * A round joinery peg: shaded end-grain dot with a top-left catchlight and a
 * doubled pencil ring — the little touch that sells "built furniture".
 * Coordinates in world px; caller has already ctx.scale(dpr, dpr)-ed.
 */
function drawPeg(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  seed: number,
): void {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.15, x, y, r);
  g.addColorStop(0, '#7d5f3f');
  g.addColorStop(0.55, '#5a422c');
  g.addColorStop(1, '#43301f');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // Catchlight arc.
  ctx.strokeStyle = 'rgba(255, 240, 214, 0.4)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.arc(x - r * 0.18, y - r * 0.18, r * 0.55, Math.PI * 0.8, Math.PI * 1.6);
  ctx.stroke();
  // Doubled pencil ring.
  ctx.strokeStyle = 'rgba(50, 40, 30, 0.6)';
  ctx.lineWidth = 1;
  const ring = (rr: number): string => {
    // Approximate circle as 4 cubic arcs via path string for doubleStroke.
    const k = rr * 0.5523;
    return (
      `M ${x - rr} ${y} C ${x - rr} ${y - k}, ${x - k} ${y - rr}, ${x} ${y - rr} ` +
      `C ${x + k} ${y - rr}, ${x + rr} ${y - k}, ${x + rr} ${y} ` +
      `C ${x + rr} ${y + k}, ${x + k} ${y + rr}, ${x} ${y + rr} ` +
      `C ${x - k} ${y + rr}, ${x - rr} ${y + k}, ${x - rr} ${y} Z`
    );
  };
  const [a, b] = doubleStroke(ring(r), { seed: seed >>> 0, amplitude: 0.35, frequency: 0.09 });
  ctx.stroke(new Path2D(a));
  ctx.stroke(new Path2D(b));
}

function renderPlank(widthWorldPx: number, dpr: number): OffscreenCanvas {
  const wDev = Math.max(1, Math.ceil(widthWorldPx * dpr));
  const hDev = Math.max(1, Math.ceil(PLANK_HEIGHT_WORLD * dpr));
  const canvas = new OffscreenCanvas(wDev, hDev);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('wood: 2d context unavailable');

  const seed = fnv1a(`plank|${widthWorldPx}`);
  const rnd = mulberry32(seed);
  const noise = seededNoise2D(seed);

  // 2–3 seeded knots per plank strip.
  const knots: Knot[] = [];
  const knotCount = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < knotCount; i++) {
    knots.push({
      x: rnd() * widthWorldPx,
      y: 6 + rnd() * (PLANK_HEIGHT_WORLD - 12),
      r: 5 + rnd() * 7,
    });
  }

  // --- grain field at quarter resolution (4px bands), then smooth-scale ---
  const lw = Math.max(1, Math.ceil(wDev / BAND_PX));
  const lh = Math.max(1, Math.ceil(hDev / BAND_PX));
  const low = new OffscreenCanvas(lw, lh);
  const lowCtx = low.getContext('2d');
  if (!lowCtx) throw new Error('wood: 2d context unavailable');
  const img = lowCtx.createImageData(lw, lh);
  const data = img.data;
  for (let py = 0; py < lh; py++) {
    // World coords of this band.
    const sy = (py * BAND_PX) / dpr;
    for (let px = 0; px < lw; px++) {
      const sx = (px * BAND_PX) / dpr;
      // Anisotropic stretch = grain direction. Kept low-frequency so the
      // band-resolution field upscales silky instead of blocky.
      const g = noise(sx * 0.006, sy * 0.045);
      let ring = g * 3.2;
      for (const k of knots) {
        const d = Math.hypot(sx - k.x, sy - k.y);
        ring += 0.5 * Math.exp(-(d * d) / (k.r * k.r)) * Math.sin(d * 0.35);
      }
      const t = Math.pow(fract(ring), 1.5) * 0.8 + 0.1;
      const i = (py * lw + px) * 4;
      data[i] = Math.round(lerp(WOOD_LIGHT.r, WOOD_DARK.r, t));
      data[i + 1] = Math.round(lerp(WOOD_LIGHT.g, WOOD_DARK.g, t));
      data[i + 2] = Math.round(lerp(WOOD_LIGHT.b, WOOD_DARK.b, t));
      data[i + 3] = 255;
    }
  }
  lowCtx.putImageData(img, 0, 0);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(low, 0, 0, lw, lh, 0, 0, wDev, hDev);

  // Directional grain streaks: long wavy light/dark strokes along the plank.
  ctx.save();
  ctx.scale(dpr, dpr);
  grainStreaks(ctx, widthWorldPx, PLANK_HEIGHT_WORLD, false, Math.round(widthWorldPx / 14), seed ^ 0x5eae);
  ctx.restore();

  // --- granulation tile, multiplied at 0.08 ---
  const tile = getGranulationTile();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.08;
  const tileSize = 256;
  for (let ty = 0; ty < hDev; ty += tileSize) {
    for (let tx = 0; tx < wDev; tx += tileSize) {
      ctx.drawImage(tile, tx, ty);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // --- lit shelf face: the plank faces the viewer and catches light, which
  // separates it from the shadowed back panel so books read as standing ON
  // it. Bright top lip fading to a darker under-edge (all baked opaque).
  const face = ctx.createLinearGradient(0, 0, 0, hDev);
  face.addColorStop(0, 'rgba(255, 248, 232, 0.42)');
  face.addColorStop(0.22, 'rgba(255, 246, 228, 0.16)');
  face.addColorStop(0.75, 'rgba(255, 255, 255, 0)');
  face.addColorStop(1, 'rgba(58, 44, 30, 0.18)');
  ctx.fillStyle = face;
  ctx.fillRect(0, 0, wDev, hDev);

  // --- plank seams + edge outlines: wobbled graphite at 55% alpha ---
  ctx.save();
  ctx.scale(dpr, dpr); // stroke geometry authored in world px
  ctx.strokeStyle = 'rgba(60, 52, 44, 0.55)';
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';

  let seamIndex = 0;
  const seamXs: number[] = [];
  for (let sx = PLANK_SEGMENT_WORLD; sx < widthWorldPx - 20; sx += PLANK_SEGMENT_WORLD) {
    const jx = sx + (rnd() * 2 - 1) * 12;
    seamXs.push(jx);
    const [seamA, seamB] = doubleStroke(
      `M ${jx} 1 L ${jx} ${PLANK_HEIGHT_WORLD - 1}`,
      { seed: (seed + 101 * seamIndex) >>> 0, amplitude: 0.9, frequency: 0.05 },
    );
    ctx.stroke(new Path2D(seamA));
    ctx.stroke(new Path2D(seamB));
    seamIndex++;
  }

  // Top edge of the shelf lip: penciled line right where books stand.
  const [topA, topB] = doubleStroke(
    `M 0 1.4 L ${widthWorldPx} 1.4`,
    { seed: (seed ^ 0x70e) >>> 0, amplitude: 0.6, frequency: 0.03 },
  );
  ctx.stroke(new Path2D(topA));
  ctx.stroke(new Path2D(topB));

  // Front edge of the shelf: doubled wobbled line near the bottom.
  const edgeY = PLANK_HEIGHT_WORLD - 1.5;
  const [edgeA, edgeB] = doubleStroke(
    `M 0 ${edgeY} L ${widthWorldPx} ${edgeY}`,
    { seed: (seed ^ 0xed6e) >>> 0, amplitude: 0.8, frequency: 0.03 },
  );
  ctx.stroke(new Path2D(edgeA));
  ctx.stroke(new Path2D(edgeB));

  // Thin gold pinstripe inlay along the shelf lip (fades under the vignette).
  ctx.strokeStyle = GOLD_INK_SOFT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(12, 6.5);
  ctx.lineTo(widthWorldPx - 12, 6.5);
  ctx.stroke();

  // Joinery pegs: a pair at each rail joint, one at every plank seam.
  const pegCtx = ctx as unknown as OffscreenCanvasRenderingContext2D;
  for (const px of [50, widthWorldPx - 50]) {
    drawPeg(pegCtx, px, 13.5, 3.4, seed ^ Math.round(px));
    drawPeg(pegCtx, px, 27.5, 3.4, (seed ^ Math.round(px)) + 7);
  }
  for (const sx of seamXs) {
    drawPeg(pegCtx, sx, 20, 3.1, seed ^ (Math.round(sx) * 3));
  }
  ctx.restore();

  // --- vignette: two radial gradients, multiplied ---
  ctx.globalCompositeOperation = 'multiply';
  const v1 = ctx.createRadialGradient(
    wDev * 0.3, hDev * 0.25, 0,
    wDev * 0.3, hDev * 0.25, Math.max(wDev, hDev) * 0.75,
  );
  v1.addColorStop(0, '#ffffff');
  v1.addColorStop(1, '#c9b8a2');
  ctx.fillStyle = v1;
  ctx.fillRect(0, 0, wDev, hDev);

  const v2 = ctx.createRadialGradient(
    wDev * 0.72, hDev * 0.9, 0,
    wDev * 0.72, hDev * 0.9, Math.max(wDev, hDev) * 0.85,
  );
  v2.addColorStop(0, '#ffffff');
  v2.addColorStop(1, '#d2c2ac');
  ctx.fillStyle = v2;
  ctx.fillRect(0, 0, wDev, hDev);
  ctx.globalCompositeOperation = 'source-over';

  return canvas;
}

/**
 * Bake (or fetch from cache) a shelf plank strip.
 * widthWorldPx is the plank width in world px; the height is always
 * PLANK_HEIGHT_WORLD. Returned bitmap is shared — do not close() it.
 */
export function bakeShelfPlank(widthWorldPx: number, dpr: number): Promise<ImageBitmap> {
  return bakeCached(`wood|plank|${widthWorldPx}x${PLANK_HEIGHT_WORLD}`, dpr, async () =>
    renderPlank(widthWorldPx, dpr),
  );
}

/* ---------------------------- under-shelf shadow -------------------------- */

/**
 * Geometry of the under-plank shadow strip, in world px. Each floor draws it
 * at the TOP of its own book zone — the shadow cast by the plank (or crown)
 * directly above — so it always shades the back panel behind the book tops
 * and bakes correctly into LOD2 floor stamps. `inset` is kept for the 9-slice
 * corners near the rails.
 */
export const SHADOW_STRIP = {
  w: 128,
  h: 26,
  /** Corner inset for 9-slice stretching. */
  inset: 16,
} as const;

/**
 * Bake the under-plank shadow strip: a strong dark core hugging the plank
 * edge dissolving into a soft pool, slightly deeper at the rail ends
 * (corners of the 9-slice) where less light reaches.
 */
export function bakeShelfShadowStrip(dpr: number): Promise<ImageBitmap> {
  return bakeCached(`wood|shadow|${SHADOW_STRIP.w}x${SHADOW_STRIP.h}`, dpr, async () => {
    const wDev = Math.ceil(SHADOW_STRIP.w * dpr);
    const hDev = Math.ceil(SHADOW_STRIP.h * dpr);
    const canvas = new OffscreenCanvas(wDev, hDev);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('wood: 2d context unavailable');
    ctx.scale(dpr, dpr);

    // Vertical falloff: dark under the plank edge, gone by ~26px down.
    const g = ctx.createLinearGradient(0, 0, 0, SHADOW_STRIP.h);
    g.addColorStop(0, 'rgba(40, 31, 22, 0.42)');
    g.addColorStop(0.28, 'rgba(43, 34, 24, 0.22)');
    g.addColorStop(0.7, 'rgba(46, 36, 26, 0.07)');
    g.addColorStop(1, 'rgba(46, 36, 26, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SHADOW_STRIP.w, SHADOW_STRIP.h);

    // Corner pools: the 9-slice keeps these at the rail ends.
    for (const cx of [0, SHADOW_STRIP.w]) {
      const r = ctx.createRadialGradient(cx, 0, 0, cx, 0, SHADOW_STRIP.inset * 1.6);
      r.addColorStop(0, 'rgba(36, 28, 20, 0.2)');
      r.addColorStop(1, 'rgba(36, 28, 20, 0)');
      ctx.fillStyle = r;
      ctx.fillRect(0, 0, SHADOW_STRIP.w, SHADOW_STRIP.h);
    }
    return canvas;
  });
}

/* -------------------------------- back panel ------------------------------ */

const BACK_LIGHT = { r: 0x6b, g: 0x54, b: 0x3b }; // #6b543b
const BACK_DARK = { r: 0x54, g: 0x41, b: 0x2d }; // #54412d

/**
 * Bake the case back panel for one floor's book zone: a darker warm board
 * wall with subtle vertical planking, soft top shading, and inner ambient
 * occlusion where it meets the side rails. Shared by every floor.
 */
export function bakeBackPanel(
  widthWorldPx: number,
  heightWorldPx: number,
  dpr: number,
): Promise<ImageBitmap> {
  return bakeCached(`wood|back|${widthWorldPx}x${heightWorldPx}`, dpr, async () => {
    const wDev = Math.ceil(widthWorldPx * dpr);
    const hDev = Math.ceil(heightWorldPx * dpr);
    const canvas = new OffscreenCanvas(wDev, hDev);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('wood: 2d context unavailable');

    const seed = fnv1a(`back|${widthWorldPx}x${heightWorldPx}`);
    const rnd = mulberry32(seed);
    const noise = seededNoise2D(seed);

    // Vertical grain field at quarter resolution (boards run upright).
    const lw = Math.max(1, Math.ceil(wDev / BAND_PX));
    const lh = Math.max(1, Math.ceil(hDev / BAND_PX));
    const low = new OffscreenCanvas(lw, lh);
    const lowCtx = low.getContext('2d');
    if (!lowCtx) throw new Error('wood: 2d context unavailable');
    const img = lowCtx.createImageData(lw, lh);
    const data = img.data;
    for (let py = 0; py < lh; py++) {
      const sy = (py * BAND_PX) / dpr;
      for (let px = 0; px < lw; px++) {
        const sx = (px * BAND_PX) / dpr;
        // Anisotropy rotated 90° vs the plank: grain flows down the boards.
        // Low contrast — the panel is a quiet backdrop, not a feature wall.
        const gN = noise(sx * 0.028, sy * 0.005);
        const t = Math.pow(fract(gN * 2.8), 1.5) * 0.42 + 0.22;
        const i = (py * lw + px) * 4;
        data[i] = Math.round(lerp(BACK_LIGHT.r, BACK_DARK.r, t));
        data[i + 1] = Math.round(lerp(BACK_LIGHT.g, BACK_DARK.g, t));
        data[i + 2] = Math.round(lerp(BACK_LIGHT.b, BACK_DARK.b, t));
        data[i + 3] = 255;
      }
    }
    lowCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(low, 0, 0, lw, lh, 0, 0, wDev, hDev);

    // Vertical grain streaks down the boards (quiet — it's a backdrop).
    ctx.save();
    ctx.scale(dpr, dpr);
    grainStreaks(ctx, widthWorldPx, heightWorldPx, true, Math.round(widthWorldPx / 24), seed ^ 0xbac);
    ctx.restore();

    // Granulation multiply.
    const tile = getGranulationTile();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.07;
    for (let ty = 0; ty < hDev; ty += 256) {
      for (let tx = 0; tx < wDev; tx += 256) ctx.drawImage(tile, tx, ty);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Board seams: faint wobbled verticals every ~150 world px.
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = 'rgba(38, 30, 22, 0.22)';
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    let seamIndex = 0;
    for (let sx = 130; sx < widthWorldPx - 40; sx += 130 + rnd() * 46) {
      const [a, b] = doubleStroke(`M ${sx} 0 L ${sx} ${heightWorldPx}`, {
        seed: (seed + 977 * seamIndex) >>> 0,
        amplitude: 1.1,
        frequency: 0.03,
      });
      ctx.stroke(new Path2D(a));
      ctx.stroke(new Path2D(b));
      seamIndex++;
    }
    ctx.restore();

    // Inner AO at the rails + gentle top-down shading (multiply passes).
    ctx.globalCompositeOperation = 'multiply';
    const aoW = Math.ceil(56 * dpr);
    const left = ctx.createLinearGradient(0, 0, aoW, 0);
    left.addColorStop(0, '#9f8f7c');
    left.addColorStop(1, '#ffffff');
    ctx.fillStyle = left;
    ctx.fillRect(0, 0, aoW, hDev);
    const right = ctx.createLinearGradient(wDev, 0, wDev - aoW, 0);
    right.addColorStop(0, '#9f8f7c');
    right.addColorStop(1, '#ffffff');
    ctx.fillStyle = right;
    ctx.fillRect(wDev - aoW, 0, aoW, hDev);
    const top = ctx.createLinearGradient(0, 0, 0, hDev);
    top.addColorStop(0, '#bdb0a0');
    top.addColorStop(0.35, '#ffffff');
    top.addColorStop(0.88, '#efe6d8');
    top.addColorStop(1, '#c8b69e');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, wDev, hDev);
    ctx.globalCompositeOperation = 'source-over';

    return canvas;
  });
}

/* -------------------------------- side rail ------------------------------- */

/**
 * Bake one vertical side rail segment (one floor tall). Drawn at both case
 * edges (mirrored on the right), IN FRONT of planks and books, so shelves
 * read as slotted into the frame. Grain variation over y is kept low so the
 * per-floor repeat has no visible seam.
 */
export function bakeSideRail(
  railWorldPx: number,
  heightWorldPx: number,
  dpr: number,
): Promise<ImageBitmap> {
  return bakeCached(`wood|rail|${railWorldPx}x${heightWorldPx}`, dpr, async () => {
    const wDev = Math.ceil(railWorldPx * dpr);
    const hDev = Math.ceil(heightWorldPx * dpr);
    const canvas = new OffscreenCanvas(wDev, hDev);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('wood: 2d context unavailable');

    const seed = fnv1a(`rail|${railWorldPx}x${heightWorldPx}`);
    const noise = seededNoise2D(seed);

    // Vertical grain, nearly y-invariant (seamless floor-to-floor repeat).
    const lw = Math.max(1, Math.ceil(wDev / BAND_PX));
    const lh = Math.max(1, Math.ceil(hDev / BAND_PX));
    const low = new OffscreenCanvas(lw, lh);
    const lowCtx = low.getContext('2d');
    if (!lowCtx) throw new Error('wood: 2d context unavailable');
    const img = lowCtx.createImageData(lw, lh);
    const data = img.data;
    for (let py = 0; py < lh; py++) {
      const sy = (py * BAND_PX) / dpr;
      for (let px = 0; px < lw; px++) {
        const sx = (px * BAND_PX) / dpr;
        const gN = noise(sx * 0.09, sy * 0.003);
        const t = Math.pow(fract(gN * 2.6), 1.5) * 0.85 + 0.08;
        const i = (py * lw + px) * 4;
        data[i] = Math.round(lerp(WOOD_LIGHT.r, WOOD_DARK.r, t));
        data[i + 1] = Math.round(lerp(WOOD_LIGHT.g, WOOD_DARK.g, t));
        data[i + 2] = Math.round(lerp(WOOD_LIGHT.b, WOOD_DARK.b, t));
        data[i + 3] = 255;
      }
    }
    lowCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(low, 0, 0, lw, lh, 0, 0, wDev, hDev);

    // Vertical streaks (few — the rail is narrow).
    ctx.save();
    ctx.scale(dpr, dpr);
    grainStreaks(ctx, railWorldPx, heightWorldPx, true, 9, seed ^ 0x11a);
    ctx.restore();

    // Granulation.
    const tile = getGranulationTile();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.08;
    for (let ty = 0; ty < hDev; ty += 256) ctx.drawImage(tile, 0, ty);
    ctx.globalAlpha = 1;

    // Rounded-form shading: darker at both long edges, lit center-left.
    const form = ctx.createLinearGradient(0, 0, wDev, 0);
    form.addColorStop(0, '#8d7c68');
    form.addColorStop(0.28, '#ffffff');
    form.addColorStop(0.75, '#efe6d8');
    form.addColorStop(1, '#7e6c58');
    ctx.fillStyle = form;
    ctx.fillRect(0, 0, wDev, hDev);
    ctx.globalCompositeOperation = 'source-over';

    // Doubled pencil edges down both sides (wobble amplitude kept small so
    // the per-floor repeat lines up without a visible kink).
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = 'rgba(60, 52, 44, 0.55)';
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    for (const [ex, edgeSeed] of [
      [1.4, seed ^ 0x11],
      [railWorldPx - 1.4, seed ^ 0x22],
    ] as const) {
      const [a, b] = doubleStroke(`M ${ex} 0 L ${ex} ${heightWorldPx}`, {
        seed: edgeSeed >>> 0,
        amplitude: 0.55,
        frequency: 0.02,
      });
      ctx.stroke(new Path2D(a));
      ctx.stroke(new Path2D(b));
    }

    // Thin gold pinstripe inlay: a dead-straight pair just inside the pencil
    // edges (straight so the per-floor repeat is seamless).
    ctx.strokeStyle = GOLD_INK;
    ctx.lineWidth = 0.9;
    for (const gx of [6.5, railWorldPx - 6.5]) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, heightWorldPx);
      ctx.stroke();
    }

    // Joinery pegs where the shelf tenons into the rail: one pair per floor,
    // sitting at the plank band near the bottom of the repeat.
    const pegY = heightWorldPx - PLANK_HEIGHT_WORLD / 2;
    drawPeg(ctx, railWorldPx * 0.5, pegY, 3.6, seed ^ 0x515);
    ctx.restore();

    return canvas;
  });
}

/* --------------------------------- crown ---------------------------------- */

/**
 * Bake the crown/header board that caps the case above floor 0 — horizontal
 * wood with a penciled outline, a darker cornice lip along the bottom edge,
 * and a small centered pencil flourish.
 */
export function bakeCrown(
  widthWorldPx: number,
  heightWorldPx: number,
  dpr: number,
): Promise<ImageBitmap> {
  return bakeCached(`wood|crown|${widthWorldPx}x${heightWorldPx}`, dpr, async () => {
    const wDev = Math.ceil(widthWorldPx * dpr);
    const hDev = Math.ceil(heightWorldPx * dpr);
    const canvas = new OffscreenCanvas(wDev, hDev);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('wood: 2d context unavailable');

    const seed = fnv1a(`crown|${widthWorldPx}x${heightWorldPx}`);
    const noise = seededNoise2D(seed);

    // Horizontal grain like the planks.
    const lw = Math.max(1, Math.ceil(wDev / BAND_PX));
    const lh = Math.max(1, Math.ceil(hDev / BAND_PX));
    const low = new OffscreenCanvas(lw, lh);
    const lowCtx = low.getContext('2d');
    if (!lowCtx) throw new Error('wood: 2d context unavailable');
    const img = lowCtx.createImageData(lw, lh);
    const data = img.data;
    for (let py = 0; py < lh; py++) {
      const sy = (py * BAND_PX) / dpr;
      for (let px = 0; px < lw; px++) {
        const sx = (px * BAND_PX) / dpr;
        const gN = noise(sx * 0.0035, sy * 0.03);
        const t = Math.pow(fract(gN * 2.3), 1.4) * 0.72 + 0.12;
        const i = (py * lw + px) * 4;
        data[i] = Math.round(lerp(WOOD_LIGHT.r, WOOD_DARK.r, t));
        data[i + 1] = Math.round(lerp(WOOD_LIGHT.g, WOOD_DARK.g, t));
        data[i + 2] = Math.round(lerp(WOOD_LIGHT.b, WOOD_DARK.b, t));
        data[i + 3] = 255;
      }
    }
    lowCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(low, 0, 0, lw, lh, 0, 0, wDev, hDev);

    // Horizontal grain streaks across the header board.
    ctx.save();
    ctx.scale(dpr, dpr);
    grainStreaks(ctx, widthWorldPx, heightWorldPx, false, Math.round(widthWorldPx / 18), seed ^ 0x37);
    ctx.restore();

    // Granulation + lighting: lit top, darker cornice lip at the bottom.
    const tile = getGranulationTile();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.08;
    for (let tx = 0; tx < wDev; tx += 256) ctx.drawImage(tile, tx, 0);
    ctx.globalAlpha = 1;
    const lipY = hDev * (1 - 10 / heightWorldPx);
    const lift = ctx.createLinearGradient(0, 0, 0, hDev);
    lift.addColorStop(0, '#fffdf8');
    lift.addColorStop(0.12, '#f3ecdf');
    lift.addColorStop(0.8, '#e9dfcf');
    lift.addColorStop(1, '#b7a68e');
    ctx.fillStyle = lift;
    ctx.fillRect(0, 0, wDev, hDev);
    ctx.fillStyle = 'rgba(84, 65, 45, 0.28)';
    ctx.fillRect(0, lipY, wDev, hDev - lipY);
    ctx.globalCompositeOperation = 'source-over';

    // Pencil outline + lip rule + a small centered flourish.
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = 'rgba(60, 52, 44, 0.55)';
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    const outline = [
      `M 1 1 L ${widthWorldPx - 1} 1`,
      `M 1 ${heightWorldPx - 1} L ${widthWorldPx - 1} ${heightWorldPx - 1}`,
      `M 1 1 L 1 ${heightWorldPx - 1}`,
      `M ${widthWorldPx - 1} 1 L ${widthWorldPx - 1} ${heightWorldPx - 1}`,
      `M 4 ${heightWorldPx - 10} L ${widthWorldPx - 4} ${heightWorldPx - 10}`,
    ];
    outline.forEach((d, i) => {
      const [a, b] = doubleStroke(d, {
        seed: (seed + 31 * i) >>> 0,
        amplitude: 0.8,
        frequency: 0.025,
      });
      ctx.stroke(new Path2D(a));
      ctx.stroke(new Path2D(b));
    });

    // Carved cornice: a dentil course (little tooth blocks) above the lip,
    // shaded so each block reads as relief, under a thin gold pinstripe.
    const dentilTop = heightWorldPx - 19;
    const dentilBottom = heightWorldPx - 11.5;
    for (let dx = 10; dx + 8 < widthWorldPx - 10; dx += 16) {
      ctx.fillStyle = 'rgba(64, 48, 32, 0.30)';
      ctx.fillRect(dx, dentilTop, 8, dentilBottom - dentilTop);
      ctx.fillStyle = 'rgba(255, 244, 222, 0.22)';
      ctx.fillRect(dx, dentilTop, 8, 1.4);
      ctx.fillStyle = 'rgba(40, 30, 20, 0.28)';
      ctx.fillRect(dx + 6.8, dentilTop, 1.2, dentilBottom - dentilTop);
    }
    ctx.strokeStyle = GOLD_INK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(8, dentilTop - 3);
    ctx.lineTo(widthWorldPx - 8, dentilTop - 3);
    ctx.stroke();

    // Carved scallop course under the top edge (soft shadow arcs).
    ctx.strokeStyle = 'rgba(60, 46, 32, 0.30)';
    ctx.lineWidth = 1.1;
    for (let sx0 = 14; sx0 + 20 < widthWorldPx - 12; sx0 += 24) {
      ctx.beginPath();
      ctx.arc(sx0 + 10, 6.5, 8.5, Math.PI * 0.12, Math.PI * 0.88);
      ctx.stroke();
    }

    // Corner rosette pegs on the cornice lip.
    drawPeg(ctx, 16, heightWorldPx - 5.5, 3.2, seed ^ 0xc0);
    drawPeg(ctx, widthWorldPx - 16, heightWorldPx - 5.5, 3.2, seed ^ 0xc1);
    // Flourish: a lazy "~~" swash with a diamond, centered.
    const cx = widthWorldPx / 2;
    const cy = (heightWorldPx - 10) / 2 + 2;
    ctx.strokeStyle = 'rgba(60, 52, 44, 0.4)';
    const swash = `M ${cx - 60} ${cy} C ${cx - 40} ${cy - 6}, ${cx - 24} ${cy + 6}, ${cx - 12} ${cy}`;
    const swashR = `M ${cx + 12} ${cy} C ${cx + 24} ${cy - 6}, ${cx + 40} ${cy + 6}, ${cx + 60} ${cy}`;
    for (const d of [swash, swashR]) {
      const [a, b] = doubleStroke(d, { seed: (seed ^ 0x77) >>> 0, amplitude: 0.6, frequency: 0.04 });
      ctx.stroke(new Path2D(a));
      ctx.stroke(new Path2D(b));
    }
    ctx.beginPath();
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx + 4, cy);
    ctx.lineTo(cx, cy + 5);
    ctx.lineTo(cx - 4, cy);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    return canvas;
  });
}

/* ========================================================================== */
/* ===================== themed wood (library-themes §1) ==================== */
/* ========================================================================== */
/*
 * ADDITIVE extension: every export above keeps its exact behaviour (the
 * untinted default-room shelf). The functions below paint an arbitrary
 * `WoodSpec` from art/themes.ts, so each library world gets its own species
 * of timber — palette ramp, grain character, defect vocabulary and finish —
 * rather than the same plank recoloured. Consumed by art/caseArt.ts.
 */

/** Small canvas factory that works in workers, the DOM and vitest alike. */
export function makeCanvas2D(w: number, h: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Parse `#rrggbb` (or `#rgb`) into 0–255 components. */
export function parseHex(colour: string): { r: number; g: number; b: number } {
  // Also accepts the `rgb()/rgba()` strings mixHex produces, so a mixed colour
  // can be fed straight back into another mix (or into paintWood) without
  // silently degrading to mid grey.
  const rgb = /^\s*rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(colour);
  if (rgb) {
    return {
      r: clamp255(Number(rgb[1])),
      g: clamp255(Number(rgb[2])),
      b: clamp255(Number(rgb[3])),
    };
  }
  const s = colour.replace('#', '').trim();
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 128, g: 128, b: 128 };
  const n = Number.parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function clamp255(n: number): number {
  return !Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

/** `rgba()` string from a hex colour plus an alpha. */
export function hexAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Mix two hex colours, t = 0 → a, 1 → b. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  return `rgb(${Math.round(lerp(ca.r, cb.r, t))}, ${Math.round(lerp(ca.g, cb.g, t))}, ${Math.round(lerp(ca.b, cb.b, t))})`;
}

export interface WoodFieldOptions {
  /** Deterministic seed — same seed ⇒ identical timber. */
  seed: number;
  /** Grain axis. 'horizontal' (default) runs the figure left→right. */
  direction?: 'horizontal' | 'vertical';
  /** Override the knot count (default derives from WoodSpec.knots × length). */
  knots?: number;
  /** Extra contrast multiplier on top of WoodSpec.contrast. */
  contrast?: number;
  /** Skip the paint film even when the spec has one (bare-wood details). */
  bare?: boolean;
  /** Device px per world px — sizes the low-res noise field. Default 1. */
  pixelScale?: number;
  /** Skip the finish/sheen pass (when the caller lights the part itself). */
  noFinish?: boolean;
}

interface KnotSite {
  along: number;
  across: number;
  r: number;
}

/**
 * Paint a themed wood field into the current transform, filling `w × h` in
 * world px.
 *
 * Rewritten for `docs/design/painted-rendering.md` Pillar 1. The old version
 * evaluated a ring function per pixel into an ImageData: mathematically it was
 * wood, but every board came out as the same isotropic fizz, because a noise
 * field has no *direction* and no *event*. Real timber is a sequence of
 * decisions — this ring is dark and that one is not, the figure sweeps around
 * that knot, someone planed the surface in that direction.
 *
 * So the board is now painted:
 *   1. a blocked-in ground with value drifting along the run
 *   2. earlywood/latewood ring pairs as long tapering strokes that FOLLOW a
 *      cathedral curve, grouped into bands rather than evenly spaced
 *   3. per-grain-character extras (ray fleck, silvering, checks, brushing)
 *   4. knots painted as swirls, with the surrounding grain deflected round them
 *   5. plane-iron chatter and the finish sheen
 */
export function paintWood(
  ctx: Ctx2D,
  wood: WoodSpec,
  w: number,
  h: number,
  opts: WoodFieldOptions,
): void {
  if (!(w > 0.5) || !(h > 0.5)) return;
  const vertical = opts.direction === 'vertical';
  const contrast = (opts.contrast ?? 1) * wood.contrast;
  const rnd = mulberry32(opts.seed >>> 0);
  const seed = opts.seed >>> 0;

  const light = P.parseColour(wood.light);
  const dark = P.parseColour(wood.dark);
  // Timber is not a two-stop ramp: it is a family of browns around a mean.
  const mid = P.mixRgb(dark, light, 0.5);
  const early = P.mixRgb(mid, light, 0.55 * contrast + 0.2);
  const late = P.mixRgb(mid, dark, 0.6 * contrast + 0.2);
  const deepest = P.mixRgb(dark, { r: 0.07, g: 0.05, b: 0.035 }, 0.42);

  const alongLen = vertical ? h : w;
  const acrossLen = vertical ? w : h;
  const sf = P.createSurface(Math.ceil(w), Math.ceil(h));

  /** Map (along, across) in board space to surface coordinates. */
  const pt = (a: number, c: number): P.Vec2 => (vertical ? { x: c, y: a } : { x: a, y: c });

  /* --- 1. ground -------------------------------------------------------- */
  P.blockIn(sf, P.rectShape(-2, -2, w + 4, h + 4), mid, {
    brush: P.brush('chalk', {
      size: Math.max(4, acrossLen * 0.22),
      colour: mid,
      opacity: 0.24,
      spacing: 0.2,
      grain: 0.7,
      jitter: { lum: 0.08, hue: 7, sat: 0.05, opacity: 0.4, position: 0.6, size: 0.3, angle: 0.4 },
    }),
    passes: 2,
    valueSpread: 0.11,
    hueSpread: 10,
    roughness: 0,
    direction: vertical ? Math.PI / 2 : 0,
    openness: 0.02,
    rowFactor: 0.5,
    feather: 0.8,
    seed: seed ^ 0x9101,
  });

  /* --- 2. knots, planned first so the figure can sweep around them ------ */
  const knotCount = opts.knots ?? Math.max(0, Math.round((wood.knots * alongLen) / 260));
  const knots: KnotSite[] = [];
  for (let i = 0; i < knotCount; i++) {
    knots.push({
      along: rnd() * alongLen,
      across: acrossLen * (0.12 + rnd() * 0.76),
      r: (3.5 + rnd() * (wood.grain === 'knotty' ? 9 : 4.5)) * (1 + acrossLen / 300),
    });
  }

  /** How far the figure is pushed aside at this point by the nearby knots. */
  const deflect = (a: number, c: number): number => {
    let d = 0;
    for (const k of knots) {
      const da = a - k.along;
      const dc = c - k.across;
      const r2 = da * da + dc * dc;
      const infl = k.r * 5.5;
      if (r2 > infl * infl) continue;
      const dist = Math.sqrt(r2) || 0.001;
      // Push perpendicular to the grain, away from the knot, falling off fast.
      d += Math.sign(dc || 1) * k.r * 1.7 * Math.exp(-dist / (k.r * 2.1));
    }
    return d;
  };

  /* --- 3. the figure ---------------------------------------------------- */
  // Rings come in bands: a run of tight dark ones then a wide pale stretch,
  // which is what a growth season actually looks like and what a uniform
  // frequency can never be.
  const ringStep = Math.max(1.6, acrossLen / Math.max(3, wood.ringFreq * 4.2 + wood.across * 90));
  const fineness = wood.grain === 'fine' || wood.grain === 'birch' ? 0.62 : 1;
  const step = ringStep * fineness;
  const ringBrush = P.brush('blade', {
    size: Math.max(0.9, step * 0.62),
    colour: late,
    opacity: 0.14,
    spacing: 0.14,
    hardness: 0.7,
    grain: 0.55,
    followPath: true,
    jitter: { lum: 0.09, hue: 6, sat: 0.05, opacity: 0.55, position: 0.35, size: 0.35, angle: 0.12 },
  });
  const paleBrush = P.withBrush(ringBrush, { colour: early, opacity: 0.1, size: Math.max(1.2, step * 0.9) });

  const flame = wood.grain === 'flame';
  const weathered = wood.grain === 'weathered';
  const cathedral = alongLen > acrossLen * 1.4 ? 1 : 0.45;
  let band = 0;
  let bandLeft = 0;
  let bandTight = false;
  for (let c = -step; c < acrossLen + step; c += step) {
    if (bandLeft <= 0) {
      bandTight = rnd() < 0.45;
      bandLeft = bandTight ? 2 + Math.floor(rnd() * 4) : 1 + Math.floor(rnd() * 3);
      band++;
    }
    bandLeft--;
    const tight = bandTight;
    // Cathedral figure: the ring arcs toward the board's centre line, more so
    // near the middle of the run — the classic plainsawn "flame".
    const centre = acrossLen * 0.5;
    const swing = (1 - Math.abs(c - centre) / centre) * acrossLen * 0.16 * cathedral;
    const phase = rnd() * 6.28;
    const path: P.Vec2[] = [];
    const segs = Math.max(6, Math.round(alongLen / 22));
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      const a = -2 + t * (alongLen + 4);
      let cc = c;
      cc += Math.sin(phase + t * (flame ? 7.4 : 2.6)) * swing * (flame ? 1.5 : 1);
      cc += (P.fbm(a * (wood.along * 42 + 0.01), c * 0.05, seed + band, 2) - 0.5) * step * 2.2;
      cc += deflect(a, c);
      path.push(pt(a, cc));
    }
    const b = tight ? ringBrush : paleBrush;
    const colour = tight
      ? P.mixRgb(late, deepest, rnd() * 0.45)
      : P.mixRgb(early, mid, rnd() * 0.6);
    P.stroke(sf, path, P.withBrush(b, { colour }), {
      passes: 1,
      pressure: (t) => 0.55 + 0.45 * Math.sin(Math.PI * t) ** 0.4,
      taper: 0.02,
      wobble: step * 0.35,
      seed: (seed + band * 733 + c * 17) >>> 0,
      alpha: (tight ? 0.85 : 0.6) * (0.55 + rnd() * 0.7),
    });
  }

  /* --- 4. grain character ---------------------------------------------- */
  if (wood.grain === 'quartersawn') {
    // Medullary ray fleck: short pale dashes lying ACROSS the grain, the
    // signature of a quartersawn oak board.
    const fleck = P.brush('flat', {
      size: Math.max(1, step * 0.8),
      colour: P.mixRgb(early, { r: 1, g: 0.97, b: 0.9 }, 0.28),
      opacity: 0.16,
      spacing: 0.2,
      grain: 0.5,
      jitter: { lum: 0.12, opacity: 0.6, size: 0.5, position: 0.4 },
    });
    const n = Math.round((alongLen * acrossLen) / 900);
    for (let i = 0; i < n; i++) {
      const a = rnd() * alongLen;
      const c = rnd() * acrossLen;
      const len = (2 + rnd() * 7) * (1 + acrossLen / 400);
      P.stroke(sf, [pt(a - len / 2, c), pt(a + len / 2, c + (rnd() - 0.5) * 2)], fleck, {
        passes: 1,
        pressure: P.PRESSURE.arc,
        taper: 0.35,
        seed: (seed + i * 271) >>> 0,
        alpha: 0.4 + rnd() * 0.6,
      });
    }
  } else if (weathered) {
    // Silvered surface, split open along the grain.
    P.glaze(sf, null, '#b9b2a4', 0.2, { blend: 'softlight', mottle: 0.5, mottleScale: Math.max(14, acrossLen * 0.6), seed: seed ^ 0x77 });
    const check = P.brush('ink', { size: Math.max(0.8, 1.1), colour: deepest, opacity: 0.3, jitter: { opacity: 0.6, position: 0.3 } });
    const n = Math.round(alongLen / 26) + 2;
    for (let i = 0; i < n; i++) {
      const c = rnd() * acrossLen;
      const a0 = rnd() * alongLen;
      const len = alongLen * (0.1 + rnd() * 0.4);
      const path: P.Vec2[] = [];
      for (let k = 0; k <= 5; k++) {
        const t = k / 5;
        path.push(pt(a0 + t * len, c + (rnd() - 0.5) * 1.6));
      }
      P.stroke(sf, path, check, { passes: 1, pressure: P.PRESSURE.arc, taper: 0.3, seed: (seed + i * 97) >>> 0 });
    }
  } else if (wood.grain === 'birch') {
    // Lenticels: the dark horizontal dashes on a pale bark-like face.
    const lent = P.brush('flat', { size: Math.max(1, step), colour: deepest, opacity: 0.2, jitter: { opacity: 0.6, size: 0.6 } });
    const n = Math.round((alongLen * acrossLen) / 1400);
    for (let i = 0; i < n; i++) {
      const a = rnd() * alongLen;
      const c = rnd() * acrossLen;
      const len = (3 + rnd() * 10) * (1 + acrossLen / 500);
      P.stroke(sf, [pt(a, c - len / 2), pt(a, c + len / 2)], lent, {
        passes: 1,
        pressure: P.PRESSURE.arc,
        taper: 0.4,
        seed: (seed + i * 313) >>> 0,
        alpha: 0.35 + rnd() * 0.5,
      });
    }
  } else if (wood.grain === 'brushed') {
    // Anisotropic brushing: long, near-parallel, very low-contrast scratches.
    const scr = P.brush('bristle', { size: Math.max(0.8, step * 0.5), colour: early, opacity: 0.06, grain: 0.9, followPath: true, jitter: { lum: 0.1, opacity: 0.7 } });
    for (let i = 0; i < Math.round(acrossLen * 1.4); i++) {
      const c = rnd() * acrossLen;
      P.stroke(sf, [pt(-2, c), pt(alongLen + 2, c + (rnd() - 0.5) * 2)], rnd() < 0.5 ? scr : P.withBrush(scr, { colour: late }), {
        passes: 1,
        pressure: P.PRESSURE.flat,
        taper: 0.02,
        seed: (seed + i * 61) >>> 0,
        alpha: 0.4 + rnd() * 0.6,
      });
    }
  }

  /* --- 5. the knots themselves ------------------------------------------ */
  for (const k of knots) {
    const rings = 3 + Math.floor(rnd() * 4);
    for (let i = rings; i >= 1; i--) {
      const rr = (k.r * i) / rings;
      const path: P.Vec2[] = [];
      const segs = 22;
      for (let s2 = 0; s2 <= segs; s2++) {
        const ang = (s2 / segs) * Math.PI * 2;
        const wob = 1 + (P.fbm(Math.cos(ang) * 3, Math.sin(ang) * 3, seed + i, 2) - 0.5) * 0.5;
        path.push(pt(k.along + Math.cos(ang) * rr * 1.5 * wob, k.across + Math.sin(ang) * rr * wob));
      }
      P.stroke(
        sf,
        path,
        P.brush('soft', {
          size: Math.max(1, k.r * 0.34),
          colour: P.mixRgb(late, deepest, 0.3 + (1 - i / rings) * 0.6),
          opacity: 0.16,
          spacing: 0.16,
          jitter: { lum: 0.1, hue: 6, opacity: 0.5, position: 0.4 },
        }),
        { passes: 1, pressure: P.PRESSURE.flat, closed: true, wobble: k.r * 0.1, seed: (seed + i * 191 + k.along) >>> 0 },
      );
    }
    P.dab(
      sf,
      pt(k.along, k.across).x,
      pt(k.along, k.across).y,
      P.brush('soft', { size: k.r * 1.1, colour: deepest, opacity: 0.5, jitter: { lum: 0.06 } }),
      { size: k.r * 1.2 },
    );
  }

  /* --- 6. plane chatter and directional streaks ------------------------- */
  const streakCount = Math.round((wood.streaks * acrossLen) / 100) + 2;
  const streak = P.brush('bristle', {
    size: Math.max(0.8, step * 0.45),
    colour: late,
    opacity: 0.055,
    grain: 0.85,
    followPath: true,
    jitter: { lum: 0.12, hue: 6, opacity: 0.7, position: 0.5 },
  });
  for (let i = 0; i < streakCount; i++) {
    const c = rnd() * acrossLen;
    const a0 = rnd() * alongLen * 0.6;
    const len = alongLen * (0.25 + rnd() * 0.75);
    P.stroke(sf, [pt(a0, c), pt(Math.min(alongLen + 2, a0 + len), c + (rnd() - 0.5) * step)], rnd() < 0.45 ? P.withBrush(streak, { colour: early }) : streak, {
      passes: 1,
      pressure: P.PRESSURE.arc,
      taper: 0.25,
      seed: (seed + i * 431) >>> 0,
      alpha: 0.5 + rnd() * 0.6,
    });
  }

  /* --- 7. unify --------------------------------------------------------- */
  // One warm glaze so every stroke belongs to the same board, plus a slow
  // value drift along the run — no plank is evenly toned end to end.
  P.glaze(sf, null, P.shiftHsl(mid, 4, 0.08, -0.04), 0.14, {
    blend: 'multiply',
    gradient: (px, py) => {
      const t = (vertical ? py / h : px / w);
      return 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 4.1 + seed * 0.01));
    },
    mottle: 0.35,
    mottleScale: Math.max(20, alongLen * 0.35),
    seed: seed ^ 0x3311,
  });
  P.addGrain(sf, 0.05, 1.5, seed ^ 0x1234);

  P.drawSurface(ctx as CanvasRenderingContext2D, sf, 0, 0);

  // --- paint film --------------------------------------------------------
  if (wood.paint && !opts.bare) paintFilm(ctx, wood.paint, w, h, vertical, rnd);

  // --- finish ------------------------------------------------------------
  if (!opts.noFinish) woodFinish(ctx, wood, w, h, vertical);
}

/**
 * An opaque paint coat with brush texture and chipped arrises. Chips are
 * concentrated along the edges (where a real case gets knocked) and cut
 * through with `destination-out`, so the bare timber underneath shows.
 */
function paintFilm(
  ctx: Ctx2D,
  paint: NonNullable<WoodSpec['paint']>,
  w: number,
  h: number,
  vertical: boolean,
  rnd: () => number,
): void {
  ctx.save();
  ctx.globalAlpha = paint.opacity;
  ctx.fillStyle = paint.colour;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;

  // Brush drag: long faint strokes of the shade colour along the grain.
  const along = vertical ? h : w;
  const across = vertical ? w : h;
  ctx.lineCap = 'round';
  const strokes = Math.max(3, Math.round(across / 5));
  for (let i = 0; i < strokes; i++) {
    ctx.strokeStyle = rnd() < 0.5 ? paint.shade : '#ffffff';
    ctx.globalAlpha = 0.05 + rnd() * 0.06;
    ctx.lineWidth = 1 + rnd() * 2.4;
    const c = rnd() * across;
    ctx.beginPath();
    if (vertical) {
      ctx.moveTo(c, rnd() * along * 0.2);
      ctx.lineTo(c + (rnd() * 2 - 1) * 2, along * (0.5 + rnd() * 0.5));
    } else {
      ctx.moveTo(rnd() * along * 0.2, c);
      ctx.lineTo(along * (0.5 + rnd() * 0.5), c + (rnd() * 2 - 1) * 2);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Chips: irregular polygons hugging the four arrises.
  const chipCount = Math.round(paint.chipping * ((w + h) / 26));
  const chipShape = (cx: number, cy: number, r: number): Path2D => {
    const p = new Path2D();
    const pts = 6 + Math.floor(rnd() * 4);
    for (let i = 0; i <= pts; i++) {
      const ang = (i / pts) * Math.PI * 2;
      const rr = r * (0.45 + rnd() * 0.75);
      const x = cx + Math.cos(ang) * rr;
      const y = cy + Math.sin(ang) * rr * 0.8;
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
    p.closePath();
    return p;
  };
  for (let i = 0; i < chipCount; i++) {
    const edge = Math.floor(rnd() * 4);
    const r = 2 + rnd() * 5;
    let cx: number;
    let cy: number;
    if (edge === 0) {
      cx = rnd() * w;
      cy = rnd() * 3;
    } else if (edge === 1) {
      cx = rnd() * w;
      cy = h - rnd() * 3;
    } else if (edge === 2) {
      cx = rnd() * 3;
      cy = rnd() * h;
    } else {
      cx = w - rnd() * 3;
      cy = rnd() * h;
    }
    const shape = chipShape(cx, cy, r);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fill(shape);
    ctx.restore();
    // Worn halo just inside the chip so the paint edge reads as thickness.
    ctx.strokeStyle = paint.shade;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.stroke(shape);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** Specular character of the surface finish. */
function woodFinish(ctx: Ctx2D, wood: WoodSpec, w: number, h: number, vertical: boolean): void {
  if (wood.sheen <= 0.001) return;
  ctx.save();
  const g = vertical ? ctx.createLinearGradient(0, 0, w, 0) : ctx.createLinearGradient(0, 0, 0, h);
  switch (wood.finish) {
    case 'lacquer': {
      // Tight bright specular band + deepened shadow side: mirror polish.
      g.addColorStop(0, `rgba(255, 252, 244, ${0.03 * wood.sheen})`);
      g.addColorStop(0.2, `rgba(255, 250, 236, ${0.5 * wood.sheen})`);
      g.addColorStop(0.34, `rgba(255, 248, 232, ${0.1 * wood.sheen})`);
      g.addColorStop(0.72, 'rgba(255, 255, 255, 0)');
      g.addColorStop(1, `rgba(20, 12, 6, ${0.28 * wood.sheen})`);
      break;
    }
    case 'wax': {
      // Broad soft bloom — hand-waxed timber, no hard highlight.
      g.addColorStop(0, `rgba(255, 246, 226, ${0.34 * wood.sheen})`);
      g.addColorStop(0.42, `rgba(255, 244, 220, ${0.1 * wood.sheen})`);
      g.addColorStop(0.85, 'rgba(255, 255, 255, 0)');
      g.addColorStop(1, `rgba(38, 26, 14, ${0.22 * wood.sheen})`);
      break;
    }
    case 'limewash': {
      g.addColorStop(0, `rgba(255, 255, 250, ${0.5 * wood.sheen})`);
      g.addColorStop(1, `rgba(240, 238, 228, ${0.2 * wood.sheen})`);
      break;
    }
    case 'gloss': {
      // Candy shell: a hard bright band near the top, a dark waist, then a
      // bounce light coming back up off whatever the object is standing on.
      g.addColorStop(0, `rgba(255, 255, 255, ${0.34 * wood.sheen})`);
      g.addColorStop(0.14, `rgba(255, 255, 255, ${0.72 * wood.sheen})`);
      g.addColorStop(0.3, `rgba(255, 255, 255, ${0.08 * wood.sheen})`);
      g.addColorStop(0.72, `rgba(70, 20, 50, ${0.16 * wood.sheen})`);
      g.addColorStop(1, `rgba(255, 240, 250, ${0.4 * wood.sheen})`);
      break;
    }
    case 'metal': {
      // Brushed metal: a wide anisotropic sheen, a cool shadow side and a
      // bright return at the far arris.
      g.addColorStop(0, `rgba(240, 250, 255, ${0.42 * wood.sheen})`);
      g.addColorStop(0.28, `rgba(255, 255, 255, ${0.16 * wood.sheen})`);
      g.addColorStop(0.62, `rgba(14, 26, 40, ${0.26 * wood.sheen})`);
      g.addColorStop(0.9, `rgba(120, 200, 240, ${0.18 * wood.sheen})`);
      g.addColorStop(1, `rgba(255, 255, 255, ${0.3 * wood.sheen})`);
      break;
    }
    case 'painted':
    case 'matte': {
      g.addColorStop(0, `rgba(255, 250, 240, ${0.24 * wood.sheen})`);
      g.addColorStop(0.6, 'rgba(255, 255, 255, 0)');
      g.addColorStop(1, `rgba(46, 34, 22, ${0.16 * wood.sheen})`);
      break;
    }
    default: {
      // 'raw' — barely any reflection, just a whisper of top light.
      g.addColorStop(0, `rgba(255, 250, 238, ${0.3 * wood.sheen})`);
      g.addColorStop(1, `rgba(40, 32, 22, ${0.14 * wood.sheen})`);
      break;
    }
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
