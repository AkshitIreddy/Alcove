/**
 * prototypes/flora/scenes/shelf.ts — the shelf mock.
 *
 * A plain dark rail with a row of book-shaped blocks, planted through the real
 * `planFlora` so the *composition* is under test, not just one specimen:
 *
 *   - does the growth frame the edges and corners, or carpet the whole plank?
 *   - is there negative space left in the middle of the book field?
 *   - does anything cover a title band?
 *
 * The blocks are painted as flat mid-value rectangles on purpose. This board
 * is about silhouette, mass and placement; a fully painted book would only
 * make it harder to see where the foliage actually sits.
 */

import {
  FLORA_SPECIES,
  drawFloraLayer,
  planFlora,
  spineKeepOuts,
  type FloraAnchor,
  type FloraDensity,
  type Rect,
} from '../../../src/art/flora';

const W = 1500;
const H = 720;

/** Case geometry for the mock: two side rails, a crown, a floor plank. */
const RAIL_W = 54;
const CROWN_H = 46;
const CASE_X = 60;
const CASE_Y = 40;
const CASE_W = W - CASE_X * 2;
const CASE_H = H - CASE_Y - 60;
const SHELF_Y = CASE_Y + CASE_H - 74; // top of the bottom plank
const BOOK_TOP = CASE_Y + CROWN_H + 26;

function books(): Rect[] {
  const out: Rect[] = [];
  let x = CASE_X + RAIL_W + 16;
  let i = 0;
  const right = CASE_X + CASE_W - RAIL_W - 16;
  while (x < right - 26) {
    const w = 26 + ((i * 37) % 5) * 6;
    const h = SHELF_Y - BOOK_TOP - ((i * 53) % 4) * 9;
    out.push({ x, y: SHELF_Y - h, w, h });
    x += w + 3;
    i++;
  }
  return out;
}

/**
 * The anchor field, with the compositional weight the real floor planner
 * supplies: ~1 at the frame rails and corners, dying toward the centre.
 */
function anchors(): FloraAnchor[] {
  const out: FloraAnchor[] = [];
  const midX = CASE_X + CASE_W / 2;
  const halfSpan = CASE_W / 2;
  /** Edge-weighted: 1 at the rails, ~0.06 in the middle of the book field. */
  const frame = (x: number): number => {
    const d = Math.abs(x - midX) / halfSpan; // 0 centre … 1 rail
    return Math.max(0.04, Math.pow(d, 2.4));
  };

  // Rail tops along the bottom plank.
  for (let i = 0; i < 16; i++) {
    const x = CASE_X + RAIL_W + 10 + (i / 15) * (CASE_W - RAIL_W * 2 - 20);
    out.push({ id: `rail${i}`, kind: 'railTop', x, y: SHELF_Y, run: 70, weight: frame(x) });
  }
  // Crown tops.
  for (let i = 0; i < 10; i++) {
    const x = CASE_X + 30 + (i / 9) * (CASE_W - 60);
    out.push({
      id: `crown${i}`,
      kind: 'crownTop',
      x,
      y: CASE_Y + CROWN_H,
      run: 80,
      weight: Math.max(0.5, frame(x)),
    });
  }
  // Upper case corners — the knots of the frame.
  out.push({ id: 'cornerL', kind: 'caseCorner', x: CASE_X + RAIL_W, y: CASE_Y + CROWN_H + 8, run: 90, weight: 1 });
  out.push({
    id: 'cornerR',
    kind: 'caseCorner',
    x: CASE_X + CASE_W - RAIL_W,
    y: CASE_Y + CROWN_H + 8,
    run: 90,
    weight: 1,
    flip: true,
  });
  // Undersides of the crown, where bundles hang.
  for (let i = 0; i < 6; i++) {
    const x = CASE_X + 90 + (i / 5) * (CASE_W - 180);
    out.push({
      id: `under${i}`,
      kind: 'shelfUnderside',
      x,
      y: CASE_Y + CROWN_H + 4,
      run: 60,
      weight: frame(x),
    });
  }
  // Joint gaps where the rails meet the plank, and pot spots on the plank.
  for (const [i, x] of [CASE_X + RAIL_W + 4, CASE_X + CASE_W - RAIL_W - 4].entries()) {
    out.push({ id: `joint${i}`, kind: 'jointGap', x, y: SHELF_Y, run: 60, weight: 1 });
    out.push({ id: `pot${i}`, kind: 'potPosition', x: x + (i === 0 ? 46 : -46), y: SHELF_Y, run: 70, weight: 0.9 });
  }
  return out;
}

function paintCase(ctx: CanvasRenderingContext2D, spines: Rect[]): void {
  // Case carcass.
  ctx.fillStyle = '#241c15';
  ctx.fillRect(CASE_X, CASE_Y, CASE_W, CASE_H);
  ctx.fillStyle = '#120e0a';
  ctx.fillRect(CASE_X + RAIL_W, CASE_Y + CROWN_H, CASE_W - RAIL_W * 2, CASE_H - CROWN_H - 74);
  // Rails / crown / plank in a slightly lighter wood value.
  ctx.fillStyle = '#33271c';
  ctx.fillRect(CASE_X, CASE_Y, CASE_W, CROWN_H);
  ctx.fillRect(CASE_X, CASE_Y, RAIL_W, CASE_H);
  ctx.fillRect(CASE_X + CASE_W - RAIL_W, CASE_Y, RAIL_W, CASE_H);
  ctx.fillRect(CASE_X, SHELF_Y, CASE_W, CASE_H - (SHELF_Y - CASE_Y));
  // Books.
  for (const [i, b] of spines.entries()) {
    const hue = 18 + ((i * 47) % 90);
    ctx.fillStyle = `hsl(${hue} 26% ${24 + ((i * 31) % 12)}%)`;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // Title band, so a keep-out violation is visible at a glance.
    ctx.fillStyle = 'hsl(44 60% 62% / 0.5)';
    ctx.fillRect(b.x + 3, b.y + b.h * 0.15, b.w - 6, b.h * 0.7);
  }
}

function shelf(density: FloraDensity, mult: number, label: string) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number): void => {
    ctx.fillStyle = '#0d0b09';
    ctx.fillRect(0, 0, w, h);
    const spines = books();
    paintCase(ctx, spines);

    const plan = planFlora({
      floorIndex: 2,
      themeSeed: 0xc0ffee,
      spec: { species: FLORA_SPECIES, density },
      anchors: anchors(),
      densityMultiplier: mult,
      keepOut: spineKeepOuts(spines, 4),
    });
    drawFloraLayer(ctx, plan, { granulate: false });

    ctx.fillStyle = '#e8dcc2';
    ctx.globalAlpha = 0.6;
    ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(`${label} — ${plan.length} specimens`, 12, 10);
    ctx.globalAlpha = 1;
  };
}

export const shelfSparseScene = {
  name: 'shelf-sparse',
  width: W,
  height: H,
  draw: shelf('sparse', 1, 'shelf mock — sparse'),
};

export const shelfLushScene = {
  name: 'shelf-lush',
  width: W,
  height: H,
  draw: shelf('lush', 1, 'shelf mock — lush'),
};

/** Density cranked past the theme, to see where the composition breaks. */
export const shelfFrameScene = {
  name: 'shelf-overgrown',
  width: W,
  height: H,
  draw: shelf('lush', 1.8, 'shelf mock — overgrown (slider at 1.8)'),
};
