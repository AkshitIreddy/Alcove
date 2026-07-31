/**
 * prototypes/painted/scenes/mass.ts — parameter sweep for `blockIn`.
 *
 * The 3× zoom showed the mass was over-averaging into a smooth gradient: with
 * spacing 0.1 and rowStep 0.28 every pixel receives ~30 overlapping stamps, so
 * the jitter cancels out. This sheet varies stamp spacing / row spacing /
 * opacity / pass count so the trade-off between "solid" and "you can see the
 * marks" can be judged by eye rather than argued about.
 *
 * Rendered at 2× so individual stamps are legible.
 */

import {
  blockIn,
  brush,
  createSurface,
  drawSurface,
  rectShape,
  type BrushKind,
} from '../../../src/art/brush';
import type { Scene } from './index';

const CW = 150;
const CH = 190;
const ZOOM = 2;

interface Variant {
  label: string;
  kind: BrushKind;
  spacing: number;
  rowFactor: number;
  opacity: number;
  passes: number;
  sizeFactor: number;
}

const VARIANTS: Variant[] = [
  { label: 'current .10/.28/.34/3', kind: 'chalk', spacing: 0.1, rowFactor: 0.28, opacity: 0.34, passes: 3, sizeFactor: 0.5 },
  { label: 'spacing .22', kind: 'chalk', spacing: 0.22, rowFactor: 0.28, opacity: 0.34, passes: 3, sizeFactor: 0.5 },
  { label: 'row .5', kind: 'chalk', spacing: 0.18, rowFactor: 0.5, opacity: 0.42, passes: 3, sizeFactor: 0.5 },
  { label: 'row .6 · 2 pass', kind: 'chalk', spacing: 0.2, rowFactor: 0.6, opacity: 0.5, passes: 2, sizeFactor: 0.5 },
  { label: 'row .6 · big head', kind: 'chalk', spacing: 0.22, rowFactor: 0.6, opacity: 0.5, passes: 2, sizeFactor: 0.85 },
  { label: 'bristle row .55', kind: 'bristle', spacing: 0.2, rowFactor: 0.55, opacity: 0.5, passes: 2, sizeFactor: 0.7 },
  { label: 'flat row .55', kind: 'flat', spacing: 0.16, rowFactor: 0.55, opacity: 0.5, passes: 2, sizeFactor: 0.7 },
  { label: 'flat row .7 · 3 pass', kind: 'flat', spacing: 0.18, rowFactor: 0.7, opacity: 0.55, passes: 3, sizeFactor: 0.8 },
];

export const massScene: Scene = {
  name: 'mass',
  width: 4 * (CW * ZOOM + 12) + 12,
  height: 2 * (CH * ZOOM + 30) + 12,
  draw(ctx, w, h) {
    ctx.fillStyle = '#0e0b08';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    VARIANTS.forEach((v, i) => {
      const col = i % 4;
      const row = (i / 4) | 0;
      const x = 12 + col * (CW * ZOOM + 12);
      const y = 26 + row * (CH * ZOOM + 30);
      const s = createSurface(CW, CH, '#181109');
      const short = CH * 0.62;
      blockIn(s, rectShape(CW * 0.16, CH * 0.1, CW * 0.68, CH * 0.8), '#6a2b26', {
        brush: brush(v.kind, {
          size: short * v.sizeFactor * 0.5,
          opacity: v.opacity,
          spacing: v.spacing,
          grain: 0.62,
          hardness: 0.45,
          jitter: { size: 0.3, opacity: 0.4, angle: 0.4, hue: 8, sat: 0.06, lum: 0.08, position: 1.4 },
        }),
        passes: v.passes,
        rowFactor: v.rowFactor,
        valueSpread: 0.13,
        hueSpread: 14,
        seed: 4242,
      });
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(ZOOM, ZOOM);
      drawSurface(ctx, s, 0, 0);
      ctx.restore();
      ctx.fillStyle = '#a2977f';
      ctx.fillText(v.label, x, y - 12);
    });
  },
};
