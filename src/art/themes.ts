/**
 * art/themes.ts — the library theme system (docs/design/library-themes.md §1).
 *
 * A theme is a room's identity: wood palette + grain character + finish,
 * joinery vocabulary, cornice profile + carving, rail inlay, floor-plate
 * material, wallpaper (pattern × colourway), and the pigment bias new book
 * spines inherit.
 *
 * A theme USED to carry three more packages: a light rig (pools, ambient, rim,
 * vignette, drift, flicker, shafts), a flora planting plan, a prop shortlist
 * and a dust-mote spec. None of them draw anything now — the deferred lighting
 * pass, the flora pipeline and the shelf props all went with the painting
 * stack — so the data went too rather than sit here reading like a promise.
 *
 * This module is the TYPE + DATA root of the theme system and deliberately
 * imports nothing from the rest of src/art, so every other art module can
 * depend on it without a cycle.
 *
 * Everything downstream is procedural + baked once (art-pipeline.md) and
 * deterministic per seed. Themes only *bias* per-book art — an explicit
 * per-book override always wins, so a favourite red leather book keeps its
 * identity in every room.
 */

/* ============================== identifiers ============================== */

export const THEME_IDS = [
  'blossom',
  'robot',
  'dino',
  'candy',
  'reef',
  'voyager',
  'athenaeum',
  'conservatory',
  'observatory',
  'cottage',
  'scriptorium',
  'sakura',
  'attic',
  'apothecary',
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

/**
 * The rooms actually OFFERED in the studio.
 *
 * Under the authored-art architecture every theme needs its own generated set
 * — case elevation, wall, props, spine bias — produced and quality-checked by
 * hand. Fourteen half-finished rooms is exactly how the app came to look
 * cheap; two rooms that hold up beat a long list that does not.
 *
 * The other themes remain as data (and remain valid `ThemeId`s, so a saved
 * library that names one still loads). Promoting one back is a single line
 * here, once its art meets the bar in ART-BIBLE.md.
 */
export const SHIPPED_THEME_IDS = [
  'blossom', // the enchanted overgrown library — the reference look
  'athenaeum', // dark oak, gilt and brass — a genuinely different mood
] as const satisfies readonly ThemeId[];

/** True when a theme is offered in the studio (as opposed to merely valid). */
export function isShippedTheme(id: ThemeId): boolean {
  return (SHIPPED_THEME_IDS as readonly ThemeId[]).includes(id);
}

/** The room a brand-new library opens in: a tree in blossom. */
export const DEFAULT_THEME_ID: ThemeId = 'blossom';

/** Narrowing guard for persisted/user-supplied values. */
export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

/**
 * Cache-key salt for every raster produced by the theme system.
 * Owned by this module — `RECIPE_VERSION` in bake.ts belongs to the shelf
 * pipeline and must not be bumped from here.
 *
 * v1: initial eight worlds + twelve wallpapers.
 * v2: backdrop variants; legible cornice carving + rail inlay; boarded back
 *     panels; scriptorium/attic show the room wall; cottage bunting and
 *     apothecary drawers wired up; wallpaper motif pass.
 * v3: six colourful worlds (blossom · robot · dino · candy · reef · voyager),
 *     Blossom Grove becomes the default, and the original eight get a
 *     saturation pass — every palette, wallpaper colourway and light rig.
 * v4: creative-motif redo of every room except the grove — deeper contrast
 *     ramps, story-telling light rigs, re-coloured walls (jungle green for
 *     the dig, strawberry cream for the shop, lagoon blue for the reef) and
 *     a richer wallpaper pass (fish, planets, sprinkles, fossils, moons).
 */
export const THEME_RECIPE_VERSION = 4;

/* ================================= wood ================================== */

/**
 * Grain character. Drives ring shape, extra passes and defect vocabulary in
 * `paintWood` (wood.ts) — not just a colour swap.
 * - `quartersawn` tight straight rings + bright ray-fleck dashes
 * - `knotty`      wide soft rings, many knots, cathedral arches
 * - `straight`    even, near-featureless (pale ash / hinoki)
 * - `weathered`   raised grain, split checks, silvered surface
 * - `fine`        very tight low-contrast rings
 * - `flame`       wavy, ribboned figure (cherry / walnut crotch)
 * - `birch`       pale sheet with dark lenticel dashes and bark peel
 * - `brushed`     not timber at all: brushed metal, fine unidirectional satin
 * - `gloss`       moulded/enamelled body — almost no figure, all highlight
 */
export type WoodGrain =
  | 'quartersawn'
  | 'knotty'
  | 'straight'
  | 'weathered'
  | 'fine'
  | 'flame'
  | 'birch'
  | 'brushed'
  | 'gloss';

/** Surface finish → specular character of the sheen pass. */
export type WoodFinish =
  | 'wax'
  | 'matte'
  | 'lacquer'
  | 'raw'
  | 'painted'
  | 'limewash'
  /** Candy-shell gloss: a hard bright band and a bounce light underneath. */
  | 'gloss'
  /** Brushed metal: a wide anisotropic sheen with a cool shadow side. */
  | 'metal';

/** An opaque paint coat over the substrate wood, optionally chipped. */
export interface PaintSpec {
  /** Body colour of the paint film. */
  colour: string;
  /** Slightly darker tone pooled in recesses/edges. */
  shade: string;
  /** 0 = flawless film, 1 = heavily chipped back to bare wood. */
  chipping: number;
  /** Coverage of the film; <1 lets grain telegraph through. */
  opacity: number;
}

export interface WoodSpec {
  /** Ramp light end (hex). */
  light: string;
  /** Ramp dark end (hex). */
  dark: string;
  grain: WoodGrain;
  /** Ring quantization frequency (higher = more rings per span). */
  ringFreq: number;
  /** Ring easing exponent (doc default 1.8; lower = softer rings). */
  ringGamma: number;
  /** Noise scale ALONG the grain axis (small = long stretched figure). */
  along: number;
  /** Noise scale ACROSS the grain axis (large = tight ring spacing). */
  across: number;
  /** Knots per 240 world px of grain run. */
  knots: number;
  /** Directional streak strokes per 100 world px across the grain. */
  streaks: number;
  /** Overall light↔dark spread; <1 flattens the field. */
  contrast: number;
  finish: WoodFinish;
  /** Specular strength of the finish pass, 0–1. */
  sheen: number;
  /** Optional paint film over the wood. */
  paint?: PaintSpec;
}

/* =============================== joinery ================================= */

/**
 * How the case is held together — visible construction is most of what makes
 * a room feel built rather than drawn.
 */
export type JoineryKind =
  | 'peg' // square-shouldered oak pegs through the tenon
  | 'iron-strap' // forged strap plates with rivet heads
  | 'mitre' // invisible joinery: a crisp mitre line only
  | 'painted-chip' // painted joint with the paint chipped off the arris
  | 'nail-head' // hand-driven square nails, rust bloom
  | 'brass-bracket' // small brass angle brackets + slotted screws
  | 'hex-bolt' // machined hex head + washer, workshop steel
  | 'vine-tie' // whipped twine binding with a green tendril escaping
  | 'bone-pin' // polished bone dowel in a bronze collar
  | 'candy-stud' // glossy jelly-bean stud with a sugar highlight
  | 'shell-rivet' // scallop shell cap over a pearl bead
  | 'star-rivet'; // neon-lit star washer, deep-space chrome

export interface JoinerySpec {
  kind: JoineryKind;
  /** Metal/peg body colour. */
  metal: string;
  /** Shadowed side of the fitting. */
  metalDark: string;
  /** Specular highlight colour. */
  highlight: string;
  /** Fitting scale in world px (peg radius / strap width). */
  size: number;
  /** 0–1 density of fittings along an edge. */
  density: number;
}

/* ================================ crown ================================== */

/** Cornice silhouette. */
export type CrownProfile =
  | 'stepped' // classical stacked fillets
  | 'ogee' // s-curve moulding
  | 'flat' // a plain overhanging board
  | 'beam' // one heavy timber, strapped
  | 'gable' // shallow roof pitch over the case
  | 'pediment' // shopfront pediment with a centre keystone
  | 'arch' // a soft round-topped arbour arch (grove, reef)
  | 'gantry' // industrial gantry beam with end plates and a lamp bar
  | 'crest'; // scalloped/finned crest — candy awning, rocket fin

/** Carving vocabulary run along the cornice. */
export type CrownCarving =
  | 'dentil' // tooth blocks
  | 'star-punch' // punched stars / pierced quatrefoils
  | 'scallop' // repeating shell arcs
  | 'plain' // no carving; the profile is the ornament
  | 'notch' // simple chip-carved v-notches
  | 'ovolo' // rounded bead-and-fillet
  | 'blossom' // a garland of five-petal blossoms on a green swag
  | 'circuit' // etched PCB traces with lit solder pads
  | 'fossil' // a run of vertebrae and teeth set into the timber
  | 'candy-stripe' // barber-pole sugar stripes with a piped edge
  | 'coral' // branching coral fans and polyp dots
  | 'starfield'; // constellation punches joined by neon rule lines

export interface CrownSpec {
  profile: CrownProfile;
  carving: CrownCarving;
  /** Crown board height in world px. */
  height: number;
  /** How far the cornice oversails the case sides, world px. */
  overhang: number;
  /** Accent line under the carving (null = none). */
  bead: { colour: string; width: number } | null;
  /** Centre ornament: a small carved motif on the crown face. */
  centrepiece:
    | 'diamond'
    | 'star'
    | 'rosette'
    | 'crane'
    | 'mortar'
    | 'none'
    | 'blossom'
    | 'gear'
    | 'skull'
    | 'lollipop'
    | 'shell'
    | 'planet';
}

/* ================================= rail ================================== */

/** Vertical inlay running the height of the case side rails. */
export type RailInlay =
  | 'gold-pinstripe'
  | 'silver'
  | 'painted-line'
  | 'brass-bead'
  | 'none'
  /** A lit LED ribbon in an aluminium channel (robot workshop). */
  | 'led-strip'
  /** A living vine climbing the rail, leaves alternating up it. */
  | 'vine'
  /** Diagonal candy-cane stripes with a piped sugar edge. */
  | 'candy-stripe'
  /** A coral rib with polyp dots either side. */
  | 'coral-line'
  /** A neon tube: hot white core, saturated halo. */
  | 'neon';

/** Long-edge treatment of the rail stock. */
export type RailEdge = 'sharp' | 'rounded' | 'chamfer' | 'rough';

export interface RailSpec {
  inlay: RailInlay;
  /** Inlay ink (ignored when inlay === 'none'). */
  inlayColour: string;
  edge: RailEdge;
  /** Rail width in world px. */
  width: number;
  /** Pencil outline ink for the rail arrises. */
  ink: string;
}

/* ================================ plate ================================== */

/** Floor label plate material. */
export type PlateKind =
  | 'brass'
  | 'enamel'
  | 'wood-burnt'
  | 'paper-tag'
  | 'slate'
  | 'tin'
  /** A painted garden sign: bright board, carved edge, hand-lettered. */
  | 'painted-sign'
  /** A backlit LED read-out in a machined bezel. */
  | 'led-panel'
  /** A polished amber cabochon with an inclusion, set in bronze. */
  | 'amber-stone'
  /** A twisted sweet wrapper with the name printed on the foil. */
  | 'candy-wrapper'
  /** A fluted scallop shell with a pearl lustre. */
  | 'shell'
  /** A neon-tube sign in a dark plate, glow bleeding onto the timber. */
  | 'neon';

export interface PlateSpec {
  kind: PlateKind;
  /** Plate body colour. */
  body: string;
  /** Darker body tone (bevel shadow / edge). */
  bodyDark: string;
  /** Label text ink. */
  ink: string;
  /** Fixing detail drawn at the plate corners. */
  fixing: 'screws' | 'rivets' | 'string' | 'nails' | 'none';
  /** Plate size in world px. */
  w: number;
  h: number;
  /** Label font stack (must be one of the bundled faces). */
  font: string;
  /** Label size in world px (handwriting faces never below 13). */
  fontSize: number;
  /** 0–1 scorch amount for wood-burnt plates; 0 = a clean pale plaque. */
  burn: number;
  /** Corner radius in world px. */
  radius: number;
}

/* ============================== wallpaper ================================ */

/**
 * The twelve tileable patterns (§2). Pattern and colourway are independent so
 * users can mix any pattern with any colourway; the renderers live in
 * wallpaper.ts, the ids live here so themes.ts stays import-free.
 */
export const WALLPAPER_PATTERN_IDS = [
  'damask',
  'botanical-toile',
  'constellation',
  'ditsy-floral',
  'gingham-floral',
  'rice-paper-bamboo',
  'lath-plaster',
  'apothecary-labels',
  'art-nouveau-vine',
  'marbled-endpaper',
  'pin-dot',
  'plain-limewash',
  // v3 — the colourful six.
  'blossom-sky',
  'circuit-trace',
  'fern-footprint',
  'peppermint-stripe',
  'reef-bubble',
  'nebula',
] as const;

export type WallpaperPatternId = (typeof WALLPAPER_PATTERN_IDS)[number];

export function isWallpaperPatternId(v: unknown): v is WallpaperPatternId {
  return typeof v === 'string' && (WALLPAPER_PATTERN_IDS as readonly string[]).includes(v);
}

/** Named colourways, mixable with any pattern. */
export const COLOURWAY_IDS = [
  'tobacco',
  'eucalyptus',
  'midnight',
  'rose-cream',
  'limewash',
  'rice',
  'greyboard',
  'amber',
  'oxblood',
  'slate-blue',
  'moss',
  'ivory',
  // v3 — saturated colourways for the colourful worlds.
  'blossom',
  'chrome',
  'jungle',
  'bubblegum',
  'lagoon',
  'nebula',
] as const;

export type ColourwayId = (typeof COLOURWAY_IDS)[number];

export function isColourwayId(v: unknown): v is ColourwayId {
  return typeof v === 'string' && (COLOURWAY_IDS as readonly string[]).includes(v);
}

export interface WallpaperSpec {
  pattern: WallpaperPatternId;
  colourway: ColourwayId;
  /** Tile edge in world px (bigger = repetition harder to read). */
  tile: number;
}

/* =============================== backdrop ================================ */

/**
 * How the *room's wall* is finished behind the case. Orthogonal to the
 * wallpaper: a papered wall shows the pattern edge to edge, a panelled wall
 * shows it only above the dado, and plastered/boarded/shoji/glazed walls
 * ignore the pattern entirely and take only its colourway. Every theme offers
 * two or three, and the studio may pick any of them independently of the room
 * (`resolveBackdrop`), so "Cottage Nook with a boarded wall" is one click.
 */
export const BACKDROP_IDS = [
  'papered', // wallpaper, edge to edge
  'panelled', // fielded timber dado + chair rail, paper above
  'plastered', // trowelled limewash, ghost of a fresco
  'boarded', // vertical tongue-and-groove boarding
  'shoji', // paper screens in a kumiko lattice, lit from behind
  'glazed', // glasshouse window wall, foliage beyond
] as const;

export type BackdropId = (typeof BACKDROP_IDS)[number];

export function isBackdropId(v: unknown): v is BackdropId {
  return typeof v === 'string' && (BACKDROP_IDS as readonly string[]).includes(v);
}

export interface BackdropInfo {
  id: BackdropId;
  name: string;
  /** One line for the studio picker. */
  blurb: string;
  /** Whether the wallpaper pattern is visible at all in this treatment. */
  usesPattern: boolean;
}

export const BACKDROPS: Readonly<Record<BackdropId, BackdropInfo>> = {
  papered: {
    id: 'papered',
    name: 'Papered',
    blurb: 'The wallpaper, floor to ceiling.',
    usesPattern: true,
  },
  panelled: {
    id: 'panelled',
    name: 'Panelled',
    blurb: 'Fielded timber below a chair rail, paper above.',
    usesPattern: true,
  },
  plastered: {
    id: 'plastered',
    name: 'Plastered',
    blurb: 'Trowelled limewash with the ghost of an old fresco.',
    usesPattern: false,
  },
  boarded: {
    id: 'boarded',
    name: 'Boarded',
    blurb: 'Vertical tongue-and-groove, beaded and a little tired.',
    usesPattern: false,
  },
  shoji: {
    id: 'shoji',
    name: 'Shoji',
    blurb: 'Paper screens in a kumiko lattice, lit from behind.',
    usesPattern: false,
  },
  glazed: {
    id: 'glazed',
    name: 'Glazed',
    blurb: 'A glasshouse wall — mullions, condensation, green beyond.',
    usesPattern: false,
  },
};

/** All backdrops in picker order. */
export function allBackdrops(): readonly BackdropInfo[] {
  return BACKDROP_IDS.map((id) => BACKDROPS[id]);
}

/* ================================ spines ================================= */

export type SpineMaterial = 'leather' | 'cloth' | 'paper' | 'vellum' | 'linen' | 'silk';

export interface SpineTheming {
  /** Weighted material bias for newly created books. */
  materials: readonly SpineMaterial[];
  /** Pigment ramp new spines draw from (hex). */
  pigments: readonly string[];
  /** 0–1 chance a new spine gets gilt bands/lettering. */
  gilt: number;
  /** 0–1 bias toward raised bands (leather) vs flat (paper/washi). */
  bands: number;
  /** 0–1 wear bias: 0 pristine, 1 well-loved. */
  wear: number;
}

/* =============================== the theme =============================== */

export interface LibraryTheme {
  id: ThemeId;
  name: string;
  blurb: string;
  wood: WoodSpec;
  joinery: JoinerySpec;
  crown: CrownSpec;
  rail: RailSpec;
  plate: PlateSpec;
  wallpaper: WallpaperSpec;
  /**
   * The room's two or three wall finishes, most characteristic first —
   * `backdrops[0]` is the room's own wall. Any backdrop may be chosen for any
   * theme from the studio; this list is only the curated shortlist.
   */
  backdrops: readonly [BackdropId, BackdropId, ...BackdropId[]];
  spineDefaults: SpineTheming;
  /**
   * Extra furniture hung under each shelf plank: apothecary drawers, cottage
   * bunting strung between floors. Omitted = a plain plank edge.
   */
  shelfDetail?: 'none' | 'drawers' | 'bunting';
  /**
   * What sits behind the books. Most rooms back the case in timber; the
   * scriptorium and attic show the room's own wall straight through.
   */
  backing?: 'wood' | 'wallpaper';
}

/* ============================== the registry ============================= */

/* ------------------------- the colourful six (v3) ------------------------ */

const BLOSSOM: LibraryTheme = {
  id: 'blossom',
  name: 'Blossom Grove',
  blurb: 'A living tree: birch, bright leaf vines and cherry blossom over the crown.',
  wood: {
    light: '#fdf3e2',
    dark: '#b98a55',
    grain: 'birch',
    ringFreq: 2.2,
    ringGamma: 1.2,
    along: 0.006,
    across: 0.045,
    knots: 0.6,
    streaks: 5,
    contrast: 0.74,
    finish: 'wax',
    sheen: 0.4,
  },
  joinery: {
    kind: 'vine-tie',
    metal: '#57c25c',
    metalDark: '#2f7d3c',
    highlight: 'rgba(226, 255, 214, 0.75)',
    size: 4,
    density: 0.6,
  },
  crown: {
    profile: 'arch',
    carving: 'blossom',
    height: 50,
    overhang: 14,
    bead: { colour: 'rgba(95, 191, 98, 0.75)', width: 1.6 },
    centrepiece: 'blossom',
  },
  rail: {
    inlay: 'brass-bead',
    inlayColour: '#c9a24a',
    edge: 'rounded',
    width: 34,
    ink: 'rgba(92, 74, 52, 0.5)',
  },
  plate: {
    kind: 'painted-sign',
    body: '#4fb95a',
    bodyDark: '#2c7c39',
    ink: 'rgba(255, 252, 236, 0.96)',
    fixing: 'screws',
    w: 112,
    h: 32,
    font: '"Caveat Variable", Caveat, cursive',
    fontSize: 22,
    burn: 0,
    radius: 9,
  },
  wallpaper: { pattern: 'blossom-sky', colourway: 'blossom', tile: 256 },
  backdrops: ['plastered', 'glazed', 'panelled'],
  spineDefaults: {
    materials: ['cloth', 'paper', 'linen'],
    pigments: ['#e75480', '#4fb95a', '#f7b32b', '#4aa3e0', '#b06fd6', '#ff8f6b'],
    gilt: 0.2,
    bands: 0.3,
    wear: 0.16,
  },
  // The grove is open to the sky: you see it straight through the case.
  backing: 'wood',
};

const ROBOT: LibraryTheme = {
  id: 'robot',
  name: 'Robot Workshop',
  blurb: 'Cherry-red enamel over navy steel, cyan LEDs and an amber bench lamp.',
  wood: {
    light: '#c7d8e8',
    dark: '#2c3a48',
    grain: 'brushed',
    ringFreq: 1.8,
    ringGamma: 1,
    along: 0.004,
    across: 0.09,
    knots: 0,
    streaks: 14,
    contrast: 0.8,
    finish: 'metal',
    sheen: 0.85,
    paint: { colour: '#d81f36', shade: '#8e1122', chipping: 0.14, opacity: 0.94 },
  },
  joinery: {
    kind: 'hex-bolt',
    metal: '#e2ecf6',
    metalDark: '#66788a',
    highlight: 'rgba(255, 255, 255, 0.9)',
    size: 4.2,
    density: 0.9,
  },
  crown: {
    profile: 'gantry',
    carving: 'circuit',
    height: 48,
    overhang: 8,
    bead: { colour: 'rgba(60, 232, 255, 0.85)', width: 1.6 },
    centrepiece: 'gear',
  },
  rail: {
    inlay: 'led-strip',
    inlayColour: '#3ce8ff',
    edge: 'sharp',
    width: 36,
    ink: 'rgba(26, 36, 48, 0.7)',
  },
  plate: {
    kind: 'led-panel',
    body: '#101d28',
    bodyDark: '#060d14',
    ink: 'rgba(96, 245, 255, 0.98)',
    fixing: 'screws',
    w: 112,
    h: 30,
    font: '"Nunito Sans", sans-serif',
    fontSize: 16,
    burn: 0,
    radius: 4,
  },
  wallpaper: { pattern: 'circuit-trace', colourway: 'chrome', tile: 256 },
  backdrops: ['panelled', 'papered', 'boarded'],
  spineDefaults: {
    materials: ['cloth', 'leather', 'linen'],
    pigments: ['#e8342f', '#12c8e8', '#ffc21c', '#f04ecb', '#2f6fe0', '#3ad17a'],
    gilt: 0.18,
    bands: 0.35,
    wear: 0.3,
  },
  shelfDetail: 'drawers',
};

const DINO: LibraryTheme = {
  id: 'dino',
  name: 'Dino Dig',
  blurb: 'Amber timber against jungle green, fossil bones and volcano sunset light.',
  wood: {
    light: '#d69340',
    dark: '#46260a',
    grain: 'knotty',
    ringFreq: 2.8,
    ringGamma: 1.5,
    along: 0.007,
    across: 0.044,
    knots: 3.6,
    streaks: 8,
    contrast: 1.08,
    finish: 'matte',
    sheen: 0.3,
  },
  joinery: {
    kind: 'bone-pin',
    metal: '#f4e8cc',
    metalDark: '#a48f68',
    highlight: 'rgba(255, 255, 244, 0.85)',
    size: 4.4,
    density: 0.7,
  },
  crown: {
    profile: 'gable',
    carving: 'fossil',
    height: 46,
    overhang: 10,
    bead: { colour: 'rgba(255, 176, 58, 0.7)', width: 1.6 },
    centrepiece: 'skull',
  },
  rail: {
    inlay: 'painted-line',
    inlayColour: '#35c257',
    edge: 'rough',
    width: 36,
    ink: 'rgba(58, 34, 14, 0.6)',
  },
  plate: {
    kind: 'amber-stone',
    body: '#f0930e',
    bodyDark: '#8f4708',
    ink: 'rgba(56, 26, 4, 0.92)',
    fixing: 'rivets',
    w: 108,
    h: 32,
    font: '"Kalam", cursive',
    fontSize: 20,
    burn: 0,
    radius: 12,
  },
  wallpaper: { pattern: 'fern-footprint', colourway: 'jungle', tile: 256 },
  backdrops: ['boarded', 'papered', 'plastered'],
  spineDefaults: {
    materials: ['leather', 'cloth', 'paper'],
    pigments: ['#2f9e4f', '#e8760f', '#c9302c', '#137a6e', '#f0b323', '#7a4a1e'],
    gilt: 0.24,
    bands: 0.5,
    wear: 0.5,
  },
  // The dig site is open to the jungle and the volcano behind it.
  backing: 'wood',
};

const CANDY: LibraryTheme = {
  id: 'candy',
  name: 'Candy Shop',
  blurb: 'Glossy bubblegum and mint, peppermint stripes and a sugar sparkle.',
  wood: {
    light: '#ffe2ef',
    dark: '#f39ac4',
    grain: 'gloss',
    ringFreq: 1.6,
    ringGamma: 1,
    along: 0.005,
    across: 0.05,
    knots: 0,
    streaks: 3,
    contrast: 0.5,
    finish: 'gloss',
    sheen: 0.8,
    paint: { colour: '#ff5f9e', shade: '#c22f7c', chipping: 0.05, opacity: 0.94 },
  },
  joinery: {
    kind: 'candy-stud',
    metal: '#68e8c4',
    metalDark: '#2aa88c',
    highlight: 'rgba(255, 255, 255, 0.92)',
    size: 4,
    density: 0.8,
  },
  crown: {
    profile: 'crest',
    carving: 'candy-stripe',
    height: 46,
    overhang: 14,
    bead: { colour: 'rgba(255, 244, 140, 0.9)', width: 2 },
    centrepiece: 'lollipop',
  },
  rail: {
    inlay: 'candy-stripe',
    inlayColour: '#ff5f9e',
    edge: 'rounded',
    width: 34,
    ink: 'rgba(150, 66, 108, 0.5)',
  },
  plate: {
    kind: 'candy-wrapper',
    body: '#ffe45c',
    bodyDark: '#e8a81c',
    ink: 'rgba(176, 40, 104, 0.95)',
    fixing: 'none',
    w: 108,
    h: 32,
    font: '"Caveat Variable", Caveat, cursive',
    fontSize: 22,
    burn: 0,
    radius: 10,
  },
  wallpaper: { pattern: 'peppermint-stripe', colourway: 'bubblegum', tile: 256 },
  backdrops: ['panelled', 'papered', 'boarded'],
  spineDefaults: {
    materials: ['paper', 'silk', 'cloth'],
    pigments: ['#ff5f9e', '#3fd6b0', '#ffd93d', '#b47cf0', '#5ec8ff', '#ff8a5c'],
    gilt: 0.16,
    bands: 0.2,
    wear: 0.08,
  },
  shelfDetail: 'bunting',
};

const REEF: LibraryTheme = {
  id: 'reef',
  name: 'Coral Reef',
  blurb: 'Turquoise case, coral branches and kelp, sunbeams falling through blue.',
  wood: {
    light: '#a8ece4',
    dark: '#227f88',
    grain: 'straight',
    ringFreq: 2.4,
    ringGamma: 1.3,
    along: 0.007,
    across: 0.05,
    knots: 0.4,
    streaks: 6,
    contrast: 0.66,
    finish: 'gloss',
    sheen: 0.6,
    paint: { colour: '#22bfb8', shade: '#0e7d86', chipping: 0.3, opacity: 0.9 },
  },
  joinery: {
    kind: 'shell-rivet',
    metal: '#ffddc6',
    metalDark: '#d3937c',
    highlight: 'rgba(255, 255, 255, 0.9)',
    size: 4,
    density: 0.65,
  },
  crown: {
    profile: 'arch',
    carving: 'coral',
    height: 48,
    overhang: 12,
    bead: { colour: 'rgba(255, 138, 118, 0.8)', width: 1.6 },
    centrepiece: 'shell',
  },
  rail: {
    inlay: 'coral-line',
    inlayColour: '#ff7a63',
    edge: 'rounded',
    width: 34,
    ink: 'rgba(18, 72, 88, 0.55)',
  },
  plate: {
    kind: 'shell',
    body: '#ffe0cb',
    bodyDark: '#dea287',
    ink: 'rgba(20, 78, 100, 0.92)',
    fixing: 'none',
    w: 104,
    h: 32,
    font: '"Patrick Hand", cursive',
    fontSize: 20,
    burn: 0,
    radius: 14,
  },
  wallpaper: { pattern: 'reef-bubble', colourway: 'lagoon', tile: 256 },
  backdrops: ['plastered', 'glazed', 'panelled'],
  spineDefaults: {
    materials: ['cloth', 'silk', 'linen'],
    pigments: ['#ff7a63', '#17b5c4', '#ffc75f', '#2f76c9', '#f25f9c', '#3fc98a'],
    gilt: 0.22,
    bands: 0.3,
    wear: 0.24,
  },
  // Open water behind the shelves rather than a timber back.
  backing: 'wood',
};

const VOYAGER: LibraryTheme = {
  id: 'voyager',
  name: 'Star Voyager',
  blurb: 'Indigo and violet lacquer, neon rails, planets and comet trails.',
  wood: {
    light: '#5646b8',
    dark: '#150f36',
    grain: 'flame',
    ringFreq: 3,
    ringGamma: 1.8,
    along: 0.005,
    across: 0.055,
    knots: 0.3,
    streaks: 9,
    contrast: 1,
    finish: 'lacquer',
    sheen: 0.75,
  },
  joinery: {
    kind: 'star-rivet',
    metal: '#c8d2ff',
    metalDark: '#4b3f8f',
    highlight: 'rgba(255, 255, 255, 0.9)',
    size: 4,
    density: 0.7,
  },
  crown: {
    profile: 'crest',
    carving: 'starfield',
    height: 50,
    overhang: 11,
    bead: { colour: 'rgba(120, 244, 255, 0.85)', width: 1.6 },
    centrepiece: 'planet',
  },
  rail: {
    inlay: 'neon',
    inlayColour: '#ff45d0',
    edge: 'sharp',
    width: 34,
    ink: 'rgba(20, 14, 44, 0.7)',
  },
  plate: {
    kind: 'neon',
    body: '#1a1246',
    bodyDark: '#0a0724',
    ink: 'rgba(120, 246, 255, 0.98)',
    fixing: 'rivets',
    w: 110,
    h: 32,
    font: '"Kalam", cursive',
    fontSize: 20,
    burn: 0,
    radius: 6,
  },
  wallpaper: { pattern: 'nebula', colourway: 'nebula', tile: 256 },
  backdrops: ['papered', 'glazed', 'panelled'],
  spineDefaults: {
    materials: ['leather', 'silk', 'cloth'],
    pigments: ['#5b3fd6', '#12d3e8', '#ff45b8', '#ffcf3f', '#3f7bff', '#8aff9e'],
    gilt: 0.42,
    bands: 0.45,
    wear: 0.14,
  },
  // There is no back to this case; there is only the nebula.
  backing: 'wood',
};

/* --------------------------- the original eight -------------------------- */

const ATHENAEUM: LibraryTheme = {
  id: 'athenaeum',
  name: 'Old Athenaeum',
  blurb: 'Quartersawn oak, brass and gilt — the refined default.',
  wood: {
    light: '#a87c45',
    dark: '#3c2410',
    grain: 'quartersawn',
    ringFreq: 3.4,
    ringGamma: 1.7,
    along: 0.006,
    across: 0.05,
    knots: 1.4,
    streaks: 7,
    contrast: 1,
    finish: 'wax',
    sheen: 0.5,
  },
  joinery: {
    kind: 'peg',
    metal: '#7d5f3f',
    metalDark: '#43301f',
    highlight: 'rgba(255, 240, 214, 0.42)',
    size: 3.6,
    density: 0.7,
  },
  crown: {
    profile: 'stepped',
    carving: 'dentil',
    height: 46,
    overhang: 10,
    bead: { colour: 'rgba(255, 198, 62, 0.72)', width: 1.2 },
    centrepiece: 'diamond',
  },
  rail: {
    inlay: 'gold-pinstripe',
    inlayColour: 'rgba(255, 198, 62, 0.72)',
    edge: 'sharp',
    width: 34,
    ink: 'rgba(60, 52, 44, 0.55)',
  },
  plate: {
    kind: 'brass',
    body: '#d8ac3c',
    bodyDark: '#8f6a15',
    ink: 'rgba(52, 38, 16, 0.85)',
    fixing: 'screws',
    w: 108,
    h: 30,
    font: '"Caveat Variable", Caveat, cursive',
    fontSize: 20,
    burn: 0,
    radius: 3,
  },
  wallpaper: { pattern: 'damask', colourway: 'tobacco', tile: 256 },
  backdrops: ['panelled', 'papered', 'plastered'],
  spineDefaults: {
    materials: ['leather', 'cloth', 'leather'],
    pigments: ['#a02a22', '#1f7a4a', '#d09a18', '#3b3a96', '#b0561c', '#7a2f6a'],
    gilt: 0.62,
    bands: 0.8,
    wear: 0.3,
  },
};

const CONSERVATORY: LibraryTheme = {
  id: 'conservatory',
  name: 'Fern Conservatory',
  blurb: 'Chipped sage paint, enamel plates and things growing everywhere.',
  wood: {
    light: '#dccdae',
    dark: '#b09b78',
    grain: 'straight',
    ringFreq: 2.4,
    ringGamma: 1.3,
    along: 0.008,
    across: 0.04,
    knots: 0.8,
    streaks: 4,
    contrast: 0.6,
    finish: 'painted',
    sheen: 0.22,
    paint: { colour: '#5cb96b', shade: '#247a45', chipping: 0.55, opacity: 0.94 },
  },
  joinery: {
    kind: 'mitre',
    metal: '#7fce88',
    metalDark: '#3f9a5e',
    highlight: 'rgba(255, 255, 246, 0.5)',
    size: 2.4,
    density: 0.35,
  },
  crown: {
    profile: 'ogee',
    carving: 'scallop',
    height: 44,
    overhang: 12,
    bead: { colour: 'rgba(246, 250, 240, 0.5)', width: 1.2 },
    centrepiece: 'rosette',
  },
  rail: {
    inlay: 'painted-line',
    inlayColour: 'rgba(238, 246, 232, 0.55)',
    edge: 'chamfer',
    width: 32,
    ink: 'rgba(74, 84, 66, 0.5)',
  },
  plate: {
    kind: 'enamel',
    body: '#f2f4ea',
    bodyDark: '#c3ccb8',
    ink: 'rgba(58, 78, 60, 0.85)',
    fixing: 'rivets',
    w: 104,
    h: 32,
    font: '"Patrick Hand", cursive',
    fontSize: 19,
    burn: 0,
    radius: 14,
  },
  wallpaper: { pattern: 'botanical-toile', colourway: 'eucalyptus', tile: 256 },
  backdrops: ['glazed', 'boarded', 'papered'],
  spineDefaults: {
    materials: ['paper', 'linen', 'cloth'],
    pigments: ['#5aa84a', '#e0c063', '#3f9fb0', '#d98a5a', '#9a6fc4', '#e0705f'],
    gilt: 0.08,
    bands: 0.2,
    wear: 0.35,
  },
};

const OBSERVATORY: LibraryTheme = {
  id: 'observatory',
  name: 'Moonlit Observatory',
  blurb: 'Near-black walnut, silver inlay and a sky full of tiny gold stars.',
  wood: {
    light: '#544a86',
    dark: '#141033',
    grain: 'flame',
    ringFreq: 2.8,
    ringGamma: 2,
    along: 0.005,
    across: 0.055,
    knots: 0.6,
    streaks: 8,
    contrast: 1.05,
    finish: 'lacquer',
    sheen: 0.68,
  },
  joinery: {
    kind: 'brass-bracket',
    metal: '#b6bcc4',
    metalDark: '#6a717b',
    highlight: 'rgba(238, 246, 255, 0.65)',
    size: 3.2,
    density: 0.5,
  },
  crown: {
    profile: 'stepped',
    carving: 'star-punch',
    height: 48,
    overhang: 9,
    bead: { colour: 'rgba(196, 206, 220, 0.6)', width: 1 },
    centrepiece: 'star',
  },
  rail: {
    inlay: 'silver',
    inlayColour: 'rgba(214, 228, 255, 0.75)',
    edge: 'sharp',
    width: 34,
    ink: 'rgba(24, 22, 28, 0.7)',
  },
  plate: {
    kind: 'slate',
    body: '#3b4048',
    bodyDark: '#22262c',
    ink: 'rgba(216, 226, 240, 0.9)',
    fixing: 'rivets',
    w: 106,
    h: 30,
    font: '"Kalam", cursive',
    fontSize: 19,
    burn: 0,
    radius: 2,
  },
  wallpaper: { pattern: 'constellation', colourway: 'midnight', tile: 256 },
  backdrops: ['plastered', 'glazed', 'panelled'],
  spineDefaults: {
    materials: ['leather', 'silk', 'cloth'],
    pigments: ['#2b3fb0', '#7a2f9e', '#1f7a9e', '#8a90e0', '#e0b83f', '#c43f8a'],
    gilt: 0.5,
    bands: 0.6,
    wear: 0.2,
  },
};

const COTTAGE: LibraryTheme = {
  id: 'cottage',
  name: 'Cottage Nook',
  blurb: 'Honey pine, knots and knitting — warm and thoroughly lived in.',
  wood: {
    light: '#f5c877',
    dark: '#a5641e',
    grain: 'knotty',
    ringFreq: 2.6,
    ringGamma: 1.4,
    along: 0.007,
    across: 0.042,
    knots: 4.2,
    streaks: 6,
    contrast: 0.92,
    finish: 'matte',
    sheen: 0.28,
  },
  joinery: {
    kind: 'painted-chip',
    metal: '#f3e2cb',
    metalDark: '#c39a6e',
    highlight: 'rgba(255, 250, 236, 0.6)',
    size: 3,
    density: 0.5,
  },
  crown: {
    profile: 'flat',
    carving: 'ovolo',
    height: 40,
    overhang: 13,
    bead: { colour: 'rgba(255, 122, 138, 0.7)', width: 1.8 },
    centrepiece: 'rosette',
  },
  rail: {
    inlay: 'painted-line',
    inlayColour: 'rgba(255, 122, 138, 0.7)',
    edge: 'rounded',
    width: 32,
    ink: 'rgba(96, 70, 46, 0.5)',
  },
  plate: {
    kind: 'paper-tag',
    body: '#f5e7cd',
    bodyDark: '#d8c39c',
    ink: 'rgba(112, 74, 46, 0.85)',
    fixing: 'string',
    w: 100,
    h: 34,
    font: '"Caveat Variable", Caveat, cursive',
    fontSize: 21,
    burn: 0,
    radius: 4,
  },
  wallpaper: { pattern: 'gingham-floral', colourway: 'rose-cream', tile: 256 },
  backdrops: ['boarded', 'papered', 'panelled'],
  spineDefaults: {
    materials: ['cloth', 'linen', 'paper'],
    pigments: ['#f0899e', '#ffd166', '#7fc98a', '#d98ac4', '#6fb6d6', '#e8825c'],
    gilt: 0.12,
    bands: 0.25,
    wear: 0.55,
  },
  shelfDetail: 'bunting',
};

const SCRIPTORIUM: LibraryTheme = {
  id: 'scriptorium',
  name: 'Scriptorium',
  blurb: 'Blackened timber, iron straps, limewashed plaster and candlelight.',
  wood: {
    light: '#6b5230',
    dark: '#1e150c',
    grain: 'weathered',
    ringFreq: 2.2,
    ringGamma: 2.1,
    along: 0.005,
    across: 0.06,
    knots: 2.4,
    streaks: 9,
    contrast: 1.1,
    finish: 'raw',
    sheen: 0.1,
  },
  joinery: {
    kind: 'iron-strap',
    metal: '#5b5751',
    metalDark: '#2b2823',
    highlight: 'rgba(220, 214, 200, 0.4)',
    size: 9,
    density: 0.9,
  },
  crown: {
    profile: 'beam',
    carving: 'plain',
    height: 52,
    overhang: 6,
    bead: null,
    centrepiece: 'none',
  },
  rail: {
    inlay: 'none',
    inlayColour: 'rgba(0, 0, 0, 0)',
    edge: 'rough',
    width: 38,
    ink: 'rgba(24, 20, 14, 0.65)',
  },
  plate: {
    kind: 'wood-burnt',
    body: '#8a6d4a',
    bodyDark: '#4e3a24',
    ink: 'rgba(38, 24, 12, 0.9)',
    fixing: 'nails',
    w: 104,
    h: 30,
    font: '"Kalam", cursive',
    fontSize: 19,
    burn: 0.85,
    radius: 2,
  },
  wallpaper: { pattern: 'plain-limewash', colourway: 'limewash', tile: 256 },
  backdrops: ['plastered', 'boarded', 'papered'],
  spineDefaults: {
    materials: ['vellum', 'leather', 'paper'],
    pigments: ['#e8d8a8', '#a82a1e', '#d0a02a', '#2f6a4a', '#3a5a9e', '#7a3a1e'],
    gilt: 0.45,
    bands: 0.7,
    wear: 0.7,
  },
  // The scriptorium's own limewashed wall shows straight through the case.
  backing: 'wallpaper',
};

const SAKURA: LibraryTheme = {
  id: 'sakura',
  name: 'Sakura Pavilion',
  blurb: 'Pale hinoki, flawless joinery, rice paper and drifting petals.',
  wood: {
    light: '#f0e0c2',
    dark: '#cbb188',
    grain: 'fine',
    ringFreq: 4.6,
    ringGamma: 1.2,
    along: 0.004,
    across: 0.07,
    knots: 0.2,
    streaks: 5,
    contrast: 0.5,
    finish: 'raw',
    sheen: 0.2,
  },
  joinery: {
    kind: 'mitre',
    metal: '#e2d0ae',
    metalDark: '#b39d78',
    highlight: 'rgba(255, 252, 244, 0.7)',
    size: 2,
    density: 0.3,
  },
  crown: {
    profile: 'flat',
    carving: 'plain',
    height: 36,
    overhang: 16,
    bead: null,
    centrepiece: 'crane',
  },
  rail: {
    inlay: 'none',
    inlayColour: 'rgba(0, 0, 0, 0)',
    edge: 'chamfer',
    width: 30,
    ink: 'rgba(120, 104, 78, 0.45)',
  },
  plate: {
    kind: 'wood-burnt',
    body: '#e8d6b4',
    bodyDark: '#c2ab86',
    ink: 'rgba(70, 58, 42, 0.82)',
    fixing: 'none',
    w: 92,
    h: 30,
    font: '"Patrick Hand", cursive',
    fontSize: 19,
    burn: 0,
    radius: 2,
  },
  wallpaper: { pattern: 'rice-paper-bamboo', colourway: 'rice', tile: 256 },
  backdrops: ['shoji', 'papered', 'boarded'],
  spineDefaults: {
    materials: ['paper', 'silk', 'linen'],
    pigments: ['#2f5fbf', '#ff9ec2', '#6fbf5a', '#e8d9a8', '#e0607a', '#8a6fd0'],
    gilt: 0.06,
    bands: 0.1,
    wear: 0.12,
  },
};

const ATTIC: LibraryTheme = {
  id: 'attic',
  name: 'Attic Archive',
  blurb: 'Grey barn wood, mismatched planks and a zigzag of warm bulbs.',
  wood: {
    light: '#c9b48f',
    dark: '#6e5f48',
    grain: 'weathered',
    ringFreq: 2.9,
    ringGamma: 1.9,
    along: 0.006,
    across: 0.052,
    knots: 3,
    streaks: 11,
    contrast: 0.85,
    finish: 'raw',
    sheen: 0.06,
  },
  joinery: {
    kind: 'nail-head',
    metal: '#8a8177',
    metalDark: '#4d463e',
    highlight: 'rgba(240, 236, 226, 0.5)',
    size: 2.6,
    density: 1,
  },
  crown: {
    profile: 'gable',
    carving: 'plain',
    height: 42,
    overhang: 8,
    bead: null,
    centrepiece: 'none',
  },
  rail: {
    inlay: 'none',
    inlayColour: 'rgba(0, 0, 0, 0)',
    edge: 'rough',
    width: 33,
    ink: 'rgba(58, 52, 44, 0.55)',
  },
  plate: {
    kind: 'tin',
    body: '#a8a49b',
    bodyDark: '#6d6960',
    ink: 'rgba(48, 44, 38, 0.85)',
    fixing: 'nails',
    w: 102,
    h: 30,
    font: '"Nunito Sans", sans-serif',
    fontSize: 15,
    burn: 0,
    radius: 1,
  },
  wallpaper: { pattern: 'lath-plaster', colourway: 'greyboard', tile: 256 },
  backdrops: ['boarded', 'papered', 'plastered'],
  spineDefaults: {
    materials: ['paper', 'cloth', 'linen'],
    pigments: ['#d29a42', '#7f9e8a', '#c06a3a', '#4f7a9e', '#e0c070', '#a85a6a'],
    gilt: 0.04,
    bands: 0.15,
    wear: 0.9,
  },
  // No back boards at all in the attic — you see the lath straight through.
  backing: 'wallpaper',
};

const APOTHECARY: LibraryTheme = {
  id: 'apothecary',
  name: 'Amber Apothecary',
  blurb: 'Cherry and brass, tiny drawers, and bottles that glow from within.',
  wood: {
    light: '#c26a24',
    dark: '#57200c',
    grain: 'flame',
    ringFreq: 3.1,
    ringGamma: 1.6,
    along: 0.0055,
    across: 0.048,
    knots: 1,
    streaks: 8,
    contrast: 1,
    finish: 'lacquer',
    sheen: 0.6,
  },
  joinery: {
    kind: 'brass-bracket',
    metal: '#c9a94f',
    metalDark: '#8a6a24',
    highlight: 'rgba(255, 238, 190, 0.6)',
    size: 3.4,
    density: 0.8,
  },
  crown: {
    profile: 'pediment',
    carving: 'dentil',
    height: 50,
    overhang: 12,
    bead: { colour: 'rgba(214, 172, 74, 0.6)', width: 1.2 },
    centrepiece: 'mortar',
  },
  rail: {
    inlay: 'brass-bead',
    inlayColour: 'rgba(214, 172, 74, 0.55)',
    edge: 'rounded',
    width: 34,
    ink: 'rgba(56, 32, 20, 0.6)',
  },
  plate: {
    kind: 'brass',
    body: '#c7a54a',
    bodyDark: '#8a6a24',
    ink: 'rgba(48, 30, 12, 0.88)',
    fixing: 'screws',
    w: 96,
    h: 28,
    font: '"Kalam", cursive',
    fontSize: 18,
    burn: 0,
    radius: 3,
  },
  wallpaper: { pattern: 'apothecary-labels', colourway: 'amber', tile: 256 },
  backdrops: ['panelled', 'papered', 'plastered'],
  spineDefaults: {
    materials: ['leather', 'paper', 'cloth'],
    pigments: ['#e07a14', '#c2331e', '#e0a824', '#2f7a6a', '#8a3f9e', '#f0b83a'],
    gilt: 0.4,
    bands: 0.5,
    wear: 0.45,
  },
  shelfDetail: 'drawers',
};

/** Every theme, keyed by id. */
export const THEMES: Readonly<Record<ThemeId, LibraryTheme>> = {
  blossom: BLOSSOM,
  robot: ROBOT,
  dino: DINO,
  candy: CANDY,
  reef: REEF,
  voyager: VOYAGER,
  athenaeum: ATHENAEUM,
  conservatory: CONSERVATORY,
  observatory: OBSERVATORY,
  cottage: COTTAGE,
  scriptorium: SCRIPTORIUM,
  sakura: SAKURA,
  attic: ATTIC,
  apothecary: APOTHECARY,
};

/** Look up a theme; unknown ids fall back to the default room. */
export function getTheme(id: string | null | undefined): LibraryTheme {
  return isThemeId(id) ? THEMES[id] : THEMES[DEFAULT_THEME_ID];
}

/** All themes in picker order. */
export function allThemes(): readonly LibraryTheme[] {
  return THEME_IDS.map((id) => THEMES[id]);
}

/**
 * Apply user wallpaper overrides on top of a theme's own wallpaper, so the
 * studio's "pattern + colourway" controls can mix freely (§4).
 */
export function resolveWallpaper(
  theme: LibraryTheme,
  override?: { pattern?: string | null; colourway?: string | null } | null,
): WallpaperSpec {
  const pattern = isWallpaperPatternId(override?.pattern) ? override.pattern : theme.wallpaper.pattern;
  const colourway = isColourwayId(override?.colourway) ? override.colourway : theme.wallpaper.colourway;
  return { pattern, colourway, tile: theme.wallpaper.tile };
}

/**
 * Apply a user backdrop override on top of the room's own wall finish (§4).
 * Any of the six treatments may be chosen for any theme; an unrecognised or
 * absent override falls back to the theme's first (most characteristic) wall.
 */
export function resolveBackdrop(theme: LibraryTheme, override?: string | null): BackdropId {
  return isBackdropId(override) ? override : theme.backdrops[0];
}

/** The theme's own two or three wall finishes, with their picker copy. */
export function themeBackdrops(theme: LibraryTheme): readonly BackdropInfo[] {
  return theme.backdrops.map((id) => BACKDROPS[id]);
}
