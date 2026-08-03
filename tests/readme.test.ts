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
import { SOUND_NAMES, SOUNDSCAPE_LOOPS } from '../src/sound/engine';
import { ROOM_PRESETS } from '../src/views/rail/designOptions';
import { RIBBON_PRESETS } from '../src/views/bookmarks';
import {
  COVER_FRAME_COUNT,
  COVER_MEDALLION_COUNT,
  COVER_PALETTE_COUNT,
} from '../src/art/covers';
import { SLASH_COMMANDS } from '../src/editor/slash/registry';
import { STICKER_IDS } from '../src/editor/nodes/stickers';
import { EFFECT_AXES } from '../src/editor/effects/vocabulary';
import { BLOCK_EFFECT_TYPES } from '../src/editor/effects/blockEffects';
import {
  CONTAINER_ALIASES,
  CONTAINER_NAMES,
  DIAGRAM_LANGS,
  KNOWN_ATTR_KEYS,
} from '../src/script/vocab';
import { DEFAULT_SETTINGS } from '../src/data/defaults';
import { SHORTCUT_ACTIONS, LISTED_ACTION_IDS } from '../src/data/keybindings';
import { NOTEBOOK_TEMPLATES } from '../src/features/templates/templates';
import { DEFAULT_FLOOR_COUNT, MAX_FLOOR_COUNT } from '../src/data/bookcases';
import { PACK_CATEGORIES, UNSUPPORTED_CATEGORIES } from '../src/features/packs/categories';
import { tourSteps } from '../src/features/tutorial/steps';

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
    // Beds, not rows: SOUNDSCAPE_NAMES ends in 'none', which is silence.
    ambienceBeds: Object.keys(SOUNDSCAPE_LOOPS).length,
    roomPresets: ROOM_PRESETS.length,
    ribbonPresets: RIBBON_PRESETS.length,
    coverPigments: COVER_PALETTE_COUNT,
    coverFrames: COVER_FRAME_COUNT,
    coverMedallions: COVER_MEDALLION_COUNT,
    slashCommands: SLASH_COMMANDS.length,
    stickers: STICKER_IDS.length,
    effectAxes: EFFECT_AXES.length,
    effectValues: EFFECT_AXES.reduce((sum, axis) => sum + axis.values.length, 0),
    // Node types the BlockEffects global-attribute extension attaches to —
    // i.e. how many kinds of block a reader can decorate.
    blockEffectTypes: BLOCK_EFFECT_TYPES.length,
    scriptContainers: CONTAINER_NAMES.length,
    scriptContainerAliases: Object.keys(CONTAINER_ALIASES).length,
    scriptAttrKeys: KNOWN_ATTR_KEYS.length,
    scriptDiagrams: DIAGRAM_LANGS.length,
    settingsOptions: Object.keys(DEFAULT_SETTINGS).length,
    // What the settings sheet lets you actually move: listed rows, minus the
    // ones that say out loud that they are fixed.
    rebindableKeys: SHORTCUT_ACTIONS.filter(
      (action) => action.kind === 'binding' && LISTED_ACTION_IDS.includes(action.id),
    ).length,
    templates: NOTEBOOK_TEMPLATES.length,
    defaultFloors: DEFAULT_FLOOR_COUNT,
    maxFloors: MAX_FLOOR_COUNT,
    packCategories: PACK_CATEGORIES.length,
    packRefusals: UNSUPPORTED_CATEGORIES.length,
    tourSteps: tourSteps('full').length,
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
