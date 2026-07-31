/**
 * prototypes/flora/scenes/leafboard.ts — leaves at inspection size.
 *
 * The species board shows plants; this shows *blades*. Every shape in the
 * vocabulary, painted big at each depth tier, so silhouette, value range and
 * edge quality can be judged without a whole plant's worth of overlap hiding
 * them. Plus the generated atom cut-outs at the same size, which is the only
 * honest way to compare "painted procedurally" against "painted by a model".
 */

import { LEAF_SHAPES, type LeafShape } from '../../../src/art/leaves';
import {
  TIER_BACK,
  TIER_LIT,
  TIER_MID,
  drawFloraAtom,
  drawFloraGeometry,
  drawLeafStamp,
  floraAtomNames,
  growFlora,
  setFloraAtomMode,
  type FloraAtomMode,
  type FloraSpeciesId,
  type FloraTier,
} from '../../../src/art/flora';
import { makePlacement } from './species';

const CELL = 132;
const PAD = 16;

const TIERS: [FloraTier, string][] = [
  [TIER_BACK, 'back'],
  [TIER_MID, 'mid'],
  [TIER_LIT, 'lit'],
];

const TONE = { h: 104, s: 42, l: 34 };

export const leafBoardScene = {
  name: 'leaves',
  width: PAD * 2 + LEAF_SHAPES.length * (CELL + PAD),
  height: PAD * 2 + TIERS.length * (CELL + PAD + 18) + 24,
  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = '#1b1611';
    ctx.fillRect(0, 0, w, h);
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'top';

    TIERS.forEach(([tier, tierName], row) => {
      LEAF_SHAPES.forEach((shape: LeafShape, col) => {
        const x = PAD + col * (CELL + PAD);
        const y = PAD + 18 + row * (CELL + PAD + 18);
        ctx.strokeStyle = '#e8dcc2';
        ctx.globalAlpha = 0.12;
        ctx.strokeRect(x + 0.5, y + 0.5, CELL, CELL);
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.translate(x + CELL * 0.14, y + CELL / 2);
        drawLeafStamp(ctx, {
          shape,
          tier,
          tone: TONE,
          len: CELL * 0.78,
          pale: shape === 'heart',
          curl: shape === 'oval' ? 0.35 : 0,
          damage: shape === 'serrate' ? 0.3 : 0,
          stamp: col % 4,
          seed: col * 977 + row * 31,
        });
        ctx.restore();
        if (row === 0) {
          ctx.fillStyle = '#e8dcc2';
          ctx.globalAlpha = 0.7;
          ctx.fillText(shape, x + 2, y - 15);
          ctx.globalAlpha = 1;
        }
      });
      ctx.fillStyle = '#f0c46a';
      ctx.globalAlpha = 0.8;
      ctx.fillText(tierName, 2, PAD + 20 + row * (CELL + PAD + 18));
      ctx.globalAlpha = 1;
    });
  },
};

/** Every generated foliage cut-out, tinted to the same tone as the board. */
export const atomBoardScene = {
  name: 'atoms',
  width: PAD * 2 + 8 * (CELL + PAD),
  height: PAD * 2 + 3 * (CELL + PAD + 18),
  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = '#1b1611';
    ctx.fillRect(0, 0, w, h);
    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    const names = floraAtomNames();
    if (names.length === 0) {
      ctx.fillStyle = '#e8dcc2';
      ctx.fillText('no atoms registered', PAD, PAD);
      return;
    }
    names.forEach((name, i) => {
      const col = i % 8;
      const row = Math.floor(i / 8);
      const x = PAD + col * (CELL + PAD);
      const y = PAD + 18 + row * (CELL + PAD + 18);
      ctx.strokeStyle = '#e8dcc2';
      ctx.globalAlpha = 0.12;
      ctx.strokeRect(x + 0.5, y + 0.5, CELL, CELL);
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.translate(x + CELL * 0.12, y + CELL / 2);
      drawFloraAtom(ctx, name, {
        len: CELL * 0.8,
        tone: TONE,
        tier: row === 2 ? TIER_LIT : row === 0 ? TIER_BACK : TIER_MID,
        seed: i * 131,
      });
      ctx.restore();
      ctx.fillStyle = '#e8dcc2';
      ctx.globalAlpha = 0.65;
      ctx.fillText(name, x + 2, y - 14);
      ctx.globalAlpha = 1;
    });
  },
};

/**
 * The verdict board: the same three specimens grown from the same seeds,
 * painted procedurally / mixed with generated cut-outs / entirely from them.
 * Nothing else changes between the columns.
 */
export const atomVsPaintedScene = {
  name: 'atoms-vs-painted',
  width: 3 * 380 + 4 * 20,
  height: 3 * 300 + 4 * 20 + 40,
  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = '#171310';
    ctx.fillRect(0, 0, w, h);
    ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'top';

    const modes: [FloraAtomMode, number, string][] = [
      ['off', 0, 'painted (procedural)'],
      ['mix', 0.5, 'mixed 50%'],
      ['only', 1, 'generated cut-outs only'],
    ];
    const species: FloraSpeciesId[] = ['blossom', 'fern', 'grassTuft'];

    modes.forEach(([mode, ratio, label], col) => {
      setFloraAtomMode(mode, ratio);
      const x = 20 + col * (380 + 20);
      ctx.fillStyle = '#f0c46a';
      ctx.globalAlpha = 0.85;
      ctx.fillText(label, x, 12);
      ctx.globalAlpha = 1;
      species.forEach((s, row) => {
        const y = 40 + 20 + row * (300 + 20);
        ctx.strokeStyle = '#e8dcc2';
        ctx.globalAlpha = 0.12;
        ctx.strokeRect(x + 0.5, y + 0.5, 380, 300);
        ctx.globalAlpha = 1;
        const p = makePlacement(s, 11 + row);
        const g = growFlora(p);
        const b = g.bounds;
        const k = Math.min(380 / Math.max(1, b.w), 300 / Math.max(1, b.h), 1.4);
        ctx.save();
        ctx.translate(x + 190, y + 150);
        ctx.scale(k, k);
        ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
        drawFloraGeometry(ctx, g, { granulate: false });
        ctx.restore();
      });
    });
    setFloraAtomMode('off');
  },
};
