import { describe, expect, it } from 'vitest';

import {
  normalizeBookStyleOverrides,
  resolveBookStyle,
} from '../src/art/bookStyle';
import {
  deriveSpineParams,
  renderSpine,
  type Ctx2D,
} from '../src/art/spines';

type RecordedOperation = readonly [name: string, ...args: readonly string[]];

function printable(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(6) : String(value);
  if (typeof value === 'string' || typeof value === 'boolean' || value == null) return String(value);
  return Object.prototype.toString.call(value);
}

function recordingContext(): { ctx: Ctx2D; operations: RecordedOperation[] } {
  const operations: RecordedOperation[] = [];
  const state: Record<PropertyKey, unknown> = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    direction: 'inherit',
    filter: 'none',
    shadowBlur: 0,
    shadowColor: 'rgba(0, 0, 0, 0)',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    canvas: { width: 128, height: 320 },
  };

  const ctx = new Proxy(state, {
    get(target, key): unknown {
      if (key in target) return target[key];
      const name = String(key);
      if (name === 'measureText') {
        return (text: string) => ({
          width: Array.from(text).length * 7,
          actualBoundingBoxAscent: 7,
          actualBoundingBoxDescent: 2,
        });
      }
      if (name === 'getLineDash') return () => [];
      if (name === 'getTransform') {
        return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      }
      if (name === 'createLinearGradient' || name === 'createRadialGradient') {
        return (...args: unknown[]) => {
          operations.push([name, ...args.map(printable)]);
          return {
            addColorStop: (...stop: unknown[]) => {
              operations.push(['addColorStop', ...stop.map(printable)]);
            },
          };
        };
      }
      if (name === 'createPattern') {
        return (...args: unknown[]) => {
          operations.push([name, ...args.map(printable)]);
          return { setTransform: () => undefined };
        };
      }
      return (...args: unknown[]) => {
        operations.push([name, ...args.map(printable)]);
      };
    },
    set(target, key, value): boolean {
      target[key] = value;
      operations.push([`set:${String(key)}`, printable(value)]);
      return true;
    },
  }) as unknown as Ctx2D;

  return { ctx, operations };
}

function renderOperations(hiRes: boolean): RecordedOperation[] {
  const { ctx, operations } = recordingContext();
  const params = {
    ...deriveSpineParams(0x51a7),
    binding: 'gilt-quarto' as const,
    w: 38,
    height: 236,
    ornamentOn: true,
    charm: 'ribbon' as const,
  };
  renderSpine(ctx, params, 4, 8, 236, 1, { hiRes });
  return operations;
}

describe('spine-title retirement contract', () => {
  it('ignores legacy stored titleScale/titleSpace while retaining cover typography', () => {
    const normalized = normalizeBookStyleOverrides({
      titleScale: 1.35,
      titleSpace: 0.52,
      titlePlate: 'gilt-cartouche',
      titleFont: 2,
    });

    expect(normalized).toEqual({
      titlePlate: 'gilt-cartouche',
      titleFont: 2,
    });

    const resolved = resolveBookStyle(0x51a7, undefined, {
      titleScale: 0.75,
      titleSpace: 0.16,
      titlePlate: 'paper-slip',
      titleFont: 1,
    });
    expect(resolved.style).not.toHaveProperty('titleScale');
    expect(resolved.style).not.toHaveProperty('titleSpace');
    expect(resolved.spine).not.toHaveProperty('titleScale');
    expect(resolved.spine).not.toHaveProperty('titleSpace');
    expect(resolved.cover).toMatchObject({
      titlePlate: 'label',
      titleFont: 1,
    });
  });

  it('renders identical titleless spine operations at every semantic zoom', () => {
    const low = renderOperations(false);
    const high = renderOperations(true);

    expect(high).toEqual(low);
    expect(high.some(([name]) => name === 'fillText' || name === 'strokeText')).toBe(false);
  });

  it('keeps front-cover title plate and font choices live', () => {
    const first = resolveBookStyle(73, undefined, {
      titlePlate: 'gilt-cartouche',
      titleFont: 2,
    });
    const second = resolveBookStyle(73, undefined, {
      titlePlate: 'paper-slip',
      titleFont: 0,
    });

    expect(first.cover.titlePlate).toBe('gilt-cartouche');
    expect(first.cover.titleFont).toBe(2);
    expect(second.cover.titlePlate).toBe('label');
    expect(second.cover.titleFont).toBe(0);
  });
});
