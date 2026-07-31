/**
 * Material specimen board + a bake-cost probe.
 *
 * The board is the "look at six treatments side by side" sheet; the probe
 * prints per-spine cost, because a painted spine that takes 100ms to bake is
 * a spine the shelf cannot afford.
 */
import { DEFAULT_LIGHT_RIG } from '../../../src/art/lighting';
import { deriveSpineParams, renderSpine, type BindingMaterial } from '../../../src/art/spines';
import type { Scene } from './index';

const MATERIALS: BindingMaterial[] = ['leather', 'cloth', 'paper', 'vellum', 'linen', 'silk'];

export const MATERIAL_SCENES: Scene[] = [
  {
    name: 'materials',
    width: 1200,
    height: 640,
    draw: (ctx, w, h) => {
      ctx.fillStyle = '#100c08';
      ctx.fillRect(0, 0, w, h);
      const cols = MATERIALS.length;
      const cw = w / cols;
      MATERIALS.forEach((m, i) => {
        for (let j = 0; j < 3; j++) {
          const seed = (i * 7919 + j * 104729 + 13) >>> 0;
          const base = deriveSpineParams(seed);
          const params = { ...base, material: m, w: 46, boardStyle: j };
          ctx.save();
          ctx.translate(i * cw + cw / 2 - 23, 30 + j * 0);
          renderSpine(ctx, params, 0, 0, h - 70, 1, `${m} ${j}`, {
            hiRes: true,
            rig: DEFAULT_LIGHT_RIG,
            rowPhase: 0.5 + j * 0.2,
          });
          ctx.restore();
          break;
        }
        ctx.fillStyle = '#d8cbb0';
        ctx.font = '13px sans-serif';
        ctx.fillText(m, i * cw + 8, 18);
      });
    },
  },
  {
    name: 'bake-cost',
    width: 900,
    height: 320,
    draw: (ctx, w, h) => {
      ctx.fillStyle = '#100c08';
      ctx.fillRect(0, 0, w, h);
      (globalThis as any).__spineProf = [];
      const n = 20;
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        const params = deriveSpineParams((i * 2654435761 + 7) >>> 0);
        ctx.save();
        ctx.translate(20 + i * 42, 40);
        renderSpine(ctx, params, 0, 0, 230, 1, 'Cost Probe', {
          hiRes: true,
          rig: DEFAULT_LIGHT_RIG,
          rowPhase: i / n,
        });
        ctx.restore();
      }
      const ms = (performance.now() - t0) / n;
      ctx.fillStyle = '#ffe9a8';
      ctx.font = '18px sans-serif';
      ctx.fillText(`${ms.toFixed(1)} ms / spine (230px tall, 1x)`, 20, h - 24);
      // eslint-disable-next-line no-console
      console.warn(`[bake-cost] ${ms.toFixed(2)} ms per spine`);
      const prof = (globalThis as any).__spineProf as Array<Record<string, number>>;
      const agg: Record<string, number> = {};
      for (const o of prof) for (const k of Object.keys(o)) agg[k] = (agg[k] ?? 0) + o[k];
      console.warn(`[phases] ` + Object.entries(agg).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${(v / prof.length).toFixed(1)}`).join(" "));
    },
  },
];
