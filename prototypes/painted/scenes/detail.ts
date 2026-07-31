/**
 * prototypes/painted/scenes/detail.ts
 *
 * Two sheets:
 *  - `detail` — the full recipe at 2.5× so brush texture and edge variety can
 *    actually be inspected. If it turns to mush here, the engine is a filter,
 *    not a brush.
 *  - `layers` — the same subject built up one op at a time. This doubles as
 *    the worked example for the flora and book agents.
 */

import {
  addGrain,
  blockIn,
  brush,
  createSurface,
  drawSurface,
  edgeVary,
  ellipseShape,
  glaze,
  gradeSurface,
  leafShape,
  PRESSURE,
  rasterizeShape,
  rectShape,
  roughenShape,
  scumble,
  setPaintQuality,
  stroke,
  type Surface,
  type Vec2,
} from '../../../src/art/brush';
import type { Scene } from './index';

const GROUND = '#181109';
const KEY = Math.PI * 0.75; // travelling down-left, i.e. sun at upper right

/* ----------------------------- a painted leaf ----------------------------- */

function paintLeaf(w: number, h: number, seed: number, upTo = 99): Surface {
  const s = createSurface(w, h, GROUND);
  const poly = leafShape(w * 0.5, h * 0.52, h * 0.78, h * 0.4, -Math.PI / 2.2, 0.4, 0.16, 40);

  // 1 — dead colour: a dark, slightly cool green mass.
  const mask = blockIn(s, poly, '#3d5226', {
    passes: 3,
    valueSpread: 0.12,
    hueSpread: 16,
    roughness: h * 0.012,
    seed,
  });
  // Weights are expressed in *shape* space, not canvas space: a canvas-space
  // gradient rejects nearly everything for a shape sitting mid-frame.
  const u = (x: number) => (x - mask.x) / mask.width;
  const v = (y: number) => (y - mask.y) / mask.height;
  if (upTo < 2) return finish(s, seed);

  // 2 — shade side: cool scumble away from the key, then a multiply glaze.
  scumble(s, mask, brush('chalk', { size: w * 0.05, colour: '#1d2a2e', opacity: 0.16, grain: 0.85 }), {
    coverage: 0.42, passes: 2, patchScale: w * 0.13, targetBuildup: 0.3, seed: seed + 1,
    weight: (x, y) => Math.max(0, Math.min(1, u(x) * 1.5 + v(y) * 0.45 - 0.42)),
  });
  glaze(s, mask, '#182234', 0.24, {
    blend: 'multiply',
    gradient: (x, y) => Math.max(0, Math.min(1, (x / w) * 1.4 + (y / h) * 0.5 - 0.5)),
    mottle: 0.25, seed: seed + 2,
  });
  if (upTo < 3) return finish(s, seed);

  // 3 — light: warm broken colour on the faces turned to the key.
  scumble(s, mask, brush('bristle', { size: w * 0.038, colour: '#9fbc4e', opacity: 0.15, grain: 0.6 }), {
    coverage: 0.4, passes: 2, patchScale: w * 0.1, targetBuildup: 0.32, direction: -Math.PI / 2.2, seed: seed + 3,
    weight: (x, y) => Math.pow(Math.max(0, 1 - u(x) * 1.15 - v(y) * 0.3), 1.1),
  });
  scumble(s, mask, brush('sponge', { size: w * 0.028, colour: '#d8e07a', opacity: 0.14 }), {
    coverage: 0.26, passes: 1, patchScale: w * 0.07, targetBuildup: 0.26, edgeBias: 0.25, seed: seed + 4,
    weight: (x, y) => Math.pow(Math.max(0, 1 - u(x) * 1.5 - v(y) * 0.45), 1.4),
  });
  glaze(s, mask, '#ffd88f', 0.26, {
    blend: 'softlight',
    gradient: (x, y) => Math.pow(Math.max(0, 1 - (x / w) * 1.35 - (y / h) * 0.3), 1.4),
    mottle: 0.22, seed: seed + 5,
  });
  if (upTo < 4) return finish(s, seed);

  // 4 — structure: midrib and lateral veins, each a tapered stroke.
  const tip = { x: w * 0.5 - h * 0.05, y: h * 0.14 };
  const base = { x: w * 0.5 + h * 0.1, y: h * 0.9 };
  stroke(s, [base, { x: w * 0.5 + h * 0.02, y: h * 0.5 }, tip],
    brush('blade', { size: w * 0.022, colour: '#e6dc9a', opacity: 0.42, followPath: true }),
    { pressure: PRESSURE.flick, taper: [0.04, 0.4], passes: 2, seed: seed + 6, wobble: 1.4 });
  for (let i = 0; i < 13; i++) {
    const t = 0.1 + (i / 13) * 0.78;
    const ax = base.x + (tip.x - base.x) * t;
    const ay = base.y + (tip.y - base.y) * t;
    const dir = i % 2 ? 1 : -1;
    const reach = h * 0.17 * Math.sin(Math.PI * Math.min(1, t * 1.15));
    stroke(s, [
      { x: ax, y: ay },
      { x: ax + dir * reach * 0.75, y: ay - reach * 0.5 },
      { x: ax + dir * reach, y: ay - reach * 0.95 },
    ], brush('blade', {
      size: w * 0.012, colour: i % 3 ? '#b9c778' : '#8fa35c', opacity: 0.24, followPath: true,
    }), { pressure: PRESSURE.flick, taper: [0.02, 0.55], passes: 1, seed: seed + 20 + i, wobble: 1.2 });
  }
  // A couple of blemishes — perfect leaves read as clip-art.
  for (let i = 0; i < 3; i++) {
    const bx = w * (0.36 + i * 0.14);
    const by = h * (0.3 + ((i * 37) % 40) / 100);
    const bm = rasterizeShape(roughenShape(ellipseShape(bx, by, w * 0.035, w * 0.026, 18), 2.2, seed + i), 5);
    scumble(s, bm, brush('chalk', { size: w * 0.02, colour: i ? '#6d5a22' : '#3c3a1c', opacity: 0.16 }), {
      coverage: 0.6, passes: 1, seed: seed + 40 + i,
    });
  }
  if (upTo < 5) return finish(s, seed);

  // 5 — edges: crisp where the light rakes, lost in the shade.
  edgeVary(s, poly, { crisp: 0.34, lost: 0.24, band: 3.4, lightAngle: KEY, accentStrength: 0.5, seed: seed + 7 });
  return finish(s, seed);
}

function finish(s: Surface, seed: number): Surface {
  addGrain(s, 0.05, 1.8, seed + 90);
  gradeSurface(s, { contrast: 1.18, pivot: 0.4, black: -0.03, tintStrength: 0.15, saturation: 1.12 });
  return s;
}

/* ---------------------------- a painted spine ----------------------------- */

function paintSpine(w: number, h: number, seed: number): Surface {
  const s = createSurface(w, h, GROUND);
  const x0 = w * 0.28;
  const x1 = w * 0.7;
  const poly: Vec2[] = rectShape(x0, h * 0.07, x1 - x0, h * 0.86);

  const mask = blockIn(s, poly, '#5e2321', {
    passes: 3, valueSpread: 0.1, hueSpread: 12, roughness: w * 0.006, feather: 1.1, seed,
  });
  // cracked-leather grain
  scumble(s, mask, brush('chalk', { size: w * 0.03, colour: '#3a1210', opacity: 0.22, grain: 0.9 }), {
    coverage: 0.44, passes: 2, patchScale: w * 0.08, targetBuildup: 0.3, seed: seed + 1,
    weight: (x) => Math.max(0.15, Math.min(1, (x - x0) / (x1 - x0) * 1.4)),
  });
  scumble(s, mask, brush('sponge', { size: w * 0.018, colour: '#8c4a36', opacity: 0.2 }), {
    coverage: 0.3, passes: 1, patchScale: w * 0.055, targetBuildup: 0.26, seed: seed + 2,
    weight: (x) => Math.pow(Math.max(0, 1 - (x - x0) / (x1 - x0) * 1.3), 1.3),
  });
  for (let i = 0; i < 30; i++) {
    const cy = h * (0.08 + (i / 30) * 0.84);
    stroke(s, [
      { x: x0 + w * 0.01, y: cy },
      { x: (x0 + x1) / 2, y: cy + (i % 2 ? 2.5 : -2.5) },
      { x: x1 - w * 0.01, y: cy + (i % 3 ? -1.5 : 2) },
    ], brush('blade', { size: 1.3, colour: i % 4 ? '#43191a' : '#8a5140', opacity: 0.12, followPath: true }),
      { pressure: PRESSURE.arc, taper: 0.2, passes: 1, seed: seed + 100 + i, wobble: 1.6 });
  }

  // shade / light across the round of the spine
  glaze(s, mask, '#141c30', 0.3, {
    blend: 'multiply',
    gradient: (x) => Math.pow(Math.max(0, (x - x0) / (x1 - x0)), 1.5),
    mottle: 0.16, seed: seed + 3,
  });
  glaze(s, mask, '#ffd18a', 0.28, {
    blend: 'softlight',
    gradient: (x) => Math.pow(Math.max(0, 1 - (x - x0) / (x1 - x0)), 1.8),
    mottle: 0.18, seed: seed + 4,
  });

  // raised bands, each with its own shadow beneath and catch above
  for (const by of [0.2, 0.36, 0.55, 0.72, 0.87]) {
    const y = h * by;
    stroke(s, [{ x: x0 - 1, y: y + 3 }, { x: x1 + 1, y: y + 3 }],
      brush('flat', { size: w * 0.05, colour: '#240b0b', opacity: 0.3, followPath: true }),
      { pressure: PRESSURE.flat, taper: 0.03, passes: 1, seed: seed + 5, wobble: 0.8 });
    stroke(s, [{ x: x0 - 1, y }, { x: x1 + 1, y }],
      brush('flat', { size: w * 0.035, colour: '#7c3a2e', opacity: 0.35, followPath: true }),
      { pressure: PRESSURE.flat, taper: 0.03, passes: 1, seed: seed + 6, wobble: 0.7 });
    stroke(s, [{ x: x0 - 1, y: y - w * 0.02 }, { x: x1 * 0.86, y: y - w * 0.02 }],
      brush('blade', { size: w * 0.014, colour: '#e8bd76', opacity: 0.4, followPath: true }),
      { pressure: PRESSURE.arc, taper: 0.15, passes: 1, seed: seed + 7, wobble: 0.6 });
  }

  // foil title: worn, half-legible, catching the key
  for (let i = 0; i < 4; i++) {
    const y = h * 0.44 + i * (h * 0.018);
    const inset = w * (0.02 + (i % 2) * 0.04);
    stroke(s, [{ x: x0 + inset + w * 0.02, y }, { x: x1 - inset - w * 0.02, y }],
      brush('ink', { size: w * 0.012, colour: '#f4d288', opacity: 0.22 + (i % 3) * 0.16, followPath: true }),
      { pressure: PRESSURE.double, taper: 0.12, passes: 1, seed: seed + 200 + i, wobble: 0.7 });
  }

  // page block, gilt on its top edge
  const pages = rectShape(x1, h * 0.085, w * 0.075, h * 0.845);
  const pm = blockIn(s, pages, '#c4ac7e', { passes: 2, valueSpread: 0.12, roughness: 0.8, seed: seed + 8 });
  scumble(s, pm, brush('blade', { size: w * 0.006, colour: '#7d6a45', opacity: 0.16 }), {
    coverage: 0.6, passes: 2, direction: Math.PI / 2, seed: seed + 9,
  });
  glaze(s, pm, '#ffe0a8', 0.3, { blend: 'screen', gradient: (_x, y) => Math.pow(Math.max(0, 1 - (y / h) * 2.2), 2), mottle: 0.2, seed: seed + 10 });

  edgeVary(s, poly, { crisp: 0.4, lost: 0.16, band: 3, lightAngle: KEY, accentStrength: 0.5, seed: seed + 11 });
  return finish(s, seed);
}

/* ----------------------------- a painted plank ---------------------------- */

function paintPlank(w: number, h: number, seed: number): Surface {
  const s = createSurface(w, h, GROUND);
  const poly = rectShape(w * 0.04, h * 0.3, w * 0.92, h * 0.34);
  const mask = blockIn(s, poly, '#6a4626', {
    passes: 3, valueSpread: 0.1, hueSpread: 10, roughness: 1.2, feather: 1.2, direction: 0, seed,
  });
  // long grain
  for (let i = 0; i < 46; i++) {
    const y = h * 0.31 + (i / 46) * h * 0.32;
    const path: Vec2[] = [];
    for (let k = 0; k <= 6; k++) {
      const x = w * (0.03 + (k / 6) * 0.94);
      path.push({ x, y: y + Math.sin(k * 1.7 + i) * 2.4 + Math.sin(k * 0.6 + i * 2.2) * 1.3 });
    }
    stroke(s, path, brush('blade', {
      size: 1 + (i % 4) * 0.7,
      colour: i % 5 === 0 ? '#301d0e' : i % 3 === 0 ? '#946a3c' : '#4d3319',
      opacity: 0.1 + (i % 4) * 0.05,
      followPath: true,
    }), { pressure: PRESSURE.arc, taper: 0.1, passes: 1, seed: seed + 300 + i, wobble: 1.4 });
  }
  // knots
  for (const [kx, ky, kr] of [[0.34, 0.47, 1], [0.72, 0.44, 0.7]] as const) {
    const km = rasterizeShape(roughenShape(ellipseShape(w * kx, h * ky, w * 0.022 * kr, h * 0.05 * kr, 22), 1.4, seed), 8);
    scumble(s, km, brush('chalk', { size: w * 0.012, colour: '#241305', opacity: 0.2 }), {
      coverage: 0.85, passes: 2, seed: seed + 12,
    });
    for (let r = 1; r <= 3; r++) {
      const ring = roughenShape(ellipseShape(w * kx, h * ky, w * (0.022 + r * 0.012) * kr, h * (0.05 + r * 0.025) * kr, 30), 1.6, seed + r);
      stroke(s, ring, brush('blade', { size: 1.2, colour: '#3a2410', opacity: 0.16, followPath: true }),
        { closed: true, pressure: PRESSURE.flat, taper: 0, passes: 1, seed: seed + 400 + r, wobble: 1.1 });
    }
  }
  glaze(s, mask, '#101828', 0.34, {
    blend: 'multiply', gradient: (_x, y) => Math.pow(Math.max(0, (y / h - 0.3) / 0.34), 1.3), mottle: 0.2, seed: seed + 13,
  });
  glaze(s, mask, '#ffcf87', 0.42, {
    blend: 'softlight', gradient: (_x, y) => Math.pow(Math.max(0, 1 - (y / h - 0.28) / 0.2), 1.6), mottle: 0.18, seed: seed + 14,
  });
  edgeVary(s, poly, { crisp: 0.38, lost: 0.2, band: 3, lightAngle: KEY, accentStrength: 0.45, seed: seed + 15 });
  return finish(s, seed);
}

/* --------------------------------- scenes --------------------------------- */

const D_W = 400;
const D_H = 460;

export const detailScene: Scene = {
  name: 'detail',
  width: 3 * D_W + 4 * 14,
  height: D_H + 44,
  draw(ctx, w, h) {
    ctx.fillStyle = '#0e0b08';
    ctx.fillRect(0, 0, w, h);
    const items: [string, Surface][] = [
      ['leaf', paintLeaf(D_W, D_H, 7)],
      ['spine', paintSpine(D_W, D_H, 19)],
      ['plank', paintPlank(D_W, D_H, 29)],
    ];
    items.forEach(([label, surf], i) => {
      const x = 14 + i * (D_W + 14);
      drawSurface(ctx, surf, x, 30);
      ctx.fillStyle = '#a2977f';
      ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, 16);
    });
  },
};

/**
 * `zoom` — 3× magnification of two crops. This is the honest test of "is it a
 * brush or a filter": at 3× you either see stamps and varied edges, or you see
 * a smooth gradient with noise on top.
 */
export const zoomScene: Scene = {
  name: 'zoom',
  width: 1290,
  height: 470,
  draw(ctx, w, h) {
    ctx.fillStyle = '#0e0b08';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    const leaf = paintLeaf(D_W, D_H, 7);
    const spine = paintSpine(D_W, D_H, 19);
    // crop rects in source px, magnified 3×
    const crops: [Surface, number, number, string][] = [
      [leaf, 118, 90, 'leaf edge + blade'],
      [spine, 96, 120, 'spine: leather, band, foil'],
    ];
    crops.forEach(([surf, cx, cy, label], i) => {
      const x = 10 + i * 640;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, 28, 620, 430);
      ctx.clip();
      ctx.translate(x - cx * 3, 28 - cy * 3);
      ctx.scale(3, 3);
      drawSurface(ctx, surf, 0, 0);
      ctx.restore();
      ctx.fillStyle = '#a2977f';
      ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(label, x, 14);
    });
  },
};

/**
 * `quality` — the same subject at three stamp budgets. Cost is dominated by
 * stamp count, so this is the knob that buys bake time; the question this
 * sheet answers is how much texture you lose for it.
 */
export const qualityScene: Scene = {
  name: 'quality',
  width: 3 * 300 + 4 * 12,
  height: 360 + 44,
  draw(ctx, w, h) {
    ctx.fillStyle = '#0e0b08';
    ctx.fillRect(0, 0, w, h);
    ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    [1, 0.6, 0.35].forEach((q, i) => {
      setPaintQuality(q);
      const t0 = performance.now();
      const surf = paintSpine(300, 360, 19);
      const ms = Math.round(performance.now() - t0);
      const x = 12 + i * (300 + 12);
      drawSurface(ctx, surf, x, 30);
      ctx.fillStyle = i === 0 ? '#f0c46a' : '#a2977f';
      ctx.fillText(`quality ${q} — ${ms}ms`, x, 16);
    });
    setPaintQuality(1);
  },
};

const L_W = 260;
const L_H = 300;
const LAYER_LABELS = ['1 blockIn', '2 + shade', '3 + light', '4 + detail', '5 + edgeVary'];

export const layersScene: Scene = {
  name: 'layers',
  width: LAYER_LABELS.length * (L_W + 12) + 12,
  height: L_H + 44,
  draw(ctx, w, h) {
    ctx.fillStyle = '#0e0b08';
    ctx.fillRect(0, 0, w, h);
    ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    LAYER_LABELS.forEach((label, i) => {
      const x = 12 + i * (L_W + 12);
      drawSurface(ctx, paintLeaf(L_W, L_H, 7, i + 1), x, 30);
      ctx.fillStyle = i === LAYER_LABELS.length - 1 ? '#f0c46a' : '#a2977f';
      ctx.fillText(label, x, 16);
    });
  },
};
