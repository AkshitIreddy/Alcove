/**
 * art/flora.ts — the flora & growth system (docs/design/library-themes.md §3).
 *
 * "The thing that makes a shelf feel alive." The flora on the reference
 * painting is flowering VINES: they climb the side rails, hang from the
 * crown, trail along the bottom rail. This module grows exactly that.
 *
 * ## The growth model (why it no longer reads as lettuce)
 *
 * Painted foliage reads as real when it has a skeleton, clumps AND gaps, a
 * scale hierarchy and a value range. Every specimen here is grown as:
 *
 *   1. **Vine skeleton** — a seeded climbing/hanging/trailing path anchored
 *      at the shelf edge, woody at the base and tapering to the tip, with
 *      side shoots and curling tendrils. The stem is drawn and stays visible
 *      in the gaps between leaf knots.
 *   2. **Leaves instanced at nodes** — a bare-streak/leafy-streak state
 *      machine walks the skeleton, so foliage arrives in clumps separated by
 *      bare internodes, never as a uniform rosette. Leaves near the interior
 *      are small and dark (TIER_BACK); a few large heroes (TIER_LIT) stand
 *      proud of the silhouette and catch the rim light.
 *   3. **Inflorescences at nodes** — flowers arrive as rare focal clusters
 *      of 3–7 varied blossoms with buds, each on its own pedicel, half
 *      cupped by bract leaves. Never an even scatter of dots.
 *   4. **Value discipline** — the draw lays down the near-black interior
 *      mass first, the skeleton over it, then mid foliage, then lit rims and
 *      backlit heroes. The `LightRig` drives every grading decision.
 *
 * ## Drawing = stamp instancing (why it is fast)
 *
 * Leaves are painted ONCE per (shape, palette tone, tier) into small
 * offscreen canvases — the **leaf-stamp cache** — with full vector richness
 * (gradients, veins, rim light, nibbled margins). Specimens then instance
 * them with `drawImage` transforms. Bake canvases are CPU-resident
 * (`willReadFrequently`), so this is both richer and dramatically cheaper
 * than re-running a vector pipeline per leaf.
 *
 * Three layers, in order:
 *
 *   1. **Plan**  `planFlora()` — pure math. Picks which anchors grow what, at
 *      what scale, and returns placements with honest world-space bounds.
 *      No canvas, no DOM: safe to run in a worker or a unit test.
 *   2. **Grow**  `growFlora()` — turns a placement into `FloraGeometry`
 *      (vines, leaf instances, bloom clusters, threads) in anchor-local
 *      coords. Pure and DOM-free.
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
 * Bounds are deliberately conservative (leaves are bounded by a circle
 * covering the whole blade), so a placement that passes keep-out has margin.
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
  type LeafPaint,
  type LeafShape,
  type Pt,
} from './leaves';
import { bakeCached } from './bake';
import { blowOut, keyToSource, rgbaToCss, type LightRig } from './lighting';
import { getGranulationTile, type Canvas2D, type Ctx2D } from './spines';

/** Bump when the growth model or drawing changes — invalidates baked sprites. */
export const FLORA_RECIPE_VERSION = 5;

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
 * A lush anchor grows a **clump** — 2–3 specimens fanned along the anchor's
 * run at different scales and depths, which is what turns individual plants
 * into the *masses* the art direction asks for. (Four read as wallpaper.)
 */
export const DENSITY_CLUMP: Record<FloraDensity, [number, number]> = {
  none: [0, 0],
  sparse: [1, 2],
  lush: [2, 3],
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

/** A spot on the case that flora may take hold. `id` must be stable. */
export interface FloraAnchor {
  /** Stable identifier — part of the seed, so it must not change per frame. */
  id: string;
  kind: FloraAnchorKind;
  /** Attachment point, world px (the shelf compositor's coordinate space). */
  x: number;
  y: number;
  /** Primary growth direction. Defaults per `kind` (see `speciesFacing`). */
  facing?: FloraFacing;
  /** Mirror the growth laterally. Default: derived from the seed. */
  flip?: boolean;
  /** Run available along the anchor in px (rail width, gap width…). */
  run?: number;
  /**
   * Compositional weight, 0–1, supplied by the floor planner: how strongly
   * this anchor participates in the frame around the book field. Edge and
   * corner anchors weigh ~1, mid-field anchors near 0. Omit ⇒ 1 (neutral).
   */
  weight?: number;
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
 * (see `VineRecipe.toneDelta`). That is what lets "Coral Reef" repaint every
 * plant on the shelf into weed-teal and coral-pink while ivy, pothos and
 * hearts stay recognisably different plants from each other.
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

/**
 * How a vine carries itself off its anchor:
 *  - `climb`   — up the side of the case, hugging the vertical;
 *  - `hang`    — spilling over an edge and draping downward;
 *  - `trail`   — running horizontally along a plank or rail;
 *  - `upright` — standing up out of a surface (fronds, pot plants).
 */
export type VineHabit = 'climb' | 'hang' | 'trail' | 'upright';

/**
 * One vine: the skeleton everything else hangs from. `pts` runs base → tip;
 * `widths` tapers from woody base to fresh tip. Drawn as a tapered ribbon and
 * deliberately left visible in the gaps between leaf clumps.
 */
export interface VineGeom {
  pts: Pt[];
  widths: number[];
  tone: Tone;
  /** 0 = green shoot, 1 = woody branch (drawn browner, harder-edged). */
  woody: number;
  habit: VineHabit;
  /** Depth tier. Default `TIER_MID`. */
  tier?: FloraTier;
  /** Draw bark striations along the length. Set on the thick woody vines. */
  bark?: boolean;
}

/**
 * One instanced leaf. Geometry only — the pixels live in the leaf-stamp
 * cache, keyed by (shape, palette tone bucket, tier). `x/y` is the petiole
 * attachment on (or just off) the vine skeleton; the blade extends `len` px
 * along `angle`.
 */
export interface LeafInstance {
  x: number;
  y: number;
  angle: number;
  /** Blade length, world px. */
  len: number;
  /** Blade full width, world px (bounds + stamp aspect). */
  width: number;
  /** Stamp family — the leaf shape vocabulary of `leaves.ts`. */
  shape: LeafShape;
  /** Stamp variant index within the family's cached set. */
  stamp: number;
  /** Mirror the blade across its own axis (hand-drawn asymmetry). */
  flip: boolean;
  /** Variegated (pale-streaked) blade — pothos and the odd dry grass blade. */
  pale: boolean;
  tone: Tone;
  /** Depth tier — always explicit on instances. */
  tier: FloraTier;
  seed: number;
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

/**
 * A focal point of flowers at one skeleton node: 3–7 blooms of varied radius
 * (one hero, mid blooms, buds), each carried on its own pedicel back to the
 * node. This is the unit that replaced "popcorn": flowers never appear singly
 * scattered — they arrive as a small bouquet half-cupped by foliage.
 */
export interface BloomCluster {
  /** The node heart the pedicels spring from (anchor-local). */
  x: number;
  y: number;
  blooms: BloomGeom[];
  pedicels: ThreadGeom[];
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
  vines: VineGeom[];
  leaves: LeafInstance[];
  clusters: BloomCluster[];
  threads: ThreadGeom[];
  shades: ShadeGeom[];
  mounds: MoundGeom[];
  pots: PotGeom[];
  tags: TagGeom[];
  ink: string;
  /** Anchor-local bounding box (add the anchor position for world space). */
  bounds: Rect;
}

/* ================================ seeding ================================= */

/** The one and only seed derivation: `(floorIndex, anchorId, themeSeed)`. */
export function floraSeed(floorIndex: number, anchorId: string, themeSeed: number): number {
  return fnv1a(`flora|${FLORA_RECIPE_VERSION}|${floorIndex}|${anchorId}|${themeSeed >>> 0}`);
}

/* ============================== colour roles ============================== */

/** Human-readable species names (settings UI, debug boards). */
export const FLORA_LABELS: Record<FloraSpeciesId, string> = {
  ivy: 'ivy vine',
  pothos: 'pothos vine',
  moss: 'moss tuft',
  fern: 'fern frond',
  herbBundle: 'hanging herb bundle',
  blossom: 'flowering vine',
  hearts: 'string-of-hearts vine',
  potted: 'small potted plant',
  grassTuft: 'grass & dandelion tuft',
  cobweb: 'cobweb',
};

const DEFAULT_INK = 'hsl(112 34% 18%)';

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
  /** The anchor kind this specimen took hold of (habit resolution). */
  anchorKind: FloraAnchorKind;
  /** Resolved facing (post `speciesFacing`). */
  facing: FloraFacing;
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
 * One flower's colour off the recipe's petal tone. Most keep the hue and
 * jitter around it; `paleChance` of them open near-white, which is what a
 * real cherry branch does and what stops a cluster of blossom reading as one
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
  return parts.join('|');
}

/** Random in `[a, b)`. */
function rr(gr: Grow, a: number, b: number): number {
  return a + gr.rnd() * (b - a);
}

/** Random integer in `[a, b]` inclusive. */
function rri(gr: Grow, a: number, b: number): number {
  return a + Math.floor(gr.rnd() * (b - a + 1));
}

/** Smallest signed difference between two angles. */
function angleDelta(target: number, from: number): number {
  return Math.atan2(Math.sin(target - from), Math.cos(target - from));
}

/* ============================ the vine recipe ============================= */

/**
 * Everything that makes one species grow differently from another, expressed
 * as numbers on the shared vine engine. No per-species draw code: ivy,
 * pothos, hearts, blossom, moss, fern, herbs and pot plants are all the same
 * skeleton + instanced leaves + rare clustered flowers, parameterised.
 */
interface VineRecipe {
  /** How many vines sprout from the anchor point. */
  vines: [number, number];
  /** Vine path length, px at scale 1 (before `Grow.scale`). */
  len: [number, number];
  /** Average internode step, px at scale 1. */
  step: number;
  /** Stem width at the base, px at scale 1. */
  width: [number, number];
  /** 0 = green shoot … 1 = fully woody (bark, brown, harder edge). */
  woody: number;
  /** Habit when the resolved facing is up / down. */
  habitUp: VineHabit;
  habitDown: VineHabit;
  /** Anchor kinds that force a horizontal trail along the plank. */
  trailOn?: readonly FloraAnchorKind[];
  /** Weighted leaf-shape pick, `[shape, weight]`. */
  shapes: readonly (readonly [LeafShape, number])[];
  /** Blade length range, px at scale 1. */
  leafLen: [number, number];
  /** Leaves per leafy node (1–2 alternate; exactly 2 when `opposite`). */
  perNode: [number, number];
  /** Opposite leaf pairs at a node (string-of-hearts, fern pinnae). */
  opposite?: boolean;
  /** Leafy-streak length in nodes, then a bare streak — clumps AND gaps. */
  clumpRun: [number, number];
  gapRun: [number, number];
  /** Chance a leaf falls back into the dark interior tier. */
  backChance: number;
  /** Rim-lit hero leaves per vine. */
  heroes: [number, number];
  /** Expected side shoots per vine (0–2 in practice). */
  branches: number;
  /** Expected curling tendrils near the tip. */
  tendrils: number;
  /** Leaf angle off the stem, radians. */
  splay: [number, number];
  /** Per-step heading wobble, radians. */
  curve: number;
  /** Variegated blade chance. */
  pale?: number;
  /** Colour role + species character delta. */
  role: FloraToneRole;
  toneDelta: ToneTuple;
  /** Flowers, when the species blooms. */
  flowers?: {
    kinds: readonly BloomKind[];
    /** Roll per leafy clump. */
    chance: number;
    /** Hard cap per vine — flowers stay rare and focal. */
    maxPerVine: number;
    /** Hero blossom radius, px at scale 1. */
    size: [number, number];
    /** Near-white blossom chance. */
    pale: number;
    role: FloraToneRole;
  };
}

/* ============================= the vine engine ============================ */

/** The full-fan spread of vine base angles off the anchor, per habit. */
const HABIT_FAN: Record<VineHabit, number> = {
  climb: 0.55,
  hang: 0.95,
  trail: 0.7,
  upright: 1.25,
};

function pickShape(gr: Grow, rec: VineRecipe): LeafShape {
  let total = 0;
  for (const [, w] of rec.shapes) total += w;
  let roll = gr.rnd() * total;
  for (const [shape, w] of rec.shapes) {
    roll -= w;
    if (roll <= 0) return shape;
  }
  return rec.shapes[0]![0];
}

/** Blade aspect per shape: full width as a fraction of length. */
function shapeAspect(shape: LeafShape): number {
  switch (shape) {
    case 'heart':
      return 0.9;
    case 'lobed':
      return 0.95;
    case 'palmate':
      return 1.05;
    case 'round':
      return 0.95;
    case 'serrate':
      return 0.5;
    case 'needle':
      return 0.2;
    case 'strap':
      return 0.26;
    case 'petal':
      return 0.55;
    case 'fan':
      return 0.9;
    case 'pinnate':
      return 0.5;
    default:
      return 0.62;
  }
}

function habitFor(gr: Grow, rec: VineRecipe): VineHabit {
  if (rec.trailOn && rec.trailOn.includes(gr.anchorKind)) return 'trail';
  return gr.facing === 'down' ? rec.habitDown : rec.habitUp;
}

/**
 * Integrate one vine's skeleton: a steered random walk whose target heading
 * depends on the habit, with per-step noise for the hand-drawn wobble.
 * Returns the path base → tip plus the per-point widths (tapered).
 */
function vinePath(
  gr: Grow,
  rec: VineRecipe,
  habit: VineHabit,
  ox: number,
  oy: number,
  baseAngle: number,
  len: number,
  baseWidth: number,
  vineIdx: number,
): { pts: Pt[]; widths: number[] } {
  const step = Math.max(4, rec.step * gr.scale * rr(gr, 0.9, 1.1));
  const steps = Math.max(3, Math.round(len / step));
  const pts: Pt[] = [{ x: ox, y: oy }];
  const widths: number[] = [baseWidth];
  const phase = gr.rnd() * Math.PI * 2;
  // Trail runs left or right depending on the mirror; the flip picks which.
  const trailDir = gr.flip > 0 ? 0 : Math.PI;
  // Upright fronds arc outward as they rise; the fan position sets the side.
  const uprightSide = Math.sin(phase) >= 0 ? 1 : -1;

  let ang = baseAngle;
  let x = ox;
  let y = oy;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const wob = (gr.noise(i * 0.42 + vineIdx * 13.7) - 0.5) * 2 * rec.curve;
    switch (habit) {
      case 'hang': {
        // Spill outward first, then settle into a slow S-swing downward.
        const target = Math.PI / 2 + Math.sin(t * Math.PI * 1.7 + phase) * 0.5 * (1 - t * 0.35);
        ang += angleDelta(target, ang) * 0.22 + wob;
        break;
      }
      case 'climb': {
        // Reach upward with a gentle weave, hugging the vertical.
        const target = -Math.PI / 2 + Math.sin(t * Math.PI * 2.1 + phase) * 0.36;
        ang += angleDelta(target, ang) * 0.2 + wob;
        break;
      }
      case 'trail': {
        // Along the plank, undulating; the last stretch droops over the edge.
        const undulate = Math.sin(t * 5.2 + phase) * 0.3;
        const droop = t > 0.78 ? ((t - 0.78) / 0.22) * 0.55 : 0;
        const target = trailDir + undulate + (trailDir === 0 ? droop : -droop);
        ang += angleDelta(target, ang) * 0.26 + wob * 0.7;
        break;
      }
      default: {
        // Upright: rise steeply, then arc outward toward the fan side.
        const arc = (1 - (1 - t) * (1 - t)) * 0.75 * uprightSide;
        ang = baseAngle + arc + wob;
        break;
      }
    }
    const stepLen = step * (0.86 + gr.rnd() * 0.28);
    x += Math.cos(ang) * stepLen;
    y += Math.sin(ang) * stepLen;
    pts.push({ x, y });
    widths.push(Math.max(0.45, baseWidth * Math.pow(1 - t, 0.72) + 0.3));
  }
  return { pts, widths };
}

/** A curling tendril thread off a node near the vine tip. */
function growTendril(gr: Grow, p: Pt, stemAngle: number, tone0: Tone): ThreadGeom {
  const side = gr.rnd() < 0.5 ? 1 : -1;
  let ang = stemAngle + side * rr(gr, 1.0, 1.6);
  const pts: Pt[] = [{ x: p.x, y: p.y }];
  let x = p.x;
  let y = p.y;
  const segs = rri(gr, 8, 11);
  const curl = side * rr(gr, 0.32, 0.5);
  for (let i = 1; i <= segs; i++) {
    ang += curl;
    const d = 2.6 * gr.scale * (1 - (i / segs) * 0.45);
    x += Math.cos(ang) * d;
    y += Math.sin(ang) * d;
    pts.push({ x, y });
  }
  return {
    pts,
    width: Math.max(0.45, 0.62 * gr.scale),
    alpha: 0.85,
    colour: toneStr(tone0, 6, -4),
    taper: true,
  };
}

/**
 * The inflorescence: one focal flower cluster at a leafy node.
 *
 * Structure, always: one large open hero, 1–4 mid blooms at 55–85% of its
 * radius, 1–2 closed buds at 35–55% — every bloom on its own visible pedicel
 * back to the node, and 1–2 small bract leaves cupping the cluster from
 * below (they land in the mid tier, so they half-hide the buds behind them).
 */
function growInflorescence(
  gr: Grow,
  rec: VineRecipe,
  flowers: NonNullable<VineRecipe['flowers']>,
  node: Pt,
  stemAngle: number,
  hero: boolean,
  stemTone: Tone,
): void {
  const petal = roleTone(gr, flowers.role);
  const heroR = rr(gr, flowers.size[0], flowers.size[1]) * 1.2 * gr.scale;
  // The cluster leans out from the stem on the side the leaves already face.
  const lean = stemAngle + (gr.rnd() < 0.5 ? 1 : -1) * rr(gr, 0.2, 0.65);
  const hx = node.x + Math.cos(lean) * heroR * 1.15;
  const hy = node.y + Math.sin(lean) * heroR * 1.15;

  const nB = rri(gr, 3, 7);
  const nBuds = clamp(rri(gr, 1, 2), 1, nB - 2);
  const blooms: BloomGeom[] = [];
  const pedicels: ThreadGeom[] = [];
  const cluster: BloomCluster = { x: node.x, y: node.y, blooms, pedicels };

  const place = (px: number, py: number, r: number, kind: BloomKind, open: number, tier: FloraTier): void => {
    const b: BloomGeom = {
      x: px,
      y: py,
      r,
      kind,
      open,
      tone: petalTone(gr, petal, flowers.pale),
      seed: (gr.rnd() * 0xffffffff) >>> 0,
      tier,
      petals: 5,
    };
    blooms.push(b);
    // Pedicel: node → bloom with a soft outward bow.
    const mx = (node.x + px) / 2;
    const my = (node.y + py) / 2;
    const dx = px - node.x;
    const dy = py - node.y;
    const dist = Math.hypot(dx, dy) || 1;
    const bow = dist * rr(gr, 0.14, 0.3) * (gr.rnd() < 0.5 ? 1 : -1);
    pedicels.push({
      pts: [
        { x: node.x, y: node.y },
        { x: mx - (dy / dist) * bow, y: my + (dx / dist) * bow },
        { x: px, y: py },
      ],
      width: Math.max(0.5, 0.7 * gr.scale + r * 0.045),
      alpha: 0.92,
      colour: toneStr(stemTone, -4, 2),
      taper: true,
      tier,
    });
  };

  // The hero sits at the cluster heart.
  place(hx, hy, heroR, flowers.kinds[0] ?? 'blossom', rr(gr, 0.85, 1), hero ? TIER_LIT : TIER_MID);

  // Mid blooms dart-thrown around the hero, buds tucked nearer the node.
  let placed = 1;
  let guard = 0;
  while (placed < nB - nBuds && guard++ < 24) {
    const a = gr.rnd() * Math.PI * 2;
    const d = heroR * rr(gr, 0.9, 2.05);
    const px = hx + Math.cos(a) * d;
    const py = hy + Math.sin(a) * d * 0.9;
    let ok = true;
    for (const b of blooms) {
      if (Math.hypot(b.x - px, b.y - py) < (b.r + heroR * 0.62) * 0.72) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const kind = flowers.kinds[rri(gr, 0, flowers.kinds.length - 1)] ?? 'blossom';
    place(px, py, heroR * rr(gr, 0.55, 0.85), kind, rr(gr, 0.5, 0.95), TIER_MID);
    placed++;
  }
  for (let k = 0; k < nBuds; k++) {
    const a = gr.rnd() * Math.PI * 2;
    const d = heroR * rr(gr, 0.5, 1.25);
    place(
      node.x + (hx - node.x) * 0.55 + Math.cos(a) * d * 0.5,
      node.y + (hy - node.y) * 0.55 + Math.sin(a) * d * 0.45,
      heroR * rr(gr, 0.35, 0.55),
      'bud',
      rr(gr, 0.12, 0.3),
      TIER_BACK,
    );
  }

  // Bracts: small leaves cupping the cluster, emitted into the leaf list so
  // they draw with the rest of the mid foliage — over the buds, under the
  // open faces.
  const nBracts = rri(gr, 1, 2);
  for (let k = 0; k < nBracts; k++) {
    const ba = lean + (gr.rnd() < 0.5 ? 1 : -1) * rr(gr, 0.9, 1.7);
    const bl = heroR * rr(gr, 0.75, 1.05);
    g_pushLeaf(gr, rec, {
      x: node.x + Math.cos(ba) * heroR * 0.5,
      y: node.y + Math.sin(ba) * heroR * 0.5,
      angle: ba,
      len: bl,
      tier: TIER_MID,
    });
  }

  gr.g.clusters.push(cluster);
}

/** Push one leaf instance, with per-leaf tone jitter and stamp pick. */
function g_pushLeaf(
  gr: Grow,
  rec: VineRecipe,
  o: { x: number; y: number; angle: number; len: number; tier: FloraTier; shape?: LeafShape },
): number {
  const shape = o.shape ?? pickShape(gr, rec);
  const v = variance(gr);
  const base = roleTone(gr, rec.role, rec.toneDelta);
  const t: Tone = {
    h: base.h + (gr.rnd() * 2 - 1) * v * 0.5,
    s: clamp(base.s + (gr.rnd() * 2 - 1) * 5, 0, 100),
    l: clamp(base.l + (gr.rnd() * 2 - 1) * 4, 0, 100),
  };
  gr.g.leaves.push({
    x: o.x,
    y: o.y,
    angle: o.angle,
    len: o.len,
    width: o.len * shapeAspect(shape),
    shape,
    stamp: rri(gr, 0, 3),
    flip: gr.rnd() < 0.5,
    pale: (rec.pale ?? 0) > 0 && gr.rnd() < (rec.pale ?? 0),
    tone: t,
    tier: o.tier,
    seed: (gr.rnd() * 0xffffffff) >>> 0,
  });
  return gr.g.leaves.length - 1;
}

/**
 * Grow one vine (and its side shoots) from a base point: skeleton, node
 * clumps/gaps, leaf instances, heroes, tendrils, inflorescences.
 */
function growVine(
  gr: Grow,
  rec: VineRecipe,
  habit: VineHabit,
  ox: number,
  oy: number,
  baseAngle: number,
  len: number,
  baseWidth: number,
  vineIdx: number,
  depth: number,
): void {
  const { pts, widths } = vinePath(gr, rec, habit, ox, oy, baseAngle, len, baseWidth, vineIdx);
  const steps = pts.length - 1;
  const stemTone =
    rec.woody > 0.5
      ? roleTone(gr, 'wood', [rec.toneDelta[0] * 0.4, rec.toneDelta[1] * 0.4, rec.toneDelta[2] * 0.4])
      : roleTone(gr, rec.role, [rec.toneDelta[0], rec.toneDelta[1] - 6, rec.toneDelta[2] - 8]);

  gr.g.vines.push({
    pts,
    widths,
    tone: stemTone,
    woody: rec.woody,
    habit,
    bark: rec.woody > 0.5 && baseWidth * 1 > 2.6,
  });

  // Smoothed stem angle at node i.
  const stemAngleAt = (i: number): number => {
    const a = pts[Math.max(0, i - 1)] as Pt;
    const b = pts[Math.min(steps, i + 1)] as Pt;
    return Math.atan2(b.y - a.y, b.x - a.x);
  };

  // -- The clump/gap rhythm: leafy streaks alternate with bare streaks, so
  // foliage knots at nodes and the skeleton stays visible between them.
  const leafy: boolean[] = new Array<boolean>(steps + 1).fill(false);
  leafy[0] = true; // the grip is always clothed
  {
    let i = 1;
    let state = true;
    while (i <= steps) {
      const run = state ? rri(gr, rec.clumpRun[0], rec.clumpRun[1]) : rri(gr, rec.gapRun[0], rec.gapRun[1]);
      for (let k = 0; k < run && i <= steps; k++, i++) leafy[i] = state;
      state = !state;
    }
    // Fresh growth: the tip node is bare more often than not.
    if (gr.rnd() < 0.6) leafy[steps] = false;
  }

  // -- Leaves at the leafy nodes.
  const nodeLeafIdx: number[][] = [];
  for (let i = 1; i <= steps; i++) {
    if (!leafy[i]) continue;
    const p = pts[i] as Pt;
    const stemA = stemAngleAt(i);
    const n = rec.opposite ? 2 : rri(gr, rec.perNode[0], rec.perNode[1]);
    const idxs: number[] = [];
    for (let k = 0; k < n; k++) {
      const sideSign = rec.opposite
        ? k === 0
          ? 1
          : -1
        : ((i + k) % 2 === 0 ? 1 : -1) * gr.flip;
      const splay = rr(gr, rec.splay[0], rec.splay[1]);
      const la = stemA + sideSign * splay + (gr.rnd() - 0.5) * 0.24;
      // Big leaves low and mid-vine, small toward the tip; interior leaves
      // (near the base, where foliage overlaps) fall back into the dark tier.
      const taper = lerp(1.14, 0.6, i / steps);
      const len = rr(gr, rec.leafLen[0], rec.leafLen[1]) * taper * (0.9 + gr.rnd() * 0.2) * gr.scale;
      const backRoll = rec.backChance + (i < steps * 0.3 ? 0.18 : 0);
      const tier: FloraTier = gr.rnd() < backRoll ? TIER_BACK : TIER_MID;
      idxs.push(
        g_pushLeaf(gr, rec, {
          x: p.x + Math.cos(la) * len * 0.1,
          y: p.y + Math.sin(la) * len * 0.1,
          angle: la,
          len,
          tier,
        }),
      );
    }
    nodeLeafIdx.push(idxs);
  }

  // -- Heroes: a few leaves upgraded to the lit tier — bigger, pushed proud
  // of the silhouette. They are the leaves that catch the rim light.
  const heroN = rri(gr, rec.heroes[0], rec.heroes[1]);
  const midIdx: number[] = [];
  for (const idxs of nodeLeafIdx) {
    for (const idx of idxs) {
      const l = gr.g.leaves[idx] as LeafInstance;
      if (l.tier === TIER_MID) midIdx.push(idx);
    }
  }
  if (heroN > 0 && midIdx.length > 3) {
    for (let h = 0; h < Math.min(heroN, midIdx.length); h++) {
      const idx = midIdx[Math.floor(((h + 0.5) / Math.min(heroN, midIdx.length)) * midIdx.length)] as number;
      const l = gr.g.leaves[idx] as LeafInstance;
      l.tier = TIER_LIT;
      l.len *= 1.26;
      l.width *= 1.26;
      l.x += Math.cos(l.angle) * l.len * 0.08;
      l.y += Math.sin(l.angle) * l.len * 0.08;
    }
  }

  // -- Side shoots, off nodes in the vine's midsection.
  if (depth === 0 && rec.branches > 0) {
    let n = Math.floor(rec.branches);
    if (gr.rnd() < rec.branches - n) n++;
    for (let b = 0; b < n && steps > 4; b++) {
      const i = rri(gr, Math.max(2, Math.floor(steps * 0.28)), Math.floor(steps * 0.65));
      const p = pts[i] as Pt;
      const side = (b % 2 === 0 ? 1 : -1) * gr.flip;
      growVine(
        gr,
        rec,
        habit,
        p.x,
        p.y,
        stemAngleAt(i) + side * rr(gr, 0.5, 0.95),
        len * rr(gr, 0.36, 0.55),
        Math.max(0.5, (widths[i] ?? 1) * 0.62),
        vineIdx * 10 + b + 1,
        depth + 1,
      );
    }
  }

  // -- Tendrils, off nodes in the tip half.
  if (rec.tendrils > 0) {
    let n = Math.floor(rec.tendrils);
    if (gr.rnd() < rec.tendrils - n) n++;
    for (let k = 0; k < n && steps > 3; k++) {
      const i = rri(gr, Math.floor(steps * 0.55), steps);
      const p = pts[i] as Pt;
      gr.g.threads.push(growTendril(gr, p, stemAngleAt(i), stemTone));
    }
  }

  // -- Inflorescences: one roll per leafy clump, hard-capped per vine.
  if (rec.flowers && depth === 0) {
    const fl = rec.flowers;
    let used = 0;
    let i = 1;
    let clusterIdx = 0;
    while (i <= steps && used < fl.maxPerVine) {
      if (!leafy[i]) {
        i++;
        continue;
      }
      // Found the start of a clump; walk to its end — the outer node is the
      // showpiece position, poking out of the foliage that cups it.
      let j = i;
      while (j + 1 <= steps && leafy[j + 1]) j++;
      const clumpLen = j - i + 1;
      if (clumpLen >= 2 && gr.rnd() < fl.chance) {
        const p = pts[j] as Pt;
        growInflorescence(gr, rec, fl, p, stemAngleAt(j), used === 0, stemTone);
        used++;
        clusterIdx++;
      }
      i = j + 1;
    }
    void clusterIdx;
  }
}

/** Grow a whole specimen of vines from the anchor point. */
function growVineSpecimen(gr: Grow, rec: VineRecipe): void {
  const habit = habitFor(gr, rec);
  const total = rri(gr, rec.vines[0], rec.vines[1]);
  const fan = HABIT_FAN[habit];
  const baseDir = habit === 'trail' ? (gr.flip > 0 ? 0 : Math.PI) : gr.dir;
  for (let v = 0; v < total; v++) {
    const spread = total > 1 ? (v / (total - 1) - 0.5) * fan : 0;
    const angle = baseDir + spread * gr.flip + (gr.rnd() - 0.5) * 0.16;
    const len = rr(gr, rec.len[0], rec.len[1]) * gr.scale * lerp(1, 0.72, total > 1 ? v / (total - 1) : 0);
    const w = rr(gr, rec.width[0], rec.width[1]) * Math.min(1.25, gr.scale);
    // Siblings spread a little along the anchor's run so they don't stack.
    const ox = (gr.rnd() * 2 - 1) * 7 * gr.scale;
    const oy = (gr.rnd() * 2 - 1) * 2.5 * gr.scale;
    growVine(gr, rec, habit, ox, oy, angle, len, w, v, 0);
  }
}

/* --------------------------- species add-ons ----------------------------- */

/** Moss creeps; its body is a filled cushion under the creeping vines. */
function addMossMound(gr: Grow, rec: VineRecipe): void {
  const up = gr.facing === 'down' ? -1 : 1;
  const rx = rr(gr, 30, 48) * gr.scale;
  gr.g.mounds.push({
    x: rr(gr, -4, 4) * gr.scale,
    y: 0,
    rx,
    ry: rx * rr(gr, 0.4, 0.52),
    up,
    tone: roleTone(gr, 'moss', rec.toneDelta),
    seed: (gr.rnd() * 0xffffffff) >>> 0,
  });
}

/** Herb bundles hang from twine wraps, with the occasional paper tag. */
function addTwineAndTag(gr: Grow): void {
  const twine = roleColour(gr, 'twine');
  const wrapY = rr(gr, 7, 11) * gr.scale;
  const wrapW = rr(gr, 9, 13) * gr.scale;
  for (let k = 0; k < 2; k++) {
    const y = wrapY + k * 3.2 * gr.scale;
    const pts: Pt[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * (i / 8);
      pts.push({ x: -Math.cos(a) * wrapW, y: y + Math.sin(a) * 2.6 * gr.scale });
    }
    gr.g.threads.push({ pts, width: Math.max(0.7, 1.1 * gr.scale), alpha: 0.95, colour: twine });
  }
  // The loop the bunch hangs from.
  gr.g.threads.push({
    pts: [
      { x: 0, y: -9 * gr.scale },
      { x: -1.5 * gr.scale, y: -3 * gr.scale },
      { x: 0, y: wrapY },
      { x: 1.5 * gr.scale, y: -3 * gr.scale },
      { x: 0.4 * gr.scale, y: -9 * gr.scale },
    ],
    width: Math.max(0.6, 0.9 * gr.scale),
    alpha: 0.9,
    colour: twine,
  });
  if (gr.rnd() < 0.55) {
    const tx = wrapW * rr(gr, 0.7, 1.05);
    const ty = wrapY + rr(gr, 4, 8) * gr.scale;
    gr.g.threads.push({
      pts: [
        { x: wrapW * 0.55, y: wrapY },
        { x: tx * 0.8, y: ty - 2 * gr.scale },
        { x: tx, y: ty },
      ],
      width: Math.max(0.5, 0.7 * gr.scale),
      alpha: 0.85,
      colour: twine,
    });
    gr.g.tags.push({
      x: tx,
      y: ty,
      w: 12 * gr.scale,
      h: 8 * gr.scale,
      angle: rr(gr, -0.15, 0.3),
    });
  }
}

/* ------------------------- bespoke: grass tuft ---------------------------- */

/**
 * Grass is not a vine — it is a fan of strap blades off a basal point, plus
 * 1–3 thin flower stalks carrying a single dandelion clock or seed puff.
 * The blades still instance stamps and still tier back→lit.
 */
function growGrassTuft(gr: Grow): void {
  const g = gr.g;
  g.shades.push({
    x: 0,
    y: 1.5 * gr.scale,
    rx: 15 * gr.scale,
    ry: 4.5 * gr.scale,
    alpha: 0.42,
  });

  const bladeN = rri(gr, 9, 16);
  const bladeIdx: number[] = [];
  for (let b = 0; b < bladeN; b++) {
    const angle = -Math.PI / 2 + (gr.rnd() - 0.5) * rr(gr, 0.9, 1.5);
    const len = rr(gr, 34, 78) * gr.scale;
    const dry = gr.rnd() < 0.14;
    const base = dry ? roleTone(gr, 'dry') : roleTone(gr, 'grass');
    const v = variance(gr);
    const tier: FloraTier = gr.rnd() < 0.24 ? TIER_BACK : TIER_MID;
    g.leaves.push({
      x: (gr.rnd() * 2 - 1) * 5 * gr.scale,
      y: (gr.rnd() - 0.5) * 2 * gr.scale,
      angle,
      len,
      width: len * 0.16,
      shape: 'strap',
      stamp: rri(gr, 0, 3),
      flip: gr.rnd() < 0.5,
      pale: dry,
      tone: {
        h: base.h + (gr.rnd() * 2 - 1) * v * 0.5,
        s: clamp(base.s + (gr.rnd() * 2 - 1) * 6, 0, 100),
        l: clamp(base.l + (gr.rnd() * 2 - 1) * 5, 0, 100),
      },
      tier,
      seed: (gr.rnd() * 0xffffffff) >>> 0,
    });
    bladeIdx.push(g.leaves.length - 1);
  }
  // A couple of hero blades catch the light.
  const heroes = rri(gr, 0, 2);
  for (let h = 0; h < heroes && bladeIdx.length > 4; h++) {
    const idx = bladeIdx[rri(gr, 0, bladeIdx.length - 1)] as number;
    const l = g.leaves[idx] as LeafInstance;
    if (l.tier !== TIER_MID) continue;
    l.tier = TIER_LIT;
    l.len *= 1.14;
    l.width *= 1.14;
  }

  // Flower stalks: a slim upright vine each, crowned with one clock or puff.
  const stalks = rri(gr, 1, 3);
  for (let s = 0; s < stalks; s++) {
    const ox = (gr.rnd() * 2 - 1) * 7 * gr.scale;
    const len = rr(gr, 74, 118) * gr.scale;
    const lean = (gr.rnd() - 0.5) * 0.5;
    const pts: Pt[] = [{ x: ox, y: 0 }];
    const segs = 5;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      pts.push({
        x: ox + Math.sin(lean) * len * t + Math.sin(t * 4 + s) * 1.5 * gr.scale,
        y: -Math.cos(lean) * len * t,
      });
    }
    const stemTone = roleTone(gr, 'grass', [0, -6, -8]);
    g.vines.push({
      pts,
      widths: pts.map((_, i) => Math.max(0.4, (1.1 - (i / segs) * 0.6) * gr.scale)),
      tone: stemTone,
      woody: 0,
      habit: 'upright',
    });
    const tip = pts[segs] as Pt;
    const clock = gr.rnd() < 0.55;
    const r = rr(gr, 5.5, 8.5) * gr.scale;
    g.clusters.push({
      x: tip.x,
      y: tip.y,
      blooms: [
        {
          x: tip.x,
          y: tip.y,
          r,
          kind: clock ? 'dandelion' : 'puff',
          open: 1,
          tone: clock ? roleTone(gr, 'bloomAlt') : tone(gr, 42, 22, 78),
          seed: (gr.rnd() * 0xffffffff) >>> 0,
          tier: TIER_LIT,
        },
      ],
      pedicels: [],
    });
  }
}

/* --------------------------- bespoke: cobweb ------------------------------ */

/**
 * A cobweb is not foliage at all: a fan of radial silk threads across a case
 * corner, joined by a few sagging concentric arcs. Threads only.
 */
function growCobweb(gr: Grow): void {
  const g = gr.g;
  const silk = roleColour(gr, 'silk');
  const halo = 'hsl(140 20% 22% / 0.5)';
  const cx = 0;
  const cy = 0;
  // The web spans the corner's inner diagonal; flip mirrors it.
  const baseA = (gr.flip > 0 ? 1 : -1) * (Math.PI / 4);
  const radials: Pt[][] = [];
  const n = rri(gr, 5, 8);
  for (let i = 0; i < n; i++) {
    const a = baseA + (gr.flip > 0 ? 1 : -1) * ((i / (n - 1)) - 0.5) * rr(gr, 1.2, 1.7);
    const len = rr(gr, 34, 74) * gr.scale;
    const pts: Pt[] = [
      { x: cx, y: cy },
      { x: cx + Math.cos(a) * len * 0.55, y: cy + Math.sin(a) * len * 0.55 },
      { x: cx + Math.cos(a) * len, y: cy + Math.sin(a) * len },
    ];
    radials.push(pts);
    g.threads.push({ pts, width: 0.6, alpha: rr(gr, 0.35, 0.55), colour: silk, halo });
  }
  // Concentric arcs between adjacent radials, sagging toward the centre.
  const rings = rri(gr, 2, 4);
  for (let k = 1; k <= rings; k++) {
    const f = 0.3 + (k / (rings + 1)) * 0.62;
    for (let i = 0; i + 1 < radials.length; i++) {
      const a = radials[i] as Pt[];
      const b = radials[i + 1] as Pt[];
      const p0 = a[2] as Pt;
      const p1 = b[2] as Pt;
      const ax = p0.x * f;
      const ay = p0.y * f;
      const bx = p1.x * f;
      const by = p1.y * f;
      const sag = rr(gr, 3, 7) * gr.scale;
      g.threads.push({
        pts: [
          { x: ax, y: ay },
          { x: (ax + bx) / 2, y: (ay + by) / 2 + sag },
          { x: bx, y: by },
        ],
        width: 0.5,
        alpha: rr(gr, 0.3, 0.5),
        colour: silk,
        halo,
      });
    }
  }
  // One or two drift threads hanging loose.
  const drifts = rri(gr, 1, 2);
  for (let d = 0; d < drifts; d++) {
    const x = rr(gr, -20, 20) * gr.scale;
    const len = rr(gr, 24, 52) * gr.scale;
    g.threads.push({
      pts: [
        { x, y: cy },
        { x: x + rr(gr, -3, 3), y: cy + len * 0.6 },
        { x: x + rr(gr, -5, 5), y: cy + len },
      ],
      width: 0.5,
      alpha: rr(gr, 0.4, 0.6),
      colour: silk,
      halo,
    });
  }
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

/** Grow a vine specimen from a recipe, plus any species add-ons. */
function vineGrower(rec: VineRecipe, addons?: (gr: Grow) => void): (gr: Grow) => void {
  return (gr: Grow) => {
    // Contact shadow first — everything else lands on top of it.
    const reach = ((rec.len[0] + rec.len[1]) / 2) * gr.scale;
    gr.g.shades.push({
      x: 0,
      y: gr.facing === 'down' ? 3 * gr.scale : 1.5 * gr.scale,
      rx: clamp(reach * 0.3, 8, 60),
      ry: clamp(reach * 0.3, 8, 60) * 0.3,
      alpha: 0.4,
    });
    growVineSpecimen(gr, rec);
    if (addons) addons(gr);
  };
}

const IVY: VineRecipe = {
  vines: [2, 3],
  len: [90, 160],
  step: 13,
  width: [2.2, 3.2],
  woody: 0.55,
  habitUp: 'climb',
  habitDown: 'hang',
  shapes: [
    ['lobed', 0.7],
    ['palmate', 0.3],
  ],
  leafLen: [22, 38],
  perNode: [1, 2],
  clumpRun: [2, 4],
  gapRun: [1, 3],
  backChance: 0.3,
  heroes: [1, 2],
  branches: 1.1,
  tendrils: 1.4,
  splay: [0.55, 1.0],
  curve: 0.22,
  role: 'leaf',
  toneDelta: [-5, -1, -2],
};

const POTHOS: VineRecipe = {
  vines: [1, 3],
  len: [90, 170],
  step: 14,
  width: [2.0, 2.8],
  woody: 0.25,
  habitUp: 'climb',
  habitDown: 'hang',
  shapes: [['heart', 1]],
  leafLen: [24, 42],
  perNode: [1, 2],
  clumpRun: [1, 3],
  gapRun: [1, 2],
  backChance: 0.26,
  heroes: [1, 2],
  branches: 0.9,
  tendrils: 0.8,
  splay: [0.6, 1.1],
  curve: 0.24,
  pale: 0.4,
  role: 'leaf',
  toneDelta: [-11, -2, 2],
};

const HEARTS: VineRecipe = {
  vines: [4, 7],
  len: [60, 130],
  step: 11,
  width: [0.8, 1.2],
  woody: 0.1,
  habitUp: 'hang',
  habitDown: 'hang',
  shapes: [['heart', 1]],
  leafLen: [8, 15],
  perNode: [2, 2],
  opposite: true,
  clumpRun: [1, 2],
  gapRun: [1, 2],
  backChance: 0.22,
  heroes: [0, 1],
  branches: 0.3,
  tendrils: 0.6,
  splay: [0.9, 1.5],
  curve: 0.18,
  role: 'leaf',
  toneDelta: [12, -32, 10],
};

const BLOSSOM: VineRecipe = {
  vines: [1, 2],
  len: [110, 200],
  step: 15,
  width: [2.6, 3.8],
  woody: 0.75,
  habitUp: 'climb',
  habitDown: 'hang',
  trailOn: ['jointGap', 'potPosition'],
  shapes: [
    ['serrate', 0.6],
    ['oval', 0.4],
  ],
  leafLen: [15, 25],
  perNode: [1, 2],
  clumpRun: [2, 3],
  gapRun: [1, 2],
  backChance: 0.3,
  heroes: [1, 2],
  branches: 0.8,
  tendrils: 0.3,
  splay: [0.5, 0.9],
  curve: 0.2,
  role: 'leaf',
  toneDelta: [6, -8, 1],
  flowers: {
    kinds: ['blossom'],
    chance: 0.5,
    maxPerVine: 3,
    size: [6.5, 11],
    pale: 0.3,
    role: 'bloom',
  },
};

const MOSS: VineRecipe = {
  vines: [2, 4],
  len: [28, 62],
  step: 8,
  width: [1.4, 2.0],
  woody: 0.15,
  habitUp: 'trail',
  habitDown: 'trail',
  shapes: [['round', 1]],
  leafLen: [4.5, 8.5],
  perNode: [2, 3],
  clumpRun: [3, 6],
  gapRun: [0, 1],
  backChance: 0.35,
  heroes: [0, 0],
  branches: 0.6,
  tendrils: 0,
  splay: [0.4, 1.2],
  curve: 0.26,
  role: 'moss',
  toneDelta: [0, 0, 0],
};

const FERN: VineRecipe = {
  vines: [5, 8],
  len: [60, 110],
  step: 10,
  width: [1.6, 2.2],
  woody: 0.2,
  habitUp: 'upright',
  habitDown: 'hang',
  shapes: [['needle', 1]],
  leafLen: [7, 13],
  perNode: [2, 2],
  opposite: true,
  clumpRun: [8, 12],
  gapRun: [0, 1],
  backChance: 0.3,
  heroes: [0, 1],
  branches: 0,
  tendrils: 0,
  splay: [1.1, 1.5],
  curve: 0.14,
  role: 'leafDeep',
  toneDelta: [0, 0, 0],
};

const HERB: VineRecipe = {
  vines: [3, 5],
  len: [34, 62],
  step: 9,
  width: [1.0, 1.5],
  woody: 0.35,
  habitUp: 'hang',
  habitDown: 'hang',
  shapes: [['strap', 1]],
  leafLen: [11, 20],
  perNode: [1, 2],
  clumpRun: [2, 4],
  gapRun: [1, 2],
  backChance: 0.3,
  heroes: [0, 0],
  branches: 0.2,
  tendrils: 0,
  splay: [0.3, 0.8],
  curve: 0.12,
  role: 'dry',
  toneDelta: [0, 0, 0],
};

const POTTED: VineRecipe = {
  vines: [2, 4],
  len: [44, 85],
  step: 11,
  width: [1.6, 2.4],
  woody: 0.4,
  habitUp: 'upright',
  habitDown: 'upright',
  shapes: [
    ['oval', 0.7],
    ['round', 0.3],
  ],
  leafLen: [13, 23],
  perNode: [1, 2],
  clumpRun: [2, 4],
  gapRun: [1, 2],
  backChance: 0.28,
  heroes: [1, 2],
  branches: 0.7,
  tendrils: 0,
  splay: [0.6, 1.1],
  curve: 0.16,
  role: 'leaf',
  toneDelta: [4, -2, 0],
  flowers: {
    kinds: ['blossom'],
    chance: 0.22,
    maxPerVine: 1,
    size: [3.6, 5.5],
    pale: 0.15,
    role: 'bloomAlt',
  },
};

/** The pot itself, then vines out of its soil. */
function growPotted(gr: Grow): void {
  const w = rr(gr, 30, 42) * gr.scale;
  const h = w * rr(gr, 0.72, 0.85);
  const kinds: PotGeom['kind'][] = ['terracotta', 'terracotta', 'brass', 'enamel'];
  gr.g.pots.push({
    x: -w / 2,
    y: -h,
    w,
    h,
    kind: kinds[rri(gr, 0, kinds.length - 1)] ?? 'terracotta',
  });
  gr.g.shades.push({
    x: 0,
    y: 2 * gr.scale,
    rx: w * 0.62,
    ry: w * 0.2,
    alpha: 0.45,
  });
  // Vines sprout from the soil line, not the plank.
  const soilY = -h + 3 * gr.scale;
  const rec = POTTED;
  const total = rri(gr, rec.vines[0], rec.vines[1]);
  for (let v = 0; v < total; v++) {
    const spread = total > 1 ? (v / (total - 1) - 0.5) * HABIT_FAN.upright : 0;
    growVine(
      gr,
      rec,
      'upright',
      (gr.rnd() * 2 - 1) * w * 0.22,
      soilY,
      gr.dir + spread + (gr.rnd() - 0.5) * 0.2,
      rr(gr, rec.len[0], rec.len[1]) * gr.scale * lerp(1, 0.7, total > 1 ? v / (total - 1) : 0),
      rr(gr, rec.width[0], rec.width[1]) * Math.min(1.25, gr.scale),
      v,
      0,
    );
  }
}

const SPECIES: Record<FloraSpeciesId, SpeciesDef> = {
  ivy: {
    id: 'ivy',
    label: FLORA_LABELS.ivy,
    anchors: ['railTop', 'shelfUnderside', 'caseCorner', 'crownTop', 'jointGap'],
    scale: [0.75, 1.25],
    nominalW: 160,
    grow: vineGrower(IVY),
  },
  pothos: {
    id: 'pothos',
    label: FLORA_LABELS.pothos,
    anchors: ['railTop', 'shelfUnderside', 'crownTop'],
    scale: [0.7, 1.2],
    nominalW: 150,
    grow: vineGrower(POTHOS),
  },
  moss: {
    id: 'moss',
    label: FLORA_LABELS.moss,
    anchors: ['railTop', 'jointGap', 'caseCorner', 'crownTop', 'potPosition'],
    scale: [0.7, 1.35],
    nominalW: 100,
    grow: vineGrower(MOSS, (gr) => addMossMound(gr, MOSS)),
  },
  fern: {
    id: 'fern',
    label: FLORA_LABELS.fern,
    anchors: ['railTop', 'jointGap', 'potPosition', 'caseCorner'],
    scale: [0.7, 1.2],
    nominalW: 120,
    grow: vineGrower(FERN),
  },
  herbBundle: {
    id: 'herbBundle',
    label: FLORA_LABELS.herbBundle,
    anchors: ['railTop', 'shelfUnderside'],
    scale: [0.7, 1.15],
    nominalW: 60,
    grow: vineGrower(HERB, addTwineAndTag),
  },
  blossom: {
    id: 'blossom',
    label: FLORA_LABELS.blossom,
    anchors: ['railTop', 'crownTop', 'shelfUnderside', 'caseCorner', 'jointGap', 'potPosition'],
    scale: [0.8, 1.3],
    nominalW: 180,
    grow: vineGrower(BLOSSOM),
  },
  hearts: {
    id: 'hearts',
    label: FLORA_LABELS.hearts,
    anchors: ['railTop', 'shelfUnderside', 'caseCorner', 'crownTop'],
    scale: [0.75, 1.25],
    nominalW: 100,
    grow: vineGrower(HEARTS),
  },
  potted: {
    id: 'potted',
    label: FLORA_LABELS.potted,
    anchors: ['potPosition', 'railTop', 'jointGap'],
    scale: [0.7, 1.2],
    nominalW: 90,
    grow: growPotted,
  },
  grassTuft: {
    id: 'grassTuft',
    label: FLORA_LABELS.grassTuft,
    anchors: ['jointGap', 'railTop', 'potPosition'],
    scale: [0.7, 1.25],
    nominalW: 90,
    grow: growGrassTuft,
  },
  cobweb: {
    id: 'cobweb',
    label: FLORA_LABELS.cobweb,
    anchors: ['caseCorner', 'shelfUnderside'],
    scale: [0.8, 1.2],
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
    vines: [],
    leaves: [],
    clusters: [],
    threads: [],
    shades: [],
    mounds: [],
    pots: [],
    tags: [],
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
  for (const v of g.vines) {
    for (let i = 0; i < v.pts.length; i++) {
      const p = v.pts[i] as Pt;
      hit(p.x, p.y, (v.widths[i] ?? 1) / 2 + 0.5);
    }
  }
  // A leaf is bounded by the circle that covers its whole blade from the
  // petiole — deliberately conservative (keep-out runs on these numbers).
  for (const l of g.leaves) hit(l.x, l.y, leafBoundRadius(l.len, l.width) + 0.5);
  for (const c of g.clusters) {
    for (const b of c.blooms) hit(b.x, b.y, b.r * 1.35 + 1);
    for (const t of c.pedicels) for (const p of t.pts) hit(p.x, p.y, t.width + 0.5);
  }
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
    anchorKind: p.anchor.kind,
    facing: p.facing,
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
 *
 * An anchor's compositional `weight` (0–1, from the floor planner's frame
 * field) gates acceptance, clump size and specimen scale — edge anchors grow
 * full vines while mid-field anchors shrink toward nothing, which is what
 * keeps the central book field clear.
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

    const weight = clamp(anchor.weight ?? 1, 0, 1);
    const seed = floraSeed(o.floorIndex, anchor.id, o.themeSeed);
    const rnd = mulberry32(seed);
    if (rnd() >= coverage * weight) continue;

    // How many specimens pile onto this anchor. The slider pushes this as
    // well as coverage, so dragging density to 2 genuinely overgrows the case
    // instead of merely accepting more anchors.
    const clumpN = Math.max(
      1,
      Math.round(lerp(clumpRange[0], clumpRange[1], rnd()) * clamp(mult, 0.5, 2) * lerp(0.55, 1, weight)),
    );

    for (let c = 0; c < clumpN; c++) {
      const csRnd = mulberry32((seed ^ (0x9e3779b9 * (c + 1))) >>> 0);
      const species = candidates[Math.floor(csRnd() * candidates.length)] as FloraSpeciesId;
      const def = SPECIES[species];
      // Lush rooms grow larger specimens as well as more of them, and within
      // a clump the members differ in size — equal siblings read as a stencil.
      const densityScale =
        densityScaleBase * lerp(0.94, 1.1, clamp(coverage, 0, 1)) * lerp(0.66, 1, weight);
      const sibling = c === 0 ? 1 : lerp(0.62, 1.02, csRnd());
      let scale = lerp(def.scale[0], def.scale[1], csRnd()) * densityScale * sibling;
      if (anchor.run && anchor.run > 0) {
        // Growth is *allowed* to be wider than its anchor now (it drapes over
        // the shelf edge and in front of the books), so the run only caps the
        // very biggest species rather than shrinking everything to fit.
        scale = Math.min(scale, Math.max(0.55, (anchor.run * 3.2) / def.nominalW));
      }
      // A drape past ~1.7 reads as a curtain smothering the books; cap it.
      if (TRAILING.has(species)) scale = Math.min(scale, 1.7);
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
  // A hair of epsilon: callers test containment with <=, and float summation
  // otherwise makes a placement sit *just* outside its own layer bounds.
  return { x: minX, y: minY, w: maxX - minX + 1e-9, h: maxY - minY + 1e-9 };
}

/* ================================ drawing ================================= */

function toneStr(t: Tone, dl = 0, ds = 0, a = 1): string {
  return hsl(t.h, t.s + ds, t.l + dl, a);
}

/**
 * Draw one vine as a tapered ribbon with real *round* form: a shaded side, a
 * lit side, bark striations on the thick woody ones and a pencil arris.
 */
function drawVineRibbon(ctx: Ctx2D, s: VineGeom, ink: string, light: FloraLight): void {
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
      ctx.fillStyle = toneStr(b.tone, 14, 8);
      ctx.beginPath();
      ctx.arc(0, 0, b.r * 0.42, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'puff': {
      // A seed clock: radiating filaments with tiny seed dots.
      ctx.strokeStyle = 'hsl(48 14% 88% / 0.75)';
      ctx.lineWidth = 0.55;
      for (let i = 0; i < 26; i++) {
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

/* ---------------------------- leaf stamp cache --------------------------- */

/**
 * The performance heart of the rebuild.
 *
 * Painting one leaf the vector way costs a dozen paths and gradients; a vine
 * carries dozens of leaves and a floor carries hundreds. Instead, each
 * (shape, palette tone bucket, tier, pale) combination is painted ONCE into
 * `STAMP_VARIANTS` small canvases — full richness: gradient, veins, mottle,
 * rim light, nibbled margins — and every leaf instance is a single
 * transformed `drawImage`. Bake canvases are CPU-resident Skia rasters, so
 * blitting is the cheapest thing we can do per leaf.
 */
interface LeafStamp {
  c: Canvas2D;
  /** Petiole (attachment) point inside the stamp canvas. */
  px: number;
  py: number;
  /** Native blade length the stamp was painted at. */
  len: number;
}

/** Native blade length per tier: heroes are painted big (crisp when lit). */
const STAMP_NATIVE: Record<FloraTier, number> = {
  [TIER_BACK]: 30,
  [TIER_MID]: 46,
  [TIER_LIT]: 66,
};

const STAMP_VARIANTS = 4;

const stampCache = new Map<string, LeafStamp[]>();
const STAMP_CACHE_CAP = 160;

/** Paint options per tier — this is where the value discipline is baked in. */
function stampPaint(
  tier: FloraTier,
  tone0: Tone,
  pale: boolean,
  ink: string,
  light: FloraLight,
  len: number,
): LeafPaint {
  const back = tier === TIER_BACK;
  const lit = tier === TIER_LIT;
  return {
    fillBase: back ? toneStr(tone0, -12, -10) : toneStr(tone0),
    // The tip catches light: LIGHTER but no less saturated. Bleeding
    // saturation out of the gradient is what turns a leaf into a faded
    // pressed specimen.
    fillTip: back ? toneStr(tone0, -4, -10) : toneStr(tone0, lit ? 15 : 11, 3),
    ink,
    vein: back ? toneStr(tone0, -8, -6) : toneStr(tone0, -16, 8),
    lineWidth: clamp(len * 0.045, 0.5, 1.3),
    // Variegation is a *pattern on* the leaf, not a different leaf colour.
    variegation: pale ? toneStr(tone0, 27, -19) : undefined,
    sheen: toneStr(tone0, 22, 0),
    shade: toneStr(tone0, -22, -4),
    lightAngle: light.angle,
    rim: back ? undefined : light.rim,
    rimStrength: (lit ? 0.85 : 0.38) * light.strength,
    specular: lit ? hsl(48, 70, 96, 0.5) : undefined,
    translucent: lit ? toneStr(tone0, 26, 16, 0.5) : undefined,
    mottle: back ? 0 : 0.55,
    // The back tier is a silhouette: interior detail there is invisible at
    // shelf scale and only costs contrast.
    flat: back,
  };
}

/** Build (or fetch) the stamp set for one (shape, pale, tier, tone bucket). */
function leafStamps(
  shape: LeafShape,
  pale: boolean,
  tier: FloraTier,
  tone0: Tone,
  ink: string,
  light: FloraLight,
): LeafStamp[] {
  // Quantize the tone so per-leaf jitter doesn't fragment the cache: leaves
  // within ~6°/8%/8% of each other share stamps, and the variants +
  // transforms supply the visible variety.
  const q = (v: number, step: number): number => Math.round(v / step);
  const key = [
    shape,
    pale ? 1 : 0,
    tier,
    q(tone0.h, 6),
    q(tone0.s, 8),
    q(tone0.l, 8),
    ink,
    light.angle.toFixed(2),
  ].join('|');
  const hit = stampCache.get(key);
  if (hit) return hit;

  const len = STAMP_NATIVE[tier];
  const width = Math.max(3, len * shapeAspect(shape));
  const paint = stampPaint(tier, tone0, pale, ink, light, len);
  const rnd = mulberry32(fnv1a(key));
  const stamps: LeafStamp[] = [];
  for (let v = 0; v < STAMP_VARIANTS; v++) {
    const bend = (rnd() * 2 - 1) * len * 0.16;
    const curl = rnd() < 0.35 ? rnd() * 0.3 : 0;
    const damage = rnd() < 0.3 ? 0.12 + rnd() * 0.3 : 0;
    const seed = (rnd() * 0xffffffff) >>> 0;
    const padX = 7;
    const padY = 7 + Math.abs(bend);
    const w = Math.ceil(len * 1.28 + padX * 2);
    const h = Math.ceil(width + padY * 2);
    const c = makeCanvas(w, h);
    const ctx = get2d(c);
    const px = padX + len * 0.14;
    const py = h / 2;
    ctx.translate(px, py);
    drawLeaf(
      ctx,
      {
        shape,
        len,
        width,
        bend,
        curl,
        jitter: clamp(len * 0.028, 0.2, 0.9),
        seed,
        damage,
        lobes: shape === 'palmate' ? 2.5 : undefined,
      },
      paint,
    );
    stamps.push({ c, px, py, len });
  }
  if (stampCache.size > STAMP_CACHE_CAP) stampCache.clear();
  stampCache.set(key, stamps);
  return stamps;
}

/** Instance one leaf: a single transformed blit from the stamp cache. */
function drawLeafInstance(ctx: Ctx2D, l: LeafInstance, ink: string, light: FloraLight): void {
  const stamps = leafStamps(l.shape, l.pale, l.tier, l.tone, ink, light);
  const s = stamps[l.stamp % stamps.length] as LeafStamp;
  const k = l.len / s.len;
  ctx.save();
  ctx.translate(l.x, l.y);
  ctx.rotate(l.angle);
  if (l.flip) ctx.scale(1, -1);
  ctx.drawImage(s.c as CanvasImageSource, -s.px * k, -s.py * k, s.c.width * k, s.c.height * k);
  ctx.restore();
}

/**
 * Ambient occlusion inside a foliage mass: soft dark blobs at the *centroid*
 * of each dense leaf cluster, painted between the back and mid tiers. Real
 * canopies are almost black in their interior; without this pass a hundred
 * leaves still read as a hundred separate stickers.
 */
function drawMassOcclusion(ctx: Ctx2D, leaves: readonly LeafInstance[], alpha: number): void {
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
    const strength = clamp(0.04 + b.n * 0.026, 0, 0.26) * alpha;
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

/* --------------------------- bake-time pacing ---------------------------- */

/**
 * Yield to the event loop so a long bake never becomes a longtask.
 * `scheduler.yield()` (Chromium 129+) continues as a macrotask without the
 * 4ms nested-timeout clamp; setTimeout is the fallback everywhere else.
 */
function yieldControl(): Promise<void> {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (sched && typeof sched.yield === 'function') return sched.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Frame-budget pacer for bake draws. `tick()` is awaited between draw
 * elements; it resolves immediately while under budget and yields the event
 * loop once the budget is spent, so the window stays responsive (and Pixi's
 * ticker keeps rendering) through a whole multi-floor bake storm.
 */
class BakePacer {
  private deadline: number;
  constructor(private readonly budgetMs = 10) {
    this.deadline = performance.now() + budgetMs;
  }
  async tick(): Promise<void> {
    if (performance.now() < this.deadline) return;
    await yieldControl();
    this.deadline = performance.now() + this.budgetMs;
  }
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

/**
 * Draw a grown specimen at the current transform origin (= its anchor).
 *
 * Draw order is the value discipline made literal:
 *
 *   contact shades → back-tier mounds + leaves (the near-black interior
 *   mass) → the occlusion pass over that mass → the vine skeleton (visible
 *   in the gaps) → back blooms (buds nestled in shadow) → mid mounds →
 *   mid threads → mid leaves (the body) → mid blooms → lit leaves (heroes)
 *   → lit blooms (the focal faces) → pots and tags.
 *
 * The body is a generator that yields between top-level elements, at points
 * where the canvas state is back at the baseline established by the opening
 * `save()`. The two drivers below execute the *same* canvas calls in the
 * *same* order — the sync one runs straight through (sprites, tests), the
 * async one (bake path) lets the event loop breathe via a BakePacer, so the
 * rasterized output is identical either way.
 */
function* drawFloraGeometrySteps(
  ctx: Ctx2D,
  g: FloraGeometry,
  opts: FloraDrawOptions,
): Generator<void, void, void> {
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
      yield;
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

  const pedicelsOf = (tier: FloraTier): ThreadGeom[] =>
    g.clusters.flatMap((c) => tierOf(c.pedicels, tier));
  const bloomsOf = (tier: FloraTier): BloomGeom[] =>
    g.clusters.flatMap((c) => tierOf(c.blooms, tier));

  // 1. The interior mass: back mounds + back leaves, then the occlusion pass
  //    multiplied over it — the near-black heart every cluster needs.
  for (const m of tierOf(g.mounds, TIER_BACK)) {
    drawMound(ctx, m, g.ink, light);
    yield;
  }
  for (const l of tierOf(g.leaves, TIER_BACK)) {
    drawLeafInstance(ctx, l, g.ink, light);
    yield;
  }
  if (opts.occlude ?? true) {
    drawMassOcclusion(ctx, g.leaves, A * light.occlusion);
    yield;
  }

  // 2. The skeleton, over the dark mass so the vines stay visible in gaps.
  for (const v of g.vines) {
    drawVineRibbon(ctx, v, g.ink, light);
    yield;
  }

  // 3. Back-tier threads + buds: the shadowed, half-hidden parts of a cluster.
  for (const t of tierOf(g.threads, TIER_BACK)) {
    drawThread(t);
    yield;
  }
  for (const t of pedicelsOf(TIER_BACK)) {
    drawThread(t);
    yield;
  }
  for (const b of bloomsOf(TIER_BACK)) {
    drawBloom(ctx, b, g.ink, light);
    yield;
  }

  // 4. The mid body: mounds, threads, foliage, open blooms.
  for (const m of tierOf(g.mounds, TIER_MID)) {
    drawMound(ctx, m, g.ink, light);
    yield;
  }
  for (const t of tierOf(g.threads, TIER_MID)) {
    drawThread(t);
    yield;
  }
  for (const t of pedicelsOf(TIER_MID)) {
    drawThread(t);
    yield;
  }
  for (const l of tierOf(g.leaves, TIER_MID)) {
    drawLeafInstance(ctx, l, g.ink, light);
    yield;
  }
  for (const b of bloomsOf(TIER_MID)) {
    drawBloom(ctx, b, g.ink, light);
    yield;
  }

  // 5. The lit accents: hero leaves first, then the focal flower faces.
  for (const t of tierOf(g.threads, TIER_LIT)) {
    drawThread(t);
    yield;
  }
  for (const l of tierOf(g.leaves, TIER_LIT)) {
    drawLeafInstance(ctx, l, g.ink, light);
    yield;
  }
  for (const t of pedicelsOf(TIER_LIT)) {
    drawThread(t);
    yield;
  }
  for (const b of bloomsOf(TIER_LIT)) {
    drawBloom(ctx, b, g.ink, light);
    yield;
  }

  // Pots and tags are objects, not foliage: they belong in front of the
  // growth that spills out of them but behind the lit blades that drape over.
  for (const p of g.pots) {
    drawPot(ctx, p, g.ink, light);
    yield;
  }
  for (const t of g.tags) {
    drawTag(ctx, t, g.ink);
    yield;
  }

  ctx.restore();
}

/** Synchronous driver: run the whole specimen in one turn (sprites, tests). */
export function drawFloraGeometry(
  ctx: Ctx2D,
  g: FloraGeometry,
  opts: FloraDrawOptions = {},
): void {
  const steps = drawFloraGeometrySteps(ctx, g, opts);
  while (!steps.next().done) {
    // The generator only yields pacing markers; nothing to do between them.
  }
}

/**
 * Asynchronous driver for the bake path: identical pixels to
 * `drawFloraGeometry`, but whenever `budgetMs` of solid drawing has elapsed
 * the loop suspends for one macrotask, so a whole-floor bake is a stream of
 * sub-frame slices instead of one window-freezing longtask.
 */
export async function drawFloraGeometryAsync(
  ctx: Ctx2D,
  g: FloraGeometry,
  opts: FloraDrawOptions = {},
  pacer: BakePacer = new BakePacer(),
): Promise<void> {
  const steps = drawFloraGeometrySteps(ctx, g, opts);
  for (let r = steps.next(); !r.done; r = steps.next()) {
    await pacer.tick();
  }
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
  for (const p of placements) {
    drawFlora(ctx, p, opts);
  }
}

/**
 * The bake-path layer draw: identical pixels to `drawFloraLayer`, paced so no
 * contiguous run of drawing exceeds `budgetMs` before the event loop gets a
 * macrotask. One pacer is shared across every specimen so the budget is
 * honoured across specimen boundaries too.
 */
export async function drawFloraLayerAsync(
  ctx: Ctx2D,
  placements: readonly FloraPlacement[],
  opts: FloraDrawOptions = {},
  budgetMs = 10,
): Promise<void> {
  const pacer = new BakePacer(budgetMs);
  for (const p of placements) {
    const g = growFlora(p);
    ctx.save();
    ctx.translate(p.anchor.x, p.anchor.y);
    await drawFloraGeometryAsync(ctx, g, opts, pacer);
    ctx.restore();
  }
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
  // Bake canvases are only ever read back (convertToBlob → disk PNG cache,
  // transferToImageBitmap → Pixi upload) — never shown on screen. Keeping
  // them CPU-resident keeps every draw off the GPU channel: that channel is
  // where a bake used to block for seconds at a time behind a saturated GPU
  // process, and it made convertToBlob pay a full readback on top.
  const ctx = (c as OffscreenCanvas).getContext('2d', { willReadFrequently: true });
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
 *
 * Async because the draw is paced (`drawFloraLayerAsync`): the same canvas
 * calls in the same order as the synchronous sprite path, sliced so the bake
 * never blocks the window.
 */
export async function renderFloraLayerCanvas(
  placements: readonly FloraPlacement[],
  dpr = 1,
  opts: FloraDrawOptions = {},
): Promise<FloraSpriteResult | null> {
  const b = floraLayerBounds(placements);
  if (!b || b.w <= 0 || b.h <= 0) return null;
  const w = Math.max(1, Math.ceil(b.w * dpr));
  const h = Math.max(1, Math.ceil(b.h * dpr));
  const canvas = makeCanvas(w, h);
  const ctx = get2d(canvas);
  ctx.scale(dpr, dpr);
  ctx.translate(-b.x, -b.y);
  await drawFloraLayerAsync(ctx, placements, opts);
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
    const res = await renderFloraLayerCanvas(placements, dpr, opts);
    if (!res) throw new Error('flora: empty layer');
    return res.canvas as OffscreenCanvas;
  });
  return { bitmap, bounds };
}
