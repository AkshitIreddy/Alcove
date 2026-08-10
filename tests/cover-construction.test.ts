import { describe, expect, it } from 'vitest';

import {
  COVER_TEXTURES,
  coverCacheKey,
  coverConstructionFor,
  type CoverParams,
} from '../src/art/covers';
import type { MaterialLook } from '../src/art/bookDesign';

function cover(material: MaterialLook): CoverParams {
  return {
    seed: 0x51ee,
    palette: 8,
    texture: 0,
    covering: COVER_TEXTURES.indexOf(material),
    frame: 0,
    medallion: -1,
    titleFont: 0,
    gilt: false,
    titlePlate: 'label',
  };
}

describe('cover construction', () => {
  it('distinguishes smooth casework from supported skin and tied vellum', () => {
    const cloth = coverConstructionFor(cover('smooth-cloth'));
    const morocco = coverConstructionFor(cover('morocco-grain'));
    const vellum = coverConstructionFor(cover('vellum'));

    expect(cloth.supports).toEqual([]);
    expect(cloth.endband).toBe('woven');
    expect(morocco.supports).toHaveLength(5);
    expect(morocco.spineRatio).toBeGreaterThan(cloth.spineRatio);
    expect(vellum.supports).toHaveLength(4);
    expect(vellum.endband).toBe('tied');
  });

  it('keeps flexible wrappers narrow and free of fake raised bands', () => {
    const wrapper = coverConstructionFor(cover('paper-wrapper'));
    const sailcloth = coverConstructionFor(cover('sailcloth'));
    const split = coverConstructionFor(cover('half-bound'));

    expect(wrapper.boardEdge).toBe('folded');
    expect(wrapper.supports).toEqual([]);
    expect(wrapper.spineRatio).toBeLessThan(0.08);
    expect(sailcloth.endband).toBe('stitched');
    expect(sailcloth.supports).toEqual([]);
    expect(split.supports).toHaveLength(4);
    expect(split.spineRatio).toBeGreaterThan(0.14);
  });

  it('gives the quiet material families authored edge construction', () => {
    expect(coverConstructionFor(cover('linen')).boardEdge).toBe('turned');
    expect(coverConstructionFor(cover('canvas')).boardEdge).toBe('turned');
    expect(coverConstructionFor(cover('felt')).boardEdge).toBe('soft');
    expect(coverConstructionFor(cover('paste-paper')).boardEdge).toBe('folded');
  });

  it('projects the actual titleless spine furniture onto the visible cover turn', () => {
    const welcome = {
      ...cover('velvet'),
      raisedBands: 2,
      bandGilt: true,
      headTail: false,
      headTailStyle: 2,
      medallion: 20,
    } satisfies CoverParams;
    const construction = coverConstructionFor(welcome);

    expect(construction.supports).toEqual([0.2, 0.8]);
    expect(construction.supportWeight).toBeGreaterThan(0.1);
    expect(construction.endband).toBe('none');

    expect(coverCacheKey(142, 197, welcome, 'Welcome')).not.toBe(
      coverCacheKey(142, 197, { ...welcome, raisedBands: 0 }, 'Welcome'),
    );
    expect(coverCacheKey(142, 197, welcome, 'Welcome')).not.toBe(
      coverCacheKey(142, 197, { ...welcome, headTail: true }, 'Welcome'),
    );
  });

  it('keeps every generated construction inside the cover silhouette budget', () => {
    for (const material of COVER_TEXTURES) {
      const construction = coverConstructionFor(cover(material));
      expect(construction.spineRatio).toBeGreaterThanOrEqual(0.07);
      expect(construction.spineRatio).toBeLessThanOrEqual(0.16);
      expect(construction.roundRatio).toBeGreaterThanOrEqual(0.1);
      expect(construction.roundRatio).toBeLessThanOrEqual(0.22);
      expect(construction.jointRatio).toBeGreaterThan(0);
      expect(construction.supports.every((t) => t > 0.1 && t < 0.9)).toBe(true);
    }
  });
});
