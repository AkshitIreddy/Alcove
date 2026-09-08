import { describe, expect, it } from 'vitest';
import {
  BOOK_PRESETS,
  bookPresetAuthoredFocalGlyph,
  decorationAuthoredFocalGlyph,
} from '../src/art/bookDesign';
import { bindingArtworkEmblemIndexForGlyph } from '../src/art/bookBindingArtwork';
import { resolveBookStyle } from '../src/art/bookStyle';
import { resolveSpineBinding } from '../src/art/spines';

describe('book binding focal identity', () => {
  it('uses the same emblem index on the spine and cover for every live preset', () => {
    for (const [position, preset] of BOOK_PRESETS.entries()) {
      const glyphs = preset.decorations
        .map(decorationAuthoredFocalGlyph)
        .filter((glyph): glyph is NonNullable<typeof glyph> => glyph !== null);
      expect(glyphs.length, `${preset.id}: one authored focal at most`).toBeLessThanOrEqual(1);

      const authoredGlyph = bookPresetAuthoredFocalGlyph(preset.id);
      expect(authoredGlyph, `${preset.id}: preset semantic follows its decoration`).toBe(
        glyphs[0] ?? null,
      );

      const resolved = resolveBookStyle(
        (0x9e3700 + Math.imul(position + 1, 7919)) >>> 0,
        undefined,
        undefined,
        { binding: preset.id },
      );
      const appliedSpine = { ...resolved.spine, binding: preset.id };
      const spineDesign = resolveSpineBinding(appliedSpine);
      expect(spineDesign.preset, `${preset.id}: production spine binding`).toBe(preset.id);
      const resolvedSpineGlyphs = spineDesign.decorations
        .map(decorationAuthoredFocalGlyph)
        .filter((glyph): glyph is NonNullable<typeof glyph> => glyph !== null);
      expect(resolvedSpineGlyphs, `${preset.id}: resolved spine semantics`).toEqual(glyphs);

      const spineEmblem = resolvedSpineGlyphs.length === 0
        ? (resolved.spine.ornamentOn ? resolved.spine.ornament : -1)
        : (bindingArtworkEmblemIndexForGlyph(resolvedSpineGlyphs[0]) ?? -1);

      expect(spineEmblem, `${preset.id}: spine and cover emblem`).toBe(
        resolved.cover.medallion,
      );
    }
  });
});
