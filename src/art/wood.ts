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

  // --- plank seams + front-edge outline: wobbled graphite at 55% alpha ---
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

/** 9-slice geometry of the shadow strip, in world px. */
export const SHADOW_STRIP = {
  w: 128,
  h: 24,
  /** Corner inset for 9-slice stretching. */
  inset: 16,
} as const;

/**
 * Bake the blurred under-shelf shadow strip. Drawn 9-sliced and stretched
 * under every shelf row (corners kept, middle stretched).
 */
export function bakeShelfShadowStrip(dpr: number): Promise<ImageBitmap> {
  return bakeCached(`wood|shadow|${SHADOW_STRIP.w}x${SHADOW_STRIP.h}`, dpr, async () => {
    const wDev = Math.ceil(SHADOW_STRIP.w * dpr);
    const hDev = Math.ceil(SHADOW_STRIP.h * dpr);
    const canvas = new OffscreenCanvas(wDev, hDev);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('wood: 2d context unavailable');
    ctx.scale(dpr, dpr);

    // Soft outer pool.
    ctx.filter = `blur(${4 * dpr}px)`;
    ctx.fillStyle = 'rgba(46, 36, 26, 0.30)';
    fillRoundedRect(ctx, 8, 2, SHADOW_STRIP.w - 16, 9, 4);

    // Tighter dark core right under the plank edge.
    ctx.filter = `blur(${1.5 * dpr}px)`;
    ctx.fillStyle = 'rgba(40, 31, 22, 0.35)';
    fillRoundedRect(ctx, 10, 1, SHADOW_STRIP.w - 20, 4, 2);

    ctx.filter = 'none';
    return canvas;
  });
}

function fillRoundedRect(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fill();
}
