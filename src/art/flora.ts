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
 *   1. **Stem skeleton** — a seeded climbing/hanging/trailing path anchored
 *      at the shelf edge, thick and woody at the grip and tapering to a hair
 *      at the growing point, with side shoots and curling tendrils. The stem
 *      is drawn and stays visible in the gaps between leaf knots.
 *   2. **Leaves instanced at nodes** — a bare-streak/leafy-streak state
 *      machine walks the skeleton, so foliage arrives in clumps separated by
 *      bare internodes, never as a uniform rosette.
 *   3. **Inflorescences at nodes** — flowers arrive as rare focal clusters
 *      of 3–7 varied blossoms with buds, each on its own pedicel, half
 *      cupped by bract leaves. Never an even scatter of dots.
 *   4. **Depth by position, not by dice** — `shadeInterior()` then re-tiers
 *      every blade by its distance from the mass centroid: the heart of a
 *      clump goes to TIER_BACK (near-black, buried), the outer silhouette
 *      keeps TIER_MID, and the chosen heroes stay TIER_LIT. Rolling tiers
 *      per leaf instead scatters dark blades evenly and reads as noise.
 *   5. **Value discipline** — the draw lays down the near-black interior
 *      mass first, the skeleton over it, then mid foliage, then lit rims and
 *      backlit heroes. The `LightRig` drives every grading decision.
 *
 * ## Everything is painted, nothing is filled
 *
 * Blades, stems and moss cushions go through `art/brush.ts`: a block-in of
 * crossing marks, aimed scumbles for the lit and shaded flanks, unifying
 * glazes, stroked venation, a rim, and `edgeVary` to decide which edges the
 * eye may lock onto. There is not a `ctx.fill()` of a leaf anywhere in this
 * file, because a filled path with a gradient over it is flat by construction
 * (docs/design/painted-rendering.md §1).
 *
 * Blades are painted ONCE per (shape, tone bucket, tier, light bucket) into
 * small offscreen canvases — the **leaf-stamp cache** — at ~2x their final
 * size, then instanced with `drawImage` transforms. Supersampling matters: a
 * brush mark has a physical size, and painted at a blade's true 30px the head
 * is a third of the blade and the silhouette dissolves. Baking the *light
 * direction* into the stamp matters too — one stamp reused at every angle
 * gives every blade its highlight on the same flank of itself, and a mass
 * with no agreement about where the sun is reads as a sheet of stickers.
 *
 * Three layers, in order:
 *
 *   1. **Plan**  `planFlora()` — pure math. Picks which anchors grow what, at
 *      what scale, and returns placements with honest world-space bounds.
 *      No canvas, no DOM: safe to run in a worker or a unit test.
 *   2. **Grow**  `growFlora()` — turns a placement into `FloraGeometry`
 *      (stems, leaf instances, blooms, threads) in anchor-local coords. Pure
 *      and DOM-free.
 *   3. **Draw**  `drawFlora()` / `renderFloraSprite()` / `bakeFloraLayer()` —
 *      rendering of that geometry, once, into a sprite.
 *
 * ## Generated cut-outs
 *
 * `registerFloraAtoms()` + `setFloraAtomMode()` let the painted blades be
 * replaced or supplemented by the transparent foliage cut-outs in
 * `assets/atoms/`, re-lit into the scene's palette and depth tiers. Default
 * `off` — see the note on `ATOM_FAMILIES` for which families are usable and
 * why most are not.
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
  hsl,
  leafAxis,
  leafBoundRadius,
  leafOutline,
  leafVeins,
  traceSmooth,
  traceTapered,
  type LeafGeometryOptions,
  type LeafShape,
  type Pt,
} from './leaves';
import {
  PRESSURE,
  blockIn,
  brush,
  clipToMask,
  createSurface,
  dab,
  edgeVary,
  getPaintQuality,
  drawSurface,
  glaze,
  hslToRgb,
  parseColour,
  scumble,
  setPaintQuality,
  stroke,
  surfaceToImageData,
  type Hsl,
  type Surface,
  type Vec2,
} from './brush';
import { bakeCached } from './bake';
import { blowOut, keyToSource, rgbaToCss, type LightRig } from './lighting';
import { getGranulationTile, type Canvas2D, type Ctx2D } from './spines';

/** Bump when the growth model or drawing changes — invalidates baked sprites. */
export const FLORA_RECIPE_VERSION = 6;

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
 * One stem: the skeleton everything else hangs from. `pts` runs base → tip;
 * `widths` tapers from woody base to fresh tip — thick and directional at the
 * grip, a hair at the growing point. Drawn as a painted tapered ribbon and
 * deliberately left visible in the gaps between leaf clumps.
 */
export interface StemGeom {
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

/** @deprecated the growth model calls these stems now. */
export type VineGeom = StemGeom;

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
  /**
   * 0 = flat, up to ~0.55 = an older blade rolled over on itself. Carried on
   * the *instance* (not decided inside the stamp cache) so a plant can be
   * asked for "mostly fresh, a few tired" and the growth model owns that
   * ratio — curl is character, not a rendering detail.
   */
  curl: number;
  /** 0–1: how chewed the margin is. A canopy with no damage looks printed. */
  damage: number;
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

/**
 * Everything one specimen draws, in anchor-local coordinates.
 *
 * Flat arrays, not a tree. Flowers used to live inside a `clusters` structure
 * that owned its own pedicels; the renderer then had to flatten it twice per
 * tier and nothing else could see a bloom without knowing about clusters.
 * They are still *composed* as clusters by `growInflorescence` — a hero, mid
 * blooms and buds around one node, each on its own pedicel — the composition
 * just lands in the shared lists like every other part.
 */
export interface FloraGeometry {
  /** Woody skeleton: stems, side shoots, flower stalks. */
  stems: StemGeom[];
  leaves: LeafInstance[];
  /** Every flower and bud, already tiered. */
  blooms: BloomGeom[];
  /** Pedicels, tendrils, twine, silk — anything drawn as a line. */
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
  /** Chance a blade is old enough to have curled. Default 0.24. */
  curlChance?: number;
  /** Chance a blade's margin has been chewed. Default 0.16. */
  damageChance?: number;
  /**
   * Lift the whole specimen off its anchor by this many px at scale 1, along
   * the growth direction. Moss sits *on* a cushion, not on the plank.
   */
  lift?: number;
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
      // A grass blade is a *blade*. At 0.26 the stamp came out as wide as a
      // hosta leaf and a tuft read as a clump of green caterpillars.
      return 0.16;
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
        // Upright: rise steeply, then nod outward toward the fan side.
        //
        // The arc is an *absolute* offset off the base angle, never an
        // integration — an integrated gravity term compounds, and a frond
        // that gains a few degrees per step ends up lying on its side by the
        // tip, which is what turned a fern clump into a moustache. Capped at
        // ~29° of total turn so a frond nods, and only nods.
        const arc = (1 - (1 - t) * (1 - t)) * 0.5 * uprightSide;
        ang = baseAngle + arc + wob * (1 - t * 0.4);
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
  // Local list only so the packing test below can see its own siblings; every
  // bloom is pushed straight into the shared geometry as it is placed.
  const blooms: BloomGeom[] = [];

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
    gr.g.blooms.push(b);
    // Pedicel: node → bloom with a soft outward bow.
    const mx = (node.x + px) / 2;
    const my = (node.y + py) / 2;
    const dx = px - node.x;
    const dy = py - node.y;
    const dist = Math.hypot(dx, dy) || 1;
    const bow = dist * rr(gr, 0.14, 0.3) * (gr.rnd() < 0.5 ? 1 : -1);
    gr.g.threads.push({
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
}

/**
 * Push one leaf instance, with per-leaf tone jitter, stamp pick, and the two
 * bits of *age* a blade carries: `curl` (a tired leaf rolling over on itself)
 * and `damage` (a chewed margin).
 *
 * Age is a minority state on purpose. A canopy where nothing is curled reads
 * as plastic; one where half of it is reads as dying. The recipe owns the
 * ratio (`curlChance` ≈ ¼) and the growth model — not the stamp cache — makes
 * the roll, so a specimen's mix of fresh and tired blades is part of its
 * geometry and survives into the tests.
 */
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
  const curlChance = rec.curlChance ?? 0.24;
  gr.g.leaves.push({
    x: o.x,
    y: o.y,
    angle: o.angle,
    len: o.len,
    width: o.len * shapeAspect(shape),
    shape,
    stamp: rri(gr, 0, STAMP_VARIANTS - 1),
    flip: gr.rnd() < 0.5,
    pale: (rec.pale ?? 0) > 0 && gr.rnd() < (rec.pale ?? 0),
    tone: t,
    tier: o.tier,
    curl: gr.rnd() < curlChance ? rr(gr, 0.14, 0.44) : 0,
    damage: gr.rnd() < (rec.damageChance ?? 0.16) ? rr(gr, 0.12, 0.4) : 0,
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

  gr.g.stems.push({
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
    // `lift` raises the whole specimen off the anchor along its growth
    // direction — moss creeps across the crown of its own cushion, so its
    // stems start above the plank, not on it.
    const lift = (rec.lift ?? 0) * gr.scale;
    const oy = (gr.rnd() * 2 - 1) * 2.5 * gr.scale - (gr.facing === 'down' ? -lift : lift);
    growVine(gr, rec, habit, ox, oy, angle, len, w, v, 0);
  }
}

/* --------------------------- species add-ons ----------------------------- */

/** Moss creeps; its body is a filled cushion under the creeping vines. */
function addMossMound(gr: Grow, rec: VineRecipe): void {
  const up = gr.facing === 'down' ? -1 : 1;
  // Wider than 36px and half as tall, a cushion stops being a dome and starts
  // being a smear of green along the plank.
  const rx = rr(gr, 22, 38) * gr.scale;
  gr.g.mounds.push({
    x: rr(gr, -4, 4) * gr.scale,
    y: 0,
    rx,
    ry: rx * rr(gr, 0.56, 0.74),
    up,
    tone: roleTone(gr, 'moss', rec.toneDelta),
    seed: (gr.rnd() * 0xffffffff) >>> 0,
  });
}

/**
 * The twine rig a herb bundle hangs from — the part that makes it read as a
 * *tied* object rather than as leaves floating under a shelf.
 *
 * Six threads minimum, and each one is doing a job:
 *   - **two hangers** rising from the wrap to the hook, slightly apart, so
 *     the bunch reads as suspended by a loop with real width;
 *   - **three wraps**, tightening down the neck of the bunch — a single wrap
 *     looks like a rubber band, three look like string turned round by hand;
 *   - **one tail**, the cut end of the twine, hanging free;
 *   - plus a tag string when the bundle is labelled.
 */
function addTwineAndTag(gr: Grow): void {
  const twine = roleColour(gr, 'twine');
  const wrapY = rr(gr, 7, 11) * gr.scale;
  const wrapW = rr(gr, 9, 13) * gr.scale;
  const wrapWidth = Math.max(0.7, 1.1 * gr.scale);

  // Three wraps, each a shade narrower as the neck tapers into the bunch.
  for (let k = 0; k < 3; k++) {
    const y = wrapY + k * 3.1 * gr.scale;
    const w = wrapW * (1 - k * 0.07);
    const pts: Pt[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * (i / 8);
      pts.push({ x: -Math.cos(a) * w, y: y + Math.sin(a) * 2.6 * gr.scale });
    }
    gr.g.threads.push({ pts, width: wrapWidth, alpha: 0.95, colour: twine });
  }

  // Two hangers up to the hook, meeting at the top.
  const hookY = -10 * gr.scale;
  for (const side of [-1, 1]) {
    gr.g.threads.push({
      pts: [
        { x: side * 0.6 * gr.scale, y: hookY },
        { x: side * 2.1 * gr.scale, y: hookY * 0.35 },
        { x: side * 1.1 * gr.scale, y: wrapY - 1 * gr.scale },
      ],
      width: Math.max(0.6, 0.9 * gr.scale),
      alpha: 0.9,
      colour: twine,
    });
  }

  // The cut tail of the knot, hanging loose off the last wrap.
  {
    const tailSide = gr.rnd() < 0.5 ? 1 : -1;
    const tailLen = rr(gr, 8, 15) * gr.scale;
    gr.g.threads.push({
      pts: [
        { x: tailSide * wrapW * 0.75, y: wrapY + 2 * gr.scale },
        { x: tailSide * wrapW * (0.95 + gr.rnd() * 0.3), y: wrapY + tailLen * 0.55 },
        { x: tailSide * wrapW * (0.6 + gr.rnd() * 0.5), y: wrapY + tailLen },
      ],
      width: Math.max(0.5, 0.75 * gr.scale),
      alpha: 0.85,
      colour: twine,
      taper: true,
    });
  }

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
      stamp: rri(gr, 0, STAMP_VARIANTS - 1),
      flip: gr.rnd() < 0.5,
      pale: dry,
      tone: {
        h: base.h + (gr.rnd() * 2 - 1) * v * 0.5,
        s: clamp(base.s + (gr.rnd() * 2 - 1) * 6, 0, 100),
        l: clamp(base.l + (gr.rnd() * 2 - 1) * 5, 0, 100),
      },
      tier,
      // Dry blades kink over; green ones stand.
      curl: dry ? rr(gr, 0.2, 0.5) : 0,
      damage: dry ? rr(gr, 0.1, 0.3) : 0,
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
    g.stems.push({
      pts,
      widths: pts.map((_, i) => Math.max(0.4, (1.1 - (i / segs) * 0.6) * gr.scale)),
      tone: stemTone,
      woody: 0,
      habit: 'upright',
    });
    const tip = pts[segs] as Pt;
    const clock = gr.rnd() < 0.55;
    const r = rr(gr, 5.5, 8.5) * gr.scale;
    g.blooms.push({
      x: tip.x,
      y: tip.y,
      r,
      kind: clock ? 'dandelion' : 'puff',
      open: 1,
      tone: clock ? roleTone(gr, 'bloomAlt') : tone(gr, 42, 22, 78),
      seed: (gr.rnd() * 0xffffffff) >>> 0,
      tier: TIER_LIT,
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
  // Ivy is its lobed silhouette. Mixing palmate in was an attempt at canopy
  // variety that only made the plant unidentifiable — variety in an ivy comes
  // from scale, curl and lobe count, not from a second blade shape.
  shapes: [['lobed', 1]],
  leafLen: [24, 42],
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
  backChance: 0.34,
  heroes: [2, 3],
  branches: 0.9,
  tendrils: 0.8,
  splay: [0.6, 1.1],
  curve: 0.24,
  // Variegation on two leaves in five, not on nearly every one: a plant whose
  // every blade is streaked pale has no dark left to be variegated against.
  pale: 0.22,
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
  toneDelta: [10, -18, 6],
};

const BLOSSOM: VineRecipe = {
  vines: [1, 2],
  // A flowering branch used to run to 200px while nothing else on the shelf
  // passed 130 — one plant then dominated every composition it landed in and
  // the shelf read as "a cherry tree with some books". Kept in the same size
  // class as its neighbours; the flowers do the work, not the reach.
  len: [80, 135],
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
    kinds: ['blossom', 'rosette', 'bell'],
    chance: 0.5,
    maxPerVine: 3,
    // A blossom on a shelf is 20-40px across in the reference, not 13. Small
    // flowers read as popcorn: they have no interior structure at that size,
    // so a cluster of them is a scatter of white dots.
    size: [10, 16],
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
  curlChance: 0.1,
  damageChance: 0.05,
  // Moss creeps over the top of its own cushion, not along the bare plank.
  lift: 9,
};

const FERN: VineRecipe = {
  vines: [5, 8],
  len: [60, 110],
  step: 10,
  width: [1.6, 2.2],
  woody: 0.2,
  habitUp: 'upright',
  habitDown: 'hang',
  // Pinnules, not needles. A fern painted with 0.2-aspect needles at 7-13px
  // gave every pinna a 2px width: the blades vanished, the rachis was the
  // only thing left, and a clump of fronds read as barbed wire. A real
  // pinnule is a deeply-cut blade with actual area.
  shapes: [
    ['pinnate', 0.7],
    ['needle', 0.3],
  ],
  leafLen: [14, 24],
  perNode: [2, 2],
  opposite: true,
  clumpRun: [8, 12],
  gapRun: [0, 1],
  backChance: 0.32,
  heroes: [1, 2],
  curlChance: 0.14,
  branches: 0,
  tendrils: 0,
  splay: [1.1, 1.5],
  curve: 0.14,
  role: 'leafDeep',
  toneDelta: [0, 0, 0],
};

const HERB: VineRecipe = {
  // A bundle is a *bunch*: four sprigs is the minimum that reads as tied
  // together rather than as a single sad twig on a string.
  vines: [4, 6],
  len: [48, 82],
  step: 9,
  width: [1.2, 1.8],
  woody: 0.35,
  habitUp: 'hang',
  habitDown: 'hang',
  shapes: [
    ['strap', 0.6],
    ['needle', 0.4],
  ],
  leafLen: [15, 26],
  curlChance: 0.4,
  damageChance: 0.35,
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
    // Undersides only. A bunch tied to a rail *top* has nothing to hang from
    // and grew upside down out of the plank.
    anchors: ['shelfUnderside'],
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
    stems: [],
    leaves: [],
    blooms: [],
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
  for (const v of g.stems) {
    for (let i = 0; i < v.pts.length; i++) {
      const p = v.pts[i] as Pt;
      hit(p.x, p.y, (v.widths[i] ?? 1) / 2 + 0.5);
    }
  }
  // A leaf is bounded by the circle that covers its whole blade from the
  // petiole — deliberately conservative (keep-out runs on these numbers).
  for (const l of g.leaves) hit(l.x, l.y, leafBoundRadius(l.len, l.width) + 0.5);
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
 * Push the *interior* of a foliage mass into shadow.
 *
 * Depth tiers were being rolled per leaf from a fixed probability, which
 * scatters dark leaves evenly through a mass — and an evenly-speckled mass has
 * no depth at all, it just looks noisy. A real canopy is organised in space:
 * the blades near the heart of the clump are buried under everything else and
 * go nearly black, the ones on the outside of the silhouette are the ones the
 * light can actually reach.
 *
 * So tiers are re-assigned by distance from the mass centroid. This is the
 * pass that stopped the shelf's planting reading as a pale-green glow sitting
 * *in front of* the case instead of growing out of it.
 *
 * Light-independent on purpose: geometry is memoized by placement, and making
 * it depend on the mutable light rig would silently serve stale specimens
 * after a theme change. Interior-is-dark is true whatever direction the sun
 * comes from.
 */
function shadeInterior(g: FloraGeometry): void {
  const leaves = g.leaves;
  if (leaves.length < 8) return;
  let cx = 0;
  let cy = 0;
  for (const l of leaves) {
    cx += l.x;
    cy += l.y;
  }
  cx /= leaves.length;
  cy /= leaves.length;
  let maxD = 1;
  for (const l of leaves) maxD = Math.max(maxD, Math.hypot(l.x - cx, l.y - cy));
  for (const l of leaves) {
    // Heroes were chosen deliberately; they keep their light.
    if (l.tier === TIER_LIT) continue;
    const d = Math.hypot(l.x - cx, l.y - cy) / maxD;
    if (d < 0.52) l.tier = TIER_BACK;
    else if (d > 0.84) l.tier = TIER_MID;
  }
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
  shadeInterior(g);
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

/** A tone pushed to a depth tier's value — the shared ladder, for non-leaves. */
function tierTone(t: Tone, tier: FloraTier): Tone {
  const v = TIER_VALUE[tier];
  return { h: t.h, s: clamp(t.s * v.s, 0, 100), l: clamp(t.l * v.l, 0, 100) };
}

/**
 * Paint one stem as a tapering woody ribbon with real cylindrical form.
 *
 * The stem is the thing that makes a plant read as *grown* rather than
 * assembled: it has a direction, it is thick where it grips and a hair where
 * it is still growing, and its light wraps around a cylinder. So it gets the
 * full treatment rather than a stroked path — block-in along the run, a dark
 * flank away from the key, a lit core on the key side, bark striations on the
 * thick ones, and a hairline arris.
 *
 * Thin green shoots (under ~2px) skip the surface entirely and take the cheap
 * canvas ribbon: a two-pixel-wide stem has no interior to paint, and there
 * can be a hundred of them on one floor.
 */
function drawStemRibbon(ctx: Ctx2D, s: StemGeom, ink: string, light: FloraLight): void {
  const n = s.pts.length;
  if (n < 2) return;
  const tier = s.tier ?? TIER_MID;
  const maxW = Math.max(...s.widths);
  const t = tierTone(s.tone, tier);

  // Ribbon outline, as before: the two offset flanks of a variable-width path.
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = s.pts[Math.max(0, i - 1)] as Pt;
    const b = s.pts[Math.min(n - 1, i + 1)] as Pt;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const m = Math.hypot(dx, dy) || 1;
    const w = Math.max(0.45, (s.widths[i] ?? 1) / 2);
    const p = s.pts[i] as Pt;
    left.push({ x: p.x - (dy / m) * w, y: p.y + (dx / m) * w });
    right.push({ x: p.x + (dy / m) * w, y: p.y - (dx / m) * w });
  }
  const outline = left.concat([...right].reverse());

  if (maxW < 2.1 || tier === TIER_BACK) {
    // Cheap path: a filled ribbon with a single length gradient.
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
    ctx.strokeStyle = ink;
    ctx.globalAlpha = s.woody > 0.5 ? 0.45 : 0.3;
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Painted path. Surface covering the ribbon plus brush overshoot.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of outline) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = Math.ceil(Math.max(4, maxW * 0.9));
  const ox = -minX + pad;
  const oy = -minY + pad;
  const sw = Math.ceil(maxX - minX + pad * 2);
  const sh = Math.ceil(maxY - minY + pad * 2);
  if (sw < 3 || sh < 3 || sw * sh > 900000) return;
  const surface = createSurface(sw, sh);
  const shape: Vec2[] = outline.map((p) => ({ x: p.x + ox, y: p.y + oy }));
  const spine: Vec2[] = s.pts.map((p) => ({ x: p.x + ox, y: p.y + oy }));

  const first = spine[0] as Vec2;
  const last = spine[spine.length - 1] as Vec2;
  const runAngle = Math.atan2(last.y - first.y, last.x - first.x);
  const body: Hsl = { h: t.h, s: clamp(t.s / 100, 0, 1), l: clamp(t.l / 100, 0, 1) };

  const mask = blockIn(surface, shape, body, {
    direction: runAngle,
    brush: brush(s.woody > 0.5 ? 'chalk' : 'bristle', {
      size: Math.max(2.4, maxW * 0.62),
      opacity: 0.5,
      grain: s.woody > 0.5 ? 0.7 : 0.5,
      hardness: 0.55,
      spacing: 0.16,
      colour: body,
      jitter: { size: 0.24, opacity: 0.34, angle: 0.3, hue: 7, sat: 0.05, lum: 0.07, position: 0.4 },
    }),
    valueSpread: 0.13,
    hueSpread: 10,
    roughness: Math.max(0.25, maxW * 0.06),
    openness: 0.02,
    rowFactor: 0.38,
    feather: 0.85,
    edgeNoise: Math.max(0.2, maxW * 0.05),
    seed: (Math.round(first.x * 31 + first.y * 17) >>> 0) || 0x5111,
  });

  // Cylinder form: the away side falls off, the key side keeps a lit core.
  const lx = Math.cos(light.angle);
  const ly = Math.sin(light.angle);
  /** Signed distance across the stem, normalised to ±1 on the key axis. */
  const across = (x: number, y: number): number => {
    // Nearest spine sample, cheaply: project onto the overall run.
    const px = x - first.x;
    const py = y - first.y;
    const along = px * Math.cos(runAngle) + py * Math.sin(runAngle);
    const cxp = first.x + Math.cos(runAngle) * along;
    const cyp = first.y + Math.sin(runAngle) * along;
    return clamp(((x - cxp) * lx + (y - cyp) * ly) / Math.max(1, maxW * 0.55), -1, 1);
  };
  scumble(
    surface,
    mask,
    brush('bristle', {
      size: Math.max(2, maxW * 0.5),
      opacity: 0.2,
      grain: 0.55,
      colour: { h: t.h + 4, s: clamp((t.s - 6) / 100, 0, 1), l: clamp((t.l * 0.5) / 100, 0, 1) },
      angle: runAngle,
      jitter: { size: 0.35, opacity: 0.45, angle: 0.25, hue: 6, sat: 0.05, lum: 0.05, position: 0.6 },
    }),
    {
      coverage: 0.7,
      passes: 2,
      direction: runAngle,
      patchScale: Math.max(6, maxW * 3),
      targetBuildup: 0.6,
      weight: (x, y) => clamp(-across(x, y), 0, 1),
      seed: 0x5222,
    },
  );
  scumble(
    surface,
    mask,
    brush('flat', {
      size: Math.max(1.8, maxW * 0.34),
      opacity: 0.17,
      grain: 0.4,
      colour: { h: t.h - 4, s: clamp((t.s + 2) / 100, 0, 1), l: clamp((t.l + 15) / 100, 0, 1) },
      angle: runAngle,
      jitter: { size: 0.3, opacity: 0.4, angle: 0.2, hue: 5, sat: 0.05, lum: 0.05, position: 0.5 },
    }),
    {
      coverage: 0.5,
      passes: 1,
      direction: runAngle,
      patchScale: Math.max(6, maxW * 2.4),
      targetBuildup: 0.5,
      weight: (x, y) => Math.pow(clamp(across(x, y), 0, 1), 0.8),
      seed: 0x5333,
    },
  );

  // Bark: short striations parallel to the run, only where there is room.
  if (s.bark && maxW > 3) {
    const rnd = mulberry32((Math.round(first.x * 131 + first.y * 71) >>> 0) || 0x5444);
    const barkBrush = brush('blade', {
      size: Math.max(0.8, maxW * 0.1),
      opacity: 0.2,
      colour: { h: t.h + 6, s: clamp((t.s + 2) / 100, 0, 1), l: clamp((t.l * 0.62) / 100, 0, 1) },
      jitter: { size: 0.4, opacity: 0.5, angle: 0.15, hue: 5, sat: 0.04, lum: 0.05, position: 0.4 },
    });
    for (let k = 0; k < 7; k++) {
      const i0 = Math.floor(rnd() * Math.max(1, spine.length - 3));
      const i1 = Math.min(spine.length - 1, i0 + 2 + Math.floor(rnd() * 4));
      const off = (rnd() * 2 - 1) * maxW * 0.3;
      const seg: Vec2[] = [];
      for (let i = i0; i <= i1; i++) {
        const p = spine[i] as Vec2;
        const a = spine[Math.max(0, i - 1)] as Vec2;
        const b = spine[Math.min(spine.length - 1, i + 1)] as Vec2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const m = Math.hypot(dx, dy) || 1;
        seg.push({ x: p.x - (dy / m) * off, y: p.y + (dx / m) * off });
      }
      if (seg.length > 2) {
        stroke(surface, seg, barkBrush, { passes: 1, taper: 0.4, alpha: 0.5, seed: (k * 977) >>> 0 });
      }
    }
  }

  clipToMask(surface, mask, {
    feather: 0.9,
    noise: Math.max(0.2, maxW * 0.05),
    noiseScale: Math.max(5, maxW * 2.5),
    seed: 0x5555,
  });

  // The arris: one hairline of key colour down the lit side of the cylinder.
  if (light.strength > 0.02 && maxW > 2.4) {
    const litFlank = ly < 0 ? right : left;
    const flank: Vec2[] = litFlank.map((p) => ({ x: p.x + ox, y: p.y + oy }));
    stroke(
      surface,
      flank,
      brush('ink', {
        size: Math.max(0.8, Math.min(2.4, maxW * 0.2)),
        opacity: 0.3,
        hardness: 0.75,
        colour: light.rim,
        jitter: { size: 0.4, opacity: 0.55, angle: 0.2, hue: 5, sat: 0.05, lum: 0.05, position: 0.5 },
      }),
      {
        passes: 1,
        taper: [0.2, 0.6],
        alpha: 0.5 * light.strength * (tier === TIER_LIT ? 1 : 0.7),
        seed: 0x5666,
      },
    );
  }

  edgeVary(surface, shape, {
    crisp: 0.34,
    lost: 0.24,
    band: clamp(maxW * 0.28, 1.2, 3),
    frequency: 0.5,
    accent: ink,
    accentStrength: s.woody > 0.5 ? 0.4 : 0.28,
    lightAngle: light.angle,
    softness: clamp(maxW * 0.24, 1.2, 3),
    seed: 0x5777,
  });

  drawSurface(ctx as CanvasRenderingContext2D, surface, -ox, -oy);
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
 * The filled body of a cushion (moss), painted rather than filled.
 *
 * Moss exposed the limits of the old fill-and-gradient approach most
 * brutally: a gradient-washed dome with a few dots on it reads as a green
 * bread roll, which is exactly what it looked like. Real cushion moss is a
 * *velvet* — a mass with no hard edge anywhere, thousands of tiny shoots
 * catching light along the crest and going near-black in the hollows.
 *
 * So: a sponge block-in for the body, two aimed scumbles for crest and skirt,
 * then a scatter of sponge dabs deliberately stamped *past* the silhouette so
 * the boundary is a fuzz of shoots rather than a line. There is no final clip
 * — losing the outline is the entire point of the pass.
 */
function drawMound(ctx: Ctx2D, m: MoundGeom, ink: string, light: FloraLight): void {
  if (m.rx <= 0 || m.ry <= 0) return;
  const tier = m.tier ?? TIER_MID;
  const dl = tier === TIER_BACK ? -14 : tier === TIER_LIT ? 4 : 0;
  const rnd = mulberry32(m.seed >>> 0);
  const lx = Math.cos(light.angle);
  const ly = Math.sin(light.angle);

  // Surface: the dome plus room for the fuzz to spill past it.
  const fuzz = Math.max(3, m.ry * 0.45);
  const pad = Math.ceil(fuzz + 4);
  const sw = Math.ceil(m.rx * 2 + pad * 2);
  const sh = Math.ceil(m.ry * 1.35 + pad * 2);
  const ox = pad + m.rx; // surface x of the mound centre
  const oy = m.up > 0 ? sh - pad : pad; // surface y of the ground line
  const surface = createSurface(sw, sh);

  // The dome outline: a lumpy half-ellipse standing on the ground line.
  const steps = 34;
  const dome: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const a = Math.PI * u;
    const bump =
      1 + 0.14 * Math.sin(u * Math.PI * 2.7 + m.seed * 0.001) + 0.09 * Math.sin(u * Math.PI * 5.3 + 1.7);
    dome.push({
      x: ox - Math.cos(a) * m.rx * (0.97 + 0.06 * Math.sin(u * Math.PI * 3.1)),
      y: oy - m.up * Math.sin(a) * m.ry * bump,
    });
  }
  dome.push({ x: ox + m.rx, y: oy });
  dome.push({ x: ox - m.rx, y: oy });

  const body: Hsl = {
    h: m.tone.h,
    s: clamp(m.tone.s / 100, 0, 1),
    l: clamp((m.tone.l + dl) / 100, 0, 1),
  };
  const mask = blockIn(surface, dome, body, {
    brush: brush('sponge', {
      size: Math.max(4, m.ry * 0.42),
      opacity: 0.34,
      grain: 0.92,
      hardness: 0.36,
      spacing: 0.3,
      scatter: 0.3,
      colour: body,
      jitter: { size: 0.5, opacity: 0.5, angle: 0.9, hue: 11, sat: 0.08, lum: 0.1, position: m.ry * 0.1 },
    }),
    valueSpread: 0.16,
    hueSpread: 16,
    roughness: m.ry * 0.1,
    openness: 0.06,
    rowFactor: 0.45,
    feather: 2,
    edgeNoise: m.ry * 0.1,
    seed: (m.seed ^ 0x4d05) >>> 0,
  });

  const crestY = oy - m.up * m.ry;
  if (tier !== TIER_BACK) {
    // Lit crest: a warmer, paler green on the key side of the dome's top.
    scumble(
      surface,
      mask,
      brush('sponge', {
        size: Math.max(3, m.ry * 0.3),
        opacity: 0.2,
        grain: 0.9,
        colour: {
          h: m.tone.h - 6,
          s: clamp((m.tone.s - 6) / 100, 0, 1),
          l: clamp((m.tone.l + 17 + dl) / 100, 0, 1),
        },
        jitter: { size: 0.55, opacity: 0.5, angle: 1, hue: 9, sat: 0.07, lum: 0.08, position: 1.4 },
      }),
      {
        coverage: 0.5,
        passes: 2,
        patchScale: Math.max(5, m.rx * 0.22),
        targetBuildup: 0.55,
        weight: (x, y) => {
          const nx = (x - ox) / Math.max(1, m.rx);
          const ny = (y - crestY) / Math.max(1, m.ry);
          const face = clamp(nx * lx - ny * ly * m.up * 0.6, -1, 1);
          const height = clamp(1 - Math.abs(y - crestY) / Math.max(1, m.ry * 1.1), 0, 1);
          return clamp(face * 0.55 + 0.2, 0, 1) * (0.3 + 0.7 * height);
        },
        seed: (m.seed ^ 0x5e16) >>> 0,
      },
    );
  }
  // Skirt: the cushion goes nearly black where it meets the wood.
  scumble(
    surface,
    mask,
    brush('sponge', {
      size: Math.max(3, m.ry * 0.34),
      opacity: 0.24,
      grain: 0.85,
      colour: {
        h: m.tone.h + 6,
        s: clamp((m.tone.s - 4) / 100, 0, 1),
        l: clamp((m.tone.l * 0.42 + dl) / 100, 0, 1),
      },
      jitter: { size: 0.5, opacity: 0.5, angle: 1, hue: 7, sat: 0.06, lum: 0.05, position: 1.2 },
    }),
    {
      coverage: 0.6,
      passes: 2,
      patchScale: Math.max(5, m.rx * 0.2),
      targetBuildup: 0.6,
      weight: (_x, y) => {
        const d = (y - oy) * -m.up; // 0 at the ground line, grows into the dome
        return clamp(1 - d / Math.max(1, m.ry * 0.75), 0, 1);
      },
      seed: (m.seed ^ 0x6f27) >>> 0,
    },
  );

  // The velvet boundary: individual shoots stamped along the crest, half of
  // them outside the silhouette. This is what a cushion's edge actually is.
  const shoots = Math.round(clamp(m.rx * 1.1, 20, 160));
  const shootBrush = brush('sponge', {
    size: Math.max(2, m.ry * 0.2),
    opacity: 0.5,
    grain: 0.95,
    hardness: 0.5,
    colour: body,
    jitter: { size: 0.6, opacity: 0.5, angle: 1.2, hue: 12, sat: 0.09, lum: 0.12, position: 0 },
  });
  for (let i = 0; i < shoots; i++) {
    const u = rnd();
    const a = Math.PI * u;
    const bump = 1 + 0.14 * Math.sin(u * Math.PI * 2.7) + 0.09 * Math.sin(u * Math.PI * 5.3 + 1.7);
    const out = rnd() * fuzz * 0.9;
    const dx = -Math.cos(a) * (m.rx + out * 0.6);
    const dy = -m.up * (Math.sin(a) * m.ry * bump + out);
    const face = clamp((dx / Math.max(1, m.rx)) * lx - (dy / Math.max(1, m.ry)) * ly, -1, 1);
    dab(surface, ox + dx, oy + dy, shootBrush, {
      size: Math.max(1.6, m.ry * (0.12 + rnd() * 0.16)),
      opacity: (0.28 + rnd() * 0.3) * (1 - (out / (fuzz + 1)) * 0.55),
      colour: {
        h: m.tone.h + (rnd() * 2 - 1) * 10,
        s: clamp((m.tone.s + (rnd() * 2 - 1) * 8) / 100, 0, 1),
        l: clamp((m.tone.l + dl + face * 13 + (rnd() * 2 - 1) * 6) / 100, 0, 1),
      },
    });
  }

  // Rim along the lit crest — one thin note of key colour, nothing more.
  if (tier !== TIER_BACK && light.strength > 0.02) {
    const arcPts: Vec2[] = [];
    const a0 = lx >= 0 ? 0.44 : 0.06;
    for (let i = 0; i <= 12; i++) {
      const u = a0 + (i / 12) * 0.5;
      const a = Math.PI * u;
      arcPts.push({ x: ox - Math.cos(a) * m.rx * 0.94, y: oy - m.up * Math.sin(a) * m.ry * 0.96 });
    }
    stroke(
      surface,
      arcPts,
      brush('soft', {
        size: Math.max(1.6, m.ry * 0.16),
        opacity: 0.13,
        hardness: 0.35,
        colour: light.rim,
        jitter: { size: 0.4, opacity: 0.5, angle: 0.3, hue: 5, sat: 0.05, lum: 0.05, position: 0.8 },
      }),
      {
        passes: 1,
        taper: 0.4,
        alpha: 0.55 * light.strength,
        seed: (m.seed ^ 0x7038) >>> 0,
      },
    );
  }

  drawSurface(ctx as CanvasRenderingContext2D, surface, m.x - ox, m.y - oy);
  void ink;
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
  // Values a stop below where they started: a pot lit as brightly as the key
  // itself becomes the brightest object on the shelf and steals the eye from
  // the plant growing out of it — the brass one read as a gold balloon.
  const ramp: Record<PotGeom['kind'], [string, string, string]> = {
    terracotta: ['#a8492c', '#c96a44', '#5e2412'],
    brass: ['#9c7526', '#c99f47', '#5a3f0c'],
    enamel: ['#237986', '#3f9ba8', '#0e4a54'],
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
/**
 * Native blade length per tier. Heroes are painted big so they stay crisp
 * when the light hits them; the silhouette tier is painted small because
 * nothing in it is ever legible as an individual leaf.
 */
const STAMP_NATIVE: Record<FloraTier, number> = {
  [TIER_BACK]: 30,
  [TIER_MID]: 46,
  [TIER_LIT]: 68,
};

/**
 * Supersample factor for painting a stamp.
 *
 * A brush mark has a physical size. Painted at a blade's true 30px the head
 * is a third of the blade wide, the silhouette dissolves and a leaf reads as
 * a ball of moss — which is exactly what the first pass produced. Painted at
 * 2.4x and blitted down, the same marks land at a believable scale *and* the
 * downscale does the antialiasing for free, so the edge comes back.
 */
const STAMP_SUPERSAMPLE = 1.9;

const STAMP_VARIANTS = 3;

/**
 * How many directions of key light a blade is painted for.
 *
 * The light is baked *into* the stamp, so a stamp is only correct for leaves
 * pointing a particular way. Painting one stamp and reusing it at every angle
 * is what made the old foliage read as a sheet of stickers: every blade
 * carried its highlight on the same flank of *itself*, so the mass had no
 * agreement about where the sun was. Six buckets is enough that the error
 * never exceeds 45°, which is below the threshold at which a highlight on a
 * 30px blade reads as being on the wrong side — and four is as far as the
 * budget stretches, since every bucket multiplies the stamp cache.
 */
const LIGHT_BUCKETS = 4;

/**
 * The value ladder. This is the single most important table in the file.
 *
 * The reference painting's foliage is not "green at three opacities" — it is
 * a near-black mass, an ordinary mid-green body, and a handful of blades that
 * have actually been *hit* by light. Our old tiers spanned about 12 points of
 * lightness in total and the result read as one flat green no matter how much
 * per-leaf detail went in underneath.
 */
const TIER_VALUE: Record<FloraTier, { l: number; s: number }> = {
  // Silhouette. 0.44 of the body value puts a 34%-lightness leaf at 15% —
  // dark enough to read as a hole in the mass, not so dark it punches a
  // literal black blob through a warm painting.
  [TIER_BACK]: { l: 0.42, s: 0.78 },
  [TIER_MID]: { l: 0.86, s: 1 },
  [TIER_LIT]: { l: 1.12, s: 1.05 },
};

interface LeafStamp {
  c: Canvas2D;
  /** Petiole (attachment) point inside the stamp canvas. */
  px: number;
  py: number;
  /** Native blade length the stamp was painted at. */
  len: number;
}

const stampCache = new Map<string, LeafStamp[]>();
const STAMP_CACHE_CAP = 420;

/** Tone → the brush engine's colour form, with a tier's value applied. */
function tierColour(t: Tone, tier: FloraTier, dl = 0, ds = 0, dh = 0): Hsl {
  const v = TIER_VALUE[tier];
  return {
    h: t.h + dh,
    s: clamp((t.s * v.s + ds) / 100, 0, 1),
    l: clamp((t.l * v.l + dl) / 100, 0, 1),
  };
}

/* ---------------------- the painted blade (brush.ts) ---------------------- */

interface BladeSpec {
  shape: LeafShape;
  len: number;
  width: number;
  bend: number;
  curl: number;
  damage: number;
  tone: Tone;
  tier: FloraTier;
  pale: boolean;
  ink: string;
  light: FloraLight;
  /** Key direction in **blade-local** radians (blade runs along +x). */
  keyAngle: number;
  seed: number;
}

/**
 * Paint one blade into its own surface with the brush engine.
 *
 * There is not a single `fill()` in here, and that is the point
 * (docs/design/painted-rendering.md §1): a filled path with a gradient over it
 * is flat by construction, and no amount of vein detail rescues it. What the
 * eye reads as "painted" is *broken colour* — a mass laid down with crossing
 * marks whose value and hue wander, edges that are crisp in one place and lost
 * in another, and a lit side built by dragging a lighter colour over a darker
 * one so the under-layer keeps showing through.
 *
 * The passes, in order:
 *
 *   1. **block-in** — the mass, in crossing chalk strokes, silhouette roughened;
 *   2. **shadow scumble** — a cooler, darker colour dragged across the flank
 *      facing away from the key, weighted by the local light term;
 *   3. **lit scumble** — a warmer, lighter colour on the key flank, biased
 *      toward the tip (the part of a blade that actually catches sun);
 *   4. **glazes** — one cool multiply in the shadow, one warm pass in the
 *      light, which is what makes a hundred separately-painted leaves agree
 *      they are in the same room;
 *   5. **venation** — a dark midrib with a pale halo either side, then
 *      secondaries, all as tapered strokes;
 *   6. **variegation** — pale patches for pothos and friends;
 *   7. **rim** — a hairline of key colour along the lit margin, then the whole
 *      surface re-clipped so nothing haloes outside the blade;
 *   8. **edge variation** — a handful of crisp edges, the rest dissolved.
 *
 * The silhouette tier stops after pass 1: it is a shape, not a leaf, and
 * every pass after the block-in only costs contrast and time.
 */
function paintBlade(spec: BladeSpec): { surface: Surface; px: number; py: number } {
  const { shape, len, width, tier, tone: t0, light } = spec;
  const back = tier === TIER_BACK;
  const lit = tier === TIER_LIT;
  const rnd = mulberry32(spec.seed >>> 0);
  // A strap or a needle is nearly all edge. Roughening a silhouette that is
  // 12px across by a fixed fraction of its *width* scallops it into a
  // bottlebrush, and the interior passes have nowhere to land — so narrow
  // blades get a quieter treatment across the board.
  const narrow = width < 26;

  const geo: LeafGeometryOptions = {
    shape,
    len,
    width,
    bend: spec.bend,
    curl: spec.curl,
    damage: spec.damage,
    jitter: clamp(len * 0.02, 0.15, 0.7),
    seed: spec.seed,
    steps: len > 34 ? 26 : len > 16 ? 20 : 14,
    lobes: shape === 'palmate' ? 2.5 : undefined,
  };
  const outline = leafOutline(geo);

  // Surface big enough for the blade plus the brush overshoot at its edges.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of outline) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = Math.max(5, width * 0.16);
  const px = -minX + pad;
  const py = -minY + pad;
  const sw = Math.ceil(maxX - minX + pad * 2);
  const sh = Math.ceil(maxY - minY + pad * 2);
  const surface = createSurface(sw, sh);

  const shape2: Vec2[] = outline.map((p) => ({ x: p.x + px, y: p.y + py }));
  const axis: Vec2[] = leafAxis(geo).map((p) => ({ x: p.x + px, y: p.y + py }));

  // Light term in blade-local space: +1 on the flank facing the key.
  const lx = Math.cos(spec.keyAngle);
  const ly = Math.sin(spec.keyAngle);
  const cx = px + len * 0.45;
  const cy = py;
  const half = Math.max(2, width * 0.5);
  /** −1 (deep shade) … +1 (facing the key), per surface pixel. */
  const lightAt = (x: number, y: number): number =>
    clamp(((x - cx) * lx + (y - cy) * ly) / (half * 1.05), -1, 1);

  /* -- 1. block-in --------------------------------------------------------- */
  const body = tierColour(t0, tier);
  const mask = blockIn(surface, shape2, body, {
    direction: Math.atan2(spec.bend, len),
    // Head sized against the blade's *short* axis. A leaf has to survive as a
    // silhouette first and a texture second: at a quarter of the blade width
    // the marks are visible without eating the shape.
    brush: brush(back ? 'chalk' : 'chalk', {
      size: Math.max(3.5, width * (back ? 0.3 : 0.24)),
      opacity: back ? 0.6 : 0.5,
      grain: back ? 0.72 : 0.58,
      hardness: back ? 0.55 : 0.52,
      spacing: 0.17,
      colour: body,
      jitter: {
        size: 0.26,
        opacity: 0.34,
        angle: 0.45,
        hue: back ? 4 : 9,
        sat: 0.06,
        lum: back ? 0.035 : 0.075,
        position: Math.max(0.3, width * 0.018),
      },
    }),
    valueSpread: back ? 0.06 : 0.16,
    hueSpread: back ? 6 : 18,
    roughness: narrow ? Math.max(0.2, width * 0.006) : Math.max(0.3, width * 0.016),
    // Openness and row spacing decide whether you can see the marks at all.
    // Below ~0.35 rows every pixel gets so many overlapping stamps that the
    // jitter averages out and the blade turns into airbrush — which is what
    // the first inspection board showed: velvet, not paint.
    openness: back ? 0.02 : narrow ? 0.03 : 0.07,
    rowFactor: narrow ? 0.4 : 0.58,
    feather: 0.9,
    edgeNoise: narrow ? Math.max(0.15, width * 0.005) : Math.max(0.25, width * 0.014),
    seed: (spec.seed ^ 0x51a3) >>> 0,
  });

  if (back) {
    // Silhouette tier: a faint cool glaze to sink it, a whisper of the rim so
    // the mass still has a top edge, and out. Everything else is invisible at
    // this value and costs only time.
    glaze(surface, mask, light.fill, 0.09 * light.occlusion, {
      blend: 'multiply',
      mottle: 0.2,
      mottleScale: Math.max(8, len * 0.4),
      seed: (spec.seed ^ 0x2b17) >>> 0,
    });
    clipToMask(surface, mask, {
      feather: 1,
      noise: Math.max(0.25, width * 0.012),
      noiseScale: Math.max(5, len * 0.22),
      seed: (spec.seed ^ 0x66fa) >>> 0,
    });
    return { surface, px, py };
  }

  /* -- 2. shadow flank ----------------------------------------------------- */
  const shadeCol = tierColour(t0, tier, -13, -3, -6);
  scumble(
    surface,
    mask,
    brush('bristle', {
      size: Math.max(3, width * 0.3),
      opacity: 0.2,
      grain: 0.55,
      colour: shadeCol,
      jitter: { size: 0.4, opacity: 0.45, angle: 0.6, hue: 7, sat: 0.05, lum: 0.05, position: 1 },
    }),
    {
      coverage: 0.62,
      passes: 2,
      patchScale: Math.max(6, len * 0.28),
      targetBuildup: 0.62,
      direction: Math.atan2(spec.bend, len),
      // Deepest at the petiole end of the shaded flank: a blade is darkest
      // where it tucks back under the mass it grew out of.
      weight: (x, y) => {
        const s = clamp(-lightAt(x, y), 0, 1);
        const along = clamp(1.12 - (x - px) / Math.max(1, len), 0, 1);
        return s * (0.45 + 0.55 * along);
      },
      seed: (spec.seed ^ 0x77c1) >>> 0,
    },
  );

  /* -- 3. lit flank -------------------------------------------------------- */
  const litCol = tierColour(t0, tier, lit ? 19 : 13, lit ? 2 : -1, lit ? 5 : 3);
  scumble(
    surface,
    mask,
    brush('flat', {
      size: Math.max(3, width * 0.26),
      opacity: 0.17,
      grain: 0.42,
      colour: litCol,
      angle: Math.atan2(spec.bend, len),
      jitter: { size: 0.35, opacity: 0.4, angle: 0.35, hue: 6, sat: 0.05, lum: 0.06, position: 0.9 },
    }),
    {
      coverage: lit ? 0.58 : 0.34,
      passes: 2,
      patchScale: Math.max(5, len * 0.22),
      targetBuildup: lit ? 0.6 : 0.36,
      direction: Math.atan2(spec.bend, len),
      weight: (x, y) => {
        const s = clamp(lightAt(x, y), 0, 1);
        const along = clamp((x - px) / Math.max(1, len), 0, 1);
        return Math.pow(s, 0.8) * (0.35 + 0.65 * along);
      },
      seed: (spec.seed ^ 0x1f5d) >>> 0,
    },
  );

  /* -- 4. unifying glazes -------------------------------------------------- */
  glaze(surface, mask, light.fill, 0.16 * light.occlusion, {
    blend: 'multiply',
    mottle: 0.24,
    mottleScale: Math.max(7, len * 0.35),
    gradient: (x, y) => clamp(-lightAt(x, y) * 0.9 + 0.12, 0, 1),
    seed: (spec.seed ^ 0x3ae9) >>> 0,
  });
  if (lit) {
    // Sun through the blade: a warm pass near the tip, on the key side only.
    glaze(surface, mask, light.key, 0.22 * light.strength, {
      blend: 'softlight',
      mottle: 0.3,
      mottleScale: Math.max(6, len * 0.3),
      gradient: (x, y) =>
        clamp(lightAt(x, y) * 0.7 + 0.3, 0, 1) * clamp((x - px) / Math.max(1, len * 0.9), 0, 1),
      seed: (spec.seed ^ 0x60b4) >>> 0,
    });
  }

  /* -- 5. venation --------------------------------------------------------- */
  if (len >= 17 && shape !== 'needle' && shape !== 'round') {
    const veinDark = tierColour(t0, tier, -16, 4, -4);
    const veinPale = tierColour(t0, tier, lit ? 24 : 17, -6, 4);
    // Pale halo first, then the dark rib over its centre — a rib drawn as one
    // dark line reads as a scratch; real venation is a valley with lit sides.
    stroke(surface, axis, brush('soft', {
      size: Math.max(1.6, width * 0.11),
      opacity: 0.1,
      hardness: 0.3,
      colour: veinPale,
      jitter: { size: 0.2, opacity: 0.3, angle: 0.2, hue: 4, sat: 0.03, lum: 0.05, position: 0.5 },
    }), {
      passes: 1,
      taper: [0.06, 0.55],
      alpha: 0.7,
      seed: (spec.seed ^ 0x11ab) >>> 0,
    });
    stroke(surface, axis, brush('blade', {
      size: Math.max(1, width * 0.05),
      opacity: 0.3,
      colour: veinDark,
      jitter: { size: 0.25, opacity: 0.35, angle: 0.15, hue: 4, sat: 0.03, lum: 0.04, position: 0.3 },
    }), {
      passes: 1,
      taper: [0.05, 0.75],
      alpha: 0.75,
      seed: (spec.seed ^ 0x22bc) >>> 0,
    });
    const secondaries = len > 40 ? 4 : len > 26 ? 3 : 2;
    const vb = brush('blade', {
      size: Math.max(0.9, width * 0.035),
      opacity: 0.22,
      colour: veinDark,
      jitter: { size: 0.3, opacity: 0.4, angle: 0.2, hue: 4, sat: 0.03, lum: 0.04, position: 0.4 },
    });
    for (const v of leafVeins(geo, secondaries)) {
      stroke(surface, v.map((p) => ({ x: p.x + px, y: p.y + py })), vb, {
        passes: 1,
        taper: [0.1, 0.8],
        alpha: 0.55,
        seed: (spec.seed ^ (0x33cd + v.length * 977)) >>> 0,
      });
    }
  }

  /* -- 6. variegation ------------------------------------------------------ */
  if (spec.pale) {
    scumble(
      surface,
      mask,
      brush('sponge', {
        size: Math.max(3, width * 0.28),
        opacity: 0.26,
        grain: 0.7,
        colour: tierColour(t0, tier, 15, -14, 6),
        jitter: { size: 0.5, opacity: 0.4, angle: 0.7, hue: 8, sat: 0.05, lum: 0.04, position: 1.2 },
      }),
      {
        coverage: 0.26,
        passes: 1,
        patchScale: Math.max(4, len * 0.2),
        targetBuildup: 0.5,
        threshold: 0.62,
        seed: (spec.seed ^ 0x44de) >>> 0,
      },
    );
  }

  /* -- 7. rim light -------------------------------------------------------- */
  if (light.strength > 0.02) {
    // The lit margin is whichever half of the outline the key vector points
    // into. `outline` runs petiole → tip along the +normal flank, then back.
    const halfN = Math.floor(shape2.length / 2);
    const litNear = ly > 0;
    const edge = litNear ? shape2.slice(0, halfN) : shape2.slice(halfN);
    const a0 = Math.floor(edge.length * 0.16);
    const a1 = Math.floor(edge.length * 0.9);
    const seg = edge.slice(a0, a1);
    if (seg.length > 3) {
      // Two strokes: a soft wide halo just inside the margin so the edge
      // glows, then a thin hot core on top. One thin line alone disappeared
      // the moment the stamp was blitted down to shelf scale — which is
      // exactly what happened, and the rim light was the whole point.
      stroke(surface, seg, brush('soft', {
        // Tight. At a fifth of the blade width this halo washed a pale slash
        // clear across the leaf *face*, which reads as damage, not as light.
        size: clamp(width * 0.1, 1.6, 4.5),
        opacity: 0.11,
        hardness: 0.42,
        colour: light.rim,
        jitter: { size: 0.3, opacity: 0.5, angle: 0.2, hue: 5, sat: 0.05, lum: 0.05, position: 0.4 },
      }), {
        passes: 1,
        taper: [0.3, 0.35],
        pressure: PRESSURE.arc,
        alpha: (lit ? 0.9 : 0.34) * light.strength,
        seed: (spec.seed ^ 0x54ee) >>> 0,
      });
      stroke(surface, seg, brush('ink', {
        size: clamp(width * 0.05, 1, 2.6),
        opacity: 0.6,
        hardness: 0.88,
        colour: light.rim,
        jitter: { size: 0.35, opacity: 0.45, angle: 0.2, hue: 5, sat: 0.06, lum: 0.05, position: 0.35 },
      }), {
        passes: 1,
        taper: [0.35, 0.4],
        pressure: PRESSURE.arc,
        // The mid tier is the *body* of the mass. Rim-lighting all of it
        // strongly is how a canopy ends up looking frosted: only the blades
        // actually standing proud of the silhouette should catch the key.
        alpha: (lit ? 1 : 0.34) * light.strength,
        seed: (spec.seed ^ 0x55ef) >>> 0,
      });
    }
    // A hot specular catch on the heroes only — the brightest note on the plant.
    if (lit) {
      const sx = px + len * 0.5 + lx * half * 0.42;
      const sy = py + spec.bend * 0.4 + ly * half * 0.42;
      dab(surface, sx, sy, brush('soft', {
        size: Math.max(3, len * 0.2),
        opacity: 0.16 * light.strength,
        hardness: 0.22,
        colour: light.rim,
        jitter: { size: 0, opacity: 0, angle: 0, hue: 0, sat: 0, lum: 0, position: 0 },
      }));
    }
  }

  // Everything since the block-in was free to spill; pull it all back inside
  // the silhouette, with a noisy boundary so the edge is never a vector path.
  clipToMask(surface, mask, {
    feather: 0.95,
    noise: Math.max(0.25, width * 0.012),
    noiseScale: Math.max(5, len * 0.22),
    seed: (spec.seed ^ 0x66fa) >>> 0,
  });

  /* -- 8. edge variation --------------------------------------------------- */
  edgeVary(surface, shape2, {
    // Crisp where the light hits, lost in the shade — the reference painting's
    // leaves have maybe two hard edges each and the rest melt into the mass.
    //
    // `lost` is the dangerous knob at this size. At 0.42 nearly half of a
    // 30px blade's outline dissolved and the leaf stopped being a leaf; the
    // treated band has to stay a small fraction of the short axis too.
    crisp: lit ? 0.4 : 0.3,
    lost: lit ? 0.2 : 0.24,
    band: clamp(width * 0.05, 1.2, 3.2),
    frequency: 0.7,
    accent: tierColour(t0, tier, -20, 6, -8),
    accentStrength: lit ? 0.45 : 0.34,
    lightAngle: spec.keyAngle,
    softness: clamp(width * 0.05, 1.2, 3),
    seed: (spec.seed ^ 0x77ab) >>> 0,
  });

  void rnd;
  return { surface, px, py };
}

/** Blade-local key direction for a leaf pointing `worldAngle`, bucketed. */
function lightBucket(worldAngle: number, flip: boolean, light: FloraLight): number {
  // A flipped stamp is mirrored across its own axis at draw time, so the light
  // has to be mirrored with it or half the plant lights from the wrong side.
  const local = (light.angle - worldAngle) * (flip ? -1 : 1);
  const norm = ((local % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.round((norm / (Math.PI * 2)) * LIGHT_BUCKETS) % LIGHT_BUCKETS;
}

/** Build (or fetch) the stamp set for one (shape, pale, tier, tone, key). */
function leafStamps(
  shape: LeafShape,
  pale: boolean,
  tier: FloraTier,
  tone0: Tone,
  ink: string,
  light: FloraLight,
  bucket: number,
): LeafStamp[] {
  // Quantize the tone so per-leaf jitter doesn't fragment the cache: leaves
  // within ~7°/9%/9% of each other share stamps, and the variants, the light
  // buckets and the instance transforms supply the visible variety.
  const q = (v: number, step: number): number => Math.round(v / step);
  const key = [
    shape,
    pale ? 1 : 0,
    tier,
    q(tone0.h, 7),
    q(tone0.s, 9),
    q(tone0.l, 9),
    bucket,
    ink,
    light.rim,
    light.strength.toFixed(2),
  ].join('|');
  const hit = stampCache.get(key);
  if (hit) return hit;

  const len = STAMP_NATIVE[tier] * STAMP_SUPERSAMPLE;
  const width = Math.max(3, len * shapeAspect(shape));
  const keyAngle = (bucket / LIGHT_BUCKETS) * Math.PI * 2;
  const rnd = mulberry32(fnv1a(key));
  const stamps: LeafStamp[] = [];
  // Stamps are painted supersampled and blitted down, so the finest half of
  // the texture the brush engine would lay is thrown away by the downscale
  // anyway. Halving the stamp budget for this stretch buys most of the bake
  // time back and costs nothing you can see. Values are preserved — the
  // engine raises per-stamp opacity to compensate.
  const q0 = getPaintQuality();
  setPaintQuality(q0 * 0.5);
  for (let v = 0; v < STAMP_VARIANTS; v++) {
    const painted = paintBlade({
      shape,
      len,
      width,
      bend: (rnd() * 2 - 1) * len * 0.15,
      // The instance carries curl/damage as *character*; the variants only
      // need enough spread that four blades in a row are not the same blade.
      curl: 0,
      damage: rnd() < 0.3 ? 0.12 + rnd() * 0.28 : 0,
      tone: tone0,
      tier,
      pale,
      ink,
      light,
      keyAngle,
      seed: (rnd() * 0xffffffff) >>> 0,
    });
    const c = makeCanvas(painted.surface.width, painted.surface.height);
    const ctx = get2d(c);
    ctx.putImageData(surfaceToImageData(painted.surface), 0, 0);
    stamps.push({ c, px: painted.px, py: painted.py, len });
  }
  setPaintQuality(q0);
  if (stampCache.size > STAMP_CACHE_CAP) stampCache.clear();
  stampCache.set(key, stamps);
  return stamps;
}

/**
 * Instance one leaf: a single transformed blit from the stamp cache.
 *
 * `curl` is applied here rather than baked, as a lateral squash of the blit —
 * a rolled leaf presents a narrower silhouette to the viewer, which is exactly
 * a scale on the blade's short axis, and doing it at instance time means one
 * cached stamp serves both the fresh and the tired version of a blade.
 */
function drawLeafInstance(ctx: Ctx2D, l: LeafInstance, ink: string, light: FloraLight): void {
  const bucket = lightBucket(l.angle, l.flip, light);
  const atom = atomFor(l);
  const s = atom
    ? atomStamp(atom, l.tone, l.tier, light, bucket)
    : (leafStamps(l.shape, l.pale, l.tier, l.tone, ink, light, bucket)[
        l.stamp % STAMP_VARIANTS
      ] as LeafStamp);
  if (!s) return;
  const k = l.len / s.len;
  ctx.save();
  ctx.translate(l.x, l.y);
  ctx.rotate(l.angle);
  if (l.flip) ctx.scale(1, -1);
  if (l.curl > 0.02) ctx.scale(1, 1 - clamp(l.curl, 0, 0.6) * 0.55);
  ctx.drawImage(s.c as CanvasImageSource, -s.px * k, -s.py * k, s.c.width * k, s.c.height * k);
  ctx.restore();
}

/* ========================= generated foliage atoms ========================= */

/**
 * The alternative to painting a blade: composite a *generated* one.
 *
 * `assets/atoms/` holds 16 transparent foliage cut-outs produced by the local
 * SDXL pipeline (see docs/design/generated-assets.md) — rose leaves, fern
 * leaflets, grass blades, daisies, a berry sprig. They are real painted
 * botanical material, which is more than any procedure will ever be.
 *
 * They are also, as generated, unusable raw:
 *
 *   - they sit at one fixed value key (bright, high-key, ink-outlined), so
 *     dropping them into a shelf lit from the upper right gives every leaf a
 *     highlight in the same place regardless of which way it points;
 *   - most carry a pale halo where the background was cut away, which reads as
 *     a white fringe against near-black wood;
 *   - their colour is fixed, so a theme that repaints the planting teal has no
 *     effect on them at all.
 *
 * So an atom is never blitted as-is. It goes through `atomStamp`, which crops
 * it to its real content, strips the halo, and **re-lights it**: every pixel's
 * luminance is remapped into the depth tier's value band and its hue/sat are
 * pulled toward the species tone, with a directional lift on the key side. The
 * source image contributes its *drawing* — the venation, the margin, the shape
 * of a real leaf — and the scene contributes the light and the palette.
 */

/** An atom the caller has decoded and handed us. */
export interface FloraAtomImage {
  image: CanvasImageSource;
  width: number;
  height: number;
}

/**
 * Which leaf shapes an atom family can stand in for. Anything not listed here
 * has no generated equivalent and always paints procedurally.
 */
const ATOM_FAMILIES: Record<string, readonly LeafShape[]> = {
  // Only `rose-leaf` maps. The comparison board (prototypes/flora,
  // `atoms-vs-painted`) settled this: the fern and grass cut-outs are whole
  // *compositions* — a complete frond, a bundle of blades — not single
  // organs, so instancing one per leaf node builds fronds out of fronds and
  // grass tufts out of grass tufts. The result is recursive and wrong at
  // every scale. Their right use is as an entire specimen, not as a blade.
  'rose-leaf': ['serrate', 'oval', 'heart'],
};

const atomImages = new Map<string, FloraAtomImage>();
const atomsByShape = new Map<LeafShape, string[]>();

/**
 * How the renderer uses the generated cut-outs.
 *
 *  - `off`  — procedural blades only (the default; nothing depends on assets
 *             having been generated on this machine);
 *  - `mix`  — a fraction of blades in a supported family come from atoms, so
 *             a mass mixes generated and painted leaves;
 *  - `only` — every blade with a generated equivalent uses one.
 */
export type FloraAtomMode = 'off' | 'mix' | 'only';

let atomMode: FloraAtomMode = 'off';
let atomMixRatio = 0.45;

export function setFloraAtomMode(mode: FloraAtomMode, mixRatio = 0.45): void {
  atomMode = mode;
  atomMixRatio = clamp(mixRatio, 0, 1);
  atomStampCache.clear();
}

export function getFloraAtomMode(): FloraAtomMode {
  return atomMode;
}

/**
 * Hand the renderer decoded atom images, keyed by their file stem
 * (`rose-leaf-v1-3`). Safe to call again; it replaces the registry.
 */
export function registerFloraAtoms(atoms: Record<string, FloraAtomImage>): void {
  atomImages.clear();
  atomsByShape.clear();
  atomStampCache.clear();
  for (const [name, img] of Object.entries(atoms)) {
    atomImages.set(name, img);
    for (const [family, shapes] of Object.entries(ATOM_FAMILIES)) {
      if (!name.startsWith(family)) continue;
      for (const shape of shapes) {
        const list = atomsByShape.get(shape);
        if (list) list.push(name);
        else atomsByShape.set(shape, [name]);
      }
    }
  }
  for (const list of atomsByShape.values()) list.sort();
}

/** Registered atom names, sorted. For the prototype boards. */
export function floraAtomNames(): string[] {
  return [...atomImages.keys()].sort();
}

interface AtomStamp {
  c: Canvas2D;
  px: number;
  py: number;
  /** Native blade length (the cropped content's long axis). */
  len: number;
}

const atomStampCache = new Map<string, AtomStamp>();
const ATOM_CACHE_CAP = 260;

/**
 * Crop, de-halo and re-light one atom into a stamp with the same contract as
 * a painted one: petiole at (px, py), blade running along +x, `len` px long.
 */
function atomStamp(
  name: string,
  tone0: Tone,
  tier: FloraTier,
  light: FloraLight,
  bucket: number,
): AtomStamp | null {
  const src = atomImages.get(name);
  if (!src) return null;
  const q = (v: number, step: number): number => Math.round(v / step);
  const key = [name, tier, q(tone0.h, 7), q(tone0.s, 9), q(tone0.l, 9), bucket, light.rim].join('|');
  const hit = atomStampCache.get(key);
  if (hit) return hit;

  // 1. Read the source at a working size — big enough to stay crisp on a hero
  //    blade, small enough that the per-pixel pass is cheap.
  const long = Math.max(src.width, src.height);
  const k = Math.min(1, 190 / Math.max(1, long));
  const w = Math.max(2, Math.round(src.width * k));
  const h = Math.max(2, Math.round(src.height * k));
  const work = makeCanvas(w, h);
  const wctx = get2d(work);
  wctx.drawImage(src.image, 0, 0, w, h);
  const img = wctx.getImageData(0, 0, w, h);
  const d = img.data;

  // 2. De-halo + crop. The cut-outs carry a pale fringe where the background
  //    was removed; it is low-alpha, near-white and desaturated, so it can be
  //    identified and dissolved without touching the leaf itself.
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = d[i + 3]! / 255;
      if (a <= 0.02) continue;
      const r = d[i]! / 255;
      const g = d[i + 1]! / 255;
      const b = d[i + 2]! / 255;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx <= 0 ? 0 : (mx - mn) / mx;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (sat < 0.14 && lum > 0.78) {
        // Halo: fade it out rather than cutting, so the margin stays soft.
        const kill = clamp((lum - 0.78) / 0.16, 0, 1) * clamp(1 - sat / 0.14, 0, 1);
        d[i + 3] = Math.round(d[i + 3]! * (1 - kill));
        if (d[i + 3]! / 255 <= 0.04) continue;
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;

  // 3. Re-light. Luminance drives everything: it carries the drawing (veins,
  //    margin, the modelling the generator painted) and nothing else survives
  //    the palette swap intact.
  const v = TIER_VALUE[tier];
  const targetL = clamp((tone0.l * v.l) / 100, 0.02, 0.96);
  const band = tier === TIER_BACK ? 0.16 : tier === TIER_LIT ? 0.4 : 0.3;
  const lo = clamp(targetL - band * 0.62, 0.01, 0.97);
  const hi = clamp(targetL + band * 0.55, 0.02, 0.99);
  const targetS = clamp((tone0.s * v.s) / 100, 0, 1);
  // The key direction in blade-local space, so the atom at least agrees with
  // the rest of the shelf about which side of itself is lit.
  const keyAngle = (bucket / LIGHT_BUCKETS) * Math.PI * 2;
  const klx = Math.cos(keyAngle);
  const kly = Math.sin(keyAngle);
  const rim = parseColour(light.rim);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = makeCanvas(cw, ch);
  const octx = get2d(out);
  const oimg = octx.createImageData(cw, ch);
  const od = oimg.data;
  const ccx = cw / 2;
  const ccy = ch / 2;
  const rad = Math.max(1, Math.hypot(cw, ch) * 0.5);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = ((y + minY) * w + (x + minX)) * 4;
      const oi = (y * cw + x) * 4;
      const a = d[si + 3]!;
      if (a <= 4) continue;
      const r = d[si]! / 255;
      const g = d[si + 1]! / 255;
      const b = d[si + 2]! / 255;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx <= 0 ? 0 : (mx - mn) / mx;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      // Directional lift: the half of the blade facing the key gets warmer
      // and lighter, the other half sinks. Without it the generated highlight
      // sits wherever the model happened to put it.
      const face = clamp((((x - ccx) * klx + (y - ccy) * kly) / rad) * 1.15, -1, 1);
      const shaped = clamp(Math.pow(lum, 0.86) + face * (tier === TIER_BACK ? 0.05 : 0.16), 0, 1);
      const l = lo + (hi - lo) * shaped;
      // Keep a memory of the source's own saturation so a pale vein stays pale.
      const s = clamp(targetS * (0.5 + 0.75 * clamp(sat / 0.45, 0, 1)), 0, 1);
      const c = hslToRgb({ h: tone0.h + (sat > 0.5 ? 0 : 6), s, l });
      // A hairline of key colour where the blade is both lit and bright.
      const rimK =
        tier === TIER_BACK ? 0 : clamp((face - 0.45) / 0.55, 0, 1) * clamp((lum - 0.58) / 0.42, 0, 1) * 0.55 * light.strength;
      od[oi] = Math.round(255 * clamp(c.r * (1 - rimK) + rim.r * rimK, 0, 1));
      od[oi + 1] = Math.round(255 * clamp(c.g * (1 - rimK) + rim.g * rimK, 0, 1));
      od[oi + 2] = Math.round(255 * clamp(c.b * (1 - rimK) + rim.b * rimK, 0, 1));
      od[oi + 3] = a;
    }
  }
  octx.putImageData(oimg, 0, 0);

  // Petiole: the cut-outs are drawn tip-up or tip-right; treat the long axis
  // as the blade and hang the stamp off the middle of its near end.
  const landscape = cw >= ch;
  const stamp: AtomStamp = landscape
    ? { c: out, px: cw * 0.06, py: ch / 2, len: cw }
    : { c: out, px: cw / 2, py: ch * 0.94, len: ch };
  if (atomStampCache.size > ATOM_CACHE_CAP) atomStampCache.clear();
  atomStampCache.set(key, stamp);
  return stamp;
}

/** Should this leaf instance be drawn from a generated cut-out? */
function atomFor(l: LeafInstance): string | null {
  if (atomMode === 'off') return null;
  const list = atomsByShape.get(l.shape);
  if (!list || list.length === 0) return null;
  if (atomMode === 'mix') {
    // Stable per leaf: the same blade must not flicker between sources when
    // the layer is re-baked.
    if ((l.seed >>> 8) / 0x00ffffff > atomMixRatio) return null;
  }
  return list[l.seed % list.length] ?? null;
}

export interface FloraAtomDrawOptions {
  len: number;
  tone: Tone;
  tier: FloraTier;
  seed?: number;
  flip?: boolean;
  light?: Partial<FloraLight>;
}

/**
 * Draw one atom at the current origin, contract-identical to `drawLeafStamp`.
 * For the prototype boards.
 */
export function drawFloraAtom(ctx: Ctx2D, name: string, o: FloraAtomDrawOptions): void {
  const light: FloraLight = o.light ? { ...activeLight, ...o.light } : activeLight;
  const s = atomStamp(name, o.tone, o.tier, light, 0);
  if (!s) return;
  const k = o.len / s.len;
  ctx.save();
  if (o.flip) ctx.scale(1, -1);
  ctx.drawImage(s.c as CanvasImageSource, -s.px * k, -s.py * k, s.c.width * k, s.c.height * k);
  ctx.restore();
}

/* ------------------------- painted-blade debug API ------------------------ */

export interface LeafStampOptions {
  shape: LeafShape;
  tier: FloraTier;
  tone: Tone;
  len: number;
  pale?: boolean;
  curl?: number;
  damage?: number;
  stamp?: number;
  flip?: boolean;
  seed?: number;
  ink?: string;
  light?: Partial<FloraLight>;
}

/**
 * Paint one blade at the current origin (petiole at 0,0, blade along +x).
 * Exists for the prototype boards: the shelf never draws a lone leaf, but the
 * only way to judge a blade's value range and edge quality is to look at one
 * on its own at inspection size.
 */
export function drawLeafStamp(ctx: Ctx2D, o: LeafStampOptions): void {
  const light: FloraLight = o.light ? { ...activeLight, ...o.light } : activeLight;
  drawLeafInstance(
    ctx,
    {
      x: 0,
      y: 0,
      angle: 0,
      len: o.len,
      width: o.len * shapeAspect(o.shape),
      shape: o.shape,
      stamp: o.stamp ?? 0,
      flip: o.flip ?? false,
      pale: o.pale ?? false,
      tone: o.tone,
      tier: o.tier,
      curl: o.curl ?? 0,
      damage: o.damage ?? 0,
      seed: o.seed ?? 1,
    },
    o.ink ?? DEFAULT_INK,
    light,
  );
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

  const bloomsOf = (tier: FloraTier): BloomGeom[] => tierOf(g.blooms, tier);

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
  for (const v of g.stems) {
    drawStemRibbon(ctx, v, g.ink, light);
    yield;
  }

  // 3. Back-tier threads + buds: the shadowed, half-hidden parts of a cluster.
  for (const t of tierOf(g.threads, TIER_BACK)) {
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
