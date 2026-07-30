/**
 * art/themes.ts — the library theme system (docs/design/library-themes.md §1).
 *
 * A theme is a complete art package, not a colour swap: wood palette + grain
 * character + finish, joinery vocabulary, cornice profile + carving, rail
 * inlay, floor-plate material, wallpaper (pattern × colourway), a light rig,
 * flora/props/motes dressing, and the pigment bias new book spines inherit.
 *
 * This module is the TYPE + DATA root of the theme system and deliberately
 * imports nothing from the rest of src/art, so every other art module can
 * depend on it without a cycle:
 *
 *     themes.ts  ←  wood.ts  ←  caseArt.ts
 *          ↑                       ↑
 *          └──── wallpaper.ts ─────┘
 *
 * Everything downstream is procedural + baked once (art-pipeline.md) and
 * deterministic per seed. Themes only *bias* per-book art — an explicit
 * per-book override always wins, so a favourite red leather book keeps its
 * identity in every room.
 */

/* ============================== identifiers ============================== */

export const THEME_IDS = [
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

/** The refined default room. */
export const DEFAULT_THEME_ID: ThemeId = 'athenaeum';

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
 */
export const THEME_RECIPE_VERSION = 1;

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
 */
export type WoodGrain = 'quartersawn' | 'knotty' | 'straight' | 'weathered' | 'fine' | 'flame';

/** Surface finish → specular character of the sheen pass. */
export type WoodFinish = 'wax' | 'matte' | 'lacquer' | 'raw' | 'painted' | 'limewash';

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
  | 'brass-bracket'; // small brass angle brackets + slotted screws

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
  | 'pediment'; // shopfront pediment with a centre keystone

/** Carving vocabulary run along the cornice. */
export type CrownCarving =
  | 'dentil' // tooth blocks
  | 'star-punch' // punched stars / pierced quatrefoils
  | 'scallop' // repeating shell arcs
  | 'plain' // no carving; the profile is the ornament
  | 'notch' // simple chip-carved v-notches
  | 'ovolo'; // rounded bead-and-fillet

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
  centrepiece: 'diamond' | 'star' | 'rosette' | 'crane' | 'mortar' | 'none';
}

/* ================================= rail ================================== */

/** Vertical inlay running the height of the case side rails. */
export type RailInlay = 'gold-pinstripe' | 'silver' | 'painted-line' | 'brass-bead' | 'none';

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
export type PlateKind = 'brass' | 'enamel' | 'wood-burnt' | 'paper-tag' | 'slate' | 'tin';

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

/* ================================ light ================================== */

/** A pool of light on the case, positioned in normalized case coordinates. */
export interface LightPool {
  /** 0–1 across the case. */
  x: number;
  /** 0–1 down the case (0 = crown). */
  y: number;
  /** Pool radius as a fraction of the case's longest side. */
  radius: number;
  colour: string;
  /** 0–1 peak intensity. */
  intensity: number;
  /** Horizontal drift amplitude in world px for the (very slow) idle sway. */
  drift: number;
}

export interface LightSpec {
  pools: LightPool[];
  /** Whole-room colour cast, multiplied over the case. */
  ambient: { colour: string; amount: number };
  /** Edge rim light (null = none). */
  rim: { colour: string; width: number; intensity: number } | null;
  /** Corner darkening. */
  vignette: { amount: number; colour: string };
  /** Seconds for one full drift cycle. */
  driftSeconds: number;
  /** Candle-style breathing: 0 = steady. */
  flicker: number;
  /** Visible dust shafts from the pools (attic). */
  shafts: boolean;
}

/* ============================= flora & props ============================= */

export type FloraSpecies =
  | 'ivy-trail'
  | 'pothos-trail'
  | 'moss-tuft'
  | 'fern-frond'
  | 'herb-bundle'
  | 'blossom-branch'
  | 'string-of-hearts'
  | 'potted-plant'
  | 'grass-tuft'
  | 'cobweb';

export type FloraAnchor =
  | 'rail-top'
  | 'shelf-underside'
  | 'case-corner'
  | 'crown-top'
  | 'joint-gap'
  | 'pot';

export type FloraDensity = 'none' | 'sparse' | 'lush';

export interface FloraSpec {
  species: readonly FloraSpecies[];
  density: FloraDensity;
  anchors: readonly FloraAnchor[];
}

/**
 * Themed shelf dressing. `kind` is a superset of the five prop kinds
 * currently implemented in props.ts; `fallback` maps every themed prop onto
 * one of those five so the shelf renders sensibly before the extended props
 * land (see "integration points" in the module docs).
 */
export type PropName =
  | 'plant'
  | 'hourglass'
  | 'candle'
  | 'globe'
  | 'bookstack'
  | 'terracotta-pot'
  | 'watering-can'
  | 'glass-cloche'
  | 'seed-packet'
  | 'orrery'
  | 'telescope'
  | 'moon-dial'
  | 'star-chart'
  | 'jam-jar'
  | 'thimble'
  | 'yarn-ball'
  | 'bunting'
  | 'quill'
  | 'wax-seal'
  | 'scroll'
  | 'bell'
  | 'tea-bowl'
  | 'ink-stone'
  | 'paper-crane'
  | 'crate'
  | 'suitcase'
  | 'dusty-jar'
  | 'newspapers'
  | 'mortar-pestle'
  | 'brass-scales'
  | 'glow-bottle'
  | 'inkwell'
  | 'candlestick';

/** Legacy prop kinds implemented today in props.ts (0–4). */
export type LegacyPropKind = 0 | 1 | 2 | 3 | 4;

export interface PropSpec {
  kind: PropName;
  /** Where the prop sits. */
  anchor: 'shelf' | 'crown' | 'shelf-underside' | 'floor';
  /** Selection weight (higher = shows up more often). */
  weight: number;
  /** Existing props.ts kind to draw until `kind` has its own renderer. */
  fallback: LegacyPropKind;
}

/* ============================ spines & motes ============================= */

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

export type MoteKind = 'dust' | 'pollen' | 'sparkle' | 'petals' | 'none';

export interface MoteSpec {
  kind: MoteKind;
  /** Particles per 1000×1000 world px. */
  density: number;
  colour: string;
  /** Fall speed in world px/s (negative drifts upward). */
  drift: number;
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
  light: LightSpec;
  flora: FloraSpec;
  props: readonly PropSpec[];
  spineDefaults: SpineTheming;
  motes: MoteSpec;
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

const ATHENAEUM: LibraryTheme = {
  id: 'athenaeum',
  name: 'Old Athenaeum',
  blurb: 'Quartersawn oak, brass and gilt — the refined default.',
  wood: {
    light: '#8d6a44',
    dark: '#3b2a19',
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
    bead: { colour: 'rgba(201, 162, 62, 0.55)', width: 1 },
    centrepiece: 'diamond',
  },
  rail: {
    inlay: 'gold-pinstripe',
    inlayColour: 'rgba(201, 162, 62, 0.5)',
    edge: 'sharp',
    width: 34,
    ink: 'rgba(60, 52, 44, 0.55)',
  },
  plate: {
    kind: 'brass',
    body: '#b9963f',
    bodyDark: '#7d6222',
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
  light: {
    pools: [
      { x: 0.26, y: 0.16, radius: 0.42, colour: '#ffd9a0', intensity: 0.5, drift: 10 },
      { x: 0.78, y: 0.52, radius: 0.36, colour: '#ffcf92', intensity: 0.34, drift: 7 },
    ],
    ambient: { colour: '#e8c894', amount: 0.14 },
    rim: null,
    vignette: { amount: 0.46, colour: '#3a2a18' },
    driftSeconds: 34,
    flicker: 0,
    shafts: false,
  },
  flora: { species: ['ivy-trail'], density: 'sparse', anchors: ['pot', 'rail-top'] },
  props: [
    { kind: 'hourglass', anchor: 'shelf', weight: 3, fallback: 1 },
    { kind: 'globe', anchor: 'shelf', weight: 2, fallback: 3 },
    { kind: 'candlestick', anchor: 'shelf', weight: 2, fallback: 2 },
    { kind: 'inkwell', anchor: 'shelf', weight: 2, fallback: 4 },
  ],
  spineDefaults: {
    materials: ['leather', 'cloth', 'leather'],
    pigments: ['#6e2420', '#2f4433', '#8a6420', '#3a3350', '#5c3a1e'],
    gilt: 0.62,
    bands: 0.8,
    wear: 0.3,
  },
  motes: { kind: 'dust', density: 26, colour: '#f2dcb4', drift: 5 },
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
    paint: { colour: '#93a68d', shade: '#71856c', chipping: 0.55, opacity: 0.94 },
  },
  joinery: {
    kind: 'mitre',
    metal: '#8fa389',
    metalDark: '#63775e',
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
  light: {
    pools: [
      { x: 0.5, y: -0.08, radius: 0.78, colour: '#e8f4ea', intensity: 0.42, drift: 4 },
      { x: 0.38, y: 1.02, radius: 0.5, colour: '#ffdca6', intensity: 0.24, drift: 3 },
    ],
    ambient: { colour: '#d6e2d0', amount: 0.13 },
    rim: { colour: '#f4fff2', width: 2.5, intensity: 0.3 },
    vignette: { amount: 0.22, colour: '#4c5a48' },
    driftSeconds: 46,
    flicker: 0,
    shafts: false,
  },
  flora: {
    species: ['ivy-trail', 'pothos-trail', 'moss-tuft', 'fern-frond', 'potted-plant'],
    density: 'lush',
    anchors: ['rail-top', 'shelf-underside', 'case-corner', 'joint-gap', 'pot', 'crown-top'],
  },
  props: [
    { kind: 'terracotta-pot', anchor: 'shelf', weight: 4, fallback: 0 },
    { kind: 'watering-can', anchor: 'shelf', weight: 2, fallback: 3 },
    { kind: 'glass-cloche', anchor: 'shelf', weight: 2, fallback: 1 },
    { kind: 'seed-packet', anchor: 'shelf', weight: 2, fallback: 4 },
  ],
  spineDefaults: {
    materials: ['paper', 'linen', 'cloth'],
    pigments: ['#8a9b74', '#c7b591', '#7d9aa2', '#b3866f', '#9e8fa8'],
    gilt: 0.08,
    bands: 0.2,
    wear: 0.35,
  },
  motes: { kind: 'pollen', density: 34, colour: '#f6f0b8', drift: -3 },
};

const OBSERVATORY: LibraryTheme = {
  id: 'observatory',
  name: 'Moonlit Observatory',
  blurb: 'Near-black walnut, silver inlay and a sky full of tiny gold stars.',
  wood: {
    light: '#4c403c',
    dark: '#171316',
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
    inlayColour: 'rgba(198, 210, 226, 0.55)',
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
  light: {
    pools: [
      { x: 0.16, y: 0.1, radius: 0.62, colour: '#b9cdf2', intensity: 0.44, drift: 5 },
      { x: 0.86, y: 0.78, radius: 0.3, colour: '#f0a95e', intensity: 0.2, drift: 3 },
    ],
    ambient: { colour: '#4a5a7c', amount: 0.24 },
    rim: { colour: '#dce8ff', width: 2.2, intensity: 0.6 },
    vignette: { amount: 0.6, colour: '#0d1020' },
    driftSeconds: 52,
    flicker: 0,
    shafts: false,
  },
  flora: { species: [], density: 'none', anchors: [] },
  props: [
    { kind: 'orrery', anchor: 'shelf', weight: 3, fallback: 3 },
    { kind: 'telescope', anchor: 'shelf', weight: 3, fallback: 1 },
    { kind: 'moon-dial', anchor: 'shelf', weight: 2, fallback: 3 },
    { kind: 'star-chart', anchor: 'shelf', weight: 2, fallback: 4 },
  ],
  spineDefaults: {
    materials: ['leather', 'silk', 'cloth'],
    pigments: ['#232c4c', '#432f52', '#1d3340', '#5a5f70', '#2b2440'],
    gilt: 0.5,
    bands: 0.6,
    wear: 0.2,
  },
  motes: { kind: 'sparkle', density: 18, colour: '#dfe9ff', drift: 1 },
};

const COTTAGE: LibraryTheme = {
  id: 'cottage',
  name: 'Cottage Nook',
  blurb: 'Honey pine, knots and knitting — warm and thoroughly lived in.',
  wood: {
    light: '#e6bc82',
    dark: '#a97440',
    grain: 'knotty',
    ringFreq: 2.6,
    ringGamma: 1.4,
    along: 0.007,
    across: 0.042,
    knots: 4.2,
    streaks: 6,
    contrast: 0.9,
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
    bead: { colour: 'rgba(226, 148, 138, 0.45)', width: 1.6 },
    centrepiece: 'rosette',
  },
  rail: {
    inlay: 'painted-line',
    inlayColour: 'rgba(224, 150, 140, 0.45)',
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
  light: {
    pools: [
      { x: 0.92, y: 0.3, radius: 0.72, colour: '#ffcf8a', intensity: 0.5, drift: 12 },
      { x: 0.34, y: 0.68, radius: 0.44, colour: '#ffd9a4', intensity: 0.3, drift: 8 },
    ],
    ambient: { colour: '#f2cf9c', amount: 0.16 },
    rim: { colour: '#fff0d2', width: 2, intensity: 0.26 },
    vignette: { amount: 0.34, colour: '#7a5334' },
    driftSeconds: 40,
    flicker: 0,
    shafts: false,
  },
  flora: {
    species: ['potted-plant', 'string-of-hearts', 'moss-tuft'],
    density: 'sparse',
    anchors: ['pot', 'rail-top', 'shelf-underside'],
  },
  props: [
    { kind: 'jam-jar', anchor: 'shelf', weight: 3, fallback: 0 },
    { kind: 'yarn-ball', anchor: 'shelf', weight: 3, fallback: 3 },
    { kind: 'thimble', anchor: 'shelf', weight: 2, fallback: 1 },
    { kind: 'bunting', anchor: 'shelf-underside', weight: 2, fallback: 4 },
  ],
  spineDefaults: {
    materials: ['cloth', 'linen', 'paper'],
    pigments: ['#dba7a4', '#e8c98a', '#a8b894', '#c9a2b6', '#8fa7b2'],
    gilt: 0.12,
    bands: 0.25,
    wear: 0.55,
  },
  motes: { kind: 'dust', density: 24, colour: '#ffe6bc', drift: 4 },
};

const SCRIPTORIUM: LibraryTheme = {
  id: 'scriptorium',
  name: 'Scriptorium',
  blurb: 'Blackened timber, iron straps, limewashed plaster and candlelight.',
  wood: {
    light: '#584c3e',
    dark: '#1d1812',
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
  light: {
    pools: [
      { x: 0.14, y: 0.24, radius: 0.3, colour: '#ffb54a', intensity: 0.56, drift: 3 },
      { x: 0.52, y: 0.08, radius: 0.26, colour: '#ffa838', intensity: 0.44, drift: 2 },
      { x: 0.86, y: 0.6, radius: 0.28, colour: '#ffbb58', intensity: 0.48, drift: 3 },
    ],
    ambient: { colour: '#c08a44', amount: 0.2 },
    rim: { colour: '#ffcf8a', width: 1.8, intensity: 0.34 },
    vignette: { amount: 0.72, colour: '#150e08' },
    driftSeconds: 22,
    flicker: 0.55,
    shafts: false,
  },
  flora: { species: ['cobweb'], density: 'sparse', anchors: ['case-corner', 'crown-top'] },
  props: [
    { kind: 'quill', anchor: 'shelf', weight: 3, fallback: 2 },
    { kind: 'wax-seal', anchor: 'shelf', weight: 2, fallback: 4 },
    { kind: 'scroll', anchor: 'shelf', weight: 3, fallback: 4 },
    { kind: 'bell', anchor: 'shelf', weight: 2, fallback: 1 },
  ],
  spineDefaults: {
    materials: ['vellum', 'leather', 'paper'],
    pigments: ['#d8c9a4', '#6d2a20', '#8a6a34', '#c0ac82', '#4a3524'],
    gilt: 0.45,
    bands: 0.7,
    wear: 0.7,
  },
  motes: { kind: 'dust', density: 48, colour: '#e8cf9a', drift: 6 },
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
  light: {
    pools: [
      { x: 0.5, y: 0.3, radius: 0.95, colour: '#fff6ea', intensity: 0.4, drift: 3 },
      { x: 0.2, y: 0.82, radius: 0.4, colour: '#ffeef2', intensity: 0.18, drift: 2 },
    ],
    ambient: { colour: '#f4ece0', amount: 0.1 },
    rim: { colour: '#fffaf2', width: 1.6, intensity: 0.22 },
    vignette: { amount: 0.14, colour: '#8c7f6c' },
    driftSeconds: 60,
    flicker: 0,
    shafts: false,
  },
  flora: {
    species: ['blossom-branch', 'moss-tuft'],
    density: 'sparse',
    anchors: ['crown-top', 'joint-gap'],
  },
  props: [
    { kind: 'tea-bowl', anchor: 'shelf', weight: 3, fallback: 0 },
    { kind: 'ink-stone', anchor: 'shelf', weight: 2, fallback: 4 },
    { kind: 'paper-crane', anchor: 'shelf', weight: 3, fallback: 1 },
  ],
  spineDefaults: {
    materials: ['paper', 'silk', 'linen'],
    pigments: ['#33507e', '#e8b7c4', '#8fa86a', '#d8cbb0', '#b06a72'],
    gilt: 0.06,
    bands: 0.1,
    wear: 0.12,
  },
  motes: { kind: 'petals', density: 12, colour: '#f6ccd6', drift: 8 },
};

const ATTIC: LibraryTheme = {
  id: 'attic',
  name: 'Attic Archive',
  blurb: 'Grey barn wood, mismatched planks and a zigzag of warm bulbs.',
  wood: {
    light: '#b6ada0',
    dark: '#6a6157',
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
  light: {
    pools: [
      { x: 0.12, y: 0.12, radius: 0.26, colour: '#ffca7a', intensity: 0.5, drift: 6 },
      { x: 0.38, y: 0.04, radius: 0.24, colour: '#ffc472', intensity: 0.46, drift: 6 },
      { x: 0.64, y: 0.14, radius: 0.24, colour: '#ffcd82', intensity: 0.44, drift: 6 },
      { x: 0.9, y: 0.05, radius: 0.24, colour: '#ffc06a', intensity: 0.42, drift: 6 },
    ],
    ambient: { colour: '#9e9484', amount: 0.18 },
    rim: null,
    vignette: { amount: 0.66, colour: '#241d16' },
    driftSeconds: 18,
    flicker: 0.12,
    shafts: true,
  },
  flora: { species: ['cobweb', 'grass-tuft'], density: 'sparse', anchors: ['case-corner', 'joint-gap'] },
  props: [
    { kind: 'crate', anchor: 'shelf', weight: 3, fallback: 4 },
    { kind: 'suitcase', anchor: 'shelf', weight: 2, fallback: 4 },
    { kind: 'dusty-jar', anchor: 'shelf', weight: 3, fallback: 1 },
    { kind: 'newspapers', anchor: 'shelf', weight: 2, fallback: 4 },
  ],
  spineDefaults: {
    materials: ['paper', 'cloth', 'linen'],
    pigments: ['#b39468', '#8e8577', '#a8845c', '#7c7f74', '#c2ab8a'],
    gilt: 0.04,
    bands: 0.15,
    wear: 0.9,
  },
  motes: { kind: 'dust', density: 62, colour: '#e6d5b4', drift: 7 },
};

const APOTHECARY: LibraryTheme = {
  id: 'apothecary',
  name: 'Amber Apothecary',
  blurb: 'Cherry and brass, tiny drawers, and bottles that glow from within.',
  wood: {
    light: '#a9663a',
    dark: '#4e2415',
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
  light: {
    pools: [
      { x: 0.22, y: 0.72, radius: 0.34, colour: '#ffb257', intensity: 0.5, drift: 4 },
      { x: 0.56, y: 0.86, radius: 0.28, colour: '#ffc266', intensity: 0.44, drift: 4 },
      { x: 0.84, y: 0.66, radius: 0.3, colour: '#ffa93f', intensity: 0.46, drift: 4 },
      { x: 0.5, y: 0.1, radius: 0.5, colour: '#f2c17e', intensity: 0.22, drift: 6 },
    ],
    ambient: { colour: '#d8973e', amount: 0.2 },
    rim: { colour: '#ffdc9a', width: 2, intensity: 0.4 },
    vignette: { amount: 0.52, colour: '#331a0c' },
    driftSeconds: 30,
    flicker: 0.18,
    shafts: false,
  },
  flora: {
    species: ['herb-bundle', 'ivy-trail'],
    density: 'sparse',
    anchors: ['shelf-underside', 'rail-top'],
  },
  props: [
    { kind: 'mortar-pestle', anchor: 'shelf', weight: 3, fallback: 4 },
    { kind: 'brass-scales', anchor: 'shelf', weight: 2, fallback: 1 },
    { kind: 'glow-bottle', anchor: 'shelf', weight: 4, fallback: 2 },
  ],
  spineDefaults: {
    materials: ['leather', 'paper', 'cloth'],
    pigments: ['#b6702a', '#8e3a20', '#a8722c', '#6e4420', '#c08a3a'],
    gilt: 0.4,
    bands: 0.5,
    wear: 0.45,
  },
  motes: { kind: 'sparkle', density: 22, colour: '#ffd28a', drift: 3 },
};

/** Every theme, keyed by id. */
export const THEMES: Readonly<Record<ThemeId, LibraryTheme>> = {
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
 * Scale a theme's flora density by the global settings slider (0–1).
 * 0 always yields a genuinely clean shelf (acceptance criterion §5).
 */
export function scaleFloraDensity(density: FloraDensity, slider: number): FloraDensity {
  if (slider <= 0.001 || density === 'none') return 'none';
  if (slider < 0.55) return density === 'lush' ? 'sparse' : 'sparse';
  return density;
}
