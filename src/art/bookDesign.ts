/**
 * art/bookDesign.ts — the hundred and fifty ways a book can be bound.
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
 *   SHAPE      what the silhouette does — square, round-backed, gabled, corded,
 *              boxed, coil-bound, a bare sliver. Fifty of them, each a genuinely
 *              different outline plus whatever separate objects hang off it.
 *   MATERIAL   what the face is made of, said in flat colour rather than in
 *              texture — where the turned board sits, whether the head third is
 *              a different hide, what marks the covering carries. Fifty.
 *   DECORATION what is tooled onto it — bands, panels, corner brackets, a
 *              lozenge, a crest, a blind frame, a foot ornament. Fifty.
 *
 * and a table of named presets so the studio can offer "Half Morocco" and
 * "Plain Wrapper" as things rather than as sixteen sliders.
 *
 * ## Why every axis is a TABLE and not a switch
 *
 * Fifty of anything cannot be fifty hand-written path functions and stay
 * coherent — the tenth one drifts from the first and the fortieth is somebody
 * else's drawing. So a shape is a row of numbers read by ONE tracer (an end
 * profile at the head, another at the tail, a side profile, a corner cut, and a
 * list of separate objects); a material is a row read by ONE painter (a body
 * tone, a turned board, an optional second covering at head and tail, and one
 * grain); a decoration is a row read by ONE toolist (a band run, a frame, a
 * motif, or an applied object). That is what makes the fiftieth entry as good
 * as the first, and it is the same reason `art/shelfDesign.ts` keeps its
 * carpentry as `BuildSpec` rows rather than as fifty drawings.
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
 * grain bitmap; a decoration is three chunky strokes, never a filigree; and
 * every shape difference is at least a tenth of the width, because a twentieth
 * is a rounding error. Anything finer is decoration nobody can see, and each
 * mark carries its own `floor` — the width below which it is dropped rather
 * than drawn as dirt.
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
 *                                   moods                                    *
 * ========================================================================== */

/**
 * What an entry FEELS like, so a roll of the dice can be steered.
 *
 * The first sixteen words are exactly `BuildTag` from `art/shelfDesign.ts`,
 * spelled identically on purpose: the studio's "in the mood for" row is built
 * by counting tags across every vocabulary (`designOptions.moodTags`), so a
 * word the carpentry and the bindings both use makes one chip that steers both
 * rather than two chips that each steer half the picture. The last eight are
 * the ones only a book can answer to.
 */
export type BookTag =
  | 'plain'
  | 'formal'
  | 'refined'
  | 'ornate'
  | 'fancy'
  | 'goofy'
  | 'whimsical'
  | 'cosy'
  | 'rustic'
  | 'natural'
  | 'antique'
  | 'modern'
  | 'severe'
  | 'airy'
  | 'heavy'
  | 'utilitarian'
  | 'gilt'
  | 'sober'
  | 'scholarly'
  | 'devotional'
  | 'handmade'
  | 'luxe'
  | 'battered'
  | 'pocket';

/** Every mood word, in the order a picker should offer them. */
export const BOOK_TAGS: readonly BookTag[] = [
  'plain',
  'formal',
  'refined',
  'ornate',
  'fancy',
  'gilt',
  'luxe',
  'scholarly',
  'devotional',
  'sober',
  'goofy',
  'whimsical',
  'cosy',
  'rustic',
  'natural',
  'handmade',
  'antique',
  'battered',
  'modern',
  'severe',
  'airy',
  'heavy',
  'pocket',
  'utilitarian',
];

export function isBookTag(value: unknown): value is BookTag {
  return typeof value === 'string' && (BOOK_TAGS as readonly string[]).includes(value);
}

/* ========================================================================== *
 *                              the vocabularies                              *
 * ========================================================================== */

/**
 * How the silhouette is cut. Fifty shapes, grouped rather than alphabetised so
 * the studio's grid reads as a progression: case bindings, then cut heads, then
 * the profiles that change width, the soft and limp coverings, the sewing you
 * can see, the mechanical bindings, the boxed ones, and last the fastened.
 *
 * The ten original ids all survive and still mean what they meant — a shape
 * reaches a book through its preset, and a preset id is persisted per book in
 * `data/designPrefs.ts`, so retiring one would silently rebind somebody's
 * library.
 */
export const SPINE_SHAPES = [
  // Case bindings: the differences are in the joint and the back.
  'square',
  'rounded',
  'tight-back',
  'double-hinge',
  'hollow-back',
  'spring-back',
  'cushioned',
  'ledger',

  // Heads that have been cut into.
  'domed-head',
  'round-cap',
  'gabled',
  'ogee-head',
  'notched-head',
  'stepped-head',
  'crenellated',
  'wave-head',
  'scalloped-head',
  'scalloped-tail',

  // Profiles that change width down the spine.
  'tapered-head',
  'splayed',
  'tapered-tail',
  'flared-tail',
  'shoulder',
  'waisted',
  'chamfered',
  'bevel-head',

  // Soft, limp and turned.
  'limp',
  'creased',
  'two-lobe',
  'rolled',

  // Sewing you can see.
  'ribbed',
  'exposed-cords',
  'coptic',
  'japanese-stab',
  'long-stitch',
  'sewn-sections',
  'pamphlet-thin',

  // Mechanical bindings.
  'spiral-wire',
  'comb-bound',
  'ring-binder',
  'saddle-stapled',

  // Boxed and wrapped.
  'slipcased',
  'clamshell',
  'boxed-set',
  'portfolio',
  'wallet',

  // Fastened.
  'yapp',
  'clasped',
  'chained',
  'tab-index',
] as const;
export type SpineShape = (typeof SPINE_SHAPES)[number];

/**
 * What the binding is covered in, said flatly.
 *
 * None of these is a texture. A material here decides *where the colour changes
 * across the spine* — how wide the turned board is, whether there is one on the
 * far side too, whether the head third is a second hide, whether the body is
 * cream regardless of the book's pigment — plus ONE grain: a handful of chunky
 * marks laid over the face. That is the only way a surface can differ at 30px,
 * and it is also how the icon says "wood" and "cloth" without painting either.
 *
 * Fifty coverings, in picker order: cloth and weave, figured silks, leather,
 * vellum, decorated papers, and last the split bindings where two coverings
 * share one book.
 */
export const MATERIAL_LOOKS = [
  // Cloth and weave.
  'smooth-cloth',
  'ribbed-cloth',
  'buckram',
  'linen',
  'canvas',
  'sailcloth',
  'hessian',
  'tweed',
  'felt',
  'velvet',

  // Figured silks.
  'silk-moire',
  'brocade',
  'damask',

  // Leather.
  'morocco-grain',
  'polished-calf',
  'russia-calf',
  'tree-calf',
  'sprinkled-calf',
  'mottled-calf',
  'roan',
  'skiver',
  'suede',
  'shagreen',
  'snakeskin',
  'crocodile',
  'pigskin',
  'oilcloth',

  // Vellum and parchment.
  'vellum',
  'parchment',
  'alum-tawed',

  // Decorated papers.
  'marbled-paper',
  'spanish-marble',
  'stone-marble',
  'shell-marble',
  'paste-paper',
  'patterned-paper',
  'block-print',
  'washi-print',
  'japanese-paper',
  'dutch-gilt',
  'stripe-paper',
  'chequer-paper',
  'paper-wrapper',
  'newsprint',

  // Two coverings on one book.
  'half-bound',
  'quarter-bound',
  'three-quarter',
  'half-cloth-paper',
  'tips-and-bands',
  'boards-exposed',
] as const;
export type MaterialLook = (typeof MATERIAL_LOOKS)[number];

/**
 * What is tooled onto the spine. A design carries none, one or two of these —
 * three is already a crowded 30px spine, and the caller usually adds a title
 * and an ornament stamp on top.
 *
 * Fifty marks, in picker order: rules and bands, applied plates, panels and
 * frames, corner work, single stamps, scattered work, and the head and foot
 * ornaments last.
 */
export const DECORATIONS = [
  'plain',

  // Rules and bands.
  'gilt-bands',
  'double-bands',
  'triple-bands',
  'spine-rule',
  'centre-rule',
  'edge-piping',
  'dotted-rule',
  'beaded-band',
  'dentil-band',
  'zigzag-band',
  'chequer-band',
  'rope-band',
  'chain-band',
  'greek-key',
  'wave-scroll',
  'marbled-band',

  // Applied plates and tickets.
  'label-plate',
  'banner-plaque',
  'shelf-ticket',
  'number-roundel',

  // Panels and frames.
  'gilt-panel',
  'double-frame',
  'blind-stamped-frame',
  'blind-panel',
  'arch-panel',
  'gothic-panel',
  'cartouche',
  'lattice-panel',

  // Corner and edge work.
  'corner-tooling',
  'shell-corners',
  'pin-studs',
  'bosses',

  // Single stamps.
  'diamond-centre',
  'monogram-lozenge',
  'rosette',
  'star-tooling',
  'crest',
  'crown-tooling',

  // Scattered and trailing work.
  'fleur-seme',
  'bee-diaper',
  'vine-trail',
  'laurel-spray',
  'acorn-tooling',
  'sunburst-fan',
  'wax-seal',

  // Head, foot and ribbon.
  'head-ornament',
  'foot-ornament',
  'tally-rules',
  'ribbon-marker',
] as const;
export type Decoration = (typeof DECORATIONS)[number];

/**
 * Where the four raised cords of a `ribbed` spine sit, as fractions of its
 * height.
 *
 * Not evenly spaced. Even spacing gives five identical compartments, none of
 * them tall enough for a lettering-piece, and the book comes out looking like
 * a ladder; a real corded spine has an enlarged second compartment that the
 * title lives in. `freeSpan` hands that compartment back to the caller.
 */
export const RIB_STATIONS: readonly number[] = [0.14, 0.3, 0.6, 0.8];

/** …and where the five BARE cords of an uncovered sewing sit. */
export const BARE_CORD_STATIONS: readonly number[] = [0.1, 0.26, 0.42, 0.74, 0.9];

/* ========================================================================== *
 *                          the shapes, as a table                            *
 * ========================================================================== */

/**
 * One end of the spine, as a run of knots in normalised coordinates.
 *
 * `u` runs 0→1 along the edge (left→right at the head, right→left at the tail);
 * `v` is measured OUTWARD in units of the shape's `endDepth`, so a positive v
 * is up at the head and down at the tail and the same table draws both. `cu/cv`
 * is the quadratic's control point; a control on the straight line between two
 * knots gives a straight run, which is how the gable and the steps stay crisp.
 */
type EndProfile =
  | 'flat'
  | 'cushion'
  | 'dome'
  | 'round'
  | 'gable'
  | 'ogee'
  | 'notch'
  | 'step'
  | 'crenel'
  | 'scallop2'
  | 'scallop3'
  | 'wave'
  | 'bevel';

/** What the long edges do between the two ends. */
type SideProfile = 'straight' | 'belly' | 'bulge' | 'waist' | 'ripple' | 'sway' | 'shoulder';

/**
 * The parts of a shape that are separate OBJECTS rather than silhouette.
 *
 * Drawn after the body — a cord stands on the spine, a slipcase stands in front
 * of the book — and before any tooling, which then lands on whichever surface
 * the reader is actually looking at.
 */
type ShapeMark =
  | 'cords'
  | 'bareCords'
  | 'grooves'
  | 'frenchGrooves'
  | 'stitchLine'
  | 'stabKnots'
  | 'longStitch'
  | 'chainStitch'
  | 'coil'
  | 'comb'
  | 'rings'
  | 'staples'
  | 'sections'
  | 'slipcase'
  | 'clamshell'
  | 'boxedSet'
  | 'flange'
  | 'walletFlap'
  | 'clasps'
  | 'chainLink'
  | 'knobs'
  | 'headcaps'
  | 'yappLips'
  | 'ledgerStrap'
  | 'tab';

interface Knot {
  u: number;
  v: number;
  cu: number;
  cv: number;
}

interface EndProfileSpec {
  /** Outward offset at the very start of the run, in units of `endDepth`. */
  v0: number;
  knots: readonly Knot[];
  /** The furthest this profile travels outward — used to size the body box. */
  reach: number;
}

function endProfile(v0: number, knots: readonly Knot[]): EndProfileSpec {
  let reach = Math.max(0, v0);
  let prev = v0;
  for (const k of knots) {
    // A quadratic's extreme is its midpoint value, (a + 2c + b) / 4.
    reach = Math.max(reach, k.v, (prev + 2 * k.cv + k.v) / 4);
    prev = k.v;
  }
  return { v0, knots, reach };
}

/** Two lobes, three lobes: a scalloped end, built rather than typed out. */
function lobes(count: number, height: number): readonly Knot[] {
  const out: Knot[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ u: (i + 1) / count, v: 0, cu: (i + 0.5) / count, cv: height });
  }
  return out;
}

const END_PROFILES: Readonly<Record<EndProfile, EndProfileSpec>> = {
  // The house edge: a hair of outward bow and nothing else.
  flat: endProfile(0, [{ u: 1, v: 0, cu: 0.5, cv: 0.3 }]),
  // A gently swollen end — a padded board, a springback's roll.
  cushion: endProfile(0, [{ u: 1, v: 0, cu: 0.5, cv: 1 }]),
  // The hollow back: the spine arcs away from the text block.
  dome: endProfile(0, [{ u: 1, v: 0, cu: 0.5, cv: 2 }]),
  // A rolled leather cap: flat across the crown, turned down hard at the sides.
  round: endProfile(0, [
    { u: 0.26, v: 1.55, cu: 0.04, cv: 1.2 },
    { u: 0.74, v: 1.55, cu: 0.5, cv: 2.15 },
    { u: 1, v: 0, cu: 0.96, cv: 1.2 },
  ]),
  // A pitched roof: both controls sit on the ramps, so the runs are straight.
  gable: endProfile(0, [
    { u: 0.5, v: 2.2, cu: 0.25, cv: 1.1 },
    { u: 1, v: 0, cu: 0.75, cv: 1.1 },
  ]),
  // The same rise, taken as an S — the ogee of a chapel door.
  ogee: endProfile(0, [
    { u: 0.5, v: 2.4, cu: 0.33, cv: 0.15 },
    { u: 1, v: 0, cu: 0.67, cv: 0.15 },
  ]),
  // A thumb notch cut INTO the end.
  notch: endProfile(0, [
    { u: 0.32, v: 0, cu: 0.16, cv: 0.12 },
    { u: 0.5, v: -1.7, cu: 0.41, cv: -0.85 },
    { u: 0.68, v: 0, cu: 0.59, cv: -0.85 },
    { u: 1, v: 0, cu: 0.84, cv: 0.12 },
  ]),
  // A two-tier ziggurat. Every control is a midpoint, so every run is straight.
  step: endProfile(0, [
    { u: 0.18, v: 0, cu: 0.09, cv: 0 },
    { u: 0.18, v: 1.1, cu: 0.18, cv: 0.55 },
    { u: 0.34, v: 1.1, cu: 0.26, cv: 1.1 },
    { u: 0.34, v: 2.2, cu: 0.34, cv: 1.65 },
    { u: 0.66, v: 2.2, cu: 0.5, cv: 2.2 },
    { u: 0.66, v: 1.1, cu: 0.66, cv: 1.65 },
    { u: 0.82, v: 1.1, cu: 0.74, cv: 1.1 },
    { u: 0.82, v: 0, cu: 0.82, cv: 0.55 },
    { u: 1, v: 0, cu: 0.91, cv: 0 },
  ]),
  // Battlements: two square teeth and the merlons between them.
  crenel: endProfile(0, [
    { u: 0.14, v: 0, cu: 0.07, cv: 0 },
    { u: 0.14, v: 1.8, cu: 0.14, cv: 0.9 },
    { u: 0.36, v: 1.8, cu: 0.25, cv: 1.8 },
    { u: 0.36, v: 0.1, cu: 0.36, cv: 0.95 },
    { u: 0.64, v: 0.1, cu: 0.5, cv: 0.1 },
    { u: 0.64, v: 1.8, cu: 0.64, cv: 0.95 },
    { u: 0.86, v: 1.8, cu: 0.75, cv: 1.8 },
    { u: 0.86, v: 0, cu: 0.86, cv: 0.9 },
    { u: 1, v: 0, cu: 0.93, cv: 0 },
  ]),
  scallop2: endProfile(0, lobes(2, 2)),
  scallop3: endProfile(0, lobes(3, 2)),
  // One S across the end — a cover that has curled.
  wave: endProfile(0, [
    { u: 0.5, v: 1.7, cu: 0.24, cv: 2.4 },
    { u: 1, v: -0.7, cu: 0.76, cv: -0.1 },
  ]),
  // A single slant: high on one side, flush on the other.
  bevel: endProfile(1.9, [{ u: 1, v: 0, cu: 0.5, cv: 0.95 }]),
};

/** One silhouette, as numbers the tracer and the mark drawer read. */
export interface ShapeSpec {
  id: SpineShape;
  name: string;
  /** One line for the studio card. */
  blurb: string;
  /** What this silhouette feels like. At least two, so a steer can hit it. */
  tags: readonly BookTag[];
  head: EndProfile;
  tail: EndProfile;
  side: SideProfile;
  /** Body width at the head and at the tail, as fractions of the body box. */
  headWidth: number;
  tailWidth: number;
  /** Where a `shoulder` side changes width, as a fraction of the height. */
  shoulderAt: number;
  /** Corner radius as a fraction of the width. */
  corner: number;
  /** A chamfer instead of a fillet where the ends meet the sides. */
  bevelCorner: boolean;
  /** How far an end profile travels, as a fraction of the height. */
  endDepth: number;
  /** The body stands this far inside its footprint, per side. */
  inset: number;
  /** …and this far down from the head, and up from the tail. */
  dropTop: number;
  dropBottom: number;
  /** Separate objects drawn after the body. */
  marks: readonly ShapeMark[];
  /** The decorated surface is the case, not the book (slipcase, box). */
  onCase: boolean;
  /** Where that case's head sits, as a fraction of the footprint height. */
  caseTop: number;
  /** Tooling keeps this much of the decorated surface clear, top and bottom. */
  decorTop: number;
  decorBottom: number;
  /** …and stands this far inside it horizontally. */
  decorInset: number;
  /** The clear compartment this shape's own furniture leaves for a title. */
  claimTop: number;
  claimBottom: number;
}

const SHAPE_DEFAULTS: Omit<ShapeSpec, 'id' | 'name' | 'blurb' | 'tags'> = {
  head: 'flat',
  tail: 'flat',
  side: 'straight',
  headWidth: 1,
  tailWidth: 1,
  shoulderAt: 0.2,
  corner: 0.16,
  bevelCorner: false,
  endDepth: 0.03,
  inset: 0,
  dropTop: 0,
  dropBottom: 0,
  marks: [],
  onCase: false,
  caseTop: 0.14,
  decorTop: 0,
  decorBottom: 0,
  decorInset: 0,
  claimTop: 0.06,
  claimBottom: 0.94,
};

function shape(
  id: SpineShape,
  name: string,
  blurb: string,
  tags: readonly BookTag[],
  spec: Partial<Omit<ShapeSpec, 'id' | 'name' | 'blurb' | 'tags'>> = {},
): ShapeSpec {
  return { ...SHAPE_DEFAULTS, ...spec, id, name, blurb, tags };
}

/** Every silhouette, keyed by id. */
export const SHAPES: Readonly<Record<SpineShape, ShapeSpec>> = {
  /* ------------------------------ case bindings ------------------------------ */

  square: shape('square', 'Square', 'The ordinary case binding: near-square corners, dead upright.',
    ['plain', 'utilitarian'], {}),

  rounded: shape('rounded', 'Rounded Back', 'The sides belly out and the corners are generous.',
    ['plain', 'antique', 'cosy'], { side: 'belly', corner: 0.46 }),

  'tight-back': shape('tight-back', 'Tight Back', 'Flat back with the joints creased in: crisp corners, two grooves.',
    ['formal', 'severe', 'refined'], { corner: 0.06, endDepth: 0.022, marks: ['grooves'] }),

  'double-hinge': shape('double-hinge', 'French Groove', 'Two grooves at each joint, so the covers open like doors.',
    ['formal', 'refined', 'luxe'], { corner: 0.06, endDepth: 0.022, marks: ['frenchGrooves'] }),

  'hollow-back': shape('hollow-back', 'Hollow Back', 'The spine arcs away from the text block, so head and tail dome.',
    ['antique', 'refined', 'airy'], { head: 'dome', tail: 'dome', corner: 0.1, endDepth: 0.04 }),

  'spring-back': shape('spring-back', 'Spring Back', 'The stationer’s swell: a back that bulges out under its own sewing.',
    ['heavy', 'utilitarian', 'antique'],
    { side: 'bulge', head: 'cushion', tail: 'cushion', headWidth: 0.9, tailWidth: 0.9, corner: 0.3 }),

  cushioned: shape('cushioned', 'Cushioned', 'Padded boards: every edge swollen, nothing sharp anywhere.',
    ['cosy', 'luxe', 'devotional'], { head: 'cushion', tail: 'cushion', side: 'belly', corner: 0.44 }),

  ledger: shape('ledger', 'Ledger', 'Square shoulders and a strap across the tail. Built to be written in.',
    ['utilitarian', 'heavy', 'sober'],
    { corner: 0.04, endDepth: 0.022, marks: ['grooves', 'ledgerStrap'], claimBottom: 0.74 }),

  /* -------------------------------- cut heads -------------------------------- */

  'domed-head': shape('domed-head', 'Domed Head', 'One arc over the head, and a flat foot to stand on.',
    ['refined', 'antique'], { head: 'dome', corner: 0.14, endDepth: 0.045, decorTop: 0.03 }),

  'round-cap': shape('round-cap', 'Rolled Caps', 'Leather turned over a cord at head and tail, and rolled round.',
    ['luxe', 'antique', 'refined'],
    { head: 'round', tail: 'round', endDepth: 0.04, corner: 0.1, marks: ['headcaps'],
      claimTop: 0.12, claimBottom: 0.88 }),

  gabled: shape('gabled', 'Gabled', 'A pitched roof over the head, as on a reliquary.',
    ['ornate', 'devotional', 'antique'], { head: 'gable', endDepth: 0.035, corner: 0.07, decorTop: 0.04 }),

  'ogee-head': shape('ogee-head', 'Ogee Head', 'The S-curve of a chapel door, taken to a point.',
    ['ornate', 'devotional', 'fancy'], { head: 'ogee', endDepth: 0.04, corner: 0.07, decorTop: 0.04 }),

  'notched-head': shape('notched-head', 'Notched Head', 'A thumb notch cut into the head, for pulling it off the shelf.',
    ['utilitarian', 'modern', 'plain'], { head: 'notch', endDepth: 0.035, corner: 0.1, decorTop: 0.04 }),

  'stepped-head': shape('stepped-head', 'Stepped Head', 'A two-tier ziggurat, cut square with a saw.',
    ['modern', 'goofy', 'formal'], { head: 'step', endDepth: 0.025, corner: 0.04, decorTop: 0.04 }),

  crenellated: shape('crenellated', 'Crenellated', 'Battlements: two teeth and the merlons between them.',
    ['goofy', 'ornate', 'whimsical'], { head: 'crenel', endDepth: 0.03, corner: 0.04, decorTop: 0.04 }),

  'wave-head': shape('wave-head', 'Wave Head', 'One S across the head, as though the cover had curled.',
    ['whimsical', 'handmade', 'battered'], { head: 'wave', endDepth: 0.035, corner: 0.1, decorTop: 0.04 }),

  'scalloped-head': shape('scalloped-head', 'Scalloped Head', 'The head cut into three lobes, as on a child’s primer.',
    ['whimsical', 'goofy', 'cosy'], { head: 'scallop3', endDepth: 0.032, corner: 0.14, decorTop: 0.04 }),

  'scalloped-tail': shape('scalloped-tail', 'Scalloped Tail', 'Three lobes at the foot, so it stands like a valance.',
    ['whimsical', 'fancy', 'cosy'], { tail: 'scallop3', endDepth: 0.032, corner: 0.14, decorBottom: 0.04 }),

  /* ---------------------------- changing widths ----------------------------- */

  'tapered-head': shape('tapered-head', 'Tapered Head', 'The head is pinched in and flares out to full width below it.',
    ['refined', 'antique', 'fancy'],
    { headWidth: 0.66, side: 'shoulder', shoulderAt: 0.13, decorTop: 0.05, decorInset: 0.03 }),

  splayed: shape('splayed', 'Splayed', 'A wedge: narrow at the head, full width where it stands.',
    ['handmade', 'battered', 'rustic'], { headWidth: 0.78, corner: 0.12, decorInset: 0.06 }),

  'tapered-tail': shape('tapered-tail', 'Tapered Tail', 'The reverse wedge — broad at the head, drawn in at the foot.',
    ['handmade', 'whimsical', 'battered'], { tailWidth: 0.78, corner: 0.12, decorInset: 0.06 }),

  'flared-tail': shape('flared-tail', 'Flared Foot', 'A plinth at the very bottom, as if the book had a base.',
    ['formal', 'ornate', 'heavy'],
    { headWidth: 0.86, side: 'shoulder', shoulderAt: 0.86, corner: 0.1, decorInset: 0.04 }),

  shoulder: shape('shoulder', 'Shouldered', 'A raised head panel steps out to the full width a third of the way down.',
    ['formal', 'modern', 'refined'],
    { headWidth: 0.8, side: 'shoulder', shoulderAt: 0.3, corner: 0.12, decorInset: 0.05 }),

  waisted: shape('waisted', 'Waisted', 'Pinched in at the middle, the way a book read to death goes.',
    ['battered', 'handmade', 'cosy'], { side: 'waist', corner: 0.2, decorInset: 0.05 }),

  chamfered: shape('chamfered', 'Bevelled Boards', 'All four corners cut off at a slant, never rounded.',
    ['formal', 'severe', 'luxe'], { corner: 0.34, bevelCorner: true, endDepth: 0.025 }),

  'bevel-head': shape('bevel-head', 'Bevelled Head', 'One long slant across the head — a book cut on the skew.',
    ['modern', 'goofy', 'whimsical'], { head: 'bevel', endDepth: 0.035, corner: 0.08, decorTop: 0.05 }),

  /* ------------------------------ soft and limp ----------------------------- */

  limp: shape('limp', 'Limp Binding', 'No boards at all: the whole spine leans and sways.',
    ['handmade', 'antique', 'devotional'],
    { side: 'sway', head: 'cushion', tail: 'cushion', corner: 0.34 }),

  creased: shape('creased', 'Creased', 'Three soft creases down a cover that has been rolled in a pocket.',
    ['battered', 'pocket', 'rustic'], { side: 'ripple', corner: 0.2 }),

  'two-lobe': shape('two-lobe', 'Twin Lobes', 'Two humps at each end: a fat pill of a book.',
    ['goofy', 'whimsical', 'cosy'],
    { head: 'scallop2', tail: 'scallop2', endDepth: 0.035, corner: 0.2 }),

  rolled: shape('rolled', 'Scroll', 'Barely a book: a roll with a turned knob at each end.',
    ['antique', 'whimsical', 'handmade'],
    { head: 'round', tail: 'round', endDepth: 0.05, inset: 0.13, corner: 0.4, marks: ['knobs'],
      claimTop: 0.14, claimBottom: 0.86 }),

  /* --------------------------- sewing you can see --------------------------- */

  ribbed: shape('ribbed', 'Raised Cords', 'Sewn on raised cords: four flat pills stand proud across the spine.',
    ['formal', 'luxe', 'antique'],
    { inset: 0.055, marks: ['cords'], claimTop: 0.32, claimBottom: 0.58 }),

  'exposed-cords': shape('exposed-cords', 'Exposed Cords', 'The cords never got covered — five bare ropes and the thread between them.',
    ['handmade', 'rustic', 'natural'],
    { inset: 0.1, corner: 0.1, marks: ['bareCords'], claimTop: 0.47, claimBottom: 0.7 }),

  coptic: shape('coptic', 'Coptic Sewing', 'A chain of link stitches runs the length of a bare spine.',
    ['handmade', 'natural', 'antique'], { inset: 0.09, corner: 0.08, marks: ['chainStitch'] }),

  'japanese-stab': shape('japanese-stab', 'Stab Sewn', 'Four knots down one side, and the thread that ties them.',
    ['handmade', 'refined', 'natural'], { corner: 0.06, marks: ['stabKnots'] }),

  'long-stitch': shape('long-stitch', 'Long Stitch', 'Three runs of stitching straight through a limp cover.',
    ['handmade', 'rustic', 'natural'],
    { head: 'cushion', tail: 'cushion', corner: 0.24, marks: ['longStitch'] }),

  'sewn-sections': shape('sewn-sections', 'Unbound Sections', 'No cover: five folded gatherings and their sewing.',
    ['handmade', 'plain', 'natural'], { inset: 0.08, corner: 0.06, marks: ['sections'] }),

  'pamphlet-thin': shape('pamphlet-thin', 'Pamphlet', 'A stitched sliver, squared off, with a folded edge.',
    ['plain', 'pocket', 'utilitarian'], { inset: 0.13, corner: 0.1, endDepth: 0.02, marks: ['stitchLine'] }),

  /* ---------------------------- mechanical binding -------------------------- */

  'spiral-wire': shape('spiral-wire', 'Spiral Wire', 'A wire coil threaded through the whole spine.',
    ['modern', 'utilitarian', 'plain'], { inset: 0.06, corner: 0.06, marks: ['coil'] }),

  'comb-bound': shape('comb-bound', 'Comb Bound', 'A plastic comb, nine teeth of it, gripping the edge.',
    ['modern', 'utilitarian', 'goofy'], { inset: 0.04, corner: 0.04, marks: ['comb'] }),

  'ring-binder': shape('ring-binder', 'Ring Binder', 'Three rings and a rigid back that will not bend.',
    ['modern', 'utilitarian', 'heavy'],
    { corner: 0.05, marks: ['rings'], claimTop: 0.58, claimBottom: 0.72 }),

  'saddle-stapled': shape('saddle-stapled', 'Saddle Stapled', 'Two wire staples through the fold, and nothing else.',
    ['plain', 'utilitarian', 'pocket'],
    { inset: 0.1, corner: 0.08, marks: ['staples'], claimTop: 0.32, claimBottom: 0.7 }),

  /* ----------------------------- boxed and wrapped -------------------------- */

  slipcased: shape('slipcased', 'Slipcased', 'Standing in a slipcase, with only its head showing above the board.',
    ['formal', 'luxe', 'refined'],
    { inset: 0.11, dropBottom: 0.02, marks: ['slipcase'], onCase: true, caseTop: 0.14, claimTop: 0.08 }),

  clamshell: shape('clamshell', 'Clamshell Box', 'A drop-back box: a lid line at the head and a lip down the fore edge.',
    ['formal', 'luxe', 'severe'],
    { inset: 0.05, dropBottom: 0.02, marks: ['clamshell'], onCase: true, caseTop: 0.06, claimTop: 0.2 }),

  'boxed-set': shape('boxed-set', 'Boxed Set', 'Two heads above one case: the second volume is in there too.',
    ['formal', 'luxe', 'cosy'],
    { inset: 0.14, marks: ['boxedSet'], onCase: true, caseTop: 0.2, claimTop: 0.26 }),

  portfolio: shape('portfolio', 'Portfolio', 'A flap folds across from the left and fastens with a stud.',
    ['utilitarian', 'formal', 'antique'],
    { inset: 0.02, corner: 0.1, marks: ['flange'], decorInset: 0.12 }),

  wallet: shape('wallet', 'Wallet Edge', 'An envelope flap over the foot, with a tongue to tuck in.',
    ['pocket', 'cosy', 'handmade'],
    { corner: 0.18, marks: ['walletFlap'], claimBottom: 0.68 }),

  /* --------------------------------- fastened -------------------------------- */

  yapp: shape('yapp', 'Yapp Edges', 'The covers overhang the block at head and tail.',
    ['devotional', 'cosy', 'antique'],
    { inset: 0.07, dropTop: 0.015, dropBottom: 0.015, corner: 0.22, marks: ['yappLips'] }),

  clasped: shape('clasped', 'Clasped', 'Two metal clasps hold it shut, and mean it.',
    ['antique', 'devotional', 'heavy'],
    { corner: 0.08, marks: ['clasps'], claimTop: 0.34, claimBottom: 0.66 }),

  chained: shape('chained', 'Chained', 'A ring and a link at the foot: this one does not leave the room.',
    ['antique', 'severe', 'scholarly'],
    { corner: 0.06, marks: ['chainLink'], claimBottom: 0.78 }),

  'tab-index': shape('tab-index', 'Thumb Index', 'A cut card tab standing at the fore edge, halfway down.',
    ['utilitarian', 'scholarly', 'modern'],
    { corner: 0.12, marks: ['tab'], claimTop: 0.06, claimBottom: 0.36 }),
};

/** Look up a silhouette; unknown ids give the plain case rather than a throw. */
export function shapeSpec(id: unknown): ShapeSpec {
  return SHAPES[(typeof id === 'string' ? id : '') as SpineShape] ?? SHAPES.square;
}

/** Display names for the studio's shape picker. */
export const SHAPE_LABELS: Readonly<Record<SpineShape, string>> = Object.freeze(
  Object.fromEntries(SPINE_SHAPES.map((id) => [id, SHAPES[id].name])) as Record<SpineShape, string>,
);

/** Every silhouette carrying `tag`, in picker order. For steered dice. */
export function shapesTagged(tag: BookTag): readonly ShapeSpec[] {
  return SPINE_SHAPES.map((id) => SHAPES[id]).filter((s) => s.tags.includes(tag));
}

/** All silhouettes in picker order. */
export function allShapes(): readonly ShapeSpec[] {
  return SPINE_SHAPES.map((id) => SHAPES[id]);
}

/* ========================================================================== *
 *                        the materials, as a table                           *
 * ========================================================================== */

/**
 * Which of the book's own colours the body is painted in.
 *
 * A covering is not a hue — the book already has one, from `CLOTHS` — it is a
 * RELATIONSHIP to that hue. Buckram is the same book in its own darker value;
 * a wrapper is the same book washed most of the way to paper; vellum throws the
 * pigment away entirely and keeps it only on the label, which is exactly why a
 * vellum quarto jumps out of a row of coloured cloth.
 */
type BodyTone = 'cloth' | 'deep' | 'pale' | 'cream' | 'parchment' | 'accent';

/**
 * Where a second covering sits, when a book has two.
 *
 * `half` is the classic: leather over the head third and the spine's joint,
 * boards below. The rest are the other places a binder splits a book, and each
 * one moves the line the reader's eye finds first.
 */
type Split = 'none' | 'half' | 'quarter' | 'threeQuarter' | 'tips' | 'headBand';

/**
 * The one grain a covering carries.
 *
 * ONE, never a texture pass: a 30px spine has room for about six horizontal
 * marks and two vertical ones before they merge into grey. Every entry here is
 * a handful of chunky flat marks, sized as a fraction of the spine, and each is
 * dropped whole below the material's `floor` rather than drawn as dirt.
 */
type Grain =
  | 'none'
  | 'ribs'
  | 'weave'
  | 'twill'
  | 'coarse'
  | 'fleck'
  | 'nap'
  | 'watered'
  | 'figured'
  | 'damask'
  | 'pebble'
  | 'panelled'
  | 'flame'
  | 'sprinkle'
  | 'mottle'
  | 'scales'
  | 'shagreen'
  | 'plates'
  | 'pinDot'
  | 'creases'
  | 'stitchRun'
  | 'combedVeins'
  | 'spanishWave'
  | 'stoneVein'
  | 'shellSpots'
  | 'pasteComb'
  | 'lozenges'
  | 'floret'
  | 'fibres'
  | 'laidLines'
  | 'giltDots'
  | 'stripes'
  | 'chequer'
  | 'newsRules'
  | 'wrapperRules'
  | 'scuffs';

/** Which colour the grain marks are struck in. */
type GrainTone = 'dark' | 'deeper' | 'pale' | 'cream' | 'ink' | 'accent' | 'foil';

/** One covering, as numbers the ONE painter reads. */
export interface MaterialSpec {
  id: MaterialLook;
  name: string;
  blurb: string;
  tags: readonly BookTag[];
  body: BodyTone;
  /** Turned board down the near joint, as a fraction of the width. 0 = none. */
  turn: number;
  /** …and on the far side, which is what makes a back read as rounded. */
  farTurn: number;
  split: Split;
  grain: Grain;
  grainTone: GrainTone;
  /** How many marks the grain lays down. Fixed counts, never fixed spacings. */
  grainCount: number;
  /** Fine ink lines down the joints: 0, 1 or 2. */
  joints: number;
  /** Below this spine width the grain is dropped whole. */
  floor: number;
}

const MATERIAL_DEFAULTS: Omit<MaterialSpec, 'id' | 'name' | 'blurb' | 'tags'> = {
  body: 'cloth',
  turn: 0.26,
  farTurn: 0,
  split: 'none',
  grain: 'none',
  grainTone: 'dark',
  grainCount: 8,
  joints: 0,
  floor: 11,
};

function material(
  id: MaterialLook,
  name: string,
  blurb: string,
  tags: readonly BookTag[],
  spec: Partial<Omit<MaterialSpec, 'id' | 'name' | 'blurb' | 'tags'>> = {},
): MaterialSpec {
  return { ...MATERIAL_DEFAULTS, ...spec, id, name, blurb, tags };
}

/** Every covering, keyed by id. */
export const MATERIALS: Readonly<Record<MaterialLook, MaterialSpec>> = {
  /* ------------------------------ cloth and weave ---------------------------- */

  'smooth-cloth': material('smooth-cloth', 'Smooth Cloth', 'Publisher’s cloth: one even face, one turned board, nothing else.',
    ['plain', 'sober', 'utilitarian'], {}),

  'ribbed-cloth': material('ribbed-cloth', 'Rep Cloth', 'Ribbed across in eight fine courses, the way rep is woven.',
    ['plain', 'formal', 'antique'], { grain: 'ribs', grainCount: 8, floor: 8 }),

  buckram: material('buckram', 'Library Buckram', 'The whole spine in its own deep tone. Matte, heavy, unbudgeable.',
    ['utilitarian', 'severe', 'scholarly'], { body: 'deep', turn: 0.3 }),

  linen: material('linen', 'Linen', 'A loose open weave you can count the threads of.',
    ['plain', 'natural', 'handmade'], { turn: 0.2, grain: 'weave', grainCount: 7 }),

  canvas: material('canvas', 'Canvas Duck', 'Heavy cotton duck, laid in a close diagonal twill.',
    ['utilitarian', 'rustic', 'heavy'], { body: 'pale', turn: 0.22, grain: 'twill', grainCount: 9 }),

  sailcloth: material('sailcloth', 'Sailcloth', 'No turned board at all — one bolt of canvas, seamed with heavy stitching.',
    ['utilitarian', 'handmade', 'rustic'], { body: 'pale', turn: 0, grain: 'stitchRun', grainCount: 12 }),

  hessian: material('hessian', 'Hessian', 'Sackcloth: six coarse slubs and not a smooth inch anywhere.',
    ['rustic', 'natural', 'battered'], { turn: 0.18, grain: 'coarse', grainCount: 6 }),

  tweed: material('tweed', 'Tweed', 'Flecked through with the second cloth, like a coat off a hook.',
    ['cosy', 'rustic', 'natural'], { turn: 0.24, grain: 'fleck', grainTone: 'accent', grainCount: 16 }),

  felt: material('felt', 'Felt', 'Thick and soft: a wide turned board and a napped edge that eats the light.',
    ['cosy', 'handmade', 'plain'], { turn: 0.36, grain: 'nap', grainCount: 3 }),

  velvet: material('velvet', 'Velvet', 'Deep pile, a broad dark board, and the accent lying along the fore edge.',
    ['luxe', 'ornate', 'cosy'], { body: 'deep', turn: 0.4, grain: 'nap', grainTone: 'accent', grainCount: 3 }),

  /* ------------------------------- figured silks ----------------------------- */

  'silk-moire': material('silk-moire', 'Watered Silk', 'Moiré: five long ripples running the height, like light on water.',
    ['luxe', 'refined', 'fancy'], { turn: 0.2, grain: 'watered', grainTone: 'pale', grainCount: 5 }),

  brocade: material('brocade', 'Brocade', 'A column of woven figures in the second colour, raised out of the ground.',
    ['ornate', 'luxe', 'fancy'], { turn: 0.22, grain: 'figured', grainTone: 'accent', grainCount: 6 }),

  damask: material('damask', 'Damask', 'Reversed weave: leaf shapes that are the same silk facing the other way.',
    ['ornate', 'refined', 'formal'], { turn: 0.22, grain: 'damask', grainTone: 'pale', grainCount: 5 }),

  /* ---------------------------------- leather -------------------------------- */

  'morocco-grain': material('morocco-grain', 'Morocco', 'Grained goatskin, turned over BOTH joints so the back reads round.',
    ['luxe', 'formal', 'antique'], { turn: 0.22, farTurn: 0.14, grain: 'pebble', grainCount: 18, joints: 2 }),

  'polished-calf': material('polished-calf', 'Polished Calf', 'Smooth hide with a paler panel down the centre, burnished by hand.',
    ['refined', 'formal', 'luxe'], { turn: 0.2, farTurn: 0.12, grain: 'panelled', grainTone: 'pale', grainCount: 1 }),

  'russia-calf': material('russia-calf', 'Russia Calf', 'Birch-tarred and dark, with the two joints creased hard in.',
    ['antique', 'sober', 'scholarly'], { body: 'deep', turn: 0.24, farTurn: 0.12, joints: 2 }),

  'tree-calf': material('tree-calf', 'Tree Calf', 'The acid-drawn tree: a trunk up the spine and four branches off it.',
    ['antique', 'ornate', 'refined'], { turn: 0.2, farTurn: 0.1, grain: 'flame', grainTone: 'deeper', grainCount: 4 }),

  'sprinkled-calf': material('sprinkled-calf', 'Sprinkled Calf', 'Flicked over with dark stain from a brush, and left where it fell.',
    ['antique', 'refined', 'scholarly'], { body: 'pale', turn: 0.2, farTurn: 0.1, grain: 'sprinkle', grainTone: 'deeper', grainCount: 26 }),

  'mottled-calf': material('mottled-calf', 'Mottled Calf', 'Bigger, softer blots than sprinkling — the hide came out cloudy.',
    ['antique', 'battered', 'handmade'], { turn: 0.2, farTurn: 0.1, grain: 'mottle', grainTone: 'deeper', grainCount: 7 }),

  roan: material('roan', 'Roan', 'Cheap sheepskin standing in for morocco, with one honest joint line.',
    ['plain', 'utilitarian', 'antique'], { turn: 0.28, joints: 1 }),

  skiver: material('skiver', 'Skiver', 'Split so thin it takes the board’s own colour; pricked all over.',
    ['plain', 'pocket', 'battered'], { body: 'pale', turn: 0.16, grain: 'pinDot', grainTone: 'deeper', grainCount: 14 }),

  suede: material('suede', 'Suede', 'Flesh side out: a wide soft board and no joint you could find.',
    ['cosy', 'handmade', 'natural'], { turn: 0.32, grain: 'nap', grainTone: 'deeper', grainCount: 4 }),

  shagreen: material('shagreen', 'Shagreen', 'Rayskin: a ring of pale pearls round one still centre.',
    ['luxe', 'fancy', 'modern'], { turn: 0.18, farTurn: 0.12, grain: 'shagreen', grainTone: 'pale', grainCount: 9 }),

  snakeskin: material('snakeskin', 'Snakeskin', 'Overlapping scales in courses down the whole spine.',
    ['fancy', 'ornate', 'goofy'], { turn: 0.18, grain: 'scales', grainTone: 'deeper', grainCount: 9 }),

  crocodile: material('crocodile', 'Crocodile', 'Squared plates in two columns, each one an object of its own.',
    ['luxe', 'heavy', 'fancy'], { body: 'deep', turn: 0.2, farTurn: 0.12, grain: 'plates', grainTone: 'pale', grainCount: 7 }),

  pigskin: material('pigskin', 'Pigskin', 'Bristle holes in threes, all over a pale unstained hide.',
    ['antique', 'scholarly', 'heavy'], { body: 'pale', turn: 0.24, grain: 'pinDot', grainTone: 'ink', grainCount: 21 }),

  oilcloth: material('oilcloth', 'Oilcloth', 'Waxed and dark, creased three times where it has been folded back.',
    ['utilitarian', 'battered', 'pocket'], { body: 'deep', turn: 0.26, grain: 'creases', grainTone: 'pale', grainCount: 3 }),

  /* ---------------------------- vellum and parchment ------------------------- */

  vellum: material('vellum', 'Vellum', 'Cream whatever the book’s pigment is — the colour lives on the label.',
    ['antique', 'devotional', 'refined'], { body: 'cream', turn: 0.22, joints: 1 }),

  parchment: material('parchment', 'Parchment', 'Older and warmer than vellum, and it has cockled at the joints.',
    ['antique', 'handmade', 'battered'], { body: 'parchment', turn: 0.2, grain: 'creases', grainTone: 'ink', grainCount: 3 }),

  'alum-tawed': material('alum-tawed', 'Alum-Tawed', 'White tawed pigskin over oak boards: the oldest binding still standing.',
    ['devotional', 'antique', 'severe'], { body: 'cream', turn: 0.16, grain: 'pinDot', grainTone: 'ink', grainCount: 12, joints: 2 }),

  /* ----------------------------- decorated papers ---------------------------- */

  'marbled-paper': material('marbled-paper', 'Marbled Paper', 'Four combed veins pulled the length of the sheet.',
    ['fancy', 'antique', 'handmade'], { turn: 0.24, grain: 'combedVeins', grainTone: 'accent', grainCount: 4 }),

  'spanish-marble': material('spanish-marble', 'Spanish Marble', 'The bath rocked as the sheet went on: paired zigzags all the way down.',
    ['fancy', 'ornate', 'handmade'], { turn: 0.22, grain: 'spanishWave', grainTone: 'accent', grainCount: 7 }),

  'stone-marble': material('stone-marble', 'Stone Marble', 'Sparse branching veins over an otherwise still ground.',
    ['antique', 'sober', 'handmade'], { turn: 0.24, grain: 'stoneVein', grainTone: 'ink', grainCount: 5 }),

  'shell-marble': material('shell-marble', 'Shell Marble', 'Rings of colour with a pale eye in each, where the oil broke the drop.',
    ['fancy', 'refined', 'antique'], { turn: 0.22, grain: 'shellSpots', grainTone: 'accent', grainCount: 8 }),

  'paste-paper': material('paste-paper', 'Paste Paper', 'Coloured paste dragged with a comb, in five soft waves.',
    ['handmade', 'cosy', 'whimsical'], { turn: 0.2, grain: 'pasteComb', grainTone: 'pale', grainCount: 5 }),

  'patterned-paper': material('patterned-paper', 'Patterned Paper', 'A diaper of small lozenges, offset row by row.',
    ['plain', 'cosy', 'whimsical'], { turn: 0.24, grain: 'lozenges', grainTone: 'pale', grainCount: 10 }),

  'block-print': material('block-print', 'Block-Printed Paper', 'One carved floret, inked and struck over and over slightly out of true.',
    ['handmade', 'ornate', 'cosy'], { turn: 0.22, grain: 'floret', grainTone: 'accent', grainCount: 7 }),

  'washi-print': material('washi-print', 'Washi', 'Long mulberry fibres lying at every angle in a cream sheet.',
    ['natural', 'handmade', 'airy'], { body: 'cream', turn: 0.18, grain: 'fibres', grainTone: 'deeper', grainCount: 14 }),

  'japanese-paper': material('japanese-paper', 'Laid Paper', 'Fine chain lines from the mould, evenly down the whole height.',
    ['plain', 'refined', 'airy'], { body: 'pale', turn: 0.18, grain: 'laidLines', grainTone: 'dark', grainCount: 5 }),

  'dutch-gilt': material('dutch-gilt', 'Dutch Gilt Paper', 'Embossed and gilded in a close grid — the cheapest way to look rich.',
    ['gilt', 'ornate', 'fancy'], { turn: 0.22, grain: 'giltDots', grainTone: 'foil', grainCount: 9 }),

  'stripe-paper': material('stripe-paper', 'Striped Paper', 'Three broad stripes running the height, two colours between them.',
    ['whimsical', 'modern', 'plain'], { turn: 0, grain: 'stripes', grainTone: 'accent', grainCount: 3 }),

  'chequer-paper': material('chequer-paper', 'Chequered Paper', 'A two-colour chequer, big enough to count across a room.',
    ['goofy', 'whimsical', 'modern'], { turn: 0, grain: 'chequer', grainTone: 'accent', grainCount: 9 }),

  'paper-wrapper': material('paper-wrapper', 'Paper Wrapper', 'One sheet folded round, no turned board — which is how the eye knows it is cheap.',
    ['plain', 'pocket', 'utilitarian'], { body: 'pale', turn: 0, grain: 'wrapperRules', grainTone: 'ink', grainCount: 2 }),

  newsprint: material('newsprint', 'Newsprint', 'Grey stock ruled into columns, already going brown at the edges.',
    ['utilitarian', 'battered', 'pocket'], { body: 'pale', turn: 0, grain: 'newsRules', grainTone: 'dark', grainCount: 14 }),

  /* -------------------------- two coverings, one book ------------------------ */

  'half-bound': material('half-bound', 'Half Bound', 'Leather over the head third and the joint; boards for the rest.',
    ['formal', 'refined', 'antique'], { turn: 0.26, split: 'half' }),

  'quarter-bound': material('quarter-bound', 'Quarter Bound', 'A narrow strip of the good stuff at head and tail, and no more.',
    ['formal', 'plain', 'antique'], { turn: 0.26, split: 'quarter' }),

  'three-quarter': material('three-quarter', 'Three-Quarter Bound', 'Leather most of the way down: the expensive compromise.',
    ['luxe', 'formal', 'ornate'], { turn: 0.26, split: 'threeQuarter', joints: 1 }),

  'half-cloth-paper': material('half-cloth-paper', 'Half Cloth over Paper', 'Cloth at the head, and a lozenge paper on the boards below it.',
    ['plain', 'cosy', 'handmade'], { turn: 0.24, split: 'half', grain: 'lozenges', grainTone: 'pale', grainCount: 8 }),

  'tips-and-bands': material('tips-and-bands', 'Tips & Bands', 'The second hide only where the book is handled: both tips, both joints.',
    ['refined', 'formal', 'antique'], { turn: 0.28, split: 'tips', joints: 1 }),

  'boards-exposed': material('boards-exposed', 'Exposed Boards', 'Never covered: raw millboard, a cloth strip at the head, and old scuffs.',
    ['battered', 'plain', 'handmade'], { body: 'parchment', turn: 0.14, split: 'headBand', grain: 'scuffs', grainTone: 'ink', grainCount: 5 }),
};

/** Look up a covering; unknown ids give smooth cloth rather than a throw. */
export function materialSpec(id: unknown): MaterialSpec {
  return MATERIALS[(typeof id === 'string' ? id : '') as MaterialLook] ?? MATERIALS['smooth-cloth'];
}

/** Display names for the studio's material picker. */
export const MATERIAL_LOOK_LABELS: Readonly<Record<MaterialLook, string>> = Object.freeze(
  Object.fromEntries(MATERIAL_LOOKS.map((id) => [id, MATERIALS[id].name])) as Record<
    MaterialLook,
    string
  >,
);

/** Every covering carrying `tag`, in picker order. */
export function materialsTagged(tag: BookTag): readonly MaterialSpec[] {
  return MATERIAL_LOOKS.map((id) => MATERIALS[id]).filter((m) => m.tags.includes(tag));
}

/** All coverings in picker order. */
export function allMaterials(): readonly MaterialSpec[] {
  return MATERIAL_LOOKS.map((id) => MATERIALS[id]);
}

/* ========================================================================== *
 *                       the decorations, as a table                          *
 * ========================================================================== */

/**
 * A motif repeated along a band. Eleven, because a run has to survive being
 * about four pixels tall — anything with an interior detail turns to grey.
 */
type RunGlyph =
  | 'dot'
  | 'bead'
  | 'dentil'
  | 'zigzag'
  | 'chequer'
  | 'rope'
  | 'chain'
  | 'key'
  | 'scroll'
  | 'lattice'
  | 'wave';

/**
 * A motif struck once. Sixteen, and every one of them is drawn from the same
 * handful of primitives — a disc, a lozenge, a triangle, a fan of spokes — so
 * the sixteenth is as sound as the first at 30px.
 */
type StampGlyph =
  | 'lozenge'
  | 'rosette'
  | 'star'
  | 'crest'
  | 'crown'
  | 'fleuron'
  | 'fleur'
  | 'bee'
  | 'acorn'
  | 'sun'
  | 'monogram'
  | 'seal'
  | 'shell'
  | 'leaf';

/** How a frame's head is shaped. */
type FrameHead = 'square' | 'arch' | 'gothic' | 'cartouche';

/**
 * One piece of applied ornament.
 *
 * A decoration is one to three of these, which is what lets fifty of them be
 * fifty compositions rather than fifty drawings. The ONE toolist below switches
 * on `k` and nothing else knows how any of it is drawn.
 *
 * Every station is a fraction of the decorated surface's height, every size a
 * fraction of its width, so the same row draws a 20px sliver and a 45px folio.
 */
type DecorPart =
  /** Rules across the spine at the given stations. `from`/`to` span the width. */
  | { k: 'rule'; at: readonly number[]; weight: number; from: number; to: number }
  /** Rules down the spine. Split around a reserved band when they would cross it. */
  | { k: 'vrule'; at: readonly number[]; weight: number; top: number; bottom: number }
  /** A repeated motif along one band. */
  | { k: 'run'; at: number; glyph: RunGlyph; height: number; count: number }
  /** An outlined rectangle. `grows` lets it swell to enclose a reserved band. */
  | {
      k: 'frame';
      top: number;
      bottom: number;
      inset: number;
      weight: number;
      head: FrameHead;
      double: boolean;
      grows: boolean;
    }
  /** An applied plate: a physical thing stuck on, with its own ink outline. */
  | { k: 'plate'; top: number; height: number; inset: number; shape: PlateShape; ruled: number }
  /** One motif, struck once. Relocates if the caller reserved its station. */
  | { k: 'stamp'; at: number; glyph: StampGlyph; size: number }
  /** The same motif scattered over the field, skipping the reserved band. */
  | { k: 'seme'; glyph: StampGlyph; size: number; rows: number; top: number; bottom: number }
  /** A stem up the spine with leaves off it. Splits around a reserved band. */
  | { k: 'trail'; glyph: 'vine' | 'laurel' | 'acorn'; count: number; top: number; bottom: number }
  /** Metal: pins, or domed bosses. `cols` 2 keeps the centre clear for a title. */
  | { k: 'studs'; at: readonly number[]; size: number; cols: 1 | 2; domed: boolean }
  /** Brackets or shells at the four corners of the field. */
  | { k: 'corners'; glyph: 'bracket' | 'shell'; arm: number }
  /** A band of another material laid across the spine. */
  | { k: 'band'; at: number; height: number; fill: 'accent' | 'cream'; combed: boolean }
  /** A ribbon lying out of the head. */
  | { k: 'ribbon'; at: number };

type PlateShape = 'plate' | 'banner' | 'ticket' | 'roundel';

/** One applied ornament, as parts. */
export interface DecorSpec {
  id: Decoration;
  name: string;
  blurb: string;
  tags: readonly BookTag[];
  parts: readonly DecorPart[];
  /** Struck without foil — ink only, even on a gilt book. */
  blind: boolean;
  /** Below this spine width the whole ornament is dropped. */
  floor: number;
  /** What it takes out of the clear compartment, top and bottom. */
  claimTop: number;
  claimBottom: number;
}

function decor(
  id: Decoration,
  name: string,
  blurb: string,
  tags: readonly BookTag[],
  parts: readonly DecorPart[],
  spec: Partial<Pick<DecorSpec, 'blind' | 'floor' | 'claimTop' | 'claimBottom'>> = {},
): DecorSpec {
  return {
    id,
    name,
    blurb,
    tags,
    parts,
    blind: spec.blind ?? false,
    floor: spec.floor ?? 7,
    claimTop: spec.claimTop ?? 0,
    claimBottom: spec.claimBottom ?? 1,
  };
}

/** Every ornament, keyed by id. */
export const DECORS: Readonly<Record<Decoration, DecorSpec>> = {
  plain: decor('plain', 'Plain', 'Nothing at all. Plenty of real books are like this and a shelf needs them.',
    ['plain', 'sober'], []),

  /* ------------------------------ rules and bands ---------------------------- */

  'gilt-bands': decor('gilt-bands', 'Gilt Bands', 'The house pattern, straight off the app mark: two at the head, one at the tail.',
    ['gilt', 'formal', 'refined'],
    [{ k: 'rule', at: [0.14, 0.2, 0.82], weight: 0.1, from: 0.18, to: 0.86 }],
    { claimTop: 0.24, claimBottom: 0.78 }),

  'double-bands': decor('double-bands', 'Double Bands', 'Three stations of paired thin rules — fussier, and more expensive.',
    ['formal', 'refined', 'gilt'],
    [{ k: 'rule', at: [0.12, 0.17, 0.46, 0.51, 0.79, 0.84], weight: 0.05, from: 0.16, to: 0.88 }],
    { claimTop: 0.21, claimBottom: 0.75 }),

  'triple-bands': decor('triple-bands', 'Triple Bands', 'Three rules together at each end, close as a stave.',
    ['formal', 'ornate', 'gilt'],
    [{ k: 'rule', at: [0.1, 0.14, 0.18, 0.78, 0.82, 0.86], weight: 0.045, from: 0.16, to: 0.88 }],
    { claimTop: 0.24, claimBottom: 0.74 }),

  'spine-rule': decor('spine-rule', 'Spine Rules', 'Two long rules the whole height, just inside each edge.',
    ['plain', 'formal', 'sober'],
    [{ k: 'vrule', at: [0.15, 0.85], weight: 0.055, top: 0.05, bottom: 0.95 }],
    { claimTop: 0.06, claimBottom: 0.94 }),

  'centre-rule': decor('centre-rule', 'Centre Rules', 'A pair of fine rules a hair either side of the middle, parting round the title.',
    ['refined', 'modern', 'sober'],
    [{ k: 'vrule', at: [0.42, 0.58], weight: 0.045, top: 0.06, bottom: 0.94 }],
    { claimTop: 0.06, claimBottom: 0.94 }),

  'edge-piping': decor('edge-piping', 'Edge Piping', 'Thick piping right on the joints, the way a livery binding is finished.',
    ['luxe', 'formal', 'heavy'],
    [{ k: 'vrule', at: [0.07, 0.93], weight: 0.075, top: 0.03, bottom: 0.97 }],
    { floor: 10 }),

  'dotted-rule': decor('dotted-rule', 'Dotted Rules', 'Rules broken into dots, struck with a pointillé wheel.',
    ['refined', 'fancy', 'gilt'],
    [{ k: 'run', at: 0.16, glyph: 'dot', height: 0.012, count: 9 },
     { k: 'run', at: 0.84, glyph: 'dot', height: 0.012, count: 9 }],
    { floor: 10, claimTop: 0.22, claimBottom: 0.8 }),

  'beaded-band': decor('beaded-band', 'Beaded Bands', 'Touching half-rounds — the astragal, run across instead of along.',
    ['refined', 'ornate', 'formal'],
    [{ k: 'run', at: 0.18, glyph: 'bead', height: 0.018, count: 7 },
     { k: 'run', at: 0.8, glyph: 'bead', height: 0.018, count: 7 }],
    { floor: 11, claimTop: 0.26, claimBottom: 0.76 }),

  'dentil-band': decor('dentil-band', 'Dentil Band', 'A course of square teeth under the head, straight off a cornice.',
    ['formal', 'ornate', 'antique'],
    [{ k: 'run', at: 0.2, glyph: 'dentil', height: 0.024, count: 6 }],
    { floor: 12, claimTop: 0.28 }),

  'zigzag-band': decor('zigzag-band', 'Zigzag Bands', 'The Norman chevron, chased across head and tail.',
    ['ornate', 'antique', 'goofy'],
    [{ k: 'run', at: 0.16, glyph: 'zigzag', height: 0.022, count: 5 },
     { k: 'run', at: 0.84, glyph: 'zigzag', height: 0.022, count: 5 }],
    { floor: 12, claimTop: 0.24, claimBottom: 0.78 }),

  'chequer-band': decor('chequer-band', 'Chequer Band', 'A single chequered course at the tail, foil and ground alternating.',
    ['goofy', 'whimsical', 'formal'],
    [{ k: 'run', at: 0.82, glyph: 'chequer', height: 0.026, count: 6 }],
    { floor: 12, claimBottom: 0.76 }),

  'rope-band': decor('rope-band', 'Rope Bands', 'A carved cable, twisted the same way at both ends.',
    ['rustic', 'ornate', 'handmade'],
    [{ k: 'run', at: 0.15, glyph: 'rope', height: 0.02, count: 6 },
     { k: 'run', at: 0.85, glyph: 'rope', height: 0.02, count: 6 }],
    { floor: 12, claimTop: 0.23, claimBottom: 0.79 }),

  'chain-band': decor('chain-band', 'Chain Band', 'Interlocking links across the head — a chained book’s memory of itself.',
    ['antique', 'severe', 'ornate'],
    [{ k: 'run', at: 0.18, glyph: 'chain', height: 0.024, count: 5 }],
    { floor: 13, claimTop: 0.27 }),

  'greek-key': decor('greek-key', 'Greek Key', 'The meander, folded and folded back along the foot.',
    ['formal', 'ornate', 'scholarly'],
    [{ k: 'run', at: 0.8, glyph: 'key', height: 0.03, count: 4 }],
    { floor: 14, claimBottom: 0.74 }),

  'wave-scroll': decor('wave-scroll', 'Vitruvian Scroll', 'A running wave that breaks the same way every time.',
    ['ornate', 'fancy', 'formal'],
    [{ k: 'run', at: 0.17, glyph: 'scroll', height: 0.028, count: 4 }],
    { floor: 14, claimTop: 0.26 }),

  'marbled-band': decor('marbled-band', 'Marbled Band', 'A strip of the endpaper laid across the spine and combed three times.',
    ['fancy', 'handmade', 'antique'],
    [{ k: 'band', at: 0.66, height: 0.12, fill: 'accent', combed: true }],
    { floor: 12, claimBottom: 0.62 }),

  /* --------------------------- applied plates and tickets -------------------- */

  'label-plate': decor('label-plate', 'Label Plate', 'The cream lettering-piece the title is set on.',
    ['plain', 'formal', 'scholarly'], []),

  'banner-plaque': decor('banner-plaque', 'Banner Plaque', 'A swallow-tailed banner near the foot, for whatever the volume is called.',
    ['ornate', 'fancy', 'whimsical'],
    [{ k: 'plate', top: 0.72, height: 0.13, inset: 0.1, shape: 'banner', ruled: 2 }],
    { floor: 13, claimBottom: 0.68 }),

  'shelf-ticket': decor('shelf-ticket', 'Shelf Ticket', 'A little paper shelfmark stuck near the tail, slightly crooked.',
    ['scholarly', 'utilitarian', 'antique'],
    [{ k: 'plate', top: 0.87, height: 0.07, inset: 0.28, shape: 'ticket', ruled: 1 }],
    { floor: 11, claimBottom: 0.85 }),

  'number-roundel': decor('number-roundel', 'Volume Roundel', 'A gilt disc at the head with a rule beneath it — volume something.',
    ['gilt', 'formal', 'refined'],
    [{ k: 'plate', top: 0.06, height: 0.075, inset: 0.3, shape: 'roundel', ruled: 0 },
     { k: 'rule', at: [0.155], weight: 0.05, from: 0.2, to: 0.8 }],
    { floor: 12, claimTop: 0.2 }),

  /* ----------------------------- panels and frames --------------------------- */

  'gilt-panel': decor('gilt-panel', 'Gilt Panel', 'A tooled rectangle round the title compartment, grown to fit it.',
    ['gilt', 'formal', 'luxe'],
    [{ k: 'frame', top: 0.3, bottom: 0.64, inset: 0.13, weight: 0.06, head: 'square', double: false, grows: true }],
    { floor: 12 }),

  'double-frame': decor('double-frame', 'Double Frame', 'Two rectangles, one inside the other, the whole height of the spine.',
    ['formal', 'ornate', 'severe'],
    [{ k: 'frame', top: 0.07, bottom: 0.93, inset: 0.1, weight: 0.05, head: 'square', double: true, grows: false }],
    { floor: 13, claimTop: 0.12, claimBottom: 0.88 }),

  'blind-stamped-frame': decor('blind-stamped-frame', 'Blind Frame', 'Struck without foil: ink only, the sober binding’s one gesture.',
    ['sober', 'severe', 'devotional'],
    [{ k: 'frame', top: 0.045, bottom: 0.955, inset: 0.13, weight: 0.05, head: 'square', double: false, grows: false }],
    { blind: true, floor: 12, claimTop: 0.1, claimBottom: 0.9 }),

  'blind-panel': decor('blind-panel', 'Blind Panel', 'A soft blind rectangle round the compartment, and nothing shining anywhere.',
    ['sober', 'devotional', 'plain'],
    [{ k: 'frame', top: 0.3, bottom: 0.66, inset: 0.13, weight: 0.045, head: 'square', double: false, grows: true }],
    { blind: true, floor: 12 }),

  'arch-panel': decor('arch-panel', 'Arched Panel', 'A round-headed panel at the head, like a bay in a reading room.',
    ['ornate', 'devotional', 'formal'],
    [{ k: 'frame', top: 0.06, bottom: 0.3, inset: 0.16, weight: 0.055, head: 'arch', double: false, grows: false }],
    { floor: 13, claimTop: 0.34 }),

  'gothic-panel': decor('gothic-panel', 'Gothic Panel', 'The same panel, brought to a point. A chapel door at spine scale.',
    ['ornate', 'devotional', 'severe'],
    [{ k: 'frame', top: 0.06, bottom: 0.32, inset: 0.16, weight: 0.055, head: 'gothic', double: false, grows: false }],
    { floor: 13, claimTop: 0.36 }),

  cartouche: decor('cartouche', 'Cartouche', 'A lobed shield at the foot, waiting for arms it will never get.',
    ['ornate', 'fancy', 'luxe'],
    [{ k: 'frame', top: 0.62, bottom: 0.84, inset: 0.15, weight: 0.055, head: 'cartouche', double: false, grows: false }],
    { floor: 13, claimBottom: 0.58 }),

  'lattice-panel': decor('lattice-panel', 'Lattice Panel', 'A framed trellis at the tail, four crossings of it.',
    ['ornate', 'refined', 'fancy'],
    [{ k: 'frame', top: 0.68, bottom: 0.92, inset: 0.14, weight: 0.05, head: 'square', double: false, grows: false },
     { k: 'run', at: 0.8, glyph: 'lattice', height: 0.05, count: 4 }],
    { floor: 14, claimBottom: 0.64 }),

  /* ---------------------------- corner and edge work ------------------------- */

  'corner-tooling': decor('corner-tooling', 'Corner Tooling', 'Four small brackets, one at each corner of the field.',
    ['formal', 'refined', 'gilt'],
    [{ k: 'corners', glyph: 'bracket', arm: 0.32 }],
    { floor: 12, claimTop: 0.12, claimBottom: 0.88 }),

  'shell-corners': decor('shell-corners', 'Shell Corners', 'Fan shells filling the corners, as a rococo binder would.',
    ['ornate', 'fancy', 'luxe'],
    [{ k: 'corners', glyph: 'shell', arm: 0.3 }],
    { floor: 13, claimTop: 0.13, claimBottom: 0.87 }),

  'pin-studs': decor('pin-studs', 'Pin Studs', 'Brass pins down both joints, keeping the centre clear.',
    ['antique', 'heavy', 'utilitarian'],
    [{ k: 'studs', at: [0.1, 0.28, 0.5, 0.72, 0.9], size: 0.1, cols: 2, domed: false }],
    { floor: 11, claimTop: 0.06, claimBottom: 0.94 }),

  bosses: decor('bosses', 'Bosses', 'Two domed metal bosses, the sort that keep a book off a wet table.',
    ['antique', 'heavy', 'devotional'],
    [{ k: 'studs', at: [0.12, 0.88], size: 0.28, cols: 1, domed: true }],
    { floor: 13, claimTop: 0.2, claimBottom: 0.8 }),

  /* -------------------------------- single stamps ---------------------------- */

  'diamond-centre': decor('diamond-centre', 'Diamond Centre', 'One filled lozenge struck in the middle of the free compartment.',
    ['gilt', 'formal', 'refined'],
    [{ k: 'stamp', at: 0.5, glyph: 'lozenge', size: 0.3 }],
    { floor: 12 }),

  'monogram-lozenge': decor('monogram-lozenge', 'Monogram Lozenge', 'An outlined lozenge with a bar through it, where the owner’s letters go.',
    ['refined', 'formal', 'luxe'],
    [{ k: 'stamp', at: 0.5, glyph: 'monogram', size: 0.34 }],
    { floor: 13 }),

  rosette: decor('rosette', 'Rosette', 'A little six-petalled flower, the commonest tool in any bindery.',
    ['ornate', 'fancy', 'cosy'],
    [{ k: 'stamp', at: 0.5, glyph: 'rosette', size: 0.3 }],
    { floor: 12 }),

  'star-tooling': decor('star-tooling', 'Star Tooling', 'A five-pointed star, struck once and struck well.',
    ['gilt', 'whimsical', 'fancy'],
    [{ k: 'stamp', at: 0.5, glyph: 'star', size: 0.32 }],
    { floor: 12 }),

  crest: decor('crest', 'Crest', 'A shield with a band across it: somebody’s arms, on somebody’s book.',
    ['luxe', 'formal', 'antique'],
    [{ k: 'stamp', at: 0.5, glyph: 'crest', size: 0.36 }],
    { floor: 13 }),

  'crown-tooling': decor('crown-tooling', 'Crown Tooling', 'A three-pointed crown on its band — a royal binding, or pretending to be.',
    ['luxe', 'ornate', 'gilt'],
    [{ k: 'stamp', at: 0.5, glyph: 'crown', size: 0.34 }],
    { floor: 13 }),

  /* --------------------------- scattered and trailing ------------------------ */

  'fleur-seme': decor('fleur-seme', 'Fleur Semé', 'Powdered all over with the lily, as a French royal binding is.',
    ['ornate', 'luxe', 'gilt'],
    [{ k: 'seme', glyph: 'fleur', size: 0.2, rows: 7, top: 0.08, bottom: 0.92 }],
    { floor: 13, claimTop: 0.06, claimBottom: 0.94 }),

  'bee-diaper': decor('bee-diaper', 'Bee Diaper', 'The imperial bee, repeated in a diaper across the whole spine.',
    ['ornate', 'fancy', 'luxe'],
    [{ k: 'seme', glyph: 'bee', size: 0.22, rows: 6, top: 0.1, bottom: 0.9 }],
    { floor: 14, claimTop: 0.06, claimBottom: 0.94 }),

  'vine-trail': decor('vine-trail', 'Vine Trail', 'A stem up the whole spine with leaves off it, alternating sides.',
    ['ornate', 'natural', 'handmade'],
    [{ k: 'trail', glyph: 'vine', count: 6, top: 0.08, bottom: 0.92 }],
    { floor: 12, claimTop: 0.06, claimBottom: 0.94 }),

  'laurel-spray': decor('laurel-spray', 'Laurel Spray', 'A short laurel at the foot, the way a prize binding signs itself.',
    ['formal', 'gilt', 'refined'],
    [{ k: 'trail', glyph: 'laurel', count: 3, top: 0.7, bottom: 0.93 }],
    { floor: 12, claimBottom: 0.66 }),

  'acorn-tooling': decor('acorn-tooling', 'Acorn Tooling', 'Three acorns hanging under the head, on their own little stem.',
    ['natural', 'cosy', 'rustic'],
    [{ k: 'trail', glyph: 'acorn', count: 3, top: 0.07, bottom: 0.28 }],
    { floor: 12, claimTop: 0.32 }),

  'sunburst-fan': decor('sunburst-fan', 'Sunburst Fan', 'A fan of rays at the tail, all struck from one point.',
    ['fancy', 'ornate', 'whimsical'],
    [{ k: 'stamp', at: 0.84, glyph: 'sun', size: 0.4 }],
    { floor: 13, claimBottom: 0.74 }),

  'wax-seal': decor('wax-seal', 'Wax Seal', 'A blob of sealing wax with a rim, pressed on and never taken off.',
    ['whimsical', 'antique', 'handmade'],
    [{ k: 'stamp', at: 0.74, glyph: 'seal', size: 0.34 }],
    { floor: 12, claimBottom: 0.66 }),

  /* ------------------------------ head, foot, ribbon ------------------------- */

  'head-ornament': decor('head-ornament', 'Head Ornament', 'A fleuron under the head with a rule beneath it.',
    ['refined', 'formal', 'ornate'],
    [{ k: 'stamp', at: 0.095, glyph: 'fleuron', size: 0.26 },
     { k: 'rule', at: [0.165], weight: 0.055, from: 0.2, to: 0.8 }],
    { floor: 11, claimTop: 0.23 }),

  'foot-ornament': decor('foot-ornament', 'Foot Ornament', 'The same, upside down at the tail: a small leaf and a rule.',
    ['refined', 'formal', 'ornate'],
    [{ k: 'stamp', at: 0.885, glyph: 'leaf', size: 0.24 },
     { k: 'rule', at: [0.935], weight: 0.06, from: 0.2, to: 0.8 }],
    { floor: 10, claimBottom: 0.84 }),

  'tally-rules': decor('tally-rules', 'Tally Rules', 'Five short strokes at the head, like a count kept on the binding.',
    ['utilitarian', 'plain', 'handmade'],
    [{ k: 'rule', at: [0.08, 0.12, 0.16, 0.2, 0.24], weight: 0.05, from: 0.56, to: 0.9 }],
    { floor: 10, claimTop: 0.3 }),

  'ribbon-marker': decor('ribbon-marker', 'Ribbon Marker', 'A ribbon lying out of the head, off to one side.',
    ['cosy', 'devotional', 'whimsical'],
    [{ k: 'ribbon', at: 0.3 }],
    { floor: 10, claimTop: 0.2 }),
};

/** Look up an ornament; unknown ids give `plain` rather than a throw. */
export function decorSpec(id: unknown): DecorSpec {
  return DECORS[(typeof id === 'string' ? id : '') as Decoration] ?? DECORS.plain;
}

/** Display names for the studio's decoration checklist. */
export const DECORATION_LABELS: Readonly<Record<Decoration, string>> = Object.freeze(
  Object.fromEntries(DECORATIONS.map((id) => [id, DECORS[id].name])) as Record<Decoration, string>,
);

/** Every ornament carrying `tag`, in picker order. */
export function decorationsTagged(tag: BookTag): readonly DecorSpec[] {
  return DECORATIONS.map((id) => DECORS[id]).filter((d) => d.tags.includes(tag));
}

/** All ornaments in picker order. */
export function allDecorations(): readonly DecorSpec[] {
  return DECORATIONS.map((id) => DECORS[id]);
}

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

  /* --- the studio's own axes, on top of whatever the preset decided ------- *
   *
   * A preset says how the book was BOUND; these four say what happened to it
   * afterwards, and every one of them is a control on the Book Studio sheet.
   * Defaults are the no-op values, so a caller that knows nothing about them
   * draws exactly what it drew before.
   */

  /** Raised cords sewn across the spine, 0–5. Each one stands proud. */
  bands: number;
  /** Foil rules flanking each cord. False strikes them in soft ink. */
  bandGilt: boolean;
  /** Endband style at head and tail — 0 blocks, 1 chevron, 2 cord — or null. */
  headTail: number | null;
  /**
   * 0 pristine → 1 well-loved. Flat art cannot grind dirt into a surface, so
   * wear is told as fading cloth and rubbed-off foil: the two things that
   * actually happen to a spine pulled off a shelf a thousand times, and the
   * two you can still read across a room.
   */
  wear: number;
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
   * mostly plain; a clamshell folio is rare because a shelf with six of them
   * on it stops reading as a library and starts reading as a shop display.
   */
  weight: number;
  /** What this binding feels like. Read structurally by the studio's mood row. */
  tags: readonly BookTag[];
}

function preset(
  id: string,
  label: string,
  shape: SpineShape,
  material: MaterialLook,
  decorations: readonly Decoration[],
  gilt: boolean,
  weight: number,
  tags: readonly BookTag[],
): BookPreset {
  return { id, label, shape, material, decorations, gilt, weight, tags };
}

/**
 * The named bindings, in the order the studio lists them: wrappers and
 * pamphlets first, then cloth, buckram, leather, vellum, decorated papers,
 * half and quarter bindings, the visible sewings, the mechanical bindings, and
 * the boxed and fastened oddities last.
 *
 * Two constraints hold across the whole table, and both are load-bearing:
 *
 *  - **No preset carries more than two decorations.** The caller adds a title
 *    and usually an ornament on top of whatever is here, and a 30px spine with
 *    five marks on it is a smudge.
 *  - **`gilt-panel` and `label-plate` may share a preset**, because the panel
 *    grows to enclose the label rather than colliding with it (see the frame
 *    part in `drawDecoration`), and a lettering-piece inside a tooled panel is
 *    one of the handsomest things a spine does.
 *
 * The sixty-two original ids all survive and still mean what they meant — a
 * preset id is persisted per book in `data/designPrefs.ts`, so retiring one
 * would silently rebind somebody's library.
 */
export const BOOK_PRESETS: readonly BookPreset[] = [
  /* ------------------------------- wrappers -------------------------------- */
  preset('plain-wrapper', 'Plain Wrapper', 'pamphlet-thin', 'paper-wrapper', ['plain'], false, 7, ['plain', 'pocket', 'utilitarian']),
  preset('stitched-pamphlet', 'Stitched Pamphlet', 'pamphlet-thin', 'paper-wrapper', ['spine-rule'], false, 5, ['plain', 'handmade', 'pocket']),
  preset('offprint', 'Offprint', 'pamphlet-thin', 'paper-wrapper', ['label-plate'], false, 4, ['scholarly', 'plain', 'utilitarian']),
  preset('printed-wrapper', 'Printed Wrapper', 'pamphlet-thin', 'patterned-paper', ['label-plate'], false, 4, ['plain', 'cosy', 'pocket']),
  preset('chapbook', 'Chapbook', 'scalloped-head', 'paper-wrapper', ['foot-ornament'], false, 3, ['whimsical', 'handmade', 'pocket']),
  preset('penny-dreadful', 'Penny Dreadful', 'saddle-stapled', 'newsprint', ['tally-rules'], false, 4, ['battered', 'pocket', 'goofy']),
  preset('news-quarto', 'News Quarto', 'pamphlet-thin', 'newsprint', ['plain'], false, 4, ['utilitarian', 'battered', 'plain']),
  preset('field-notes', 'Field Notes', 'wallet', 'oilcloth', ['plain'], false, 4, ['pocket', 'utilitarian', 'battered']),
  preset('paper-almanac', 'Paper Almanac', 'creased', 'stripe-paper', ['label-plate'], false, 3, ['whimsical', 'pocket', 'cosy']),
  preset('sunday-programme', 'Sunday Programme', 'saddle-stapled', 'paper-wrapper', ['centre-rule'], false, 3, ['plain', 'modern', 'utilitarian']),

  /* --------------------------------- cloth --------------------------------- */
  preset('plain-cloth', 'Plain Cloth', 'square', 'smooth-cloth', ['plain'], false, 8, ['plain', 'sober', 'utilitarian']),
  preset('gilt-quarto', 'Gilt Quarto', 'square', 'smooth-cloth', ['gilt-bands', 'label-plate'], true, 8, ['gilt', 'formal', 'refined']),
  preset('lettered-cloth', 'Lettered Cloth', 'square', 'smooth-cloth', ['label-plate'], false, 7, ['plain', 'formal', 'sober']),
  preset('banded-cloth', 'Banded Cloth', 'square', 'smooth-cloth', ['double-bands'], true, 5, ['formal', 'gilt', 'refined']),
  preset('panelled-cloth', 'Panelled Cloth', 'square', 'smooth-cloth', ['gilt-panel', 'label-plate'], true, 4, ['gilt', 'formal', 'luxe']),
  preset('blind-cloth', 'Blind-Stamped Cloth', 'square', 'smooth-cloth', ['blind-stamped-frame'], false, 4, ['sober', 'severe', 'plain']),
  preset('ruled-cloth', 'Ruled Cloth', 'square', 'smooth-cloth', ['spine-rule', 'label-plate'], true, 4, ['plain', 'formal', 'gilt']),
  preset('rep-cloth', 'Rep Cloth', 'square', 'ribbed-cloth', ['label-plate'], false, 5, ['plain', 'antique', 'sober']),
  preset('ribbed-rep', 'Ribbed Rep', 'tight-back', 'ribbed-cloth', ['gilt-bands'], true, 4, ['formal', 'gilt', 'antique']),
  preset('corded-rep', 'Corded Rep', 'ribbed', 'ribbed-cloth', ['gilt-bands', 'label-plate'], true, 4, ['formal', 'antique', 'gilt']),
  preset('foot-tooled-octavo', 'Foot-Tooled Octavo', 'square', 'ribbed-cloth', ['gilt-bands', 'foot-ornament'], true, 3, ['refined', 'gilt', 'ornate']),
  preset('hollow-octavo', 'Hollow-Back Octavo', 'hollow-back', 'smooth-cloth', ['gilt-bands', 'label-plate'], true, 4, ['refined', 'antique', 'airy']),
  preset('scalloped-primer', 'Scalloped Primer', 'scalloped-head', 'smooth-cloth', ['label-plate'], false, 3, ['whimsical', 'cosy', 'goofy']),
  preset('diamond-primer', 'Diamond Primer', 'tapered-head', 'smooth-cloth', ['diamond-centre'], true, 3, ['refined', 'gilt', 'fancy']),
  preset('tight-back-prize', 'Tight-Back Prize', 'tight-back', 'smooth-cloth', ['gilt-panel', 'corner-tooling'], true, 3, ['formal', 'gilt', 'severe']),
  preset('presentation-binding', 'Presentation Binding', 'rounded', 'smooth-cloth', ['gilt-panel', 'diamond-centre'], true, 2, ['luxe', 'gilt', 'formal']),
  preset('yapp-pocket', 'Yapp Pocket', 'yapp', 'smooth-cloth', ['label-plate'], false, 3, ['cosy', 'devotional', 'pocket']),
  preset('schoolroom-cloth', 'Schoolroom Cloth', 'ledger', 'buckram', ['shelf-ticket'], false, 4, ['utilitarian', 'scholarly', 'battered']),
  preset('linen-quarto', 'Linen Quarto', 'square', 'linen', ['label-plate'], false, 5, ['natural', 'plain', 'handmade']),
  preset('linen-cords', 'Corded Linen', 'ribbed', 'linen', ['double-bands'], false, 3, ['natural', 'handmade', 'formal']),
  preset('duck-canvas', 'Duck Canvas', 'tight-back', 'canvas', ['plain'], false, 4, ['utilitarian', 'heavy', 'rustic']),
  preset('canvas-ledger', 'Canvas Ledger', 'ledger', 'canvas', ['corner-tooling'], false, 4, ['utilitarian', 'heavy', 'sober']),
  preset('sailmakers-quarto', 'Sailmaker’s Quarto', 'long-stitch', 'sailcloth', ['plain'], false, 3, ['handmade', 'rustic', 'natural']),
  preset('hessian-folio', 'Hessian Folio', 'splayed', 'hessian', ['plain'], false, 3, ['rustic', 'battered', 'natural']),
  preset('tweed-octavo', 'Tweed Octavo', 'rounded', 'tweed', ['label-plate'], false, 4, ['cosy', 'rustic', 'natural']),
  preset('tweed-gilt', 'Tweed & Gilt', 'rounded', 'tweed', ['gilt-bands', 'label-plate'], true, 3, ['cosy', 'gilt', 'refined']),
  preset('felt-pocketbook', 'Felt Pocketbook', 'cushioned', 'felt', ['plain'], false, 3, ['cosy', 'handmade', 'pocket']),
  preset('velvet-missal', 'Velvet Missal', 'cushioned', 'velvet', ['bosses', 'ribbon-marker'], true, 2, ['devotional', 'luxe', 'ornate']),
  preset('velvet-album', 'Velvet Album', 'clasped', 'velvet', ['corner-tooling'], true, 2, ['luxe', 'antique', 'heavy']),

  /* -------------------------------- silks ---------------------------------- */
  preset('moire-keepsake', 'Moiré Keepsake', 'rounded', 'silk-moire', ['label-plate'], true, 3, ['luxe', 'refined', 'fancy']),
  preset('moire-panelled', 'Panelled Moiré', 'round-cap', 'silk-moire', ['gilt-panel', 'label-plate'], true, 2, ['luxe', 'gilt', 'ornate']),
  preset('brocade-anthology', 'Brocade Anthology', 'ribbed', 'brocade', ['gilt-bands'], true, 2, ['ornate', 'luxe', 'fancy']),
  preset('damask-hours', 'Damask Hours', 'gabled', 'damask', ['arch-panel'], true, 2, ['devotional', 'ornate', 'formal']),

  /* -------------------------------- buckram -------------------------------- */
  preset('library-buckram', 'Library Buckram', 'square', 'buckram', ['label-plate'], false, 6, ['utilitarian', 'scholarly', 'sober']),
  preset('college-buckram', 'College Buckram', 'tight-back', 'buckram', ['spine-rule', 'label-plate'], true, 4, ['scholarly', 'formal', 'sober']),
  preset('reading-room-buckram', 'Reading-Room Buckram', 'tight-back', 'buckram', ['double-bands'], false, 4, ['scholarly', 'severe', 'sober']),
  preset('gilt-buckram', 'Gilt Buckram', 'square', 'buckram', ['gilt-bands', 'corner-tooling'], true, 3, ['gilt', 'formal', 'scholarly']),
  preset('hollow-ledger', 'Hollow Ledger', 'hollow-back', 'buckram', ['corner-tooling'], false, 3, ['utilitarian', 'sober', 'antique']),
  preset('plain-buckram', 'Plain Buckram', 'square', 'buckram', ['plain'], false, 4, ['plain', 'utilitarian', 'severe']),
  preset('stack-buckram', 'Stack Buckram', 'ledger', 'buckram', ['shelf-ticket', 'spine-rule'], false, 4, ['scholarly', 'utilitarian', 'sober']),
  preset('archive-buckram', 'Archive Buckram', 'tab-index', 'buckram', ['tally-rules'], false, 3, ['utilitarian', 'scholarly', 'modern']),

  /* -------------------------------- leather -------------------------------- */
  preset('full-morocco', 'Full Morocco', 'rounded', 'morocco-grain', ['gilt-bands', 'corner-tooling'], true, 5, ['luxe', 'gilt', 'formal']),
  preset('tooled-morocco', 'Tooled Morocco', 'ribbed', 'morocco-grain', ['gilt-bands', 'diamond-centre'], true, 4, ['luxe', 'ornate', 'gilt']),
  preset('blind-calf', 'Blind-Tooled Calf', 'rounded', 'polished-calf', ['blind-stamped-frame'], false, 4, ['sober', 'severe', 'antique']),
  preset('panelled-calf', 'Panelled Calf', 'rounded', 'polished-calf', ['gilt-panel', 'label-plate'], true, 4, ['refined', 'gilt', 'formal']),
  preset('tree-calf', 'Tree Calf', 'hollow-back', 'tree-calf', ['double-bands', 'label-plate'], true, 3, ['antique', 'ornate', 'refined']),
  preset('diced-russia', 'Diced Russia', 'ribbed', 'russia-calf', ['double-bands', 'foot-ornament'], true, 3, ['antique', 'sober', 'scholarly']),
  preset('plain-calf', 'Plain Calf', 'rounded', 'polished-calf', ['plain'], false, 4, ['plain', 'refined', 'antique']),
  preset('yapp-devotional', 'Yapp Devotional', 'yapp', 'morocco-grain', ['gilt-bands', 'ribbon-marker'], true, 3, ['devotional', 'cosy', 'gilt']),
  preset('cathedral-morocco', 'Cathedral Morocco', 'ribbed', 'morocco-grain', ['gilt-panel', 'label-plate'], true, 2, ['luxe', 'ornate', 'formal']),
  preset('sprinkled-octavo', 'Sprinkled Octavo', 'round-cap', 'sprinkled-calf', ['double-bands', 'label-plate'], true, 4, ['antique', 'scholarly', 'refined']),
  preset('mottled-quarto', 'Mottled Quarto', 'rounded', 'mottled-calf', ['spine-rule'], false, 3, ['antique', 'battered', 'handmade']),
  preset('russia-folio', 'Russia Folio', 'double-hinge', 'russia-calf', ['triple-bands', 'label-plate'], true, 3, ['formal', 'luxe', 'severe']),
  preset('roan-schoolbook', 'Roan Schoolbook', 'square', 'roan', ['label-plate'], false, 5, ['plain', 'utilitarian', 'battered']),
  preset('roan-almanac', 'Roan Almanac', 'creased', 'roan', ['head-ornament'], false, 3, ['pocket', 'battered', 'antique']),
  preset('skiver-diary', 'Skiver Diary', 'wallet', 'skiver', ['edge-piping'], true, 3, ['pocket', 'cosy', 'refined']),
  preset('suede-commonplace', 'Suede Commonplace', 'limp', 'suede', ['plain'], false, 3, ['cosy', 'handmade', 'natural']),
  preset('shagreen-case', 'Shagreen Case', 'chamfered', 'shagreen', ['corner-tooling'], true, 2, ['luxe', 'modern', 'fancy']),
  preset('snakeskin-folly', 'Snakeskin Folly', 'waisted', 'snakeskin', ['star-tooling'], true, 2, ['fancy', 'goofy', 'ornate']),
  preset('crocodile-folio', 'Crocodile Folio', 'shoulder', 'crocodile', ['edge-piping', 'crest'], true, 2, ['luxe', 'heavy', 'fancy']),
  preset('pigskin-antiphonal', 'Pigskin Antiphonal', 'clasped', 'pigskin', ['bosses'], false, 2, ['antique', 'devotional', 'heavy']),
  preset('pigskin-lectern', 'Lectern Pigskin', 'chained', 'pigskin', ['blind-panel'], false, 2, ['antique', 'severe', 'scholarly']),
  preset('oilcloth-logbook', 'Oilcloth Logbook', 'ledger', 'oilcloth', ['tally-rules'], false, 3, ['utilitarian', 'battered', 'rustic']),

  /* -------------------------------- vellum --------------------------------- */
  preset('antique-vellum', 'Antique Vellum', 'tapered-head', 'vellum', ['spine-rule', 'label-plate'], false, 4, ['antique', 'refined', 'devotional']),
  preset('limp-vellum', 'Limp Vellum', 'limp', 'vellum', ['plain'], false, 4, ['antique', 'handmade', 'devotional']),
  preset('gilt-vellum', 'Gilt Vellum', 'rounded', 'vellum', ['gilt-bands', 'label-plate'], true, 3, ['gilt', 'refined', 'antique']),
  preset('vellum-ties', 'Vellum with Ties', 'yapp', 'vellum', ['ribbon-marker'], false, 3, ['devotional', 'cosy', 'antique']),
  preset('corded-vellum', 'Corded Vellum', 'ribbed', 'vellum', ['label-plate'], false, 3, ['antique', 'handmade', 'formal']),
  preset('parchment-roll', 'Parchment Roll', 'rolled', 'parchment', ['plain'], false, 2, ['antique', 'whimsical', 'handmade']),
  preset('parchment-cartulary', 'Cartulary', 'clasped', 'parchment', ['blind-stamped-frame'], false, 2, ['antique', 'severe', 'scholarly']),
  preset('tawed-psalter', 'Tawed Psalter', 'gabled', 'alum-tawed', ['gothic-panel', 'ribbon-marker'], false, 2, ['devotional', 'antique', 'severe']),
  preset('tawed-boards', 'Tawed Boards', 'exposed-cords', 'alum-tawed', ['plain'], false, 2, ['antique', 'handmade', 'natural']),

  /* --------------------------- decorated papers ---------------------------- */
  preset('marbled-boards', 'Marbled Boards', 'square', 'marbled-paper', ['label-plate'], false, 6, ['fancy', 'antique', 'handmade']),
  preset('combed-marble', 'Combed Marble', 'square', 'marbled-paper', ['gilt-bands'], true, 4, ['fancy', 'gilt', 'antique']),
  preset('shell-marble', 'Shell Marble', 'rounded', 'shell-marble', ['double-bands', 'label-plate'], true, 3, ['fancy', 'refined', 'antique']),
  preset('spanish-wave', 'Spanish Wave', 'tight-back', 'spanish-marble', ['marbled-band'], false, 3, ['fancy', 'ornate', 'handmade']),
  preset('stone-quarto', 'Stone Quarto', 'square', 'stone-marble', ['spine-rule'], false, 3, ['sober', 'antique', 'handmade']),
  preset('paste-paper-book', 'Paste Paper Book', 'coptic', 'paste-paper', ['plain'], false, 3, ['handmade', 'cosy', 'natural']),
  preset('patterned-boards', 'Patterned Boards', 'square', 'patterned-paper', ['label-plate'], false, 5, ['plain', 'cosy', 'whimsical']),
  preset('diaper-paper', 'Diaper Paper', 'square', 'patterned-paper', ['spine-rule'], false, 4, ['plain', 'cosy', 'refined']),
  preset('block-printed', 'Block-Printed Boards', 'tapered-head', 'block-print', ['double-bands', 'label-plate'], false, 3, ['handmade', 'ornate', 'cosy']),
  preset('ribbon-almanac', 'Ribbon Almanac', 'square', 'patterned-paper', ['ribbon-marker', 'label-plate'], false, 3, ['cosy', 'whimsical', 'pocket']),
  preset('washi-notebook', 'Washi Notebook', 'japanese-stab', 'washi-print', ['plain'], false, 4, ['natural', 'handmade', 'airy']),
  preset('stab-sewn-album', 'Stab-Sewn Album', 'japanese-stab', 'japanese-paper', ['label-plate'], false, 3, ['refined', 'handmade', 'airy']),
  preset('laid-paper-quire', 'Laid Paper Quire', 'sewn-sections', 'japanese-paper', ['plain'], false, 3, ['plain', 'handmade', 'airy']),
  preset('dutch-gilt-primer', 'Dutch Gilt Primer', 'scalloped-head', 'dutch-gilt', ['head-ornament'], true, 2, ['gilt', 'ornate', 'whimsical']),
  preset('dutch-gilt-toybook', 'Gilt Toy Book', 'two-lobe', 'dutch-gilt', ['rosette'], true, 2, ['goofy', 'whimsical', 'gilt']),
  preset('striped-songbook', 'Striped Songbook', 'saddle-stapled', 'stripe-paper', ['plain'], false, 3, ['whimsical', 'modern', 'plain']),
  preset('chequer-primer', 'Chequer Primer', 'scalloped-tail', 'chequer-paper', ['label-plate'], false, 3, ['goofy', 'whimsical', 'modern']),
  preset('chequer-annual', 'Chequer Annual', 'square', 'chequer-paper', ['chequer-band'], true, 2, ['goofy', 'fancy', 'modern']),

  /* --------------------------- half and quarter ---------------------------- */
  preset('half-morocco', 'Half Morocco', 'ribbed', 'half-bound', ['gilt-bands', 'label-plate'], true, 6, ['formal', 'luxe', 'gilt']),
  preset('half-calf', 'Half Calf', 'rounded', 'half-bound', ['double-bands'], true, 5, ['formal', 'refined', 'antique']),
  preset('half-cloth', 'Half Cloth', 'square', 'half-cloth-paper', ['label-plate'], false, 5, ['plain', 'cosy', 'handmade']),
  preset('half-roan', 'Half Roan', 'tight-back', 'half-bound', ['spine-rule'], true, 3, ['plain', 'formal', 'antique']),
  preset('sammelband', 'Sammelband', 'ribbed', 'half-bound', ['foot-ornament', 'label-plate'], true, 2, ['scholarly', 'antique', 'formal']),
  preset('tooled-tail', 'Tooled Tail', 'rounded', 'half-bound', ['foot-ornament', 'spine-rule'], true, 2, ['refined', 'gilt', 'ornate']),
  preset('quarter-calf', 'Quarter Calf', 'rounded', 'quarter-bound', ['double-bands'], true, 5, ['formal', 'plain', 'antique']),
  preset('quarter-cloth', 'Quarter Cloth', 'square', 'quarter-bound', ['label-plate'], false, 5, ['plain', 'utilitarian', 'sober']),
  preset('quarter-vellum', 'Quarter Vellum', 'tapered-head', 'quarter-bound', ['spine-rule', 'label-plate'], false, 3, ['antique', 'refined', 'scholarly']),
  preset('marbled-quarter', 'Marbled Quarter', 'square', 'quarter-bound', ['marbled-band', 'label-plate'], false, 3, ['fancy', 'antique', 'handmade']),
  preset('three-quarter-morocco', 'Three-Quarter Morocco', 'ribbed', 'three-quarter', ['triple-bands', 'label-plate'], true, 3, ['luxe', 'formal', 'gilt']),
  preset('three-quarter-set', 'Three-Quarter Set', 'round-cap', 'three-quarter', ['gilt-bands', 'number-roundel'], true, 2, ['luxe', 'ornate', 'formal']),
  preset('tips-and-bands', 'Tips & Bands', 'double-hinge', 'tips-and-bands', ['corner-tooling', 'label-plate'], true, 3, ['refined', 'formal', 'antique']),
  preset('exposed-boards', 'Exposed Boards', 'splayed', 'boards-exposed', ['plain'], false, 3, ['battered', 'handmade', 'plain']),
  preset('rebacked-quarto', 'Rebacked Quarto', 'shoulder', 'boards-exposed', ['shelf-ticket'], false, 3, ['battered', 'antique', 'scholarly']),

  /* -------------------------- the sewing you can see ------------------------ */
  preset('coptic-sketchbook', 'Coptic Sketchbook', 'coptic', 'linen', ['plain'], false, 4, ['handmade', 'natural', 'modern']),
  preset('coptic-hardcase', 'Coptic Hard Case', 'coptic', 'boards-exposed', ['corner-tooling'], false, 3, ['handmade', 'battered', 'natural']),
  preset('long-stitch-journal', 'Long-Stitch Journal', 'long-stitch', 'suede', ['plain'], false, 4, ['handmade', 'cosy', 'rustic']),
  preset('long-stitch-limp', 'Limp Long-Stitch', 'long-stitch', 'parchment', ['plain'], false, 3, ['handmade', 'antique', 'natural']),
  preset('unbound-quire', 'Unbound Quire', 'sewn-sections', 'paper-wrapper', ['plain'], false, 3, ['plain', 'handmade', 'airy']),
  preset('bare-cords', 'Bare Cords', 'exposed-cords', 'boards-exposed', ['plain'], false, 3, ['handmade', 'rustic', 'natural']),
  preset('binders-mock-up', 'Binder’s Mock-Up', 'exposed-cords', 'linen', ['shelf-ticket'], false, 2, ['handmade', 'utilitarian', 'plain']),
  preset('raised-cord-folio', 'Raised-Cord Folio', 'ribbed', 'morocco-grain', ['triple-bands', 'label-plate'], true, 3, ['luxe', 'formal', 'gilt']),

  /* -------------------------- mechanical bindings --------------------------- */
  preset('spiral-notebook', 'Spiral Notebook', 'spiral-wire', 'canvas', ['plain'], false, 5, ['modern', 'utilitarian', 'plain']),
  preset('spiral-sketchpad', 'Spiral Sketchpad', 'spiral-wire', 'newsprint', ['tally-rules'], false, 3, ['modern', 'utilitarian', 'battered']),
  preset('comb-report', 'Comb-Bound Report', 'comb-bound', 'paper-wrapper', ['label-plate'], false, 4, ['modern', 'utilitarian', 'plain']),
  preset('ring-file', 'Ring File', 'ring-binder', 'buckram', ['shelf-ticket'], false, 4, ['modern', 'utilitarian', 'heavy']),
  preset('ring-catalogue', 'Ring Catalogue', 'ring-binder', 'oilcloth', ['spine-rule'], false, 3, ['utilitarian', 'sober', 'modern']),
  preset('thumb-index-lexicon', 'Thumb-Index Lexicon', 'tab-index', 'roan', ['label-plate'], true, 3, ['scholarly', 'utilitarian', 'formal']),
  preset('stapled-bulletin', 'Stapled Bulletin', 'saddle-stapled', 'paper-wrapper', ['plain'], false, 4, ['plain', 'utilitarian', 'pocket']),

  /* -------------------------- cut heads and profiles ------------------------ */
  preset('domed-hymnal', 'Domed Hymnal', 'domed-head', 'smooth-cloth', ['gilt-bands', 'ribbon-marker'], true, 3, ['devotional', 'cosy', 'gilt']),
  preset('reliquary-quarto', 'Reliquary Quarto', 'gabled', 'morocco-grain', ['gothic-panel'], true, 2, ['devotional', 'ornate', 'antique']),
  preset('ogee-breviary', 'Ogee Breviary', 'ogee-head', 'velvet', ['arch-panel', 'ribbon-marker'], true, 2, ['devotional', 'ornate', 'luxe']),
  preset('notched-manual', 'Notched Manual', 'notched-head', 'canvas', ['spine-rule'], false, 3, ['modern', 'utilitarian', 'plain']),
  preset('stepped-monograph', 'Stepped Monograph', 'stepped-head', 'buckram', ['centre-rule'], true, 2, ['modern', 'severe', 'formal']),
  preset('crenellated-history', 'Crenellated History', 'crenellated', 'russia-calf', ['dentil-band', 'crest'], true, 2, ['ornate', 'goofy', 'antique']),
  preset('wave-head-reader', 'Wave-Head Reader', 'wave-head', 'paste-paper', ['plain'], false, 3, ['whimsical', 'handmade', 'battered']),
  preset('valance-primer', 'Valance Primer', 'scalloped-tail', 'patterned-paper', ['rosette'], true, 2, ['whimsical', 'fancy', 'cosy']),
  preset('bevel-head-annual', 'Bevel-Head Annual', 'bevel-head', 'stripe-paper', ['centre-rule'], false, 2, ['modern', 'goofy', 'whimsical']),
  preset('splayed-scrapbook', 'Splayed Scrapbook', 'splayed', 'hessian', ['wax-seal'], false, 3, ['battered', 'handmade', 'rustic']),
  preset('waisted-well-read', 'Read to Death', 'waisted', 'roan', ['plain'], false, 4, ['battered', 'cosy', 'handmade']),
  preset('chamfered-monograph', 'Chamfered Monograph', 'chamfered', 'polished-calf', ['double-frame'], true, 2, ['formal', 'severe', 'luxe']),
  preset('shouldered-atlas', 'Shouldered Atlas', 'shoulder', 'buckram', ['gilt-panel', 'label-plate'], true, 2, ['formal', 'heavy', 'modern']),
  preset('plinth-folio', 'Plinth Folio', 'flared-tail', 'crocodile', ['greek-key'], true, 2, ['heavy', 'formal', 'ornate']),
  preset('twin-lobe-nursery', 'Nursery Twin-Lobe', 'two-lobe', 'felt', ['rosette'], false, 2, ['goofy', 'cosy', 'whimsical']),
  preset('creased-pocketbook', 'Creased Pocketbook', 'creased', 'skiver', ['plain'], false, 4, ['pocket', 'battered', 'cosy']),
  preset('limp-commonplace', 'Limp Commonplace', 'limp', 'linen', ['plain'], false, 4, ['handmade', 'natural', 'cosy']),
  preset('scroll-case', 'Scroll', 'rolled', 'parchment', ['plain'], false, 1, ['antique', 'whimsical', 'handmade']),
  preset('spring-back-ledger', 'Spring-Back Ledger', 'spring-back', 'canvas', ['corner-tooling', 'shelf-ticket'], false, 3, ['utilitarian', 'heavy', 'antique']),
  preset('cushioned-album', 'Cushioned Album', 'cushioned', 'velvet', ['bosses'], true, 2, ['luxe', 'cosy', 'ornate']),
  preset('tapered-anthology', 'Tapered Anthology', 'tapered-tail', 'marbled-paper', ['label-plate'], false, 3, ['handmade', 'fancy', 'whimsical']),

  /* --------------------------- boxed and fastened --------------------------- */
  preset('slipcased-set', 'Slipcased Set', 'slipcased', 'smooth-cloth', ['label-plate'], false, 3, ['formal', 'luxe', 'refined']),
  preset('slipcased-folio', 'Slipcased Folio', 'slipcased', 'buckram', ['gilt-bands'], true, 2, ['formal', 'luxe', 'gilt']),
  preset('clamshell-archive', 'Clamshell Archive', 'clamshell', 'buckram', ['shelf-ticket'], false, 2, ['formal', 'severe', 'scholarly']),
  preset('clamshell-treasure', 'Clamshell Treasure', 'clamshell', 'morocco-grain', ['gilt-panel', 'label-plate'], true, 1, ['luxe', 'gilt', 'formal']),
  preset('boxed-collected', 'Boxed Collected Works', 'boxed-set', 'half-bound', ['gilt-bands', 'number-roundel'], true, 2, ['formal', 'luxe', 'cosy']),
  preset('boxed-nursery', 'Boxed Nursery Set', 'boxed-set', 'chequer-paper', ['label-plate'], false, 2, ['cosy', 'goofy', 'whimsical']),
  preset('portfolio-plates', 'Plate Portfolio', 'portfolio', 'canvas', ['corner-tooling'], false, 3, ['utilitarian', 'formal', 'antique']),
  preset('portfolio-drawings', 'Drawing Portfolio', 'portfolio', 'boards-exposed', ['shelf-ticket'], false, 2, ['utilitarian', 'battered', 'plain']),
  preset('wallet-diary', 'Wallet Diary', 'wallet', 'suede', ['plain'], false, 4, ['pocket', 'cosy', 'handmade']),
  preset('clasped-bible', 'Clasped Bible', 'clasped', 'morocco-grain', ['blind-panel', 'ribbon-marker'], false, 3, ['devotional', 'antique', 'heavy']),
  preset('clasped-grimoire', 'Clasped Grimoire', 'clasped', 'shagreen', ['pin-studs', 'wax-seal'], false, 2, ['antique', 'ornate', 'heavy']),
  preset('chained-cartulary', 'Chained Cartulary', 'chained', 'alum-tawed', ['bosses'], false, 2, ['antique', 'severe', 'scholarly']),
  preset('chained-lectionary', 'Chained Lectionary', 'chained', 'pigskin', ['blind-stamped-frame'], false, 2, ['devotional', 'severe', 'antique']),
  preset('yapp-testament', 'Yapp Testament', 'yapp', 'skiver', ['edge-piping', 'ribbon-marker'], true, 3, ['devotional', 'pocket', 'cosy']),

  /* --------------------------- the very ornamented -------------------------- */
  preset('seme-royal', 'Semé Royal', 'ribbed', 'morocco-grain', ['fleur-seme', 'label-plate'], true, 1, ['luxe', 'ornate', 'gilt']),
  preset('empire-bees', 'Empire Bees', 'round-cap', 'morocco-grain', ['bee-diaper'], true, 1, ['ornate', 'luxe', 'fancy']),
  preset('vine-trailed-herbal', 'Trailed Herbal', 'ribbed', 'polished-calf', ['vine-trail'], true, 2, ['ornate', 'natural', 'handmade']),
  preset('laurel-prize', 'Prize Binding', 'rounded', 'smooth-cloth', ['laurel-spray', 'label-plate'], true, 3, ['formal', 'gilt', 'refined']),
  preset('acorn-nature-diary', 'Acorn Nature Diary', 'limp', 'tweed', ['acorn-tooling'], false, 3, ['natural', 'cosy', 'rustic']),
  preset('sunburst-atlas', 'Sunburst Atlas', 'flared-tail', 'silk-moire', ['sunburst-fan'], true, 2, ['fancy', 'ornate', 'luxe']),
  preset('cartouche-armorial', 'Armorial Cartouche', 'ribbed', 'morocco-grain', ['cartouche', 'gilt-bands'], true, 2, ['luxe', 'ornate', 'formal']),
  preset('lattice-cabinet', 'Lattice Cabinet Book', 'chamfered', 'brocade', ['lattice-panel'], true, 2, ['ornate', 'refined', 'fancy']),
  preset('greek-key-classics', 'Classics in Greek Key', 'tight-back', 'buckram', ['greek-key', 'label-plate'], true, 3, ['scholarly', 'formal', 'ornate']),
  preset('vitruvian-treatise', 'Vitruvian Treatise', 'double-hinge', 'polished-calf', ['wave-scroll', 'label-plate'], true, 2, ['formal', 'ornate', 'scholarly']),
  preset('chain-band-annals', 'Chain-Band Annals', 'ledger', 'russia-calf', ['chain-band'], true, 2, ['antique', 'severe', 'heavy']),
  preset('zigzag-saga', 'Zigzag Saga', 'gabled', 'roan', ['zigzag-band'], true, 2, ['antique', 'goofy', 'ornate']),
  preset('rope-band-logbook', 'Rope-Band Logbook', 'ledger', 'sailcloth', ['rope-band'], false, 3, ['rustic', 'handmade', 'utilitarian']),
  preset('beaded-poetry', 'Beaded Poetry', 'domed-head', 'silk-moire', ['beaded-band', 'label-plate'], true, 3, ['refined', 'fancy', 'gilt']),
  preset('dotted-miscellany', 'Dotted Miscellany', 'round-cap', 'tree-calf', ['dotted-rule', 'label-plate'], true, 3, ['refined', 'antique', 'gilt']),
  preset('dentil-lexicon', 'Dentil Lexicon', 'stepped-head', 'buckram', ['dentil-band', 'label-plate'], true, 2, ['formal', 'scholarly', 'ornate']),
  preset('banner-songbook', 'Banner Songbook', 'scalloped-head', 'block-print', ['banner-plaque'], true, 2, ['whimsical', 'ornate', 'cosy']),
  preset('monogrammed-letters', 'Monogrammed Letters', 'rounded', 'morocco-grain', ['monogram-lozenge', 'gilt-bands'], true, 2, ['luxe', 'refined', 'formal']),
  preset('crowned-statutes', 'Crowned Statutes', 'ribbed', 'russia-calf', ['crown-tooling', 'triple-bands'], true, 1, ['luxe', 'formal', 'ornate']),
  preset('studded-daybook', 'Studded Daybook', 'ledger', 'oilcloth', ['pin-studs'], false, 2, ['utilitarian', 'heavy', 'battered']),
  preset('shell-corner-keepsake', 'Shell-Corner Keepsake', 'cushioned', 'shell-marble', ['shell-corners', 'label-plate'], true, 2, ['fancy', 'ornate', 'cosy']),
  preset('double-framed-code', 'Double-Framed Code', 'tight-back', 'crocodile', ['double-frame'], true, 2, ['severe', 'formal', 'heavy']),
  preset('roundel-encyclopaedia', 'Roundel Encyclopaedia', 'shoulder', 'half-bound', ['number-roundel', 'gilt-bands'], true, 3, ['formal', 'scholarly', 'gilt']),
  preset('sealed-testimony', 'Sealed Testimony', 'portfolio', 'parchment', ['wax-seal'], false, 2, ['antique', 'handmade', 'severe']),
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

/** Every preset carrying `tag`, in list order. For steered randomisation. */
export function presetsTagged(tag: BookTag): readonly BookPreset[] {
  return BOOK_PRESETS.filter((p) => p.tags.includes(tag));
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
  /**
   * Overrule the preset's covering.
   *
   * Only pass this when the reader ASKED for it. A preset's material is half of
   * what makes it that preset — pass one unconditionally and all hundred and
   * eighty bindings collapse into however many looks the caller knows about.
   */
  material?: MaterialLook | null;
  /** Overrule the preset's silhouette. Same warning as `material`. */
  shape?: SpineShape | null;
  /** Raised cords across the spine, 0–5. Default 0. */
  bands?: number;
  /** Foil on those cords. Defaults to the design's own `gilt`. */
  bandGilt?: boolean;
  /** Endband style 0–2, or null for none (the default). */
  headTail?: number | null;
  /** 0–1, fading the cloth and rubbing the foil. Default 0. */
  wear?: number;
}

/**
 * Resolve a book's binding. Deterministic: same options ⇒ identical design, so
 * a book that picked "Half Morocco" on the day it was made is Half Morocco
 * forever, and a baked atlas rect stays valid across sessions.
 */
export function resolveBookDesign(opts: ResolveBookDesignOptions): BookDesign {
  const seed = opts.seed >>> 0;
  const chosen = opts.preset ? bookPreset(opts.preset) : presetForSeed(seed);
  const cloth = normIndex(opts.cloth ?? seed % CLOTHS.length, CLOTHS.length);
  // The accent must never equal the cloth: a half binding whose leather is the
  // same colour as its boards is just a plain book with a stray line on it.
  const accent = normIndex(
    opts.accent ?? cloth + 1 + (((seed >>> 5) % (CLOTHS.length - 1)) | 0),
    CLOTHS.length,
  );
  const gilt = opts.gilt ?? chosen.gilt;
  return {
    preset: chosen.id,
    shape: opts.shape ?? chosen.shape,
    material: opts.material ?? chosen.material,
    decorations: chosen.decorations,
    cloth,
    accent: accent === cloth ? normIndex(cloth + 1, CLOTHS.length) : accent,
    gilt,
    labelAt: clamp(opts.labelAt ?? 0.24, 0.16, 0.48),
    seed,
    bands: clamp(Math.round(opts.bands ?? 0), 0, 5),
    bandGilt: opts.bandGilt ?? gilt,
    headTail:
      opts.headTail === null || opts.headTail === undefined
        ? null
        : clamp(Math.round(opts.headTail), 0, 2),
    wear: clamp(opts.wear ?? 0, 0, 1),
  };
}

/**
 * The studio's seven binding materials, folded onto the fifty looks the drawing
 * knows. Seven distinct answers — the map is injective on purpose, because a
 * chip that lands on the same picture as its neighbour is a chip that does
 * nothing.
 */
export const MATERIAL_LOOK_FOR_BINDING: Readonly<Record<string, MaterialLook>> = {
  leather: 'morocco-grain',
  cloth: 'smooth-cloth',
  paper: 'paper-wrapper',
  vellum: 'vellum',
  linen: 'linen',
  // Silk is the flattest rich surface a flat drawing has: one deep even tone,
  // edge to edge, no turned board catching the light it does not have.
  silk: 'silk-moire',
  marbled: 'marbled-paper',
};

/** `MATERIAL_LOOK_FOR_BINDING` with a safe fallback. */
export function materialLookFor(material: string | undefined): MaterialLook {
  return MATERIAL_LOOK_FOR_BINDING[material ?? ''] ?? 'smooth-cloth';
}

/**
 * …and back, so the studio's covering chips can say what the BINDING chose.
 *
 * Lossy, and that is fine: the drawing knows fifty looks and the studio offers
 * seven, so a half binding reports the leather its head strip is made of. The
 * chip is then telling the truth about what the reader is looking at, and
 * pressing it says "make the whole book that" — which is exactly what it does.
 */
export function bindingMaterialFor(look: MaterialLook): string {
  switch (look) {
    case 'vellum':
    case 'parchment':
    case 'alum-tawed':
      return 'vellum';
    case 'linen':
    case 'ribbed-cloth':
    case 'canvas':
    case 'sailcloth':
    case 'hessian':
    case 'tweed':
      return 'linen';
    case 'silk-moire':
    case 'brocade':
    case 'damask':
    case 'velvet':
      return 'silk';
    case 'marbled-paper':
    case 'spanish-marble':
    case 'stone-marble':
    case 'shell-marble':
    case 'paste-paper':
      return 'marbled';
    case 'patterned-paper':
    case 'block-print':
    case 'washi-print':
    case 'japanese-paper':
    case 'dutch-gilt':
    case 'stripe-paper':
    case 'chequer-paper':
    case 'paper-wrapper':
    case 'newsprint':
    case 'boards-exposed':
      return 'paper';
    case 'smooth-cloth':
    case 'buckram':
    case 'felt':
      return 'cloth';
    default:
      // Every hide, and every split binding, whose visible face is a hide.
      return 'leather';
  }
}

/** The binding a stable string id resolves to (book row ids, test fixtures). */
export function bookDesignFromId(
  id: string,
  opts: Omit<ResolveBookDesignOptions, 'seed'> = {},
): BookDesign {
  return resolveBookDesign({ ...opts, seed: fnv1a(id) });
}

/**
 * A short stable tag for one design.
 *
 * **Every cache that stores drawn book pixels must carry this** alongside
 * `flatSchemeTag()`. The binding is a new axis of variation and it is *not*
 * implied by the seed once the studio can pin a preset — without the tag in the
 * key, a book restyled from Plain Wrapper to Full Morocco keeps serving the
 * wrapper off the disk cache forever.
 *
 * The shape is spelled out separately from the preset because `resolveBookDesign`
 * can now be handed one directly: two books on the same preset with different
 * silhouettes are different pixels and must be different keys.
 */
export function bookDesignTag(design: BookDesign): string {
  // The studio's four axes belong in the key for the same reason the preset
  // does: they change pixels, and a cache that ignores them serves a pristine
  // spine to a book the reader just wore out.
  //
  // EVERY numeric field is separated. They used to be concatenated bare, which
  // was unambiguous only while each was a single digit: with cloths at 50,
  // cloth 1 + accent 23 and cloth 12 + accent 3 both spell "123", so two
  // different books shared a cache key and one of them was served the other's
  // art. Nothing fails when that happens — the disk cache validates nothing
  // about a hit — so the separators are load-bearing, not tidiness.
  return [
    design.preset,
    design.shape,
    design.cloth,
    design.accent,
    design.gilt ? 'g' : 'n',
    design.material,
    design.bands,
    design.bandGilt ? 'g' : 'n',
    design.headTail ?? '-',
    Math.round(design.wear * 10),
  ].join('.');
}

/** Does this design carry the given mark? */
export function hasDecoration(design: BookDesign, mark: Decoration): boolean {
  return design.decorations.includes(mark);
}

/** Every mood word this design's three vocabularies carry, deduplicated. */
export function bookDesignTags(design: BookDesign): readonly BookTag[] {
  const out = new Set<BookTag>();
  for (const tag of shapeSpec(design.shape).tags) out.add(tag);
  for (const tag of materialSpec(design.material).tags) out.add(tag);
  for (const mark of design.decorations) for (const tag of decorSpec(mark).tags) out.add(tag);
  return [...out];
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
 * Never to fake a light: both endpoints are palette colours, so everything this
 * produces still sits inside the icon's tiny range.
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
 * A cloth after `wear` years on a shelf.
 *
 * Sun and hands take a spine's dye toward the paper it is made of; they do not
 * add dirt, and a flat drawing that tried to would just look smudged. A fifth
 * of the way to cream at full wear is enough to read beside a pristine
 * neighbour and not so much that a well-loved oxblood stops being oxblood.
 */
function fadedPair(pair: readonly [string, string], wear: number): readonly [string, string] {
  if (wear <= 0.02) return pair;
  const t = clamp(wear, 0, 1) * 0.2;
  return [mix(pair[0], FLAT.cream, t), mix(pair[1], FLAT.cream, t * 0.8)];
}

/**
 * Tooling colour after `wear`. Gilt is leaf a few atoms thick and it is the
 * first thing to go; what shows through is the board underneath.
 */
function rubbed(foil: string, board: string, wear: number): string {
  return wear <= 0.02 ? foil : mix(foil, board, clamp(wear, 0, 1) * 0.5);
}

/** The [face, board] pair a material's `body` tone asks for. */
function bodyPair(design: BookDesign): readonly [string, string] {
  const spec = materialSpec(design.material);
  const [face, dark] = fadedPair(clothPair(design.cloth), design.wear);
  const [accentFace, accentDark] = fadedPair(clothPair(design.accent), design.wear);
  switch (spec.body) {
    case 'deep':
      return [dark, mix(dark, FLAT.ink, 0.26)];
    case 'pale': {
      const pale = mix(face, FLAT.cream, 0.34);
      return [pale, mix(pale, FLAT.ink, 0.2)];
    }
    case 'cream':
      return [FLAT.cream, FLAT.creamDeep];
    case 'parchment':
      return [FLAT.creamDeep, mix(FLAT.creamDeep, FLAT.ink, 0.24)];
    case 'accent':
      return [accentFace, accentDark];
    default:
      return [face, dark];
  }
}

/** Where a split material's second covering sits, as a [top, bottom] span. */
function splitSpan(split: Split): readonly (readonly [number, number])[] {
  switch (split) {
    case 'half':
      return [[-0.02, 0.34]];
    case 'quarter':
      return [
        [-0.02, 0.18],
        [0.9, 1.02],
      ];
    case 'threeQuarter':
      return [[-0.02, 0.6]];
    case 'tips':
      return [
        [-0.02, 0.12],
        [0.88, 1.02],
      ];
    case 'headBand':
      return [[-0.02, 0.15]];
    default:
      return [];
  }
}

/**
 * The [face, board] pair the material actually shows at height fraction `t`.
 *
 * Cords, yapp lips, creases and the slipcase are drawn OUTSIDE the material
 * clip, so they cannot read the surface they sit on and have to ask. Without
 * this a vellum book grew green cords and a half binding's top cord came out in
 * the boards' colour instead of the leather's — in both cases the object stopped
 * reading as part of the book it is standing on.
 */
function surfaceAt(design: BookDesign, t: number): readonly [string, string] {
  const spec = materialSpec(design.material);
  for (const [a, b] of splitSpan(spec.split)) {
    if (t >= a && t <= b) return fadedPair(clothPair(design.accent), design.wear);
  }
  return bodyPair(design);
}

/**
 * Ribbon colourways. Saturated only — a pale ribbon at the head of a spine reads
 * as a second, smaller label, which is the one thing it must not do. (Same
 * reasoning, and the same shortlist, as `spines.ts`'s own ribbon.)
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
 * The same hash `flat.ts` wobbles with, repeated rather than imported so the two
 * files agree on what "drawn by hand" looks like without `flat.ts` having to
 * export a private detail.
 */
function wob(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** Continue the current path to (tx, ty) with a slight perpendicular bow. */
function bowTo(ctx: FlatCtx, fx: number, fy: number, tx: number, ty: number, amount: number): void {
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
  /** The drawn book body. Many shapes stand narrower than their footprint. */
  body: DesignBox;
  /**
   * Where tooling and the label go. Identical to `body` except for the boxed
   * shapes, whose marks belong on the case rather than on the sliver of head
   * showing above it, and for the cut heads, which eat into their own top.
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
  return shapeBoxes(shapeSpec(design.shape), x, y, w, h);
}

/**
 * How far an end profile eats into the body, as a fraction of the height.
 *
 * The end profiles are measured INWARD from the footprint's edge (see `endY`),
 * so a gable's peak lands exactly on the top of the slot and its shoulders sit
 * below it, rather than the whole roof standing outside the rect the shelf
 * composer reserved. That is what keeps every one of the fifty inside its
 * atlas rect — but it also means a mark tooled at the very head would land on
 * air beside the roof, so the decorated surface starts below the intrusion.
 */
function endIntrusion(profile: EndProfile, endDepth: number): number {
  return END_PROFILES[profile].reach * endDepth;
}

function shapeBoxes(spec: ShapeSpec, x: number, y: number, w: number, h: number): BookSpineBoxes {
  const inset = w * spec.inset;
  const body: DesignBox = {
    x: x + inset,
    y: y + h * spec.dropTop,
    w: Math.max(2, w - inset * 2),
    h: Math.max(4, h * (1 - spec.dropTop - spec.dropBottom)),
  };
  // A boxed book is decorated on its CASE, which starts below the head that
  // pokes out of it. Everything else is tooled on the book itself.
  const base: DesignBox = spec.onCase
    ? { x, y: y + h * spec.caseTop, w, h: h * (1 - spec.caseTop) }
    : body;
  const top = Math.max(spec.decorTop, spec.onCase ? 0 : endIntrusion(spec.head, spec.endDepth));
  const bottom = Math.max(
    spec.decorBottom,
    spec.onCase ? 0 : endIntrusion(spec.tail, spec.endDepth),
  );
  const dInset = base.w * spec.decorInset;
  return {
    body,
    decor: {
      x: base.x + dInset,
      y: base.y + base.h * top,
      w: Math.max(2, base.w - dInset * 2),
      h: Math.max(4, base.h * (1 - top - bottom)),
    },
  };
}

/** The body's width at height fraction `t`, as a fraction of the box. */
function widthAt(spec: ShapeSpec, t: number): number {
  if (spec.side === 'shoulder') {
    // A real step, not a taper: the width changes over a thirtieth of the
    // height, which at 200px is six pixels — a shoulder you can see.
    const k = clamp((t - spec.shoulderAt) / 0.035, 0, 1);
    const s = k * k * (3 - 2 * k);
    return spec.headWidth + (spec.tailWidth - spec.headWidth) * s;
  }
  const run = spec.headWidth + (spec.tailWidth - spec.headWidth) * t;
  switch (spec.side) {
    case 'belly':
      return run + Math.sin(Math.PI * t) * 0.06;
    case 'bulge':
      return run + Math.sin(Math.PI * t) * 0.15;
    case 'waist':
      return run - Math.sin(Math.PI * t) * 0.13;
    case 'ripple':
      return run + Math.sin(Math.PI * 3 * t) * 0.035;
    default:
      return run;
  }
}

/** How far the body's centre line wanders, as a fraction of the box width. */
function centreAt(spec: ShapeSpec, t: number): number {
  switch (spec.side) {
    case 'sway':
      // A limp binding has no boards to hold it upright, so the whole spine
      // leans. One slow S, never a wobble — a wobble reads as a mistake.
      return Math.sin(Math.PI * t * 1.15 + 0.55) * 0.045;
    case 'ripple':
      return Math.sin(Math.PI * 3 * t + 1) * 0.014;
    default:
      return 0;
  }
}

/** How many points a long edge is sampled at. Sixteen is smooth at any LOD. */
const SIDE_SAMPLES = 16;

interface Pt {
  x: number;
  y: number;
}

/**
 * Lay the silhouette into the current path. Fill and stroke are the caller's.
 *
 * ONE tracer for all fifty shapes: an end profile at the head, another at the
 * tail, a width profile down the sides, a corner treatment. Everything a shape
 * adds beyond that outline is a separate OBJECT and belongs in `drawShapeMarks`.
 */
function traceBookShape(ctx: FlatCtx, b: DesignBox, spec: ShapeSpec, seed: number): void {
  const { x, y, w, h } = b;
  const cx = x + w / 2;
  const dep = Math.max(0.5, spec.endDepth * h);
  const amp = Math.min(w, h) * 0.012;
  const bowR = (0.4 + 0.6 * Math.abs(wob(seed + 3))) * amp;
  const bowL = (0.4 + 0.6 * Math.abs(wob(seed + 4))) * amp;

  const right = (t: number): number =>
    cx + w * centreAt(spec, t) + (w * widthAt(spec, t)) / 2 + Math.sin(Math.PI * t) * bowR;
  const left = (t: number): number =>
    cx + w * centreAt(spec, t) - (w * widthAt(spec, t)) / 2 - Math.sin(Math.PI * t) * bowL;

  const head = END_PROFILES[spec.head];
  const tail = END_PROFILES[spec.tail];
  // Measured inward from the slot's edge, so the tallest point of any profile
  // lands exactly on it and nothing is drawn outside the atlas rect.
  const headY = (v: number): number => y + (head.reach - v) * dep;
  const tailY = (v: number): number => y + h - (tail.reach - v) * dep;

  const hL = left(0);
  const hR = right(0);
  const tL = left(1);
  const tR = right(1);
  const radius = Math.min(spec.corner * w, spec.corner * 0.12 * h, h * 0.06);
  const rH = Math.max(0, Math.min(radius, (hR - hL) * 0.44));
  const rT = Math.max(0, Math.min(radius, (tR - tL) * 0.44));

  const hSpan = Math.max(0.5, hR - hL - rH * 2);
  const tSpan = Math.max(0.5, tR - tL - rT * 2);
  const hx = (u: number): number => hL + rH + u * hSpan;
  const tx = (u: number): number => tR - rT - u * tSpan;

  const headEnd = head.knots.length > 0 ? (head.knots[head.knots.length - 1] as Knot).v : head.v0;
  const tailEnd = tail.knots.length > 0 ? (tail.knots[tail.knots.length - 1] as Knot).v : tail.v0;

  /** A long edge, sampled and smoothed through the midpoints of its samples. */
  const side = (from: Pt, to: Pt, at: (t: number) => number, t0: number, t1: number): void => {
    const pts: Pt[] = [from];
    for (let i = 1; i < SIDE_SAMPLES; i++) {
      const t = t0 + ((t1 - t0) * i) / SIDE_SAMPLES;
      pts.push({ x: at(t), y: y + t * h });
    }
    pts.push(to);
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i] as Pt;
      const q = pts[i + 1] as Pt;
      ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
    }
    const a = pts[pts.length - 2] as Pt;
    ctx.quadraticCurveTo(a.x, a.y, to.x, to.y);
  };

  /** A corner: a fillet normally, a straight chamfer for bevelled boards. */
  const corner = (via: Pt, to: Pt): void => {
    if (spec.bevelCorner) ctx.lineTo(to.x, to.y);
    else ctx.quadraticCurveTo(via.x, via.y, to.x, to.y);
  };

  const headRightY = headY(headEnd) + rH;
  const headLeftY = headY(head.v0) + rH;
  const tailRightY = tailY(tail.v0) - rT;
  const tailLeftY = tailY(tailEnd) - rT;

  ctx.beginPath();
  ctx.moveTo(hx(0), headY(head.v0));
  for (const k of head.knots) ctx.quadraticCurveTo(hx(k.cu), headY(k.cv), hx(k.u), headY(k.v));
  corner({ x: hR, y: headY(headEnd) }, { x: hR, y: headRightY });
  side(
    { x: hR, y: headRightY },
    { x: tR, y: tailRightY },
    right,
    (headRightY - y) / h,
    (tailRightY - y) / h,
  );
  corner({ x: tR, y: tailY(tail.v0) }, { x: tx(0), y: tailY(tail.v0) });
  for (const k of tail.knots) ctx.quadraticCurveTo(tx(k.cu), tailY(k.cv), tx(k.u), tailY(k.v));
  corner({ x: tL, y: tailY(tailEnd) }, { x: tL, y: tailLeftY });
  side(
    { x: tL, y: tailLeftY },
    { x: hL, y: headLeftY },
    left,
    (tailLeftY - y) / h,
    (headLeftY - y) / h,
  );
  corner({ x: hL, y: headY(head.v0) }, { x: hx(0), y: headY(head.v0) });
  ctx.closePath();
}

/**
 * The parts of a shape that are separate OBJECTS rather than silhouette:
 * cords, caps, grooves, stitching, wire, boxes, clasps, straps.
 *
 * Drawn AFTER the body — a cord stands on the spine, and a slipcase stands in
 * front of the book — and before any tooling, which then lands on top of
 * whichever surface the reader is actually looking at.
 */
function drawShapeMarks(
  ctx: FlatCtx,
  foot: DesignBox,
  b: DesignBox,
  spec: ShapeSpec,
  design: BookDesign,
  ink: number,
): void {
  const { x, y, w, h } = b;
  const seed = design.seed;
  const [, board] = surfaceAt(design, 0.5);
  const brass = rubbed(FLAT.gilt, board, design.wear);
  const steel = mix(FLAT.slate, FLAT.cream, 0.12);
  const thread = mix(FLAT.cream, board, 0.2);
  const fine = Math.max(1, ink * 0.62);
  const caseFill = mix(board, FLAT.cream, 0.52);

  /** An object standing on the spine: its own body, its own one ink outline. */
  const pill = (px: number, py: number, pw: number, ph: number, fill: string, n: number): void => {
    if (pw <= 0.5 || ph <= 0.5) return;
    panel(ctx, px, py, pw, ph, fill, {
      radius: Math.min(pw, ph) * 0.46,
      seed: seed + n,
      width: fine,
    });
  };

  for (const mark of spec.marks) {
    // Cords, creases and stitches are all sub-pixel on a sliver, and a sliver
    // with four grey rungs across it stops looking like a book. The boxes are
    // exempt: a slipcase IS the book at that size.
    if (w < 9 && !spec.onCase) continue;

    switch (mark) {
      case 'cords': {
        // Fat, not thin: a cord is a rope under leather, and a hairline rung
        // would read as a rule rather than as something standing proud.
        const ch = Math.max(2.4, h * 0.026);
        for (let i = 0; i < RIB_STATIONS.length; i++) {
          const s = RIB_STATIONS[i] as number;
          pill(foot.x, y + h * s - ch / 2, foot.w, ch, surfaceAt(design, s)[0], 40 + i);
        }
        break;
      }
      case 'bareCords': {
        const ch = Math.max(2.2, h * 0.022);
        for (let i = 0; i < BARE_CORD_STATIONS.length; i++) {
          const s = BARE_CORD_STATIONS[i] as number;
          pill(foot.x, y + h * s - ch / 2, foot.w, ch, thread, 44 + i);
        }
        // The sewing thread running between them, down the middle.
        stroke(ctx, x + w * 0.5, y + h * 0.1, x + w * 0.5, y + h * 0.9, thread, Math.max(1, w * 0.05), seed + 49);
        break;
      }
      case 'grooves':
      case 'frenchGrooves': {
        // The creases where the covers hinge — the one thing that tells a flat
        // back from a rounded one at this size.
        const c = mix(board, FLAT.ink, 0.35);
        const at = mark === 'grooves' ? [0.17, 0.83] : [0.1, 0.21, 0.79, 0.9];
        for (let i = 0; i < at.length; i++) {
          const t = at[i] as number;
          stroke(ctx, x + w * t, y + h * 0.035, x + w * t, y + h * 0.965, c, Math.max(1, w * 0.04), seed + 60 + i);
        }
        break;
      }
      case 'stitchLine': {
        stroke(ctx, x + w * 0.3, y + h * 0.03, x + w * 0.3, y + h * 0.97, mix(board, FLAT.ink, 0.3), Math.max(1, w * 0.07), seed + 70);
        const st = Math.max(1.4, h * 0.028);
        for (let i = 0; i < 3; i++) {
          const t = 0.26 + i * 0.24;
          stroke(ctx, x + w * 0.64, y + h * t - st / 2, x + w * 0.64, y + h * t + st / 2, FLAT.inkSoft, Math.max(1, w * 0.1), seed + 71 + i);
        }
        break;
      }
      case 'stabKnots': {
        // Four knots down one side and the thread that ties them — the whole
        // of a stab binding, seen edge on.
        const kx = x + w * 0.26;
        stroke(ctx, kx, y + h * 0.12, kx, y + h * 0.88, thread, Math.max(1, w * 0.06), seed + 74);
        const kr = Math.max(1.6, w * 0.13);
        for (let i = 0; i < 4; i++) {
          pill(kx - kr, y + h * (0.16 + i * 0.23) - kr, kr * 2, kr * 2, thread, 75 + i);
        }
        break;
      }
      case 'longStitch': {
        // Three runs of stitching straight through a limp cover: dashes, not
        // lines, because a line at this width is a rule and reads as tooling.
        for (let r = 0; r < 3; r++) {
          const ly = y + h * (0.2 + r * 0.3);
          for (let i = 0; i < 3; i++) {
            const sx = x + w * (0.16 + i * 0.28);
            stroke(ctx, sx, ly, sx + w * 0.18, ly, thread, Math.max(1, h * 0.008), seed + 80 + r * 3 + i);
          }
        }
        break;
      }
      case 'chainStitch': {
        // A chain of link stitches down a bare spine: alternating short
        // diagonals, which is what a Coptic chain looks like from the side.
        const links = 9;
        for (let i = 0; i < links; i++) {
          const y0 = y + h * (0.08 + (i * 0.84) / links);
          const y1 = y + h * (0.08 + ((i + 1) * 0.84) / links);
          const dir = i % 2 === 0 ? 1 : -1;
          stroke(ctx, x + w * (0.5 - 0.16 * dir), y0, x + w * (0.5 + 0.16 * dir), y1, thread, Math.max(1, w * 0.07), seed + 90 + i);
        }
        break;
      }
      case 'coil': {
        // A wire coil threaded through the spine: every turn is one slanted
        // bar, and the bars are all parallel because the wire is one spiral.
        const turns = 11;
        for (let i = 0; i < turns; i++) {
          const ty0 = y + h * (0.05 + (i * 0.9) / turns);
          stroke(ctx, x + w * 0.14, ty0, x + w * 0.86, ty0 + h * 0.032, steel, Math.max(1.2, w * 0.09), seed + 100 + i);
        }
        break;
      }
      case 'comb': {
        // A plastic comb gripping the edge: teeth that curl back on themselves.
        const teeth = 9;
        const th = Math.max(2, (h * 0.86) / (teeth * 1.7));
        for (let i = 0; i < teeth; i++) {
          const ty0 = y + h * (0.07 + (i * 0.86) / teeth);
          pill(x + w * 0.08, ty0, w * 0.6, th, steel, 110 + i);
        }
        break;
      }
      case 'rings': {
        const rr = Math.min(w * 0.34, h * 0.05);
        for (let i = 0; i < 3; i++) {
          const cy = y + h * (0.2 + i * 0.3);
          ctx.beginPath();
          ctx.ellipse(x + w * 0.42, cy, rr, rr * 1.15, 0, 0, Math.PI * 2);
          ctx.strokeStyle = steel;
          ctx.lineWidth = Math.max(1.4, w * 0.1);
          ctx.stroke();
        }
        break;
      }
      case 'staples': {
        const sh = Math.max(3, h * 0.05);
        for (const [t, n] of [
          [0.25, 0],
          [0.75, 1],
        ] as const) {
          pill(x + w * 0.36, y + h * t - sh / 2, w * 0.28, sh, steel, 120 + n);
        }
        break;
      }
      case 'sections': {
        // Five folded gatherings, each seen end on: a stack of soft pills with
        // the sewing running through them.
        const gaps = 5;
        const gh = (h * 0.94) / gaps;
        for (let i = 0; i < gaps; i++) {
          pill(x + w * 0.06, y + h * 0.03 + i * gh, w * 0.88, gh * 0.86, surfaceAt(design, (i + 0.5) / gaps)[0], 130 + i);
        }
        break;
      }
      case 'slipcase': {
        // A pale board sleeve standing in front of the book, with its own mouth
        // line at the top so it reads as open rather than as a second cover.
        const cy = foot.y + foot.h * spec.caseTop;
        const ch = foot.y + foot.h - cy;
        panel(ctx, foot.x, cy, foot.w, ch, caseFill, {
          radius: Math.min(foot.w * 0.16, ch * 0.02),
          seed: seed + 140,
          width: Math.max(1, inkWidth(foot.w)),
        });
        stroke(ctx, foot.x + foot.w * 0.12, cy + ch * 0.035, foot.x + foot.w * 0.88, cy + ch * 0.035, FLAT.inkSoft, Math.max(1, foot.w * 0.05), seed + 141);
        break;
      }
      case 'clamshell': {
        // A drop-back box: the lid line runs right across near the head and a
        // lip runs the whole fore edge, which is what a clamshell shows.
        const cy = foot.y + foot.h * spec.caseTop;
        const ch = foot.y + foot.h - cy;
        panel(ctx, foot.x, cy, foot.w, ch, caseFill, {
          radius: Math.min(foot.w * 0.08, ch * 0.015),
          seed: seed + 145,
          width: Math.max(1, inkWidth(foot.w)),
        });
        stroke(ctx, foot.x + foot.w * 0.04, cy + ch * 0.12, foot.x + foot.w * 0.96, cy + ch * 0.12, FLAT.inkSoft, Math.max(1.2, foot.w * 0.055), seed + 146);
        stroke(ctx, foot.x + foot.w * 0.86, cy + ch * 0.16, foot.x + foot.w * 0.86, cy + ch * 0.96, mix(caseFill, FLAT.ink, 0.32), Math.max(1, foot.w * 0.05), seed + 147);
        break;
      }
      case 'boxedSet': {
        // Two heads above one case: the second volume is in there too, which is
        // the only honest way to say "set" with one slot on a shelf.
        const cy = foot.y + foot.h * spec.caseTop;
        const ch = foot.y + foot.h - cy;
        const secondW = foot.w * 0.34;
        panel(ctx, foot.x + foot.w * 0.58, foot.y + foot.h * 0.03, secondW, cy - foot.y + foot.h * 0.04, surfaceAt(design, 0.05)[1], {
          radius: secondW * 0.2,
          seed: seed + 150,
          width: fine,
        });
        panel(ctx, foot.x, cy, foot.w, ch, caseFill, {
          radius: Math.min(foot.w * 0.14, ch * 0.02),
          seed: seed + 151,
          width: Math.max(1, inkWidth(foot.w)),
        });
        // A short slot line under the case's head: enough to say "two volumes
        // in here", and short enough never to run under a title.
        stroke(ctx, foot.x + foot.w * 0.5, cy + ch * 0.05, foot.x + foot.w * 0.5, cy + ch * 0.2, mix(caseFill, FLAT.ink, 0.28), Math.max(1, foot.w * 0.045), seed + 152);
        break;
      }
      case 'flange': {
        // A portfolio flap folded across from the left, with a stud to hold it.
        const fw = w * 0.34;
        panel(ctx, x - w * 0.01, y + h * 0.02, fw, h * 0.96, mix(board, FLAT.ink, 0.14), {
          radius: fw * 0.28,
          seed: seed + 155,
          width: fine,
        });
        const sr = Math.max(1.4, w * 0.09);
        pill(x + fw - sr, y + h * 0.5 - sr, sr * 2, sr * 2, brass, 156);
        break;
      }
      case 'walletFlap': {
        // An envelope flap over the foot, with a tongue that tucks in.
        const fy = y + h * 0.7;
        panel(ctx, x + w * 0.02, fy, w * 0.96, h * 0.28, mix(board, FLAT.cream, 0.16), {
          radius: w * 0.26,
          seed: seed + 158,
          width: fine,
        });
        const tw = Math.max(2, w * 0.22);
        pill(x + w * 0.5 - tw / 2, fy + h * 0.2, tw, h * 0.1, board, 159);
        break;
      }
      case 'clasps': {
        const cw = Math.max(3, w * 0.36);
        const chh = Math.max(2.4, h * 0.036);
        for (const [t, n] of [
          [0.22, 0],
          [0.78, 1],
        ] as const) {
          pill(x + w * 0.5 - cw / 2, y + h * t - chh / 2, cw, chh, brass, 160 + n);
          stroke(ctx, x + w * 0.5, y + h * t - chh * 0.9, x + w * 0.5, y + h * t + chh * 0.9, brass, Math.max(1, w * 0.06), seed + 162 + n);
        }
        break;
      }
      case 'chainLink': {
        // A ring at the foot and one link hanging off it. This book stays.
        const rr = Math.max(2, Math.min(w * 0.2, h * 0.024));
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.ellipse(x + w * 0.5, y + h * (0.88 + i * 0.045), rr, rr * 1.3, 0, 0, Math.PI * 2);
          ctx.strokeStyle = steel;
          ctx.lineWidth = Math.max(1.2, w * 0.07);
          ctx.stroke();
        }
        break;
      }
      case 'knobs': {
        // A turned knob at each end: a scroll, not a book, and it should look
        // like one from across the room.
        const kw = w * 1.6;
        const kh = Math.max(3, h * 0.03);
        for (const [t, n] of [
          [0.02, 0],
          [0.98, 1],
        ] as const) {
          pill(x + w * 0.5 - kw / 2, y + h * t - kh / 2, kw, kh, mix(board, FLAT.ink, 0.2), 165 + n);
        }
        break;
      }
      case 'headcaps': {
        // Leather turned over a cord at head and tail, and rolled round.
        const capH = Math.max(2.2, h * 0.024);
        for (const [t, n] of [
          [0.045, 0],
          [0.955, 1],
        ] as const) {
          pill(x + w * 0.04, y + h * t - capH / 2, w * 0.92, capH, surfaceAt(design, t)[1], 168 + n);
        }
        break;
      }
      case 'yappLips': {
        // The covers overhang the block. The lips sit mostly OUTSIDE the body,
        // so they read as caps on the ends rather than as two rungs across it.
        const lh = Math.max(2, h * 0.03);
        for (const [ly, t, n] of [
          [y - lh * 0.62, 0, 0],
          [y + h - lh * 0.38, 1, 1],
        ] as const) {
          pill(foot.x, ly, foot.w, lh, surfaceAt(design, t)[1], 170 + n);
        }
        break;
      }
      case 'ledgerStrap': {
        const sh = Math.max(3, h * 0.05);
        pill(foot.x, y + h * 0.82 - sh / 2, foot.w, sh, mix(board, FLAT.ink, 0.22), 174);
        const br = Math.max(1.6, w * 0.12);
        pill(x + w * 0.5 - br, y + h * 0.82 - br, br * 2, br * 2, brass, 175);
        break;
      }
      case 'tab': {
        // A cut card tab standing at the fore edge, halfway down.
        //
        // It stands PROUD of the slot, which is the point of a thumb index —
        // but only just. It used to be placed at `x + w - tw * 0.3`, i.e.
        // projecting 0.7 of its own width, about 29% of the spine. That is
        // wider than the bake reserves, so the mark was sheared off by the
        // bitmap edge, and on a shelf it would have stood through the book
        // next to it. Cap the overhang instead of the position, so it holds at
        // both ends of the 8-58px thickness range rather than only at the
        // width it happened to be drawn at.
        const tw = Math.max(3, w * 0.42);
        const th = Math.max(4, h * 0.09);
        const proud = Math.min(tw * 0.7, w * 0.08 + 1);
        panel(ctx, x + w + proud - tw, y + h * 0.44, tw, th, FLAT.cream, {
          radius: tw * 0.3,
          seed: seed + 178,
          width: fine,
        });
        break;
      }
      default:
        break;
    }
  }
}

/* ========================================================================== *
 *                           stage 2 — the material                           *
 * ========================================================================== */

const TAU = Math.PI * 2;

/**
 * Paint the inside of the silhouette. The caller has already clipped to it, so
 * everything here may overshoot the box freely — which it does, because a
 * wobbled band clipped by a wobbled outline is what stops the two edges from
 * agreeing too neatly.
 *
 * ONE painter for all fifty coverings: a body tone, a turned board (near side,
 * and optionally far), an optional second covering over one or two spans, one
 * grain, and up to two joint lines. Nothing here is a texture — a material
 * reads through where the colour changes and through a handful of chunky flat
 * marks, which is the only thing that survives thirty pixels of width.
 */
function paintMaterial(ctx: FlatCtx, b: DesignBox, design: BookDesign): void {
  const { x, y, w, h } = b;
  const spec = materialSpec(design.material);
  const [face, board] = bodyPair(design);
  const [accentFace, accentBoard] = fadedPair(clothPair(design.accent), design.wear);
  const seed = design.seed;
  const r = Math.min(w * 0.3, h * 0.03);

  /** One covering laid over a span of the spine: board, then face beside it. */
  const lay = (top: number, bottom: number, f: string, d: string, n: number): void => {
    const ty = y + h * top;
    const th = h * (bottom - top);
    if (spec.turn <= 0) {
      fillBand(ctx, x - w, ty, w * 3, th, f, 0, seed + n);
      return;
    }
    fillBand(ctx, x - w, ty, w * 3, th, d, 0, seed + n);
    fillBand(ctx, x + w * spec.turn, ty, w * (2 - spec.turn), th, f, r, seed + n + 1);
    if (spec.farTurn > 0) {
      fillBand(ctx, x + w * (1 - spec.farTurn), ty, w * 2, th, d, 0, seed + n + 2);
    }
  };

  lay(-0.03, 1.03, face, board, 10);

  // Below its floor the fine work of a covering — veins, lozenges, joint lines
  // — lands on less than a pixel and reads as dirt, so a sliver gets the plain
  // two-tone case and nothing else. The two-tone still carries the colour. A
  // thoroughly worn book loses the same detail for the same reason it loses its
  // gilt: it has been rubbed off.
  const fine = w >= spec.floor && design.wear < 0.78;

  /* ------------------------------- the grain ------------------------------- */

  const gc = ((): string => {
    switch (spec.grainTone) {
      case 'deeper':
        return mix(board, FLAT.ink, 0.32);
      case 'pale':
        return mix(face, FLAT.cream, 0.42);
      case 'cream':
        return FLAT.cream;
      case 'ink':
        return FLAT.inkSoft;
      case 'accent':
        return accentFace;
      case 'foil':
        return rubbed(FLAT.gilt, board, design.wear);
      default:
        return mix(board, FLAT.ink, 0.16);
    }
  })();

  // The clear field: everything right of the turned board and left of the far
  // one. A grain struck across the joint reads as a mistake, not as a weave.
  const f0 = spec.turn > 0 ? spec.turn + 0.05 : 0.06;
  const f1 = 1 - (spec.farTurn > 0 ? spec.farTurn + 0.03 : 0.04);
  const fw = Math.max(0.02, f1 - f0);
  const rand = mulberry32((seed ^ 0x9e37) >>> 0);
  const n = Math.max(1, Math.round(spec.grainCount));

  const dot = (cx: number, cy: number, rr: number, colour = gc): void => {
    if (rr < 0.35) return;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rr, rr, 0, 0, TAU);
    ctx.fillStyle = colour;
    ctx.fill();
  };
  const hLine = (t: number, a: number, bb: number, weight: number, k: number): void =>
    stroke(ctx, x + w * a, y + h * t, x + w * bb, y + h * t, gc, Math.max(0.8, weight), seed + 200 + k);
  const vLine = (a: number, t0: number, t1: number, weight: number, k: number): void =>
    stroke(ctx, x + w * a, y + h * t0, x + w * a, y + h * t1, gc, Math.max(0.8, weight), seed + 240 + k);

  if (fine) {
    switch (spec.grain) {
      case 'ribs':
        for (let i = 1; i < n; i++) hLine(i / n, f0 - 0.02, 1.04, h * 0.006, i);
        break;
      case 'weave': {
        for (let i = 1; i < n; i++) hLine(i / n, f0, f1, h * 0.005, i);
        for (let i = 1; i < 4; i++) vLine(f0 + (fw * i) / 4, 0.04, 0.96, w * 0.03, i);
        break;
      }
      case 'twill':
        for (let i = 0; i < n; i++) {
          const t = 0.05 + (i * 0.9) / n;
          stroke(ctx, x + w * f0, y + h * t, x + w * f1, y + h * (t + 0.028), gc, Math.max(0.8, h * 0.005), seed + 200 + i);
        }
        break;
      case 'coarse':
        for (let i = 0; i < n; i++) {
          const t = 0.08 + (i * 0.86) / n;
          hLine(t, f0 + rand() * 0.1, f1 - rand() * 0.12, h * 0.009, i);
        }
        break;
      case 'fleck':
        for (let i = 0; i < n; i++) {
          const t = 0.05 + rand() * 0.9;
          const a = f0 + rand() * fw * 0.7;
          hLine(t, a, a + fw * 0.22, h * 0.006, i);
        }
        break;
      case 'nap': {
        // Pile: a broad soft band along the fore edge, in the second value.
        // Depth said as a darker flat face beside a lighter one, never as light.
        fillBand(ctx, x + w * (f1 - 0.2), y - h * 0.02, w * (0.2 + 0.06), h * 1.04, gc, w * 0.14, seed + 205);
        for (let i = 1; i <= n; i++) vLine(f0 + (fw * i) / (n + 1) - 0.03, 0.06, 0.94, w * 0.025, i);
        break;
      }
      case 'watered':
      case 'combedVeins':
        for (let i = 0; i < n; i++) {
          const vx = x + w * (f0 + (fw * (i + 0.5)) / n);
          const amp = w * (spec.grain === 'watered' ? 0.035 : 0.055) * (1 + wob(seed + i) * 0.3);
          ctx.beginPath();
          ctx.moveTo(vx, y + h * 0.02);
          const steps = 5;
          for (let s = 0; s < steps; s++) {
            const y0 = y + h * (0.02 + (0.96 * s) / steps);
            const y1 = y + h * (0.02 + (0.96 * (s + 1)) / steps);
            ctx.quadraticCurveTo(vx + (s % 2 === 0 ? amp : -amp), (y0 + y1) / 2, vx, y1);
          }
          ctx.strokeStyle = i % 2 === 0 ? gc : mix(gc, FLAT.cream, 0.3);
          ctx.lineWidth = Math.max(1, w * (spec.grain === 'watered' ? 0.035 : 0.05));
          ctx.lineCap = 'round';
          ctx.stroke();
        }
        break;
      case 'figured':
        for (let i = 0; i < n; i++) {
          const cy = y + h * (0.08 + (i * 0.84) / (n - 1 || 1));
          const s = Math.min(w * 0.16, h * 0.02);
          ctx.beginPath();
          ctx.moveTo(x + w * (f0 + fw * 0.5), cy - s);
          ctx.quadraticCurveTo(x + w * (f0 + fw * 0.5) + s, cy, x + w * (f0 + fw * 0.5), cy + s);
          ctx.quadraticCurveTo(x + w * (f0 + fw * 0.5) - s, cy, x + w * (f0 + fw * 0.5), cy - s);
          ctx.fillStyle = gc;
          ctx.fill();
        }
        break;
      case 'damask':
        for (let i = 0; i < n; i++) {
          const cy = y + h * (0.1 + (i * 0.8) / (n - 1 || 1));
          const cxx = x + w * (f0 + fw * (i % 2 === 0 ? 0.36 : 0.64));
          const s = Math.min(w * 0.18, h * 0.024);
          ctx.beginPath();
          ctx.moveTo(cxx, cy - s);
          ctx.quadraticCurveTo(cxx + s * 0.9, cy - s * 0.2, cxx, cy + s);
          ctx.quadraticCurveTo(cxx - s * 0.9, cy - s * 0.2, cxx, cy - s);
          ctx.fillStyle = gc;
          ctx.fill();
        }
        break;
      case 'pebble': {
        const rows = Math.max(4, Math.round(n / 2));
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < 2; col++) {
            const cy = y + h * (0.06 + (row * 0.88) / (rows - 1 || 1));
            const cxx = x + w * (f0 + fw * (row % 2 === 0 ? 0.3 + col * 0.4 : 0.5 + col * 0.4));
            dot(cxx, cy, Math.min(w * 0.05, h * 0.006));
          }
        }
        break;
      }
      case 'panelled':
        fillBand(ctx, x + w * (f0 + fw * 0.24), y - h * 0.02, w * fw * 0.5, h * 1.04, gc, w * 0.12, seed + 210);
        break;
      case 'flame': {
        const stem = f0 + fw * 0.5;
        vLine(stem, 0.06, 0.94, w * 0.05, 0);
        for (let i = 0; i < n; i++) {
          const t = 0.18 + (i * 0.62) / (n - 1 || 1);
          const dir = i % 2 === 0 ? 1 : -1;
          stroke(ctx, x + w * stem, y + h * t, x + w * (stem + fw * 0.42 * dir), y + h * (t - 0.07), gc, Math.max(1, w * 0.04), seed + 212 + i);
        }
        break;
      }
      case 'sprinkle':
        for (let i = 0; i < n; i++) {
          dot(x + w * (f0 + rand() * fw), y + h * (0.03 + rand() * 0.94), Math.min(w * 0.035, h * 0.004));
        }
        break;
      case 'mottle':
        for (let i = 0; i < n; i++) {
          const s = Math.min(w * 0.14, h * 0.017) * (0.6 + rand() * 0.8);
          ctx.beginPath();
          ctx.ellipse(x + w * (f0 + rand() * fw), y + h * (0.05 + rand() * 0.9), s, s * 0.7, 0, 0, TAU);
          ctx.fillStyle = gc;
          ctx.fill();
        }
        break;
      case 'scales':
        for (let row = 0; row < n; row++) {
          const cy = y + h * (0.07 + (row * 0.86) / n);
          for (let col = 0; col < 2; col++) {
            const cxx = x + w * (f0 + fw * (row % 2 === 0 ? 0.28 + col * 0.44 : 0.5 + col * 0.44));
            ctx.beginPath();
            ctx.ellipse(cxx, cy, Math.min(w * 0.14, h * 0.016), Math.min(w * 0.1, h * 0.012), 0, Math.PI, TAU);
            ctx.strokeStyle = gc;
            ctx.lineWidth = Math.max(0.8, w * 0.03);
            ctx.stroke();
          }
        }
        break;
      case 'shagreen': {
        const cxx = x + w * (f0 + fw * 0.5);
        const cy = y + h * 0.5;
        const rr = Math.min(w * 0.26, h * 0.03);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          dot(cxx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 1.6, Math.min(w * 0.045, h * 0.005));
        }
        dot(cxx, cy, Math.min(w * 0.05, h * 0.006));
        break;
      }
      case 'plates':
        for (let row = 0; row < n; row++) {
          for (let col = 0; col < 2; col++) {
            const px = x + w * (f0 + fw * (0.06 + col * 0.48));
            const py = y + h * (0.06 + (row * 0.88) / n);
            fillBand(ctx, px, py, w * fw * 0.4, h * (0.88 / n) * 0.7, gc, w * 0.04, seed + 220 + row * 2 + col);
          }
        }
        break;
      case 'pinDot':
        for (let i = 0; i < n; i++) {
          const cy = y + h * (0.05 + (i * 0.9) / n);
          const cxx = x + w * (f0 + fw * (i % 2 === 0 ? 0.34 : 0.62));
          const s = Math.min(w * 0.03, h * 0.0035);
          dot(cxx, cy, s);
          dot(cxx + w * 0.09, cy + h * 0.006, s);
          dot(cxx + w * 0.045, cy - h * 0.008, s);
        }
        break;
      case 'creases':
        for (let i = 0; i < n; i++) {
          const t = 0.16 + (i * 0.68) / (n - 1 || 1);
          stroke(ctx, x + w * f0, y + h * t, x + w * f1, y + h * (t + 0.05), gc, Math.max(1, w * 0.035), seed + 226 + i);
        }
        break;
      case 'stitchRun':
        for (let i = 0; i < n; i++) {
          const t = 0.05 + (i * 0.9) / n;
          hLine(t, f0 + fw * 0.1, f0 + fw * 0.34, h * 0.008, i);
          hLine(t, f0 + fw * 0.62, f0 + fw * 0.86, h * 0.008, i + 40);
        }
        break;
      case 'spanishWave':
        for (let row = 0; row < n; row++) {
          const cy = y + h * (0.06 + (row * 0.88) / n);
          ctx.beginPath();
          const peaks = 3;
          for (let i = 0; i <= peaks * 2; i++) {
            const px = x + w * (f0 + (fw * i) / (peaks * 2));
            const py = cy + (i % 2 === 0 ? -1 : 1) * h * 0.012;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.strokeStyle = row % 2 === 0 ? gc : mix(gc, FLAT.ink, 0.25);
          ctx.lineWidth = Math.max(0.9, h * 0.006);
          ctx.lineJoin = 'round';
          ctx.stroke();
        }
        break;
      case 'stoneVein':
        for (let i = 0; i < n; i++) {
          const t = 0.08 + (i * 0.84) / n;
          const a = f0 + rand() * fw * 0.5;
          stroke(ctx, x + w * a, y + h * t, x + w * (a + fw * 0.45), y + h * (t + 0.04), gc, Math.max(0.9, w * 0.03), seed + 230 + i);
          stroke(ctx, x + w * (a + fw * 0.22), y + h * (t + 0.02), x + w * (a + fw * 0.3), y + h * (t - 0.03), gc, Math.max(0.8, w * 0.025), seed + 235 + i);
        }
        break;
      case 'shellSpots':
        for (let i = 0; i < n; i++) {
          const cy = y + h * (0.07 + (i * 0.86) / n);
          const cxx = x + w * (f0 + fw * (i % 2 === 0 ? 0.34 : 0.62));
          const rr = Math.min(w * 0.12, h * 0.015);
          dot(cxx, cy, rr);
          dot(cxx, cy, rr * 0.45, mix(gc, FLAT.cream, 0.6));
        }
        break;
      case 'pasteComb':
        for (let i = 0; i < n; i++) {
          const cy = y + h * (0.08 + (i * 0.84) / (n - 1 || 1));
          ctx.beginPath();
          ctx.moveTo(x + w * f0, cy);
          ctx.quadraticCurveTo(x + w * (f0 + fw * 0.5), cy + h * 0.022, x + w * f1, cy);
          ctx.strokeStyle = gc;
          ctx.lineWidth = Math.max(1, h * 0.008);
          ctx.stroke();
        }
        break;
      case 'lozenges': {
        const size = Math.min(w * 0.15, h * 0.018);
        ctx.fillStyle = gc;
        for (let row = 0; row < n; row++) {
          const cy = y + h * (0.06 + (row * 0.88) / (n - 1 || 1));
          for (let col = 0; col < 2; col++) {
            const cxx = x + w * (f0 + fw * (row % 2 === 0 ? 0.26 + col * 0.42 : 0.47 + col * 0.42));
            if (cxx > x + w * f1) continue;
            ctx.beginPath();
            ctx.moveTo(cxx, cy - size);
            ctx.lineTo(cxx + size * 0.7, cy);
            ctx.lineTo(cxx, cy + size);
            ctx.lineTo(cxx - size * 0.7, cy);
            ctx.closePath();
            ctx.fill();
          }
        }
        break;
      }
      case 'floret': {
        const s = Math.min(w * 0.09, h * 0.011);
        for (let row = 0; row < n; row++) {
          const cy = y + h * (0.08 + (row * 0.84) / (n - 1 || 1));
          const cxx = x + w * (f0 + fw * (row % 2 === 0 ? 0.34 : 0.62));
          for (let p = 0; p < 4; p++) {
            const a = (p / 4) * TAU + 0.4;
            dot(cxx + Math.cos(a) * s * 1.5, cy + Math.sin(a) * s * 1.5, s);
          }
          dot(cxx, cy, s * 0.8, mix(gc, FLAT.ink, 0.3));
        }
        break;
      }
      case 'fibres':
        for (let i = 0; i < n; i++) {
          const t = 0.04 + rand() * 0.92;
          const a = f0 + rand() * fw * 0.6;
          stroke(ctx, x + w * a, y + h * t, x + w * (a + fw * (0.2 + rand() * 0.3)), y + h * (t + (rand() - 0.5) * 0.05), gc, Math.max(0.8, w * 0.02), seed + 250 + i);
        }
        break;
      case 'laidLines':
        for (let i = 1; i <= n; i++) vLine(f0 + (fw * i) / (n + 1), 0.03, 0.97, w * 0.022, i);
        break;
      case 'giltDots': {
        const rows = Math.max(5, n);
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < 2; col++) {
            dot(
              x + w * (f0 + fw * (row % 2 === 0 ? 0.28 + col * 0.42 : 0.49 + col * 0.42)),
              y + h * (0.06 + (row * 0.88) / (rows - 1 || 1)),
              Math.min(w * 0.05, h * 0.006),
            );
          }
        }
        break;
      }
      case 'stripes':
        for (let i = 0; i < n; i++) {
          const sw = fw / (n * 2 - 1);
          fillBand(ctx, x + w * (f0 + i * sw * 2), y - h * 0.02, w * sw, h * 1.04, i % 2 === 0 ? gc : mix(gc, FLAT.ink, 0.28), 0, seed + 260 + i);
        }
        break;
      case 'chequer': {
        const cols = 2;
        const cw = (fw * w) / cols;
        const chh = (h * 0.98) / n;
        for (let row = 0; row < n; row++) {
          for (let col = 0; col < cols; col++) {
            if ((row + col) % 2 !== 0) continue;
            fillBand(ctx, x + w * f0 + col * cw, y + h * 0.01 + row * chh, cw, chh, gc, 0, seed + 270 + row);
          }
        }
        break;
      }
      case 'newsRules':
        for (let i = 0; i < n; i++) {
          const block = Math.floor(i / 5);
          hLine(0.06 + i * 0.06 + block * 0.02, f0, f1 - 0.06 * (i % 3), h * 0.004, i);
        }
        break;
      case 'wrapperRules':
        for (let i = 0; i < n; i++) hLine(i === 0 ? 0.09 : 0.91, 0.14, 0.86, w * 0.05, i);
        break;
      case 'scuffs':
        for (let i = 0; i < n; i++) {
          const t = i % 2 === 0 ? 0.04 + rand() * 0.1 : 0.86 + rand() * 0.1;
          const a = f0 + rand() * fw * 0.6;
          stroke(ctx, x + w * a, y + h * t, x + w * (a + fw * 0.35), y + h * (t + 0.02), gc, Math.max(0.9, w * 0.03), seed + 280 + i);
        }
        break;
      default:
        break;
    }
  }

  /* --------------------------- the second covering -------------------------- */

  for (const [i, [top, bottom]] of splitSpan(spec.split).entries()) {
    lay(top, bottom, accentFace, accentBoard, 290 + i * 4);
    // The line where the two coverings meet. Ink, because it is a real edge:
    // one skin ends and another begins, and a binder turns the leather over it.
    const edge = top < 0 ? bottom : top;
    stroke(ctx, x - w * 0.02, y + h * edge, x + w * 1.02, y + h * edge, FLAT.ink, Math.max(1, inkWidth(w) * 0.6), seed + 300 + i);
  }

  /* -------------------------------- the joints ------------------------------ */

  if (fine && spec.joints > 0) {
    const joint = mix(board, FLAT.ink, 0.32);
    const at = [spec.turn > 0 ? spec.turn : 0.22];
    if (spec.joints > 1) at.push(1 - (spec.farTurn > 0 ? spec.farTurn : 0.14));
    for (let i = 0; i < at.length; i++) {
      stroke(ctx, x + w * (at[i] as number), y + h * 0.02, x + w * (at[i] as number), y + h * 0.98, joint, Math.max(1, w * 0.032), seed + 310 + i);
    }
  }
}

/** How far down the spine a material has already spoken for, at the head. */
function materialHeadClaim(material: MaterialLook): number {
  const spans = splitSpan(materialSpec(material).split);
  const head = spans.find(([top]) => top <= 0);
  return head === undefined ? 0 : head[1] + 0.02;
}

/** …and the same at the foot. */
function materialFootClaim(material: MaterialLook): number {
  const spans = splitSpan(materialSpec(material).split);
  const tail = spans.find(([, bottom]) => bottom >= 1);
  return tail === undefined ? 1 : tail[0] - 0.02;
}

/* ========================================================================== *
 *                          stage 3 — the decoration                          *
 * ========================================================================== */

/**
 * A region of the spine the caller has spoken for, in absolute px.
 *
 * `x0`/`x1` are optional. Without them the band is treated as spanning the full
 * width, which is what every caller meant before they existed — but a
 * lettering-piece is a RECTANGLE, and treating it as a horizontal stripe is
 * what let `spine-rule` strike through one: its rules sit at 0.15 and 0.85 of
 * the width, just outside the `LABEL_SPAN` constant, so the vertical-rule
 * painter concluded they cleared the label and ran them full height. On the
 * designs whose plate is actually wider than that constant, they did not.
 */
interface Reserved {
  y0: number;
  y1: number;
  x0?: number;
  x1?: number;
}

/**
 * Does a lettering-piece fit, and read as one?
 *
 * The same test `spines.ts` applies before it sets a title, exported so the two
 * cannot disagree — a plate drawn here that the title code then declines to
 * fill is a blank white smear, and the reverse is a title floating on bare
 * cloth. On a sliver the answer is no and the book simply goes untitled, which
 * is what a sliver on a real shelf does.
 */
export function fitsLabelPlate(d: DesignBox): boolean {
  return d.w > 14 && d.h > 60;
}

function overlaps(reserved: Reserved | null, y0: number, y1: number): boolean {
  return reserved !== null && y0 < reserved.y1 && y1 > reserved.y0;
}

/**
 * Does a vertical stripe from `px - half` to `px + half` cross the reserved
 * rectangle? Falls back to `LABEL_SPAN` when the caller gave no x extent, so
 * callers that pass only a band behave exactly as they did.
 *
 * `WOBBLE_SLACK` is not padding for taste. Every line in this vocabulary is
 * drawn with a bowed edge, so a rule's ink lands a pixel or two either side of
 * where its centre says it is. `spine-rule` sits about 1.8px clear of the
 * plate on a 34px spine — clear by arithmetic, and through the title in the
 * bitmap. Compare the ink's real reach, not the nominal centreline.
 */
const WOBBLE_SLACK = 0.06;

function crossesReserved(
  reserved: Reserved | null,
  px: number,
  half: number,
  x: number,
  w: number,
): boolean {
  if (reserved === null) return false;
  const x0 = reserved.x0 ?? x + w * LABEL_SPAN.left;
  const x1 = reserved.x1 ?? x + w * LABEL_SPAN.right;
  const reach = half + Math.max(1.5, w * WOBBLE_SLACK);
  return px + reach > x0 && px - reach < x1;
}

/** The horizontal span a lettering-piece covers, as fractions of the width. */
const LABEL_SPAN = { left: 0.185, right: 0.815 } as const;

/* ------------------------------- run glyphs -------------------------------- */

/**
 * One motif repeated along a band.
 *
 * Every one of these is drawn between two x's at one y, in a band `bh` tall,
 * so a decoration never has to know what a spine is. `count` is a COUNT, never
 * a pitch: the same spine is baked at two very different scales, and a pitch
 * rule gives four repeats at one LOD and twelve at the other.
 */
function drawRun(
  ctx: FlatCtx,
  glyph: RunGlyph,
  x0: number,
  x1: number,
  cy: number,
  bh: number,
  count: number,
  colour: string,
  weight: number,
  seed: number,
): void {
  const span = x1 - x0;
  if (span <= 1 || bh <= 0.6) return;
  const step = span / count;
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.lineWidth = weight;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  switch (glyph) {
    case 'dot':
      for (let i = 0; i < count; i++) {
        ctx.beginPath();
        ctx.ellipse(x0 + step * (i + 0.5), cy, bh * 0.5, bh * 0.5, 0, 0, TAU);
        ctx.fill();
      }
      return;
    case 'bead':
      for (let i = 0; i < count; i++) {
        ctx.beginPath();
        ctx.ellipse(x0 + step * (i + 0.5), cy, step * 0.46, bh * 0.62, 0, 0, TAU);
        ctx.fill();
      }
      return;
    case 'dentil':
      for (let i = 0; i < count; i++) {
        wobbleRect(ctx, x0 + step * (i + 0.16), cy - bh * 0.6, step * 0.68, bh * 1.2, bh * 0.14, seed + i);
        ctx.fill();
      }
      return;
    case 'chequer':
      for (let i = 0; i < count; i++) {
        if (i % 2 !== 0) continue;
        wobbleRect(ctx, x0 + step * i, cy - bh * 0.6, step, bh * 1.2, bh * 0.1, seed + i);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(x0, cy - bh * 0.6);
      ctx.lineTo(x1, cy - bh * 0.6);
      ctx.moveTo(x0, cy + bh * 0.6);
      ctx.lineTo(x1, cy + bh * 0.6);
      ctx.lineWidth = Math.max(0.8, weight * 0.5);
      ctx.stroke();
      return;
    case 'zigzag':
    case 'wave': {
      ctx.beginPath();
      const teeth = count * 2;
      for (let i = 0; i <= teeth; i++) {
        const px = x0 + (span * i) / teeth;
        const py = cy + (i % 2 === 0 ? -bh * 0.6 : bh * 0.6);
        if (i === 0) ctx.moveTo(px, py);
        else if (glyph === 'zigzag') ctx.lineTo(px, py);
        else ctx.quadraticCurveTo(px - span / teeth / 2, cy + (i % 2 === 0 ? bh * 0.6 : -bh * 0.6), px, py);
      }
      ctx.stroke();
      return;
    }
    case 'rope':
      for (let i = 0; i < count; i++) {
        const px = x0 + step * (i + 0.5);
        ctx.beginPath();
        ctx.moveTo(px - step * 0.3, cy + bh * 0.55);
        ctx.quadraticCurveTo(px, cy, px + step * 0.3, cy - bh * 0.55);
        ctx.stroke();
      }
      return;
    case 'chain':
      for (let i = 0; i < count; i++) {
        ctx.beginPath();
        ctx.ellipse(x0 + step * (i + 0.5), cy, step * 0.56, bh * 0.55, 0, 0, TAU);
        ctx.stroke();
      }
      return;
    case 'key':
      // The meander: up, across, down, across — folded and folded back.
      for (let i = 0; i < count; i++) {
        const px = x0 + step * i;
        ctx.beginPath();
        ctx.moveTo(px, cy + bh * 0.5);
        ctx.lineTo(px, cy - bh * 0.5);
        ctx.lineTo(px + step * 0.66, cy - bh * 0.5);
        ctx.lineTo(px + step * 0.66, cy + bh * 0.1);
        ctx.lineTo(px + step * 0.33, cy + bh * 0.1);
        ctx.stroke();
      }
      return;
    case 'scroll':
      // A running wave that breaks the same way every time.
      for (let i = 0; i < count; i++) {
        const px = x0 + step * (i + 0.5);
        ctx.beginPath();
        ctx.arc(px, cy, Math.min(step * 0.45, bh * 0.6), Math.PI * 0.15, Math.PI * 1.55);
        ctx.stroke();
      }
      return;
    case 'lattice':
      for (let i = 0; i <= count; i++) {
        const px = x0 + step * i;
        ctx.beginPath();
        ctx.moveTo(px, cy - bh * 0.5);
        ctx.lineTo(px + step, cy + bh * 0.5);
        ctx.moveTo(px + step, cy - bh * 0.5);
        ctx.lineTo(px, cy + bh * 0.5);
        ctx.stroke();
      }
      return;
    default:
      return;
  }
}

/* ------------------------------ stamp glyphs ------------------------------- */

/** One motif, struck once, centred on (cx, cy) and `s` across. */
function drawStamp(
  ctx: FlatCtx,
  glyph: StampGlyph,
  cx: number,
  cy: number,
  s: number,
  colour: string,
  weight: number,
): void {
  if (s < 1) return;
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.lineWidth = weight;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const disc = (dx: number, dy: number, rr: number): void => {
    ctx.beginPath();
    ctx.ellipse(cx + dx, cy + dy, rr, rr, 0, 0, TAU);
    ctx.fill();
  };

  switch (glyph) {
    case 'lozenge':
      ctx.beginPath();
      ctx.moveTo(cx, cy - s);
      ctx.lineTo(cx + s * 0.66, cy);
      ctx.lineTo(cx, cy + s);
      ctx.lineTo(cx - s * 0.66, cy);
      ctx.closePath();
      ctx.fill();
      return;
    case 'monogram':
      ctx.beginPath();
      ctx.moveTo(cx, cy - s);
      ctx.lineTo(cx + s * 0.68, cy);
      ctx.lineTo(cx, cy + s);
      ctx.lineTo(cx - s * 0.68, cy);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.34, cy);
      ctx.lineTo(cx + s * 0.34, cy);
      ctx.stroke();
      return;
    case 'rosette':
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        disc(Math.cos(a) * s * 0.58, Math.sin(a) * s * 0.58, s * 0.34);
      }
      disc(0, 0, s * 0.3);
      return;
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU - Math.PI / 2;
        const rr = i % 2 === 0 ? s : s * 0.44;
        const px = cx + Math.cos(a) * rr * 0.8;
        const py = cy + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      return;
    }
    case 'crest':
      // A shield: square shoulders, a point at the foot, one band across it.
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.66, cy - s * 0.9);
      ctx.lineTo(cx + s * 0.66, cy - s * 0.9);
      ctx.lineTo(cx + s * 0.66, cy + s * 0.2);
      ctx.quadraticCurveTo(cx + s * 0.5, cy + s * 0.75, cx, cy + s);
      ctx.quadraticCurveTo(cx - s * 0.5, cy + s * 0.75, cx - s * 0.66, cy + s * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = FLAT.ink;
      ctx.lineWidth = Math.max(0.8, weight * 0.7);
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.6, cy - s * 0.2);
      ctx.lineTo(cx + s * 0.6, cy - s * 0.2);
      ctx.stroke();
      return;
    case 'crown':
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.8, cy + s * 0.6);
      ctx.lineTo(cx - s * 0.8, cy - s * 0.2);
      ctx.lineTo(cx - s * 0.4, cy + s * 0.15);
      ctx.lineTo(cx, cy - s * 0.8);
      ctx.lineTo(cx + s * 0.4, cy + s * 0.15);
      ctx.lineTo(cx + s * 0.8, cy - s * 0.2);
      ctx.lineTo(cx + s * 0.8, cy + s * 0.6);
      ctx.closePath();
      ctx.fill();
      return;
    case 'fleuron':
      // Three lobes off one stem — the commonest tool in any bindery.
      for (const [dx, dy, rr] of [
        [0, -s * 0.45, s * 0.44],
        [-s * 0.6, s * 0.1, s * 0.38],
        [s * 0.6, s * 0.1, s * 0.38],
      ] as const) {
        disc(dx, dy, rr);
      }
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx, cy + s * 0.9);
      ctx.lineWidth = Math.max(1, weight);
      ctx.stroke();
      return;
    case 'fleur':
      // The lily: a centre petal, two swept side petals, one bar under them.
      ctx.beginPath();
      ctx.moveTo(cx, cy - s);
      ctx.quadraticCurveTo(cx + s * 0.34, cy - s * 0.2, cx, cy + s * 0.34);
      ctx.quadraticCurveTo(cx - s * 0.34, cy - s * 0.2, cx, cy - s);
      ctx.fill();
      ctx.lineWidth = Math.max(1, weight);
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.72, cy - s * 0.1);
      ctx.quadraticCurveTo(cx - s * 0.2, cy + s * 0.05, cx, cy + s * 0.36);
      ctx.moveTo(cx + s * 0.72, cy - s * 0.1);
      ctx.quadraticCurveTo(cx + s * 0.2, cy + s * 0.05, cx, cy + s * 0.36);
      ctx.moveTo(cx - s * 0.6, cy + s * 0.5);
      ctx.lineTo(cx + s * 0.6, cy + s * 0.5);
      ctx.stroke();
      return;
    case 'bee':
      ctx.beginPath();
      ctx.ellipse(cx, cy + s * 0.2, s * 0.4, s * 0.6, 0, 0, TAU);
      ctx.fill();
      ctx.lineWidth = Math.max(1, weight);
      ctx.beginPath();
      ctx.ellipse(cx - s * 0.62, cy - s * 0.3, s * 0.42, s * 0.24, -0.6, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx + s * 0.62, cy - s * 0.3, s * 0.42, s * 0.24, 0.6, 0, TAU);
      ctx.stroke();
      return;
    case 'acorn':
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.5, cy - s * 0.1);
      ctx.quadraticCurveTo(cx, cy + s, cx + s * 0.5, cy - s * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx, cy - s * 0.28, s * 0.62, s * 0.3, 0, 0, TAU);
      ctx.fill();
      return;
    case 'sun':
      disc(0, 0, s * 0.36);
      ctx.lineWidth = Math.max(1, weight);
      for (let i = 0; i < 9; i++) {
        const a = Math.PI + (i / 8) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * s * 0.46, cy + Math.sin(a) * s * 0.46);
        ctx.lineTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s);
        ctx.stroke();
      }
      return;
    case 'seal':
      ctx.beginPath();
      ctx.ellipse(cx, cy, s * 0.9, s * 0.82, 0, 0, TAU);
      ctx.fillStyle = FLAT.terracotta;
      ctx.fill();
      ctx.strokeStyle = FLAT.ink;
      ctx.lineWidth = Math.max(1, weight);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx, cy, s * 0.44, s * 0.4, 0, 0, TAU);
      ctx.strokeStyle = colour;
      ctx.stroke();
      return;
    case 'shell':
      ctx.beginPath();
      ctx.ellipse(cx, cy + s * 0.4, s, s, 0, Math.PI, TAU);
      ctx.fill();
      ctx.strokeStyle = FLAT.ink;
      ctx.lineWidth = Math.max(0.8, weight * 0.6);
      for (let i = 1; i < 4; i++) {
        const a = Math.PI + (i / 4) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(cx, cy + s * 0.4);
        ctx.lineTo(cx + Math.cos(a) * s * 0.92, cy + s * 0.4 + Math.sin(a) * s * 0.92);
        ctx.stroke();
      }
      return;
    case 'leaf':
      ctx.beginPath();
      ctx.moveTo(cx, cy - s);
      ctx.quadraticCurveTo(cx + s * 0.72, cy, cx, cy + s);
      ctx.quadraticCurveTo(cx - s * 0.72, cy, cx, cy - s);
      ctx.fill();
      return;
    default:
      return;
  }
}

/* -------------------------------- the toolist ------------------------------ */

/**
 * Strike one ornament onto the decorated surface.
 *
 * ONE toolist, switching on the part kind and nothing else. Every part that
 * could land on the caller's lettering-piece asks `reserved` first and answers
 * in the way a binder would: a rule skips that station, a semé skips that row,
 * a stamp moves into the next free compartment, a vertical rule parts round it,
 * and a panel GROWS to frame it — because a panel around a label is a real
 * binding and a panel across one is a mistake.
 */
function drawDecoration(
  ctx: FlatCtx,
  d: DesignBox,
  design: BookDesign,
  spec: DecorSpec,
  reserved: Reserved | null,
): void {
  const { x, y, w, h } = d;
  if (w < spec.floor) return;
  const seed = design.seed;
  const [, board] = surfaceAt(design, 0.5);
  const foil = spec.blind
    ? FLAT.inkSoft
    : rubbed(design.gilt ? FLAT.gilt : FLAT.inkSoft, board, design.wear);
  const ink = inkWidth(w);
  const rand = mulberry32((seed ^ 0x5eed1) >>> 0);

  /** The largest clear stretch of the field, for a stamp that must move. */
  const freeCentre = (): number | null => {
    if (reserved === null) return y + h * 0.5;
    const above = reserved.y0 - (y + h * 0.06);
    const below = y + h * 0.94 - reserved.y1;
    if (above < h * 0.12 && below < h * 0.12) return null;
    return above > below ? (y + h * 0.06 + reserved.y0) / 2 : (reserved.y1 + y + h * 0.94) / 2;
  };

  for (const part of spec.parts) {
    switch (part.k) {
      case 'rule': {
        const weight = Math.max(1, w * part.weight);
        for (let i = 0; i < part.at.length; i++) {
          const t = part.at[i] as number;
          const py = y + h * t;
          if (overlaps(reserved, py - weight, py + weight)) continue;
          stroke(ctx, x + w * part.from, py, x + w * part.to, py, foil, weight, seed + 400 + i + t * 100);
        }
        break;
      }
      case 'vrule': {
        const weight = Math.max(1, w * part.weight);
        for (let i = 0; i < part.at.length; i++) {
          const f = part.at[i] as number;
          const px = x + w * f;
          const top = y + h * part.top;
          const bottom = y + h * part.bottom;
          // A rule outside the lettering-piece's own width runs straight past
          // it; one underneath it parts, so the label is never struck through.
          //
          // Measured against the reserved rectangle rather than the LABEL_SPAN
          // constant. `spine-rule` sits at 0.15/0.85 — outside that constant,
          // inside the plate that several designs actually draw — so the old
          // test said "clears it" and the rule went through the title.
          const under = crossesReserved(reserved, px, weight * 0.5, x, w);
          if (!under || reserved === null || !overlaps(reserved, top, bottom)) {
            stroke(ctx, px, top, px, bottom, foil, weight, seed + 410 + i);
            continue;
          }
          const pad = h * 0.02;
          if (reserved.y0 - pad > top + h * 0.04) {
            stroke(ctx, px, top, px, reserved.y0 - pad, foil, weight, seed + 412 + i);
          }
          if (bottom > reserved.y1 + pad + h * 0.04) {
            stroke(ctx, px, reserved.y1 + pad, px, bottom, foil, weight, seed + 414 + i);
          }
        }
        break;
      }
      case 'run': {
        const bh = Math.max(1.4, h * part.height);
        const cy = y + h * part.at;
        if (overlaps(reserved, cy - bh, cy + bh)) break;
        drawRun(ctx, part.glyph, x + w * 0.14, x + w * 0.86, cy, bh, part.count, foil, Math.max(1, w * 0.05), seed + 420);
        break;
      }
      case 'frame': {
        const weight = Math.max(1, w * part.weight);
        const pad = h * 0.045;
        let top = y + h * part.top;
        let bottom = y + h * part.bottom;
        if (part.grows && reserved !== null) {
          top = Math.min(top, reserved.y0 - pad);
          bottom = Math.max(bottom, reserved.y1 + pad);
        } else if (
          overlaps(reserved, top - weight, top + weight) ||
          overlaps(reserved, bottom - weight, bottom + weight)
        ) {
          break;
        }
        if (bottom - top < h * 0.08) break;
        for (const grow of part.double ? [0, w * 0.03] : [0]) {
          drawFrame(
            ctx,
            x + w * part.inset + grow,
            top + grow * 0.6,
            w * (1 - part.inset * 2) - grow * 2,
            bottom - top - grow * 1.2,
            part.head,
            foil,
            weight,
            seed + 430,
          );
        }
        break;
      }
      case 'plate': {
        const py = y + h * part.top;
        const ph = Math.max(3, h * part.height);
        if (overlaps(reserved, py, py + ph)) break;
        drawPlate(ctx, part.shape, x + w * part.inset, py, w * (1 - part.inset * 2), ph, part.ruled, foil, ink, seed + 440);
        break;
      }
      case 'stamp': {
        const s = Math.min(w * part.size, h * part.size * 0.16);
        let cy = y + h * part.at;
        if (overlaps(reserved, cy - s, cy + s)) {
          const moved = freeCentre();
          if (moved === null) break;
          cy = moved;
          if (overlaps(reserved, cy - s, cy + s)) break;
        }
        drawStamp(ctx, part.glyph, x + w * 0.5, cy, s, foil, Math.max(1, w * 0.055));
        break;
      }
      case 'seme': {
        const s = Math.min(w * part.size, h * part.size * 0.12);
        for (let row = 0; row < part.rows; row++) {
          const cy = y + h * (part.top + ((part.bottom - part.top) * row) / (part.rows - 1 || 1));
          if (overlaps(reserved, cy - s, cy + s)) continue;
          for (let col = 0; col < 2; col++) {
            const cxx = x + w * (row % 2 === 0 ? 0.32 + col * 0.36 : 0.5 + col * 0.36);
            if (cxx > x + w * 0.86) continue;
            drawStamp(ctx, part.glyph, cxx, cy, s, foil, Math.max(0.9, w * 0.04));
          }
        }
        break;
      }
      case 'trail': {
        const s = Math.min(w * 0.2, h * 0.026);
        const stemX = x + w * 0.5;
        const top = y + h * part.top;
        const bottom = y + h * part.bottom;
        // The gap has to clear a whole LEAF, not just the stem: a trail cut
        // flush with the lettering-piece drops half a leaf onto it.
        const gap = s + h * 0.02;
        const runs: (readonly [number, number])[] =
          reserved !== null && overlaps(reserved, top, bottom)
            ? [
                [top, reserved.y0 - gap],
                [reserved.y1 + gap, bottom],
              ]
            : [[top, bottom]];
        for (const [a, bb] of runs) {
          if (bb - a < h * 0.06) continue;
          stroke(ctx, stemX, a, stemX, bb, foil, Math.max(1, w * 0.05), seed + 450 + a);
          const leaves = Math.max(2, Math.round((part.count * (bb - a)) / (bottom - top)));
          for (let i = 0; i < leaves; i++) {
            const ly = a + ((bb - a) * (i + 0.5)) / leaves;
            const dir = i % 2 === 0 ? 1 : -1;
            if (part.glyph === 'acorn') {
              drawStamp(ctx, 'acorn', stemX + w * 0.2 * dir, ly, s * 0.8, foil, Math.max(0.9, w * 0.04));
            } else {
              ctx.save();
              ctx.translate(stemX + w * 0.18 * dir, ly);
              ctx.scale(dir, 1);
              drawStamp(ctx, 'leaf', 0, 0, s * (part.glyph === 'laurel' ? 0.8 : 0.9), foil, Math.max(0.9, w * 0.04));
              ctx.restore();
            }
          }
        }
        break;
      }
      case 'studs': {
        const s = Math.max(1.2, Math.min(w * part.size, h * part.size * 0.14));
        for (let i = 0; i < part.at.length; i++) {
          const cy = y + h * (part.at[i] as number);
          if (overlaps(reserved, cy - s, cy + s)) continue;
          const cols = part.cols === 2 ? [0.14, 0.86] : [0.5];
          for (const f of cols) {
            ctx.beginPath();
            ctx.ellipse(x + w * f, cy, s, s, 0, 0, TAU);
            ctx.fillStyle = foil;
            ctx.fill();
            if (!part.domed) continue;
            ctx.strokeStyle = FLAT.ink;
            ctx.lineWidth = Math.max(0.8, ink * 0.5);
            ctx.stroke();
            ctx.beginPath();
            ctx.ellipse(x + w * f, cy, s * 0.42, s * 0.42, 0, 0, TAU);
            ctx.strokeStyle = mix(foil, FLAT.ink, 0.4);
            ctx.stroke();
          }
        }
        break;
      }
      case 'corners': {
        const arm = Math.min(w * part.arm, h * 0.032);
        const lw = Math.max(1, w * 0.055);
        for (const [cx0, cy0, sx, sy] of [
          [x + w * 0.16, y + h * 0.05, 1, 1],
          [x + w * 0.84, y + h * 0.05, -1, 1],
          [x + w * 0.16, y + h * 0.95, 1, -1],
          [x + w * 0.84, y + h * 0.95, -1, -1],
        ] as const) {
          if (overlaps(reserved, cy0 - arm * 1.6, cy0 + arm * 1.6)) continue;
          if (part.glyph === 'shell') {
            ctx.save();
            ctx.translate(cx0, cy0);
            ctx.scale(sx, sy);
            drawStamp(ctx, 'shell', 0, 0, arm * 0.9, foil, lw);
            ctx.restore();
            continue;
          }
          stroke(ctx, cx0, cy0, cx0 + arm * sx, cy0, foil, lw, seed + 460 + cx0);
          stroke(ctx, cx0, cy0, cx0, cy0 + arm * sy * 1.4, foil, lw, seed + 470 + cy0);
        }
        break;
      }
      case 'band': {
        const bh = h * part.height;
        let top = y + h * part.at;
        if (overlaps(reserved, top, top + bh)) top = y + h * 0.04;
        if (overlaps(reserved, top, top + bh)) break;
        const fill = part.fill === 'cream' ? FLAT.cream : (clothPair(design.accent)[0] as string);
        panel(ctx, x + w * 0.06, top, w * 0.88, bh, fill, {
          radius: w * 0.16,
          seed: seed + 480,
          width: Math.max(1, ink * 0.6),
        });
        if (!part.combed) break;
        for (let i = 0; i < 3; i++) {
          const ly = top + bh * (0.28 + i * 0.22);
          stroke(ctx, x + w * 0.12, ly, x + w * 0.88, ly, FLAT.inkSoft, Math.max(1, w * 0.04), seed + 481 + i);
        }
        break;
      }
      case 'ribbon': {
        // Off centre, and started above the head so its cap is cut off by the
        // bake's own bounds — that is what makes it read as coming out of the
        // book rather than as a pill painted on the cloth.
        const rw = Math.max(2, w * 0.19);
        const rh = Math.min(h * 0.17, rw * 6);
        if (overlaps(reserved, y - rh * 0.24, y + rh * 0.76)) break;
        const colour = RIBBONS[normIndex(design.accent, RIBBONS.length)] as string;
        panel(ctx, x + w * part.at - rw / 2, y - rh * 0.24, rw, rh, colour, {
          radius: rw * 0.42,
          seed: seed + 490 + Math.floor(rand() * 4),
          width: Math.max(1, inkWidth(rw) * 0.8),
        });
        break;
      }
      default:
        break;
    }
  }
}

/** A tooled rectangle, with one of four heads. */
function drawFrame(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  head: FrameHead,
  colour: string,
  weight: number,
  seed: number,
): void {
  if (w <= 2 || h <= 2) return;
  ctx.strokeStyle = colour;
  ctx.lineWidth = weight;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (head === 'square') {
    wobbleRect(ctx, x, y, w, h, Math.min(w * 0.2, h * 0.1), seed);
    ctx.stroke();
    return;
  }
  const rise = Math.min(h * 0.34, w * 0.62);
  ctx.beginPath();
  ctx.moveTo(x, y + rise);
  if (head === 'arch') {
    ctx.quadraticCurveTo(x, y, x + w / 2, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rise);
  } else if (head === 'gothic') {
    ctx.quadraticCurveTo(x + w * 0.16, y + rise * 0.14, x + w / 2, y);
    ctx.quadraticCurveTo(x + w * 0.84, y + rise * 0.14, x + w, y + rise);
  } else {
    // Cartouche: three lobes across the head, the shape of a shield's cresting.
    ctx.quadraticCurveTo(x + w * 0.02, y, x + w * 0.28, y + rise * 0.3);
    ctx.quadraticCurveTo(x + w * 0.5, y - rise * 0.34, x + w * 0.72, y + rise * 0.3);
    ctx.quadraticCurveTo(x + w * 0.98, y, x + w, y + rise);
  }
  bowTo(ctx, x + w, y + rise, x + w, y + h, -w * 0.012);
  if (head === 'cartouche') {
    ctx.quadraticCurveTo(x + w * 0.5, y + h + h * 0.14, x, y + h);
  } else {
    bowTo(ctx, x + w, y + h, x, y + h, -w * 0.012);
  }
  bowTo(ctx, x, y + h, x, y + rise, -w * 0.012);
  ctx.closePath();
  ctx.stroke();
}

/** An applied plate: a physical thing stuck on, with its own ink outline. */
function drawPlate(
  ctx: FlatCtx,
  shape: PlateShape,
  x: number,
  y: number,
  w: number,
  h: number,
  ruled: number,
  colour: string,
  ink: number,
  seed: number,
): void {
  if (w <= 2 || h <= 2) return;
  if (shape === 'roundel') {
    const rr = Math.min(w, h) / 2;
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, rr, rr, 0, 0, TAU);
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.strokeStyle = FLAT.ink;
    ctx.lineWidth = Math.max(0.9, ink * 0.6);
    ctx.stroke();
    return;
  }
  const fill = shape === 'ticket' ? FLAT.cream : mix(FLAT.cream, colour, 0.22);
  panel(ctx, x, y, w, h, fill, {
    radius: shape === 'ticket' ? w * 0.08 : w * 0.16,
    seed,
    width: Math.max(0.9, ink * 0.7),
  });
  if (shape === 'banner') {
    // The swallow tail: a notch cut out of each end, drawn as two ink darts.
    for (const [px, dir] of [
      [x, 1],
      [x + w, -1],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(px, y);
      ctx.lineTo(px + w * 0.14 * dir, y + h / 2);
      ctx.lineTo(px, y + h);
      ctx.strokeStyle = FLAT.ink;
      ctx.lineWidth = Math.max(0.9, ink * 0.6);
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }
  for (let i = 0; i < ruled; i++) {
    const ry = y + h * ((i + 1) / (ruled + 1));
    stroke(ctx, x + w * 0.16, ry, x + w * (0.84 - i * 0.1), ry, FLAT.inkSoft, Math.max(0.8, w * 0.06), seed + i);
  }
}

/* ========================================================================== *
 *                     stage 3b — the studio's own marks                      *
 * ========================================================================== */

/** Head and tail margins the cords never cross, as fractions of the height. */
const CORD_SPAN = { top: 0.1, bottom: 0.92 } as const;

/**
 * How much taller the lettering compartment is than its neighbours.
 *
 * Not decoration — it is how a corded spine is actually laid out, and the
 * reason `RIB_STATIONS` has an enlarged second compartment too. Cut five equal
 * slices instead and the book comes out a ladder with no rung tall enough to
 * carry its own title, which is exactly what the first pass did.
 */
const TITLE_COMPARTMENT_WEIGHT = 2.1;

/**
 * Where `n` sewn cords sit, as fractions of the spine height.
 *
 * A binder divides the spine into `n + 1` compartments and the cords land on
 * the divisions between them — never flush with head or tail, which would read
 * as the book having been cut off rather than sewn. The compartment the label
 * wants (`labelAt`) is given roughly twice the room of its neighbours.
 */
export function cordStations(n: number, labelAt = 0.24): readonly number[] {
  const count = clamp(Math.round(n), 0, 5);
  if (count === 0) return [];
  const cells = count + 1;
  const span = CORD_SPAN.bottom - CORD_SPAN.top;
  // Which cell an equal cut would have put the label in — good enough to pick
  // the one to enlarge, and it keeps the answer a pure function of (n, labelAt).
  const home = clamp(Math.floor(((labelAt - CORD_SPAN.top) / span) * cells), 0, cells - 1);
  const weights: number[] = [];
  let total = 0;
  for (let i = 0; i < cells; i += 1) {
    const wt = i === home ? TITLE_COMPARTMENT_WEIGHT : 1;
    weights.push(wt);
    total += wt;
  }
  const out: number[] = [];
  let run = 0;
  for (let i = 0; i < count; i += 1) {
    run += weights[i] as number;
    out.push(CORD_SPAN.top + (run / total) * span);
  }
  return out;
}

/**
 * The raised cords the studio's "raised cords" slider asks for.
 *
 * A cord is a physical thing, not a rule: it stands proud of the spine, so it
 * gets the flat language's answer for "in front" — its own body in the darker
 * board tone with the one ink outline round it — and the foil, when there is
 * any, goes on as two thin rules riding its shoulders, which is where a binder
 * actually strikes them.
 */
function drawRaisedCords(
  ctx: FlatCtx,
  d: DesignBox,
  design: BookDesign,
  reserved: Reserved | null,
): void {
  if (design.bands <= 0) return;
  const { x, y, w, h } = d;
  // Under about seven px the cord, its outline and its two rules add up to more
  // ink than cloth and the spine turns into a ladder of grey.
  if (w < 7) return;
  const [, board] = surfaceAt(design, 0.5);
  const cordH = Math.max(2, Math.min(h * 0.022, w * 0.42));
  const foil = rubbed(design.gilt || design.bandGilt ? FLAT.gilt : FLAT.inkSoft, board, design.wear);
  const rule = Math.max(0.8, w * 0.045);

  for (const [i, t] of cordStations(design.bands, design.labelAt).entries()) {
    const cy = y + h * t;
    // The cord's whole body, and the rules riding it, must clear the reserved
    // band — a cord half under a lettering-piece reads as a printing fault.
    if (overlaps(reserved, cy - cordH * 2, cy + cordH * 2)) continue;
    panel(ctx, x + w * 0.04, cy - cordH / 2, w * 0.92, cordH, board, {
      radius: cordH * 0.5,
      seed: design.seed + 300 + i,
      width: Math.max(1, inkWidth(w) * 0.55),
    });
    if (!design.bandGilt || w < 11) continue;
    for (const off of [-cordH * 1.35, cordH * 1.35]) {
      stroke(ctx, x + w * 0.16, cy + off, x + w * 0.84, cy + off, foil, rule, design.seed + 320 + i * 2 + (off > 0 ? 1 : 0));
    }
  }
}

/**
 * The silk endbands at head and tail — the striped thread a hand-bound book
 * shows above and below its text block.
 *
 * Tiny on purpose: two or three px tall at shelf scale. They are the detail
 * that separates a bound book from a printed box, and the moment they grow past
 * a thirtieth of the spine they read as extra bands instead.
 */
function drawEndbands(ctx: FlatCtx, d: DesignBox, design: BookDesign, reserved: Reserved | null): void {
  const style = design.headTail;
  if (style === null) return;
  const { x, y, w, h } = d;
  if (w < 8) return;
  const [accent] = fadedPair(clothPair(design.accent), design.wear);
  // A real endband is a couple of millimetres of thread and would vanish at
  // shelf scale; this is the smallest that still reads as striped rather than
  // as a scratch. Inset from the very edge, because many of the shapes narrow
  // at the head and a band flush with the tip hangs off the silhouette.
  const band = Math.max(3, Math.min(h * 0.026, w * 0.42));
  const bx = x + w * 0.16;
  const bw = w * 0.68;

  for (const [end, by] of [
    [0, y + h * 0.035],
    [1, y + h * 0.965 - band],
  ] as const) {
    if (overlaps(reserved, by, by + band)) continue;
    const seed = design.seed + 400 + end * 7;
    switch (style) {
      case 1: {
        // Chevron: a zigzag of the accent over cream, the classic two-colour
        // sewn endband. Four peaks is the most that survives at this width.
        panel(ctx, bx, by, bw, band, FLAT.cream, {
          radius: band * 0.4,
          seed,
          width: Math.max(0.8, inkWidth(w) * 0.4),
        });
        ctx.beginPath();
        const peaks = 4;
        for (let i = 0; i <= peaks * 2; i += 1) {
          const px = bx + (bw * i) / (peaks * 2);
          const py = by + (i % 2 === 0 ? band * 0.82 : band * 0.18);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = accent;
        ctx.lineWidth = Math.max(0.8, band * 0.34);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        break;
      }
      case 2: {
        // Cord: one wrapped rope, so it reads as a single object rather than as
        // a stripe. Cream body, accent whipping every third of its length.
        panel(ctx, bx, by, bw, band, FLAT.cream, {
          radius: band * 0.5,
          seed,
          width: Math.max(0.8, inkWidth(w) * 0.4),
        });
        for (let i = 1; i < 4; i += 1) {
          const sx = bx + (bw * i) / 4;
          stroke(ctx, sx, by + band * 0.05, sx - band * 0.5, by + band * 0.95, accent, Math.max(0.8, band * 0.3), seed + i);
        }
        break;
      }
      default: {
        // Blocks: alternating cream and accent, the commonest machine endband.
        const cells = 5;
        for (let i = 0; i < cells; i += 1) {
          fillBandOutlined(ctx, bx + (bw * i) / cells, by, bw / cells, band, i % 2 === 0 ? FLAT.cream : accent, seed + i);
        }
        break;
      }
    }
  }
}

/** One endband cell: filled, and outlined only once round the whole run. */
function fillBandOutlined(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: string,
  seed: number,
): void {
  wobbleRect(ctx, x, y, w, h, h * 0.22, seed);
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.strokeStyle = FLAT.ink;
  ctx.lineWidth = Math.max(0.7, h * 0.16);
  ctx.stroke();
}

/**
 * Where the lettering-piece goes — THE one answer, for both callers.
 *
 * `spines.ts` sets a real title at the hi-res LOD and this module draws a ruled
 * placeholder at the lo one, and the two must land on exactly the same
 * rectangle: a book whose label jumps when the LOD flips is worse than a book
 * with no label at all. So the caller asks here rather than recomputing.
 *
 * `runLen` is how much room the lettering needs *along* the spine. A real spine
 * label is cut to its title, so the plate grows about its own centre inside the
 * free compartment rather than truncating the words — which is the difference
 * between "The Long Winter" and "The Long…".
 */
export function bookLabelBox(d: DesignBox, design: BookDesign, runLen = 0): DesignBox {
  const { x, y, w, h } = d;
  const lw = w * (LABEL_SPAN.right - LABEL_SPAN.left);
  const span = freeSpan(design);
  const room = (span.bottom - span.top) * h;
  // The resting height, then as much of the compartment as the run asks for.
  const rest = Math.min(h * 0.24, lw * 2.4, room);
  const lh = clamp(runLen, rest, Math.max(rest, room));
  const cy = clamp(y + h * design.labelAt + rest / 2, y + h * span.top, y + h * span.bottom);
  const ly = clamp(cy - lh / 2, y + h * span.top, y + h * span.bottom - lh);
  return { x: x + w * LABEL_SPAN.left, y: ly, w: lw, h: lh };
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
    stroke(ctx, lx + lw * 0.2, ry, lx + lw * (0.8 - i * 0.12), ry, FLAT.inkSoft, Math.max(0.9, lw * 0.07), design.seed + i);
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
   * cross it is skipped, and a growable panel frames it instead.
   */
  reserved?: { y0: number; y1: number; x0?: number; x1?: number } | null;
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
  /** The drawn body inside the footprint — narrower for many of the shapes. */
  body: DesignBox;
  /** The surface tooling and the label sit on (the case, for a boxed book). */
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
 * adds the shape, material and ornament axes on top. The title, the ornament
 * stamp and the charm ribbon stay the caller's, which is why this returns the
 * free compartment rather than filling it.
 *
 * `x, y, w, h` is the FOOTPRINT: the slot the shelf composer gave this book.
 * Many shapes stand narrower inside it (see `shapeBoxes`), every end profile is
 * measured inward from it, and the footprint is never exceeded except by a yapp
 * lip, a scroll's knobs and a ribbon — all three of which are meant to break the
 * outline.
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
  const spec = shapeSpec(design.shape);
  const { body, decor } = shapeBoxes(spec, x, y, w, h);
  const ink = inkWidth(body.w);

  // 1. the silhouette, filled with the material and outlined once.
  ctx.save();
  traceBookShape(ctx, body, spec, design.seed);
  ctx.clip();
  paintMaterial(ctx, body, design);
  ctx.restore();
  traceBookShape(ctx, body, spec, design.seed);
  ctx.strokeStyle = FLAT.ink;
  ctx.lineWidth = ink;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // 2. the shape's separate objects — cords, caps, wire, boxes, clasps.
  drawShapeMarks(ctx, foot, body, spec, design, ink);

  // 3. tooling, on whichever surface ended up in front.
  const reserved: Reserved | null = opts.reserved ?? null;
  const wantsLabel = hasDecoration(design, 'label-plate') && fitsLabelPlate(decor);
  for (const mark of design.decorations) {
    if (mark === 'label-plate' || mark === 'plain') continue;
    drawDecoration(ctx, decor, design, decorSpec(mark), reserved);
  }

  // 3b. the studio's own marks, over the preset's tooling and under the
  // lettering-piece: cords are sewn INTO the book, a label is stuck ON it.
  drawRaisedCords(ctx, decor, design, reserved);
  drawEndbands(ctx, decor, design, reserved);

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
 * The clear stretch of the decorated surface, as fractions of it.
 *
 * Everything a design puts near the head or the tail pushes these in, so the
 * caller's title and ornament land in a compartment rather than across a band.
 * All three vocabularies declare their own claim, which is what stops this from
 * being a switch that has to be extended every time an entry is added — a new
 * ornament that forgets to claim its room simply claims none, and the gate
 * catches it by striking through the reserved band.
 */
function freeSpan(design: BookDesign): { top: number; bottom: number } {
  const shape = shapeSpec(design.shape);
  let top = Math.max(0.06, materialHeadClaim(design.material), shape.claimTop);
  let bottom = Math.min(0.94, materialFootClaim(design.material), shape.claimBottom);
  for (const mark of design.decorations) {
    const d = decorSpec(mark);
    top = Math.max(top, d.claimTop);
    bottom = Math.min(bottom, d.claimBottom);
  }
  // The studio's cords claim the compartment they bound, so the caller's title
  // lands BETWEEN two cords rather than across one. Whichever gap round the
  // label's resting place is largest wins.
  const stations = cordStations(design.bands, design.labelAt);
  if (stations.length > 0) {
    const edges = [top, ...stations.filter((t) => t > top && t < bottom), bottom];
    let bestTop = top;
    let bestBottom = bottom;
    let best = -1;
    // Clear of the cord AND of the gilt rules riding its shoulders — 0.022 for
    // the cord, another 0.015 for the rule, and a hair of air.
    const gap = 0.05;
    for (let i = 0; i < edges.length - 1; i += 1) {
      const a = (edges[i] as number) + gap;
      const b = (edges[i + 1] as number) - gap;
      // Prefer the compartment the label already wants to sit in; fall back to
      // the roomiest one so a five-cord spine still has somewhere to be titled.
      const holds = design.labelAt >= a && design.labelAt <= b ? 1 : 0;
      const score = b - a + holds;
      if (score > best) {
        best = score;
        bestTop = a;
        bestBottom = b;
      }
    }
    top = Math.max(top, bestTop);
    bottom = Math.min(bottom, bestBottom);
  }
  if (design.headTail !== null) {
    // Clear of the endband itself, which stands at 0.035 and is up to 0.026 of
    // the height tall — a title crossing one reads as a printing fault.
    top = Math.max(top, 0.08);
    bottom = Math.min(bottom, 0.92);
  }
  return { top, bottom: Math.max(bottom, top + 0.16) };
}
