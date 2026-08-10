import { describe, expect, it } from 'vitest';

import {
  AUTHORED_SPINE_PROGRAM_IDS,
  BOOK_PRESET_IDS,
  BOOK_PRESETS,
  BOOK_SURPRISE_DIRECTIONS,
  COMPOSER_SAFE_DECORATIONS,
  CURATED_RETIRED_BOOK_PRESET_IDS,
  DECORS,
  FOCAL_TOOL_DECORATIONS,
  FORMAL_BOOK_PRESET_ID,
  MATERIALS,
  RETIRED_BOOK_PRESET_IDS,
  SPINE_TEXT_FURNITURE_IDS,
  ROLLABLE_DECORATIONS,
  ROLLABLE_MATERIALS,
  ROLLABLE_SHAPES,
  bookPreset,
  bookPresetHasAuthoredFocal,
  bookPresetWantsCoverTitle,
  bookSurfaceColoursAt,
  resolveBookDesign,
  shapeSpec,
} from '../src/art/bookDesign';

const FINAL_MATERIALS = [
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

const WALLPAPER_GRAINS = new Set([
  'fleck', 'figured', 'damask', 'sprinkle', 'pinDot', 'shellSpots',
  'lozenges', 'sprigs', 'floret', 'giltDots', 'chequer',
]);

describe('curated active book vocabulary', () => {
  it('removes the non-booklike soft/fastened silhouettes from new choices', () => {
    for (const shape of [
      'limp', 'creased', 'long-stitch', 'clasped', 'hollow-back',
      'cushioned', 'ledger', 'chamfered',
    ]) {
      expect(ROLLABLE_SHAPES).not.toContain(shape);
    }
    expect(ROLLABLE_SHAPES).toEqual([
      'square',
      'tight-back',
      'double-hinge',
    ]);
    for (const retired of ['rounded', 'library-shoulder', 'round-cap', 'ribbed']) {
      expect(ROLLABLE_SHAPES).not.toContain(retired);
      expect(shapeSpec(retired)).toBeDefined();
    }
  });

  it('pins the 18 construction-led materials and excludes wallpaper fields', () => {
    expect(ROLLABLE_MATERIALS).toEqual(FINAL_MATERIALS);
    for (const material of ROLLABLE_MATERIALS) {
      expect(material, material).not.toMatch(/moire|marble|pattern|print|damask|sprig|stripe/i);
      expect(WALLPAPER_GRAINS.has(MATERIALS[material].grain), material).toBe(false);
    }
  });

  it('pins 58 one-to-one authored programmes into seven premium physical families', () => {
    expect(AUTHORED_SPINE_PROGRAM_IDS).toHaveLength(58);
    expect(ROLLABLE_DECORATIONS).toEqual(['plain', ...AUTHORED_SPINE_PROGRAM_IDS]);
    expect(COMPOSER_SAFE_DECORATIONS).toEqual(ROLLABLE_DECORATIONS);
    expect(FOCAL_TOOL_DECORATIONS).toHaveLength(28);
    const archetypes = new Set<string>();
    const signatures = new Set<string>();
    for (const decoration of ROLLABLE_DECORATIONS) {
      const kinds = DECORS[decoration].parts.map((part) => part.k);
      expect(
        decoration === 'plain' ? kinds.length === 0 : kinds.length === 1 && kinds[0] === 'binding',
        decoration,
      ).toBe(true);
      for (const part of DECORS[decoration].parts) {
        if (part.k === 'binding') archetypes.add(part.archetype);
      }
      for (const retiredKind of [
        'run', 'frame', 'plate', 'stamp', 'seme', 'trail', 'compartments',
        'bands', 'focal', 'studs', 'corners', 'band', 'ribbon',
      ]) expect(kinds, `${decoration}:${retiredKind}`).not.toContain(retiredKind);
      if (decoration !== 'plain') {
        const signature = JSON.stringify({
          parts: DECORS[decoration].parts,
          blind: DECORS[decoration].blind,
        });
        expect(signatures.has(signature), decoration).toBe(false);
        signatures.add(signature);
      }
    }
    expect(signatures.size).toBe(58);
    expect(archetypes).toEqual(new Set([
      'terminal',
      'publisher-panel',
      'corded-leather',
      'ceremonial-crown',
      'diagonal-botanical',
      'laureate',
      'structural-sewing',
    ]));
    expect(RETIRED_BOOK_PRESET_IDS).toContain('morocco-star-medallion');
    expect(bookPreset('morocco-star-medallion').id).toBe(FORMAL_BOOK_PRESET_ID);
  });

  it('offers no text-bearing spine furniture while preserving front-cover titles', () => {
    for (const furniture of SPINE_TEXT_FURNITURE_IDS) {
      expect(ROLLABLE_DECORATIONS).not.toContain(furniture);
    }
    for (const preset of BOOK_PRESETS) {
      expect(
        preset.decorations.some((decoration) => SPINE_TEXT_FURNITURE_IDS.includes(decoration)),
        preset.id,
      ).toBe(false);
    }
    expect(bookPresetWantsCoverTitle('lettered-cloth')).toBe(true);
    expect(bookPreset('lettered-cloth').decorations).not.toContain('label-plate');
  });

  it('keeps split-board construction but paints one continuous shelf spine', () => {
    expect(MATERIALS['half-bound'].split).toBe('half');
    expect(MATERIALS['quarter-bound'].split).toBe('quarter');

    for (const preset of ['half-calf', 'quarter-calf', 'half-cloth-botanical', 'three-quarter-morocco']) {
      const resolved = resolveBookDesign({ seed: 0x51e5a11, preset, cloth: 4, accent: 17 });
      expect(bookSurfaceColoursAt(resolved, 0.05)).toEqual(bookSurfaceColoursAt(resolved, 0.5));
      expect(bookSurfaceColoursAt(resolved, 0.5)).toEqual(bookSurfaceColoursAt(resolved, 0.95));
    }
  });

  it('keeps 67 authored bindings after the eleven-concept premium purge', () => {
    expect(BOOK_PRESETS).toHaveLength(67);
    expect(BOOK_PRESET_IDS).toEqual(BOOK_PRESETS.map((preset) => preset.id));
    expect(new Set(BOOK_PRESET_IDS).size).toBe(67);
    const plain = BOOK_PRESETS.filter((preset) => preset.decorations[0] === 'plain');
    const authored = BOOK_PRESETS.filter((preset) => preset.decorations[0] !== 'plain');
    expect(plain).toHaveLength(9);
    expect(authored).toHaveLength(58);
    expect(new Set(authored.map((preset) => preset.decorations[0])).size).toBe(58);
    for (const preset of BOOK_PRESETS) {
      expect(ROLLABLE_SHAPES, preset.id).toContain(preset.shape);
      expect(ROLLABLE_MATERIALS, preset.id).toContain(preset.material);
      expect(preset.decorations.length, preset.id).toBeLessThanOrEqual(1);
      const hasFocal = preset.decorations.some((decoration) =>
        DECORS[decoration].parts.some((part) => part.k === 'binding' && part.glyph !== undefined),
      );
      expect(bookPresetHasAuthoredFocal(preset.id), preset.id).toBe(hasFocal);
      for (const decoration of preset.decorations) {
        expect(ROLLABLE_DECORATIONS, `${preset.id}:${decoration}`).toContain(decoration);
      }
    }
  });

  it('preserves retired ids as explicit formal recovery, never as new choices', () => {
    for (const id of CURATED_RETIRED_BOOK_PRESET_IDS) {
      expect(RETIRED_BOOK_PRESET_IDS).toContain(id);
      expect(bookPreset(id).id).toBe(FORMAL_BOOK_PRESET_ID);
    }
  });

  it('keeps all eight Surprise pools broad, active, unique and reset-safe', () => {
    const active = new Set(BOOK_PRESETS.map((preset) => preset.id));
    expect(BOOK_SURPRISE_DIRECTIONS).toHaveLength(8);
    for (const direction of BOOK_SURPRISE_DIRECTIONS) {
      expect(direction.presetIds.length, direction.id).toBeGreaterThanOrEqual(10);
      expect(direction.presetIds.length, direction.id).toBeLessThanOrEqual(12);
      expect(new Set(direction.presetIds).size, direction.id).toBe(direction.presetIds.length);
      for (const id of direction.presetIds) {
        expect(active.has(id), `${direction.id}:${id}`).toBe(true);
        const preset = bookPreset(id);
        expect(ROLLABLE_SHAPES, `${direction.id}:${id}`).toContain(preset.shape);
        expect(ROLLABLE_MATERIALS, `${direction.id}:${id}`).toContain(preset.material);
        expect(
          preset.decorations.every((decoration) => ROLLABLE_DECORATIONS.includes(decoration)),
          `${direction.id}:${id}`,
        ).toBe(true);
        const hasFocal = preset.decorations.some((decoration) =>
          DECORS[decoration].parts.some((part) => part.k === 'binding' && part.glyph !== undefined),
        );
        expect(bookPresetHasAuthoredFocal(id), `${direction.id}:${id}`).toBe(hasFocal);
      }
    }
  });
});
