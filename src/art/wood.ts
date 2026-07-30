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
const BAND_PX = 4;

const WOOD_LIGHT = { r: 0x8a, g: 0x6a, b: 0x48 }; // #8a6a48
const WOOD_DARK = { r: 0x6f, g: 0x51, b: 0x38 }; // #6f5138

interface Knot {
  x: number;
  y: number;
  r: number;
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
      // Anisotropic stretch = grain direction.
      const g = noise(sx * 0.008, sy * 0.09);
      let ring = g * 5.5;
      for (const k of knots) {
        const d = Math.hypot(sx - k.x, sy - k.y);
        ring += 0.5 * Math.exp(-(d * d) / (k.r * k.r)) * Math.sin(d * 0.35);
      }
      const t = Math.pow(fract(ring), 1.8);
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
  for (let sx = PLANK_SEGMENT_WORLD; sx < widthWorldPx - 20; sx += PLANK_SEGMENT_WORLD) {
    const jx = sx + (rnd() * 2 - 1) * 12;
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
        const gN = noise(sx * 0.05, sy * 0.006);
        const t = Math.pow(fract(gN * 4.5), 1.8) * 0.42 + 0.22;
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
        const gN = noise(sx * 0.16, sy * 0.004);
        const t = Math.pow(fract(gN * 3.5), 1.8);
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
        const gN = noise(sx * 0.006, sy * 0.07);
        const t = Math.pow(fract(gN * 5), 1.8);
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
