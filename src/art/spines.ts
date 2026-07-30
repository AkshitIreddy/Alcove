/**
 * art/spines.ts — seeded procedural book spines (L2).
 *
 * A book's entire look derives from a 32-bit seed (fnv1a of its id):
 * seed → mulberry32 → SpineParams (~100 bytes, the only persisted state).
 * renderSpine draws one spine onto a canvas in ~0.3ms with NO SVG filters:
 * the watercolor look comes from layered multiply gradients + a 2px inset
 * pigment-pooling edge, the pencil look from per-vertex jittered
 * double-stroked polylines, and granulation from one shared 256² noise tile
 * composited with 'overlay' at alpha 0.06.
 */

import {
  charmColorCss,
  charmSpineReserve,
  charmTakesOrnamentSlot,
  drawSpineCharm,
  type CharmKind,
} from './charms';
import {
  DEFAULT_LIGHT_RIG,
  applyAmbientOcclusion,
  applyAtmosphericHaze,
  applyColourBleed,
  applyCreaseOcclusion,
  applyKeyLight,
  applyRimLight,
  applySpecularCatch,
  blowOut,
  castContactShadow,
  castObjectShadow,
  cylinderShading,
  keyToSource,
  litEdges,
  mixColourCss,
  shiftTemperature,
  withAlpha,
  type LightRig,
} from './lighting';
import { clamp, lerp, mulberry32, type RandomFn } from './noise';

/* ------------------------------ studio vocab ------------------------------ */

/**
 * Binding materials (library-themes §4). Each one is a genuinely different
 * baked treatment in `paintBindingMaterial`, not a colour swap:
 * leather (pebble grain + creases + sheen) · cloth (fine even buckram weave,
 * matte) · paper (flat, fibre streaks, foxing specks) · vellum (parchment
 * lightening + translucency clouds + follicles) · linen (coarse irregular
 * slubby weave) · silk (satin sheen bands + watered moiré).
 */
export const BINDING_MATERIALS = [
  'leather',
  'cloth',
  'paper',
  'vellum',
  'linen',
  'silk',
  'marbled',
] as const;
export type BindingMaterial = (typeof BINDING_MATERIALS)[number];

/**
 * Sub-treatments *within* a material, rolled from the seed rather than chosen
 * in the studio. The painterly spec asks for "cracked leather, ribbed cloth,
 * marbled boards" as separate visual facts; rather than inflate the studio's
 * material picker to a dozen entries, each material carries two or three
 * genuinely different grains and the seed picks one:
 *
 * - leather: `0` smooth calf · `1` pebbled morocco · `2` crackled (craquelure)
 * - cloth:   `0` flat buckram · `1` ribbed (rep) cloth · `2` pyroxylin sheen
 * - paper:   `0` laid · `1` coated/glazed · `2` kraft
 * - vellum:  `0` pale skin · `1` tanned skin
 * - linen:   `0` coarse · `1` fine
 * - silk:    `0` satin · `1` watered/moiré
 * - marbled: `0` combed · `1` Spanish wave · `2` stone/shell
 */
export const MAX_BOARD_STYLE = 2;

/** Title panel treatments on the spine (and, mirrored, on the cover). */
export const TITLE_PLATES = ['none', 'gilt', 'label', 'debossed'] as const;
export type TitlePlateStyle = (typeof TITLE_PLATES)[number];

/** Text-block edge treatments (the sliver of pages visible at the joint). */
export const EDGE_TREATMENTS = ['plain', 'gilt', 'marbled', 'speckled'] as const;
export type EdgeTreatment = (typeof EDGE_TREATMENTS)[number];

/** Number of curated pigment duos (shared with covers.ts). */
export const PIGMENT_COUNT = 20;
/** Number of ornament stamps (a book may also have none). */
export const ORNAMENT_COUNT = 12;
/** Maximum raised bands (cords) across a spine. */
export const MAX_RAISED_BANDS = 5;

/**
 * Legal spine height range in world px. Widened at both ends from the old
 * 150–290: the reference's skyline swings 20–30% between neighbours, and a
 * band that narrow could not express it.
 */
export const SPINE_HEIGHT_RANGE = { min: 132, max: 300 } as const;

/**
 * Legal spine thickness range in world px.
 *
 * The old floor of 20 was the single loudest "machine-made" tell on the shelf:
 * the reference has slivers you could lose a fingernail in sitting right next
 * to tomes four times their width. 8 → 58 gives that ratio. Anything relying
 * on a minimum drawable spine should clamp on its own side.
 */
export const SPINE_THICKNESS_RANGE = { min: 8, max: 58 } as const;

/**
 * Book formats, the bibliographic sizes a real shelf mixes: a folio towers
 * over a pocket duodecimo. Heights are in world px and always inside
 * SPINE_HEIGHT_RANGE. The studio's height slider overrides them outright.
 */
export const SPINE_FORMATS = {
  folio: { min: 268, max: 300, label: 'Folio' },
  quarto: { min: 238, max: 272, label: 'Quarto' },
  octavo: { min: 204, max: 244, label: 'Octavo' },
  duodecimo: { min: 170, max: 212, label: 'Duodecimo' },
  pocket: { min: 134, max: 178, label: 'Pocket' },
} as const;
export type SpineFormat = keyof typeof SPINE_FORMATS;
export const SPINE_FORMAT_IDS = Object.keys(SPINE_FORMATS) as readonly SpineFormat[];

export function isSpineFormat(v: unknown): v is SpineFormat {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SPINE_FORMATS, v);
}

/** The five named wear stops, pristine → well-loved (wear is continuous). */
export const WEAR_STOPS = [
  { id: 'pristine', label: 'Pristine', value: 0 },
  { id: 'gently-read', label: 'Gently read', value: 0.25 },
  { id: 'read', label: 'Read', value: 0.5 },
  { id: 'worn', label: 'Worn', value: 0.75 },
  { id: 'well-loved', label: 'Well-loved', value: 1 },
] as const;

/** Display names for the studio's material picker. */
export const MATERIAL_LABELS: Readonly<Record<BindingMaterial, string>> = {
  leather: 'Leather',
  cloth: 'Cloth',
  paper: 'Paper',
  vellum: 'Vellum',
  linen: 'Linen',
  silk: 'Silk',
  marbled: 'Marbled boards',
};

/** Display names for the 20 pigment duos, index-aligned with PALETTES. */
export const PIGMENT_LABELS: readonly string[] = [
  'Amber',
  'Terracotta',
  'Moss',
  'Dusty blue',
  'Plum',
  'Ochre',
  'Sage',
  'Rust',
  'Clay',
  'Olive',
  'Slate',
  'Blush',
  'Oxblood',
  'Navy',
  'Forest',
  'Tan',
  'Cream',
  'Ink',
  'Teal',
  'Saffron',
];

/** Display names for the 12 ornament stamps, index-aligned with drawOrnament. */
export const ORNAMENT_LABELS: readonly string[] = [
  'Diamond',
  'Laurel spray',
  'Star',
  'Blot',
  'Chevron',
  'Sun',
  'Moon',
  'Keyhole',
  'Laurel wreath',
  'Quill',
  'Tree',
  'Crescent & stars',
];

/** Display names for the title-plate treatments. */
export const TITLE_PLATE_LABELS: Readonly<Record<TitlePlateStyle, string>> = {
  none: 'None',
  gilt: 'Gilt panel',
  label: 'Paper label',
  debossed: 'Debossed',
};

/** Display names for the text-block edge treatments. */
export const EDGE_LABELS: Readonly<Record<EdgeTreatment, string>> = {
  plain: 'Plain',
  gilt: 'Gilt',
  marbled: 'Marbled',
  speckled: 'Speckled',
};

export function isBindingMaterial(v: unknown): v is BindingMaterial {
  return typeof v === 'string' && (BINDING_MATERIALS as readonly string[]).includes(v);
}
export function isTitlePlateStyle(v: unknown): v is TitlePlateStyle {
  return typeof v === 'string' && (TITLE_PLATES as readonly string[]).includes(v);
}
export function isEdgeTreatment(v: unknown): v is EdgeTreatment {
  return typeof v === 'string' && (EDGE_TREATMENTS as readonly string[]).includes(v);
}

/* --------------------------------- params -------------------------------- */

/** Horizontal rule across the spine. y is a fraction of spine height. */
export interface BandSpec {
  y: number;
  /** 0 = double-rule, 1 = thick band, 2 = gilt band. */
  kind: 0 | 1 | 2;
}

export interface SpineParams {
  /** The seed the params were derived from (kept for render-time jitter). */
  seed: number;
  /** Silhouette template 0–6: straight/taper-top/taper-bottom/banded/scalloped/rounded-top/waist. */
  silhouette: number;
  /** Index into the 12 curated warm pigment duos. */
  palette: number;
  /** Extra per-book hue rotation, ±6°. */
  hueJitter: number;
  /** 0–3 horizontal bands. */
  bands: BandSpec[];
  /**
   * Ornament stamp 0–11: diamond/laurel/star/blot/chevron/sun/moon/keyhole/
   * laurel-wreath/quill/tree/crescent-with-stars.
   */
  ornament: number;
  /** Cover texture: 0 = cloth, 1 = leather, 2 = paper. */
  texture: 0 | 1 | 2;
  /** Title face: 0 = Caveat, 1 = Kalam, 2 = Patrick Hand. */
  font: 0 | 1 | 2;
  /** Gilt (gold) bands/ornament/title. */
  gilt: boolean;
  /** Lean angle in degrees, ±1.2 — applied by the shelf compositor. */
  lean: number;
  /** Spine width in world px, 28–46 weighted toward 32–38. */
  w: number;
  /** Height jitter in world px, ±6 — applied by the shelf compositor. */
  hJitter: number;
  /** Two-tone binding: the head section is bound in the darker partner tone. */
  twoTone: boolean;
  /** Fraction of the height covered by the two-tone head section (0.26–0.48). */
  twoToneSplit: number;
  /** Striped head/tail bands (endbands) at the spine's top and bottom. */
  headTail: boolean;

  /* ---------------------- Book Studio additions (§4) ---------------------- */
  /* Every field below is OPTIONAL so hand-built params from before the studio
   * still typecheck and render; deriveSpineParams always populates them, and
   * renderSpine falls back to a seed-stable default when one is missing. */

  /** Binding material. Defaults to a material implied by `texture`. */
  material?: BindingMaterial;
  /** Raised cords across the spine, 0–5. >0 replaces the decorative `bands`. */
  raisedBands?: number;
  /** Gold rules flanking each raised cord. */
  bandGilt?: boolean;
  /** Endband stripe variant: 0 = blocks, 1 = chevron, 2 = wrapped cord. */
  headTailStyle?: number;
  /** False = no ornament stamp ("none" in the studio's 12 + none). */
  ornamentOn?: boolean;
  /** Title panel treatment. */
  titlePlate?: TitlePlateStyle;
  /** Wear, 0 (pristine) → 1 (well-loved): scuffs, bumped corners, sun-fade. */
  wear?: number;
  /** Text-block edge treatment. */
  edge?: EdgeTreatment;
  /** Bibliographic format the seeded `height` was drawn from. */
  format?: SpineFormat;
  /** Spine height in world px (drawn from `format`'s band by default). */
  height?: number;
  /** Charm carried on the shelf AND into the pull-out / open book. */
  charm?: CharmKind;
  /** Index into charms.CHARM_COLORS for the ribbon/twine/wax colourway. */
  charmColor?: number;

  /* ------------------- painterly rebuild additions (§1, §3) ---------------- */
  /* All optional, all seed-derived, none exposed in the studio: these are the
   * facts that separate "a painted book" from "a coloured rectangle". */

  /**
   * Sub-treatment within the material (see MAX_BOARD_STYLE): crackled vs
   * pebbled leather, ribbed vs flat cloth, combed vs stone marbling…
   */
  boardStyle?: number;
  /**
   * How much of the text block's fore-edge shows beside the spine, as a
   * fraction of the spine's drawn width (0.05–0.24). The reference has a
   * visible cream page-block next to *every* spine; we had none.
   */
  pageBlock?: number;
  /**
   * How far the book stands proud of (positive) or recessed behind (negative)
   * the shelf's front edge, in world px, ±10. Drives the compositor's depth
   * offset, the AO on recessed books and the contact shadow's gap.
   */
  proud?: number;
  /** Extra sun-fade on the side facing the key, 0–1 (independent of `wear`). */
  sunFade?: number;
  /** How much of the foil title has rubbed away, 0 (crisp) → 1 (ghost). */
  foilWear?: number;
  /** The book's own bump/knock history: 0–1, drives corner and cap damage. */
  knock?: number;
  /** Squab: a slightly convex (rounded) spine, 0 (flat back) → 1 (full round). */
  round?: number;
}

/** Suggested base spine height in world px (book zone is 280). */
export const SPINE_BASE_HEIGHT = 232;

interface HSL {
  h: number;
  s: number;
  l: number;
}

/**
 * 20 curated pigment duos (top/light, bottom/dark).
 *
 * Two changes from the original twelve, both straight out of the painterly
 * spec's "deep colour range" line:
 *
 *  1. Every dark partner tone was pushed down 4–7 points of lightness and up a
 *     little in saturation. The whole shelf used to sit mid-tone; "genuinely
 *     dark darks" is what a painting has and a diagram does not.
 *  2. Eight pigments were appended — oxblood, navy, forest, tan, cream, ink,
 *     teal and saffron. The reference's row is built out of exactly this kind
 *     of spread: a couple of near-black bindings anchoring a run of tans and
 *     creams, with one saturated red doing all the work.
 *
 * Order is append-only: index 0–11 keep their hue family so an existing
 * book's identity survives the change.
 */
const PALETTES: ReadonlyArray<readonly [HSL, HSL]> = [
  [{ h: 38, s: 64, l: 52 }, { h: 28, s: 62, l: 31 }], // 0  amber
  [{ h: 16, s: 58, l: 47 }, { h: 8, s: 56, l: 27 }], // 1  terracotta
  [{ h: 95, s: 30, l: 41 }, { h: 102, s: 34, l: 23 }], // 2  moss
  [{ h: 210, s: 28, l: 46 }, { h: 216, s: 34, l: 26 }], // 3  dusty blue
  [{ h: 315, s: 26, l: 39 }, { h: 322, s: 32, l: 21 }], // 4  plum
  [{ h: 44, s: 62, l: 46 }, { h: 38, s: 58, l: 27 }], // 5  ochre
  [{ h: 130, s: 18, l: 51 }, { h: 136, s: 22, l: 31 }], // 6  sage
  [{ h: 22, s: 62, l: 39 }, { h: 16, s: 62, l: 22 }], // 7  rust
  [{ h: 28, s: 40, l: 51 }, { h: 22, s: 38, l: 31 }], // 8  clay
  [{ h: 70, s: 32, l: 37 }, { h: 64, s: 36, l: 21 }], // 9  olive
  [{ h: 200, s: 20, l: 41 }, { h: 206, s: 24, l: 23 }], // 10 slate
  [{ h: 355, s: 34, l: 55 }, { h: 348, s: 34, l: 35 }], // 11 blush
  // --- the deep range the reference is actually built from -----------------
  [{ h: 2, s: 54, l: 33 }, { h: 356, s: 56, l: 17 }], // 12 oxblood
  [{ h: 220, s: 46, l: 29 }, { h: 226, s: 50, l: 15 }], // 13 navy
  [{ h: 148, s: 36, l: 27 }, { h: 154, s: 40, l: 14 }], // 14 forest
  [{ h: 33, s: 46, l: 60 }, { h: 27, s: 42, l: 40 }], // 15 tan
  [{ h: 44, s: 40, l: 83 }, { h: 38, s: 32, l: 62 }], // 16 cream
  [{ h: 212, s: 12, l: 25 }, { h: 214, s: 14, l: 11 }], // 17 ink
  [{ h: 186, s: 36, l: 33 }, { h: 192, s: 40, l: 18 }], // 18 teal
  [{ h: 36, s: 76, l: 55 }, { h: 28, s: 72, l: 34 }], // 19 saffron
];

const FONTS: readonly string[] = [
  '"Caveat Variable", "Caveat", cursive',
  '"Kalam", cursive',
  '"Patrick Hand", cursive',
];

const GOLD = '#c9a227';
const GRAPHITE = 'rgba(58, 50, 42, 0.55)';

/**
 * Derive the full parameter set for one book from its seed.
 * Pure and deterministic: same seed ⇒ structurally identical params.
 */
export function deriveSpineParams(seed: number): SpineParams {
  const rnd = mulberry32(seed >>> 0);
  const silhouette = Math.floor(rnd() * 7);
  const palette = Math.floor(rnd() * PALETTES.length);
  const hueJitter = (rnd() * 2 - 1) * 6;

  const bandCount = Math.floor(rnd() * 4); // 0–3
  const bands: BandSpec[] = [];
  // Always consume the same number of rnd() calls so the parameter stream
  // stays aligned regardless of bandCount.
  for (let i = 0; i < 3; i++) {
    const y = 0.12 + rnd() * 0.76;
    const kind = Math.floor(rnd() * 3) as 0 | 1 | 2;
    if (i < bandCount) bands.push({ y, kind });
  }
  bands.sort((a, b) => a.y - b.y);

  const ornament = Math.floor(rnd() * 12);
  const texture = Math.floor(rnd() * 3) as 0 | 1 | 2;
  const font = Math.floor(rnd() * 3) as 0 | 1 | 2;
  const gilt = rnd() < 0.3;
  const lean = (rnd() * 2 - 1) * 1.2;
  // Spine thickness. The old recipe (triangular, 28–46) is exactly the
  // "near-uniform widths" the art direction calls out: a triangular
  // distribution puts four books in five inside a 10px band, and a row of
  // those reads as a fence.
  //
  // A real shelf is a *mixture*: mostly ordinary octavos, but with a long
  // thin tail of pamphlets and slim verse, and a short fat tail of atlases
  // and bound volumes. So roll a class first, then a width inside it — a
  // genuine multi-modal draw with the tails the reference has.
  const w = thicknessRoll(rnd);
  const hJitter = (rnd() * 2 - 1) * 6;
  // New draws are APPENDED so every earlier parameter keeps its value for a
  // given seed (the rnd stream stays aligned with the original recipe).
  const twoTone = rnd() < 0.3;
  const twoToneSplit = 0.26 + rnd() * 0.22;
  const headTail = rnd() < 0.55;

  // --- Book Studio rolls (appended: earlier fields keep their values) ---
  const material = pickWeighted(rnd(), MATERIAL_WEIGHTS);
  // Cords are a leather/vellum convention; cloth and paper books rarely have
  // them, so the count is biased by material.
  const cordBias = MATERIAL_CORD_BIAS[material];
  const cordRoll = rnd();
  const raisedBands =
    cordRoll < cordBias.none ? 0 : 1 + Math.floor(rnd() * cordBias.max);
  const bandGilt = rnd() < (gilt ? 0.75 : 0.34);
  const headTailStyle = Math.floor(rnd() * 3);
  const ornamentOn = rnd() < 0.82;
  const titlePlate = pickWeighted(rnd(), PLATE_WEIGHTS);
  // Skew hard toward the low end: most books are gently read, few are ruins.
  const wearRoll = rnd();
  const wear = clamp(wearRoll * wearRoll * (0.55 + MATERIAL_WEAR_BIAS[material]), 0, 1);
  const edge = pickWeighted(rnd(), EDGE_WEIGHTS);
  const charmRoll = rnd();
  const charm: CharmKind =
    charmRoll < 0.66
      ? 'none'
      : (['ribbon', 'tassel', 'pressed-flower', 'clasp', 'wax-seal', 'tag'] as const)[
          Math.floor(rnd() * 6)
        ] ?? 'none';
  const charmColor = Math.floor(rnd() * 8);

  // --- painterly rebuild rolls (appended: earlier fields keep their values) ---
  const boardStyle = Math.floor(rnd() * (MAX_BOARD_STYLE + 1));
  // Thin books show proportionally MORE page block (there is less spine to
  // hide it behind), which is exactly what makes a row of slivers read as
  // books rather than as coloured strips.
  const pageBlock = clamp(0.05 + rnd() * 0.13 + (w < 20 ? 0.06 : 0), 0.05, 0.24);
  // Most books sit flush; a quarter are noticeably pushed back or pulled
  // forward. Squaring the roll keeps the extremes rare.
  const proudRoll = rnd() * 2 - 1;
  const proud = Math.sign(proudRoll) * proudRoll * proudRoll * 10;
  const sunFade = rnd() * rnd();
  const foilWear = clamp(rnd() * rnd() * 1.5, 0, 1);
  const knock = rnd() * rnd();
  // Round backs are a hand-binding convention: leather and vellum almost
  // always, cloth sometimes, paper wrappers never.
  const round =
    material === 'leather' || material === 'vellum'
      ? 0.55 + rnd() * 0.45
      : material === 'cloth' || material === 'linen'
        ? rnd() * 0.6
        : rnd() * 0.25;

  // --- book format (appended last: every earlier field keeps its value) ---
  // A real shelf is not a row of identical rectangles — it is folios next to
  // pocket duodecimos. `hJitter` (±6px, consumed above) stays exactly as it
  // was for the legacy compositor; `height` now carries the format spread.
  const format = pickWeighted(rnd(), FORMAT_WEIGHTS);
  const span = SPINE_FORMATS[format];
  const height = clamp(
    span.min + rnd() * (span.max - span.min) + hJitter * 0.35,
    SPINE_HEIGHT_RANGE.min,
    SPINE_HEIGHT_RANGE.max,
  );

  return {
    format,
    seed: seed >>> 0,
    silhouette,
    palette,
    hueJitter,
    bands,
    ornament,
    texture,
    font,
    gilt,
    lean,
    w,
    hJitter,
    twoTone,
    twoToneSplit,
    headTail,
    material,
    raisedBands,
    bandGilt,
    headTailStyle,
    ornamentOn,
    titlePlate,
    wear,
    edge,
    height,
    charm,
    charmColor,
    boardStyle,
    pageBlock,
    proud,
    sunFade,
    foilWear,
    knock,
    round,
  };
}

/* ------------------------------ thickness ---------------------------------- */

/**
 * The six thickness classes a real shelf mixes, with the share of books that
 * fall in each. The spread — a 7px pamphlet standing next to a 54px atlas —
 * is the single most important silhouette fact in the art direction.
 */
export const THICKNESS_CLASSES = [
  { id: 'pamphlet', label: 'Pamphlet', min: 8, max: 13, weight: 9 },
  { id: 'slim', label: 'Slim', min: 13, max: 20, weight: 17 },
  { id: 'trade', label: 'Trade', min: 20, max: 28, weight: 26 },
  { id: 'standard', label: 'Standard', min: 28, max: 37, weight: 24 },
  { id: 'stout', label: 'Stout', min: 37, max: 46, weight: 15 },
  { id: 'tome', label: 'Tome', min: 46, max: 58, weight: 9 },
] as const;

export type ThicknessClass = (typeof THICKNESS_CLASSES)[number]['id'];

/**
 * Draw one spine thickness in world px. Consumes exactly two values from
 * `rnd` (class, then position inside the class) so the parameter stream stays
 * aligned for every seed.
 */
export function thicknessRoll(rnd: RandomFn): number {
  const roll = rnd();
  let total = 0;
  for (const c of THICKNESS_CLASSES) total += c.weight;
  let acc = roll * total;
  let chosen = THICKNESS_CLASSES[2] as (typeof THICKNESS_CLASSES)[number];
  for (const c of THICKNESS_CLASSES) {
    acc -= c.weight;
    if (acc < 0) {
      chosen = c;
      break;
    }
  }
  return clamp(
    chosen.min + rnd() * (chosen.max - chosen.min),
    SPINE_THICKNESS_RANGE.min,
    SPINE_THICKNESS_RANGE.max,
  );
}

/** Which thickness class a width lands in (for tests and the studio label). */
export function thicknessClassFor(w: number): ThicknessClass {
  for (const c of THICKNESS_CLASSES) {
    if (w < c.max) return c.id;
  }
  return 'tome';
}

/* --------------------------- weighted roll tables ------------------------- */

/** Pick from [value, weight] pairs with a roll already in [0, 1). */
function pickWeighted<T>(roll: number, table: ReadonlyArray<readonly [T, number]>): T {
  let total = 0;
  for (const [, wgt] of table) total += wgt;
  let acc = roll * total;
  for (const [value, wgt] of table) {
    acc -= wgt;
    if (acc < 0) return value;
  }
  return (table[table.length - 1] as readonly [T, number])[0];
}

const MATERIAL_WEIGHTS: ReadonlyArray<readonly [BindingMaterial, number]> = [
  ['leather', 21],
  ['cloth', 22],
  ['paper', 16],
  ['linen', 13],
  ['vellum', 9],
  ['silk', 10],
  ['marbled', 9],
];

/** `none` = chance of zero cords; `max` = cords drawn as 1 + floor(r*max). */
const MATERIAL_CORD_BIAS: Readonly<Record<BindingMaterial, { none: number; max: number }>> = {
  leather: { none: 0.2, max: 5 },
  vellum: { none: 0.4, max: 4 },
  cloth: { none: 0.66, max: 3 },
  linen: { none: 0.7, max: 3 },
  paper: { none: 0.86, max: 2 },
  silk: { none: 0.78, max: 2 },
  // Marbled boards are the classic half-leather binding: the spine IS leather,
  // so cords are the norm.
  marbled: { none: 0.24, max: 5 },
};

/** Added to the wear multiplier — soft bindings age faster than leather. */
const MATERIAL_WEAR_BIAS: Readonly<Record<BindingMaterial, number>> = {
  leather: 0.15,
  cloth: 0.3,
  paper: 0.45,
  vellum: 0.2,
  linen: 0.35,
  silk: 0.25,
  marbled: 0.4,
};

const PLATE_WEIGHTS: ReadonlyArray<readonly [TitlePlateStyle, number]> = [
  ['none', 38],
  ['gilt', 24],
  ['label', 22],
  ['debossed', 16],
];

const FORMAT_WEIGHTS: ReadonlyArray<readonly [SpineFormat, number]> = [
  ['folio', 9],
  ['quarto', 20],
  ['octavo', 38],
  ['duodecimo', 22],
  ['pocket', 11],
];

const EDGE_WEIGHTS: ReadonlyArray<readonly [EdgeTreatment, number]> = [
  ['plain', 58],
  ['gilt', 18],
  ['speckled', 14],
  ['marbled', 10],
];

/** Material implied by the legacy 0|1|2 `texture` field. */
export function materialFromTexture(texture: 0 | 1 | 2): BindingMaterial {
  return texture === 0 ? 'cloth' : texture === 1 ? 'leather' : 'paper';
}

/** Legacy 0|1|2 texture bucket a material falls into (cover back-compat). */
export function textureFromMaterial(material: BindingMaterial): 0 | 1 | 2 {
  switch (material) {
    case 'leather':
      return 1;
    case 'cloth':
    case 'linen':
    case 'silk':
      return 0;
    // Half-bound marbled boards read as leather on the pull-out cover: the
    // spine and corners the user actually sees up close are calf.
    case 'marbled':
      return 1;
    default:
      return 2;
  }
}

/** Middle of a format's height band, in world px (the studio's preset value). */
export function heightForFormat(format: SpineFormat): number {
  const span = SPINE_FORMATS[format];
  return clamp((span.min + span.max) / 2, SPINE_HEIGHT_RANGE.min, SPINE_HEIGHT_RANGE.max);
}

/** Which format band a height lands in (so the studio can label a slider). */
export function formatForHeight(height: number): SpineFormat {
  let best: SpineFormat = 'octavo';
  let bestDist = Number.POSITIVE_INFINITY;
  for (const id of SPINE_FORMAT_IDS) {
    const span = SPINE_FORMATS[id];
    const d = height < span.min ? span.min - height : height > span.max ? height - span.max : 0;
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}

/** Resolved spine height in world px (studio override wins over the jitter). */
export function spineHeightPx(params: SpineParams): number {
  return clamp(
    params.height ?? SPINE_BASE_HEIGHT + params.hJitter,
    SPINE_HEIGHT_RANGE.min,
    SPINE_HEIGHT_RANGE.max,
  );
}

/**
 * Public alias for cover modules (the pulled-book overlay bakes a DOM/canvas
 * cover that must match the shelf spine exactly). Same seed ⇒ same params.
 */
export function getSpineParams(seed: number): SpineParams {
  return deriveSpineParams(seed);
}

/** CSS-usable palette of one spine, derived from its params. */
export interface SpinePaletteCss {
  /** Light/top pigment. */
  top: string;
  /** Dark/bottom pigment. */
  bottom: string;
  /** Deep ink used for bands/edges. */
  ink: string;
  /** Ornament/title color (gold when the book is gilt). */
  accent: string;
  /** The shared gilt gold. */
  gold: string;
}

/**
 * The canonical palette lookup for a book's params — exported so the cover
 * module (and the DOM overlay) never has to duplicate the pigment tables.
 */
export function getSpinePalette(params: SpineParams): SpinePaletteCss {
  const duo = PALETTES[params.palette % PALETTES.length] as readonly [HSL, HSL];
  const hue = params.hueJitter;
  return {
    top: hslStr(duo[0], hue),
    bottom: hslStr(duo[1], hue),
    ink: hslStr(duo[1], hue, -18),
    accent: params.gilt ? GOLD : hslStr(duo[1], hue, -24),
    gold: GOLD,
  };
}

/* --------------------------- granulation tile ---------------------------- */

export type Canvas2D = OffscreenCanvas | HTMLCanvasElement;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const GRANULATION_SIZE = 256;
let granulationTile: Canvas2D | null = null;

function makeCanvas(w: number, h: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function get2d(c: Canvas2D): Ctx2D {
  const ctx = (c as OffscreenCanvas).getContext('2d');
  if (!ctx) throw new Error('spines: 2d context unavailable');
  return ctx as Ctx2D;
}

/**
 * The shared 256² high-frequency granulation noise tile (module-level lazy).
 * Drawn everywhere with globalCompositeOperation 'overlay' at alpha 0.06 —
 * cheaper than another filter chain, reused by spines, wood and washes.
 */
export function getGranulationTile(): Canvas2D {
  if (granulationTile) return granulationTile;
  const c = makeCanvas(GRANULATION_SIZE, GRANULATION_SIZE);
  const ctx = get2d(c);
  const img = ctx.createImageData(GRANULATION_SIZE, GRANULATION_SIZE);
  const rnd = mulberry32(0xa57a57);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    // Mid-gray ± noise: gray 128 is neutral under 'overlay'.
    const v = Math.round(128 + (rnd() * 2 - 1) * 56);
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  granulationTile = c;
  return c;
}

/* ------------------------------ geometry --------------------------------- */

interface Pt {
  x: number;
  y: number;
}

/**
 * Silhouette outline (clockwise from top-left) in local coords, before
 * jittering. Templates 0–6.
 */
function silhouetteOutline(silhouette: number, w: number, h: number): Pt[] {
  const tl: Pt = { x: 0, y: 0 };
  const tr: Pt = { x: w, y: 0 };
  const br: Pt = { x: w, y: h };
  const bl: Pt = { x: 0, y: h };
  switch (silhouette) {
    case 1: // tapered top
      return [{ x: w * 0.08, y: 0 }, { x: w * 0.92, y: 0 }, br, bl];
    case 2: // tapered bottom
      return [tl, tr, { x: w * 0.94, y: h }, { x: w * 0.06, y: h }];
    case 3: // banded — slight bulge at mid height
      return [
        tl, tr,
        { x: w * 1.03, y: h * 0.5 },
        br, bl,
        { x: -w * 0.03, y: h * 0.5 },
      ];
    case 4: // scalloped top edge
      return [
        tl,
        { x: w * 0.25, y: h * 0.012 },
        { x: w * 0.5, y: -h * 0.008 },
        { x: w * 0.75, y: h * 0.012 },
        tr, br, bl,
      ];
    case 5: // rounded (chamfered) top corners
      return [
        { x: 0, y: h * 0.02 },
        { x: w * 0.14, y: 0 },
        { x: w * 0.86, y: 0 },
        { x: w, y: h * 0.02 },
        br, bl,
      ];
    case 6: // waist
      return [
        tl, tr,
        { x: w * 0.95, y: h * 0.5 },
        br, bl,
        { x: w * 0.05, y: h * 0.5 },
      ];
    default: // 0 straight
      return [tl, tr, br, bl];
  }
}

/**
 * Densify a closed polygon (subdivide each edge every ~`step` px) and jitter
 * every vertex by ±amp. The jitter sequence comes from `rnd`, so identical
 * seeds reproduce identical outlines.
 */
function densifyJitter(pts: readonly Pt[], step: number, amp: number, rnd: RandomFn): Pt[] {
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i] as Pt;
    const b = pts[(i + 1) % n] as Pt;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const segs = Math.max(1, Math.round(len / step));
    for (let k = 0; k < segs; k++) {
      const t = k / segs;
      out.push({
        x: a.x + (b.x - a.x) * t + (rnd() * 2 - 1) * amp,
        y: a.y + (b.y - a.y) * t + (rnd() * 2 - 1) * amp,
      });
    }
  }
  return out;
}

function tracePoly(ctx: Ctx2D, pts: readonly Pt[], close: boolean): void {
  ctx.beginPath();
  const first = pts[0];
  if (!first) return;
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i] as Pt;
    ctx.lineTo(p.x, p.y);
  }
  if (close) ctx.closePath();
}

/** Jittered open polyline between two points (for band rules etc.). */
function jitteredSegment(a: Pt, b: Pt, step: number, amp: number, rnd: RandomFn): Pt[] {
  const out: Pt[] = [];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const segs = Math.max(1, Math.round(len / step));
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    out.push({
      x: a.x + (b.x - a.x) * t + (rnd() * 2 - 1) * amp,
      y: a.y + (b.y - a.y) * t + (rnd() * 2 - 1) * amp,
    });
  }
  return out;
}

/** Stroke a rectangle as four jittered pencil segments. */
function jitterRectStroke(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  step: number,
  amp: number,
  rnd: RandomFn,
): void {
  const c: Pt[] = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  for (let i = 0; i < 4; i++) {
    tracePoly(ctx, jitteredSegment(c[i] as Pt, c[(i + 1) % 4] as Pt, step, amp, rnd), false);
    ctx.stroke();
  }
}

/* -------------------------------- colors --------------------------------- */

function hslStr(c: HSL, hueShift: number, dl = 0, ds = 0, alpha = 1): string {
  const h = ((c.h + hueShift) % 360 + 360) % 360;
  const s = clamp(c.s + ds, 0, 100);
  const l = clamp(c.l + dl, 0, 100);
  return alpha >= 1 ? `hsl(${h} ${s}% ${l}%)` : `hsl(${h} ${s}% ${l}% / ${alpha})`;
}

/* ------------------------------- ornaments ------------------------------- */

function strokePts(ctx: Ctx2D, pts: readonly Pt[], close: boolean): void {
  tracePoly(ctx, pts, close);
  ctx.stroke();
}

/**
 * The 12 procedural ornament stamps, drawn as simple wobbled paths:
 * 0 diamond, 1 laurel, 2 star, 3 blot, 4 chevron, 5 sun, 6 moon, 7 keyhole,
 * 8 laurel wreath, 9 quill, 10 tree, 11 crescent-with-stars.
 */
function drawOrnament(
  ctx: Ctx2D,
  kind: number,
  cx: number,
  cy: number,
  s: number,
  rnd: RandomFn,
): void {
  const j = (v: number) => v + (rnd() * 2 - 1) * s * 0.06;
  const pt = (x: number, y: number): Pt => ({ x: j(cx + x * s), y: j(cy + y * s) });

  switch (kind) {
    case 0: { // diamond
      strokePts(ctx, [pt(0, -1), pt(0.62, 0), pt(0, 1), pt(-0.62, 0)], true);
      break;
    }
    case 1: { // laurel spray — two mirrored stems with FILLED leaves
      // Hairline leaf ticks vanish at 14px; solid leaves survive.
      for (const side of [-1, 1]) {
        strokePts(ctx, [pt(side * 0.12, 0.92), pt(side * 0.42, 0.1), pt(side * 0.34, -0.86)], false);
        for (let i = 0; i < 4; i++) {
          const t = 0.1 + i * 0.27;
          const bx = side * (0.12 + (0.42 - 0.12) * Math.min(1, t * 1.6));
          const by = 0.92 - t * 1.78;
          const ang = side * (0.5 + i * 0.12);
          ctx.beginPath();
          ctx.ellipse(
            cx + (bx + side * 0.26) * s,
            cy + (by - 0.06) * s,
            s * 0.3,
            s * 0.12,
            ang,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
      // Tie at the foot.
      strokePts(ctx, [pt(-0.2, 1), pt(0, 0.84), pt(0.2, 1)], false);
      break;
    }
    case 2: { // star (5-point)
      const star: Pt[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 1 : 0.45;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        star.push(pt(Math.cos(a) * r, Math.sin(a) * r));
      }
      strokePts(ctx, star, true);
      break;
    }
    case 3: { // blot — irregular filled blob
      const blob: Pt[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = 0.55 + rnd() * 0.4;
        blob.push({ x: cx + Math.cos(a) * r * s, y: cy + Math.sin(a) * r * s });
      }
      tracePoly(ctx, blob, true);
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = prevAlpha * 0.8;
      ctx.fill();
      ctx.globalAlpha = prevAlpha;
      break;
    }
    case 4: { // chevron — two stacked zigzags
      for (const dy of [-0.22, 0.22]) {
        strokePts(
          ctx,
          [pt(-0.8, dy - 0.25), pt(-0.4, dy + 0.25), pt(0, dy - 0.25), pt(0.4, dy + 0.25), pt(0.8, dy - 0.25)],
          false,
        );
      }
      break;
    }
    case 5: { // sun — circle + 8 rays
      // 20 samples, not 12: at 14px a 12-gon reads as a lumpy pentagon.
      const circle: Pt[] = [];
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        circle.push({
          x: cx + Math.cos(a) * 0.55 * s,
          y: cy + Math.sin(a) * 0.55 * s,
        });
      }
      strokePts(ctx, circle, true);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        strokePts(ctx, [pt(Math.cos(a) * 0.7, Math.sin(a) * 0.7), pt(Math.cos(a) * 1.05, Math.sin(a) * 1.05)], false);
      }
      break;
    }
    case 6: { // moon — crescent
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.85, -Math.PI * 0.55, Math.PI * 0.55, false);
      ctx.arc(cx + s * 0.42, cy, s * 0.62, Math.PI * 0.62, -Math.PI * 0.62, true);
      ctx.closePath();
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = prevAlpha * 0.8;
      ctx.fill();
      ctx.globalAlpha = prevAlpha;
      break;
    }
    case 7: { // keyhole
      const circle: Pt[] = [];
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        circle.push({
          x: cx + Math.cos(a) * 0.42 * s,
          y: cy + (-0.35 + Math.sin(a) * 0.42) * s,
        });
      }
      strokePts(ctx, circle, true);
      strokePts(ctx, [pt(-0.16, -0.05), pt(-0.3, 0.85), pt(0.3, 0.85), pt(0.16, -0.05)], true);
      break;
    }
    case 8: { // laurel wreath — open-topped ring of FILLED leaves
      const leaves = 12;
      for (let i = 0; i < leaves; i++) {
        // Sweep from the bottom up both sides, leaving a gap at the crown.
        const t = i / (leaves - 1);
        const a = Math.PI / 2 + (t < 0.5 ? -1 : 1) * ((t < 0.5 ? 1 - t * 2 : t * 2 - 1) * Math.PI * 0.86);
        const bx = Math.cos(a) * 0.78;
        const by = Math.sin(a) * 0.78;
        ctx.beginPath();
        ctx.ellipse(cx + bx * s, cy + by * s, s * 0.3, s * 0.13, a + Math.PI / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      // Ribbon knot at the bottom.
      ctx.lineWidth = Math.max(1, ctx.lineWidth);
      strokePts(ctx, [pt(-0.26, 1.02), pt(0, 0.8), pt(0.26, 1.02)], false);
      break;
    }
    case 9: { // quill — a solid feather blade on a curved shaft
      const shaftPt = (t: number): Pt =>
        pt(-0.72 + t * 1.44, 0.9 - t * 1.6 - Math.sin(t * Math.PI) * 0.3);
      // Blade: one closed vane down one side of the shaft.
      const vane: Pt[] = [];
      for (let i = 0; i <= 8; i++) vane.push(shaftPt(0.2 + (i / 8) * 0.8));
      for (let i = 8; i >= 0; i--) {
        const t = 0.2 + (i / 8) * 0.8;
        const p = shaftPt(t);
        const bulge = Math.sin(((t - 0.2) / 0.8) * Math.PI) * 0.42;
        vane.push({ x: p.x - bulge * s, y: p.y + bulge * 0.42 * s });
      }
      tracePoly(ctx, vane, true);
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = prevAlpha * 0.85;
      ctx.fill();
      ctx.globalAlpha = prevAlpha;
      // Shaft + nib, drawn over the blade.
      const shaft: Pt[] = [];
      for (let i = 0; i <= 8; i++) shaft.push(shaftPt(i / 8));
      strokePts(ctx, shaft, false);
      strokePts(ctx, [shaftPt(0), pt(-0.94, 1.06)], false);
      break;
    }
    case 10: { // tree — trunk, three branch tiers, root flare
      strokePts(ctx, [pt(0, 1), pt(0, -0.25)], false);
      for (const [ty, sp] of [
        [0.45, 0.72],
        [0.05, 0.55],
        [-0.35, 0.36],
      ] as const) {
        strokePts(ctx, [pt(-sp, ty + 0.35), pt(0, ty - 0.2), pt(sp, ty + 0.35)], false);
      }
      strokePts(ctx, [pt(-0.3, 1), pt(0, 0.82), pt(0.3, 1)], false);
      // Tiny crown dot.
      ctx.beginPath();
      ctx.arc(cx, cy - 0.62 * s, s * 0.08, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: { // 11 crescent-with-stars
      // A fatter crescent tipped back, so the horns read even at 14px.
      ctx.beginPath();
      ctx.arc(cx - s * 0.22, cy, s * 0.86, -Math.PI * 0.46, Math.PI * 0.46, false);
      ctx.arc(cx + s * 0.16, cy, s * 0.6, Math.PI * 0.62, -Math.PI * 0.62, true);
      ctx.closePath();
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = prevAlpha * 0.92;
      ctx.fill();
      ctx.globalAlpha = prevAlpha;
      // Filled four-point sparkles instead of hairline outlines.
      for (const [sx, sy, sr] of [
        [0.6, -0.62, 0.3],
        [0.86, 0.16, 0.19],
      ] as const) {
        tracePoly(
          ctx,
          [pt(sx, sy - sr), pt(sx + sr * 0.36, sy), pt(sx, sy + sr), pt(sx - sr * 0.36, sy)],
          true,
        );
        ctx.fill();
      }
      break;
    }
  }
}

/* ---------------------------- material tiles ----------------------------- */

/**
 * Neutral-grey (128) tiles composited with 'overlay', so they add structure
 * without shifting hue — the same trick as the granulation tile, but with
 * shaped marks instead of white noise. Lazily built, shared forever.
 */
type MaterialTileKind =
  | 'pebble'
  | 'weave'
  | 'linen'
  | 'laid'
  | 'crackle'
  | 'rib'
  | 'morocco'
  | 'kraft';
const materialTiles = new Map<MaterialTileKind, Canvas2D>();

const TILE_SIZE: Readonly<Record<MaterialTileKind, number>> = {
  pebble: 128,
  weave: 48,
  linen: 64,
  laid: 64,
  crackle: 160,
  rib: 32,
  morocco: 144,
  kraft: 96,
};

/**
 * Craquelure: the branching net of hairline cracks old leather grows as the
 * finish dries and the boards flex. Built by growing a set of seeded polylines
 * and letting them branch — a Voronoi would be more correct and a great deal
 * slower, and at spine scale nobody can tell.
 */
function paintCrackleTile(ctx: Ctx2D, size: number, rnd: RandomFn): void {
  const walk = (
    x0: number,
    y0: number,
    angle: number,
    len: number,
    depth: number,
    width: number,
  ): void => {
    let x = x0;
    let y = y0;
    let a = angle;
    const seg = 5 + rnd() * 5;
    const steps = Math.max(2, Math.round(len / seg));
    // A crack is a valley: a dark core with a lit lip on the side the light
    // would catch. Drawing both is what makes it read as *depth* rather than
    // as a scratch of ink.
    const pts: Pt[] = [{ x, y }];
    for (let i = 0; i < steps; i++) {
      a += (rnd() * 2 - 1) * 0.55;
      x += Math.cos(a) * seg;
      y += Math.sin(a) * seg;
      pts.push({ x, y });
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(22,22,22,${(0.26 + rnd() * 0.2).toFixed(3)})`;
    ctx.lineWidth = width;
    tracePoly(ctx, pts, false);
    ctx.stroke();
    ctx.strokeStyle = `rgba(238,238,238,${(0.12 + rnd() * 0.12).toFixed(3)})`;
    ctx.lineWidth = width * 0.7;
    ctx.save();
    ctx.translate(-width * 0.55, -width * 0.55);
    tracePoly(ctx, pts, false);
    ctx.stroke();
    ctx.restore();

    if (depth > 0) {
      const branches = 1 + Math.floor(rnd() * 2);
      for (let b = 0; b < branches; b++) {
        const at = pts[1 + Math.floor(rnd() * (pts.length - 1))] as Pt;
        walk(
          at.x,
          at.y,
          a + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.9),
          len * (0.4 + rnd() * 0.3),
          depth - 1,
          Math.max(0.5, width * 0.72),
        );
      }
    }
  };

  for (let i = 0; i < 14; i++) {
    walk(rnd() * size, rnd() * size, rnd() * Math.PI * 2, 40 + rnd() * 70, 2, 1.1 + rnd() * 0.9);
  }
  // Fine surface crazing between the big cracks.
  for (let i = 0; i < 260; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const a = rnd() * Math.PI * 2;
    const l = 2 + rnd() * 6;
    ctx.strokeStyle = `rgba(30,30,30,${(0.08 + rnd() * 0.12).toFixed(3)})`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
}

/**
 * One cell of a plain (over-under) weave. `warp` true ⇒ the vertical thread
 * passes over the horizontal one in this cell. Threads are drawn as rounded
 * bars with a lit crown and a shadowed underside so the cloth reads as
 * *fabric* rather than a grid of lines.
 */
function weaveCell(
  ctx: Ctx2D,
  x: number,
  y: number,
  c: number,
  warp: boolean,
  thread: number,
  contrast: number,
): void {
  const half = thread / 2;
  const drawBar = (vertical: boolean, over: boolean): void => {
    const a = over ? contrast : contrast * 0.55;
    const cx = x + c / 2;
    const cy = y + c / 2;
    if (vertical) {
      const g = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
      g.addColorStop(0, `rgba(34,34,34,${(a * 0.9).toFixed(3)})`);
      g.addColorStop(0.42, `rgba(238,238,238,${(a * 0.75).toFixed(3)})`);
      g.addColorStop(1, `rgba(34,34,34,${a.toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(cx - half, y - 0.4, thread, c + 0.8);
    } else {
      const g = ctx.createLinearGradient(0, cy - half, 0, cy + half);
      g.addColorStop(0, `rgba(34,34,34,${(a * 0.9).toFixed(3)})`);
      g.addColorStop(0.42, `rgba(238,238,238,${(a * 0.75).toFixed(3)})`);
      g.addColorStop(1, `rgba(34,34,34,${a.toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(x - 0.4, cy - half, c + 0.8, thread);
    }
  };
  // Under first, over second — that is what makes the interlace read.
  drawBar(!warp, false);
  drawBar(warp, true);
}

function getMaterialTile(kind: MaterialTileKind): Canvas2D {
  const hit = materialTiles.get(kind);
  if (hit) return hit;
  const size = TILE_SIZE[kind];
  const c = makeCanvas(size, size);
  const ctx = get2d(c);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  const TILE_SEEDS: Readonly<Record<MaterialTileKind, number>> = {
    pebble: 0x9e3b17,
    linen: 0x51c0de,
    laid: 0x1a1d0e,
    weave: 0x2b17a4,
    crackle: 0xc7ac41,
    rib: 0x71bbed,
    morocco: 0x3af0c0,
    kraft: 0x8d21fa,
  };
  const rnd = mulberry32(TILE_SEEDS[kind]);

  if (kind === 'crackle') {
    paintCrackleTile(ctx, size, rnd);
  } else if (kind === 'rib') {
    // Rep / ribbed cloth: parallel raised cords running across the spine.
    // Each rib is a tiny cylinder — dark valley, lit crown, dark valley — and
    // the pitch drifts slightly so it never reads as a printed stripe.
    let y = 0;
    while (y < size) {
      const pitch = 3.4 + rnd() * 1.6;
      const g = ctx.createLinearGradient(0, y, 0, y + pitch);
      g.addColorStop(0, 'rgba(28,28,28,0.34)');
      g.addColorStop(0.3, 'rgba(226,226,226,0.28)');
      g.addColorStop(0.52, 'rgba(198,198,198,0.14)');
      g.addColorStop(1, 'rgba(24,24,24,0.36)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, size, pitch);
      y += pitch;
    }
    // Fine warp threads crossing the ribs, barely there.
    for (let x = 0; x < size; x += 2.2) {
      ctx.fillStyle = `rgba(160,160,160,${(0.04 + rnd() * 0.05).toFixed(3)})`;
      ctx.fillRect(x, 0, 0.9, size);
    }
  } else if (kind === 'morocco') {
    // Morocco (goat) grain: much larger, flatter, more angular cells than
    // calf pebble, in drifting rows — the grain a fine binding actually has.
    const rows = 9;
    for (let j = 0; j < rows; j++) {
      const cy = ((j + 0.5) / rows) * size;
      let x = rnd() * 14;
      while (x < size + 14) {
        const rx = 6 + rnd() * 9;
        const ry = 4 + rnd() * 5;
        const yy = cy + (rnd() * 2 - 1) * 5;
        const g = ctx.createRadialGradient(x - rx * 0.35, yy - ry * 0.4, ry * 0.1, x, yy, rx);
        g.addColorStop(0, 'rgba(232,232,232,0.26)');
        g.addColorStop(0.7, 'rgba(140,140,140,0.05)');
        g.addColorStop(1, 'rgba(24,24,24,0.34)');
        ctx.beginPath();
        ctx.ellipse(x, yy, rx, ry, (rnd() * 2 - 1) * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
        x += rx * 1.5 + rnd() * 4;
      }
    }
    // The deep valleys between the grain islands.
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = 'rgba(20,20,20,0.16)';
      ctx.fillRect(rnd() * size, rnd() * size, 1.2 + rnd() * 2.6, 1.1);
    }
  } else if (kind === 'kraft') {
    // Kraft / boards paper: coarse recycled pulp with visible long fibres.
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(60,60,60,0.1)' : 'rgba(228,228,228,0.12)';
      ctx.fillRect(rnd() * size, rnd() * size, 0.9 + rnd() * 1.6, 0.9);
    }
    for (let i = 0; i < 70; i++) {
      ctx.save();
      ctx.translate(rnd() * size, rnd() * size);
      ctx.rotate(rnd() * Math.PI);
      ctx.fillStyle = rnd() < 0.4 ? 'rgba(48,42,34,0.2)' : 'rgba(236,230,216,0.22)';
      ctx.fillRect(0, 0, 6 + rnd() * 22, 0.9 + rnd() * 0.8);
      ctx.restore();
    }
  } else if (kind === 'pebble') {
    // Leather grain: clustered irregular cells with dark valleys between the
    // lit crowns. Two passes — big soft cells, then fine crazing on top —
    // so the grain still reads once the tile is scaled up on a cover.
    for (let i = 0; i < 320; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = 3.4 + rnd() * 6.5;
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.34, r * 0.05, x, y, r);
      g.addColorStop(0, 'rgba(236,236,236,0.30)');
      g.addColorStop(0.62, 'rgba(150,150,150,0.06)');
      g.addColorStop(1, 'rgba(28,28,28,0.30)');
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.68 + rnd() * 0.6), rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }
    for (let i = 0; i < 900; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = 0.8 + rnd() * 2.2;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.6 + rnd() * 0.7), rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fillStyle = rnd() < 0.55 ? 'rgba(30,30,30,0.22)' : 'rgba(236,236,236,0.18)';
      ctx.fill();
    }
  } else if (kind === 'weave') {
    // Book cloth (buckram): a TIGHT, perfectly even plain weave. The cells are
    // small and regular — that regularity is what separates cloth from linen.
    const cell = size / 12;
    for (let j = 0; j < 12; j++) {
      for (let i = 0; i < 12; i++) {
        weaveCell(ctx, i * cell, j * cell, cell, (i + j) % 2 === 0, cell * 0.72, 0.4);
      }
    }
    // A whisper of sizing/starch sheen across the whole tile.
    ctx.fillStyle = 'rgba(220,220,220,0.05)';
    ctx.fillRect(0, 0, size, size);
  } else if (kind === 'linen') {
    // Linen: the SAME interlace at 3× the pitch, with irregular thread
    // thickness, drifting spacing and slubs. Coarse, hand-woven, alive.
    const cells = 5;
    const cell = size / cells;
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        weaveCell(
          ctx,
          i * cell,
          j * cell,
          cell,
          (i + j) % 2 === 0,
          cell * (0.52 + rnd() * 0.3),
          0.42 + rnd() * 0.22,
        );
      }
    }
    // Slubs: short fat thread bulges that only linen has.
    for (let i = 0; i < 18; i++) {
      const x = rnd() * size;
      const y = Math.floor(rnd() * cells) * cell + cell * 0.5;
      ctx.fillStyle = `rgba(26,26,26,${(0.2 + rnd() * 0.2).toFixed(3)})`;
      ctx.fillRect(x, y - cell * 0.22, 5 + rnd() * 11, cell * 0.44);
      ctx.fillStyle = 'rgba(240,240,240,0.2)';
      ctx.fillRect(x, y - cell * 0.26, 5 + rnd() * 9, 1.2);
    }
    // Undyed neps caught in the weave.
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = 'rgba(246,246,246,0.26)';
      ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2.4, 1 + rnd() * 1.4);
    }
  } else {
    // Laid paper: widely spaced chain lines across faint laid lines — the
    // mould marks a hand-made sheet carries. The laid lines are deliberately
    // whisper-quiet and one-directional; give them any real weight and paper
    // starts reading as another woven cloth.
    for (let x = 0; x < size; x += 3.6) {
      ctx.fillStyle = `rgba(104,104,104,${(0.05 + rnd() * 0.04).toFixed(3)})`;
      ctx.fillRect(x, 0, 1.3, size);
    }
    for (let y = 0; y < size; y += 19) {
      ctx.fillStyle = 'rgba(242,242,242,0.34)';
      ctx.fillRect(0, y, size, 1.8);
      ctx.fillStyle = 'rgba(64,64,64,0.2)';
      ctx.fillRect(0, y + 2, size, 1.2);
    }
    // Pulp flecks and the odd embedded fibre.
    for (let i = 0; i < 150; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(48,48,48,0.14)' : 'rgba(244,244,244,0.18)';
      ctx.fillRect(rnd() * size, rnd() * size, 0.9 + rnd() * 1.8, 0.9);
    }
    for (let i = 0; i < 14; i++) {
      ctx.save();
      ctx.translate(rnd() * size, rnd() * size);
      ctx.rotate(rnd() * Math.PI);
      ctx.fillStyle = 'rgba(228,228,228,0.28)';
      ctx.fillRect(0, 0, 5 + rnd() * 14, 0.9);
      ctx.restore();
    }
  }

  materialTiles.set(kind, c);
  return c;
}

function tileOver(
  ctx: Ctx2D,
  tile: Canvas2D,
  w: number,
  h: number,
  tileSize: number,
  alpha: number,
  mode: GlobalCompositeOperation = 'overlay',
): void {
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = alpha;
  for (let ty = 0; ty < h; ty += tileSize) {
    for (let tx = 0; tx < w; tx += tileSize) {
      ctx.drawImage(tile, tx, ty, tileSize, tileSize);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = prev;
}

/* --------------------------- binding materials --------------------------- */

/**
 * Pigment accessors for a material pass. `light`/`dark` are the two tones of
 * the book's pigment duo; each takes (lightnessDelta, saturationDelta, alpha)
 * so a material can reach for a paler or deeper version of the same pigment.
 */
export interface MaterialTones {
  light: (dl?: number, ds?: number, a?: number) => string;
  dark: (dl?: number, ds?: number, a?: number) => string;
}

/**
 * Marbled paper boards — the swirled, combed sheets a half-bound book carries
 * on its covers, and (on a narrow spine) a band of the same pattern.
 *
 * Three genuinely different historical patterns, chosen by `variant`:
 *  - `0` **combed**: colour bands raked into a regular wave by a comb.
 *  - `1` **Spanish wave**: the comb pattern overlaid with a hard, repeating
 *    light/dark ripple pressed in as the sheet was lifted.
 *  - `2` **stone / shell**: no comb at all — droplets spread into cells with
 *    pale haloes, the oldest and loosest of the three.
 *
 * The palette is the book's own pigment duo plus a fixed set of period marbling
 * colours, so a marbled book still reads as belonging to its shelf.
 */
export function paintMarbledBoard(
  ctx: Ctx2D,
  w: number,
  h: number,
  tones: MaterialTones,
  s: number,
  rnd: RandomFn,
  variant = 0,
): void {
  const px = Math.max(0.5, s);
  ctx.save();

  // --- size (the ground the colours float on) ---
  ctx.fillStyle = 'rgba(238, 227, 200, 0.5)';
  ctx.fillRect(0, 0, w, h);

  const inks = [
    tones.dark(-8, 8, 1),
    tones.light(2, 6, 1),
    '#7b2f22',
    '#2f4a6b',
    '#6d5a1f',
    '#4a2f52',
    '#2f5340',
  ];

  if (variant === 2) {
    // --- stone / shell marble: droplets spreading into cells ---
    const drops = Math.round((w * h) / Math.max(30, 260 * px * px)) + 26;
    for (let i = 0; i < drops; i++) {
      const cx = rnd() * w;
      const cy = rnd() * h;
      const r = (2.2 + rnd() * 7) * px;
      const col = inks[Math.floor(rnd() * inks.length)] as string;
      // Each cell is a soft blob with a pale halo where the size was pushed
      // aside — the "shell" in shell marble.
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, withAlpha(col, 0.62));
      g.addColorStop(0.62, withAlpha(col, 0.42));
      g.addColorStop(0.86, 'rgba(252, 246, 226, 0.5)');
      g.addColorStop(1, 'rgba(252, 246, 226, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * (0.7 + rnd() * 0.6), rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // --- combed marble: bands of colour raked into a wave ---
    const bandH = Math.max(2.4 * px, h / (10 + Math.floor(rnd() * 10)));
    const waveLen = Math.max(8 * px, w * (0.55 + rnd() * 0.9));
    const waveAmp = bandH * (0.7 + rnd() * 1.1);
    const phase = rnd() * Math.PI * 2;
    let y = -bandH * 2;
    let bandIndex = 0;
    ctx.lineCap = 'round';
    while (y < h + bandH * 2) {
      const col = inks[(bandIndex + Math.floor(rnd() * 2)) % inks.length] as string;
      const thick = bandH * (0.3 + rnd() * 0.7);
      ctx.strokeStyle = withAlpha(col, 0.42 + rnd() * 0.3);
      ctx.lineWidth = thick;
      ctx.beginPath();
      const steps = Math.max(4, Math.ceil(w / Math.max(1.2, 2 * px)));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const xx = t * w;
        const yy = y + Math.sin((xx / waveLen) * Math.PI * 2 + phase + bandIndex * 0.35) * waveAmp;
        if (k === 0) ctx.moveTo(xx, yy);
        else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
      // A pale vein of size between every pair of colour bands.
      ctx.strokeStyle = 'rgba(250, 243, 222, 0.34)';
      ctx.lineWidth = Math.max(0.5, thick * 0.34);
      ctx.stroke();
      y += bandH;
      bandIndex++;
    }

    // Comb ticks: fine vertical pulls that drag the bands into peaks.
    const teeth = Math.max(3, Math.round(w / Math.max(3, 6 * px)));
    for (let i = 0; i < teeth; i++) {
      const xx = ((i + 0.5) / teeth) * w;
      const g = ctx.createLinearGradient(xx - px, 0, xx + px, 0);
      g.addColorStop(0, 'rgba(40, 30, 18, 0.1)');
      g.addColorStop(0.5, 'rgba(252, 246, 226, 0.16)');
      g.addColorStop(1, 'rgba(40, 30, 18, 0.1)');
      ctx.fillStyle = g;
      ctx.fillRect(xx - px, 0, px * 2, h);
    }

    if (variant === 1) {
      // Spanish wave: a hard repeating light/dark ripple pressed across
      // everything, at an angle to the comb.
      const step = Math.max(2.4 * px, h * 0.045);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(0.12);
      ctx.translate(-w / 2, -h / 2);
      for (let yy = -h * 0.2; yy < h * 1.2; yy += step) {
        const g = ctx.createLinearGradient(0, yy, 0, yy + step);
        g.addColorStop(0, 'rgba(30, 22, 12, 0.24)');
        g.addColorStop(0.42, 'rgba(255, 250, 232, 0.2)');
        g.addColorStop(1, 'rgba(30, 22, 12, 0.2)');
        ctx.fillStyle = g;
        ctx.fillRect(-w * 0.2, yy, w * 1.4, step);
      }
      ctx.restore();
    }
  }

  // --- the sheet itself: paper grain, and the glaze marbled boards carry ---
  tileOver(ctx, getMaterialTile('kraft'), w, h, Math.max(30, 54 * px), 0.28);
  tileOver(ctx, getGranulationTile(), w, h, GRANULATION_SIZE * 2, 0.08, 'multiply');
  const glaze = ctx.createLinearGradient(0, 0, w, 0);
  glaze.addColorStop(0, 'rgba(0,0,0,0.14)');
  glaze.addColorStop(0.38, 'rgba(255,250,236,0.14)');
  glaze.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = glaze;
  ctx.fillRect(0, 0, w, h);

  ctx.restore();
}

/**
 * Paint one of the seven binding materials over an already-based, clipped
 * region of `w`×`h`. Shared verbatim by spines and covers so a linen spine
 * pulls out into a linen cover.
 *
 * Each material is a distinct *treatment*, tuned so the six are separable at
 * a glance even at 36px spine width:
 *  - leather  pebble-grain tile, soft creases, a broad waxy sheen
 *  - cloth    fine even two-way weave, cool matte veil, zero sheen
 *  - paper    flat, long fibre streaks, foxing specks, chalky veil
 *  - vellum   strong parchment lightening, translucency clouds, follicles
 *  - linen    coarse slubby weave, warm natural veil, visible flecks
 *  - silk     vertical satin sheen bands + watered (moiré) ripples
 */
export function paintBindingMaterial(
  ctx: Ctx2D,
  w: number,
  h: number,
  material: BindingMaterial,
  tones: MaterialTones,
  s: number,
  rnd: RandomFn,
  /**
   * Sub-treatment within the material, 0–{@link MAX_BOARD_STYLE}. See the
   * MAX_BOARD_STYLE doc comment for what each index means per material.
   * Defaults to 0 so every existing call site keeps its old look.
   */
  boardStyle = 0,
): void {
  const px = Math.max(0.5, s);
  const variant = clamp(Math.round(boardStyle), 0, MAX_BOARD_STYLE);
  ctx.save();
  ctx.lineCap = 'round';

  switch (material) {
    case 'leather': {
      // 0 smooth calf · 1 pebbled morocco · 2 crackled (craquelure)
      if (variant === 1) {
        tileOver(ctx, getMaterialTile('morocco'), w, h, Math.max(52, 92 * px), 0.72);
        tileOver(ctx, getMaterialTile('pebble'), w, h, Math.max(30, 54 * px), 0.28);
      } else {
        tileOver(ctx, getMaterialTile('pebble'), w, h, Math.max(44, 78 * px), 0.66);
      }
      tileOver(ctx, getGranulationTile(), w, h, GRANULATION_SIZE * 2, 0.1, 'multiply');

      if (variant === 2) {
        // Craquelure. Two passes at different scales so the crack net has the
        // hierarchy real dried leather does: a few big branching splits, then
        // a fine web filling between them.
        tileOver(ctx, getMaterialTile('crackle'), w, h, Math.max(60, 118 * px), 0.68);
        tileOver(ctx, getMaterialTile('crackle'), w, h, Math.max(26, 46 * px), 0.34);
        // Pigment has flaked out of the deepest cracks back to the board.
        for (let i = 0; i < 12; i++) {
          const cx = rnd() * w;
          const cy = rnd() * h;
          const r = (1.2 + rnd() * 3.4) * px;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, tones.light(26, -28, 0.3));
          g.addColorStop(1, tones.light(26, -28, 0));
          ctx.fillStyle = g;
          ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        }
      }

      // Creases: long soft folds that follow the way a spine flexes.
      ctx.strokeStyle = tones.dark(-16, 0, 0.16);
      ctx.lineWidth = Math.max(0.7, 1.1 * px);
      for (let i = 0; i < 5; i++) {
        const cy = (0.08 + rnd() * 0.84) * h;
        ctx.beginPath();
        ctx.moveTo(-w * 0.05, cy);
        ctx.quadraticCurveTo(w * 0.5, cy + (rnd() * 2 - 1) * 9 * px, w * 1.05, cy + (rnd() * 2 - 1) * 6 * px);
        ctx.stroke();
      }
      // Waxy sheen down the crown of the spine. Crackled leather has lost most
      // of its finish, so its sheen is much flatter.
      const gloss = variant === 2 ? 0.4 : 1;
      const sheen = ctx.createLinearGradient(0, 0, w, 0);
      sheen.addColorStop(0, `rgba(255,246,226,0)`);
      sheen.addColorStop(0.34, `rgba(255,246,226,${(0.15 * gloss).toFixed(3)})`);
      sheen.addColorStop(0.52, `rgba(255,246,226,${(0.06 * gloss).toFixed(3)})`);
      sheen.addColorStop(1, 'rgba(0,0,0,0.1)');
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'cloth': {
      // 0 flat buckram · 1 ribbed (rep) cloth · 2 pyroxylin-coated
      if (variant === 1) {
        // Ribbed cloth: the horizontal cords are the whole identity of the
        // material, so they get a real tile plus a second, finer pass to keep
        // the pitch from banding at any particular zoom.
        tileOver(ctx, getMaterialTile('rib'), w, h, Math.max(14, 26 * px), 0.8);
        tileOver(ctx, getMaterialTile('rib'), w, h, Math.max(7, 13 * px), 0.26);
        tileOver(ctx, getMaterialTile('weave'), w, h, Math.max(16, 26 * px), 0.2);
      } else {
        tileOver(ctx, getMaterialTile('weave'), w, h, Math.max(20, 34 * px), 0.72);
      }
      if (variant === 2) {
        // Pyroxylin: a plasticky coating over the weave, so it *does* return a
        // highlight — the one cloth that is not matte.
        const pg = ctx.createLinearGradient(0, 0, w, 0);
        pg.addColorStop(0, 'rgba(0,0,0,0.12)');
        pg.addColorStop(0.36, 'rgba(255,252,242,0.2)');
        pg.addColorStop(0.62, 'rgba(255,252,242,0.06)');
        pg.addColorStop(1, 'rgba(0,0,0,0.14)');
        ctx.fillStyle = pg;
        ctx.fillRect(0, 0, w, h);
      } else {
        // Matte veil: cloth eats light, never returns a highlight.
        ctx.fillStyle = 'rgba(238, 236, 230, 0.07)';
        ctx.fillRect(0, 0, w, h);
      }
      // Cloth is dyed in the piece, so the colour sits slightly uneven.
      for (let i = 0; i < 4; i++) {
        const cx = rnd() * w;
        const cy = rnd() * h;
        const r = (0.16 + rnd() * 0.3) * Math.max(w, h);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, tones.dark(-6, 2, 0.07));
        g.addColorStop(1, tones.dark(-6, 2, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      break;
    }
    case 'marbled': {
      paintMarbledBoard(ctx, w, h, tones, s, rnd, variant);
      break;
    }
    case 'paper': {
      // Flat and chalky: no gloss anywhere, but the mould's laid + chain
      // lines are unmistakable.
      ctx.fillStyle = 'rgba(246, 240, 226, 0.12)';
      ctx.fillRect(0, 0, w, h);
      if (variant === 2) {
        // Kraft / boards: coarse recycled pulp, no mould marks at all.
        tileOver(ctx, getMaterialTile('kraft'), w, h, Math.max(34, 58 * px), 0.6);
      } else {
        tileOver(ctx, getMaterialTile('laid'), w, h, Math.max(40, 68 * px), 0.42);
      }
      if (variant === 1) {
        // Coated / glazed wrapper: a low, broad sheen and a crisper surface.
        const cg = ctx.createLinearGradient(0, 0, w, 0);
        cg.addColorStop(0, 'rgba(0,0,0,0.08)');
        cg.addColorStop(0.4, 'rgba(255,253,246,0.18)');
        cg.addColorStop(1, 'rgba(0,0,0,0.1)');
        ctx.fillStyle = cg;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.strokeStyle = tones.light(16, -12, 0.1);
      ctx.lineWidth = Math.max(0.5, 0.7 * px);
      for (let i = 0; i < 9; i++) {
        const xx = rnd() * w;
        const y0 = rnd() * h * 0.6;
        ctx.beginPath();
        ctx.moveTo(xx, y0);
        ctx.quadraticCurveTo(xx + (rnd() * 2 - 1) * 3 * px, y0 + h * 0.2, xx + (rnd() * 2 - 1) * 2 * px, y0 + h * 0.4);
        ctx.stroke();
      }
      // Foxing: the little rust specks old paper grows.
      for (let i = 0; i < 40; i++) {
        const r = (0.4 + rnd() * 1.3) * px;
        ctx.beginPath();
        ctx.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(126, 88, 46, ${(0.05 + rnd() * 0.13).toFixed(3)})`;
        ctx.fill();
      }
      break;
    }
    case 'vellum': {
      // Parchment lightening is the signature move — vellum reads as skin,
      // not pigment, so the duo is heavily veiled toward cream.
      ctx.fillStyle = 'rgba(242, 231, 199, 0.46)';
      ctx.fillRect(0, 0, w, h);
      // Uneven translucency: soft clouds where the skin is thinner/thicker.
      for (let i = 0; i < 9; i++) {
        const cx = rnd() * w;
        const cy = rnd() * h;
        const r = (0.1 + rnd() * 0.3) * Math.max(w, h);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        const dark = rnd() < 0.45;
        g.addColorStop(0, dark ? 'rgba(150, 124, 82, 0.16)' : 'rgba(255, 250, 232, 0.2)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      // Hair follicles: faint paired pinpricks in drifting rows.
      ctx.fillStyle = 'rgba(122, 96, 58, 0.24)';
      for (let i = 0; i < 90; i++) {
        const x = rnd() * w;
        const y = rnd() * h;
        ctx.fillRect(x, y, 0.9 * px, 0.9 * px);
        if (rnd() < 0.5) ctx.fillRect(x + 1.6 * px, y + 0.7 * px, 0.8 * px, 0.8 * px);
      }
      // Waxy translucent sheen.
      const vg = ctx.createLinearGradient(0, 0, w, 0);
      vg.addColorStop(0, 'rgba(120, 96, 56, 0.14)');
      vg.addColorStop(0.42, 'rgba(255, 252, 238, 0.2)');
      vg.addColorStop(1, 'rgba(120, 96, 56, 0.16)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'linen': {
      tileOver(ctx, getMaterialTile('linen'), w, h, Math.max(26, 44 * px), 0.78);
      // Warm natural-fibre veil (linen is never as cool as buckram).
      ctx.fillStyle = 'rgba(226, 208, 172, 0.14)';
      ctx.fillRect(0, 0, w, h);
      // Undyed flecks in the weave.
      for (let i = 0; i < 34; i++) {
        ctx.fillStyle = `rgba(246, 238, 214, ${(0.12 + rnd() * 0.24).toFixed(3)})`;
        ctx.fillRect(rnd() * w, rnd() * h, (1 + rnd() * 3) * px, 0.9 * px);
      }
      break;
    }
    default: {
      // silk — the only material with a hard specular.
      const bands = 5;
      for (let i = 0; i < bands; i++) {
        const cx = ((i + 0.5) / bands) * w;
        const bw = w / bands;
        const g = ctx.createLinearGradient(cx - bw * 0.5, 0, cx + bw * 0.5, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.14)');
        g.addColorStop(0.42, 'rgba(255,252,240,0.24)');
        g.addColorStop(0.62, 'rgba(255,252,240,0.1)');
        g.addColorStop(1, 'rgba(0,0,0,0.12)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - bw * 0.5, 0, bw, h);
      }
      // Watered (moiré) ripples across the sheen.
      ctx.lineWidth = Math.max(0.5, 0.8 * px);
      for (let i = 0; i < 16; i++) {
        const y0 = (i / 16) * h + rnd() * h * 0.02;
        ctx.strokeStyle = i % 2 === 0 ? 'rgba(255,252,240,0.11)' : tones.dark(-12, 0, 0.09);
        ctx.beginPath();
        ctx.moveTo(0, y0);
        for (let x = 0; x <= w; x += Math.max(2, 3 * px)) {
          ctx.lineTo(x, y0 + Math.sin((x / Math.max(6, w)) * 7 + i) * 2.2 * px);
        }
        ctx.stroke();
      }
      // Crisp catchlight where the silk turns.
      const spec = ctx.createLinearGradient(w * 0.2, 0, w * 0.46, 0);
      spec.addColorStop(0, 'rgba(255,255,248,0)');
      spec.addColorStop(0.5, 'rgba(255,255,248,0.3)');
      spec.addColorStop(1, 'rgba(255,255,248,0)');
      ctx.fillStyle = spec;
      ctx.fillRect(w * 0.2, 0, w * 0.26, h);
      break;
    }
  }

  ctx.restore();
}

/* ---------------------------- edge treatments ---------------------------- */

/**
 * Paint the visible sliver of the text block's edge — on a spine that is the
 * ~3px strip at the joint, on a cover the fore-edge down the right side.
 * Four treatments: plain (cream leaves), gilt (burnished gold), marbled
 * (combed veins), speckled (spattered pigment).
 */
export function paintEdgeTreatment(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  edge: EdgeTreatment,
  s: number,
  rnd: RandomFn,
): void {
  if (w <= 0.4 || h <= 0.4) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // Cream page block with the leaf lines that any edge shows.
  const base = ctx.createLinearGradient(x, 0, x + w, 0);
  base.addColorStop(0, '#cbbc99');
  base.addColorStop(0.35, '#eae0c4');
  base.addColorStop(1, '#c9b995');
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(96, 82, 58, 0.22)';
  ctx.lineWidth = Math.max(0.4, 0.5 * s);
  const pitch = Math.max(1.4, 2 * s);
  ctx.beginPath();
  for (let yy = y; yy < y + h; yy += pitch) {
    ctx.moveTo(x, yy);
    ctx.lineTo(x + w, yy);
  }
  ctx.stroke();

  if (edge === 'gilt') {
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#8a6a14');
    g.addColorStop(0.3, '#f3dc93');
    g.addColorStop(0.52, '#c9a227');
    g.addColorStop(0.78, '#f7e7ab');
    g.addColorStop(1, '#7d5f12');
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    // Burnish streaks.
    ctx.strokeStyle = 'rgba(255, 248, 214, 0.4)';
    ctx.lineWidth = Math.max(0.4, 0.5 * s);
    for (let i = 0; i < 8; i++) {
      const yy = y + rnd() * h;
      ctx.beginPath();
      ctx.moveTo(x, yy);
      ctx.lineTo(x + w, yy + (rnd() * 2 - 1) * 2 * s);
      ctx.stroke();
    }
  } else if (edge === 'marbled') {
    const veins = ['#8d3a2a', '#2f4a6b', '#7b6a2c', '#5d3a5c'];
    ctx.globalAlpha = 0.62;
    for (let i = 0; i < 14; i++) {
      const col = veins[Math.floor(rnd() * veins.length)] as string;
      const y0 = y + rnd() * h;
      const amp = (0.9 + rnd() * 2.6) * s;
      const thick = (0.9 + rnd() * 2.4) * s;
      ctx.strokeStyle = col;
      ctx.lineWidth = thick;
      ctx.beginPath();
      ctx.moveTo(x - 1, y0);
      const steps = Math.max(2, Math.ceil(w / Math.max(1, s)));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        ctx.lineTo(x + t * (w + 2), y0 + Math.sin(t * 6 + i) * amp);
      }
      ctx.stroke();
    }
    // Comb ticks pulled across the veins.
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#f0e6cb';
    ctx.lineWidth = Math.max(0.4, 0.6 * s);
    for (let i = 0; i < 18; i++) {
      const yy = y + rnd() * h;
      ctx.beginPath();
      ctx.moveTo(x, yy);
      ctx.lineTo(x + w, yy + 3 * s);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (edge === 'speckled') {
    const specks = ['#7a3a24', '#4a3c2a', '#8f6a24'];
    const count = Math.max(24, Math.round((w * h) / Math.max(2, 6 * s * s)));
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = specks[Math.floor(rnd() * specks.length)] as string;
      ctx.globalAlpha = 0.25 + rnd() * 0.5;
      const r = (0.3 + rnd() * 0.9) * s;
      ctx.beginPath();
      ctx.arc(x + rnd() * w, y + rnd() * h, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Shadow where the block meets the board.
  const sh = ctx.createLinearGradient(x, 0, x + Math.max(1, w * 0.4), 0);
  sh.addColorStop(0, 'rgba(38, 30, 20, 0.45)');
  sh.addColorStop(1, 'rgba(38, 30, 20, 0)');
  ctx.fillStyle = sh;
  ctx.fillRect(x, y, Math.max(1, w * 0.4), h);
  ctx.restore();
}

/* --------------------------------- wear ---------------------------------- */

/**
 * Round and bump a silhouette's corners in proportion to wear. Books that
 * have been shelved for decades lose their sharp board corners first — this
 * chamfers every vertex and knocks the two tail corners in a little further.
 */
export function applyOutlineWear(
  pts: readonly Pt[],
  wear: number,
  s: number,
  rnd: RandomFn,
): Pt[] {
  if (wear <= 0.02 || pts.length < 3) return pts.slice();
  const r = (0.8 + wear * 5) * s;
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n] as Pt;
    const cur = pts[i] as Pt;
    const next = pts[(i + 1) % n] as Pt;
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1;
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y) || 1;
    const ri = Math.min(r, inLen * 0.45);
    const ro = Math.min(r, outLen * 0.45);
    // Bumped corner: knock the vertex itself inward a touch.
    const bump = wear * 1.8 * s * rnd();
    out.push({
      x: cur.x + ((prev.x - cur.x) / inLen) * ri,
      y: cur.y + ((prev.y - cur.y) / inLen) * ri,
    });
    out.push({
      x: cur.x + ((prev.x - cur.x) / inLen + (next.x - cur.x) / outLen) * bump,
      y: cur.y + ((prev.y - cur.y) / inLen + (next.y - cur.y) / outLen) * bump,
    });
    out.push({
      x: cur.x + ((next.x - cur.x) / outLen) * ro,
      y: cur.y + ((next.y - cur.y) / outLen) * ro,
    });
  }
  return out;
}

/**
 * The wear pass: sun-faded panel, edge scuffs, rubbed patches where the
 * pigment has gone back to board, grime pooled at the tail, and hairline
 * cracks once a book is genuinely well-loved. Runs inside the silhouette
 * clip, over the finished artwork.
 */
export function paintWear(
  ctx: Ctx2D,
  w: number,
  h: number,
  wear: number,
  tones: MaterialTones,
  s: number,
  rnd: RandomFn,
): void {
  if (wear <= 0.02) return;
  const px = Math.max(0.5, s);
  ctx.save();

  // --- sun-faded panel: a soft band of light that lay across the spine for
  // years. Feathered on BOTH sides and inset from the joint — a hard-edged
  // stripe starting at x=0 reads as a printing fault, not as sunlight. ---
  const fadeC = w * 0.4;
  const fadeR = w * (0.34 + wear * 0.34);
  const fade = ctx.createLinearGradient(fadeC - fadeR, 0, fadeC + fadeR, 0);
  const fadeA = 0.06 + wear * 0.2;
  fade.addColorStop(0, 'rgba(222, 210, 182, 0)');
  fade.addColorStop(0.34, `rgba(224, 212, 184, ${(fadeA * 0.75).toFixed(3)})`);
  fade.addColorStop(0.52, `rgba(226, 214, 186, ${fadeA.toFixed(3)})`);
  fade.addColorStop(1, 'rgba(222, 210, 182, 0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
  // Desaturate the same band so it reads as bleached, not merely lighter.
  ctx.globalCompositeOperation = 'saturation';
  ctx.globalAlpha = 0.14 + wear * 0.4;
  const sat = ctx.createLinearGradient(fadeC - fadeR, 0, fadeC + fadeR, 0);
  sat.addColorStop(0, 'hsl(0 0% 60% / 0)');
  sat.addColorStop(0.5, 'hsl(0 0% 60%)');
  sat.addColorStop(1, 'hsl(0 0% 60% / 0)');
  ctx.fillStyle = sat;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // --- edge scuffs: rubs along both joints ---
  const scuffs = Math.round(3 + wear * 16);
  ctx.lineCap = 'round';
  for (let i = 0; i < scuffs; i++) {
    const edgeX = rnd() < 0.5 ? (0.6 + rnd() * 1.6) * px : w - (0.6 + rnd() * 1.6) * px;
    const wy = rnd() * h;
    const len = (4 + rnd() * 22) * px;
    ctx.strokeStyle = tones.light(28 + rnd() * 14, -20, 0.14 + wear * 0.34);
    ctx.lineWidth = (0.5 + rnd() * 0.9) * px;
    ctx.beginPath();
    ctx.moveTo(edgeX, wy);
    ctx.lineTo(edgeX + (rnd() * 2 - 1) * 1.2 * px, wy + len);
    ctx.stroke();
  }

  // --- rubbed patches: pigment gone, board showing through ---
  if (wear > 0.3) {
    const patches = Math.round(1 + wear * 5);
    for (let i = 0; i < patches; i++) {
      const cx = rnd() < 0.5 ? (1 + rnd() * 3) * px : w - (1 + rnd() * 3) * px;
      const cy = rnd() * h;
      const rx = (2 + rnd() * 5) * px;
      const ry = (5 + rnd() * 26) * px;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
      g.addColorStop(0, tones.light(30, -26, 0.34 * wear));
      g.addColorStop(1, tones.light(30, -26, 0));
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
      ctx.fillRect(-Math.max(rx, ry), -Math.max(rx, ry), Math.max(rx, ry) * 2, Math.max(rx, ry) * 2);
      ctx.restore();
    }
  }

  // --- bumped corners: pale wedges where the board has been knocked ---
  for (const [cx, cy] of [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ] as const) {
    const r = (1.6 + wear * 6 + rnd() * 2) * px;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, tones.light(34, -28, 0.2 + wear * 0.42));
    g.addColorStop(1, tones.light(34, -28, 0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  // --- grime pooled at the tail (books are shelved bottom-first) ---
  const grime = ctx.createLinearGradient(0, h * 0.86, 0, h);
  grime.addColorStop(0, 'rgba(44, 34, 22, 0)');
  grime.addColorStop(1, `rgba(44, 34, 22, ${(0.08 + wear * 0.22).toFixed(3)})`);
  ctx.fillStyle = grime;
  ctx.fillRect(0, h * 0.86, w, h * 0.14);

  // --- worn through: the head and tail caps of a truly well-loved book give
  // out first, and the joint frays back to the board underneath ---
  if (wear > 0.8) {
    const t = (wear - 0.8) / 0.2;
    for (const capY of [0, h] as const) {
      const dir = capY === 0 ? 1 : -1;
      const capH = (2.5 + t * 5) * px;
      const g = ctx.createLinearGradient(0, capY, 0, capY + dir * capH);
      g.addColorStop(0, tones.light(36, -32, 0.3 + t * 0.34));
      g.addColorStop(1, tones.light(36, -32, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, Math.min(capY, capY + dir * capH), w, capH);
      // A nick out of the cap.
      ctx.fillStyle = tones.light(30, -30, 0.24 + t * 0.3);
      const nx = (0.2 + rnd() * 0.6) * w;
      ctx.beginPath();
      ctx.ellipse(nx, capY, (1.6 + rnd() * 3) * px, (1.4 + t * 3.4) * px, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- hairline cracks in the joint, only when truly well-loved ---
  if (wear > 0.62) {
    ctx.strokeStyle = 'rgba(38, 28, 18, 0.34)';
    ctx.lineWidth = Math.max(0.4, 0.6 * px);
    const cracks = Math.round((wear - 0.62) * 12);
    for (let i = 0; i < cracks; i++) {
      const x0 = rnd() < 0.5 ? 1.5 * px : w - 1.5 * px;
      const y0 = rnd() < 0.5 ? rnd() * h * 0.22 : h * (0.78 + rnd() * 0.22);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      let cxp = x0;
      let cyp = y0;
      for (let k = 0; k < 4; k++) {
        cxp += (rnd() * 2 - 1) * 3 * px;
        cyp += (rnd() < 0.5 ? -1 : 1) * (2 + rnd() * 5) * px;
        ctx.lineTo(cxp, cyp);
      }
      ctx.stroke();
    }
  }

  ctx.restore();
}

/* ------------------------------ panel layout ----------------------------- */

interface Panel {
  y0: number;
  y1: number;
}

/**
 * Split the spine into the panels a binder would work with: the zone between
 * head and tail, cut by the raised cords and by whatever band the charm
 * occupies. Title goes in one panel, the ornament stamp in another — exactly
 * how real tooled spines are laid out.
 */
function spinePanels(
  cordYs: readonly number[],
  reserve: Panel | null,
  /**
   * Half-thickness of a cut (cord or band rule) as a fraction of the spine
   * height. Panels are held clear of it — otherwise a raised cord runs
   * straight through the middle of the lettering, which is exactly what the
   * first pass of this did.
   */
  cutPad = 0,
): Panel[] {
  const zoneTop = 0.055;
  const zoneBot = 0.945;
  const cuts: Panel[] = [];
  let prev = zoneTop;
  for (const y of [...cordYs].sort((a, b) => a - b)) {
    if (y - cutPad > prev) cuts.push({ y0: prev, y1: y - cutPad });
    prev = Math.max(prev, y + cutPad);
  }
  if (zoneBot > prev) cuts.push({ y0: prev, y1: zoneBot });

  if (!reserve) return cuts;
  const out: Panel[] = [];
  for (const p of cuts) {
    if (reserve.y1 <= p.y0 || reserve.y0 >= p.y1) {
      out.push(p);
      continue;
    }
    if (reserve.y0 > p.y0) out.push({ y0: p.y0, y1: reserve.y0 });
    if (reserve.y1 < p.y1) out.push({ y0: reserve.y1, y1: p.y1 });
  }
  return out;
}

/* -------------------------------- render --------------------------------- */

export interface RenderSpineOptions {
  /**
   * Hi-res variant: adds the vertical title with per-glyph baseline wobble.
   * Lo-res LOD bakes skip text entirely (illegible at that size anyway).
   */
  hiRes?: boolean;

  /* ---------------------- painterly rebuild (§1, §2) ---------------------- */

  /**
   * The room's light rig. Defaults to the house golden-hour rig. Every book on
   * a shelf must be handed the SAME rig or the row falls apart — one sun.
   */
  rig?: LightRig;
  /**
   * Where this book sits along the row, 0 (far end from the key) → 1 (nearest
   * the key). Drives how much key light the spine takes, so a row reads as a
   * single gradient rather than thirty identically-lit rectangles.
   * Default 0.5.
   */
  rowPhase?: number;
  /**
   * How far back in the shelf the book sits, 0 (proud of the edge) →
   * 1 (pushed to the back board). Drives AO and atmospheric haze.
   * Default derived from `params.proud`.
   */
  depth?: number;
  /**
   * The neighbouring spines' colours, for the reference's colour bleeding.
   * Pass `null` for "nothing there" (the end of a run, or a gap).
   */
  neighbourLeft?: string | null;
  neighbourRight?: string | null;
  /**
   * Bake the light passes into the spine texture. Default true. Set false when
   * the compositor lights the sprite itself (e.g. a Pixi filter pass), so the
   * light is not applied twice.
   */
  light?: boolean;
  /**
   * Draw the page-block edge beside the spine. Default true. The reference has
   * one next to *every* spine; this exists only so the pull-out cover, which
   * paints its own fore-edge, can suppress it.
   */
  pageBlock?: boolean;
}

/**
 * Render one spine at (x, y) on `ctx`. hPx is the spine height in canvas px;
 * `scale` converts world px → canvas px (params.w * scale = drawn width).
 *
 * params.lean and params.hJitter are NOT applied here — spines are baked
 * upright into atlas rects; the shelf compositor applies lean/height when
 * placing the sprite.
 *
 * Layer order per the docs: base silhouette fill → two layered multiply
 * watercolor gradients → 2px inset pigment-pooling edge → texture → bands →
 * ornament stamp → title (hiRes) → shared granulation overlay → pencil edges.
 */
export function renderSpine(
  ctx: Ctx2D,
  params: SpineParams,
  x: number,
  y: number,
  hPx: number,
  scale: number,
  title: string,
  opts: RenderSpineOptions = {},
): void {
  const w = params.w * scale;
  const h = hPx;
  const duo = PALETTES[params.palette % PALETTES.length] as readonly [HSL, HSL];
  const [colA, colB] = duo;
  const hue = params.hueJitter;
  const rnd = mulberry32((params.seed ^ 0x51ab) >>> 0);

  // --- resolved studio style (all optional fields get a stable default) ---
  const material = params.material ?? materialFromTexture(params.texture);
  const wear = clamp(params.wear ?? 0.12, 0, 1);
  const raisedBands = clamp(Math.round(params.raisedBands ?? 0), 0, MAX_RAISED_BANDS);
  const bandGilt = params.bandGilt ?? params.gilt;
  const headTailStyle = clamp(Math.round(params.headTailStyle ?? 0), 0, 2);
  const ornamentOn = params.ornamentOn ?? true;
  const titlePlate: TitlePlateStyle = params.titlePlate ?? 'none';
  const edge = params.edge ?? 'plain';
  const charm: CharmKind = params.charm ?? 'none';
  const boardStyle = clamp(Math.round(params.boardStyle ?? 0), 0, MAX_BOARD_STYLE);
  const round = clamp(params.round ?? 0.4, 0, 1);
  const foilWear = clamp(params.foilWear ?? wear * 0.6, 0, 1);
  const sunFade = clamp(params.sunFade ?? 0, 0, 1);
  const knock = clamp(params.knock ?? wear * 0.5, 0, 1);
  const tones: MaterialTones = {
    light: (dl = 0, ds = 0, a = 1) => hslStr(colA, hue, dl, ds, a),
    dark: (dl = 0, ds = 0, a = 1) => hslStr(colB, hue, dl, ds, a),
  };

  /* --- the light this book sits in -------------------------------------- */
  const rig = opts.rig ?? DEFAULT_LIGHT_RIG;
  const lightOn = opts.light !== false;
  const rowPhase = clamp(opts.rowPhase ?? 0.5, 0, 1);
  const depth = clamp(
    opts.depth ?? 0.5 - clamp((params.proud ?? 0) / 20, -0.5, 0.5),
    0,
    1,
  );
  // A book at the far end of the row from the key takes ~55% of the key a book
  // right under it does. That single gradient across a row is most of what
  // makes a shelf read as *lit* rather than *coloured in*.
  const keyTake = lerp(0.45, 1.15, rowPhase) * lerp(1, 0.62, depth);
  const src = keyToSource(rig);
  /** Which side of the spine the key comes from: +1 = right, -1 = left. */
  const keySide = src.x >= 0 ? 1 : -1;

  ctx.save();
  ctx.translate(x, y);

  // --- silhouette fill path (jittered, corners worn round) ---
  // `knock` is the book's bump history, independent of how faded it is: a
  // pristine book that has been dropped still has rounded board corners, and
  // that irregularity at the silhouette is what stops a row reading as a bar
  // chart even before any of the surface detail lands.
  const outline = applyOutlineWear(
    silhouetteOutline(params.silhouette, w, h),
    clamp(wear + knock * 0.45, 0, 1),
    scale,
    rnd,
  );
  const step = Math.max(4, 6 * scale);
  const fillPts = densifyJitter(outline, step, 0.6 * scale, rnd);
  tracePoly(ctx, fillPts, true);
  ctx.fillStyle = hslStr(colA, hue);
  ctx.fill();

  // Everything painterly happens clipped to the silhouette.
  ctx.save();
  tracePoly(ctx, fillPts, true);
  ctx.clip();

  // --- two layered multiply watercolor gradients ---
  const g1 = ctx.createLinearGradient(0, 0, 0, h);
  g1.addColorStop(0, hslStr(colA, hue, 8));
  g1.addColorStop(0.55, hslStr(colA, hue));
  g1.addColorStop(1, hslStr(colB, hue));
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = g1;
  ctx.fillRect(-w * 0.05, 0, w * 1.1, h);

  const g2 = ctx.createLinearGradient(0, 0, w, 0);
  g2.addColorStop(0, hslStr(colB, hue, -6));
  g2.addColorStop(0.18, hslStr(colA, hue, 10));
  g2.addColorStop(0.82, hslStr(colA, hue, 6));
  g2.addColorStop(1, hslStr(colB, hue, -8));
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = g2;
  ctx.fillRect(-w * 0.05, 0, w * 1.1, h);

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // --- two-tone binding: darker partner tone over the head section ---
  if (params.twoTone) {
    const splitY = params.twoToneSplit * h;
    const g3 = ctx.createLinearGradient(0, 0, 0, splitY);
    g3.addColorStop(0, hslStr(colB, hue, -2, 4, 0.92));
    g3.addColorStop(1, hslStr(colB, hue, -10, 2, 0.92));
    ctx.fillStyle = g3;
    ctx.fillRect(-w * 0.05, 0, w * 1.1, splitY);
    // Separating rule where the tones meet: gilt on gilt books, ink else.
    if (params.gilt) {
      ctx.fillStyle = GOLD;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(w * 0.04, splitY - 1.1 * scale, w * 0.92, 2.2 * scale);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = hslStr(colB, hue, -22, 0, 0.7);
    ctx.lineWidth = Math.max(0.7, 0.8 * scale);
    strokePts(
      ctx,
      jitteredSegment({ x: 0, y: splitY }, { x: w, y: splitY }, step, 0.4 * scale, rnd),
      false,
    );
  }

  // --- 2px inset pigment-pooling edge (stroke inside the clip) ---
  tracePoly(ctx, fillPts, true);
  ctx.lineWidth = 4 * scale; // clipped: only the inner ~2px shows
  ctx.strokeStyle = hslStr(colB, hue, -12, 0, 0.5);
  ctx.stroke();

  // --- binding material (seven materials × three sub-treatments) ---
  ctx.globalAlpha = 1;
  paintBindingMaterial(ctx, w, h, material, tones, scale, rnd, boardStyle);

  // --- round back: the spine is a shallow cylinder, not a flat card ---
  // Real books are backed round; the flat fill we had is what made every spine
  // read as a painted strip. Shading the width as a cylinder — dark at both
  // joints, a lit crown offset toward the key — costs one gradient and gives
  // the row its whole sense of solidity.
  if (round > 0.03) {
    const crown = clamp(0.5 + keySide * 0.16 * (lightOn ? 1 : 0), 0.2, 0.8);
    const rg = ctx.createLinearGradient(0, 0, w, 0);
    const deep = 0.34 * round;
    const lift = 0.26 * round;
    rg.addColorStop(0, hslStr(colB, hue, -30, 0, deep));
    rg.addColorStop(Math.max(0.06, crown - 0.34), hslStr(colB, hue, -14, 0, deep * 0.35));
    rg.addColorStop(crown, hslStr(colA, hue, 22, -6, lift));
    rg.addColorStop(Math.min(0.94, crown + 0.34), hslStr(colB, hue, -16, 0, deep * 0.42));
    rg.addColorStop(1, hslStr(colB, hue, -32, 0, deep * 1.05));
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);
    // The two joints (where the spine leather turns onto the boards) are the
    // darkest line on any book. Two crease occlusions, one per joint.
    const jointR = Math.max(0.8, w * 0.1);
    applyCreaseOcclusion(ctx, {
      rig,
      x: 0,
      y: 0,
      length: h,
      axis: 'vertical',
      reach: jointR,
      strength: 0.7 * round,
      bias: 0.55,
    });
    applyCreaseOcclusion(ctx, {
      rig,
      x: w,
      y: 0,
      length: h,
      axis: 'vertical',
      reach: jointR,
      strength: 0.7 * round,
      bias: -0.55,
    });
  }

  // --- text-block edge: the sliver of pages showing at the fore-joint ---
  // Widened hard from the old `w * 0.075` cap: the art direction's very first
  // book note is "visible page-block edges beside every spine", and a 2px
  // sliver is not visible at shelf scale. `params.pageBlock` carries the
  // per-book fraction, and thin books show proportionally more.
  const blockFrac = clamp(params.pageBlock ?? 0.1, 0.05, 0.24);
  const edgeW =
    opts.pageBlock === false ? 0 : clamp(w * blockFrac, 2.2 * scale, 9 * scale);
  if (edgeW > 0.5) {
    const blockX = keySide > 0 ? w - edgeW : 0;
    paintEdgeTreatment(ctx, blockX, h * 0.012, edgeW, h * 0.976, edge, scale, rnd);
    // The page block stands a hair proud of the boards, so it takes its own
    // key light and throws its own tiny shadow back onto the spine.
    if (lightOn) {
      applyKeyLight(ctx, {
        rig,
        x: blockX,
        y: h * 0.012,
        width: edgeW,
        height: h * 0.976,
        intensity: keyTake * 1.15,
        hotSpot: 0.2,
      });
    }
    castContactShadow(ctx, {
      rig,
      x: keySide > 0 ? blockX : blockX + edgeW,
      y: h * 0.012,
      length: h * 0.976,
      depth: Math.max(1.2, edgeW * 0.6),
      side: keySide > 0 ? 'left' : 'right',
      strength: 0.7,
      skew: 0,
    });
    // Head and tail of the block: you see the top few leaves from above.
    const capH = Math.max(0.8, 1.6 * scale);
    const capG = ctx.createLinearGradient(0, 0, 0, capH * 2.4);
    capG.addColorStop(0, 'rgba(246, 238, 214, 0.7)');
    capG.addColorStop(1, 'rgba(246, 238, 214, 0)');
    ctx.fillStyle = capG;
    ctx.fillRect(blockX, 0, edgeW, capH * 2.4);
  }

  // --- bands (embossed: every dark rule carries a catchlight rule above) ---
  const inkBand = hslStr(colB, hue, -18, 0, 0.8);
  const embossLight = hslStr(colA, hue, 26, -8, 0.5);
  const legacyBands = raisedBands > 0 ? [] : params.bands;
  for (const band of legacyBands) {
    const by = band.y * h;
    if (band.kind === 0) {
      // embossed double-rule: light/dark pairs read as raised cords
      ctx.lineWidth = Math.max(0.7, 0.7 * scale);
      for (const dy of [-1.8 * scale, 1.8 * scale]) {
        ctx.strokeStyle = embossLight;
        strokePts(ctx, jitteredSegment({ x: w * 0.06, y: by + dy - 0.9 * scale }, { x: w * 0.94, y: by + dy - 0.9 * scale }, step, 0.35 * scale, rnd), false);
        ctx.strokeStyle = inkBand;
        strokePts(ctx, jitteredSegment({ x: w * 0.06, y: by + dy }, { x: w * 0.94, y: by + dy }, step, 0.4 * scale, rnd), false);
      }
    } else if (band.kind === 1) {
      // thick raised band: shaded fill, catchlight on top, shadow below
      ctx.fillStyle = hslStr(colB, hue, -8, 0, 0.65);
      ctx.fillRect(0, by - 3 * scale, w, 6 * scale);
      ctx.strokeStyle = embossLight;
      ctx.lineWidth = Math.max(0.6, 0.6 * scale);
      strokePts(ctx, jitteredSegment({ x: 0, y: by - 3.8 * scale }, { x: w, y: by - 3.8 * scale }, step, 0.35 * scale, rnd), false);
      ctx.strokeStyle = inkBand;
      ctx.lineWidth = Math.max(0.7, 0.7 * scale);
      for (const dy of [-3 * scale, 3 * scale]) {
        strokePts(ctx, jitteredSegment({ x: 0, y: by + dy }, { x: w, y: by + dy }, step, 0.4 * scale, rnd), false);
      }
    } else {
      // gilt band with an embossed shadow under the gold
      ctx.fillStyle = hslStr(colB, hue, -20, 0, 0.4);
      ctx.fillRect(w * 0.05, by + 1.2 * scale, w * 0.9, 1.2 * scale);
      ctx.fillStyle = GOLD;
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(w * 0.05, by - 1.4 * scale, w * 0.9, 2.8 * scale);
      ctx.globalAlpha = prevAlpha;
      ctx.fillStyle = 'rgba(255, 244, 214, 0.55)';
      ctx.fillRect(w * 0.08, by - 1.4 * scale, w * 0.84, 0.8 * scale);
      ctx.strokeStyle = hslStr(colB, hue, -20, 0, 0.5);
      ctx.lineWidth = Math.max(0.5, 0.5 * scale);
      strokePts(ctx, jitteredSegment({ x: w * 0.05, y: by }, { x: w * 0.95, y: by }, step, 0.3 * scale, rnd), false);
    }
  }

  // --- raised bands (cords sewn under the leather), 0–5, optionally gilt ---
  const cordYs: number[] = [];
  if (raisedBands > 0) {
    const zTop = 0.085;
    const zBot = 0.915;
    for (let i = 0; i < raisedBands; i++) {
      cordYs.push(zTop + ((i + 1) / (raisedBands + 1)) * (zBot - zTop));
    }
  }
  // Cords are FAT — a sewn cord under leather stands a real 3–4mm proud, and
  // the timid 3px band we drew before was the difference between "raised
  // bands casting their own tiny shadows" and "painted lines".
  const cordH = clamp(w * 0.24, 4.2 * scale, 11 * scale);
  for (const cy of cordYs) {
    const by = cy * h;
    const top = by - cordH / 2;

    // 1. The cord's OWN cast shadow onto the panel beneath it. This is the
    //    spec's raised-band note, and it has to happen before the cord is
    //    drawn so the cord sits on top of its own shadow.
    castContactShadow(ctx, {
      rig,
      x: -w * 0.02,
      y: top + cordH,
      length: w * 1.04,
      depth: cordH * 0.95,
      side: 'below',
      strength: 0.85,
      gap: cordH * 0.25,
      skew: cordH * 0.4,
      taper: w * 0.1,
    });

    // 2. The cord body: a true cylinder lit by the rig, not a stack of stops.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, w, cordH);
    ctx.clip();
    // Base tone first — the leather is stretched thinner over the cord, so it
    // reads a shade lighter and less saturated than the panel.
    ctx.fillStyle = hslStr(colA, hue, 6, -4, 0.9);
    ctx.fillRect(0, top, w, cordH);
    ctx.fillStyle = cylinderShading(ctx, rig, w / 2, top + cordH / 2, cordH / 2, 0);
    ctx.fillRect(0, top, w, cordH);
    // The leather's own grain still runs over the cord.
    tileOver(
      ctx,
      getMaterialTile(material === 'leather' && boardStyle === 1 ? 'morocco' : 'pebble'),
      w,
      cordH,
      Math.max(20, 44 * scale),
      0.2,
    );
    ctx.restore();

    // 3. Crown catchlight — a thin specular streak along the top of the roll.
    const crownY = top + cordH * (keySide > 0 ? 0.3 : 0.32);
    ctx.lineWidth = Math.max(0.6, 0.8 * scale);
    ctx.strokeStyle = withAlpha(blowOut(rig.rimColour, 0.4), 0.42 * keyTake);
    strokePts(
      ctx,
      jitteredSegment({ x: 0, y: crownY }, { x: w, y: crownY }, step, 0.3 * scale, rnd),
      false,
    );

    // 4. The two seat lines where the cord meets the panel.
    ctx.strokeStyle = hslStr(colB, hue, -34, 0, 0.55);
    ctx.lineWidth = Math.max(0.5, 0.6 * scale);
    for (const sy of [top, top + cordH]) {
      strokePts(
        ctx,
        jitteredSegment({ x: 0, y: sy }, { x: w, y: sy }, step, 0.3 * scale, rnd),
        false,
      );
    }

    if (bandGilt) {
      // A gold rule tooled tight against each side of the cord, each with its
      // own debossed shadow so the gold sits *in* the leather.
      for (const gy of [top - cordH * 0.34, top + cordH * 1.12]) {
        const gh = Math.max(0.8, 1.2 * scale);
        ctx.fillStyle = hslStr(colB, hue, -30, 0, 0.45);
        ctx.fillRect(w * 0.07, gy + gh * 0.85, w * 0.86, gh * 0.8);
        ctx.fillStyle = GOLD;
        ctx.globalAlpha = 0.92;
        ctx.fillRect(w * 0.07, gy, w * 0.86, gh);
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(255, 246, 216, 0.5)';
        ctx.fillRect(w * 0.07, gy, w * 0.86, gh * 0.4);
      }
      if (lightOn) {
        applySpecularCatch(ctx, {
          rig,
          x: w * (keySide > 0 ? 0.72 : 0.28),
          y: top - cordH * 0.34,
          radius: Math.max(1.4, w * 0.16),
          aspect: 3.4,
          angle: 0,
          strength: 0.55 * keyTake,
          colour: '#fff2c0',
        });
      }
    }
  }

  // --- head/tail endbands: striped caps at the very top and bottom ---
  if (params.headTail) {
    // Real endbands are a *fine* two-colour silk twist, only a few threads
    // deep. Kept low-contrast and shallow here: at shelf scale a loud band
    // reads as hazard tape across the top of every book.
    const bandH = 3.2 * scale;
    const stripeW = Math.max(1.5 * scale, 2);
    const capColor = params.gilt ? GOLD : hslStr(colB, hue, -6, -6);
    const creamColor = 'hsl(41 40% 82%)';
    for (const [cy0, edgeY] of [
      [0.6 * scale, 0],
      [h - bandH - 0.6 * scale, h],
    ] as const) {
      ctx.fillStyle = creamColor;
      ctx.globalAlpha = 0.62;
      ctx.fillRect(w * 0.04, cy0, w * 0.92, bandH);
      ctx.globalAlpha = 0.62;
      ctx.fillStyle = capColor;
      if (headTailStyle === 1) {
        // Chevron endband: slanted stripes, the classic two-colour sewing.
        for (let sx = w * 0.02; sx < w * 0.98; sx += stripeW * 2) {
          ctx.beginPath();
          ctx.moveTo(sx, cy0 + bandH);
          ctx.lineTo(sx + stripeW, cy0 + bandH);
          ctx.lineTo(sx + stripeW + bandH * 0.8, cy0);
          ctx.lineTo(sx + bandH * 0.8, cy0);
          ctx.closePath();
          ctx.fill();
        }
      } else if (headTailStyle === 2) {
        // Wrapped cord: a rounded core with thread spiralling round it.
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = creamColor;
        ctx.fillRect(w * 0.04, cy0, w * 0.92, bandH);
        ctx.globalAlpha = 0.62;
        ctx.strokeStyle = capColor;
        ctx.lineWidth = Math.max(0.7, 0.9 * scale);
        for (let sx = w * 0.03; sx < w * 0.99; sx += stripeW * 1.35) {
          ctx.beginPath();
          ctx.moveTo(sx, cy0 + bandH);
          ctx.lineTo(sx + bandH * 0.75, cy0);
          ctx.stroke();
        }
        // Crown highlight so the cord reads round.
        ctx.strokeStyle = 'rgba(255, 250, 232, 0.32)';
        ctx.lineWidth = Math.max(0.5, 0.6 * scale);
        ctx.beginPath();
        ctx.moveTo(w * 0.05, cy0 + bandH * 0.3);
        ctx.lineTo(w * 0.95, cy0 + bandH * 0.3);
        ctx.stroke();
      } else {
        for (let sx = w * 0.04; sx < w * 0.96; sx += stripeW * 2) {
          ctx.fillRect(sx, cy0, Math.min(stripeW, w * 0.96 - sx), bandH);
        }
      }
      ctx.globalAlpha = 1;
      // Seat line where the endband meets the boards.
      ctx.strokeStyle = hslStr(colB, hue, -24, 0, 0.4);
      ctx.lineWidth = Math.max(0.5, 0.5 * scale);
      const seamY = edgeY === 0 ? cy0 + bandH : cy0;
      strokePts(ctx, jitteredSegment({ x: w * 0.03, y: seamY }, { x: w * 0.97, y: seamY }, step, 0.35 * scale, rnd), false);
    }
  }

  // --- tooling panels: title in one, ornament in another ---
  const reserve = charmSpineReserve(charm);
  // Anything drawn ACROSS the spine is a cut the lettering has to respect:
  // the sewn cords when there are any, the decorative rules when there are not.
  const cutYs = raisedBands > 0 ? cordYs : legacyBands.map((b) => b.y);
  const cutPad = h > 0 ? (raisedBands > 0 ? cordH * 0.95 : 4.6 * scale) / h : 0;
  const panels = spinePanels(cutYs, reserve, cutPad).filter((p) => p.y1 - p.y0 > 0.045);
  let titlePanel: Panel | null = null;
  let ornamentPanel: Panel | null = null;
  if (panels.length > 0) {
    // Binder's convention: title goes in the second panel from the head when
    // there is one, otherwise the tallest panel in the upper half.
    const upper = panels.filter((p) => (p.y0 + p.y1) / 2 < 0.68);
    const pool = upper.length > 0 ? upper : panels;
    const tallest = pool.reduce((a, b) => (b.y1 - b.y0 > a.y1 - a.y0 ? b : a));
    const second = panels.length > 1 ? (panels[1] as Panel) : null;
    // Follow the convention only when it costs (almost) nothing: on a heavily
    // corded spine the second panel can be much shorter than the best one, and
    // an elided title is a worse crime than an unconventional one.
    titlePanel =
      second !== null && second.y1 - second.y0 >= (tallest.y1 - tallest.y0) * 0.8
        ? second
        : tallest;
    const below = panels.filter((p) => p !== titlePanel && p.y0 >= (titlePanel as Panel).y1 - 1e-6);
    const rest = below.length > 0 ? below : panels.filter((p) => p !== titlePanel);
    if (rest.length > 0) {
      ornamentPanel = rest.reduce((a, b) => (b.y1 - b.y0 > a.y1 - a.y0 ? b : a));
      if (ornamentPanel.y1 - ornamentPanel.y0 < 0.085) ornamentPanel = null;
    }
    if (!ornamentPanel && panels.length === 1) {
      // Single panel: give the ornament the tail quarter and shorten the title.
      const only = panels[0] as Panel;
      ornamentPanel = { y0: only.y0 + (only.y1 - only.y0) * 0.74, y1: only.y1 };
      titlePanel = { y0: only.y0, y1: ornamentPanel.y0 };
    }
  }

  // --- title plate + vertical title ---
  const trnd = mulberry32((params.seed ^ 0x7115) >>> 0);
  if (titlePanel) {
    const py0 = titlePanel.y0 * h;
    const py1 = titlePanel.y1 * h;
    const pad = 4 * scale;
    const availLen = Math.max(0, py1 - py0 - pad * 2);
    const family = FONTS[params.font] as string;
    // A binder letters the title to FIT the panel: he picks smaller tools
    // before he abbreviates. So shrink the face first (down to the legibility
    // floor), and only then elide — a spine that says "Constellati…" is a bug,
    // one that says "Cons" is a disaster.
    const maxFont = clamp(w * 0.52, 10 * scale, 20 * scale);
    const minFont = Math.max(6.5 * scale, maxFont * 0.52);
    // Cursive faces overhang their advance width; keep a little air so the
    // last glyph's tail never crosses the plate border.
    const fitLen = Math.max(0, availLen - pad * 0.9);
    let fontPx = maxFont;
    let text = title.trim();
    const measure = (t: string): number => {
      ctx.font = `${fontPx.toFixed(2)}px ${family}`;
      let sum = 0;
      for (const ch of t) sum += ctx.measureText(ch).width;
      return sum;
    };
    if (opts.hiRes && text.length > 0 && fitLen > 0) {
      while (measure(text) > fitLen && fontPx > minFont) fontPx = Math.max(minFont, fontPx * 0.94);
      if (measure(text) > fitLen) {
        // Still too long at the floor: elide on a word boundary when one is
        // near the end, otherwise clip and mark it with an ellipsis.
        while (text.length > 1 && measure(`${text}…`) > fitLen) text = text.slice(0, -1);
        const trimmed = text.replace(/[\s,;:.-]+$/u, '');
        text = `${trimmed.length > 0 ? trimmed : text}…`;
      }
    } else {
      text = '';
    }
    ctx.font = `${fontPx.toFixed(2)}px ${family}`;

    const glyphs: Array<{ ch: string; adv: number }> = [];
    let textLen = 0;
    for (const ch of text) {
      const cw = ctx.measureText(ch).width;
      glyphs.push({ ch, adv: cw });
      textLen += cw;
    }
    const plateLen =
      textLen > 0
        ? Math.min(availLen, textLen + pad * 2.6)
        : Math.min(availLen, (py1 - py0) * 0.6);
    const plateW = Math.min(w * 0.78, fontPx * 1.9);
    const plateX = w * 0.5 - plateW / 2;
    const plateY = (py0 + py1) / 2 - plateLen / 2;

    if (titlePlate !== 'none' && plateLen > 6 * scale) {
      ctx.save();
      if (titlePlate === 'gilt') {
        ctx.fillStyle = hslStr(colB, hue, -8, 2, 0.32);
        ctx.fillRect(plateX, plateY, plateW, plateLen);
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = Math.max(0.9, 1.3 * scale);
        jitterRectStroke(ctx, plateX, plateY, plateW, plateLen, step, 0.4 * scale, rnd);
        ctx.strokeStyle = 'rgba(201, 162, 39, 0.55)';
        ctx.lineWidth = Math.max(0.5, 0.7 * scale);
        // Inner rule inset proportionally, so small plates do not end up with
        // two rules sitting on top of each other.
        const gi = Math.min(3.2 * scale, plateW * 0.14, plateLen * 0.1);
        jitterRectStroke(ctx, plateX + gi, plateY + gi, plateW - gi * 2, plateLen - gi * 2, step, 0.35 * scale, rnd);
      } else if (titlePlate === 'label') {
        ctx.fillStyle = 'rgba(40, 32, 22, 0.32)';
        ctx.fillRect(plateX + 1.2 * scale, plateY + 1.6 * scale, plateW, plateLen);
        ctx.fillStyle = '#efe3c4';
        ctx.fillRect(plateX, plateY, plateW, plateLen);
        // Ruled border + a hint of the paper's own tone at the edges.
        ctx.strokeStyle = 'rgba(120, 96, 58, 0.55)';
        ctx.lineWidth = Math.max(0.5, 0.7 * scale);
        jitterRectStroke(ctx, plateX + 1.8 * scale, plateY + 1.8 * scale, plateW - 3.6 * scale, plateLen - 3.6 * scale, step, 0.4 * scale, rnd);
        ctx.strokeStyle = 'rgba(150, 124, 82, 0.4)';
        jitterRectStroke(ctx, plateX, plateY, plateW, plateLen, step, 0.5 * scale, rnd);
      } else {
        // debossed: pressed into the binding — dark top/left, lit bottom/right
        ctx.fillStyle = hslStr(colB, hue, -12, 0, 0.4);
        ctx.fillRect(plateX, plateY, plateW, plateLen);
        ctx.strokeStyle = hslStr(colB, hue, -32, 0, 0.7);
        ctx.lineWidth = Math.max(0.7, 1 * scale);
        ctx.beginPath();
        ctx.moveTo(plateX, plateY + plateLen);
        ctx.lineTo(plateX, plateY);
        ctx.lineTo(plateX + plateW, plateY);
        ctx.stroke();
        ctx.strokeStyle = hslStr(colA, hue, 28, -8, 0.55);
        ctx.beginPath();
        ctx.moveTo(plateX + plateW, plateY);
        ctx.lineTo(plateX + plateW, plateY + plateLen);
        ctx.lineTo(plateX, plateY + plateLen);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (glyphs.length > 0) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      // Letter the title in whatever actually reads against the panel it sits
      // on. A binder never tools dark ink onto navy cloth — he uses gold or a
      // white foil — and "near-black on near-black" was the single worst
      // legibility bug on the shelf.
      const lift = material === 'vellum' ? 20 : material === 'paper' ? 9 : 0;
      const panelL = colA.l * 0.55 + colB.l * 0.45 + lift + wear * 6;
      const onLabel = titlePlate === 'label';
      const goldTitle = !onLabel && (titlePlate === 'gilt' || params.gilt);
      const paleTitle = !onLabel && !goldTitle && panelL < 48;
      const titleInk = onLabel
        ? hslStr(colB, hue, -34, 6, 0.95)
        : goldTitle
          ? GOLD
          : paleTitle
            ? hslStr(colA, hue, clamp(94 - colA.l, 0, 100), -46, 0.94)
            : hslStr(colB, hue, -38, 0, 0.94);
      // Every tooled title is stamped INTO the binding, so it always carries a
      // relief edge. Drawing it unconditionally (not just for `debossed`) is
      // also the belt-and-braces that keeps a title readable on a ground whose
      // lightness sits right on the pale/deep decision boundary.
      const reliefInk = onLabel
        ? null
        : paleTitle
          ? hslStr(colB, hue, -30, 0, 0.5)
          : hslStr(colA, hue, 26, -12, 0.5);
      const runY0 = (py0 + py1) / 2 - textLen / 2;
      ctx.save();
      ctx.translate(w / 2, runY0);
      ctx.rotate(Math.PI / 2);
      let advance = 0;
      for (const g of glyphs) {
        // Per-glyph baseline wobble: rnd()*1.2 - 0.6 px (scaled).
        const wob = (trnd() * 1.2 - 0.6) * scale;
        if (reliefInk !== null) {
          // Stamped INTO the binding: a dark bite on the side the light comes
          // from and a lit lip opposite, not a flat drop shadow.
          ctx.fillStyle = hslStr(colB, hue, -34, 0, 0.4);
          ctx.fillText(g.ch, advance - 0.55 * scale * keySide, wob - 0.6 * scale);
          ctx.fillStyle = reliefInk;
          ctx.fillText(g.ch, advance + 0.75 * scale, wob + 0.75 * scale);
        }
        if (goldTitle) {
          // Real foil is not one flat gold: it is a burnished ramp, brightest
          // where the light rakes it. Painting each glyph with a gradient in
          // the RUN's direction is what makes a tooled title catch the eye.
          const gg = ctx.createLinearGradient(advance, -fontPx * 0.55, advance, fontPx * 0.55);
          gg.addColorStop(0, '#8a6a14');
          gg.addColorStop(0.28, '#f5e29b');
          gg.addColorStop(0.5, GOLD);
          gg.addColorStop(0.74, '#fff2c4');
          gg.addColorStop(1, '#7d5f12');
          ctx.fillStyle = gg;
        } else {
          ctx.fillStyle = titleInk;
        }
        ctx.fillText(g.ch, advance, wob);
        advance += g.adv;
      }
      ctx.restore();

      // --- foil wear + specular catch -----------------------------------
      // "Gold foil titles that CATCH the light, half-legible, some worn away."
      // Beauty over legibility at shelf scale: a perfectly crisp title on every
      // book is the single most machine-made thing on a shelf.
      if (goldTitle) {
        const runLen = textLen;
        const runX0 = w / 2 - fontPx * 0.6;

        if (foilWear > 0.04 && runLen > 2) {
          // Rub the foil back to the binding underneath, in patches — foil
          // wears where fingers and neighbours touch it, not uniformly.
          const rubs = Math.round(4 + foilWear * 26);
          for (let i = 0; i < rubs; i++) {
            const ry = runY0 + trnd() * runLen;
            const rx = w / 2 + (trnd() * 2 - 1) * fontPx * 0.55;
            const rr = (0.6 + trnd() * 2.4) * scale * (0.5 + foilWear);
            const g = ctx.createRadialGradient(rx, ry, 0, rx, ry, rr);
            const a = clamp(foilWear * (0.35 + trnd() * 0.6), 0, 0.9);
            g.addColorStop(0, hslStr(colB, hue, -6, 0, a));
            g.addColorStop(1, hslStr(colB, hue, -6, 0, 0));
            ctx.fillStyle = g;
            ctx.fillRect(rx - rr, ry - rr, rr * 2, rr * 2);
          }
          // Whole-run fade: at high wear the title is a ghost, and that is a
          // feature — half-legible is what the reference has.
          if (foilWear > 0.55) {
            ctx.fillStyle = hslStr(colB, hue, -4, 0, (foilWear - 0.55) * 0.5);
            ctx.fillRect(runX0, runY0 - fontPx * 0.4, fontPx * 1.3, runLen + fontPx * 0.8);
          }
        }

        if (lightOn) {
          // The catch: one hard glint travelling along the run, placed where
          // the key would rake it, plus a broad low sheen over the whole title.
          const catchAt = clamp(0.24 + rowPhase * 0.5, 0, 1);
          applySpecularCatch(ctx, {
            rig,
            x: w / 2 + keySide * fontPx * 0.14,
            y: runY0 + runLen * catchAt,
            radius: Math.max(2, fontPx * 0.85),
            aspect: 0.42,
            angle: Math.PI / 2,
            strength: clamp((1 - foilWear * 0.7) * keyTake * 1.1, 0, 1.3),
            colour: '#fff6d2',
          });
          applySpecularCatch(ctx, {
            rig,
            x: w / 2,
            y: runY0 + runLen * 0.5,
            radius: Math.max(3, runLen * 0.4),
            aspect: 0.2,
            angle: Math.PI / 2,
            strength: clamp((1 - foilWear) * keyTake * 0.32, 0, 0.6),
            colour: '#ffe9a8',
          });
        }
      }
    }
  }

  // --- ornament stamp (12 + none; the wax seal charm takes its slot) ---
  if (ornamentOn && !charmTakesOrnamentSlot(charm)) {
    const oPanel = ornamentPanel ?? { y0: 0.7, y1: 0.9 };
    const ocy = ((oPanel.y0 + oPanel.y1) / 2) * h;
    const oSize = Math.min(w * 0.36, 14 * scale, ((oPanel.y1 - oPanel.y0) * h) / 2.1);
    const inkColor = params.gilt ? GOLD : hslStr(colB, hue, -24, 0, 0.85);
    ctx.strokeStyle = inkColor;
    ctx.fillStyle = inkColor;
    ctx.lineWidth = Math.max(1, 1.1 * scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    drawOrnament(ctx, params.ornament, w / 2, ocy, Math.max(2, oSize), rnd);
  }

  // --- shared granulation overlay ---
  const tile = getGranulationTile();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.06;
  for (let ty = 0; ty < h; ty += GRANULATION_SIZE) {
    for (let tx = 0; tx < w; tx += GRANULATION_SIZE) {
      ctx.drawImage(tile, tx, ty);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // --- wear: sun-fade, scuffs, rubbed patches, grime, cracks ---
  paintWear(ctx, w, h, wear, tones, scale, rnd);

  // --- charm: the identity cue carried to the cover and the open book ---
  if (charm !== 'none') {
    drawSpineCharm(ctx, charm, w, h, {
      color: charmColorCss(params.charmColor ?? 0),
      scale,
      rnd: mulberry32((params.seed ^ 0xc4a7) >>> 0),
      gilt: params.gilt,
    });
  }

  /* ------------------------------------------------------------------ *
   *  The light passes. Everything above painted the OBJECT; everything
   *  below paints the LIGHT ON it, in the order the art direction sets
   *  out: AO in every recess → key with hot spots → rim → bleed → haze.
   * ------------------------------------------------------------------ */
  if (lightOn) {
    // --- 1. ambient occlusion -----------------------------------------
    // The head and tail of a shelved book are always occluded — one by the
    // plank above, one by the plank it stands on — and both joints are
    // occluded by the neighbours. That is four of four edges, but weighted:
    // the tail is darkest, the head next, the joints least (the round-back
    // crease already did most of that work).
    applyAmbientOcclusion(ctx, {
      rig,
      x: 0,
      y: 0,
      width: w,
      height: h,
      edges: ['bottom'],
      reach: Math.min(h * 0.3, 30 * scale),
      strength: 0.9 + depth * 0.4,
      corners: false,
    });
    applyAmbientOcclusion(ctx, {
      rig,
      x: 0,
      y: 0,
      width: w,
      height: h,
      edges: ['top'],
      reach: Math.min(h * 0.22, 22 * scale),
      strength: 0.62 + depth * 0.5,
      corners: false,
    });
    applyAmbientOcclusion(ctx, {
      rig,
      x: 0,
      y: 0,
      width: w,
      height: h,
      edges: ['left', 'right'],
      reach: Math.max(1, w * 0.22),
      strength: 0.34 + depth * 0.5,
      corners: true,
    });

    // --- 2. sun-fade on the side that faces the window -----------------
    // Independent of `wear`: this is bleaching from years of standing in the
    // same light, and it lands on ONE side of the spine — the reference's
    // books are visibly paler where the sun reached them.
    if (sunFade > 0.05) {
      const fx = keySide > 0 ? w : 0;
      const fg = ctx.createLinearGradient(fx, 0, fx - keySide * w * 0.85, 0);
      const fa = sunFade * 0.3 * (0.4 + rowPhase * 0.9);
      fg.addColorStop(0, `rgba(236, 224, 196, ${fa.toFixed(3)})`);
      fg.addColorStop(0.55, `rgba(236, 224, 196, ${(fa * 0.4).toFixed(3)})`);
      fg.addColorStop(1, 'rgba(236, 224, 196, 0)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.globalCompositeOperation = 'saturation';
      ctx.globalAlpha = sunFade * 0.34;
      const sg = ctx.createLinearGradient(fx, 0, fx - keySide * w * 0.85, 0);
      sg.addColorStop(0, 'hsl(0 0% 55%)');
      sg.addColorStop(1, 'hsl(0 0% 55% / 0)');
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // --- 3. the key ----------------------------------------------------
    applyKeyLight(ctx, {
      rig,
      x: 0,
      y: 0,
      width: w,
      height: h,
      intensity: keyTake,
      // A book facing the viewer takes the key almost head-on; the surface
      // normal is straight out of the frame, which the 2D rig treats as
      // "fully facing", so the modulation lives in `keyTake` instead.
      hotSpot: rig.hotSpot * clamp(keyTake, 0, 1) * (material === 'silk' ? 1.3 : 1),
    });

    // --- 4. the rim ----------------------------------------------------
    // Only the edges that actually face the key, and only on the vertical
    // joints plus the head: the tail sits in the plank's contact shadow and
    // must never light up.
    const edgesLit = litEdges(rig).filter((e) => e !== 'bottom');
    applyRimLight(ctx, {
      rig,
      x: 0,
      y: 0,
      width: w,
      height: h,
      edges: edgesLit,
      thickness: Math.max(1, w * 0.14),
      strength: keyTake * (material === 'vellum' || material === 'silk' ? 1.25 : 1),
    });

    // --- 5. colour bleed from the neighbours ---------------------------
    if (opts.neighbourLeft) {
      applyColourBleed(ctx, {
        x: 0,
        y: 0,
        width: w,
        height: h,
        colour: opts.neighbourLeft,
        from: 'left',
        reach: Math.max(1.5, w * 0.4),
        strength: 0.13,
      });
    }
    if (opts.neighbourRight) {
      applyColourBleed(ctx, {
        x: 0,
        y: 0,
        width: w,
        height: h,
        colour: opts.neighbourRight,
        from: 'right',
        reach: Math.max(1.5, w * 0.4),
        strength: 0.13,
      });
    }

    // --- 6. atmospheric depth for recessed books -----------------------
    if (depth > 0.55) {
      applyAtmosphericHaze(ctx, {
        rig,
        x: 0,
        y: 0,
        width: w,
        height: h,
        depth: (depth - 0.55) / 0.45,
        strength: 0.85,
      });
    }
  }

  ctx.restore(); // end clip

  // --- pencil edges: per-vertex jittered, double-stroked, alpha 0.55 ---
  ctx.strokeStyle = GRAPHITE;
  ctx.lineWidth = Math.max(0.8, 0.9 * scale);
  ctx.lineJoin = 'round';
  const passA = densifyJitter(outline, step, 0.7 * scale, rnd);
  tracePoly(ctx, passA, true);
  ctx.stroke();
  const passB = densifyJitter(outline, step, 0.55 * scale, rnd);
  ctx.save();
  ctx.translate(0.5 * scale, -0.4 * scale);
  tracePoly(ctx, passB, true);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

/* ========================================================================== *
 *                        shelf-row composition (Â§3)                          *
 * ========================================================================== *
 *
 * "Per shelf, generate a *composition*, not a row: choose a rhythm of
 *  thick/thin, tall/short, leaning/upright, proud/recessed; cluster similar
 *  bindings then break the pattern; leave occasional gaps and stacked-flat
 *  books."
 *
 * The old layout put every book in a slot of its own width with a 1â€“5px gap.
 * That is a *packing*, and packings look packed. What follows is a
 * composition: a plan of runs, each with a character, laid out left to right,
 * with the books ASSIGNED to runs by how well they suit the run's character
 * rather than taken in order.
 *
 * Everything here is pure and deterministic â€” same (books, seed) â‡’ identical
 * composition â€” so it can be unit-tested in node and cached by the shelf.
 */

/** How a book sits on the plank. */
export type BookPose =
  /** Standing square, the ordinary case. */
  | 'upright'
  /** Standing but tipped several degrees into an adjacent gap. */
  | 'leaning'
  /** Lying on its side in a stack, spine outward. */
  | 'flat'
  /** Standing, but pivoted a little so a corner of the board shows. */
  | 'angled';

/** The character of one run of books within a row. */
export type RunCharacter =
  /** A tight block of thin books â€” the row's rhythm section. */
  | 'thin-run'
  /** Ordinary mixed widths, the connective tissue. */
  | 'mixed'
  /** Two or three heavy tomes, the row's anchors. */
  | 'heavy'
  /** A cluster whose last book has fallen into the gap beside it. */
  | 'leaning-cluster'
  /** A short stack of books lying flat, filling a gap. */
  | 'flat-stack'
  /** Deliberately empty. */
  | 'gap';

/** One book handed to the composer. */
export interface RowBookInput {
  /** Stable id, echoed back on the placement (usually the book row id). */
  id: string;
  /** Art seed. */
  seed: number;
  /** Title, for the spine lettering. */
  title: string;
  /**
   * Pre-resolved params. When omitted the composer derives them from `seed`,
   * so a caller with no style overrides can pass ids and titles alone.
   */
  params?: SpineParams;
}

/** Where one book ended up. */
export interface RowPlacement {
  id: string;
  /** Index into the composer's input array. */
  index: number;
  params: SpineParams;
  title: string;
  /** Left edge of the book's footprint, world px from the row's origin. */
  x: number;
  /** Footprint width (the thickness, widened when the book leans). */
  width: number;
  /** Drawn spine height, world px. */
  height: number;
  /** Lean in degrees; positive tips the top to the right. */
  leanDeg: number;
  /**
   * Depth into the case: -1 pulled fully proud of the shelf edge,
   * 0 flush, +1 pushed to the back board. Feeds `renderSpine`'s `depth`
   * (remapped to 0â€“1) and the contact shadow's gap.
   */
  depth: number;
  /** 0â€“1 along the row, for `renderSpine`'s `rowPhase`. */
  phase: number;
  pose: BookPose;
  /** Which run this book belongs to. */
  run: number;
  runCharacter: RunCharacter;
  /** For `flat` books: how high off the plank the book lies, world px. */
  stackY: number;
  /** Empty width immediately after this book, world px. */
  gapAfter: number;
}

/** An empty stretch of plank. */
export interface RowGap {
  x: number;
  width: number;
  /** True when the gap exists because a book leans into it. */
  leanedInto: boolean;
}

/** The finished composition. */
export interface ShelfRowComposition {
  placements: RowPlacement[];
  /** Gaps between runs, for flora and props to grow into. */
  gaps: RowGap[];
  /** Total width consumed, world px. */
  width: number;
  /** Tallest drawn height in the row, world px. */
  maxHeight: number;
  /** Shortest drawn height in the row, world px. */
  minHeight: number;
  /** The run plan, in order â€” useful for tests and for debugging a bad row. */
  runs: RunCharacter[];
  /**
   * The row's skyline variation: (max - min) / max. The art direction asks for
   * 20â€“30%; the composer targets it explicitly and reports what it achieved.
   */
  skylineVariation: number;
  /** Ratio of the fattest book to the thinnest. */
  thicknessRatio: number;
}

export interface ComposeShelfRowOptions {
  /** Total width available, world px. Default 900. */
  width?: number;
  /** Composition seed. Same seed â‡’ same composition. */
  seed?: number;
  /**
   * Target skyline variation, (max-height âˆ’ min-height) / max-height.
   * Default 0.26, the middle of the spec's 20â€“30%.
   */
  skylineTarget?: number;
  /** Allow books to lean. Default true. */
  lean?: boolean;
  /** Allow flat-stacked runs. Default true. */
  flatStacks?: boolean;
  /** Allow gaps. Default true. */
  gaps?: boolean;
  /** Minimum gap between two neighbouring upright books, world px. Default 0.6. */
  minKerf?: number;
}

/** Weighted pick of a run character, avoiding repeating the previous one. */
function pickRunCharacter(
  rnd: RandomFn,
  previous: RunCharacter | null,
  remaining: number,
  allowFlat: boolean,
  allowGap: boolean,
): RunCharacter {
  const table: Array<readonly [RunCharacter, number]> = [
    ['mixed', 30],
    ['thin-run', 20],
    ['heavy', 14],
    ['leaning-cluster', 14],
    ['flat-stack', allowFlat && remaining >= 2 ? 10 : 0],
    ['gap', allowGap ? 12 : 0],
  ];
  // A run never immediately repeats itself â€” that repetition is exactly the
  // "uniform slots" failure the art direction calls out. Two gaps in a row is
  // especially bad: it reads as a missing shelf, not as breathing room.
  const filtered = table.map(([c, wgt]) =>
    c === previous ? ([c, wgt * 0.12] as const) : ([c, wgt] as const),
  );
  let total = 0;
  for (const [, wgt] of filtered) total += wgt;
  if (total <= 0) return 'mixed';
  let acc = rnd() * total;
  for (const [c, wgt] of filtered) {
    acc -= wgt;
    if (acc < 0) return c;
  }
  return 'mixed';
}

/** How many books a run of this character wants. */
function runSize(character: RunCharacter, rnd: RandomFn, remaining: number): number {
  switch (character) {
    case 'gap':
      return 0;
    case 'heavy':
      return Math.min(remaining, 1 + Math.floor(rnd() * 2.4));
    case 'flat-stack':
      return Math.min(remaining, 2 + Math.floor(rnd() * 3));
    case 'thin-run':
      return Math.min(remaining, 3 + Math.floor(rnd() * 4));
    case 'leaning-cluster':
      return Math.min(remaining, 2 + Math.floor(rnd() * 3));
    default:
      return Math.min(remaining, 2 + Math.floor(rnd() * 4));
  }
}

/**
 * Score how well a book suits a run's character. Higher is better. This is
 * the compositional heart of the module: a shelf looks *arranged* because the
 * thin books ended up together and the tomes anchor the ends, not because
 * every book got its own equal slot.
 */
function suitability(params: SpineParams, character: RunCharacter): number {
  const bw = params.w;
  const bh = spineHeightPx(params);
  switch (character) {
    case 'thin-run':
      return 100 - bw * 2.2;
    case 'heavy':
      return bw * 2.4 + bh * 0.16;
    case 'flat-stack':
      // Flat books want to be wide-ish and NOT tall (a folio lying flat eats
      // the whole shelf).
      return bw * 1.1 - Math.abs(bh - 200) * 0.28;
    case 'leaning-cluster':
      // A leaning book should be slim enough to fall convincingly.
      return 60 - Math.abs(bw - 24) * 1.5;
    default:
      return 40 - Math.abs(bw - 30) * 0.6;
  }
}

/** Shift everything right of `from` by `delta` (used when resizing a gap). */
function shiftAfter(
  placements: RowPlacement[],
  gaps: RowGap[],
  from: number,
  delta: number,
  skipGapIndex: number,
): void {
  if (delta === 0) return;
  for (const p of placements) {
    if (p.x >= from - 0.001) p.x += delta;
  }
  for (let i = 0; i < gaps.length; i++) {
    if (i === skipGapIndex) continue;
    const g = gaps[i] as RowGap;
    if (g.x >= from - 0.001) g.x += delta;
  }
}

/**
 * Compose a pleasing row.
 *
 * The pipeline:
 *  1. plan a sequence of runs (thin / mixed / heavy / leaning / flat / gap),
 *     never repeating a character back to back;
 *  2. assign books to runs by suitability, so like bindings cluster;
 *  3. break the pattern â€” swap members between long runs, because a perfectly
 *     sorted run is its own kind of uniform;
 *  4. fix the skyline: nudge heights until the row hits its variation target
 *     and no three neighbours share a height;
 *  5. lay out x positions, kerf, leans, depths and gaps;
 *  6. scale gaps to fill (or compress to fit) the available width.
 */
export function composeShelfRow(
  books: readonly RowBookInput[],
  opts: ComposeShelfRowOptions = {},
): ShelfRowComposition {
  const width = Math.max(60, opts.width ?? 900);
  const rnd = mulberry32(((opts.seed ?? 0x5e1f) ^ 0x9e3779b1) >>> 0);
  const allowLean = opts.lean !== false;
  const allowFlat = opts.flatStacks !== false;
  const allowGap = opts.gaps !== false;
  const minKerf = opts.minKerf ?? 0.6;
  const skylineTarget = clamp(opts.skylineTarget ?? 0.26, 0.05, 0.6);

  if (books.length === 0) {
    return {
      placements: [],
      gaps: [{ x: 0, width, leanedInto: false }],
      width: 0,
      maxHeight: 0,
      minHeight: 0,
      runs: ['gap'],
      skylineVariation: 0,
      thicknessRatio: 1,
    };
  }

  interface Candidate {
    input: RowBookInput;
    index: number;
    params: SpineParams;
    height: number;
  }

  const pool: Candidate[] = books.map((b, index) => {
    const params = b.params ?? deriveSpineParams(b.seed);
    return { input: b, index, params, height: spineHeightPx(params) };
  });

  /* ---------------- 1. plan the runs ---------------------------------- */
  const runs: RunCharacter[] = [];
  const runMembers: Candidate[][] = [];
  const unassigned = pool.slice();
  let previous: RunCharacter | null = null;
  let guard = 0;
  while (unassigned.length > 0 && guard++ < 400) {
    // Always open on something solid rather than a gap; a row that starts with
    // a hole reads as broken rather than as composed.
    const character: RunCharacter =
      runs.length === 0
        ? rnd() < 0.4
          ? 'heavy'
          : 'mixed'
        : pickRunCharacter(rnd, previous, unassigned.length, allowFlat, allowGap);
    previous = character;
    if (character === 'gap') {
      runs.push('gap');
      runMembers.push([]);
      continue;
    }
    const want = Math.max(1, runSize(character, rnd, unassigned.length));
    // 2. assign by suitability, with a little noise so the sort is not rigid.
    const scored = unassigned
      .map((c) => ({ c, s: suitability(c.params, character) + rnd() * 18 }))
      .sort((a, b) => b.s - a.s);
    const taken = scored.slice(0, want).map((entry) => entry.c);
    for (const t of taken) {
      const at = unassigned.indexOf(t);
      if (at >= 0) unassigned.splice(at, 1);
    }
    runs.push(character);
    runMembers.push(taken);
  }
  if (runs.length === 0) {
    runs.push('mixed');
    runMembers.push(pool.slice());
  }

  /* ---------------- 3. break the pattern ------------------------------ */
  // Swap one member between two long runs. A run of five perfectly graded
  // thin books is as machine-made as a run of five identical ones; the
  // reference always has one book that does not belong where it is.
  for (let i = 0; i < runMembers.length; i++) {
    const a = runMembers[i] as Candidate[];
    if (a.length < 3 || runs[i] === 'gap' || runs[i] === 'flat-stack') continue;
    for (let j = i + 1; j < runMembers.length; j++) {
      const b = runMembers[j] as Candidate[];
      if (b.length < 3 || runs[j] === 'gap' || runs[j] === 'flat-stack') continue;
      if (rnd() < 0.6) {
        const ai = Math.floor(rnd() * a.length);
        const bi = Math.floor(rnd() * b.length);
        const tmp = a[ai] as Candidate;
        a[ai] = b[bi] as Candidate;
        b[bi] = tmp;
      }
      break;
    }
  }

  // Shuffle within each run so suitability sorting does not leave a visible
  // monotone ramp of widths inside every cluster.
  for (const members of runMembers) {
    for (let i = members.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = members[i] as Candidate;
      members[i] = members[j] as Candidate;
      members[j] = tmp;
    }
  }

  /* ---------------- 4. fix the skyline -------------------------------- */
  const flatList = runMembers.flat();
  if (flatList.length >= 2) {
    let maxH = -Infinity;
    let minH = Infinity;
    for (const c of flatList) {
      maxH = Math.max(maxH, c.height);
      minH = Math.min(minH, c.height);
    }
    const variation = maxH > 0 ? (maxH - minH) / maxH : 0;
    if (variation < skylineTarget) {
      // Not enough spread: push the shortest down and the tallest up, in
      // proportion to how far each already sits from the row's mean, so the
      // skyline gains range without any book losing its format identity.
      const mean = flatList.reduce((s, c) => s + c.height, 0) / flatList.length;
      const need = (skylineTarget - variation) * maxH;
      const span = Math.max(1, maxH - minH);
      for (const c of flatList) {
        const away = c.height - mean;
        const push = Math.sign(away) * need * (0.35 + (Math.abs(away) / span) * 0.5);
        c.height = clamp(c.height + push, SPINE_HEIGHT_RANGE.min, SPINE_HEIGHT_RANGE.max);
      }
    }
    // No three consecutive books within 3% of each other â€” the "irregular
    // skyline" note. A plateau of three is the eye's threshold for "these are
    // all the same height".
    for (let i = 2; i < flatList.length; i++) {
      const a = flatList[i - 2] as Candidate;
      const b = flatList[i - 1] as Candidate;
      const c = flatList[i] as Candidate;
      const near = (p: number, q: number): boolean => Math.abs(p - q) / Math.max(1, p) < 0.03;
      if (near(a.height, b.height) && near(b.height, c.height)) {
        const dir = rnd() < 0.5 ? -1 : 1;
        b.height = clamp(
          b.height + dir * b.height * (0.06 + rnd() * 0.08),
          SPINE_HEIGHT_RANGE.min,
          SPINE_HEIGHT_RANGE.max,
        );
      }
    }
  }

  /* ---------------- 5. lay out ---------------------------------------- */
  const placements: RowPlacement[] = [];
  const gaps: RowGap[] = [];
  let cursor = 0;

  for (let r = 0; r < runs.length; r++) {
    const character = runs[r] as RunCharacter;
    const members = runMembers[r] as Candidate[];

    if (character === 'gap') {
      const g = 14 + rnd() * 34;
      gaps.push({ x: cursor, width: g, leanedInto: false });
      cursor += g;
      continue;
    }

    if (character === 'flat-stack' && members.length >= 2) {
      // A flat stack: books lying on their sides, biggest at the bottom, each
      // one offset a little so the stack reads as hand-made. The stack's
      // FOOTPRINT is the tallest book's height; its own height is the sum of
      // the thicknesses. Real shelves are full of these and we had none.
      const sorted = [...members].sort((a, b) => b.height - a.height);
      const footprint = Math.max(...sorted.map((c) => c.height)) * 0.94;
      let stackY = 0;
      for (let i = 0; i < sorted.length; i++) {
        const c = sorted[i] as Candidate;
        const jitterX = (rnd() * 2 - 1) * Math.min(10, footprint * 0.05);
        placements.push({
          id: c.input.id,
          index: c.index,
          params: c.params,
          title: c.input.title,
          x: cursor + jitterX + (footprint - c.height * 0.94) / 2,
          width: c.height * 0.94,
          height: c.params.w,
          leanDeg: (rnd() * 2 - 1) * 1.6,
          depth: 0.1 + rnd() * 0.3,
          phase: 0,
          pose: 'flat',
          run: r,
          runCharacter: character,
          stackY,
          gapAfter: 0,
        });
        stackY += c.params.w;
      }
      cursor += footprint + 2 + rnd() * 8;
      continue;
    }

    const leanLast =
      allowLean &&
      (character === 'leaning-cluster' || (character !== 'heavy' && rnd() < 0.16)) &&
      members.length >= 2;
    // A whole cluster shares a depth bias â€” books get pushed back in groups
    // when someone reshelves a handful at once.
    const runDepth = (rnd() * 2 - 1) * 0.42;

    for (let i = 0; i < members.length; i++) {
      const c = members[i] as Candidate;
      const isLast = i === members.length - 1;
      const doLean = leanLast && isLast;
      const leanDeg = doLean
        ? (rnd() < 0.5 ? -1 : 1) * (6 + rnd() * 9)
        : c.params.lean + (rnd() * 2 - 1) * 0.9;
      const rad = Math.abs(leanDeg) * (Math.PI / 180);
      // A leaning book occupies more floor: its footprint is the thickness
      // projected plus the height's contribution.
      const footprint = c.params.w * Math.cos(rad) + c.height * Math.sin(rad);
      // Per-book depth: the cluster bias plus the book's own `proud`, plus a
      // little noise. Recessed books gain AO and haze in renderSpine.
      const proud = (c.params.proud ?? 0) / 10;
      const depth = clamp(runDepth * 0.7 + proud * 0.8 + (rnd() * 2 - 1) * 0.18, -1, 1);
      // 'angled': a book pivoted so a sliver of its board shows. Rare, and
      // never on a leaner (that would read as a rendering bug).
      const pose: BookPose = doLean ? 'leaning' : rnd() < 0.07 ? 'angled' : 'upright';

      placements.push({
        id: c.input.id,
        index: c.index,
        params: c.params,
        title: c.input.title,
        x: cursor,
        width: footprint,
        height: c.height,
        leanDeg,
        depth,
        phase: 0,
        pose,
        run: r,
        runCharacter: character,
        stackY: 0,
        gapAfter: 0,
      });

      // Kerf: books inside a run touch. Only a leaner opens a real space.
      const kerf = isLast ? 0 : minKerf + rnd() * (character === 'thin-run' ? 0.8 : 2.2);
      cursor += footprint + kerf;
    }

    // A leaner needs somewhere to fall into.
    if (leanLast) {
      const last = placements[placements.length - 1] as RowPlacement;
      const g = Math.max(10, last.height * Math.sin(Math.abs(last.leanDeg) * (Math.PI / 180)) * 0.9);
      gaps.push({ x: cursor, width: g, leanedInto: true });
      cursor += g;
    } else if (r < runs.length - 1 && runs[r + 1] !== 'gap') {
      // Between two runs, a small breath.
      const g = 3 + rnd() * 9;
      gaps.push({ x: cursor, width: g, leanedInto: false });
      cursor += g;
    }
  }

  /* ---------------- 6. fit to the available width --------------------- */
  const used = cursor;
  if (used > 1 && Math.abs(used - width) > 1) {
    const slack = width - used;
    const gapTotal = gaps.reduce((s, g) => s + g.width, 0);
    if (slack > 0 && gaps.length > 0) {
      // Distribute the leftover into the gaps, weighted toward the ones that
      // are already large â€” a row of equal gaps is a picket fence.
      const weights = gaps.map((g) => g.width + 6);
      const wSum = weights.reduce((s, v) => s + v, 0);
      for (let i = 0; i < gaps.length; i++) {
        const g = gaps[i] as RowGap;
        const add = (slack * (weights[i] as number)) / wSum;
        shiftAfter(placements, gaps, g.x + g.width, add, i);
        g.width += add;
      }
    } else if (slack < 0) {
      // Overfull: shrink the gaps first, and only then squeeze uniformly.
      const shrink = Math.min(gapTotal * 0.92, -slack);
      if (gapTotal > 0.5) {
        const k = shrink / gapTotal;
        for (let i = 0; i < gaps.length; i++) {
          const g = gaps[i] as RowGap;
          const cut = g.width * k;
          shiftAfter(placements, gaps, g.x + g.width, -cut, i);
          g.width -= cut;
        }
      }
      const nowUsed = placements.reduce((s, p) => Math.max(s, p.x + p.width), 0);
      if (nowUsed > width + 1) {
        const k = width / nowUsed;
        for (const p of placements) {
          p.x *= k;
          p.width *= k;
        }
        for (const g of gaps) {
          g.x *= k;
          g.width *= k;
        }
      }
    }
  }

  /* ---------------- finalize ------------------------------------------ */
  let maxHeight = 0;
  let minHeight = Infinity;
  let maxW = 0;
  let minW = Infinity;
  const total = Math.max(
    1,
    placements.reduce((s, p) => Math.max(s, p.x + p.width), 0),
  );
  for (const p of placements) {
    p.phase = clamp((p.x + p.width / 2) / total, 0, 1);
    const drawn = p.pose === 'flat' ? p.stackY + p.height : p.height;
    maxHeight = Math.max(maxHeight, drawn);
    minHeight = Math.min(minHeight, drawn);
    maxW = Math.max(maxW, p.params.w);
    minW = Math.min(minW, p.params.w);
  }
  // gapAfter, for flora and props.
  for (const p of placements) {
    const right = p.x + p.width;
    let best = 0;
    for (const g of gaps) {
      if (g.x >= right - 0.5 && g.x - right < 3) best = Math.max(best, g.width);
    }
    p.gapAfter = best;
  }
  if (!Number.isFinite(minHeight)) minHeight = 0;
  if (!Number.isFinite(minW)) minW = 1;

  return {
    placements,
    gaps,
    width: total,
    maxHeight,
    minHeight,
    runs,
    skylineVariation: maxHeight > 0 ? (maxHeight - minHeight) / maxHeight : 0,
    thicknessRatio: minW > 0 ? maxW / minW : 1,
  };
}

/* -------------------------- rendering a whole row ------------------------- */

export interface RenderShelfRowOptions {
  /** The room's light. Every book in the row gets this same rig. */
  rig?: LightRig;
  /** World px â†’ canvas px. */
  scale?: number;
  /** Canvas x of the row's origin. */
  x?: number;
  /**
   * Canvas y of the PLANK's top surface â€” books stand on this line and cast
   * their contact shadows onto it.
   */
  baselineY: number;
  /** Bake titles (hi-res). Default true. */
  hiRes?: boolean;
  /** Paint a plank under the books. Default true. */
  plank?: boolean;
  /** Plank depth in canvas px (how much of the shelf board shows). */
  plankHeight?: number;
  /** Paint the dark back board behind the books. Default true. */
  backBoard?: boolean;
  /** Seed for the row's own incidental jitter. */
  seed?: number;
}

/**
 * Render a whole composed row â€” plank, back board, every book with its
 * contact shadows, in back-to-front depth order.
 *
 * This is the function the QA specimen board uses, and the reference
 * implementation for how a compositor should light a shelf: the *inter-object*
 * shadows (book onto neighbour, book onto plank) can only be drawn here,
 * because a single baked spine sprite has no idea what is next to it.
 *
 * Frame-wide passes (shafts, bloom, vignette, grade) are deliberately NOT
 * applied â€” they belong to the case, over the whole composite. Use
 * `renderLitScene` from `art/lighting.ts` for those.
 */
export function renderShelfRow(
  ctx: Ctx2D,
  comp: ShelfRowComposition,
  opts: RenderShelfRowOptions,
): void {
  const rig = opts.rig ?? DEFAULT_LIGHT_RIG;
  const scale = opts.scale ?? 1;
  const originX = opts.x ?? 0;
  const baseY = opts.baselineY;
  const rnd = mulberry32(((opts.seed ?? 0x51e1f) ^ 0x2545f491) >>> 0);
  const plankH = opts.plankHeight ?? 26 * scale;
  const rowW = comp.width * scale;
  const tallest = comp.maxHeight * scale;
  const src = keyToSource(rig);
  const keySide = src.x >= 0 ? 1 : -1;

  /* --- back board: the case's interior, which falls to near-black -------- */
  if (opts.backBoard !== false) {
    ctx.save();
    const bg = ctx.createLinearGradient(originX, baseY - tallest * 1.25, originX + rowW, baseY);
    const far = shiftTemperature(rig.shadowColour, -rig.temperatureShift * 0.8);
    const near = mixColourCss(rig.ambientColour, rig.keyColour, 0.18 * rig.keyIntensity);
    bg.addColorStop(0, keySide > 0 ? withAlpha(far, 0.98) : near);
    bg.addColorStop(1, keySide > 0 ? near : withAlpha(far, 0.98));
    ctx.fillStyle = bg;
    ctx.fillRect(originX, baseY - tallest * 1.28, rowW, tallest * 1.28);
    // Deep occlusion where the back board meets the plank.
    applyCreaseOcclusion(ctx, {
      rig,
      x: originX,
      y: baseY,
      length: rowW,
      axis: 'horizontal',
      reach: tallest * 0.3,
      strength: 1.15,
      bias: -0.85,
    });
    ctx.restore();
  }

  /* --- the plank ---------------------------------------------------------- */
  if (opts.plank !== false) {
    ctx.save();
    const wood = ctx.createLinearGradient(0, baseY, 0, baseY + plankH);
    wood.addColorStop(0, mixColourCss('#8a6a45', rig.keyColour, 0.3));
    wood.addColorStop(0.18, '#7d5f3c');
    wood.addColorStop(0.72, '#5d4429');
    wood.addColorStop(1, '#3b2a18');
    ctx.fillStyle = wood;
    ctx.fillRect(originX, baseY, rowW, plankH);
    // Grain: long low-contrast streaks along the board.
    ctx.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const gy = baseY + rnd() * plankH;
      ctx.strokeStyle = rnd() < 0.5 ? 'rgba(46,32,18,0.24)' : 'rgba(196,164,116,0.16)';
      ctx.lineWidth = (0.4 + rnd() * 1.3) * scale;
      ctx.beginPath();
      ctx.moveTo(originX, gy);
      for (let gx = 0; gx <= rowW; gx += 40 * scale) {
        ctx.lineTo(originX + gx, gy + Math.sin(gx * 0.012 + i) * 1.4 * scale);
      }
      ctx.stroke();
    }
    tileOver(ctx, getGranulationTile(), rowW, plankH, 128, 0.07, 'multiply');
    // The plank's own front arris catches the key.
    applyKeyLight(ctx, {
      rig,
      x: originX,
      y: baseY,
      width: rowW,
      height: plankH,
      intensity: 0.7,
      hotSpot: 0.2,
    });
    ctx.restore();
  }

  /* --- books, back to front ---------------------------------------------- */
  // Depth order matters: a recessed book must be overlapped by the proud one
  // in front of it, and its shadow must land under, not over.
  const order = comp.placements
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      if (a.p.pose === 'flat' && b.p.pose !== 'flat') return -1;
      if (b.p.pose === 'flat' && a.p.pose !== 'flat') return 1;
      return b.p.depth - a.p.depth;
    });

  for (const { p, i } of order) {
    const px = originX + p.x * scale;
    const pw = p.params.w * scale;
    const ph = p.height * scale;
    // Depth shifts the book up-screen a little and shrinks it â€” the cheapest
    // convincing parallax there is.
    const depth01 = clamp((p.depth + 1) / 2, 0, 1);
    const recess = p.depth * 6 * scale;
    const bookBase = baseY - Math.max(0, recess) * 0.45;

    const left = comp.placements[i - 1];
    const right = comp.placements[i + 1];
    const paletteOf = (q: RowPlacement | undefined): string | null =>
      q === undefined ? null : getSpinePalette(q.params).top;

    if (p.pose === 'flat') {
      /* ---- a book lying on its side in a stack ------------------------ */
      const fw = p.width * scale;
      const fh = p.params.w * scale;
      const fy = bookBase - (p.stackY + p.params.w) * scale;
      // Contact shadow onto whatever it lies on.
      castContactShadow(ctx, {
        rig,
        x: px - fw * 0.02,
        y: fy + fh,
        length: fw * 1.04,
        depth: Math.max(2, fh * 0.7),
        side: 'below',
        strength: 1.05,
        gap: 0.5,
      });
      ctx.save();
      ctx.translate(px + fw / 2, fy + fh / 2);
      ctx.rotate((p.leanDeg * Math.PI) / 180);
      // The spine renderer draws a vertical spine; rotate a quarter turn so
      // the lettering runs along the stack the way it does in life.
      ctx.rotate(-Math.PI / 2);
      renderSpine(
        ctx,
        p.params,
        -fw / 2,
        -fh / 2,
        fw,
        (fh / p.params.w) * 1,
        p.title,
        {
          hiRes: opts.hiRes !== false,
          rig,
          rowPhase: p.phase,
          depth: depth01,
          light: true,
        },
      );
      ctx.restore();
      continue;
    }

    /* ---- an upright (or leaning) book --------------------------------- */
    const leanRad = (p.leanDeg * Math.PI) / 180;

    // 1. The long projected shadow onto the plank, along the key direction.
    castObjectShadow(ctx, {
      rig,
      x: px,
      y: bookBase,
      width: pw,
      height: ph * 0.42,
      strength: 0.7 * (1 - depth01 * 0.3),
      softness: 0.55 + depth01 * 0.3,
    });

    // 2. THE contact shadow at the foot. Every object that touches another.
    castContactShadow(ctx, {
      rig,
      x: px - pw * 0.06,
      y: bookBase,
      length: pw * 1.12,
      depth: Math.max(2.5, pw * 0.55),
      side: 'below',
      strength: 1.1 * (1 - depth01 * 0.25),
      gap: Math.max(0, -p.depth) * 2,
    });

    // 3. Contact shadow onto the neighbour on the shadow side, drawn on the
    //    plank line between them â€” the join a row of books actually shows.
    if (left !== undefined || right !== undefined) {
      const sideX = keySide > 0 ? px : px + pw;
      castContactShadow(ctx, {
        rig,
        x: sideX,
        y: bookBase - ph,
        length: ph,
        depth: Math.max(1.5, pw * 0.4),
        side: keySide > 0 ? 'left' : 'right',
        strength: 0.55,
        skew: 0,
      });
    }

    ctx.save();
    // Lean pivots about the book's foot, and the foot sinks a touch so the
    // other corner tucks into the plank instead of floating over it.
    const sink = (pw / 2) * Math.abs(Math.sin(leanRad));
    ctx.translate(px + pw / 2, bookBase + sink);
    ctx.rotate(leanRad);
    ctx.translate(-pw / 2, -ph);

    renderSpine(ctx, p.params, 0, 0, ph, scale, p.title, {
      hiRes: opts.hiRes !== false,
      rig,
      rowPhase: p.phase,
      depth: depth01,
      neighbourLeft: paletteOf(left),
      neighbourRight: paletteOf(right),
      light: true,
    });
    ctx.restore();

    // 4. An 'angled' book shows a sliver of its front board catching the key.
    if (p.pose === 'angled') {
      const bw = Math.max(1.5, pw * 0.22);
      const bx = keySide > 0 ? px + pw : px - bw;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(bx, bookBase - ph * 0.995);
      ctx.lineTo(bx + bw * keySide, bookBase - ph * 0.97);
      ctx.lineTo(bx + bw * keySide, bookBase - ph * 0.02);
      ctx.lineTo(bx, bookBase);
      ctx.closePath();
      ctx.clip();
      const pal = getSpinePalette(p.params);
      ctx.fillStyle = pal.bottom;
      ctx.fillRect(Math.min(bx, bx + bw * keySide), bookBase - ph, bw, ph);
      applyKeyLight(ctx, {
        rig,
        x: Math.min(bx, bx + bw * keySide),
        y: bookBase - ph,
        width: bw,
        height: ph,
        intensity: 1.25,
        hotSpot: 0.5,
      });
      applyAmbientOcclusion(ctx, {
        rig,
        x: Math.min(bx, bx + bw * keySide),
        y: bookBase - ph,
        width: bw,
        height: ph,
        edges: ['bottom'],
        reach: ph * 0.25,
        strength: 1,
        corners: false,
      });
      ctx.restore();
    }
  }

  /* --- the row's own front-edge occlusion --------------------------------- */
  // The plank's front arris throws a shadow back under the books it carries;
  // without it the whole row reads as pasted onto the wood.
  applyCreaseOcclusion(ctx, {
    rig,
    x: originX,
    y: baseY,
    length: rowW,
    axis: 'horizontal',
    reach: 8 * scale,
    strength: 0.8,
    bias: -0.4,
  });
}

