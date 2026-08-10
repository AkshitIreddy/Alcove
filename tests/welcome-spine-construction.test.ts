import { describe, expect, it } from 'vitest';

import {
  DECORS,
  bookPresetHasAuthoredFocal,
  materialSpec,
} from '../src/art/bookDesign';
import {
  deriveSpineParams,
  resolveSpineBinding,
  type SpineParams,
} from '../src/art/spines';

describe('formal titleless Welcome spine construction', () => {
  it('keeps the straight-backed cloth smooth under two cords and one broad tool', () => {
    const params: SpineParams = {
      ...deriveSpineParams(0x41c0),
      binding: 'plain-cloth',
      // `material` is still projected for compatibility, but an inherited
      // coarse chip must not replace the binding's exact polished covering.
      material: 'leather',
      materialPinned: false,
      raisedBands: 2,
      bandGilt: true,
      headTail: false,
      ornament: 20,
      ornamentOn: true,
      gilt: true,
    };

    const design = resolveSpineBinding(params);

    expect(design).toMatchObject({
      shape: 'square',
      material: 'smooth-cloth',
      decorations: ['plain'],
      bands: 2,
      bandGilt: true,
      headTail: null,
    });
    expect(materialSpec(design.material)).toMatchObject({
      grain: 'none',
      joints: 0,
    });
  });

  it('keeps even a pinned coarse leather chip inside the quiet reset materials', () => {
    const design = resolveSpineBinding({
      ...deriveSpineParams(0x41c0),
      binding: 'plain-cloth',
      material: 'leather',
      materialPinned: true,
      raisedBands: 2,
      bandGilt: true,
      headTail: false,
    });

    expect(design.material).toBe('polished-calf');
    expect(materialSpec(design.material).grain).toBe('none');
  });

  it('gives the shipped Welcome a grand publisher panel and one foliate lozenge', () => {
    const design = resolveSpineBinding({
      ...deriveSpineParams(0x41c0),
      binding: 'gilt-quarto',
      raisedBands: 2,
      bandGilt: true,
      headTail: false,
      ornament: 0,
      ornamentOn: true,
      gilt: true,
    });

    expect(design).toMatchObject({
      shape: 'square',
      material: 'smooth-cloth',
      // The optional foliate lozenge is the focal programme, so the resolver
      // deliberately quiets the preset fillet instead of stacking two ornate
      // systems on a 30px spine. The two physical cords keep the hierarchy.
      decorations: ['plain'],
      bands: 2,
      bandGilt: true,
      headTail: null,
    });
    expect(bookPresetHasAuthoredFocal('gilt-quarto')).toBe(false);

    const programme = DECORS['quarto-grand-fillet'];
    expect(programme.parts).toEqual([
      expect.objectContaining({
        k: 'binding',
        archetype: 'publisher-panel',
        variant: 0,
      }),
    ]);
  });
});
