import { describe, expect, it } from 'vitest';

import {
  AUTHORED_SPINE_PROGRAM_IDS,
  BOOK_PRESETS,
  BOOK_SURPRISE_DIRECTIONS,
  DECORS,
  FOCAL_TOOL_DECORATIONS,
  FORMAL_BOOK_PRESET_ID,
  MATERIALS,
  MATERIAL_LOOK_FOR_BINDING,
  RETIRED_BOOK_PRESET_IDS,
  ROLLABLE_DECORATIONS,
  ROLLABLE_MATERIALS,
  ROLLABLE_SHAPES,
  bookPreset,
  bookPresetHasAuthoredFocal,
  cordStations,
  normaliseBookPresetId,
  parseOwnBinding,
  resolveBookDesign,
} from '../src/art/bookDesign';

const RESET_MATERIALS = [
  'smooth-cloth',
  'buckram',
  'linen',
  'felt',
  'velvet',
  'polished-calf',
  'morocco-grain',
  'russia-calf',
  'roan',
  'oilcloth',
  'vellum',
  'parchment',
  'alum-tawed',
  'paper-wrapper',
  'half-bound',
  'quarter-bound',
  'three-quarter',
  'half-cloth-paper',
] as const;

describe('book-apocalypse binding vocabulary', () => {
  it('has one explicit straight-backed authority for every independent axis', () => {
    expect(ROLLABLE_SHAPES).toEqual(['square', 'tight-back', 'double-hinge']);
    expect(ROLLABLE_MATERIALS).toEqual(RESET_MATERIALS);
    expect(AUTHORED_SPINE_PROGRAM_IDS).toHaveLength(58);
    expect(ROLLABLE_DECORATIONS).toEqual([
      'plain',
      ...AUTHORED_SPINE_PROGRAM_IDS,
    ]);
  });

  it('uses only connected construction and broad one-off tools', () => {
    const allowedArchetypes = new Set([
      'terminal',
      'publisher-panel',
      'corded-leather',
      'ceremonial-crown',
      'diagonal-botanical',
      'laureate',
      'structural-sewing',
    ]);
    const recipes = new Set<string>();

    for (const id of ROLLABLE_DECORATIONS) {
      const spec = DECORS[id];
      for (const part of DECORS[id].parts) {
        expect(part.k, `${id}:${part.k}`).toBe('binding');
        if (part.k === 'binding') {
          expect(allowedArchetypes.has(part.archetype), id).toBe(true);
          expect(part.variant, id).toBeGreaterThanOrEqual(0);
          if (part.glyph !== undefined) {
            expect([
              'crown', 'palmette', 'sprig', 'laurel', 'shield', 'fleuron',
              'rosette', 'fleur-de-lis', 'starflower', 'acanthus', 'sunrise',
              'oak-spray', 'thistle', 'ivy-knot', 'oak-volutes',
              'wheat-saltire', 'pomegranate', 'tulip', 'fern-palmette', 'ginkgo',
            ]).toContain(part.glyph);
          }
        }
      }
      if (id !== 'plain') {
        const signature = JSON.stringify({ parts: spec.parts, blind: spec.blind });
        expect(recipes.has(signature), id).toBe(false);
        recipes.add(signature);
      }
    }

    for (const retired of [
      'dotted-rule',
      'beaded-band',
      'label-plate',
      'banner-plaque',
      'pin-studs',
      'bosses',
      'fleur-seme',
      'bee-diaper',
      'wax-seal',
      'ribbon-marker',
      'double-frame',
      'blind-stamped-frame',
      'corner-tooling',
      'head-ornament',
      'foot-ornament',
      'oxford-double-fillet',
      'cambridge-blind-compartments',
      'printers-fleuron-terminals',
      'laurel-centrepiece',
      'crown-fillet',
      'heraldic-lozenge',
      'botanical-centre-sprig',
      'prize-laurel-terminal',
      'palmette-compartment',
      'abbey-blind-rules',
      'scholar-double-rule',
      'folio-compartments',
      'ducal-corners',
      'royal-compartments',
      'architects-fillet',
      'binder-terminal-pair',
      'library-fillet',
      'botanical-corner-fillet',
    ]) {
      expect(ROLLABLE_DECORATIONS).not.toContain(retired);
    }

    // Structural presets do not acquire a pictogram merely to inflate the
    // focal count. Twenty-eight named programmes deliberately spend the one
    // broad-tool budget; the rest derive identity from binding architecture.
    expect(FOCAL_TOOL_DECORATIONS).toHaveLength(28);
    expect(new Set(FOCAL_TOOL_DECORATIONS).size).toBe(28);
    for (const preset of BOOK_PRESETS) {
      const hasFocal = preset.decorations.some((id) =>
        DECORS[id].parts.some((part) => part.k === 'binding' && part.glyph !== undefined),
      );
      expect(bookPresetHasAuthoredFocal(preset.id), preset.id).toBe(hasFocal);
    }
  });

  it('keeps every active surface cue quiet when wear is zero', () => {
    expect(MATERIALS.buckram).toMatchObject({ grain: 'none', joints: 1 });
    expect(MATERIALS.linen).toMatchObject({ grain: 'none', joints: 1 });
    expect(MATERIALS.felt).toMatchObject({ grain: 'none', construction: 'felt-case' });
    expect(MATERIALS.velvet).toMatchObject({ grain: 'none', construction: 'velvet-case' });
    expect(MATERIALS['polished-calf']).toMatchObject({ grain: 'none', construction: 'calf-back' });
    expect(MATERIALS['morocco-grain']).toMatchObject({ grain: 'none', construction: 'morocco-back' });
    expect(MATERIALS['russia-calf']).toMatchObject({ grain: 'none', construction: 'russia-back' });
    expect(MATERIALS.parchment).toMatchObject({ grain: 'none', construction: 'parchment-fold' });
    expect(MATERIALS['alum-tawed']).toMatchObject({ grain: 'none', construction: 'alum-tawed-laced' });
    expect(MATERIALS['paper-wrapper']).toMatchObject({ grain: 'none', construction: 'wrapper-fold' });
    expect(MATERIALS['half-cloth-paper']).toMatchObject({ grain: 'none', construction: 'half-cloth' });

    for (const retired of [
      'ribbed-cloth',
      'brocade',
      'damask',
      'tips-and-bands',
      'sprinkled-calf',
      'shagreen',
      'snakeskin',
      'crocodile',
      'marbled-paper',
      'patterned-paper',
      'dutch-gilt',
      'chequer-paper',
      'newsprint',
      'boards-exposed',
    ]) {
      expect(ROLLABLE_MATERIALS).not.toContain(retired);
    }
  });

  it('maps every coarse material override onto an active exact covering', () => {
    const active = new Set<string>(ROLLABLE_MATERIALS);
    const emitted = Object.values(MATERIAL_LOOK_FOR_BINDING);
    expect(new Set(emitted).size).toBe(emitted.length);
    for (const look of emitted) expect(active.has(look), look).toBe(true);
  });

  it('offers dozens of authored books and thousands of guarded composed ids', () => {
    const shapes = new Set<string>(ROLLABLE_SHAPES);
    const materials = new Set<string>(ROLLABLE_MATERIALS);
    const decorations = new Set<string>(ROLLABLE_DECORATIONS);
    expect(BOOK_PRESETS).toHaveLength(67);
    expect(new Set(BOOK_PRESETS.map((preset) => preset.id)).size).toBe(
      BOOK_PRESETS.length,
    );

    for (const preset of BOOK_PRESETS) {
      expect(shapes.has(preset.shape), preset.id).toBe(true);
      expect(materials.has(preset.material), preset.id).toBe(true);
      expect(preset.decorations.length, preset.id).toBeLessThanOrEqual(1);
      for (const decoration of preset.decorations) {
        expect(decorations.has(decoration), `${preset.id}:${decoration}`).toBe(true);
      }
    }

    const acceptedComposedIds =
      ROLLABLE_SHAPES.length *
      ROLLABLE_MATERIALS.length *
      (ROLLABLE_DECORATIONS.length + 1) *
      2;
    expect(acceptedComposedIds).toBeGreaterThanOrEqual(1_700);
  });

  it('caps manual raised cords at three and suppresses a second horizontal ladder', () => {
    const ruled = resolveBookDesign({ seed: 1, preset: 'gilt-quarto', bands: 99 });
    expect(ruled.bands).toBe(3);
    expect(ruled.decorations).toEqual(['plain']);
    expect(cordStations(99)).toHaveLength(3);

    const vertical = resolveBookDesign({ seed: 1, preset: 'cambridge-cloth', bands: 3 });
    expect(vertical.bands).toBe(3);
    expect(vertical.decorations).toEqual(['plain']);

    // Welcome's crown sits above the two authored cords and has no transverse
    // division of its own, so the resolver preserves that one focal programme.
    const grand = resolveBookDesign({ seed: 1, preset: 'velvet-ducal', bands: 2 });
    expect(grand.decorations).toEqual(['grand-crown-compartments']);
    expect(bookPresetHasAuthoredFocal(grand.preset)).toBe(true);
  });

  it('keeps every authored Surprise roster active, unique and broad', () => {
    const active = new Set(BOOK_PRESETS.map((preset) => preset.id));
    const reachable = new Set<string>();
    for (const direction of BOOK_SURPRISE_DIRECTIONS) {
      expect(direction.presetIds.length, direction.id).toBeGreaterThanOrEqual(10);
      expect(new Set(direction.presetIds).size, direction.id).toBe(
        direction.presetIds.length,
      );
      for (const id of direction.presetIds) {
        expect(active.has(id), `${direction.id}:${id}`).toBe(true);
        reachable.add(id);
      }
    }
    expect(reachable).toEqual(active);
  });

  it('force-normalises every retired named or composed appearance', () => {
    for (const retired of [
      'brocade-anthology',
      'lattice-cabinet',
      'parchment-cartulary',
      'scroll-case',
      'scholar-cloth',
      'formal-felt',
      'felt-fleuron',
      'felt-library',
      'heraldic-calf',
      'oilcloth-architect',
      'tips-and-bands',
      'half-heraldic',
      'tips-heraldic',
      'tips-corners',
      'tips-fillet',
    ]) {
      expect(RETIRED_BOOK_PRESET_IDS).toContain(retired);
      expect(normaliseBookPresetId(retired)).toBe(FORMAL_BOOK_PRESET_ID);
      expect(bookPreset(retired).id).toBe(FORMAL_BOOK_PRESET_ID);
    }

    for (const retiredOwn of [
      'own:rounded/smooth-cloth/plain/blind',
      'own:square/brocade/plain/gilt',
      'own:square/smooth-cloth/dotted-rule/gilt',
    ]) {
      expect(parseOwnBinding(retiredOwn)).toBeNull();
      expect(normaliseBookPresetId(retiredOwn)).toBe(FORMAL_BOOK_PRESET_ID);
      expect(bookPreset(retiredOwn).id).toBe(FORMAL_BOOK_PRESET_ID);
    }
  });
});
