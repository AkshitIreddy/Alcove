/**
 * src/features/packs/categories.ts — the four categories a reader can bring
 * their own work to, and the honest list of the ones they cannot.
 *
 * Every `values` array below is READ from the module that owns the vocabulary
 * rather than typed out. That is the whole anti-drift mechanism: add a
 * fifty-first wallpaper motif in `art/wallpaperDesign.ts` and the importer
 * accepts it, the dialog names it and the AI prompt lists it, on the same
 * commit, without anybody remembering this file exists.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT A "WALLPAPER PACK" ACTUALLY IS, AND WHY IT IS NOT A PICTURE
 * ─────────────────────────────────────────────────────────────────────────
 * The wall is a tiling sprite whose tile is drawn by `renderWallpaperTile`,
 * seamless BY CONSTRUCTION — a torus-aware mark emitter and a lattice fitted
 * to the tile. That is what earned the wall a pattern back after it had been
 * reduced to one flat fill to kill a seam. Hand an arbitrary PNG to the same
 * sprite and the seam returns immediately, at the largest flat area on screen,
 * where the reader looks past it all day.
 *
 * So a reader's wallpaper is a RECIPE — six axes out of the vocabulary the app
 * already draws — and the dialog says exactly that rather than offering an
 * upload button that would produce a visibly broken wall. Three hundred
 * thousand combinations exist and the shipped book hangs a hundred and
 * twenty-six of them; naming your own is not a consolation prize.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY SOUNDS TAKE FILES AND EVERYTHING ELSE TAKES JSON
 * ─────────────────────────────────────────────────────────────────────────
 * A model can write a wallpaper recipe and it can write an SVG. It cannot
 * write a WAV. So the sound prompt asks for a self-contained script that
 * WRITES the files — which is how this repo's own cues are made
 * (`scripts/gen-sounds.mjs`) — and the intake stays the file picker
 * `sound/userSoundSetStore.ts` already built and already tests.
 */

import {
  BUILD_IDS,
  PATTERN_IDS,
} from '../../art/shelfDesign';
import {
  WALLPAPER_DEPTHS,
  WALLPAPER_EDGES,
  WALLPAPER_INKS,
  WALLPAPER_PATTERNS,
  WALLPAPER_SCALES,
  WALLPAPER_TONES,
} from '../../art/wallpaperDesign';
import { FAMILY_NAMES } from '../../sound/engine';
import {
  AUDIO_EXTENSIONS,
  MAX_CUE_BYTES,
  ROLE_LABELS,
  roleVocabulary,
} from '../../sound/userSoundSetStore';
import type {
  PackCategory,
  PackCategoryId,
  UnsupportedCategory,
} from './schema';

/**
 * A sticker's ceiling. Sixty-four kilobytes of SVG is an enormous drawing —
 * every sticker this app ships is under four — and it is small enough that a
 * model which decided to inline a base64 photograph is refused rather than
 * quietly stored.
 */
const MAX_STICKER_BYTES = 64 * 1024;

/* ========================================================================== *
 *                                 wallpaper                                  *
 * ========================================================================== */

const WALLPAPER: PackCategory = {
  id: 'wallpaper',
  title: 'Wallpapers',
  noun: 'wallpaper',
  plural: 'wallpapers',
  blurb: 'papers for the wall behind your bookcases',
  intake: 'manifest',
  fileName: 'alcove-wallpapers.json',
  maxItems: 24,
  fields: [
    {
      kind: 'text',
      key: 'name',
      label: 'what to call it',
      required: true,
      maxLength: 40,
      note: 'shows on the tile in the studio — a name, not a sentence',
    },
    {
      kind: 'text',
      key: 'blurb',
      label: 'one line about it',
      required: false,
      maxLength: 80,
      note: 'appears in the tooltip; leave it out rather than pad it',
    },
    {
      kind: 'enum',
      key: 'pattern',
      label: 'the motif',
      required: true,
      values: WALLPAPER_PATTERNS,
    },
    {
      kind: 'enum',
      key: 'scale',
      label: 'how big the motif is drawn',
      required: true,
      values: WALLPAPER_SCALES,
    },
    {
      kind: 'enum',
      key: 'depth',
      label: 'how much relief it has',
      required: true,
      values: WALLPAPER_DEPTHS,
      note: '"flat" is printed paper; "carved" is plasterwork',
    },
    {
      kind: 'enum',
      key: 'ink',
      label: 'which of the room’s colours the motif is drawn in',
      required: true,
      values: WALLPAPER_INKS,
      note: 'these follow the room, so the paper re-colours when the room does',
    },
    {
      kind: 'enum',
      key: 'tone',
      label: 'a fixed colour for the motif instead',
      required: false,
      values: WALLPAPER_TONES,
      note: 'leave it out for "auto", which lets the room decide',
    },
    {
      kind: 'enum',
      key: 'edge',
      label: 'how sharp the mark is',
      required: false,
      values: WALLPAPER_EDGES,
      note: 'leave it out for "crisp"',
    },
  ],
  howTo: [
    'Copy the prompt below and paste it to any assistant, with a sentence about the room you want — “six papers for a botanist’s study, autumn colours”.',
    'Save what it hands back as a plain .json file.',
    'Press Choose a file and pick it.',
    'Your papers appear under “yours” in the studio’s wallpaper row, and hang on the wall when you press one.',
  ],
  rules: [
    'The file must be JSON and nothing else — no commentary, no markdown fence.',
    'Every word in an enum field must be spelled exactly as listed. There is no “close enough”.',
    'A key that is not on the list is refused, so a typo cannot be quietly dropped.',
    'The whole file is accepted or the whole file is refused; nothing half-imports.',
  ],
  craft: [
    'Vary the SCALE across the pack. Six papers at "medium" all read as the same paper.',
    'A room is mostly wall. One loud paper is a feature; six are a headache.',
    'Leave "tone" out unless you mean it — a paper that follows the room re-colours when the room does, and that is usually the nicer behaviour.',
    '"depth": "carved" earns its keep on lattices and figured motifs, and looks like a mistake on a pinstripe.',
  ],
  example: [
    {
      name: 'Fern Study',
      blurb: 'a botanist’s wall, printed close',
      pattern: 'fern',
      scale: 'small',
      depth: 'low',
      ink: 'timber',
      tone: 'moss',
      edge: 'soft',
    },
    {
      name: 'Long Gallery',
      blurb: 'plaster trellis, deep relief',
      pattern: 'trellis',
      scale: 'grand',
      depth: 'carved',
      ink: 'paper',
    },
    {
      name: 'Hare and Thorn',
      pattern: 'hare',
      scale: 'medium',
      depth: 'flat',
      ink: 'cloth',
      tone: 'sepia',
      edge: 'etched',
    },
  ],
  caveat:
    'A wallpaper here is a recipe, not a picture. The wall tiles seamlessly because the app draws the tile; an uploaded image would show its seam across the widest thing on screen.',
};

/* ========================================================================== *
 *                                 carpentry                                  *
 * ========================================================================== */

const CARPENTRY: PackCategory = {
  id: 'carpentry',
  title: 'Bookcases',
  noun: 'bookcase',
  plural: 'bookcases',
  blurb: 'how a case is built, and what is worked into its timber',
  intake: 'manifest',
  fileName: 'alcove-bookcases.json',
  maxItems: 24,
  fields: [
    {
      kind: 'text',
      key: 'name',
      label: 'what to call it',
      required: true,
      maxLength: 40,
    },
    {
      kind: 'text',
      key: 'blurb',
      label: 'one line about it',
      required: false,
      maxLength: 80,
    },
    {
      kind: 'enum',
      key: 'build',
      label: 'the carpentry — the shape of the case itself',
      required: true,
      values: BUILD_IDS,
    },
    {
      kind: 'enum',
      key: 'pattern',
      label: 'the treatment worked into its timber',
      required: true,
      values: PATTERN_IDS,
      note: '"none" is a real answer, and the right one for a plain case',
    },
  ],
  howTo: [
    'Copy the prompt below and paste it to any assistant, with the room you have in mind.',
    'Save what it hands back as a plain .json file.',
    'Press Choose a file and pick it.',
    'Your cases appear under “yours” in the studio’s bookcase row.',
  ],
  rules: [
    'The file must be JSON and nothing else — no commentary, no markdown fence.',
    'Every word in an enum field must be spelled exactly as listed, including its capitals: `faceFrame`, not `faceframe`.',
    'A key that is not on the list is refused, so a typo cannot be quietly dropped.',
    'The whole file is accepted or the whole file is refused; nothing half-imports.',
  ],
  craft: [
    'A build and a treatment are independent. The interesting pairs are the ones a joiner would not have thought of — plain carpentry with an elaborate enrichment, or the reverse.',
    'Pattern "none" on a busy build is a real choice, not a lazy one.',
    'Name them after rooms rather than after their parts. “Counting House” tells a reader more than “Barrister + Dentil”.',
  ],
  example: [
    { name: 'Vestry Reeded', blurb: 'chapel joinery, quiet flutes', build: 'vestry', pattern: 'reeded' },
    { name: 'Counting Bench', build: 'workbench', pattern: 'cockBead' },
    { name: 'Plain Plank', blurb: 'nothing between you and the books', build: 'plank', pattern: 'none' },
  ],
  caveat:
    'A bookcase here is a pairing of carpentry the app already draws, not new woodwork. New shapes are drawing code, and code cannot arrive in a JSON file.',
};

/* ========================================================================== *
 *                                  stickers                                  *
 * ========================================================================== */

const STICKER: PackCategory = {
  id: 'sticker',
  title: 'Stickers',
  noun: 'sticker',
  plural: 'stickers',
  blurb: 'doodles you can stick anywhere on a page',
  intake: 'manifest',
  fileName: 'alcove-stickers.json',
  maxItems: 30,
  fields: [
    {
      kind: 'text',
      key: 'name',
      label: 'what to call it',
      required: true,
      maxLength: 32,
      note: 'becomes its name in Notebook Script: {sticker=user:your-name}',
    },
    {
      kind: 'svg',
      key: 'svg',
      label: 'the drawing itself',
      required: true,
      maxBytes: MAX_STICKER_BYTES,
      note: 'one complete <svg> element, as a JSON string',
    },
  ],
  howTo: [
    'Copy the prompt below and paste it to any assistant, saying what you want drawn.',
    'Save what it hands back as a plain .json file.',
    'Press Choose a file and pick it.',
    'They land in the catalogue under “your stickers”, alongside the built-in ones.',
    'Already have PNGs or SVGs on disk? Use Choose images instead and skip the JSON entirely.',
  ],
  rules: [
    'Each `svg` must be one complete <svg> element, beginning with <svg and ending with </svg>.',
    'It must carry a viewBox, so it scales with the page instead of arriving at whatever size it was authored.',
    'No <script>, no on… event attributes, and no reference to any external file or URL — a sticker is a drawing, not a program, and one that phones out is refused.',
    'The whole file is accepted or the whole file is refused; nothing half-imports.',
  ],
  craft: [
    'This app is drawn flat: solid colour, ONE dark outline colour on everything, rounded corners, edges that bow very slightly. No gradients-as-lighting, no highlights, no blur, no drop shadows.',
    'Depth is a darker flat shape beside a lighter one — never a shading pass.',
    'A tiny palette beats a rich one. Three or four colours per sticker.',
    'Draw at a size a reader will actually use it: these sit in running text, roughly 28px tall.',
  ],
  example: [
    {
      name: 'acorn',
      svg: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M18 26c4-9 24-9 28 0 1 3-2 4-14 4s-15-1-14-4z" fill="#b7823f" stroke="#3a2a1d" stroke-width="3" stroke-linejoin="round"/><path d="M20 30c1 14 7 22 12 22s11-8 12-22c-6 2-18 2-24 0z" fill="#e8b567" stroke="#3a2a1d" stroke-width="3" stroke-linejoin="round"/><path d="M32 14c0 4-1 7-1 9" fill="none" stroke="#3a2a1d" stroke-width="3" stroke-linecap="round"/></svg>',
    },
    {
      name: 'ink-pot',
      svg: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M16 30c10-3 22-3 32 0 1 9 0 17-2 22-9 2-19 2-28 0-2-5-3-13-2-22z" fill="#3f5d72" stroke="#22303a" stroke-width="3" stroke-linejoin="round"/><path d="M20 28c8-4 16-4 24 0" fill="none" stroke="#22303a" stroke-width="3" stroke-linecap="round"/><path d="M44 12c2 8 1 12-2 16" fill="none" stroke="#22303a" stroke-width="3" stroke-linecap="round"/></svg>',
    },
  ],
  caveat:
    'Stickers are drawings, and the app draws flat. An SVG full of gradients and blur filters will import and will look like it came from somewhere else.',
};

/* ========================================================================== *
 *                                   sounds                                   *
 * ========================================================================== */

const SOUND: PackCategory = {
  id: 'sound',
  title: 'Sounds',
  noun: 'sound set',
  plural: 'sound sets',
  blurb: 'your own recordings, on the app’s own cues',
  intake: 'files',
  fileName: 'a folder of audio files',
  maxItems: FAMILY_NAMES.length,
  fields: [],
  files: {
    extensions: AUDIO_EXTENSIONS,
    maxBytes: MAX_CUE_BYTES,
    partialIsFine: true,
    naming: FAMILY_NAMES.map((role) => ({
      name: role,
      label: ROLE_LABELS[role],
      // The matcher's own vocabulary, minus the exact name, which is listed
      // separately above it. Read from the matcher so the dialog cannot teach
      // a naming rule the importer does not follow.
      alsoAccepts: roleVocabulary(role).filter((word) => word !== role),
    })),
  },
  howTo: [
    'Name each audio file after the moment it should play — `page-flip.wav`, `click-soft.wav`. The full list is below.',
    'Put them all in one folder. The folder’s name becomes the name of your set.',
    'Press Choose files and select them all at once.',
    'Fill as few or as many as you like — every cue you leave out keeps playing the set you based yours on.',
  ],
  rules: [
    `Files must be one of: ${AUDIO_EXTENSIONS.join(', ')}.`,
    `Each file must be under ${Math.round(MAX_CUE_BYTES / (1024 * 1024))} MB — these are button clicks, not tracks.`,
    'A file whose name matches none of the cues below is reported, never guessed at.',
    'Nothing is required. A set with one sound in it is a working set.',
  ],
  craft: [
    'Keep them short. A click that runs past 200ms feels late even when it is on time.',
    'Trim the silence off the front of every file — a leading gap is heard as lag.',
    'Level them against each other, quietest for hovering, loudest for celebration. Nothing in the app conditions your files: they play exactly as you recorded them.',
    'Mono is fine and halves the size.',
  ],
  example: [],
  caveat:
    'Nothing conditions your files. The shipped cues are levelled into one loudness hierarchy at build time; a sample mastered twelve decibels hotter will be twelve decibels hotter.',
};

/* ========================================================================== *
 *                                 the table                                  *
 * ========================================================================== */

/** Every supported category, in the order the dialog offers them. */
export const PACK_CATEGORIES: readonly PackCategory[] = [
  WALLPAPER,
  CARPENTRY,
  STICKER,
  SOUND,
];

const BY_ID = new Map<string, PackCategory>(PACK_CATEGORIES.map((c) => [c.id, c]));

export function isPackCategoryId(value: unknown): value is PackCategoryId {
  return typeof value === 'string' && BY_ID.has(value);
}

/** Total: an unknown id answers null rather than throwing inside an import. */
export function packCategory(id: unknown): PackCategory | null {
  return typeof id === 'string' ? (BY_ID.get(id) ?? null) : null;
}

/**
 * What a reader will reasonably try to upload and cannot, with the reason.
 *
 * Kept next to the supported table on purpose. When one of these becomes
 * possible it moves up rather than being remembered — and until it does, the
 * dialog shows the row greyed with its reason instead of an upload button.
 */
export const UNSUPPORTED_CATEGORIES: readonly UnsupportedCategory[] = [
  {
    title: 'A wallpaper as an image',
    why: 'the wall is one tile repeated across the widest surface on screen, and it is seamless because the app draws the tile. An uploaded picture would show its join.',
    instead: 'Wallpapers, above — fifty motifs across five scales, four reliefs, six ink slots and fifty tones.',
  },
  {
    title: 'Page effects — tape, washi, frames, lifts',
    why: 'an effect is drawing code, not data. There is no set of numbers that describes a new one, so there is nothing a file could carry.',
    instead: 'The catalogue’s tape & trim shelf already offers fifty of each axis.',
  },
  {
    title: 'Book bindings and spine shapes',
    why: 'the same: a binding is a draw function, picked from fifty spine shapes, fifty materials and fifty decorations that the app knows how to paint.',
    instead: 'The book studio, where all one hundred and eighty-nine are pickable by hand.',
  },
  {
    title: 'Fonts and handwriting',
    why: 'the faces are bundled with the app so a page looks the same on a machine that has never seen it. A font loaded from outside would change what an exported PDF looks like without warning.',
  },
  {
    title: 'Cursors',
    why: 'the app does not have custom cursors yet. When it does, they will be drawings, and drawings do arrive in a file — so this one is a “not yet”, not a “no”.',
  },
];
