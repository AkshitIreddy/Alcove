/**
 * src/features/tutorial/tasteProfile.ts — the taste questionnaire's questions,
 * and the pure function that turns four answers into a whole dressed library.
 *
 * ## What the reader asked for, and what is NOT built here
 *
 *   "during onboarding ask the user whether they like bland or vivid, what kind
 *    of pattern and style they like (make it sound better) and then auto pick
 *    their colour profile, from the preset to how their shelf, welcome book,
 *    wallpaper, etc, as well as their sound profile, the colour profile on the
 *    settings icons and other app ui icons"
 *
 * The aside is the whole brief for this file: **nobody is asked "bland or
 * vivid".** Adjectives about taste are a quiz; they put the reader in the
 * position of describing themselves to a computer, and the two words mean
 * different things to every person who reads them. So the questions are about
 * ROOMS, PAPER and QUIET — things this app actually has — and every option is
 * shown as the real drawing it would produce (`tasteQuestionnaire.tsx` draws
 * each card with `drawRoomCard`, the same routine the studio previews with).
 * The loud/quiet axis is still in there; it is question two, and it is asked by
 * showing four rooms rather than by naming a preference.
 *
 * ## This is a STARTING POINT, never a lock
 *
 * Everything the resolver decides is a value the reader can change afterwards
 * in exactly the place they would look for it — the library studio for the
 * room, the book studio for the binding, the settings sheet for the sound and
 * the interface colours. Nothing here is written anywhere those panels cannot
 * reach, and nothing here is remembered as "the answers say so": once applied,
 * the choices are ordinary choices. `tasteApply.ts` is the whole write path and
 * it makes exactly the same calls the panels make.
 *
 * ## The answers start from a PRESET and only then compose
 *
 * `ROOM_PRESETS` are composed rooms — colour, carpentry and paper judged
 * together by eye (see the note on that table). A resolver that rolled a build
 * from one answer, a theme from another and a paper from a third would be
 * handing an unvetted room to a reader who has not seen the app yet, which is
 * the one moment it must not look thrown together. So the answers SCORE the
 * table first and the best-scoring room wins.
 *
 * Then `resolveRoom` repaints or rehangs it, but ONLY when the family the
 * reader pointed at cannot answer the other two questions at all — every room
 * in Quiet is muted by design, so "a plain desk, plenty of colour" was showing
 * four identical pale cards and then handing over a pale room. The long note on
 * `resolveRoom` says why that swap is allowed and when it does not happen.
 *
 * Pure and DOM-free on purpose: node tests drive every combination through it,
 * and the questionnaire calls it once per option card on every render.
 */

import {
  BOOK_PRESETS,
  ROLLABLE_PRESETS,
  type BookPreset,
  type BookTag,
} from '../../art/bookDesign';
import { THEMES, THEME_IDS, getTheme, type ThemeId, type ThemeTag } from '../../art/themes';
import {
  WALLPAPER_ROLL,
  getWallpaper,
  type WallpaperFamily,
  type WallpaperMood,
} from '../../art/wallpaperDesign';
import {
  SOUND_SET_GROUPS,
  SOUND_SET_GROUP_IDS,
  soundSetsInGroup,
  type SoundSetGroupId,
  type SoundSetId,
} from '../../sound/soundSets';
import type { ThemeName } from '../../data/types';
import {
  ROOM_PRESETS,
  type RoomLook,
  type RoomPreset,
  type RoomPresetGroup,
} from '../../views/rail/designOptions';

/* ========================================================================== *
 *  The four axes
 * ========================================================================== */

/** Question one: which room the reader would rather be sitting in. */
export type TasteRoomId =
  | 'reading-room'
  | 'chapter-house'
  | 'bare-desk'
  | 'good-parlour'
  | 'glasshouse'
  | 'harbour'
  | 'toy-box'
  | 'sawmill';

/** Question two: how much colour is in it. This is "bland or vivid", asked properly. */
export type TastePitchId = 'hushed' | 'warm' | 'deep' | 'bright';

/** Question three: what is on the wall behind the case. */
export type TastePaperId = 'bare' | 'ruled' | 'growing' | 'figured' | 'gilded';

/** Question four: what the app sounds like under their hands. */
export type TasteSoundId = SoundSetGroupId;

export interface TasteAnswers {
  room?: TasteRoomId;
  pitch?: TastePitchId;
  paper?: TastePaperId;
  sound?: TasteSoundId;
}

/** The four question ids, in the order they are asked. */
export const TASTE_AXES = ['room', 'pitch', 'paper', 'sound'] as const;
export type TasteAxis = (typeof TASTE_AXES)[number];

/* ========================================================================== *
 *  What each answer means to each vocabulary
 *
 *  Every table below is a STEER, not a lookup: an answer nudges the score of
 *  every preset that carries the matching word, and the winner is whatever the
 *  four steers agree on. Written as weights rather than as a 8x4x5 table of
 *  hand-picked rooms for two reasons — a table of 160 hand-picked rooms is a
 *  table nobody will keep true when a preset is renamed, and a steer degrades
 *  gracefully when an answer is missing (the reader skipped a question) where a
 *  lookup simply has no row.
 * ========================================================================== */

/**
 * Which families of room a "where would you rather sit" answer means.
 *
 * Two entries each, weighted, so an answer is a direction rather than a
 * synonym for one shelf of the picker: someone who chose the chapter house
 * should still be able to land in a Formal room if their other three answers
 * pull that way.
 */
const ROOM_GROUPS: Readonly<Record<TasteRoomId, Partial<Record<RoomPresetGroup, number>>>> = {
  'reading-room': { Formal: 12, Grand: 6 },
  'chapter-house': { Antique: 12, Formal: 4 },
  'bare-desk': { Quiet: 12, Formal: 3 },
  'good-parlour': { Cosy: 12, Storybook: 4 },
  glasshouse: { Botanical: 12, Quiet: 4 },
  harbour: { Coastal: 12, Rustic: 4 },
  'toy-box': { Storybook: 12, Cosy: 4 },
  sawmill: { Rustic: 12, Antique: 4 },
};

/**
 * The mood words a room answer also implies about its COLOUR.
 *
 * Weak (they are worth a fraction of the pitch answer) but not nothing: it is
 * what stops "the harbour room" from landing in a hot orange just because the
 * reader also said "bright".
 */
const ROOM_THEME_TAGS: Readonly<Record<TasteRoomId, readonly ThemeTag[]>> = {
  'reading-room': ['formal', 'dark', 'quiet'],
  'chapter-house': ['formal', 'dark', 'winter'],
  'bare-desk': ['quiet', 'pale'],
  'good-parlour': ['cosy', 'warm'],
  glasshouse: ['botanical', 'natural', 'spring'],
  harbour: ['coastal', 'cool', 'winter'],
  'toy-box': ['playful', 'storybook', 'summer'],
  sawmill: ['natural', 'warm', 'autumn'],
};

/**
 * What "how loud is the colour" means to a room's palette.
 *
 * Only words that are ABOUT the colour. `quiet`, `formal` and `storybook` were
 * in here and had to come out: they describe a room's character, not its
 * loudness, and 'quiet' in particular is carried by dark warm browns like
 * English Walnut — so "hardly any colour" and "warm" both resolved to walnut
 * and question two showed the reader the same room twice.
 */
const PITCH_THEME_TAGS: Readonly<Record<TastePitchId, readonly ThemeTag[]>> = {
  hushed: ['pale', 'muted'],
  warm: ['warm', 'cosy', 'autumn'],
  /*
   * `deep` needs TWO words, and the second one is the whole point.
   *
   * On `['dark']` alone all ten dark palettes scored identically, the tie broke
   * on table order, and every room answer resolved to the same grey-brown
   * Ebonised — so the four "how much colour" cards showed one dark room four
   * times. Measured with shots-now/taste-matrix.mjs, which renders the room
   * answer against the colour answer as a grid; the `deep` column was uniform
   * across every row.
   *
   * The question promises "Ink, forest, claret. Dark, and SATURATED all the
   * way down", and the palette has exactly those — Indigo Room, Forest,
   * Lacquer Red, Aubergine. What separates them from Ebonised and Fumed is
   * that the rich ones carry `grand` while the grey ones carry `quiet` and
   * `muted`. `muted` is already penalised (it is what `hushed` wants), so
   * rewarding `grand` is the half that was missing.
   */
  deep: ['dark', 'grand'],
  bright: ['vivid', 'playful'],
};

/** And what it means to the paper hung behind the case. */
const PITCH_PAPER_MOODS: Readonly<Record<TastePitchId, readonly WallpaperMood[]>> = {
  hushed: ['quiet'],
  warm: ['warm', 'cosy'],
  deep: ['formal', 'nocturnal', 'antique'],
  bright: ['bold', 'playful'],
};

/**
 * The wall answer, as the paper vocabulary's own words.
 *
 * `families` is the strong half — a reader who asked for "something growing"
 * should get leaves — and `moods` breaks the tie between the nine or so papers
 * in that family.
 */
const PAPER_STEER: Readonly<
  Record<TastePaperId, { families: readonly WallpaperFamily[]; moods: readonly WallpaperMood[] }>
> = {
  bare: { families: ['ruled'], moods: ['quiet'] },
  ruled: { families: ['stripe', 'ruled', 'check'], moods: ['quiet', 'formal'] },
  // BOTANICAL only, and not `lattice` as well. The lattice family is trellis,
  // arch, scallop, diaper, fret, quatrefoil and ogee — one garden trellis and
  // six pieces of architecture — so letting it answer "something growing" is
  // how a reader who asked for leaves got a wall of scallop shells and the
  // resolver saw nothing wrong. Lattice answers "a figure that repeats", which
  // is what six of its seven motifs actually are.
  growing: { families: ['botanical'], moods: ['fresh', 'cosy'] },
  figured: { families: ['figured', 'spot', 'lattice'], moods: ['grand', 'antique'] },
  gilded: { families: ['figured', 'spot', 'lattice'], moods: ['gilded', 'grand', 'bold'] },
};

/** What a room answer means about how a book on that shelf is bound. */
const ROOM_BOOK_TAGS: Readonly<Record<TasteRoomId, readonly BookTag[]>> = {
  'reading-room': ['formal', 'refined', 'scholarly'],
  'chapter-house': ['antique', 'devotional', 'severe'],
  'bare-desk': ['plain', 'sober', 'utilitarian'],
  'good-parlour': ['cosy', 'handmade', 'refined'],
  glasshouse: ['natural', 'airy', 'handmade'],
  harbour: ['plain', 'battered', 'natural'],
  'toy-box': ['whimsical', 'goofy', 'fancy'],
  sawmill: ['rustic', 'handmade', 'battered'],
};

/** And what the pitch answer means about it. */
const PITCH_BOOK_TAGS: Readonly<Record<TastePitchId, readonly BookTag[]>> = {
  hushed: ['plain', 'sober', 'airy'],
  warm: ['cosy', 'handmade', 'natural'],
  deep: ['luxe', 'gilt', 'formal'],
  bright: ['fancy', 'ornate', 'whimsical'],
};

/**
 * The interface's own colour scheme — the "colour profile on the settings
 * icons and other app UI icons" the report asks for.
 *
 * There are four (`settings.css` remaps the tokens for three of them; parchment
 * IS tokens.css), so this is a genuine choice rather than a shade. The room
 * answer supplies the base and the pitch answer moves it: asking for a deep
 * room and getting a cream interface reads as the app ignoring the answer.
 */
const ROOM_UI_THEME: Readonly<Record<TasteRoomId, ThemeName>> = {
  'reading-room': 'parchment',
  'chapter-house': 'parchment',
  'bare-desk': 'parchment',
  'good-parlour': 'pastel',
  glasshouse: 'botanical',
  harbour: 'parchment',
  'toy-box': 'pastel',
  sawmill: 'botanical',
};

/**
 * The ink the app writes in.
 *
 * Three values, and they are the three `settings.css` knows (`data-ink`).
 * Chosen off the pitch answer, with the two cool rooms overruling it: sepia in
 * the harbour room is the one combination that reads as a mistake rather than
 * as a choice.
 */
const PITCH_INK: Readonly<Record<TastePitchId, string>> = {
  hushed: 'graphite',
  warm: 'sepia',
  deep: 'ink-blue',
  bright: 'sepia',
};

/* ========================================================================== *
 *  The questions, as the app says them out loud
 * ========================================================================== */

export interface TasteOption<Id extends string = string> {
  id: Id;
  /** What the card is called. Lowercase, like the rest of the app's micro-copy. */
  label: string;
  /** One line under it. Describes the THING, never the reader. */
  line: string;
}

export interface TasteQuestion<Id extends string = string> {
  axis: TasteAxis;
  /** The question, in the app's voice. */
  title: string;
  /** A sentence of context under the title. */
  body: string;
  /** How the option cards are laid out — art cards, or a list with marks. */
  shape: 'rooms' | 'sounds';
  options: readonly TasteOption<Id>[];
}

const ROOM_QUESTION: TasteQuestion<TasteRoomId> = {
  axis: 'room',
  title: 'Where would you rather be sitting?',
  body: 'Every one of these is a real room in here. Pick the one you would walk into, and the rest of your library takes after it.',
  shape: 'rooms',
  options: [
    { id: 'reading-room', label: 'a reading room', line: 'Dark cabinet work, everything squared and shut.' },
    { id: 'chapter-house', label: 'a chapter house', line: 'Pointed bays, battlements, stone and ink.' },
    { id: 'bare-desk', label: 'a plain desk', line: 'A board, two uprights, and nothing asking for you.' },
    { id: 'good-parlour', label: 'the good parlour', line: 'Turned spindles, soft cloth, a fire somewhere.' },
    { id: 'glasshouse', label: 'a glasshouse', line: 'Slender bars, ferns, everything still growing.' },
    { id: 'harbour', label: 'a room by the water', line: 'Beadboard and rope, and light off the harbour.' },
    { id: 'toy-box', label: 'a toy box', line: 'Fat rounded boards and colours that shout.' },
    { id: 'sawmill', label: 'a workshop', line: 'Sawn boards, pegs, honest and a little rough.' },
  ],
};

const PITCH_QUESTION: TasteQuestion<TastePitchId> = {
  axis: 'pitch',
  title: 'And how much colour is in it?',
  body: 'The same room, four ways. This is the one thing everything else takes its temperature from — the shelf, the paper, the books, the ink you write in.',
  shape: 'rooms',
  options: [
    { id: 'hushed', label: 'hardly any', line: 'Chalk, bone, weathered grey. The books do all the work.' },
    { id: 'warm', label: 'warm', line: 'Wood, honey, late afternoon. Colour, but nothing raised.' },
    { id: 'deep', label: 'deep', line: 'Ink, forest, claret. Dark, and saturated all the way down.' },
    { id: 'bright', label: 'plenty', line: 'The dial turned up. Colour you could not walk past.' },
  ],
};

const PAPER_QUESTION: TasteQuestion<TastePaperId> = {
  axis: 'paper',
  title: 'What is on the wall behind it?',
  body: 'There are a hundred and twenty-six papers in here. You are choosing a direction, not a roll of it.',
  shape: 'rooms',
  options: [
    { id: 'bare', label: 'next to nothing', line: 'Plain paper. Let the spines be the only pattern.' },
    { id: 'ruled', label: 'lines', line: 'Rules, stripes, ticking. Pattern that stays out of the way.' },
    { id: 'growing', label: 'something growing', line: 'Leaves, sprigs, ferns, a vine up the wall.' },
    { id: 'figured', label: 'a figure that repeats', line: 'Damask, medallions, scallops, diaper work.' },
    { id: 'gilded', label: 'gold', line: 'Struck in gilt. Not subtle, and not trying to be.' },
  ],
};

/**
 * The sound question is DERIVED from `SOUND_SET_GROUPS` rather than written
 * out, so a family renamed or re-blurbed in the sound module cannot leave this
 * panel describing a set that no longer sounds like that. The seven names and
 * lines below are the sound module's own words.
 */
const SOUND_QUESTION: TasteQuestion<TasteSoundId> = {
  axis: 'sound',
  title: 'And what should it sound like?',
  body: 'Press one and listen — a click, a page, a book off the shelf, and the thing that answers when you finish something.',
  shape: 'sounds',
  options: SOUND_SET_GROUP_IDS.map((id) => ({
    id,
    label: SOUND_SET_GROUPS[id].name.toLowerCase(),
    line: SOUND_SET_GROUPS[id].blurb,
  })),
};

/** The four questions, in the order they are asked. */
export const TASTE_QUESTIONS: readonly TasteQuestion[] = [
  ROOM_QUESTION as TasteQuestion,
  PITCH_QUESTION as TasteQuestion,
  PAPER_QUESTION as TasteQuestion,
  SOUND_QUESTION as TasteQuestion,
];

/** Is `value` an answer this axis knows? Used to validate a stored blob. */
export function isTasteAnswer(axis: TasteAxis, value: unknown): boolean {
  const question = TASTE_QUESTIONS.find((q) => q.axis === axis);
  if (question === undefined || typeof value !== 'string') return false;
  return question.options.some((option) => option.id === value);
}

/** Total: keeps only the values their own axis recognises. */
export function mergeTasteAnswers(raw: unknown): TasteAnswers {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const axis of TASTE_AXES) {
    const value = source[axis];
    if (isTasteAnswer(axis, value)) out[axis] = value as string;
  }
  return out as unknown as TasteAnswers;
}

/** True once every question has an answer this module recognises. */
export function isTasteComplete(answers: TasteAnswers): boolean {
  return TASTE_AXES.every((axis) => isTasteAnswer(axis, answers[axis]));
}

/* ========================================================================== *
 *  The resolver
 * ========================================================================== */

/**
 * A whole room — a `RoomLook` the studio could store as it stands, plus where
 * each part of it came from.
 *
 * `RoomLook` and not `RoomPreset` because the room is allowed to be a composed
 * one; see `resolveRoom`. Everything the drawing needs is in the four inherited
 * fields, so this goes straight into `drawRoomCard` and straight into the two
 * writes `tasteApply` makes.
 */
export interface TasteRoom extends RoomLook {
  /** The preset the carpentry came from — the room's structural identity. */
  from: RoomPreset;
  /** The named paper actually hung, for the ledger and for search. */
  paper: string;
  /** The colours were swapped to answer the pitch question. */
  repainted: boolean;
  /** The paper was swapped to answer the wall question. */
  rehung: boolean;
  /** What was changed, in the reader's words, or null when nothing was. */
  note: string | null;
}

/** Everything the questionnaire decides, ready for `tasteApply.ts` to write. */
export interface TasteOutcome {
  /** The whole room: its colours, its carpentry and its paper. */
  room: TasteRoom;
  /** The welcome book's binding. Always a rollable one — never an oddity. */
  binding: BookPreset;
  /** The sound set, and the family it came from. */
  soundSet: SoundSetId;
  soundGroup: SoundSetGroupId;
  /** The interface: `data-theme` and `data-ink` on <html>. */
  uiTheme: ThemeName;
  ink: string;
}

/** Count how many of `wanted` appear in `has`, weighted per hit. */
function tagScore(
  has: readonly string[],
  wanted: readonly string[],
  per: number,
): number {
  let score = 0;
  for (const tag of wanted) if (has.includes(tag)) score += per;
  return score;
}

/**
 * How well one composed room answers the reader's three room questions.
 *
 * The weights are the whole argument of this file, so they are stated rather
 * than buried, and the shape of them matters more than the numbers:
 *
 *   the FAMILY the reader pointed at DECIDES (12, or 6 for the second family),
 *   and everything else together cannot outvote it. That is not a preference,
 *   it is what question one means: somebody who said "a chapter house" and
 *   "hardly any colour" wants the palest chapter house, not a bare atelier
 *   that happens to be paler. At the first weights it did get the atelier, and
 *   every card in question two showed a different family — which is the exact
 *   failure of "the eye reads the wrong difference first".
 *
 *   the COLOUR they asked for chooses within that family (2 per mood word),
 *   the PAPER refines it further (3.5 for the right family, 1 per mood), and
 *   the colour implied by the room answer is a whisper (0.6) that breaks ties.
 *
 * A missing answer contributes nothing rather than a default, which is what
 * makes a half-answered questionnaire still resolve to a sensible room.
 *
 * This picks the room's SHAPE. When the family it lands in cannot answer the
 * other two questions — and the Quiet family genuinely has no vivid room in it,
 * so a "plain desk, plenty of colour" reader was being shown four identical
 * pale cards — `resolveRoom` below repaints or rehangs it. See the note there.
 */
function scoreRoom(preset: RoomPreset, answers: TasteAnswers): number {
  let score = 0;

  if (answers.room !== undefined) {
    score += ROOM_GROUPS[answers.room][preset.group] ?? 0;
    score += tagScore(getTheme(preset.theme).tags, ROOM_THEME_TAGS[answers.room], 0.6);
  }

  if (answers.pitch !== undefined) {
    score += tagScore(getTheme(preset.theme).tags, PITCH_THEME_TAGS[answers.pitch], 2);
    score += tagScore(getWallpaper(preset.paper).tags, PITCH_PAPER_MOODS[answers.pitch], 0.5);
  }

  if (answers.paper !== undefined) {
    const paper = getWallpaper(preset.paper);
    const steer = PAPER_STEER[answers.paper];
    if (steer.families.includes(paper.family)) score += 3.5;
    score += tagScore(paper.tags, steer.moods, 1);
  }

  return score;
}

/**
 * The best-scoring room, ties broken by the preset table's own order.
 *
 * `ROOM_PRESETS` is never empty (it is a literal), but the fallback is written
 * anyway: this runs on the first screen a reader ever sees, and a resolver that
 * can throw there is a resolver that can hand somebody a white page instead of
 * a library.
 */
export function resolveRoomPreset(answers: TasteAnswers): RoomPreset {
  let best = ROOM_PRESETS[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const preset of ROOM_PRESETS) {
    const score = scoreRoom(preset, answers);
    if (score > bestScore) {
      best = preset;
      bestScore = score;
    }
  }
  return best;
}

/* ---------------------- repainting and rehanging it ----------------------- */

/**
 * The best room in the library the reader can be given, which is NOT always a
 * preset off the shelf.
 *
 * ## Why this step exists
 *
 * The presets are composed rooms and the family the reader points at decides
 * which one they get — but a family is a family, and some of them cannot answer
 * the other two questions at all. Every room in Quiet is muted by design, so a
 * reader who said "a plain desk" and "plenty of colour" was shown four
 * identical pale cards in question two and then handed a pale room. That is the
 * app asking a question and ignoring the answer, which is worse than not
 * asking; it is also exactly the imbalance the reader reported ("a lot of
 * presets… seem to be bland… it should be balanced with presets that are vivid
 * too").
 *
 * ## Why this is allowed
 *
 * Because the vocabularies are orthogonal ON PURPOSE — CLAUDE.md states it in
 * as many words: "repainting a room must not straighten its arches, and
 * rebuilding a case must not repaint it". A wallpaper takes its motif colour
 * from a slot in the ROOM's palette (`WallpaperInk`), never from a hex of its
 * own, so any paper in any room is a colour-coherent pairing by construction
 * rather than by luck. Swapping the colours or the paper of a preset is
 * therefore an ordinary, already-expressible state: it is the two rows directly
 * under the preset strip in the library studio, and the studio will honestly
 * report the result as "a room of your own".
 *
 * ## When it does NOT happen
 *
 * Whenever the preset already answers. A vetted pairing is preferred every
 * time — the swap only runs when the room the character chose carries no mood
 * word from the pitch answer at all (or hangs no paper of the requested
 * family), which is the mechanical form of "this family cannot say that".
 */
/** The colour words the OTHER three pitches want, per pitch. */
const OTHER_PITCH_TAGS: Readonly<Record<TastePitchId, readonly ThemeTag[]>> = {
  hushed: [...PITCH_THEME_TAGS.warm, ...PITCH_THEME_TAGS.deep, ...PITCH_THEME_TAGS.bright],
  warm: [...PITCH_THEME_TAGS.hushed, ...PITCH_THEME_TAGS.deep, ...PITCH_THEME_TAGS.bright],
  deep: [...PITCH_THEME_TAGS.hushed, ...PITCH_THEME_TAGS.warm, ...PITCH_THEME_TAGS.bright],
  bright: [...PITCH_THEME_TAGS.hushed, ...PITCH_THEME_TAGS.warm, ...PITCH_THEME_TAGS.deep],
};

/**
 * How cleanly a palette answers ONE pitch — hits for the words it wants, and a
 * penalty for the words the other three wanted.
 *
 * The penalty is the load-bearing half. Verdigris Library is tagged both `dark`
 * and `vivid` and is a perfectly honest description of both, so on hits alone it
 * won "deep" AND "plenty" and question two showed the reader the same room
 * twice. Asking for the room that answers this pitch and NOT the others is what
 * makes four cards four cards.
 */
function pitchAffinity(tags: readonly ThemeTag[], pitch: TastePitchId): number {
  return (
    tagScore(tags, PITCH_THEME_TAGS[pitch], 3) -
    tagScore(tags, OTHER_PITCH_TAGS[pitch], 1.5)
  );
}

/** One clean hit with nothing pulling the other way. */
const ANSWERS_PITCH = 3;

function bestTheme(answers: TasteAnswers, fallback: ThemeId): ThemeId {
  if (answers.pitch === undefined) return fallback;
  const pitch = answers.pitch;
  /*
   * The character's own words, MINUS any that are really about colour and
   * belong to a different pitch.
   *
   * "A reading room" carries `dark`, and `dark` is what "deep" means — so when
   * the reader asked for plenty of colour, the character was quietly voting for
   * a near-black oak and winning, and "deep" and "plenty" showed the same card.
   * Question one owns the room's character; question two owns its colour, and
   * where a word is both, question two has it.
   */
  const character = (answers.room === undefined ? [] : ROOM_THEME_TAGS[answers.room]).filter(
    (tag) => !OTHER_PITCH_TAGS[pitch].includes(tag),
  );
  let best = fallback;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const id of THEME_IDS) {
    const tags = THEMES[id].tags;
    // The pitch is what this swap is FOR, but the character has to stay
    // audible: at a whisper, every "warm" answer in the app resolved to the
    // same dark library brown and a toy box came out looking like a chambers.
    // At 2.5 a room matching both of its character words outweighs one clean
    // pitch hit, which is the balance a card in question two needs to still
    // look like the room the reader chose in question one.
    const score = pitchAffinity(tags, pitch) + tagScore(tags, character, 3);
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

function bestPaper(answers: TasteAnswers, fallback: string): string {
  if (answers.paper === undefined) return fallback;
  const steer = PAPER_STEER[answers.paper];
  const moods = answers.pitch === undefined ? [] : PITCH_PAPER_MOODS[answers.pitch];
  let best = fallback;
  let bestScore = Number.NEGATIVE_INFINITY;
  // WALLPAPER_ROLL, not WALLPAPER_PRESETS: the back-of-the-book papers are
  // pickable on purpose and rollable on purpose, and this is a roll.
  for (const paper of WALLPAPER_ROLL) {
    if (!steer.families.includes(paper.family)) continue;
    const score = tagScore(paper.tags, steer.moods, 2) + tagScore(paper.tags, moods, 1.5);
    if (score > bestScore) {
      best = paper.id;
      bestScore = score;
    }
  }
  return best;
}

/** The room, composed. Total — every branch lands on something drawable. */
export function resolveRoom(answers: TasteAnswers): TasteRoom {
  const from = resolveRoomPreset(answers);

  const answersPitch =
    answers.pitch !== undefined &&
    pitchAffinity(getTheme(from.theme).tags, answers.pitch) >= ANSWERS_PITCH;
  const theme = answersPitch ? from.theme : bestTheme(answers, from.theme);
  const repainted = theme !== from.theme;

  const answersPaper =
    answers.paper !== undefined &&
    PAPER_STEER[answers.paper].families.includes(getWallpaper(from.paper).family);
  const paper = answersPaper ? from.paper : bestPaper(answers, from.paper);
  const rehung = paper !== from.paper;

  const changes: string[] = [];
  if (repainted) changes.push(`repainted in ${getTheme(theme).name}`);
  if (rehung) changes.push(`rehung with ${getWallpaper(paper).name}`);

  return {
    theme,
    build: from.build,
    pattern: from.pattern,
    wallpaper: getWallpaper(paper).spec,
    from,
    paper,
    repainted,
    rehung,
    note: changes.length === 0 ? null : changes.join(', '),
  };
}

/**
 * How well a binding answers the two questions that say anything about books.
 *
 * The tier bonus is deliberately large. This binding goes on the welcome book —
 * the first object a reader ever sees on a shelf, dressed as the app's calling
 * card in `data/seed.ts` — so a taste answer may choose its character but must
 * not be able to drop it onto something that reads badly at 34px.
 */
const TIER_BONUS: Readonly<Record<string, number>> = {
  signature: 2.5,
  shelf: 1.25,
  niche: 0,
  oddity: -99,
};

export function resolveBinding(answers: TasteAnswers): BookPreset {
  // ROLLABLE only: the oddity tier "reads as something that is not a book",
  // and the studio is where those are found on purpose.
  const pool = ROLLABLE_PRESETS.length > 0 ? ROLLABLE_PRESETS : BOOK_PRESETS;
  let best = pool[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const preset of pool) {
    let score = TIER_BONUS[preset.tier] ?? 0;
    if (answers.room !== undefined) {
      score += tagScore(preset.tags, ROOM_BOOK_TAGS[answers.room], 2);
    }
    if (answers.pitch !== undefined) {
      score += tagScore(preset.tags, PITCH_BOOK_TAGS[answers.pitch], 1.5);
    }
    if (score > bestScore) {
      best = preset;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The set inside the chosen family.
 *
 * The family's FIRST set, which `soundSets.ts` documents as "its most typical
 * member" — the picker's own order, not a second opinion invented here. The
 * other three in the family stay one click away in the settings sheet, which is
 * the point: this answer is a direction, and the shelf of variants behind it is
 * still there.
 */
export function resolveSoundSet(answers: TasteAnswers): {
  set: SoundSetId;
  group: SoundSetGroupId;
} {
  const group: SoundSetGroupId = answers.sound ?? 'house';
  const sets = soundSetsInGroup(group);
  const first = sets[0];
  return { set: first ?? 'house', group };
}

/** The interface's colour scheme and ink. */
export function resolveInterface(answers: TasteAnswers): {
  uiTheme: ThemeName;
  ink: string;
} {
  const base: ThemeName = answers.room === undefined ? 'parchment' : ROOM_UI_THEME[answers.room];
  let uiTheme = base;
  if (answers.pitch === 'deep') {
    // They asked for dark. A cream interface around a claret room is the app
    // not listening — and night is the only theme that answers it.
    uiTheme = 'night';
  } else if (answers.pitch === 'bright' && base === 'parchment') {
    uiTheme = 'pastel';
  }

  let ink = answers.pitch === undefined ? 'sepia' : PITCH_INK[answers.pitch];
  // A cool room writes in a cool ink whatever the pitch said. Sepia against
  // harbour teal is the one pairing that reads as an oversight.
  if ((answers.room === 'harbour' || answers.room === 'chapter-house') && ink === 'sepia') {
    ink = 'ink-blue';
  }
  return { uiTheme, ink };
}

/**
 * Four answers in, a whole library out. Total — every field is filled even
 * when nothing was answered at all, which is what the "surprise me" path and a
 * half-finished questionnaire both rely on.
 */
export function resolveTaste(answers: TasteAnswers): TasteOutcome {
  const sound = resolveSoundSet(answers);
  const ui = resolveInterface(answers);
  return {
    room: resolveRoom(answers),
    binding: resolveBinding(answers),
    soundSet: sound.set,
    soundGroup: sound.group,
    uiTheme: ui.uiTheme,
    ink: ui.ink,
  };
}

/**
 * A one-line summary of an outcome, for the confirmation panel and for QA.
 * Names, never ids — this is read out to the reader.
 */
export function describeTaste(outcome: TasteOutcome): string {
  const room = outcome.room;
  const name = room.repainted
    ? `${room.from.name} in ${getTheme(room.theme).name}`
    : room.from.name;
  return (
    `${name}, bound in ${outcome.binding.label.toLowerCase()}, ` +
    `sounding like ${SOUND_SET_GROUPS[outcome.soundGroup].name.toLowerCase()}`
  );
}

/**
 * Every axis the ROOM's drawing varies on.
 *
 * Spelled out rather than named, because a repainted Atelier and a plain one
 * are the same preset and two different pictures — and this is what the option
 * cards key their cached tiles on. A key that named the preset would serve one
 * reader's pale plain desk to the reader who asked for a bright one, forever.
 * The paper's NAME is enough for the wall: every paper here comes out of
 * `getWallpaper`, so the name determines all six of its axes.
 */
export function tasteRoomKey(room: TasteRoom): string {
  return `${room.theme}|${room.build}.${room.pattern}|${room.paper}`;
}

/**
 * Every distinct thing an outcome decides, as one comparable string. Used by
 * the tests to prove the axes actually move the answer, and by the panel to
 * decide whether a re-render changed anything worth redrawing.
 */
export function tasteOutcomeKey(outcome: TasteOutcome): string {
  return [
    tasteRoomKey(outcome.room),
    outcome.binding.id,
    outcome.soundSet,
    outcome.uiTheme,
    outcome.ink,
  ].join('|');
}
