/**
 * prototypes/flora/scenes/species.ts — the species board.
 *
 * One cell per species, each grown at a fixed seed on a plain dark rail, so a
 * change to the growth model or the painting is visible side by side instead
 * of buried in a whole shelf. Two variants: on parchment (what the shelf
 * actually composites over) and on near-black (which is where value mistakes
 * show up — a leaf mass with no dark interior disappears against parchment
 * and glows radioactively against black).
 */

import {
  FLORA_LABELS,
  FLORA_SPECIES,
  drawFloraGeometry,
  floraSeed,
  growFlora,
  speciesAnchors,
  speciesFacing,
  type FloraAnchor,
  type FloraPlacement,
  type FloraSpeciesId,
} from '../../../src/art/flora';

const COLS = 5;
const CELL_W = 300;
const CELL_H = 320;
const PAD = 26;

export function makePlacement(
  species: FloraSpeciesId,
  seed: number,
  scale = 1,
  over: Partial<FloraPlacement> = {},
): FloraPlacement {
  const kind = speciesAnchors(species)[0]!;
  const anchor: FloraAnchor = { id: `${species}-${seed}`, kind, x: 0, y: 0, run: 90 };
  return {
    id: `p:${species}:${seed}`,
    anchor,
    species,
    seed: floraSeed(0, `${species}-${seed}`, seed),
    scale,
    flip: false,
    facing: speciesFacing(species, kind),
    palette: {},
    bounds: { x: 0, y: 0, w: 0, h: 0 },
    ...over,
  };
}

/** Fit a specimen's local bounds into a cell and draw it there. */
function drawFitted(
  ctx: CanvasRenderingContext2D,
  p: FloraPlacement,
  cx: number,
  cy: number,
  cw: number,
  ch: number,
): void {
  const g = growFlora(p);
  const b = g.bounds;
  const k = Math.min(cw / Math.max(1, b.w), ch / Math.max(1, b.h), 1.35);
  ctx.save();
  ctx.translate(cx + cw / 2, cy + ch / 2);
  ctx.scale(k, k);
  ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
  drawFloraGeometry(ctx, g, { granulate: false });
  ctx.restore();
}

function board(ground: string, label: string, contrastInk: string) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number): void => {
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, w, h);

    ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'top';

    FLORA_SPECIES.forEach((species, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = PAD + col * (CELL_W + PAD);
      const y = PAD + 22 + row * (CELL_H + PAD + 22);

      // Cell frame + a rail stub so grounded species have something to sit on.
      ctx.strokeStyle = contrastInk;
      ctx.globalAlpha = 0.16;
      ctx.strokeRect(x + 0.5, y + 0.5, CELL_W, CELL_H);
      ctx.globalAlpha = 1;

      drawFitted(ctx, makePlacement(species, 7 + i), x, y, CELL_W, CELL_H);

      ctx.fillStyle = contrastInk;
      ctx.globalAlpha = 0.75;
      ctx.fillText(FLORA_LABELS[species], x + 4, y + CELL_H + 5);
      ctx.globalAlpha = 1;
    });

    ctx.fillStyle = contrastInk;
    ctx.globalAlpha = 0.5;
    ctx.fillText(label, PAD, 6);
    ctx.globalAlpha = 1;
  };
}

const ROWS = Math.ceil(10 / COLS);
const W = PAD * 2 + COLS * CELL_W + (COLS - 1) * PAD;
const H = PAD * 2 + 22 + ROWS * (CELL_H + PAD + 22);

export const speciesScene = {
  name: 'species',
  width: W,
  height: H,
  draw: board('#e8dcc2', 'species board — over parchment', '#2a2118'),
};

export const speciesLitScene = {
  name: 'species-dark',
  width: W,
  height: H,
  draw: board('#171310', 'species board — over near-black (value check)', '#e8dcc2'),
};
