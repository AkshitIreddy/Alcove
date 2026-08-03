// @vitest-environment node
/**
 * tests/taste-onboarding.test.ts — the taste questionnaire.
 *
 * Four answers pick a room, a binding, a sound set and the interface's own
 * colours, and every one of those is a pointer into a vocabulary that fails
 * SILENTLY: `getWallpaper` answers an unknown paper with a bare wall,
 * `resolveShelfDesign` answers an unknown build with the plank case,
 * `takeEnum` in `data/settings.ts` answers an unknown theme with the default.
 * A resolver that quietly picked nothing would look exactly like one that
 * worked — the reader would simply get the house room and never know they had
 * been asked.
 *
 * So this file checks four things, in order of how badly each would hurt:
 *
 *   REACHES SOMETHING  every combination of answers resolves to a real preset,
 *                      a rollable binding, a real set and a theme+ink the
 *                      settings validator will actually accept.
 *   LISTENS            each axis changes the answer. An axis that scored
 *                      nothing would be a question the app asks and ignores,
 *                      which is worse than not asking.
 *   WRITES             `applyTasteWith` makes all five calls, survives any one
 *                      of them failing, and never throws on the first screen a
 *                      reader ever sees.
 *   DRAWS FLAT         `taste.css` lives beside its feature rather than in
 *                      src/styles, so `tests/styles.test.ts` does not sweep it.
 *                      The same two rules are gated here instead of the file
 *                      being quietly exempt.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  TASTE_AXES,
  TASTE_QUESTIONS,
  describeTaste,
  isTasteAnswer,
  isTasteComplete,
  mergeTasteAnswers,
  resolveBinding,
  resolveInterface,
  resolveRoom,
  resolveRoomPreset,
  resolveSoundSet,
  resolveTaste,
  tasteOutcomeKey,
  type TasteAnswers,
  type TasteAxis,
} from '../src/features/tutorial/tasteProfile';
import { applyTasteWith, type TasteSink } from '../src/features/tutorial/tasteApply';
import { mergeSettings } from '../src/data/settings';
import { ROOM_PRESETS } from '../src/views/rail/designOptions';
import { BOOK_PRESET_IDS, ROLLABLE_PRESETS } from '../src/art/bookDesign';
import { isBuildId, isPatternId } from '../src/art/shelfDesign';
import { getWallpaper } from '../src/art/wallpaperDesign';
import { isThemeId } from '../src/art/themes';
import {
  SOUND_SET_GROUPS,
  SOUND_SET_GROUP_IDS,
  isSoundSetId,
  soundSetsInGroup,
} from '../src/sound/soundSets';

/* -------------------------------------------------------------------------
   Fixtures
   ---------------------------------------------------------------------- */

const optionIds = (axis: TasteAxis): string[] => {
  const question = TASTE_QUESTIONS.find((q) => q.axis === axis);
  return question === undefined ? [] : question.options.map((o) => o.id);
};

/** Every answer combination the panel can produce. */
function everyCombination(): TasteAnswers[] {
  const out: TasteAnswers[] = [];
  for (const room of optionIds('room')) {
    for (const pitch of optionIds('pitch')) {
      for (const paper of optionIds('paper')) {
        for (const sound of optionIds('sound')) {
          out.push({ room, pitch, paper, sound } as unknown as TasteAnswers);
        }
      }
    }
  }
  return out;
}

/** The four values `data/settings.ts` maps onto a stylesheet room. */
const UI_THEMES = ['parchment', 'pastel', 'botanical', 'night'];
/** The three `settings.css` draws a `data-ink` rule for. */
const INKS = ['sepia', 'graphite', 'ink-blue'];

/* -------------------------------------------------------------------------
   1. The questions
   ---------------------------------------------------------------------- */

describe('the questions', () => {
  it('asks four, one per axis, in the order the axes are listed', () => {
    expect(TASTE_QUESTIONS.map((q) => q.axis)).toEqual([...TASTE_AXES]);
  });

  it('gives every option a distinct id, a name and a line', () => {
    for (const question of TASTE_QUESTIONS) {
      const ids = question.options.map((o) => o.id);
      expect(new Set(ids).size, question.axis).toBe(ids.length);
      for (const option of question.options) {
        expect(option.label.length, `${question.axis}/${option.id}`).toBeGreaterThan(2);
        expect(option.line.length, `${question.axis}/${option.id}`).toBeGreaterThan(10);
      }
    }
  });

  /**
   * The reader's aside — "(make it sound better)" — is the brief for the copy,
   * so it is worth a mechanical check that the two words they used as shorthand
   * never made it onto the screen as the question itself.
   */
  it('never asks the reader to describe themselves as bland or vivid', () => {
    const prose = TASTE_QUESTIONS.flatMap((q) => [
      q.title,
      q.body,
      ...q.options.flatMap((o) => [o.label, o.line]),
    ])
      .join(' ')
      .toLowerCase();
    for (const word of ['bland', 'vivid', 'boring', 'personality']) {
      expect(prose, `copy says "${word}"`).not.toContain(word);
    }
  });

  /** Long lists cap at ~20 with an "N more" control; none of these is close. */
  it('keeps every question inside one screenful', () => {
    for (const question of TASTE_QUESTIONS) {
      expect(question.options.length, question.axis).toBeLessThanOrEqual(20);
      expect(question.options.length, question.axis).toBeGreaterThanOrEqual(4);
    }
  });

  it('derives the sound question from the sound module, not a second list', () => {
    expect(optionIds('sound')).toEqual([...SOUND_SET_GROUP_IDS]);
    for (const id of SOUND_SET_GROUP_IDS) {
      const option = TASTE_QUESTIONS[3].options.find((o) => o.id === id);
      expect(option?.line).toBe(SOUND_SET_GROUPS[id].blurb);
    }
  });
});

/* -------------------------------------------------------------------------
   2. The stored blob is total
   ---------------------------------------------------------------------- */

describe('mergeTasteAnswers', () => {
  it('answers junk with nothing rather than throwing', () => {
    for (const junk of [null, undefined, 7, 'nope', [], { room: 42 }]) {
      expect(mergeTasteAnswers(junk)).toEqual({});
    }
  });

  it('drops values their own axis does not know', () => {
    expect(mergeTasteAnswers({ room: 'harbour', pitch: 'lavender' })).toEqual({
      room: 'harbour',
    });
  });

  it('keeps a full set', () => {
    const full = { room: 'toy-box', pitch: 'bright', paper: 'figured', sound: 'whimsy' };
    expect(mergeTasteAnswers(full)).toEqual(full);
    expect(isTasteComplete(mergeTasteAnswers(full))).toBe(true);
  });

  it('does not call a half-answered set complete', () => {
    expect(isTasteComplete({ room: 'harbour' } as TasteAnswers)).toBe(false);
    expect(isTasteAnswer('room', 'harbour')).toBe(true);
    expect(isTasteAnswer('room', 'sofa')).toBe(false);
  });
});

/* -------------------------------------------------------------------------
   3. Every combination reaches something real
   ---------------------------------------------------------------------- */

describe('resolveTaste reaches a real library', () => {
  const combinations = everyCombination();

  it('has a combination for every option of every axis', () => {
    expect(combinations.length).toBe(
      optionIds('room').length *
        optionIds('pitch').length *
        optionIds('paper').length *
        optionIds('sound').length,
    );
  });

  it('resolves each one into ids the vocabularies actually hold', () => {
    for (const answers of combinations) {
      const out = resolveTaste(answers);
      const where = JSON.stringify(answers);

      // The room: a real preset underneath, and every pointer resolves.
      expect(ROOM_PRESETS, where).toContain(out.room.from);
      expect(isThemeId(out.room.theme), where).toBe(true);
      expect(isBuildId(out.room.build), where).toBe(true);
      expect(isPatternId(out.room.pattern), where).toBe(true);
      // A paper name nothing knows resolves to the bare wall SILENTLY, so the
      // check is that the name round-trips to a paper carrying it.
      expect(getWallpaper(out.room.paper).id, where).toBe(out.room.paper);
      expect(out.room.wallpaper, where).toEqual(getWallpaper(out.room.paper).spec);

      // The binding: a real preset, and never an oddity.
      expect(BOOK_PRESET_IDS, where).toContain(out.binding.id);
      expect(ROLLABLE_PRESETS, where).toContain(out.binding);
      expect(out.binding.tier, where).not.toBe('oddity');

      // The sound: a real set, in the family that was asked for.
      expect(isSoundSetId(out.soundSet), where).toBe(true);
      expect(soundSetsInGroup(out.soundGroup), where).toContain(out.soundSet);
      expect(out.soundGroup, where).toBe(answers.sound);

      // The interface: values `data/settings.ts` and `settings.css` know.
      expect(UI_THEMES, where).toContain(out.uiTheme);
      expect(INKS, where).toContain(out.ink);
    }
  });

  it('resolves an empty and a half-finished set without throwing', () => {
    for (const partial of [
      {},
      { room: 'glasshouse' },
      { pitch: 'deep' },
      { paper: 'gilded', sound: 'hush' },
    ] as TasteAnswers[]) {
      const out = resolveTaste(partial);
      expect(ROOM_PRESETS).toContain(out.room.from);
      expect(ROLLABLE_PRESETS).toContain(out.binding);
      expect(isSoundSetId(out.soundSet)).toBe(true);
      expect(UI_THEMES).toContain(out.uiTheme);
    }
  });

  it('is deterministic — the same answers are the same library', () => {
    for (const answers of combinations.slice(0, 40)) {
      expect(tasteOutcomeKey(resolveTaste(answers))).toBe(
        tasteOutcomeKey(resolveTaste({ ...answers })),
      );
    }
  });

  it('says what it decided in words, using names rather than ids', () => {
    const line = describeTaste(resolveTaste({ room: 'toy-box', pitch: 'bright' }));
    expect(line).not.toMatch(/[a-z]+\.[a-z-]+/); // no preset ids
    expect(line.length).toBeGreaterThan(20);
  });
});

/* -------------------------------------------------------------------------
   4. Every axis is listened to
   ---------------------------------------------------------------------- */

describe('every question changes the answer', () => {
  const base: TasteAnswers = {
    room: 'reading-room',
    pitch: 'warm',
    paper: 'ruled',
    sound: 'house',
  } as TasteAnswers;

  for (const axis of TASTE_AXES) {
    it(`"${axis}" is not a question the app ignores`, () => {
      const keys = new Set(
        optionIds(axis).map((value) =>
          tasteOutcomeKey(resolveTaste({ ...base, [axis]: value } as TasteAnswers)),
        ),
      );
      expect(keys.size).toBeGreaterThan(1);
    });
  }

  /**
   * The room answer is the loudest of the four, so it gets the stronger check:
   * eight different rooms asked for must not collapse into two.
   */
  it('gives most of the eight rooms their own preset', () => {
    const rooms = new Set(
      optionIds('room').map(
        (value) => resolveRoomPreset({ ...base, room: value } as TasteAnswers).id,
      ),
    );
    expect(rooms.size).toBeGreaterThanOrEqual(7);
  });

  it('reaches a wide spread of rooms across the whole questionnaire', () => {
    const rooms = new Set(everyCombination().map((a) => resolveRoomPreset(a).id));
    // Eight characters x four pitches x five papers should not land on a
    // handful of rooms — that would mean the scoring is dominated by one axis.
    expect(rooms.size).toBeGreaterThanOrEqual(20);
  });

  /**
   * The failure this whole repaint/rehang step exists for, pinned.
   *
   * The Quiet family is muted end to end, so before `resolveRoom` a reader who
   * chose "a plain desk" saw four IDENTICAL pale cards in question two — the
   * app asking a question and ignoring the answer. Every character must be able
   * to show four different colours, or question two is decoration.
   */
  it('gives every character visibly different answers to the colour question', () => {
    const everything = new Set<string>();
    for (const room of optionIds('room')) {
      const themes = new Set(
        optionIds('pitch').map(
          (pitch) => resolveRoom({ room, pitch, paper: 'bare' } as TasteAnswers).theme,
        ),
      );
      for (const theme of themes) everything.add(theme);
      // Three of four rather than four of four, deliberately. The mood words
      // these are scored on live in `art/themes.ts`, which this feature does not
      // own and which gets re-cut; pinning "exactly four" would make an ordinary
      // re-tagging over there fail a test over here. Three is the line that
      // matters — below it the question has stopped being a question.
      expect(themes.size, `${room} answers the pitch question`).toBeGreaterThanOrEqual(3);
    }
    // And the four answers must not be the same four rooms for everybody.
    expect(everything.size).toBeGreaterThanOrEqual(8);
  });

  /** And the same for the wall: every character can hang every kind of paper. */
  it('gives every character a paper of the family it was asked for', () => {
    for (const room of optionIds('room')) {
      for (const paper of optionIds('paper')) {
        const got = resolveRoom({ room, paper, pitch: 'warm' } as TasteAnswers);
        const families = {
          bare: ['ruled'],
          ruled: ['stripe', 'ruled', 'check'],
          growing: ['botanical'],
          figured: ['figured', 'spot', 'lattice'],
          gilded: ['figured', 'spot', 'lattice'],
        }[paper] as string[];
        expect(families, `${room}/${paper}`).toContain(getWallpaper(got.paper).family);
      }
    }
  });

  /** A vetted pairing is never thrown away when it already answers. */
  it('leaves a preset alone when its own colours already answer', () => {
    const kept = resolveRoom({ room: 'toy-box', pitch: 'bright' } as TasteAnswers);
    expect(kept.repainted).toBe(false);
    expect(kept.theme).toBe(kept.from.theme);
    expect(kept.note).toBeNull();
  });

  it('says so in words when it did repaint', () => {
    const swapped = resolveRoom({ room: 'bare-desk', pitch: 'bright' } as TasteAnswers);
    expect(swapped.repainted).toBe(true);
    expect(swapped.theme).not.toBe(swapped.from.theme);
    expect(swapped.note).toMatch(/repainted in /);
  });

  it('gives the bindings a spread too', () => {
    const bindings = new Set(everyCombination().map((a) => resolveBinding(a).id));
    expect(bindings.size).toBeGreaterThanOrEqual(6);
  });
});

/* -------------------------------------------------------------------------
   5. The interface answer
   ---------------------------------------------------------------------- */

describe('the interface colours', () => {
  it('answers "deep" with the after-dark room', () => {
    for (const room of optionIds('room')) {
      const out = resolveInterface({ room, pitch: 'deep' } as TasteAnswers);
      expect(out.uiTheme, room).toBe('night');
    }
  });

  it('never writes sepia into a cool room', () => {
    for (const pitch of optionIds('pitch')) {
      expect(
        resolveInterface({ room: 'harbour', pitch } as TasteAnswers).ink,
      ).not.toBe('sepia');
    }
  });

  it('defaults to the house room and the house ink when nothing was asked', () => {
    expect(resolveInterface({})).toEqual({ uiTheme: 'parchment', ink: 'sepia' });
  });

  /**
   * The failure that would be completely invisible.
   *
   * `data/settings.ts` validates `theme` against `APP_THEME_IDS` — a table this
   * module does not own and that is being grown — and answers an id it does not
   * know with the DEFAULT, silently. So a rename over there would leave the
   * questionnaire writing 'pastel' forever, the reader getting parchment, and
   * nothing anywhere saying why.
   */
  it('writes a theme and an ink the settings validator actually accepts', () => {
    for (const combination of everyCombination()) {
      const { uiTheme, ink } = resolveInterface(combination);
      const merged = mergeSettings({ theme: uiTheme, inkColor: ink });
      expect(merged.theme, `theme "${uiTheme}" rejected by data/settings.ts`).toBe(uiTheme);
      expect(merged.inkColor, `ink "${ink}" rejected by data/settings.ts`).toBe(ink);
    }
  });

  it('picks the family lead of each sound character', () => {
    for (const group of SOUND_SET_GROUP_IDS) {
      const { set } = resolveSoundSet({ sound: group } as TasteAnswers);
      expect(set).toBe(soundSetsInGroup(group)[0]);
    }
  });
});

/* -------------------------------------------------------------------------
   6. The write path
   ---------------------------------------------------------------------- */

interface Recorded {
  library: unknown[];
  room: unknown[];
  bindings: Array<[string, string]>;
  sound: string[];
  settings: unknown[];
}

function fakeSink(
  options: { welcome?: string | null; throwOn?: string } = {},
): { sink: TasteSink; seen: Recorded } {
  const seen: Recorded = { library: [], room: [], bindings: [], sound: [], settings: [] };
  const guard = async (name: string, run: () => void): Promise<unknown> => {
    if (options.throwOn === name) throw new Error(`${name} failed`);
    run();
    return null;
  };
  return {
    seen,
    sink: {
      saveLibraryPrefs: (patch) => guard('colours', () => seen.library.push(patch)),
      saveRoomDesign: (patch) => guard('room', () => seen.room.push(patch)),
      saveBookBinding: (bookId, preset) =>
        guard('binding', () => seen.bindings.push([bookId, preset])),
      saveSoundSet: (id) => guard('sound', () => seen.sound.push(id)),
      saveSettings: (patch) => guard('interface', () => seen.settings.push(patch)),
      welcomeBookId: async () =>
        options.welcome === undefined ? 'welcome-1' : options.welcome,
    },
  };
}

describe('applyTasteWith', () => {
  const answers = {
    room: 'glasshouse',
    pitch: 'bright',
    paper: 'growing',
    sound: 'whimsy',
  } as TasteAnswers;

  it('writes all six things, through the modules that own them', async () => {
    const { sink, seen } = fakeSink();
    const outcome = resolveTaste(answers);
    const report = await applyTasteWith(outcome, sink);

    expect(report.failed).toEqual([]);
    expect(seen.library).toEqual([
      {
        theme: outcome.room.theme,
        shelf: null,
        wall: null,
        timberHex: null,
        wallHex: null,
      },
    ]);
    expect(seen.room).toEqual([
      {
        build: outcome.room.build,
        pattern: outcome.room.pattern,
        wallpaper: outcome.room.wallpaper,
      },
    ]);
    expect(seen.settings).toEqual([
      { theme: outcome.uiTheme, inkColor: outcome.ink },
    ]);
    expect(seen.sound).toEqual([outcome.soundSet]);
    expect(seen.bindings).toEqual([['welcome-1', outcome.binding.id]]);
    expect(report.boundBookId).toBe('welcome-1');
  });

  /**
   * The borrowed part colours are cleared, exactly as the studio's own
   * "apply preset" clears them. Leaving a `timberHex` behind would hand the
   * reader a room that does not look like the card they just pressed.
   */
  it('clears the parts and the reader-mixed colours', async () => {
    const { sink, seen } = fakeSink();
    await applyTasteWith(resolveTaste(answers), sink);
    const patch = seen.library[0] as Record<string, unknown>;
    expect(patch.shelf).toBeNull();
    expect(patch.wall).toBeNull();
    expect(patch.timberHex).toBeNull();
    expect(patch.wallHex).toBeNull();
  });

  it('dresses everything else when one writer fails', async () => {
    for (const name of ['colours', 'room', 'interface', 'sound', 'binding']) {
      const { sink, seen } = fakeSink({ throwOn: name });
      const report = await applyTasteWith(resolveTaste(answers), sink);
      expect(report.failed, name).toEqual([name]);
      // Four of the five still landed, whichever one was broken.
      const landed =
        seen.library.length +
        seen.room.length +
        seen.settings.length +
        seen.sound.length +
        seen.bindings.length;
      expect(landed, name).toBe(4);
    }
  });

  it('skips the binding when the library has no welcome book', async () => {
    const { sink, seen } = fakeSink({ welcome: null });
    const report = await applyTasteWith(resolveTaste(answers), sink);
    expect(seen.bindings).toEqual([]);
    expect(report.boundBookId).toBeNull();
    expect(report.failed).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
   7. The stylesheet, gated where styles.test.ts cannot see it
   ---------------------------------------------------------------------- */

describe('taste.css follows the flat rule', () => {
  const css = readFileSync(
    join(import.meta.dirname, '..', 'src', 'features', 'tutorial', 'taste.css'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

  it('has no blur anywhere', () => {
    expect(css).not.toMatch(/backdrop-filter\s*:/);
    expect(css).not.toMatch(/filter\s*:\s*[^;]*blur\(/);
  });

  it('uses only offset plates and rings for its shadows', () => {
    const shadows = [...css.matchAll(/box-shadow\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(shadows.length).toBeGreaterThan(0);
    for (const shadow of shadows) {
      for (const layer of shadow.split(',')) {
        if (layer.includes('var(--shadow')) continue; // token, gated in tokens.css
        const lengths = layer.replace(/[a-z-]+\([^)]*\)/gi, ' ').match(/-?[\d.]+(px)?/g) ?? [];
        // 0 offset-x, 1 offset-y, 2 blur. A missing blur slot is 0 by omission.
        const blur = lengths[2] ?? '0';
        expect(Number.parseFloat(blur), `${layer} in taste.css`).toBe(0);
      }
    }
  });

  it('never sets a handwriting face below 13px', () => {
    // Rule-block scoped: a block only fails if it sets BOTH a handwriting
    // family and a size under the floor.
    for (const block of css.split('}')) {
      const size = /font-size\s*:\s*([\d.]+)px/.exec(block);
      if (size === null || Number.parseFloat(size[1]) >= 13) continue;
      expect(block, 'handwriting under 13px').not.toMatch(
        /font-family[^;]*(Caveat|Patrick Hand|Kalam|Architects Daughter)/i,
      );
      expect(block, 'handwriting token under 13px').not.toMatch(
        /font-family[^;]*var\(--font-(heading|body|accent|diagram)\)/,
      );
    }
  });

  it('anchors its way out to the left, never the right', () => {
    // The exits row is a flex header, so the mechanical check is that nothing
    // in this file pins an exit to the right-hand edge.
    expect(css).not.toMatch(/\.nbq-exit[^{]*\{[^}]*\bright\s*:/);
  });
});
