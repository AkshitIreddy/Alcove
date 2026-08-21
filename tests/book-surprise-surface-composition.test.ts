import { describe, expect, it } from 'vitest';

import {
  BOOK_PRESET_IDS,
  BOOK_SURPRISE_DIRECTIONS,
  MATERIALS,
  ROLLABLE_DECORATIONS,
  ROLLABLE_MATERIALS,
  ROLLABLE_SHAPES,
  bookPreset,
  bookPresetHasAuthoredFocal,
} from '../src/art/bookDesign';
import {
  BOOK_SURPRISE_EMBLEM_INDICES,
  bookPresetAllowedForAutomaticSurprise,
  bookSurpriseMaterialSurfaceComplexity,
  inspectBookSurpriseSurfaceComposition,
  surpriseBookRecipe,
} from '../src/art/bookSurprise';
import {
  ACTIVE_COVER_FRAME_INDICES,
  FRAME_LABELS,
} from '../src/art/covers';
import {
  ACTIVE_EDGE_TREATMENTS,
  ACTIVE_HEAD_TAIL_STYLES,
  ACTIVE_ORNAMENT_INDICES,
  ACTIVE_TITLE_PLATES,
  MAX_RAISED_BANDS,
} from '../src/art/spines';

function sweepSeed(directionIndex: number, seedIndex: number): number {
  return (
    0x6e57_4d21 ^
    Math.imul(directionIndex + 3, 0x9e37_79b1) ^
    Math.imul(seedIndex + 29, 0x85eb_ca6b)
  ) >>> 0;
}

describe('Surprise surface composition', () => {
  it('spends the automatic decoration budget on one focal programme', () => {
    const retiredEmblems = new Set([3, 6, 17, 19, 27, 38, 57]);
    for (let directionIndex = 0; directionIndex < BOOK_SURPRISE_DIRECTIONS.length; directionIndex += 1) {
      const direction = BOOK_SURPRISE_DIRECTIONS[directionIndex]!;
      const reached = new Set<string>();
      const programmeCounts = new Map<string, number>();
      for (let seedIndex = 0; seedIndex < 96; seedIndex += 1) {
        const recipe = surpriseBookRecipe({
          direction: direction.id,
          seed: sweepSeed(directionIndex, seedIndex),
        });
        const preset = bookPreset(recipe.preset);
        const audit = inspectBookSurpriseSurfaceComposition(recipe);
        const at = `${direction.id}:${seedIndex}:${recipe.preset}`;

        expect(BOOK_PRESET_IDS, at).toContain(recipe.preset);
        expect(direction.presetIds, at).toContain(recipe.preset);
        expect(ROLLABLE_SHAPES, at).toContain(preset.shape);
        expect(ROLLABLE_MATERIALS, at).toContain(preset.material);
        for (const decoration of preset.decorations) {
          expect(ROLLABLE_DECORATIONS, `${at}:${decoration}`).toContain(decoration);
        }
        expect(bookPresetAllowedForAutomaticSurprise(preset), at).toBe(true);
        expect(audit.programmes.length, `${at}:${audit.programmes.join('+')}`).toBeLessThanOrEqual(1);
        if (direction.id === 'quiet') {
          expect(audit.programmes, at).not.toContain('matched-emblem');
        } else {
          expect(audit.programmes, at).toHaveLength(1);
          expect(
            ['authored-surface', 'matched-emblem', 'architectural-frame'],
            `${at}:${audit.programmes.join('+')}`,
          ).toContain(audit.programmes[0]);
          const focal = audit.programmes[0] ?? 'missing';
          reached.add(focal);
          programmeCounts.set(focal, (programmeCounts.get(focal) ?? 0) + 1);
        }
        expect(audit.repeatedField, at).toBe(false);
        expect(recipe.style.charm, at).toBe('none');
        expect(recipe.style.cornerProtectors, at).toBe(false);
        expect(recipe.style.insetPlate, at).toBe(false);
        expect(recipe.style.raisedBands ?? 0, at).toBeLessThanOrEqual(
          Math.min(2, MAX_RAISED_BANDS),
        );
        expect(ACTIVE_HEAD_TAIL_STYLES, at).toContain(recipe.style.headTailStyle);
        expect(ACTIVE_COVER_FRAME_INDICES, at).toContain(recipe.style.coverFrame);
        expect(ACTIVE_TITLE_PLATES, at).toContain(recipe.style.titlePlate);
        const materialGroup = MATERIALS[preset.material].group;
        if ([
          'morocco-single-rule', 'morocco-double-rule', 'morocco-clipped-rule',
          'calf-blind-label', 'two-tone-leather-label',
        ].includes(recipe.style.titlePlate)) {
          expect(['leather', 'split'], `${at}:${recipe.style.titlePlate}`).toContain(materialGroup);
        }
        if ([
          'dyed-leather-crossband', 'gilt-ruled-crossband', 'split-leather-crossband',
        ].includes(recipe.style.titlePlate)) {
          expect(['leather', 'cloth', 'split'], at).toContain(materialGroup);
        }
        if ([
          'laid-paper-ticket', 'deckled-paper-ticket', 'vellum-rule-ticket', 'parchment-slip',
        ].includes(recipe.style.titlePlate)) {
          expect(['vellum', 'paper', 'split'], at).toContain(materialGroup);
        }
        expect(ACTIVE_EDGE_TREATMENTS, at).toContain(recipe.style.edge);

        const ornament = recipe.style.ornament ?? -1;
        const medallion = recipe.style.coverMedallion ?? -1;
        expect(ornament >= 0, at).toBe(medallion >= 0);
        if (ornament >= 0) {
          expect(ACTIVE_ORNAMENT_INDICES, at).toContain(ornament);
          expect(BOOK_SURPRISE_EMBLEM_INDICES, at).toContain(ornament);
          expect(retiredEmblems.has(ornament), `${at}:retired emblem ${ornament}`).toBe(false);
          expect(medallion, at).toBe(ornament);
        }
        if (bookPresetHasAuthoredFocal(recipe.preset)) {
          expect(audit.programmes, at).toEqual(['authored-surface']);
        }

        const frameLabel = FRAME_LABELS[recipe.style.coverFrame ?? 0] ?? '';
        expect(frameLabel, `${at}:${frameLabel}`).not.toMatch(/dots?|rings?|studded|side /i);
      }

      if (direction.id !== 'quiet') {
        const summary = JSON.stringify(Object.fromEntries(programmeCounts));
        expect(reached.size, `${direction.id}:focal reachability:${summary}`).toBeGreaterThan(0);
      }
    }
  }, 90_000);

  it('reaches frames and matched emblems on every direction with a smooth open binding', () => {
    for (let directionIndex = 0; directionIndex < BOOK_SURPRISE_DIRECTIONS.length; directionIndex += 1) {
      const direction = BOOK_SURPRISE_DIRECTIONS[directionIndex]!;
      if (direction.id === 'quiet') continue;
      const openPreset = direction.presetIds
        .map((id) => bookPreset(id))
        .find((preset) =>
          !bookPresetHasAuthoredFocal(preset.id)
          && bookPresetAllowedForAutomaticSurprise(preset)
          && bookSurpriseMaterialSurfaceComplexity(preset) < 0.42);
      // A direction whose upgraded bindings all contain their own focal art
      // must preserve that art rather than stack a generated programme.
      if (openPreset === undefined) {
        expect(
          direction.presetIds.every((id) => bookPresetHasAuthoredFocal(id)),
          `${direction.id}:no open binding and not wholly authored`,
        ).toBe(true);
        continue;
      }

      const reached = new Set<string>();
      for (let seedIndex = 0; seedIndex < 64; seedIndex += 1) {
        const recipe = surpriseBookRecipe({
          direction: direction.id,
          seed: sweepSeed(directionIndex, seedIndex + 0x180),
          guard: (preset) => preset.id === openPreset.id,
        });
        const audit = inspectBookSurpriseSurfaceComposition(recipe);
        expect(recipe.preset, `${direction.id}:${seedIndex}`).toBe(openPreset.id);
        expect(
          audit.programmes,
          `${direction.id}:${seedIndex}:${JSON.stringify(recipe.style)}:${JSON.stringify(audit)}`,
        ).toHaveLength(1);
        reached.add(audit.programmes[0] ?? 'missing');
      }
      expect([...reached], `${direction.id}:${openPreset.id}:frame`).toContain('architectural-frame');
      expect([...reached], `${direction.id}:${openPreset.id}:emblem`).toContain('matched-emblem');
    }
  }, 60_000);

  it('is byte-deterministic for every direction after focal composition', () => {
    for (let directionIndex = 0; directionIndex < BOOK_SURPRISE_DIRECTIONS.length; directionIndex += 1) {
      const direction = BOOK_SURPRISE_DIRECTIONS[directionIndex]!;
      const request = {
        direction: direction.id,
        seed: sweepSeed(directionIndex, 0x5a),
      } as const;
      expect(surpriseBookRecipe(request), direction.id).toEqual(surpriseBookRecipe(request));
    }
  }, 30_000);

  it('keeps every named direction reachable through its direct and Anything paths', () => {
    const anything = new Set<string>();
    for (const direction of BOOK_SURPRISE_DIRECTIONS) {
      const direct = surpriseBookRecipe({ direction: direction.id, seed: 0x51e5_a11 });
      expect(direct.direction).toBe(direction.id);
    }
    for (let seedIndex = 0; seedIndex < 1_024; seedIndex += 1) {
      // Direction selection precedes candidate search. The positional seam
      // exercises the same Anything draw with one treatment instead of
      // redundantly scoring ~70 candidates for each reachability sample.
      anything.add(surpriseBookRecipe(null, seedIndex * 0x9e37 + 17).direction);
    }
    expect([...anything].sort()).toEqual(
      BOOK_SURPRISE_DIRECTIONS.map((direction) => direction.id).sort(),
    );
  }, 60_000);
});
