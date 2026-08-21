import { describe, expect, it } from 'vitest';

import {
  ACTIVE_COVER_HANDS,
  ACTIVE_COVER_HAND_INDICES,
  ACTIVE_COVER_FRAME_INDICES,
  ACTIVE_COVER_FRAMES,
  COVER_FONTS,
  coverCacheKey,
  coverCompositionLayout,
  coverTitleFurniture,
  normalizeCoverHandIndex,
  normalizeCoverFrameIndex,
  renderCoverInto,
  type CoverParams,
  type CoverTitleFurniture,
} from '../src/art/covers';
import type { FlatCtx } from '../src/art/flat';
import { ACTIVE_TITLE_PLATES } from '../src/art/spines';

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
  frame: 26,
  medallion: -1,
  titleFont: 0,
  gilt: true,
  titlePlate: 'none',
  coverBaseHex: '#475d82',
  coverAccentHex: '#314564',
  toolingHex: '#f1d16f',
  wear: 0.05,
  edge: 'gilt',
  charm: 'none',
};

const EXPECTED_FURNITURE = new Map<string, CoverTitleFurniture>([
  ['none', 'direct-lettering'],
  ['direct-blind-title', 'direct-blind-impression'],
  ['direct-gilt-title', 'direct-gilt-lettering'],
  ['direct-ink-title', 'direct-ink-lettering'],
  ['press-small-caps', 'press-small-caps'],
  ['printer-floret-imprint', 'printer-floret'],
  ['laid-paper-ticket', 'laid-paper-label'],
  ['deckled-paper-ticket', 'deckled-paper-label'],
  ['vellum-rule-ticket', 'vellum-ruled-label'],
  ['parchment-slip', 'parchment-title-slip'],
  ['morocco-single-rule', 'morocco-single-fillet'],
  ['morocco-double-rule', 'morocco-double-fillet'],
  ['morocco-clipped-rule', 'morocco-clipped-fillet'],
  ['calf-blind-label', 'calf-blind-piece'],
  ['two-tone-leather-label', 'two-tone-leather-piece'],
  ['library-buckram-label', 'buckram-library-piece'],
  ['dyed-leather-crossband', 'dyed-leather-crossband'],
  ['gilt-ruled-crossband', 'gilt-ruled-crossband'],
  ['cloth-inlay-crossband', 'cloth-inlay-crossband'],
  ['split-leather-crossband', 'split-leather-crossband'],
  ['oxford-blind-compartment', 'oxford-open-compartment'],
  ['cambridge-calf-compartment', 'cambridge-open-compartment'],
  ['french-triple-fillet', 'french-triple-compartment'],
  ['ledger-open-field', 'ledger-open-rules'],
  ['inscription-shoulders', 'concave-inscription-shoulders'],
  ['renaissance-title-window', 'renaissance-mitred-window'],
]);

describe('authored cover frame system', () => {
  it('keeps eighteen materially distinct frame families and translates every legacy id', () => {
    expect(ACTIVE_COVER_FRAME_INDICES).toEqual([
      0, 2, 5, 6, 8, 17, 20, 24, 26, 36, 43, 48,
      50, 51, 52, 53, 54, 55,
    ]);
    expect(ACTIVE_COVER_FRAMES.map(({ tier }) => tier)).toEqual([
      'single', 'double', 'single', 'fillet', 'single', 'double',
      'fillet', 'fillet', 'fillet', 'banded', 'banded', 'banded',
      'fillet', 'triple', 'triple', 'triple', 'triple', 'fillet',
    ]);
    const constructions = ACTIVE_COVER_FRAMES.map((frame) => JSON.stringify({
      rules: frame.rules,
      corner: frame.corner,
      side: frame.side,
      turn: frame.turn,
      band: frame.band,
    }));
    expect(new Set(constructions).size).toBe(ACTIVE_COVER_FRAMES.length);
    for (let index = 0; index < 56; index += 1) {
      expect(ACTIVE_COVER_FRAME_INDICES, `legacy frame ${index}`).toContain(
        normalizeCoverFrameIndex(index),
      );
    }
    expect(normalizeCoverFrameIndex(6)).toBe(6);
    expect(normalizeCoverFrameIndex(17)).toBe(17);
    expect(normalizeCoverFrameIndex(20)).toBe(20);
    expect(normalizeCoverFrameIndex(48)).toBe(48);
    expect(normalizeCoverFrameIndex(19)).toBe(8);
    expect(normalizeCoverFrameIndex(27)).toBe(2);
    expect(normalizeCoverFrameIndex(28)).toBe(24);
  });
});

describe('authored cover title furniture', () => {
  it('offers ten curated lettering hands while folding the fifty-entry archive safely', () => {
    expect(ACTIVE_COVER_HAND_INDICES).toEqual([0, 1, 2, 9, 18, 31, 36, 38, 43, 44]);
    expect(ACTIVE_COVER_HANDS.map(({ index }) => index)).toEqual(ACTIVE_COVER_HAND_INDICES);
    expect(new Set(ACTIVE_COVER_HANDS.map(({ label }) => label)).size).toBe(10);
    for (let index = 0; index < COVER_FONTS.length; index += 1) {
      expect(ACTIVE_COVER_HAND_INDICES, COVER_FONTS[index]).toContain(
        normalizeCoverHandIndex(index),
      );
    }

    const title = 'A Quiet Ledger of Small Histories';
    for (const titleFont of ACTIVE_COVER_HAND_INDICES) {
      const { ctx, operations } = recordingContext(142, 197);
      renderCoverInto(ctx, 142, 197, { ...BASE, titleFont, titlePlate: 'gilt-direct' }, title);
      const lines = operations
        .filter(([name]) => name === 'fillText')
        .map(([, value]) => String(value));
      expect(lines.join(' ').toLocaleLowerCase(), COVER_FONTS[titleFont]).toBe(
        title.toLocaleLowerCase(),
      );
      expect(lines.join(''), COVER_FONTS[titleFont]).not.toMatch(/…|\.\.\./u);
    }
  });

  it('gives every active treatment its own named physical construction', () => {
    expect(ACTIVE_TITLE_PLATES).toEqual([...EXPECTED_FURNITURE.keys()]);
    for (const [style, furniture] of EXPECTED_FURNITURE) {
      expect(coverTitleFurniture(style as never), style).toBe(furniture);
    }
    expect(new Set(EXPECTED_FURNITURE.values()).size).toBe(ACTIVE_TITLE_PLATES.length);
    expect([...EXPECTED_FURNITURE.values()].join(' ')).not.toMatch(/pill|capsule|badge/i);
  });

  it('keys every curated title treatment independently in the cover cache', () => {
    const keys = ACTIVE_TITLE_PLATES.map((titlePlate) =>
      coverCacheKey(142, 197, { ...BASE, titlePlate }, 'A Quiet Ledger'));
    expect(new Set(keys).size).toBe(ACTIVE_TITLE_PLATES.length);
  });

  it('allocates broad horizontal fields and genuine vertical slips', () => {
    const vertical = new Set([
      'deckled-paper-ticket', 'parchment-slip', 'cloth-inlay-crossband',
    ]);
    for (const style of ACTIVE_TITLE_PLATES) {
      const layout = coverCompositionLayout(style, 26, -1);
      if (vertical.has(style)) {
        expect(layout.titleWidth, style).toBeLessThanOrEqual(0.32);
        expect(layout.titleHeight, style).toBeGreaterThanOrEqual(0.5);
        expect(layout.titleCenterX, style).not.toBe(0.5);
        continue;
      }
      if (layout.family === 'band') expect(layout.titleWidth, style).toBeGreaterThanOrEqual(0.82);
      if (layout.family === 'ticket') expect(layout.titleWidth, style).toBeGreaterThanOrEqual(0.45);
      if (layout.family === 'heraldic') expect(layout.titleWidth, style).toBeGreaterThanOrEqual(0.64);
      if (layout.family === 'panel') expect(layout.titleWidth, style).toBeGreaterThanOrEqual(0.73);
    }
  });

  it('paints complete titles at true and detail sizes in every construction', () => {
    const title = 'A Quiet Ledger of Small Histories';
    for (const style of ACTIVE_TITLE_PLATES) {
      for (const [width, height] of [[142, 197], [420, 583]] as const) {
        const { ctx, operations } = recordingContext(width, height);
        renderCoverInto(ctx, width, height, { ...BASE, titlePlate: style }, title);
        const lines = operations
          .filter(([name]) => name === 'fillText')
          .map(([, value]) => String(value));
        expect(lines.length, `${style}@${width}x${height}`).toBeGreaterThan(0);
        expect(lines.length, `${style}@${width}x${height}`).toBeLessThanOrEqual(3);
        expect(lines.join(' '), `${style}@${width}x${height}`).toBe(title);
        expect(lines.join(''), `${style}@${width}x${height}`).not.toMatch(/…|\.\.\./u);
      }
    }
  });
});
