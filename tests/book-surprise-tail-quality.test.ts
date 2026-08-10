import { describe, expect, it } from 'vitest';

import {
  BOOK_PRESET_IDS,
  BOOK_SURPRISE_DIRECTIONS,
  ROLLABLE_DECORATIONS,
  ROLLABLE_MATERIALS,
  ROLLABLE_SHAPES,
  bookPreset,
} from '../src/art/bookDesign';
import {
  BOOK_SURPRISE_ARCHETYPES,
  BOOK_SURPRISE_EMBLEM_INDICES,
  BOOK_SURPRISE_SPINE_RATIO_FLOORS,
  BOOK_SURPRISE_SPINE_WIDTH_FLOORS,
  bookPresetAllowedForAutomaticSurprise,
  inspectBookSurpriseRecipe,
  inspectBookSurpriseSearch,
  inspectBookSurpriseSurfaceComposition,
  surpriseBookRecipe,
} from '../src/art/bookSurprise';
import { ACTIVE_COVER_FRAME_INDICES } from '../src/art/covers';
import {
  ACTIVE_EDGE_TREATMENTS,
  ACTIVE_HEAD_TAIL_STYLES,
  ACTIVE_ORNAMENT_INDICES,
  ACTIVE_TITLE_PLATES,
  MAX_RAISED_BANDS,
} from '../src/art/spines';

function sweepSeed(directionIndex: number, seedIndex: number): number {
  return (
    0x51e5_a11 ^
    Math.imul(directionIndex + 1, 0x9e37_79b1) ^
    Math.imul(seedIndex + 17, 0x85eb_ca6b)
  ) >>> 0;
}

describe('Surprise bad-tail quality', () => {
  it('pins the native-scale automatic emblem subset to the paired premium tools', () => {
    expect(ACTIVE_EDGE_TREATMENTS).toEqual([
      'plain', 'gilt', 'stained-red', 'sepia-edge', 'deckle', 'red-under-gold',
    ]);
    expect(BOOK_SURPRISE_EMBLEM_INDICES).toEqual([
      0, 1, 2, 5, 12, 13, 14, 20,
      23, 26, 28, 29, 30, 31, 43, 56,
    ]);
    for (const ornament of BOOK_SURPRISE_EMBLEM_INDICES) {
      expect(ACTIVE_ORNAMENT_INDICES).toContain(ornament);
    }
    for (const retired of [3, 6, 17, 19, 27, 38, 57]) {
      expect(ACTIVE_ORNAMENT_INDICES).not.toContain(retired);
      expect(BOOK_SURPRISE_EMBLEM_INDICES).not.toContain(retired);
    }
  });

  it('rebuilds each final direction as one active whole-book programme', () => {
    const active = new Set(BOOK_PRESET_IDS);
    expect(BOOK_SURPRISE_ARCHETYPES).toHaveLength(BOOK_SURPRISE_DIRECTIONS.length);

    for (const direction of BOOK_SURPRISE_DIRECTIONS) {
      const programmes = BOOK_SURPRISE_ARCHETYPES.filter(
        (archetype) => archetype.direction === direction.id,
      );
      expect(programmes, direction.id).toHaveLength(1);
      expect(programmes[0]?.id).toBe(`${direction.id}-binding-programme`);
      expect(programmes[0]?.presetIds).toEqual(direction.presetIds);
      for (const id of direction.presetIds) {
        expect(active.has(id), `${direction.id}:${id}`).toBe(true);
      }
    }
  });

  it('gives every final direction binding six legal authored treatments', () => {
    for (let directionIndex = 0; directionIndex < BOOK_SURPRISE_DIRECTIONS.length; directionIndex += 1) {
      const direction = BOOK_SURPRISE_DIRECTIONS[directionIndex]!;
      const audit = inspectBookSurpriseSearch({
        direction: direction.id,
        seed: sweepSeed(directionIndex, 0x51),
      });

      expect(audit.candidatesEvaluated, direction.id).toBe(direction.presetIds.length * 6);
      expect(audit.presets.map((preset) => preset.preset).sort(), direction.id)
        .toEqual([...direction.presetIds].sort());
      for (const preset of audit.presets) {
        const at = `${direction.id}:${preset.preset}`;
        expect(preset.archetype, at).toBe(`${direction.id}-binding-programme`);
        expect(preset.treatmentsEvaluated, at).toBe(6);
        expect(
          preset.legalTreatments,
          `${at} [${preset.violationMessages.join('; ')}]`,
        ).toBe(6);
        expect(preset.structurallyEligible, at).toBe(true);
        expect(preset.minimumScore, at).toBeGreaterThanOrEqual(82);
      }
    }
  }, 60_000);

  it('keeps the selected tail active, book-like and limited to one focal programme', () => {
    const failures: string[] = [];
    const record = (condition: boolean, message: string): void => {
      if (!condition && failures.length < 80) failures.push(message);
    };

    for (let directionIndex = 0; directionIndex < BOOK_SURPRISE_DIRECTIONS.length; directionIndex += 1) {
      const direction = BOOK_SURPRISE_DIRECTIONS[directionIndex]!;
      const seenPresets = new Set<string>();
      const signatures = new Set<string>();
      let emblemCount = 0;
      let authoredCount = 0;

      for (let seedIndex = 0; seedIndex < 40; seedIndex += 1) {
        const recipe = surpriseBookRecipe({
          direction: direction.id,
          seed: sweepSeed(directionIndex, seedIndex),
        });
        const preset = bookPreset(recipe.preset);
        const audit = inspectBookSurpriseSurfaceComposition(recipe);
        const at = `${direction.id}:${seedIndex}:${recipe.preset}`;
        const height = recipe.style.height ?? 1;
        const thickness = recipe.style.thickness ?? 0;

        record(direction.presetIds.includes(recipe.preset), `${at} escaped its final roster`);
        record(bookPresetAllowedForAutomaticSurprise(preset), `${at} selected a wallpaper field`);
        record(ROLLABLE_SHAPES.includes(preset.shape), `${at} selected retired shape ${preset.shape}`);
        record(ROLLABLE_MATERIALS.includes(preset.material), `${at} selected retired material ${preset.material}`);
        record(
          preset.decorations.every((mark) => ROLLABLE_DECORATIONS.includes(mark)),
          `${at} selected retired decoration ${preset.decorations.join('+')}`,
        );
        record(recipe.constraintViolations === 0, `${at} has ${recipe.constraintViolations} hard violations`);
        record(recipe.score >= 82, `${at} score ${recipe.score}`);
        record(recipe.archetype === `${direction.id}-binding-programme`, `${at} widened its grammar`);
        record(audit.programmes.length <= 1, `${at} stacked ${audit.programmes.join('+')}`);
        record(audit.repeatedField === false, `${at} emitted a repeated field`);
        record(recipe.style.charm === 'none', `${at} emitted ${recipe.style.charm}`);
        record(recipe.style.cornerProtectors !== true, `${at} emitted corner hardware`);
        record(recipe.style.insetPlate !== true, `${at} emitted an inset plate`);
        record(
          (recipe.style.raisedBands ?? 0) <= Math.min(2, MAX_RAISED_BANDS),
          `${at} emitted ${recipe.style.raisedBands} automatic bands`,
        );
        record(
          ACTIVE_HEAD_TAIL_STYLES.includes(recipe.style.headTailStyle as never),
          `${at} emitted retired endband style ${recipe.style.headTailStyle}`,
        );
        record(
          ACTIVE_COVER_FRAME_INDICES.includes(recipe.style.coverFrame as never),
          `${at} emitted retired frame ${recipe.style.coverFrame}`,
        );
        record(
          ACTIVE_TITLE_PLATES.includes(recipe.style.titlePlate as never),
          `${at} emitted retired title treatment ${recipe.style.titlePlate}`,
        );
        record(
          ACTIVE_EDGE_TREATMENTS.includes(recipe.style.edge as never),
          `${at} emitted retired edge ${recipe.style.edge}`,
        );
        const ornament = recipe.style.ornament ?? -1;
        const medallion = recipe.style.coverMedallion ?? -1;
        if (ornament >= 0) emblemCount += 1;
        if (audit.programmes.includes('authored-surface')) authoredCount += 1;
        record((ornament >= 0) === (medallion >= 0), `${at} has a one-sided emblem`);
        record(ornament < 0 || ornament === medallion, `${at} mismatched emblems ${ornament}/${medallion}`);
        record(
          ornament < 0 || (
            ACTIVE_ORNAMENT_INDICES.includes(ornament as never) &&
            BOOK_SURPRISE_EMBLEM_INDICES.includes(ornament)
          ),
          `${at} emitted retired ornament ${ornament}`,
        );
        record(
          thickness / height + 0.001 >= BOOK_SURPRISE_SPINE_RATIO_FLOORS[direction.id],
          `${at} is a hairline ${thickness}/${height}`,
        );
        record(
          thickness >= BOOK_SURPRISE_SPINE_WIDTH_FLOORS[direction.id],
          `${at} is only ${thickness}px wide`,
        );

        seenPresets.add(recipe.preset);
        signatures.add([
          recipe.preset,
          recipe.style.titlePlate,
          recipe.style.coverFrame,
          recipe.style.ornament,
          recipe.style.edge,
          recipe.style.spineBaseHex,
        ].join('|'));
      }

      record(seenPresets.size >= 4, `${direction.id} collapsed to ${seenPresets.size} presets`);
      record(signatures.size >= 28, `${direction.id} collapsed to ${signatures.size}/40 layouts`);
      if (direction.id === 'quiet') {
        record(emblemCount === 0, `${direction.id} stamped ${emblemCount}/40 restrained books`);
      } else {
        record(
          emblemCount > 0 || authoredCount === 40,
          `${direction.id} reached neither a matched emblem nor an authored focal surface`,
        );
        record(emblemCount < 40, `${direction.id} stamped every book like a repeated badge`);
      }
    }

    expect(failures).toEqual([]);
  }, 90_000);

  it('keeps all final directions reachable through Anything without preserving every legacy preset', () => {
    const missing = new Set(BOOK_SURPRISE_DIRECTIONS.map((direction) => direction.id));
    for (let seedIndex = 0; seedIndex < 512 && missing.size > 0; seedIndex += 1) {
      const recipe = surpriseBookRecipe({
        direction: null,
        seed: sweepSeed(0x2b, seedIndex + 0x400),
      });
      missing.delete(recipe.direction);
    }
    expect([...missing]).toEqual([]);
  }, 60_000);

  it('keeps the historical adversarial seeds inside the reset grammar', () => {
    const cases = [
      ['formal', 1_776_248_472],
      ['grand', 135_538_366],
      ['grand', 2_451_264_824],
      ['antique', 1_582_318_512],
      ['storybook', 3_176_092_094],
      ['storybook', 3_758_236_553],
      ['cosy', 245_011_101],
      ['rustic', 3_899_695_084],
      ['quiet', 671_125_788],
      ['quiet', 3_296_789_740],
    ] as const;

    for (const [direction, seed] of cases) {
      const recipe = surpriseBookRecipe({ direction, seed });
      const audit = inspectBookSurpriseSurfaceComposition(recipe);
      const at = `${direction}:${seed}:${recipe.preset}`;
      expect(recipe.constraintViolations, at).toBe(0);
      expect(recipe.score, at).toBeGreaterThanOrEqual(82);
      expect(recipe.archetype, at).toBe(`${direction}-binding-programme`);
      expect(audit.programmes.length, at).toBeLessThanOrEqual(1);
      expect(recipe.style.charm, at).toBe('none');
      expect(recipe.style.cornerProtectors, at).toBe(false);
      expect(recipe.style.insetPlate, at).toBe(false);
    }
  }, 30_000);

  it('keeps native-scale scratch, insect and hardware emblems out of automatic books', () => {
    const rejected = new Set([
      3, 6, 9, 17, 19, 27, 38, 57, 65,
    ]); // refuted scratch, pictogram, hardware and mismatched paired tools
    const refutedCells = [
      ['antique', 4_058_589_858],
      ['antique', 498_606_278],
      ['storybook', 3_045_068_971],
      ['cosy', 289_802_484],
    ] as const;

    for (const [direction, seed] of refutedCells) {
      const recipe = surpriseBookRecipe({ direction, seed });
      const ornament = recipe.style.ornament ?? -1;
      expect(rejected.has(ornament), `${direction}:${seed}:${ornament}`).toBe(false);
      if (ornament >= 0) {
        expect(BOOK_SURPRISE_EMBLEM_INDICES, `${direction}:${seed}`).toContain(ornament);
        expect(recipe.style.coverMedallion, `${direction}:${seed}`).toBe(ornament);
      }
    }
  });

  it('recognises a deliberately incoherent legacy book as a negative control', () => {
    const baseline = surpriseBookRecipe({ direction: 'grand', seed: 0xbad_5eed });
    const inspection = inspectBookSurpriseRecipe({
      preset: baseline.preset,
      style: {
        ...baseline.style,
        format: 'folio',
        height: 300,
        thickness: 12,
        raisedBands: 5,
        titlePlate: 'stippled-ground',
        coverFrame: 38,
        ornament: 4,
        coverMedallion: 7,
        cornerProtectors: true,
        insetPlate: true,
        charm: 'wax-seal',
      },
    }, 'grand');

    expect(inspection.constraintViolations).toBeGreaterThanOrEqual(5);
    expect(inspection.score).toBeLessThan(60);
    expect(inspection.diagnostics.some((item) => item.code === 'composition-hierarchy')).toBe(true);
    expect(inspection.diagnostics.some((item) => item.code === 'proportion')).toBe(true);
  });
});
