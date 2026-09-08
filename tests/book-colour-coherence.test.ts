import { describe, expect, it } from 'vitest';

import { BOOK_PRESETS, BOOK_SURPRISE_DIRECTIONS } from '../src/art/bookDesign';
import { resolveBookSurpriseColourProjection, surpriseBookRecipe } from '../src/art/bookSurprise';
import { resolveBookStyle } from '../src/art/bookStyle';
import { toOklch } from '../src/art/palette';
import { resolveSpineBinding } from '../src/art/spines';

function hueGap(first: string, second: string): number {
  const a = toOklch(first);
  const b = toOklch(second);
  if (Math.min(a.C, b.C) < 0.025) return 0;
  const direct = Math.abs(a.h - b.h);
  return Math.min(direct, 360 - direct);
}

function visibleBodies(seed: number, binding: string, overrides?: unknown) {
  const resolved = resolveBookStyle(seed, undefined, overrides, { binding });
  const spine = resolveSpineBinding({ ...resolved.spine, binding });
  const projection = resolveBookSurpriseColourProjection(
    spine,
    resolved.cover,
    resolved.style,
  );
  return {
    resolved,
    projection,
    visible: projection.visible,
  };
}

describe('spine and front-cover colour coherence', () => {
  it('keeps automatic Surprise faces in one recognisable colour family', () => {
    let worst = { gap: 0, direction: '', seed: 0, binding: '', spine: '', cover: '' };

    for (const direction of BOOK_SURPRISE_DIRECTIONS) {
      for (let seed = 0; seed < 4; seed += 1) {
        const recipe = surpriseBookRecipe({ direction: direction.id, seed });
        const { visible } = visibleBodies(seed, recipe.preset, recipe.style);
        const gap = hueGap(visible.spineBaseHex, visible.coverBaseHex);
        if (gap > worst.gap) {
          worst = {
            gap,
            direction: direction.id,
            seed,
            binding: recipe.preset,
            spine: visible.spineBaseHex,
            cover: visible.coverBaseHex,
          };
        }
      }
    }

    expect(worst.gap, JSON.stringify(worst)).toBeLessThanOrEqual(55);
  }, 12_000);

  it('keeps uncustomized seed defaults coherent across every named binding', () => {
    let worst = { gap: 0, seed: 0, binding: '', spine: '', cover: '' };
    for (const preset of BOOK_PRESETS) {
      for (let seed = 0; seed < 16; seed += 1) {
        const { visible } = visibleBodies(seed, preset.id);
        const gap = hueGap(visible.spineBaseHex, visible.coverBaseHex);
        if (gap > worst.gap) {
          worst = {
            gap,
            seed,
            binding: preset.id,
            spine: visible.spineBaseHex,
            cover: visible.coverBaseHex,
          };
        }
      }
    }

    expect(worst.gap, JSON.stringify(worst)).toBeLessThanOrEqual(55);
  }, 20_000);

  it('coordinates every unlocked body role around any one held colour', () => {
    const cases = [
      ['colour.spine-base', 'spineBaseHex'],
      ['colour.spine-accent', 'spineAccentHex'],
      ['colour.cover-base', 'coverBaseHex'],
      ['colour.cover-accent', 'coverAccentHex'],
    ] as const;

    for (const [lock, field] of cases) {
      const current = visibleBodies(0x51a7, 'plain-cloth', { [field]: '#315b50' });
      const snapshot = {
        binding: 'plain-cloth',
        style: current.resolved.style,
        pinned: current.resolved.pinned,
        visibleColours: current.projection.visible,
        colourSources: current.projection.sources,
      };
      const anchor = current.projection.visible[field];
      let worst = { gap: 0, lock, field: '', direction: '', seed: 0, binding: '', colour: '' };

      for (const direction of BOOK_SURPRISE_DIRECTIONS) {
        for (let seed = 0; seed < 4; seed += 1) {
          const recipe = surpriseBookRecipe({
            direction: direction.id,
            seed,
            current: snapshot,
            locks: [lock],
          });
          const { visible } = visibleBodies(0x51a7, recipe.preset, recipe.style);
          for (const role of [
            'spineBaseHex', 'spineAccentHex', 'coverBaseHex', 'coverAccentHex',
          ] as const) {
            const gap = hueGap(anchor, visible[role]);
            if (gap > worst.gap) {
              worst = {
                gap,
                lock,
                field: role,
                direction: direction.id,
                seed,
                binding: recipe.preset,
                colour: visible[role],
              };
            }
          }
        }
      }

      expect(worst.gap, JSON.stringify({ ...worst, anchor })).toBeLessThanOrEqual(55);
    }
  }, 30_000);

  it('keeps two deliberately conflicting held faces byte-identical', () => {
    const explicit = {
      spineBaseHex: '#315b50',
      coverBaseHex: '#82464c',
    };
    const current = visibleBodies(0x51a7, 'plain-cloth', explicit);
    const recipe = surpriseBookRecipe({
      direction: 'storybook',
      seed: 2,
      current: {
        binding: 'plain-cloth',
        style: current.resolved.style,
        pinned: current.resolved.pinned,
        visibleColours: current.projection.visible,
        colourSources: current.projection.sources,
      },
      locks: ['colour.spine-base', 'colour.cover-base'],
    });
    expect(recipe.style).toMatchObject(explicit);
  });

  it('keeps harmonious tonal variation in the corrected green-spine case', () => {
    const current = visibleBodies(0x51a7, 'plain-cloth', {
      spineBaseHex: '#315b50',
    });
    const recipe = surpriseBookRecipe({
      direction: 'storybook',
      seed: 2,
      current: {
        binding: 'plain-cloth',
        style: current.resolved.style,
        pinned: current.resolved.pinned,
        visibleColours: current.projection.visible,
        colourSources: current.projection.sources,
      },
      locks: ['colour.spine-base'],
    });
    const { visible } = visibleBodies(0x51a7, recipe.preset, recipe.style);
    expect(hueGap(visible.spineBaseHex, visible.coverBaseHex)).toBeLessThanOrEqual(55);
    expect(visible.coverBaseHex).not.toBe(visible.spineBaseHex);
  });

  it('preserves deliberately separate reader-picked face colours', () => {
    const explicit = {
      spineBaseHex: '#315b50',
      coverBaseHex: '#82464c',
    };
    const { resolved } = visibleBodies(0x51a7, 'plain-cloth', explicit);
    expect(resolved.style).toMatchObject(explicit);
  });
});
