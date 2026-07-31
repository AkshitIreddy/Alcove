/**
 * The comparison scene: a case with two loaded shelves, framed like the
 * reference crop so the two can sit side by side.
 */
import { DEFAULT_LIGHT_RIG, getLightRig, type LightRig } from '../../../src/art/lighting';
import { composeShelfRow, renderSpine } from '../../../src/art/spines';
import { getTheme } from '../../../src/art/themes';
import { paintWood } from '../../../src/art/wood';
import { rowInputs } from './baseline';
import type { Scene } from './index';

const PLANK_H = 26;

export function drawCase(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: { seed?: number; rigId?: string; rows?: number } = {},
): void {
  const rig: LightRig = opts.rigId ? getLightRig(opts.rigId) : DEFAULT_LIGHT_RIG;
  const seed = opts.seed ?? 7;
  const rows = opts.rows ?? 2;
  const theme = getTheme('cottage');

  // --- case back --------------------------------------------------------
  ctx.save();
  paintWood(ctx, theme.wood, w, h, { seed: seed * 31, direction: 'vertical', contrast: 0.8 });
  ctx.restore();

  const margin = 34;
  const rowH = (h - margin) / rows;

  for (let r = 0; r < rows; r++) {
    const baseline = margin + rowH * (r + 1) - PLANK_H;
    const avail = w - margin * 2;
    const books = rowInputs(30, seed + r * 13);
    const comp = composeShelfRow(books, { width: avail, seed: seed + r * 101 });

    for (const p of comp.placements) {
      ctx.save();
      if (p.pose === 'flat') {
        ctx.translate(margin + p.x, baseline - p.stackY);
        ctx.rotate(-Math.PI / 2);
        renderSpine(ctx, p.params, 0, 0, p.width, 1, p.title, {
          hiRes: true,
          rig,
          rowPhase: p.phase,
          depth: (p.depth + 1) / 2,
        });
      } else {
        const hp = Math.min(p.height, rowH - PLANK_H - 8);
        ctx.translate(margin + p.x, baseline - hp);
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

    // --- the plank ------------------------------------------------------
    ctx.save();
    ctx.translate(0, baseline);
    paintWood(ctx, theme.wood, w, PLANK_H, { seed: seed * 17 + r, direction: 'horizontal' });
    ctx.restore();
  }
}

export const SHELF_SCENES: Scene[] = [
  {
    name: 'shelf',
    width: 1000,
    height: 560,
    draw: (ctx, w, h) => drawCase(ctx, w, h, { seed: 7 }),
  },
  {
    name: 'shelf-crop',
    width: 1000,
    height: 560,
    draw: (ctx, w, h) => {
      const off = document.createElement('canvas');
      off.width = 1000;
      off.height = 560;
      drawCase(off.getContext('2d')!, 1000, 560, { seed: 7 });
      ctx.drawImage(off, 120, 40, 430, 240, 0, 0, w, h);
    },
  },
];
