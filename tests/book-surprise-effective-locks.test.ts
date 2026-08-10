import { describe, expect, it } from 'vitest';
import { bindingMaterialFor } from '../src/art/bookDesign';
import {
  surpriseBookRecipe,
  type BookSurpriseCurrent,
  type BookSurprisePalette,
} from '../src/art/bookSurprise';
import { resolveBookStyle, type ResolvedBookStyle } from '../src/art/bookStyle';
import { coveringSpecFor } from '../src/art/covers';
import { resolveSpineBinding } from '../src/art/spines';

function latentStyle(
  binding: BookSurpriseCurrent['binding'],
  accepts: (resolved: ResolvedBookStyle) => boolean,
): ResolvedBookStyle {
  for (let seed = 0; seed < 4_096; seed += 1) {
    const resolved = resolveBookStyle(seed, undefined, undefined, { binding });
    if (accepts(resolved)) return resolved;
  }
  throw new Error(`No latent style matched ${binding}`);
}

function current(
  binding: BookSurpriseCurrent['binding'],
  resolved: ResolvedBookStyle,
  visibleColours?: BookSurprisePalette,
): BookSurpriseCurrent {
  return {
    binding,
    style: resolved.style,
    pinned: resolved.pinned,
    ...(visibleColours === undefined ? {} : { visibleColours }),
  };
}

describe('Surprise locks preserve rendered values, not latent seed fields', () => {
  it('captures Gilt Quarto cloth when its unpinned seed material says something else', () => {
    const binding = 'gilt-quarto';
    const before = latentStyle(
      binding,
      (resolved) => resolved.style.material !== bindingMaterialFor('smooth-cloth'),
    );
    const beforeSpine = { ...before.spine, binding };

    expect(before.pinned.has('material')).toBe(false);
    expect(before.style.material).not.toBe('cloth');
    expect(resolveSpineBinding(beforeSpine).material).toBe('smooth-cloth');
    expect(coveringSpecFor(before.cover).id).toBe('smooth-cloth');

    const recipe = surpriseBookRecipe({
      direction: 'formal',
      seed: 0xc10_7a11,
      current: current(binding, before),
      locks: ['cover.material'],
    });

    expect(recipe.style.material).toBe('cloth');
    expect(bindingMaterialFor(recipe.components.material)).toBe('cloth');

    const after = resolveBookStyle(before.seed, undefined, recipe.style, {
      binding: recipe.preset,
    });
    expect(after.pinned.has('material')).toBe(true);
    expect(resolveSpineBinding({ ...after.spine, binding: recipe.preset }).material).toBe(
      'smooth-cloth',
    );
    expect(coveringSpecFor(after.cover).id).toBe('smooth-cloth');
  });

  it('captures Library Buckram\'s visible cover label when the latent plate is none', () => {
    const binding = 'library-buckram';
    const before = latentStyle(binding, (resolved) => resolved.style.titlePlate === 'none');

    expect(before.pinned.has('titlePlate')).toBe(false);
    expect(before.style.titlePlate).toBe('none');
    expect(before.cover.titlePlate).toBe('label');

    const recipe = surpriseBookRecipe({
      direction: 'quiet',
      seed: 0x1abe_110c,
      current: current(binding, before),
      locks: ['title.plate'],
    });

    expect(recipe.style.titlePlate).toBe('label');
    const after = resolveBookStyle(before.seed, undefined, recipe.style, {
      binding: recipe.preset,
    });
    expect(after.pinned.has('titlePlate')).toBe(true);
    expect(after.cover.titlePlate).toBe('label');
  });

  it('keeps an active unpinned seed plate instead of replacing it with the binding fallback', () => {
    const binding = 'library-buckram';
    const before = latentStyle(
      binding,
      (resolved) => resolved.style.titlePlate === 'morocco-label',
    );
    expect(before.cover.titlePlate).toBe('morocco-label');

    const recipe = surpriseBookRecipe({
      direction: 'formal',
      seed: 0x51a7_e111,
      current: current(binding, before),
      locks: ['title.plate'],
    });
    expect(recipe.style.titlePlate).toBe('morocco-label');
  });

  it('lets an explicit None plate remove a binding-derived label and locks that absence', () => {
    const binding = 'library-buckram';
    const before = resolveBookStyle(0x119e, undefined, { titlePlate: 'none' }, { binding });

    expect(before.pinned.has('titlePlate')).toBe(true);
    expect(before.cover.titlePlate).toBe('none');

    const recipe = surpriseBookRecipe({
      direction: 'storybook',
      seed: 0x0ff0_0ff0,
      current: current(binding, before),
      locks: ['title.plate'],
    });
    expect(recipe.style.titlePlate).toBe('none');
  });

  it('keeps an active latent cover plate unchanged', () => {
    const binding = 'library-buckram';
    const before = latentStyle(
      binding,
      (resolved) => resolved.style.titlePlate === 'morocco-label',
    );
    expect(before.pinned.has('titlePlate')).toBe(false);
    expect(before.cover.titlePlate).toBe('morocco-label');
  });

  it('still preserves an explicitly pinned coarse material over the binding', () => {
    const binding = 'gilt-quarto';
    const before = resolveBookStyle(0x8812, undefined, { material: 'paper' }, { binding });
    const recipe = surpriseBookRecipe({
      direction: 'quiet',
      seed: 0xe11e,
      current: current(binding, before),
      locks: ['cover.material'],
    });

    expect(before.pinned.has('material')).toBe(true);
    expect(recipe.style.material).toBe('paper');
    expect(bindingMaterialFor(recipe.components.material)).toBe('paper');
  });

  it('keeps inherited colour roles inherited when the shared pigment is locked', () => {
    const binding = 'blind-cloth';
    const before = resolveBookStyle(12_345, undefined, undefined, { binding });
    const visibleColours: BookSurprisePalette = {
      spineBaseHex: '#6b786e',
      spineAccentHex: '#8b665c',
      coverBaseHex: '#6b786e',
      coverAccentHex: '#8b665c',
      toolingHex: '#4a333b',
      emblemHex: '#4a333b',
      hardwareHex: '#9b7549',
    };
    const recipe = surpriseBookRecipe({
      direction: 'grand',
      seed: 98_765,
      current: current(binding, before, visibleColours),
      locks: ['colour.palette'],
    });

    expect(recipe.style.pigment).toBe(before.style.pigment);
    expect(recipe.style.clothHex).toBe(before.style.clothHex);
    expect(recipe.style.hueJitter).toBe(before.style.hueJitter);
    for (const field of [
      'spineBaseHex',
      'spineAccentHex',
      'coverBaseHex',
      'coverAccentHex',
      'toolingHex',
      'emblemHex',
      // Hardware colour is retired metadata and remains inherited/null.
      'hardwareHex',
    ] as const) expect(recipe.style[field]).toBeNull();
  });

  it('captures every inherited colour well when its individual lock closes', () => {
    const binding = 'blind-cloth';
    const before = resolveBookStyle(12_345, undefined, undefined, { binding });
    const visibleColours: BookSurprisePalette = {
      spineBaseHex: '#31564f',
      spineAccentHex: '#9b665c',
      coverBaseHex: '#284a66',
      coverAccentHex: '#b58a49',
      toolingHex: '#f2d991',
      emblemHex: '#eadfca',
      hardwareHex: '#8d6142',
    };
    const cases = [
      ['colour.spine-base', 'spineBaseHex'],
      ['colour.spine-accent', 'spineAccentHex'],
      ['colour.cover-base', 'coverBaseHex'],
      ['colour.cover-accent', 'coverAccentHex'],
      ['colour.tooling', 'toolingHex'],
      ['colour.emblem', 'emblemHex'],
    ] as const;

    for (const [lock, field] of cases) {
      const recipe = surpriseBookRecipe({
        direction: 'storybook',
        seed: 98_765,
        current: current(binding, before, visibleColours),
        locks: [lock],
      });
      expect(recipe.style[field], `${lock} should capture ${field}`).toBe(visibleColours[field]);
    }
  });
});
