/**
 * The comparison scene: a case with two loaded shelves, lit by the shared rig
 * and framed like the reference crop so the two can sit side by side.
 */
import { renderBackPanel, renderPlank, renderRail } from '../../../src/art/caseArt';
import {
  DEFAULT_LIGHT_RIG,
  getLightRig,
  renderLitScene,
  type LightRig,
} from '../../../src/art/lighting';
import { composeShelfRow, renderSpine } from '../../../src/art/spines';
import { getTheme } from '../../../src/art/themes';
import { rowInputs } from './baseline';
import type { Scene } from './index';

const PLANK_H = 28;
const RAIL_W = 26;

export function drawCase(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: {
    seed?: number;
    rigId?: string;
    rows?: number;
    theme?: string;
    skipShafts?: boolean;
    skipBloom?: boolean;
    skipGrade?: boolean;
    skipVignette?: boolean;
  } = {},
): void {
  const rig: LightRig = opts.rigId ? getLightRig(opts.rigId) : DEFAULT_LIGHT_RIG;
  const seed = opts.seed ?? 7;
  const rows = opts.rows ?? 2;
  const theme = getTheme(opts.theme ?? 'cottage');

  renderLitScene(
    ctx,
    w,
    h,
    rig,
    (api) => {
      // --- the carcass back ---------------------------------------------
      renderBackPanel(ctx, theme, w, h, seed * 31);

      const top = 8;
      const rowH = (h - top) / rows;

      for (let r = 0; r < rows; r++) {
        const baseline = top + rowH * (r + 1) - PLANK_H;
        const bayTop = top + rowH * r;
        const avail = w - RAIL_W * 2;
        const books = rowInputs(30, seed + r * 13);
        const comp = composeShelfRow(books, { width: avail, seed: seed + r * 101 });

        // The bay behind the books is the darkest thing in the frame.
        api.ao({
          x: RAIL_W,
          y: bayTop,
          width: avail,
          height: baseline - bayTop,
          edges: ['top', 'left', 'right', 'bottom'],
          reach: Math.min(46, rowH * 0.4),
          strength: 1.15,
          corners: true,
        });

        for (const p of comp.placements) {
          ctx.save();
          if (p.pose === 'flat') {
            ctx.translate(RAIL_W + p.x, baseline - p.stackY);
            ctx.rotate(-Math.PI / 2);
            renderSpine(ctx, p.params, 0, 0, p.width, 1, p.title, {
              hiRes: true,
              rig,
              rowPhase: p.phase,
              depth: (p.depth + 1) / 2,
            });
          } else {
            const hp = Math.min(p.height, rowH - PLANK_H - 6);
            ctx.translate(RAIL_W + p.x, baseline - hp);
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

          // Every book touching the plank throws a contact shadow.
          const fw = p.pose === 'flat' ? p.width : p.params.w;
          api.contactShadow({
            x: RAIL_W + p.x,
            y: baseline,
            length: fw,
            depth: 7,
            side: 'below',
            strength: 0.85,
            gap: 0,
            skew: 3,
          });
        }

        // --- the plank ----------------------------------------------------
        ctx.save();
        ctx.translate(0, baseline);
        renderPlank(ctx, theme, w, PLANK_H, seed * 17 + r);
        ctx.restore();
        api.contactShadow({
          x: 0,
          y: baseline + PLANK_H,
          length: w,
          depth: 16,
          side: 'below',
          strength: 1,
          gap: 0,
          skew: 5,
        });
        api.key({
          x: 0,
          y: baseline,
          width: w,
          height: PLANK_H * 0.5,
          intensity: 0.5,
          hotSpot: 0.15,
        });
      }

      // --- side rails ------------------------------------------------------
      for (const side of [0, 1]) {
        ctx.save();
        ctx.translate(side === 0 ? 0 : w - RAIL_W, 0);
        renderRail(ctx, theme, RAIL_W, h, seed * 53 + side);
        ctx.restore();
      }
    },
    {
      seed: seed * 977,
      skipShafts: opts.skipShafts ?? true,
      skipBloom: opts.skipBloom ?? true,
      skipGrade: opts.skipGrade,
      skipVignette: opts.skipVignette,
    },
  );
}

/** Four lighting balances side by side — pick, then port. */
function contactSheet(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  variants: ReadonlyArray<{ label: string; opts: Parameters<typeof drawCase>[3] }>,
): void {
  const cols = 2;
  const rows = Math.ceil(variants.length / cols);
  const cw = Math.floor(w / cols);
  const ch = Math.floor(h / rows);
  ctx.fillStyle = '#0b0906';
  ctx.fillRect(0, 0, w, h);
  variants.forEach((v, i) => {
    const off = document.createElement('canvas');
    off.width = cw - 8;
    off.height = ch - 24;
    drawCase(off.getContext('2d')!, off.width, off.height, v.opts);
    const x = (i % cols) * cw + 4;
    const y = Math.floor(i / cols) * ch + 20;
    ctx.drawImage(off, x, y);
    ctx.fillStyle = '#e8ddc9';
    ctx.font = '13px sans-serif';
    ctx.fillText(v.label, x + 2, y - 6);
  });
}

export const SHELF_SCENES: Scene[] = [
  {
    name: 'shelf-athenaeum',
    width: 1000,
    height: 560,
    draw: (ctx, w, h) => drawCase(ctx, w, h, { seed: 11, theme: 'athenaeum' }),
  },
  {
    name: 'detail-athenaeum',
    width: 1100,
    height: 620,
    draw: (ctx, w, h) => {
      const off = document.createElement('canvas');
      off.width = 2000;
      off.height = 1120;
      const octx = off.getContext('2d')!;
      octx.scale(2, 2);
      drawCase(octx, 1000, 560, { seed: 11, theme: 'athenaeum' });
      ctx.drawImage(off, 120, 30, w, h, 0, 0, w, h);
    },
  },
  {
    name: 'shelf',
    width: 1000,
    height: 560,
    draw: (ctx, w, h) => drawCase(ctx, w, h, { seed: 7 }),
  },
  {
    name: 'light-sheet',
    width: 1360,
    height: 700,
    draw: (ctx, w, h) =>
      contactSheet(ctx, w, h, [
        { label: 'all passes', opts: { seed: 7 } },
        { label: 'no bloom', opts: { seed: 7, skipBloom: true } },
        { label: 'no grade', opts: { seed: 7, skipGrade: true } },
        { label: 'no bloom / no grade / no vignette', opts: { seed: 7, skipBloom: true, skipGrade: true, skipVignette: true } },
        { label: 'no shafts / no bloom / no grade', opts: { seed: 7, skipShafts: true, skipBloom: true, skipGrade: true } },
      ]),
  },
  {
    // A true 2× render cropped, not an upscale: this is what the eye sees
    // when the shelf camera zooms in, and where material has to hold up.
    name: 'shelf-detail',
    width: 1100,
    height: 620,
    draw: (ctx, w, h) => {
      const off = document.createElement('canvas');
      off.width = 2000;
      off.height = 1120;
      const octx = off.getContext('2d')!;
      octx.scale(2, 2);
      drawCase(octx, 1000, 560, { seed: 7 });
      ctx.drawImage(off, 120, 30, w, h, 0, 0, w, h);
    },
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
      ctx.drawImage(off, 90, 30, 430, 240, 0, 0, w, h);
    },
  },
];
