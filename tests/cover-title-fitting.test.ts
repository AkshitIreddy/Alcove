import { describe, expect, it } from 'vitest';

import { ACTIVE_TITLE_PLATES } from '../src/art/bookStyle';
import {
  COVER_FONTS,
  renderCoverInto,
  type CoverParams,
} from '../src/art/covers';
import type { FlatCtx } from '../src/art/flat';

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
          const tracking = Number.parseFloat(String(target.letterSpacing)) || 0;
          const glyphs = Array.from(text);
          const body = glyphs.reduce((sum, glyph) => sum + px * (glyph === ' ' ? 0.31 : 0.54), 0);
          return {
            width: body + Math.max(0, glyphs.length - 1) * tracking,
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
      return (...args: unknown[]) => {
        operations.push([name, ...args]);
      };
    },
    set(target, key, value): boolean {
      target[key] = value;
      if (key === 'font') operations.push(['set:font', value]);
      return true;
    },
  }) as unknown as FlatCtx;

  return { ctx, operations };
}

const BASE: CoverParams = {
  seed: 0x51ee,
  palette: 20,
  texture: 0,
  material: 'smooth-cloth',
  covering: 0,
  frame: 26,
  medallion: 20,
  titleFont: 2,
  gilt: true,
  titlePlate: 'label',
};

function paintedTitle(
  title: string,
  titlePlate: CoverParams['titlePlate'],
  width: number,
  height: number,
  titleFont = 2,
): { lines: string[]; fontPx: number } {
  const { ctx, operations } = recordingContext(width, height);
  renderCoverInto(ctx, width, height, { ...BASE, titlePlate, titleFont }, title);
  let font = '0px sans-serif';
  const lines: string[] = [];
  let paintedFont = font;
  for (const [name, value] of operations) {
    if (name === 'set:font') font = String(value);
    if (name !== 'fillText') continue;
    lines.push(String(value));
    paintedFont = font;
  }
  return {
    lines,
    fontPx: Number.parseFloat(paintedFont.match(/([\d.]+)px/)?.[1] ?? '0'),
  };
}

describe('cover title fitting', () => {
  it('preserves every word without UI ellipsis across active treatments and real sizes', () => {
    const title = 'The Collected Correspondence of an Unreasonably Curious Cartographer';
    for (const treatment of ACTIVE_TITLE_PLATES) {
      for (const [width, height] of [[166, 230], [85, 118]] as const) {
        const { lines } = paintedTitle(title, treatment, width, height);
        expect(lines.length, `${treatment} at ${width}x${height}`).toBeGreaterThan(0);
        expect(lines.length, `${treatment} at ${width}x${height}`).toBeLessThanOrEqual(3);
        expect(lines.join(' '), `${treatment} at ${width}x${height}`).toBe(title);
        expect(lines.join(''), `${treatment} at ${width}x${height}`).not.toMatch(/…|\.\.\./u);
      }
    }
  });

  it('keeps one unbroken title complete instead of replacing its tail', () => {
    const title = 'Pneumonoultramicroscopicsilicovolcanoconiosis';
    const { lines } = paintedTitle(title, 'gilt-direct', 85, 118);
    expect(lines).toEqual([title]);
  });

  it('keeps the complete title in every reader-selectable title hand', () => {
    const title = 'The Lantern Atlas of Forgotten Roads';
    for (let titleFont = 0; titleFont < COVER_FONTS.length; titleFont += 1) {
      const { lines } = paintedTitle(title, 'gilt-direct', 85, 118, titleFont);
      expect(lines.join(' ').toLocaleLowerCase(), COVER_FONTS[titleFont]).toBe(
        title.toLocaleLowerCase(),
      );
      expect(lines.join(''), COVER_FONTS[titleFont]).not.toMatch(/…|\.\.\./u);
    }
  });

  it('sets the long gilt-direct stress title at deliberate, legible line counts', () => {
    const title = 'A Quiet Ledger of Small Histories';
    const native = paintedTitle(title, 'gilt-direct', 166, 230);
    const shelf = paintedTitle(title, 'gilt-direct', 85, 118);

    expect(native.lines).toHaveLength(2);
    expect(native.fontPx).toBeGreaterThanOrEqual(10);
    expect(shelf.lines).toHaveLength(3);
    expect(shelf.fontPx).toBeGreaterThanOrEqual(6.5);
    expect(native.lines.join(' ')).toBe(title);
    expect(shelf.lines.join(' ')).toBe(title);
  });
});
