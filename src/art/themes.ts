/**
 * art/themes.ts — the library's colour schemes.
 *
 * A theme is now a NAME, a blurb and a handful of hexes. That is the whole of
 * it, and the shrinkage is the point.
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
 * This module is the TYPE + DATA root of the theme system and deliberately
 * imports nothing, so every other art module can depend on it without a cycle.
 * `ColourScheme` is structurally identical to the scheme `art/flat.ts` applies,
 * which is what lets the two modules agree without either importing the other.
 */

/* ============================== identifiers ============================== */

/**
 * The rooms, in picker order. Four, and four is a deliberate ceiling.
 *
 * There used to be fourteen ids, ten of which were never offered — kept "as
 * data" so a saved library naming one would still load. Under a colour-only
 * theme there is nothing to keep: `getTheme` falls back to the default room for
 * any id it does not know, so a library saved in the old Sakura Pavilion opens
 * in the Old Athenaeum rather than failing, and nothing has to carry a dead
 * palette to make that true.
 */
export const THEME_IDS = ['athenaeum', 'blossom', 'reef', 'apothecary'] as const;

export type ThemeId = (typeof THEME_IDS)[number];

/** The room a brand-new library opens in: the app icon's own palette. */
export const DEFAULT_THEME_ID: ThemeId = 'athenaeum';

/** Narrowing guard for persisted/user-supplied values. */
export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

/* ============================== the scheme =============================== */

/**
 * Every colour a room may change, and nothing else.
 *
 * The ink is NOT in here on purpose. One dark outline colour on everything is
 * most of why the flat style reads as a single drawing; letting a room pick its
 * own would turn four palettes into four unrelated illustrations. It also puts
 * a floor under how dark a scheme may go — every colour below has to keep the
 * one brown ink legible on top of it, which is why there is no midnight room.
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

export interface LibraryTheme {
  id: ThemeId;
  name: string;
  /** One line for the studio card. */
  blurb: string;
  scheme: ColourScheme;
  spineDefaults: SpineTheming;
}

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

/** Assemble a theme, deriving its spine bias from its own cloths. */
function room(id: ThemeId, name: string, blurb: string, scheme: ColourScheme): LibraryTheme {
  return {
    id,
    name,
    blurb,
    scheme,
    spineDefaults: { ...SPINE_DRESSING, pigments: scheme.cloths.map(([face]) => face) },
  };
}

/**
 * Old Athenaeum — the app icon's own palette, unchanged.
 *
 * This is the scheme `art/flat.ts` hard-codes as its default, spelled out here
 * so the default room is a room like any other rather than a special case. Edit
 * one and you must edit the other; a test holds them together.
 */
const ATHENAEUM = room(
  'athenaeum',
  'Old Athenaeum',
  'Warm oak, parchment plaster and terracotta cloth — the house style.',
  {
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
);

/** Blossom Grove — pale birch, a leaf-green wall, spring cloth. */
const BLOSSOM = room(
  'blossom',
  'Blossom Grove',
  'Pale birch against a soft leaf-green wall, in blossom and meadow cloth.',
  {
    timber: '#dcbb8a',
    timberDark: '#b8925e',
    recess: '#8c6a45',
    wall: '#e3ead5',
    cloths: [
      ['#e08aa0', '#bd6480'], // blossom
      ['#7fae5f', '#5c8843'], // leaf
      ['#7aa8c9', '#5580a1'], // sky
      ['#e3bc5c', '#bf9636'], // butter
      ['#a184b8', '#7c6293'], // lilac
      ['#7d915c', '#4f6138'], // moss
    ],
  },
);

/** Coral Reef — a painted sea-green case on pale sand. */
const REEF = room(
  'reef',
  'Coral Reef',
  'A sea-green painted case against pale sand, in coral and kelp cloth.',
  {
    timber: '#74b0a6',
    timberDark: '#4f8b85',
    recess: '#3d6d6b',
    wall: '#ebe4d2',
    cloths: [
      ['#e08063', '#bb5c41'], // coral
      ['#4f9aa8', '#357683'], // lagoon
      ['#d9b878', '#b59052'], // sand
      ['#5f7d9e', '#455f7e'], // deep water
      ['#7d9a5c', '#5b7540'], // kelp
      ['#d99a9a', '#b57272'], // shell
    ],
  },
);

/** Amber Apothecary — cherry timber, a dusky rose wall, jar-glass cloth. */
const APOTHECARY = room(
  'apothecary',
  'Amber Apothecary',
  'Cherry timber and a dusky rose wall, in amber and oxblood cloth.',
  {
    timber: '#bd7136',
    timberDark: '#9a5525',
    recess: '#77452a',
    wall: '#efd8c6',
    cloths: [
      ['#d9922f', '#b06f18'], // amber
      ['#b0503f', '#8c3728'], // oxblood
      ['#5f8a63', '#456647'], // bottle green
      ['#566a94', '#3f5074'], // ink blue
      ['#8f5f78', '#6d445b'], // plum
      ['#c9a94f', '#a48435'], // mustard
    ],
  },
);

/** Every room, keyed by id. */
export const THEMES: Readonly<Record<ThemeId, LibraryTheme>> = {
  athenaeum: ATHENAEUM,
  blossom: BLOSSOM,
  reef: REEF,
  apothecary: APOTHECARY,
};

/** Look up a room; unknown ids fall back to the default. */
export function getTheme(id: string | null | undefined): LibraryTheme {
  return isThemeId(id) ? THEMES[id] : THEMES[DEFAULT_THEME_ID];
}

/** All rooms in picker order. */
export function allThemes(): readonly LibraryTheme[] {
  return THEME_IDS.map((id) => THEMES[id]);
}
