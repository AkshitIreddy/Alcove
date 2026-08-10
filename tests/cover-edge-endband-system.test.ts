import { describe, expect, it } from 'vitest';

import { renderCoverInto, type CoverParams } from '../src/art/covers';
import type { FlatCtx } from '../src/art/flat';
import {
  ACTIVE_EDGE_TREATMENTS,
  ACTIVE_HEAD_TAIL_STYLES,
} from '../src/art/spines';

type Operation = readonly [name: string, ...args: readonly unknown[]];

function recordingContext(width: number, height: number): {
  ctx: FlatCtx;
  operations: Operation[];
} {
  const operations: Operation[] = [];
  const state: Record<PropertyKey, unknown> = {
    canvas: { width, height },
    font: '10px sans-serif',
    letterSpacing: '0px',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    filter: 'none',
    shadowBlur: 0,
    shadowColor: 'rgba(0, 0, 0, 0)',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };

  const ctx = new Proxy(state, {
    get(target, key): unknown {
      if (key in target) return target[key];
      const name = String(key);
      if (name === 'measureText') {
        return (text: string) => {
          const px = Number.parseFloat(String(target.font).match(/([\d.]+)px/)?.[1] ?? '10');
          const glyphs = Array.from(text);
          return {
            width: glyphs.reduce((sum, glyph) => sum + px * (glyph === ' ' ? 0.31 : 0.54), 0),
            actualBoundingBoxAscent: px * 0.74,
            actualBoundingBoxDescent: px * 0.2,
          };
        };
      }
      if (name === 'getLineDash') return () => [];
      if (name === 'getTransform') {
        return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      }
      if (name === 'createLinearGradient' || name === 'createRadialGradient') {
        return () => ({ addColorStop: () => undefined });
      }
      if (name === 'createPattern') return () => ({ setTransform: () => undefined });
      return (...args: unknown[]) => operations.push([name, ...args]);
    },
    set(target, key, value): boolean {
      target[key] = value;
      if (key === 'fillStyle' || key === 'strokeStyle' || key === 'lineWidth') {
        operations.push([`set:${String(key)}`, value]);
      }
      return true;
    },
  }) as unknown as FlatCtx;

  return { ctx, operations };
}

const BASE: CoverParams = {
  seed: 0x51ee,
  palette: 29,
  texture: 0,
  material: 'velvet',
  covering: 0,
  frame: 0,
  medallion: -1,
  titleFont: 44,
  gilt: true,
  raisedBands: 2,
  bandGilt: true,
  headTail: true,
  headTailStyle: 1,
  titlePlate: 'gilt-direct',
  coverBaseHex: '#475d82',
  coverAccentHex: '#314564',
  toolingHex: '#f1d16f',
  wear: 0.05,
  edge: 'plain',
  charm: 'none',
};

function fingerprint(overrides: Partial<CoverParams>): string {
  const { ctx, operations } = recordingContext(142, 197);
  renderCoverInto(ctx, 142, 197, { ...BASE, ...overrides }, 'BINDING');
  return JSON.stringify(operations);
}

describe('held-cover edge and endband programmes', () => {
  it('paints all six active page-edge finishes as distinct true-size constructions', () => {
    expect(ACTIVE_EDGE_TREATMENTS).toEqual([
      'plain', 'gilt', 'stained-red', 'sepia-edge', 'deckle', 'red-under-gold',
    ]);
    const signatures = ACTIVE_EDGE_TREATMENTS.map((edge) => fingerprint({ edge }));
    expect(new Set(signatures).size).toBe(ACTIVE_EDGE_TREATMENTS.length);
  });

  it('paints off plus three sewn endband geometries without aliases', () => {
    expect(ACTIVE_HEAD_TAIL_STYLES).toEqual([1, 2, 3]);
    const signatures = [
      fingerprint({ headTail: false }),
      ...ACTIVE_HEAD_TAIL_STYLES.map((headTailStyle) =>
        fingerprint({ headTail: true, headTailStyle })),
    ];
    expect(new Set(signatures).size).toBe(4);
  });
});
