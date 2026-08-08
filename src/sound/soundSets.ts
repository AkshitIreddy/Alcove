/**
 * src/sound/soundSets.ts — NAMED SOUND SETS: the voicing vocabulary.
 *
 * A room has carpentry and a wallpaper; a book has a binding. This is the
 * third kind of choice, for the ear: a **sound set** is a named character that
 * every interface cue in the app is heard through — the button click, the
 * panel pop, the checkbox, the page turn, the book coming off the shelf, the
 * landing, the crumple, the camera move, the keystroke, the bell.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT A SET IS ALLOWED TO DO, AND WHY IT IS NOT NEW AUDIO
 * ─────────────────────────────────────────────────────────────────────────
 * Every shipped cue is a real CC0 / public-domain recording, sliced and
 * conditioned by `scripts/gen-sounds.mjs`, which re-emits
 * `public/sounds/CREDITS.json` from the same table on every build so the audio
 * and its licences cannot drift apart. One source (the rain bed) is CC BY 4.0
 * and its credit is a shipping obligation.
 *
 * These sets add NO new recordings. Sourcing new material would mean new rows
 * in that table, a network fetch and an ffmpeg decode; instead a set is built
 * entirely by CONDITIONING the cues that already ship, at play time:
 *
 *   SUBSTITUTION  a role is voiced by a different family. The `paper` sets
 *                 press a button with a pencil tap (`tick-hover`) instead of
 *                 a board tap; the `studio` sets use the crisp Kenney blip
 *                 (`pop-soft`) for everything the interface does. This is by
 *                 far the largest lever — it changes the material, not the EQ.
 *   RATE          playback rate, i.e. pitch AND length together. 0.9 is
 *                 heavier and longer, 1.25 is smaller and quicker.
 *   GAIN          an extra trim on top of the reader's own category sliders.
 *   LAYER         a second, quieter cue underneath — a soft thump 130 ms
 *                 under a book coming off the shelf is what makes the
 *                 `library` sets feel like they have weight.
 *   POOL          which half of each family (`plain`/`full`) the set draws
 *                 its takes from.
 *   JITTER        a scale on the per-play pitch/level wobble. 0.2 is a
 *                 machine; 2.4 is a wind-up toy.
 *   FILTER        real BiquadFilterNodes wrapped by Pixi Sound's public
 *                 `filtersAll` surface. It is genuinely per-SET rather than
 *                 per-role because every cue reaches that master chain.
 *
 * Only seven sets carry one, and that is a judgement rather than a limit: the
 * cues are conditioned once by `gen-sounds.mjs` against measured centroid and
 * high-share ceilings, so a filter on top is only worth its risk where the
 * set's own blurb already promises a tone that rate and gain cannot deliver —
 * "as if it were all happening in the next room" is a lowpass and nothing
 * else. The rest of the table leaves the mastered voicing alone.
 *
 * Because nothing here writes a file, the credits stay exactly as
 * `gen-sounds.mjs` left them: a derived cue carries the provenance of the
 * recording it is derived from, which is the recording the set plays.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE TABLE'S SHAPE: DEPARTURES, NOT COPIES
 * ─────────────────────────────────────────────────────────────────────────
 * A voice is resolved in three layers — the house default, then the group's
 * departures, then the set's. The house default for a role is DERIVED
 * (`{ cue: <the role's own family>, rate: 1, gain: 1 }`), never restated, so
 * a family added to the engine is voiced by every set on the day it lands.
 * A group or set may also carry a flat `rate`/`gain` multiplier, which is how
 * "the same room half a step down" is one number rather than thirteen.
 *
 * `null` in a voice table means SILENT for that role — that is how the `hush`
 * family drops the hover tick and the camera whoosh entirely.
 *
 * Nothing in here imports the engine at runtime (types only), so the engine
 * can import this table without a cycle.
 */

import { NO_BUS_FILTER, type BusFilter } from './filter';
import type { FamilyName, VariantWeight } from './engine';

/* ─────────────────────────────── the shapes ─────────────────────────────── */

/** A second cue played under the first. Never used on a role that repeats fast. */
export interface LayerSpec {
  readonly cue: FamilyName;
  readonly rate?: number;
  readonly gain?: number;
  readonly delayMs?: number;
}

/** One role's departure from the house voicing. Every field is optional. */
export interface VoiceSpec {
  /** Which family actually sounds. Omitted ⇒ the role's own family. */
  readonly cue?: FamilyName;
  readonly rate?: number;
  readonly gain?: number;
  readonly layer?: LayerSpec;
}

/**
 * Role ⇒ departure. A role IS a family name: the family a role is named after
 * is the house cue for it, which is what keeps `play('book-pull')` at every
 * call site meaning "the book-coming-off-the-shelf role" without a second
 * index to fold differently.
 *
 * `null` ⇒ that role is silent in this set.
 */
export type VoiceTable = Partial<Record<FamilyName, VoiceSpec | null>>;

/** Departures shared by a whole family of sets. */
export interface SoundSetGroup {
  readonly name: string;
  readonly blurb: string;
  readonly rate?: number;
  readonly gain?: number;
  readonly jitterScale?: number;
  readonly pool?: VariantWeight | 'all';
  readonly voices?: VoiceTable;
  /** A master-bus biquad chain. See `sound/filter.ts`. */
  readonly filter?: BusFilter;
}

export interface SoundSetSpec {
  readonly id: string;
  readonly name: string;
  readonly group: SoundSetGroupId;
  readonly blurb: string;
  readonly rate?: number;
  readonly gain?: number;
  readonly jitterScale?: number;
  readonly pool?: VariantWeight | 'all';
  readonly voices?: VoiceTable;
  /**
   * A master-bus biquad chain, REPLACING the group's rather than compounding
   * with it — unlike `rate` and `gain`, which are scalars and multiply.
   * Two lowpasses in series is not "a bit more lowpass", it is a 24 dB/oct
   * slope at a corner neither table chose, so a set that wants a different
   * tone from its family states the whole chain.
   */
  readonly filter?: BusFilter;
}

/** A fully resolved voice — what the engine actually plays. */
export interface SoundVoice {
  readonly cue: FamilyName;
  readonly rate: number;
  readonly gain: number;
  readonly layer: SoundLayer | null;
}

export interface SoundLayer {
  readonly cue: FamilyName;
  readonly rate: number;
  readonly gain: number;
  readonly delayMs: number;
}

/* ────────────────────────────── the groups ──────────────────────────────── */

export type SoundSetGroupId =
  | 'house'
  | 'paper'
  | 'library'
  | 'chamber'
  | 'studio'
  | 'hush'
  | 'whimsy';

/**
 * The seven characters, in the order the picker lays them out. `house` opens
 * because it is the default and the thing every other set is a departure from.
 */
export const SOUND_SET_GROUPS: Record<SoundSetGroupId, SoundSetGroup> = {
  house: {
    name: 'House',
    blurb: 'the voicing every cue was mastered as, and three steps either side',
    voices: {
      /*
       * FINISHING SOMETHING IS WOOD, NOT METAL.
       *
       * The reader, on the tour: "the sound effects for onboarding when
       * completing a task is very weird, its like a metal tong". That is not
       * a figure of speech — `check-done`'s four takes are literally a struck
       * metal bell (`gen-sounds.mjs`: `src: ['bell', n]`, credited to
       * opengameart's "Bell dings/chimes"), and the tour rings it at
       * `TutorialOverlay.markDone` the moment the reader does the thing.
       *
       * Metal is the one material this app does not otherwise own. The room
       * is parchment, board and cloth; the shipped cues are a wooden desk
       * drawer, Russian dolls, cracking peanuts, paper, a book landing. A
       * bell in the middle of that reads as a notification from another
       * application — and the bell already HAS a job here, the hour, which is
       * exactly what it should stay the sound of.
       *
       * So the house voicing answers "done" the way this room would: a
       * wooden tap a little lower and slower than the one that OPENS a panel,
       * with a soft thump under it 80 ms later. The tap says an event
       * happened; the thump says it settled and is staying. That pairing is
       * the same lever the `library` family uses to give the shelf weight.
       *
       * This is a departure on the HOUSE GROUP, which `resolveVoice` reads
       * only for sets in that group — so it re-voices the four house sets
       * (including the default, which is what a reader who has never opened
       * the picker hears) and touches nothing else. The bell FILES are
       * untouched: `chamber` still rings, and its `drop-thump` layer still
       * reaches for `check-done`'s takes by name.
       */
      'check-done': {
        cue: 'pop-soft',
        rate: 0.96,
        gain: 1,
        layer: { cue: 'drop-thump', rate: 0.9, gain: 0.3, delayMs: 80 },
      },
    },
  },

  /* Graphite, leaf and desk. The distinguishing rule: nothing in this family
   * rings. The checkbox is a fingertip on a board, opening a panel is a page
   * lifting, and a button is a pencil tap — the SAME pencil recording the
   * hover tick comes from, but the keystroke slice, which was mastered 9 dB
   * louder and so can carry a press without borrowing headroom. */
  paper: {
    name: 'Paper',
    blurb: 'graphite, leaf and desk — nothing in this family rings',
    voices: {
      'click-soft': { cue: 'typing-tick', gain: 0.5 },
      'tick-hover': { gain: 0.8 },
      'pop-soft': { cue: 'page-flip', rate: 1.08, gain: 0.35 },
      'check-done': { cue: 'click-soft', rate: 1.06 },
      // A celebration stays a celebration in every audible set. Substituting
      // a book riffle here made the same confetti effect sound like somebody
      // handling paper off-screen.
      confetti: { cue: 'confetti', rate: 1.05, gain: 0.72 },
      'drop-thump': { rate: 1.02, gain: 0.8 },
      'chime-hour': { rate: 0.99, gain: 0.8 },
      'shelf-whoosh': { gain: 0.9 },
    },
  },

  /* The room and its weight. Everything sits a little lower and slower, and
   * the two book gestures carry a thump underneath them — the one thing that
   * makes a shelf feel like it holds objects rather than sprites. */
  library: {
    name: 'Library',
    blurb: 'boards, shelves and weight — things land',
    rate: 0.94,
    voices: {
      'pop-soft': { rate: 0.96, gain: 0.85 },
      'check-done': { rate: 0.98, gain: 0.85 },
      'book-pull': { layer: { cue: 'drop-thump', rate: 0.92, gain: 0.35, delayMs: 130 } },
      'book-return': { layer: { cue: 'drop-thump', rate: 0.9, gain: 0.42, delayMs: 160 } },
      'drop-thump': { rate: 0.96 },
      'shelf-whoosh': { rate: 0.98 },
    },
  },

  /* The family that rings. The bell answers what you finish, and a very small
   * one sits under a book landing — the signature that tells the two heavier
   * families apart by ear. `check-done` keeps its mastered level: it is
   * already the loudest cue in the set, so this family rings by putting bells
   * in MORE places rather than by turning one up. */
  chamber: {
    name: 'Chamber',
    blurb: 'bells and resonance — the family that rings',
    voices: {
      'click-soft': { rate: 1.08, gain: 0.95 },
      'pop-soft': { rate: 1.04 },
      'drop-thump': {
        rate: 0.98,
        gain: 0.9,
        layer: { cue: 'check-done', rate: 1.4, gain: 0.16, delayMs: 60 },
      },
      'page-flip': { rate: 1.02 },
    },
  },

  /* Crisp modern interface. The Kenney blips lead, the jitter is nearly off
   * (repeatability IS the character here) and only the plain, shorter takes
   * are in play. */
  studio: {
    name: 'Studio',
    blurb: 'crisp modern interface — tight, fast, near-identical every press',
    rate: 1.1,
    jitterScale: 0.5,
    pool: 'plain',
    // The one thing rate could not do for this family. Playing a cue 10%
    // faster shifts its whole spectrum up, body included; a 200 Hz highpass
    // takes the body away and leaves the rest where it was mastered, which is
    // what "small" actually means. Q at the Butterworth default: a resonant
    // corner would put a bump exactly where a book thump lives.
    filter: [{ type: 'highpass', frequency: 200, q: 0.707 }],
    voices: {
      'click-soft': { cue: 'pop-soft', rate: 1.06, gain: 0.7 },
      'tick-hover': { cue: 'pop-soft', rate: 1.34, gain: 0.22 },
      // Two blips, low then high. Everything in this family is the same
      // recording, so level alone would leave "a panel opened" and "you ticked
      // a box" indistinguishable — measured at 273 ms/394 Hz against
      // 310 ms/347 Hz, which is not a difference anyone hears. The rising pair
      // is what a modern interface actually does to say "done".
      'check-done': {
        cue: 'pop-soft',
        rate: 0.92,
        gain: 0.9,
        layer: { cue: 'pop-soft', rate: 1.45, gain: 0.55, delayMs: 110 },
      },
      confetti: {
        cue: 'confetti',
        rate: 1.1,
        gain: 0.78,
      },
      'page-flip': { gain: 0.85 },
      'book-pull': { gain: 0.85 },
      'book-return': { gain: 0.85 },
      'drop-thump': { gain: 0.85 },
      'crumple-delete': { gain: 0.85 },
      'typing-tick': { gain: 0.85 },
    },
  },

  /* As close to silence as the app gets. The decorative layer is gone, the
   * crisp blip is replaced by the small board tap, and everything is roughly
   * half the level of the house set. */
  hush: {
    name: 'Hush',
    blurb: 'as close to silence as the app gets',
    gain: 0.55,
    jitterScale: 0.5,
    pool: 'plain',
    // Quiet and dull are different things and this family wants both. The
    // group's 0.55 gain is the quiet; a 4 kHz lid is the dull. It sits well
    // above the 3% high-share ceiling `gen-sounds.mjs` already holds the cues
    // to, so this takes off air rather than substance.
    filter: [{ type: 'lowpass', frequency: 4000, q: 0.707 }],
    voices: {
      'tick-hover': null,
      'shelf-whoosh': null,
      confetti: null,
      // 1.5 and 1.25 look like they break the ≤ 1 rule and do not: the group's
      // own 0.55 is the outer multiplier, so these resolve to 0.83 and 0.69.
      // Opening a panel has to stay clear of pressing a button even when both
      // are the same recording, and that gap is the only thing carrying it.
      'pop-soft': { cue: 'click-soft', rate: 0.98, gain: 1.5 },
      'check-done': { cue: 'click-soft', rate: 1.12, gain: 1.25 },
      'page-flip': { rate: 0.98 },
    },
  },

  /* Light, springy and pitched up, with a wide wobble between takes so two
   * presses in a row are audibly two presses. */
  whimsy: {
    name: 'Whimsy',
    blurb: 'light, springy and a little toy-like',
    rate: 1.18,
    jitterScale: 1.6,
    voices: {
      'click-soft': { cue: 'pop-soft', rate: 1.08, gain: 0.7 },
      'pop-soft': { rate: 1.03, gain: 0.95 },
      'check-done': { cue: 'confetti', rate: 1.02, gain: 0.7 },
      'tick-hover': { rate: 1.1 },
      'drop-thump': {
        gain: 0.9,
        layer: { cue: 'pop-soft', rate: 1.26, gain: 0.25, delayMs: 45 },
      },
    },
  },
};

export const SOUND_SET_GROUP_IDS = Object.keys(SOUND_SET_GROUPS) as readonly SoundSetGroupId[];

/* ─────────────────────────────── the sets ───────────────────────────────── */

/**
 * Twenty-eight sets, four per character. Order is the picker's order: the
 * house voicing first, then each family from its most typical member outwards.
 *
 * `as const` so the id union below is DERIVED from this list rather than
 * written out a second time — the one place this table could go stale.
 */
const SET_LIST = [
  /* ── house ───────────────────────────────────────────────────────────── */
  {
    id: 'house',
    name: 'House',
    group: 'house',
    blurb: 'the set as recorded — warm, even, nothing pushed',
  },
  {
    id: 'house-soft',
    name: 'House, Softer',
    group: 'house',
    blurb: 'the house voicing with everything a quarter down',
    gain: 0.75,
    jitterScale: 0.8,
  },
  {
    id: 'house-bright',
    name: 'House, Brighter',
    group: 'house',
    blurb: 'the house cues a touch higher and quicker',
    rate: 1.08,
  },
  {
    id: 'house-wide',
    name: 'House, Wider',
    group: 'house',
    blurb: 'the house cues, with far more variation between two presses',
    jitterScale: 1.9,
  },

  /* ── paper ───────────────────────────────────────────────────────────── */
  {
    id: 'loose-leaf',
    name: 'Loose Leaf',
    group: 'paper',
    blurb: 'a single sheet lifted — pencil taps, and no bell anywhere',
    voices: { 'page-flip': { rate: 1.04 } },
  },
  {
    id: 'writing-desk',
    name: 'Writing Desk',
    group: 'paper',
    blurb: 'graphite on a wooden desk; ticking a box is a fingertip',
    voices: {
      'click-soft': { cue: 'typing-tick', rate: 0.94, gain: 0.5 },
      'tick-hover': { rate: 0.96, gain: 0.75 },
      'check-done': {
        cue: 'click-soft',
        rate: 0.98,
        layer: { cue: 'tick-hover', rate: 0.92, gain: 0.5, delayMs: 45 },
      },
    },
  },
  {
    id: 'margin-note',
    name: 'Margin Note',
    group: 'paper',
    blurb: 'everything one size smaller; the camera moves in silence',
    voices: {
      'pop-soft': { cue: 'click-soft', rate: 1.05, gain: 0.8 },
      'page-flip': { rate: 1.06, gain: 0.8 },
      'book-pull': { cue: 'page-flip', rate: 0.94, gain: 0.95 },
      'book-return': { cue: 'page-flip', rate: 0.9, gain: 0.95 },
      'shelf-whoosh': null,
    },
  },
  {
    id: 'pressed-flowers',
    name: 'Pressed Flowers',
    group: 'paper',
    blurb: 'the whole set slowed and pressed flat — nothing is sudden',
    rate: 0.94,
    gain: 0.72,
    jitterScale: 0.6,
    pool: 'plain',
    // "Pressed flat" is a tone, not a speed. 2.6 kHz is under every cue's
    // mastered centroid, so this is the one set in the paper family whose
    // pencil taps genuinely lose their edge rather than just slowing down.
    filter: [{ type: 'lowpass', frequency: 2600, q: 0.707 }],
    voices: { 'crumple-delete': { rate: 0.94 } },
  },

  /* ── library ─────────────────────────────────────────────────────────── */
  {
    id: 'reading-room',
    name: 'Reading Room',
    group: 'library',
    blurb: 'a low room with a long table — every book lands',
  },
  {
    id: 'oak-stacks',
    name: 'Oak Stacks',
    group: 'library',
    blurb: 'deeper timber; the shelves are full and the drop is dull',
    rate: 0.94,
    // Timber is a shape: a lid on the air plus weight underneath it. The
    // low shelf is +3 dB and not more because the bus sits after the reader's
    // master fader — a boost here can only spend headroom the mix left.
    filter: [
      { type: 'lowpass', frequency: 4400, q: 0.707 },
      { type: 'lowshelf', frequency: 180, gain: 3 },
    ],
    voices: {
      'drop-thump': { rate: 0.92 },
      'book-pull': { layer: { cue: 'drop-thump', rate: 0.88, gain: 0.45, delayMs: 140 } },
      'crumple-delete': { rate: 0.96 },
    },
  },
  {
    id: 'map-room',
    name: 'Map Room',
    group: 'library',
    blurb: 'wide sheets and drawers — a panel opens like a sheet drawn out',
    voices: {
      'pop-soft': { cue: 'book-pull', rate: 1.1, gain: 0.5 },
      'page-flip': { rate: 1.05 },
      'crumple-delete': { rate: 1.02 },
      'shelf-whoosh': { rate: 1.06 },
    },
  },
  {
    id: 'night-porter',
    name: 'Night Porter',
    group: 'library',
    blurb: 'the same room with the lamps off — half a step down, no hover',
    gain: 0.6,
    jitterScale: 0.8,
    voices: { 'tick-hover': null, 'shelf-whoosh': null },
  },

  /* ── chamber ─────────────────────────────────────────────────────────── */
  {
    id: 'brass-bell',
    name: 'Brass Bell',
    group: 'chamber',
    blurb: 'a small brass bell answers anything you finish',
  },
  {
    id: 'cloister',
    name: 'Cloister',
    group: 'chamber',
    blurb: 'the same bells lower and longer, ringing into stone',
    // Stone is a low-mid room. The peak at 900 Hz is the only thing in this
    // table that adds a resonance rather than removing one, and it is the
    // difference between "the same bells slower" (which `rate` already did)
    // and bells in a hard room.
    filter: [
      { type: 'lowpass', frequency: 5000, q: 0.707 },
      { type: 'peaking', frequency: 900, q: 1.1, gain: 3 },
    ],
    voices: {
      'check-done': { rate: 0.86 },
      confetti: { rate: 0.88 },
      'chime-hour': { rate: 0.9 },
      'pop-soft': { rate: 0.94 },
      'drop-thump': {
        rate: 0.94,
        gain: 0.95,
        layer: { cue: 'check-done', rate: 1.05, gain: 0.14, delayMs: 80 },
      },
    },
  },
  {
    id: 'music-box',
    name: 'Music Box',
    group: 'chamber',
    blurb: 'tiny high bells — a music box somewhere under the desk',
    // Tiny is the absence of a body. Rate alone made the bells higher AND
    // kept every gram of their low end, which is why this set used to read as
    // "the same bells, sped up" rather than as something small.
    filter: [
      { type: 'highpass', frequency: 520, q: 0.707 },
      { type: 'peaking', frequency: 3200, q: 1.2, gain: 3 },
    ],
    voices: {
      'check-done': { rate: 1.3, gain: 0.85 },
      confetti: { rate: 1.34, gain: 0.8 },
      'pop-soft': { rate: 1.2, gain: 0.85 },
      'tick-hover': { rate: 1.25 },
      'chime-hour': { rate: 1.2, gain: 0.8 },
    },
  },
  {
    id: 'carillon',
    name: 'Carillon',
    group: 'chamber',
    blurb: 'the panels ring too — the loudest set in the app',
    voices: {
      'pop-soft': { cue: 'check-done', rate: 1.18, gain: 0.45 },
      confetti: { cue: 'confetti', rate: 1.12, gain: 0.7 },
      'chime-hour': { rate: 0.96 },
    },
  },

  /* ── studio ──────────────────────────────────────────────────────────── */
  {
    id: 'drafting-table',
    name: 'Drafting Table',
    group: 'studio',
    blurb: 'crisp and quick — the interface answers before you finish clicking',
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    group: 'studio',
    blurb: 'the tightest set — almost no difference between two presses',
    rate: 1.03,
    gain: 0.78,
    jitterScale: 0.2,
  },
  {
    id: 'glass-desk',
    name: 'Glass Desk',
    group: 'studio',
    blurb: 'a few semitones up again — small, bright and glassy',
    rate: 1.08,
    // Replaces the studio group's plain 200 Hz highpass: glass is higher and
    // brighter than the family default, so the corner moves up and a shelf
    // comes in above 4 kHz.
    filter: [
      { type: 'highpass', frequency: 260, q: 0.707 },
      { type: 'highshelf', frequency: 4200, gain: 3 },
    ],
    voices: {
      'click-soft': { cue: 'pop-soft', rate: 1.12, gain: 0.6 },
      'check-done': {
        cue: 'pop-soft',
        rate: 1.02,
        gain: 0.9,
        layer: { cue: 'pop-soft', rate: 1.5, gain: 0.5, delayMs: 90 },
      },
    },
  },
  {
    id: 'steel-nib',
    name: 'Steel Nib',
    group: 'studio',
    blurb: 'modern chrome, paper interior — the books are not synthetic',
    voices: {
      // 0.909 × the group's 1.1 puts the paper cues back at house speed while
      // the interface chrome stays fast. Derived from the group, not guessed.
      'page-flip': { rate: 0.909, gain: 1 },
      'book-pull': { rate: 0.909, gain: 1 },
      'book-return': { rate: 0.909, gain: 1 },
      'drop-thump': { rate: 0.909, gain: 1 },
      'crumple-delete': { rate: 0.909, gain: 1 },
    },
  },

  /* ── hush ────────────────────────────────────────────────────────────── */
  {
    id: 'quiet-hours',
    name: 'Quiet Hours',
    group: 'hush',
    blurb: 'only what an action needs, at about half the level',
  },
  {
    id: 'far-room',
    name: 'Far Room',
    group: 'hush',
    blurb: 'as if it were all happening in the next room',
    rate: 0.94,
    gain: 0.7,
    // The set this whole module was worth building for. A wall between you
    // and a sound is a lowpass and nothing else: quieter and slower is a
    // smaller, later sound in THIS room, which is what 0.7 gain and 0.94 rate
    // were achieving on their own, and it never once read as distance.
    // 1.5 kHz is deep — the deepest in the table — because that is where a
    // door actually sits.
    filter: [{ type: 'lowpass', frequency: 1500, q: 0.8 }],
  },
  {
    id: 'paper-only',
    name: 'Paper Only',
    group: 'hush',
    blurb: 'one material for everything — a page moving, at every size',
    voices: {
      'click-soft': { cue: 'page-flip', rate: 1.22, gain: 0.55 },
      'pop-soft': { cue: 'page-flip', rate: 1.1, gain: 0.8 },
      'check-done': { cue: 'page-flip', rate: 1.28, gain: 0.9 },
      'drop-thump': { cue: 'book-return', rate: 0.95, gain: 0.9 },
      'crumple-delete': { cue: 'page-flip', rate: 0.88, gain: 1 },
    },
  },
  {
    id: 'almost-nothing',
    name: 'Almost Nothing',
    group: 'hush',
    blurb: 'buttons say nothing at all; only books and pages are heard',
    gain: 0.8,
    voices: {
      'click-soft': null,
      'pop-soft': null,
      'check-done': null,
      'typing-tick': null,
    },
  },

  /* ── whimsy ──────────────────────────────────────────────────────────── */
  {
    id: 'paper-birds',
    name: 'Paper Birds',
    group: 'whimsy',
    blurb: 'light and quick, pitched up, with a sparkle on every tick',
  },
  {
    id: 'sweet-shop',
    name: 'Sweet Shop',
    group: 'whimsy',
    blurb: 'small high bells on very nearly everything',
    voices: {
      'check-done': { rate: 1.14, gain: 0.85 },
      'pop-soft': { cue: 'check-done', rate: 1.22, gain: 0.6 },
      confetti: { rate: 1.1 },
    },
  },
  {
    id: 'wind-up',
    name: 'Wind-Up',
    group: 'whimsy',
    blurb: 'wound a shade too tight — the widest wobble in the app',
    rate: 1.05,
    jitterScale: 2.4,
    voices: { 'click-soft': { cue: 'pop-soft', rate: 1.12, gain: 0.65 } },
  },
  {
    id: 'flip-book',
    name: 'Flip Book',
    group: 'whimsy',
    blurb: 'the interface flicked through like a flip book',
    voices: {
      'click-soft': { cue: 'page-flip', rate: 1.14, gain: 0.4 },
      'pop-soft': { cue: 'page-flip', rate: 1.04, gain: 0.55 },
      'check-done': {
        cue: 'page-flip',
        rate: 1.18,
        gain: 0.65,
        layer: { cue: 'confetti', rate: 1.08, gain: 0.28, delayMs: 40 },
      },
    },
  },
] as const satisfies readonly SoundSetSpec[];

/** Derived from the list above — never written out twice. */
export type SoundSetId = (typeof SET_LIST)[number]['id'];

export const SOUND_SET_IDS = SET_LIST.map((s) => s.id) as readonly SoundSetId[];

export const SOUND_SETS = Object.fromEntries(
  SET_LIST.map((s) => [s.id, s]),
) as Record<SoundSetId, SoundSetSpec>;

/**
 * The house voicing. Deliberately the identity set: the cues were mastered
 * together — one warmth ceiling per cue, one loudness hierarchy across the
 * whole set — and pushing that around by default would be arguing with the
 * pipeline that produced it. Every other set is a departure from here.
 */
export const DEFAULT_SOUND_SET_ID: SoundSetId = 'house';

/**
 * One set per character, in group order — what the picker shows before the
 * reader asks for all of them. Derived from the group order and the set list,
 * so a new group is represented the moment it has a member.
 */
export const SOUND_SET_SHORTLIST: readonly SoundSetId[] = SOUND_SET_GROUP_IDS.map(
  (group) => SET_LIST.find((s) => s.group === group)?.id,
).filter((id): id is SoundSetId => id !== undefined);

/** Every set in one group, in table order. */
export function soundSetsInGroup(group: SoundSetGroupId): readonly SoundSetId[] {
  return SET_LIST.filter((s) => s.group === group).map((s) => s.id) as readonly SoundSetId[];
}

export function isSoundSetId(value: unknown): value is SoundSetId {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(SOUND_SETS, value);
}

/** Total: junk out of SQLite gives the house set, never a throw. */
export function resolveSoundSetId(value: unknown): SoundSetId {
  return isSoundSetId(value) ? value : DEFAULT_SOUND_SET_ID;
}

/* ───────────────────────────── resolution ───────────────────────────────── */

/**
 * Rate bounds. The backend accepts a much wider range; this narrow window is a
 * musical judgement — past a quarter either way a page turn stops sounding
 * like paper — and it is also what makes the two multiplier layers safe to
 * compound without anyone having to check the product by hand.
 */
const RATE_MIN = 0.5;
const RATE_MAX = 2;
const GAIN_MAX = 4;

const clampRate = (v: number): number =>
  !Number.isFinite(v) ? 1 : v < RATE_MIN ? RATE_MIN : v > RATE_MAX ? RATE_MAX : v;

const clampGain = (v: number): number =>
  !Number.isFinite(v) ? 1 : v < 0 ? 0 : v > GAIN_MAX ? GAIN_MAX : v;

/**
 * Look a role up in one table.
 *   undefined — the table says nothing (fall through to the layer below)
 *   null      — the table says SILENT
 */
function lookup(table: VoiceTable | undefined, role: FamilyName): VoiceSpec | null | undefined {
  if (table === undefined) return undefined;
  if (!Object.prototype.hasOwnProperty.call(table, role)) return undefined;
  return table[role] ?? null;
}

/**
 * Memo of the resolved voice per (set, role).
 *
 * The key carries a separator, which is not a formality: ids and family names
 * both contain hyphens, and a key built by concatenation alone would let
 * ('house-soft', 'click') collide with ('house', 'soft-click') on the day
 * either name grows a segment. Nothing would fail — the wrong voice would
 * just be served for the rest of the session.
 */
const voiceMemo = new Map<string, SoundVoice | null>();

/**
 * The voice a set gives a role, or null when the set silences it. Total for
 * any input: an unknown set id resolves to the house set.
 */
export function resolveVoice(setId: SoundSetId, role: FamilyName): SoundVoice | null {
  const id = resolveSoundSetId(setId);
  const key = `${id}|${role}`;
  const cached = voiceMemo.get(key);
  if (cached !== undefined) return cached;

  const set = SOUND_SETS[id];
  const group = SOUND_SET_GROUPS[set.group];
  const own = lookup(set.voices, role);
  const spec = own !== undefined ? own : lookup(group.voices, role);

  let voice: SoundVoice | null;
  if (spec === null) {
    voice = null;
  } else {
    const s: VoiceSpec = spec ?? {};
    const rateMul = (group.rate ?? 1) * (set.rate ?? 1);
    const gainMul = (group.gain ?? 1) * (set.gain ?? 1);
    const layer = s.layer;
    voice = {
      cue: s.cue ?? role,
      rate: clampRate((s.rate ?? 1) * rateMul),
      gain: clampGain((s.gain ?? 1) * gainMul),
      layer:
        layer === undefined
          ? null
          : {
              cue: layer.cue,
              rate: clampRate((layer.rate ?? 1) * rateMul),
              gain: clampGain((layer.gain ?? 1) * gainMul),
              delayMs: Math.max(0, Math.min(600, Math.round(layer.delayMs ?? 0))),
            },
    };
  }
  voiceMemo.set(key, voice);
  return voice;
}

/** Which half of each family this set draws from ('all' ⇒ leave it to the character). */
export function soundSetPool(setId: SoundSetId): VariantWeight | 'all' {
  const set = SOUND_SETS[resolveSoundSetId(setId)];
  return set.pool ?? SOUND_SET_GROUPS[set.group].pool ?? 'all';
}

/**
 * The master-bus chain this set asks for — the set's own, else its group's,
 * else nothing. REPLACING, not compounding: see `SoundSetSpec.filter`.
 */
export function soundSetFilter(setId: SoundSetId): BusFilter {
  const set = SOUND_SETS[resolveSoundSetId(setId)];
  return set.filter ?? SOUND_SET_GROUPS[set.group].filter ?? NO_BUS_FILTER;
}

/** Multiplier on the character's per-play pitch/level wobble. */
export function soundSetJitterScale(setId: SoundSetId): number {
  const set = SOUND_SETS[resolveSoundSetId(setId)];
  const scale = set.jitterScale ?? SOUND_SET_GROUPS[set.group].jitterScale ?? 1;
  return Number.isFinite(scale) && scale >= 0 ? Math.min(scale, 4) : 1;
}

/** Display name / blurb for the picker. Total. */
export function soundSetSpec(setId: SoundSetId): SoundSetSpec {
  return SOUND_SETS[resolveSoundSetId(setId)];
}
