/**
 * art/flora.ts — the flora & growth system (docs/design/library-themes.md §3).
 *
 * "The thing that makes a shelf feel alive." Ten species grow on the case
 * itself — over rail tops, out of joint gaps, down from shelf undersides,
 * across crowns and into corners — all deterministic per
 * `(floorIndex, anchorId, themeSeed)` and all baked once into ImageBitmaps.
 *
 * Three layers, in order:
 *
 *   1. **Plan**  `planFlora()` — pure math. Picks which anchors grow what, at
 *      what scale, and returns placements with honest world-space bounds.
 *      No canvas, no DOM: safe to run in a worker or a unit test.
 *   2. **Grow**  `growFlora()` — turns a placement into `FloraGeometry`
 *      (stems, leaves, blooms, threads, pots, tags) in anchor-local coords.
 *   3. **Draw**  `drawFlora()` / `renderFloraSprite()` / `bakeFloraLayer()` —
 *      Canvas2D rendering of that geometry, once, into a sprite.
 *
 * ## Occlusion rule (binding)
 *
 * Flora renders **behind books** and must never cover a spine's title area.
 * The compositor enforces this with:
 *   - draw order: the flora layer is composited *before* the spine atlas;
 *   - `spineTitleKeepOut()` → per-book keep-out rects;
 *   - `enforceKeepOut()` → shrinks, then drops, any placement that would
 *     reach into one. `planFlora({ keepOut })` runs it for you.
 *
 * Bounds are deliberately conservative (leaves are bounded by a circle of
 * radius `leafBoundRadius`), so a placement that passes keep-out has margin.
 */

import { clamp, lerp, mulberry32, seededNoise1D, fnv1a, type RandomFn } from './noise';
import type { NoiseFunction1D } from './noise';
import {
  drawBellFlower,
  drawBlossom,
  drawFloretDome,
  drawLeaf,
  hsl,
  leafBoundRadius,
  traceSmooth,
  traceTapered,
  type LeafShape,
  type Pt,
} from './leaves';
import { bakeCached } from './bake';
import { blowOut, keyToSource, rgbaToCss, type LightRig } from './lighting';
import { getGranulationTile, type Canvas2D, type Ctx2D } from './spines';

/** Bump when the growth model or drawing changes — invalidates baked sprites. */
export const FLORA_RECIPE_VERSION = 4;

/**
 * Flora is decoration: the shelf compositor drops the whole layer below this
 * LOD tier (see bookshelf-rendering.md's 3-tier LOD).
 */
export const FLORA_MIN_LOD = 1;

/* ================================= types ================================== */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The ten species from the design doc. */
export type FloraSpeciesId =
  | 'ivy'
  | 'pothos'
  | 'moss'
  | 'fern'
  | 'herbBundle'
  | 'blossom'
  | 'hearts'
  | 'potted'
  | 'grassTuft'
  | 'cobweb';

export const FLORA_SPECIES: readonly FloraSpeciesId[] = [
  'ivy',
  'pothos',
  'moss',
  'fern',
  'herbBundle',
  'blossom',
  'hearts',
  'potted',
  'grassTuft',
  'cobweb',
];

/** Where on the case a plant may take hold. */
export type FloraAnchorKind =
  | 'railTop'
  | 'shelfUnderside'
  | 'caseCorner'
  | 'crownTop'
  | 'jointGap'
  | 'potPosition';

export const FLORA_ANCHOR_KINDS: readonly FloraAnchorKind[] = [
  'railTop',
  'shelfUnderside',
  'caseCorner',
  'crownTop',
  'jointGap',
  'potPosition',
];

export type FloraDensity = 'none' | 'sparse' | 'lush';

/** Fraction of eligible anchors that grow something, before the slider. */
export const DENSITY_COVERAGE: Record<FloraDensity, number> = {
  none: 0,
  sparse: 0.4,
  lush: 1,
};

/**
 * How many specimens pile onto ONE accepted anchor.
 *
 * This is the lever that was missing. Coverage alone can only ever produce
 * "one sprig per rail", and a single sprig is what made the old shelf read as
 * sprinkled decoration. A lush anchor now grows a **clump** — 2–4 specimens
 * fanned along the anchor's run at different scales and depths, which is what
 * turns individual plants into the *masses* the art direction asks for
 * (docs/design/painterly-art-direction.md §4).
 */
export const DENSITY_CLUMP: Record<FloraDensity, [number, number]> = {
  none: [0, 0],
  sparse: [1, 2],
  lush: [2, 4],
};

/**
 * Relative specimen size per density. "Lush" does not just mean *more* — the
 * reference painting's foliage is physically bigger than ours was, so lush
 * growth is scaled up as well as multiplied.
 */
export const DENSITY_SCALE: Record<FloraDensity, number> = {
  none: 1,
  sparse: 1,
  lush: 1.18,
};

/* ------------------------------- lighting -------------------------------- */

/**
 * The subset of the shared `LightRig` (docs/design/painterly-art-direction.md
 * §2) that flora actually consumes. Kept as its own small structure and
 * *injected* rather than imported, so this module never hard-depends on
 * `art/lighting.ts` landing — the compositor calls `setFloraLight()` once the
 * rig exists and every specimen baked afterwards picks it up.
 */
export interface FloraLight {
  /**
   * Direction **toward** the key light, in canvas radians (y grows downward).
   * The reference is lit from the upper right, i.e. ≈ -0.6 rad.
   */
  angle: number;
  /** Rim/edge colour on surfaces facing the key. */
  rim: string;
  /** Warm colour the lit tier is graded toward. */
  key: string;
  /** Cool bounce in the shadows. */
  fill: string;
  /** 0–1 overall strength of the rim and specular passes. */
  strength: number;
  /** How far the back tier is pushed toward silhouette, 0–1. */
  occlusion: number;
}

export const DEFAULT_FLORA_LIGHT: FloraLight = {
  angle: -0.62,
  rim: 'hsl(46 96% 82%)',
  key: 'hsl(44 88% 74%)',
  fill: 'hsl(214 44% 42%)',
  strength: 0.85,
  occlusion: 0.85,
};

let activeLight: FloraLight = DEFAULT_FLORA_LIGHT;

/**
 * Adapt the shared `LightRig` (art/lighting.ts) down to the handful of numbers
 * flora needs. Kept as an explicit adapter rather than consuming the rig
 * directly so the growth model stays testable in plain Node and so a caller
 * with no rig at all still gets a sensible painting.
 *
 * Angle convention: the rig's `keyAngle` is the direction light *travels*;
 * `keyToSource` gives the unit vector pointing back at the source, which is
 * what every shading term here wants.
 */
export function floraLightFromRig(rig: LightRig): FloraLight {
  const src = keyToSource(rig);
  return {
    angle: Math.atan2(src.y, src.x),
    rim: rgbaToCss(blowOut(rig.rimColour, 0.35)),
    key: rig.keyColour,
    fill: rig.fillColour,
    strength: clamp(rig.rimStrength * 0.85, 0, 1.4),
    occlusion: clamp(rig.ambientOcclusion, 0, 1.4),
  };
}

/** Point flora at a room's rig in one call. */
export function useFloraRig(rig: LightRig | null | undefined): void {
  setFloraLight(rig ? floraLightFromRig(rig) : null);
}

/**
 * Point the flora system at the room's light rig. Accepts a partial so a
 * caller holding a full shared `LightRig` can spread it in and let the
 * unrecognised fields fall away.
 */
export function setFloraLight(light: Partial<FloraLight> | null | undefined): void {
  activeLight = { ...DEFAULT_FLORA_LIGHT, ...(light ?? {}) };
}

export function getFloraLight(): FloraLight {
  return activeLight;
}

/**
 * Optional post-passes supplied by `art/lighting.ts`. Every one is feature
 * detected at call time: if the sibling module has not registered them, flora
 * simply draws its own (weaker but self-sufficient) contact shadows and rim.
 */
export interface FloraLightPasses {
  applyAmbientOcclusion?: (ctx: Ctx2D, w: number, h: number, amount: number) => void;
  castContactShadow?: (ctx: Ctx2D, x: number, y: number, rx: number, ry: number, a: number) => void;
  applyRimLight?: (ctx: Ctx2D, w: number, h: number, angle: number, colour: string) => void;
  applyBloom?: (ctx: Ctx2D, w: number, h: number, amount: number) => void;
  applyColourGrade?: (ctx: Ctx2D, w: number, h: number) => void;
}

let lightPasses: FloraLightPasses = {};

/** Register the shared lighting passes (called once by the compositor). */
export function setFloraLightPasses(p: FloraLightPasses | null | undefined): void {
  lightPasses = p ?? {};
}

/**
 * Depth tier. The reference painting's foliage reads because it is layered:
 * a near-black silhouette mass behind, ordinary foliage in the middle, and a
 * few big rim-lit blades in front. Everything grown here carries its tier and
 * the renderer sorts by it.
 */
export type FloraTier = 0 | 1 | 2;

export const TIER_BACK: FloraTier = 0;
export const TIER_MID: FloraTier = 1;
export const TIER_LIT: FloraTier = 2;

export type FloraFacing = 'up' | 'down' | 'left' | 'right';

/** A spot on the case that flora may grow from. `id` must be stable. */
export interface FloraAnchor {
  /** Stable identifier — part of the seed, so it must not change per frame. */
  id: string;
  kind: FloraAnchorKind;
  /** Attachment point, world px (the shelf compositor's coordinate space). */
  x: number;
  y: number;
  /** Primary growth direction. Defaults per `kind` (see `defaultFacing`). */
  facing?: FloraFacing;
  /** Mirror the growth laterally. Default: derived from the seed. */
  flip?: boolean;
  /** Run available along the anchor in px (rail width, gap width…). */
  run?: number;
}

/**
 * An HSL triple, `[hue 0-360, saturation 0-100, lightness 0-100]`. Roles are
 * authored as triples rather than strings because every species jitters and
 * shades around its role colour — you cannot do that to `#4bc23a`.
 */
export type ToneTuple = readonly [number, number, number];

/**
 * The colour roles a specimen paints from. A theme supplies as many as it
 * cares about; anything omitted falls back to `DEFAULT_FLORA_ROLES` (a vivid
 * summer garden), so `{}` is still a perfectly good palette.
 *
 * Species do NOT own absolute colours: each declares a small delta off a role
 * (see `SPECIES_TINT`). That is what lets "Coral Reef" repaint every plant on
 * the shelf into weed-teal and coral-pink while ivy, pothos and hearts stay
 * recognisably different plants from each other.
 */
export type FloraToneRole =
  /** Trailing vines and general foliage. */
  | 'leaf'
  /** Mature, deeper foliage — fern fronds. */
  | 'leafDeep'
  /** Cushion moss. */
  | 'moss'
  /** Grass blades. */
  | 'grass'
  /** Blossom petals. */
  | 'bloom'
  /** The warm small flower — dandelion heads. */
  | 'bloomAlt'
  /** The cool small flower — lavender-ish herb spikes. */
  | 'bloomCool'
  /** Woody branches and twigs. */
  | 'wood'
  /** Dried/sun-bleached material — herb bundles, dead grass blades. */
  | 'dry';

/** Roles that are flat CSS colour strings rather than jitterable tones. */
export type FloraStringRole = 'silk' | 'twine';

export type FloraRoles = {
  [K in FloraToneRole]?: ToneTuple;
} & {
  /** Cobweb silk. */
  silk?: string;
  /** Twine on hanging bundles. */
  twine?: string;
};

/**
 * Theme-level colour control for the planting.
 *
 * Two layers, deliberately: `hueShift`/`satShift`/`lightShift` are a cheap
 * global push over whatever the roles produce (dry a shelf out, cool it,
 * fade it for a crossfade), while the roles themselves repaint the world.
 */
export interface FloraPalette extends FloraRoles {
  hueShift?: number;
  satShift?: number;
  lightShift?: number;
  /** Pencil colour for every outline. Default a dark warm graphite-green. */
  ink?: string;
  /**
   * Per-leaf hue spread in degrees, ± this much. Higher = a scrappier, more
   * varied planting. Default 9.
   */
  variance?: number;
}

/** A theme's flora recipe — `LibraryTheme.flora` in `art/themes.ts`. */
export interface FloraSpec {
  /** Candidate species; the planner picks per anchor from the eligible ones. */
  species: readonly FloraSpeciesId[];
  density: FloraDensity;
  /** Anchor kinds this theme allows. Omit ⇒ every kind is eligible. */
  eligibleAnchors?: readonly FloraAnchorKind[];
  palette?: FloraPalette;
}

/** One planted specimen, ready to grow/draw. */
export interface FloraPlacement {
  /** `${floorIndex}:${anchor.id}` — unique within a floor. */
  id: string;
  anchor: FloraAnchor;
  species: FloraSpeciesId;
  /** Full 32-bit seed derived from (floorIndex, anchorId, themeSeed). */
  seed: number;
  scale: number;
  flip: boolean;
  facing: FloraFacing;
  palette: FloraPalette;
  /** World-space bounding box of everything this specimen draws. */
  bounds: Rect;
}

/* ------------------------------- geometry -------------------------------- */

export interface Tone {
  h: number;
  s: number;
  l: number;
}

export interface StemGeom {
  pts: Pt[];
  widths: number[];
  tone: Tone;
  /** 0 = green shoot, 1 = woody branch (drawn browner, harder-edged). */
  woody: number;
  /** Depth tier. Default `TIER_MID`. */
  tier?: FloraTier;
  /** Draw bark striations along the length. Set on the thick woody stems. */
  bark?: boolean;
}

export interface LeafGeom {
  x: number;
  y: number;
  angle: number;
  len: number;
  width: number;
  shape: LeafShape;
  bend: number;
  curl: number;
  tone: Tone;
  /** Variegated (pale-streaked) leaf — pothos and some herbs. */
  pale: boolean;
  seed: number;
  /** Depth tier. Default `TIER_MID`. */
  tier?: FloraTier;
  /** 0–1 nibbled/torn margin. A canopy with no damage looks manufactured. */
  damage?: number;
}

export type BloomKind =
  | 'blossom'
  | 'bud'
  | 'dandelion'
  | 'puff'
  | 'capsule'
  | 'dust'
  | 'berry'
  /** Side-on trumpet — foxglove, morning glory. */
  | 'bell'
  /** Many-floret dome — hydrangea, lilac, cow-parsley. */
  | 'dome'
  /** A wide flat daisy/rose face with many petals. */
  | 'rosette';

export interface BloomGeom {
  x: number;
  y: number;
  r: number;
  kind: BloomKind;
  /** 0 = closed bud, 1 = fully open. */
  open: number;
  tone: Tone;
  seed: number;
  /** Depth tier. Default `TIER_MID`. */
  tier?: FloraTier;
  /** Facing rotation for bells and rosettes, radians. */
  angle?: number;
  /** Petal count override (rosettes want 8–13, blossoms 5). */
  petals?: number;
}

export interface ThreadGeom {
  pts: Pt[];
  width: number;
  alpha: number;
  colour: string;
  /**
   * Optional wider stroke laid down first. Pale silk needs a dark halo to
   * survive on parchment; dark twine needs none.
   */
  halo?: string;
  /** Depth tier. Default `TIER_MID`. */
  tier?: FloraTier;
  /** Taper the stroke from full width to nothing. Default false. */
  taper?: boolean;
}

export interface PotGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'terracotta' | 'brass' | 'enamel';
}

export interface TagGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
}

/** A soft contact shadow that grounds a specimen on the surface it sits on. */
export interface ShadeGeom {
  x: number;
  y: number;
  rx: number;
  ry: number;
  alpha: number;
}

/**
 * A filled cushion silhouette drawn *under* a fringe of leaves. This is what
 * gives a moss tuft actual volume — without a body, a few dozen tiny blades
 * only ever read as scattered grit.
 */
export interface MoundGeom {
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** +1 = the dome bulges toward -y (sits on a surface), -1 = toward +y. */
  up: number;
  tone: Tone;
  seed: number;
  /** Depth tier. Default `TIER_MID`. */
  tier?: FloraTier;
}

export interface FloraGeometry {
  stems: StemGeom[];
  leaves: LeafGeom[];
  blooms: BloomGeom[];
  threads: ThreadGeom[];
  pots: PotGeom[];
  tags: TagGeom[];
  shades: ShadeGeom[];
  mounds: MoundGeom[];
  ink: string;
  /** Anchor-local bounding box (add the anchor position for world space). */
  bounds: Rect;
}

/* ================================ seeding ================================= */

/** The one and only seed derivation: `(floorIndex, anchorId, themeSeed)`. */
export function floraSeed(floorIndex: number, anchorId: string, themeSeed: number): number {
  return fnv1a(`flora|${FLORA_RECIPE_VERSION}|${floorIndex}|${anchorId}|${themeSeed >>> 0}`);
}

/* ============================= species table ============================== */

interface SpeciesDef {
  id: FloraSpeciesId;
  label: string;
  /** Anchor kinds this species can grow from. */
  anchors: readonly FloraAnchorKind[];
  /** Scale range picked per specimen. */
  scale: [number, number];
  /** Nominal untransformed footprint width, used to fit `anchor.run`. */
  nominalW: number;
  grow: (gr: Grow) => void;
}

/** Human-readable species names (settings UI, debug boards). */
export const FLORA_LABELS: Record<FloraSpeciesId, string> = {
  ivy: 'ivy trail',
  pothos: 'pothos trail',
  moss: 'moss tuft',
  fern: 'fern frond',
  herbBundle: 'hanging herb bundle',
  blossom: 'blossom branch',
  hearts: 'string-of-hearts trail',
  potted: 'small potted plant',
  grassTuft: 'grass & dandelion tuft',
  cobweb: 'cobweb',
};

const DEFAULT_INK = 'hsl(112 34% 18%)';

/* ============================== colour roles ============================== */

/**
 * The default world: a summer garden in full colour. These are the numbers a
 * theme overrides — see `FLORA_PALETTES` for the shipped alternatives.
 *
 * Saturation matters more than hue here. The old planting sat around 30-35%
 * and read as sage-grey pot-pourri at shelf scale; foliage in daylight is
 * 45-55% and blossom is 70-85%, which is what makes growth look *alive*
 * rather than pressed and dried.
 */
export const DEFAULT_FLORA_ROLES: Record<FloraToneRole, ToneTuple> = {
  leaf: [98, 38, 34],
  leafDeep: [126, 36, 28],
  moss: [92, 38, 29],
  grass: [84, 42, 37],
  bloom: [344, 62, 74],
  bloomAlt: [44, 78, 58],
  bloomCool: [276, 42, 68],
  wood: [24, 34, 26],
  dry: [40, 40, 52],
};

/** String-valued roles (drawn flat, never jittered). */
export const DEFAULT_FLORA_STRINGS: Record<FloraStringRole, string> = {
  silk: 'hsl(190 26% 92%)',
  twine: 'hsl(36 46% 58%)',
};

/** Every tone role, in a stable order (cache keys, debug boards, tests). */
export const TONE_ROLES: readonly FloraToneRole[] = [
  'leaf',
  'leafDeep',
  'moss',
  'grass',
  'bloom',
  'bloomAlt',
  'bloomCool',
  'wood',
  'dry',
];

/**
 * Named palettes a theme can point at (`LibraryTheme.flora.palette`). Each is
 * a partial set of roles: anything left out keeps the garden default, which
 * is why "Autumn Study" only has to say what turns.
 */
export const FLORA_PALETTES = {
  /** The default: high-summer garden greens, cherry-pink blossom. */
  garden: {},
  /** Cherry orchard in full bloom — pale-bright foliage, heaps of blossom. */
  blossomGrove: {
    leaf: [108, 54, 43],
    leafDeep: [124, 50, 38],
    moss: [100, 52, 38],
    grass: [92, 56, 46],
    bloom: [338, 88, 84],
    bloomAlt: [52, 96, 68],
    wood: [16, 34, 32],
    variance: 11,
  },
  /** Underwater: weed-teal fronds, coral heads, urchin-violet buds. */
  coralReef: {
    leaf: [172, 60, 41],
    leafDeep: [190, 58, 36],
    moss: [166, 52, 35],
    grass: [180, 56, 44],
    bloom: [10, 88, 68],
    bloomAlt: [288, 72, 68],
    wood: [200, 22, 38],
    dry: [30, 42, 60],
    silk: 'hsl(186 60% 90%)',
    twine: 'hsl(190 34% 62%)',
    ink: 'hsl(196 46% 18%)',
    variance: 14,
  },
  /** Jurassic undergrowth: deep jungle greens, hot volcanic blooms. */
  dinoDig: {
    leaf: [98, 50, 32],
    leafDeep: [142, 46, 27],
    moss: [82, 46, 29],
    grass: [72, 52, 40],
    bloom: [28, 88, 58],
    bloomAlt: [14, 82, 52],
    wood: [26, 44, 25],
    dry: [38, 54, 52],
    ink: 'hsl(104 40% 14%)',
    variance: 12,
  },
  /** Workshop circuitry: neon teal "foliage", magenta indicator blooms. */
  circuit: {
    leaf: [168, 70, 44],
    leafDeep: [198, 68, 38],
    moss: [186, 62, 36],
    grass: [160, 68, 46],
    bloom: [318, 88, 66],
    bloomAlt: [52, 96, 60],
    wood: [220, 14, 34],
    dry: [206, 20, 56],
    silk: 'hsl(184 70% 88%)',
    twine: 'hsl(210 20% 60%)',
    ink: 'hsl(206 44% 16%)',
    variance: 10,
  },
  /** Sweet-shop: mint stems, bubblegum flowers, sherbet everything. */
  candy: {
    leaf: [150, 58, 50],
    leafDeep: [166, 54, 44],
    moss: [300, 42, 60],
    grass: [140, 60, 54],
    bloom: [330, 92, 80],
    bloomAlt: [40, 96, 70],
    wood: [20, 38, 44],
    dry: [46, 60, 68],
    variance: 16,
  },
  /** Late October: everything turns, nothing has fallen yet. */
  autumn: {
    leaf: [30, 72, 45],
    leafDeep: [12, 66, 38],
    moss: [64, 44, 34],
    grass: [40, 62, 48],
    bloom: [350, 74, 72],
    bloomAlt: [38, 92, 56],
    wood: [20, 44, 27],
    dry: [34, 58, 52],
    variance: 18,
  },
  /** After dark: cooled, deepened, with luminous night-blooming flowers. */
  moonlit: {
    leaf: [156, 40, 32],
    leafDeep: [176, 38, 27],
    moss: [150, 38, 28],
    grass: [148, 42, 36],
    bloom: [286, 62, 76],
    bloomAlt: [196, 70, 72],
    wood: [220, 18, 24],
    dry: [206, 16, 46],
    silk: 'hsl(210 44% 88%)',
    ink: 'hsl(214 44% 12%)',
    variance: 9,
  },
} as const satisfies Record<string, FloraPalette>;

export type FloraPaletteName = keyof typeof FLORA_PALETTES;

export const FLORA_PALETTE_NAMES = Object.keys(FLORA_PALETTES) as FloraPaletteName[];

/** Resolve a palette by name (unknown names fall back to the garden). */
export function floraPalette(name: string): FloraPalette {
  return (FLORA_PALETTES as Record<string, FloraPalette>)[name] ?? FLORA_PALETTES.garden;
}

/**
 * Species that *hang*: they drape down off whatever they take hold of. The
 * rest stand up out of the surface they sit on. Facing is therefore a
 * property of the pair (species, anchor kind), not of the anchor alone —
 * getting this wrong is what makes moss grow downward through a shelf.
 */
const TRAILING: ReadonlySet<FloraSpeciesId> = new Set<FloraSpeciesId>([
  'ivy',
  'pothos',
  'hearts',
  'cobweb',
  'herbBundle',
]);

/** Which way a given species grows off a given anchor kind. */
export function speciesFacing(id: FloraSpeciesId, kind: FloraAnchorKind): FloraFacing {
  switch (kind) {
    case 'shelfUnderside':
    case 'caseCorner':
      // Nothing stands upright on the underside of a plank or a top corner.
      return 'down';
    case 'railTop':
    case 'crownTop':
      // A vine spills over the front edge; a tuft stands on the surface.
      return TRAILING.has(id) ? 'down' : 'up';
    default:
      return 'up';
  }
}

function facingAngle(f: FloraFacing): number {
  switch (f) {
    case 'up':
      return -Math.PI / 2;
    case 'left':
      return Math.PI;
    case 'right':
      return 0;
    default:
      return Math.PI / 2;
  }
}

/* ============================== growth core =============================== */

interface Grow {
  rnd: RandomFn;
  noise: NoiseFunction1D;
  scale: number;
  /** Base growth angle in canvas coords (y down). */
  dir: number;
  /** +1 or -1 lateral mirror. */
  flip: number;
  pal: FloraPalette;
  g: FloraGeometry;
  /**
   * Depth tier everything emitted right now belongs to. Species functions set
   * this as they build back→front; the emitters stamp it onto each element.
   */
  tier: FloraTier;
}

/** Run `body` with the grower temporarily on a different depth tier. */
function onTier(gr: Grow, tier: FloraTier, body: () => void): void {
  const prev = gr.tier;
  gr.tier = tier;
  try {
    body();
  } finally {
    gr.tier = prev;
  }
}

function tone(gr: Grow, h: number, s: number, l: number): Tone {
  return {
    h: h + (gr.pal.hueShift ?? 0),
    s: clamp(s + (gr.pal.satShift ?? 0), 0, 100),
    l: clamp(l + (gr.pal.lightShift ?? 0), 0, 100),
  };
}

/**
 * Look a colour role up in the palette (falling back to the garden default)
 * and apply this species' character delta, then the theme's global shifts.
 *
 * This is the one place species colour comes from. Nothing below hardcodes a
 * green: change `pal.leaf` and every vine on the shelf follows.
 */
function roleTone(gr: Grow, role: FloraToneRole, delta: ToneTuple = [0, 0, 0]): Tone {
  const base = gr.pal[role] ?? DEFAULT_FLORA_ROLES[role];
  return tone(gr, base[0] + delta[0], base[1] + delta[1], base[2] + delta[2]);
}

/** Palette string roles (silk, twine) with their defaults. */
function roleColour(gr: Grow, role: FloraStringRole): string {
  return gr.pal[role] ?? DEFAULT_FLORA_STRINGS[role];
}

/** Per-leaf hue spread for this palette. */
function variance(gr: Grow, fallback = 9): number {
  return gr.pal.variance ?? fallback;
}

/**
 * One flower's colour off the branch's petal tone. Most keep the hue and
 * jitter around it; `paleChance` of them open near-white, which is what a
 * real cherry branch does and what stops a mass of blossom reading as one
 * flat pink blob.
 */
function petalTone(gr: Grow, petal: Tone, paleChance: number): Tone {
  if (gr.rnd() < paleChance) {
    return {
      h: petal.h + (gr.rnd() * 2 - 1) * 8,
      s: clamp(petal.s * 0.55 + 8, 0, 100),
      l: clamp(petal.l + rr(gr, 5, 11), 0, 94),
    };
  }
  return {
    h: petal.h + (gr.rnd() * 2 - 1) * variance(gr, 9),
    s: clamp(petal.s + (gr.rnd() * 2 - 1) * 10, 0, 100),
    l: clamp(petal.l + (gr.rnd() * 2 - 1) * 7, 0, 100),
  };
}

/**
 * Everything about a palette that changes pixels, as a short stable string.
 *
 * Both the geometry memo and the on-disk bake cache key off this: without the
 * role colours in here, switching a theme's planting from garden green to
 * reef teal would silently reuse the old baked bitmaps.
 */
export function paletteKey(pal: FloraPalette): string {
  const parts: string[] = [
    `h${pal.hueShift ?? 0}`,
    `s${pal.satShift ?? 0}`,
    `l${pal.lightShift ?? 0}`,
    `v${pal.variance ?? ''}`,
    `i${pal.ink ?? ''}`,
    `k${pal.silk ?? ''}`,
    `t${pal.twine ?? ''}`,
  ];
  for (const role of TONE_ROLES) {
    const v = pal[role];
    if (v) parts.push(`${role}${v[0]},${v[1]},${v[2]}`);
  }
  return parts.join('/');
}

/** Potting soil, derived from the palette's wood so it never clashes. */
function soilTone(gr: Grow): [number, number, number] {
  const t = roleTone(gr, 'wood', [4, -14, -6]);
  return [t.h, t.s, t.l];
}

/** Uniform in [a, b). */
function rr(gr: Grow, a: number, b: number): number {
  return a + gr.rnd() * (b - a);
}

/**
 * Contact shadow where growth meets wood. Every species that touches the case
 * lays one down: it is the single cheapest thing that stops a specimen from
 * looking like a sticker pasted on top of the shelf.
 *
 * `spread` is the half-width of the contact patch in *unscaled* px; the shade
 * is squashed along the growth axis so it hugs the surface, and offset a hair
 * along the facing direction so the plant sits *in front of* its own shadow.
 */
function contactShade(gr: Grow, spread: number, alpha = 0.3, x = 0): void {
  const s = gr.scale;
  const down = Math.sin(gr.dir) >= 0 ? 1 : -1;
  gr.g.shades.push({
    x,
    y: down * 0.8 * s,
    rx: spread * s,
    ry: Math.max(1.6, spread * 0.17) * s,
    alpha,
  });
}

interface StemParams {
  x: number;
  y: number;
  angle: number;
  len: number;
  width: number;
  /** Tip width as a fraction of the base width. */
  taper?: number;
  /** 0 = ignores gravity, 1 = falls straight down within a few steps. */
  gravity?: number;
  /** Per-step angular noise amplitude (radians). */
  wobble?: number;
  woody?: number;
  tone: Tone;
  step?: number;
  /** Draw bark striations. Only worth it above ~3px. */
  bark?: boolean;
  /** Override the current tier. */
  tier?: FloraTier;
}

/**
 * Grow one wobbled, gravity-aware stem. The spine is a random walk in *angle*
 * (simplex, so it curves rather than jitters) with a pull toward straight
 * down — that single term is what makes trails droop and blades arc.
 */
function growStem(gr: Grow, p: StemParams): StemGeom {
  const step = p.step ?? 4;
  const n = Math.max(2, Math.round(p.len / step));
  const taper = p.taper ?? 0.3;
  const gravity = p.gravity ?? 0;
  const wobble = p.wobble ?? 0.05;
  const phase = gr.rnd() * 400;

  let a = p.angle;
  let x = p.x;
  let y = p.y;
  const pts: Pt[] = [{ x, y }];
  const widths: number[] = [p.width];

  for (let i = 1; i <= n; i++) {
    const t = i / n;
    a += gr.noise(phase + i * 0.42) * wobble;
    if (gravity > 0) {
      const raw = Math.PI / 2 - a;
      const d = Math.atan2(Math.sin(raw), Math.cos(raw));
      a += clamp(d, -0.45, 0.45) * gravity;
    }
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    pts.push({ x, y });
    widths.push(Math.max(0.4, p.width * lerp(1, taper, t)));
  }

  const stem: StemGeom = {
    pts,
    widths,
    tone: p.tone,
    woody: p.woody ?? 0,
    tier: p.tier ?? gr.tier,
    bark: p.bark ?? p.width > 3.4,
  };
  gr.g.stems.push(stem);
  return stem;
}

/** Tangent angle of a stem at index i. */
function stemAngle(stem: StemGeom, i: number): number {
  const a = stem.pts[Math.max(0, i - 1)] as Pt;
  const b = stem.pts[Math.min(stem.pts.length - 1, i + 1)] as Pt;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

interface LeafParams {
  shape: LeafShape | readonly LeafShape[];
  /** Arclength between leaves (or leaf pairs), px. */
  every: number;
  len: number;
  width: number;
  /** Splay from the stem tangent, radians. */
  splay: number;
  paired?: boolean;
  from?: number;
  to?: number;
  tone: Tone;
  hueJitter?: number;
  /** Relative leaf size at the stem tip (the taper the doc asks for). */
  sizeTaper?: number;
  /**
   * `taper` (default) shrinks linearly toward the tip. `frond` uses a fern's
   * envelope: short pinnae at the base, longest around a third of the way up,
   * shrinking to nothing at the tip.
   */
  sizeProfile?: 'taper' | 'frond';
  /** Per-leaf random size spread, ± this fraction. Default 0.17. */
  sizeJitter?: number;
  /**
   * Signed bend pushed into every blade, as a fraction of leaf length. Fern
   * pinnae and grass all sweep the same way; random-only bend reads as noise.
   */
  bendBias?: number;
  curlChance?: number;
  paleChance?: number;
  /** Probability a leaf is an older, darker one. */
  darkChance?: number;
  /**
   * How many leaves are emitted at each station. >1 builds a *rosette* at the
   * node instead of a single blade — the difference between a strand of beads
   * and an actual leafy shoot.
   */
  perNode?: number;
  /** Probability a leaf has a bite taken out of it. Default 0.16. */
  damageChance?: number;
  /**
   * Tier assignment. `'spread'` (default) puts roughly a third of the blades
   * behind, a third mid and a third in front, which is what creates depth
   * inside one mass. `'fixed'` keeps whatever tier the grower is on.
   */
  tiers?: 'spread' | 'fixed';
  /** Weight of the back tier when spreading. Default 0.3. */
  backWeight?: number;
  /** Weight of the lit tier when spreading. Default 0.28. */
  litWeight?: number;
}

/**
 * Alternate (or pair) leaves along a stem at jittered angles and sizes,
 * tapering toward the tip, with occasional curled/darker older leaves.
 */
function leafify(gr: Grow, stem: StemGeom, p: LeafParams): void {
  const from = p.from ?? 0.1;
  const to = p.to ?? 0.98;
  const sizeTaper = p.sizeTaper ?? 0.45;
  const hueJitter = p.hueJitter ?? 9;
  const curlChance = p.curlChance ?? 0.16;
  const darkChance = p.darkChance ?? 0.18;
  const paleChance = p.paleChance ?? 0;
  const shapes: readonly LeafShape[] = Array.isArray(p.shape)
    ? (p.shape as readonly LeafShape[])
    : [p.shape as LeafShape];

  let acc = 0;
  let next = p.every * rr(gr, 0.45, 0.9);
  let side = gr.rnd() < 0.5 ? 1 : -1;
  const n = stem.pts.length;

  for (let i = 1; i < n; i++) {
    const a = stem.pts[i - 1] as Pt;
    const b = stem.pts[i] as Pt;
    acc += Math.hypot(b.x - a.x, b.y - a.y);
    const t = i / (n - 1);
    if (t < from || t > to || acc < next) continue;
    acc = 0;
    next = p.every * rr(gr, 0.72, 1.3);

    const tangent = stemAngle(stem, i);
    const jit = p.sizeJitter ?? 0.17;
    const envelope =
      p.sizeProfile === 'frond'
        ? // Peaks around t≈0.3 and closes to `sizeTaper` at the tip.
          lerp(sizeTaper, 1, Math.pow(Math.sin(Math.PI * Math.pow(clamp(t, 0, 1), 0.62)), 0.85))
        : lerp(1, sizeTaper, t);
    const size = envelope * rr(gr, 1 - jit, 1 + jit);
    const sides = p.paired ? [1, -1] : [side];
    const perNode = Math.max(1, Math.round(p.perNode ?? 1));
    const spreadTiers = (p.tiers ?? 'spread') === 'spread';
    const backW = p.backWeight ?? 0.3;
    const litW = p.litWeight ?? 0.28;
    for (const s of sides) {
      for (let k = 0; k < perNode; k++) {
        const dark = gr.rnd() < darkChance;
        const curl = gr.rnd() < curlChance ? rr(gr, 0.28, 0.62) : 0;
        // Tier drives value as well as draw order: a blade in the back tier
        // is *painted* darker and flatter, which is what stops a dense mass
        // from turning into one undifferentiated green slab.
        let tier: FloraTier = gr.tier;
        if (spreadTiers) {
          const u = gr.rnd();
          tier = u < backW ? TIER_BACK : u < 1 - litW ? TIER_MID : TIER_LIT;
        }
        // The reference's darks are genuinely dark. -17 lightness left the
        // back tier still reading as bright foliage; -30 with the saturation
        // pulled out of it is what turns it into shape rather than object.
        const tierL = tier === TIER_BACK ? -30 : tier === TIER_LIT ? 9 : 0;
        const tierS = tier === TIER_BACK ? -22 : tier === TIER_LIT ? 4 : 0;
        // Temperature shift: lit foliage goes warm/yellow, shade goes cool.
        const tierH = tier === TIER_BACK ? 16 : tier === TIER_LIT ? -13 : 0;
        const lt: Tone = {
          h: p.tone.h + (gr.rnd() * 2 - 1) * hueJitter + tierH,
          s: clamp(p.tone.s + (gr.rnd() * 2 - 1) * 11 - (dark ? 6 : 0) + tierS, 0, 100),
          l: clamp(p.tone.l + (gr.rnd() * 2 - 1) * 9 - (dark ? 11 : 0) + tierL, 0, 100),
        };
        // Extra blades at a node fan around the primary one and shrink a
        // little, so the node reads as a shoot rather than a starburst.
        const fan = perNode > 1 ? ((k + 0.5) / perNode - 0.5) * 1.45 : 0;
        const shrink = perNode > 1 ? 1 - Math.abs(fan) * 0.3 : 1;
        // Back-tier blades sit slightly deeper into the stem so the mass has
        // a real interior instead of a fringe.
        const inset = tier === TIER_BACK ? -2.2 : tier === TIER_LIT ? 1.4 : 0;
        gr.g.leaves.push({
          x: b.x + Math.cos(tangent) * inset,
          y: b.y + Math.sin(tangent) * inset,
          angle: tangent + s * gr.flip * (p.splay + fan + (gr.rnd() * 2 - 1) * 0.3),
          len: p.len * size * shrink,
          width: p.width * size * shrink,
          shape: shapes[Math.floor(gr.rnd() * shapes.length) as number] ?? 'oval',
          bend:
            ((gr.rnd() * 2 - 1) * 0.16 + s * gr.flip * (p.bendBias ?? 0)) * p.len * size,
          curl,
          tone: lt,
          pale: gr.rnd() < paleChance,
          seed: (gr.rnd() * 0xffffffff) >>> 0,
          tier,
          damage: gr.rnd() < (p.damageChance ?? 0.16) ? rr(gr, 0.25, 0.8) : 0,
        });
      }
    }
    if (!p.paired) side = -side;
  }
}

/* ---------------------------- mass primitives ---------------------------- */

/**
 * A **flower cluster**: 5–15 blooms packed into a soft blob with real
 * variation in size, openness, tone and kind (§4 — "flower clusters of 5–15
 * blooms with visible centres and layered petals").
 *
 * The old code scattered one 5px blossom per twig, which is why the user saw
 * "flowers barely on shelf". A cluster instead owns a patch of the canvas:
 * buds and back-tier blooms first, the big open lit ones last and on top.
 */
interface ClusterParams {
  x: number;
  y: number;
  /** Radius of the patch the blooms are packed into, px. */
  spread: number;
  /** Bloom radius range, px. 20–40px flowers ⇒ r 10–20. */
  r: [number, number];
  count: [number, number];
  tone: Tone;
  /** Fraction that open near-white. */
  paleChance?: number;
  /** Fraction that stay closed buds. */
  budChance?: number;
  /** Kinds allowed in this cluster. */
  kinds?: readonly BloomKind[];
  /** Squash the patch along y (a raceme is tall, an umbel is flat). */
  squash?: number;
  /** Rotation of the whole patch. */
  angle?: number;
  petals?: number;
}

function growCluster(gr: Grow, p: ClusterParams): void {
  const n = Math.round(rr(gr, p.count[0], p.count[1]));
  const kinds = p.kinds ?? ['blossom'];
  const squash = p.squash ?? 1;
  const rot = p.angle ?? 0;
  const paleChance = p.paleChance ?? 0.24;
  const budChance = p.budChance ?? 0.22;

  interface Placed {
    x: number;
    y: number;
    r: number;
    tier: FloraTier;
    open: number;
    kind: BloomKind;
    tone: Tone;
    seed: number;
    angle: number;
  }
  const placed: Placed[] = [];
  for (let i = 0; i < n; i++) {
    // Dart-throwing: a few tries to find a spot not sitting on top of an
    // existing bloom. Slight overlap is fine and desirable; concentric is not.
    let bx = 0;
    let by = 0;
    let br = rr(gr, p.r[0], p.r[1]);
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = gr.rnd() * Math.PI * 2;
      const rad = p.spread * Math.sqrt(gr.rnd());
      const cx = Math.cos(a) * rad;
      const cy = Math.sin(a) * rad * squash;
      bx = p.x + cx * Math.cos(rot) - cy * Math.sin(rot);
      by = p.y + cx * Math.sin(rot) + cy * Math.cos(rot);
      let clear = true;
      for (const q of placed) {
        if (Math.hypot(q.x - bx, q.y - by) < (q.r + br) * 0.52) {
          clear = false;
          break;
        }
      }
      if (clear) break;
      br *= 0.94;
    }
    // Depth inside the cluster: the small tight ones sit behind.
    const u = gr.rnd();
    const tier: FloraTier = u < 0.3 ? TIER_BACK : u < 0.72 ? TIER_MID : TIER_LIT;
    const bud = gr.rnd() < budChance;
    if (bud) br *= 0.62;
    const tierL = tier === TIER_BACK ? -14 : tier === TIER_LIT ? 6 : 0;
    const base = petalTone(gr, p.tone, paleChance);
    placed.push({
      x: bx,
      y: by,
      r: tier === TIER_BACK ? br * 0.82 : tier === TIER_LIT ? br * 1.12 : br,
      tier,
      open: bud ? rr(gr, 0.08, 0.3) : rr(gr, 0.62, 1),
      kind: bud ? 'bud' : (kinds[Math.floor(gr.rnd() * kinds.length)] as BloomKind),
      tone: { h: base.h, s: base.s, l: clamp(base.l + tierL, 0, 100) },
      seed: (gr.rnd() * 0xffffffff) >>> 0,
      angle: gr.dir + (gr.rnd() * 2 - 1) * 0.9,
    });
  }
  // Back to front, so the renderer's stable sort keeps cluster depth intact.
  placed.sort((a, b) => a.tier - b.tier);
  for (const q of placed) {
    gr.g.blooms.push({
      x: q.x,
      y: q.y,
      r: q.r,
      kind: q.kind,
      open: q.open,
      tone: q.tone,
      seed: q.seed,
      tier: q.tier,
      angle: q.angle,
      petals: p.petals,
    });
  }
}

/**
 * A **foliage mass**: several strands radiating from one origin, whose leaves
 * are spaced *closer together than they are long* so the blades overlap into
 * a continuous canopy. This one function is the difference between the old
 * "sprinkled leaves" and the reference's solid drifts of foliage.
 */
interface MassParams {
  /** Number of strands. */
  strands: [number, number];
  /** Strand length range, unscaled px. */
  len: [number, number];
  /** Base stem width, unscaled px — the spec asks for 3–6. */
  width: number;
  /** Angular half-spread of the fan off `gr.dir`, radians. */
  fan: number;
  /** Lateral spread of the strand origins, unscaled px. */
  originSpread: number;
  gravity: number;
  wobble: number;
  shape: LeafShape | readonly LeafShape[];
  /** Leaf length range, unscaled px — the spec asks for 25–60. */
  leafLen: [number, number];
  /** Leaf width as a fraction of its length. */
  leafAspect: number;
  /**
   * Node spacing as a fraction of leaf length. **Below 1 the leaves overlap**,
   * which is the entire point; 0.5–0.7 gives a proper canopy.
   */
  overlap: number;
  splay: number;
  tone: Tone;
  stemTone: Tone;
  perNode?: number;
  paleChance?: number;
  curlChance?: number;
  sizeTaper?: number;
  sizeJitter?: number;
  bendBias?: number;
  /** Sub-branches per strand. */
  branches?: number;
  woody?: number;
  bark?: boolean;
}

function growMass(gr: Grow, m: MassParams): StemGeom[] {
  const s = gr.scale;
  const count = Math.round(rr(gr, m.strands[0], m.strands[1]));
  const out: StemGeom[] = [];
  for (let i = 0; i < count; i++) {
    // Fan the strands, but jitter so they are not a neat protractor.
    const u = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
    const lean = u * m.fan * rr(gr, 0.7, 1.2) + (gr.rnd() * 2 - 1) * 0.12;
    // Longest strand in the middle, shorter at the edges — the silhouette of
    // a real cascade rather than a comb.
    const lenScale = lerp(0.62, 1, 1 - Math.abs(u) * 0.75) * rr(gr, 0.85, 1.15);
    const strandLen = rr(gr, m.len[0], m.len[1]) * s * lenScale;
    const w = m.width * s * rr(gr, 0.82, 1.2) * lerp(0.7, 1, 1 - Math.abs(u) * 0.5);
    const stem = growStem(gr, {
      x: u * m.originSpread * s * rr(gr, 0.6, 1.15),
      y: (gr.rnd() * 2 - 1) * 2 * s,
      angle: gr.dir + gr.flip * lean,
      len: strandLen,
      width: w,
      taper: 0.3,
      gravity: m.gravity,
      wobble: m.wobble,
      woody: m.woody ?? 0,
      bark: m.bark ?? w > 3.4,
      tone: m.stemTone,
      step: 5,
    });
    out.push(stem);

    const leafLen = rr(gr, m.leafLen[0], m.leafLen[1]) * s;
    const params: LeafParams = {
      shape: m.shape,
      // THE line that makes a mass: spacing derived from leaf size, < 1.
      every: leafLen * m.overlap,
      len: leafLen,
      width: leafLen * m.leafAspect,
      splay: m.splay,
      tone: m.tone,
      hueJitter: variance(gr, 11),
      perNode: m.perNode ?? 1,
      paleChance: m.paleChance ?? 0,
      curlChance: m.curlChance ?? 0.14,
      sizeTaper: m.sizeTaper ?? 0.5,
      sizeJitter: m.sizeJitter ?? 0.3,
      bendBias: m.bendBias ?? 0,
      from: 0.05,
    };
    leafify(gr, stem, params);

    // Sub-branches keep the mass from reading as a comb of parallel strands.
    const nb = m.branches ?? 1;
    for (let b = 0; b < nb; b++) {
      if (gr.rnd() < 0.3) continue;
      const at = Math.floor(stem.pts.length * rr(gr, 0.2, 0.68));
      const q = stem.pts[at] as Pt;
      const br = growStem(gr, {
        x: q.x,
        y: q.y,
        angle: stemAngle(stem, at) + (gr.rnd() < 0.5 ? -1 : 1) * rr(gr, 0.42, 1),
        len: strandLen * rr(gr, 0.35, 0.62),
        width: w * 0.6,
        taper: 0.3,
        gravity: m.gravity * 1.2,
        wobble: m.wobble * 1.25,
        woody: m.woody ?? 0,
        tone: m.stemTone,
        step: 5,
      });
      leafify(gr, br, {
        ...params,
        len: params.len * 0.82,
        width: params.width * 0.82,
        every: params.every * 0.86,
      });
      out.push(br);
    }
  }
  return out;
}

/**
 * A dark under-mass: a few big flat silhouette blades sitting behind
 * everything else, giving the canopy something to be *in front of*. Cheap —
 * a dozen flat fills — and it is what reads as depth from three feet away.
 */
function growUnderMass(
  gr: Grow,
  count: number,
  radius: number,
  leafLen: number,
  tone: Tone,
  shape: LeafShape | readonly LeafShape[],
): void {
  const s = gr.scale;
  const shapes: readonly LeafShape[] = Array.isArray(shape)
    ? (shape as readonly LeafShape[])
    : [shape as LeafShape];
  for (let i = 0; i < count; i++) {
    const a = gr.dir + (gr.rnd() * 2 - 1) * 1.5;
    const rad = radius * s * Math.sqrt(gr.rnd());
    const len = leafLen * s * rr(gr, 0.85, 1.35);
    gr.g.leaves.push({
      x: Math.cos(a) * rad,
      y: Math.sin(a) * rad,
      angle: a + (gr.rnd() * 2 - 1) * 0.8,
      len,
      width: len * rr(gr, 0.62, 0.95),
      shape: shapes[Math.floor(gr.rnd() * shapes.length) as number] ?? 'oval',
      bend: (gr.rnd() * 2 - 1) * len * 0.14,
      curl: 0,
      tone: {
        h: tone.h + (gr.rnd() * 2 - 1) * 8,
        s: clamp(tone.s - 12, 0, 100),
        l: clamp(tone.l - rr(gr, 18, 26), 0, 100),
      },
      pale: false,
      seed: (gr.rnd() * 0xffffffff) >>> 0,
      tier: TIER_BACK,
      damage: 0,
    });
  }
}

/* --------------------------- trailing species ---------------------------- */

/**
 * The three trailing vines, rebuilt to the reference standard.
 *
 * Every number here moved in the same direction: **stems 3–6px** instead of
 * 1–3, **leaves 28–58px** instead of 10–26, node spacing derived from leaf
 * length at `overlap < 1` so blades cover each other, and 3–6 strands per
 * specimen instead of one. A single ivy specimen now paints roughly eight
 * times the area it used to, which is what "foliage occupies ~30% of the
 * frame" actually requires.
 */
const TRAILS: Record<'ivy' | 'pothos' | 'hearts', MassParams & { role: FloraToneRole; tint: ToneTuple; underMass?: number; berries?: boolean }> = {
  ivy: {
    // English ivy: the darkest, bluest-green of the three, big palmate hands.
    role: 'leaf',
    tint: [-4, -2, -2],
    strands: [4, 7],
    len: [150, 235],
    width: 4.2,
    fan: 0.95,
    originSpread: 13,
    gravity: 0.2,
    wobble: 0.06,
    shape: ['palmate', 'lobed', 'lobed'],
    leafLen: [30, 52],
    leafAspect: 1.06,
    overlap: 0.6,
    splay: 0.95,
    perNode: 1,
    curlChance: 0.16,
    sizeTaper: 0.45,
    sizeJitter: 0.32,
    branches: 2,
    woody: 0.55,
    bark: true,
    underMass: 14,
    tone: { h: 0, s: 0, l: 0 },
    stemTone: { h: 0, s: 0, l: 0 },
    berries: true,
  },
  pothos: {
    // Pothos: warmer, yellower, enormous variegated hearts.
    role: 'leaf',
    tint: [-11, -2, 2],
    strands: [3, 6],
    len: [140, 215],
    width: 4.8,
    fan: 1.05,
    originSpread: 15,
    gravity: 0.24,
    wobble: 0.05,
    shape: ['heart', 'heart', 'oval'],
    leafLen: [34, 58],
    leafAspect: 0.94,
    overlap: 0.62,
    splay: 0.9,
    perNode: 1,
    paleChance: 0.44,
    curlChance: 0.12,
    sizeTaper: 0.48,
    sizeJitter: 0.28,
    branches: 1,
    woody: 0.2,
    underMass: 12,
    tone: { h: 0, s: 0, l: 0 },
    stemTone: { h: 0, s: 0, l: 0 },
  },
  hearts: {
    // String-of-hearts: silvered, fine, but now a *curtain* of many strands
    // rather than one lonely bead chain.
    role: 'leaf',
    tint: [12, -32, 10],
    strands: [7, 12],
    len: [180, 280],
    width: 1.9,
    fan: 0.42,
    originSpread: 20,
    gravity: 0.46,
    wobble: 0.028,
    shape: 'heart',
    leafLen: [13, 22],
    leafAspect: 1.08,
    overlap: 0.95,
    splay: 1.4,
    perNode: 1,
    curlChance: 0.1,
    sizeTaper: 0.7,
    sizeJitter: 0.36,
    branches: 0,
    underMass: 0,
    tone: { h: 0, s: 0, l: 0 },
    stemTone: { h: 0, s: 0, l: 0 },
  },
};

function growTrail(gr: Grow, def: (typeof TRAILS)[keyof typeof TRAILS]): void {
  const s = gr.scale;
  const t = roleTone(gr, def.role, def.tint);
  const stemTone: Tone = {
    h: t.h - 6,
    s: clamp(t.s - 6, 0, 100),
    l: clamp(t.l - 4, 0, 100),
  };
  // Where the vine grips the wood — a wide, soft patch, not a dot.
  contactShade(gr, 16, 0.4);
  contactShade(gr, 7, 0.34, rr(gr, -10, 10) * s);

  // 1. The dark under-mass first: blades that will never be seen whole, only
  //    as shadow shapes between the lit ones.
  if (def.underMass) {
    onTier(gr, TIER_BACK, () => {
      growUnderMass(gr, def.underMass as number, 26, 30, t, def.shape);
    });
  }

  // 2. The cascade proper.
  const stems = growMass(gr, { ...def, tone: t, stemTone });

  // 3. Ivy fruits in autumn: little dark umbels on a few tips. One more
  //    reason for the eye to stop somewhere inside the mass.
  if (def.berries && gr.rnd() < 0.55) {
    const stem = stems[Math.floor(gr.rnd() * stems.length)];
    if (stem) {
      const tip = stem.pts[stem.pts.length - 1] as Pt;
      onTier(gr, TIER_LIT, () => {
        growCluster(gr, {
          x: tip.x,
          y: tip.y,
          spread: 7 * s,
          r: [2.2 * s, 3.6 * s],
          count: [7, 13],
          tone: roleTone(gr, 'wood', [200, -6, -14]),
          kinds: ['berry'],
          budChance: 0,
          paleChance: 0,
        });
      });
    }
  }

  // 4. A couple of big lit blades hanging proud of everything else. Painters
  //    call these "read leaves": they establish the scale of the whole mass.
  onTier(gr, TIER_LIT, () => {
    const n = 2 + Math.floor(gr.rnd() * 3);
    for (let i = 0; i < n; i++) {
      const stem = stems[Math.floor(gr.rnd() * stems.length)];
      if (!stem) continue;
      const at = Math.floor(stem.pts.length * rr(gr, 0.25, 0.9));
      const q = stem.pts[at] as Pt;
      const len = rr(gr, def.leafLen[1] * 0.95, def.leafLen[1] * 1.3) * s;
      gr.g.leaves.push({
        x: q.x,
        y: q.y,
        angle: stemAngle(stem, at) + gr.flip * rr(gr, 0.6, 1.3) * (gr.rnd() < 0.5 ? 1 : -1),
        len,
        width: len * def.leafAspect * rr(gr, 0.9, 1.1),
        shape: Array.isArray(def.shape)
          ? ((def.shape as readonly LeafShape[])[0] as LeafShape)
          : (def.shape as LeafShape),
        bend: (gr.rnd() * 2 - 1) * len * 0.18,
        curl: gr.rnd() < 0.2 ? rr(gr, 0.25, 0.5) : 0,
        tone: { h: t.h + rr(gr, -6, 6), s: clamp(t.s + 4, 0, 100), l: clamp(t.l + 9, 0, 100) },
        pale: gr.rnd() < (def.paleChance ?? 0),
        seed: (gr.rnd() * 0xffffffff) >>> 0,
        tier: TIER_LIT,
        damage: gr.rnd() < 0.22 ? rr(gr, 0.2, 0.6) : 0,
      });
    }
  });
}

/* --------------------------- the ten species ----------------------------- */

/**
 * One arching frond: a thick rachis with two ranks of pinnae under a proper
 * frond envelope. Rebuilt at roughly double the old scale — a fern at 100px
 * tall with 21px pinnae is a herb; the reference's ferns are shrubs.
 */
function growFrond(
  gr: Grow,
  s: number,
  t: Tone,
  lean: number,
  size: number,
  tier: FloraTier,
): StemGeom {
  const rachis = growStem(gr, {
    x: (gr.rnd() * 2 - 1) * 5 * s,
    y: 0,
    angle: gr.dir + gr.flip * lean,
    len: 168 * s * size * rr(gr, 0.88, 1.12),
    width: 4.6 * s * size,
    taper: 0.12,
    // Gravity is integrated per step, so over a 30-step rachis even 0.14
    // accumulates a full 90° turn and the frond flops onto its side. 0.045
    // buys the ~30° nod a fern actually has.
    gravity: 0.045,
    wobble: 0.035,
    bark: false,
    tier,
    tone: { h: t.h - 6, s: t.s + 6, l: clamp(t.l + 8 - (tier === TIER_BACK ? 18 : 0), 0, 100) },
  });
  leafify(gr, rachis, {
    // Real pinnae are themselves lobed; 'pinnate' cuts them, which reads far
    // better at 34px than a plain needle did at 21px.
    shape: ['pinnate', 'needle'],
    // Overlapping ranks: spacing well under the pinna length.
    every: 12 * s * size,
    len: 38 * s * size,
    width: 11 * s * size,
    splay: 1.06,
    paired: true,
    perNode: 2,
    from: 0.08,
    tone: t,
    // Short at the base, longest a third of the way up, closing at the tip —
    // the silhouette that separates a frond from a fish skeleton.
    sizeProfile: 'frond',
    sizeTaper: 0.28,
    sizeJitter: 0.16,
    // Every pinna sweeps toward the tip of the frond.
    bendBias: -0.3,
    curlChance: 0.07,
    darkChance: 0.15,
    damageChance: 0.1,
    hueJitter: variance(gr),
    tiers: tier === TIER_BACK ? 'fixed' : 'spread',
    backWeight: 0.34,
    litWeight: 0.24,
  });
  return rachis;
}

function growFern(gr: Grow): void {
  const s = gr.scale;
  const t = roleTone(gr, 'leafDeep');
  contactShade(gr, 26, 0.42);
  contactShade(gr, 11, 0.3, rr(gr, -16, 16) * s);

  // A shuttlecock of fronds fanning from one crown. Three ranks of depth: a
  // dark back row, the body, and two lit fronds thrown forward.
  const base = rr(gr, 0.05, 0.3);
  onTier(gr, TIER_BACK, () => {
    for (let i = 0; i < 3; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      growFrond(gr, s, t, base + side * rr(gr, 0.35, 1.0), rr(gr, 0.6, 0.92), TIER_BACK);
    }
  });

  const fronds = 5 + Math.floor(gr.rnd() * 3);
  const main = growFrond(gr, s, t, base, 1, TIER_MID);
  for (let i = 1; i < fronds; i++) {
    // Alternate sides, widening as we go, each frond shorter than the last.
    const side = i % 2 === 0 ? 1 : -1;
    const lean = base + side * (0.26 + Math.floor(i / 2) * 0.3) * rr(gr, 0.85, 1.15);
    growFrond(gr, s, t, lean, rr(gr, 0.58, 0.86) - i * 0.03, TIER_MID);
  }
  onTier(gr, TIER_LIT, () => {
    for (let i = 0; i < 2; i++) {
      growFrond(
        gr,
        s,
        { h: t.h + 4, s: clamp(t.s + 6, 0, 100), l: clamp(t.l + 10, 0, 100) },
        base + (i === 0 ? -1 : 1) * rr(gr, 0.18, 0.5),
        rr(gr, 0.7, 0.95),
        TIER_LIT,
      );
    }
  });

  // Fiddleheads: unfurling spirals, now on thick croziers with a furry scale
  // texture rather than a hairline spiral.
  const heads = 1 + Math.floor(gr.rnd() * 3);
  for (let k = 0; k < heads; k++) {
    const src = k === 0 ? main : main;
    const tip = src.pts[src.pts.length - 1] as Pt;
    const a0 = stemAngle(src, src.pts.length - 1);
    const off = k === 0 ? 0 : rr(gr, -30, 30) * s;
    const pts: Pt[] = [];
    const turn = gr.flip * (gr.rnd() < 0.5 ? 1 : -1);
    const R = rr(gr, 12, 19) * s;
    for (let i = 0; i <= 30; i++) {
      const u = i / 30;
      const r = R * (1 - u * 0.93);
      const a = a0 + turn * u * Math.PI * 2.2;
      pts.push({
        x: tip.x + off + Math.cos(a) * r - Math.cos(a0) * R,
        y: tip.y + Math.sin(a) * r - Math.sin(a0) * R,
      });
    }
    gr.g.threads.push({
      pts,
      width: 3.4 * s,
      alpha: 0.95,
      colour: hsl(t.h - 4, t.s + 10, t.l + 12),
      halo: hsl(t.h - 8, t.s + 4, t.l - 16, 0.7),
      tier: TIER_LIT,
    });
  }
}

function growMoss(gr: Grow): void {
  const s = gr.scale;
  const t = roleTone(gr, 'moss');
  const up = gr.dir;
  const flipY = up < 0 ? 1 : -1;
  // Cushions are lumpy and wide, not neat and low. Doubled from the old
  // 20–30 × 15–23: a 50px-wide moss bank is a feature, a 25px one is lint.
  const halfW = rr(gr, 42, 68) * s;
  const height = rr(gr, 26, 42) * s;
  contactShade(gr, halfW / s + 8, 0.44);

  // 1. The body. FOUR overlapping domes at three tiers give the bank an
  //    uneven crest with real internal depth — the silhouette stops reading
  //    as a drawn semicircle and starts reading as a landscape.
  const domes: Array<{ x: number; rx: number; ry: number; dl: number; tier: FloraTier }> = [
    { x: rr(gr, -0.5, -0.15) * halfW, rx: halfW * rr(gr, 0.5, 0.7), ry: height * rr(gr, 0.85, 1.2), dl: -14, tier: TIER_BACK },
    { x: rr(gr, 0.1, 0.5) * halfW, rx: halfW * rr(gr, 0.45, 0.66), ry: height * rr(gr, 0.75, 1.1), dl: -10, tier: TIER_BACK },
    { x: 0, rx: halfW, ry: height * 0.94, dl: -4, tier: TIER_MID },
    { x: rr(gr, -0.42, 0.42) * halfW, rx: halfW * rr(gr, 0.5, 0.76), ry: height * rr(gr, 0.6, 0.9), dl: 4, tier: TIER_LIT },
  ];
  for (const d of domes) {
    gr.g.mounds.push({
      x: d.x,
      y: 0,
      rx: d.rx,
      ry: d.ry,
      up: flipY,
      tone: {
        h: t.h + rr(gr, -7, 9),
        s: clamp(t.s + rr(gr, -4, 6), 0, 100),
        l: clamp(t.l + d.dl, 0, 100),
      },
      seed: (gr.rnd() * 0xffffffff) >>> 0,
      tier: d.tier,
    });
  }

  // 2. Five fringes of blades, back to front. Moss is legible only as
  //    *texture*, so the count went up as hard as the size did.
  const LAYERS: Array<{ count: number; spread: number; rise: number; size: number; dl: number; front: number; tier: FloraTier }> = [
    { count: 46, spread: 0.72, rise: 1.14, size: 1.05, dl: -20, front: -0.1, tier: TIER_BACK },
    { count: 44, spread: 0.86, rise: 1.02, size: 1, dl: -11, front: 0, tier: TIER_BACK },
    { count: 52, spread: 0.98, rise: 0.86, size: 0.96, dl: 0, front: 0.2, tier: TIER_MID },
    { count: 46, spread: 1.06, rise: 0.6, size: 0.88, dl: 8, front: 0.44, tier: TIER_MID },
    { count: 34, spread: 1.1, rise: 0.4, size: 0.8, dl: 16, front: 0.66, tier: TIER_LIT },
  ];
  for (const layer of LAYERS) {
    const count = layer.count + Math.floor(gr.rnd() * 12);
    for (let i = 0; i < count; i++) {
      const u = ((i + gr.rnd()) / count) * 2 - 1;
      // A cushion: tallest in the middle, thinning at the edges.
      const mound = Math.pow(Math.max(0, 1 - u * u), 0.5);
      const x = u * halfW * layer.spread;
      // The front fringe is pushed down the face of the cushion, but never
      // *through* the surface — at the edges the mound falls to zero and an
      // unclamped offset buried the outermost blades inside the shelf.
      const y = Math.min(
        0.5 * s,
        -mound * rr(gr, 0.5, 1.05) * height * layer.rise + layer.front * height * 0.42,
      );
      gr.g.leaves.push({
        x,
        y: y * flipY,
        angle: up + (gr.rnd() * 2 - 1) * 0.7 + u * 0.85,
        len: rr(gr, 9, 19) * s * layer.size,
        width: rr(gr, 5, 10) * s * layer.size,
        shape: gr.rnd() < 0.4 ? 'round' : gr.rnd() < 0.7 ? 'needle' : 'oval',
        bend: (gr.rnd() * 2 - 1) * 3.5 * s,
        curl: 0,
        tone: {
          h: t.h + (gr.rnd() * 2 - 1) * variance(gr, 15) * 1.6,
          s: clamp(t.s + (gr.rnd() * 2 - 1) * 12, 0, 100),
          l: clamp(t.l + (gr.rnd() * 2 - 1) * 8 + layer.dl - (gr.rnd() < 0.14 ? 8 : 0), 0, 100),
        },
        pale: false,
        seed: (gr.rnd() * 0xffffffff) >>> 0,
        tier: layer.tier,
      });
    }
  }
  // 3. Sporophytes: a proper forest of them, bare hairs each with a capsule.
  //    They are what identify the shape as moss rather than lawn.
  const hairs = 12 + Math.floor(gr.rnd() * 10);
  for (let i = 0; i < hairs; i++) {
    const x = (gr.rnd() * 2 - 1) * halfW * 0.78;
    const len = rr(gr, 24, 48) * s;
    const lit = gr.rnd() < 0.4;
    const stem = growStem(gr, {
      x,
      y: -height * rr(gr, 0.2, 0.5) * flipY,
      angle: up + (gr.rnd() * 2 - 1) * 0.4,
      len,
      width: 1.5 * s,
      taper: 0.65,
      gravity: up < 0 ? 0.06 : 0,
      wobble: 0.05,
      step: 3.5,
      tier: lit ? TIER_LIT : TIER_MID,
      tone: { h: t.h + 10, s: clamp(t.s - 14, 0, 100), l: clamp(t.l + (lit ? 28 : 18), 0, 100) },
    });
    const tip = stem.pts[stem.pts.length - 1] as Pt;
    gr.g.blooms.push({
      x: tip.x,
      y: tip.y,
      r: rr(gr, 2.4, 4) * s,
      kind: 'capsule',
      open: 1,
      tone: roleTone(gr, 'wood', [14, 8, 14]),
      seed: (gr.rnd() * 0xffffffff) >>> 0,
      tier: lit ? TIER_LIT : TIER_MID,
    });
  }
  // 4. A few tiny flowers scattered through the bank — the reference's moss
  //    is never pure green.
  if (gr.rnd() < 0.6) {
    onTier(gr, TIER_LIT, () => {
      growCluster(gr, {
        x: rr(gr, -0.5, 0.5) * halfW,
        y: -height * 0.5 * flipY,
        spread: halfW * 0.5,
        r: [3 * s, 5.5 * s],
        count: [5, 9],
        tone: roleTone(gr, 'bloomAlt'),
        squash: 0.55,
        budChance: 0.3,
      });
    });
  }
}

function growHerbBundle(gr: Grow): void {
  const s = gr.scale;
  // A drying bundle is dustier than living growth — but "dusty" is a
  // lightness/saturation move off the palette's `dry` role, not a hardcoded
  // sage-grey: a reef or a candy shelf hangs quite different bundles.
  const t = roleTone(gr, 'dry', [38, -30, -6]);
  const twine = roleColour(gr, 'twine');
  const knotY = 15 * s;
  contactShade(gr, 5, 0.24);

  // 1. Twine: a hanging loop from the shelf edge down to the knot.
  for (const side of [-1, 1]) {
    gr.g.threads.push({
      pts: [
        { x: side * 5.2 * s, y: -9 * s },
        { x: side * 4.4 * s, y: 0 },
        { x: side * 2.2 * s, y: knotY - 3 * s },
      ],
      width: 1.35 * s,
      alpha: 0.92,
      colour: twine,
    });
  }

  // 2. Three ranks of sprigs. A hanging bundle is a solid body of dried
  //    material — the old 4–6 wands read as a whisk.
  const RANKS: Array<{ n: [number, number]; tier: FloraTier; dl: number; len: [number, number] }> = [
    { n: [5, 8], tier: TIER_BACK, dl: -20, len: [62, 108] },
    { n: [6, 9], tier: TIER_MID, dl: 0, len: [70, 122] },
    { n: [4, 6], tier: TIER_LIT, dl: 10, len: [54, 96] },
  ];
  const tips: Pt[] = [];
  for (const rank of RANKS) {
    const stems = Math.round(rr(gr, rank.n[0], rank.n[1]));
    for (let i = 0; i < stems; i++) {
      const spread = ((i + gr.rnd()) / stems - 0.5) * 1.3;
      const stem = growStem(gr, {
        x: (gr.rnd() * 2 - 1) * 3 * s,
        y: knotY + 2 * s,
        angle: Math.PI / 2 + spread,
        len: rr(gr, rank.len[0], rank.len[1]) * s,
        width: rr(gr, 2.2, 3.4) * s,
        taper: 0.45,
        gravity: 0.16,
        wobble: 0.04,
        step: 4,
        tier: rank.tier,
        tone: {
          h: t.h - 8,
          s: clamp(t.s + 4, 0, 100),
          l: clamp(t.l - 12 + rank.dl * 0.6, 0, 100),
        },
      });
      tips.push(stem.pts[stem.pts.length - 1] as Pt);
      leafify(gr, stem, {
        shape: ['needle', 'pinnate', 'oval'],
        every: 12 * s,
        len: 24 * s,
        width: 9 * s,
        splay: 1.2,
        paired: true,
        perNode: 2,
        from: 0.1,
        tone: { h: t.h, s: t.s, l: clamp(t.l + rank.dl, 0, 100) },
        // Dried herbs are a scrapyard of tones: that variety is the legibility.
        hueJitter: variance(gr, 20) + 11,
        sizeTaper: 0.55,
        sizeJitter: 0.3,
        bendBias: -0.16,
        curlChance: 0.34,
        darkChance: 0.22,
        damageChance: 0.3,
        tiers: 'fixed',
      });
      // Lavender spikes: proper racemes of little bells, not five dots.
      if (gr.rnd() < 0.5) {
        const tip = stem.pts[stem.pts.length - 1] as Pt;
        onTier(gr, rank.tier, () => {
          growCluster(gr, {
            x: tip.x,
            y: tip.y - 12 * s,
            spread: 8 * s,
            r: [2.6 * s, 5 * s],
            count: [8, 15],
            tone: roleTone(gr, 'bloomCool'),
            squash: 2.6,
            budChance: 0.55,
            kinds: ['blossom', 'bell'],
          });
        });
      }
    }
  }

  // 3. The knot: three wraps round the neck plus a loose tail, so it reads as
  //    *tied* rather than as a stripe painted across the stems.
  for (let k = 0; k < 3; k++) {
    const y = knotY + k * 2.6 * s;
    gr.g.threads.push({
      pts: [
        { x: -5 * s, y: y + 0.4 * s },
        { x: 0, y: y - 0.5 * s },
        { x: 5 * s, y: y + 0.5 * s },
      ],
      width: 1.7 * s,
      alpha: 0.96,
      colour: twine,
    });
  }
  gr.g.threads.push({
    pts: [
      { x: 3 * s, y: knotY + 5 * s },
      { x: 7 * s, y: knotY + 8 * s },
      { x: 6 * s, y: knotY + 13 * s },
    ],
    width: 1.1 * s,
    alpha: 0.8,
    colour: twine,
  });
  if (gr.rnd() < 0.55) {
    gr.g.tags.push({
      x: 6.5 * s,
      y: knotY + 5 * s,
      w: 12 * s,
      h: 8 * s,
      angle: rr(gr, -0.4, 0.12),
    });
  }
}

/**
 * A flowering branch — rebuilt from "a stick with sprinkles" into the thing
 * the art direction actually asks for: a **woody armature** 5–7px at the butt
 * carrying 6–10 twigs, each ending in a **cluster of 5–15 blooms at 20–40px**,
 * over a dark under-canopy of foliage, with a scatter of fallen petals.
 */
function growBlossom(gr: Grow): void {
  const s = gr.scale;
  const wood: Tone = roleTone(gr, 'wood', [4, -12, -6]);
  const petal: Tone = roleTone(gr, 'bloom');
  const leafT = roleTone(gr, 'leaf', [6, -8, 1]);
  // Roughly a quarter of a branch's flowers open near-white, the way a real
  // cherry does — the pale ones are what make the pink ones read as pink.
  const paleChance = 0.15;
  contactShade(gr, 20, 0.42);
  contactShade(gr, 9, 0.32, rr(gr, -14, 14) * s);

  // 0. Dark leaf mass behind, so the blossom has something to sit against.
  onTier(gr, TIER_BACK, () => {
    growUnderMass(gr, 16, 40, 30, leafT, ['serrate', 'oval']);
  });

  // 1. The armature: a proper limb, 6px at the butt, tapering hard.
  const branch = growStem(gr, {
    x: 0,
    y: 0,
    angle: gr.dir + gr.flip * rr(gr, 0.8, 1.2),
    len: 190 * s * rr(gr, 0.86, 1.16),
    width: 6.2 * s,
    taper: 0.2,
    gravity: 0.07,
    wobble: 0.05,
    woody: 1,
    bark: true,
    step: 5,
    tone: wood,
  });
  // A second limb off the butt: one stick is a diagram, two is a tree.
  const limb = growStem(gr, {
    x: (branch.pts[2] as Pt).x,
    y: (branch.pts[2] as Pt).y,
    angle: stemAngle(branch, 2) + gr.flip * rr(gr, 0.55, 1.05) * (gr.rnd() < 0.5 ? 1 : -1),
    len: 128 * s * rr(gr, 0.8, 1.2),
    width: 4.4 * s,
    taper: 0.22,
    gravity: 0.09,
    wobble: 0.055,
    woody: 1,
    bark: true,
    step: 5,
    tone: { h: wood.h, s: wood.s, l: clamp(wood.l - 5, 0, 100) },
  });

  const clusterSpots: Array<{ p: Pt; a: number; big: boolean }> = [];
  for (const [host, count] of [
    [branch, 5 + Math.floor(gr.rnd() * 3)],
    [limb, 3 + Math.floor(gr.rnd() * 3)],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const at = Math.floor(host.pts.length * ((i + 0.6) / (count + 0.6)) * 0.96);
      const p = host.pts[at] as Pt;
      const twig = growStem(gr, {
        x: p.x,
        y: p.y,
        angle: stemAngle(host, at) + (gr.rnd() < 0.5 ? -1 : 1) * rr(gr, 0.45, 1.05),
        len: rr(gr, 36, 70) * s,
        width: 2.6 * s,
        taper: 0.32,
        gravity: 0.05,
        wobble: 0.05,
        step: 4,
        woody: 1,
        tone: wood,
      });
      const tip = twig.pts[twig.pts.length - 1] as Pt;
      clusterSpots.push({
        p: tip,
        a: stemAngle(twig, twig.pts.length - 1),
        big: gr.rnd() < 0.45,
      });
      // Mid-twig cluster on some twigs, so blossom is not only at the ends.
      if (gr.rnd() < 0.5) {
        const mid = twig.pts[Math.floor(twig.pts.length * 0.55)] as Pt;
        clusterSpots.push({ p: mid, a: stemAngle(twig, 3), big: false });
      }
      // Young leaves — much bigger than the old 11px, and overlapping.
      leafify(gr, twig, {
        shape: ['serrate', 'oval'],
        every: 15 * s,
        len: 26 * s,
        width: 15 * s,
        splay: 1.05,
        from: 0.05,
        tone: leafT,
        hueJitter: variance(gr),
        sizeTaper: 0.62,
        sizeJitter: 0.3,
        curlChance: 0.1,
        darkChance: 0.16,
        damageChance: 0.12,
      });
    }
  }

  // 2. The clusters. THIS is the change the user asked for: 5–15 blooms of
  //    20–40px per cluster, half a dozen clusters per branch.
  for (const spot of clusterSpots) {
    growCluster(gr, {
      x: spot.p.x,
      y: spot.p.y,
      spread: (spot.big ? 26 : 17) * s,
      r: [(spot.big ? 9 : 6.5) * s, (spot.big ? 19 : 13) * s],
      count: spot.big ? [8, 15] : [5, 9],
      tone: petal,
      paleChance,
      budChance: 0.24,
      kinds: ['blossom', 'blossom', 'rosette'],
      squash: rr(gr, 0.7, 1),
      angle: spot.a,
    });
  }

  // 3. Fallen petals drifting off the branch — the detail that makes a
  //    blossom tree read as *in bloom* rather than as decorated.
  const fallen = 7 + Math.floor(gr.rnd() * 9);
  for (let i = 0; i < fallen; i++) {
    const host = clusterSpots[Math.floor(gr.rnd() * clusterSpots.length)];
    if (!host) break;
    gr.g.leaves.push({
      x: host.p.x + rr(gr, -46, 46) * s,
      y: host.p.y + rr(gr, 12, 84) * s * (Math.sin(gr.dir) >= 0 ? 1 : -1),
      angle: gr.rnd() * Math.PI * 2,
      len: rr(gr, 7, 13) * s,
      width: rr(gr, 5, 9) * s,
      shape: 'petal',
      bend: rr(gr, -2, 2) * s,
      curl: rr(gr, 0, 0.4),
      tone: petalTone(gr, petal, paleChance + 0.2),
      pale: false,
      seed: (gr.rnd() * 0xffffffff) >>> 0,
      tier: gr.rnd() < 0.5 ? TIER_LIT : TIER_MID,
    });
  }
}

function growPotted(gr: Grow): void {
  const s = gr.scale;
  const t = roleTone(gr, 'leaf', [6, -6, -2]);
  const potW = 56 * s;
  const potH = 44 * s;
  contactShade(gr, 40, 0.5);
  const kinds: PotGeom['kind'][] = ['terracotta', 'terracotta', 'enamel', 'brass'];
  gr.g.pots.push({
    x: -potW / 2,
    y: -potH,
    w: potW,
    h: potH,
    kind: kinds[Math.floor(gr.rnd() * kinds.length)] ?? 'terracotta',
  });

  // A real houseplant is a *dome* of foliage, not a handful of wands. Back
  // rank dark and low, mid rank the body, front rank the lit big leaves.
  const RANKS: Array<{ n: [number, number]; len: [number, number]; leaf: [number, number]; tier: FloraTier; dl: number }> = [
    { n: [4, 6], len: [30, 52], leaf: [20, 32], tier: TIER_BACK, dl: -18 },
    { n: [5, 8], len: [42, 78], leaf: [26, 42], tier: TIER_MID, dl: 0 },
    { n: [3, 5], len: [34, 62], leaf: [30, 50], tier: TIER_LIT, dl: 9 },
  ];
  for (const rank of RANKS) {
    onTier(gr, rank.tier, () => {
      const stems = Math.round(rr(gr, rank.n[0], rank.n[1]));
      for (let i = 0; i < stems; i++) {
        const spread = ((i + 0.5) / stems - 0.5) * 2.05 + (gr.rnd() * 2 - 1) * 0.12;
        const stem = growStem(gr, {
          x: (gr.rnd() * 2 - 1) * 8 * s,
          y: -potH - 2 * s,
          angle: -Math.PI / 2 + spread,
          len: rr(gr, rank.len[0], rank.len[1]) * s,
          width: rr(gr, 2.6, 4) * s,
          taper: 0.42,
          gravity: 0.2,
          wobble: 0.05,
          step: 4.5,
          tone: {
            h: t.h - 4,
            s: clamp(t.s + 6, 0, 100),
            l: clamp(t.l + 6 + rank.dl * 0.6, 0, 100),
          },
        });
        const ll = rr(gr, rank.leaf[0], rank.leaf[1]) * s;
        leafify(gr, stem, {
          shape: ['round', 'oval', 'fan'],
          every: ll * 0.62,
          len: ll,
          width: ll * 0.92,
          splay: 1.0,
          from: 0.18,
          tone: { h: t.h, s: t.s, l: clamp(t.l + rank.dl, 0, 100) },
          hueJitter: variance(gr),
          sizeTaper: 0.72,
          sizeJitter: 0.3,
          curlChance: 0.14,
          darkChance: 0.2,
          damageChance: 0.14,
          tiers: 'fixed',
        });
      }
    });
  }
  // Soil: a dark crumbly line, plus a couple of pebbles.
  gr.g.threads.push({
    pts: [
      { x: -potW * 0.42, y: -potH + 2.5 * s },
      { x: 0, y: -potH + 4.2 * s },
      { x: potW * 0.42, y: -potH + 2.5 * s },
    ],
    width: 5 * s,
    alpha: 0.7,
    colour: hsl(...soilTone(gr)),
    tier: TIER_BACK,
  });
  // A flower or two on about half of them.
  if (gr.rnd() < 0.5) {
    onTier(gr, TIER_LIT, () => {
      growCluster(gr, {
        x: rr(gr, -14, 14) * s,
        y: -potH - rr(gr, 44, 72) * s,
        spread: 18 * s,
        r: [6 * s, 12 * s],
        count: [5, 10],
        tone: roleTone(gr, 'bloom'),
        budChance: 0.28,
      });
    });
  }
}

function growGrassTuft(gr: Grow): void {
  const s = gr.scale;
  const t = roleTone(gr, 'grass');
  const dryTone = roleTone(gr, 'dry');
  contactShade(gr, 22, 0.4);
  // Three ranks of blades — a tuft with a back, a body and a lit front.
  const RANKS: Array<{ n: number; tier: FloraTier; dl: number; len: [number, number]; sp: number }> = [
    { n: 16, tier: TIER_BACK, dl: -19, len: [38, 76], sp: 22 },
    { n: 20, tier: TIER_MID, dl: 0, len: [32, 68], sp: 26 },
    { n: 13, tier: TIER_LIT, dl: 10, len: [26, 56], sp: 24 },
  ];
  for (const rank of RANKS) {
    const blades = rank.n + Math.floor(gr.rnd() * 7);
    for (let i = 0; i < blades; i++) {
      const u = (i + gr.rnd()) / blades - 0.5;
      const dry = gr.rnd() < 0.2;
      gr.g.leaves.push({
        x: u * rank.sp * s + (gr.rnd() * 2 - 1) * 3 * s,
        y: (gr.rnd() * 2 - 1) * 1.5 * s,
        angle: gr.dir + u * 1.6 + (gr.rnd() * 2 - 1) * 0.24,
        len: rr(gr, rank.len[0], rank.len[1]) * s,
        width: rr(gr, 4, 8) * s,
        shape: gr.rnd() < 0.75 ? 'needle' : 'strap',
        bend: (u >= 0 ? 1 : -1) * rr(gr, 9, 26) * s,
        curl: gr.rnd() < 0.12 ? rr(gr, 0.3, 0.6) : 0,
        tone: dry
          ? { h: dryTone.h, s: dryTone.s, l: clamp(dryTone.l + rank.dl * 0.5, 0, 100) }
          : {
              h: t.h + (gr.rnd() * 2 - 1) * variance(gr, 12) * 1.3,
              s: clamp(t.s + (gr.rnd() * 2 - 1) * 10, 0, 100),
              l: clamp(t.l + (gr.rnd() * 2 - 1) * 9 + rank.dl, 0, 100),
            },
        pale: false,
        seed: (gr.rnd() * 0xffffffff) >>> 0,
        tier: rank.tier,
      });
    }
  }
  // Dandelions and a little meadow of small flowers on tall stalks.
  const stalks = 3 + Math.floor(gr.rnd() * 4);
  for (let i = 0; i < stalks; i++) {
    const lit = gr.rnd() < 0.45;
    const stem = growStem(gr, {
      x: (gr.rnd() * 2 - 1) * 16 * s,
      y: 0,
      angle: gr.dir + (gr.rnd() * 2 - 1) * 0.34,
      len: rr(gr, 52, 96) * s,
      width: 2.2 * s,
      taper: 0.72,
      gravity: 0.06,
      wobble: 0.035,
      step: 4.5,
      tier: lit ? TIER_LIT : TIER_MID,
      tone: { h: t.h - 6, s: clamp(t.s - 6, 0, 100), l: clamp(t.l + 4, 0, 100) },
    });
    const tip = stem.pts[stem.pts.length - 1] as Pt;
    const roll = gr.rnd();
    if (roll < 0.3) {
      gr.g.blooms.push({
        x: tip.x,
        y: tip.y,
        r: rr(gr, 10, 15) * s,
        kind: 'puff',
        open: 1,
        tone: roleTone(gr, 'dry', [4, -40, 26]),
        seed: (gr.rnd() * 0xffffffff) >>> 0,
        tier: lit ? TIER_LIT : TIER_MID,
      });
    } else if (roll < 0.62) {
      gr.g.blooms.push({
        x: tip.x,
        y: tip.y,
        r: rr(gr, 7, 11) * s,
        kind: 'dandelion',
        open: 1,
        tone: roleTone(gr, 'bloomAlt'),
        seed: (gr.rnd() * 0xffffffff) >>> 0,
        tier: lit ? TIER_LIT : TIER_MID,
      });
    } else {
      onTier(gr, lit ? TIER_LIT : TIER_MID, () => {
        growCluster(gr, {
          x: tip.x,
          y: tip.y,
          spread: 11 * s,
          r: [4 * s, 8 * s],
          count: [5, 11],
          tone: gr.rnd() < 0.5 ? roleTone(gr, 'bloomCool') : roleTone(gr, 'bloom'),
          squash: 0.7,
          budChance: 0.3,
        });
      });
    }
  }
}

function growCobweb(gr: Grow): void {
  const s = gr.scale;
  const colour = roleColour(gr, 'silk');
  // Pale silk vanishes on parchment; a dark halo under every strand keeps the
  // web readable on both a cream wall and dark walnut. It carries its own
  // alpha, so it must stay a colour string rather than a palette role.
  const halo = 'hsl(206 26% 18% / 0.5)';
  const spokes = 6 + Math.floor(gr.rnd() * 3);
  const reach = rr(gr, 46, 72) * s;
  // Sweep from the facing direction toward the horizontal on the flip side.
  const a0 = gr.dir;
  const a1 = gr.flip > 0 ? gr.dir + Math.PI / 2 : gr.dir - Math.PI / 2;
  const radials: Pt[][] = [];
  const ends: number[] = [];
  for (let i = 0; i < spokes; i++) {
    const a = lerp(a0, a1, (i + 0.5) / spokes) + (gr.rnd() * 2 - 1) * 0.05;
    const len = reach * rr(gr, 0.72, 1);
    ends.push(len);
    const pts: Pt[] = [];
    for (let k = 0; k <= 5; k++) {
      const u = k / 5;
      // A touch of sag so the threads are not laser-straight.
      const sag = Math.sin(Math.PI * u) * len * 0.035;
      pts.push({
        x: Math.cos(a) * len * u + Math.cos(a + Math.PI / 2) * sag,
        y: Math.sin(a) * len * u + Math.sin(a + Math.PI / 2) * sag,
      });
    }
    radials.push(pts);
    gr.g.threads.push({ pts, width: 0.8, alpha: 0.42, colour, halo });
  }
  // Catenary rings between consecutive radials, with a few missing spans.
  const rings = 4 + Math.floor(gr.rnd() * 3);
  for (let r = 1; r <= rings; r++) {
    const u = 0.22 + (r / rings) * 0.78;
    for (let i = 0; i < spokes - 1; i++) {
      if (gr.rnd() < 0.13) continue; // broken web
      const aA = lerp(a0, a1, (i + 0.5) / spokes);
      const aB = lerp(a0, a1, (i + 1.5) / spokes);
      const lA = (ends[i] as number) * u;
      const lB = (ends[i + 1] as number) * u;
      const pA = { x: Math.cos(aA) * lA, y: Math.sin(aA) * lA };
      const pB = { x: Math.cos(aB) * lB, y: Math.sin(aB) * lB };
      const mid = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };
      const sag = 1 + u * 0.18;
      gr.g.threads.push({
        pts: [pA, { x: mid.x * sag, y: mid.y * sag }, pB],
        width: 0.72,
        alpha: 0.34 + gr.rnd() * 0.12,
        colour,
        halo,
      });
    }
  }
  // Dust caught in the silk.
  for (let i = 0; i < 3; i++) {
    const a = lerp(a0, a1, gr.rnd());
    const l = reach * rr(gr, 0.25, 0.9);
    gr.g.blooms.push({
      x: Math.cos(a) * l,
      y: Math.sin(a) * l,
      r: rr(gr, 0.7, 1.5),
      kind: 'dust',
      open: 1,
      tone: roleTone(gr, 'dry', [0, -34, 14]),
      seed: (gr.rnd() * 0xffffffff) >>> 0,
    });
  }
}

const SPECIES: Record<FloraSpeciesId, SpeciesDef> = {
  ivy: {
    id: 'ivy',
    label: FLORA_LABELS.ivy,
    anchors: ['railTop', 'caseCorner', 'crownTop', 'shelfUnderside'],
    scale: [1.0, 1.45],
    nominalW: 300,
    grow: (gr) => growTrail(gr, TRAILS.ivy),
  },
  pothos: {
    id: 'pothos',
    label: FLORA_LABELS.pothos,
    anchors: ['railTop', 'shelfUnderside', 'caseCorner'],
    scale: [1.0, 1.4],
    nominalW: 290,
    grow: (gr) => growTrail(gr, TRAILS.pothos),
  },
  hearts: {
    id: 'hearts',
    label: FLORA_LABELS.hearts,
    anchors: ['railTop', 'shelfUnderside'],
    scale: [0.95, 1.35],
    nominalW: 150,
    grow: (gr) => growTrail(gr, TRAILS.hearts),
  },
  fern: {
    id: 'fern',
    label: FLORA_LABELS.fern,
    // Ferns stand up out of a surface, so no undersides and no top corners.
    anchors: ['railTop', 'jointGap', 'crownTop', 'potPosition'],
    scale: [0.95, 1.35],
    nominalW: 260,
    grow: growFern,
  },
  moss: {
    id: 'moss',
    label: FLORA_LABELS.moss,
    anchors: ['jointGap', 'railTop', 'crownTop', 'potPosition'],
    scale: [0.9, 1.4],
    nominalW: 130,
    grow: growMoss,
  },
  herbBundle: {
    id: 'herbBundle',
    label: FLORA_LABELS.herbBundle,
    anchors: ['shelfUnderside'],
    scale: [0.95, 1.3],
    nominalW: 130,
    grow: growHerbBundle,
  },
  blossom: {
    id: 'blossom',
    label: FLORA_LABELS.blossom,
    anchors: ['crownTop', 'railTop'],
    scale: [0.95, 1.3],
    nominalW: 330,
    grow: growBlossom,
  },
  potted: {
    id: 'potted',
    label: FLORA_LABELS.potted,
    anchors: ['potPosition', 'railTop'],
    scale: [0.9, 1.3],
    nominalW: 150,
    grow: growPotted,
  },
  grassTuft: {
    id: 'grassTuft',
    label: FLORA_LABELS.grassTuft,
    anchors: ['jointGap', 'railTop', 'crownTop', 'potPosition'],
    scale: [0.9, 1.35],
    nominalW: 130,
    grow: growGrassTuft,
  },
  cobweb: {
    id: 'cobweb',
    label: FLORA_LABELS.cobweb,
    // Webs live in corners and dark undersides, never out on an open crown.
    anchors: ['caseCorner', 'shelfUnderside', 'jointGap'],
    scale: [0.95, 1.4],
    nominalW: 150,
    grow: growCobweb,
  },
};

/** Which anchor kinds a species can grow from. */
export function speciesAnchors(id: FloraSpeciesId): readonly FloraAnchorKind[] {
  return SPECIES[id].anchors;
}

/** Can this species take hold on this kind of anchor? */
export function speciesFitsAnchor(id: FloraSpeciesId, kind: FloraAnchorKind): boolean {
  return SPECIES[id].anchors.includes(kind);
}

/* ================================ growing ================================= */

const geometryMemo = new Map<string, FloraGeometry>();
const GEOMETRY_MEMO_CAP = 512;

function emptyGeometry(ink: string): FloraGeometry {
  return {
    stems: [],
    leaves: [],
    blooms: [],
    threads: [],
    pots: [],
    tags: [],
    shades: [],
    mounds: [],
    ink,
    bounds: { x: 0, y: 0, w: 0, h: 0 },
  };
}

function computeBounds(g: FloraGeometry): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const hit = (x: number, y: number, r: number): void => {
    if (x - r < minX) minX = x - r;
    if (y - r < minY) minY = y - r;
    if (x + r > maxX) maxX = x + r;
    if (y + r > maxY) maxY = y + r;
  };
  for (const s of g.stems) {
    for (let i = 0; i < s.pts.length; i++) {
      const p = s.pts[i] as Pt;
      hit(p.x, p.y, (s.widths[i] ?? 1) / 2 + 0.5);
    }
  }
  for (const l of g.leaves) hit(l.x, l.y, leafBoundRadius(l.len, l.width) + Math.abs(l.bend));
  for (const b of g.blooms) hit(b.x, b.y, b.r * 1.35 + 1);
  for (const t of g.threads) for (const p of t.pts) hit(p.x, p.y, t.width + 0.5);
  for (const p of g.pots) {
    hit(p.x, p.y, 0);
    hit(p.x + p.w, p.y + p.h, 0);
    hit(p.x - 3, p.y - 7, 0); // rim overhang
    hit(p.x + p.w + 3, p.y + p.h, 0);
  }
  for (const t of g.tags) {
    const r = Math.hypot(t.w, t.h);
    hit(t.x, t.y, r);
  }
  for (const sh of g.shades) hit(sh.x, sh.y, Math.max(sh.rx, sh.ry));
  for (const m of g.mounds) {
    hit(m.x, m.y, m.rx);
    hit(m.x, m.y - m.up * m.ry, m.rx * 0.2);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  const pad = 1.5;
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

/**
 * Grow a specimen's geometry in **anchor-local** coordinates (the anchor is
 * the origin). Pure and deterministic; memoized because keep-out resolution
 * regrows the same specimen at a few different scales.
 */
export function growFlora(p: FloraPlacement): FloraGeometry {
  const pal = p.palette;
  const key = `${p.species}|${p.seed}|${p.scale.toFixed(4)}|${p.flip ? 1 : 0}|${p.facing}|${paletteKey(pal)}`;
  const hit = geometryMemo.get(key);
  if (hit) return hit;

  const g = emptyGeometry(pal.ink ?? DEFAULT_INK);
  const gr: Grow = {
    rnd: mulberry32(p.seed >>> 0),
    noise: seededNoise1D((p.seed ^ 0x5bf03635) >>> 0),
    scale: p.scale,
    dir: facingAngle(p.facing),
    flip: p.flip ? -1 : 1,
    pal,
    g,
    tier: TIER_MID,
  };
  SPECIES[p.species].grow(gr);
  g.bounds = computeBounds(g);

  if (geometryMemo.size > GEOMETRY_MEMO_CAP) geometryMemo.clear();
  geometryMemo.set(key, g);
  return g;
}

/** Drop every memoized geometry (tests / theme switches). */
export function clearFloraMemo(): void {
  geometryMemo.clear();
}

/* =============================== keep-out ================================= */

/** Do two rects overlap (touching edges do not count)? */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Grow a rect outward by `pad` on every side. */
export function inflateRect(r: Rect, pad: number): Rect {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

/**
 * The band of a spine that carries its title, as a keep-out rect.
 *
 * Spines are vertical, and the title runs down the middle of the spine with
 * bands/ornaments above and below it, so the protected band is the middle
 * ~70% of the spine height across its full width — plus `pad` of breathing
 * room so a leaf tip never even brushes a letter.
 */
export const SPINE_TITLE_BAND = { top: 0.15, bottom: 0.85 } as const;

export function spineTitleKeepOut(spine: Rect, pad = 3): Rect {
  const y = spine.y + spine.h * SPINE_TITLE_BAND.top;
  const h = spine.h * (SPINE_TITLE_BAND.bottom - SPINE_TITLE_BAND.top);
  return inflateRect({ x: spine.x, y, w: spine.w, h }, pad);
}

/** Convenience: title keep-outs for a row of book spine rects. */
export function spineKeepOuts(spines: readonly Rect[], pad = 3): Rect[] {
  return spines.map((s) => spineTitleKeepOut(s, pad));
}

export interface KeepOutOptions {
  /** Smallest scale a specimen may be shrunk to before it is dropped. */
  minScale?: number;
  /** Multiplier applied per shrink attempt. Default 0.82. */
  shrink?: number;
  /** Max shrink attempts. Default 4. */
  attempts?: number;
}

/** World-space bounds of a placement (local geometry + anchor position). */
export function placementBounds(p: FloraPlacement): Rect {
  const b = growFlora(p).bounds;
  return { x: b.x + p.anchor.x, y: b.y + p.anchor.y, w: b.w, h: b.h };
}

/** Does a placement currently reach into any keep-out rect? */
export function violatesKeepOut(p: FloraPlacement, keepOut: readonly Rect[]): boolean {
  if (keepOut.length === 0) return false;
  const b = p.bounds;
  for (const k of keepOut) if (rectsOverlap(b, k)) return true;
  return false;
}

/**
 * Enforce the occlusion rule: any specimen whose bounds reach into a keep-out
 * rect (a spine's title area) is shrunk back toward its anchor, and dropped
 * entirely if it still does not fit. The returned placements are guaranteed
 * not to overlap any keep-out rect.
 */
export function enforceKeepOut(
  placements: readonly FloraPlacement[],
  keepOut: readonly Rect[],
  opts: KeepOutOptions = {},
): FloraPlacement[] {
  if (keepOut.length === 0) return placements.slice();
  const minScale = opts.minScale ?? 0.42;
  const shrink = opts.shrink ?? 0.82;
  const attempts = opts.attempts ?? 4;

  const out: FloraPlacement[] = [];
  for (const p of placements) {
    let cur = p;
    let ok = !violatesKeepOut(cur, keepOut);
    for (let i = 0; !ok && i < attempts; i++) {
      const scale = cur.scale * shrink;
      if (scale < minScale) break;
      cur = { ...cur, scale };
      cur = { ...cur, bounds: placementBounds(cur) };
      ok = !violatesKeepOut(cur, keepOut);
    }
    if (ok) out.push(cur);
  }
  return out;
}

/* ================================ planning ================================ */

export interface FloraPlanOptions {
  floorIndex: number;
  themeSeed: number;
  spec: FloraSpec;
  anchors: readonly FloraAnchor[];
  /**
   * The settings slider. 0 = a completely clean shelf, 1 = the theme's own
   * density, up to 2 = overgrown. Clamped to [0, 2].
   */
  densityMultiplier?: number;
  /** Title keep-out rects (see `spineKeepOuts`). */
  keepOut?: readonly Rect[];
  keepOutOptions?: KeepOutOptions;
}

/**
 * Decide what grows where on one floor.
 *
 * Deterministic: identical options ⇒ identical placements, and the accept
 * test is a threshold on a per-anchor random value, so raising the density
 * multiplier only ever *adds* specimens (a sparse shelf is a subset of a
 * lush one — no reshuffling as the user drags the slider).
 */
export function planFlora(o: FloraPlanOptions): FloraPlacement[] {
  const mult = clamp(o.densityMultiplier ?? 1, 0, 2);
  const coverage = clamp(DENSITY_COVERAGE[o.spec.density] * mult, 0, 1);
  const eligible = o.spec.eligibleAnchors ?? FLORA_ANCHOR_KINDS;
  const palette = o.spec.palette ?? {};
  if (coverage <= 0 || o.spec.species.length === 0) return [];

  const clumpRange = DENSITY_CLUMP[o.spec.density];
  const densityScaleBase = DENSITY_SCALE[o.spec.density];

  const placements: FloraPlacement[] = [];
  for (const anchor of o.anchors) {
    if (!eligible.includes(anchor.kind)) continue;
    const candidates = o.spec.species.filter((s) => speciesFitsAnchor(s, anchor.kind));
    if (candidates.length === 0) continue;

    const seed = floraSeed(o.floorIndex, anchor.id, o.themeSeed);
    const rnd = mulberry32(seed);
    if (rnd() >= coverage) continue;

    // How many specimens pile onto this anchor. The slider pushes this as
    // well as coverage, so dragging density to 2 genuinely overgrows the case
    // instead of merely accepting more anchors.
    const clumpN = Math.max(
      1,
      Math.round(lerp(clumpRange[0], clumpRange[1], rnd()) * clamp(mult, 0.5, 2)),
    );

    for (let c = 0; c < clumpN; c++) {
      const csRnd = mulberry32((seed ^ (0x9e3779b9 * (c + 1))) >>> 0);
      const species = candidates[Math.floor(csRnd() * candidates.length)] as FloraSpeciesId;
      const def = SPECIES[species];
      // Lush rooms grow larger specimens as well as more of them, and within
      // a clump the members differ in size — equal siblings read as a stencil.
      const densityScale = densityScaleBase * lerp(0.94, 1.1, clamp(coverage, 0, 1));
      const sibling = c === 0 ? 1 : lerp(0.62, 1.02, csRnd());
      let scale = lerp(def.scale[0], def.scale[1], csRnd()) * densityScale * sibling;
      if (anchor.run && anchor.run > 0) {
        // Growth is *allowed* to be wider than its anchor now (it drapes over
        // the shelf edge and in front of the books), so the run only caps the
        // very biggest species rather than shrinking everything to fit.
        scale = Math.min(scale, Math.max(0.55, (anchor.run * 3.2) / def.nominalW));
      }
      const facing = anchor.facing ?? speciesFacing(species, anchor.kind);
      const flip = c === 0 ? (anchor.flip ?? csRnd() < 0.5) : csRnd() < 0.5;
      // Siblings are shuffled along the anchor's run so a clump spreads out
      // instead of stacking concentrically on one point.
      const run = anchor.run && anchor.run > 0 ? anchor.run : 90;
      const jitterX = c === 0 ? 0 : (csRnd() * 2 - 1) * run * 0.42;
      const jitterY = c === 0 ? 0 : (csRnd() * 2 - 1) * 7;
      const sibAnchor: FloraAnchor =
        c === 0 ? anchor : { ...anchor, x: anchor.x + jitterX, y: anchor.y + jitterY };

      const placement: FloraPlacement = {
        id: c === 0 ? `${o.floorIndex}:${anchor.id}` : `${o.floorIndex}:${anchor.id}#${c}`,
        anchor: sibAnchor,
        species,
        seed: c === 0 ? seed : (seed ^ (0x85ebca6b * (c + 1))) >>> 0,
        scale,
        flip,
        facing,
        palette,
        bounds: { x: 0, y: 0, w: 0, h: 0 },
      };
      placement.bounds = placementBounds(placement);
      placements.push(placement);
    }
  }

  return o.keepOut && o.keepOut.length > 0
    ? enforceKeepOut(placements, o.keepOut, o.keepOutOptions)
    : placements;
}

/** Union of every placement's bounds — the size of the floor's flora layer. */
export function floraLayerBounds(placements: readonly FloraPlacement[]): Rect | null {
  if (placements.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of placements) {
    minX = Math.min(minX, p.bounds.x);
    minY = Math.min(minY, p.bounds.y);
    maxX = Math.max(maxX, p.bounds.x + p.bounds.w);
    maxY = Math.max(maxY, p.bounds.y + p.bounds.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/* ================================ drawing ================================= */

function toneStr(t: Tone, dl = 0, ds = 0, a = 1): string {
  return hsl(t.h, t.s + ds, t.l + dl, a);
}

/**
 * Draw one stem as a tapered ribbon with real *round* form: a shaded side, a
 * lit side, a bark texture on the thick woody ones and a pencil arris.
 *
 * A stem at the spec's 3–6px is wide enough to be a cylinder rather than a
 * line, and painting it as one is most of what makes growth look woody
 * instead of drawn with a technical pen.
 */
function drawRibbon(ctx: Ctx2D, s: StemGeom, ink: string, light: FloraLight): void {
  const n = s.pts.length;
  if (n < 2) return;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = s.pts[Math.max(0, i - 1)] as Pt;
    const b = s.pts[Math.min(n - 1, i + 1)] as Pt;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const m = Math.hypot(dx, dy) || 1;
    const w = Math.max(0.45, (s.widths[i] ?? 1) / 2);
    left.push({ x: (s.pts[i] as Pt).x - (dy / m) * w, y: (s.pts[i] as Pt).y + (dx / m) * w });
    right.push({ x: (s.pts[i] as Pt).x + (dy / m) * w, y: (s.pts[i] as Pt).y - (dx / m) * w });
  }
  const outline = left.concat(right.reverse());
  const tier = s.tier ?? TIER_MID;
  const maxW = Math.max(...s.widths);
  const t = tier === TIER_BACK
    ? { h: s.tone.h, s: Math.max(0, s.tone.s - 12), l: Math.max(0, s.tone.l - 18) }
    : tier === TIER_LIT
      ? { h: s.tone.h, s: s.tone.s, l: Math.min(100, s.tone.l + 5) }
      : s.tone;

  ctx.save();
  traceSmooth(ctx, outline, true);
  const first = s.pts[0] as Pt;
  const last = s.pts[n - 1] as Pt;
  const g = ctx.createLinearGradient(first.x, first.y, last.x, last.y);
  g.addColorStop(0, toneStr(t, s.woody > 0.5 ? -6 : -2));
  g.addColorStop(0.6, toneStr(t, 2));
  g.addColorStop(1, toneStr(t, 9));
  ctx.fillStyle = g;
  ctx.fill();

  if (tier !== TIER_BACK && maxW > 1.6) {
    ctx.save();
    ctx.clip();
    // Cylinder shading: a dark edge on the away side, a bright core on the
    // key side, laid perpendicular to the run of the stem.
    const nx = Math.cos(light.angle);
    const ny = Math.sin(light.angle);
    const span = maxW * 1.4;
    const cx = (first.x + last.x) / 2;
    const cy = (first.y + last.y) / 2;
    const cg = ctx.createLinearGradient(cx + nx * span, cy + ny * span, cx - nx * span, cy - ny * span);
    cg.addColorStop(0, toneStr(t, 16, -4, 0.55));
    cg.addColorStop(0.42, 'rgba(0,0,0,0)');
    cg.addColorStop(1, toneStr(t, -26, -6, 0.6));
    ctx.fillStyle = cg;
    ctx.fillRect(cx - span * 6, cy - span * 6, span * 12, span * 12);

    // Bark: short striations running along the stem.
    if (s.bark && maxW > 3) {
      const rnd = mulberry32((Math.round(first.x * 31 + first.y * 17) >>> 0) || 7);
      ctx.strokeStyle = toneStr(t, -18, 2, 0.4);
      ctx.lineWidth = Math.max(0.4, maxW * 0.09);
      for (let k = 0; k < 9; k++) {
        const i0 = Math.floor(rnd() * (n - 2));
        const i1 = Math.min(n - 1, i0 + 2 + Math.floor(rnd() * 4));
        const off = (rnd() * 2 - 1) * maxW * 0.3;
        const seg: Pt[] = [];
        for (let i = i0; i <= i1; i++) {
          const p = s.pts[i] as Pt;
          const a = s.pts[Math.max(0, i - 1)] as Pt;
          const b = s.pts[Math.min(n - 1, i + 1)] as Pt;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const m = Math.hypot(dx, dy) || 1;
          seg.push({ x: p.x - (dy / m) * off, y: p.y + (dx / m) * off });
        }
        traceSmooth(ctx, seg, false);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Rim: a hairline of key colour along the lit arris.
    if (maxW > 2.4) {
      const litLeft = Math.sin(light.angle) < 0;
      ctx.save();
      traceSmooth(ctx, outline, true);
      ctx.clip();
      ctx.strokeStyle = light.rim;
      ctx.globalAlpha = 0.4 * light.strength * (tier === TIER_LIT ? 1 : 0.6);
      ctx.lineWidth = Math.max(0.5, maxW * 0.16);
      traceSmooth(ctx, litLeft ? right : left, false);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Pencil edge — heavier on woody branches.
  traceSmooth(ctx, outline, true);
  ctx.strokeStyle = ink;
  ctx.globalAlpha = s.woody > 0.5 ? 0.5 : 0.34;
  ctx.lineWidth = 0.75;
  ctx.stroke();
  ctx.restore();
}

/**
 * A soft contact shadow. Radial falloff, squashed onto the surface — this is
 * what makes a specimen sit *on* the wood instead of floating over it.
 */
function drawShade(ctx: Ctx2D, sh: ShadeGeom, alpha: number, light: FloraLight): void {
  if (sh.rx <= 0 || sh.ry <= 0) return;
  // A contact shadow is short, dark and *offset away from the key* — a big
  // soft radial disc centred on the plant just reads as a smudge of fog.
  const ox = -Math.cos(light.angle) * sh.ry * 0.9;
  const oy = -Math.sin(light.angle) * sh.ry * 0.55;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = alpha * sh.alpha;
  ctx.translate(sh.x + ox, sh.y + oy);
  ctx.scale(1, sh.ry / sh.rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, sh.rx);
  g.addColorStop(0, 'hsl(24 40% 7% / 0.92)');
  g.addColorStop(0.4, 'hsl(24 38% 9% / 0.5)');
  g.addColorStop(0.75, 'hsl(24 36% 11% / 0.16)');
  g.addColorStop(1, 'hsl(24 34% 12% / 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, sh.rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * The filled body of a cushion (moss). A wobbled dome, washed with a
 * top-lit gradient and a darker skirt where it meets the surface.
 */
function drawMound(ctx: Ctx2D, m: MoundGeom, ink: string, light: FloraLight): void {
  if (m.rx <= 0 || m.ry <= 0) return;
  const rnd = mulberry32(m.seed >>> 0);
  const steps = 30;
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const a = Math.PI * u;
    // Lumpy crest: two low-frequency bumps plus a little grain.
    const bump =
      1 +
      0.13 * Math.sin(u * Math.PI * 2.7 + rnd() * 0.001) +
      0.09 * Math.sin(u * Math.PI * 5.3 + 1.7);
    pts.push({
      x: m.x - Math.cos(a) * m.rx * (0.97 + 0.06 * Math.sin(u * Math.PI * 3.1)),
      y: m.y - m.up * Math.sin(a) * m.ry * bump,
    });
  }
  pts.push({ x: m.x + m.rx, y: m.y });
  pts.push({ x: m.x - m.rx, y: m.y });

  const tier = m.tier ?? TIER_MID;
  const dl = tier === TIER_BACK ? -16 : tier === TIER_LIT ? 5 : 0;
  ctx.save();
  traceSmooth(ctx, pts, true);
  // Directional, not merely top-lit: the dome's key side blows out and the
  // away side falls into the skirt shadow.
  const lx = Math.cos(light.angle);
  const ly = Math.sin(light.angle);
  const g = ctx.createLinearGradient(
    m.x + lx * m.rx * 0.9,
    m.y - m.up * m.ry * 1.15 + ly * m.ry * 0.6,
    m.x - lx * m.rx * 0.9,
    m.y + m.ry * 0.3,
  );
  g.addColorStop(0, toneStr(m.tone, 16 + dl, -4));
  g.addColorStop(0.45, toneStr(m.tone, dl));
  g.addColorStop(1, toneStr(m.tone, -20 + dl, 3));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Mottle: patchy colonies of a slightly different green.
  for (let i = 0; i < 7; i++) {
    ctx.globalAlpha = 0.1 + rnd() * 0.12;
    ctx.fillStyle = toneStr(m.tone, rnd() < 0.5 ? 12 : -14, rnd() * 10 - 4);
    ctx.beginPath();
    ctx.ellipse(
      m.x + (rnd() * 2 - 1) * m.rx * 0.8,
      m.y - m.up * rnd() * m.ry * 0.9,
      m.rx * (0.14 + rnd() * 0.24),
      m.ry * (0.16 + rnd() * 0.3),
      rnd() * 2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Edge darkening, clipped — the watercolour rim again.
  traceSmooth(ctx, pts, true);
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.24;
  ctx.lineWidth = Math.max(2.5, m.ry * 0.5);
  ctx.stroke();
  // Skirt: a hard dark band where the cushion meets the surface.
  ctx.globalAlpha = 0.32;
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(2, m.ry * 0.24);
  ctx.beginPath();
  ctx.moveTo(m.x - m.rx, m.y);
  ctx.lineTo(m.x + m.rx, m.y);
  ctx.stroke();
  ctx.restore();
  // Rim along the key edge of the crest.
  if (tier !== TIER_BACK) {
    ctx.save();
    traceSmooth(ctx, pts, true);
    ctx.clip();
    ctx.globalAlpha = 0.38 * light.strength;
    ctx.strokeStyle = light.rim;
    ctx.lineWidth = Math.max(1.4, m.ry * 0.14);
    const crest = pts.slice(
      lx >= 0 ? Math.floor(pts.length * 0.42) : 2,
      lx >= 0 ? pts.length - 2 : Math.floor(pts.length * 0.6),
    );
    traceSmooth(ctx, crest, false);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawBloom(ctx: Ctx2D, b: BloomGeom, ink: string, light: FloraLight): void {
  ctx.save();
  ctx.translate(b.x, b.y);
  const rnd = mulberry32(b.seed >>> 0);
  const tier = b.tier ?? TIER_MID;
  // Tier grading, exactly as for leaves: back blooms are darker and flatter,
  // lit ones brighter and rimmed.
  const dl = tier === TIER_BACK ? -16 : tier === TIER_LIT ? 5 : 0;
  const ds = tier === TIER_BACK ? -10 : 0;
  const rim = tier === TIER_BACK ? undefined : light.rim;
  const paint = {
    petalBase: toneStr(b.tone, -6 + dl, 4 + ds),
    petalTip: toneStr(b.tone, 11 + dl, ds),
    petalBack: toneStr(b.tone, -20 + dl, ds - 4),
    throat: toneStr(b.tone, -34 + dl, ds + 6, 0.7),
    ink,
    // A real blossom's eye is the brightest thing on the branch.
    centre: hsl(46, 96, 56 + dl * 0.4),
    stamen: hsl(34, 70, 30, 0.85),
    pollen: hsl(50, 100, 78),
    rim,
    lightAngle: light.angle,
  };
  switch (b.kind) {
    case 'blossom':
    case 'bud': {
      drawBlossom(ctx, b.r, b.kind === 'bud' ? Math.min(0.3, b.open) : b.open, b.seed, {
        ...paint,
        petals: b.petals ?? 5,
      });
      break;
    }
    case 'rosette': {
      // A many-petalled face — daisy, rose, cosmos. Two rings, offset.
      drawBlossom(ctx, b.r, Math.max(0.65, b.open), b.seed, {
        ...paint,
        petals: b.petals ?? 8 + Math.floor(rnd() * 5),
        doubled: true,
      });
      break;
    }
    case 'bell': {
      ctx.rotate((b.angle ?? 0) + (rnd() * 2 - 1) * 0.3);
      drawBellFlower(ctx, b.r, b.open, b.seed, paint);
      break;
    }
    case 'dome': {
      drawFloretDome(ctx, b.r, b.seed, paint);
      break;
    }
    case 'berry': {
      // A glossy sphere: dark body, terminator, one hard specular dot.
      const g = ctx.createRadialGradient(
        Math.cos(light.angle) * b.r * 0.4,
        Math.sin(light.angle) * b.r * 0.4,
        b.r * 0.1,
        0,
        0,
        b.r * 1.1,
      );
      g.addColorStop(0, toneStr(b.tone, 16 + dl));
      g.addColorStop(0.6, toneStr(b.tone, dl));
      g.addColorStop(1, toneStr(b.tone, -22 + dl));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = light.rim;
      ctx.beginPath();
      ctx.arc(Math.cos(light.angle) * b.r * 0.42, Math.sin(light.angle) * b.r * 0.42, b.r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'dandelion': {
      // A shaggy little sunburst.
      ctx.fillStyle = toneStr(b.tone);
      ctx.strokeStyle = toneStr(b.tone, -18, 6);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2;
        const r = b.r * (0.62 + rnd() * 0.42);
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r * 0.86;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'puff': {
      // Seed head: fine radiating hairs, each tipped with a seed.
      ctx.strokeStyle = 'hsl(46 14% 88% / 0.85)';
      ctx.lineWidth = 0.55;
      for (let i = 0; i < 34; i++) {
        const a = rnd() * Math.PI * 2;
        const r = b.r * (0.55 + rnd() * 0.5);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.stroke();
        ctx.fillStyle = 'hsl(42 18% 92% / 0.9)';
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 0.75, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'hsl(60 12% 82% / 0.55)';
      ctx.beginPath();
      ctx.arc(0, 0, b.r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'capsule': {
      ctx.fillStyle = toneStr(b.tone);
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.ellipse(0, 0, b.r * 0.75, b.r, rnd() * 0.6 - 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'dust': {
      ctx.fillStyle = toneStr(b.tone, -8, 0, 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, b.r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      ctx.fillStyle = toneStr(b.tone);
      ctx.beginPath();
      ctx.arc(0, 0, b.r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

function drawPot(ctx: Ctx2D, p: PotGeom, ink: string, light: FloraLight): void {
  void light;
  // Glazed pottery, not unfired mud: these are the only saturated non-plant
  // surfaces on a shelf and they are worth the pigment.
  const ramp: Record<PotGeom['kind'], [string, string, string]> = {
    terracotta: ['#d8613a', '#f08050', '#a03d1c'],
    brass: ['#d8a52e', '#f5c95c', '#9c7010'],
    enamel: ['#2fa8b8', '#5ecfdb', '#16707e'],
  };
  const [a, b, c] = ramp[p.kind];
  const cx = p.x + p.w / 2;
  const inset = p.h * 0.19;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Body: a tapered pot whose sides bow very slightly, traced smooth so the
  // silhouette is drawn rather than ruled.
  const body: Pt[] = [
    { x: p.x + 0.6, y: p.y },
    { x: p.x - 0.4, y: p.y + p.h * 0.4 },
    { x: p.x + inset * 0.55, y: p.y + p.h * 0.82 },
    { x: p.x + inset, y: p.y + p.h },
    { x: p.x + p.w - inset, y: p.y + p.h + 0.5 },
    { x: p.x + p.w - inset * 0.55, y: p.y + p.h * 0.82 },
    { x: p.x + p.w + 0.4, y: p.y + p.h * 0.4 },
    { x: p.x + p.w - 0.6, y: p.y },
  ];
  traceSmooth(ctx, body, true);
  const g = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0);
  g.addColorStop(0, c);
  g.addColorStop(0.34, b);
  g.addColorStop(0.72, a);
  g.addColorStop(1, c);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.05;
  ctx.stroke();

  // Rim: a lipped band with rounded ends, sitting slightly proud of the body.
  const rimY = p.y - p.h * 0.24;
  const rimH = p.h * 0.26;
  const rimW = p.w * 1.14;
  const rim: Pt[] = [
    { x: cx - rimW / 2, y: rimY + 1 },
    { x: cx - rimW / 2 - 0.8, y: rimY + rimH * 0.55 },
    { x: cx - rimW / 2 + 1.2, y: rimY + rimH },
    { x: cx + rimW / 2 - 1.2, y: rimY + rimH + 0.6 },
    { x: cx + rimW / 2 + 0.8, y: rimY + rimH * 0.55 },
    { x: cx + rimW / 2, y: rimY + 1 },
  ];
  traceSmooth(ctx, rim, true);
  const rg = ctx.createLinearGradient(cx - rimW / 2, 0, cx + rimW / 2, 0);
  rg.addColorStop(0, c);
  rg.addColorStop(0.4, a);
  rg.addColorStop(0.75, b);
  rg.addColorStop(1, c);
  ctx.globalAlpha = 1;
  ctx.fillStyle = rg;
  ctx.fill();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = ink;
  ctx.stroke();

  // A single warm highlight down the lit side, and dry-brush wear at the foot.
  ctx.globalAlpha = 0.24;
  ctx.strokeStyle = '#fffaf0';
  ctx.lineWidth = Math.max(1.4, p.w * 0.07);
  ctx.beginPath();
  ctx.moveTo(p.x + p.w * 0.68, p.y + p.h * 0.12);
  ctx.quadraticCurveTo(p.x + p.w * 0.63, p.y + p.h * 0.5, p.x + p.w * 0.6, p.y + p.h * 0.82);
  ctx.stroke();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x + inset * 1.1, p.y + p.h * 0.9);
  ctx.quadraticCurveTo(cx, p.y + p.h * 0.96, p.x + p.w - inset * 1.1, p.y + p.h * 0.88);
  ctx.stroke();
  ctx.restore();
}

function drawTag(ctx: Ctx2D, t: TagGeom, ink: string): void {
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(t.angle);
  ctx.fillStyle = 'hsl(44 34% 88%)';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.7;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(t.w, t.h * 0.22);
  ctx.lineTo(t.w, t.h * 0.86);
  ctx.lineTo(0, t.h);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  // Two scribbled "words".
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 2; i++) {
    ctx.beginPath();
    ctx.moveTo(t.w * 0.18, t.h * (0.38 + i * 0.24));
    ctx.lineTo(t.w * (0.72 - i * 0.14), t.h * (0.38 + i * 0.24));
    ctx.stroke();
  }
  ctx.restore();
}

export interface FloraDrawOptions {
  /** Overall opacity, e.g. for a crossfade on theme switch. Default 1. */
  alpha?: number;
  /** Add the shared granulation tile over the specimen. Default false. */
  granulate?: boolean;
  /**
   * Draw contact shadows. Default true. Turn off when the compositor already
   * lays down its own occlusion pass under the flora layer.
   */
  shadows?: boolean;
  /** Light rig for this draw. Defaults to whatever `setFloraLight()` set. */
  light?: Partial<FloraLight>;
  /**
   * Draw the ambient-occlusion pass that darkens the *interior* of a foliage
   * mass. Default true; it is the single largest contributor to a canopy
   * reading as a solid volume rather than a collage of leaves.
   */
  occlude?: boolean;
}

/** Draw one leaf at its own transform, tier-graded and (maybe) rim-lit. */
function drawLeafGeom(ctx: Ctx2D, l: LeafGeom, ink: string, light: FloraLight): void {
  const tier = l.tier ?? TIER_MID;
  ctx.save();
  ctx.translate(l.x, l.y);
  ctx.rotate(l.angle);
  const back = tier === TIER_BACK;
  const lit = tier === TIER_LIT;
  // The key vector expressed in this leaf's own frame.
  const localLight = light.angle - l.angle;
  drawLeaf(
    ctx,
    {
      shape: l.shape,
      len: l.len,
      width: l.width,
      bend: l.bend,
      curl: l.curl,
      // Hand-wobble has to scale with the blade: a fixed 0.45px wobble on a
      // 9px string-of-hearts leaf turns the heart into a lump.
      jitter: clamp(l.len * 0.028, 0.2, 0.9),
      seed: l.seed,
      damage: l.damage ?? 0,
      lobes: l.shape === 'palmate' ? 2.5 : undefined,
    },
    {
      fillBase: back ? toneStr(l.tone, -6, -6) : toneStr(l.tone),
      // The tip catches light: LIGHTER but no less saturated. Bleeding
      // saturation out of the gradient is exactly what turned a leaf into a
      // faded pressed specimen.
      fillTip: back ? toneStr(l.tone, 2, -6) : toneStr(l.tone, lit ? 15 : 11, 3),
      ink,
      vein: toneStr(l.tone, -16, 8),
      lineWidth: clamp(l.len * 0.045, 0.5, 1.3),
      // Variegation is a *pattern on* the leaf, not a different leaf colour.
      variegation: l.pale ? toneStr(l.tone, 27, -19) : undefined,
      sheen: toneStr(l.tone, 22, 0),
      shade: toneStr(l.tone, -22, -4),
      lightAngle: localLight,
      rim: back ? undefined : light.rim,
      rimStrength: (lit ? 0.85 : 0.38) * light.strength,
      specular: lit ? hsl(48, 70, 96, 0.5) : undefined,
      translucent: lit ? toneStr(l.tone, 26, 16, 0.5) : undefined,
      mottle: back ? 0 : 0.55,
      // The back tier is a silhouette: interior detail there is invisible at
      // shelf scale and only costs contrast.
      flat: back,
    },
  );
  ctx.restore();
}

/**
 * Ambient occlusion inside a foliage mass: soft dark blobs at the *centroid*
 * of each dense leaf cluster, painted between the back and mid tiers. Real
 * canopies are almost black in their interior; without this pass a hundred
 * leaves still read as a hundred separate stickers.
 */
function drawMassOcclusion(ctx: Ctx2D, leaves: readonly LeafGeom[], alpha: number): void {
  if (leaves.length < 6) return;
  // Coarse grid histogram — cheap, deterministic, no clustering library.
  const cell = 26;
  const bins = new Map<string, { x: number; y: number; n: number; r: number }>();
  for (const l of leaves) {
    const kx = Math.round(l.x / cell);
    const ky = Math.round(l.y / cell);
    const key = `${kx},${ky}`;
    const b = bins.get(key);
    if (b) {
      b.x += l.x;
      b.y += l.y;
      b.n += 1;
      b.r = Math.max(b.r, l.len * 0.5);
    } else {
      bins.set(key, { x: l.x, y: l.y, n: 1, r: l.len * 0.5 });
    }
  }
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  for (const b of bins.values()) {
    if (b.n < 4) continue;
    const cx = b.x / b.n;
    const cy = b.y / b.n;
    // Deliberately *smaller* than the cell: this pass darkens the gaps
    // between overlapping blades, it does not fog the air around the plant.
    const r = Math.min(cell * 1.15, Math.max(cell * 0.55, b.r * 0.8));
    const strength = clamp(0.04 + b.n * 0.026, 0, 0.24) * alpha;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `hsl(120 40% 8% / ${strength})`);
    g.addColorStop(0.55, `hsl(120 40% 10% / ${strength * 0.45})`);
    g.addColorStop(1, 'hsl(120 40% 12% / 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Draw a grown specimen at the current transform origin (= its anchor).
 *
 * Draw order is now **by depth tier, not by element kind** — the whole point
 * of the rebuild. Within a tier the order is threads → mounds → stems →
 * leaves → blooms, and between the back and mid tiers sits the mass occlusion
 * pass that gives the canopy an interior.
 */
export function drawFloraGeometry(
  ctx: Ctx2D,
  g: FloraGeometry,
  opts: FloraDrawOptions = {},
): void {
  const A = opts.alpha ?? 1;
  const light: FloraLight = opts.light
    ? { ...activeLight, ...opts.light }
    : activeLight;
  ctx.save();
  ctx.globalAlpha = A;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Contact shadows go down first, under everything the specimen draws.
  if (opts.shadows !== false) {
    const cast = lightPasses.castContactShadow;
    for (const sh of g.shades) {
      if (cast) cast(ctx, sh.x, sh.y, sh.rx, sh.ry, sh.alpha * A);
      else drawShade(ctx, sh, A, light);
    }
  }

  const tierOf = <T extends { tier?: FloraTier }>(arr: readonly T[], tier: FloraTier): T[] =>
    arr.filter((e) => (e.tier ?? TIER_MID) === tier);

  const drawThread = (t: ThreadGeom): void => {
    ctx.save();
    if (t.halo) {
      ctx.globalAlpha = A * t.alpha * 0.75;
      ctx.strokeStyle = t.halo;
      ctx.lineWidth = t.width * 2.6;
      traceSmooth(ctx, t.pts, false);
      ctx.stroke();
    }
    ctx.globalAlpha = A * t.alpha;
    if (t.taper) {
      ctx.fillStyle = t.colour;
      traceTapered(ctx, t.pts, (u) => (t.width / 2) * (1 - u * 0.85));
      ctx.fill();
    } else {
      ctx.strokeStyle = t.colour;
      ctx.lineWidth = t.width;
      traceSmooth(ctx, t.pts, false);
      ctx.stroke();
    }
    ctx.restore();
  };

  for (const tier of [TIER_BACK, TIER_MID, TIER_LIT] as const) {
    for (const t of tierOf(g.threads, tier)) drawThread(t);
    for (const m of tierOf(g.mounds, tier)) drawMound(ctx, m, g.ink, light);
    for (const s of tierOf(g.stems, tier)) drawRibbon(ctx, s, g.ink, light);
    const leaves = tierOf(g.leaves, tier);
    for (const l of leaves) drawLeafGeom(ctx, l, g.ink, light);
    for (const b of tierOf(g.blooms, tier)) drawBloom(ctx, b, g.ink, light);
    // Between the silhouette and the body: darken the interior of the mass.
    if (tier === TIER_BACK && (opts.occlude ?? true)) {
      drawMassOcclusion(ctx, g.leaves, A * light.occlusion);
    }
  }

  // Pots and tags are objects, not foliage: they belong in front of the
  // growth that spills out of them but behind the lit blades that drape over.
  for (const p of g.pots) drawPot(ctx, p, g.ink, light);
  for (const t of g.tags) drawTag(ctx, t, g.ink);

  ctx.restore();
}

/**
 * Draw a placement into a caller-provided context, in that context's world
 * coordinates (i.e. the anchor's x/y are honoured). Composite this *before*
 * the book/spine layer.
 */
export function drawFlora(ctx: Ctx2D, p: FloraPlacement, opts: FloraDrawOptions = {}): void {
  const g = growFlora(p);
  ctx.save();
  ctx.translate(p.anchor.x, p.anchor.y);
  drawFloraGeometry(ctx, g, opts);
  ctx.restore();
}

/** Draw a whole floor's flora in one pass (still one canvas, no per-frame work). */
export function drawFloraLayer(
  ctx: Ctx2D,
  placements: readonly FloraPlacement[],
  opts: FloraDrawOptions = {},
): void {
  for (const p of placements) drawFlora(ctx, p, opts);
}

/* ================================= baking ================================= */

function makeCanvas(w: number, h: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function get2d(c: Canvas2D): Ctx2D {
  const ctx = (c as OffscreenCanvas).getContext('2d');
  if (!ctx) throw new Error('flora: 2d context unavailable');
  return ctx as Ctx2D;
}

function granulate(ctx: Ctx2D, w: number, h: number): void {
  const tile = getGranulationTile();
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.05;
  const pat = ctx.createPattern(tile as CanvasImageSource, 'repeat');
  if (pat) {
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

export interface FloraSpriteResult {
  canvas: Canvas2D;
  /** World-space rect the canvas maps onto (draw it at bounds.x/bounds.y). */
  bounds: Rect;
  dpr: number;
}

/**
 * Render one specimen into its own tightly-cropped canvas — the sprite-friendly
 * form. `bounds` is where to blit it in world space.
 */
export function renderFloraSprite(
  p: FloraPlacement,
  dpr = 1,
  opts: FloraDrawOptions = {},
): FloraSpriteResult {
  const g = growFlora(p);
  const b = p.bounds.w > 0 ? p.bounds : placementBounds(p);
  const w = Math.max(1, Math.ceil(b.w * dpr));
  const h = Math.max(1, Math.ceil(b.h * dpr));
  const canvas = makeCanvas(w, h);
  const ctx = get2d(canvas);
  ctx.scale(dpr, dpr);
  // Anchor-local origin → sprite-local origin.
  ctx.translate(p.anchor.x - b.x, p.anchor.y - b.y);
  drawFloraGeometry(ctx, g, opts);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (opts.granulate !== false) granulate(ctx, w, h);
  return { canvas, bounds: b, dpr };
}

/**
 * Render a whole floor's flora into ONE canvas covering the union of the
 * placements' bounds. This is what the shelf compositor wants: a single
 * sprite drawn behind the spine atlas.
 */
export function renderFloraLayerCanvas(
  placements: readonly FloraPlacement[],
  dpr = 1,
  opts: FloraDrawOptions = {},
): FloraSpriteResult | null {
  const b = floraLayerBounds(placements);
  if (!b || b.w <= 0 || b.h <= 0) return null;
  const w = Math.max(1, Math.ceil(b.w * dpr));
  const h = Math.max(1, Math.ceil(b.h * dpr));
  const canvas = makeCanvas(w, h);
  const ctx = get2d(canvas);
  ctx.scale(dpr, dpr);
  ctx.translate(-b.x, -b.y);
  drawFloraLayer(ctx, placements, opts);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (opts.granulate !== false) granulate(ctx, w, h);
  return { canvas, bounds: b, dpr };
}

/** Cache key covering everything that affects the pixels of a flora layer. */
export function floraLayerCacheKey(placements: readonly FloraPlacement[]): string {
  const parts = placements.map(
    (p) =>
      `${p.species}:${p.seed.toString(16)}:${p.scale.toFixed(3)}:${p.flip ? 1 : 0}:${p.facing}:` +
      `${Math.round(p.anchor.x)},${Math.round(p.anchor.y)}:${paletteKey(p.palette)}`,
  );
  return `flora|v${FLORA_RECIPE_VERSION}|${parts.join('|')}`;
}

export interface BakedFloraLayer {
  bitmap: ImageBitmap;
  /** World rect to blit the bitmap into. */
  bounds: Rect;
}

/**
 * Bake a floor's flora once into an ImageBitmap (memory + disk cached through
 * `art/bake.ts`). Returns null when nothing grows on that floor.
 */
export async function bakeFloraLayer(
  placements: readonly FloraPlacement[],
  dpr = 1,
  opts: FloraDrawOptions = {},
): Promise<BakedFloraLayer | null> {
  const bounds = floraLayerBounds(placements);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) return null;
  const bitmap = await bakeCached(floraLayerCacheKey(placements), dpr, async () => {
    const res = renderFloraLayerCanvas(placements, dpr, opts);
    if (!res) throw new Error('flora: empty layer');
    return res.canvas as OffscreenCanvas;
  });
  return { bitmap, bounds };
}
