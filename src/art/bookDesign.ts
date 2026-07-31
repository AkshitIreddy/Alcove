/**
 * art/bookDesign.ts — the fifty-odd ways a book can be bound.
 *
 * `spines.ts` already knows how to dress a spine: bands, a cream label, one of
 * twelve ornament stamps, a ribbon. What it did not have was a *binding*. Every
 * book on the shelf was the same object — a rounded rectangle with a darker
 * strip down its left edge — recoloured six ways, so a full case read as one
 * book photocopied forty times. A real collection is a jumble of physically
 * different things standing next to each other: a limp vellum quarto beside a
 * stapled pamphlet beside a slipcased folio.
 *
 * This module supplies that missing axis, as three small independent
 * vocabularies that combine:
 *
 *   SHAPE     what the silhouette does — square, round-backed, tapered at the
 *             head, corded, overhanging, cased, a bare sliver.
 *   MATERIAL  what the face is made of, said in flat colour rather than in
 *             texture — where the turned board sits, whether the head third is
 *             a different leather, whether the body is cream vellum at all.
 *   DECORATION  what is tooled onto it — bands, panels, corner brackets, a
 *             lozenge, a blind frame, a foot ornament.
 *
 * and a table of 62 named presets so the studio can offer "Half Morocco" and
 * "Plain Wrapper" as things rather than as sixteen sliders.
 *
 * ## Two rules this file is built around
 *
 * **A book keeps its own colours.** Nothing here reads `flatScheme()`. The
 * timber, the recess and the wall are the room's to repaint; a book's cloth is
 * its own, in every room, because you find a book by recognising its spine.
 * Colour comes from `CLOTHS` and the fixed `FLAT` constants only.
 *
 * **Everything must survive 20–45 world px.** That is how wide a spine is
 * drawn, and it is the whole design constraint: a 30px-wide book has room for
 * about six horizontal marks and two vertical ones before they merge into
 * grey. So a material is expressed as *where the colour changes*, never as a
 * grain; a decoration is three chunky strokes, never a filigree; and every
 * shape difference is at least a tenth of the width, because a twentieth is a
 * rounding error. Anything finer than that is decoration nobody can see.
 *
 * Flat rules as everywhere else: one ink colour, rounded corners, edges that
 * bow, no light model. Depth is a darker flat face beside a lighter one.
 */

import {
  CLOTHS,
  FLAT,
  contactShadow,
  inkWidth,
  panel,
  stroke,
  wobbleRect,
  type FlatCtx,
} from './flat';
import { clamp, fnv1a, mulberry32 } from './noise';

/* ========================================================================== *
 *                              the vocabularies                              *
 * ========================================================================== */

/**
 * How the silhouette is cut. Ten shapes, each differing from `square` by at
 * least a tenth of the spine's width so the difference survives shelf scale.
 */
export const SPINE_SHAPES = [
  /** The ordinary case binding: near-square corners, dead upright. */
  'square',
  /** A rounded back — the sides belly out and the corners are generous. */
  'rounded',
  /** Flat back with the joints creased in: crisp corners, two groove lines. */
  'tight-back',
  /** The spine arcs away from the text block, so head and tail dome. */
  'hollow-back',
  /** The head is pinched in and flares out to full width below it. */
  'tapered-head',
  /** The head is cut into three lobes, as on a child's primer. */
  'scalloped-head',
  /** Sewn on raised cords: four flat pills stand proud across the spine. */
  'ribbed',
  /** Yapp edges — the covers overhang the block at head and tail. */
  'yapp',
  /** Standing in a slipcase, with only its head showing above the board. */
  'slipcased',
  /** A stitched pamphlet: a sliver, squared off, with a folded edge. */
  'pamphlet-thin',
] as const;
export type SpineShape = (typeof SPINE_SHAPES)[number];

/**
 * What the binding is made of, said flatly.
 *
 * None of these is a texture. A material here decides *where the colour
 * changes across the spine* — how wide the turned board is, whether there is
 * one on the far side too, whether the head third is a second hide, whether
 * the body is cream regardless of the book's pigment. That is the only way a
 * surface can differ at 30px, and it is also how the icon says "wood" and
 * "cloth" without painting either.
 */
export const MATERIAL_LOOKS = [
  /** Case cloth: one flat face, one darker turned board down the joint. */
  'smooth-cloth',
  /** Rep cloth: the same, ribbed across by eight darker rules. */
  'ribbed-cloth',
  /** Library buckram: the whole spine in the deep tone, matte and heavy. */
  'buckram',
  /** Grained goatskin: the face is inset on BOTH sides, so the back reads round. */
  'morocco-grain',
  /** Vellum: a cream body whatever the book's pigment; the colour lives on the label. */
  'vellum',
  /** Marbled paper: combed veins running the length of the spine. */
  'marbled-paper',
  /** Patterned paper: a diaper of small lozenges in a paler tone. */
  'patterned-paper',
  /** Half binding: the head third is a second hide, the rest is boards. */
  'half-bound',
  /** Quarter binding: a narrower head strip, and a matching one at the tail. */
  'quarter-bound',
  /** A printed paper wrapper: one flat pale colour, no turned board at all. */
  'paper-wrapper',
] as const;
export type MaterialLook = (typeof MATERIAL_LOOKS)[number];

/**
 * What is tooled onto the spine. A design carries none, one or two of these —
 * three is already a crowded 30px spine, and the caller usually adds a title
 * and an ornament stamp on top.
 */
export const DECORATIONS = [
  /** Nothing at all. Plenty of real books are like this and the shelf needs them. */
  'plain',
  /** The house band pattern: two rules near the head, one near the tail. */
  'gilt-bands',
  /** Three stations of paired thin rules — a fussier, more expensive look. */
  'double-bands',
  /** The cream lettering-piece the title is set on. */
  'label-plate',
  /** A tooled rectangle framing the title compartment. */
  'gilt-panel',
  /** Four small brackets at the corners of the spine face. */
  'corner-tooling',
  /** Two long rules running the height, just inside each edge. */
  'spine-rule',
  /** A filled lozenge struck in the middle of the free compartment. */
  'diamond-centre',
  /** A frame stamped without foil — ink only, the sober binding. */
  'blind-stamped-frame',
  /** A band of the accent paper across the spine, combed with three waves. */
  'marbled-band',
  /** A ribbon lying out of the head, off to one side. */
  'ribbon-marker',
  /** A small fleuron and rule at the tail. */
  'foot-ornament',
] as const;
export type Decoration = (typeof DECORATIONS)[number];

/** Display names for the studio's shape picker. */
export const SHAPE_LABELS: Readonly<Record<SpineShape, string>> = {
  square: 'Square',
  rounded: 'Rounded back',
  'tight-back': 'Tight back',
  'hollow-back': 'Hollow back',
  'tapered-head': 'Tapered head',
  'scalloped-head': 'Scalloped head',
  ribbed: 'Raised cords',
  yapp: 'Yapp edges',
  slipcased: 'Slipcased',
  'pamphlet-thin': 'Pamphlet',
};

/** Display names for the studio's material picker. */
export const MATERIAL_LOOK_LABELS: Readonly<Record<MaterialLook, string>> = {
  'smooth-cloth': 'Smooth cloth',
  'ribbed-cloth': 'Ribbed cloth',
  buckram: 'Buckram',
  'morocco-grain': 'Morocco grain',
  vellum: 'Vellum',
  'marbled-paper': 'Marbled paper',
  'patterned-paper': 'Patterned paper',
  'half-bound': 'Half bound',
  'quarter-bound': 'Quarter bound',
  'paper-wrapper': 'Paper wrapper',
};

/** Display names for the studio's decoration checklist. */
export const DECORATION_LABELS: Readonly<Record<Decoration, string>> = {
  plain: 'Plain',
  'gilt-bands': 'Gilt bands',
  'double-bands': 'Double bands',
  'label-plate': 'Label plate',
  'gilt-panel': 'Gilt panel',
  'corner-tooling': 'Corner tooling',
  'spine-rule': 'Spine rules',
  'diamond-centre': 'Diamond centre',
  'blind-stamped-frame': 'Blind frame',
  'marbled-band': 'Marbled band',
  'ribbon-marker': 'Ribbon marker',
  'foot-ornament': 'Foot ornament',
};

/**
 * Where the four raised cords sit, as fractions of the spine height.
 *
 * Not evenly spaced. Even spacing gives five identical compartments, none of
 * them tall enough for a lettering-piece, and the book comes out looking like
 * a ladder; a real corded spine has an enlarged second compartment that the
 * title lives in. `freeSpan` hands that compartment back to the caller.
 */
export const RIB_STATIONS: readonly number[] = [0.14, 0.3, 0.6, 0.8];

/* ========================================================================== *
 *                                 the design                                 *
 * ========================================================================== */

/** A fully-resolved binding. Everything the drawing needs, nothing optional. */
export interface BookDesign {
  /** The preset this came from, for the studio's list and for cache keys. */
  preset: BookPresetId;
  shape: SpineShape;
  material: MaterialLook;
  /** One or two marks; never empty (a plain book carries `['plain']`). */
  decorations: readonly Decoration[];
  /**
   * Index into `CLOTHS` — the book's OWN cloth. Deliberately not read from
   * `flatScheme()`: redecorating a room must not repaint the books in it.
   */
  cloth: number;
  /** Second cloth, for half/quarter bindings, marbled veins and ribbons. */
  accent: number;
  /** Foil on the tooling. False means the same marks struck in soft ink. */
  gilt: boolean;
  /** Where the label wants to sit, 0..1 of the spine height. */
  labelAt: number;
  seed: number;
}

/** A rectangle in canvas px. */
export interface DesignBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ========================================================================== *
 *                                  presets                                   *
 * ========================================================================== */

/** One entry in the studio's binding list. */
export interface BookPreset {
  id: string;
  /** What the studio calls it. */
  label: string;
  shape: SpineShape;
  material: MaterialLook;
  decorations: readonly Decoration[];
  /** Whether the tooling is struck in foil. */
  gilt: boolean;
  /**
   * Share of the shelf. Plain bindings are common because real shelves are
   * mostly plain; a slipcased folio is rare because a shelf with six of them
   * on it stops reading as a library and starts reading as a shop display.
   */
  weight: number;
}

/**
 * The 62 bindings, in the order the studio lists them: wrappers first, then
 * cloth, buckram, leather, vellum, decorated papers, half and quarter
 * bindings, and the oddities last.
 *
 * Two constraints hold across the table, and both are load-bearing:
 *
 *  - **No preset carries more than two decorations.** The caller adds a title
 *    and usually an ornament on top of whatever is here, and a 30px spine with
 *    five marks on it is a smudge.
 *  - **`gilt-panel` and `label-plate` may share a preset**, because the panel
 *    grows to enclose the label rather than colliding with it (see
 *    `drawDecoration`), and a lettering-piece inside a tooled panel is one of
 *    the handsomest things a spine does.
 */
export const BOOK_PRESETS: readonly BookPreset[] = [
  /* ------------------------------- wrappers ------------------------------- */
  { id: 'plain-wrapper', label: 'Plain Wrapper', shape: 'pamphlet-thin', material: 'paper-wrapper', decorations: ['plain'], gilt: false, weight: 7 },
  { id: 'stitched-pamphlet', label: 'Stitched Pamphlet', shape: 'pamphlet-thin', material: 'paper-wrapper', decorations: ['spine-rule'], gilt: false, weight: 5 },
  { id: 'offprint', label: 'Offprint', shape: 'pamphlet-thin', material: 'paper-wrapper', decorations: ['label-plate'], gilt: false, weight: 4 },
  { id: 'printed-wrapper', label: 'Printed Wrapper', shape: 'pamphlet-thin', material: 'patterned-paper', decorations: ['label-plate'], gilt: false, weight: 4 },
  { id: 'chapbook', label: 'Chapbook', shape: 'scalloped-head', material: 'paper-wrapper', decorations: ['foot-ornament'], gilt: false, weight: 3 },

  /* --------------------------------- cloth -------------------------------- */
  { id: 'plain-cloth', label: 'Plain Cloth', shape: 'square', material: 'smooth-cloth', decorations: ['plain'], gilt: false, weight: 8 },
  { id: 'gilt-quarto', label: 'Gilt Quarto', shape: 'square', material: 'smooth-cloth', decorations: ['gilt-bands', 'label-plate'], gilt: true, weight: 8 },
  { id: 'lettered-cloth', label: 'Lettered Cloth', shape: 'square', material: 'smooth-cloth', decorations: ['label-plate'], gilt: false, weight: 7 },
  { id: 'banded-cloth', label: 'Banded Cloth', shape: 'square', material: 'smooth-cloth', decorations: ['double-bands'], gilt: true, weight: 5 },
  { id: 'panelled-cloth', label: 'Panelled Cloth', shape: 'square', material: 'smooth-cloth', decorations: ['gilt-panel', 'label-plate'], gilt: true, weight: 4 },
  { id: 'blind-cloth', label: 'Blind-Stamped Cloth', shape: 'square', material: 'smooth-cloth', decorations: ['blind-stamped-frame'], gilt: false, weight: 4 },
  { id: 'ruled-cloth', label: 'Ruled Cloth', shape: 'square', material: 'smooth-cloth', decorations: ['spine-rule', 'label-plate'], gilt: true, weight: 4 },
  { id: 'rep-cloth', label: 'Rep Cloth', shape: 'square', material: 'ribbed-cloth', decorations: ['label-plate'], gilt: false, weight: 5 },
  { id: 'ribbed-rep', label: 'Ribbed Rep', shape: 'tight-back', material: 'ribbed-cloth', decorations: ['gilt-bands'], gilt: true, weight: 4 },
  { id: 'corded-rep', label: 'Corded Rep', shape: 'ribbed', material: 'ribbed-cloth', decorations: ['gilt-bands', 'label-plate'], gilt: true, weight: 4 },
  { id: 'foot-tooled-octavo', label: 'Foot-Tooled Octavo', shape: 'square', material: 'ribbed-cloth', decorations: ['gilt-bands', 'foot-ornament'], gilt: true, weight: 3 },
  { id: 'hollow-octavo', label: 'Hollow-Back Octavo', shape: 'hollow-back', material: 'smooth-cloth', decorations: ['gilt-bands', 'label-plate'], gilt: true, weight: 4 },
  { id: 'scalloped-primer', label: 'Scalloped Primer', shape: 'scalloped-head', material: 'smooth-cloth', decorations: ['label-plate'], gilt: false, weight: 3 },
  { id: 'diamond-primer', label: 'Diamond Primer', shape: 'tapered-head', material: 'smooth-cloth', decorations: ['diamond-centre'], gilt: true, weight: 3 },
  { id: 'tight-back-prize', label: 'Tight-Back Prize', shape: 'tight-back', material: 'smooth-cloth', decorations: ['gilt-panel', 'corner-tooling'], gilt: true, weight: 3 },
  { id: 'presentation-binding', label: 'Presentation Binding', shape: 'rounded', material: 'smooth-cloth', decorations: ['gilt-panel', 'diamond-centre'], gilt: true, weight: 2 },
  { id: 'yapp-pocket', label: 'Yapp Pocket', shape: 'yapp', material: 'smooth-cloth', decorations: ['label-plate'], gilt: false, weight: 3 },

  /* -------------------------------- buckram ------------------------------- */
  { id: 'library-buckram', label: 'Library Buckram', shape: 'square', material: 'buckram', decorations: ['label-plate'], gilt: false, weight: 6 },
  { id: 'college-buckram', label: 'College Buckram', shape: 'tight-back', material: 'buckram', decorations: ['spine-rule', 'label-plate'], gilt: true, weight: 4 },
  { id: 'reading-room-buckram', label: 'Reading-Room Buckram', shape: 'tight-back', material: 'buckram', decorations: ['double-bands'], gilt: false, weight: 4 },
  { id: 'gilt-buckram', label: 'Gilt Buckram', shape: 'square', material: 'buckram', decorations: ['gilt-bands', 'corner-tooling'], gilt: true, weight: 3 },
  { id: 'hollow-ledger', label: 'Hollow Ledger', shape: 'hollow-back', material: 'buckram', decorations: ['corner-tooling'], gilt: false, weight: 3 },
  { id: 'plain-buckram', label: 'Plain Buckram', shape: 'square', material: 'buckram', decorations: ['plain'], gilt: false, weight: 4 },

  /* -------------------------------- leather ------------------------------- */
  { id: 'full-morocco', label: 'Full Morocco', shape: 'rounded', material: 'morocco-grain', decorations: ['gilt-bands', 'corner-tooling'], gilt: true, weight: 5 },
  { id: 'tooled-morocco', label: 'Tooled Morocco', shape: 'ribbed', material: 'morocco-grain', decorations: ['gilt-bands', 'diamond-centre'], gilt: true, weight: 4 },
  { id: 'blind-calf', label: 'Blind-Tooled Calf', shape: 'rounded', material: 'morocco-grain', decorations: ['blind-stamped-frame'], gilt: false, weight: 4 },
  { id: 'panelled-calf', label: 'Panelled Calf', shape: 'rounded', material: 'morocco-grain', decorations: ['gilt-panel', 'label-plate'], gilt: true, weight: 4 },
  { id: 'tree-calf', label: 'Tree Calf', shape: 'hollow-back', material: 'morocco-grain', decorations: ['double-bands', 'label-plate'], gilt: true, weight: 3 },
  { id: 'diced-russia', label: 'Diced Russia', shape: 'ribbed', material: 'morocco-grain', decorations: ['double-bands', 'foot-ornament'], gilt: true, weight: 3 },
  { id: 'plain-calf', label: 'Plain Calf', shape: 'rounded', material: 'morocco-grain', decorations: ['plain'], gilt: false, weight: 4 },
  { id: 'yapp-devotional', label: 'Yapp Devotional', shape: 'yapp', material: 'morocco-grain', decorations: ['gilt-bands', 'ribbon-marker'], gilt: true, weight: 3 },
  { id: 'cathedral-morocco', label: 'Cathedral Morocco', shape: 'ribbed', material: 'morocco-grain', decorations: ['gilt-panel', 'label-plate'], gilt: true, weight: 2 },

  /* -------------------------------- vellum -------------------------------- */
  { id: 'antique-vellum', label: 'Antique Vellum', shape: 'tapered-head', material: 'vellum', decorations: ['spine-rule', 'label-plate'], gilt: false, weight: 4 },
  { id: 'limp-vellum', label: 'Limp Vellum', shape: 'hollow-back', material: 'vellum', decorations: ['plain'], gilt: false, weight: 4 },
  { id: 'gilt-vellum', label: 'Gilt Vellum', shape: 'rounded', material: 'vellum', decorations: ['gilt-bands', 'label-plate'], gilt: true, weight: 3 },
  { id: 'vellum-ties', label: 'Vellum with Ties', shape: 'yapp', material: 'vellum', decorations: ['ribbon-marker'], gilt: false, weight: 3 },
  { id: 'corded-vellum', label: 'Corded Vellum', shape: 'ribbed', material: 'vellum', decorations: ['label-plate'], gilt: false, weight: 3 },

  /* --------------------------- decorated papers --------------------------- */
  { id: 'marbled-boards', label: 'Marbled Boards', shape: 'square', material: 'marbled-paper', decorations: ['label-plate'], gilt: false, weight: 6 },
  { id: 'combed-marble', label: 'Combed Marble', shape: 'square', material: 'marbled-paper', decorations: ['gilt-bands'], gilt: true, weight: 4 },
  { id: 'shell-marble', label: 'Shell Marble', shape: 'rounded', material: 'marbled-paper', decorations: ['double-bands', 'label-plate'], gilt: true, weight: 3 },
  { id: 'spanish-wave', label: 'Spanish Wave', shape: 'tight-back', material: 'marbled-paper', decorations: ['marbled-band'], gilt: false, weight: 3 },
  { id: 'patterned-boards', label: 'Patterned Boards', shape: 'square', material: 'patterned-paper', decorations: ['label-plate'], gilt: false, weight: 5 },
  { id: 'diaper-paper', label: 'Diaper Paper', shape: 'square', material: 'patterned-paper', decorations: ['spine-rule'], gilt: false, weight: 4 },
  { id: 'block-printed', label: 'Block-Printed Boards', shape: 'tapered-head', material: 'patterned-paper', decorations: ['double-bands', 'label-plate'], gilt: false, weight: 3 },
  { id: 'ribbon-almanac', label: 'Ribbon Almanac', shape: 'square', material: 'patterned-paper', decorations: ['ribbon-marker', 'label-plate'], gilt: false, weight: 3 },

  /* --------------------------- half and quarter --------------------------- */
  { id: 'half-morocco', label: 'Half Morocco', shape: 'ribbed', material: 'half-bound', decorations: ['gilt-bands', 'label-plate'], gilt: true, weight: 6 },
  { id: 'half-calf', label: 'Half Calf', shape: 'rounded', material: 'half-bound', decorations: ['double-bands'], gilt: true, weight: 5 },
  { id: 'half-cloth', label: 'Half Cloth', shape: 'square', material: 'half-bound', decorations: ['label-plate'], gilt: false, weight: 5 },
  { id: 'half-roan', label: 'Half Roan', shape: 'tight-back', material: 'half-bound', decorations: ['spine-rule'], gilt: true, weight: 3 },
  { id: 'sammelband', label: 'Sammelband', shape: 'ribbed', material: 'half-bound', decorations: ['foot-ornament', 'label-plate'], gilt: true, weight: 2 },
  { id: 'tooled-tail', label: 'Tooled Tail', shape: 'rounded', material: 'half-bound', decorations: ['foot-ornament', 'spine-rule'], gilt: true, weight: 2 },
  { id: 'quarter-calf', label: 'Quarter Calf', shape: 'rounded', material: 'quarter-bound', decorations: ['double-bands'], gilt: true, weight: 5 },
  { id: 'quarter-cloth', label: 'Quarter Cloth', shape: 'square', material: 'quarter-bound', decorations: ['label-plate'], gilt: false, weight: 5 },
  { id: 'quarter-vellum', label: 'Quarter Vellum', shape: 'tapered-head', material: 'quarter-bound', decorations: ['spine-rule', 'label-plate'], gilt: false, weight: 3 },
  { id: 'marbled-quarter', label: 'Marbled Quarter', shape: 'square', material: 'quarter-bound', decorations: ['marbled-band', 'label-plate'], gilt: false, weight: 3 },

  /* ------------------------------- oddities ------------------------------- */
  { id: 'slipcased-set', label: 'Slipcased Set', shape: 'slipcased', material: 'smooth-cloth', decorations: ['label-plate'], gilt: false, weight: 3 },
  { id: 'slipcased-folio', label: 'Slipcased Folio', shape: 'slipcased', material: 'buckram', decorations: ['gilt-bands'], gilt: true, weight: 2 },
];

/** The id of one of the presets above. */
export type BookPresetId = string;

const PRESET_BY_ID: ReadonlyMap<string, BookPreset> = new Map(
  BOOK_PRESETS.map((p) => [p.id, p] as const),
);

/** Every preset id, in list order (the studio's dropdown). */
export const BOOK_PRESET_IDS: readonly string[] = BOOK_PRESETS.map((p) => p.id);

/** Look up a preset. Unknown ids fall back to the first, never throw. */
export function bookPreset(id: BookPresetId | null | undefined): BookPreset {
  return (id ? PRESET_BY_ID.get(id) : undefined) ?? (BOOK_PRESETS[0] as BookPreset);
}

export function isBookPresetId(v: unknown): v is BookPresetId {
  return typeof v === 'string' && PRESET_BY_ID.has(v);
}

const TOTAL_WEIGHT = BOOK_PRESETS.reduce((sum, p) => sum + p.weight, 0);

/**
 * Which binding a seed lands on. Weighted, so a shelf comes out mostly plain
 * cloth and wrappers with the expensive bindings as punctuation — the same
 * reason `spines.ts` rolls a thickness class before a thickness.
 */
export function presetForSeed(seed: number): BookPreset {
  // A dedicated stream, xored with a constant of its own, so adding this axis
  // does not reshuffle any of the draws `deriveSpineParams` already makes.
  let acc = mulberry32((seed ^ 0xb00d5e1) >>> 0)() * TOTAL_WEIGHT;
  for (const p of BOOK_PRESETS) {
    acc -= p.weight;
    if (acc < 0) return p;
  }
  return BOOK_PRESETS[BOOK_PRESETS.length - 1] as BookPreset;
}

/* ========================================================================== *
 *                                  resolve                                   *
 * ========================================================================== */

export interface ResolveBookDesignOptions {
  /** The book's 32-bit art seed. */
  seed: number;
  /** Cloth index. Callers pass `clothForPalette(params.palette)`. */
  cloth?: number;
  /** Second cloth. Defaults to one the seed picks, never equal to `cloth`. */
  accent?: number;
  /** Pin the binding (the studio's picker). Omit to let the seed choose. */
  preset?: BookPresetId | null;
  /** Force foil on or off, overriding the preset's own answer. */
  gilt?: boolean;
  /** Where the label sits, 0..1. Callers pass `FlatSpine.labelAt`. */
  labelAt?: number;
}

/**
 * Resolve a book's binding. Deterministic: same options ⇒ identical design,
 * so a book that picked "Half Morocco" on the day it was made is Half Morocco
 * forever, and a baked atlas rect stays valid across sessions.
 */
export function resolveBookDesign(opts: ResolveBookDesignOptions): BookDesign {
  const seed = opts.seed >>> 0;
  const preset = opts.preset ? bookPreset(opts.preset) : presetForSeed(seed);
  const cloth = normIndex(opts.cloth ?? seed % CLOTHS.length, CLOTHS.length);
  // The accent must never equal the cloth: a half binding whose leather is the
  // same colour as its boards is just a plain book with a stray line on it.
  const accent = normIndex(
    opts.accent ?? cloth + 1 + (((seed >>> 5) % (CLOTHS.length - 1)) | 0),
    CLOTHS.length,
  );
  return {
    preset: preset.id,
    shape: preset.shape,
    material: preset.material,
    decorations: preset.decorations,
    cloth,
    accent: accent === cloth ? normIndex(cloth + 1, CLOTHS.length) : accent,
    gilt: opts.gilt ?? preset.gilt,
    labelAt: clamp(opts.labelAt ?? 0.24, 0.16, 0.48),
    seed,
  };
}

/** The binding a stable string id resolves to (book row ids, test fixtures). */
export function bookDesignFromId(id: string, opts: Omit<ResolveBookDesignOptions, 'seed'> = {}): BookDesign {
  return resolveBookDesign({ ...opts, seed: fnv1a(id) });
}

/**
 * A short stable tag for one design.
 *
 * **Every cache that stores drawn book pixels must carry this** alongside
 * `flatSchemeTag()`. The binding is a new axis of variation and it is *not*
 * implied by the seed once the studio can pin a preset — without the tag in
 * the key, a book restyled from Plain Wrapper to Full Morocco keeps serving
 * the wrapper off the disk cache forever.
 */
export function bookDesignTag(design: BookDesign): string {
  return `${design.preset}.${design.cloth}${design.accent}${design.gilt ? 'g' : 'n'}`;
}

/** Does this design carry the given mark? */
export function hasDecoration(design: BookDesign, mark: Decoration): boolean {
  return design.decorations.includes(mark);
}

function normIndex(v: number, len: number): number {
  const n = Math.trunc(v);
  return ((n % len) + len) % len;
}

/* ========================================================================== *
 *                              colour helpers                                *
 * ========================================================================== */

/**
 * Mix two hexes. Used only to derive *neighbours* of the fixed palette — a
 * buckram that is the cloth pushed toward ink, a wrapper pushed toward cream.
 * Never to fake a light: both endpoints are palette colours, so everything
 * this produces still sits inside the icon's tiny range.
 */
function mix(a: string, b: string, t: number): string {
  const ca = channels(a);
  const cb = channels(b);
  const k = clamp(t, 0, 1);
  const to = (x: number, y: number): string =>
    Math.round(x + (y - x) * k)
      .toString(16)
      .padStart(2, '0');
  return `#${to(ca[0], cb[0])}${to(ca[1], cb[1])}${to(ca[2], cb[2])}`;
}

function channels(hex: string): [number, number, number] {
  if (hex.length === 7 && hex[0] === '#') {
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return [r, g, b];
  }
  return [128, 128, 128];
}

function clothPair(index: number): readonly [string, string] {
  return CLOTHS[normIndex(index, CLOTHS.length)] ?? (CLOTHS[0] as readonly [string, string]);
}

/**
 * The [face, board] pair the material actually shows at height fraction `t`.
 *
 * Cords, yapp lips, creases and the slipcase are drawn OUTSIDE the material
 * clip, so they cannot read the surface they sit on and have to ask. Without
 * this a vellum book grew green cords and a half binding's top cord came out
 * in the boards' colour instead of the leather's — in both cases the object
 * stopped reading as part of the book it is standing on.
 */
function surfaceAt(design: BookDesign, t: number): readonly [string, string] {
  const [face, dark] = clothPair(design.cloth);
  const [accentFace, accentDark] = clothPair(design.accent);
  switch (design.material) {
    case 'vellum':
      return [FLAT.cream, FLAT.creamDeep];
    case 'paper-wrapper': {
      const pale = mix(face, FLAT.cream, 0.34);
      return [pale, mix(pale, FLAT.ink, 0.2)];
    }
    case 'buckram':
      return [dark, mix(dark, FLAT.ink, 0.26)];
    case 'half-bound':
      return t < 0.34 ? [accentFace, accentDark] : [face, dark];
    case 'quarter-bound':
      return t < 0.18 || t > 0.9 ? [accentFace, accentDark] : [face, dark];
    default:
      return [face, dark];
  }
}

/**
 * Ribbon colourways. Saturated only — a pale ribbon at the head of a spine
 * reads as a second, smaller label, which is the one thing it must not do.
 * (Same reasoning, and the same shortlist, as `spines.ts`'s own ribbon.)
 */
const RIBBONS: readonly string[] = [
  FLAT.moss,
  FLAT.terracotta,
  FLAT.gilt,
  FLAT.slate,
  FLAT.plum,
  FLAT.sage,
];

/* ========================================================================== *
 *                             geometry helpers                               *
 * ========================================================================== */

/**
 * The same hash `flat.ts` wobbles with, repeated rather than imported so the
 * two files agree on what "drawn by hand" looks like without `flat.ts` having
 * to export a private detail.
 */
function wob(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** Continue the current path to (tx, ty) with a slight perpendicular bow. */
function bowTo(
  ctx: FlatCtx,
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  amount: number,
): void {
  const len = Math.hypot(tx - fx, ty - fy) || 1;
  const nx = -(ty - fy) / len;
  const ny = (tx - fx) / len;
  ctx.quadraticCurveTo((fx + tx) / 2 + nx * amount, (fy + ty) / 2 + ny * amount, tx, ty);
}

/** A wobbled rounded rect, filled but not outlined — for use inside a clip. */
function fillBand(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: string,
  radius: number,
  seed: number,
): void {
  if (w <= 0 || h <= 0) return;
  wobbleRect(ctx, x, y, w, h, radius, seed);
  ctx.fillStyle = colour;
  ctx.fill();
}

/* ========================================================================== *
 *                            stage 1 — the shape                             *
 * ========================================================================== */

/** What a shape does to the footprint it was given. */
export interface BookSpineBoxes {
  /** The drawn book body. Some shapes stand narrower than their footprint. */
  body: DesignBox;
  /**
   * Where tooling and the label go. Identical to `body` except for a
   * slipcased book, whose marks belong on the case rather than on the sliver
   * of head showing above it.
   */
  decor: DesignBox;
}

/**
 * The boxes `drawBookSpine` will use, without drawing anything.
 *
 * Exists so a caller that sets its own title can measure the run, ask
 * `bookLabelBox` where the lettering-piece lands, and hand that back as
 * `reserved` — all before a single pixel is committed.
 */
export function bookSpineBoxes(
  design: BookDesign,
  x: number,
  y: number,
  w: number,
  h: number,
): BookSpineBoxes {
  return shapeBoxes(design.shape, x, y, w, h);
}

/**
 * How much room each shape leaves inside its footprint.
 *
 * Three shapes stand narrower on purpose. A corded book's cords must reach the
 * full footprint or they are not standing proud of anything; a yapp binding's
 * overhang needs the same room; a pamphlet has to look like a sliver even when
 * the thickness roll gave it 40px, because the shape *is* the thinness. In
 * every case the footprint is unchanged, so the shelf composer's packing and
 * the atlas rect stay exactly as they were.
 */
function shapeBoxes(shape: SpineShape, x: number, y: number, w: number, h: number): BookSpineBoxes {
  switch (shape) {
    case 'ribbed': {
      // Barely inset. A cord that stands a long way proud of a narrow body
      // turns the book into a ladder — the rungs win and the book vanishes.
      const inset = w * 0.055;
      const body = { x: x + inset, y, w: w - inset * 2, h };
      return { body, decor: body };
    }
    case 'yapp': {
      const inset = w * 0.07;
      const body = { x: x + inset, y: y + h * 0.015, w: w - inset * 2, h: h * 0.97 };
      return { body, decor: body };
    }
    case 'pamphlet-thin': {
      const bw = w * 0.74;
      const body = { x: x + (w - bw) / 2, y, w: bw, h };
      return { body, decor: body };
    }
    case 'slipcased': {
      // The book stands INSIDE the case, so it is narrower and its head pokes
      // out the top; the case then covers everything below.
      const body = { x: x + w * 0.11, y, w: w * 0.78, h: h * 0.98 };
      return { body, decor: { x, y: y + h * 0.14, w, h: h * 0.86 } };
    }
    case 'tapered-head':
    case 'scalloped-head': {
      const body = { x, y, w, h };
      // Marks have to clear the cut head or they hang in the air beside it.
      return { body, decor: { x, y: y + h * 0.09, w, h: h * 0.91 } };
    }
    default: {
      const body = { x, y, w, h };
      return { body, decor: body };
    }
  }
}

/** Lay the silhouette into the current path. Fill and stroke are the caller's. */
function traceBookShape(ctx: FlatCtx, b: DesignBox, shape: SpineShape, seed: number): void {
  const { x, y, w, h } = b;
  const bow = Math.min(w, h) * 0.012;

  switch (shape) {
    case 'rounded': {
      // Generous corners plus a real belly on the sides: the whole point of a
      // rounded back is that its silhouette is not a rectangle.
      wobbleRect(ctx, x, y, w, h, Math.min(w * 0.46, h * 0.055), seed, w * 0.05);
      return;
    }
    case 'tight-back': {
      wobbleRect(ctx, x, y, w, h, Math.min(w * 0.08, h * 0.008), seed, Math.min(w, h) * 0.004);
      return;
    }
    case 'pamphlet-thin': {
      wobbleRect(ctx, x, y, w, h, Math.min(w * 0.1, h * 0.006), seed, Math.min(w, h) * 0.005);
      return;
    }
    case 'hollow-back': {
      // Head and tail dome away from the text block. The control points are
      // pulled a whisker past the box so the peak lands back on it.
      const arch = Math.min(w * 0.4, h * 0.04);
      ctx.beginPath();
      ctx.moveTo(x, y + arch);
      ctx.quadraticCurveTo(x + w / 2, y - arch * 0.95, x + w, y + arch);
      bowTo(ctx, x + w, y + arch, x + w, y + h - arch, bow);
      ctx.quadraticCurveTo(x + w / 2, y + h + arch * 0.95, x, y + h - arch);
      bowTo(ctx, x, y + h - arch, x, y + arch, bow);
      ctx.closePath();
      return;
    }
    case 'tapered-head': {
      const pinch = w * 0.18;
      const flare = h * 0.13;
      const r = Math.min(w * 0.16, h * 0.012);
      ctx.beginPath();
      ctx.moveTo(x + pinch + r, y);
      bowTo(ctx, x + pinch + r, y, x + w - pinch - r, y, bow);
      ctx.quadraticCurveTo(x + w - pinch, y, x + w - pinch + r * 0.6, y + r);
      bowTo(ctx, x + w - pinch + r * 0.6, y + r, x + w, y + flare, -bow * 0.7);
      bowTo(ctx, x + w, y + flare, x + w, y + h - r, bow);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      bowTo(ctx, x + w - r, y + h, x + r, y + h, bow);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      bowTo(ctx, x, y + h - r, x, y + flare, bow);
      bowTo(ctx, x, y + flare, x + pinch - r * 0.6, y + r, -bow * 0.7);
      ctx.quadraticCurveTo(x + pinch, y, x + pinch + r, y);
      ctx.closePath();
      return;
    }
    case 'scalloped-head': {
      const d = Math.min(w * 0.24, h * 0.03);
      const r = Math.min(w * 0.14, h * 0.01);
      const lobes = 3;
      ctx.beginPath();
      ctx.moveTo(x, y + d);
      for (let i = 0; i < lobes; i++) {
        const x0 = x + (w * i) / lobes;
        const x1 = x + (w * (i + 1)) / lobes;
        ctx.quadraticCurveTo((x0 + x1) / 2, y - d * 1.35, x1, y + d);
      }
      bowTo(ctx, x + w, y + d, x + w, y + h - r, bow);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      bowTo(ctx, x + w - r, y + h, x + r, y + h, bow);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      bowTo(ctx, x, y + h - r, x, y + d, bow);
      ctx.closePath();
      return;
    }
    case 'yapp': {
      wobbleRect(ctx, x, y, w, h, Math.min(w * 0.22, h * 0.016), seed);
      return;
    }
    default: {
      // square, ribbed, slipcased — a plain case with the house's small radius.
      wobbleRect(ctx, x, y, w, h, Math.min(w * 0.16, h * 0.014), seed);
      return;
    }
  }
}

/**
 * The parts of a shape that are separate objects rather than silhouette:
 * cords, yapp lips, joint grooves, pamphlet stitching, the slipcase itself.
 *
 * Drawn AFTER the body — a cord stands on the spine, and the slipcase stands
 * in front of the book — and before any tooling, which then lands on top of
 * whichever surface the reader is actually looking at.
 */
function drawShapeMarks(
  ctx: FlatCtx,
  foot: DesignBox,
  b: DesignBox,
  design: BookDesign,
  ink: number,
): void {
  const { x, y, w, h } = b;
  // Cords, creases and stitches are all sub-pixel on a sliver, and a sliver
  // with four grey rungs across it stops looking like a book.
  if (w < 9 && design.shape !== 'slipcased') return;

  switch (design.shape) {
    case 'ribbed': {
      // Fat, not thin: a cord is a rope under leather, and a hairline rung
      // would read as a rule rather than as something standing proud.
      const ch = Math.max(2.4, h * 0.026);
      for (let i = 0; i < RIB_STATIONS.length; i++) {
        const s = RIB_STATIONS[i] as number;
        panel(ctx, foot.x, y + h * s - ch / 2, foot.w, ch, surfaceAt(design, s)[0], {
          radius: ch * 0.46,
          seed: design.seed + 40 + i,
          width: Math.max(1, ink * 0.7),
        });
      }
      return;
    }
    case 'yapp': {
      // The covers overhang the block. The lips sit mostly OUTSIDE the body,
      // so they read as caps on the ends rather than as two rungs across it.
      const lh = Math.max(2, h * 0.03);
      for (const [ly, t, n] of [
        [y - lh * 0.62, 0, 0],
        [y + h - lh * 0.38, 1, 1],
      ] as const) {
        panel(ctx, foot.x, ly, foot.w, lh, surfaceAt(design, t)[1], {
          radius: lh * 0.45,
          seed: design.seed + 50 + n,
          width: Math.max(1, ink * 0.7),
        });
      }
      return;
    }
    case 'tight-back': {
      // Two creases where the covers hinge — the one thing that tells a flat
      // back from a rounded one at this size.
      const c = mix(surfaceAt(design, 0.5)[1], FLAT.ink, 0.35);
      for (const [t, n] of [
        [0.17, 0],
        [0.83, 1],
      ] as const) {
        stroke(
          ctx,
          x + w * t,
          y + h * 0.035,
          x + w * t,
          y + h * 0.965,
          c,
          Math.max(1, w * 0.045),
          design.seed + 60 + n,
        );
      }
      return;
    }
    case 'pamphlet-thin': {
      // A folded edge and three stitches: the whole story of a saddle-stapled
      // booklet, in four marks.
      stroke(
        ctx,
        x + w * 0.3,
        y + h * 0.03,
        x + w * 0.3,
        y + h * 0.97,
        mix(surfaceAt(design, 0.5)[1], FLAT.ink, 0.3),
        Math.max(1, w * 0.06),
        design.seed + 70,
      );
      const st = Math.max(1.4, h * 0.028);
      for (const [t, n] of [
        [0.26, 0],
        [0.5, 1],
        [0.74, 2],
      ] as const) {
        stroke(
          ctx,
          x + w * 0.64,
          y + h * t - st / 2,
          x + w * 0.64,
          y + h * t + st / 2,
          FLAT.inkSoft,
          Math.max(1, w * 0.09),
          design.seed + 71 + n,
        );
      }
      return;
    }
    case 'slipcased': {
      // A pale board sleeve standing in front of the book, with its own mouth
      // line at the top so it reads as open rather than as a second cover.
      const caseColour = mix(surfaceAt(design, 0.5)[1], FLAT.cream, 0.52);
      const cy = foot.y + foot.h * 0.14;
      const ch = foot.h - (cy - foot.y);
      panel(ctx, foot.x, cy, foot.w, ch, caseColour, {
        radius: Math.min(foot.w * 0.16, ch * 0.02),
        seed: design.seed + 80,
        width: Math.max(1, inkWidth(foot.w)),
      });
      stroke(
        ctx,
        foot.x + foot.w * 0.12,
        cy + ch * 0.035,
        foot.x + foot.w * 0.88,
        cy + ch * 0.035,
        FLAT.inkSoft,
        Math.max(1, foot.w * 0.05),
        design.seed + 81,
      );
      return;
    }
    default:
      return;
  }
}

/* ========================================================================== *
 *                           stage 2 — the material                           *
 * ========================================================================== */

/**
 * Paint the inside of the silhouette. The caller has already clipped to it, so
 * everything here may overshoot the box freely — which it does, because a
 * wobbled band clipped by a wobbled outline is what stops the two edges from
 * agreeing too neatly.
 */
function paintMaterial(ctx: FlatCtx, b: DesignBox, design: BookDesign): void {
  const { x, y, w, h } = b;
  const [face, dark] = clothPair(design.cloth);
  const [accentFace, accentDark] = clothPair(design.accent);
  const seed = design.seed;
  const r = Math.min(w * 0.3, h * 0.03);

  /** The house default: a dark turned board down the joint, face beside it. */
  const caseBody = (faceColour: string, boardColour: string, turn = 0.26): void => {
    fillBand(ctx, x - w, y - h * 0.02, w * 2, h * 1.04, boardColour, 0, seed);
    fillBand(ctx, x + w * turn, y - h * 0.02, w * (1 - turn) + w, h * 1.04, faceColour, r, seed + 11);
  };

  // Below this the fine work of a material — veins, lozenges, joint lines —
  // lands on less than a pixel and reads as dirt, so a sliver gets the plain
  // two-tone case and nothing else. The two-tone still carries the colour.
  const fine = w >= 11;

  switch (design.material) {
    case 'ribbed-cloth': {
      caseBody(face, dark);
      if (w < 8) return;
      // Eight ribs, a fixed count rather than a fixed spacing: the spine is
      // baked at two very different scales and a spacing rule would give four
      // ribs at one LOD and twelve at the other.
      const ribs = 8;
      const c = mix(dark, FLAT.ink, 0.14);
      for (let i = 1; i < ribs; i++) {
        const ry = y + (h * i) / ribs;
        stroke(ctx, x + w * 0.27, ry, x + w * 1.02, ry, c, Math.max(1, h * 0.006), seed + i);
      }
      return;
    }
    case 'buckram': {
      // The whole spine in the deep tone. Buckram is the library's workhorse
      // and it is always darker and flatter than a decorated cloth.
      caseBody(dark, mix(dark, FLAT.ink, 0.26), 0.3);
      return;
    }
    case 'morocco-grain': {
      // A turned board on BOTH sides, so the back reads as curved leather
      // rather than as a flat card with a stripe.
      caseBody(dark, dark);
      fillBand(ctx, x + w * 0.22, y - h * 0.02, w * 0.64, h * 1.04, face, r, seed + 12);
      if (!fine) return;
      const joint = mix(dark, FLAT.ink, 0.3);
      for (const [t, n] of [
        [0.22, 0],
        [0.86, 1],
      ] as const) {
        stroke(
          ctx,
          x + w * t,
          y + h * 0.02,
          x + w * t,
          y + h * 0.98,
          joint,
          Math.max(1, w * 0.035),
          seed + 20 + n,
        );
      }
      return;
    }
    case 'vellum': {
      // Cream whatever the book's pigment is — that is what makes a vellum
      // binding jump out of a row of coloured cloth. The pigment reappears on
      // the lettering-piece and the bands.
      caseBody(FLAT.cream, FLAT.creamDeep);
      if (!fine) return;
      stroke(
        ctx,
        x + w * 0.26,
        y + h * 0.02,
        x + w * 0.26,
        y + h * 0.98,
        mix(FLAT.creamDeep, FLAT.ink, 0.35),
        Math.max(1, w * 0.03),
        seed + 21,
      );
      return;
    }
    case 'marbled-paper': {
      caseBody(face, dark);
      if (!fine) return;
      // Four combed veins running the length. Vertical is the only direction
      // with room for a wave at this width.
      const veins = 4;
      for (let i = 0; i < veins; i++) {
        const vx = x + w * (0.32 + i * 0.17);
        const colour = i % 2 === 0 ? mix(accentFace, FLAT.cream, 0.22) : accentDark;
        const amp = w * 0.05 * (1 + wob(seed + i) * 0.3);
        ctx.beginPath();
        ctx.moveTo(vx, y + h * 0.02);
        const steps = 5;
        for (let s = 0; s < steps; s++) {
          const y0 = y + h * (0.02 + (0.96 * s) / steps);
          const y1 = y + h * (0.02 + (0.96 * (s + 1)) / steps);
          ctx.quadraticCurveTo(vx + (s % 2 === 0 ? amp : -amp), (y0 + y1) / 2, vx, y1);
        }
        ctx.strokeStyle = colour;
        ctx.lineWidth = Math.max(1, w * 0.055);
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      return;
    }
    case 'patterned-paper': {
      caseBody(face, dark);
      if (!fine) return;
      // A diaper of lozenges, two columns offset row by row. Ten rows, again a
      // fixed count so the pattern is the same pattern at every LOD.
      const pale = mix(face, FLAT.cream, 0.44);
      const rows = 10;
      const size = Math.min(w * 0.15, h * 0.018);
      ctx.fillStyle = pale;
      for (let row = 0; row < rows; row++) {
        const cy = y + h * (0.06 + (row * 0.88) / (rows - 1));
        for (let col = 0; col < 2; col++) {
          const cx = x + w * (row % 2 === 0 ? 0.44 + col * 0.3 : 0.59 + col * 0.3);
          if (cx > x + w * 0.94) continue;
          ctx.beginPath();
          ctx.moveTo(cx, cy - size);
          ctx.lineTo(cx + size * 0.7, cy);
          ctx.lineTo(cx, cy + size);
          ctx.lineTo(cx - size * 0.7, cy);
          ctx.closePath();
          ctx.fill();
        }
      }
      return;
    }
    case 'half-bound': {
      caseBody(face, dark);
      const split = 0.34;
      fillBand(ctx, x - w * 0.02, y - h * 0.02, w * 1.04, h * (split + 0.02), accentDark, r, seed + 30);
      fillBand(ctx, x + w * 0.26, y - h * 0.02, w * 1.04, h * (split + 0.02), accentFace, r, seed + 31);
      stroke(
        ctx,
        x - w * 0.02,
        y + h * split,
        x + w * 1.02,
        y + h * split,
        FLAT.ink,
        Math.max(1, inkWidth(w) * 0.6),
        seed + 32,
      );
      return;
    }
    case 'quarter-bound': {
      caseBody(face, dark);
      const head = 0.18;
      const tail = 0.1;
      for (const [top, height, n] of [
        [-0.02, head + 0.02, 0],
        [1 - tail, tail + 0.02, 1],
      ] as const) {
        fillBand(ctx, x - w * 0.02, y + h * top, w * 1.04, h * height, accentDark, r, seed + 33 + n);
        fillBand(ctx, x + w * 0.26, y + h * top, w * 1.04, h * height, accentFace, r, seed + 35 + n);
      }
      for (const [t, n] of [
        [head, 0],
        [1 - tail, 1],
      ] as const) {
        stroke(
          ctx,
          x - w * 0.02,
          y + h * t,
          x + w * 1.02,
          y + h * t,
          FLAT.ink,
          Math.max(1, inkWidth(w) * 0.55),
          seed + 37 + n,
        );
      }
      return;
    }
    case 'paper-wrapper': {
      // No turned board at all: a wrapper is one sheet folded round, and the
      // absence of the joint strip is exactly how the eye knows it is cheap.
      const pale = mix(face, FLAT.cream, 0.34);
      fillBand(ctx, x - w, y - h * 0.02, w * 3, h * 1.04, pale, 0, seed);
      if (!fine) return;
      const rule = mix(pale, FLAT.ink, 0.4);
      for (const [t, n] of [
        [0.09, 0],
        [0.91, 1],
      ] as const) {
        stroke(
          ctx,
          x + w * 0.14,
          y + h * t,
          x + w * 0.86,
          y + h * t,
          rule,
          Math.max(1, w * 0.05),
          seed + 40 + n,
        );
      }
      return;
    }
    default: {
      caseBody(face, dark);
      return;
    }
  }
}

/**
 * How far down the spine the material has already spoken for. A half binding
 * owns its head third; the caller's label must start below it or it lands on
 * the leather and reads as a mistake.
 */
function materialHeadClaim(material: MaterialLook): number {
  switch (material) {
    case 'half-bound':
      return 0.36;
    case 'quarter-bound':
      return 0.21;
    default:
      return 0;
  }
}

/** …and the same at the foot. */
function materialFootClaim(material: MaterialLook): number {
  return material === 'quarter-bound' ? 0.88 : 1;
}

/* ========================================================================== *
 *                          stage 3 — the decoration                          *
 * ========================================================================== */

/** A vertical band of the spine the caller has spoken for, in absolute px. */
interface Reserved {
  y0: number;
  y1: number;
}

/**
 * Does a lettering-piece fit, and read as one?
 *
 * The same test `spines.ts` applies before it sets a title, exported so the
 * two cannot disagree — a plate drawn here that the title code then declines
 * to fill is a blank white smear, and the reverse is a title floating on bare
 * cloth. On a sliver the answer is no and the book simply goes untitled, which
 * is what a sliver on a real shelf does.
 */
export function fitsLabelPlate(d: DesignBox): boolean {
  return d.w > 14 && d.h > 60;
}

/**
 * The width below which a mark stops being a mark.
 *
 * Tooling is a fraction of the spine's width, so on a 10px pamphlet a corner
 * bracket is one pixel long and a lozenge is a grey dot. Below these floors
 * the decoration is dropped rather than drawn illegibly: an undressed sliver
 * looks like a sliver, a dressed one looks like dirt.
 */
function fitsMark(mark: Decoration, w: number): boolean {
  switch (mark) {
    case 'gilt-panel':
    case 'blind-stamped-frame':
    case 'corner-tooling':
    case 'diamond-centre':
    case 'marbled-band':
      return w >= 12;
    case 'ribbon-marker':
    case 'foot-ornament':
      return w >= 10;
    default:
      return w >= 7;
  }
}

function overlaps(reserved: Reserved | null, y0: number, y1: number): boolean {
  return reserved !== null && y0 < reserved.y1 && y1 > reserved.y0;
}

function drawDecoration(
  ctx: FlatCtx,
  d: DesignBox,
  design: BookDesign,
  mark: Decoration,
  reserved: Reserved | null,
): void {
  const { x, y, w, h } = d;
  const seed = design.seed;
  const foil = design.gilt ? FLAT.gilt : FLAT.inkSoft;
  if (!fitsMark(mark, w)) return;

  switch (mark) {
    case 'gilt-bands': {
      // The icon's own proportions: two near the head, one near the tail.
      const band = Math.max(1.2, w * 0.1);
      for (const t of [0.14, 0.2, 0.82]) {
        stroke(ctx, x + w * 0.18, y + h * t, x + w * 0.86, y + h * t, foil, band, seed + t * 100);
      }
      return;
    }
    case 'double-bands': {
      const band = Math.max(1, w * 0.05);
      for (const [a, b] of [
        [0.12, 0.17],
        [0.46, 0.51],
        [0.79, 0.84],
      ] as const) {
        if (overlaps(reserved, y + h * a, y + h * b)) continue;
        for (const t of [a, b]) {
          stroke(ctx, x + w * 0.16, y + h * t, x + w * 0.88, y + h * t, foil, band, seed + t * 220);
        }
      }
      return;
    }
    case 'gilt-panel': {
      // A panel around a label is a real binding; a panel *across* one is a
      // mistake. So it grows to enclose whatever the caller reserved.
      const pad = h * 0.045;
      const top = reserved ? Math.min(y + h * 0.28, reserved.y0 - pad) : y + h * 0.3;
      const bottom = reserved ? Math.max(y + h * 0.64, reserved.y1 + pad) : y + h * 0.64;
      if (bottom - top < h * 0.1) return;
      wobbleRect(ctx, x + w * 0.14, top, w * 0.72, bottom - top, w * 0.2, seed + 90);
      ctx.strokeStyle = foil;
      ctx.lineWidth = Math.max(1, w * 0.06);
      ctx.lineJoin = 'round';
      ctx.stroke();
      return;
    }
    case 'corner-tooling': {
      const arm = Math.min(w * 0.32, h * 0.032);
      const lw = Math.max(1, w * 0.055);
      for (const [cx, cy, sx, sy] of [
        [x + w * 0.16, y + h * 0.05, 1, 1],
        [x + w * 0.84, y + h * 0.05, -1, 1],
        [x + w * 0.16, y + h * 0.95, 1, -1],
        [x + w * 0.84, y + h * 0.95, -1, -1],
      ] as const) {
        stroke(ctx, cx, cy, cx + arm * sx, cy, foil, lw, seed + cx);
        stroke(ctx, cx, cy, cx, cy + arm * sy * 1.4, foil, lw, seed + cy);
      }
      return;
    }
    case 'spine-rule': {
      const lw = Math.max(1, w * 0.055);
      for (const t of [0.15, 0.85]) {
        stroke(ctx, x + w * t, y + h * 0.05, x + w * t, y + h * 0.95, foil, lw, seed + t * 300);
      }
      return;
    }
    case 'diamond-centre': {
      // Somewhere clear: mid-spine normally, mid-way down the space below the
      // caller's label when there is one.
      const cy = reserved ? (reserved.y1 + y + h * 0.9) / 2 : y + h * 0.5;
      if (overlaps(reserved, cy - h * 0.04, cy + h * 0.04)) return;
      const s = Math.min(w * 0.3, h * 0.05);
      ctx.beginPath();
      ctx.moveTo(x + w / 2, cy - s);
      ctx.lineTo(x + w / 2 + s * 0.66, cy);
      ctx.lineTo(x + w / 2, cy + s);
      ctx.lineTo(x + w / 2 - s * 0.66, cy);
      ctx.closePath();
      ctx.fillStyle = foil;
      ctx.fill();
      return;
    }
    case 'blind-stamped-frame': {
      // Blind means struck without foil — ink only, always, even on a gilt
      // book. That is the whole point of the treatment.
      wobbleRect(ctx, x + w * 0.15, y + h * 0.045, w * 0.7, h * 0.91, w * 0.18, seed + 95);
      ctx.strokeStyle = FLAT.inkSoft;
      ctx.lineWidth = Math.max(1, w * 0.05);
      ctx.lineJoin = 'round';
      ctx.stroke();
      return;
    }
    case 'marbled-band': {
      const [bandFace] = clothPair(design.accent);
      let top = y + h * 0.66;
      if (overlaps(reserved, top, top + h * 0.12)) top = y + h * 0.04;
      const bh = h * 0.12;
      panel(ctx, x + w * 0.06, top, w * 0.88, bh, bandFace, {
        radius: w * 0.16,
        seed: seed + 100,
        width: Math.max(1, inkWidth(w) * 0.6),
      });
      for (let i = 0; i < 3; i++) {
        const ly = top + bh * (0.28 + i * 0.22);
        stroke(
          ctx,
          x + w * 0.12,
          ly,
          x + w * 0.88,
          ly,
          FLAT.inkSoft,
          Math.max(1, w * 0.04),
          seed + 101 + i,
        );
      }
      return;
    }
    case 'ribbon-marker': {
      // Off centre, and started above the head so its cap is cut off by the
      // bake's own bounds — that is what makes it read as coming out of the
      // book rather than as a pill painted on the cloth.
      const rw = Math.max(2, w * 0.19);
      const rh = Math.min(h * 0.17, rw * 6);
      const colour = RIBBONS[normIndex(design.accent, RIBBONS.length)] as string;
      panel(ctx, x + w * 0.3 - rw / 2, y - rh * 0.24, rw, rh, colour, {
        radius: rw * 0.42,
        seed: seed + 105,
        width: Math.max(1, inkWidth(rw) * 0.8),
      });
      return;
    }
    case 'foot-ornament': {
      const cy = y + h * 0.885;
      const s = Math.min(w * 0.2, h * 0.026);
      ctx.beginPath();
      ctx.moveTo(x + w / 2, cy - s);
      ctx.lineTo(x + w / 2 + s, cy + s * 0.7);
      ctx.lineTo(x + w / 2 - s, cy + s * 0.7);
      ctx.closePath();
      ctx.fillStyle = foil;
      ctx.fill();
      stroke(
        ctx,
        x + w * 0.2,
        y + h * 0.935,
        x + w * 0.8,
        y + h * 0.935,
        foil,
        Math.max(1, w * 0.06),
        seed + 110,
      );
      return;
    }
    default:
      return;
  }
}

/**
 * Where the lettering-piece goes — THE one answer, for both callers.
 *
 * `spines.ts` sets a real title at the hi-res LOD and this module draws a
 * ruled placeholder at the lo one, and the two must land on exactly the same
 * rectangle: a book whose label jumps when the LOD flips is worse than a book
 * with no label at all. So the caller asks here rather than recomputing.
 *
 * `runLen` is how much room the lettering needs *along* the spine. A real
 * spine label is cut to its title, so the plate grows about its own centre
 * inside the free compartment rather than truncating the words — which is the
 * difference between "The Long Winter" and "The Long…".
 */
export function bookLabelBox(d: DesignBox, design: BookDesign, runLen = 0): DesignBox {
  const { x, y, w, h } = d;
  const lw = w * 0.62;
  const span = freeSpan(design);
  const room = (span.bottom - span.top) * h;
  // The resting height, then as much of the compartment as the run asks for.
  const rest = Math.min(h * 0.24, lw * 2.4, room);
  const lh = clamp(runLen, rest, Math.max(rest, room));
  const cy = clamp(y + h * design.labelAt + rest / 2, y + h * span.top, y + h * span.bottom);
  const ly = clamp(cy - lh / 2, y + h * span.top, y + h * span.bottom - lh);
  return { x: x + (w - lw) / 2, y: ly, w: lw, h: lh };
}

/** The cream lettering-piece, ruled to stand in for a title at the lo LOD. */
function drawLabelPlate(ctx: FlatCtx, d: DesignBox, design: BookDesign, ink: number): DesignBox {
  const { x: lx, y: ly, w: lw, h: lh } = bookLabelBox(d, design);
  panel(ctx, lx, ly, lw, lh, FLAT.cream, {
    radius: lw * 0.18,
    seed: design.seed + 3,
    width: Math.max(1, ink * 0.7),
  });
  for (let i = 0; i < 3; i++) {
    const ry = ly + lh * (0.28 + i * 0.22);
    stroke(
      ctx,
      lx + lw * 0.2,
      ry,
      lx + lw * (0.8 - i * 0.12),
      ry,
      FLAT.inkSoft,
      Math.max(0.9, lw * 0.07),
      design.seed + i,
    );
  }
  return { x: lx, y: ly, w: lw, h: lh };
}

/* ========================================================================== *
 *                              the public draw                               *
 * ========================================================================== */

export interface DrawBookSpineOptions {
  /**
   * A band of the spine the caller will fill itself (its title plate), in
   * canvas px — usually straight out of `bookLabelBox`. Tooling that would
   * cross it is skipped, and a gilt panel grows to frame it instead.
   */
  reserved?: { y0: number; y1: number } | null;
  /**
   * The caller draws its own lettering-piece, so the design's `label-plate`
   * decoration must not draw a second one underneath it.
   */
  ownLabel?: boolean;
  /** Skip the contact shadow (a compositor that draws its own). Default false. */
  noContact?: boolean;
}

/** Where the drawing put things, so the caller can place its own on top. */
export interface BookSpineFurniture {
  /** The drawn body inside the footprint — narrower for three of the shapes. */
  body: DesignBox;
  /** The surface tooling and the label sit on (the case, for a cased book). */
  decor: DesignBox;
  /** The lettering-piece this design drew, or null when it drew none. */
  label: DesignBox | null;
  /** Top of the clear compartment, absolute px: below head bands and leather. */
  freeTop: number;
  /** Bottom of the clear compartment, absolute px: above tail bands. */
  freeBottom: number;
  /** Whether this design wants a cream lettering-piece at all. */
  wantsLabel: boolean;
}

/**
 * Draw one book, bound.
 *
 * Replaces `flatShelf.drawSpine` in the spine renderer: it covers the same
 * ground — silhouette, cloth, turned board, bands, label, contact shadow — and
 * adds the shape and material axes on top. The title, the ornament stamp and
 * the charm ribbon stay the caller's, which is why this returns the free
 * compartment rather than filling it.
 *
 * `x, y, w, h` is the FOOTPRINT: the slot the shelf composer gave this book.
 * Some shapes stand narrower inside it (see `shapeBoxes`), and the footprint is
 * never exceeded except by a yapp lip and a ribbon, both of which are meant to
 * break the outline.
 */
export function drawBookSpine(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  design: BookDesign,
  opts: DrawBookSpineOptions = {},
): BookSpineFurniture {
  const foot: DesignBox = { x, y, w, h };
  const { body, decor } = shapeBoxes(design.shape, x, y, w, h);
  const ink = inkWidth(body.w);

  // 1. the silhouette, filled with the material and outlined once.
  ctx.save();
  traceBookShape(ctx, body, design.shape, design.seed);
  ctx.clip();
  paintMaterial(ctx, body, design);
  ctx.restore();
  traceBookShape(ctx, body, design.shape, design.seed);
  ctx.strokeStyle = FLAT.ink;
  ctx.lineWidth = ink;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // 2. the shape's separate objects — cords, lips, creases, the slipcase.
  drawShapeMarks(ctx, foot, body, design, ink);

  // 3. tooling, on whichever surface ended up in front.
  const reserved: Reserved | null = opts.reserved ?? null;
  const wantsLabel = hasDecoration(design, 'label-plate') && fitsLabelPlate(decor);
  for (const mark of design.decorations) {
    if (mark === 'label-plate' || mark === 'plain') continue;
    drawDecoration(ctx, decor, design, mark, reserved);
  }

  // 4. the lettering-piece, unless the caller is about to set a real title.
  const label = wantsLabel && opts.ownLabel !== true ? drawLabelPlate(ctx, decor, design, ink) : null;

  // 5. where the book meets the plank. Last, and the only shadow in the app.
  if (opts.noContact !== true) {
    contactShadow(ctx, x + w / 2, y + h, w * 0.62, Math.max(1.5, w * 0.14), 0.18);
  }

  const claim = freeSpan(design);
  return {
    body,
    decor,
    label,
    freeTop: decor.y + decor.h * claim.top,
    freeBottom: decor.y + decor.h * claim.bottom,
    wantsLabel,
  };
}

/**
 * The clear stretch of spine, as fractions of the decorated surface.
 *
 * Everything a design puts near the head or the tail pushes these in, so the
 * caller's title and ornament land in a compartment rather than across a band.
 * The numbers are the decorations' own extents plus a hair of air.
 */
function freeSpan(design: BookDesign): { top: number; bottom: number } {
  let top = Math.max(0.06, materialHeadClaim(design.material));
  let bottom = Math.min(0.94, materialFootClaim(design.material));
  for (const mark of design.decorations) {
    switch (mark) {
      case 'gilt-bands':
        top = Math.max(top, 0.24);
        bottom = Math.min(bottom, 0.78);
        break;
      case 'double-bands':
        top = Math.max(top, 0.21);
        bottom = Math.min(bottom, 0.75);
        break;
      case 'corner-tooling':
        top = Math.max(top, 0.12);
        bottom = Math.min(bottom, 0.88);
        break;
      case 'marbled-band':
        bottom = Math.min(bottom, 0.62);
        break;
      case 'ribbon-marker':
        top = Math.max(top, 0.2);
        break;
      case 'foot-ornament':
        bottom = Math.min(bottom, 0.84);
        break;
      case 'blind-stamped-frame':
        top = Math.max(top, 0.1);
        bottom = Math.min(bottom, 0.9);
        break;
      default:
        break;
    }
  }
  if (design.shape === 'ribbed') {
    // The title compartment, the tall gap `RIB_STATIONS` leaves at 0.30–0.60.
    // A title crossing a cord reads as a misprint, not as a book.
    top = Math.max(top, 0.32);
    bottom = Math.min(bottom, 0.58);
  }
  return { top, bottom: Math.max(bottom, top + 0.16) };
}
