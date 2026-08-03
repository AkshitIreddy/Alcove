// @vitest-environment node
/**
 * tests/readme.test.ts — the README is checked, not trusted.
 *
 * The developer half of the README makes two kinds of claim a repo can drift
 * away from silently:
 *
 *  1. **Paths.** It links roughly a hundred source files by relative path,
 *     which is the whole mechanism by which it points AT the 3,841 lines of
 *     module docstring instead of copying them. A moved file turns that into
 *     a 404 and nothing else in the suite would notice.
 *  2. **Numbers.** "222 of 230 source files open with a module docstring",
 *     "126 papers", "five design docs carry a superseded banner". Every one
 *     was measured once and none is self-maintaining.
 *
 * So the numbers are not typed as prose — they are written into the markdown
 * inside an invisible marker (`<!--f:key-->126<!--/f-->`, which GitHub renders
 * as `126`) and recomputed here. `scripts/check-readme.mjs` does the file-only
 * half and can be run on its own with `npm run readme:check`; the vocabulary
 * counts need the TypeScript modules loaded, which a vitest file can simply
 * import, so this is where they are gated.
 *
 * Fixing a failure is one command: `npm run readme:facts` prints the true
 * values, and the deferred ones are printed by this file's failure message.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFERRED_FACTS,
  checkFacts,
  checkLinks,
  computeFacts,
  readmeDocs,
} from '../scripts/check-readme.mjs';

import { BUILD_IDS, PATTERN_IDS, SHELF_PRESETS } from '../src/art/shelfDesign';
import { WALLPAPER_PATTERNS, WALLPAPER_PRESETS } from '../src/art/wallpaperDesign';
import {
  BOOK_PRESETS,
  DECORATIONS,
  MATERIAL_LOOKS,
  SPINE_SHAPES,
} from '../src/art/bookDesign';
import { THEME_IDS } from '../src/art/themes';
import { CLOTHS } from '../src/art/flat';
import { SOUND_SET_IDS } from '../src/sound/soundSets';
import { SOUND_NAMES } from '../src/sound/engine';

/** The counts `scripts/check-readme.mjs` defers to this file. */
function vocabularyFacts(): Record<string, number> {
  return {
    shelfBuilds: BUILD_IDS.length,
    shelfPatterns: PATTERN_IDS.length,
    shelfPresets: SHELF_PRESETS.length,
    wallpaperMotifs: WALLPAPER_PATTERNS.length,
    wallpaperPapers: WALLPAPER_PRESETS.length,
    bookShapes: SPINE_SHAPES.length,
    bookMaterials: MATERIAL_LOOKS.length,
    bookDecorations: DECORATIONS.length,
    bookPresets: BOOK_PRESETS.length,
    roomThemes: THEME_IDS.length,
    bookCloths: CLOTHS.length,
    soundSets: SOUND_SET_IDS.length,
    soundCues: SOUND_NAMES.length,
  };
}

describe('the README describes this repo', () => {
  it('has something to check', () => {
    // A silent pass because the file moved would defeat the whole exercise.
    expect(readmeDocs().length).toBeGreaterThan(0);
  });

  it('every relative link resolves from the repo root', () => {
    const { problems } = checkLinks();
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('every marked number still matches the tree', () => {
    const facts = { ...computeFacts(), ...vocabularyFacts() };
    const { problems } = checkFacts(facts);
    const hint =
      '\n\nTrue values right now:\n' +
      Object.entries(facts)
        .map(([k, v]) => `  ${k} = ${v}`)
        .join('\n');
    expect(problems, problems.join('\n') + hint).toEqual([]);
  });

  it('the deferred key list matches what this file supplies', () => {
    // Both halves have to agree or a marker silently checks nothing: a key the
    // script defers but this file forgets is a number nobody verifies.
    expect([...DEFERRED_FACTS].sort()).toEqual(Object.keys(vocabularyFacts()).sort());
  });
});
