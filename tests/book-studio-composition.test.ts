import { describe, expect, it } from 'vitest';

import {
  ACTIVE_ORNAMENT_INDICES,
  randomBookStyleOverrides,
  resolveBookStyle,
  type BookStyle,
  type BookStyleOverrides,
} from '../src/art/bookStyle';
import {
  reconcileBookStudioSectionRoll,
  styleAfterBindingChange,
} from '../src/views/rail/bookStudioComposition';

describe('Book Studio composition guards', () => {
  it('lets a newly picked binding own its construction while preserving size, colour and cover title', () => {
    const before: BookStyleOverrides = {
      material: 'silk',
      raisedBands: 5,
      bandGilt: true,
      headTail: true,
      headTailStyle: 2,
      ornament: 14,
      gilt: true,
      charm: 'pressed-flower',
      charmColor: 3,
      coverFrame: 29,
      coverMedallion: 12,
      cornerProtectors: true,
      insetPlate: true,
      height: 244,
      thickness: 31,
      wear: 0.28,
      edge: 'deckle',
      spineBaseHex: '#5f6f5a',
      coverBaseHex: '#704050',
      titlePlate: 'morocco-label',
      titleFont: 2,
    };

    expect(styleAfterBindingChange(before)).toEqual({
      height: 244,
      thickness: 31,
      wear: 0.28,
      edge: 'deckle',
      spineBaseHex: '#5f6f5a',
      coverBaseHex: '#704050',
      titlePlate: 'morocco-label',
      titleFont: 2,
    });
  });

  it('hard-retires applied objects and keeps one emblem on both faces', () => {
    const coverKeys = [
      'coverFrame',
      'coverMedallion',
      'cornerProtectors',
      'insetPlate',
    ] as const satisfies readonly (keyof BookStyle)[];
    const charmKeys = ['charm', 'charmColor'] as const satisfies readonly (keyof BookStyle)[];

    for (let seed = 0; seed < 2_048; seed += 1) {
      const current = resolveBookStyle(seed ^ 0x9315).style;
      const rolled = randomBookStyleOverrides(seed);

      for (const keys of [coverKeys, charmKeys]) {
        const patch = Object.fromEntries(keys.map((key) => [key, rolled[key]])) as Partial<BookStyle>;
        const effective = {
          ...current,
          ...reconcileBookStudioSectionRoll(current, patch, keys),
        };
        expect(effective.charm, `${seed}:charm`).toBe('none');
        expect(effective.cornerProtectors, `${seed}:corners`).toBe(false);
        expect(effective.insetPlate, `${seed}:inset`).toBe(false);
        if (keys === coverKeys && effective.coverMedallion >= 0) {
          expect(ACTIVE_ORNAMENT_INDICES, `${seed}:active-emblem`).toContain(
            effective.coverMedallion,
          );
          expect(effective.ornament, `${seed}:paired-emblem`).toBe(effective.coverMedallion);
        }
      }
    }

    const current = resolveBookStyle(17).style;
    const retired = reconcileBookStudioSectionRoll(
      current,
      {
        charm: 'wax-seal',
        charmColor: 3,
        cornerProtectors: true,
        insetPlate: true,
        ornament: 43,
        coverMedallion: 43,
      },
      ['charm', 'charmColor', 'cornerProtectors', 'insetPlate', 'ornament', 'coverMedallion'],
    );
    expect(retired.charm).toBe('none');
    expect(retired).not.toHaveProperty('charmColor');
    expect(retired.cornerProtectors).toBe(false);
    expect(retired.insetPlate).toBe(false);
    expect(retired.ornament).toBe(retired.coverMedallion);
    expect(ACTIVE_ORNAMENT_INDICES).toContain(retired.ornament);
  });

  it('keeps section dice restrained on structural bands and figured coverings', () => {
    for (let seed = 0; seed < 2_048; seed += 1) {
      const current = resolveBookStyle(seed ^ 0x4b17).style;
      const rolled = randomBookStyleOverrides(seed);
      const bands = reconcileBookStudioSectionRoll(
        current,
        { raisedBands: rolled.raisedBands, bandGilt: rolled.bandGilt },
        ['raisedBands', 'bandGilt'],
      );
      expect(bands.raisedBands).toBeLessThanOrEqual(2);
      if (bands.raisedBands === 0) expect(bands.bandGilt).toBe(false);

      for (const material of ['silk', 'marbled'] as const) {
        const figured = {
          ...current,
          ...reconcileBookStudioSectionRoll(current, { material }, ['material']),
        };
        expect(figured.ornament).toBe(-1);
        expect(figured.charm).toBe('none');
        expect(figured.coverMedallion).toBe(-1);
        expect(figured.cornerProtectors).toBe(false);
        expect(figured.insetPlate).toBe(false);
      }
    }
  });
});
