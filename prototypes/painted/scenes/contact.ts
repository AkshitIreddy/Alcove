/**
 * prototypes/painted/scenes/contact.ts — the proof.
 *
 * Same three subjects (a leaf, a book spine, an oak plank), drawn first with
 * the old `ctx.fill()` primitive and then with each brush in the engine, and
 * finally with the full recipe (blockIn → scumble → glaze → edgeVary).
 *
 * The point of the sheet is to make the difference obvious *at a glance*.
 */

import {
  addGrain,
  blockIn,
  brush,
  drawSurface,
  createSurface,
  edgeVary,
  ellipseShape,
  glaze,
  gradeSurface,
  leafShape,
  rasterizeShape,
  rectShape,
  roughenShape,
  scumble,
  stroke,
  withBrush,
  PRESSURE,
  type Brush,
  type Surface,
  type Vec2,
} from '../../../src/art/brush';
import type { Scene } from './index';

const GROUND = '#1c150e';

/* --------------------------------- subjects -------------------------------- */

const LEAF_GREEN = '#5c7a35';
const SPINE_RED = '#7d2f28';
const PLANK_BROWN = '#6b4a2c';

function leafPoly(w: number, h: number): Vec2[] {
  return leafShape(w / 2, h / 2, h * 0.72, h * 0.34, -Math.PI / 2.35, 0.4, 0.14, 30);
}
function spinePoly(w: number, h: number): Vec2[] {
  return rectShape(w / 2 - w * 0.16, h * 0.1, w * 0.32, h * 0.8);
}
function plankPoly(w: number, h: number): Vec2[] {
  return rectShape(w * 0.07, h * 0.35, w * 0.86, h * 0.3);
}

type SubjectKey = 'leaf' | 'spine' | 'plank';

const SUBJECT: Record<SubjectKey, { poly: (w: number, h: number) => Vec2[]; colour: string }> = {
  leaf: { poly: leafPoly, colour: LEAF_GREEN },
  spine: { poly: spinePoly, colour: SPINE_RED },
  plank: { poly: plankPoly, colour: PLANK_BROWN },
};

/* ------------------------------ cell renderers ----------------------------- */

/** (a) The old way: one path, one flat fill, one perfect edge. */
function drawFill(ctx: CanvasRenderingContext2D, w: number, h: number, key: SubjectKey): void {
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, w, h);
  const poly = SUBJECT[key].poly(w, h);
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (const p of poly.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.fillStyle = SUBJECT[key].colour;
  ctx.fill();
  // Be generous to the old approach: give it the one highlight band it used to get.
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#ffffff';
  ctx.save();
  ctx.clip();
  ctx.fillRect(0, 0, w * 0.35, h);
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** (b) One brush, laid as a mass of strokes inside the same silhouette. */
function paintWithBrush(w: number, h: number, key: SubjectKey, b: Brush, seed: number): Surface {
  const s = createSurface(w, h, GROUND);
  blockIn(s, SUBJECT[key].poly(w, h), SUBJECT[key].colour, {
    brush: withBrush(b, { colour: SUBJECT[key].colour }),
    passes: 3,
    seed,
  });
  return s;
}

/** (c) The full recipe — every op in the engine, layered the way a painter would. */
function paintFull(w: number, h: number, key: SubjectKey, seed: number): Surface {
  const s = createSurface(w, h, GROUND);
  const poly = SUBJECT[key].poly(w, h);
  const base = SUBJECT[key].colour;

  // 1. dead-colour block-in, a value darker than the target
  const mask = blockIn(s, poly, base, {
    passes: 3,
    valueSpread: 0.11,
    hueSpread: 14,
    openness: 0.16,
    seed,
  });

  // Shape-space weights, so a pass can be aimed at the light.
  const u = (x: number) => (x - mask.x) / mask.width;
  const v = (y: number) => (y - mask.y) / mask.height;

  // 2. shadow side sunk with a cool scumble
  scumble(
    s,
    mask,
    brush('chalk', { size: Math.max(4, w * 0.05), colour: '#1a1b2a', opacity: 0.16, grain: 0.85 }),
    {
      coverage: 0.42,
      passes: 2,
      targetBuildup: 0.3,
      patchScale: w * 0.13,
      seed: seed + 1,
      weight: (x, y) => Math.max(0, Math.min(1, u(x) * 1.5 + v(y) * 0.45 - 0.4)),
    },
  );
  glaze(s, mask, '#20263c', 0.26, {
    blend: 'multiply',
    gradient: (x, y) => Math.max(0, Math.min(1, (x / w) * 1.3 + (y / h) * 0.35 - 0.35)),
    mottle: 0.25,
    seed: seed + 2,
  });

  // 3. lit face built up with warm broken colour
  scumble(
    s,
    mask,
    brush('bristle', { size: Math.max(3.5, w * 0.04), colour: '#c9a35c', opacity: 0.15, grain: 0.6 }),
    {
      coverage: 0.4,
      passes: 2,
      targetBuildup: 0.32,
      seed: seed + 3,
      patchScale: w * 0.11,
      direction: key === 'plank' ? 0 : -Math.PI / 2.3,
      weight: (x, y) => Math.pow(Math.max(0, 1 - u(x) * 1.15 - v(y) * 0.3), 1.1),
    },
  );
  glaze(s, mask, '#ffcf8a', 0.28, {
    blend: 'softlight',
    gradient: (x, y) => Math.pow(Math.max(0, 1 - (x / w) * 1.25 - (y / h) * 0.2), 1.5),
    mottle: 0.2,
    seed: seed + 4,
  });

  // 4. material — the thing that makes each subject a *material*
  if (key === 'leaf') {
    const mid = brush('blade', { size: 3.2, colour: '#d8c37a', opacity: 0.4, followPath: true });
    stroke(s, [
      { x: w / 2 + h * 0.1, y: h * 0.86 },
      { x: w / 2, y: h * 0.5 },
      { x: w / 2 - h * 0.04, y: h * 0.16 },
    ], mid, { pressure: PRESSURE.flick, taper: [0.05, 0.35], passes: 2, seed: seed + 5 });
    const vein = brush('blade', { size: 1.9, colour: '#b7c07a', opacity: 0.24, followPath: true });
    for (let i = 0; i < 9; i++) {
      const t = 0.14 + (i / 9) * 0.72;
      const sy = h * (0.88 - t * 0.72);
      const dir = i % 2 ? 1 : -1;
      stroke(s, [
        { x: w / 2 + (0.5 - t) * h * 0.1, y: sy },
        { x: w / 2 + dir * h * 0.09 * (1 - Math.abs(t - 0.45)), y: sy - h * 0.075 },
      ], vein, { pressure: PRESSURE.flick, taper: [0.02, 0.5], passes: 1, seed: seed + 60 + i, wobble: 1.2 });
    }
  } else if (key === 'spine') {
    // raised bands + gold foil, each catching the key light
    const bandY = [0.24, 0.42, 0.62, 0.79];
    const x0 = w / 2 - w * 0.16;
    const x1 = w / 2 + w * 0.16;
    for (const by of bandY) {
      const y = h * by;
      stroke(s, [{ x: x0 - 1, y }, { x: x1 + 1, y }], brush('flat', {
        size: 5.5, colour: '#3a1512', opacity: 0.3, followPath: true,
      }), { pressure: PRESSURE.flat, taper: 0.03, passes: 1, seed: seed + 7, wobble: 0.7 });
      stroke(s, [{ x: x0 - 1, y: y - 2.4 }, { x: x1 + 1, y: y - 2.4 }], brush('flat', {
        size: 2.6, colour: '#e0b268', opacity: 0.34, followPath: true,
      }), { pressure: PRESSURE.arc, taper: 0.12, passes: 1, seed: seed + 8, wobble: 0.6 });
    }
    // half-legible foil title
    for (let i = 0; i < 5; i++) {
      const y = h * 0.5 + (i - 2) * 4.2;
      stroke(s, [
        { x: x0 + w * 0.05, y },
        { x: x1 - w * 0.05 - (i % 2) * w * 0.06, y },
      ], brush('ink', { size: 2.1, colour: '#f0cb7d', opacity: 0.3 + (i % 3) * 0.12, followPath: true }),
        { pressure: PRESSURE.double, taper: 0.1, passes: 1, seed: seed + 30 + i, wobble: 0.5 });
    }
    // page block beside the spine
    const pages = rectShape(x1, h * 0.115, w * 0.05, h * 0.78);
    const pm = blockIn(s, pages, '#c9b489', { passes: 2, valueSpread: 0.1, seed: seed + 9 });
    scumble(s, pm, brush('blade', { size: 2.4, colour: '#8a7752', opacity: 0.18 }), {
      coverage: 0.5, direction: Math.PI / 2, targetBuildup: 0.35, seed: seed + 10, passes: 1,
    });
  } else {
    // wood: long grain lines and a couple of knots
    for (let i = 0; i < 16; i++) {
      const y = h * 0.36 + (i / 16) * h * 0.28 + Math.sin(i * 2.3) * 1.4;
      stroke(s, [
        { x: w * 0.06, y },
        { x: w * 0.35, y: y + Math.sin(i) * 2.2 },
        { x: w * 0.68, y: y - Math.cos(i * 1.7) * 2.6 },
        { x: w * 0.94, y: y + Math.sin(i * 0.7) * 1.5 },
      ], brush('blade', {
        size: 1.5 + (i % 3) * 0.8,
        colour: i % 3 === 0 ? '#3a2716' : '#8a6236',
        opacity: 0.16 + (i % 4) * 0.05,
        followPath: true,
      }), { pressure: PRESSURE.arc, taper: 0.16, passes: 1, seed: seed + 80 + i, wobble: 1.1 });
    }
    const knot = roughenShape(ellipseShape(w * 0.63, h * 0.49, 5.5, 3.4, 20), 1.1, seed + 12);
    const km = rasterizeShape(knot, 6);
    scumble(s, km, brush('chalk', { size: 4, colour: '#2a1a0d', opacity: 0.24 }), {
      coverage: 0.85, passes: 2, targetBuildup: 0.7, seed: seed + 13,
    });
  }

  // 5. edges: a few crisp, most soft, some lost
  edgeVary(s, poly, {
    crisp: 0.3,
    lost: 0.22,
    band: 3,
    lightAngle: Math.PI * 0.75,
    accentStrength: 0.42,
    seed: seed + 14,
  });

  // 6. contact shadow and finishing grade
  glaze(s, null, '#0d0a08', 0.42, {
    blend: 'multiply',
    gradient: (x, y) => Math.pow(Math.max(0, (Math.hypot(x / w - 0.42, y / h - 0.4) - 0.42) / 0.5), 1.4),
    mottle: 0.1,
    seed: seed + 15,
  });
  addGrain(s, 0.045, 1.7, seed + 16);
  gradeSurface(s, { contrast: 1.16, pivot: 0.4, black: -0.025, tintStrength: 0.14, saturation: 1.1 });
  return s;
}

/* --------------------------------- the sheet ------------------------------- */

const COLS: { label: string; render: (w: number, h: number, key: SubjectKey) => Surface | 'fill' }[] = [
  { label: 'ctx.fill (old)', render: () => 'fill' },
  { label: 'soft', render: (w, h, k) => paintWithBrush(w, h, k, brush('soft', { size: Math.max(6, w * 0.16), opacity: 0.13 }), 11) },
  { label: 'bristle', render: (w, h, k) => paintWithBrush(w, h, k, brush('bristle', { size: Math.max(6, w * 0.15), opacity: 0.16 }), 22) },
  { label: 'chalk', render: (w, h, k) => paintWithBrush(w, h, k, brush('chalk', { size: Math.max(6, w * 0.16), opacity: 0.15 }), 33) },
  { label: 'flat', render: (w, h, k) => paintWithBrush(w, h, k, brush('flat', { size: Math.max(7, w * 0.2), opacity: 0.17 }), 44) },
  { label: 'sponge', render: (w, h, k) => paintWithBrush(w, h, k, brush('sponge', { size: Math.max(7, w * 0.18), opacity: 0.16 }), 55) },
  { label: 'FULL RECIPE', render: (w, h, k) => paintFull(w, h, k, 101) },
];

const ROWS: SubjectKey[] = ['leaf', 'spine', 'plank'];

const CELL_W = 170;
const CELL_H = 190;
const PAD = 12;
const HEAD = 30;
const LABEL = 22;

export const contactScene: Scene = {
  name: 'contact',
  width: PAD + COLS.length * (CELL_W + PAD) + 70,
  height: HEAD + ROWS.length * (CELL_H + LABEL + PAD) + PAD,
  draw(ctx, w, h) {
    ctx.fillStyle = '#0e0b08';
    ctx.fillRect(0, 0, w, h);
    ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    COLS.forEach((col, ci) => {
      ctx.fillStyle = ci === COLS.length - 1 ? '#f0c46a' : ci === 0 ? '#e07a6a' : '#9c9282';
      ctx.textAlign = 'center';
      ctx.fillText(col.label, PAD + 70 + ci * (CELL_W + PAD) + CELL_W / 2, HEAD / 2 + 4);
    });

    ROWS.forEach((key, ri) => {
      const y = HEAD + ri * (CELL_H + LABEL + PAD);
      ctx.fillStyle = '#8d8375';
      ctx.textAlign = 'left';
      ctx.fillText(key, 10, y + CELL_H / 2);
      COLS.forEach((col, ci) => {
        const x = PAD + 70 + ci * (CELL_W + PAD);
        const out = col.render(CELL_W, CELL_H, key);
        if (out === 'fill') {
          ctx.save();
          ctx.translate(x, y);
          drawFill(ctx, CELL_W, CELL_H, key);
          ctx.restore();
        } else {
          drawSurface(ctx, out, x, y);
        }
        ctx.strokeStyle = ci === COLS.length - 1 ? '#8a6a2a' : '#2c241a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, CELL_W - 1, CELL_H - 1);
      });
    });
  },
};
