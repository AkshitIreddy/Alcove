/**
 * Baseline: what a shelf row looks like right now, so every later change has
 * something to be compared against.
 */
import {
  composeShelfRow,
  getSpineParams,
  renderSpine,
  spineHeightPx,
  type RowBookInput,
} from '../../../src/art/spines';
import { DEFAULT_LIGHT_RIG, getLightRig } from '../../../src/art/lighting';
import type { Scene } from './index';

const TITLES = [
  'Atlas of Quiet Places', 'The Nightjar', 'Compendium', 'Salt', 'On Growth and Form',
  'Marginalia', 'The Long Field', 'Hedgerow', 'Vespers', 'A Book of Hours',
  'Wintering', 'Tide Tables', 'The Glass Bead Game', 'Selected Letters', 'Ash',
  'Almanac', 'Chalk', 'The Peregrine', 'Field Notes', 'Ravilious',
  'Orchard', 'Kelp', 'The Dark is Rising', 'Ex Libris', 'Herbarium',
  'Lantern', 'Quill', 'Mycelium', 'Bone China', 'The Ninth Wave',
];

export function rowInputs(count: number, seedBase = 1): RowBookInput[] {
  const out: RowBookInput[] = [];
  for (let i = 0; i < count; i++) {
    const seed = (seedBase * 7919 + i * 2654435761) >>> 0;
    out.push({ id: `b${i}`, seed, title: TITLES[i % TITLES.length] });
  }
  return out;
}

export function drawRow(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: { seed?: number; count?: number; rig?: string } = {},
): void {
  const rig = opts.rig ? getLightRig(opts.rig) : DEFAULT_LIGHT_RIG;
  const books = rowInputs(opts.count ?? 26, opts.seed ?? 1);
  const comp = composeShelfRow(books, { width: w - 40, seed: opts.seed ?? 1 });
  const baseline = h - 60;

  ctx.fillStyle = '#1a130d';
  ctx.fillRect(0, 0, w, h);

  for (const p of comp.placements) {
    ctx.save();
    if (p.pose === 'flat') {
      // Lying down: the spine's long axis runs along the plank.
      ctx.translate(20 + p.x, baseline - p.stackY);
      ctx.rotate(-Math.PI / 2);
      renderSpine(ctx, p.params, 0, 0, p.width, 1, p.title, {
        hiRes: true,
        rig,
        rowPhase: p.phase,
        depth: (p.depth + 1) / 2,
      });
    } else {
      const hp = p.height;
      ctx.translate(20 + p.x, baseline - hp);
      if (p.leanDeg !== 0) {
        ctx.translate(0, hp);
        ctx.rotate((p.leanDeg * Math.PI) / 180);
        ctx.translate(0, -hp);
      }
      renderSpine(ctx, p.params, 0, 0, hp, 1, p.title, {
        hiRes: true,
        rig,
        rowPhase: p.phase,
        depth: (p.depth + 1) / 2,
      });
    }
    ctx.restore();
  }

  // plank
  ctx.fillStyle = '#3a2a1a';
  ctx.fillRect(0, baseline, w, 40);
}

export const BASELINE_SCENES: Scene[] = [
  {
    name: 'baseline-row',
    width: 1200,
    height: 420,
    draw: (ctx, w, h) => drawRow(ctx, w, h, { seed: 3 }),
  },
  {
    name: 'baseline-zoom',
    width: 1200,
    height: 420,
    draw: (ctx, w, h) => {
      const off = document.createElement('canvas');
      off.width = 1200;
      off.height = 420;
      drawRow(off.getContext('2d')!, 1200, 420, { seed: 3 });
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 60, 400, 300, 0, 0, w, h);
    },
  },
];

export { TITLES, spineHeightPx, getSpineParams };
