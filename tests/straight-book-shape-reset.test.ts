import { describe, expect, it } from 'vitest';

import {
  BOOK_PRESETS,
  BOOK_PRESET_IDS,
  BOOK_SURPRISE_DIRECTIONS,
  FORMAL_BOOK_PRESET_ID,
  RETIRED_SPINE_SHAPES,
  ROLLABLE_PRESETS,
  ROLLABLE_SHAPES,
  bookPreset,
  normaliseBookPresetId,
  parseOwnBinding,
  shapeSpec,
} from '../src/art/bookDesign';

describe('straight book silhouette reset', () => {
  it('offers only straight-backed, square-ended book constructions', () => {
    expect(ROLLABLE_SHAPES).toEqual(['square', 'tight-back', 'double-hinge']);
    expect(RETIRED_SPINE_SHAPES).toContain('rounded');
    expect(RETIRED_SPINE_SHAPES).toContain('round-cap');

    const active = new Set(ROLLABLE_SHAPES);
    for (const preset of BOOK_PRESETS) {
      expect(active.has(preset.shape), `${preset.id}:${preset.shape}`).toBe(true);
    }
    for (const preset of ROLLABLE_PRESETS) {
      expect(active.has(preset.shape), `Surprise ${preset.id}:${preset.shape}`).toBe(true);
    }
  });

  it('keeps every authored Surprise direction on the same safe shape domain', () => {
    const active = new Set(ROLLABLE_SHAPES);
    const offered = new Set(BOOK_PRESET_IDS);

    for (const direction of BOOK_SURPRISE_DIRECTIONS) {
      for (const id of direction.presetIds) {
        expect(offered.has(id), `${direction.id}:${id} remains offered`).toBe(true);
        expect(active.has(bookPreset(id).shape), `${direction.id}:${id}`).toBe(true);
      }
    }
  });

  it('normalises old composed rounded bindings while retaining archival diagnostics', () => {
    const oldOwn = 'own:rounded/smooth-cloth/plain/blind';
    expect(parseOwnBinding(oldOwn)).toBeNull();
    expect(normaliseBookPresetId(oldOwn)).toBe(FORMAL_BOOK_PRESET_ID);

    // The archived drawing still exists so migrations can identify its source,
    // but no accepted stored/picker id can ask the live product to use it.
    expect(shapeSpec('rounded').id).toBe('rounded');
    for (const compatibilityId of [
      'brocade-anthology',
      'lattice-cabinet',
      'parchment-cartulary',
    ]) {
      expect(ROLLABLE_SHAPES).toContain(bookPreset(compatibilityId).shape);
    }
  });
});
