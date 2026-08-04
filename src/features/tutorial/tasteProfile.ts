/**
 * src/features/tutorial/tasteProfile.ts — the taste questionnaire's questions,
 * and the pure function that turns the answers into a whole dressed library.
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
 * ## A steer is not a choice, so there is a choice behind it
 *
 *   "also let user then choose colour theme with more options so that picking
 *    their fav is possible directly in onboarding then"
 *
 * Four buckets standing in front of sixty palettes is still the app deciding.
 * Question three is therefore the palettes themselves — all sixty, drawn, in the
 * reader's own carpentry — and the two answers before it decide only what leads
 * the grid and what is lit when it opens (`paletteOrder`, `steerTheme`). Nobody
 * has to browse: the preselection is the room the steer worked out, so "press
 * on" and "point at one" are both one press. `TASTE_REQUIRED_AXES` is where that
 * optionality is written down.
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
import {
  THEMES,
  THEME_IDS,
  getTheme,
  isThemeId,
  type ThemeId,
  type ThemeTag,
} from '../../art/themes';
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

/** Every pitch, in the order the cards are shown. */
export const TASTE_PITCH_IDS = ['hushed', 'warm', 'deep', 'bright'] as const;

/**
 * Question three: the palette itself, named, out of all sixty.
 *
 * ## Why a steer needed a choice behind it
 *
 * Question two is four buckets and it INFERS a palette. That is a steer, and a
 * steer was all there was — sixty rooms hidden behind four words, which is the
 * app deciding for a reader who is perfectly capable of pointing at the one they
 * want. It also produced a real bug rather than merely a limitation: `deep` was
 * tagged `['dark']`, ten palettes tied on that one word, the tiebreak picked
 * Ebonised every time, and all four room answers came out the same grey (see the
 * long note on `PITCH_THEME_TAGS.deep`). A steer that ties is invisible; a grid
 * of drawn cards cannot tie, because the reader is looking at them.
 *
 * So the steer stays and keeps its job — it decides what is shown FIRST and what
 * is preselected — and this axis is the choice. It is the ONLY optional answer:
 * `undefined` means "whatever the steer worked out", which is what lets somebody
 * who does not want to browse press straight on. See `TASTE_REQUIRED_AXES`.
 */
export type TastePaletteId = ThemeId;

/** Question four: what is on the wall behind the case. */
export type TastePaperId = 'bare' | 'ruled' | 'growing' | 'figured' | 'gilded';

/** Question five: what the app sounds like under their hands. */
export type TasteSoundId = SoundSetGroupId;

export interface TasteAnswers {
  room?: TasteRoomId;
  pitch?: TastePitchId;
  /** Chosen by pressing a card. Absent means "the one the steer picked". */
  palette?: TastePaletteId;
  paper?: TastePaperId;
  sound?: TasteSoundId;
}

/** The five question ids, in the order they are asked. */
export const TASTE_AXES = ['room', 'pitch', 'palette', 'paper', 'sound'] as const;
export type TasteAxis = (typeof TASTE_AXES)[number];

/**
 * The axes a library cannot be dressed without.
 *
 * `palette` is deliberately not one of them. Every other question has no sane
 * default — there is no "average room", no "average wall — but the palette has
 * exactly one: the room the other four answers already resolve to. Requiring it
 * would mean a reader who is happy with what they were shown still has to press
 * the card that is already lit, and a reader who skipped straight to the sound
 * question by pressing a dot would find "dress my library" greyed out with no
 * visibly unanswered question to fix it.
 */
export const TASTE_REQUIRED_AXES = ['room', 'pitch', 'paper', 'sound'] as const;

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
  /**
   * How the option cards are laid out.
   *
   *  - `rooms`   — a handful of big art cards with a name and a line each.
   *  - `palettes`— the whole vocabulary as small drawn swatches, capped with an
   *                "N more" control. The one shape whose option list is longer
   *                than a screenful, and the only one the panel caps.
   *  - `sounds`  — a list with a mark, for the one axis with nothing to draw.
   */
  shape: 'rooms' | 'palettes' | 'sounds';
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

/**
 * The palette question, DERIVED from `art/themes.ts` rather than written out.
 *
 * Sixty options and not a curated eight, because the whole complaint this
 * answers is that four words were standing in front of sixty rooms. A name and
 * the theme's own blurb; the picture is the point and the panel draws it with
 * `drawRoomCard` — the studio's own routine — so a card here cannot describe a
 * room the studio would paint differently.
 *
 * The panel shows `PALETTE_HEAD` of them and offers the rest behind one "N
 * more" control, which is this app's rule for every long list
 * (`DesignStrip.CAP`, and `Capped` is the component both use). Which ones are in
 * that head is `paletteOrder`'s job, and that is where the steer earns its keep.
 */
const PALETTE_QUESTION: TasteQuestion<TastePaletteId> = {
  axis: 'palette',
  title: 'And here is every colour. Pick yours.',
  body: 'Your bookcase and your wall, painted in each one. The palette your answers point at is first and already chosen — press on and you keep it, or press any other and that is the room you get.',
  shape: 'palettes',
  options: THEME_IDS.map((id) => ({
    id,
    // A proper name, left as it is written. Every other option label in this
    // panel is lowercase micro-copy; "Verdigris Library" is not micro-copy, and
    // the ledger, the studio and the settings sheet all call it that already.
    label: THEMES[id].name,
    line: THEMES[id].blurb,
  })),
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

/** The five questions, in the order they are asked. */
export const TASTE_QUESTIONS: readonly TasteQuestion[] = [
  ROOM_QUESTION as TasteQuestion,
  PITCH_QUESTION as TasteQuestion,
  PALETTE_QUESTION as TasteQuestion,
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

/**
 * True once every question that NEEDS an answer has one.
 *
 * `palette` is exempt on purpose — see `TASTE_REQUIRED_AXES`. Skipping it is not
 * a half-finished questionnaire; it is the reader keeping what they were shown.
 */
export function isTasteComplete(answers: TasteAnswers): boolean {
  return TASTE_REQUIRED_AXES.every((axis) => isTasteAnswer(axis, answers[axis]));
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
  /** The colours were swapped away from the preset's own. */
  repainted: boolean;
  /**
   * The colours were POINTED AT rather than worked out.
   *
   * Separate from `repainted` because they answer different questions and the
   * panel says different things about them: `repainted` is "this is not the
   * preset's own palette", `picked` is "you chose this one". A reader who
   * presses the card the preset already wears gets `picked` without `repainted`,
   * and one who never opened the grid gets neither.
   */
  picked: boolean;
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

/**
 * The character words a room answer contributes to a PALETTE decision — its own
 * words, MINUS any that are really about colour and belong to a different pitch.
 *
 * "A reading room" carries `dark`, and `dark` is what "deep" means — so when the
 * reader asked for plenty of colour, the character was quietly voting for a
 * near-black oak and winning, and "deep" and "plenty" showed the same card.
 * Question one owns the room's character; question two owns its colour, and
 * where a word is both, question two has it.
 */
function characterTags(answers: TasteAnswers): readonly ThemeTag[] {
  const words = answers.room === undefined ? [] : ROOM_THEME_TAGS[answers.room];
  const pitch = answers.pitch;
  if (pitch === undefined) return words;
  return words.filter((tag) => !OTHER_PITCH_TAGS[pitch].includes(tag));
}

/**
 * How well ONE palette answers the steer — the two questions asked before it.
 *
 * Shared by `bestTheme` (which takes the argmax) and `paletteOrder` (which sorts
 * on it), and that sharing is the contract the palette grid rests on: the card
 * the resolver would have chosen for you is by construction the first card in
 * the grid, because both are reading the same number. Two functions with two
 * copies of this arithmetic would drift, and the first symptom would be a grid
 * that opens with the second-best palette lit.
 *
 * The pitch is what the swap is FOR, but the character has to stay audible: at a
 * whisper, every "warm" answer in the app resolved to the same dark library
 * brown and a toy box came out looking like a chambers. At 3 a room matching
 * both of its character words outweighs one clean pitch hit, which is the
 * balance a card needs to still look like the room chosen in question one.
 */
function themeAffinity(answers: TasteAnswers, id: ThemeId): number {
  const tags = THEMES[id].tags;
  const pitch = answers.pitch;
  return (
    (pitch === undefined ? 0 : pitchAffinity(tags, pitch)) +
    tagScore(tags, characterTags(answers), 3)
  );
}

function bestTheme(answers: TasteAnswers, fallback: ThemeId): ThemeId {
  if (answers.pitch === undefined) return fallback;
  let best = fallback;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const id of THEME_IDS) {
    const score = themeAffinity(answers, id);
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

  /*
   * A pointed-at palette beats every steer in this file, and it beats them
   * outright rather than by scoring higher.
   *
   * This is the whole difference between the two questions. The pitch answer is
   * a description and the resolver is entitled to interpret it — that is what
   * `bestTheme` and the vetted-preset shortcut under it are for. A card press is
   * not a description; the reader looked at sixty drawings and pointed at one,
   * and there is nothing left to interpret. So the branch is a short-circuit,
   * not another term in the sum: a reader who picks Snowline after answering
   * "deep" gets Snowline, and the panel says so in the ledger.
   *
   * Note what does NOT move with it. The carpentry is still `from` — the preset
   * the character chose — because the vocabularies are orthogonal and repainting
   * a room must not straighten its arches. Picking a palette repaints the room
   * the reader already chose; it does not choose them a different room.
   */
  const picked = isThemeId(answers.palette);
  const answersPitch =
    answers.pitch !== undefined &&
    pitchAffinity(getTheme(from.theme).tags, answers.pitch) >= ANSWERS_PITCH;
  const theme = picked
    ? (answers.palette as ThemeId)
    : answersPitch
      ? from.theme
      : bestTheme(answers, from.theme);
  const repainted = theme !== from.theme;

  const answersPaper =
    answers.paper !== undefined &&
    PAPER_STEER[answers.paper].families.includes(getWallpaper(from.paper).family);
  const paper = answersPaper ? from.paper : bestPaper(answers, from.paper);
  const rehung = paper !== from.paper;

  const changes: string[] = [];
  // "painted" for a choice, "repainted" for a swap the app made. The reader did
  // not repaint anything — they said what colour they wanted.
  if (repainted) {
    changes.push(`${picked ? 'painted' : 'repainted'} in ${getTheme(theme).name}`);
  }
  if (rehung) changes.push(`rehung with ${getWallpaper(paper).name}`);

  return {
    theme,
    build: from.build,
    pattern: from.pattern,
    wallpaper: getWallpaper(paper).spec,
    from,
    paper,
    repainted,
    picked,
    rehung,
    note: changes.length === 0 ? null : changes.join(', '),
  };
}

/* ------------------------- the palette grid's order ----------------------- */

/**
 * How many palette cards the panel shows before the "N more" control.
 *
 * The same twenty every long list in this app caps at (`DesignStrip.CAP`, and
 * the reader's own words there were "after like 20"). Kept as its own constant
 * rather than imported so this module stays DOM-free and node-testable, and
 * pinned against `CAP` by `tests/taste-onboarding.test.ts` so the two cannot
 * drift into two different answers to one reader-stated rule.
 */
export const PALETTE_HEAD = 20;

/**
 * The palette the steer alone would hand over — what the grid opens on.
 *
 * Deliberately resolved with the reader's own pick REMOVED, so it is the answer
 * to "what would you have given me", not "what did I choose". The panel wants
 * both: this one leads the grid and is lit when nothing has been pressed, and
 * `resolveRoom(answers).theme` is what they will actually get.
 */
export function steerTheme(answers: TasteAnswers): ThemeId {
  const steer: TasteAnswers = { ...answers };
  delete steer.palette;
  return resolveRoom(steer).theme;
}

/**
 * Every palette, best answer to the steer first.
 *
 * This is where the steer keeps its job. Sixty cards in an arbitrary order is
 * the same wall of choice the four buckets were hiding, so the two questions
 * already answered ORDER the grid: the palette the resolver would have picked
 * leads, the ones that answer the same words follow, and the rooms that answer
 * the opposite of what was asked sink to the bottom where the "N more" control
 * holds them. Somebody who answers the steer and presses straight on gets the
 * good room; somebody who wants to browse has all sixty, in the order most
 * likely to end the browse quickly.
 *
 * The order is computed from the STEER and never from the pick, so pressing a
 * card cannot reshuffle the grid under the reader's cursor.
 *
 * Total, and stable: ties break on `THEME_IDS` order, which is the studio's own
 * picker order, so a reader who has seen the library studio meets its shelves in
 * the same sequence here.
 */
export function paletteOrder(answers: TasteAnswers): readonly ThemeId[] {
  const lead = steerTheme(answers);
  const rest = THEME_IDS.filter((id) => id !== lead)
    .map((id, at) => ({ id, at, score: themeAffinity(answers, id) }))
    .sort((a, b) => (b.score === a.score ? a.at - b.at : b.score - a.score))
    .map((entry) => entry.id);
  return [lead, ...rest];
}

/**
 * The same room, in another palette. No preset scan.
 *
 * The grid draws sixty of these per render and `resolveRoom` walks all sixty-odd
 * presets each time it is called; sixty times that, twice per card (the cache
 * key and the draw), is four figures of scoring to redraw a grid whose carpentry
 * did not move. Only the colours differ between these cards — that is the whole
 * discipline of the panel, one variable per question — so only the colours are
 * recomputed.
 */
export function repaintedAs(room: TasteRoom, theme: ThemeId): TasteRoom {
  const repainted = theme !== room.from.theme;
  const changes: string[] = [];
  if (repainted) changes.push(`painted in ${getTheme(theme).name}`);
  if (room.rehung) changes.push(`rehung with ${getWallpaper(room.paper).name}`);
  return {
    ...room,
    theme,
    repainted,
    picked: true,
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

/**
 * Which of the four pitches a palette IS, in its own words.
 *
 * The pitch question's inverse, and the reason it exists is the palette grid.
 * The interface colours and the ink are chosen off the pitch ANSWER, which is a
 * description of what the reader wanted; once they have pointed at an actual
 * palette, that description is stale. Answering "deep" and then choosing
 * Snowline used to leave the app in its after-dark interface around a room made
 * of white paint — the app listening to the sentence and ignoring the finger.
 *
 * Scored with `pitchAffinity`, the same function the palette grid orders on, so
 * a palette is classified by exactly the words that put it where it is in the
 * grid. Total: `PITCH_INK` and the branches below cover all four.
 */
export function pitchOfTheme(id: ThemeId): TastePitchId {
  let best: TastePitchId = 'warm';
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const pitch of TASTE_PITCH_IDS) {
    const score = pitchAffinity(THEMES[id].tags, pitch);
    if (score > bestScore) {
      best = pitch;
      bestScore = score;
    }
  }
  return best;
}

/** The interface's colour scheme and ink. */
export function resolveInterface(answers: TasteAnswers): {
  uiTheme: ThemeName;
  ink: string;
} {
  const base: ThemeName = answers.room === undefined ? 'parchment' : ROOM_UI_THEME[answers.room];
  // A pointed-at palette speaks for the pitch answer from here down. See
  // `pitchOfTheme` for why the sentence stops counting once there is a finger.
  const pitch = isThemeId(answers.palette)
    ? pitchOfTheme(answers.palette)
    : answers.pitch;
  /*
   * ONBOARDING NEVER DARKENS THE INTERFACE.
   *
   * This used to answer `pitch === 'deep'` with `uiTheme = 'night'`, on the
   * reasoning that a cream interface around a claret room is the app not
   * listening. The reader disagreed, and gave the better argument:
   *
   *   "For some reason the app chose dark theme for UI without letting me
   *    choose. It should default to normal theme … I don't want a situation
   *    where the user has chosen their themes and it's pretty light, or light
   *    with some dark, and then all of a sudden the UI colour themes become
   *    dark. Personally I would say night theme should not even be an option
   *    during onboarding, but available in settings."
   *
   * The two are different questions and were being answered as one. "Deep" is
   * about the ROOM — the timber, the cloth, the wall a reader is looking at —
   * and wanting a claret library says nothing about wanting the chrome around
   * it inverted. Worse, it is the one taste answer whose consequence a reader
   * cannot see while making it: the room is on screen behind the card, the
   * interface only changes once the tour ends.
   *
   * So `deep` still picks a deep ROOM (see `resolveRoom`, untouched) and the
   * interface stays on the light base. Night is not removed from the app, only
   * from what onboarding may decide on somebody's behalf — all six night themes
   * remain in Settings, which is where a reader choosing dark is choosing it
   * with their eyes open. `tests/taste-onboarding.test.ts` gates this.
   */
  let uiTheme = base;
  if (pitch === 'bright' && base === 'parchment') {
    uiTheme = 'pastel';
  }

  let ink = pitch === undefined ? 'sepia' : PITCH_INK[pitch];
  // A cool room writes in a cool ink whatever the pitch said. Sepia against
  // harbour teal is the one pairing that reads as an oversight.
  if ((answers.room === 'harbour' || answers.room === 'chapter-house') && ink === 'sepia') {
    ink = 'ink-blue';
  }
  return { uiTheme, ink };
}

/**
 * The answers in, a whole library out. Total — every field is filled even
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
