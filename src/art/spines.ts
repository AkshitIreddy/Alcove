/**
 * art/spines.ts — seeded book identity, and the flat drawing of one spine.
 *
 * A book's entire look still derives from a 32-bit seed (fnv1a of its id):
 * seed → mulberry32 → SpineParams (~100 bytes, the only persisted state).
 * What changed is what those params are *spent* on. They used to feed a brush
 * engine — layered multiply gradients, generated material tiles, a light rig
 * per row — which cost seconds of startup and still read as cheap.
 *
 * `renderSpine` now draws in the app's one vocabulary (`art/flat.ts`): flat
 * colour, one ink outline, rounded corners, nothing axis-true. The params it
 * has always carried are mapped onto that vocabulary rather than thrown away —
 * `palette` picks the cloth, `bands`/`raisedBands`/`gilt` decide the dressing,
 * `ornament` still picks one of twelve stamps — so a book keeps the identity
 * it was created with and simply stops pretending to be a photograph.
 *
 * The pigment tables, the studio vocabulary and the row compositor below are
 * untouched: they are data and layout, and nothing about them was painterly.
 */

import type { CharmKind } from './charms';
import {
  bookLabelBox,
  bookSpineBoxes,
  drawBookSpine,
  fitsLabelPlate,
  hasDecoration,
  materialLookFor,
  resolveBookDesign,
  type BookDesign,
  type BookPresetId,
  type DesignBox,
} from './bookDesign';
import { CLOTHS, FLAT, inkWidth, panel } from './flat';
// `drawSpine` is no longer called from here — `drawBookSpine` covers the same
// ground and adds the shape and material axes. `flatSpineFor` survives for the
// one field the binding still takes from the old seeded spec: where the label
// sits. `flatShelf.drawSpine` itself stays: `drawCaseCard` and `drawBookRow`
// draw books at card scale, where a binding's fine work would be a smudge.
import { flatSpineFor } from './flatShelf';
import { clamp, mulberry32, type RandomFn } from './noise';

/* ------------------------------ studio vocab ------------------------------ */

/**
 * Binding materials (library-themes §4).
 *
 * These used to be seven simulated grains — pebbled leather, buckram weave,
 * vellum follicles — each a few thousand brush stamps deep. The flat spine
 * does not simulate a surface, so on the shelf a material now shows up in the
 * *silhouette and dressing* rather than in the texture: which bindings get
 * cords, how round the back is, how likely gilt is. The vocabulary is kept
 * whole because it is persisted per book and drives the Book Studio.
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
 * in the studio: rather than inflate the studio's material picker to a dozen
 * entries, each material carries two or three grains and the seed picks one.
 * The flat spine does not draw a grain, but the distinction is persisted and
 * still shifts the silhouette:
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
  /**
   * Whether `material` was CHOSEN rather than inherited.
   *
   * The 62 bindings each carry a covering of their own, and a book that hands
   * one down unasked flattens the whole table into the seven the studio knows.
   * So the covering only overrules its binding when the reader actually
   * touched the chip — which is exactly what `resolveBookStyle` reports.
   */
  materialPinned?: boolean;
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
  /**
   * A binding pinned in the Book Studio (`art/bookDesign.ts`), overriding the
   * one the seed would have picked.
   *
   * Null/absent is the normal case and is NOT the same as a default: it means
   * "whatever `presetForSeed` says", so a book that has never been dressed
   * still gets one of the 62 bindings rather than a house wrapper. It is last
   * in the params on purpose — `deriveSpineParams` appends its draw, so adding
   * it reshuffles nothing that came before.
   */
  binding?: BookPresetId | null;

  /* ------------------- painterly rebuild additions (§1, §3) ---------------- */
  /* All optional, all seed-derived, none exposed in the studio. These were the
   * facts a *simulated* surface needed — how far the boards stand proud, how
   * much foil has lifted, how round the back is — and the flat spine reads
   * none of them: it has no light model and no surface to wear. They stay on
   * the type because they are persisted per book, because `proud` is still the
   * shelf compositor's depth offset, and because a params migration buys
   * nothing here. Treat them as history, not as knobs. */

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

/* ------------------------------- canvases -------------------------------- */

export type Canvas2D = OffscreenCanvas | HTMLCanvasElement;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

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

/* ------------------------------ geometry --------------------------------- */

interface Pt {
  x: number;
  y: number;
}

/** Lay a polyline into the current path, optionally closing it. */
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

/* ========================================================================== *
 *                        drawing one spine, flat                             *
 * ========================================================================== */

/**
 * Every pigment mapped onto one of the flat palette's six book cloths.
 *
 * The cloth comes from `palette` rather than from the raw seed on purpose:
 * `palette` is the field a book's colour identity has always lived in, so a
 * book that was amber stays in the amber family — it just stops being a
 * hand-mixed gradient and becomes one flat ochre. Indices are into CLOTHS
 * (terracotta, slate, plum, ochre, sage, moss) and the twenty entries line up
 * one-for-one with PALETTES above; add a pigment there, add a row here.
 */
const CLOTH_FOR_PIGMENT: readonly number[] = [
  3, // 0  amber      → ochre
  0, // 1  terracotta → terracotta
  5, // 2  moss       → moss
  1, // 3  dusty blue → slate
  2, // 4  plum       → plum
  3, // 5  ochre      → ochre
  4, // 6  sage       → sage
  0, // 7  rust       → terracotta
  0, // 8  clay       → terracotta
  4, // 9  olive      → sage
  1, // 10 slate      → slate
  2, // 11 blush      → plum
  0, // 12 oxblood    → terracotta
  1, // 13 navy       → slate
  5, // 14 forest     → moss
  3, // 15 tan        → ochre
  3, // 16 cream      → ochre
  1, // 17 ink        → slate
  1, // 18 teal       → slate
  3, // 19 saffron    → ochre
];

/**
 * THE palette → cloth rule, for the spine and the cover alike.
 *
 * It lives here because the table above is index-aligned with `PALETTES`, but
 * `covers.ts` imports it rather than folding `palette` onto six cloths its own
 * way. That is not tidiness: a book's spine on the shelf and its board in the
 * pull-out both derive their colour from the same `palette` integer, and two
 * different foldings of it mean a book that changes colour when you pick it
 * up. (It did — the spine used this table while the cover used `palette % 6`,
 * so an amber book was ochre on the shelf and terracotta in your hand.)
 *
 * Wrapping happens at the TWENTY pigment slots first, so `palette` keeps its
 * full range as a knob (`COVER_PALETTE_COUNT`), then lands on one of six.
 * Negative and fractional inputs normalise rather than falling off the end.
 */
export function clothForPalette(palette: number): number {
  const n = CLOTH_FOR_PIGMENT.length;
  const slot = ((Math.trunc(palette) % n) + n) % n;
  return (CLOTH_FOR_PIGMENT[slot] ?? 0) % CLOTHS.length;
}

/**
 * Ribbon colourways, `charmColor` mapped into the flat palette.
 *
 * Every one is saturated. The palette's creams are deliberately absent: a pale
 * ribbon at the head of a spine reads as a second, smaller label rather than
 * as a ribbon, which is the one thing it must not do.
 */
const RIBBON_COLOURS: readonly string[] = [
  FLAT.moss,
  FLAT.terracotta,
  FLAT.gilt,
  FLAT.slate,
  FLAT.plum,
  FLAT.sage,
  FLAT.ochre,
  FLAT.mossDark,
];

/**
 * …and room for *lettering* inside a plate. Stricter than `fitsLabelPlate`,
 * because a plate only has to look like a plate whereas a title has to be
 * read: below about 6px of glyph the run is a grey smear, and forcing a
 * legible size into a sliver's label spills the letters out over the cloth.
 */
function fitsTitle(d: DesignBox): boolean {
  return fitsLabelPlate(d) && d.w * 0.62 * 0.62 >= 6;
}

/**
 * One shared 8x8 canvas for text measurement.
 *
 * A shelf bakes a few hundred spines in a burst and the old code allocated a
 * canvas per book to ask how wide a glyph was.
 */
let measureCanvasCtx: Ctx2D | null = null;
function measureCtx(): Ctx2D {
  if (measureCanvasCtx === null) measureCanvasCtx = get2d(makeCanvas(8, 8));
  return measureCanvasCtx;
}

/** A title, fitted to a binding's free compartment but not yet drawn. */
interface TitleRun {
  text: string;
  fontPx: number;
  family: string;
  /** The glyph run's own length. */
  len: number;
  /** What the plate must be, along the spine, to hold it: `len` plus padding. */
  runLen: number;
}

/**
 * Fit the title to the compartment this binding leaves free — measure only.
 *
 * Measuring and painting are separate because the plate's rectangle has to be
 * known before `drawBookSpine` runs (it is passed in as `reserved`, so tooling
 * that would cross the lettering is skipped and a gilt panel grows to frame it
 * instead) while the lettering itself has to be painted after, on top of the
 * cloth. One function that did both could only ever be called too late.
 *
 * The size is decided by the plate's *width* — a run of letters has to sit
 * inside it across the spine — and the plate is then cut to the run's length.
 * Shrinking and ellipsising only happen when even the whole compartment is too
 * short, which for a real book title is rare. How short that is depends on the
 * binding: a corded book's 0.30–0.60 compartment is a good deal less than a
 * plain wrapper's whole spine.
 */
function measureSpineTitle(
  decor: DesignBox,
  design: BookDesign,
  title: string,
  font: number,
  scale: number,
): TitleRun {
  const lw = decor.w * 0.62;
  const pad = Math.max(2, lw * 0.16);
  // `decor.h` as the requested run is a stand-in for "as long as you'll give
  // me": `bookLabelBox` clamps it to the compartment, which is never taller
  // than the box itself. That keeps the compartment's extent in ONE place.
  const maxRun = Math.max(pad * 2, bookLabelBox(decor, design, decor.h).h - pad * 2);
  const family = FONTS[font % FONTS.length] as string;
  const m = measureCtx();

  let fontPx = Math.min(lw * 0.58, 17 * scale);
  const minFont = Math.max(4.5, fontPx * 0.55);
  const runOf = (t: string): number => {
    m.font = `${fontPx.toFixed(2)}px ${family}`;
    return m.measureText(t).width;
  };

  let text = title;
  while (runOf(text) > maxRun && fontPx > minFont) fontPx = Math.max(minFont, fontPx * 0.94);
  if (runOf(text) > maxRun) {
    while (text.length > 1 && runOf(`${text}…`) > maxRun) text = text.slice(0, -1);
    const trimmed = text.replace(/[\s,;:.-]+$/u, '');
    text = `${trimmed.length > 0 ? trimmed : text}…`;
  }

  m.font = `${fontPx.toFixed(2)}px ${family}`;
  const len = m.measureText(text).width;
  return { text, fontPx, family, len, runLen: len + pad * 2 };
}

/**
 * Set the measured run down the spine, on a cream plate or straight on the
 * cloth.
 *
 * Flat means flat: no foil ramp, no relief copy, no burnished glint travelling
 * along the run. The one liberty is a hair of baseline wobble per glyph, which
 * is the same liberty every other shape in this style takes.
 *
 * `plate` is false for the bindings that carry no lettering-piece — a plain
 * wrapper, limp vellum, blind-tooled calf. Those books get their title stamped
 * directly onto the covering, which is what the real thing does; painting a
 * cream panel onto all 62 presets is what made a third of them stop meaning
 * anything.
 */
function paintSpineTitle(
  ctx: Ctx2D,
  box: DesignBox,
  run: TitleRun,
  design: BookDesign,
  scale: number,
  plate: boolean,
): void {
  if (plate) {
    panel(ctx, box.x, box.y, box.w, box.h, FLAT.cream, {
      radius: box.w * 0.18,
      seed: design.seed + 3,
      width: Math.max(1, inkWidth(box.w) * 0.7),
    });
  }

  const m = measureCtx();
  m.font = `${run.fontPx.toFixed(2)}px ${run.family}`;
  const wob = mulberry32((design.seed ^ 0x7115) >>> 0);
  ctx.save();
  // A quarter turn clockwise, so the run reads top-to-bottom the way it does
  // on a real spine and the glyph tops face the fore-edge.
  ctx.translate(box.x + box.w / 2, box.y + (box.h - run.len) / 2);
  ctx.rotate(Math.PI / 2);
  ctx.font = `${run.fontPx.toFixed(2)}px ${run.family}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  // Gilt lettering on a gilded book with no plate under it — otherwise soft
  // ink, which is what reads on cream.
  ctx.fillStyle = !plate && design.gilt ? FLAT.gilt : FLAT.inkSoft;
  let advance = 0;
  for (const ch of run.text) {
    ctx.fillText(ch, advance, (wob() * 2 - 1) * 0.5 * scale);
    advance += m.measureText(ch).width;
  }
  ctx.restore();
}

/**
 * The ornament stamp, struck straight onto the cloth.
 *
 * `drawOrnament` was always pure paths — no gradient, no tile — so the twelve
 * stamps survive the restyle intact. All that changes is the ink: one flat
 * colour, gilt on a gilded book and soft ink otherwise, with none of the
 * stencil/foil/relief machinery that used to composite it.
 */
function drawSpineOrnament(
  ctx: Ctx2D,
  decor: DesignBox,
  params: SpineParams,
  top: number,
  bottom: number,
  scale: number,
): void {
  // `top`/`bottom` are the binding's OWN free compartment, not a fixed
  // fraction of the height. The old floor of 0.79 was right for one dressing
  // and wrong for the rest: on a corded book it lands on a cord, and on a half
  // binding 0.30 puts the stamp on the leather rather than in the panel.
  const size = Math.min(decor.w * 0.3, 13 * scale, (bottom - top) / 2.2);
  if (size < 2.4 || decor.w < 12) return;
  const colour = params.gilt ? FLAT.gilt : FLAT.inkSoft;
  ctx.save();
  ctx.lineWidth = Math.max(1, size * 0.17);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  drawOrnament(
    ctx,
    params.ornament,
    decor.x + decor.w / 2,
    (top + bottom) / 2,
    size,
    mulberry32((params.seed ^ 0x0c17) >>> 0),
  );
  ctx.restore();
}

/**
 * A charm, reduced to one mark: a ribbon lying down the head of the spine.
 *
 * The six charm kinds (tassel, wax seal, clasp, tag…) were six little painted
 * objects with palettes of their own, and six competing styles on one shelf is
 * exactly what this restyle exists to stop. Flat art says the same thing with
 * one shape in one of the palette's colours; the *kind* still survives in the
 * params, and the pull-out and open book are free to draw it in full.
 */
function drawSpineRibbon(
  ctx: Ctx2D,
  body: DesignBox,
  params: SpineParams,
  design: BookDesign,
): void {
  const { x, y, w, h } = body;
  const rw = Math.max(2, w * 0.2);
  if (rw < 2.5 || h < 40) return;
  const rh = Math.min(h * 0.16, rw * 6);
  const colour = RIBBON_COLOURS[(params.charmColor ?? 0) % RIBBON_COLOURS.length] as string;
  // It starts ABOVE the head so its top cap and outline are cut off by the
  // bake's own bounds — that is what makes it read as coming out of the book
  // rather than as a pill painted on the cloth. Right of centre for the same
  // reason a real marker sits off to one side. A notched tail would be under
  // a pixel at shelf scale, so the foot is rounded like everything else.
  panel(ctx, x + w * 0.56 - rw / 2, y - rh * 0.22, rw, rh, colour, {
    radius: rw * 0.42,
    seed: design.seed + 5,
    width: Math.max(1, inkWidth(rw) * 0.8),
  });
}

export interface RenderSpineOptions {
  /**
   * Hi-res variant: sets the book's real title on the spine label. Lo-res LOD
   * bakes skip text entirely (illegible at that size anyway) and get the
   * label's ruled placeholder instead.
   */
  hiRes?: boolean;

  /* ------------------------- accepted and ignored ------------------------- */
  /* These four described where a book stood in the room's light rig. Flat art
   * has no light model at all — a spine is the same colour wherever it stands,
   * and that is the whole point of the style, not an omission. They stay in
   * the signature because the shelf's bake jobs still carry them across the
   * worker boundary, and churning four files to delete a number that is
   * already free would buy no pixels. */

  /** Where this book sits along the row, 0 → 1. */
  rowPhase?: number;
  /** How far back in the shelf the book sits, 0 → 1. */
  depth?: number;
  /** The neighbouring spines' colours. */
  neighbourLeft?: string | null;
  neighbourRight?: string | null;
}

/**
 * Render one spine at (x, y) on `ctx`. hPx is the spine height in canvas px;
 * `scale` converts world px → canvas px (params.w * scale = drawn width).
 *
 * params.lean and params.hJitter are NOT applied here — spines are baked
 * upright into atlas rects; the shelf compositor applies lean/height when
 * placing the sprite.
 *
 * Layer order: the binding (silhouette, covering material, cords, tooling and
 * — unless we are setting one ourselves — its lettering-piece) → the title →
 * the ornament → the ribbon. `art/bookDesign.ts` owns the first of those; this
 * function owns the three that carry the book's own identity.
 *
 * The binding is a THIRD axis on top of the params: `presetForSeed` gives every
 * book one of 62 deterministically, and `params.binding` pins it when the
 * reader has chosen in the studio. Nothing here consults `flatScheme()` — a
 * book keeps its own colours in every room, which is what lets you recognise
 * it after a repaint.
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
  const seeded = flatSpineFor(params.seed);
  const design = resolveBookDesign({
    seed: params.seed,
    cloth: clothForPalette(params.palette),
    gilt: params.gilt,
    labelAt: seeded.labelAt,
    preset: params.binding ?? null,
    // The studio's four own axes. They used to stop here: the sheet offered
    // cords, endbands, a covering and a wear slider, `drawBookSpine` had never
    // heard of any of them, and every one of those controls moved nothing.
    material: params.materialPinned === true ? materialLookFor(params.material) : null,
    bands: params.raisedBands ?? 0,
    bandGilt: params.bandGilt ?? params.gilt,
    headTail: params.headTail ? (params.headTailStyle ?? 0) : null,
    wear: params.wear ?? 0,
  });

  // Geometry BEFORE any drawing: three shapes stand narrower than their slot
  // and `slipcased` moves the decorated surface onto the case, so the title
  // and the ornament belong on `decor`, not on the footprint.
  const boxes = bookSpineBoxes(design, x, y, w, h);

  // Lettering is hi-res only — at the lo LOD the glyphs are a smudge, and the
  // binding's own ruled placeholder says "this book is titled" for a fraction
  // of the cost. But a titled book carries a *plate* at BOTH levels, so zooming
  // in fills the label rather than conjuring one out of nothing. (Slivers
  // under ~23 world px still pop: at the lo scale their label would be four
  // pixels wide, and drawing it would be worse than the pop.)
  const text = title.trim();
  const titled = text.length > 0 && opts.hiRes === true && fitsTitle(boxes.decor);
  // Whether this book wears a lettering-piece is the BINDING's answer, with
  // the studio's explicit `titlePlate` able to overrule it. Plating all 62
  // presets regardless is what would make a third of them indistinguishable.
  const plate =
    fitsLabelPlate(boxes.decor) &&
    (hasDecoration(design, 'label-plate') || (params.titlePlate ?? 'none') !== 'none');

  const run = titled ? measureSpineTitle(boxes.decor, design, text, params.font, scale) : null;
  const box = run !== null ? bookLabelBox(boxes.decor, design, run.runLen) : null;

  const f = drawBookSpine(ctx, x, y, w, h, design, {
    // Reserve the band the lettering will occupy even when no plate goes under
    // it: tooling struck across a title is the one thing worse than no tooling.
    reserved: box !== null ? { y0: box.y, y1: box.y + box.h } : null,
    ownLabel: titled,
    noContact: false,
  });

  if (run !== null && box !== null) paintSpineTitle(ctx, box, run, design, scale, plate);

  if (params.ornamentOn ?? true) {
    // Whatever ended up highest — our plate, or the binding's own — is the
    // ornament's ceiling; the compartment's floor is its floor.
    const above = box ?? f.label;
    const top = above !== null ? above.y + above.h : f.freeTop;
    drawSpineOrnament(ctx, f.decor, params, top, f.freeBottom, scale);
  }

  // The design's `ribbon-marker` and the charm ribbon are different objects at
  // different x. A book that has both wears two ribbons, which reads as a
  // mistake rather than as a well-used book.
  if ((params.charm ?? 'none') !== 'none' && !hasDecoration(design, 'ribbon-marker')) {
    drawSpineRibbon(ctx, f.body, params, design);
  }
}

/* ========================================================================== *
 *                        shelf-row composition (§3)                          *
 * ========================================================================== *
 *
 * "Per shelf, generate a *composition*, not a row: choose a rhythm of
 *  thick/thin, tall/short, leaning/upright, proud/recessed; cluster similar
 *  bindings then break the pattern; leave occasional gaps and stacked-flat
 *  books."
 *
 * The old layout put every book in a slot of its own width with a 1–5px gap.
 * That is a *packing*, and packings look packed. What follows is a
 * composition: a plan of runs, each with a character, laid out left to right,
 * with the books ASSIGNED to runs by how well they suit the run's character
 * rather than taken in order.
 *
 * Everything here is pure and deterministic — same (books, seed) ⇒ identical
 * composition — so it can be unit-tested in node and cached by the shelf.
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
  /** A tight block of thin books — the row's rhythm section. */
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
   * (remapped to 0–1) and the contact shadow's gap.
   */
  depth: number;
  /** 0–1 along the row, for `renderSpine`'s `rowPhase`. */
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
  /** The run plan, in order — useful for tests and for debugging a bad row. */
  runs: RunCharacter[];
  /**
   * The row's skyline variation: (max - min) / max. The art direction asks for
   * 20–30%; the composer targets it explicitly and reports what it achieved.
   */
  skylineVariation: number;
  /** Ratio of the fattest book to the thinnest. */
  thicknessRatio: number;
}

export interface ComposeShelfRowOptions {
  /** Total width available, world px. Default 900. */
  width?: number;
  /** Composition seed. Same seed ⇒ same composition. */
  seed?: number;
  /**
   * Target skyline variation, (max-height − min-height) / max-height.
   * Default 0.26, the middle of the spec's 20–30%.
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
  // A run never immediately repeats itself — that repetition is exactly the
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
 *  3. break the pattern — swap members between long runs, because a perfectly
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
    // No three consecutive books within 3% of each other — the "irregular
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
    // A whole cluster shares a depth bias — books get pushed back in groups
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
