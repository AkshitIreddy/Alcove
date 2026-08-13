import { describe, expect, it } from 'vitest';

import {
  ACTIVE_COVER_EMBLEM_INDICES,
  COVER_EMBLEM_MIN_CONTRAST,
  coverEmblemProgramme,
  normalizeCoverEmblemIndex,
  renderCoverInto,
  resolveCoverEmblemInk,
  type CoverEmblemProgramme,
  type CoverParams,
} from '../src/art/covers';
import { CLOTHS, FLAT, type FlatCtx } from '../src/art/flat';
import { colourContrast } from '../src/art/titleContrast';

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

const EXPECTED_PROGRAMMES = new Map<number, CoverEmblemProgramme>([
  [0, 'lozenge-fleuron'],
  [1, 'laurel-branch'],
  [2, 'stellar-palmette'],
  [5, 'solar-palms'],
  [12, 'upright-fleuron'],
  [13, 'oak-sprig'],
  [14, 'thistle-bloom'],
  [20, 'open-state-crown'],
  [23, 'rosette-arabesque'],
  [26, 'broad-fleur-de-lis'],
  [28, 'oak-acanthus-volutes'],
  [29, 'wheat-saltire'],
  [30, 'split-pomegranate'],
  [31, 'open-tulip'],
  [43, 'anthemion-fan'],
  [56, 'fern-palmette'],
  [66, 'acanthus-spearhead'],
  [67, 'carnation-standard'],
  [68, 'iris-triptych'],
  [69, 'artichoke-finial'],
  [70, 'poppy-capsule'],
  [71, 'olive-cutting'],
  [72, 'strawberry-sprig'],
  [73, 'vine-cluster'],
  [74, 'honeysuckle-scroll'],
  [75, 'lotus-waterline'],
  [76, 'samara-spray'],
  [77, 'willow-catkin'],
  [78, 'rowan-spray'],
  [79, 'columbine-bell'],
  [80, 'primrose-stem'],
  [81, 'dog-rose-branch'],
  [82, 'cedar-cone-spray'],
  [83, 'reed-bundle'],
  [84, 'moresque-knot'],
  [85, 'tudor-rose-standard'],
]);

const WELCOME_COVER: CoverParams = {
  seed: 0x51ee,
  palette: 29,
  texture: 0,
  material: 'velvet',
  covering: 0,
  frame: 48,
  medallion: 20,
  titleFont: 44,
  gilt: true,
  raisedBands: 2,
  bandGilt: true,
  headTail: false,
  headTailStyle: 1,
  titlePlate: 'gilt-direct',
  coverBaseHex: '#475d82',
  coverAccentHex: '#314564',
  toolingHex: '#f1d16f',
  emblemHex: '#f7e09a',
  wear: 0.05,
  edge: 'gilt',
  charm: 'none',
  cornerProtectors: false,
  insetPlate: false,
};

function renderOperations(
  medallion: number,
  width = 142,
  height = 197,
): Operation[] {
  const { ctx, operations } = recordingContext(width, height);
  renderCoverInto(ctx, width, height, { ...WELCOME_COVER, medallion }, 'Welcome to Alcove ✎');
  return operations;
}

function count(operations: readonly Operation[], name: string): number {
  return operations.filter(([operation]) => operation === name).length;
}

describe('authored cover emblem programmes', () => {
  it('assigns every active unified emblem one explicit semantic setting', () => {
    expect(ACTIVE_COVER_EMBLEM_INDICES).toEqual([...EXPECTED_PROGRAMMES.keys()]);
    for (const [index, programme] of EXPECTED_PROGRAMMES) {
      expect(coverEmblemProgramme(index), String(index)).toBe(programme);
    }
    expect(new Set(EXPECTED_PROGRAMMES.values()).size).toBe(ACTIVE_COVER_EMBLEM_INDICES.length);
    expect(normalizeCoverEmblemIndex(6)).toBe(12);
    expect(normalizeCoverEmblemIndex(19)).toBe(12);
    expect(normalizeCoverEmblemIndex(26)).toBe(26);
    expect(normalizeCoverEmblemIndex(17)).toBe(0);
    expect(normalizeCoverEmblemIndex(3)).toBe(12);
    expect(normalizeCoverEmblemIndex(27)).toBe(1);
    expect(normalizeCoverEmblemIndex(38)).toBe(13);
    expect(normalizeCoverEmblemIndex(57)).toBe(31);
  });

  it('keeps every true-size centrepiece open, authored and clear of the title', () => {
    for (const [width, height] of [[142, 197], [420, 583]] as const) {
      const quiet = renderOperations(-1, width, height);
      for (const medallion of ACTIVE_COVER_EMBLEM_INDICES) {
        const operations = renderOperations(medallion, width, height);
        const at = `${medallion}:${coverEmblemProgramme(medallion)}@${width}x${height}`;

        // An ellipse was the generic coin/badge surround. None of the final
        // active cover tools introduces one.
        expect(
          count(operations, 'ellipse') - count(quiet, 'ellipse'),
          `${at}:added badge ellipse`,
        ).toBe(0);

        // Richness has to exist in the pixels, not just in a programme name.
        const addedCurves =
          count(operations, 'quadraticCurveTo') - count(quiet, 'quadraticCurveTo') +
          count(operations, 'bezierCurveTo') - count(quiet, 'bezierCurveTo');
        expect(addedCurves, at).toBeGreaterThanOrEqual(4);
        const addedFills = count(operations, 'fill') - count(quiet, 'fill');
        const addedStrokes = count(operations, 'stroke') - count(quiet, 'stroke');
        // The append-only botanical tools are deliberately pure open strikes;
        // earlier centre blocks may retain a few solid cut leaves. Either way,
        // authored mass must come from several real marks rather than one fill.
        expect(addedFills + addedStrokes, at).toBeGreaterThanOrEqual(4);
        expect(addedStrokes, at)
          .toBeGreaterThanOrEqual(3);

        const title = operations
          .filter(([operation]) => operation === 'fillText')
          .map(([, value]) => String(value));
        expect(title.join(' ').toLocaleLowerCase(), `${at}:title`).toBe(
          'Welcome to Alcove ✎'.toLocaleLowerCase(),
        );
        expect(title.join(''), `${at}:ellipsis`).not.toMatch(/…|\.\.\./u);
      }
    }
  });

  it('keeps the Welcome Crown broad and authored without returning to micro-detail', () => {
    const quiet = renderOperations(-1, 420, 583);
    const crown = renderOperations(20, 420, 583);
    const beziers = count(crown, 'bezierCurveTo') - count(quiet, 'bezierCurveTo');
    const curves = count(crown, 'quadraticCurveTo') - count(quiet, 'quadraticCurveTo');
    const fills = count(crown, 'fill') - count(quiet, 'fill');

    expect(beziers).toBe(0);
    expect(curves).toBeGreaterThanOrEqual(20);
    // This includes the dedicated shelf-scale strike and crown-title fillets.
    // The ceiling prevents the return of domes, wreaths and micro-laurel.
    expect(curves).toBeLessThanOrEqual(48);
    expect(fills).toBeGreaterThanOrEqual(10);
    expect(fills).toBeLessThanOrEqual(14);
  });
});

describe('cover emblem ink', () => {
  it('preserves the authored Welcome gilt when it is already safe', () => {
    expect(resolveCoverEmblemInk('#f7e09a', '#475d82')).toBe('#f7e09a');
  });

  it('holds one-ink tooling above the contrast floor on every house cloth', () => {
    for (const [face] of CLOTHS) {
      for (const preferred of [FLAT.gilt, FLAT.giltPale, FLAT.inkSoft, face]) {
        const resolved = resolveCoverEmblemInk(preferred, face);
        expect(colourContrast(resolved, face), `${preferred} on ${face}`)
          .toBeGreaterThanOrEqual(COVER_EMBLEM_MIN_CONTRAST);
      }
    }
  });
});
