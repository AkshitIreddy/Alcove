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

import { bakeCached } from './bake';
import { fnv1a, fract, lerp, mulberry32, seededNoise2D } from './noise';
import { getGranulationTile } from './spines';
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
