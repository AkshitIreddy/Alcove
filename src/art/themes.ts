/**
 * art/themes.ts — the library's colour schemes.
 *
 * A theme is a NAME, a blurb, a handful of tags and a set of colours. That is
 * the whole of it, and the smallness is the point.
 *
 * The old shape described a room the way a set designer would: a wood palette
 * with grain frequency and ring gamma, a joinery vocabulary, a cornice profile
 * and its carving, a rail inlay, a floor-plate material, a wallpaper pattern
 * crossed with a colourway, a wall finish, a light rig, a flora planting plan,
 * a prop shortlist, dust motes. Fourteen rooms of it. None of it drew anything:
 * the flat restyle (`art/flat.ts`) bakes ONE case out of a fixed set of shapes,
 * so every room came out identical and the picker only changed a seed. Data
 * that describes art nobody renders is worse than no data — it reads like a
 * promise, and every reader has to discover the hard way that it is not kept.
 *
 * So a theme carries exactly what flat art can honestly vary: the colours.
 * Same shapes, same ink, same ornament — a different palette on them. Pick
 * `Coral Reef` and the case really is sea-green with coral cloth on it.
 *
 * ## Why there are sixty of them and only four before
 *
 * Four was a deliberate ceiling that turned out to be the wrong one. Four rooms
 * is not a decorating scheme, it is a radio button, and three of the four were
 * variations on warm wood — the library read as one room with the lights
 * changed. Sixty is a different kind of thing: you can go looking for the room
 * you had in mind and find it, which is what "make it yours" has to mean.
 *
 * What made four expensive was that every room was sixteen hexes mixed by eye,
 * and the JOINERY paid for it. Where a board's lit face meets the same board
 * turning away, the flat style has nothing but a colour step to say "this is
 * one piece of wood, folding". Hand-mixed pairs drift in hue and saturation as
 * well as lightness, so the fold stopped reading as a fold and started reading
 * as two objects butted together — the single ugliest thing in the app. Every
 * room below is therefore authored as ONE timber colour and ONE wall, and the
 * faces that turn away are DERIVED in OKLCh by `art/palette.ts`, with the same
 * measured step everywhere. Sixty rooms, one carpenter.
 *
 * ## What is NOT in here
 *
 * Nothing that describes art. There are no per-room shapes, no ornament, no
 * light. `family` and `tags` are the two exceptions and they earn it: both are
 * consumed — the family groups the picker, the tags steer "surprise me"
 * (`views/rail/designOptions.ts` reads them structurally). Neither is drawn.
 *
 * The bake cache key spreads every hex of a scheme (`libraryKey.ts`), so a new
 * room, or a nudged hex in an old one, invalidates the case art on disk by
 * construction. Adding a room needs nothing else.
 *
 * This module is the TYPE + DATA root of the theme system. It imports only
 * `art/palette.ts` — arithmetic, no data, no cycle — so every other art module
 * can still depend on it freely. `ColourScheme` is structurally identical to
 * the scheme `art/flat.ts` applies, which is what lets the two modules agree
 * without either importing the other.
 */

import { caseFaces, clothPair, paleAbove } from './palette';

/* ============================== the scheme =============================== */

/**
 * Every colour a room may change, and nothing else.
 *
 * The ink is NOT in here on purpose. One dark outline colour on everything is
 * most of why the flat style reads as a single drawing; letting a room pick its
 * own would turn sixty palettes into sixty unrelated illustrations. It also puts
 * a floor under how dark a scheme may go — every colour below has to keep the
 * one brown ink legible on top of it, which is why there is no midnight room
 * and why `Ebonised Oak` is a deep charcoal brown rather than black.
 */
export interface ColourScheme {
  /** Case timber, the face turned toward us. */
  timber: string;
  /** The same board turning away. Always darker than `timber`. */
  timberDark: string;
  /** Inside the case behind the books. Darker again, so books read as objects. */
  recess: string;
  /** The wall. One flat colour, and the lightest thing on screen. */
  wall: string;
  /**
   * Book cloths as [face, darker edge] pairs — the darker one is the spine's
   * turned band, the same trick the timber pair plays.
   *
   * Exactly six, in every scheme: a book picks its cloth by `seed % length`, so
   * a scheme with a different count would re-roll every book on the shelf.
   */
  cloths: readonly (readonly [string, string])[];
}

/**
 * A room's bias for newly created books, in the vocabulary the spine pipeline
 * reads (`features/bookshelf/bookIdentity.ts` bridges it to `resolveBookStyle`).
 *
 * Only `pigments` is per-room, and it is just the scheme's own cloths — a book
 * made in the reef should come out in reef colours. The rest is one shared
 * dressing (`SPINE_DRESSING`): binding material, gilt, banding and wear are
 * *dressing*, not colour, and the flat spine draws them identically whatever
 * room it is standing in.
 */
export type SpineMaterial = 'leather' | 'cloth' | 'paper' | 'vellum' | 'linen' | 'silk';

export interface SpineTheming {
  /** Weighted material bias for newly created books. */
  materials: readonly SpineMaterial[];
  /** Pigment ramp new spines draw from (hex). */
  pigments: readonly string[];
  /** 0–1 chance a new spine gets gilt bands/lettering. */
  gilt: number;
  /** 0–1 bias toward raised bands vs flat. */
  bands: number;
  /** 0–1 wear bias: 0 pristine, 1 well-loved. */
  wear: number;
}

/* ============================== how it reads ============================= */

/**
 * The shelf a room sits on in the picker.
 *
 * Sixty cards in one undivided grid is a wall, not a choice. These five are the
 * distinctions a reader actually makes when they picture a bookcase: is it
 * WOOD, is it PAINTED, is it a deep saturated colour, is it a loud one, or is
 * it somewhere in particular.
 */
export const THEME_FAMILIES = ['timber', 'painted', 'jewel', 'bright', 'far'] as const;
export type ThemeFamily = (typeof THEME_FAMILIES)[number];

/** What each shelf is called on screen. */
export const FAMILY_LABELS: Readonly<Record<ThemeFamily, string>> = {
  timber: 'Timbers',
  painted: 'Painted',
  jewel: 'Jewels',
  bright: 'Brights',
  far: 'Far rooms',
};

/**
 * The mood words a room may carry.
 *
 * A closed vocabulary, and short. These are read by the studio's dice
 * (`withMood` in `views/rail/designOptions.ts`) to narrow a roll, so a word
 * only two rooms know is a preset with extra steps rather than a mood; every
 * word below is carried by at least four rooms. They are also the only prose
 * in this file a reader can search on, which is the other reason to keep them
 * few and plain.
 */
export const THEME_TAGS = [
  'warm',
  'cool',
  'muted',
  'vivid',
  'natural',
  'formal',
  'playful',
  'dark',
  'pale',
  'cosy',
  'quiet',
  'grand',
  'coastal',
  'botanical',
  'autumn',
  'winter',
  'spring',
  'summer',
  'storybook',
] as const;
export type ThemeTag = (typeof THEME_TAGS)[number];

export interface LibraryTheme {
  id: ThemeId;
  name: string;
  /** One line for the studio card. */
  blurb: string;
  /** Which shelf of the picker it sits on. */
  family: ThemeFamily;
  /** Mood words, for steering the dice. Never drawn. */
  tags: readonly ThemeTag[];
  scheme: ColourScheme;
  spineDefaults: SpineTheming;
}

/* ============================== the pigments ============================= */

/**
 * Every book cloth in the app, mixed once and vetted once.
 *
 * A room picks six of these by name rather than spelling out six hexes, and the
 * reason is mud. Three hundred and sixty hand-mixed cloths would have contained
 * a hundred near-duplicates and a dozen greys nobody meant; forty-four mixed
 * against each other stay a palette. It also makes a room legible as a
 * DECISION — `['oxblood', 'inkblue', 'bottle', 'honey', 'plum', 'sand']` says
 * what kind of library it is in a way that six hex codes never will.
 *
 * Only the lit face is given. The turned edge of every one is derived by
 * `clothPair`, so all forty-four fold by the same amount, on the same rule as
 * the timber.
 *
 * The first six are the app icon's own cloths, at the icon's own values.
 */
const PIGMENTS = {
  /* the icon's six */
  terracotta: '#c96f4a',
  slate: '#5f7d8c',
  plum: '#8a5a72',
  ochre: '#c9973f',
  sage: '#8a9a6b',
  moss: '#7d915c',

  /* reds and oranges */
  vermilion: '#d2543c',
  coral: '#e08063',
  brick: '#b85a45',
  oxblood: '#a8493c',
  rust: '#bd6a35',
  tangerine: '#e08a3f',
  clay: '#c08f6a',

  /* yellows */
  amber: '#d9922f',
  saffron: '#e0a63a',
  mustard: '#c9a94f',
  honey: '#d9b45f',
  butter: '#e3bc5c',
  lemon: '#d9c74a',
  sand: '#d9b878',

  /* pinks and purples */
  blush: '#dfa393',
  shell: '#d99a9a',
  rose: '#d9799b',
  blossom: '#e08aa0',
  magenta: '#c05f95',
  mulberry: '#9c5a86',
  violet: '#9a7fc4',
  lilac: '#a184b8',

  /* blues */
  indigo: '#6f6fae',
  inkblue: '#566a94',
  denim: '#5f7d9e',
  cornflower: '#7d95d0',
  sky: '#7aa8c9',

  /* blue-greens */
  teal: '#3f8f9c',
  lagoon: '#4f9aa8',
  turquoise: '#4fb0b4',
  verdigris: '#4f9c8a',
  jade: '#5fa88c',

  /* greens */
  bottle: '#5f8a63',
  fern: '#6f9c5f',
  leaf: '#7fae5f',
  kelp: '#7d9a5c',
  olive: '#97974f',
  pistachio: '#a8c96f',
} as const;

type PigmentName = keyof typeof PIGMENTS;

/* ============================== the registry ============================= */

/**
 * The dressing every room shares.
 *
 * "Keep only one option for each thing to start off with" — and these four
 * dials were never colour anyway. A mixed shelf of cloth, leather and paper
 * with the odd gilt band on it is the house style; a room that quietly made
 * every book a pristine vellum was a difference nobody asked for and nobody
 * could see under flat art.
 */
const SPINE_DRESSING: Omit<SpineTheming, 'pigments'> = {
  materials: ['cloth', 'leather', 'paper', 'linen'],
  gilt: 0.32,
  bands: 0.4,
  wear: 0.28,
};

/**
 * What a room is authored as: one timber, one wall, six named cloths.
 *
 * Both hexes are an INTENT rather than a promise, and it is worth knowing which
 * way each can move before wondering why a nudge did nothing. A timber darker
 * than the one ink can carry is lifted (`caseFaces`), which is why several of
 * the deep rooms below are authored well under what their card shows and why
 * `Ebonised Oak` is not black. A wall that fails to clear its own timber is
 * lifted too (`paleAbove`) — the wall is the lightest thing on screen, and that
 * is not a preference but what makes the case read as furniture standing in a
 * room instead of a hole cut in a backdrop.
 */
interface RoomSpec {
  /** The lit face of the case. Everything else about the case folds off this. */
  timber: string;
  /**
   * The wall behind it. Authored rather than derived, because it is the second
   * thing the eye reads and a room's whole temperature lives in whether its
   * plaster is warm or cold. It is lifted if it fails to clear the timber —
   * see `paleAbove`.
   */
  wall: string;
  /** Six pigment names. The count is fixed; see `ColourScheme.cloths`. */
  cloths: readonly [
    PigmentName,
    PigmentName,
    PigmentName,
    PigmentName,
    PigmentName,
    PigmentName,
  ];
}

/** Assemble a room: fold the case, fold the cloths, guard the wall. */
function room(
  id: ThemeId,
  name: string,
  blurb: string,
  family: ThemeFamily,
  tags: readonly ThemeTag[],
  spec: RoomSpec,
): LibraryTheme {
  const faces = caseFaces(spec.timber);
  const scheme: ColourScheme = {
    ...faces,
    wall: paleAbove(spec.wall, faces.timber),
    cloths: spec.cloths.map((name) => clothPair(PIGMENTS[name])),
  };
  return {
    id,
    name,
    blurb,
    family,
    tags,
    scheme,
    spineDefaults: { ...SPINE_DRESSING, pigments: scheme.cloths.map(([face]) => face) },
  };
}

/**
 * Old Athenaeum — the app icon's own palette, hex for hex, hand-authored.
 *
 * The one room that does NOT go through `room()`, and the only one that ever
 * should. `art/flat.ts` hard-codes these exact values as the palette every
 * drawing falls back to when no scheme is set, so they have to be reproduced
 * here rather than approximated: a derivation that came out two points off
 * would mean picking the room you are already standing in repaints the shelf.
 * A test holds the two files together.
 *
 * It is also the reference the derivation was measured against — the fold in
 * `palette.ts` is this room's fold — so keeping it verbatim keeps the ruler
 * next to the things it measured.
 */
const ATHENAEUM: LibraryTheme = {
  id: 'athenaeum',
  name: 'Old Athenaeum',
  blurb: 'Warm oak, parchment plaster and terracotta cloth — the house style.',
  family: 'timber',
  tags: ['warm', 'natural', 'cosy', 'quiet'],
  scheme: {
    timber: '#c08a52',
    timberDark: '#9d6b3c',
    recess: '#7d5638',
    wall: '#e9e2d0',
    cloths: [
      ['#c96f4a', '#a8552f'], // terracotta
      ['#5f7d8c', '#456170'], // slate
      ['#8a5a72', '#6d4359'], // plum
      ['#c9973f', '#a4762a'], // ochre
      ['#8a9a6b', '#6b7a4e'], // sage
      ['#7d915c', '#4f6138'], // moss
    ],
  },
  spineDefaults: {
    ...SPINE_DRESSING,
    pigments: ['#c96f4a', '#5f7d8c', '#8a5a72', '#c9973f', '#8a9a6b', '#7d915c'],
  },
};

/* ------------------------------- timbers --------------------------------- */

const TIMBERS: readonly LibraryTheme[] = [
  ATHENAEUM,
  room('limed', 'Limed Oak', 'Oak with the grain washed pale, against soft chalk.', 'timber',
    ['cool', 'pale', 'natural', 'quiet'], {
      timber: '#c6b89b',
      wall: '#f2ece0',
      cloths: ['denim', 'sage', 'blush', 'ochre', 'moss', 'brick'],
    }),
  room('walnut', 'English Walnut', 'Dark figured walnut and a study full of oxblood.', 'timber',
    ['warm', 'dark', 'formal', 'quiet'], {
      timber: '#8b6743',
      wall: '#e9e0cc',
      cloths: ['oxblood', 'inkblue', 'bottle', 'honey', 'plum', 'sand'],
    }),
  room('cherry', 'American Cherry', 'Cherry that has gone red with age, and bottle-green cloth.', 'timber',
    ['warm', 'natural', 'cosy'], {
      timber: '#bd6a45',
      wall: '#f4e6d2',
      cloths: ['amber', 'bottle', 'denim', 'mulberry', 'honey', 'brick'],
    }),
  room('teak', 'Burmese Teak', 'Golden teak, a teal-and-saffron shelf, plain cream walls.', 'timber',
    ['warm', 'natural', 'formal'], {
      timber: '#a8873c',
      wall: '#f0e8d4',
      cloths: ['teal', 'oxblood', 'saffron', 'sage', 'inkblue', 'clay'],
    }),
  /*
   * Drafted as Rio Rosewood and renamed after the first board. Rosewood is a
   * purple-BROWN, and a purple-brown dark enough to be recognisable is below
   * the ink floor, so the derivation lifted it into a dusty pink and the card
   * was labelled with a wood it plainly was not. Tulipwood is that pink, and
   * is also a real cabinet timber — the name now matches the colour instead of
   * the other way round.
   */
  room('tulipwood', 'Brazilian Tulipwood', 'Pink-streaked tulipwood, the timber a cabinetmaker shows off with.', 'timber',
    ['warm', 'formal', 'grand', 'quiet'], {
      timber: '#8f4a5e',
      wall: '#f0dcd4',
      cloths: ['honey', 'bottle', 'indigo', 'rose', 'mustard', 'brick'],
    }),
  room('mahogany', 'Cuban Mahogany', 'Deep red mahogany and a room that means to be taken seriously.', 'timber',
    ['warm', 'dark', 'formal', 'grand'], {
      timber: '#96473f',
      wall: '#f2e5cd',
      cloths: ['mustard', 'inkblue', 'bottle', 'shell', 'oxblood', 'sand'],
    }),
  room('ebonised', 'Ebonised Oak', 'Oak stained near black, kept just light enough to hold an outline.', 'timber',
    ['dark', 'formal', 'quiet', 'cool'], {
      timber: '#6a615c',
      wall: '#e5e3e0',
      cloths: ['vermilion', 'butter', 'jade', 'cornflower', 'shell', 'olive'],
    }),
  room('birch', 'Nordic Birch', 'Blond birch, white plaster, and cloth like a spring meadow.', 'timber',
    ['pale', 'natural', 'quiet', 'spring'], {
      timber: '#dcc79f',
      wall: '#f5f0e4',
      cloths: ['sky', 'leaf', 'blossom', 'butter', 'lilac', 'moss'],
    }),
  room('beech', 'Steamed Beech', 'Beech steamed pink, a workshop full of plain honest colour.', 'timber',
    ['warm', 'pale', 'natural', 'cosy'], {
      timber: '#cfa070',
      wall: '#f3e9dc',
      cloths: ['brick', 'denim', 'kelp', 'mustard', 'plum', 'clay'],
    }),
  room('ash', 'Olive Ash', 'Ash with an olive heart, and shelves the colour of a hedge.', 'timber',
    ['natural', 'quiet', 'botanical', 'muted'], {
      timber: '#b4a86a',
      wall: '#f1efdc',
      cloths: ['fern', 'terracotta', 'denim', 'mustard', 'plum', 'kelp'],
    }),
  room('pine', 'Scots Pine', 'Yellow pine, knots and all, in a cottage with painted books.', 'timber',
    ['warm', 'natural', 'cosy', 'playful'], {
      timber: '#d9b374',
      wall: '#f4ecd9',
      cloths: ['vermilion', 'sky', 'leaf', 'blossom', 'lemon', 'plum'],
    }),
  room('cedar', 'Red Cedar', 'Cedar gone rose-brown in the weather, with lagoon and sand.', 'timber',
    ['warm', 'natural', 'cosy', 'coastal'], {
      timber: '#b87a63',
      wall: '#f2e6da',
      cloths: ['lagoon', 'sand', 'moss', 'butter', 'mulberry', 'teal'],
    }),
  /*
   * Bird's-eye maple and sweet chestnut were both drafted here and both cut.
   * A theme is a colour scheme, and their whole identity was FIGURE — the eyes
   * in the maple, the coarse ring in the chestnut — which flat art does not
   * draw. Stripped to colour they were a second birch and a third walnut, and a
   * library with sixty rooms in it can afford to have none that are almost
   * another room.
   */
  room('driftwood', 'Driftwood', 'Silvered wood off a beach, with everything the sea left in it.', 'timber',
    ['cool', 'muted', 'coastal', 'quiet'], {
      timber: '#ada08d',
      wall: '#eeeae0',
      cloths: ['teal', 'coral', 'sand', 'denim', 'kelp', 'shell'],
    }),
  room('fumed', 'Fumed Oak', 'Oak darkened in ammonia — grey, serious, and very quiet.', 'timber',
    ['muted', 'dark', 'formal', 'quiet'], {
      timber: '#91806a',
      wall: '#ece5d6',
      cloths: ['oxblood', 'sage', 'butter', 'slate', 'clay', 'bottle'],
    }),
];

/* ------------------------------- painted --------------------------------- */

const PAINTED: readonly LibraryTheme[] = [
  room('pantry', 'Pantry Green', 'The green a scullery cupboard is always painted.', 'painted',
    ['muted', 'natural', 'botanical', 'quiet'], {
      timber: '#8b9a78',
      wall: '#f1efe2',
      cloths: ['terracotta', 'honey', 'inkblue', 'shell', 'olive', 'plum'],
    }),
  room('hallway', 'Hall Grey', 'A grey with the warmth left in, for a hall that gets no sun.', 'painted',
    ['cool', 'muted', 'quiet', 'formal'], {
      timber: '#a6adb2',
      wall: '#edf0f1',
      cloths: ['brick', 'mustard', 'bottle', 'denim', 'blush', 'plum'],
    }),
  room('duckegg', 'Duck Egg', 'Pale blue-green paint, the colour of a hedgerow egg.', 'painted',
    ['cool', 'pale', 'coastal', 'quiet'], {
      timber: '#a6c4bd',
      wall: '#f2f2ea',
      cloths: ['coral', 'sand', 'inkblue', 'moss', 'shell', 'amber'],
    }),
  room('plaster', 'Rose Plaster', 'Bare pink plaster left as it dried, and nothing shouting.', 'painted',
    ['warm', 'muted', 'pale', 'cosy'], {
      timber: '#dcaa9e',
      wall: '#f8ece6',
      cloths: ['bottle', 'plum', 'sand', 'teal', 'oxblood', 'butter'],
    }),
  room('bone', 'Bone China', 'Almost no colour at all, so the books do all the work.', 'painted',
    ['pale', 'muted', 'quiet', 'formal'], {
      timber: '#dcd1bd',
      wall: '#f8f4ec',
      cloths: ['vermilion', 'inkblue', 'bottle', 'ochre', 'mulberry', 'slate'],
    }),
  room('lichen', 'Pale Lichen', 'Grey-green as lichen on a wall, with everything growing.', 'painted',
    ['muted', 'botanical', 'natural', 'spring'], {
      timber: '#aab58e',
      wall: '#f2f2e6',
      cloths: ['rose', 'fern', 'clay', 'sky', 'honey', 'kelp'],
    }),
  room('chalkblue', 'Chalk Blue', 'A cold blue chalk paint, and a winter afternoon.', 'painted',
    ['cool', 'muted', 'quiet', 'winter'], {
      timber: '#9db1c6',
      wall: '#eff1f0',
      cloths: ['rust', 'sand', 'plum', 'bottle', 'shell', 'indigo'],
    }),
  room('bramble', 'Bramble', 'Dusty purple, like a hedge at the end of the summer.', 'painted',
    ['cool', 'muted', 'quiet', 'autumn'], {
      timber: '#93789f',
      wall: '#f1ebe6',
      cloths: ['mustard', 'bottle', 'blossom', 'slate', 'brick', 'sand'],
    }),
  /*
   * Where `Peat` and `Field Mouse` used to be. Both were dark warm neutrals,
   * and the ink floor gives every dark warm neutral almost the same recess —
   * so on screen they were `Fumed Oak` and `Driftwood` again, twice. The two
   * below take the same slot in the picker and are genuinely somewhere else:
   * one goes purple, the other goes cold.
   */
  room('fig', 'Fig', 'Dusty plum paint, with green fruit colours on the shelves.', 'painted',
    ['warm', 'muted', 'quiet', 'autumn'], {
      timber: '#8f6a72',
      wall: '#f0e8e0',
      cloths: ['pistachio', 'honey', 'sand', 'teal', 'blossom', 'olive'],
    }),
  room('slateroof', 'Slate Roof', 'Cold grey-blue, with every warm colour in the library against it.', 'painted',
    ['cool', 'dark', 'muted', 'winter'], {
      timber: '#63767f',
      wall: '#e9edf0',
      cloths: ['rust', 'butter', 'sand', 'jade', 'shell', 'magenta'],
    }),
  room('clotted', 'Clotted Cream', 'Thick yellow-cream paint and a warm, unfussy room.', 'painted',
    ['warm', 'pale', 'cosy', 'quiet'], {
      timber: '#e6cf8a',
      wall: '#faf4e4',
      cloths: ['brick', 'denim', 'kelp', 'mulberry', 'amber', 'slate'],
    }),
  room('seafret', 'Sea Fret', 'The grey-green of fog coming in off the water.', 'painted',
    ['cool', 'muted', 'coastal', 'quiet'], {
      timber: '#8fa89c',
      wall: '#ecf0ec',
      cloths: ['coral', 'sand', 'teal', 'plum', 'olive', 'shell'],
    }),
  room('cardroom', 'Card Room Green', 'The dark green of a room built for long evenings.', 'painted',
    ['cool', 'muted', 'formal', 'dark'], {
      timber: '#6f8478',
      wall: '#ecefe4',
      cloths: ['oxblood', 'honey', 'shell', 'inkblue', 'rust', 'sand'],
    }),
  room('smoke', 'Smoke', 'Blue-grey, cold light, and books chosen to argue with it.', 'painted',
    ['cool', 'muted', 'winter', 'quiet'], {
      timber: '#8792a2',
      wall: '#eaeef2',
      cloths: ['tangerine', 'lemon', 'magenta', 'jade', 'indigo', 'shell'],
    }),
];

/* -------------------------------- jewels --------------------------------- */

const JEWELS: readonly LibraryTheme[] = [
  /* The default room. See DEFAULT_THEME_ID for why it is not the oak. */
  room(
    'verdigris',
    'Verdigris Library',
    'A green-blue painted case on warm plaster, in copper, saffron and ink.',
    'jewel',
    ['vivid', 'cool', 'formal', 'grand'],
    {
      timber: '#3f8a7d',
      wall: '#f1e8d2',
      cloths: ['rust', 'saffron', 'inkblue', 'oxblood', 'sand', 'mulberry'],
    },
  ),
  room('malachite', 'Malachite', 'Green as a polished stone, with gold and oxblood on it.', 'jewel',
    ['vivid', 'botanical', 'grand', 'formal'], {
      timber: '#48915c',
      wall: '#f0eeda',
      cloths: ['saffron', 'oxblood', 'sand', 'inkblue', 'shell', 'mulberry'],
    }),
  room('lapis', 'Lapis Cabinet', 'Deep blue paint with gilt — a cabinet of small precious things.', 'jewel',
    ['vivid', 'cool', 'formal', 'grand'], {
      timber: '#4a6fa5',
      wall: '#eeeee2',
      cloths: ['amber', 'coral', 'sand', 'bottle', 'shell', 'mulberry'],
    }),
  room('lacquerred', 'Lacquer Red', 'Red lacquer laid on thick, and everything else kept quiet.', 'jewel',
    ['vivid', 'warm', 'dark', 'grand'], {
      timber: '#a03a3f',
      wall: '#ece9d8',
      cloths: ['butter', 'jade', 'sand', 'inkblue', 'shell', 'olive'],
    }),
  room('aubergine', 'Aubergine', 'Purple so dark it reads as brown until the light moves.', 'jewel',
    ['dark', 'cool', 'formal', 'grand'], {
      timber: '#6d3f6e',
      wall: '#efe4e6',
      cloths: ['saffron', 'jade', 'blossom', 'sand', 'lagoon', 'butter'],
    }),
  room('peacock', 'Peacock', 'The blue-green in the eye of a feather.', 'jewel',
    ['vivid', 'cool', 'grand', 'formal'], {
      timber: '#2f7f8c',
      wall: '#eeece0',
      cloths: ['tangerine', 'magenta', 'lemon', 'olive', 'shell', 'indigo'],
    }),
  room(
    'apothecary',
    'Amber Apothecary',
    'Cherry timber and a dusky rose wall, in amber and oxblood cloth.',
    'jewel',
    ['warm', 'vivid', 'cosy', 'grand'],
    {
      timber: '#bd7136',
      wall: '#efd8c6',
      cloths: ['amber', 'oxblood', 'bottle', 'inkblue', 'mulberry', 'mustard'],
    },
  ),
  room('forest', 'Forest Study', 'A green as dark as the app will allow, and gold to lift it.', 'jewel',
    ['dark', 'botanical', 'natural', 'formal'], {
      timber: '#4e7a4a',
      wall: '#eeeddc',
      cloths: ['honey', 'brick', 'sand', 'denim', 'shell', 'mustard'],
    }),
  room('garnet', 'Garnet', 'A red with blue in it, cut and set rather than painted.', 'jewel',
    ['vivid', 'warm', 'grand', 'formal'], {
      timber: '#a5455e',
      wall: '#f2e4e2',
      cloths: ['butter', 'jade', 'sand', 'indigo', 'blush', 'olive'],
    }),
  room('indigoroom', 'Indigo Room', 'Violet-blue walls and a shelf that glows against them.', 'jewel',
    ['cool', 'dark', 'formal', 'grand'], {
      timber: '#5a5a94',
      wall: '#eceaea',
      cloths: ['saffron', 'coral', 'jade', 'sand', 'rose', 'lemon'],
    }),
  room('topaz', 'Burnt Topaz', 'Deep orange stone, and a room that stays warm after dark.', 'jewel',
    ['warm', 'vivid', 'autumn', 'grand'], {
      timber: '#cf8e2f',
      wall: '#f5ead0',
      cloths: ['inkblue', 'bottle', 'oxblood', 'sand', 'plum', 'teal'],
    }),
  room('laurel', 'Bay Laurel', 'Sharp olive green, the colour of a leaf held up to the sun.', 'jewel',
    ['vivid', 'botanical', 'natural', 'summer'], {
      timber: '#6f8a3f',
      wall: '#f1eeda',
      cloths: ['vermilion', 'sand', 'inkblue', 'blossom', 'honey', 'teal'],
    }),
];

/* ------------------------------- brights --------------------------------- */

const BRIGHTS: readonly LibraryTheme[] = [
  room(
    'reef',
    'Coral Reef',
    'A sea-green painted case against pale sand, in coral and kelp cloth.',
    'bright',
    ['vivid', 'coastal', 'playful', 'summer'],
    {
      timber: '#74b0a6',
      wall: '#ebe4d2',
      cloths: ['coral', 'lagoon', 'sand', 'denim', 'kelp', 'shell'],
    },
  ),
  /*
   * The one old room whose colours moved. It was a pale birch case on a green
   * wall, which under flat art is the same picture as `Nordic Birch` — and a
   * room called Blossom Grove whose card shows a plain wooden bookcase is a
   * name writing a cheque the palette does not cash. It is now the blossom
   * rather than the tree it grew on; the leaf-green wall is unchanged, and it
   * is that pairing the name was ever about.
   */
  room(
    'blossom',
    'Blossom Grove',
    'Blossom-pink paint against a soft leaf-green wall, in meadow cloth.',
    'bright',
    ['pale', 'spring', 'playful', 'botanical'],
    {
      timber: '#e8b9bd',
      wall: '#e6edd8',
      cloths: ['blossom', 'leaf', 'sky', 'butter', 'lilac', 'moss'],
    },
  ),
  room('vermilionroom', 'Vermilion Lacquer', 'Bright red lacquer with gold — a small loud room.', 'bright',
    ['vivid', 'warm', 'playful', 'grand'], {
      timber: '#d5543a',
      wall: '#f7ead2',
      cloths: ['butter', 'teal', 'sand', 'indigo', 'shell', 'olive'],
    }),
  room('marigold', 'Marigold', 'The yellow-orange of a market stall in full sun.', 'bright',
    ['vivid', 'warm', 'playful', 'summer'], {
      timber: '#dda13a',
      wall: '#f8f0dc',
      cloths: ['teal', 'magenta', 'inkblue', 'kelp', 'vermilion', 'lilac'],
    }),
  room('carousel', 'Carousel', 'Fairground pink, and no apology anywhere.', 'bright',
    ['vivid', 'playful', 'storybook', 'summer'], {
      timber: '#d9799b',
      wall: '#f9ecef',
      cloths: ['turquoise', 'lemon', 'violet', 'leaf', 'coral', 'sky'],
    }),
  room('pistachio', 'Pistachio Gelato', 'Pale green ice cream, in a room with a striped awning.', 'bright',
    ['vivid', 'playful', 'spring', 'pale'], {
      timber: '#a8c96f',
      wall: '#f5f3dc',
      cloths: ['rose', 'tangerine', 'sky', 'mulberry', 'butter', 'teal'],
    }),
  room('tangerine', 'Tangerine Stall', 'Orange crates, blue awning, and a great deal of noise.', 'bright',
    ['vivid', 'warm', 'playful', 'summer'], {
      timber: '#e08a45',
      wall: '#f9efdc',
      cloths: ['cornflower', 'bottle', 'magenta', 'lemon', 'shell', 'teal'],
    }),
  room('cornflower', 'Cornflower', 'A field-blue case with poppies on the shelves.', 'bright',
    ['vivid', 'cool', 'playful', 'spring'], {
      timber: '#7d95d0',
      wall: '#f0f1f4',
      cloths: ['vermilion', 'butter', 'leaf', 'blossom', 'sand', 'plum'],
    }),
  room('violetroom', 'Violet Hour', 'The half-hour after sunset, made into paint.', 'bright',
    ['vivid', 'cool', 'playful', 'storybook'], {
      timber: '#9a7fc4',
      wall: '#f1edf5',
      cloths: ['saffron', 'jade', 'rose', 'sky', 'lemon', 'terracotta'],
    }),
  room('lemongrove', 'Lemon Grove', 'Hard bright yellow, leaves, and a whitewashed wall.', 'bright',
    ['vivid', 'playful', 'summer', 'botanical'], {
      timber: '#d9c74a',
      wall: '#f9f5dc',
      cloths: ['fern', 'cornflower', 'vermilion', 'plum', 'turquoise', 'clay'],
    }),
  room('watermelon', 'Watermelon', 'Pink flesh, green rind, and nothing in between.', 'bright',
    ['vivid', 'playful', 'summer', 'storybook'], {
      timber: '#e0687a',
      wall: '#faeceb',
      cloths: ['leaf', 'lemon', 'teal', 'sand', 'violet', 'moss'],
    }),
  room('chartreuse', 'Chartreuse', 'Acid yellow-green, and nothing in the room dares be quiet.', 'bright',
    ['vivid', 'playful', 'spring', 'botanical'], {
      timber: '#b8cf3f',
      wall: '#f6f6dc',
      cloths: ['magenta', 'indigo', 'vermilion', 'turquoise', 'plum', 'clay'],
    }),
  room('turquoise', 'Turquoise Tile', 'Glazed tile blue-green, cool to the touch.', 'bright',
    ['vivid', 'coastal', 'playful', 'cool'], {
      timber: '#4fb2b6',
      wall: '#f0f3e8',
      cloths: ['tangerine', 'saffron', 'magenta', 'sand', 'inkblue', 'olive'],
    }),
];

/* ------------------------------ far rooms -------------------------------- */

const FAR: readonly LibraryTheme[] = [
  room('lantern', 'Paper Lantern', 'Everything the colour of lit paper, with one red on each shelf.', 'far',
    ['warm', 'pale', 'cosy', 'storybook'], {
      timber: '#eeb377',
      wall: '#fdf2e2',
      cloths: ['vermilion', 'inkblue', 'moss', 'sand', 'plum', 'amber'],
    }),
  /*
   * The only magenta case in the library, and it is here because nothing else
   * was. Laid out by hue, the sixty rooms had a hole between `carousel`'s
   * fairground pink and `aubergine`'s purple that no wood or muted paint was
   * ever going to fill — and a room called Souk had better be the loudest thing
   * on the shelf or it should not be called that.
   */
  room('souk', 'Marrakesh Souk', 'Magenta, saffron and tile-blue, all shouting at once.', 'far',
    ['vivid', 'warm', 'playful', 'summer'], {
      timber: '#c05f8f',
      wall: '#f7ecdc',
      cloths: ['saffron', 'turquoise', 'lemon', 'indigo', 'vermilion', 'jade'],
    }),
  room('harbour', 'Harbour Light', 'Teal-grey paint off a working quay, with rope and rust on it.', 'far',
    ['cool', 'coastal', 'muted', 'winter'], {
      timber: '#5f8fa0',
      wall: '#eef0e8',
      cloths: ['rust', 'sand', 'bottle', 'shell', 'inkblue', 'butter'],
    }),
  room('orchard', 'Autumn Orchard', 'Olive-gold, windfalls, and a long low sun.', 'far',
    ['warm', 'autumn', 'natural', 'muted'], {
      timber: '#937434',
      wall: '#f4e2c4',
      cloths: ['vermilion', 'kelp', 'honey', 'plum', 'denim', 'clay'],
    }),
  room('heather', 'Heather Moor', 'Late-summer moorland: purple, bracken and weather.', 'far',
    ['cool', 'autumn', 'muted', 'botanical'], {
      timber: '#ab8492',
      wall: '#f2ecef',
      cloths: ['olive', 'rust', 'butter', 'slate', 'fern', 'shell'],
    }),
  room('snowline', 'Snowline', 'The palest room in the library, and the coldest.', 'far',
    ['cool', 'pale', 'winter', 'quiet'], {
      timber: '#c3cdd4',
      wall: '#f5f8f8',
      cloths: ['vermilion', 'indigo', 'bottle', 'saffron', 'plum', 'teal'],
    }),
];

/* ============================== identifiers ============================== */

/**
 * The rooms, in picker order: timbers, painted, jewels, brights, far rooms.
 *
 * Grouped rather than shuffled, because the picker is what a reader looks at
 * and "all the woods, then all the painted ones" is how anyone shops for a
 * bookcase. The cost is elsewhere: `defaultThemeForOrd` (`data/bookcases.ts`)
 * indexes this list by a bookcase's ordinal, so a reader who makes several
 * bookcases in a row gets a run of timbers before it reaches the painted ones.
 * That is a fair trade — a new case's room is a starting point, one click from
 * anywhere — but it is a consequence of the order rather than an accident of it.
 *
 * Ids are never removed. Ten rooms were retired once and nothing had to be kept
 * for them, because `getTheme` falls back to the default for any id it does not
 * know — a library saved in the old Sakura Pavilion opens in the default room
 * rather than failing. That fallback is still what protects an old save; it is
 * not a licence to rename an id that currently ships, which would silently move
 * a reader's library into a room they did not choose.
 */
export const THEME_IDS = [
  // timbers
  'athenaeum',
  'limed',
  'walnut',
  'cherry',
  'teak',
  'tulipwood',
  'mahogany',
  'ebonised',
  'birch',
  'beech',
  'ash',
  'pine',
  'cedar',
  'driftwood',
  'fumed',
  // painted
  'pantry',
  'hallway',
  'duckegg',
  'plaster',
  'bone',
  'lichen',
  'chalkblue',
  'bramble',
  'fig',
  'slateroof',
  'clotted',
  'seafret',
  'cardroom',
  'smoke',
  // jewels
  'verdigris',
  'malachite',
  'lapis',
  'lacquerred',
  'aubergine',
  'peacock',
  'apothecary',
  'forest',
  'garnet',
  'indigoroom',
  'topaz',
  'laurel',
  // brights
  'reef',
  'blossom',
  'vermilionroom',
  'marigold',
  'carousel',
  'pistachio',
  'tangerine',
  'cornflower',
  'violetroom',
  'lemongrove',
  'watermelon',
  'chartreuse',
  'turquoise',
  // far rooms
  'lantern',
  'souk',
  'harbour',
  'orchard',
  'heather',
  'snowline',
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

/**
 * The room a brand-new library opens in.
 *
 * NOT the app icon's oak, and that was the point of the pass that moved it. The
 * oak is the house *fallback* — it is what `art/flat.ts` draws in when no scheme
 * is set — but as a first impression it was the blandest thing the app could
 * have chosen: a brown case on a beige wall, which is what every stock bookshelf
 * illustration looks like. Verdigris is the same drawing with a decision in it,
 * and it shows off the two fixed colours the flat style leans on hardest, since
 * gilt and cream both sing against a blue-green.
 *
 * ## Re-opened when the reader called the opening shelf bland, and kept
 *
 * The complaint turned out to be about the CARPENTRY, not the palette: the case
 * was a plain plank build, so every room read as a coloured slab. Twenty-two
 * rooms were then photographed on the new opening carpentry — the whole colour
 * axis on one build (`shots-now/defaults/board-b.png`, `board-h.png`) — and
 * verdigris still won, on three counts that only show up in a photograph:
 *
 *  - its recess sits far enough under its timber that the arcade behind the
 *    books reads as arches. On `walnut`, `fumed` and `ebonised` the same
 *    arches all but vanish, which is the difference between carpentry and mud;
 *  - its wall (`#f1e8d2`) is warm plaster against a cool case, so the wall
 *    reads as a room rather than as backdrop. The cool-walled rooms —
 *    `cardroom`, `slateroof`, `harbour` — go grey next to the app's cream
 *    pages;
 *  - its six cloths (rust, saffron, inkblue, oxblood, sand, mulberry) are the
 *    most elegant set in the file, and they are what every new book is dressed
 *    from. `peacock` beats it on the case alone and loses badly here: tangerine,
 *    magenta and lemon make a circus of the shelf a week later.
 *
 * `Old Athenaeum` is first in the picker and one click away, so nothing is lost.
 */
export const DEFAULT_THEME_ID: ThemeId = 'verdigris';

/**
 * The eight rooms a panel should show before it offers the other fifty-two.
 *
 * Sixty preview cards do not fit in a 376px sheet and would not be read if they
 * did; the studio's long axes already solve this by showing a strip and a way
 * through to a full picker (`DesignStrip` → `DesignPicker`). These eight are
 * chosen to SPAN the library rather than to be the best eight — dark wood, pale
 * wood, muted paint, warm paint, a deep colour and a loud one, with the default
 * and the house oak in front — so the strip advertises the range and the picker
 * sells the individuals.
 */
export const FEATURED_THEME_IDS: readonly ThemeId[] = [
  'verdigris',
  'athenaeum',
  'walnut',
  'limed',
  'cardroom',
  'plaster',
  'lapis',
  'carousel',
];

/** Narrowing guard for persisted/user-supplied values. */
export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

/** Every room, keyed by id. */
export const THEMES: Readonly<Record<ThemeId, LibraryTheme>> = Object.fromEntries(
  [...TIMBERS, ...PAINTED, ...JEWELS, ...BRIGHTS, ...FAR].map((theme) => [theme.id, theme]),
) as Readonly<Record<ThemeId, LibraryTheme>>;

/** Look up a room; unknown ids fall back to the default. */
export function getTheme(id: string | null | undefined): LibraryTheme {
  return isThemeId(id) ? THEMES[id] : THEMES[DEFAULT_THEME_ID];
}

/** All rooms in picker order. */
export function allThemes(): readonly LibraryTheme[] {
  return THEME_IDS.map((id) => THEMES[id]);
}

/** The rooms on one shelf of the picker, in picker order. */
export function themesInFamily(family: ThemeFamily): readonly LibraryTheme[] {
  return allThemes().filter((theme) => theme.family === family);
}
