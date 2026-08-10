import { describe, expect, it } from 'vitest';
import {
  BOOK_SURPRISE_DIRECTIONS,
  FORMAL_BOOK_PRESET_ID,
  ROLLABLE_MATERIALS,
  ROLLABLE_SHAPES,
  bindingMaterialFor,
  bookPreset,
  type BookSurpriseDirectionId,
} from '../src/art/bookDesign';
import {
  BOOK_SURPRISE_LOCK_DEFINITIONS,
  BOOK_SURPRISE_LOCK_IDS,
  bookPresetAllowedByCuration,
  inspectBookSurpriseRecipe,
  normalizeBookSurpriseLocks,
  surpriseBookRecipe,
  type BookSurpriseCurrent,
  type BookSurpriseLockId,
} from '../src/art/bookSurprise';
import { resolveBookStyle } from '../src/art/bookStyle';
import { ACTIVE_COVER_FRAME_INDICES } from '../src/art/covers';
import {
  ACTIVE_EDGE_TREATMENTS,
  ACTIVE_HEAD_TAIL_STYLES,
  ACTIVE_ORNAMENT_INDICES,
  ACTIVE_TITLE_PLATES,
  MAX_RAISED_BANDS,
} from '../src/art/spines';

function currentAppearance(seed = 0x4b00c): BookSurpriseCurrent {
  return {
    binding: 'gilt-quarto',
    style: resolveBookStyle(seed, undefined, {
      material: 'leather',
      pigment: 7,
      clothHex: '#76483f',
      spineBaseHex: '#315b50',
      spineAccentHex: '#9a5947',
      coverBaseHex: '#405d73',
      coverAccentHex: '#c4ad7d',
      toolingHex: '#efd37e',
      emblemHex: '#f4dda0',
      hardwareHex: '#c99a49',
      hueJitter: 3,
      raisedBands: 2,
      bandGilt: true,
      headTail: true,
      headTailStyle: 2,
      ornament: 17,
      titlePlate: 'morocco-label',
      titleFont: 2,
      wear: 0.37,
      edge: 'sepia-edge',
      format: 'quarto',
      height: 248,
      thickness: 41,
      overlap: true,
      gilt: true,
      charm: 'none',
      charmColor: '#8e714c',
      coverFrame: 24,
      coverMedallion: 17,
      cornerProtectors: false,
      insetPlate: false,
    }).style,
  };
}

function expectBindingLock(
  id: BookSurpriseLockId,
  current: BookSurpriseCurrent,
  recipe: ReturnType<typeof surpriseBookRecipe>,
): void {
  const before = bookPreset(current.binding);
  if (id === 'binding') expect(recipe.preset).toBe(current.binding);
  if (id === 'binding.shape') expect(recipe.components.shape).toBe(before.shape);
  if (id === 'binding.material') expect(recipe.components.material).toBe(before.material);
  if (id === 'binding.decoration') expect(recipe.components.decorations).toEqual(before.decorations);
  if (id === 'binding.gilt') expect(recipe.components.gilt).toBe(before.gilt);
}

describe('lock-aware book Surprise', () => {
  it('has a closed JSON-safe lock vocabulary and a tolerant stable normalizer', () => {
    expect(BOOK_SURPRISE_LOCK_IDS).toHaveLength(24);
    expect(new Set(BOOK_SURPRISE_LOCK_IDS).size).toBe(BOOK_SURPRISE_LOCK_IDS.length);
    expect(Object.keys(BOOK_SURPRISE_LOCK_DEFINITIONS).sort()).toEqual(
      [...BOOK_SURPRISE_LOCK_IDS].sort(),
    );
    expect(normalizeBookSurpriseLocks([
      'cover.frame',
      'not-a-lock',
      'binding.shape',
      'cover.frame',
    ])).toEqual(['binding.shape', 'cover.frame']);
    expect(normalizeBookSurpriseLocks(new Set([
      'wear',
      'title.space',
      'charm.kind',
      'charm.colour',
      'cover.medallion',
      'cover.corners',
      'cover.inset',
      'colour.hardware',
    ]))).toEqual(['wear']);
    expect(normalizeBookSurpriseLocks({ locks: ['wear'] })).toEqual([]);
  });

  it('preserves every locked visible decision exactly', () => {
    const current = currentAppearance();
    for (const id of BOOK_SURPRISE_LOCK_IDS) {
      const recipe = surpriseBookRecipe({
        direction: 'storybook',
        seed: 0x1000 + BOOK_SURPRISE_LOCK_IDS.indexOf(id),
        current,
        locks: [id],
      });
      for (const field of BOOK_SURPRISE_LOCK_DEFINITIONS[id].fields) {
        expect(recipe.style[field], `${id} must preserve ${field}`).toEqual(current.style[field]);
      }
      expectBindingLock(id, current, recipe);
      expect(recipe.style.overlap, `${id} must not alter shelf overlap intent`).toBe(true);
      expect(recipe.locks).toEqual([id]);
    }
  }, 20_000);

  it('ignores retired spine-title locks while preserving structural locks', () => {
    const current = currentAppearance();
    const retiredLocks = surpriseBookRecipe({
      direction: 'formal',
      seed: 0x511e,
      current,
      locks: ['title.scale', 'title.space'] as never,
    });
    const unlocked = surpriseBookRecipe({
      direction: 'formal',
      seed: 0x511e,
      current,
      locks: [],
    });
    expect(retiredLocks).toEqual(unlocked);
    expect(retiredLocks.locks).toEqual([]);
    expect(retiredLocks.style).not.toHaveProperty('titleScale');
    expect(retiredLocks.style).not.toHaveProperty('titleSpace');

    const cordsWin = surpriseBookRecipe({
      direction: 'antique',
      seed: 0x511f,
      current,
      locks: ['bands'],
    });
    expect(cordsWin.style.raisedBands).toBe(2);
    expect(cordsWin.style.bandGilt).toBe(true);
  });

  it('chooses an authored binding in the family of a locked coarse cover material', () => {
    const current = currentAppearance();
    const recipe = surpriseBookRecipe({
      direction: 'grand',
      seed: 0x7854,
      current,
      locks: ['cover.material'],
    });
    expect(recipe.style.material).toBe(current.style.material);
    expect(bindingMaterialFor(recipe.components.material)).toBe(current.style.material);
  });

  it('keeps explicit locked components even when hidden, but never rolls hidden unlocked parts', () => {
    const current = currentAppearance();
    const hidden = {
      bindings: [current.binding],
      shapes: [bookPreset(current.binding).shape],
      materials: [bookPreset(current.binding).material],
    };
    const exact = surpriseBookRecipe({
      direction: 'formal',
      seed: 0x91,
      current,
      locks: ['binding'],
      curation: hidden,
    });
    expect(exact.preset).toBe(current.binding);

    const free = surpriseBookRecipe({
      direction: 'formal',
      seed: 0x92,
      current,
      locks: [],
      curation: hidden,
    });
    expect(bookPresetAllowedByCuration(bookPreset(free.preset), hidden)).toBe(true);
  });

  it('honours hidden style choices inside the deterministic search before locks are applied', () => {
    const seed = 0x7123;
    const baseline = surpriseBookRecipe({ direction: 'storybook', seed });
    const curated = surpriseBookRecipe({
      direction: 'storybook',
      seed,
      curation: {
        style: {
          ornament: [String(baseline.style.ornament)],
          'title-plate': [String(baseline.style.titlePlate)],
          lettering: [String(baseline.style.titleFont)],
          edge: [String(baseline.style.edge)],
          format: [String(baseline.style.format)],
          'cover-frame': [String(baseline.style.coverFrame)],
          'spine-cloth': [String(baseline.style.pigment)],
        },
      },
    });
    expect(curated.style.ornament).not.toBe(baseline.style.ornament);
    expect(curated.style.titlePlate).not.toBe(baseline.style.titlePlate);
    expect(curated.style.titleFont).not.toBe(baseline.style.titleFont);
    expect(curated.style.edge).not.toBe(baseline.style.edge);
    expect(curated.style.format).not.toBe(baseline.style.format);
    // Retired applied furniture is no longer a hidden Surprise decision.
    expect(curated.style.charm).toBe('none');
    expect(curated.style.coverFrame).not.toBe(baseline.style.coverFrame);
    expect(curated.style.coverMedallion).toBe(curated.style.ornament);
    expect(curated.style.pigment).not.toBe(baseline.style.pigment);
  });

  it('is deterministic and keeps sampled object-form candidates strong across every direction', () => {
    const seen = new Map<BookSurpriseDirectionId, Set<string>>();
    for (const direction of BOOK_SURPRISE_DIRECTIONS) {
      const bindings = new Set<string>();
      for (let seed = 0; seed < 24; seed += 1) {
        const input = { direction: direction.id, seed: seed * 0x9e37 + 17 } as const;
        const first = surpriseBookRecipe(input);
        const second = surpriseBookRecipe(input);
        expect(second).toEqual(first);
        expect(first.score).toBeGreaterThanOrEqual(82);
        expect(first.quality === 'strong' || first.quality === 'excellent').toBe(true);
        expect(
          inspectBookSurpriseRecipe(first, direction.id).score,
        ).toBeCloseTo(first.score, 1);
        bindings.add(first.preset);
      }
      seen.set(direction.id, bindings);
      expect(bindings.size, `${direction.id} should retain binding diversity`).toBeGreaterThanOrEqual(4);
    }
  }, 40_000);

  it('normalizes the complete retired appearance even when an old lock blob asks to preserve it', () => {
    const safe = currentAppearance();
    const current: BookSurpriseCurrent = {
      ...safe,
      binding: 'velvet-missal',
      style: {
        ...safe.style,
        raisedBands: 5,
        ornament: 4,
        coverMedallion: 7,
        coverFrame: 38,
        titlePlate: 'paper-slip',
        edge: 'tea-stained',
        charm: 'pressed-flower',
        cornerProtectors: true,
        insetPlate: true,
      },
    };
    const all = [...BOOK_SURPRISE_LOCK_IDS];
    const recipe = surpriseBookRecipe({
      direction: 'quiet',
      seed: 0xfe110,
      current,
      locks: all,
    });
    expect(recipe.preset).toBe(FORMAL_BOOK_PRESET_ID);
    expect(ROLLABLE_SHAPES).toContain(recipe.components.shape);
    expect(ROLLABLE_MATERIALS).toContain(recipe.components.material);
    expect(recipe.style.raisedBands).toBeLessThanOrEqual(Math.min(2, MAX_RAISED_BANDS));
    expect(ACTIVE_HEAD_TAIL_STYLES).toContain(recipe.style.headTailStyle);
    expect(ACTIVE_COVER_FRAME_INDICES).toContain(recipe.style.coverFrame);
    expect(ACTIVE_TITLE_PLATES).toContain(recipe.style.titlePlate);
    expect(ACTIVE_EDGE_TREATMENTS).toContain(recipe.style.edge);
    expect(recipe.style.ornament).not.toBe(4);
    expect(ACTIVE_ORNAMENT_INDICES).toContain(recipe.style.ornament);
    expect(recipe.style.coverMedallion).toBe(recipe.style.ornament);
    expect(recipe.style.charm).toBe('none');
    expect(recipe.style.cornerProtectors).toBe(false);
    expect(recipe.style.insetPlate).toBe(false);
  });
});
