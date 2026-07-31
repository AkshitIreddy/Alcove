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

import * as P from './brush';
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
  applyCreaseOcclusion,
  applyKeyLight,
  castContactShadow,
  castObjectShadow,
  keyToSource,
  mixColourCss,
  shiftTemperature,
  withAlpha,
  type LightRig,
} from './lighting';
import {
  materialBase,
  materialDefaults,
  // `getMaterialTile` already means "procedural tile canvas" in this file, so
  // the generated-library accessor comes in under an unambiguous name.
  getMaterialTile as getGeneratedTile,
  type MaterialCategory,
} from './materials';
import { clamp, lerp, mulberry32, type RandomFn } from './noise';
import { emitSpines, type NormalCtx } from '../render/normals';

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

/**
 * The 20 pigment duos, exported for features-side helpers that must mirror
 * the renderer's exact colours (placeholder tints, DOM pull-out gradients,
 * neighbour-bleed colours). `spinePalette.ts` used to keep a hand-copied —
 * and silently drifting — 12-entry duplicate of this table.
 */
export const SPINE_PALETTES = PALETTES;

const FONTS: readonly string[] = [
  '"Caveat Variable", "Caveat", cursive',
  '"Kalam", cursive',
  '"Patrick Hand", cursive',
];

const GOLD = '#c9a227';

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
  // Gold is the reference row's sparkle: rather more than half its spines
  // carry tooled foil somewhere. At 0.3 our shelf had almost none of it.
  const gilt = rnd() < 0.55;
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
  const pageBlock = clamp(0.07 + rnd() * 0.14 + (w < 20 ? 0.07 : 0), 0.06, 0.28);
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
  leather: { none: 0.1, max: 5 },
  vellum: { none: 0.3, max: 4 },
  cloth: { none: 0.48, max: 3 },
  linen: { none: 0.55, max: 3 },
  paper: { none: 0.74, max: 2 },
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
  ['folio', 12],
  ['quarto', 18],
  ['octavo', 34],
  ['duodecimo', 22],
  ['pocket', 14],
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

/* ========================================================================== *
 *                        THE PAINTED SPINE (brush-based)                     *
 * ========================================================================== *
 *
 * `docs/design/painted-rendering.md` Pillar 1: a spine is not a fill with
 * decorations on top, it is a mass built from stamps. Everything below paints
 * into a {@link P.Surface} — a float RGBA buffer the brush engine owns — and
 * the result is blitted once. Three consequences, all of them the point:
 *
 *  - **no hard edges anywhere.** `blockIn` overshoots and falls short of the
 *    silhouette; `edgeVary` then decides which few edges the eye may lock on.
 *  - **colour moves inside every shape.** Per-stamp hue/value jitter means a
 *    navy spine is forty navies, which is the difference between leather and
 *    a swatch.
 *  - **one light.** The form modelling is a glaze whose gradient is derived
 *    from the shared `LightRig`, so thirty books agree about the sun. When the
 *    deferred pass lands (`opts.light === false`) the glazes are skipped and
 *    the surface is pure albedo, with the height contribution emitted instead.
 */

/** Pigment set for one book: the mass, its shadow, its crown, its tooling. */
interface Pigment {
  base: P.Rgb;
  deep: P.Rgb;
  lift: P.Rgb;
  /** Warm/cool partner used for the second material tone. */
  partner: P.Rgb;
}

/**
 * The value classes a shelf is built from.
 *
 * Pillar 3, applied where it actually bites. The old shelf sat entirely in the
 * 45–70% lightness band, which is why it read as mid-tone mush no matter how
 * the hues were tuned. A real library row is mostly *dark* — oxblood, navy,
 * near-black calf — with a handful of tan/cream bindings doing all the lifting
 * and gold doing the sparkling. Weights below sum to 1.
 */
const VALUE_CLASSES: ReadonlyArray<{ lum: readonly [number, number]; weight: number }> = [
  { lum: [0.055, 0.115], weight: 0.2 }, // near-black bindings: the anchors
  { lum: [0.115, 0.19], weight: 0.28 }, // deep: oxblood / navy / forest
  { lum: [0.19, 0.3], weight: 0.24 }, // mid-dark: the connective tissue
  { lum: [0.3, 0.44], weight: 0.16 }, // mid: tan, olive, faded cloth
  { lum: [0.5, 0.7], weight: 0.12 }, // light: vellum, cream, parchment
];

/** Pick a target luminance for this book's binding from the value structure. */
function valueTargetFor(seed: number): number {
  const r = mulberry32((seed ^ 0x7a1e) >>> 0);
  let acc = r();
  for (const cls of VALUE_CLASSES) {
    acc -= cls.weight;
    if (acc < 0) return lerp(cls.lum[0], cls.lum[1], r());
  }
  return 0.22;
}

function clampTo01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Move a colour to a target luminance while keeping its hue and bite. */
function retone(c: P.Rgb, target: number): P.Rgb {
  const lum = P.luminance(c);
  if (lum <= 0.002) return target <= 0.02 ? c : P.mixRgb(c, { r: 1, g: 1, b: 1 }, target);
  if (target < lum) {
    // Darkening MULTIPLICATIVELY rather than mixing toward black is the whole
    // difference between "oxblood in shadow" and "brown mud": a mix drags every
    // pigment toward the same grey, while a scale keeps the channel ratios —
    // and therefore the hue — intact all the way down.
    const k = target / lum;
    const sat = P.shiftHsl(c, -5, 0.16, 0);
    return {
      r: clampTo01(sat.r * k * 0.97),
      g: clampTo01(sat.g * k * 0.99),
      b: clampTo01(sat.b * k * 1.12),
    };
  }
  const k = Math.min(0.92, (target - lum) / Math.max(0.08, 1 - lum));
  return P.mixRgb(c, P.shiftHsl(c, 4, -0.12, 0.2), k);
}

/** Build the four working tones for a book from its pigment duo. */
function pigmentFor(colA: HSL, colB: HSL, hue: number, seed: number): Pigment {
  const rawA = P.hslToRgb({ h: colA.h + hue, s: colA.s / 100, l: colA.l / 100 });
  const rawB = P.hslToRgb({ h: colB.h + hue, s: colB.s / 100, l: colB.l / 100 });
  const target = valueTargetFor(seed);
  const base = retone(P.mixRgb(rawA, rawB, 0.42), target);
  return {
    base,
    // The shadow tone is a genuine dark — 30% of the mass value, not 80% — and
    // drifts cool, which is what stops a row of books reading as flat cards.
    deep: retone(P.shiftHsl(base, -8, 0.08, 0), Math.max(0.02, target * 0.34)),
    // The crown lifts and warms toward the key rather than washing out.
    lift: retone(P.shiftHsl(base, 6, -0.06, 0), Math.min(0.86, target * 1.9 + 0.1)),
    partner: retone(rawB, Math.max(0.035, target * 0.62)),
  };
}

/** Convert the local Pt polygon vocabulary to the brush engine's Vec2. */
function toVec(pts: readonly Pt[]): P.Vec2[] {
  return pts.map((p) => ({ x: p.x, y: p.y }));
}

/** Everything one painted spine needs to know about itself and its room. */
interface SpinePaintSpec {
  w: number;
  h: number;
  scale: number;
  pig: Pigment;
  material: BindingMaterial;
  boardStyle: number;
  wear: number;
  knock: number;
  foilWear: number;
  sunFade: number;
  round: number;
  rig: LightRig;
  lightOn: boolean;
  /** +1 = key from the right, -1 = from the left. */
  keySide: 1 | -1;
  keyTake: number;
  depth: number;
  seed: number;
  /**
   * 0 when this spine's surface is entirely hand-painted, 1 when a generated
   * material tile went down under the brushwork. The material painters read
   * it and pull their own texture passes back, so the two never stack into
   * mush — see `matteBack`.
   */
  matBase: number;
}

/**
 * Attenuate a procedural texture pass by however much generated material sits
 * under it. `k` is how much of the pass survives at full material (0.35 =
 * "keep a third of it"). The pass never goes to zero: the brush marks are
 * what stop a tiled sheet from reading as a tiled sheet, and they carry the
 * per-book variation the tile cannot.
 */
function matteBack(spec: SpinePaintSpec, value: number, k = 0.4): number {
  return value * (1 - spec.matBase * (1 - k));
}

/**
 * Where the lit crown of the round back sits, 0..1 across the width.
 * One expression, shared by the albedo pass and the height contribution, so
 * the painted crown and the shaded crown are the same crown.
 */
function crownAt(spec: SpinePaintSpec): number {
  return clamp(0.5 + spec.keySide * 0.17 * spec.round, 0.22, 0.78);
}

/* ------------------------------ materials -------------------------------- */

/**
 * Cracked leather. Pebble grain from a sponge, creases dragged with a soft
 * head, then a crackle net of short dark strokes that follow no grid — the
 * craquelure of a binding that has flexed for a century.
 */
function paintLeatherPainterly(sf: P.Surface, mask: P.Mask, spec: SpinePaintSpec, rnd: RandomFn): void {
  const { w, h, scale, pig } = spec;
  const s = Math.max(0.6, scale);
  const grainSize = clamp(w * 0.16, 2.4 * s, 7 * s);

  // 1. pebble grain — two sponge passes, one sinking, one lifting.
  //    Morocco's pebbling is the one thing the generated tile does better than
  //    a sponge, so when it is under here the sponge only has to break up the
  //    tile's regularity rather than invent the grain.
  const grainK = matteBack(spec, 1, 0.3);
  P.scumble(sf, mask, P.brush('sponge', { size: grainSize, colour: pig.deep, opacity: 0.15 * grainK, spacing: 0.5, grain: 0.95 }), {
    coverage: 0.15 * grainK,
    passes: 1,
    patchScale: grainSize * 3.4,
    edgeBias: 0.25,
    seed: (spec.seed ^ 0x1e47) >>> 0,
    targetBuildup: 0.45,
  });
  P.scumble(sf, mask, P.brush('sponge', { size: grainSize * 0.8, colour: pig.lift, opacity: 0.11 * grainK, spacing: 0.55, grain: 0.95 }), {
    coverage: 0.11 * grainK,
    passes: 1,
    patchScale: grainSize * 5,
    // Grain catches the light on the side the key comes from.
    weight: (x) => 0.35 + 0.65 * clamp01Local(spec.keySide > 0 ? x / w : 1 - x / w),
    seed: (spec.seed ^ 0x2b71) >>> 0,
    targetBuildup: 0.35,
  });

  // 2. creases — the soft folds where the spine has been opened.
  const creases = 1 + Math.floor(rnd() * 2);
  const creaseBrush = P.brush('soft', {
    size: Math.max(1.6, w * 0.2),
    colour: pig.deep,
    opacity: 0.055,
    spacing: 0.14,
    jitter: { lum: 0.05, hue: 5, position: 0.5 },
  });
  for (let i = 0; i < creases; i++) {
    const cx = w * (0.16 + rnd() * 0.68);
    const y0 = h * rnd() * 0.4;
    const y1 = y0 + h * (0.28 + rnd() * 0.5);
    const path: P.Vec2[] = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      path.push({ x: cx + Math.sin(t * 3.1 + i) * w * 0.12, y: lerp(y0, y1, t) });
    }
    P.stroke(sf, path, creaseBrush, {
      passes: 2,
      pressure: P.PRESSURE.arc,
      seed: (spec.seed + i * 977) >>> 0,
      alpha: 0.8,
    });
  }

  // 3. craquelure — short, hard, dark, and only where wear says so.
  //    `leather-cracked` already supplies a crack net when it is resident, so
  //    the hand-drawn ones drop to a few accents that cross it at odd angles.
  const cracks = Math.round(matteBack(spec, spec.wear * 18 + 3, 0.35));
  const crackBrush = P.brush('ink', {
    size: Math.max(0.9, 1.1 * s),
    colour: pig.deep,
    opacity: 0.3,
    spacing: 0.3,
    jitter: { lum: 0.1, opacity: 0.6, position: 0.4 },
  });
  for (let i = 0; i < cracks; i++) {
    let px = rnd() * w;
    let py = rnd() * h;
    const segs = 2 + Math.floor(rnd() * 3);
    const path: P.Vec2[] = [{ x: px, y: py }];
    let ang = rnd() * Math.PI * 2;
    for (let k = 0; k < segs; k++) {
      ang += (rnd() - 0.5) * 1.9;
      const len = (1.6 + rnd() * 4.5) * s;
      px += Math.cos(ang) * len;
      py += Math.sin(ang) * len;
      path.push({ x: px, y: py });
    }
    P.stroke(sf, path, crackBrush, {
      passes: 1,
      pressure: P.PRESSURE.flick,
      wobble: 0.3 * s,
      seed: (spec.seed + i * 313) >>> 0,
      alpha: 0.5 + rnd() * 0.5,
    });
  }

  // 4. waxy sheen — a broad soft-light glaze biased to the crown.
  const crown = crownAt(spec);
  P.glaze(sf, mask, P.shiftHsl(pig.lift, 4, -0.1, 0.06), 0.16, {
    blend: 'softlight',
    gradient: (x, y) => {
      const u = x / w;
      const band = Math.exp(-Math.pow((u - crown) / 0.3, 2));
      const v = y / h;
      return band * (0.45 + 0.55 * Math.sin(Math.PI * clamp01Local(v)));
    },
    mottle: 0.34,
    mottleScale: Math.max(10, w * 1.4),
    seed: (spec.seed ^ 0x51c0) >>> 0,
  });
}

/**
 * Book cloth / buckram. A woven material reads by its *rib*: fine vertical
 * warp with a horizontal weft crossing it, matte, with the weave picking up a
 * cool sheen only on the crown.
 */
function paintClothPainterly(sf: P.Surface, mask: P.Mask, spec: SpinePaintSpec, rnd: RandomFn): void {
  const { w, h, scale, pig, boardStyle } = spec;
  const s = Math.max(0.6, scale);
  const ribGap = boardStyle === 1 ? 4.2 * s : boardStyle === 2 ? 6 * s : 2.9 * s;
  // The ribbed tile IS a warp, so when it is under here the painted warp
  // becomes a scatter of irregular threads over it instead of the weave.
  const weaveK = matteBack(spec, 1, 0.32);
  const warpBrush = P.brush('bristle', {
    size: Math.max(1.1, ribGap * 0.85),
    colour: pig.deep,
    opacity: 0.115 * weaveK,
    spacing: 0.3,
    grain: 0.8,
    followPath: true,
    jitter: { lum: 0.09, hue: 6, opacity: 0.55, position: 0.35 },
  });
  const warpLift = P.withBrush(warpBrush, { colour: pig.lift, opacity: 0.085 * weaveK });
  for (let x = -ribGap; x < w + ribGap; x += ribGap) {
    const jx = x + (rnd() - 0.5) * ribGap * 0.3;
    const b = rnd() < 0.42 ? warpLift : warpBrush;
    P.stroke(
      sf,
      [
        { x: jx, y: -h * 0.02 },
        { x: jx + (rnd() - 0.5) * 1.2 * s, y: h * 0.5 },
        { x: jx + (rnd() - 0.5) * 1.2 * s, y: h * 1.02 },
      ],
      b,
      { passes: 1, pressure: P.PRESSURE.flat, taper: 0.02, wobble: 0.35 * s, seed: (spec.seed + x * 71) >>> 0 },
    );
  }
  // Weft: shorter, broken horizontals, half the density of the warp.
  const weftBrush = P.brush('flat', {
    size: Math.max(1, ribGap * 0.7),
    colour: pig.deep,
    opacity: 0.05 * weaveK,
    spacing: 0.35,
    grain: 0.85,
    jitter: { lum: 0.07, opacity: 0.7, position: 0.4 },
  });
  for (let y = 0; y < h; y += ribGap * 1.7) {
    const jy = y + (rnd() - 0.5) * ribGap * 0.4;
    P.stroke(
      sf,
      [
        { x: -w * 0.04, y: jy },
        { x: w * 1.04, y: jy },
      ],
      weftBrush,
      { passes: 1, pressure: P.PRESSURE.flat, taper: 0.05, wobble: 0.25 * s, seed: (spec.seed + y * 131) >>> 0, alpha: 0.55 + rnd() * 0.45 },
    );
  }
  // Slubs — the little thick spots any woven cloth has.
  P.scumble(sf, mask, P.brush('chalk', { size: Math.max(1.4, 2.2 * s), colour: pig.lift, opacity: 0.11, grain: 0.9 }), {
    coverage: 0.07,
    passes: 1,
    patchScale: Math.max(12, w * 1.1),
    seed: (spec.seed ^ 0x3fa1) >>> 0,
    targetBuildup: 0.4,
  });
  // Matte veil: cloth never has leather's sheen, so the crown glaze is cool
  // and weak. This is the whole difference between the two at shelf scale.
  P.glaze(sf, mask, P.shiftHsl(pig.base, 16, -0.2, 0.1), 0.1, {
    blend: 'softlight',
    mottle: 0.4,
    mottleScale: Math.max(14, w * 2),
    seed: (spec.seed ^ 0x22b8) >>> 0,
  });
}

/** Paper-covered boards: long fibres, foxing, a chalky bloom. */
function paintPaperPainterly(sf: P.Surface, mask: P.Mask, spec: SpinePaintSpec, rnd: RandomFn): void {
  const { w, h, scale, pig } = spec;
  const s = Math.max(0.6, scale);
  const fibre = P.brush('chalk', {
    size: Math.max(1, 1.5 * s),
    colour: pig.deep,
    opacity: 0.05,
    spacing: 0.45,
    grain: 0.95,
    jitter: { lum: 0.12, opacity: 0.8, position: 0.7 },
  });
  // The laid-paper tile brings its own fibre and crackle; the painted fibres
  // then only need to add the long ones that cross several of the tile's.
  const fibres = Math.round(matteBack(spec, h / (5 * s) + 4, 0.4));
  for (let i = 0; i < fibres; i++) {
    const x0 = rnd() * w;
    const y0 = rnd() * h;
    const len = h * (0.06 + rnd() * 0.3);
    P.stroke(
      sf,
      [
        { x: x0, y: y0 },
        { x: x0 + (rnd() - 0.5) * 2.4 * s, y: y0 + len },
      ],
      rnd() < 0.4 ? P.withBrush(fibre, { colour: pig.lift }) : fibre,
      { passes: 1, pressure: P.PRESSURE.arc, taper: 0.3, seed: (spec.seed + i * 617) >>> 0 },
    );
  }
  // Foxing: rust specks that bloom where damp got in.
  const spots = Math.round(4 + spec.wear * 22);
  const fox = P.brush('soft', { size: Math.max(1.2, 2.4 * s), colour: '#8a5a30', opacity: 0.09, jitter: { hue: 14, lum: 0.12, size: 0.7 } });
  for (let i = 0; i < spots; i++) {
    P.dab(sf, rnd() * w, rnd() * h, fox, { size: (0.7 + rnd() * 2.6) * s, opacity: 0.04 + rnd() * 0.11 });
  }
  P.glaze(sf, mask, '#e8dcc0', 0.09, { blend: 'softlight', mottle: 0.5, mottleScale: Math.max(16, w * 2.2), seed: (spec.seed ^ 0x9c31) >>> 0 });
}

/** Vellum: translucent, pale, follicled, unevenly stretched. */
function paintVellumPainterly(sf: P.Surface, mask: P.Mask, spec: SpinePaintSpec, rnd: RandomFn): void {
  const { w, h, scale, pig } = spec;
  const s = Math.max(0.6, scale);
  // Big soft clouds of translucency — vellum's signature is that you can see
  // the skin's thickness change across the sheet.
  const cloud = P.brush('soft', {
    size: Math.max(4, w * 0.7),
    colour: P.shiftHsl(pig.lift, 6, -0.1, 0.14),
    opacity: 0.055,
    spacing: 0.3,
    jitter: { lum: 0.1, hue: 9, size: 0.6 },
  });
  // Vellum's mottling is the tile's strongest signal, so the painted clouds
  // thin right out when it is present — but never vanish, because the clouds
  // are what differ from book to book.
  for (let i = 0, n = Math.round(matteBack(spec, 14, 0.45)); i < n; i++) {
    P.dab(sf, rnd() * w, rnd() * h, cloud, { size: w * (0.5 + rnd() * 1.1), opacity: 0.03 + rnd() * 0.06 });
  }
  P.scumble(sf, mask, P.brush('soft', { size: Math.max(2, w * 0.3), colour: P.shiftHsl(pig.deep, 20, -0.1, 0.08), opacity: 0.05 }), {
    coverage: 0.16,
    passes: 1,
    patchScale: Math.max(18, w * 2.4),
    seed: (spec.seed ^ 0x77c2) >>> 0,
    targetBuildup: 0.3,
  });
  // Follicles: the hair pattern, in little arcs of three or four dots.
  const dot = P.brush('ink', { size: Math.max(0.8, 0.9 * s), colour: P.shiftHsl(pig.deep, 8, 0, 0.06), opacity: 0.22 });
  const groups = Math.round(6 + h / (12 * s));
  for (let i = 0; i < groups; i++) {
    const gx = rnd() * w;
    const gy = rnd() * h;
    const a = rnd() * Math.PI;
    for (let k = 0; k < 3; k++) {
      P.dab(sf, gx + Math.cos(a) * k * 1.7 * s, gy + Math.sin(a) * k * 1.7 * s, dot, { opacity: 0.1 + rnd() * 0.16 });
    }
  }
  P.glaze(sf, mask, '#f3e8cc', 0.14, { blend: 'screen', mottle: 0.45, mottleScale: Math.max(12, w * 1.8), seed: (spec.seed ^ 0x1188) >>> 0 });
}

/** Linen: coarse, slubby, cross-hatched, warm. */
function paintLinenPainterly(sf: P.Surface, mask: P.Mask, spec: SpinePaintSpec, rnd: RandomFn): void {
  const { w, h, scale, pig } = spec;
  const s = Math.max(0.6, scale);
  const gap = 4.6 * s;
  const hatchK = matteBack(spec, 1, 0.34);
  const hatch = P.brush('chalk', {
    size: Math.max(1.2, gap * 0.9),
    colour: pig.deep,
    opacity: 0.06 * hatchK,
    spacing: 0.4,
    grain: 1,
    jitter: { lum: 0.13, opacity: 0.8, position: 0.6 },
  });
  for (let x = -gap; x < w + gap; x += gap) {
    P.stroke(sf, [{ x, y: -2 }, { x: x + (rnd() - 0.5) * 2 * s, y: h + 2 }], hatch, {
      passes: 1,
      pressure: P.PRESSURE.flat,
      wobble: 0.7 * s,
      seed: (spec.seed + x * 89) >>> 0,
      alpha: 0.6 + rnd() * 0.5,
    });
  }
  for (let y = -gap; y < h + gap; y += gap * 1.1) {
    P.stroke(sf, [{ x: -2, y }, { x: w + 2, y: y + (rnd() - 0.5) * 1.6 * s }], P.withBrush(hatch, { colour: rnd() < 0.4 ? pig.lift : pig.deep, opacity: 0.05 * hatchK }), {
      passes: 1,
      pressure: P.PRESSURE.flat,
      wobble: 0.6 * s,
      seed: (spec.seed + y * 151) >>> 0,
      alpha: 0.5 + rnd() * 0.5,
    });
  }
  // Slubs: fat irregular thread nubs, the thing that says "linen" not "cloth".
  const slub = P.brush('flat', { size: Math.max(1.6, 3 * s), colour: pig.lift, opacity: 0.13, grain: 0.9 });
  for (let i = 0, n = Math.round(matteBack(spec, w * h * 0.004, 0.45)); i < n; i++) {
    const a = rnd() * Math.PI;
    const sx = rnd() * w;
    const sy = rnd() * h;
    const len = (2 + rnd() * 4) * s;
    P.stroke(
      sf,
      [
        { x: sx, y: sy },
        { x: sx + Math.cos(a) * len, y: sy + Math.sin(a) * len },
      ],
      rnd() < 0.5 ? slub : P.withBrush(slub, { colour: pig.deep, opacity: 0.11 }),
      { passes: 1, pressure: P.PRESSURE.arc, taper: 0.35, seed: (spec.seed + i * 41) >>> 0 },
    );
  }
  P.glaze(sf, mask, '#d8c49a', 0.08, { blend: 'softlight', mottle: 0.4, seed: (spec.seed ^ 0x4d21) >>> 0 });
}

/** Silk: satin sheen bands running the length, plus a watered moiré. */
function paintSilkPainterly(sf: P.Surface, mask: P.Mask, spec: SpinePaintSpec, rnd: RandomFn): void {
  const { w, h, scale, pig } = spec;
  const s = Math.max(0.6, scale);
  const bands = 3 + Math.floor(rnd() * 3);
  const sheen = P.brush('soft', {
    size: Math.max(2, w / bands),
    colour: pig.lift,
    opacity: 0.07,
    spacing: 0.16,
    jitter: { lum: 0.07, hue: 5, position: 0.3 },
  });
  for (let i = 0; i < bands; i++) {
    const bx = ((i + 0.5) / bands) * w;
    P.stroke(sf, [{ x: bx, y: -2 }, { x: bx, y: h + 2 }], i % 2 === 0 ? sheen : P.withBrush(sheen, { colour: pig.deep, opacity: 0.06 }), {
      passes: 2,
      pressure: P.PRESSURE.flat,
      taper: 0.05,
      wobble: 0.8 * s,
      seed: (spec.seed + i * 733) >>> 0,
    });
  }
  // Watered ripple: sinusoidal horizontals of alternating tone.
  const ripple = P.brush('soft', { size: Math.max(1.2, 1.8 * s), colour: pig.lift, opacity: 0.06, spacing: 0.2 });
  for (let y = 0; y < h; y += 6 * s) {
    const path: P.Vec2[] = [];
    const phase = rnd() * 6.28;
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      path.push({ x: t * w, y: y + Math.sin(phase + t * 5.4) * 2.2 * s });
    }
    P.stroke(sf, path, y % (7.2 * s) < 3.6 * s ? ripple : P.withBrush(ripple, { colour: pig.deep }), {
      passes: 1,
      pressure: P.PRESSURE.arc,
      seed: (spec.seed + y * 211) >>> 0,
      alpha: 0.6,
    });
  }
  P.glaze(sf, mask, P.shiftHsl(pig.lift, 0, 0.06, 0.1), 0.12, {
    blend: 'screen',
    gradient: (x) => Math.exp(-Math.pow((x / w - crownAt(spec)) / 0.22, 2)),
    mottle: 0.25,
    seed: (spec.seed ^ 0x6a3c) >>> 0,
  });
}

/**
 * Marbled boards, painted rather than composited: combed waves laid as long
 * wavering strokes in three or four period colours, then a Spanish-wave or
 * stone variant on top.
 */
function paintMarbledPainterly(
  sf: P.Surface,
  mask: P.Mask,
  spec: SpinePaintSpec,
  rnd: RandomFn,
  variant: number,
): void {
  const { w, h, scale, pig } = spec;
  const s = Math.max(0.6, scale);
  const inks: P.ColourLike[] = [
    P.shiftHsl(pig.deep, 0, 0.1, 0),
    P.shiftHsl(pig.base, 24, 0.08, 0.02),
    '#7a2b1e',
    '#1e3a52',
    '#c8a24a',
  ];
  // The generated marbled sheet is genuinely better combed than anything the
  // stamp budget allows, so when it is down the painted veins drop to a few
  // that ride over it and tie it to this book's pigment.
  const veinCount = Math.round(matteBack(spec, h / (5.5 * s), 0.28));
  const veinBrush = P.brush('soft', {
    size: Math.max(1.2, 2.4 * s),
    colour: inks[0],
    opacity: 0.14,
    spacing: 0.18,
    jitter: { lum: 0.1, hue: 10, opacity: 0.5, position: 0.5 },
  });
  const combAmp = variant === 2 ? 0.3 : 1;
  for (let i = 0; i < veinCount; i++) {
    const y = (i / veinCount) * h + (rnd() - 0.5) * 2 * s;
    const colour = inks[i % inks.length];
    const path: P.Vec2[] = [];
    const phase = variant === 0 ? (i % 2) * 1.6 : rnd() * 6.28;
    const amp = (variant === 1 ? 3.4 : 2.2) * s * combAmp;
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      path.push({ x: -2 + t * (w + 4), y: y + Math.sin(phase + t * (variant === 1 ? 9 : 5)) * amp });
    }
    P.stroke(sf, path, P.withBrush(veinBrush, { colour }), {
      passes: 1,
      pressure: P.PRESSURE.flat,
      taper: 0.04,
      wobble: 0.5 * s,
      seed: (spec.seed + i * 419) >>> 0,
      alpha: 0.45 + rnd() * 0.45,
    });
  }
  if (variant === 2) {
    // Stone/shell: droplets with pale haloes, no comb.
    const drop = P.brush('soft', { size: Math.max(2, 4 * s), colour: inks[2], opacity: 0.13, jitter: { hue: 16, lum: 0.14, size: 0.7 } });
    const halo = P.withBrush(drop, { colour: '#efe4c4', opacity: 0.09 });
    for (let i = 0, n = Math.round(matteBack(spec, w * h * 0.006, 0.4)); i < n; i++) {
      const dx = rnd() * w;
      const dy = rnd() * h;
      const r = (1.4 + rnd() * 3.4) * s;
      P.dab(sf, dx, dy, halo, { size: r * 2.1 });
      P.dab(sf, dx, dy, P.withBrush(drop, { colour: inks[1 + Math.floor(rnd() * 4)] }), { size: r });
    }
  }
  P.glaze(sf, mask, pig.deep, 0.1, { blend: 'multiply', mottle: 0.4, seed: (spec.seed ^ 0x3e91) >>> 0 });
}

/* ------------------------- generated material base ------------------------ */

/**
 * Which generated tile stands in for each binding, per board sub-style.
 *
 * The mapping is not "one tile per material name" because `boardStyle` already
 * says *which* leather or *which* cloth this book is bound in, and the library
 * happens to contain exactly those distinctions: crackled calf and pebbled
 * morocco are two different tiles, ribbed rep and slubby buckram are two more.
 *
 * `silk` is deliberately absent. Its identity is a moving satin sheen — bands
 * of specular that slide as the eye moves — and no static tile can supply
 * that; the procedural version in `paintSilkPainterly` is better, so silk
 * keeps painting itself. Same reasoning, opposite conclusion, for `marbled`:
 * combed marbling is pure high-frequency figure and the generated sheet beats
 * anything the brush engine can lay in a shelf's stamp budget.
 */
export function bindingMaterialSlug(material: BindingMaterial, boardStyle: number): string | null {
  switch (material) {
    case 'leather':
      // 0 smooth calf · 1 pebbled morocco · 2 craquelure
      return boardStyle === 2 ? 'leather-cracked' : 'leather-morocco';
    case 'cloth':
      // 0 flat buckram · 1 ribbed rep · 2 pyroxylin-coated
      return boardStyle === 1 ? 'cloth-ribbed' : 'cloth-linen';
    case 'linen':
      return 'cloth-linen';
    case 'paper':
      return 'paper-laid';
    case 'vellum':
      return 'vellum';
    case 'marbled':
      return 'paper-marbled';
    case 'silk':
    default:
      return null;
  }
}

/** Category a binding belongs to, for the generic loader path. */
function spineMaterialCategory(material: BindingMaterial): MaterialCategory | null {
  switch (material) {
    case 'leather':
      return 'leather';
    case 'cloth':
    case 'linen':
      return 'cloth';
    case 'paper':
    case 'vellum':
      return 'paper';
    case 'marbled':
      return 'marble';
    default:
      return null;
  }
}

/**
 * Lay the generated tile over the blocked-in mass, tinted to this book's
 * pigment. Returns 0 when nothing was available (paint it all by hand) and
 * 1 when a full material base went down.
 *
 * Three things keep this from reading as a texture decal:
 *  - the crop offset and mirror are seeded per book, so two morocco spines
 *    side by side are two different pieces of the same skin;
 *  - the repeat is scaled by the bake scale, so grain size is physical and
 *    does not crawl between the lo-res and hi-res LODs;
 *  - it composites at less than full alpha, so the underpainting's hue and
 *    value drift still breathes through — and every pass after this one
 *    (joints, bands, foil, wear, light) is still brushwork on top.
 */
function paintGeneratedBase(sf: P.Surface, mask: P.Mask, spec: SpinePaintSpec): number {
  const slug = bindingMaterialSlug(spec.material, spec.boardStyle);
  if (slug === null) return 0;
  const tile = getGeneratedTile(slug);
  const category = spineMaterialCategory(spec.material);
  if (!tile && category === null) return 0;

  const tuned = materialDefaults(slug, spec.scale);
  // A narrow spine only ever shows a sliver of the sheet, so squeeze the
  // repeat a little on wide books and let it run on slivers — the grain then
  // reads at roughly the same *count* of features across every spine width.
  const widthK = clamp(28 / Math.max(6, spec.w / Math.max(0.6, spec.scale)), 0.72, 1.5);
  const marbled = spec.material === 'marbled';
  const seed = (spec.seed ^ 0x4d13) >>> 0;

  const ok = materialBase(sf, mask, {
    slug: tile ? slug : undefined,
    category: tile ? undefined : (category ?? undefined),
    tint: spec.pig.base,
    scale: spec.scale,
    tilePx: tuned.tilePx * widthK,
    // Marbling is the subject on a marbled board, so it comes in hard; a
    // grain is tooth under the paint and comes in softer.
    strength: marbled ? 0.98 : 0.9,
    alpha: marbled ? 0.96 : 0.9,
    seed,
    flipX: (seed & 1) === 1,
    flipY: (seed & 2) === 2,
    feather: 1,
    floor: 0.06,
    ceiling: 2.2,
  });
  return ok ? 1 : 0;
}

/** Dispatch: paint the binding material into an already blocked-in mass. */
function paintMaterialPainterly(sf: P.Surface, mask: P.Mask, spec: SpinePaintSpec, rnd: RandomFn): void {
  switch (spec.material) {
    case 'leather':
      paintLeatherPainterly(sf, mask, spec, rnd);
      break;
    case 'cloth':
      paintClothPainterly(sf, mask, spec, rnd);
      break;
    case 'paper':
      paintPaperPainterly(sf, mask, spec, rnd);
      break;
    case 'vellum':
      paintVellumPainterly(sf, mask, spec, rnd);
      break;
    case 'linen':
      paintLinenPainterly(sf, mask, spec, rnd);
      break;
    case 'silk':
      paintSilkPainterly(sf, mask, spec, rnd);
      break;
    default:
      paintMarbledPainterly(sf, mask, spec, rnd, spec.boardStyle);
      break;
  }
}

function clamp01Local(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Lay the spine's mass.
 *
 * This is `blockIn` specialised for the one shape the shelf draws two hundred
 * of. The general routine has to make *any* silhouette opaque, so it lays a
 * dense soft underpainting at ~16× overdraw before its visible passes — a
 * hundred milliseconds a book, which a shelf cannot pay. A spine is a tall
 * thin rectangle whose mass can be laid in four vertical strokes, so it is,
 * and the silhouette is cut afterwards exactly as `blockIn` does it.
 *
 * Returns the mask so the material and light passes can clip to it.
 */
function paintSpineMass(
  sf: P.Surface,
  shape: readonly P.Vec2[],
  colour: P.Rgb,
  w: number,
  h: number,
  scale: number,
  seed: number,
): P.Mask {
  const s = Math.max(0.6, scale);
  const mask = P.rasterizeShape(shape, Math.max(3, Math.min(10, w * 0.25)));
  const rng = mulberry32(seed >>> 0);
  const hsl = P.rgbToHsl(colour);
  const size = Math.max(2.6, w * 0.62);
  const b = P.brush('chalk', {
    size,
    colour,
    opacity: 0.5,
    spacing: 0.3,
    grain: 0.62,
    scatter: 0.06,
    jitter: { lum: 0.075, hue: 9, sat: 0.05, opacity: 0.3, position: 0.5, size: 0.22, angle: 0.5 },
  });

  for (let pass = 0; pass < 2; pass++) {
    const lean = (pass - 0.5) * 0.1;
    const step = size * (pass === 0 ? 0.5 : 0.72);
    for (let x = -size * 0.35; x < w + size * 0.35; x += step) {
      // Value and hue drift across the mass — the thing a flat fill can never
      // have, and cheap here because it is per stroke rather than per stamp.
      const gx = x / Math.max(1, w) - 0.5;
      const drift = P.fbm(x * 0.06, pass * 13.7, seed + 11, 2) - 0.5;
      const c = P.hslToRgb({
        h: hsl.h + (drift + gx * 0.5) * 16,
        s: clamp01Local(hsl.s + drift * 0.07),
        l: clamp01Local(hsl.l + (drift * 1.5 + gx * 0.35) * 0.11),
      });
      const jx = x + (rng() - 0.5) * step * 0.4;
      P.stroke(
        sf,
        [
          { x: jx - h * lean * 0.5, y: -size * 0.4 },
          { x: jx + (rng() - 0.5) * s, y: h * 0.5 },
          { x: jx + h * lean * 0.5, y: h + size * 0.4 },
        ],
        P.withBrush(b, { colour: c, opacity: pass === 0 ? 0.5 : 0.24 }),
        {
          passes: 1,
          pressure: P.PRESSURE.flat,
          taper: 0.015,
          wobble: size * 0.12,
          smooth: false,
          rng,
          gradient: (t) => ({ dl: (t - 0.5) * 0.09, dh: (t - 0.5) * 10 }),
        },
      );
    }
  }

  P.clipToMask(sf, mask, {
    feather: 1.1,
    noise: 0.45 * s,
    noiseScale: Math.max(4, Math.min(w, h) * 0.16),
    seed: (seed + 41) >>> 0,
  });
  return mask;
}

/** Push a colour toward white without losing its temperature. */
function blowOutRgb(c: P.Rgb, amount: number): P.Rgb {
  const k = clamp01Local(amount);
  return P.mixRgb(c, { r: 1, g: 0.985, b: 0.94 }, k);
}

/* ------------------------------ stencils --------------------------------- */

/** An alpha coverage field lifted off a canvas — text, an ornament, a charm. */
interface Stencil {
  w: number;
  h: number;
  a: Float32Array;
}

let stencilCanvas: Canvas2D | null = null;

/**
 * Rasterise anything drawable into an alpha stencil.
 *
 * The bridge between "canvas can draw text and bezier ornaments" and "the
 * brush engine paints everything else". A glyph run comes back as coverage,
 * which is then *stamped* with gold rather than filled with it — the whole
 * reason a tooled title can look burnished instead of printed.
 */
function makeStencil(w: number, h: number, draw: (c: Ctx2D) => void): Stencil {
  const cw = Math.max(1, Math.ceil(w));
  const ch = Math.max(1, Math.ceil(h));
  if (!stencilCanvas || stencilCanvas.width < cw || stencilCanvas.height < ch) {
    stencilCanvas = makeCanvas(Math.max(cw, 128), Math.max(ch, 128));
  }
  const c = stencilCanvas;
  const ctx = get2d(c);
  ctx.save();
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  draw(ctx);
  ctx.restore();
  const img = ctx.getImageData(0, 0, cw, ch);
  const a = new Float32Array(cw * ch);
  for (let i = 0, o = 0; i < a.length; i++, o += 4) a[i] = img.data[o + 3] / 255;
  return { w: cw, h: ch, a };
}

interface StampOptions {
  /** Rotate the stencil a quarter turn so a horizontal run reads top-to-bottom. */
  rotate?: boolean;
  /** Colour at coverage centre; may vary with position along the run. */
  colour: (t: number, u: number) => P.Rgb;
  /** 0..1 — how much of the mark has been rubbed back to the binding. */
  wear?: number;
  /** Noise scale for the wear dropouts, px. */
  wearScale?: number;
  alpha?: number;
  seed?: number;
  /** Debossed bite: a dark offset copy under the mark. */
  relief?: { colour: P.Rgb; dx: number; dy: number; alpha: number } | null;
}

/**
 * Composite a stencil onto the surface as *material* rather than as ink.
 *
 * `t` runs along the mark, `u` across it, so a foil colour ramp can be a
 * burnished gradient rather than a flat gold. Wear eats the mark with
 * low-frequency noise, which is the reference's "some worn away".
 */
function stampStencil(sf: P.Surface, st: Stencil, ox: number, oy: number, opts: StampOptions): void {
  const rotate = opts.rotate ?? false;
  const wear = clamp(opts.wear ?? 0, 0, 1);
  const wearScale = opts.wearScale ?? 7;
  const alphaMul = opts.alpha ?? 1;
  const seed = (opts.seed ?? 0x4f01) >>> 0;
  const d = sf.data;
  const relief = opts.relief ?? null;

  const put = (sx: number, sy: number, cov: number, colour: P.Rgb): void => {
    const xi = Math.round(sx);
    const yi = Math.round(sy);
    if (xi < 0 || yi < 0 || xi >= sf.width || yi >= sf.height) return;
    const i = (yi * sf.width + xi) * 4;
    const a = clamp01Local(cov);
    if (a <= 0.004) return;
    const inv = 1 - a;
    d[i] = colour.r * a + d[i] * inv;
    d[i + 1] = colour.g * a + d[i + 1] * inv;
    d[i + 2] = colour.b * a + d[i + 2] * inv;
    d[i + 3] = a + d[i + 3] * inv;
  };

  for (let sy = 0; sy < st.h; sy++) {
    for (let sx = 0; sx < st.w; sx++) {
      const cov = st.a[sy * st.w + sx];
      if (cov <= 0.01) continue;
      // Along/across parameters, in the mark's own frame.
      const t = st.w > 1 ? sx / (st.w - 1) : 0;
      const u = st.h > 1 ? sy / (st.h - 1) : 0.5;
      const tx = rotate ? ox - (sy - st.h / 2) : ox + sx;
      const ty = rotate ? oy + sx : oy + sy;
      let a = cov * alphaMul;
      if (wear > 0) {
        const n = P.fbm(tx / wearScale, ty / wearScale, seed, 3);
        // Foil lifts in patches: below the threshold it is simply gone.
        const eaten = clamp01Local((n - (0.34 + wear * 0.42)) / 0.22);
        a *= 0.18 + 0.82 * eaten;
        if (wear > 0.6) a *= 1 - (wear - 0.6) * 1.1;
      }
      if (a <= 0.006) continue;
      if (relief) {
        put(tx + relief.dx, ty + relief.dy, cov * relief.alpha * alphaMul, relief.colour);
      }
      put(tx, ty, a, opts.colour(t, u));
    }
  }
}

/** The burnished ramp a real gold-foil letter carries across its stroke. */
function foilColour(u: number, warm: P.Rgb, hot: P.Rgb, dark: P.Rgb): P.Rgb {
  // The dark ends are deliberately narrow. A burnished ramp that spends half
  // its width in the shadow tone reads as brown paint at spine scale, and the
  // whole point of foil is that it is the brightest thing on the shelf.
  if (u < 0.14) return P.mixRgb(dark, warm, u / 0.14);
  if (u < 0.44) return P.mixRgb(warm, hot, (u - 0.14) / 0.3);
  if (u < 0.7) return P.mixRgb(hot, warm, (u - 0.44) / 0.26);
  if (u < 0.88) return P.mixRgb(warm, hot, (u - 0.7) / 0.18);
  return P.mixRgb(hot, dark, (u - 0.88) / 0.12);
}

const FOIL_WARM: P.Rgb = P.parseColour('#dcb03a');
const FOIL_HOT: P.Rgb = P.parseColour('#fff3c6');
const FOIL_DARK: P.Rgb = P.parseColour('#8a6412');
const FOIL_SILVER: P.Rgb = P.parseColour('#cdd3d8');

/* ---------------------------- painted furniture --------------------------- */

/**
 * A tooled rule: gold (or blind) line pressed into the binding.
 * Never a `fillRect` — a rule that survives a century has gaps in it.
 */
function paintRule(
  sf: P.Surface,
  x0: number,
  x1: number,
  y: number,
  thickness: number,
  colour: P.Rgb,
  spec: SpinePaintSpec,
  opts: { gold?: boolean; alpha?: number; seed?: number; wear?: number } = {},
): void {
  const gold = opts.gold ?? false;
  const wear = clamp(opts.wear ?? spec.foilWear * 0.7, 0, 1);
  const seed = (opts.seed ?? spec.seed) >>> 0;
  const rnd = mulberry32(seed);
  const th = Math.max(0.7, thickness);
  // The bite under the tool: every impressed rule sits in its own trench.
  P.stroke(
    sf,
    [
      { x: x0, y: y + th * 0.85 },
      { x: x1, y: y + th * 0.85 },
    ],
    P.brush('soft', { size: th * 2.2, colour: spec.pig.deep, opacity: 0.34, spacing: 0.2, jitter: { lum: 0.05, position: 0.2 } }),
    { passes: 1, pressure: P.PRESSURE.flat, taper: 0.04, seed: seed ^ 0x11, alpha: 0.8 },
  );
  const steps = Math.max(2, Math.round((x1 - x0) / Math.max(1.2, th * 1.6)));
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    // Dropouts: the tool skipped, or the gold has since lifted.
    if (rnd() < wear * 0.55) continue;
    const c = gold ? foilColour(0.2 + rnd() * 0.6, FOIL_WARM, FOIL_HOT, FOIL_DARK) : colour;
    P.stroke(
      sf,
      [
        { x: lerp(x0, x1, t0), y: y + (rnd() - 0.5) * th * 0.4 },
        { x: lerp(x0, x1, t1), y: y + (rnd() - 0.5) * th * 0.4 },
      ],
      P.brush('blade', {
        size: th,
        colour: c,
        opacity: (opts.alpha ?? 0.92) * (0.75 + rnd() * 0.45),
        spacing: 0.12,
        hardness: 0.9,
        jitter: { lum: gold ? 0.14 : 0.06, hue: gold ? 8 : 3, opacity: 0.4, position: 0.25 },
      }),
      { passes: 1, pressure: P.PRESSURE.flat, taper: 0.02, wobble: th * 0.25, seed: (seed + i * 37) >>> 0 },
    );
  }
}

/**
 * A raised cord: the sewing support under the leather. Three marks — the
 * trench it casts below, the roll of the cord itself, the catchlight on its
 * crown — because "raised bands casting their own tiny shadows" is on the
 * art-direction list and a painted line is not that.
 */
function paintCord(sf: P.Surface, cy: number, cordH: number, spec: SpinePaintSpec, seed: number): void {
  const { w, pig } = spec;
  const top = cy - cordH / 2;
  const rnd = mulberry32(seed >>> 0);

  // 1. the cast shadow under the cord
  P.stroke(
    sf,
    [
      { x: -w * 0.05, y: top + cordH * 1.05 },
      { x: w * 1.05, y: top + cordH * 1.05 },
    ],
    P.brush('soft', { size: cordH * 1.1, colour: pig.deep, opacity: 0.17, spacing: 0.18, jitter: { lum: 0.05, position: 0.4 } }),
    { passes: 2, pressure: P.PRESSURE.flat, taper: 0.03, seed: seed ^ 0x71 },
  );

  // 2. the roll — dark seat, body, lit crown, all as strokes across the width
  const rows = Math.max(3, Math.round(cordH));
  for (let i = 0; i < rows; i++) {
    const v = (i + 0.5) / rows;
    const y = top + v * cordH;
    // Lambert across a half-cylinder, offset toward the key.
    const n = Math.cos((v - 0.42) * Math.PI);
    const lit = clamp01Local(n * 0.5 + 0.5);
    const colour =
      lit > 0.62
        ? P.mixRgb(pig.base, pig.lift, (lit - 0.62) / 0.38)
        : P.mixRgb(pig.deep, pig.base, lit / 0.62);
    P.stroke(
      sf,
      [
        { x: -w * 0.04, y },
        { x: w * 1.04, y },
      ],
      P.brush('flat', {
        size: Math.max(1, cordH / rows + 0.6),
        colour,
        opacity: 0.6,
        spacing: 0.14,
        jitter: { lum: 0.05, hue: 4, opacity: 0.3, position: 0.25 },
      }),
      { passes: 1, pressure: P.PRESSURE.flat, taper: 0.02, wobble: 0.4, seed: (seed + i * 53) >>> 0 },
    );
  }

  // 3. the catchlight
  if (spec.lightOn) {
    P.stroke(
      sf,
      [
        { x: w * 0.04, y: top + cordH * 0.3 },
        { x: w * 0.96, y: top + cordH * 0.3 },
      ],
      P.brush('soft', {
        size: Math.max(0.9, cordH * 0.22),
        colour: P.mixRgb(pig.lift, FOIL_HOT, 0.35),
        opacity: 0.2 * spec.keyTake,
        spacing: 0.2,
        jitter: { opacity: 0.6, position: 0.3 },
      }),
      { passes: 1, pressure: P.PRESSURE.arc, taper: 0.16, seed: seed ^ 0x2f },
    );
  }
  void rnd;
}

/**
 * The page block: the cream sliver of the text block visible beside the spine.
 *
 * The art direction's first book note. Painted as leaves — many near-vertical
 * hairlines of slightly different creams — rather than a gradient strip, so it
 * reads as a thousand sheets of paper instead of a beige rectangle.
 */
function paintPageBlockPainterly(
  sf: P.Surface,
  x: number,
  y: number,
  bw: number,
  bh: number,
  edge: EdgeTreatment,
  spec: SpinePaintSpec,
  rnd: RandomFn,
): void {
  if (bw <= 0.6 || bh <= 1) return;
  const s = Math.max(0.6, spec.scale);
  const shape = P.roughenShape(P.rectShape(x, y, bw, bh), 0.4 * s, (spec.seed ^ 0x2244) >>> 0, 3.4);
  // Aged paper, not white. A text block that has stood on a shelf for fifty
  // years is the colour of weak tea; painting it cream-white was what made
  // every book look like it had a strip of masking tape down one side.
  const paper = edge === 'gilt' ? '#9c7c2e' : '#bcab86';
  // A 4px strip does not need the whole block-in machinery — its mass is
  // three strokes wide. Rasterise the silhouette for the glazes to clip to,
  // then lay the ground by hand.
  const mask = P.rasterizeShape(shape, 3);
  P.stroke(
    sf,
    [
      { x: x + bw * 0.5, y: y - 0.5 },
      { x: x + bw * 0.5, y: y + bh + 0.5 },
    ],
    P.brush('flat', {
      size: Math.max(1.6, bw * 1.05),
      colour: paper,
      opacity: 0.72,
      spacing: 0.3,
      grain: 0.5,
      jitter: { lum: 0.1, hue: 8, opacity: 0.25, position: 0.3, size: 0.16 },
    }),
    { passes: 2, pressure: P.PRESSURE.flat, taper: 0.02, wobble: 0.3 * s, seed: (spec.seed ^ 0x5511) >>> 0 },
  );

  // The leaves. Every few are darker (dust between them) and a few catch light.
  const leafBrush = P.brush('blade', {
    size: Math.max(0.7, 0.9 * s),
    colour: '#e8dcbc',
    opacity: 0.3,
    spacing: 0.16,
    hardness: 0.85,
    jitter: { lum: 0.12, hue: 8, opacity: 0.6, position: 0.25 },
  });
  const count = Math.max(3, Math.round(bw / (1.5 * s)));
  for (let i = 0; i < count; i++) {
    const lx = x + ((i + 0.5) / count) * bw + (rnd() - 0.5) * 0.5 * s;
    const dark = rnd() < 0.34;
    P.stroke(
      sf,
      [
        { x: lx, y: y + bh * 0.01 },
        { x: lx + (rnd() - 0.5) * 0.8 * s, y: y + bh * 0.99 },
      ],
      P.withBrush(leafBrush, {
        colour: dark ? '#7e7052' : rnd() < 0.28 ? '#e2d6b6' : '#c6b590',
        opacity: dark ? 0.24 : 0.24,
      }),
      { passes: 1, pressure: P.PRESSURE.flat, taper: 0.03, wobble: 0.3 * s, seed: (spec.seed + i * 97) >>> 0, alpha: 0.6 + rnd() * 0.5 },
    );
  }

  if (edge === 'gilt') {
    // Burnished gold over the leaves, hottest where the key rakes it.
    P.glaze(sf, mask, FOIL_WARM, 0.6, { blend: 'normal', mottle: 0.35, mottleScale: 9, seed: (spec.seed ^ 0x88) >>> 0 });
    P.scumble(sf, mask, P.brush('soft', { size: Math.max(1.2, bw * 0.6), colour: FOIL_HOT, opacity: 0.16 }), {
      coverage: 0.45,
      passes: 1,
      patchScale: Math.max(6, bh * 0.09),
      seed: (spec.seed ^ 0x99) >>> 0,
      targetBuildup: 0.5,
    });
  } else if (edge === 'speckled') {
    const speck = P.brush('ink', { size: Math.max(0.7, 0.8 * s), colour: '#7d3c22', opacity: 0.4, jitter: { hue: 20, lum: 0.2, size: 0.8 } });
    for (let i = 0; i < Math.round(bw * bh * 0.09); i++) {
      P.dab(sf, x + rnd() * bw, y + rnd() * bh, speck, { size: (0.5 + rnd() * 1.3) * s, opacity: 0.2 + rnd() * 0.4 });
    }
  } else if (edge === 'marbled') {
    const vein = P.brush('soft', { size: Math.max(0.9, 1.4 * s), colour: '#8a4a2c', opacity: 0.2, jitter: { hue: 24, lum: 0.16 } });
    for (let i = 0; i < Math.round(bh / (4 * s)); i++) {
      const vy = rnd() * bh;
      P.stroke(
        sf,
        [
          { x: x - 0.5, y: y + vy },
          { x: x + bw * 0.5, y: y + vy + (rnd() - 0.5) * 3 * s },
          { x: x + bw + 0.5, y: y + vy + (rnd() - 0.5) * 3 * s },
        ],
        P.withBrush(vein, { colour: i % 2 === 0 ? '#8a4a2c' : '#2f4a5e' }),
        { passes: 1, pressure: P.PRESSURE.arc, seed: (spec.seed + i * 173) >>> 0, alpha: 0.5 },
      );
    }
  }

  // The block stands a hair proud, so it takes light on its outer face and
  // throws a thin shadow back onto the board beside it.
  const outerLeft = spec.keySide > 0;
  P.glaze(sf, mask, spec.lightOn ? P.mixRgb(FOIL_HOT, P.parseColour(spec.rig.keyColour), 0.5) : FOIL_HOT, spec.lightOn ? 0.13 * spec.keyTake : 0.05, {
    blend: 'screen',
    gradient: (px) => {
      const u = (px - x) / bw;
      return clamp01Local(outerLeft ? u : 1 - u) ** 2.2;
    },
    mottle: 0.35,
    seed: (spec.seed ^ 0xaa1) >>> 0,
  });
  // Dust and shadow collect in the gutter side of the block.
  P.glaze(sf, mask, spec.pig.deep, 0.4, {
    blend: 'multiply',
    gradient: (px) => {
      const u = (px - x) / bw;
      return clamp01Local(outerLeft ? 1 - u * 2.2 : (u - 0.55) / 0.45) ** 1.2;
    },
    mottle: 0.3,
    seed: (spec.seed ^ 0xaa2) >>> 0,
  });
  P.stroke(
    sf,
    [
      { x: outerLeft ? x : x + bw, y },
      { x: outerLeft ? x : x + bw, y: y + bh },
    ],
    P.brush('soft', { size: Math.max(1, bw * 0.5), colour: spec.pig.deep, opacity: 0.2, spacing: 0.2 }),
    { passes: 1, pressure: P.PRESSURE.flat, taper: 0.03, seed: (spec.seed ^ 0xbb2) >>> 0 },
  );
}

/**
 * The wear pass, painted: sun bleach, rubbed board showing through, grime
 * pooled at the tail, and knocked corners.
 */
function paintWearPainterly(sf: P.Surface, mask: P.Mask, spec: SpinePaintSpec, rnd: RandomFn): void {
  const { w, h, scale, pig, wear } = spec;
  if (wear <= 0.02) return;
  const s = Math.max(0.6, scale);

  // Rubbed patches — pigment gone back to the board underneath.
  const boardTone = P.mixRgb(pig.base, P.parseColour('#a08a68'), 0.5 + wear * 0.28);
  const rub = P.brush('chalk', {
    size: Math.max(1.6, w * 0.22),
    colour: boardTone,
    opacity: 0.1,
    spacing: 0.4,
    grain: 0.95,
    jitter: { lum: 0.12, hue: 8, opacity: 0.7, size: 0.6 },
  });
  const rubs = Math.round(wear * 16);
  for (let i = 0; i < rubs; i++) {
    // Wear lands on corners and edges, never in the middle of a panel.
    const edgePick = rnd();
    const rx = edgePick < 0.5 ? (rnd() < 0.5 ? w * (0.02 + rnd() * 0.12) : w * (0.86 + rnd() * 0.12)) : rnd() * w;
    const ry = edgePick < 0.5 ? rnd() * h : rnd() < 0.5 ? h * rnd() * 0.1 : h * (0.9 + rnd() * 0.1);
    P.dab(sf, rx, ry, rub, { size: (1.6 + rnd() * 4) * s, opacity: 0.05 + rnd() * 0.14 * wear });
  }

  // Grime pooled at the tail, where a shelved book collects dust for decades.
  P.glaze(sf, mask, '#3b3125', 0.16 * (0.4 + wear), {
    blend: 'multiply',
    gradient: (_x, y) => clamp01Local((y / h - 0.78) / 0.22) ** 1.4,
    mottle: 0.5,
    mottleScale: Math.max(8, w),
    seed: (spec.seed ^ 0x6611) >>> 0,
  });

  // Sun bleach: one broad soft band across the spine, on the key side.
  if (spec.sunFade > 0.05) {
    P.glaze(sf, mask, '#efe4c6', spec.sunFade * 0.24, {
      blend: 'screen',
      gradient: (x) => {
        const u = spec.keySide > 0 ? x / w : 1 - x / w;
        return clamp01Local(u) ** 1.5;
      },
      mottle: 0.45,
      mottleScale: Math.max(10, w * 1.5),
      seed: (spec.seed ^ 0x7722) >>> 0,
    });
  }

  // Knocked corners: the board is bumped and the covering has lifted.
  if (spec.knock > 0.08) {
    const bump = P.brush('chalk', { size: Math.max(1.4, 2.6 * s), colour: boardTone, opacity: 0.16, grain: 1, jitter: { lum: 0.14, size: 0.7 } });
    for (const [cx, cy] of [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ] as const) {
      const n = Math.round(spec.knock * 5);
      for (let i = 0; i < n; i++) {
        const r = (0.6 + rnd() * 2.4) * s;
        P.dab(sf, cx + (rnd() - 0.5) * 4 * s, cy + (rnd() - 0.5) * 4 * s, bump, { size: r * 2, opacity: 0.08 + rnd() * 0.16 });
      }
    }
  }
}

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
  /**
   * Height/normal buffer for the deferred lighting pass. When given, the book
   * writes its rounded-box profile (and the ribs of any raised bands) at the
   * same rect it painted, so one fullscreen shader can light the whole shelf.
   * The spine never shades itself into this buffer — it only declares shape.
   */
  normalCtx?: NormalCtx;
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

  /* --- the light this book sits in -------------------------------------- */
  const rig = opts.rig ?? DEFAULT_LIGHT_RIG;
  const lightOn = opts.light !== false;
  const rowPhase = clamp(opts.rowPhase ?? 0.5, 0, 1);
  const depth = clamp(
    opts.depth ?? 0.5 - clamp((params.proud ?? 0) / 20, -0.5, 0.5),
    0,
    1,
  );
  // A book at the far end of the row from the key takes ~half of the key a
  // book right under it does. That single gradient across a row is most of
  // what makes a shelf read as *lit* rather than *coloured in*. The floor is
  // 0.55, not lower: shaded books keep their pigment's identity (the
  // reference's shaded end is dusky, never silhouette).
  const keyTake = lerp(0.55, 1.15, rowPhase) * lerp(1, 0.62, depth);
  const src = keyToSource(rig);
  /** Which side of the spine the key comes from: +1 = right, -1 = left. */
  const keySide = src.x >= 0 ? 1 : -1;

  /* ------------------------------------------------------------------ *
   *  Everything below paints into a brush Surface and is blitted once.
   *  No `fill()`, no gradient stops, no hard rectangle anywhere.
   * ------------------------------------------------------------------ */
  const pig = pigmentFor(colA, colB, hue, params.seed);
  const spec: SpinePaintSpec = {
    w,
    h,
    scale,
    pig,
    material,
    boardStyle,
    wear,
    knock,
    foilWear,
    sunFade,
    round,
    rig,
    lightOn,
    keySide,
    keyTake,
    depth,
    seed: params.seed >>> 0,
    // Filled in once the mass exists — the base cannot be laid before there
    // is something to lay it on.
    matBase: 0,
  };
  // Stamp budget for the whole spine. The brush engine's default budget is
  // tuned for a full-frame painting; a 30x230px spine at that density spends
  // most of its stamps on detail no one will ever see.
  const restoreQuality = P.getPaintQuality();
  P.setPaintQuality(0.62);
  const sf = P.createSurface(Math.max(2, Math.ceil(w)), Math.max(2, Math.ceil(h)));
  const s = Math.max(0.6, scale);
  // The silhouette is INSET rather than the surface padded: a stroke that
  // overshoots the edge has somewhere to land, which is what stops the
  // outline reading as a cut-out.
  const inset = Math.min(w * 0.06, Math.max(0.8, 1.1 * s));
  const outline = applyOutlineWear(
    silhouetteOutline(params.silhouette, w - inset * 2, h - inset * 2),
    clamp(wear + knock * 0.45, 0, 1),
    scale,
    rnd,
  );
  const shape = P.roughenShape(
    P.densifyShape(
      toVec(outline).map((p) => ({ x: p.x + inset, y: p.y + inset })),
      Math.max(2, 5 * s),
    ),
    0.55 * s,
    (params.seed ^ 0x3311) >>> 0,
    2.4,
  );

  /* --- 1. the mass ------------------------------------------------------ */
  const crown = crownAt(spec);
  const mask = paintSpineMass(sf, shape, pig.base, w, h, scale, (params.seed ^ 0x81ac) >>> 0);

  /* --- 1b. the generated material, dyed to this book's pigment --------- */
  // Goes down straight onto the mass and under everything else, because that
  // is where a binding material physically is: the board is covered first,
  // then the joints are turned, then the bands are worked, then the foil is
  // struck, then a century happens to it. When the library is not resident
  // this is a no-op and the hand-painted passes below run at full strength.
  spec.matBase = paintGeneratedBase(sf, mask, spec);

  /* --- 2. underpainting: sink the joints ------------------------------ */
  // Both vertical joints are where the covering turns onto the boards: the
  // darkest lines on any book, and the reason a row reads as objects rather
  // than as a barcode. A glaze rather than a scumble — this is a broad tonal
  // move, and paying two thousand stamps for a gradient is how a shelf ends
  // up costing a hundred milliseconds a book.
  // The band is capped in PIXELS, not as a fraction of the width: a joint is
  // the same few millimetres of turned-over covering on a sliver and on a
  // folio, and expressing it as 28% of the width swallowed the whole face of
  // every fat book.
  const jointBand = clamp((3.4 * s) / Math.max(1, w), 0.08, 0.26);
  P.glaze(sf, mask, pig.deep, 0.46, {
    blend: 'multiply',
    gradient: (px) => {
      const u = px / w;
      return clamp01Local(Math.max(1 - u / jointBand, (u - (1 - jointBand)) / jointBand)) ** 1.4;
    },
    mottle: 0.42,
    mottleScale: Math.max(6, w * 0.9),
    seed: (params.seed ^ 0x1c0d) >>> 0,
  });

  /* --- 3. the binding material ----------------------------------------- */
  if (opts.hiRes !== false || h > 90) paintMaterialPainterly(sf, mask, spec, rnd);

  /* --- 4. two-tone binding: a darker label panel over the head ---------- */
  if (params.twoTone) {
    const splitY = params.twoToneSplit * h;
    const panelShape = P.roughenShape(P.rectShape(-1, -1, w + 2, splitY + 1), 0.5 * s, (params.seed ^ 0x4a1) >>> 0, 3);
    const panelMask = P.blockIn(sf, panelShape, pig.partner, {
      brush: P.brush('chalk', { size: Math.max(2, w * 0.4), colour: pig.partner, opacity: 0.18, grain: 0.7 }),
      passes: 2,
      valueSpread: 0.08,
      hueSpread: 9,
      roughness: 0.4 * s,
      direction: Math.PI / 2,
      openness: 0.08,
      rowFactor: 0.45,
      feather: 1,
      seed: (params.seed ^ 0x4a1) >>> 0,
    });
    P.clipToMask(sf, mask, { feather: 1.1 });
    void panelMask;
    if (params.gilt) {
      paintRule(sf, w * 0.05, w * 0.95, splitY, Math.max(0.9, 1.4 * s), FOIL_WARM, spec, { gold: true, seed: (params.seed ^ 0x51) >>> 0 });
    } else {
      paintRule(sf, w * 0.05, w * 0.95, splitY, Math.max(0.8, s), pig.deep, spec, { seed: (params.seed ^ 0x52) >>> 0, wear: 0.2 });
    }
  }

  /* --- 5. round back: one cylinder of light across the width ------------ */
  if (round > 0.03) {
    // Multiply pass for the two shoulders rolling away from the viewer …
    P.glaze(sf, mask, pig.deep, 0.55 * round, {
      blend: 'multiply',
      gradient: (px) => {
        const u = px / w;
        const d0 = Math.abs(u - crown) / Math.max(crown, 1 - crown);
        return clamp01Local(d0 ** 1.7);
      },
      mottle: 0.22,
      mottleScale: Math.max(9, h * 0.2),
      seed: (params.seed ^ 0x6c11) >>> 0,
    });
    // … and a screen pass for the crown, warmed toward the key.
    P.glaze(sf, mask, lightOn ? P.mixRgb(pig.lift, P.parseColour(rig.keyColour), 0.28) : pig.lift, 0.24 * round * (lightOn ? keyTake : 0.7), {
      blend: 'screen',
      gradient: (px, py) => {
        const band = Math.exp(-Math.pow((px / w - crown) / 0.2, 2));
        return band * (0.35 + 0.65 * Math.sin(Math.PI * clamp01Local(py / h)) ** 0.7);
      },
      mottle: 0.25,
      mottleScale: Math.max(10, h * 0.22),
      seed: (params.seed ^ 0x6c12) >>> 0,
    });
  }

  /* --- 6. the page block ------------------------------------------------ */
  const blockFrac = clamp(params.pageBlock ?? 0.1, 0.05, 0.24);
  const edgeW = opts.pageBlock === false ? 0 : clamp(w * blockFrac, 2 * s, 9 * s);
  if (edgeW > 0.8) {
    const blockX = keySide > 0 ? w - edgeW - inset * 0.5 : inset * 0.5;
    paintPageBlockPainterly(sf, blockX, h * 0.014, edgeW, h * 0.972, edge, spec, rnd);
  }

  /* --- 7. bands and cords ---------------------------------------------- */
  const legacyBands = raisedBands > 0 ? [] : params.bands;
  for (const band of legacyBands) {
    const by = band.y * h;
    if (band.kind === 0) {
      for (const dy of [-1.9 * s, 1.9 * s]) {
        paintRule(sf, w * 0.05, w * 0.95, by + dy, Math.max(0.7, 0.9 * s), pig.deep, spec, {
          seed: (params.seed + by * 13 + dy) >>> 0,
          wear: 0.25,
          alpha: 0.6,
        });
      }
    } else if (band.kind === 1) {
      paintCord(sf, by, clamp(w * 0.2, 3.4 * s, 8 * s), spec, (params.seed + by * 29) >>> 0);
    } else {
      paintRule(sf, w * 0.05, w * 0.95, by, Math.max(1, 1.6 * s), FOIL_WARM, spec, {
        gold: true,
        seed: (params.seed + by * 37) >>> 0,
      });
    }
  }

  const cordYs: number[] = [];
  if (raisedBands > 0) {
    const zTop = 0.085;
    const zBot = 0.915;
    for (let i = 0; i < raisedBands; i++) {
      cordYs.push(zTop + ((i + 1) / (raisedBands + 1)) * (zBot - zTop));
    }
  }
  const cordH = clamp(w * 0.24, 4.2 * s, 11 * s);
  for (const cy of cordYs) {
    paintCord(sf, cy * h, cordH, spec, (params.seed + cy * 9973) >>> 0);
    if (bandGilt) {
      for (const gy of [cy * h - cordH * 0.85, cy * h + cordH * 0.85]) {
        paintRule(sf, w * 0.08, w * 0.92, gy, Math.max(0.9, 1.2 * s), FOIL_WARM, spec, {
          gold: true,
          seed: (params.seed + gy * 61) >>> 0,
        });
      }
    }
  }

  /* --- 8. head and tail endbands ---------------------------------------- */
  if (params.headTail) {
    const bandH = 3 * s;
    const stripeW = Math.max(1.4 * s, 1.8);
    const capCol = params.gilt ? FOIL_WARM : P.shiftHsl(pig.partner, 0, -0.06, 0.04);
    const creamCol = P.parseColour('#ddd0ab');
    for (const cy0 of [0.7 * s, h - bandH - 0.7 * s]) {
      P.stroke(
        sf,
        [
          { x: w * 0.05, y: cy0 + bandH * 0.5 },
          { x: w * 0.95, y: cy0 + bandH * 0.5 },
        ],
        P.brush('flat', { size: bandH, colour: creamCol, opacity: 0.34, spacing: 0.2, jitter: { lum: 0.09, position: 0.3 } }),
        { passes: 1, pressure: P.PRESSURE.flat, taper: 0.06, seed: (params.seed + cy0 * 17) >>> 0 },
      );
      const stripeBrush = P.brush('flat', {
        size: bandH * 0.75,
        colour: capCol,
        opacity: 0.4,
        spacing: 0.2,
        jitter: { lum: 0.1, hue: 6, opacity: 0.5, position: 0.3 },
      });
      for (let sx = w * 0.05; sx < w * 0.95; sx += stripeW * 2) {
        const slant = headTailStyle === 0 ? 0 : bandH * 0.8;
        P.stroke(
          sf,
          [
            { x: sx, y: cy0 + bandH },
            { x: sx + slant, y: cy0 },
          ],
          stripeBrush,
          { passes: 1, pressure: P.PRESSURE.flat, taper: 0.1, smooth: false, seed: (params.seed + sx * 31) >>> 0, alpha: 0.7 + rnd() * 0.4 },
        );
      }
      paintRule(sf, w * 0.05, w * 0.95, cy0 < h / 2 ? cy0 + bandH : cy0, Math.max(0.6, 0.7 * s), pig.deep, spec, {
        seed: (params.seed + cy0 * 71) >>> 0,
        wear: 0.3,
        alpha: 0.5,
      });
    }
  }

  /* --- 9. tooling panels: title in one, ornament in another ------------- */
  const reserve = charmSpineReserve(charm);
  const cutYs = raisedBands > 0 ? cordYs : legacyBands.map((b) => b.y);
  const cutPad = h > 0 ? (raisedBands > 0 ? cordH * 0.95 : 4.6 * scale) / h : 0;
  const panels = spinePanels(cutYs, reserve, cutPad).filter((p) => p.y1 - p.y0 > 0.045);
  let titlePanel: Panel | null = null;
  let ornamentPanel: Panel | null = null;
  if (panels.length > 0) {
    const upper = panels.filter((p) => (p.y0 + p.y1) / 2 < 0.68);
    const pool = upper.length > 0 ? upper : panels;
    const tallest = pool.reduce((a, b) => (b.y1 - b.y0 > a.y1 - a.y0 ? b : a));
    const second = panels.length > 1 ? (panels[1] as Panel) : null;
    titlePanel =
      second !== null && second.y1 - second.y0 >= (tallest.y1 - tallest.y0) * 0.8 ? second : tallest;
    const below = panels.filter((p) => p !== titlePanel && p.y0 >= (titlePanel as Panel).y1 - 1e-6);
    const rest = below.length > 0 ? below : panels.filter((p) => p !== titlePanel);
    if (rest.length > 0) {
      ornamentPanel = rest.reduce((a, b) => (b.y1 - b.y0 > a.y1 - a.y0 ? b : a));
      if (ornamentPanel.y1 - ornamentPanel.y0 < 0.085) ornamentPanel = null;
    }
    if (!ornamentPanel && panels.length === 1) {
      const only = panels[0] as Panel;
      ornamentPanel = { y0: only.y0 + (only.y1 - only.y0) * 0.74, y1: only.y1 };
      titlePanel = { y0: only.y0, y1: ornamentPanel.y0 };
    }
  }

  /* --- 10. the title, tooled in foil ----------------------------------- */
  const trnd = mulberry32((params.seed ^ 0x7115) >>> 0);
  if (titlePanel) {
    const py0 = titlePanel.y0 * h;
    const py1 = titlePanel.y1 * h;
    const pad = 4 * scale;
    const availLen = Math.max(0, py1 - py0 - pad * 2);
    const family = FONTS[params.font] as string;
    const mctx = get2d(makeCanvas(8, 8));
    const maxFont = clamp(w * 0.52, 10 * scale, 20 * scale);
    const minFont = Math.max(6.5 * scale, maxFont * 0.52);
    const fitLen = Math.max(0, availLen - pad * 0.9);
    let fontPx = maxFont;
    let text = title.trim();
    const measure = (t: string): number => {
      mctx.font = `${fontPx.toFixed(2)}px ${family}`;
      let sum = 0;
      for (const ch of t) sum += mctx.measureText(ch).width;
      return sum;
    };
    if (opts.hiRes && text.length > 0 && fitLen > 0) {
      while (measure(text) > fitLen && fontPx > minFont) fontPx = Math.max(minFont, fontPx * 0.94);
      if (measure(text) > fitLen) {
        while (text.length > 1 && measure(`${text}…`) > fitLen) text = text.slice(0, -1);
        const trimmed = text.replace(/[\s,;:.-]+$/u, '');
        text = `${trimmed.length > 0 ? trimmed : text}…`;
      }
    } else {
      text = '';
    }
    mctx.font = `${fontPx.toFixed(2)}px ${family}`;
    const glyphs: Array<{ ch: string; adv: number }> = [];
    let textLen = 0;
    for (const ch of text) {
      const cw = mctx.measureText(ch).width;
      glyphs.push({ ch, adv: cw });
      textLen += cw;
    }

    // The lettering ground: a tooled panel, a paper label, or nothing at all.
    const plateLen =
      textLen > 0 ? Math.min(availLen, textLen + pad * 2.6) : Math.min(availLen, (py1 - py0) * 0.6);
    const plateW = Math.min(w * 0.8, fontPx * 1.95);
    const plateX = w * 0.5 - plateW / 2;
    const plateY = (py0 + py1) / 2 - plateLen / 2;

    if (titlePlate !== 'none' && plateLen > 6 * scale) {
      if (titlePlate === 'label') {
        // A paper label, gummed on: the ONE genuinely light shape a dark book
        // is allowed, which is why it has to be painted rather than filled.
        const labelShape = P.roughenShape(
          P.densifyShape(P.rectShape(plateX, plateY, plateW, plateLen), 5 * s),
          0.7 * s,
          (params.seed ^ 0x9a1) >>> 0,
          3.2,
        );
        P.stroke(
          sf,
          [
            { x: plateX + plateW * 0.5, y: plateY + plateLen + 1.2 * s },
            { x: plateX + plateW * 0.5, y: plateY - 1 * s },
          ],
          P.brush('soft', { size: plateW * 1.15, colour: pig.deep, opacity: 0.12, spacing: 0.2 }),
          { passes: 1, pressure: P.PRESSURE.flat, taper: 0.05, seed: (params.seed ^ 0x9a2) >>> 0 },
        );
        const labelMask = P.blockIn(sf, labelShape, '#e3d5b2', {
          brush: P.brush('chalk', { size: Math.max(2, plateW * 0.6), colour: '#e3d5b2', opacity: 0.24, grain: 0.7 }),
          passes: 3,
          valueSpread: 0.07,
          hueSpread: 7,
          roughness: 0.4 * s,
          direction: Math.PI / 2,
          openness: 0.03,
          rowFactor: 0.4,
          feather: 0.9,
          seed: (params.seed ^ 0x9a3) >>> 0,
        });
        P.glaze(sf, labelMask, '#8b7444', 0.16, {
          blend: 'multiply',
          gradient: (px, py) => {
            const u = clamp01Local((px - plateX) / plateW);
            const v = clamp01Local((py - plateY) / plateLen);
            return Math.max(Math.abs(u - 0.5) * 1.5, Math.abs(v - 0.5) * 1.5) ** 2;
          },
          mottle: 0.4,
          seed: (params.seed ^ 0x9a4) >>> 0,
        });
        paintRule(sf, plateX + 1.8 * s, plateX + plateW - 1.8 * s, plateY + 1.8 * s, Math.max(0.6, 0.7 * s), P.parseColour('#7a6238'), spec, { wear: 0.35, alpha: 0.5, seed: (params.seed ^ 0x9a5) >>> 0 });
        paintRule(sf, plateX + 1.8 * s, plateX + plateW - 1.8 * s, plateY + plateLen - 1.8 * s, Math.max(0.6, 0.7 * s), P.parseColour('#7a6238'), spec, { wear: 0.35, alpha: 0.5, seed: (params.seed ^ 0x9a6) >>> 0 });
      } else {
        // gilt / debossed: rules tooled straight into the binding.
        const gold = titlePlate === 'gilt';
        const ruleCol = gold ? FOIL_WARM : pig.deep;
        for (const ry of [plateY, plateY + plateLen]) {
          paintRule(sf, plateX, plateX + plateW, ry, Math.max(0.8, 1.2 * s), ruleCol, spec, {
            gold,
            seed: (params.seed + ry * 41) >>> 0,
          });
        }
        const vBrush = P.brush('blade', {
          size: Math.max(0.8, 1.1 * s),
          colour: ruleCol,
          opacity: 0.5,
          spacing: 0.14,
          hardness: 0.9,
          jitter: { lum: gold ? 0.16 : 0.06, hue: gold ? 9 : 3, opacity: 0.5, position: 0.3 },
        });
        for (const rx of [plateX, plateX + plateW]) {
          P.stroke(
            sf,
            [
              { x: rx, y: plateY },
              { x: rx, y: plateY + plateLen },
            ],
            vBrush,
            { passes: 1, pressure: P.PRESSURE.flat, taper: 0.03, wobble: 0.35 * s, seed: (params.seed + rx * 53) >>> 0, alpha: 1 - foilWear * 0.5 },
          );
        }
      }
    }

    if (glyphs.length > 0) {
      const onLabel = titlePlate === 'label';
      const goldTitle = !onLabel && (titlePlate === 'gilt' || params.gilt);
      const groundLum = P.luminance(pig.base);
      const silverTitle = !onLabel && !goldTitle && groundLum < 0.2;
      const runY0 = (py0 + py1) / 2 - textLen / 2;
      const stH = Math.ceil(fontPx * 1.75);
      const st = makeStencil(Math.ceil(textLen + fontPx * 0.6), stH, (c) => {
        c.font = `${fontPx.toFixed(2)}px ${family}`;
        c.textAlign = 'left';
        c.textBaseline = 'middle';
        let advance = fontPx * 0.3;
        for (const g of glyphs) {
          const wob = (trnd() * 1.2 - 0.6) * scale;
          c.fillText(g.ch, advance, stH / 2 + wob);
          advance += g.adv;
        }
      });

      // Rotate the run a quarter turn: `t` now runs down the spine, `u` across
      // the letter's stroke — which is exactly the axis a burnished foil ramp
      // needs to run along.
      const inkDark = P.mixRgb(pig.deep, P.parseColour('#141019'), 0.45);
      const inkPale = P.mixRgb(pig.lift, P.parseColour('#f4ecd8'), 0.6);
      const colourAt = goldTitle
        ? (t: number, u: number): P.Rgb => {
            const foil = foilColour(u, FOIL_WARM, FOIL_HOT, FOIL_DARK);
            // One glint travels along the run where the key rakes it.
            const catchAt = clamp(0.24 + rowPhase * 0.5, 0, 1);
            const g = Math.exp(-Math.pow((t - catchAt) / 0.16, 2)) * (lightOn ? keyTake : 0.4);
            return P.mixRgb(foil, FOIL_HOT, clamp01Local(g * 0.7));
          }
        : silverTitle
          ? (_t: number, u: number): P.Rgb => foilColour(u, FOIL_SILVER, P.parseColour('#ffffff'), P.parseColour('#5d6670'))
          : onLabel
            ? (): P.Rgb => inkDark
            : (): P.Rgb => (groundLum < 0.34 ? inkPale : inkDark);

      stampStencil(sf, st, w / 2, runY0 - fontPx * 0.3, {
        rotate: true,
        colour: colourAt,
        wear: onLabel ? foilWear * 0.35 : foilWear,
        wearScale: Math.max(3.5, fontPx * 0.55),
        alpha: 0.95,
        seed: (params.seed ^ 0x515e) >>> 0,
        relief: onLabel
          ? null
          : {
              colour: goldTitle || silverTitle ? P.mixRgb(pig.deep, P.parseColour('#000000'), 0.35) : pig.deep,
              dx: -0.8 * s * keySide,
              dy: 0.85 * s,
              alpha: 0.4,
            },
      });
    }
  }

  /* --- 11. the ornament, tooled in the same foil ------------------------ */
  if (ornamentOn && !charmTakesOrnamentSlot(charm)) {
    const oPanel = ornamentPanel ?? { y0: 0.7, y1: 0.9 };
    const ocy = ((oPanel.y0 + oPanel.y1) / 2) * h;
    const oSize = Math.min(w * 0.36, 14 * scale, ((oPanel.y1 - oPanel.y0) * h) / 2.1);
    if (oSize > 1.6) {
      const box = Math.ceil(oSize * 2.6);
      const ornRnd = mulberry32((params.seed ^ 0x0c17) >>> 0);
      const st = makeStencil(box, box, (c) => {
        c.lineWidth = Math.max(1, 1.1 * scale);
        c.lineJoin = 'round';
        c.lineCap = 'round';
        drawOrnament(c, params.ornament, box / 2, box / 2, Math.max(2, oSize), ornRnd);
      });
      const gold = params.gilt;
      stampStencil(sf, st, w / 2 - box / 2, ocy - box / 2, {
        colour: gold
          ? (_t, u) => foilColour(u, FOIL_WARM, FOIL_HOT, FOIL_DARK)
          : () => P.mixRgb(pig.deep, P.parseColour('#0e0b12'), 0.3),
        wear: foilWear * 0.8,
        wearScale: Math.max(3, oSize * 0.5),
        alpha: gold ? 0.9 : 0.7,
        seed: (params.seed ^ 0x0c18) >>> 0,
        relief: {
          colour: P.mixRgb(pig.deep, P.parseColour('#000000'), 0.3),
          dx: -0.7 * s * keySide,
          dy: 0.7 * s,
          alpha: 0.35,
        },
      });
    }
  }

  /* --- 12. wear --------------------------------------------------------- */
  paintWearPainterly(sf, mask, spec, rnd);

  /* --- 13. the light on the object -------------------------------------- */
  if (lightOn) {
    // Occlusion: the plank below, the plank above, and the neighbour on the
    // side away from the key. Three glazes, one direction, no halo.
    P.glaze(sf, mask, P.mixRgb(pig.deep, P.parseColour(rig.ambientColour), 0.18), 0.42 * (0.7 + depth * 0.5), {
      blend: 'multiply',
      gradient: (_x, py) => clamp01Local((py / h - 0.86) / 0.14) ** 1.5,
      mottle: 0,
      seed: (params.seed ^ 0x3a01) >>> 0,
    });
    P.glaze(sf, mask, P.mixRgb(pig.deep, P.parseColour(rig.ambientColour), 0.24), 0.26 * (0.6 + depth * 0.6), {
      blend: 'multiply',
      gradient: (_x, py) => clamp01Local((0.12 - py / h) / 0.12) ** 1.6,
      mottle: 0,
      seed: (params.seed ^ 0x3a02) >>> 0,
    });
    // The neighbour's occlusion, on the side away from the key. Kept to a
    // narrow band: a wide one turns every book into a vignette, which is how
    // the first painted pass ended up murky.
    P.glaze(sf, mask, P.mixRgb(pig.deep, P.parseColour('#0c0a12'), 0.4), 0.34, {
      blend: 'multiply',
      gradient: (px) => {
        const u = keySide > 0 ? 1 - px / w : px / w;
        return clamp01Local((0.2 - u) / 0.2) ** 1.5;
      },
      mottle: 0.25,
      mottleScale: Math.max(8, h * 0.15),
      seed: (params.seed ^ 0x3a03) >>> 0,
    });

    // The key: warm, raking, strongest on books nearest the source. This is
    // the pass that has to *win* — a shelf where the occlusion outweighs the
    // sun reads as a cupboard, not a library in the afternoon.
    P.glaze(sf, mask, P.parseColour(rig.keyColour), clamp(0.34 * keyTake * rig.keyIntensity, 0, 0.6), {
      blend: 'screen',
      gradient: (px, py) => {
        const u = keySide > 0 ? px / w : 1 - px / w;
        const across = 0.3 + 0.7 * clamp01Local(u) ** 1.1;
        const down = 0.42 + 0.58 * clamp01Local(1 - py / h) ** 0.7;
        return across * down;
      },
      mottle: 0.3,
      mottleScale: Math.max(12, h * 0.25),
      seed: (params.seed ^ 0x3a04) >>> 0,
    });
    // A hot lip where the covering turns the corner into the key: the one
    // near-white the binding is allowed, and what makes a row sparkle.
    P.glaze(sf, mask, blowOutRgb(P.parseColour(rig.rimColour), 0.45), clamp(0.3 * keyTake, 0, 0.5), {
      blend: 'screen',
      gradient: (px, py) => {
        const u = keySide > 0 ? px / w : 1 - px / w;
        const lip = Math.exp(-Math.pow((u - 0.9) / 0.09, 2));
        return lip * (0.35 + 0.65 * Math.sin(Math.PI * clamp01Local(py / h)) ** 0.6);
      },
      mottle: 0.4,
      mottleScale: Math.max(8, h * 0.14),
      seed: (params.seed ^ 0x3a08) >>> 0,
    });

    // Colour bleeding from the neighbours: a painted shelf has no isolated
    // objects, and this is nearly free.
    if (opts.neighbourLeft) {
      P.glaze(sf, mask, opts.neighbourLeft, 0.11, {
        blend: 'softlight',
        gradient: (px) => clamp01Local((0.32 - px / w) / 0.32) ** 1.3,
        mottle: 0.3,
        seed: (params.seed ^ 0x3a05) >>> 0,
      });
    }
    if (opts.neighbourRight) {
      P.glaze(sf, mask, opts.neighbourRight, 0.11, {
        blend: 'softlight',
        gradient: (px) => clamp01Local((px / w - 0.68) / 0.32) ** 1.3,
        mottle: 0.3,
        seed: (params.seed ^ 0x3a06) >>> 0,
      });
    }

    // Recessed books lose contrast and gain the room's haze.
    if (depth > 0.55) {
      P.glaze(sf, mask, P.parseColour(rig.ambientColour), (depth - 0.55) / 0.45 * 0.22 * rig.hazeStrength, {
        blend: 'normal',
        mottle: 0.2,
        seed: (params.seed ^ 0x3a07) >>> 0,
      });
    }
  }

  /* --- 14. edges: a few crisp, most of them lost ------------------------ */
  P.edgeVary(sf, shape, {
    crisp: 0.26,
    lost: 0.3,
    band: Math.max(1.2, 1.6 * s),
    accent: P.mixRgb(pig.deep, P.parseColour('#0b0910'), 0.4),
    accentStrength: 0.4,
    lightAngle: rig.keyAngle,
    softness: Math.max(1.2, 2 * s),
    seed: (params.seed ^ 0x1d3e) >>> 0,
  });

  // Canvas tooth, faint, tying the book to every other painted thing.
  P.addGrain(sf, 0.028, 1.5, (params.seed ^ 0x7e11) >>> 0, mask);

  /* --- 15. one blit ----------------------------------------------------- */
  ctx.save();
  ctx.translate(x, y);
  P.drawSurface(ctx as CanvasRenderingContext2D, sf, 0, 0);

  // The charm keeps its own palette, so it is composited rather than stamped.
  if (charm !== 'none') {
    drawSpineCharm(ctx, charm, w, h, {
      color: charmColorCss(params.charmColor ?? 0),
      scale,
      rnd: mulberry32((params.seed ^ 0xc4a7) >>> 0),
      gilt: params.gilt,
    });
  }
  ctx.restore();

  // The height contribution for the deferred pass. Emitted whether or not the
  // albedo was lit, so a scene can light a pre-lit bake for free extra depth
  // or take `light: false` art and do all of it on the GPU.
  P.setPaintQuality(restoreQuality);
  const nctx = opts.normalCtx;
  if (nctx) {
    emitSpines(nctx, [
      {
        x,
        y,
        width: w,
        height: h,
        proud: clamp(1 - depth, 0, 1),
        radius: clamp(0.16 + round * 0.16, 0.08, 0.4),
        bands: raisedBands,
      },
    ]);
  }
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
  //
  // Density is a compositional property, not a leftover.
  //
  // The old version poured *all* the slack into the gaps, so a shelf given 26
  // books and 1200px of plank came back as five clumps separated by 90px
  // voids. That is the single most unfinished-looking thing the old row did,
  // and it is nothing like the reference, where the books are shoulder to
  // shoulder for the whole run with one or two deliberate holes.
  //
  // So the row is re-packed from scratch here rather than nudged: group the
  // placements (a flat stack is ONE group, since its books share an x range),
  // cap every space between groups at a plausible book-sized hole, spend any
  // remaining slack on making the books thicker, and only then admit a single
  // trailing hole — which is where a bookend or a trailing vine wants to be
  // anyway.
  {
    interface Group {
      members: RowPlacement[];
      x0: number;
      x1: number;
      /** Space to the next group in the original layout. */
      after: number;
      flat: boolean;
      leanedInto: boolean;
    }

    const byRun = new Map<number, RowPlacement[]>();
    for (const p of placements) {
      const key = p.pose === 'flat' ? p.run : p.index + 1e6;
      const list = byRun.get(key);
      if (list) list.push(p);
      else byRun.set(key, [p]);
    }
    const groups: Group[] = [];
    for (const members of byRun.values()) {
      let x0 = Infinity;
      let x1 = -Infinity;
      for (const m of members) {
        x0 = Math.min(x0, m.x);
        x1 = Math.max(x1, m.x + m.width);
      }
      groups.push({ members, x0, x1, after: 0, flat: members[0]?.pose === 'flat', leanedInto: false });
    }
    groups.sort((a, b) => a.x0 - b.x0);

    // A leaner needs the hole it is falling into; everything else is packed.
    const leanGap = new Set<number>();
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i] as Group;
      const next = groups[i + 1];
      g.after = next ? Math.max(0, next.x0 - g.x1) : 0;
      const tipped = g.members.some((m) => Math.abs(m.leanDeg) > 4);
      if (tipped) leanGap.add(i);
      g.leanedInto = tipped;
    }

    const holeCap = Math.min(52, Math.max(20, width * 0.04));
    let spacing = groups.map((g, i) => {
      if (i === groups.length - 1) return 0;
      const tight = minKerf + (g.after > 0 ? Math.min(g.after, 3.2) : 0);
      return leanGap.has(i) ? Math.min(Math.max(g.after, 10), holeCap) : tight;
    });

    const bookSpan = (): number => groups.reduce((s, g) => s + (g.x1 - g.x0), 0);
    const spanTotal = (): number => bookSpan() + spacing.reduce((s, v) => s + v, 0);

    let slack = width - spanTotal();

    // 1. Fatten the books. Bounded at +38%: past that a duodecimo becomes a
    //    folio and the format identity the studio panel controls goes away.
    if (slack > 2) {
      const total = bookSpan();
      if (total > 1) {
        const k = Math.min(1.38, 1 + slack / total);
        if (k > 1.001) {
          for (const g of groups) {
            const gx0 = g.x0;
            for (const m of g.members) {
              const rel = m.x - gx0;
              if (m.pose === 'flat') {
                // A flat book's drawn "width" is its height lying down; leave
                // the volume alone and only re-anchor it.
                m.x = gx0 + rel * k;
              } else {
                m.x = gx0 + rel * k;
                m.width *= k;
                m.params = {
                  ...m.params,
                  w: clamp(m.params.w * k, SPINE_THICKNESS_RANGE.min, SPINE_THICKNESS_RANGE.max * 1.25),
                };
              }
            }
            g.x1 = gx0 + (g.x1 - gx0) * k;
          }
          slack = width - spanTotal();
        }
      }
    }

    // 2. Any slack left widens the holes, up to the cap.
    if (slack > 1 && groups.length > 1) {
      const holes = spacing.length - 1;
      const room = spacing.map((v, i) => (i < holes ? Math.max(0, holeCap - v) : 0));
      const roomTotal = room.reduce((s, v) => s + v, 0);
      if (roomTotal > 0.5) {
        const take = Math.min(slack, roomTotal);
        spacing = spacing.map((v, i) => v + (room[i] as number) * (take / roomTotal));
        slack = width - spanTotal();
      }
    }

    // 3. Overfull: squeeze the spaces, then the books.
    if (slack < 0) {
      const spaceTotal = spacing.reduce((s, v) => s + v, 0);
      const cut = Math.min(spaceTotal * 0.85, -slack);
      if (spaceTotal > 0.5) {
        const k = 1 - cut / spaceTotal;
        spacing = spacing.map((v) => v * k);
        slack = width - spanTotal();
      }
      if (slack < -1) {
        const total = bookSpan();
        const k = Math.max(0.55, (total + slack) / Math.max(1, total));
        for (const g of groups) {
          const gx0 = g.x0;
          for (const m of g.members) {
            const rel = m.x - gx0;
            m.x = gx0 + rel * k;
            if (m.pose !== 'flat') {
              m.width *= k;
              m.params = {
                ...m.params,
                w: clamp(m.params.w * k, SPINE_THICKNESS_RANGE.min, SPINE_THICKNESS_RANGE.max * 1.25),
              };
            }
          }
          g.x1 = gx0 + (g.x1 - gx0) * k;
        }
        slack = width - spanTotal();
      }
    }

    // 4. Re-pack left to right and rebuild the gap list from what is left.
    gaps.length = 0;
    let cur = 0;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i] as Group;
      const shift = cur - g.x0;
      for (const m of g.members) m.x += shift;
      g.x1 += shift;
      cur = g.x1;
      const gapW = spacing[i] as number;
      if (gapW > 4) gaps.push({ x: cur, width: gapW, leanedInto: g.leanedInto });
      cur += gapW;
      for (const m of g.members) m.gapAfter = gapW;
    }
    if (width - cur > 6) gaps.push({ x: cur, width: width - cur, leanedInto: false });
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

