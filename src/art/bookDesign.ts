/**
 * art/bookDesign.ts — the authoritative book-binding vocabulary.
 *
 * The first binding system accumulated fifty silhouettes, fifty surfaces and
 * fifty decorations. Individually plausible rows combined into rounded toys,
 * dotted wallpaper, hardware and shapes that stopped reading as books. This
 * module now draws a hard line between the renderer's diagnostic vocabulary
 * and the product vocabulary a reader is allowed to create.
 *
 * The live system has three independent axes:
 *
 *   SHAPE      three square-ended cased backs: square, tight back, French groove;
 *   MATERIAL   quiet cloth, calf, vellum, paper and split constructions whose
 *              identity comes from broad colour/turn/joint relationships;
 *   DECORATION uninterrupted rules plus authored programmes with one focal idea.
 *
 * `RESET_PRESET_ROWS` is a separately authored collection of finished books.
 * It is not a compatibility filter over the former catalogue and Surprise does
 * not generate blind cross-products.
 *
 * ## The reset is forceful
 *
 * Old rows remain below only because the one renderer still uses their table
 * shapes and tests need to identify what was retired. They have no product
 * authority. Any persisted named id or `own:` id containing one retired axis
 * normalises to `FORMAL_BOOK_PRESET_ID`; there are no appearance-preserving
 * brocade, parchment, rounded-back or text-furniture exceptions.
 *
 * The active authority is deliberately easy to audit:
 *
 *  - `ROLLABLE_SHAPES`, `ROLLABLE_MATERIALS` and `ROLLABLE_DECORATIONS` are
 *    explicit allow-lists, never tier-derived filters;
 *  - `BOOK_PRESETS` is built only from `RESET_PRESET_ROWS`;
 *  - `presetForSeed` walks only named whole books vetted inside the Surprise
 *    direction pools, never a blind cross-product of otherwise legal parts;
 *  - retired and malformed ids all resolve to one formal reset binding.
 *
 * A bizarre silhouette is a silent bug: nothing throws and the atlas bakes it
 * happily. The explicit lists make visual curation load-bearing in code.
 *
 * ## Why every axis is a TABLE and not a switch
 *
 * Dozens of anything cannot be dozens of hand-written path functions and stay
 * coherent — the tenth one drifts from the first and the fortieth is somebody
 * else's drawing. So a shape is a row of numbers read by ONE tracer (an end
 * profile at the head, another at the tail, a side profile, a corner cut, and a
 * list of separate objects); a material is a row read by ONE painter (a body
 * tone, a turned board, an optional second board covering, and one
 * grain); a decoration is a row read by ONE toolist (a band run, a frame, a
 * motif, or an applied object). That is what makes the newest entry as good
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
import { normaliseHex } from './customColour';
import { clothPair as foldCloth } from './palette';
import { clamp, mulberry32 } from './noise';
import { colourContrast } from './titleContrast';

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

/* ========================================================================== *
 *                              rank and the dice                             *
 * ========================================================================== */

/**
 * How well an entry reads AS A BOOK at the size a spine is actually drawn.
 *
 * Not a measure of how ornate it is, and not a judgement of the drawing in
 * isolation — a scroll with turned ends is a perfectly good picture of a
 * scroll. It is a judgement of the picture at 34 world px, standing in a row of
 * forty other spines, seen by somebody who did not ask for it. That is the
 * question the reader asked after opening a shelf and finding "literally pencil
 * shape or other just bizarre shapes" on it.
 *
 * The field still orders the diagnostic tables and documents the original
 * audit, but it no longer grants product access. The reset's explicit active
 * allow-lists are the only authority for the picker, stored composed ids and
 * Surprise. This distinction is intentional: tiering proved too permissive.
 *
 *  - **Order.** Every picker list is sorted by group, then by tier, then by the
 *    order the entry was written in. The good ones come first inside their
 *    family and the odd ones sink, without anybody hand-sorting an array that
 *    the next edit will quietly re-sort.
 * Every diagnostic row must still declare a tier so an added renderer primitive
 * cannot arrive without somebody recording how it fared in the old audit.
 */
export type BookTier =
  /** The ones a shelf should be built out of. First in its family. */
  | 'signature'
  /** Sound, everyday, offered freely. */
  | 'shelf'
  /** Fine but specialised, or quiet enough to be missed in the old audit. */
  | 'niche'
  /** Reads as something that is not a book. Diagnostic only. */
  | 'oddity';

/** Every tier, best first. */
export const BOOK_TIERS: readonly BookTier[] = ['signature', 'shelf', 'niche', 'oddity'];

const TIER_RANK: Readonly<Record<BookTier, number>> = {
  signature: 0,
  shelf: 1,
  niche: 2,
  oddity: 3,
};

/**
 * May a roll of the dice land here?
 *
 * Deliberately a function of the tier alone rather than a second boolean on
 * every row: two fields that must agree is two fields that will one day
 * disagree, and the one that would be wrong is the one nothing checks.
 */
export function isRollable(tier: BookTier): boolean {
  return tier !== 'oddity';
}

/** What every ranked row carries. */
interface Ranked {
  /** Which family it belongs to. Families are ordered too, strongest first. */
  group: string;
  tier: BookTier;
}

/**
 * Picker order: family, then tier, then the order it was written in.
 *
 * Derived rather than hand-sorted, and that is the whole point — a hand-sorted
 * list is one somebody re-sorts by accident while adding an entry in the middle
 * of it, and nothing fails when they do.
 */
function byRank<T extends Ranked>(rows: readonly T[], groups: readonly string[]): readonly T[] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort(
      (a, b) =>
        groups.indexOf(a.row.group) - groups.indexOf(b.row.group) ||
        TIER_RANK[a.row.tier] - TIER_RANK[b.row.tier] ||
        a.i - b.i,
    )
    .map((entry) => entry.row);
}

/** The families a silhouette can belong to, strongest first. */
export type ShapeGroup =
  | 'case'
  | 'profile'
  | 'sewn'
  | 'boxed'
  | 'fastened'
  | 'soft'
  | 'cut'
  | 'mechanical';

const SHAPE_GROUPS: readonly ShapeGroup[] = [
  'case',
  'profile',
  'sewn',
  'boxed',
  'fastened',
  'soft',
  'cut',
  'mechanical',
];

/** …a covering… */
export type MaterialGroup =
  | 'cloth'
  | 'leather'
  | 'vellum'
  | 'split'
  | 'paper'
  | 'silk'
  | 'exotic';

const MATERIAL_GROUPS: readonly MaterialGroup[] = [
  'cloth',
  'leather',
  'vellum',
  'split',
  'paper',
  'silk',
  'exotic',
];

/** …an ornament… */
export type DecorGroup =
  | 'rules'
  | 'plates'
  | 'panels'
  | 'stamps'
  | 'corners'
  | 'terminal'
  | 'scattered';

const DECOR_GROUPS: readonly DecorGroup[] = [
  'rules',
  'plates',
  'panels',
  'stamps',
  'corners',
  'terminal',
  'scattered',
];

/** …and a named binding. */
export type PresetGroup =
  | 'cloth'
  | 'leather'
  | 'halfQuarter'
  | 'buckram'
  | 'papers'
  | 'vellum'
  | 'wrappers'
  | 'profiles'
  | 'ornamented'
  | 'boxed'
  | 'sewn'
  | 'silks'
  | 'mechanical';

const PRESET_GROUPS: readonly PresetGroup[] = [
  'cloth',
  'leather',
  'halfQuarter',
  'buckram',
  'papers',
  'vellum',
  'wrappers',
  'profiles',
  'ornamented',
  'boxed',
  'sewn',
  'silks',
  'mechanical',
];

/* ========================================================================== *
 *                              the vocabularies                              *
 * ========================================================================== */

/**
 * Every silhouette id, in the order they were WRITTEN.
 *
 * This list gives the renderer its literal union and lets diagnostics name old
 * failures. It does not feed the studio. Only `ROLLABLE_SHAPES` below can reach
 * a newly accepted binding, and every other stored shape is force-normalised.
 */
const SHAPE_IDS = [
  // Case bindings: the differences are in the joint and the back.
  'square',
  'rounded',
  'tight-back',
  'double-hinge',
  'hollow-back',
  'library-shoulder',
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
export type SpineShape = (typeof SHAPE_IDS)[number];

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
 * Fifty coverings, written in families and ordered by `MATERIAL_LOOKS` below.
 */
const MATERIAL_IDS = [
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
  'sprig-paper-sides',

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
export type MaterialLook = (typeof MATERIAL_IDS)[number];

/**
 * The 58 finished tooling programmes used by the 58 non-plain reset presets.
 *
 * This list is deliberately one-to-one with the authored books rather than a
 * small bag of rules shared by dozens of rows.  A programme can reuse the
 * bindery's primitives, but its hierarchy, stations and focal idea belong to
 * one finished binding.  That is what prevents a new large catalogue from
 * collapsing back into the same four pictures in different colours.
 */
export const AUTHORED_SPINE_PROGRAM_IDS = [
  'quarto-grand-fillet',
  'oxford-double-compartment',
  'cambridge-blind-bays',
  'printers-terminal-blocks',
  'library-closed-fillet',
  'folio-five-compartment',
  'botanical-centre-panel',
  'prize-laurel-panel',
  'buckram-library-bays',
  'buckram-oxford-fillets',
  'buckram-cambridge-bands',
  'buckram-archive-folio',
  'linen-herbarium-sprig',
  'linen-printers-bands',
  'linen-scholar-bays',
  'velvet-crown-frame',
  'velvet-palmette-panel',
  'grand-crown-compartments',
  'calf-blind-double-fillet',
  'calf-oxford-bands',
  'calf-cambridge-bays',
  'calf-gilt-compartments',
  'calf-royal-crown',
  'calf-laurel-wreath',
  'russia-folio-panels',
  'russia-blind-fillet',
  'russia-crown-bay',
  'russia-scholar-bands',
  'roan-school-fillet',
  'roan-botanical-sprig',
  'roan-terminal-bays',
  'oilcloth-ledger-fillet',
  'oilcloth-terminal-bands',
  'vellum-folio-bays',
  'vellum-terminal-fleuron',
  'vellum-laurel-panel',
  'vellum-abbey-fillet',
  'parchment-quarto-bands',
  'parchment-blind-bays',
  'parchment-herbarium-sprig',
  'parchment-fleuron-panel',
  'parchment-scholar-fillet',
  'wrapper-ruled-fold',
  'wrapper-printers-imprint',
  'wrapper-botanical-sprig',
  'wrapper-archive-sewn',
  'half-calf-material-bands',
  'half-oxford-compartments',
  'half-laurel-panel',
  'quarter-calf-bands',
  'quarter-scholar-bays',
  'quarter-botanical-sprig',
  'three-quarter-corded',
  'three-quarter-folio-bays',
  'three-quarter-crown',
  'half-cloth-herbarium',
  'half-cloth-prize-laurel',
  'half-cloth-printers',
] as const;

/**
 * What is tooled onto the spine. A design carries one complete programme, or
 * the intentional plain baseline.  Historical ids remain in this registry so
 * old data can be diagnosed, but only the list above has product authority.
 */
const DECORATION_IDS = [
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
  'star-fillet-medallion',
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

  // Reset-era programmes: continuous fillets, compartments and one focal tool.
  'oxford-double-fillet',
  'cambridge-blind-compartments',
  'printers-fleuron-terminals',
  'laurel-centrepiece',
  'crown-fillet',
  'heraldic-lozenge',
  'botanical-centre-sprig',
  'prize-laurel-terminal',
  'palmette-compartment',
  'abbey-blind-rules',
  'scholar-double-rule',
  'folio-compartments',
  'ducal-corners',
  'royal-compartments',
  'architects-fillet',
  'binder-terminal-pair',
  'library-fillet',
  'botanical-corner-fillet',

  // Final spine authority: rules only, held to head/tail and joint zones.
  'single-head-rule',
  'single-tail-rule',
  'paired-head-rules',
  'paired-tail-rules',
  'terminal-rule-pair',
  'asymmetric-terminal-rules',
  'four-terminal-rules',
  'single-joint-fillet',
  'inner-joint-fillets',
  'terminal-rules-with-joints',
  'head-rules-with-joints',
  'tail-rules-with-joints',

  // Book-apocalypse authored authority: one programme per non-plain preset.
  ...AUTHORED_SPINE_PROGRAM_IDS,
] as const;
export type Decoration = (typeof DECORATION_IDS)[number];

/**
 * Where the four raised cords of a `ribbed` spine sit, as fractions of its
 * height.
 *
 * Not evenly spaced. Even spacing gives five identical compartments and the
 * book comes out looking like a ladder; a real corded spine has one enlarged
 * focal compartment. `freeSpan` hands that compartment back to the caller for
 * a single ornament.
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

/**
 * What the long edges do between the two ends.
 *
 * `pinch` and `crumple` are the same idea as `waist` and `ripple` taken far
 * enough to survive 34px. They exist as their own values rather than as bigger
 * numbers on the old two because the old two are shared: `waist` also carries
 * `hollow-back` and `long-stitch`, and `ripple` also carries `wave-head`, whose
 * differences live at their ENDS. Deepening the shared curve moved all six
 * together and separated none of them.
 */
type SideProfile =
  | 'straight'
  | 'belly'
  | 'bulge'
  | 'waist'
  | 'pinch'
  | 'ripple'
  | 'crumple'
  | 'sway'
  | 'shoulder';

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

/**
 * Two lobes, three lobes: a scalloped end, built rather than typed out.
 *
 * `valley` is the floor BETWEEN lobes, and it is the whole difference between a
 * scallop and a row of spikes. Built with the valleys at zero — which is what
 * this did — each lobe ends where the next begins, the two quadratics meet at a
 * cusp, and a "child's primer with a scalloped head" came out of the rasterizer
 * as three sharpened teeth. Holding the valleys a little proud of the corners
 * turns the cusps into notches and the teeth back into lobes.
 */
function lobes(count: number, height: number, valley: number): readonly Knot[] {
  const out: Knot[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ u: (i + 1) / count, v: valley, cu: (i + 0.5) / count, cv: height });
  }
  return out;
}

const END_PROFILES: Readonly<Record<EndProfile, EndProfileSpec>> = {
  // The house edge: a hair of outward bow and nothing else.
  flat: endProfile(0, [{ u: 1, v: 0, cu: 0.5, cv: 0.3 }]),
  /*
   * A gently swollen end — a padded board, a springback's roll.
   *
   * One quadratic across the whole edge is an ARCH, not a cushion, and once the
   * corner fillets stopped eating four fifths of the span that is exactly what
   * `cushioned`, `spring-back` and `limp` all turned into: a lozenge with a
   * soft point on it. A padded board is flat over most of its width and only
   * turns near the corners, so the crown is held from 0.22 to 0.78 and the
   * turn-down is a fifth of the edge at each side.
   */
  cushion: endProfile(0, [
    { u: 0.24, v: 0.46, cu: 0.1, cv: 0.26 },
    { u: 0.76, v: 0.46, cu: 0.5, cv: 0.56 },
    { u: 1, v: 0, cu: 0.9, cv: 0.26 },
  ]),
  /*
   * The hollow back: the spine arcs away from the text block.
   *
   * A single quadratic is a PARABOLA, and a parabola 16px tall over a 29px
   * edge has a point on it — `hollow-back` and `domed-head` were both reading
   * as leaves. The knot at the crown with both controls pulled out to the
   * sides is the same total rise taken as an arch: the shoulders climb faster
   * and the top is round.
   */
  dome: endProfile(0, [
    { u: 0.5, v: 1, cu: 0.13, cv: 1 },
    { u: 1, v: 0, cu: 0.87, cv: 1 },
  ]),
  /*
   * A rolled leather cap: flat across the crown, turned down at the sides.
   *
   * It was not flat across anything. The crown ran 0.26→0.74 with its control
   * at cv 2.15 — a third of a unit ABOVE both knots — so the middle bulged
   * while the flanks fell away from 1.55 to 0 over a quarter of the width
   * each, and what `round-cap` actually put at its foot was a shallow
   * ARROWHEAD under a pill. A pencil tip, which is the thing the reader named.
   * The crown is wider now, the control sits barely proud of it, and the turn
   * down is a fifth of the width at each side — a cap turned over a cord.
   */
  round: endProfile(0, [
    { u: 0.2, v: 1.5, cu: 0.06, cv: 1.35 },
    { u: 0.8, v: 1.5, cu: 0.5, cv: 1.62 },
    { u: 1, v: 0, cu: 0.94, cv: 1.35 },
  ]),
  /*
   * A pitched roof, TRUNCATED. Both controls sit on the ramps, so the runs are
   * straight; the flat between the two ramps is what stops it being a point.
   *
   * Taken to a single apex — which is what this was — and combined with the
   * pinched head width the shape carried, `gabled` came out of the rasterizer
   * as a sharpened pencil, and it is the first thing the reader named. A
   * reliquary lid has a ridge, not a nib.
   */
  gable: endProfile(0, [
    { u: 0.26, v: 1.7, cu: 0.13, cv: 0.85 },
    { u: 0.74, v: 1.7, cu: 0.5, cv: 1.7 },
    { u: 1, v: 0, cu: 0.87, cv: 0.85 },
  ]),
  // The same rise taken as an S — the ogee of a chapel door — and crowned flat
  // for the same reason the gable is: a point at 34px is a nib, not an arch.
  // The crown is narrower and the rise taller than the gable's, which is the
  // whole difference between the two once neither of them comes to a point.
  // A third of the width and 1.8 units up was not narrow or tall enough for
  // that to be true of `domed-head` as well, which is one arc over nearly the
  // same span: the two read as one picture. A quarter, and taller again.
  ogee: endProfile(0, [
    { u: 0.34, v: 2, cu: 0.24, cv: 0.05 },
    { u: 0.66, v: 2, cu: 0.5, cv: 2.3 },
    { u: 1, v: 0, cu: 0.76, cv: 0.05 },
  ]),
  /*
   * A thumb notch cut INTO the end — a scoop you could get a finger in, not a
   * slot you could post a letter through. At 1.7 units on a 17px depth the cut
   * was 30px into a 200px book and the silhouette read as a tuning fork.
   */
  notch: endProfile(0, [
    { u: 0.33, v: 0, cu: 0.165, cv: 0.1 },
    { u: 0.5, v: -1.05, cu: 0.42, cv: -0.95 },
    { u: 0.67, v: 0, cu: 0.58, cv: -0.95 },
    { u: 1, v: 0, cu: 0.835, cv: 0.1 },
  ]),
  // A two-tier ziggurat. Every control is a midpoint, so every run is straight.
  // The crown is wide (0.3–0.7): a narrow one reads as a chimney on a bottle.
  step: endProfile(0, [
    { u: 0.14, v: 0, cu: 0.07, cv: 0 },
    { u: 0.14, v: 1.05, cu: 0.14, cv: 0.525 },
    { u: 0.3, v: 1.05, cu: 0.22, cv: 1.05 },
    { u: 0.3, v: 2.1, cu: 0.3, cv: 1.575 },
    { u: 0.7, v: 2.1, cu: 0.5, cv: 2.1 },
    { u: 0.7, v: 1.05, cu: 0.7, cv: 1.575 },
    { u: 0.86, v: 1.05, cu: 0.78, cv: 1.05 },
    { u: 0.86, v: 0, cu: 0.86, cv: 0.525 },
    { u: 1, v: 0, cu: 0.93, cv: 0 },
  ]),
  /*
   * Battlements: three broad MERLONS and the two narrow embrasures between
   * them, cut shallow.
   *
   * That sentence was already here and the numbers under it said something
   * else. The run started and ended at v 0 with two raised teeth 0.16 wide in
   * the middle of it, so the outer "merlons" were not raised at all and what
   * the rasterizer drew was the two-pin wall plug the comment claimed to have
   * fixed — verified on `shots-now/out/shapes-detail.png` before this edit.
   *
   * A crenellation starts and ends ON a merlon, which is why `v0` is now the
   * full rise and the last knot lands there too: three teeth 0.22 wide, two
   * gaps 0.17 wide, and the corners of the spine are the outer two merlons.
   * Embrasures are held a hair proud of the shoulder (0.1) for the same reason
   * the scallops hold their valleys proud — a floor at zero puts a cusp where
   * the ink of two walls meets and the gap fills in with outline.
   */
  crenel: endProfile(1.45, [
    { u: 0.22, v: 1.45, cu: 0.11, cv: 1.45 },
    { u: 0.22, v: 0.1, cu: 0.22, cv: 0.775 },
    { u: 0.39, v: 0.1, cu: 0.305, cv: 0.1 },
    { u: 0.39, v: 1.45, cu: 0.39, cv: 0.775 },
    { u: 0.61, v: 1.45, cu: 0.5, cv: 1.45 },
    { u: 0.61, v: 0.1, cu: 0.61, cv: 0.775 },
    { u: 0.78, v: 0.1, cu: 0.695, cv: 0.1 },
    { u: 0.78, v: 1.45, cu: 0.78, cv: 0.775 },
    { u: 1, v: 1.45, cu: 0.89, cv: 1.45 },
  ]),
  /*
   * Scallops, with the valleys held PROUD of the corners.
   *
   * The lobes have to stay shallow beside how wide they are or the cusps
   * between them sharpen and the head reads as a row of teeth: three lobes over
   * a 34px spine is 11px each, so the rise has to be about half that. Deeper is
   * not more scalloped, it is more forked.
   */
  scallop2: endProfile(1.55, lobes(2, 2.45, 1.55)),
  scallop3: endProfile(1.7, lobes(3, 2.3, 1.7)),
  // One S across the end — a cover that has curled. Gentle: taken to 1.7 units
  // up and 0.7 down on a 16px depth the head came out looking torn off rather
  // than curled, and a book with a bite out of it is not a binding.
  wave: endProfile(0, [
    { u: 0.5, v: 1.55, cu: 0.24, cv: 2.15 },
    { u: 1, v: -0.55, cu: 0.76, cv: -0.1 },
  ]),
  // A single slant: high on one side, flush on the other. A CORNER cut off, not
  // a blade ground on — at 1.9 units of a 18px depth it was a scalpel.
  bevel: endProfile(1.55, [{ u: 1, v: 0, cu: 0.5, cv: 0.78 }]),
};

/** One silhouette, as numbers the tracer and the mark drawer read. */
export interface ShapeSpec {
  id: SpineShape;
  name: string;
  /** One line for the studio card. */
  blurb: string;
  /** What this silhouette feels like. At least two, so a steer can hit it. */
  tags: readonly BookTag[];
  /** Which family it is filed under. Families are ordered, strongest first. */
  group: ShapeGroup;
  /** How well it reads as a book at 34px. Decides order and the dice. */
  tier: BookTier;
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
  /** The clear compartment this shape's own furniture leaves for an ornament. */
  claimTop: number;
  claimBottom: number;
}

/** Everything except the four the caller always writes, and the two it must. */
type ShapeRest = Omit<ShapeSpec, 'id' | 'name' | 'blurb' | 'tags' | 'group' | 'tier'>;

const SHAPE_DEFAULTS: ShapeRest = {
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

/**
 * `spec` is REQUIRED and so are its `group` and `tier`, which is the point:
 * TypeScript will not let a fifty-first silhouette into the table until
 * somebody has said which family it joins and how well it reads at 34px.
 */
function shape(
  id: SpineShape,
  name: string,
  blurb: string,
  tags: readonly BookTag[],
  spec: Partial<ShapeRest> & { group: ShapeGroup; tier: BookTier },
): ShapeSpec {
  return { ...SHAPE_DEFAULTS, ...spec, id, name, blurb, tags };
}

/** Every silhouette, keyed by id. */
export const SHAPES: Readonly<Record<SpineShape, ShapeSpec>> = {
  /* ------------------------------ case bindings ------------------------------ */

  square: shape('square', 'Square', 'The ordinary case binding: near-square corners, dead upright.',
    ['plain', 'utilitarian'], { group: 'case', tier: 'signature' }),

  // An 11px fillet on a 34px spine is the same picture as a 12px chamfer, which
  // is how a rounded back came to read as bevelled boards, and generous corners
  // alone never separated it from `square` either. The ROUND is the belly, and
  // a back that is round is WIDEST IN THE MIDDLE — so it stands in at the head
  // and the foot, which is the one difference that runs the full height.
  rounded: shape('rounded', 'Rounded Back', 'The sides belly out and the corners are generous.',
    ['plain', 'antique', 'cosy'],
    { group: 'case', tier: 'signature', side: 'belly', corner: 0.4, headWidth: 0.86, tailWidth: 0.86,
      head: 'cushion', tail: 'cushion', endDepth: 0.042 }),

  'tight-back': shape('tight-back', 'Tight Back', 'Flat back with the joints creased in: crisp corners, two grooves.',
    ['formal', 'severe', 'refined'], { group: 'case', tier: 'shelf', corner: 0.06, endDepth: 0.022, marks: ['grooves'] }),

  'double-hinge': shape('double-hinge', 'French Groove', 'Two grooves at each joint, so the covers open like doors.',
    ['formal', 'refined', 'luxe'], { group: 'case', tier: 'shelf', corner: 0.06, endDepth: 0.022, marks: ['frenchGrooves'] }),

  // The side is WAISTED because the blurb already said so — "the spine arcs
  // away from the text block" — and it was drawn with straight sides, which
  // left it 164px from `chamfered` across the whole spine.
  // The domes carry the whole name, so they are cut to a tenth of the height
  // rather than to 0.072 — at the old depth the arc was fourteen pixels on a
  // 200px book and `hollow-back` read as `waisted` with a rounded top.
  'hollow-back': shape('hollow-back', 'Hollow Back', 'The spine arcs away from the text block, so head and tail dome.',
    ['antique', 'refined', 'airy'],
    { group: 'case', tier: 'shelf', head: 'dome', tail: 'dome', side: 'waist', corner: 0.1, endDepth: 0.078 }),

  // A robust library case, not a novelty cut: the shallow shoulder tells where
  // the sewn block ends, while paired joints and modest headcaps keep one
  // continuous back. This replaces soft/stick silhouettes with construction a
  // reader can still identify on a 24px shelf spine.
  'library-shoulder': shape('library-shoulder', 'Library Shoulder', 'A stout cased back with a shallow text-block shoulder and reinforced joints.',
    ['scholarly', 'utilitarian', 'formal'],
    // Keep the shoulder inside the boards. A narrowed round head plus a wider
    // applied cap made the old version a bottle/thermos when its label vanished.
    { group: 'case', tier: 'signature', headWidth: 0.97, tailWidth: 0.97,
      head: 'cushion', tail: 'cushion', endDepth: 0.012, corner: 0.1,
      marks: ['grooves'], claimTop: 0.08, claimBottom: 0.92 }),

  // A springback is a BARREL — the swell is the whole object, and the boards
  // are pulled in tight above and below it. At 0.9 either end against a 0.15
  // bulge the swing was a pixel and a half and it sat in the middle of the
  // plain-rectangle cluster; three quarters against the same bulge is a
  // sixteenth of the slot at the ends and a shape you can name from the door.
  'spring-back': shape('spring-back', 'Spring Back', 'The stationer’s swell: a back that bulges out under its own sewing.',
    ['heavy', 'utilitarian', 'antique'],
    // The joints come with it. A stationer's springback is a swollen back
    // between two square boards, and the two dark joints are what keep it clear
    // of `two-lobe`, whose spec — bulged sides, ends pulled in to about three
    // quarters, soft crowns — is otherwise the same sentence.
    // ODDITY on the second report. Everything above is true of a springback and
    // none of it survives the trip to a shelf: bulged sides pulled in to three
    // quarters at both ends, rounded off, is a CIGAR, and on a thin roll it is
    // the fat pencil the reader named the first time. Two of them turned up in
    // one thirty-book shelf and both were the first thing the eye went to.
    { group: 'case', tier: 'oddity', side: 'bulge', head: 'cushion', tail: 'cushion', headWidth: 0.74, tailWidth: 0.74,
      corner: 0.36, endDepth: 0.05, marks: ['grooves'] }),

  // A padded board swells at BOTH ends; a rounded back only bellies. With the
  // same belly and near-identical corner the two were 190px apart and read as
  // one shape, so this takes the swelling all the way.
  cushioned: shape('cushioned', 'Cushioned', 'Padded boards: every edge swollen, nothing sharp anywhere.',
    ['cosy', 'luxe', 'devotional'],
    { group: 'case', tier: 'shelf', head: 'cushion', tail: 'cushion', side: 'bulge', headWidth: 0.82, tailWidth: 0.82,
      endDepth: 0.06, corner: 0.62 }),

  ledger: shape('ledger', 'Ledger', 'Square shoulders and a strap across the tail. Built to be written in.',
    ['utilitarian', 'heavy', 'sober'],
    // Its blurb said "square shoulders" and it had none — a plain rectangle
    // 282px from `tight-back`, which also wears grooves. Now the shoulder is in
    // the silhouette where the name always claimed it was.
    { group: 'case', tier: 'shelf', side: 'shoulder', headWidth: 0.88, shoulderAt: 0.17, corner: 0.04, endDepth: 0.022,
      marks: ['grooves', 'ledgerStrap'], claimBottom: 0.74 }),

  /* -------------------------------- cut heads -------------------------------- */

  /*
   * The cut-head family — dome, gable, ogee, notch, step, crenel, wave,
   * scallop, bevel — all differ ONLY in the top of the spine, and they shipped
   * with cuts 5 to 9 px deep on a 200px book. Nine shapes that were nameable
   * and not distinguishable: `domed-head` alone sat within 360px of six others.
   *
   * Two changes, both applied across the whole family. The cuts are twice as
   * deep, so the profile is a shape rather than a nick. And each carries its
   * own `headWidth`, so the difference runs the FULL height instead of living
   * in the top twelfth — which is the only way a head profile can be told apart
   * in a row of spines at 34px wide.
   */
  // The arc is the entry, so it is a NINTH of the book and the body under it is
  // pulled in a little: at 0.075 deep and 0.96 wide the dome was a rounded
  // corner on a full-width rectangle and it read as one of the five plain
  // backs at every coarseness a reader meets a shelf at.
  'domed-head': shape('domed-head', 'Domed Head', 'One arc over the head, and a flat foot to stand on.',
    ['refined', 'antique'],
    // …and a taper up the WHOLE height rather than a taller and taller arch.
    // At 0.115 deep the dome was 23px on a 200px book and what stood on the
    // shelf was a bullet — the reader's word for that family is "pencil", and
    // winning a signature count by growing one is not winning. The arc is back
    // to a ninth, and what holds it clear of `ogee-head` at every coarseness is
    // that the foot is full width and the head is not: "a flat foot to stand
    // on" was already in the blurb.
    { group: 'cut', tier: 'signature', head: 'dome', headWidth: 0.84, tailWidth: 1, corner: 0.14,
      endDepth: 0.088, decorTop: 0.1 }),

  'round-cap': shape('round-cap', 'Rolled Caps', 'Leather turned over a cord at head and tail, and rolled round.',
    ['luxe', 'antique', 'refined'],
    // The roll is an inset seam in the leather, not a knob wider than the book.
    { group: 'cut', tier: 'signature', head: 'cushion', tail: 'cushion',
      headWidth: 0.97, tailWidth: 0.97, endDepth: 0.014, corner: 0.12,
      marks: ['headcaps'], claimTop: 0.09, claimBottom: 0.91 }),

  gabled: shape('gabled', 'Gabled', 'A pitched roof over the head, as on a reliquary.',
    ['ornate', 'devotional', 'antique'],
    // Was headWidth 0.66 under a pointed gable, which is a pencil however you
    // colour it. The ridge is the shape; the body underneath it is a book.
    { group: 'cut', tier: 'shelf', head: 'gable', headWidth: 0.8, endDepth: 0.05, corner: 0.07, decorTop: 0.095 }),

  'ogee-head': shape('ogee-head', 'Ogee Head', 'The S-curve of a chapel door, crowned flat.',
    ['ornate', 'devotional', 'fancy'],
    { group: 'cut', tier: 'niche', head: 'ogee', headWidth: 1, endDepth: 0.055, corner: 0.07, decorTop: 0.14 }),

  'notched-head': shape('notched-head', 'Notched Head', 'A thumb notch cut into the head, for pulling it off the shelf.',
    ['utilitarian', 'modern', 'plain'],
    { group: 'cut', tier: 'niche', head: 'notch', side: 'shoulder', headWidth: 0.87, shoulderAt: 0.14,
      endDepth: 0.055, corner: 0.1, decorTop: 0.09 }),

  'stepped-head': shape('stepped-head', 'Stepped Head', 'A two-tier ziggurat, cut square with a saw.',
    ['modern', 'goofy', 'formal'],
    { group: 'cut', tier: 'niche', head: 'step', headWidth: 0.7, endDepth: 0.045, corner: 0.04, decorTop: 0.08 }),

  crenellated: shape('crenellated', 'Crenellated', 'Battlements: three teeth and the embrasures between them.',
    ['goofy', 'ornate', 'whimsical'],
    { group: 'cut', tier: 'oddity', head: 'crenel', headWidth: 0.9, endDepth: 0.032, corner: 0.04, decorTop: 0.06 }),

  'wave-head': shape('wave-head', 'Wave Head', 'One S across the head, as though the cover had curled.',
    ['whimsical', 'handmade', 'battered'],
    // ODDITY on the second report, and the only one of the nine cut heads that
    // went. A rippling side under a peaked head is a CRAYON — it was the one
    // shape in this family still nameable as another object at the 80% the app
    // opens on, where the notch, the step and the bevel are simply invisible.
    // Those three stay: a demotion has to be paid for out of a budget (the
    // table may not send more than a fifth of itself to the bottom), and
    // spending it on cuts nobody can see would have been the cruelty the brief
    // warns against.
    { group: 'cut', tier: 'oddity', head: 'wave', side: 'ripple', headWidth: 1, endDepth: 0.045, corner: 0.1, decorTop: 0.06 }),

  // The scallops are shallow by necessity (see `lobes`), so each of these
  // carries a width of its own as well — the same trick the rest of the
  // cut-head family uses, and the only way a 6px lobe is still findable in a
  // row of forty other spines.
  'scalloped-head': shape('scalloped-head', 'Scalloped Head', 'The head cut into three soft lobes, as on a child’s primer.',
    ['whimsical', 'goofy', 'cosy'],
    { group: 'cut', tier: 'niche', head: 'scallop3', headWidth: 0.86, endDepth: 0.08, corner: 0.14, decorTop: 0.085 }),

  'scalloped-tail': shape('scalloped-tail', 'Scalloped Tail', 'Three lobes at the foot, so it stands like a valance.',
    ['whimsical', 'fancy', 'cosy'],
    { group: 'cut', tier: 'niche', tail: 'scallop3', tailWidth: 0.86, endDepth: 0.08, corner: 0.14, decorBottom: 0.085 }),

  /* ---------------------------- changing widths ----------------------------- */

  'tapered-head': shape('tapered-head', 'Tapered Head', 'The head is pinched in and flares out to full width below it.',
    ['refined', 'antique', 'fancy'],
    { group: 'profile', tier: 'signature', headWidth: 0.66, side: 'shoulder', shoulderAt: 0.13, decorTop: 0.05, decorInset: 0.03 }),

  splayed: shape('splayed', 'Splayed', 'A wedge: narrow at the head, full width where it stands.',
    ['handmade', 'battered', 'rustic'], { group: 'profile', tier: 'shelf', headWidth: 0.78, corner: 0.12, decorInset: 0.06 }),

  'tapered-tail': shape('tapered-tail', 'Tapered Tail', 'The reverse wedge — broad at the head, drawn in at the foot.',
    ['handmade', 'whimsical', 'battered'], { group: 'profile', tier: 'shelf', tailWidth: 0.78, corner: 0.12, decorInset: 0.06 }),

  'flared-tail': shape('flared-tail', 'Flared Foot', 'A plinth at the very bottom, as if the book had a base.',
    ['formal', 'ornate', 'heavy'],
    { group: 'profile', tier: 'shelf', headWidth: 0.86, side: 'shoulder', shoulderAt: 0.86, corner: 0.1, decorInset: 0.04 }),

  shoulder: shape('shoulder', 'Shouldered', 'A raised head panel steps out to the full width a third of the way down.',
    ['formal', 'modern', 'refined'],
    { group: 'profile', tier: 'shelf', headWidth: 0.8, side: 'shoulder', shoulderAt: 0.3, corner: 0.12, decorInset: 0.05 }),

  // `pinch`, not `waist`: sharing the waist with `hollow-back` is what made the
  // two of them one picture, and the difference between them was supposed to be
  // that one of them is domed at both ends.
  waisted: shape('waisted', 'Waisted', 'Pinched in at the middle, the way a book read to death goes.',
    ['battered', 'handmade', 'cosy'], { group: 'profile', tier: 'shelf', side: 'pinch', corner: 0.2, decorInset: 0.05 }),

  chamfered: shape('chamfered', 'Bevelled Boards', 'All four corners cut off at a slant, never rounded.',
    // 0.52 of the width, cut on all four corners, is not a bevelled board — it
    // is a hexagonal pencil. A third is the cut a binder actually takes, and it
    // still reads as chamfered beside a square one because the cut is straight.
    // Planed all round, so the case stands a little inside the block as well as
    // being cut at the corners. Cutting harder was the other way to keep it
    // clear of a plain square, and it took the silhouette back to a hexagonal
    // pencil — this says the same thing without the point.
    // Full width, though. The cut corners ARE the shape; standing it in at 0.89
    // as well made it one more narrow soft-ended book and it read as
    // `long-stitch`, `pamphlet-thin`, `two-lobe` and `spring-back` in turn.
    ['formal', 'severe', 'luxe'],
    { group: 'profile', tier: 'signature', corner: 0.42, bevelCorner: true, endDepth: 0.026, headWidth: 0.96, tailWidth: 0.96 }),

  'bevel-head': shape('bevel-head', 'Bevelled Head', 'One long slant across the head — a book cut on the skew.',
    ['modern', 'goofy', 'whimsical'],
    { group: 'profile', tier: 'niche', head: 'bevel', headWidth: 0.92, endDepth: 0.05, corner: 0.08, decorTop: 0.075 }),

  /* ------------------------------ soft and limp ----------------------------- */

  // No boards means no boards: a limp cover is the thickness of the block and
  // the hide round it, so it stands narrower than every cased book beside it.
  // That, and the deeper sway, are what took it out of the five-way plain-back
  // cluster it was sitting in at full width.
  limp: shape('limp', 'Limp Binding', 'No boards at all: the whole spine leans and sways.',
    ['handmade', 'antique', 'devotional'],
    { group: 'soft', tier: 'signature', side: 'sway', head: 'cushion', tail: 'cushion', headWidth: 0.86,
      tailWidth: 0.89, corner: 0.34, endDepth: 0.055 }),

  // Its own `crumple` rather than the shared `ripple`, which it was reading as
  // `wave-head` under — the closest pair in the whole table at 534px, two
  // shapes whose only difference was a cut at one end of one of them.
  creased: shape('creased', 'Creased', 'Three soft creases down a cover that has been rolled in a pocket.',
    ['battered', 'pocket', 'rustic'], { group: 'soft', tier: 'shelf', side: 'crumple', corner: 0.2 }),

  'two-lobe': shape('two-lobe', 'Twin Lobes', 'Two soft humps at each end: a fat pill of a book.',
    ['goofy', 'whimsical', 'cosy'],
    // "A fat pill" is a proportion, not just two bumps — pinched at both ends
    // and swollen in the middle, which is also what keeps it clear of the
    // bevelled boards, the only other shape rounded off at both ends.
    { group: 'soft', tier: 'oddity', head: 'scallop2', tail: 'scallop2', side: 'bulge', headWidth: 0.62, tailWidth: 0.62,
      endDepth: 0.075, corner: 0.2 }),

  rolled: shape('rolled', 'Scroll', 'Barely a book: a roll with a turned knob at each end.',
    ['antique', 'whimsical', 'handmade'],
    // A straight roll, not a rolled CAP: with `round` at both ends the body
    // pinched to half its width where the knob sits and the crown poked through
    // the middle of it, which is a spindle, not a scroll.
    // …and rolled thin, which is the other half of being a scroll and the half
    // that keeps it clear of `yapp`.
    { group: 'soft', tier: 'oddity', head: 'cushion', tail: 'cushion', endDepth: 0.022, inset: 0.26, corner: 0.45,
      marks: ['knobs'], claimTop: 0.14, claimBottom: 0.86 }),

  /* --------------------------- sewing you can see --------------------------- */

  ribbed: shape('ribbed', 'Raised Cords', 'Sewn on raised cords: four flat pills stand proud across the spine.',
    ['formal', 'luxe', 'antique'],
    { group: 'sewn', tier: 'signature', inset: 0.015, marks: ['cords'], claimTop: 0.32, claimBottom: 0.58 }),

  /*
   * The five insets — 0.13, 0.10, 0.10, 0.09, 0.06 — were the whole cluster.
   * `pamphlet-thin`, `saddle-stapled`, `exposed-cords`, `coptic` and
   * `spiral-wire` all stood the same width, all carried thread-coloured marks
   * a pixel or two thick, and at four cells across a forty-pixel window they
   * were one narrow rectangle five times over: `coptic` and `saddle-stapled`
   * collided at four of the five coarsenesses measured.
   *
   * They are spread across the whole range now — 0.02 to 0.23 — and each one's
   * inset is the one its own name argues for. A book whose sewing is exposed
   * has no covering to stand inside; a stitched sliver is a sliver.
   */
  'exposed-cords': shape('exposed-cords', 'Exposed Cords', 'The cords never got covered — five bare ropes and the thread between them.',
    ['handmade', 'rustic', 'natural'],
    // ODDITY on the second report. Five bare cords laid across a pale narrow
    // spine is a BANDAGED STICK — a roll of gauze, a splint — and the fact that
    // the drawing is a correct picture of an uncovered sewing is exactly the
    // trap: it is a good drawing of a thing that is not a book.
    { group: 'sewn', tier: 'oddity', inset: 0.035, corner: 0.1, marks: ['bareCords'], claimTop: 0.47, claimBottom: 0.7 }),

  coptic: shape('coptic', 'Coptic Sewing', 'A chain of link stitches runs the length of a bare spine.',
    // ODDITY on the second report. At 30px a chain of link stitches is a row of
    // big pale ovals down the whole spine, and what that reads as is a ZIP or a
    // bicycle chain. Three of them landed on one dice shelf and every one was
    // read as hardware before it was read as a book.
    ['handmade', 'natural', 'antique'], { group: 'sewn', tier: 'oddity', inset: 0.055, corner: 0.08, marks: ['chainStitch'] }),

  'japanese-stab': shape('japanese-stab', 'Stab Sewn', 'Four knots down one side, and the thread that ties them.',
    ['handmade', 'refined', 'natural'], { group: 'sewn', tier: 'shelf', corner: 0.06, marks: ['stabKnots'] }),

  'long-stitch': shape('long-stitch', 'Long Stitch', 'Three runs of stitching straight through a limp cover.',
    ['handmade', 'rustic', 'natural'],
    // A LIMP cover, sewn through: it has no boards to hold it straight, so it
    // sags in the middle and the sewing pulls the ends in. Drawn upright with
    // faint stitch marks it was 270px from a plain square — the closest pair
    // left — and "limp" was a word in the blurb rather than a thing you could
    // see.
    // …and narrower than a cased book for the same reason `limp` is: there is a
    // cover and sewing here and nothing else. At 0.9 it was reading as the
    // bevelled boards, which is the other shape rounded off at both ends.
    { group: 'sewn', tier: 'shelf', head: 'cushion', tail: 'cushion', side: 'waist', headWidth: 0.95, tailWidth: 0.95,
      endDepth: 0.05, corner: 0.24, marks: ['longStitch'] }),

  'sewn-sections': shape('sewn-sections', 'Unbound Sections', 'No cover: five folded gatherings and their sewing.',
    ['handmade', 'plain', 'natural'], { group: 'sewn', tier: 'niche', inset: 0.015, corner: 0.06, marks: ['sections'] }),

  'pamphlet-thin': shape('pamphlet-thin', 'Pamphlet', 'A stitched sliver, squared off, with a folded edge.',
    ['plain', 'pocket', 'utilitarian'], { group: 'sewn', tier: 'shelf', inset: 0.27, corner: 0.1, endDepth: 0.02, marks: ['stitchLine'] }),

  /* ---------------------------- mechanical binding -------------------------- */

  'spiral-wire': shape('spiral-wire', 'Spiral Wire', 'A wire coil threaded through the whole spine.',
    ['modern', 'utilitarian', 'plain'], // The block stands INSIDE the wire, which is the only silhouette in the
    // table with ground biting into its sides. Filling the slot and laying fat
    // grey bars across it made the whole spine one solid mass, and it read as
    // `rounded`, `chamfered` and `waisted` — three shapes with nothing on them.
    // ODDITY on the second report. A coil is grey rungs the full height of the
    // spine at even spacing, and on a shelf that is not a notebook, it is a
    // STEP-LADDER — it was the loudest thing on a thirty-book dice shelf and it
    // came up twice in the same thirty.
    { group: 'mechanical', tier: 'oddity', inset: 0.11, corner: 0.06, marks: ['coil'] }),

  'comb-bound': shape('comb-bound', 'Comb Bound', 'A plastic comb, nine teeth of it, gripping the edge.',
    ['modern', 'utilitarian', 'goofy'], { group: 'mechanical', tier: 'oddity', inset: 0.04, corner: 0.04, marks: ['comb'] }),

  'ring-binder': shape('ring-binder', 'Ring Binder', 'Three rings and a rigid back that will not bend.',
    ['modern', 'utilitarian', 'heavy'],
    // ODDITY on the second report. Two big open rings on the fore edge is an
    // office ring binder and reads as one from across the room — which is the
    // whole of what "mechanical bindings are office supplies with a book's
    // proportions" was already saying about this family. The family is now
    // entirely un-rolled, and that is the honest end of that sentence.
    { group: 'mechanical', tier: 'oddity', corner: 0.05, marks: ['rings'], claimTop: 0.58, claimBottom: 0.72 }),

  // Two staples and nothing else is not much to be told apart by, so the shape
  // has to do it: a stapled pamphlet has no back at all and FLOPS, which is
  // why it leans like a limp binding and rounds off at the corners while
  // `pamphlet-thin`, the other stitched sliver, stays crisp and square.
  'saddle-stapled': shape('saddle-stapled', 'Saddle Stapled', 'Two wire staples through the fold, and nothing else.',
    ['plain', 'utilitarian', 'pocket'],
    { group: 'mechanical', tier: 'shelf', inset: 0.14, side: 'sway', corner: 0.34, marks: ['staples'],
      claimTop: 0.32, claimBottom: 0.7 }),

  /* ----------------------------- boxed and wrapped -------------------------- */

  slipcased: shape('slipcased', 'Slipcased', 'Standing in a slipcase, with only its head showing above the board.',
    ['formal', 'luxe', 'refined'],
    { group: 'boxed', tier: 'signature', inset: 0.11, dropBottom: 0.02, marks: ['slipcase'], onCase: true, caseTop: 0.14, claimTop: 0.08 }),

  clamshell: shape('clamshell', 'Clamshell Box', 'A drop-back box: a lid line at the head and a lip down the fore edge.',
    ['formal', 'luxe', 'severe'],
    { group: 'boxed', tier: 'signature', inset: 0.05, dropBottom: 0.02, marks: ['clamshell'], onCase: true, caseTop: 0.06, claimTop: 0.2 }),

  'boxed-set': shape('boxed-set', 'Boxed Set', 'Two heads above one case: the second volume is in there too.',
    ['formal', 'luxe', 'cosy'],
    { group: 'boxed', tier: 'shelf', inset: 0.14, marks: ['boxedSet'], onCase: true, caseTop: 0.2, claimTop: 0.26 }),

  portfolio: shape('portfolio', 'Portfolio', 'A flap folds across from the left and fastens with a stud.',
    ['utilitarian', 'formal', 'antique'],
    { group: 'boxed', tier: 'shelf', inset: 0.02, corner: 0.035, marks: ['flange'], decorInset: 0.12 }),

  wallet: shape('wallet', 'Wallet Edge', 'An envelope flap over the foot, with a tongue to tuck in.',
    ['pocket', 'cosy', 'handmade'],
    { group: 'boxed', tier: 'shelf', corner: 0.18, marks: ['walletFlap'], claimBottom: 0.68 }),

  /* --------------------------------- fastened -------------------------------- */

  // The overhang is the point, so the block stands well inside its covers —
  // and that is also what separates it from `rolled`, the other shape that is
  // a narrow body with a cap at each end. It was 0.07 in and the two of them
  // were one picture.
  yapp: shape('yapp', 'Yapp Edges', 'The covers overhang the block at head and tail.',
    ['devotional', 'cosy', 'antique'],
    // A yapp is a soft cover extending a LITTLE beyond the text block. The
    // earlier 11.5% side inset made its full-width lips into the caps of an
    // I-beam; keep the back nearly full-width and let a small rounded extension
    // at head/tail do the naming.
    { group: 'fastened', tier: 'shelf', inset: 0.045, dropTop: 0.02, dropBottom: 0.02, corner: 0.2, marks: ['yappLips'] }),

  /*
   * The plain-rectangle group — square, clasped, chained, chamfered, ledger,
   * tab-index — all had the identical body and differed only by small marks
   * drawn on it. `clasped` sat 218px from `square` across the whole spine, the
   * closest pair in the table.
   *
   * Each now carries a proportion its own name already claimed. `square` is
   * left alone deliberately: it is the plain case binding, and the baseline the
   * others are read against.
   */
  clasped: shape('clasped', 'Clasped', 'Two metal clasps hold it shut, and mean it.',
    ['antique', 'devotional', 'heavy'],
    // A book that needs clasps is one whose text block is trying to spring
    // open, and the swell between them is the reason they are there.
    { group: 'fastened', tier: 'signature', side: 'belly', corner: 0.08, marks: ['clasps'], claimTop: 0.34, claimBottom: 0.66 }),

  chained: shape('chained', 'Chained', 'A ring and a link at the foot: this one does not leave the room.',
    ['antique', 'severe', 'scholarly'],
    // It hangs. A chained book took its weight on the ring at its foot, and the
    // lean says so at a size where the chain link itself is four pixels.
    { group: 'fastened', tier: 'niche', side: 'sway', corner: 0.06, marks: ['chainLink'], claimBottom: 0.78 }),

  'tab-index': shape('tab-index', 'Thumb Index', 'A cut card tab standing at the fore edge, halfway down.',
    ['utilitarian', 'scholarly', 'modern'],
    { group: 'fastened', tier: 'shelf', corner: 0.12, marks: ['tab'], claimTop: 0.06, claimBottom: 0.36 }),
};

/**
 * Every silhouette id in PICKER order: family, then tier, then declaration.
 *
 * Derived, never written down. The studio grid, the specimen board and the
 * sweep in `tests/book-bindings.test.ts` all read this, so a shape demoted to
 * `oddity` sinks to the end of its family everywhere at once.
 */
export const SPINE_SHAPES: readonly SpineShape[] = byRank(
  SHAPE_IDS.map((id) => SHAPES[id]),
  SHAPE_GROUPS,
).map((s) => s.id);

/**
 * The silhouettes a reader may build a NEW binding from.
 *
 * This is intentionally much smaller than the archival fifty above. Tiering
 * alone proved too generous: it kept office stationery, display boxes and
 * novelty head cuts out of the dice, but still put forty very different
 * objects in the "spine shape" picker. At shelf size a reader should not need
 * the name under a tile to decide whether it is a book.
 *
 * The kept set is intentionally literal: a straight head and tail, continuous
 * upright sides, and at most joint grooves inside that rectangular book back.
 * Rounded, capped, cut, swollen and mechanical outlines remain in `SHAPES` so
 * old data can be diagnosed, but accepted stored ids normalise onto this set.
 */
export const ROLLABLE_SHAPES: readonly SpineShape[] = [
  'square',
  'tight-back',
  'double-hinge',
] as const;

const ACTIVE_SHAPE_SET: ReadonlySet<string> = new Set(ROLLABLE_SHAPES);

/** Silhouettes retained only so old stored ids can be diagnosed. */
export const RETIRED_SPINE_SHAPES: readonly SpineShape[] = SPINE_SHAPES.filter(
  (id) => !ACTIVE_SHAPE_SET.has(id),
);

/** Look up a silhouette; unknown ids give the plain case rather than a throw. */
export function shapeSpec(id: unknown): ShapeSpec {
  return SHAPES[(typeof id === 'string' ? id : '') as SpineShape] ?? SHAPES.square;
}

/** Display names for the studio's shape picker. */
export const SHAPE_LABELS: Readonly<Record<SpineShape, string>> = Object.freeze(
  Object.fromEntries(SPINE_SHAPES.map((id) => [id, SHAPES[id].name])) as Record<SpineShape, string>,
);

/* ========================================================================== *
 *                        the materials, as a table                           *
 * ========================================================================== */

/**
 * Which of the book's own colours the body is painted in.
 *
 * A covering is not a hue — the book already has one, from `CLOTHS` — it is a
 * RELATIONSHIP to that hue. Buckram is the same book in its own darker value;
 * a wrapper is the same book washed most of the way to paper; vellum throws the
 * pigment away almost entirely, which is exactly why a vellum quarto jumps out
 * of a row of coloured cloth.
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
  /**
   * Three naps, not one.
   *
   * Felt, velvet and suede all used to be `nap`, and one drawing in three
   * colours is not three coverings — on the specimen board the felt and the
   * suede were the same set of vertical strokes and the reader had no way to
   * tell which was which. They are different surfaces and they are told apart
   * by different marks: felt is CUT (a soft band with a tufted edge), velvet
   * is PILE (two steps of it down the fore edge, crushed across), suede is
   * BRUSHED (short strokes at every angle, which is what flesh side out is).
   */
  | 'napEdge'
  | 'pile'
  | 'brushed'
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
  | 'sprigs'
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

/**
 * Broad construction cue used after the covering is laid.
 *
 * This is intentionally not another grain.  Each value describes a real edge,
 * fold, shoulder or turned face and is drawn in two or three large flat shapes
 * that survive a 30px shelf spine.  No value emits a repeated field.
 */
type MaterialConstruction =
  | 'cloth-case'
  | 'buckram-case'
  | 'linen-case'
  | 'felt-case'
  | 'velvet-case'
  | 'calf-back'
  | 'morocco-back'
  | 'russia-back'
  | 'roan-back'
  | 'oilcloth-back'
  | 'vellum-laced'
  | 'parchment-fold'
  | 'alum-tawed-laced'
  | 'wrapper-fold'
  | 'half-leather'
  | 'quarter-leather'
  | 'three-quarter-leather'
  | 'half-cloth'
  | 'tips-leather';

/** One covering, as numbers the ONE painter reads. */
export interface MaterialSpec {
  id: MaterialLook;
  name: string;
  blurb: string;
  tags: readonly BookTag[];
  group: MaterialGroup;
  tier: BookTier;
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
  /** One broad, material-specific binding construction. Never a texture. */
  construction: MaterialConstruction;
  /** Below this spine width the grain is dropped whole. */
  floor: number;
}

type MaterialRest = Omit<MaterialSpec, 'id' | 'name' | 'blurb' | 'tags' | 'group' | 'tier'>;

const MATERIAL_DEFAULTS: MaterialRest = {
  body: 'cloth',
  turn: 0.26,
  farTurn: 0,
  split: 'none',
  grain: 'none',
  grainTone: 'dark',
  grainCount: 8,
  joints: 0,
  construction: 'cloth-case',
  floor: 11,
};

function material(
  id: MaterialLook,
  name: string,
  blurb: string,
  tags: readonly BookTag[],
  spec: Partial<MaterialRest> & { group: MaterialGroup; tier: BookTier },
): MaterialSpec {
  return { ...MATERIAL_DEFAULTS, ...spec, id, name, blurb, tags };
}

/** Every covering, keyed by id. */
export const MATERIALS: Readonly<Record<MaterialLook, MaterialSpec>> = {
  /* ------------------------------ cloth and weave ---------------------------- */

  'smooth-cloth': material('smooth-cloth', 'Smooth Cloth', 'Publisher’s cloth: one even face, one turned board, nothing else.',
    ['plain', 'sober', 'utilitarian'], { group: 'cloth', tier: 'signature', construction: 'cloth-case' }),

  'ribbed-cloth': material('ribbed-cloth', 'Rep Cloth', 'A fine archival rep weave, retained for older bindings.',
    ['plain', 'formal', 'antique'], { group: 'cloth', tier: 'signature', grain: 'ribs', grainCount: 8, floor: 8 }),

  buckram: material('buckram', 'Library Buckram', 'A deep, quiet library cloth identified by its broad turn and one firm joint.',
    ['utilitarian', 'severe', 'scholarly'], {
      group: 'cloth', tier: 'signature', body: 'deep', turn: 0.32, farTurn: 0.08, joints: 1, grain: 'none', construction: 'buckram-case',
    }),

  linen: material('linen', 'Book Linen', 'A pale woven covering expressed by a narrow turn and one joint, never an all-over weave tile.',
    ['plain', 'natural', 'handmade'], {
      group: 'cloth', tier: 'shelf', body: 'pale', turn: 0.18, farTurn: 0.06, joints: 1, grain: 'none', construction: 'linen-case',
    }),

  canvas: material('canvas', 'Canvas Duck', 'Heavy cotton duck, laid in a close diagonal twill.',
    ['utilitarian', 'rustic', 'heavy'], { group: 'cloth', tier: 'shelf', body: 'pale', turn: 0.22, grain: 'twill', grainCount: 9 }),

  sailcloth: material('sailcloth', 'Sailcloth', 'One bolt of canvas with a restrained pair of sewn joint seams.',
    ['utilitarian', 'handmade', 'rustic'], { group: 'cloth', tier: 'niche', body: 'pale', turn: 0.12, grain: 'stitchRun', grainCount: 5 }),

  hessian: material('hessian', 'Hessian', 'Sackcloth: six coarse slubs and not a smooth inch anywhere.',
    ['rustic', 'natural', 'battered'], { group: 'cloth', tier: 'shelf', turn: 0.18, grain: 'coarse', grainCount: 6 }),

  tweed: material('tweed', 'Tweed', 'Flecked through with the second cloth, like a coat off a hook.',
    ['cosy', 'rustic', 'natural'], { group: 'cloth', tier: 'shelf', turn: 0.24, grain: 'fleck', grainTone: 'accent', grainCount: 16 }),

  felt: material('felt', 'Felt', 'Thick and soft: a modest turned edge with a few cut tufts.',
    ['cosy', 'handmade', 'plain'], { group: 'cloth', tier: 'shelf', turn: 0.3, farTurn: 0.1, grain: 'none', grainCount: 0, construction: 'felt-case' }),

  velvet: material('velvet', 'Velvet', 'A deep, even face identified by colour and a broad turned edge, without painted pile specks.',
    ['luxe', 'ornate', 'cosy'], { group: 'cloth', tier: 'shelf', body: 'deep', turn: 0.24, farTurn: 0.1, grain: 'none', construction: 'velvet-case' }),

  /* ------------------------------- figured silks ----------------------------- */

  'silk-moire': material('silk-moire', 'Watered Silk', 'A restrained watered figure, retained for older bindings.',
    ['luxe', 'refined', 'fancy'], { group: 'silk', tier: 'niche', turn: 0.2, grain: 'watered', grainTone: 'dark', grainCount: 3 }),

  brocade: material('brocade', 'Brocade', 'Small woven leaf figures repeat quietly in the silk ground.',
    ['ornate', 'luxe', 'fancy'], { group: 'silk', tier: 'shelf', turn: 0.22, grain: 'figured', grainTone: 'pale', grainCount: 5 }),

  damask: material('damask', 'Damask', 'Reversed weave: leaf shapes that are the same silk facing the other way.',
    ['ornate', 'refined', 'formal'], { group: 'silk', tier: 'shelf', turn: 0.22, grain: 'damask', grainTone: 'pale', grainCount: 5 }),

  /* ---------------------------------- leather -------------------------------- */

  'morocco-grain': material('morocco-grain', 'Morocco Goatskin', 'Supple goatskin rounded over a broad back with two pared shoulders; no imitation pebble field.',
    ['luxe', 'formal', 'antique'], {
      group: 'leather', tier: 'signature', turn: 0.22, farTurn: 0.14, grain: 'none', joints: 0, construction: 'morocco-back',
    }),

  'polished-calf': material('polished-calf', 'Polished Calf', 'Smooth calf with paired joint fillets; no painted highlight or false shine.',
    ['refined', 'formal', 'luxe'], { group: 'leather', tier: 'signature', turn: 0.2, farTurn: 0.14, joints: 2, construction: 'calf-back' }),

  'russia-calf': material('russia-calf', 'Russia Calf', 'Birch-tarred and dark, with the two joints creased hard in.',
    ['antique', 'sober', 'scholarly'], { group: 'leather', tier: 'shelf', body: 'deep', turn: 0.25, farTurn: 0.15, joints: 2, construction: 'russia-back' }),

  'tree-calf': material('tree-calf', 'Tree Calf', 'The acid-drawn tree: a trunk up the spine and four branches off it.',
    ['antique', 'ornate', 'refined'], { group: 'leather', tier: 'shelf', turn: 0.2, farTurn: 0.1, grain: 'flame', grainTone: 'deeper', grainCount: 4 }),

  'sprinkled-calf': material('sprinkled-calf', 'Sprinkled Calf', 'Flicked over with dark stain from a brush, and left where it fell.',
    ['antique', 'refined', 'scholarly'], { group: 'leather', tier: 'shelf', body: 'pale', turn: 0.2, farTurn: 0.1, grain: 'sprinkle', grainTone: 'deeper', grainCount: 26 }),

  'mottled-calf': material('mottled-calf', 'Mottled Calf', 'Bigger, softer blots than sprinkling — the hide came out cloudy.',
    ['antique', 'battered', 'handmade'], { group: 'leather', tier: 'niche', turn: 0.2, farTurn: 0.1, grain: 'mottle', grainTone: 'deeper', grainCount: 7 }),

  roan: material('roan', 'Roan', 'Cheap sheepskin standing in for morocco, with one honest joint line.',
    ['plain', 'utilitarian', 'antique'], { group: 'leather', tier: 'shelf', turn: 0.29, farTurn: 0.05, joints: 1, construction: 'roan-back' }),

  skiver: material('skiver', 'Skiver', 'Split so thin it takes the board’s own colour; pricked all over.',
    ['plain', 'pocket', 'battered'], { group: 'leather', tier: 'niche', body: 'pale', turn: 0.16, grain: 'pinDot', grainTone: 'deeper', grainCount: 14 }),

  suede: material('suede', 'Suede', 'Flesh side out: a wide soft board, and the nap brushed every way at once.',
    ['cosy', 'handmade', 'natural'], { group: 'leather', tier: 'shelf', turn: 0.32, grain: 'brushed', grainTone: 'deeper', grainCount: 4 }),

  shagreen: material('shagreen', 'Shagreen', 'Rayskin: a ring of pale pearls round one still centre.',
    ['luxe', 'fancy', 'modern'], { group: 'exotic', tier: 'niche', turn: 0.18, farTurn: 0.12, grain: 'shagreen', grainTone: 'pale', grainCount: 9 }),

  snakeskin: material('snakeskin', 'Snakeskin', 'Overlapping scales in courses down the whole spine.',
    ['fancy', 'ornate', 'goofy'], { group: 'exotic', tier: 'niche', turn: 0.18, grain: 'scales', grainTone: 'deeper', grainCount: 9 }),

  crocodile: material('crocodile', 'Crocodile', 'Squared plates, staggered row by row, each one an object of its own.',
    ['luxe', 'heavy', 'fancy'], { group: 'exotic', tier: 'niche', body: 'deep', turn: 0.2, farTurn: 0.12, grain: 'plates', grainTone: 'pale', grainCount: 15 }),

  pigskin: material('pigskin', 'Pigskin', 'Bristle holes in threes, all over a pale unstained hide.',
    ['antique', 'scholarly', 'heavy'], { group: 'leather', tier: 'shelf', body: 'pale', turn: 0.24, grain: 'pinDot', grainTone: 'ink', grainCount: 21 }),

  oilcloth: material('oilcloth', 'Oilcloth', 'Waxed dark cloth with one firm joint and an otherwise quiet face.',
    ['utilitarian', 'battered', 'pocket'], { group: 'leather', tier: 'shelf', body: 'deep', turn: 0.21, farTurn: 0.08, joints: 1, construction: 'oilcloth-back' }),

  /* ---------------------------- vellum and parchment ------------------------- */

  vellum: material('vellum', 'Vellum', 'Cream whatever the book’s pigment is — the colour lives on the label.',
    ['antique', 'devotional', 'refined'], { group: 'vellum', tier: 'signature', body: 'cream', turn: 0.22, farTurn: 0.08, joints: 1, construction: 'vellum-laced' }),

  parchment: material('parchment', 'Parchment', 'Older and warmer than vellum, kept as one quiet warm face with a turned joint.',
    ['antique', 'handmade', 'battered'], { group: 'vellum', tier: 'shelf', body: 'parchment', turn: 0.2, farTurn: 0.06, grain: 'none', joints: 1, construction: 'parchment-fold' }),

  'alum-tawed': material('alum-tawed', 'Alum-Tawed Pigskin', 'Pale tawed hide laced to oak boards with two broad structural returns, never a field of bristle dots.',
    ['devotional', 'antique', 'severe'], {
      group: 'vellum', tier: 'shelf', body: 'cream', turn: 0.16, farTurn: 0.09, grain: 'none', joints: 1, construction: 'alum-tawed-laced',
    }),

  /* ----------------------------- decorated papers ---------------------------- */

  'marbled-paper': material('marbled-paper', 'Marbled Paper', 'Four combed veins pulled the length of the sheet.',
    ['fancy', 'antique', 'handmade'], { group: 'paper', tier: 'signature', turn: 0.24, grain: 'combedVeins', grainTone: 'accent', grainCount: 4 }),

  'spanish-marble': material('spanish-marble', 'Spanish Marble', 'The bath rocked as the sheet went on: paired zigzags all the way down.',
    ['fancy', 'ornate', 'handmade'], { group: 'paper', tier: 'shelf', turn: 0.22, grain: 'spanishWave', grainTone: 'accent', grainCount: 7 }),

  'stone-marble': material('stone-marble', 'Stone Marble', 'Sparse branching veins over an otherwise still ground.',
    ['antique', 'sober', 'handmade'], { group: 'paper', tier: 'niche', turn: 0.24, grain: 'stoneVein', grainTone: 'ink', grainCount: 5 }),

  'shell-marble': material('shell-marble', 'Shell Marble', 'Rings of colour with a pale eye in each, where the oil broke the drop.',
    ['fancy', 'refined', 'antique'], { group: 'paper', tier: 'shelf', turn: 0.22, grain: 'shellSpots', grainTone: 'accent', grainCount: 8 }),

  'paste-paper': material('paste-paper', 'Paste Paper', 'Coloured paste dragged with a comb, in five soft waves.',
    ['handmade', 'cosy', 'whimsical'], { group: 'paper', tier: 'shelf', turn: 0.2, grain: 'pasteComb', grainTone: 'pale', grainCount: 5 }),

  'patterned-paper': material('patterned-paper', 'Patterned Paper', 'A diaper of small lozenges, offset row by row.',
    ['plain', 'cosy', 'whimsical'], { group: 'paper', tier: 'signature', turn: 0.24, grain: 'lozenges', grainTone: 'pale', grainCount: 10 }),

  'block-print': material('block-print', 'Block-Printed Paper', 'One carved floret, inked and struck over and over slightly out of true.',
    ['handmade', 'ornate', 'cosy'], { group: 'paper', tier: 'shelf', turn: 0.22, grain: 'floret', grainTone: 'accent', grainCount: 7 }),

  'washi-print': material('washi-print', 'Washi', 'Long mulberry fibres lying at every angle in a cream sheet.',
    ['natural', 'handmade', 'airy'], { group: 'paper', tier: 'shelf', body: 'cream', turn: 0.18, grain: 'fibres', grainTone: 'deeper', grainCount: 14 }),

  'japanese-paper': material('japanese-paper', 'Laid Paper', 'Fine chain lines from the mould, evenly down the whole height.',
    ['plain', 'refined', 'airy'], { group: 'paper', tier: 'shelf', body: 'pale', turn: 0.18, grain: 'laidLines', grainTone: 'dark', grainCount: 5 }),

  'dutch-gilt': material('dutch-gilt', 'Dutch Gilt Paper', 'Embossed and gilded in a close grid — the cheapest way to look rich.',
    ['gilt', 'ornate', 'fancy'], { group: 'paper', tier: 'shelf', turn: 0.22, grain: 'giltDots', grainTone: 'foil', grainCount: 9 }),

  'stripe-paper': material('stripe-paper', 'Striped Paper', 'Three broad stripes running the height, two colours between them.',
    ['whimsical', 'modern', 'plain'], { group: 'paper', tier: 'shelf', turn: 0, grain: 'stripes', grainTone: 'accent', grainCount: 3 }),

  'chequer-paper': material('chequer-paper', 'Chequered Paper', 'A two-colour chequer, big enough to count across a room.',
    ['goofy', 'whimsical', 'modern'], { group: 'paper', tier: 'oddity', turn: 0, grain: 'chequer', grainTone: 'accent', grainCount: 9 }),

  'paper-wrapper': material('paper-wrapper', 'Paper Wrapper', 'One quiet pale sheet folded round with no turned board or printed terminal lines.',
    ['plain', 'pocket', 'utilitarian'], { group: 'paper', tier: 'signature', body: 'pale', turn: 0.08, farTurn: 0.05, grain: 'none', construction: 'wrapper-fold' }),

  newsprint: material('newsprint', 'Newsprint', 'Grey stock ruled into columns, already going brown at the edges.',
    ['utilitarian', 'battered', 'pocket'], { group: 'paper', tier: 'niche', body: 'pale', turn: 0, grain: 'newsRules', grainTone: 'dark', grainCount: 14 }),

  /* -------------------------- two coverings, one book ------------------------ */

  'half-bound': material('half-bound', 'Half Bound', 'A leather back and corners frame paper-covered boards.',
    ['formal', 'refined', 'antique'], { group: 'split', tier: 'signature', turn: 0.27, farTurn: 0.12, split: 'half', joints: 2, construction: 'half-leather' }),

  'quarter-bound': material('quarter-bound', 'Quarter Bound', 'A narrow leather or cloth back meets paper-covered boards.',
    ['formal', 'plain', 'antique'], { group: 'split', tier: 'signature', turn: 0.19, farTurn: 0.06, split: 'quarter', joints: 1, construction: 'quarter-leather' }),

  'three-quarter': material('three-quarter', 'Three-Quarter Bound', 'A leather back and broad corners leave a restrained paper side.',
    ['luxe', 'formal', 'ornate'], { group: 'split', tier: 'shelf', turn: 0.34, farTurn: 0.15, split: 'threeQuarter', joints: 2, construction: 'three-quarter-leather' }),

  'half-cloth-paper': material('half-cloth-paper', 'Half Cloth over Paper', 'A cloth back and corners hold quiet unpatterned paper sides.',
    ['plain', 'cosy', 'handmade'], { group: 'split', tier: 'shelf', turn: 0.24, farTurn: 0.08, split: 'half', grain: 'none', joints: 1, construction: 'half-cloth' }),

  // Alfred Launder-style construction translated into the flat vocabulary:
  // a continuous natural cloth back and restrained printed-paper sides. The
  // tiny sprig is a block-printed mark, never a photographic texture.
  'sprig-paper-sides': material('sprig-paper-sides', 'Linen & Sprig Paper', 'Natural cloth at the back, small block-printed sprigs on the paper sides.',
    ['refined', 'handmade', 'natural'], { group: 'split', tier: 'signature', body: 'pale', turn: 0.22, split: 'half', grain: 'sprigs', grainTone: 'accent', grainCount: 6, joints: 1 }),

  'tips-and-bands': material('tips-and-bands', 'Tips & Bands', 'A leather back and small leather tips protect the handled corners.',
    ['refined', 'formal', 'antique'], { group: 'split', tier: 'shelf', turn: 0.3, farTurn: 0.16, split: 'tips', joints: 2, construction: 'tips-leather' }),

  'boards-exposed': material('boards-exposed', 'Exposed Boards', 'Never covered: raw millboard, a cloth strip at the head, and old scuffs.',
    ['battered', 'plain', 'handmade'], { group: 'split', tier: 'niche', body: 'parchment', turn: 0.14, split: 'headBand', grain: 'scuffs', grainTone: 'ink', grainCount: 5 }),
};

/** Every covering id in picker order: family, then tier, then declaration. */
export const MATERIAL_LOOKS: readonly MaterialLook[] = byRank(
  MATERIAL_IDS.map((id) => MATERIALS[id]),
  MATERIAL_GROUPS,
).map((m) => m.id);

/**
 * Coverings offered for a new binding.
 *
 * This is the binding reset's authoritative covering roster. A covering earns
 * a place here only when its identity comes from construction, a broad colour
 * relationship, or a few terminal marks. Repeated weave, pebble, dot, scale,
 * diaper and novelty-paper fields stay in the diagnostic table above, but no
 * accepted picker id, stored composed id or random roll can ask for them.
 *
 * Buckram and book linen were redrawn for this roster: both now use a quiet
 * face plus a turn/joint construction cue. They are not the tiled versions the
 * old catalogue offered under those names.
 */
export const ROLLABLE_MATERIALS: readonly MaterialLook[] = [
  'smooth-cloth',
  'buckram',
  'linen',
  'felt',
  'velvet',
  'polished-calf',
  'morocco-grain',
  'russia-calf',
  'roan',
  'oilcloth',
  'vellum',
  'parchment',
  'alum-tawed',
  'paper-wrapper',
  'half-bound',
  'quarter-bound',
  'three-quarter',
  'half-cloth-paper',
] as const;

const ACTIVE_MATERIAL_SET: ReadonlySet<string> = new Set(ROLLABLE_MATERIALS);

/** Coverings retained only so old stored ids can be diagnosed. */
export const RETIRED_MATERIAL_LOOKS: readonly MaterialLook[] = MATERIAL_LOOKS.filter(
  (id) => !ACTIVE_MATERIAL_SET.has(id),
);

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

/** Large, unmistakable binder's tools; never repeated as a field. */
export type BroadFocalGlyph =
  | 'crown'
  | 'palmette'
  | 'sprig'
  | 'laurel'
  | 'shield'
  | 'fleuron'
  | 'compass'
  | 'rosette'
  | 'fleur-de-lis'
  | 'starflower'
  | 'acanthus'
  | 'sunrise'
  | 'oak-spray'
  | 'thistle'
  | 'ivy-knot'
  | 'oak-volutes'
  | 'wheat-saltire'
  | 'pomegranate'
  | 'tulip'
  | 'pinecone'
  | 'fern-palmette'
  | 'ginkgo'
  | 'acanthus-spear'
  | 'carnation'
  | 'iris-fan'
  | 'artichoke'
  | 'poppy-seedhead'
  | 'olive-spray'
  | 'strawberry-sprig'
  | 'vine-cluster'
  | 'honeysuckle-scroll'
  | 'lotus-palmette'
  | 'maple-samara'
  | 'willow-catkin'
  | 'rowan-spray'
  | 'columbine-bell'
  | 'primrose-stem'
  | 'dog-rose'
  | 'cedar-cone'
  | 'reed-bundle'
  | 'moresque-knot'
  | 'tudor-rose';

/**
 * Six real binding architectures, not six names for the same tall rectangle.
 * They all keep the book-square silhouette, but distribute the tooling in
 * recognisably different ways: closed mitres, open corner returns, stepped
 * fillets, side rails, folio ledges, or a deliberately open focal canopy.
 */
type CompartmentStyle =
  | 'mitred'
  | 'corner-return'
  | 'stepped'
  | 'rail'
  | 'folio'
  | 'canopy';

/** The physically distinct premium binding families which survived reset. */
type BindingArchetype =
  | 'terminal'
  | 'publisher-panel'
  | 'corded-leather'
  | 'ceremonial-crown'
  | 'diagonal-botanical'
  | 'laureate'
  | 'structural-sewing';

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
  /** Rules down the spine. */
  | { k: 'vrule'; at: readonly number[]; weight: number; top: number; bottom: number }
  /** A repeated motif along one band. */
  | { k: 'run'; at: number; glyph: RunGlyph; height: number; count: number }
  /** An outlined rectangle. */
  | {
      k: 'frame';
      top: number;
      bottom: number;
      inset: number;
      weight: number;
      head: FrameHead;
      double: boolean;
    }
  /** A square fillet whose transverse divisions physically meet its sides. */
  | {
      k: 'compartments';
      top: number;
      bottom: number;
      inset: number;
      weight: number;
      double: boolean;
      divisions: readonly number[];
      style: CompartmentStyle;
    }
  /** Material-bodied raised bands with optional foil rules on the shoulders. */
  | {
      k: 'bands';
      at: readonly number[];
      height: number;
      fill: 'surface' | 'accent';
      shoulders: boolean;
    }
  /** One broad, filled binder's tool in an intentionally empty bay. */
  | { k: 'focal'; at: number; glyph: BroadFocalGlyph; size: number }
  /** One complete premium spine architecture; never combined with old cages. */
  | {
      k: 'binding';
      archetype: BindingArchetype;
      variant: number;
      glyph?: BroadFocalGlyph;
    }
  /** An applied plate: a physical thing stuck on, with its own ink outline. */
  | { k: 'plate'; top: number; height: number; inset: number; shape: PlateShape; ruled: number }
  /** One motif, struck once. */
  | { k: 'stamp'; at: number; glyph: StampGlyph; size: number }
  /** The same motif scattered over the field. */
  | { k: 'seme'; glyph: StampGlyph; size: number; rows: number; top: number; bottom: number }
  /** A stem up the spine with leaves off it. */
  | { k: 'trail'; glyph: 'vine' | 'laurel' | 'acorn'; count: number; top: number; bottom: number }
  /** Metal: pins, or domed bosses. `cols` 2 makes paired edge rows. */
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
  group: DecorGroup;
  tier: BookTier;
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
  spec: Partial<Pick<DecorSpec, 'blind' | 'floor' | 'claimTop' | 'claimBottom'>> & {
    group: DecorGroup;
    tier: BookTier;
  },
): DecorSpec {
  return {
    id,
    name,
    blurb,
    tags,
    group: spec.group,
    tier: spec.tier,
    parts,
    blind: spec.blind ?? false,
    floor: spec.floor ?? 7,
    claimTop: spec.claimTop ?? 0,
    claimBottom: spec.claimBottom ?? 1,
  };
}

type AuthoredSpineProgramId = (typeof AUTHORED_SPINE_PROGRAM_IDS)[number];

type ProgrammeFrame = 0 | 1 | 2;
type ProgrammeFocal = readonly [BroadFocalGlyph, number, number];
type ProgrammeRow = readonly [
  id: AuthoredSpineProgramId,
  name: string,
  frame: ProgrammeFrame,
  divisions: readonly number[],
  bands: readonly number[],
  focal?: ProgrammeFocal,
  blind?: boolean,
];

/**
 * One row per non-plain preset.  The compact tuple keeps the authoring table
 * readable while every row still declares its own hierarchy.  Divisions are
 * deliberately non-uniform: equal little bays are the visual grammar of a
 * ladder, not of a fine binding.
 *
 * Construction references (primary museum/conservation records):
 * - Library of Congress Diderot treatment — smooth tightback calf, recessed
 *   cords, gold tooling around spine panels/onlays and tied-down endbands:
 *   https://www.loc.gov/preservation/conservators/diderot/treatment.html
 * - Met 448957 — one central motif with geometric tooling growing outward:
 *   https://www.metmuseum.org/art/collection/search/448957
 * - Met Vitruvius survey — raised-band quarter leather and complex blind-panel
 *   publisher's cloth, demonstrating structure and tooling as one hierarchy:
 *   https://www.metmuseum.org/perspectives/vitruvius
 */
const AUTHORED_PROGRAMME_ROWS: readonly ProgrammeRow[] = [
  ['quarto-grand-fillet', 'Grand Quarto Fillet', 2, [0.18, 0.72], [0.84]],
  ['oxford-double-compartment', 'Oxford Double Compartments', 2, [0.22, 0.66], [], undefined, false],
  ['cambridge-blind-bays', 'Cambridge Blind Bays', 1, [0.27, 0.7], [], undefined, true],
  ['printers-terminal-blocks', 'Printer’s Terminal Bands', 1, [], [0.16, 0.84]],
  ['library-closed-fillet', 'Library Closed Fillet', 1, [0.2, 0.79], [], undefined, true],
  ['folio-five-compartment', 'Folio Five Compartments', 1, [0.15, 0.34, 0.67, 0.85], [], undefined, false],
  ['botanical-centre-panel', 'Botanical Centre Panel', 1, [0.3, 0.7], [], ['sprig', 0.5, 0.58]],
  ['prize-laurel-panel', 'Prize Laurel Panel', 2, [0.27, 0.61], [], ['laurel', 0.78, 0.6]],

  ['buckram-library-bays', 'Buckram Library Bays', 1, [0.19, 0.76], [], undefined, true],
  ['buckram-oxford-fillets', 'Buckram Oxford Fillets', 2, [0.24, 0.72], [], undefined, false],
  ['buckram-cambridge-bands', 'Buckram Cambridge Bands', 1, [0.35, 0.74], [0.18]],
  ['buckram-archive-folio', 'Buckram Archive Folio', 1, [0.16, 0.37, 0.73, 0.87], [], undefined, true],

  ['linen-herbarium-sprig', 'Linen Herbarium Sprig', 1, [0.3, 0.72], [], ['sprig', 0.51, 0.62]],
  ['linen-printers-bands', 'Linen Printer’s Bands', 0, [], [0.17, 0.79]],
  ['linen-scholar-bays', 'Linen Scholar Bays', 1, [0.26, 0.64, 0.82], [], undefined, true],


  ['velvet-crown-frame', 'Velvet Sunrise State Binding', 2, [0.25, 0.73], [], ['sunrise', 0.49, 0.62]],
  ['velvet-palmette-panel', 'Velvet Palmette Panel', 1, [0.28, 0.72], [], ['palmette', 0.5, 0.62]],
  ['grand-crown-compartments', 'Grand Crown Binding', 2, [], [], ['crown', 0.31, 0.68]],

  ['calf-blind-double-fillet', 'Calf Blind Double Fillet', 2, [0.2, 0.75], [], undefined, true],
  ['calf-oxford-bands', 'Calf Oxford Bands', 1, [0.32, 0.7], [0.17, 0.83]],
  ['calf-cambridge-bays', 'Calf Cambridge Bays', 1, [0.25, 0.62, 0.79], [], undefined, true],
  ['calf-gilt-compartments', 'Calf Gilt Compartments', 2, [0.15, 0.36, 0.67, 0.86], [], undefined, false],
  ['calf-royal-crown', 'Royal Calf State Binding', 1, [0.23, 0.7], []],
  ['calf-laurel-wreath', 'Calf Laurel Tool', 1, [0.3, 0.67], [], ['laurel', 0.51, 0.62]],

  ['russia-folio-panels', 'Russia Folio Panels', 1, [0.14, 0.33, 0.63, 0.84], [], undefined, true],
  ['russia-blind-fillet', 'Russia Blind Fillet', 2, [0.24, 0.78], [], undefined, true],
  ['russia-crown-bay', 'Russia State Bay', 1, [0.29, 0.71], []],
  ['russia-scholar-bands', 'Russia Scholar Bands', 1, [0.37, 0.75], [0.19, 0.84], undefined, true],

  ['roan-school-fillet', 'Roan School Fillet', 1, [0.21, 0.8], [], undefined, true],
  ['roan-botanical-sprig', 'Roan Botanical Sprig', 1, [0.33, 0.73], [], ['sprig', 0.52, 0.58]],
  ['roan-terminal-bays', 'Roan Terminal Bays', 2, [0.18, 0.77], [0.86]],

  ['oilcloth-ledger-fillet', 'Oilcloth Ledger Fillet', 1, [0.17, 0.39, 0.82], [], undefined, true],
  ['oilcloth-terminal-bands', 'Oilcloth Terminal Bands', 0, [], [0.14, 0.2, 0.84]],

  ['vellum-folio-bays', 'Vellum Folio Bays', 1, [0.16, 0.35, 0.65, 0.84], [], undefined, true],
  ['vellum-terminal-fleuron', 'Vellum Terminal Fleuron', 1, [0.24, 0.71], [], ['fleuron', 0.49, 0.58]],
  ['vellum-laurel-panel', 'Vellum Laurel Tool', 2, [0.3, 0.67], [], ['laurel', 0.5, 0.6]],
  ['vellum-abbey-fillet', 'Vellum Abbey Fillet', 1, [0.22, 0.43, 0.79], [], undefined, true],

  ['parchment-quarto-bands', 'Parchment Quarto Bands', 1, [], [0.18, 0.76, 0.87], undefined, true],
  ['parchment-blind-bays', 'Parchment Blind Bays', 2, [0.26, 0.69], [], undefined, true],
  ['parchment-herbarium-sprig', 'Parchment Herbarium Sprig', 1, [0.31, 0.71], [], ['sprig', 0.51, 0.61]],
  ['parchment-fleuron-panel', 'Parchment Fleuron Panel', 2, [0.25, 0.68], [], ['fleuron', 0.49, 0.57]],
  ['parchment-scholar-fillet', 'Parchment Scholar Fillet', 1, [0.19, 0.41, 0.78], [], undefined, true],

  ['wrapper-ruled-fold', 'Wrapper Fold Fillet', 1, [0.18, 0.81], [], undefined, true],
  ['wrapper-printers-imprint', 'Wrapper Printer’s Imprint', 1, [0.28, 0.74], [], ['fleuron', 0.51, 0.52]],
  ['wrapper-botanical-sprig', 'Wrapper Botanical Sprig', 1, [0.34, 0.73], [], ['sprig', 0.52, 0.56]],
  ['wrapper-archive-sewn', 'Wrapper Archive Sewn Fillet', 2, [0.18, 0.39, 0.81], [], undefined, true],

  ['half-calf-material-bands', 'Half Calf Material Bands', 0, [], [0.15, 0.33, 0.72, 0.86]],
  ['half-oxford-compartments', 'Half Oxford Compartments', 2, [0.21, 0.65, 0.82], [], undefined, false],
  ['half-laurel-panel', 'Half Binding Oak Tool', 1, [0.29, 0.66], [], ['oak-spray', 0.51, 0.58]],

  ['quarter-calf-bands', 'Quarter Calf Bands', 0, [], [0.17, 0.38, 0.78]],
  ['quarter-scholar-bays', 'Quarter Scholar Bays', 1, [0.25, 0.6, 0.81], [], undefined, true],
  ['quarter-botanical-sprig', 'Quarter Botanical Sprig', 2, [0.32, 0.72], [], ['sprig', 0.52, 0.58]],

  ['three-quarter-corded', 'Three-Quarter Material Cords', 0, [], [0.14, 0.29, 0.59, 0.82]],
  ['three-quarter-folio-bays', 'Three-Quarter Folio Bays', 1, [0.16, 0.31, 0.62, 0.85], [], undefined, false],
  ['three-quarter-crown', 'Three-Quarter State Binding', 2, [0.25, 0.73], []],

  ['half-cloth-herbarium', 'Half Cloth Herbarium', 1, [0.31, 0.71], [], ['sprig', 0.51, 0.6]],
  ['half-cloth-prize-laurel', 'Half Cloth Prize Starflower', 2, [0.28, 0.64], [], ['starflower', 0.78, 0.56]],
  ['half-cloth-printers', 'Half Cloth Printer’s Bands', 1, [0.36, 0.76], [0.17, 0.83]],

] as const;

/**
 * The architectural decision for every finished programme. Keeping this as a
 * complete record is intentionally more verbose than deriving `index % 6`:
 * the silhouette of the tooling belongs to the named binding and survives a
 * reorder of the catalogue. The rows above own rhythm; this table owns how
 * that rhythm meets corners, rails and terminal ledges.
 */
const RETIRED_PROGRAMME_ARCHITECTURE: Readonly<
  Record<AuthoredSpineProgramId, CompartmentStyle>
> = {
  'quarto-grand-fillet': 'mitred',
  'oxford-double-compartment': 'corner-return',
  'cambridge-blind-bays': 'stepped',
  'printers-terminal-blocks': 'rail',
  'library-closed-fillet': 'rail',
  'folio-five-compartment': 'folio',
  'botanical-centre-panel': 'canopy',
  'prize-laurel-panel': 'canopy',

  'buckram-library-bays': 'rail',
  'buckram-oxford-fillets': 'corner-return',
  'buckram-cambridge-bands': 'stepped',
  'buckram-archive-folio': 'folio',
  'linen-herbarium-sprig': 'canopy',
  'linen-printers-bands': 'rail',
  'linen-scholar-bays': 'stepped',
  'velvet-crown-frame': 'canopy',
  'velvet-palmette-panel': 'canopy',
  'grand-crown-compartments': 'canopy',

  'calf-blind-double-fillet': 'mitred',
  'calf-oxford-bands': 'stepped',
  'calf-cambridge-bays': 'corner-return',
  'calf-gilt-compartments': 'folio',
  'calf-royal-crown': 'canopy',
  'calf-laurel-wreath': 'canopy',
  'russia-folio-panels': 'folio',
  'russia-blind-fillet': 'mitred',
  'russia-crown-bay': 'canopy',
  'russia-scholar-bands': 'stepped',
  'roan-school-fillet': 'rail',
  'roan-botanical-sprig': 'canopy',
  'roan-terminal-bays': 'corner-return',
  'oilcloth-ledger-fillet': 'rail',
  'oilcloth-terminal-bands': 'rail',

  'vellum-folio-bays': 'folio',
  'vellum-terminal-fleuron': 'canopy',
  'vellum-laurel-panel': 'canopy',
  'vellum-abbey-fillet': 'corner-return',
  'parchment-quarto-bands': 'stepped',
  'parchment-blind-bays': 'mitred',
  'parchment-herbarium-sprig': 'canopy',
  'parchment-fleuron-panel': 'canopy',
  'parchment-scholar-fillet': 'rail',
  'wrapper-ruled-fold': 'corner-return',
  'wrapper-printers-imprint': 'canopy',
  'wrapper-botanical-sprig': 'canopy',
  'wrapper-archive-sewn': 'stepped',

  'half-calf-material-bands': 'folio',
  'half-oxford-compartments': 'corner-return',
  'half-laurel-panel': 'canopy',
  'quarter-calf-bands': 'rail',
  'quarter-scholar-bays': 'stepped',
  'quarter-botanical-sprig': 'canopy',
  'three-quarter-corded': 'folio',
  'three-quarter-folio-bays': 'folio',
  'three-quarter-crown': 'canopy',
  'half-cloth-herbarium': 'canopy',
  'half-cloth-prize-laurel': 'canopy',
  'half-cloth-printers': 'corner-return',
};
void RETIRED_PROGRAMME_ARCHITECTURE;

interface ProgrammeArchetypeSpec {
  readonly archetype: BindingArchetype;
  readonly variant: number;
  readonly glyph?: BroadFocalGlyph;
}

/**
 * The final physical authority: 58 redrawn programmes share seven premium
 * construction families (the eighth family is the nine quiet material-only
 * baselines). Variants tune hierarchy inside a family; they never reintroduce
 * crop corners, perimeter cages, labels, hardware or symbol wallpaper.
 */
const PROGRAMME_ARCHETYPES: Readonly<
  Record<AuthoredSpineProgramId, ProgrammeArchetypeSpec>
> = {
  'library-closed-fillet': { archetype: 'terminal', variant: 0 },
  'printers-terminal-blocks': { archetype: 'terminal', variant: 1, glyph: 'fleuron' },
  'linen-printers-bands': { archetype: 'terminal', variant: 2, glyph: 'starflower' },
  'roan-school-fillet': { archetype: 'terminal', variant: 3, glyph: 'shield' },
  'oilcloth-ledger-fillet': { archetype: 'terminal', variant: 4 },
  'oilcloth-terminal-bands': { archetype: 'terminal', variant: 5, glyph: 'sunrise' },
  'half-cloth-printers': { archetype: 'terminal', variant: 6, glyph: 'rosette' },
  'buckram-library-bays': { archetype: 'terminal', variant: 7 },
  'buckram-cambridge-bands': { archetype: 'terminal', variant: 8 },

  'quarto-grand-fillet': { archetype: 'publisher-panel', variant: 0 },
  'oxford-double-compartment': { archetype: 'publisher-panel', variant: 1 },
  'cambridge-blind-bays': { archetype: 'publisher-panel', variant: 2 },
  'folio-five-compartment': { archetype: 'publisher-panel', variant: 3 },
  'linen-scholar-bays': { archetype: 'publisher-panel', variant: 4 },
  'buckram-oxford-fillets': { archetype: 'publisher-panel', variant: 5, glyph: 'acanthus' },
  'buckram-archive-folio': { archetype: 'publisher-panel', variant: 6 },

  'calf-blind-double-fillet': { archetype: 'corded-leather', variant: 0 },
  'calf-oxford-bands': { archetype: 'corded-leather', variant: 1 },
  'russia-folio-panels': { archetype: 'corded-leather', variant: 2 },
  'calf-cambridge-bays': { archetype: 'corded-leather', variant: 3 },
  'calf-gilt-compartments': { archetype: 'corded-leather', variant: 4, glyph: 'starflower' },
  'russia-blind-fillet': { archetype: 'corded-leather', variant: 5 },
  'russia-scholar-bands': { archetype: 'corded-leather', variant: 6 },
  'roan-terminal-bays': { archetype: 'corded-leather', variant: 7, glyph: 'rosette' },
  'half-calf-material-bands': { archetype: 'corded-leather', variant: 8 },
  'quarter-calf-bands': { archetype: 'corded-leather', variant: 9 },
  'three-quarter-corded': { archetype: 'corded-leather', variant: 10 },
  'half-oxford-compartments': { archetype: 'corded-leather', variant: 11, glyph: 'ivy-knot' },
  'quarter-scholar-bays': { archetype: 'corded-leather', variant: 12, glyph: 'thistle' },
  'three-quarter-folio-bays': { archetype: 'corded-leather', variant: 13 },

  'grand-crown-compartments': { archetype: 'ceremonial-crown', variant: 0, glyph: 'crown' },
  'velvet-crown-frame': { archetype: 'ceremonial-crown', variant: 1, glyph: 'sunrise' },
  'calf-royal-crown': { archetype: 'ceremonial-crown', variant: 2 },
  'russia-crown-bay': { archetype: 'ceremonial-crown', variant: 3 },
  'three-quarter-crown': { archetype: 'ceremonial-crown', variant: 4 },

  'botanical-centre-panel': { archetype: 'diagonal-botanical', variant: 0, glyph: 'oak-spray' },
  'linen-herbarium-sprig': { archetype: 'diagonal-botanical', variant: 1, glyph: 'tulip' },
  'roan-botanical-sprig': { archetype: 'diagonal-botanical', variant: 2, glyph: 'thistle' },
  'quarter-botanical-sprig': { archetype: 'diagonal-botanical', variant: 3, glyph: 'pomegranate' },
  'half-cloth-herbarium': { archetype: 'diagonal-botanical', variant: 4, glyph: 'rosette' },
  'parchment-herbarium-sprig': { archetype: 'diagonal-botanical', variant: 5, glyph: 'thistle' },
  'wrapper-botanical-sprig': { archetype: 'diagonal-botanical', variant: 6, glyph: 'ivy-knot' },

  'prize-laurel-panel': { archetype: 'laureate', variant: 0, glyph: 'laurel' },
  'velvet-palmette-panel': { archetype: 'laureate', variant: 1, glyph: 'palmette' },
  'calf-laurel-wreath': { archetype: 'laureate', variant: 2, glyph: 'laurel' },
  'half-laurel-panel': { archetype: 'laureate', variant: 3, glyph: 'oak-spray' },
  'half-cloth-prize-laurel': { archetype: 'laureate', variant: 4, glyph: 'starflower' },
  'vellum-terminal-fleuron': { archetype: 'laureate', variant: 5, glyph: 'fleuron' },
  'vellum-laurel-panel': { archetype: 'laureate', variant: 6, glyph: 'laurel' },
  'parchment-fleuron-panel': { archetype: 'laureate', variant: 7, glyph: 'fleuron' },

  'vellum-folio-bays': { archetype: 'structural-sewing', variant: 0 },
  'parchment-quarto-bands': { archetype: 'structural-sewing', variant: 1 },
  'vellum-abbey-fillet': { archetype: 'structural-sewing', variant: 2 },
  'parchment-blind-bays': { archetype: 'structural-sewing', variant: 3 },
  'parchment-scholar-fillet': { archetype: 'structural-sewing', variant: 4 },
  'wrapper-ruled-fold': { archetype: 'structural-sewing', variant: 5 },
  'wrapper-printers-imprint': { archetype: 'structural-sewing', variant: 6, glyph: 'fleuron' },
  'wrapper-archive-sewn': { archetype: 'structural-sewing', variant: 7 },
};

/** Build the table without weakening `Decoration` to an arbitrary string. */
const AUTHORED_DECORS: Readonly<Record<AuthoredSpineProgramId, DecorSpec>> =
  Object.fromEntries(
    AUTHORED_PROGRAMME_ROWS.map(([id, name, , , , , blind]) => {
      const architecture = PROGRAMME_ARCHETYPES[id];
      const parts: DecorPart[] = [{
        k: 'binding',
        archetype: architecture.archetype,
        variant: architecture.variant,
        ...(architecture.glyph === undefined ? {} : { glyph: architecture.glyph }),
      }];
      const tags: readonly BookTag[] =
        architecture.archetype === 'diagonal-botanical' ||
        architecture.archetype === 'laureate'
          ? ['natural', 'handmade', 'refined']
          : architecture.archetype === 'ceremonial-crown'
            ? ['formal', 'luxe', 'gilt']
            : blind
              ? ['sober', 'scholarly', 'antique']
              : ['formal', 'refined', 'scholarly'];
      return [
        id,
        decor(
          id,
          name,
          'One physically authored binding architecture, scaled for a true thirty-pixel shelf spine.',
          tags,
          parts,
          {
            group:
              architecture.glyph === undefined ? 'panels' : 'stamps',
            tier: 'signature',
            floor: 8,
            blind: blind ?? false,
          },
        ),
      ];
    }),
  ) as unknown as Readonly<Record<AuthoredSpineProgramId, DecorSpec>>;

/** Every ornament, keyed by id. */
export const DECORS: Readonly<Record<Decoration, DecorSpec>> = {
  plain: decor('plain', 'Plain', 'Nothing at all. Plenty of real books are like this and a shelf needs them.',
    ['plain', 'sober'], [],
    { group: 'rules', tier: 'signature' }),

  /* ------------------------------ rules and bands ---------------------------- */

  'gilt-bands': decor('gilt-bands', 'Gilt Bands', 'The house pattern, straight off the app mark: two at the head, one at the tail.',
    ['gilt', 'formal', 'refined'],
    [{ k: 'rule', at: [0.14, 0.2, 0.82], weight: 0.1, from: 0.18, to: 0.86 }],
    { group: 'rules', tier: 'signature', claimTop: 0.24, claimBottom: 0.78 }),

  'double-bands': decor('double-bands', 'Double Bands', 'A paired rule at the head and another at the tail, leaving the whole middle open.',
    ['formal', 'refined', 'gilt'],
    [{ k: 'rule', at: [0.11, 0.17, 0.83, 0.89], weight: 0.05, from: 0.16, to: 0.88 }],
    { group: 'rules', tier: 'signature', claimTop: 0.21, claimBottom: 0.79 }),

  'triple-bands': decor('triple-bands', 'Triple Bands', 'Three rules together at each end, close as a stave.',
    ['formal', 'ornate', 'gilt'],
    [{ k: 'rule', at: [0.1, 0.14, 0.18, 0.82, 0.86, 0.9], weight: 0.045, from: 0.16, to: 0.88 }],
    { group: 'rules', tier: 'shelf', claimTop: 0.24, claimBottom: 0.74 }),

  'spine-rule': decor('spine-rule', 'Spine Rules', 'Two long rules the whole height, just inside each edge.',
    ['plain', 'formal', 'sober'],
    [{ k: 'vrule', at: [0.15, 0.85], weight: 0.055, top: 0.05, bottom: 0.95 }],
    { group: 'rules', tier: 'signature', claimTop: 0.06, claimBottom: 0.94 }),

  'centre-rule': decor('centre-rule', 'Centre Rules', 'A pair of fine rules a hair either side of the middle, parting round the title.',
    ['refined', 'modern', 'sober'],
    [{ k: 'vrule', at: [0.42, 0.58], weight: 0.045, top: 0.06, bottom: 0.94 }],
    { group: 'rules', tier: 'shelf', claimTop: 0.06, claimBottom: 0.94 }),

  'edge-piping': decor('edge-piping', 'Edge Piping', 'Thick piping just inside the joints, the way a livery binding is finished.',
    ['luxe', 'formal', 'heavy'],
    // At 0.07 and 0.93 the piping sat under the outline itself and the whole
    // ornament was invisible — a decoration you cannot see is a decoration that
    // is not there. Inboard by a twentieth is all it needed.
    [{ k: 'vrule', at: [0.12, 0.88], weight: 0.08, top: 0.03, bottom: 0.97 }],
    { group: 'rules', tier: 'shelf', floor: 10 }),

  'dotted-rule': decor('dotted-rule', 'Dotted Rules', 'Rules broken into dots, struck with a pointillé wheel.',
    ['refined', 'fancy', 'gilt'],
    [{ k: 'run', at: 0.16, glyph: 'dot', height: 0.012, count: 9 },
     { k: 'run', at: 0.84, glyph: 'dot', height: 0.012, count: 9 }],
    { group: 'rules', tier: 'shelf', floor: 10, claimTop: 0.22, claimBottom: 0.8 }),

  'beaded-band': decor('beaded-band', 'Beaded Bands', 'Touching half-rounds — the astragal, run across instead of along.',
    ['refined', 'ornate', 'formal'],
    [{ k: 'run', at: 0.18, glyph: 'bead', height: 0.018, count: 7 },
     { k: 'run', at: 0.8, glyph: 'bead', height: 0.018, count: 7 }],
    { group: 'rules', tier: 'shelf', floor: 11, claimTop: 0.26, claimBottom: 0.76 }),

  'dentil-band': decor('dentil-band', 'Dentil Band', 'A course of square teeth under the head, straight off a cornice.',
    ['formal', 'ornate', 'antique'],
    [{ k: 'run', at: 0.2, glyph: 'dentil', height: 0.024, count: 6 }],
    { group: 'rules', tier: 'shelf', floor: 12, claimTop: 0.28 }),

  'zigzag-band': decor('zigzag-band', 'Zigzag Bands', 'The Norman chevron, chased across head and tail.',
    ['ornate', 'antique', 'goofy'],
    [{ k: 'run', at: 0.16, glyph: 'zigzag', height: 0.022, count: 5 },
     { k: 'run', at: 0.84, glyph: 'zigzag', height: 0.022, count: 5 }],
    { group: 'rules', tier: 'shelf', floor: 12, claimTop: 0.24, claimBottom: 0.78 }),

  'chequer-band': decor('chequer-band', 'Chequer Band', 'A single chequered course at the tail, foil and ground alternating.',
    ['goofy', 'whimsical', 'formal'],
    // 5px tall over six cells was a dashed smudge; the course has to be tall
    // enough that a cell is squarish or it stops reading as a chequer.
    [{ k: 'run', at: 0.82, glyph: 'chequer', height: 0.038, count: 5 }],
    { group: 'rules', tier: 'niche', floor: 12, claimBottom: 0.74 }),

  'rope-band': decor('rope-band', 'Rope Bands', 'A carved cable, twisted the same way at both ends.',
    ['rustic', 'ornate', 'handmade'],
    [{ k: 'run', at: 0.15, glyph: 'rope', height: 0.026, count: 4 },
     { k: 'run', at: 0.85, glyph: 'rope', height: 0.026, count: 4 }],
    { group: 'rules', tier: 'niche', floor: 12, claimTop: 0.24, claimBottom: 0.78 }),

  'chain-band': decor('chain-band', 'Chain Band', 'Interlocking links across the head — a chained book’s memory of itself.',
    ['antique', 'severe', 'ornate'],
    [{ k: 'run', at: 0.18, glyph: 'chain', height: 0.03, count: 4 }],
    { group: 'rules', tier: 'niche', floor: 13, claimTop: 0.28 }),

  'greek-key': decor('greek-key', 'Greek Key', 'The meander, folded and folded back along the foot.',
    ['formal', 'ornate', 'scholarly'],
    [{ k: 'run', at: 0.8, glyph: 'key', height: 0.032, count: 3 }],
    { group: 'rules', tier: 'niche', floor: 14, claimBottom: 0.72 }),

  'wave-scroll': decor('wave-scroll', 'Vitruvian Scroll', 'A running wave that breaks the same way every time.',
    ['ornate', 'fancy', 'formal'],
    [{ k: 'run', at: 0.17, glyph: 'scroll', height: 0.03, count: 3 }],
    { group: 'rules', tier: 'niche', floor: 14, claimTop: 0.27 }),

  'marbled-band': decor('marbled-band', 'Marbled Band', 'A strip of the endpaper laid across the spine and combed three times.',
    ['fancy', 'handmade', 'antique'],
    [{ k: 'band', at: 0.66, height: 0.12, fill: 'accent', combed: true }],
    { group: 'rules', tier: 'shelf', floor: 12, claimBottom: 0.62 }),

  /* --------------------------- applied plates and tickets -------------------- */

  'label-plate': decor('label-plate', 'Label Plate', 'The cream lettering-piece the title is set on.',
    ['plain', 'formal', 'scholarly'], [],
    { group: 'plates', tier: 'signature' }),

  'banner-plaque': decor('banner-plaque', 'Banner Plaque', 'A swallow-tailed banner near the foot, for whatever the volume is called.',
    ['ornate', 'fancy', 'whimsical'],
    [{ k: 'plate', top: 0.72, height: 0.13, inset: 0.1, shape: 'banner', ruled: 2 }],
    { group: 'plates', tier: 'niche', floor: 13, claimBottom: 0.68 }),

  'shelf-ticket': decor('shelf-ticket', 'Shelf Ticket', 'A little paper shelfmark stuck near the tail, slightly crooked.',
    ['scholarly', 'utilitarian', 'antique'],
    [{ k: 'plate', top: 0.87, height: 0.07, inset: 0.28, shape: 'ticket', ruled: 1 }],
    { group: 'plates', tier: 'shelf', floor: 11, claimBottom: 0.85 }),

  'number-roundel': decor('number-roundel', 'Volume Roundel', 'A gilt disc at the head with a rule beneath it — volume something.',
    ['gilt', 'formal', 'refined'],
    [{ k: 'plate', top: 0.06, height: 0.075, inset: 0.3, shape: 'roundel', ruled: 0 },
     { k: 'rule', at: [0.155], weight: 0.05, from: 0.2, to: 0.8 }],
    { group: 'plates', tier: 'shelf', floor: 12, claimTop: 0.2 }),

  /* ----------------------------- panels and frames --------------------------- */

  'gilt-panel': decor('gilt-panel', 'Gilt Panel', 'A tooled rectangle round the central compartment.',
    ['gilt', 'formal', 'luxe'],
    [{ k: 'frame', top: 0.3, bottom: 0.64, inset: 0.13, weight: 0.06, head: 'square', double: false }],
    { group: 'panels', tier: 'signature', floor: 12 }),

  'double-frame': decor('double-frame', 'Double Frame', 'Two rectangles, one inside the other, the whole height of the spine.',
    ['formal', 'ornate', 'severe'],
    [{ k: 'frame', top: 0.07, bottom: 0.93, inset: 0.1, weight: 0.05, head: 'square', double: true }],
    { group: 'panels', tier: 'shelf', floor: 13, claimTop: 0.12, claimBottom: 0.88 }),

  'blind-stamped-frame': decor('blind-stamped-frame', 'Blind Frame', 'Struck without foil: ink only, the sober binding’s one gesture.',
    ['sober', 'severe', 'devotional'],
    [{ k: 'frame', top: 0.045, bottom: 0.955, inset: 0.13, weight: 0.05, head: 'square', double: false }],
    { group: 'panels', tier: 'signature', blind: true, floor: 12, claimTop: 0.1, claimBottom: 0.9 }),

  'blind-panel': decor('blind-panel', 'Blind Panel', 'A tall blind rectangle round the compartment, and nothing shining anywhere.',
    ['sober', 'devotional', 'plain'],
    // Taller and WIDER than `gilt-panel`. Struck at the same 0.3–0.66 the two
    // were the same drawing in two colours, and on a dark cloth even the colour
    // did not carry — which is not a second ornament, it is one ornament listed
    // twice. Its wider rails also make the blind strike legible at shelf scale.
    [{ k: 'frame', top: 0.22, bottom: 0.74, inset: 0.075, weight: 0.05, head: 'square', double: false }],
    { group: 'panels', tier: 'shelf', blind: true, floor: 12 }),

  'arch-panel': decor('arch-panel', 'Arched Panel', 'A round-headed panel at the head, like a bay in a reading room.',
    ['ornate', 'devotional', 'formal'],
    [{ k: 'frame', top: 0.06, bottom: 0.3, inset: 0.16, weight: 0.055, head: 'arch', double: false }],
    { group: 'panels', tier: 'shelf', floor: 13, claimTop: 0.34 }),

  'gothic-panel': decor('gothic-panel', 'Gothic Panel', 'The same panel, brought to a point. A chapel door at spine scale.',
    ['ornate', 'devotional', 'severe'],
    [{ k: 'frame', top: 0.06, bottom: 0.32, inset: 0.16, weight: 0.055, head: 'gothic', double: false }],
    { group: 'panels', tier: 'shelf', floor: 13, claimTop: 0.36 }),

  cartouche: decor('cartouche', 'Cartouche', 'A lobed shield at the foot, waiting for arms it will never get.',
    ['ornate', 'fancy', 'luxe'],
    [{ k: 'frame', top: 0.62, bottom: 0.84, inset: 0.15, weight: 0.055, head: 'cartouche', double: false }],
    { group: 'panels', tier: 'shelf', floor: 13, claimBottom: 0.58 }),

  'lattice-panel': decor('lattice-panel', 'Lattice Panel', 'A framed trellis at the tail, four crossings of it.',
    ['ornate', 'refined', 'fancy'],
    [{ k: 'frame', top: 0.68, bottom: 0.92, inset: 0.14, weight: 0.05, head: 'square', double: false },
     { k: 'run', at: 0.8, glyph: 'lattice', height: 0.05, count: 4 }],
    { group: 'panels', tier: 'niche', floor: 14, claimBottom: 0.64 }),

  /* ---------------------------- corner and edge work ------------------------- */

  'corner-tooling': decor('corner-tooling', 'Corner Tooling', 'Four small brackets, one at each corner of the field.',
    ['formal', 'refined', 'gilt'],
    [{ k: 'corners', glyph: 'bracket', arm: 0.32 }],
    { group: 'corners', tier: 'signature', floor: 12, claimTop: 0.12, claimBottom: 0.88 }),

  'shell-corners': decor('shell-corners', 'Shell Corners', 'Fan shells filling the corners, as a rococo binder would.',
    ['ornate', 'fancy', 'luxe'],
    [{ k: 'corners', glyph: 'shell', arm: 0.3 }],
    { group: 'corners', tier: 'shelf', floor: 13, claimTop: 0.13, claimBottom: 0.87 }),

  'pin-studs': decor('pin-studs', 'Pin Studs', 'Brass pins down both joints, keeping the centre clear.',
    ['antique', 'heavy', 'utilitarian'],
    [{ k: 'studs', at: [0.1, 0.28, 0.5, 0.72, 0.9], size: 0.1, cols: 2, domed: false }],
    { group: 'corners', tier: 'shelf', floor: 11, claimTop: 0.06, claimBottom: 0.94 }),

  bosses: decor('bosses', 'Bosses', 'Two domed metal bosses, the sort that keep a book off a wet table.',
    ['antique', 'heavy', 'devotional'],
    [{ k: 'studs', at: [0.12, 0.88], size: 0.28, cols: 1, domed: true }],
    { group: 'corners', tier: 'shelf', floor: 13, claimTop: 0.2, claimBottom: 0.8 }),

  /* -------------------------------- single stamps ---------------------------- */

  'diamond-centre': decor('diamond-centre', 'Diamond Centre', 'One filled lozenge struck in the middle of the free compartment.',
    ['gilt', 'formal', 'refined'],
    [{ k: 'stamp', at: 0.5, glyph: 'lozenge', size: 0.3 }],
    { group: 'stamps', tier: 'signature', floor: 12 }),

  'monogram-lozenge': decor('monogram-lozenge', 'Monogram Lozenge', 'An outlined lozenge with a bar through it, where the owner’s letters go.',
    ['refined', 'formal', 'luxe'],
    [{ k: 'stamp', at: 0.5, glyph: 'monogram', size: 0.34 }],
    { group: 'stamps', tier: 'shelf', floor: 13 }),

  rosette: decor('rosette', 'Rosette', 'A little six-petalled flower, the commonest tool in any bindery.',
    ['ornate', 'fancy', 'cosy'],
    [{ k: 'stamp', at: 0.5, glyph: 'rosette', size: 0.3 }],
    { group: 'stamps', tier: 'shelf', floor: 12 }),

  'star-tooling': decor('star-tooling', 'Star Tooling', 'A five-pointed star, struck once and struck well.',
    ['gilt', 'whimsical', 'fancy'],
    [{ k: 'stamp', at: 0.5, glyph: 'star', size: 0.32 }],
    { group: 'stamps', tier: 'shelf', floor: 12 }),

  // One coherent tooling programme, based on the central medallion + fillet
  // hierarchy of Met 448957. Keeping frame and centre in one decoration stops
  // Surprise from stacking an unrelated panel, stamp and furniture system.
  'star-fillet-medallion': decor('star-fillet-medallion', 'Star & Fillet Medallion', 'A restrained double fillet enclosing one geometric star low in the field.',
    ['gilt', 'formal', 'refined'],
    [
      { k: 'frame', top: 0.1, bottom: 0.9, inset: 0.14, weight: 0.055, head: 'square', double: true },
      { k: 'stamp', at: 0.72, glyph: 'star', size: 0.3 },
    ],
    { group: 'stamps', tier: 'signature', floor: 13, claimTop: 0.12, claimBottom: 0.88 }),

  crest: decor('crest', 'Crest', 'A shield with a band across it: somebody’s arms, on somebody’s book.',
    ['luxe', 'formal', 'antique'],
    [{ k: 'stamp', at: 0.5, glyph: 'crest', size: 0.36 }],
    { group: 'stamps', tier: 'shelf', floor: 13 }),

  'crown-tooling': decor('crown-tooling', 'Crown Tooling', 'A three-pointed crown on its band — a royal binding, or pretending to be.',
    ['luxe', 'ornate', 'gilt'],
    [{ k: 'stamp', at: 0.5, glyph: 'crown', size: 0.34 }],
    { group: 'stamps', tier: 'shelf', floor: 13 }),

  /* --------------------------- scattered and trailing ------------------------ */

  'fleur-seme': decor('fleur-seme', 'Fleur Semé', 'Powdered all over with the lily, as a French royal binding is.',
    ['ornate', 'luxe', 'gilt'],
    [{ k: 'seme', glyph: 'fleur', size: 0.2, rows: 7, top: 0.08, bottom: 0.92 }],
    { group: 'scattered', tier: 'shelf', floor: 13, claimTop: 0.06, claimBottom: 0.94 }),

  'bee-diaper': decor('bee-diaper', 'Bee Diaper', 'The imperial bee, repeated in a diaper across the whole spine.',
    ['ornate', 'fancy', 'luxe'],
    [{ k: 'seme', glyph: 'bee', size: 0.22, rows: 6, top: 0.1, bottom: 0.9 }],
    { group: 'scattered', tier: 'oddity', floor: 14, claimTop: 0.06, claimBottom: 0.94 }),

  'vine-trail': decor('vine-trail', 'Vine Trail', 'A stem up the whole spine with leaves off it, alternating sides.',
    ['ornate', 'natural', 'handmade'],
    [{ k: 'trail', glyph: 'vine', count: 6, top: 0.08, bottom: 0.92 }],
    { group: 'scattered', tier: 'shelf', floor: 12, claimTop: 0.06, claimBottom: 0.94 }),

  'laurel-spray': decor('laurel-spray', 'Laurel Spray', 'A laurel at the foot, the way a prize binding signs itself.',
    ['formal', 'gilt', 'refined'],
    // Three leaves over a fifth of the height is a twig. A spray needs enough
    // of them that the eye reads the run rather than counting the parts.
    [{ k: 'trail', glyph: 'laurel', count: 5, top: 0.64, bottom: 0.94 }],
    { group: 'scattered', tier: 'shelf', floor: 12, claimBottom: 0.6 }),

  'acorn-tooling': decor('acorn-tooling', 'Acorn Tooling', 'Acorns hanging under the head, on their own little stem.',
    ['natural', 'cosy', 'rustic'],
    [{ k: 'trail', glyph: 'acorn', count: 4, top: 0.06, bottom: 0.33 }],
    { group: 'scattered', tier: 'niche', floor: 12, claimTop: 0.37 }),

  'sunburst-fan': decor('sunburst-fan', 'Sunburst Fan', 'A fan of rays at the tail, all struck from one point.',
    ['fancy', 'ornate', 'whimsical'],
    [{ k: 'stamp', at: 0.84, glyph: 'sun', size: 0.4 }],
    { group: 'scattered', tier: 'niche', floor: 13, claimBottom: 0.74 }),

  'wax-seal': decor('wax-seal', 'Wax Seal', 'A blob of sealing wax with a rim, pressed on and never taken off.',
    ['whimsical', 'antique', 'handmade'],
    [{ k: 'stamp', at: 0.74, glyph: 'seal', size: 0.34 }],
    { group: 'scattered', tier: 'niche', floor: 12, claimBottom: 0.66 }),

  /* ------------------------------ head, foot, ribbon ------------------------- */

  'head-ornament': decor('head-ornament', 'Head Ornament', 'A fleuron under the head with a rule beneath it.',
    ['refined', 'formal', 'ornate'],
    [{ k: 'stamp', at: 0.095, glyph: 'fleuron', size: 0.26 },
     { k: 'rule', at: [0.165], weight: 0.055, from: 0.2, to: 0.8 }],
    { group: 'terminal', tier: 'signature', floor: 11, claimTop: 0.23 }),

  'foot-ornament': decor('foot-ornament', 'Foot Ornament', 'The same, upside down at the tail: a small leaf and a rule.',
    ['refined', 'formal', 'ornate'],
    [{ k: 'stamp', at: 0.885, glyph: 'leaf', size: 0.24 },
     { k: 'rule', at: [0.935], weight: 0.06, from: 0.2, to: 0.8 }],
    { group: 'terminal', tier: 'signature', floor: 10, claimBottom: 0.84 }),

  'tally-rules': decor('tally-rules', 'Tally Rules', 'Five short strokes at the head, like a count kept on the binding.',
    ['utilitarian', 'plain', 'handmade'],
    [{ k: 'rule', at: [0.08, 0.12, 0.16, 0.2, 0.24], weight: 0.05, from: 0.56, to: 0.9 }],
    { group: 'terminal', tier: 'niche', floor: 10, claimTop: 0.3 }),

  'ribbon-marker': decor('ribbon-marker', 'Ribbon Marker', 'A ribbon lying out of the head, off to one side.',
    ['cosy', 'devotional', 'whimsical'],
    [{ k: 'ribbon', at: 0.3 }],
    { group: 'terminal', tier: 'shelf', floor: 10, claimTop: 0.2 }),

  /* ----------------------- reset-era binder programmes ---------------------- */

  'oxford-double-fillet': decor(
    'oxford-double-fillet',
    'Oxford Double Fillet',
    'A restrained double perimeter with a single rule at head and tail.',
    ['formal', 'scholarly', 'refined'],
    [
      { k: 'frame', top: 0.06, bottom: 0.94, inset: 0.11, weight: 0.045, head: 'square', double: true },
      { k: 'rule', at: [0.15, 0.85], weight: 0.05, from: 0.18, to: 0.82 },
    ],
    { group: 'panels', tier: 'signature', floor: 12, claimTop: 0.19, claimBottom: 0.81 },
  ),

  'cambridge-blind-compartments': decor(
    'cambridge-blind-compartments',
    'Cambridge Blind Compartments',
    'One blind perimeter divided into three generous, quiet compartments.',
    ['sober', 'scholarly', 'antique'],
    [
      { k: 'frame', top: 0.055, bottom: 0.945, inset: 0.12, weight: 0.05, head: 'square', double: false },
      { k: 'rule', at: [0.31, 0.69], weight: 0.05, from: 0.14, to: 0.86 },
    ],
    { group: 'panels', tier: 'signature', blind: true, floor: 12, claimTop: 0.34, claimBottom: 0.66 },
  ),

  'printers-fleuron-terminals': decor(
    'printers-fleuron-terminals',
    'Printer’s Fleuron Terminals',
    'A small fleuron at each end, stopped by one measured rule.',
    ['refined', 'formal', 'scholarly'],
    [
      { k: 'stamp', at: 0.09, glyph: 'fleuron', size: 0.23 },
      { k: 'stamp', at: 0.91, glyph: 'fleuron', size: 0.23 },
      { k: 'rule', at: [0.17, 0.83], weight: 0.05, from: 0.2, to: 0.8 },
    ],
    { group: 'terminal', tier: 'signature', floor: 11, claimTop: 0.21, claimBottom: 0.79 },
  ),

  'laurel-centrepiece': decor(
    'laurel-centrepiece',
    'Laurel Centre Sprig',
    'One short laurel sprig held in an open central field by two rules.',
    ['formal', 'natural', 'refined'],
    [
      { k: 'trail', glyph: 'laurel', count: 3, top: 0.4, bottom: 0.6 },
      { k: 'rule', at: [0.32, 0.68], weight: 0.05, from: 0.22, to: 0.78 },
    ],
    { group: 'stamps', tier: 'signature', floor: 12 },
  ),

  'crown-fillet': decor(
    'crown-fillet',
    'Crown & Fillet',
    'A single crown centred inside a fine double fillet.',
    ['formal', 'luxe', 'gilt'],
    [
      { k: 'frame', top: 0.07, bottom: 0.93, inset: 0.12, weight: 0.045, head: 'square', double: true },
      { k: 'stamp', at: 0.54, glyph: 'crown', size: 0.31 },
    ],
    { group: 'stamps', tier: 'signature', floor: 13, claimTop: 0.11, claimBottom: 0.89 },
  ),

  'heraldic-lozenge': decor(
    'heraldic-lozenge',
    'Heraldic Lozenge',
    'One lozenge under a short head rule, enclosed by a single fillet.',
    ['formal', 'antique', 'refined'],
    [
      { k: 'frame', top: 0.08, bottom: 0.92, inset: 0.13, weight: 0.05, head: 'square', double: false },
      { k: 'rule', at: [0.29], weight: 0.05, from: 0.2, to: 0.8 },
      { k: 'stamp', at: 0.58, glyph: 'lozenge', size: 0.29 },
    ],
    { group: 'stamps', tier: 'shelf', floor: 13, claimTop: 0.12, claimBottom: 0.88 },
  ),

  'botanical-centre-sprig': decor(
    'botanical-centre-sprig',
    'Botanical Centre Sprig',
    'One short vine sprig in the centre, never a trail or repeated field.',
    ['natural', 'handmade', 'refined'],
    [
      { k: 'trail', glyph: 'vine', count: 3, top: 0.39, bottom: 0.61 },
      { k: 'rule', at: [0.31, 0.69], weight: 0.045, from: 0.24, to: 0.76 },
    ],
    { group: 'stamps', tier: 'signature', floor: 12 },
  ),

  'prize-laurel-terminal': decor(
    'prize-laurel-terminal',
    'Prize Laurel Terminal',
    'A compact laurel at the foot, separated from the open field by one rule.',
    ['formal', 'natural', 'gilt'],
    [
      { k: 'trail', glyph: 'laurel', count: 3, top: 0.7, bottom: 0.88 },
      { k: 'rule', at: [0.63], weight: 0.055, from: 0.19, to: 0.81 },
    ],
    { group: 'terminal', tier: 'signature', floor: 12, claimBottom: 0.59 },
  ),

  'palmette-compartment': decor(
    'palmette-compartment',
    'Palmette Compartment',
    'A single fleuron in one proportioned central compartment.',
    ['formal', 'ornate', 'refined'],
    [
      { k: 'frame', top: 0.27, bottom: 0.73, inset: 0.13, weight: 0.05, head: 'square', double: false },
      { k: 'stamp', at: 0.5, glyph: 'fleuron', size: 0.29 },
    ],
    { group: 'stamps', tier: 'shelf', floor: 12 },
  ),

  'abbey-blind-rules': decor(
    'abbey-blind-rules',
    'Abbey Blind Rules',
    'A blind perimeter with one quiet division near each terminal.',
    ['devotional', 'sober', 'antique'],
    [
      { k: 'frame', top: 0.055, bottom: 0.945, inset: 0.14, weight: 0.055, head: 'square', double: false },
      { k: 'rule', at: [0.23, 0.77], weight: 0.055, from: 0.16, to: 0.84 },
    ],
    { group: 'panels', tier: 'signature', blind: true, floor: 12, claimTop: 0.27, claimBottom: 0.73 },
  ),

  'scholar-double-rule': decor(
    'scholar-double-rule',
    'Scholar’s Double Rule',
    'Paired joint rules joined by one rule at head and tail.',
    ['scholarly', 'formal', 'sober'],
    [
      { k: 'vrule', at: [0.16, 0.84], weight: 0.05, top: 0.06, bottom: 0.94 },
      { k: 'rule', at: [0.16, 0.84], weight: 0.05, from: 0.16, to: 0.84 },
    ],
    { group: 'rules', tier: 'signature', floor: 11, claimTop: 0.2, claimBottom: 0.8 },
  ),

  'folio-compartments': decor(
    'folio-compartments',
    'Folio Compartments',
    'Four broad horizontal divisions and two quiet joint rules.',
    ['formal', 'scholarly', 'heavy'],
    [
      { k: 'rule', at: [0.16, 0.34, 0.66, 0.84], weight: 0.055, from: 0.16, to: 0.84 },
      { k: 'vrule', at: [0.15, 0.85], weight: 0.045, top: 0.08, bottom: 0.92 },
    ],
    { group: 'rules', tier: 'signature', floor: 12, claimTop: 0.38, claimBottom: 0.62 },
  ),

  'ducal-corners': decor(
    'ducal-corners',
    'Ducal Corners',
    'Four bracket tools lead to one small crown in the centre.',
    ['luxe', 'formal', 'gilt'],
    [
      { k: 'corners', glyph: 'bracket', arm: 0.28 },
      { k: 'stamp', at: 0.52, glyph: 'crown', size: 0.28 },
    ],
    { group: 'corners', tier: 'shelf', floor: 13, claimTop: 0.12, claimBottom: 0.88 },
  ),

  'royal-compartments': decor(
    'royal-compartments',
    'Royal Compartments',
    'Measured terminal compartments with one crown in the open middle.',
    ['formal', 'luxe', 'gilt'],
    [
      { k: 'rule', at: [0.17, 0.29, 0.71, 0.83], weight: 0.05, from: 0.16, to: 0.84 },
      { k: 'stamp', at: 0.5, glyph: 'crown', size: 0.29 },
    ],
    { group: 'stamps', tier: 'shelf', floor: 13, claimTop: 0.33, claimBottom: 0.67 },
  ),

  'architects-fillet': decor(
    'architects-fillet',
    'Architect’s Fillet',
    'A single perimeter joined by exact head and tail rules.',
    ['formal', 'modern', 'severe'],
    [
      { k: 'frame', top: 0.055, bottom: 0.945, inset: 0.1, weight: 0.055, head: 'square', double: false },
      { k: 'rule', at: [0.13, 0.87], weight: 0.055, from: 0.1, to: 0.9 },
    ],
    { group: 'panels', tier: 'shelf', floor: 12, claimTop: 0.17, claimBottom: 0.83 },
  ),

  'binder-terminal-pair': decor(
    'binder-terminal-pair',
    'Binder’s Terminal Pair',
    'A fleuron at the head, a leaf at the foot, and one rule beside each.',
    ['refined', 'handmade', 'formal'],
    [
      { k: 'stamp', at: 0.09, glyph: 'fleuron', size: 0.23 },
      { k: 'stamp', at: 0.91, glyph: 'leaf', size: 0.23 },
      { k: 'rule', at: [0.17, 0.83], weight: 0.05, from: 0.21, to: 0.79 },
    ],
    { group: 'terminal', tier: 'signature', floor: 11, claimTop: 0.21, claimBottom: 0.79 },
  ),

  'library-fillet': decor(
    'library-fillet',
    'Library Fillet',
    'One continuous fillet and two short terminal rules: sober and durable.',
    ['scholarly', 'utilitarian', 'formal'],
    [
      { k: 'frame', top: 0.06, bottom: 0.94, inset: 0.12, weight: 0.055, head: 'square', double: false },
      { k: 'rule', at: [0.18, 0.82], weight: 0.05, from: 0.24, to: 0.76 },
    ],
    { group: 'panels', tier: 'signature', floor: 11, claimTop: 0.22, claimBottom: 0.78 },
  ),

  'botanical-corner-fillet': decor(
    'botanical-corner-fillet',
    'Botanical Corner Fillet',
    'Bracket corners frame one leaf tool, with the rest of the field left open.',
    ['natural', 'refined', 'handmade'],
    [
      { k: 'corners', glyph: 'bracket', arm: 0.27 },
      { k: 'stamp', at: 0.54, glyph: 'leaf', size: 0.28 },
    ],
    { group: 'corners', tier: 'shelf', floor: 12, claimTop: 0.12, claimBottom: 0.88 },
  ),

  /* --------------------- final active rule-only programmes ------------------ */

  'single-head-rule': decor('single-head-rule', 'Single Head Rule', 'One short fillet below the head and an otherwise open field.',
    ['plain', 'formal', 'refined'],
    [{ k: 'rule', at: [0.15], weight: 0.055, from: 0.2, to: 0.8 }],
    { group: 'rules', tier: 'signature', claimTop: 0.19 }),

  'single-tail-rule': decor('single-tail-rule', 'Single Tail Rule', 'One short fillet above the tail and an otherwise open field.',
    ['plain', 'formal', 'refined'],
    [{ k: 'rule', at: [0.85], weight: 0.055, from: 0.2, to: 0.8 }],
    { group: 'rules', tier: 'signature', claimBottom: 0.81 }),

  'paired-head-rules': decor('paired-head-rules', 'Paired Head Rules', 'Two close fillets below the head, with no marks through the body.',
    ['formal', 'refined', 'scholarly'],
    [{ k: 'rule', at: [0.11, 0.17], weight: 0.05, from: 0.18, to: 0.82 }],
    { group: 'rules', tier: 'signature', claimTop: 0.21 }),

  'paired-tail-rules': decor('paired-tail-rules', 'Paired Tail Rules', 'Two close fillets above the tail, with no marks through the body.',
    ['formal', 'refined', 'scholarly'],
    [{ k: 'rule', at: [0.83, 0.89], weight: 0.05, from: 0.18, to: 0.82 }],
    { group: 'rules', tier: 'signature', claimBottom: 0.79 }),

  'terminal-rule-pair': decor('terminal-rule-pair', 'Head & Tail Rules', 'One short fillet at each terminal, leaving one generous field.',
    ['formal', 'plain', 'sober'],
    [{ k: 'rule', at: [0.15, 0.85], weight: 0.055, from: 0.19, to: 0.81 }],
    { group: 'rules', tier: 'signature', claimTop: 0.19, claimBottom: 0.81 }),

  'asymmetric-terminal-rules': decor('asymmetric-terminal-rules', 'Asymmetric Terminal Rules', 'A paired head fillet answered by one tail rule.',
    ['formal', 'refined', 'antique'],
    [{ k: 'rule', at: [0.11, 0.17, 0.85], weight: 0.05, from: 0.18, to: 0.82 }],
    { group: 'rules', tier: 'shelf', claimTop: 0.21, claimBottom: 0.81 }),

  'four-terminal-rules': decor('four-terminal-rules', 'Four Terminal Rules', 'Two close rules at each end; the middle remains completely open.',
    ['formal', 'scholarly', 'gilt'],
    [{ k: 'rule', at: [0.11, 0.17, 0.83, 0.89], weight: 0.05, from: 0.17, to: 0.83 }],
    { group: 'rules', tier: 'signature', claimTop: 0.21, claimBottom: 0.79 }),

  'single-joint-fillet': decor('single-joint-fillet', 'Single Joint Fillet', 'One uninterrupted rule beside the near joint.',
    ['plain', 'severe', 'utilitarian'],
    [{ k: 'vrule', at: [0.18], weight: 0.055, top: 0.06, bottom: 0.94 }],
    { group: 'rules', tier: 'shelf', claimTop: 0.06, claimBottom: 0.94 }),

  'inner-joint-fillets': decor('inner-joint-fillets', 'Inner Joint Fillets', 'A quiet vertical pair set inboard from the physical joints.',
    ['formal', 'refined', 'sober'],
    [{ k: 'vrule', at: [0.28, 0.72], weight: 0.045, top: 0.07, bottom: 0.93 }],
    { group: 'rules', tier: 'shelf', claimTop: 0.07, claimBottom: 0.93 }),

  'terminal-rules-with-joints': decor('terminal-rules-with-joints', 'Terminal Rules & Joints', 'Two joint fillets with one short terminal rule at each end.',
    ['formal', 'scholarly', 'refined'],
    [
      { k: 'vrule', at: [0.17, 0.83], weight: 0.045, top: 0.07, bottom: 0.93 },
      { k: 'rule', at: [0.15, 0.85], weight: 0.05, from: 0.24, to: 0.76 },
    ],
    { group: 'rules', tier: 'signature', claimTop: 0.19, claimBottom: 0.81 }),

  'head-rules-with-joints': decor('head-rules-with-joints', 'Head Rules & Joints', 'Two joint fillets with a paired rule held at the head.',
    ['formal', 'scholarly', 'refined'],
    [
      { k: 'vrule', at: [0.17, 0.83], weight: 0.045, top: 0.07, bottom: 0.93 },
      { k: 'rule', at: [0.11, 0.17], weight: 0.05, from: 0.24, to: 0.76 },
    ],
    { group: 'rules', tier: 'shelf', claimTop: 0.21, claimBottom: 0.93 }),

  'tail-rules-with-joints': decor('tail-rules-with-joints', 'Tail Rules & Joints', 'Two joint fillets with a paired rule held at the tail.',
    ['formal', 'scholarly', 'refined'],
    [
      { k: 'vrule', at: [0.17, 0.83], weight: 0.045, top: 0.07, bottom: 0.93 },
      { k: 'rule', at: [0.83, 0.89], weight: 0.05, from: 0.24, to: 0.76 },
    ],
    { group: 'rules', tier: 'shelf', claimTop: 0.07, claimBottom: 0.79 }),

  ...AUTHORED_DECORS,
};

/** Every ornament id in picker order: family, then tier, then declaration. */
export const DECORATIONS: readonly Decoration[] = byRank(
  DECORATION_IDS.map((id) => DECORS[id]),
  DECOR_GROUPS,
).map((d) => d.id);

/**
 * Historical marks whose only job was to hold, imply, or index spine text.
 *
 * They remain in preset metadata because `label-plate` still helps choose a
 * fitting FRONT-COVER title treatment for older named bindings. The spine
 * painter deliberately ignores every one of them, and the component picker
 * does not offer an option that produces an empty ticket or doorway.
 */
export const SPINE_TEXT_FURNITURE_IDS: readonly Decoration[] = [
  'label-plate',
  'banner-plaque',
  'shelf-ticket',
  'number-roundel',
  'gilt-panel',
  'blind-panel',
  'arch-panel',
  'gothic-panel',
  'cartouche',
  'lattice-panel',
] as const;

const SPINE_TEXT_FURNITURE: ReadonlySet<Decoration> = new Set(
  SPINE_TEXT_FURNITURE_IDS,
);

/** A self-corded back must not receive a second horizontal construction. */
const ADDED_BAND_DECORATIONS: ReadonlySet<Decoration> = new Set([
  'gilt-bands',
  'double-bands',
  'triple-bands',
]);

/**
 * Marks that remain readable for legacy data but failed the caption-free
 * shelf test: they resemble belts, rulers, luggage fittings, or antennae more
 * readily than restrained binding tooling.
 */
export const RETIRED_VISUAL_DECORATION_IDS: readonly Decoration[] = [
  'beaded-band',
  'dentil-band',
  'chequer-band',
  'chain-band',
  'marbled-band',
  'pin-studs',
  'bosses',
  'tally-rules',
  'ribbon-marker',
  'bee-diaper',
] as const;

/**
 * The final spine-tooling authority: one quiet baseline plus 58 finished,
 * individually authored programmes.  Every active part is a connected square
 * fillet, a material-bodied band or one broad binder's tool.  No active row can
 * emit a dot field, trail, plate, hardware, rounded ticket or wallpaper run.
 */
export const ROLLABLE_DECORATIONS: readonly Decoration[] = [
  'plain',
  ...AUTHORED_SPINE_PROGRAM_IDS,
] as const;

/**
 * Decorations safe to expose as the independent composer axis.
 *
 * Kept as a named export instead of making callers infer safety from the
 * renderer table. At present every active programme was authored to stand on
 * any active straight binding; a future named-preset-only programme can remain
 * active without silently appearing here.
 */
export const COMPOSER_SAFE_DECORATIONS: readonly Decoration[] =
  ROLLABLE_DECORATIONS;

/** Programmes whose broad focal tool already spends the spine's motif budget. */
export const FOCAL_TOOL_DECORATIONS: readonly Decoration[] =
  AUTHORED_PROGRAMME_ROWS
    .filter((row) => PROGRAMME_ARCHETYPES[row[0]].glyph !== undefined)
    .map((row) => row[0]);

const FOCAL_TOOL_DECORATION_SET: ReadonlySet<string> = new Set(
  FOCAL_TOOL_DECORATIONS,
);

/** Does this programme already contain its one broad authored focal tool? */
export function decorationHasFocalTool(id: unknown): boolean {
  return typeof id === 'string' && FOCAL_TOOL_DECORATION_SET.has(id);
}

function bindingOwnsPhysicalCords(
  part: Extract<DecorPart, { k: 'binding' }>,
): boolean {
  return (
    part.archetype === 'corded-leather' ||
    part.archetype === 'ceremonial-crown' ||
    part.archetype === 'structural-sewing'
  );
}

/** Does this decoration add any horizontal spine rule or terminal station? */
export function decorationHasHorizontalRules(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  const spec = DECORS[id as Decoration];
  return spec?.parts.some((part) =>
    part.k === 'rule' ||
    part.k === 'bands' ||
    (part.k === 'binding' && !bindingOwnsPhysicalCords(part)) ||
    (part.k === 'compartments' && part.divisions.length > 0)
  ) ?? false;
}

const ACTIVE_DECOR_SET: ReadonlySet<string> = new Set(ROLLABLE_DECORATIONS);

/** Tooling retained only so old stored ids can be diagnosed. */
export const RETIRED_DECORATIONS: readonly Decoration[] = DECORATIONS.filter(
  (id) => !ACTIVE_DECOR_SET.has(id),
);

/** Look up an ornament; unknown ids give `plain` rather than a throw. */
export function decorSpec(id: unknown): DecorSpec {
  return DECORS[(typeof id === 'string' ? id : '') as Decoration] ?? DECORS.plain;
}

/** Display names for the studio's decoration checklist. */
export const DECORATION_LABELS: Readonly<Record<Decoration, string>> = Object.freeze(
  Object.fromEntries(DECORATIONS.map((id) => [id, DECORS[id].name])) as Record<Decoration, string>,
);

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
   * The book's OWN cloth. Deliberately not read from `flatScheme()`:
   * redecorating a room must not repaint the books in it.
   *
   * An index into `CLOTHS` for the fifty house cloths, or a `#rrggbb` the
   * READER typed. A hex is not folded onto the nearest of the fifty on the way
   * in: a picker that answers "magenta" with "the mulberry we happen to own" is
   * the same silent degradation `art/customColour.ts` exists to refuse. It is
   * clamped instead, by `palette.clothPair`, which lifts it off the ink floor
   * and derives the turned face — so an arbitrary colour still arrives as two
   * flat faces with a legible fold, which is the only way this style can accept
   * one at all.
   */
  cloth: number | string;
  /**
   * Whether `cloth` came from the dedicated spine-base colour role.
   *
   * A vellum or parchment binding normally keeps its undyed paper colour even
   * when the book inherits a shared cloth pigment. Once the reader explicitly
   * chooses the spine face, that choice becomes a pale dye/wash instead. The
   * colour value alone cannot distinguish those two cases: an inherited
   * `clothHex` and an explicit `spineBaseHex` may contain the same bytes.
   */
  baseColourPinned: boolean;
  /** Second cloth, for half/quarter bindings, marbled veins and ribbons. */
  accent: number | string;
  /** Rules, frames and spine tooling; null follows gilt/blind tooling. */
  tooling: string | null;
  /** Centred stamps and medallions; null follows the tooling colour. */
  emblem: string | null;
  /** Clasps, corner pieces and other fittings; null uses the authored metal. */
  hardware: string | null;
  /** Foil on the tooling. False means the same marks struck in soft ink. */
  gilt: boolean;
  /** Preferred focal compartment for cords and the optional ornament, 0..1. */
  focusAt: number;
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
  /** Which shelf of the studio's list it is filed on. Families are ordered. */
  group: PresetGroup;
  /**
   * How well the whole binding reads at 34px.
   *
   * A binding is only ever as good as its worst part — a Full Morocco built on
   * a scroll is a scroll — so in practice this tracks the weakest of the shape,
   * the covering and the marks, tightened by how common the binding is meant to
   * be. It is written down rather than computed because the studio's list is
   * the thing a reader browses, and a table that decides its own order is one
   * nobody can overrule.
   */
  tier: BookTier;
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
  rank: { group: PresetGroup; tier: BookTier },
): BookPreset {
  return { id, label, shape, material, decorations, gilt, weight, tags, ...rank };
}

/**
 * The named bindings, written in families: wrappers and pamphlets, then cloth,
 * silks, buckram, leather, vellum, decorated papers, half and quarter
 * bindings, the visible sewings, the mechanical bindings, the cut profiles, the
 * boxed and fastened, and the very ornamented.
 *
 * This is the order they were WRITTEN, not the order anybody sees. `BOOK_PRESETS`
 * below re-sorts it by each row's own `group` and `tier` — so a binding added at
 * the bottom of this list lands wherever its family and its quality put it, and
 * nothing here has to be kept in any particular sequence by hand.
 *
 * Two diagnostic constraints hold across this former catalogue:
 *
 *  - **No preset carries more than two decorations.** The caller may add one
 *    ornament on top, and a 30px spine with four marks on it is a smudge.
 *  - **Historical text-furniture ids remain identifiable here.** They never
 *    enter `BOOK_PRESETS`; `bookPresetWantsCoverTitle` reads the old metadata
 *    only to choose a FRONT-COVER title treatment during migration.
 */
const PRESET_ROWS: readonly BookPreset[] = [
  /* ------------------------------- wrappers -------------------------------- */
  preset('plain-wrapper', 'Plain Wrapper', 'pamphlet-thin', 'paper-wrapper', ['plain'], false, 7, ['plain', 'pocket', 'utilitarian'], { group: 'wrappers', tier: 'shelf' }),
  preset('stitched-pamphlet', 'Stitched Pamphlet', 'pamphlet-thin', 'paper-wrapper', ['spine-rule'], false, 5, ['plain', 'handmade', 'pocket'], { group: 'wrappers', tier: 'shelf' }),
  preset('offprint', 'Offprint', 'pamphlet-thin', 'paper-wrapper', ['label-plate'], false, 4, ['scholarly', 'plain', 'utilitarian'], { group: 'wrappers', tier: 'shelf' }),
  preset('printed-wrapper', 'Printed Wrapper', 'pamphlet-thin', 'patterned-paper', ['label-plate'], false, 4, ['plain', 'cosy', 'pocket'], { group: 'wrappers', tier: 'shelf' }),
  preset('chapbook', 'Chapbook', 'scalloped-head', 'paper-wrapper', ['foot-ornament'], false, 3, ['whimsical', 'handmade', 'pocket'], { group: 'wrappers', tier: 'niche' }),
  preset('penny-dreadful', 'Penny Dreadful', 'saddle-stapled', 'newsprint', ['tally-rules'], false, 4, ['battered', 'pocket', 'goofy'], { group: 'wrappers', tier: 'niche' }),
  preset('news-quarto', 'News Quarto', 'pamphlet-thin', 'newsprint', ['plain'], false, 4, ['utilitarian', 'battered', 'plain'], { group: 'wrappers', tier: 'niche' }),
  preset('field-notes', 'Field Notes', 'wallet', 'oilcloth', ['plain'], false, 4, ['pocket', 'utilitarian', 'battered'], { group: 'wrappers', tier: 'shelf' }),
  preset('paper-almanac', 'Paper Almanac', 'creased', 'stripe-paper', ['label-plate'], false, 3, ['whimsical', 'pocket', 'cosy'], { group: 'wrappers', tier: 'shelf' }),
  preset('sunday-programme', 'Sunday Programme', 'saddle-stapled', 'paper-wrapper', ['centre-rule'], false, 3, ['plain', 'modern', 'utilitarian'], { group: 'wrappers', tier: 'shelf' }),

  /* --------------------------------- cloth --------------------------------- */
  preset('plain-cloth', 'Plain Cloth', 'square', 'smooth-cloth', ['plain'], false, 8, ['plain', 'sober', 'utilitarian'], { group: 'cloth', tier: 'signature' }),
  preset('gilt-quarto', 'Gilt Quarto', 'square', 'smooth-cloth', ['gilt-bands', 'label-plate'], true, 8, ['gilt', 'formal', 'refined'], { group: 'cloth', tier: 'signature' }),
  preset('lettered-cloth', 'Lettered Cloth', 'square', 'smooth-cloth', ['label-plate'], false, 7, ['plain', 'formal', 'sober'], { group: 'cloth', tier: 'signature' }),
  preset('banded-cloth', 'Banded Cloth', 'square', 'smooth-cloth', ['double-bands'], true, 5, ['formal', 'gilt', 'refined'], { group: 'cloth', tier: 'signature' }),
  preset('panelled-cloth', 'Panelled Cloth', 'square', 'smooth-cloth', ['gilt-panel', 'label-plate'], true, 4, ['gilt', 'formal', 'luxe'], { group: 'cloth', tier: 'shelf' }),
  preset('blind-cloth', 'Blind-Stamped Cloth', 'square', 'smooth-cloth', ['blind-stamped-frame'], false, 4, ['sober', 'severe', 'plain'], { group: 'cloth', tier: 'shelf' }),
  preset('ruled-cloth', 'Ruled Cloth', 'square', 'smooth-cloth', ['spine-rule', 'label-plate'], true, 4, ['plain', 'formal', 'gilt'], { group: 'cloth', tier: 'shelf' }),
  preset('rep-cloth', 'Rep Cloth', 'square', 'ribbed-cloth', ['label-plate'], false, 5, ['plain', 'antique', 'sober'], { group: 'cloth', tier: 'signature' }),
  preset('ribbed-rep', 'Ribbed Rep', 'tight-back', 'ribbed-cloth', ['gilt-bands'], true, 4, ['formal', 'gilt', 'antique'], { group: 'cloth', tier: 'shelf' }),
  preset('corded-rep', 'Corded Rep', 'ribbed', 'ribbed-cloth', ['gilt-bands', 'label-plate'], true, 4, ['formal', 'antique', 'gilt'], { group: 'cloth', tier: 'shelf' }),
  preset('foot-tooled-octavo', 'Foot-Tooled Octavo', 'square', 'ribbed-cloth', ['gilt-bands', 'foot-ornament'], true, 3, ['refined', 'gilt', 'ornate'], { group: 'cloth', tier: 'shelf' }),
  preset('hollow-octavo', 'Hollow-Back Octavo', 'hollow-back', 'smooth-cloth', ['gilt-bands', 'label-plate'], true, 4, ['refined', 'antique', 'airy'], { group: 'cloth', tier: 'shelf' }),
  preset('scalloped-primer', 'Scalloped Primer', 'scalloped-head', 'smooth-cloth', ['label-plate'], false, 3, ['whimsical', 'cosy', 'goofy'], { group: 'cloth', tier: 'niche' }),
  preset('diamond-primer', 'Diamond Primer', 'tapered-head', 'smooth-cloth', ['diamond-centre'], true, 3, ['refined', 'gilt', 'fancy'], { group: 'cloth', tier: 'shelf' }),
  preset('tight-back-prize', 'Tight-Back Prize', 'tight-back', 'smooth-cloth', ['gilt-panel', 'corner-tooling'], true, 3, ['formal', 'gilt', 'severe'], { group: 'cloth', tier: 'shelf' }),
  preset('presentation-binding', 'Presentation Binding', 'double-hinge', 'smooth-cloth', ['gilt-panel', 'diamond-centre'], true, 2, ['luxe', 'gilt', 'formal'], { group: 'cloth', tier: 'niche' }),
  preset('yapp-pocket', 'Yapp Pocket', 'yapp', 'smooth-cloth', ['label-plate'], false, 3, ['cosy', 'devotional', 'pocket'], { group: 'cloth', tier: 'shelf' }),
  preset('schoolroom-cloth', 'Schoolroom Cloth', 'ledger', 'buckram', ['shelf-ticket'], false, 4, ['utilitarian', 'scholarly', 'battered'], { group: 'cloth', tier: 'shelf' }),
  preset('linen-quarto', 'Linen Quarto', 'square', 'linen', ['label-plate'], false, 5, ['natural', 'plain', 'handmade'], { group: 'cloth', tier: 'shelf' }),
  preset('linen-cords', 'Corded Linen', 'ribbed', 'linen', ['double-bands'], false, 3, ['natural', 'handmade', 'formal'], { group: 'cloth', tier: 'shelf' }),
  preset('duck-canvas', 'Duck Canvas', 'tight-back', 'canvas', ['plain'], false, 4, ['utilitarian', 'heavy', 'rustic'], { group: 'cloth', tier: 'shelf' }),
  preset('canvas-ledger', 'Canvas Ledger', 'ledger', 'canvas', ['corner-tooling'], false, 4, ['utilitarian', 'heavy', 'sober'], { group: 'cloth', tier: 'shelf' }),
  preset('sailmakers-quarto', 'Sailmaker’s Quarto', 'long-stitch', 'sailcloth', ['plain'], false, 3, ['handmade', 'rustic', 'natural'], { group: 'cloth', tier: 'niche' }),
  preset('hessian-folio', 'Hessian Folio', 'splayed', 'hessian', ['plain'], false, 3, ['rustic', 'battered', 'natural'], { group: 'cloth', tier: 'shelf' }),
  preset('tweed-octavo', 'Tweed Octavo', 'square', 'tweed', ['label-plate'], false, 4, ['cosy', 'rustic', 'natural'], { group: 'cloth', tier: 'shelf' }),
  preset('tweed-gilt', 'Tweed & Gilt', 'tight-back', 'tweed', ['gilt-bands', 'label-plate'], true, 3, ['cosy', 'gilt', 'refined'], { group: 'cloth', tier: 'shelf' }),
  preset('felt-pocketbook', 'Felt Pocketbook', 'cushioned', 'felt', ['plain'], false, 3, ['cosy', 'handmade', 'pocket'], { group: 'cloth', tier: 'shelf' }),
  preset('velvet-missal', 'Velvet Missal', 'cushioned', 'velvet', ['bosses', 'ribbon-marker'], true, 2, ['devotional', 'luxe', 'ornate'], { group: 'cloth', tier: 'niche' }),
  preset('velvet-album', 'Velvet Album', 'clasped', 'velvet', ['corner-tooling'], true, 2, ['luxe', 'antique', 'heavy'], { group: 'cloth', tier: 'niche' }),

  /*
   * Cased replacements for the soft-cover cluster.  They keep the tactile
   * coverings, but put them on continuous backs with one legible furnishing.
   * That is the construction, rather than a novelty silhouette, doing the
   * visual work at shelf size.
   */
  preset('felt-common-room', 'Common-Room Felt', 'square', 'felt', ['label-plate'], false, 4, ['cosy', 'plain', 'handmade'], { group: 'cloth', tier: 'shelf' }),
  preset('velvet-presentation', 'Velvet Presentation', 'tight-back', 'velvet', ['label-plate'], true, 3, ['luxe', 'formal', 'refined'], { group: 'cloth', tier: 'shelf' }),
  preset('archival-cloth', 'Archival Cloth', 'library-shoulder', 'buckram', ['shelf-ticket', 'spine-rule'], false, 4, ['scholarly', 'utilitarian', 'sober'], { group: 'cloth', tier: 'signature' }),
  preset('linen-herbarium', 'Linen Herbarium', 'tight-back', 'linen', ['vine-trail'], false, 4, ['natural', 'handmade', 'refined'], { group: 'cloth', tier: 'shelf' }),
  preset('linen-sewn-journal', 'Cased Linen Journal', 'tight-back', 'linen', ['double-bands', 'label-plate'], false, 4, ['handmade', 'natural', 'rustic'], { group: 'cloth', tier: 'shelf' }),
  preset('sailcloth-field-ledger', 'Sailcloth Field Book', 'tight-back', 'sailcloth', ['shelf-ticket'], false, 4, ['rustic', 'utilitarian', 'handmade'], { group: 'cloth', tier: 'shelf' }),
  preset('canvas-daybook', 'Cased Canvas Daybook', 'library-shoulder', 'canvas', ['shelf-ticket'], false, 4, ['rustic', 'utilitarian', 'sober'], { group: 'cloth', tier: 'shelf' }),
  preset('canvas-corded-log', 'Corded Canvas Log', 'ribbed', 'canvas', ['label-plate'], false, 4, ['rustic', 'heavy', 'utilitarian'], { group: 'cloth', tier: 'shelf' }),
  preset('cased-nature-diary', 'Cased Nature Diary', 'tight-back', 'tweed', ['acorn-tooling', 'label-plate'], false, 4, ['natural', 'cosy', 'refined'], { group: 'cloth', tier: 'shelf' }),

  /* -------------------------------- silks ---------------------------------- */
  preset('moire-keepsake', 'Moiré Keepsake', 'square', 'silk-moire', ['label-plate'], true, 3, ['luxe', 'refined', 'fancy'], { group: 'silks', tier: 'shelf' }),
  preset('moire-panelled', 'Panelled Moiré', 'round-cap', 'silk-moire', ['gilt-panel', 'label-plate'], true, 2, ['luxe', 'gilt', 'ornate'], { group: 'silks', tier: 'niche' }),
  preset('brocade-anthology', 'Brocade Anthology', 'ribbed', 'brocade', ['gilt-bands'], true, 2, ['ornate', 'luxe', 'fancy'], { group: 'silks', tier: 'niche' }),
  preset('damask-hours', 'Damask Hours', 'gabled', 'damask', ['arch-panel'], true, 2, ['devotional', 'ornate', 'formal'], { group: 'silks', tier: 'niche' }),
  preset('damask-presentation', 'Damask Presentation', 'double-hinge', 'damask', ['gilt-panel', 'label-plate'], true, 3, ['luxe', 'formal', 'refined'], { group: 'silks', tier: 'shelf' }),

  /* -------------------------------- buckram -------------------------------- */
  preset('library-buckram', 'Library Buckram', 'square', 'buckram', ['label-plate'], false, 6, ['utilitarian', 'scholarly', 'sober'], { group: 'buckram', tier: 'signature' }),
  preset('college-buckram', 'College Buckram', 'tight-back', 'buckram', ['spine-rule', 'label-plate'], true, 4, ['scholarly', 'formal', 'sober'], { group: 'buckram', tier: 'shelf' }),
  preset('reading-room-buckram', 'Reading-Room Buckram', 'tight-back', 'buckram', ['double-bands'], false, 4, ['scholarly', 'severe', 'sober'], { group: 'buckram', tier: 'shelf' }),
  preset('gilt-buckram', 'Gilt Buckram', 'square', 'buckram', ['gilt-bands', 'corner-tooling'], true, 3, ['gilt', 'formal', 'scholarly'], { group: 'buckram', tier: 'shelf' }),
  preset('hollow-ledger', 'Hollow Ledger', 'hollow-back', 'buckram', ['corner-tooling'], false, 3, ['utilitarian', 'sober', 'antique'], { group: 'buckram', tier: 'shelf' }),
  preset('plain-buckram', 'Plain Buckram', 'square', 'buckram', ['plain'], false, 4, ['plain', 'utilitarian', 'severe'], { group: 'buckram', tier: 'shelf' }),
  preset('stack-buckram', 'Stack Buckram', 'ledger', 'buckram', ['shelf-ticket', 'spine-rule'], false, 4, ['scholarly', 'utilitarian', 'sober'], { group: 'buckram', tier: 'shelf' }),
  preset('archive-buckram', 'Archive Buckram', 'tab-index', 'buckram', ['tally-rules'], false, 3, ['utilitarian', 'scholarly', 'modern'], { group: 'buckram', tier: 'niche' }),

  /* -------------------------------- leather -------------------------------- */
  preset('full-morocco', 'Full Morocco', 'tight-back', 'morocco-grain', ['gilt-bands', 'corner-tooling'], true, 5, ['luxe', 'gilt', 'formal'], { group: 'leather', tier: 'signature' }),
  preset('tooled-morocco', 'Tooled Morocco', 'ribbed', 'morocco-grain', ['gilt-bands', 'diamond-centre'], true, 4, ['luxe', 'ornate', 'gilt'], { group: 'leather', tier: 'shelf' }),
  preset('blind-calf', 'Blind-Tooled Calf', 'square', 'polished-calf', ['blind-stamped-frame'], false, 4, ['sober', 'severe', 'antique'], { group: 'leather', tier: 'shelf' }),
  preset('panelled-calf', 'Panelled Calf', 'tight-back', 'polished-calf', ['gilt-panel', 'label-plate'], true, 4, ['refined', 'gilt', 'formal'], { group: 'leather', tier: 'shelf' }),
  preset('tree-calf', 'Tree Calf', 'hollow-back', 'tree-calf', ['double-bands', 'label-plate'], true, 3, ['antique', 'ornate', 'refined'], { group: 'leather', tier: 'shelf' }),
  preset('diced-russia', 'Diced Russia', 'ribbed', 'russia-calf', ['double-bands', 'foot-ornament'], true, 3, ['antique', 'sober', 'scholarly'], { group: 'leather', tier: 'shelf' }),
  preset('plain-calf', 'Plain Calf', 'square', 'polished-calf', ['plain'], false, 4, ['plain', 'refined', 'antique'], { group: 'leather', tier: 'shelf' }),
  preset('yapp-devotional', 'Yapp Devotional', 'yapp', 'morocco-grain', ['gilt-bands', 'ribbon-marker'], true, 3, ['devotional', 'cosy', 'gilt'], { group: 'leather', tier: 'shelf' }),
  preset('cathedral-morocco', 'Cathedral Morocco', 'ribbed', 'morocco-grain', ['gilt-panel', 'label-plate'], true, 2, ['luxe', 'ornate', 'formal'], { group: 'leather', tier: 'niche' }),
  preset('sprinkled-octavo', 'Sprinkled Octavo', 'round-cap', 'sprinkled-calf', ['double-bands', 'label-plate'], true, 4, ['antique', 'scholarly', 'refined'], { group: 'leather', tier: 'shelf' }),
  preset('mottled-quarto', 'Mottled Quarto', 'square', 'mottled-calf', ['spine-rule'], false, 3, ['antique', 'battered', 'handmade'], { group: 'leather', tier: 'niche' }),
  preset('russia-folio', 'Russia Folio', 'double-hinge', 'russia-calf', ['triple-bands', 'label-plate'], true, 3, ['formal', 'luxe', 'severe'], { group: 'leather', tier: 'shelf' }),
  preset('roan-schoolbook', 'Roan Schoolbook', 'square', 'roan', ['label-plate'], false, 5, ['plain', 'utilitarian', 'battered'], { group: 'leather', tier: 'shelf' }),
  preset('roan-almanac', 'Roan Almanac', 'creased', 'roan', ['head-ornament'], false, 3, ['pocket', 'battered', 'antique'], { group: 'leather', tier: 'shelf' }),
  preset('skiver-diary', 'Skiver Diary', 'wallet', 'skiver', ['edge-piping'], true, 3, ['pocket', 'cosy', 'refined'], { group: 'leather', tier: 'niche' }),
  preset('suede-commonplace', 'Suede Commonplace', 'limp', 'suede', ['plain'], false, 3, ['cosy', 'handmade', 'natural'], { group: 'leather', tier: 'shelf' }),
  preset('shagreen-case', 'Shagreen Case', 'chamfered', 'shagreen', ['corner-tooling'], true, 2, ['luxe', 'modern', 'fancy'], { group: 'leather', tier: 'niche' }),
  preset('snakeskin-folly', 'Snakeskin Folly', 'waisted', 'snakeskin', ['star-tooling'], true, 2, ['fancy', 'goofy', 'ornate'], { group: 'leather', tier: 'niche' }),
  preset('crocodile-folio', 'Crocodile Folio', 'shoulder', 'crocodile', ['edge-piping', 'crest'], true, 2, ['luxe', 'heavy', 'fancy'], { group: 'leather', tier: 'niche' }),
  preset('pigskin-antiphonal', 'Pigskin Antiphonal', 'clasped', 'pigskin', ['bosses'], false, 2, ['antique', 'devotional', 'heavy'], { group: 'leather', tier: 'niche' }),
  preset('pigskin-lectern', 'Lectern Pigskin', 'chained', 'pigskin', ['blind-panel'], false, 2, ['antique', 'severe', 'scholarly'], { group: 'leather', tier: 'oddity' }),
  preset('oilcloth-logbook', 'Oilcloth Logbook', 'ledger', 'oilcloth', ['tally-rules'], false, 3, ['utilitarian', 'battered', 'rustic'], { group: 'leather', tier: 'niche' }),
  preset('suede-field-book', 'Cased Suede Field Book', 'tight-back', 'suede', ['spine-rule', 'label-plate'], false, 4, ['natural', 'handmade', 'rustic'], { group: 'leather', tier: 'shelf' }),
  preset('oilcloth-field-book', 'Cased Oilcloth Field Book', 'tight-back', 'oilcloth', ['tally-rules'], false, 4, ['utilitarian', 'battered', 'rustic'], { group: 'leather', tier: 'shelf' }),
  preset('rounded-roan-almanac', 'Roan Almanac', 'square', 'roan', ['head-ornament', 'label-plate'], false, 4, ['antique', 'cosy', 'plain'], { group: 'leather', tier: 'shelf' }),

  /*
   * Restrained Morocco: Met 448957's central hierarchy translated into the
   * house star/fillet vocabulary—one geometric centre, sparse frame, no added
   * hardware.  See also Ligatus's separation of covering, structure, titling
   * and furniture; those roles remain independent here.
   */
  preset('morocco-star-medallion', 'Star-Medallion Morocco', 'round-cap', 'morocco-grain', ['star-fillet-medallion'], true, 3, ['luxe', 'formal', 'refined'], { group: 'leather', tier: 'signature' }),
  preset('armorial-calf', 'Restrained Armorial Calf', 'double-hinge', 'polished-calf', ['cartouche', 'gilt-bands'], true, 3, ['formal', 'antique', 'luxe'], { group: 'leather', tier: 'shelf' }),

  /* -------------------------------- vellum --------------------------------- */
  preset('antique-vellum', 'Antique Vellum', 'tapered-head', 'vellum', ['spine-rule', 'label-plate'], false, 4, ['antique', 'refined', 'devotional'], { group: 'vellum', tier: 'shelf' }),
  preset('limp-vellum', 'Limp Vellum', 'limp', 'vellum', ['plain'], false, 4, ['antique', 'handmade', 'devotional'], { group: 'vellum', tier: 'shelf' }),
  preset('gilt-vellum', 'Gilt Vellum', 'tight-back', 'vellum', ['gilt-bands', 'label-plate'], true, 3, ['gilt', 'refined', 'antique'], { group: 'vellum', tier: 'shelf' }),
  preset('vellum-ties', 'Vellum with Ties', 'yapp', 'vellum', ['ribbon-marker'], false, 3, ['devotional', 'cosy', 'antique'], { group: 'vellum', tier: 'shelf' }),
  preset('corded-vellum', 'Corded Vellum', 'ribbed', 'vellum', ['label-plate'], false, 3, ['antique', 'handmade', 'formal'], { group: 'vellum', tier: 'shelf' }),
  preset('parchment-roll', 'Parchment Roll', 'rolled', 'parchment', ['plain'], false, 2, ['antique', 'whimsical', 'handmade'], { group: 'vellum', tier: 'oddity' }),
  preset('parchment-cartulary', 'Cartulary', 'clasped', 'parchment', ['blind-stamped-frame'], false, 2, ['antique', 'severe', 'scholarly'], { group: 'vellum', tier: 'niche' }),
  preset('tawed-psalter', 'Tawed Psalter', 'gabled', 'alum-tawed', ['gothic-panel', 'ribbon-marker'], false, 2, ['devotional', 'antique', 'severe'], { group: 'vellum', tier: 'niche' }),
  preset('tawed-boards', 'Tawed Boards', 'exposed-cords', 'alum-tawed', ['plain'], false, 2, ['antique', 'handmade', 'natural'], { group: 'vellum', tier: 'oddity' }),
  preset('stiff-vellum-quarto', 'Stiff-Board Vellum Quarto', 'tight-back', 'vellum', ['spine-rule', 'label-plate'], false, 5, ['antique', 'refined', 'scholarly'], { group: 'vellum', tier: 'signature' }),
  preset('laced-parchment-case', 'Laced Parchment Case', 'ribbed', 'parchment', ['label-plate'], false, 4, ['antique', 'handmade', 'scholarly'], { group: 'vellum', tier: 'shelf' }),

  /* --------------------------- decorated papers ---------------------------- */
  preset('marbled-boards', 'Marbled Boards', 'square', 'marbled-paper', ['label-plate'], false, 6, ['fancy', 'antique', 'handmade'], { group: 'papers', tier: 'signature' }),
  preset('combed-marble', 'Combed Marble', 'square', 'marbled-paper', ['gilt-bands'], true, 4, ['fancy', 'gilt', 'antique'], { group: 'papers', tier: 'shelf' }),
  preset('shell-marble', 'Shell Marble', 'square', 'shell-marble', ['double-bands', 'label-plate'], true, 3, ['fancy', 'refined', 'antique'], { group: 'papers', tier: 'shelf' }),
  preset('spanish-wave', 'Spanish Wave', 'tight-back', 'spanish-marble', ['marbled-band'], false, 3, ['fancy', 'ornate', 'handmade'], { group: 'papers', tier: 'shelf' }),
  preset('stone-quarto', 'Stone Quarto', 'square', 'stone-marble', ['spine-rule'], false, 3, ['sober', 'antique', 'handmade'], { group: 'papers', tier: 'niche' }),
  preset('paste-paper-book', 'Paste Paper Book', 'coptic', 'paste-paper', ['plain'], false, 3, ['handmade', 'cosy', 'natural'], { group: 'papers', tier: 'oddity' }),
  preset('patterned-boards', 'Patterned Boards', 'square', 'patterned-paper', ['label-plate'], false, 5, ['plain', 'cosy', 'whimsical'], { group: 'papers', tier: 'signature' }),
  preset('diaper-paper', 'Diaper Paper', 'square', 'patterned-paper', ['spine-rule'], false, 4, ['plain', 'cosy', 'refined'], { group: 'papers', tier: 'shelf' }),
  preset('block-printed', 'Block-Printed Boards', 'tapered-head', 'block-print', ['double-bands', 'label-plate'], false, 3, ['handmade', 'ornate', 'cosy'], { group: 'papers', tier: 'shelf' }),
  preset('ribbon-almanac', 'Ribbon Almanac', 'square', 'patterned-paper', ['ribbon-marker', 'label-plate'], false, 3, ['cosy', 'whimsical', 'pocket'], { group: 'papers', tier: 'shelf' }),
  preset('washi-notebook', 'Washi Notebook', 'japanese-stab', 'washi-print', ['plain'], false, 4, ['natural', 'handmade', 'airy'], { group: 'papers', tier: 'shelf' }),
  preset('stab-sewn-album', 'Stab-Sewn Album', 'japanese-stab', 'japanese-paper', ['label-plate'], false, 3, ['refined', 'handmade', 'airy'], { group: 'papers', tier: 'shelf' }),
  preset('laid-paper-quire', 'Laid Paper Quire', 'sewn-sections', 'japanese-paper', ['plain'], false, 3, ['plain', 'handmade', 'airy'], { group: 'papers', tier: 'niche' }),
  preset('dutch-gilt-primer', 'Dutch Gilt Primer', 'scalloped-head', 'dutch-gilt', ['head-ornament'], true, 2, ['gilt', 'ornate', 'whimsical'], { group: 'papers', tier: 'niche' }),
  preset('dutch-gilt-toybook', 'Gilt Toy Book', 'two-lobe', 'dutch-gilt', ['rosette'], true, 2, ['goofy', 'whimsical', 'gilt'], { group: 'papers', tier: 'oddity' }),
  preset('striped-songbook', 'Striped Songbook', 'saddle-stapled', 'stripe-paper', ['plain'], false, 3, ['whimsical', 'modern', 'plain'], { group: 'papers', tier: 'shelf' }),
  preset('chequer-primer', 'Chequer Primer', 'scalloped-tail', 'chequer-paper', ['label-plate'], false, 3, ['goofy', 'whimsical', 'modern'], { group: 'papers', tier: 'oddity' }),
  preset('chequer-annual', 'Chequer Annual', 'square', 'chequer-paper', ['chequer-band'], true, 2, ['goofy', 'fancy', 'modern'], { group: 'papers', tier: 'oddity' }),
  preset('cased-stripe-almanac', 'Cased Stripe Almanac', 'square', 'stripe-paper', ['label-plate'], false, 4, ['cosy', 'whimsical', 'plain'], { group: 'papers', tier: 'shelf' }),
  preset('paste-paper-keepsake', 'Paste-Paper Keepsake', 'square', 'paste-paper', ['label-plate'], false, 4, ['cosy', 'handmade', 'refined'], { group: 'papers', tier: 'shelf' }),

  /* --------------------------- half and quarter ---------------------------- */
  preset('half-morocco', 'Half Morocco', 'ribbed', 'half-bound', ['gilt-bands', 'label-plate'], true, 6, ['formal', 'luxe', 'gilt'], { group: 'halfQuarter', tier: 'signature' }),
  preset('half-calf', 'Half Calf', 'tight-back', 'half-bound', ['double-bands'], true, 5, ['formal', 'refined', 'antique'], { group: 'halfQuarter', tier: 'signature' }),
  preset('half-cloth', 'Half Cloth', 'square', 'half-cloth-paper', ['label-plate'], false, 5, ['plain', 'cosy', 'handmade'], { group: 'halfQuarter', tier: 'shelf' }),
  preset('half-roan', 'Half Roan', 'tight-back', 'half-bound', ['spine-rule'], true, 3, ['plain', 'formal', 'antique'], { group: 'halfQuarter', tier: 'shelf' }),
  preset('sammelband', 'Sammelband', 'ribbed', 'half-bound', ['foot-ornament', 'label-plate'], true, 2, ['scholarly', 'antique', 'formal'], { group: 'halfQuarter', tier: 'niche' }),
  preset('tooled-tail', 'Tooled Tail', 'tight-back', 'half-bound', ['foot-ornament', 'spine-rule'], true, 2, ['refined', 'gilt', 'ornate'], { group: 'halfQuarter', tier: 'niche' }),
  preset('quarter-calf', 'Quarter Calf', 'square', 'quarter-bound', ['double-bands'], true, 5, ['formal', 'plain', 'antique'], { group: 'halfQuarter', tier: 'signature' }),
  preset('quarter-cloth', 'Quarter Cloth', 'square', 'quarter-bound', ['label-plate'], false, 5, ['plain', 'utilitarian', 'sober'], { group: 'halfQuarter', tier: 'signature' }),
  preset('quarter-vellum', 'Quarter Vellum', 'tapered-head', 'quarter-bound', ['spine-rule', 'label-plate'], false, 3, ['antique', 'refined', 'scholarly'], { group: 'halfQuarter', tier: 'shelf' }),
  preset('marbled-quarter', 'Marbled Quarter', 'square', 'quarter-bound', ['marbled-band', 'label-plate'], false, 3, ['fancy', 'antique', 'handmade'], { group: 'halfQuarter', tier: 'shelf' }),
  preset('three-quarter-morocco', 'Three-Quarter Morocco', 'ribbed', 'three-quarter', ['triple-bands', 'label-plate'], true, 3, ['luxe', 'formal', 'gilt'], { group: 'halfQuarter', tier: 'shelf' }),
  preset('three-quarter-set', 'Three-Quarter Set', 'round-cap', 'three-quarter', ['gilt-bands', 'number-roundel'], true, 2, ['luxe', 'ornate', 'formal'], { group: 'halfQuarter', tier: 'niche' }),
  preset('tips-and-bands', 'Tips & Bands', 'double-hinge', 'tips-and-bands', ['corner-tooling', 'label-plate'], true, 3, ['refined', 'formal', 'antique'], { group: 'halfQuarter', tier: 'shelf' }),
  preset('exposed-boards', 'Exposed Boards', 'splayed', 'boards-exposed', ['plain'], false, 3, ['battered', 'handmade', 'plain'], { group: 'halfQuarter', tier: 'niche' }),
  preset('rebacked-quarto', 'Rebacked Quarto', 'shoulder', 'boards-exposed', ['shelf-ticket'], false, 3, ['battered', 'antique', 'scholarly'], { group: 'halfQuarter', tier: 'niche' }),

  /*
   * The Met's Alfred Launder examples pair restrained cloth/vellum backs with
   * patterned-paper sides and one restrained title ground. The active
   * version uses the same construction hierarchy in Alcove's flat vocabulary:
   * continuous titleless spine, quiet paper field, a composed front cover and
   * no loose furniture.
   */
  preset('launder-patterned-sides', 'Launder Patterned Sides', 'tight-back', 'sprig-paper-sides', ['label-plate'], true, 5, ['refined', 'handmade', 'antique'], { group: 'halfQuarter', tier: 'signature' }),

  /* -------------------------- the sewing you can see ------------------------ */
  preset('coptic-sketchbook', 'Coptic Sketchbook', 'coptic', 'linen', ['plain'], false, 4, ['handmade', 'natural', 'modern'], { group: 'sewn', tier: 'oddity' }),
  preset('coptic-hardcase', 'Coptic Hard Case', 'coptic', 'boards-exposed', ['corner-tooling'], false, 3, ['handmade', 'battered', 'natural'], { group: 'sewn', tier: 'oddity' }),
  preset('long-stitch-journal', 'Long-Stitch Journal', 'long-stitch', 'suede', ['plain'], false, 4, ['handmade', 'cosy', 'rustic'], { group: 'sewn', tier: 'shelf' }),
  preset('long-stitch-limp', 'Limp Long-Stitch', 'long-stitch', 'parchment', ['plain'], false, 3, ['handmade', 'antique', 'natural'], { group: 'sewn', tier: 'shelf' }),
  preset('unbound-quire', 'Unbound Quire', 'sewn-sections', 'paper-wrapper', ['plain'], false, 3, ['plain', 'handmade', 'airy'], { group: 'sewn', tier: 'niche' }),
  preset('bare-cords', 'Bare Cords', 'exposed-cords', 'boards-exposed', ['plain'], false, 3, ['handmade', 'rustic', 'natural'], { group: 'sewn', tier: 'oddity' }),
  preset('binders-mock-up', 'Binder’s Mock-Up', 'exposed-cords', 'linen', ['shelf-ticket'], false, 2, ['handmade', 'utilitarian', 'plain'], { group: 'sewn', tier: 'oddity' }),
  preset('raised-cord-folio', 'Raised-Cord Folio', 'ribbed', 'morocco-grain', ['triple-bands', 'label-plate'], true, 3, ['luxe', 'formal', 'gilt'], { group: 'sewn', tier: 'shelf' }),

  /* -------------------------- mechanical bindings --------------------------- */
  preset('spiral-notebook', 'Spiral Notebook', 'spiral-wire', 'canvas', ['plain'], false, 5, ['modern', 'utilitarian', 'plain'], { group: 'mechanical', tier: 'oddity' }),
  preset('spiral-sketchpad', 'Spiral Sketchpad', 'spiral-wire', 'newsprint', ['tally-rules'], false, 3, ['modern', 'utilitarian', 'battered'], { group: 'mechanical', tier: 'oddity' }),
  preset('comb-report', 'Comb-Bound Report', 'comb-bound', 'paper-wrapper', ['label-plate'], false, 4, ['modern', 'utilitarian', 'plain'], { group: 'mechanical', tier: 'oddity' }),
  preset('ring-file', 'Ring File', 'ring-binder', 'buckram', ['shelf-ticket'], false, 4, ['modern', 'utilitarian', 'heavy'], { group: 'mechanical', tier: 'oddity' }),
  preset('ring-catalogue', 'Ring Catalogue', 'ring-binder', 'oilcloth', ['spine-rule'], false, 3, ['utilitarian', 'sober', 'modern'], { group: 'mechanical', tier: 'oddity' }),
  preset('thumb-index-lexicon', 'Thumb-Index Lexicon', 'tab-index', 'roan', ['label-plate'], true, 3, ['scholarly', 'utilitarian', 'formal'], { group: 'mechanical', tier: 'shelf' }),
  preset('stapled-bulletin', 'Stapled Bulletin', 'saddle-stapled', 'paper-wrapper', ['plain'], false, 4, ['plain', 'utilitarian', 'pocket'], { group: 'mechanical', tier: 'shelf' }),

  /* -------------------------- cut heads and profiles ------------------------ */
  preset('domed-hymnal', 'Domed Hymnal', 'domed-head', 'smooth-cloth', ['gilt-bands', 'ribbon-marker'], true, 3, ['devotional', 'cosy', 'gilt'], { group: 'profiles', tier: 'shelf' }),
  preset('reliquary-quarto', 'Reliquary Quarto', 'gabled', 'morocco-grain', ['gothic-panel'], true, 2, ['devotional', 'ornate', 'antique'], { group: 'profiles', tier: 'niche' }),
  preset('ogee-breviary', 'Ogee Breviary', 'ogee-head', 'velvet', ['arch-panel', 'ribbon-marker'], true, 2, ['devotional', 'ornate', 'luxe'], { group: 'profiles', tier: 'niche' }),
  preset('notched-manual', 'Notched Manual', 'notched-head', 'canvas', ['spine-rule'], false, 3, ['modern', 'utilitarian', 'plain'], { group: 'profiles', tier: 'niche' }),
  preset('stepped-monograph', 'Stepped Monograph', 'stepped-head', 'buckram', ['centre-rule'], true, 2, ['modern', 'severe', 'formal'], { group: 'profiles', tier: 'niche' }),
  preset('crenellated-history', 'Crenellated History', 'crenellated', 'russia-calf', ['dentil-band', 'crest'], true, 2, ['ornate', 'goofy', 'antique'], { group: 'profiles', tier: 'oddity' }),
  preset('wave-head-reader', 'Wave-Head Reader', 'wave-head', 'paste-paper', ['plain'], false, 3, ['whimsical', 'handmade', 'battered'], { group: 'profiles', tier: 'oddity' }),
  preset('valance-primer', 'Valance Primer', 'scalloped-tail', 'patterned-paper', ['rosette'], true, 2, ['whimsical', 'fancy', 'cosy'], { group: 'profiles', tier: 'niche' }),
  preset('bevel-head-annual', 'Bevel-Head Annual', 'bevel-head', 'stripe-paper', ['centre-rule'], false, 2, ['modern', 'goofy', 'whimsical'], { group: 'profiles', tier: 'niche' }),
  preset('splayed-scrapbook', 'Splayed Scrapbook', 'splayed', 'hessian', ['wax-seal'], false, 3, ['battered', 'handmade', 'rustic'], { group: 'profiles', tier: 'niche' }),
  preset('waisted-well-read', 'Read to Death', 'waisted', 'roan', ['plain'], false, 4, ['battered', 'cosy', 'handmade'], { group: 'profiles', tier: 'shelf' }),
  preset('chamfered-monograph', 'Chamfered Monograph', 'chamfered', 'polished-calf', ['double-frame'], true, 2, ['formal', 'severe', 'luxe'], { group: 'profiles', tier: 'niche' }),
  preset('shouldered-atlas', 'Shouldered Atlas', 'shoulder', 'buckram', ['gilt-panel', 'label-plate'], true, 2, ['formal', 'heavy', 'modern'], { group: 'profiles', tier: 'niche' }),
  preset('plinth-folio', 'Plinth Folio', 'flared-tail', 'crocodile', ['greek-key'], true, 2, ['heavy', 'formal', 'ornate'], { group: 'profiles', tier: 'niche' }),
  preset('twin-lobe-nursery', 'Nursery Twin-Lobe', 'two-lobe', 'felt', ['rosette'], false, 2, ['goofy', 'cosy', 'whimsical'], { group: 'profiles', tier: 'oddity' }),
  preset('creased-pocketbook', 'Creased Pocketbook', 'creased', 'skiver', ['plain'], false, 4, ['pocket', 'battered', 'cosy'], { group: 'profiles', tier: 'niche' }),
  preset('limp-commonplace', 'Limp Commonplace', 'limp', 'linen', ['plain'], false, 4, ['handmade', 'natural', 'cosy'], { group: 'profiles', tier: 'shelf' }),
  preset('scroll-case', 'Scroll', 'rolled', 'parchment', ['plain'], false, 1, ['antique', 'whimsical', 'handmade'], { group: 'profiles', tier: 'oddity' }),
  preset('spring-back-ledger', 'Spring-Back Ledger', 'spring-back', 'canvas', ['corner-tooling', 'shelf-ticket'], false, 3, ['utilitarian', 'heavy', 'antique'], { group: 'profiles', tier: 'oddity' }),
  preset('cushioned-album', 'Cushioned Album', 'cushioned', 'velvet', ['bosses'], true, 2, ['luxe', 'cosy', 'ornate'], { group: 'profiles', tier: 'niche' }),
  preset('tapered-anthology', 'Tapered Anthology', 'tapered-tail', 'marbled-paper', ['label-plate'], false, 3, ['handmade', 'fancy', 'whimsical'], { group: 'profiles', tier: 'shelf' }),

  /* --------------------------- boxed and fastened --------------------------- */
  preset('slipcased-set', 'Slipcased Set', 'slipcased', 'smooth-cloth', ['label-plate'], false, 3, ['formal', 'luxe', 'refined'], { group: 'boxed', tier: 'shelf' }),
  preset('slipcased-folio', 'Slipcased Folio', 'slipcased', 'buckram', ['gilt-bands'], true, 2, ['formal', 'luxe', 'gilt'], { group: 'boxed', tier: 'niche' }),
  preset('clamshell-archive', 'Clamshell Archive', 'clamshell', 'buckram', ['shelf-ticket'], false, 2, ['formal', 'severe', 'scholarly'], { group: 'boxed', tier: 'niche' }),
  preset('clamshell-treasure', 'Clamshell Treasure', 'clamshell', 'morocco-grain', ['gilt-panel', 'label-plate'], true, 1, ['luxe', 'gilt', 'formal'], { group: 'boxed', tier: 'niche' }),
  preset('boxed-collected', 'Boxed Collected Works', 'boxed-set', 'half-bound', ['gilt-bands', 'number-roundel'], true, 2, ['formal', 'luxe', 'cosy'], { group: 'boxed', tier: 'niche' }),
  preset('boxed-nursery', 'Boxed Nursery Set', 'boxed-set', 'chequer-paper', ['label-plate'], false, 2, ['cosy', 'goofy', 'whimsical'], { group: 'boxed', tier: 'oddity' }),
  preset('portfolio-plates', 'Plate Portfolio', 'portfolio', 'canvas', ['corner-tooling'], false, 3, ['utilitarian', 'formal', 'antique'], { group: 'boxed', tier: 'shelf' }),
  preset('portfolio-drawings', 'Drawing Portfolio', 'portfolio', 'boards-exposed', ['shelf-ticket'], false, 2, ['utilitarian', 'battered', 'plain'], { group: 'boxed', tier: 'niche' }),
  preset('wallet-diary', 'Wallet Diary', 'wallet', 'suede', ['plain'], false, 4, ['pocket', 'cosy', 'handmade'], { group: 'boxed', tier: 'shelf' }),
  preset('clasped-bible', 'Clasped Bible', 'clasped', 'morocco-grain', ['blind-panel', 'ribbon-marker'], false, 3, ['devotional', 'antique', 'heavy'], { group: 'boxed', tier: 'shelf' }),
  preset('clasped-grimoire', 'Clasped Grimoire', 'clasped', 'shagreen', ['pin-studs', 'wax-seal'], false, 2, ['antique', 'ornate', 'heavy'], { group: 'boxed', tier: 'niche' }),
  preset('chained-cartulary', 'Chained Cartulary', 'chained', 'alum-tawed', ['bosses'], false, 2, ['antique', 'severe', 'scholarly'], { group: 'boxed', tier: 'oddity' }),
  preset('chained-lectionary', 'Chained Lectionary', 'chained', 'pigskin', ['blind-stamped-frame'], false, 2, ['devotional', 'severe', 'antique'], { group: 'boxed', tier: 'oddity' }),
  preset('yapp-testament', 'Yapp Testament', 'yapp', 'skiver', ['edge-piping', 'ribbon-marker'], true, 3, ['devotional', 'pocket', 'cosy'], { group: 'boxed', tier: 'niche' }),

  /* --------------------------- the very ornamented -------------------------- */
  preset('seme-royal', 'Semé Royal', 'ribbed', 'morocco-grain', ['fleur-seme', 'label-plate'], true, 1, ['luxe', 'ornate', 'gilt'], { group: 'ornamented', tier: 'niche' }),
  preset('empire-bees', 'Empire Bees', 'round-cap', 'morocco-grain', ['bee-diaper'], true, 1, ['ornate', 'luxe', 'fancy'], { group: 'ornamented', tier: 'oddity' }),
  preset('vine-trailed-herbal', 'Trailed Herbal', 'ribbed', 'polished-calf', ['vine-trail'], true, 2, ['ornate', 'natural', 'handmade'], { group: 'ornamented', tier: 'niche' }),
  preset('laurel-prize', 'Prize Binding', 'tight-back', 'smooth-cloth', ['laurel-spray', 'label-plate'], true, 3, ['formal', 'gilt', 'refined'], { group: 'ornamented', tier: 'shelf' }),
  preset('acorn-nature-diary', 'Acorn Nature Diary', 'limp', 'tweed', ['acorn-tooling'], false, 3, ['natural', 'cosy', 'rustic'], { group: 'ornamented', tier: 'niche' }),
  preset('sunburst-atlas', 'Sunburst Atlas', 'flared-tail', 'silk-moire', ['sunburst-fan'], true, 2, ['fancy', 'ornate', 'luxe'], { group: 'ornamented', tier: 'niche' }),
  preset('cartouche-armorial', 'Armorial Cartouche', 'ribbed', 'morocco-grain', ['cartouche', 'gilt-bands'], true, 2, ['luxe', 'ornate', 'formal'], { group: 'ornamented', tier: 'niche' }),
  preset('lattice-cabinet', 'Lattice Cabinet Book', 'chamfered', 'brocade', ['lattice-panel'], true, 2, ['ornate', 'refined', 'fancy'], { group: 'ornamented', tier: 'niche' }),
  preset('greek-key-classics', 'Classics in Greek Key', 'tight-back', 'buckram', ['greek-key', 'label-plate'], true, 3, ['scholarly', 'formal', 'ornate'], { group: 'ornamented', tier: 'niche' }),
  preset('vitruvian-treatise', 'Vitruvian Treatise', 'double-hinge', 'polished-calf', ['wave-scroll', 'label-plate'], true, 2, ['formal', 'ornate', 'scholarly'], { group: 'ornamented', tier: 'niche' }),
  preset('chain-band-annals', 'Chain-Band Annals', 'ledger', 'russia-calf', ['chain-band'], true, 2, ['antique', 'severe', 'heavy'], { group: 'ornamented', tier: 'niche' }),
  preset('zigzag-saga', 'Zigzag Saga', 'gabled', 'roan', ['zigzag-band'], true, 2, ['antique', 'goofy', 'ornate'], { group: 'ornamented', tier: 'niche' }),
  preset('rope-band-logbook', 'Rope-Band Logbook', 'ledger', 'sailcloth', ['rope-band'], false, 3, ['rustic', 'handmade', 'utilitarian'], { group: 'ornamented', tier: 'niche' }),
  preset('beaded-poetry', 'Beaded Poetry', 'domed-head', 'silk-moire', ['beaded-band', 'label-plate'], true, 3, ['refined', 'fancy', 'gilt'], { group: 'ornamented', tier: 'shelf' }),
  preset('dotted-miscellany', 'Dotted Miscellany', 'round-cap', 'tree-calf', ['dotted-rule', 'label-plate'], true, 3, ['refined', 'antique', 'gilt'], { group: 'ornamented', tier: 'shelf' }),
  preset('dentil-lexicon', 'Dentil Lexicon', 'stepped-head', 'buckram', ['dentil-band', 'label-plate'], true, 2, ['formal', 'scholarly', 'ornate'], { group: 'ornamented', tier: 'niche' }),
  preset('banner-songbook', 'Banner Songbook', 'scalloped-head', 'block-print', ['banner-plaque'], true, 2, ['whimsical', 'ornate', 'cosy'], { group: 'ornamented', tier: 'niche' }),
  preset('monogrammed-letters', 'Monogrammed Letters', 'double-hinge', 'morocco-grain', ['monogram-lozenge', 'gilt-bands'], true, 2, ['luxe', 'refined', 'formal'], { group: 'ornamented', tier: 'niche' }),
  preset('crowned-statutes', 'Crowned Statutes', 'ribbed', 'russia-calf', ['crown-tooling', 'triple-bands'], true, 1, ['luxe', 'formal', 'ornate'], { group: 'ornamented', tier: 'niche' }),
  preset('studded-daybook', 'Studded Daybook', 'ledger', 'oilcloth', ['pin-studs'], false, 2, ['utilitarian', 'heavy', 'battered'], { group: 'ornamented', tier: 'niche' }),
  preset('shell-corner-keepsake', 'Shell-Corner Keepsake', 'cushioned', 'shell-marble', ['shell-corners', 'label-plate'], true, 2, ['fancy', 'ornate', 'cosy'], { group: 'ornamented', tier: 'niche' }),
  preset('double-framed-code', 'Double-Framed Code', 'tight-back', 'crocodile', ['double-frame'], true, 2, ['severe', 'formal', 'heavy'], { group: 'ornamented', tier: 'niche' }),
  preset('roundel-encyclopaedia', 'Roundel Encyclopaedia', 'shoulder', 'half-bound', ['number-roundel', 'gilt-bands'], true, 3, ['formal', 'scholarly', 'gilt'], { group: 'ornamented', tier: 'shelf' }),
  preset('sealed-testimony', 'Sealed Testimony', 'portfolio', 'parchment', ['wax-seal'], false, 2, ['antique', 'handmade', 'severe'], { group: 'ornamented', tier: 'niche' }),
];

/**
 * The post-reset named collection.
 *
 * This is deliberately a second authored table, not a filter over the old
 * catalogue and not a generated cross-product. Each row names a complete
 * straight-backed book, a quiet construction-led covering, and one tooling
 * hierarchy. Similar materials get different programmes only when the result
 * serves a distinct library role: prize book, archive volume, devotional,
 * field book, formal folio, or everyday reading copy.
 */
const RESET_PRESET_ROWS: readonly BookPreset[] = [
  /* -------------------------------- cloth --------------------------------- */
  preset('plain-cloth', 'Plain Cloth', 'square', 'smooth-cloth', ['plain'], false, 9, ['plain', 'sober', 'utilitarian'], { group: 'cloth', tier: 'signature' }),
  preset('gilt-quarto', 'Gilt Quarto', 'square', 'smooth-cloth', ['quarto-grand-fillet'], true, 8, ['gilt', 'formal', 'refined'], { group: 'cloth', tier: 'signature' }),
  preset('oxford-cloth', 'Oxford Cloth', 'tight-back', 'smooth-cloth', ['oxford-double-compartment'], true, 6, ['formal', 'scholarly', 'refined'], { group: 'cloth', tier: 'signature' }),
  preset('cambridge-cloth', 'Cambridge Cloth', 'tight-back', 'smooth-cloth', ['cambridge-blind-bays'], false, 6, ['sober', 'scholarly', 'antique'], { group: 'cloth', tier: 'signature' }),
  preset('printers-cloth', 'Printer’s Cloth', 'double-hinge', 'smooth-cloth', ['printers-terminal-blocks'], true, 5, ['refined', 'scholarly', 'formal'], { group: 'cloth', tier: 'shelf' }),
  preset('library-fillet-cloth', 'Library Fillet Cloth', 'square', 'smooth-cloth', ['library-closed-fillet'], false, 6, ['scholarly', 'utilitarian', 'formal'], { group: 'cloth', tier: 'signature' }),
  preset('folio-cloth', 'Folio Cloth', 'tight-back', 'smooth-cloth', ['folio-five-compartment'], true, 4, ['formal', 'scholarly', 'heavy'], { group: 'cloth', tier: 'shelf' }),
  preset('botanical-cloth', 'Botanical Cloth', 'square', 'smooth-cloth', ['botanical-centre-panel'], false, 4, ['natural', 'handmade', 'refined'], { group: 'cloth', tier: 'shelf' }),
  preset('prize-cloth', 'Prize Cloth', 'tight-back', 'smooth-cloth', ['prize-laurel-panel'], true, 4, ['formal', 'gilt', 'refined'], { group: 'cloth', tier: 'shelf' }),

  preset('buckram-library', 'Library Buckram', 'square', 'buckram', ['buckram-library-bays'], false, 7, ['utilitarian', 'scholarly', 'sober'], { group: 'buckram', tier: 'signature' }),
  preset('buckram-oxford', 'Oxford Buckram', 'tight-back', 'buckram', ['buckram-oxford-fillets'], true, 5, ['formal', 'scholarly', 'refined'], { group: 'buckram', tier: 'shelf' }),
  preset('buckram-cambridge', 'Cambridge Buckram', 'double-hinge', 'buckram', ['buckram-cambridge-bands'], false, 5, ['sober', 'scholarly', 'antique'], { group: 'buckram', tier: 'shelf' }),
  preset('buckram-folio', 'Archive Folio', 'tight-back', 'buckram', ['buckram-archive-folio'], false, 4, ['scholarly', 'utilitarian', 'heavy'], { group: 'buckram', tier: 'shelf' }),

  preset('linen-commonplace', 'Linen Commonplace', 'square', 'linen', ['plain'], false, 6, ['plain', 'natural', 'handmade'], { group: 'cloth', tier: 'signature' }),
  preset('linen-botanical', 'Linen Herbarium', 'tight-back', 'linen', ['linen-herbarium-sprig'], false, 5, ['natural', 'handmade', 'refined'], { group: 'cloth', tier: 'shelf' }),
  preset('linen-printers', 'Printer’s Linen', 'double-hinge', 'linen', ['linen-printers-bands'], true, 4, ['refined', 'handmade', 'formal'], { group: 'cloth', tier: 'shelf' }),
  preset('linen-scholar', 'Scholar’s Linen', 'tight-back', 'linen', ['linen-scholar-bays'], false, 5, ['scholarly', 'natural', 'sober'], { group: 'cloth', tier: 'shelf' }),

  preset('velvet-crown', 'Sunrise Velvet', 'double-hinge', 'velvet', ['velvet-crown-frame'], true, 3, ['luxe', 'formal', 'gilt'], { group: 'cloth', tier: 'shelf' }),
  preset('velvet-palmette', 'Palmette Velvet', 'tight-back', 'velvet', ['velvet-palmette-panel'], true, 3, ['luxe', 'ornate', 'refined'], { group: 'cloth', tier: 'shelf' }),
  preset('velvet-ducal', 'Grand Crown Velvet', 'square', 'velvet', ['grand-crown-compartments'], true, 2, ['luxe', 'formal', 'ornate'], { group: 'cloth', tier: 'signature' }),

  /* -------------------------------- leather -------------------------------- */
  preset('plain-calf', 'Plain Calf', 'square', 'polished-calf', ['plain'], false, 7, ['plain', 'refined', 'antique'], { group: 'leather', tier: 'signature' }),
  preset('blind-calf', 'Blind Calf', 'tight-back', 'polished-calf', ['calf-blind-double-fillet'], false, 6, ['sober', 'severe', 'antique'], { group: 'leather', tier: 'signature' }),
  preset('oxford-calf', 'Oxford Calf', 'tight-back', 'polished-calf', ['calf-oxford-bands'], true, 6, ['formal', 'scholarly', 'refined'], { group: 'leather', tier: 'signature' }),
  preset('cambridge-calf', 'Cambridge Calf', 'double-hinge', 'polished-calf', ['calf-cambridge-bays'], false, 5, ['sober', 'scholarly', 'antique'], { group: 'leather', tier: 'shelf' }),
  preset('calf-compartments', 'Calf Gilt Compartments', 'square', 'polished-calf', ['calf-gilt-compartments'], true, 5, ['formal', 'antique', 'gilt'], { group: 'leather', tier: 'shelf' }),
  preset('royal-calf', 'Royal State Calf', 'double-hinge', 'polished-calf', ['calf-royal-crown'], true, 3, ['formal', 'luxe', 'gilt'], { group: 'leather', tier: 'shelf' }),
  preset('laurel-calf', 'Laureate Calf', 'square', 'polished-calf', ['calf-laurel-wreath'], true, 4, ['formal', 'natural', 'refined'], { group: 'leather', tier: 'shelf' }),

  preset('russia-folio', 'Russia Folio', 'double-hinge', 'russia-calf', ['russia-folio-panels'], true, 5, ['formal', 'scholarly', 'severe'], { group: 'leather', tier: 'signature' }),
  preset('russia-blind', 'Blind Russia', 'tight-back', 'russia-calf', ['russia-blind-fillet'], false, 5, ['sober', 'antique', 'severe'], { group: 'leather', tier: 'shelf' }),
  preset('russia-crown', 'Formal Russia', 'square', 'russia-calf', ['russia-crown-bay'], true, 3, ['formal', 'luxe', 'antique'], { group: 'leather', tier: 'shelf' }),
  preset('russia-scholar', 'Russia Scholar', 'tight-back', 'russia-calf', ['russia-scholar-bands'], false, 5, ['scholarly', 'sober', 'antique'], { group: 'leather', tier: 'shelf' }),

  preset('roan-schoolbook', 'Roan Schoolbook', 'square', 'roan', ['plain'], false, 7, ['plain', 'utilitarian', 'antique'], { group: 'leather', tier: 'signature' }),
  preset('roan-fillet', 'Roan School Fillet', 'tight-back', 'roan', ['roan-school-fillet'], false, 5, ['plain', 'formal', 'antique'], { group: 'leather', tier: 'shelf' }),
  preset('roan-botanical', 'Botanical Roan', 'double-hinge', 'roan', ['roan-botanical-sprig'], false, 4, ['natural', 'handmade', 'antique'], { group: 'leather', tier: 'shelf' }),
  preset('roan-terminal', 'Terminal-Bay Roan', 'tight-back', 'roan', ['roan-terminal-bays'], true, 4, ['refined', 'handmade', 'formal'], { group: 'leather', tier: 'shelf' }),

  preset('oilcloth-logbook', 'Oilcloth Logbook', 'square', 'oilcloth', ['plain'], false, 6, ['utilitarian', 'battered', 'sober'], { group: 'leather', tier: 'signature' }),
  preset('oilcloth-rules', 'Ledger Oilcloth', 'tight-back', 'oilcloth', ['oilcloth-ledger-fillet'], false, 5, ['utilitarian', 'formal', 'sober'], { group: 'leather', tier: 'shelf' }),
  preset('oilcloth-terminal', 'Terminal Oilcloth', 'double-hinge', 'oilcloth', ['oilcloth-terminal-bands'], false, 4, ['utilitarian', 'handmade', 'refined'], { group: 'leather', tier: 'shelf' }),

  /* --------------------------- vellum and parchment ------------------------ */
  preset('plain-vellum', 'Plain Vellum', 'square', 'vellum', ['plain'], false, 7, ['antique', 'devotional', 'refined'], { group: 'vellum', tier: 'signature' }),
  preset('vellum-folio', 'Vellum Folio', 'tight-back', 'vellum', ['vellum-folio-bays'], false, 5, ['formal', 'scholarly', 'antique'], { group: 'vellum', tier: 'signature' }),
  preset('vellum-terminal', 'Fleuron Vellum', 'double-hinge', 'vellum', ['vellum-terminal-fleuron'], true, 4, ['refined', 'devotional', 'formal'], { group: 'vellum', tier: 'shelf' }),
  preset('vellum-laurel', 'Laureate Vellum', 'square', 'vellum', ['vellum-laurel-panel'], true, 4, ['formal', 'natural', 'antique'], { group: 'vellum', tier: 'shelf' }),
  preset('vellum-abbey', 'Abbey Vellum', 'tight-back', 'vellum', ['vellum-abbey-fillet'], false, 5, ['devotional', 'sober', 'antique'], { group: 'vellum', tier: 'shelf' }),

  preset('parchment-quarto', 'Parchment Quarto', 'square', 'parchment', ['parchment-quarto-bands'], false, 6, ['antique', 'handmade', 'scholarly'], { group: 'vellum', tier: 'signature' }),
  preset('parchment-blind', 'Blind Parchment', 'tight-back', 'parchment', ['parchment-blind-bays'], false, 5, ['sober', 'antique', 'handmade'], { group: 'vellum', tier: 'shelf' }),
  preset('parchment-sprig', 'Parchment Herbarium', 'double-hinge', 'parchment', ['parchment-herbarium-sprig'], false, 4, ['natural', 'handmade', 'antique'], { group: 'vellum', tier: 'shelf' }),
  preset('parchment-fleuron', 'Fleuron Parchment', 'tight-back', 'parchment', ['parchment-fleuron-panel'], false, 4, ['refined', 'handmade', 'scholarly'], { group: 'vellum', tier: 'shelf' }),
  preset('parchment-scholar', 'Scholar’s Parchment', 'square', 'parchment', ['parchment-scholar-fillet'], false, 5, ['scholarly', 'sober', 'antique'], { group: 'vellum', tier: 'shelf' }),

  /* -------------------------------- wrappers ------------------------------- */
  preset('plain-wrapper', 'Plain Wrapper', 'square', 'paper-wrapper', ['plain'], false, 7, ['plain', 'pocket', 'utilitarian'], { group: 'wrappers', tier: 'signature' }),
  preset('ruled-wrapper', 'Fold-Fillet Wrapper', 'tight-back', 'paper-wrapper', ['wrapper-ruled-fold'], false, 5, ['plain', 'scholarly', 'utilitarian'], { group: 'wrappers', tier: 'shelf' }),
  preset('printers-wrapper', 'Printer’s Wrapper', 'double-hinge', 'paper-wrapper', ['wrapper-printers-imprint'], false, 4, ['refined', 'handmade', 'scholarly'], { group: 'wrappers', tier: 'shelf' }),
  preset('botanical-wrapper', 'Botanical Wrapper', 'square', 'paper-wrapper', ['wrapper-botanical-sprig'], false, 4, ['natural', 'handmade', 'plain'], { group: 'wrappers', tier: 'shelf' }),
  preset('archive-wrapper', 'Archive Fillet Wrapper', 'tight-back', 'paper-wrapper', ['wrapper-archive-sewn'], false, 5, ['scholarly', 'utilitarian', 'sober'], { group: 'wrappers', tier: 'shelf' }),

  /* --------------------------- split constructions ------------------------ */
  preset('half-calf', 'Half Calf', 'tight-back', 'half-bound', ['half-calf-material-bands'], true, 7, ['formal', 'refined', 'antique'], { group: 'halfQuarter', tier: 'signature' }),
  preset('half-oxford', 'Oxford Half Binding', 'square', 'half-bound', ['half-oxford-compartments'], true, 5, ['formal', 'scholarly', 'refined'], { group: 'halfQuarter', tier: 'shelf' }),
  preset('half-laurel', 'Oak Half Binding', 'double-hinge', 'half-bound', ['half-laurel-panel'], true, 4, ['formal', 'natural', 'antique'], { group: 'halfQuarter', tier: 'shelf' }),

  preset('quarter-calf', 'Quarter Calf', 'square', 'quarter-bound', ['quarter-calf-bands'], true, 7, ['formal', 'plain', 'antique'], { group: 'halfQuarter', tier: 'signature' }),
  preset('quarter-cloth', 'Quarter Cloth', 'tight-back', 'quarter-bound', ['plain'], false, 7, ['plain', 'utilitarian', 'sober'], { group: 'halfQuarter', tier: 'signature' }),
  preset('quarter-scholar', 'Scholar’s Quarter Binding', 'double-hinge', 'quarter-bound', ['quarter-scholar-bays'], false, 5, ['scholarly', 'formal', 'sober'], { group: 'halfQuarter', tier: 'shelf' }),
  preset('quarter-botanical', 'Botanical Quarter Binding', 'square', 'quarter-bound', ['quarter-botanical-sprig'], false, 4, ['natural', 'handmade', 'refined'], { group: 'halfQuarter', tier: 'shelf' }),

  preset('three-quarter-morocco', 'Three-Quarter Corded Binding', 'tight-back', 'three-quarter', ['three-quarter-corded'], true, 5, ['luxe', 'formal', 'antique'], { group: 'halfQuarter', tier: 'signature' }),
  preset('three-quarter-folio', 'Three-Quarter Folio', 'double-hinge', 'three-quarter', ['three-quarter-folio-bays'], true, 4, ['formal', 'scholarly', 'heavy'], { group: 'halfQuarter', tier: 'shelf' }),
  preset('three-quarter-crown', 'Three-Quarter State Binding', 'square', 'three-quarter', ['three-quarter-crown'], true, 3, ['luxe', 'formal', 'gilt'], { group: 'halfQuarter', tier: 'shelf' }),

  preset('half-cloth', 'Half Cloth', 'square', 'half-cloth-paper', ['plain'], false, 7, ['plain', 'cosy', 'handmade'], { group: 'halfQuarter', tier: 'signature' }),
  preset('half-cloth-botanical', 'Herbarium Half Cloth', 'tight-back', 'half-cloth-paper', ['half-cloth-herbarium'], false, 5, ['natural', 'handmade', 'refined'], { group: 'halfQuarter', tier: 'shelf' }),
  preset('half-cloth-prize', 'Starflower Prize Half Cloth', 'double-hinge', 'half-cloth-paper', ['half-cloth-prize-laurel'], true, 4, ['formal', 'cosy', 'gilt'], { group: 'halfQuarter', tier: 'shelf' }),
  preset('half-cloth-printers', 'Printer’s Half Cloth', 'square', 'half-cloth-paper', ['half-cloth-printers'], false, 4, ['refined', 'handmade', 'scholarly'], { group: 'halfQuarter', tier: 'shelf' }),

];

/** The one formal binding used for every hard-reset recovery. */
export const FORMAL_BOOK_PRESET_ID = 'gilt-quarto' as const;

/** Every pre-reset preset, retained only as an id registry for hard migration. */
const HISTORICAL_BOOK_PRESETS: readonly BookPreset[] = byRank(PRESET_ROWS, PRESET_GROUPS);

/**
 * A small public sample of the historical compositions explicitly called out
 * during the visual audit. The full retired roster is exported below.
 */
export const CURATED_RETIRED_BOOK_PRESET_IDS = [
  'felt-pocketbook',
  'velvet-missal',
  'cushioned-album',
  'shell-corner-keepsake',
  'laced-parchment-case',
  'three-quarter-set',
  'combed-marble',
] as const;

/**
 * The named bindings a reader can choose now.
 *
 * This is the new authored collection in its own right. It is never obtained
 * by filtering the historical catalogue, so a later change to an old row
 * cannot accidentally revive it. Every row is square-ended, construction-led,
 * titleless on the spine and limited to one coherent tooling programme.
 */
const COVER_LABEL_PRESET_SET: ReadonlySet<string> = new Set(
  HISTORICAL_BOOK_PRESETS
    .filter((preset) => preset.decorations.includes('label-plate'))
    .map((preset) => preset.id),
);

/** Whether this historical binding asks the FRONT COVER for a label treatment. */
export function bookPresetWantsCoverTitle(id: string): boolean {
  return COVER_LABEL_PRESET_SET.has(id);
}

export const BOOK_PRESETS: readonly BookPreset[] = byRank(
  RESET_PRESET_ROWS,
  PRESET_GROUPS,
);

/** The id of one of the presets above. */
export type BookPresetId = string;

const PRESET_BY_ID: ReadonlyMap<string, BookPreset> = new Map(
  BOOK_PRESETS.map((p) => [p.id, p] as const),
);

/** Concepts explicitly purged by the premium-binding reset. */
export const RESET_RETIRED_BOOK_PRESET_IDS = [
  'scholar-cloth',
  'formal-felt',
  'felt-fleuron',
  'felt-library',
  'heraldic-calf',
  'oilcloth-architect',
  'tips-and-bands',
  'half-heraldic',
  'tips-heraldic',
  'tips-corners',
  'tips-fillet',
] as const;

/** Historical and reset-era named bindings absent from picker/Surprise. */
export const RETIRED_BOOK_PRESET_IDS: readonly string[] = [
  ...new Set([
    ...HISTORICAL_BOOK_PRESETS
      .filter((preset) => !PRESET_BY_ID.has(preset.id))
      .map((preset) => preset.id),
    ...RESET_RETIRED_BOOK_PRESET_IDS,
  ]),
];

const RETIRED_PRESET_SET: ReadonlySet<string> = new Set(RETIRED_BOOK_PRESET_IDS);

/** Every preset id, in list order (the studio's dropdown). */
export const BOOK_PRESET_IDS: readonly string[] = BOOK_PRESETS.map((p) => p.id);

/* ---------------------------- surprise directions ----------------------- */

/** A coherent visual direction for the Book Studio's Surprise action. */
export interface BookSurpriseDirection {
  id: string;
  label: string;
  hint: string;
  /** Explicitly art-directed bindings. Never inferred from intersecting tags. */
  presetIds: readonly string[];
}

/**
 * Art-directed binding pools.
 *
 * These echo the room studio's useful language, but every list was composed at
 * the WHOLE-BOOK level. A tag intersection is not enough: "ornate" can mean a
 * velvet missal, a novelty paper or a crocodile case, and blindly crossing
 * those axes is precisely how a randomiser produces costume rather than a
 * binding. Each pool therefore names finished books with a coherent material,
 * silhouette and tooling density.
 */
export const BOOK_SURPRISE_DIRECTIONS = [
  {
    id: 'formal',
    label: 'Formal',
    hint: 'Crisp joints, measured rules and restrained construction.',
    presetIds: [
      'gilt-quarto',
      'oxford-cloth',
      'printers-cloth',
      'library-fillet-cloth',
      'folio-cloth',
      'buckram-oxford',
      'buckram-folio',
      'oxford-calf',
      'calf-compartments',
      'russia-folio',
      'half-calf',
      'quarter-scholar',
    ],
  },
  {
    id: 'grand',
    label: 'Grand',
    hint: 'Velvet, calf and gilt arranged around one formal focal programme.',
    presetIds: [
      'velvet-crown',
      'velvet-palmette',
      'velvet-ducal',
      'royal-calf',
      'russia-crown',
      'vellum-terminal',
      'three-quarter-crown',
      'three-quarter-folio',
      'prize-cloth',
      'half-cloth-prize',
      'half-laurel',
      'calf-compartments',
    ],
  },
  {
    id: 'antique',
    label: 'Antique',
    hint: 'Blind rules, calf, parchment and split boards with old-library restraint.',
    presetIds: [
      'cambridge-cloth',
      'cambridge-calf',
      'russia-blind',
      'russia-scholar',
      'roan-fillet',
      'vellum-abbey',
      'parchment-blind',
      'parchment-quarto',
      'blind-calf',
      'quarter-calf',
      'three-quarter-morocco',
      'vellum-folio',
    ],
  },
  {
    id: 'storybook',
    label: 'Storybook',
    hint: 'Warm tactile bindings and one small fleuron or terminal flourish.',
    presetIds: [
      'library-fillet-cloth',
      'buckram-library',
      'ruled-wrapper',
      'linen-commonplace',
      'linen-printers',
      'roan-schoolbook',
      'roan-terminal',
      'plain-wrapper',
      'printers-wrapper',
      'half-cloth-printers',
      'botanical-wrapper',
      'half-cloth-prize',
    ],
  },
  {
    id: 'botanical',
    label: 'Botanical',
    hint: 'Linen, parchment and calf with one short leaf or laurel programme.',
    presetIds: [
      'botanical-cloth',
      'prize-cloth',
      'linen-botanical',
      'laurel-calf',
      'roan-botanical',
      'vellum-laurel',
      'parchment-sprig',
      'botanical-wrapper',
      'half-laurel',
      'quarter-botanical',
      'half-cloth-botanical',
    ],
  },
  {
    id: 'cosy',
    label: 'Cosy',
    hint: 'Soft cloth, linen, roan and quiet half bindings.',
    presetIds: [
      'plain-cloth',
      'library-fillet-cloth',
      'linen-commonplace',
      'linen-botanical',
      'botanical-wrapper',
      'roan-botanical',
      'roan-schoolbook',
      'plain-wrapper',
      'half-cloth',
      'half-cloth-prize',
      'parchment-fleuron',
      'quarter-cloth',
    ],
  },
  {
    id: 'rustic',
    label: 'Rustic',
    hint: 'Linen, roan, oilcloth and parchment kept sturdy and simple.',
    presetIds: [
      'linen-scholar',
      'oilcloth-logbook',
      'oilcloth-rules',
      'oilcloth-terminal',
      'buckram-cambridge',
      'parchment-quarto',
      'parchment-scholar',
      'ruled-wrapper',
      'quarter-botanical',
      'half-cloth',
      'roan-botanical',
      'archive-wrapper',
    ],
  },
  {
    id: 'quiet',
    label: 'Quiet',
    hint: 'Plain cloth, sober joints and very little surface furniture.',
    presetIds: [
      'plain-cloth',
      'library-fillet-cloth',
      'buckram-library',
      'buckram-cambridge',
      'plain-calf',
      'blind-calf',
      'plain-vellum',
      'vellum-folio',
      'parchment-scholar',
      'archive-wrapper',
      'quarter-cloth',
      'half-oxford',
    ],
  },
] as const satisfies readonly BookSurpriseDirection[];

export type BookSurpriseDirectionId = (typeof BOOK_SURPRISE_DIRECTIONS)[number]['id'];

const SURPRISE_DIRECTION_BY_ID: ReadonlyMap<string, BookSurpriseDirection> = new Map(
  BOOK_SURPRISE_DIRECTIONS.map((direction) => [direction.id, direction] as const),
);

/** Every vetted surprise id, de-duplicated in direction order. */
const SURPRISE_PRESET_ID_SET: ReadonlySet<string> = new Set(
  BOOK_SURPRISE_DIRECTIONS.flatMap((direction) => direction.presetIds),
);

/* ------------------------- bindings built by hand ------------------------- */

/**
 * A binding a reader composed themselves, as an id.
 *
 * `BOOK_PRESETS` is the authored finished-book collection. The three active
 * axes are also independently pickable in the studio, and their complete
 * cross-product cannot sensibly be another named table.
 *
 * So a composed binding is written as `own:shape/material/decoration/gilt` and
 * resolved on read. That is deliberately an ID rather than a new shape of
 * stored value: `designPrefs` persists `Record<bookId, BookPresetId>`,
 * `SpineParams.binding` passes it through untouched, and the ONE cache that
 * varies with a binding — `SpineFactory.paramsCache`, keyed
 * `${styleEpoch}|${bookId}|${pinned}` — carries that same string. Widening the
 * stored type would have meant a migration, a second validator, and a new axis
 * for that key to forget.
 *
 * Which is why the id must spell every axis out. It is not a label for a
 * binding, it IS the binding as far as the params cache can tell: two composed
 * bindings that agreed on their id would share one cached `ResolvedBookStyle`
 * and one of them would be served the other's spine, silently, until something
 * else happened to invalidate the book. `ownBindingId` is therefore required to
 * be injective over `OwnBinding`, and `tests/design-cache-keys.test.ts` sweeps
 * it. (An earlier version of this comment credited `bookDesignTag` with the
 * same duty; no cache has ever consulted that function — see its own header.)
 *
 * `decoration` may be `none`, which is how a reader takes the marks off.
 *
 * GILT IS ITS OWN SEGMENT because the preset table says it has to be. It looks
 * derivable and is not: the same uninterrupted fillet can be struck blind or
 * in foil. It is an editorial choice about the whole book, so a reader
 * composing one gets to make it rather than have it guessed from the mark.
 */
const OWN_PREFIX = 'own:';

// A composed id is valid only when every axis is still offered. The diagnostic
// renderer tables remain larger so we can recognise what changed, but carrying one
// retired part forward would preserve the very non-book silhouette the safety
// migration is meant to remove.
const SHAPE_SET = ACTIVE_SHAPE_SET;
const MATERIAL_SET = ACTIVE_MATERIAL_SET;
const DECOR_SET = ACTIVE_DECOR_SET;

/** The axes of a hand-composed binding. */
export interface OwnBinding {
  shape: SpineShape;
  material: MaterialLook;
  decoration: Decoration | 'none';
  gilt: boolean;
}

/** Compose an id for a hand-picked binding. */
export function ownBindingId(parts: OwnBinding): BookPresetId {
  const foil = parts.gilt ? 'gilt' : 'blind';
  return `${OWN_PREFIX}${parts.shape}/${parts.material}/${parts.decoration}/${foil}`;
}

/** The axes of an id, or null when it is not a composed one this build knows. */
export function parseOwnBinding(id: BookPresetId | null | undefined): OwnBinding | null {
  if (typeof id !== 'string' || !id.startsWith(OWN_PREFIX)) return null;
  const [shape, material, decoration, foil, ...rest] = id.slice(OWN_PREFIX.length).split('/');
  if (rest.length > 0) return null;
  if (shape === undefined || material === undefined || decoration === undefined) return null;
  if (foil !== 'gilt' && foil !== 'blind') return null;
  // Validated part by part, so one stale axis cannot smuggle the other two
  // past — an unknown name here means the vocabulary changed under a saved
  // choice, and the whole id is then not a binding this build can draw.
  if (!SHAPE_SET.has(shape) || !MATERIAL_SET.has(material)) return null;
  if (decoration !== 'none' && !DECOR_SET.has(decoration)) return null;
  return {
    shape: shape as SpineShape,
    material: material as MaterialLook,
    decoration: decoration as Decoration | 'none',
    gilt: foil === 'gilt',
  };
}

/**
 * The preset a composed id stands for.
 *
 * Spread from the first preset so that every field this interface grows in
 * future has a value here without this function being edited — the four the
 * reader chose are then written over it. `weight` is inherited and meaningless:
 * a composed binding is never rolled, only chosen.
 */
function ownPreset(parts: OwnBinding): BookPreset {
  const base = PRESET_BY_ID.get(FORMAL_BOOK_PRESET_ID) as BookPreset;
  return {
    ...base,
    id: ownBindingId(parts),
    label: 'your own',
    shape: parts.shape,
    material: parts.material,
    decorations: parts.decoration === 'none' ? [] : [parts.decoration],
    gilt: parts.gilt,
  };
}

/**
 * Look up a preset.
 *
 * Unknown ids and every retired id become the same formal safe binding. The
 * reset deliberately has no appearance-preserving exceptions: retaining one
 * brocade field or one legacy panel would keep the failed system alive through
 * a side door.
 */
export function bookPreset(id: BookPresetId | null | undefined): BookPreset {
  const own = parseOwnBinding(id);
  if (own !== null) return ownPreset(own);
  return (
    (id ? PRESET_BY_ID.get(id) : undefined) ??
    (PRESET_BY_ID.get(FORMAL_BOOK_PRESET_ID) as BookPreset)
  );
}

/**
 * Has this finished binding already spent its one authored motif programme?
 *
 * Named and `own:` bindings take the same path so Surprise, the surface
 * resolver and the Studio do not each invent a slightly different definition
 * of "already ornamented" before deciding whether to add the separate emblem.
 */
export function bookPresetHasAuthoredFocal(
  id: string | null | undefined,
): boolean {
  return bookPreset(id).decorations.some(decorationHasFocalTool);
}

/**
 * The one broad tool a finished binding already owns, if any.
 *
 * The shelf renderer consumes the whole authored programme. Cover projection
 * needs only this semantic identity so it can carry the same focal hierarchy
 * onto the front board without enlarging a shelf glyph or re-rolling another
 * ornament. Keeping the lookup beside `PROGRAMME_ARCHETYPES` prevents the two
 * surfaces from inferring meaning from decoration names.
 */
export function bookPresetAuthoredFocalGlyph(
  id: string | null | undefined,
): BroadFocalGlyph | null {
  const decoration = bookPreset(id).decorations.find(decorationHasFocalTool);
  if (decoration === undefined) return null;
  return PROGRAMME_ARCHETYPES[decoration as AuthoredSpineProgramId]?.glyph ?? null;
}

export function isBookPresetId(v: unknown): v is BookPresetId {
  if (typeof v !== 'string') return false;
  return PRESET_BY_ID.has(v) || parseOwnBinding(v) !== null;
}

/** Was this once a named binding but deliberately removed from new choices? */
export function isRetiredBookPresetId(v: unknown): v is string {
  return typeof v === 'string' && RETIRED_PRESET_SET.has(v);
}

/**
 * Repair a stored binding id.
 *
 * `null` still means "let this book's seed choose". Any stored STRING that no
 * longer names a supported binding — an unrepaired retired preset, a retired
 * `own:` axis, or data written by a future/experimental build — becomes the
 * conservative formal binding. This is intentionally different from dropping
 * an unsupported id: dropping would hand authority back to the seed. The hard
 * fallback is deterministic and makes the reset forceful on every old library.
 */
export function normaliseBookPresetId(v: unknown): BookPresetId | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return null;
  return isBookPresetId(v) ? v : FORMAL_BOOK_PRESET_ID;
}

/**
 * A binding is only ever as good as its worst part.
 *
 * `BookPreset.tier` says so in prose and used to be the only gate, which is how
 * the second report happened: a preset writes its own tier down by hand, so a
 * `niche` named binding could sit on a silhouette that reads as a step-ladder
 * and nothing anywhere disagreed with it. Fifteen of them did.
 *
 * This makes the sentence load-bearing. A preset is rollable only if it AND
 * every vocabulary row it names is rollable — so demoting a shape now demotes
 * every binding built on it, whatever those bindings say about themselves, and
 * a fifty-first silhouette that turns out to be a stapler cannot leak back onto
 * a shelf through a preset somebody forgot to re-rank.
 *
 * Deliberately a floor and not a recomputation of the tier: the ORDER of the
 * studio's list stays hand-written (a table that decides its own order is one
 * nobody can overrule), and this only ever removes from the dice.
 */
function worstPartRollable(p: BookPreset): boolean {
  if (!ACTIVE_SHAPE_SET.has(p.shape)) return false;
  if (!ACTIVE_MATERIAL_SET.has(p.material)) return false;
  return p.decorations.every((decoration) => ACTIVE_DECOR_SET.has(decoration));
}

/**
 * The bindings the dice may hand out.
 *
 * Surprise draws only from the active reset collection. Former catalogue rows
 * remain diagnostic data solely so old stored ids can be recognised and
 * migrated to the formal safe binding.
 */
export const ROLLABLE_PRESETS: readonly BookPreset[] = BOOK_PRESETS.filter(
  (p) => SURPRISE_PRESET_ID_SET.has(p.id) && isRollable(p.tier) && worstPartRollable(p),
);

function pickWeightedBookPreset(pool: readonly BookPreset[], seed: number): BookPreset {
  const safePool = pool.length > 0 ? pool : [bookPreset(FORMAL_BOOK_PRESET_ID)];
  const total = safePool.reduce((sum, preset) => sum + Math.max(1, preset.weight), 0);
  let acc = mulberry32(seed >>> 0)() * total;
  for (const preset of safePool) {
    acc -= Math.max(1, preset.weight);
    if (acc < 0) return preset;
  }
  return safePool[safePool.length - 1] as BookPreset;
}

function surpriseDirectionSalt(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Choose one complete, coherent binding inside a named direction.
 *
 * Passing `null` means anything, but "anything" is still the union of the
 * vetted direction pools rather than all legal axis combinations. The seed is
 * required so the studio can avoid repeating its current id without making
 * the art layer non-deterministic, and so tests can sweep thousands of rolls.
 */
export function surpriseBookPreset(
  direction: BookSurpriseDirectionId | null,
  seed: number,
): BookPreset {
  const descriptor = direction === null ? null : SURPRISE_DIRECTION_BY_ID.get(direction);
  const pool = descriptor
    ? descriptor.presetIds
        .map((id) => PRESET_BY_ID.get(id))
        .filter((preset): preset is BookPreset => preset !== undefined)
    : ROLLABLE_PRESETS;
  const salt = descriptor ? surpriseDirectionSalt(descriptor.id) : 0xb00d5e1;
  return pickWeightedBookPreset(pool, (seed ^ salt) >>> 0);
}

/**
 * Which binding a seed lands on. Weighted, so a shelf comes out mostly plain
 * cloth and wrappers with the expensive bindings as punctuation — the same
 * reason `spines.ts` rolls a thickness class before a thickness.
 *
 * **This is the randomiser the gate is on.** It is what a new book rolls
 * through `resolveBookDesign`, what "surprise me" in the Book Studio calls, and
 * the only binding decision a reader who never opens the studio ever meets, so
 * it walks `ROLLABLE_PRESETS` and not the whole table.
 */
export function presetForSeed(seed: number): BookPreset {
  return surpriseBookPreset(null, seed);
}

/* ========================================================================== *
 *                                  resolve                                   *
 * ========================================================================== */

export interface ResolveBookDesignOptions {
  /** The book's 32-bit art seed. */
  seed: number;
  /**
   * The book's cloth: an index (callers pass `clothForPalette(params.palette)`)
   * or the reader's own `#rrggbb`. See `BookDesign.cloth`.
   */
  cloth?: number | string;
  /**
   * `cloth` is the reader's dedicated spine-base choice, not the shared cloth
   * inherited by the whole book. Pale coverings retain their natural colour
   * unless this bit is true.
   */
  baseColourPinned?: boolean;
  /** Second cloth. Defaults to one the seed picks, never equal to `cloth`. */
  accent?: number | string;
  /** Rules, frames and spine tooling. A custom hex overrides gilt/blind ink. */
  tooling?: string | null;
  /** Centred stamps and medallions. Null inherits the tooling convention. */
  emblem?: string | null;
  /** Clasps, corner pieces and other metalwork. */
  hardware?: string | null;
  /** Pin the binding (the studio's picker). Omit to let the seed choose. */
  preset?: BookPresetId | null;
  /** Force foil on or off, overriding the preset's own answer. */
  gilt?: boolean;
  /** Preferred focal compartment for cords and the optional ornament, 0..1. */
  focusAt?: number;
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
  // A reader's own hex is kept AS a hex; only a house cloth has a slot. The
  // slot is still computed either way, because the accent and the "not the
  // same colour twice" guard below are index arithmetic — a custom cloth
  // leaves the second colour where the seed put it rather than dragging the
  // half-binding leather along with it.
  const ownCloth = normaliseHex(opts.cloth);
  const slot = normIndex(
    typeof opts.cloth === 'number' ? opts.cloth : seed % CLOTHS.length,
    CLOTHS.length,
  );
  const cloth: number | string = ownCloth ?? slot;
  // The accent must never equal the cloth: a half binding whose leather is the
  // same colour as its boards is just a plain book with a stray line on it.
  const ownAccent = normaliseHex(opts.accent);
  const accentSlot = normIndex(
    typeof opts.accent === 'number'
      ? opts.accent
      : slot + 1 + (((seed >>> 5) % (CLOTHS.length - 1)) | 0),
    CLOTHS.length,
  );
  const accent: number | string =
    ownAccent ?? (accentSlot === slot ? normIndex(slot + 1, CLOTHS.length) : accentSlot);
  const gilt = opts.gilt ?? chosen.gilt;
  const bands = clamp(Math.round(opts.bands ?? 0), 0, 3);
  // Raised cords already divide the spine horizontally. A second terminal-rule
  // programme on top turns even a good straight book into a ladder, so the
  // resolver—not just Surprise—owns the invariant for every direct/manual path.
  const decorations: readonly Decoration[] =
    bands > 0 && chosen.decorations.some(decorationHasHorizontalRules)
      ? ['plain']
      : chosen.decorations;
  return {
    preset: chosen.id,
    shape: opts.shape ?? chosen.shape,
    material: opts.material ?? chosen.material,
    decorations,
    cloth,
    baseColourPinned: opts.baseColourPinned === true,
    accent,
    tooling: normaliseHex(opts.tooling),
    emblem: normaliseHex(opts.emblem),
    hardware: normaliseHex(opts.hardware),
    gilt,
    focusAt: clamp(opts.focusAt ?? 0.24, 0.16, 0.48),
    seed,
    bands,
    bandGilt: opts.bandGilt ?? gilt,
    headTail:
      opts.headTail === null || opts.headTail === undefined
        ? null
        : clamp(Math.round(opts.headTail), 1, 3),
    wear: clamp(opts.wear ?? 0, 0, 1),
  };
}

/**
 * The studio's seven coarse covering chips, folded onto active reset looks.
 * Every emitted look is accepted by `ROLLABLE_MATERIALS`; a coarse override can
 * therefore never resurrect brocade, pebble grain, marbling, scale fields or
 * any other retired surface behind a safe named binding.
 */
export const MATERIAL_LOOK_FOR_BINDING: Readonly<Record<string, MaterialLook>> = {
  leather: 'polished-calf',
  cloth: 'smooth-cloth',
  paper: 'paper-wrapper',
  vellum: 'vellum',
  linen: 'linen',
  silk: 'velvet',
  // The old chip name remains a storage/API value. Its safe visual answer is a
  // split cloth-and-paper construction, not an all-over faux-marble bitmap.
  marbled: 'half-cloth-paper',
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
    case 'sprig-paper-sides':
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
    case 'half-cloth-paper':
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

/**
 * One resolved binding, reduced to a single comparable string.
 *
 * ## It is not a cache key, whatever this comment used to say
 *
 * It said "**every cache that stores drawn book pixels must carry this**", and
 * `bookStyle.ts` and `spines.ts` repeated it. Nothing in `src/` calls this
 * function; its only callers are tests. The spine caches are
 * INVALIDATION-keyed rather than content-keyed, and that is a deliberate
 * design, not an oversight:
 *
 *   - `SpineFactory.paramsCache` is `${styleEpoch}|${bookId}|${pinned}`. The
 *     pin is in it because a binding lives in `data/designPrefs.ts`, outside
 *     `cover_meta`, where `bookStyleOverridesFor` cannot see it — so nothing
 *     else would notice it moving.
 *   - the atlas key is `${variant}|${bookId}` and carries no binding at all.
 *
 * Every other axis spelled below — cloth, accent, wear, cords, endbands,
 * silhouette, covering — reaches the shelf only through a studio edit or a
 * room change, and both of those call `SpineFactory.invalidate` /
 * `invalidateAll`, which DROP the baked texture and release the atlas rect
 * instead of keying around them.
 *
 * Checked on the running shelf rather than argued: with `styleEpoch` held at 1
 * and the pin held at `plain-cloth`, a Book Studio edit repainted 14.7% of the
 * spine's crop; pinning and unpinning moved the art both ways; and unpinning
 * restored the seeded binding byte-for-byte (0 differing pixels), which is the
 * cache being right rather than the cache being absent.
 *
 * ## What it IS for
 *
 * "Are these two resolved bindings different pixels?", answered as one string
 * two tests can compare. That is the observable `tests/book-bindings.test.ts`
 * and `tests/design-cache-keys.test.ts` use to prove that the archival
 * vocabularies and current active subset do not collapse different bindings
 * onto one pixel identity — which is not something a specimen board can establish,
 * because a board shows what a binding looks like and never that two of them
 * look different. It is also the tag a content-keyed spine cache would carry
 * if one is ever built, which is why the separators below are still exact.
 *
 * The shape is spelled out separately from the preset because `resolveBookDesign`
 * can be handed one directly: two books on the same preset with different
 * silhouettes are different pixels and must be different strings.
 */
export function bookDesignTag(design: BookDesign): string {
  // The studio's four axes belong here for the same reason the preset does:
  // they change pixels, so a tag that ignored them would call a pristine
  // binding and a worn-out one the same binding.
  //
  // EVERY numeric field is separated. They used to be concatenated bare, which
  // was unambiguous only while each was a single digit: with cloths at 50,
  // cloth 1 + accent 23 and cloth 12 + accent 3 both spell "123" — so the
  // string said two different bindings were the same one, and the test that
  // was meant to prove the fifty cloths are fifty distinct bindings passed
  // anyway. The separators are load-bearing, not tidiness.
  return [
    design.preset,
    design.seed,
    design.shape,
    design.cloth,
    design.baseColourPinned ? 'own-base' : 'inherited-base',
    design.accent,
    design.tooling ?? '-',
    design.emblem ?? '-',
    design.hardware ?? '-',
    design.gilt ? 'g' : 'n',
    design.material,
    design.bands,
    design.bandGilt ? 'g' : 'n',
    design.headTail ?? '-',
    design.focusAt.toFixed(4),
    design.decorations.join(','),
    design.wear.toFixed(4),
  ].join('.');
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

/**
 * A cloth's two faces, from a house slot OR from a colour the reader typed.
 *
 * The hex branch does not look anything up: `palette.clothPair` folds an
 * arbitrary colour the same way the fifty in `flat.ts` were folded (one
 * measured OKLCh step down, a little chroma into the dark, a couple of degrees
 * warmer, and a floor that keeps the turned face above `FLAT.ink`). So a
 * reader's colour arrives as a cloth rather than as a flat rectangle, and the
 * one thing this style cannot do without — an ink outline you can still see —
 * survives every hex anybody can type.
 */
function clothPair(value: number | string): readonly [string, string] {
  if (typeof value === 'string') {
    const hex = normaliseHex(value);
    if (hex !== null) return foldCloth(hex);
  }
  const index = typeof value === 'number' ? value : 0;
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

/** One authoritative fold for the reader's tooling role. */
function toolingColour(design: BookDesign, board: string, blind = false): string {
  const authored = design.tooling ?? (blind ? FLAT.inkSoft : design.gilt ? FLAT.gilt : FLAT.inkSoft);
  return rubbed(authored, board, design.wear);
}

/** A stamp may differ from its frame, but inherits it when unset. */
function emblemColour(design: BookDesign, board: string, blind = false): string {
  const authored =
    design.emblem ??
    design.tooling ??
    (blind ? FLAT.inkSoft : design.gilt ? FLAT.gilt : FLAT.inkSoft);
  return rubbed(authored, board, design.wear);
}

/** Fittings retain their authored metal unless the reader pins this role. */
function hardwareColour(design: BookDesign, authored: string, board: string): string {
  return rubbed(design.hardware ?? authored, board, design.wear);
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
      if (!design.baseColourPinned) return [FLAT.cream, FLAT.creamDeep];
      if (normaliseHex(design.cloth) === FLAT.cream) {
        return [FLAT.cream, FLAT.creamDeep];
      }
      // Vellum is still vellum after it is coloured: retain the pale ground
      // and let roughly two fifths of the chosen dye remain. This is strong
      // enough to read on a 30px shelf spine without turning the material into
      // ordinary cloth.
      {
        const tinted = mix(face, FLAT.cream, 0.6);
        return [tinted, mix(tinted, FLAT.ink, 0.2)];
      }
    case 'parchment':
      if (!design.baseColourPinned) {
        return [FLAT.creamDeep, mix(FLAT.creamDeep, FLAT.ink, 0.24)];
      }
      if (normaliseHex(design.cloth) === FLAT.creamDeep) {
        return [FLAT.creamDeep, mix(FLAT.creamDeep, FLAT.ink, 0.24)];
      }
      // Parchment is a warmer, slightly denser wash than vellum. Its source
      // still moves the face visibly, while the creamDeep paper anchor keeps
      // it from reading as smooth cloth with a different label.
      {
        const tinted = mix(face, FLAT.creamDeep, 0.54);
        return [tinted, mix(tinted, FLAT.ink, 0.24)];
      }
    case 'accent':
      return [accentFace, accentDark];
    default:
      return [face, dark];
  }
}

/**
 * The actual flat faces a resolved spine covering paints.
 *
 * Exported for recipe QA: contrast against the reader's raw swatch is not
 * enough because vellum, parchment, deep buckram and split bindings transform
 * that swatch before a tooling mark ever meets it. Pale skins ignore inherited
 * cloth but wash an explicitly pinned face colour into their paper ground.
 */
export function bookBodyColours(design: BookDesign): readonly [string, string] {
  return bodyPair(design);
}

/**
 * The two colour controls which feed the spine painter, before the material
 * turns, washes or replaces either pigment.
 *
 * These are deliberately different from {@link bookBodyColours}. A deep
 * buckram spine paints the folded face of its source cloth; natural vellum
 * discards an inherited source for cream while explicitly dyed vellum washes
 * it toward paper; a worn cloth mixes it toward paper. Book Studio needs both
 * answers: the well shows the pixels, while a Surprise lock must persist the
 * source and keep the transformations which made those pixels.
 */
export function bookColourSources(
  design: Pick<BookDesign, 'cloth' | 'accent'>,
): { base: string; accent: string } {
  const source = (value: number | string): string => {
    if (typeof value === 'string') return normaliseHex(value) ?? (CLOTHS[0]![0] as string);
    return (CLOTHS[normIndex(value, CLOTHS.length)] ?? CLOTHS[0]!)[0] as string;
  };
  return {
    base: source(design.cloth),
    accent: source(design.accent),
  };
}

/**
 * The representative flat fills actually painted for the spine's primary and
 * secondary colour roles.
 *
 * `base` is the main material face. `accent` is the secondary covering after
 * wear, used by split bindings, patterned materials, endbands and applied
 * bands. Returning the painter's resolved values keeps Studio wells truthful
 * for vellum, parchment, deep cloth, split bindings and ordinary cloth alike.
 */
export function bookPainterColours(
  design: BookDesign,
): { base: string; accent: string } {
  const [base] = bodyPair(design);
  const [accent] = fadedPair(clothPair(design.accent), design.wear);
  return { base, accent };
}

/**
 * Where a split binding's BACK covering sits on the spine.
 *
 * Half/quarter binding describes the boards: leather or cloth covers the whole
 * back, then extends by different amounts onto the boards and corners. The old
 * renderer split that second covering into horizontal spine chunks, which made
 * a strong colour pair look like two books stacked end-to-end. `covers.ts`
 * still draws the construction-specific board regions from `MaterialSpec.split`;
 * this span keeps the shelf-facing back continuous, as the object itself is.
 */
function splitSpan(split: Split): readonly (readonly [number, number])[] {
  switch (split) {
    case 'half':
    case 'quarter':
    case 'threeQuarter':
    case 'tips':
      return [[-0.02, 1.02]];
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

/** Actual covering faces at one spine-height fraction, including split skins. */
export function bookSurfaceColoursAt(
  design: BookDesign,
  fraction: number,
): readonly [string, string] {
  return surfaceAt(design, clamp(fraction, 0, 1));
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
interface SpineBoxes {
  /** The drawn book body. Many shapes stand narrower than their footprint. */
  body: DesignBox;
  /**
   * Where tooling and the optional ornament go. Identical to `body` except for the boxed
   * shapes, whose marks belong on the case rather than on the sliver of head
   * showing above it, and for the cut heads, which eat into their own top.
   */
  decor: DesignBox;
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

function shapeBoxes(spec: ShapeSpec, x: number, y: number, w: number, h: number): SpineBoxes {
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
      return run + Math.sin(Math.PI * t) * 0.095;
    case 'bulge':
      return run + Math.sin(Math.PI * t) * 0.15;
    case 'waist':
      return run - Math.sin(Math.PI * t) * 0.13;
    // A book read to death, not a book that has been leaned on: the waist goes
    // to a fifth of the width, which at 34px is seven pixels off the middle and
    // the only amount a reader picks out of a row of forty spines.
    case 'pinch':
      return run - Math.sin(Math.PI * t) * 0.2;
    case 'ripple':
      return run + Math.sin(Math.PI * 3 * t) * 0.035;
    // Rolled in a pocket: four folds, uneven, because a crease that repeats on
    // a beat reads as a moulding rather than as damage.
    case 'crumple':
      return (
        run +
        Math.sin(Math.PI * 3.6 * t + 0.4) * 0.06 +
        Math.sin(Math.PI * 7.4 * t + 2.1) * 0.028
      );
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
      // At 0.045 the lean was a pixel and a half at each end of a 34px spine
      // and `limp` sat inside the plain-rectangle cluster; a lean has to be
      // seen against its upright neighbours or it is not a lean.
      return Math.sin(Math.PI * t * 1.15 + 0.55) * 0.07;
    case 'ripple':
      return Math.sin(Math.PI * 3 * t + 1) * 0.014;
    case 'crumple':
      return Math.sin(Math.PI * 3.6 * t + 0.4) * 0.03 + Math.sin(Math.PI * 7.4 * t + 2.1) * 0.012;
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
  /*
   * A generous corner and a profiled end fight over the same span, and the
   * corner used to win — twice over.
   *
   * ACROSS: `cushioned` (corner 0.62, headWidth 0.82) left the head profile
   * 3.9px of a 27.9px edge to swell across, so the cushion's control point —
   * six pixels above the crown and under four wide — came out of the rasterizer
   * as a NIB. A padded board with a spike on it; `rolled` grew a smaller one at
   * its foot. So a corner may eat at most three tenths of a profiled end.
   *
   * DEEP: capping the width alone left a fillet 8.4px deep flanking a swell
   * 6px high, and a fillet deeper than the profile beside it INVERTS it — the
   * cushion came back as a crown with a dip on either side, which is not what a
   * padded board does either. So a fillet on a profiled end is also never
   * deeper than that profile's own reach.
   *
   * Three tenths was still too much across: at 0.62 of the width `cushioned`
   * kept 11px of a 28px edge, and a swell that has to happen in 11px is a HAT,
   * however gently the profile is written. An end that carries a profile has
   * already said how it meets its sides, so the fillet only rounds the join —
   * a sixth, no more.
   *
   * A flat end has no profile to protect and keeps the whole 0.44, which is
   * what `rounded` and `two-lobe` were tuned against.
   */
  const cornerCap = (end: EndProfile, span: number): number =>
    end === 'flat'
      ? span * 0.44
      : Math.min(span * 0.18, Math.max(1.2, END_PROFILES[end].reach * dep));
  const rH = Math.max(0, Math.min(radius, cornerCap(spec.head, hR - hL)));
  const rT = Math.max(0, Math.min(radius, cornerCap(spec.tail, tR - tL)));

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
  const brass = hardwareColour(design, FLAT.gilt, board);
  // Old wire, not new: a warm pewter mixed out of the ink, because `FLAT.slate`
  // barely tinted toward cream is a COLD blue-grey, and four books with cold
  // blue hardware on them were the only cold things on a parchment shelf.
  const steel = design.hardware ?? mix(FLAT.inkSoft, FLAT.cream, 0.5);
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
        // A cord rises UNDER the leather and stays inside the board footprint.
        // Full-footprint 2.4px pills protruded beyond the back and turned four
        // sewing stations into the rungs of a ladder at shelf width.
        const ch = Math.max(1.1, Math.min(h * 0.013, w * 0.14));
        const cx = x + w * 0.07;
        const cw = w * 0.86;
        for (let i = 0; i < RIB_STATIONS.length; i++) {
          const s = RIB_STATIONS[i] as number;
          pill(cx, y + h * s - ch / 2, cw, ch, mix(surfaceAt(design, s)[0], FLAT.ink, 0.08), 40 + i);
        }
        break;
      }
      case 'bareCords': {
        // Fatter than a covered cord, because there is no leather over these —
        // it is the rope itself, and five ropes at h*0.022 averaged away into
        // the cloth at every coarseness a reader sees a shelf at.
        const ch = Math.max(2.6, h * 0.032);
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
        /*
         * The creases where the covers hinge — the one thing that tells a flat
         * back from a rounded one at this size, and it was drawn as two
         * hairlines a twenty-fifth of the width across. On a 34px spine that is
         * one and a third pixels of a colour a third of the way to ink, which
         * is to say nothing: `tight-back` sat inside the plain-rectangle
         * cluster with `square`, `clasped` and `creased` at three of the five
         * coarsenesses measured.
         *
         * A board creased hard against a spine is a FLAT DARKER FACE beside a
         * lighter one — the way this app says depth everywhere else — with the
         * crease inked where the two meet. A tight back turns its whole joint
         * away; french grooves are two sunk channels with cloth either side,
         * which is the actual difference between the two bindings.
         */
        const deep = mix(board, FLAT.ink, 0.44);
        const crease = mix(board, FLAT.ink, 0.66);
        const bands: readonly (readonly [number, number])[] =
          mark === 'grooves'
            ? [
                [0, 0.2],
                [0.8, 1],
              ]
            : [
                [0.075, 0.15],
                [0.85, 0.925],
              ];
        ctx.save();
        traceBookShape(ctx, b, spec, seed);
        ctx.clip();
        bands.forEach(([a, bb], i) =>
          fillBand(ctx, x + w * a, y - h * 0.03, w * (bb - a), h * 1.06, deep, 0, seed + 60 + i),
        );
        ctx.restore();
        const cw2 = Math.max(1, w * 0.035);
        bands.forEach(([a, bb], i) => {
          for (const t of [a, bb]) {
            // The silhouette's own outline already inks the two outer edges.
            if (t <= 0.001 || t >= 0.999) continue;
            stroke(ctx, x + w * t, y + h * 0.03, x + w * t, y + h * 0.97, crease, cw2, seed + 64 + i * 2 + (t === a ? 0 : 1));
          }
        });
        break;
      }
      case 'stitchLine': {
        // "A folded edge" is in the blurb, and it was a single stroke a
        // fourteenth of the width — so a pamphlet was a bare sliver, which is
        // what every other bare sliver on the shelf also was. The fold is the
        // sheet doubled back on itself: a narrower, darker face down the near
        // side, with the sewing worked through it.
        ctx.save();
        traceBookShape(ctx, b, spec, seed);
        ctx.clip();
        fillBand(ctx, x - w * 0.04, y - h * 0.03, w * 0.42, h * 1.06, mix(board, FLAT.ink, 0.28), 0, seed + 69);
        ctx.restore();
        stroke(ctx, x + w * 0.38, y + h * 0.03, x + w * 0.38, y + h * 0.97, mix(board, FLAT.ink, 0.5), Math.max(1, w * 0.06), seed + 70);
        const st = Math.max(1.6, h * 0.032);
        for (let i = 0; i < 3; i++) {
          const t = 0.26 + i * 0.24;
          stroke(ctx, x + w * 0.19, y + h * t - st / 2, x + w * 0.19, y + h * t + st / 2, thread, Math.max(1.2, w * 0.14), seed + 71 + i);
        }
        break;
      }
      case 'stabKnots': {
        /*
         * Four knots down one side and the thread that ties them — the whole
         * of a stab binding, seen edge on.
         *
         * A stab binding is sewn through a MARGIN: the holes are punched a
         * finger's width in from the fold and the strip between the fold and
         * the sewing is dead ground that never opens. Drawn as a thread and
         * four dots on a plain field it was a plain field, and the shape read
         * as `square` and `tight-back`.
         *
         * The margin sits on the FORE-EDGE side, and that is not arbitrary.
         * Every covering in `paintMaterial` lays its turned board down the near
         * side, so a darker band drawn there lands on top of a darker band and
         * changes nothing — measured on the dominant-class grid, `japanese-stab`
         * with a left-hand margin was pixel-for-pixel `square` at five columns.
         * A mark has to be put where the covering is not already dark.
         */
        const kx = x + w * 0.68;
        ctx.save();
        traceBookShape(ctx, b, spec, seed);
        ctx.clip();
        fillBand(ctx, x + w * 0.6, y - h * 0.03, w * 0.43, h * 1.06, mix(board, FLAT.ink, 0.34), 0, seed + 73);
        ctx.restore();
        stroke(ctx, kx, y + h * 0.08, kx, y + h * 0.92, thread, Math.max(1, w * 0.07), seed + 74);
        const kr = Math.max(1.6, w * 0.14);
        for (let i = 0; i < 4; i++) {
          pill(kx - kr, y + h * (0.16 + i * 0.23) - kr, kr * 2, kr * 2, thread, 75 + i);
        }
        break;
      }
      case 'longStitch': {
        // Three runs of stitching straight through a limp cover: dashes, not
        // lines, because a line at this width is a rule and reads as tooling.
        // …and at h*0.008 they were a pixel and a half of thread on a 200px
        // book, which is a smudge. Linen sewn through a limp cover stands
        // proud of it; three dashes per run, each a fifth of the width.
        for (let r = 0; r < 3; r++) {
          const ly = y + h * (0.2 + r * 0.3);
          for (let i = 0; i < 3; i++) {
            const sx = x + w * (0.13 + i * 0.29);
            stroke(ctx, sx, ly, sx + w * 0.22, ly, thread, Math.max(1.4, h * 0.016), seed + 80 + r * 3 + i);
          }
        }
        break;
      }
      case 'chainStitch': {
        // A chain of link stitches down a bare spine.
        //
        // Drawn as alternating diagonals this came out as one wobbling scribble
        // — a lightning bolt on a stick — because the segments join end to end
        // and the eye reads the join, not the links. Overlapping loops read as a
        // CHAIN: each one closes, and each one bites into the one above it.
        // Six fatter links, not seven thin ones: at w*0.22 the chain was
        // narrower than a third of the spine and `coptic` collided with
        // `saddle-stapled` at four of the five coarsenesses measured — the
        // worst pair in the table.
        const links = 6;
        const lw = Math.min(w * 0.3, h * 0.03);
        const lh = (h * 0.84) / links;
        ctx.strokeStyle = thread;
        ctx.lineWidth = Math.max(1.2, w * 0.09);
        for (let i = 0; i < links; i++) {
          // Half-height, so consecutive links touch and bite rather than
          // swallowing each other into one long tube.
          ctx.beginPath();
          ctx.ellipse(x + w * 0.5, y + h * 0.08 + lh * (i + 0.5), lw, lh * 0.52, 0, 0, TAU);
          ctx.stroke();
        }
        break;
      }
      case 'coil': {
        // A wire coil threaded through the spine: every turn is one slanted
        // bar, and the bars are all parallel because the wire is one spiral.
        // Eight fat turns rather than eleven thin ones: at w*0.09 the wire was
        // three pixels on a 34px spine and averaged into the cloth, which left
        // `spiral-wire` reading as `rounded` and as `waisted` — two shapes that
        // have nothing on them at all.
        // …and the wire wraps AROUND the block, so every turn runs the full
        // width of the slot and stands proud of the body on both sides. The
        // gaps of bare ground between the turns down each edge are the whole
        // point: no other shape in the table has ground biting into its sides,
        // and drawn inside the body this was eight grey bars on a rectangle.
        const turns = 13;
        for (let i = 0; i < turns; i++) {
          const ty0 = y + h * (0.045 + (i * 0.91) / turns);
          stroke(ctx, foot.x, ty0, foot.x + foot.w, ty0 + h * 0.03, steel, Math.max(1.8, w * 0.21), seed + 100 + i);
        }
        break;
      }
      case 'comb': {
        // A plastic comb gripping the edge: teeth that curl back on themselves.
        // Narrow and many, so the run reads as one comb rather than as a column
        // of separate lozenges lying on a book.
        // The teeth reach two thirds across, not under a half: at 0.46 the run
        // sat entirely in the left half and `comb-bound` read as
        // `sewn-sections`, whose gatherings are the full width.
        const teeth = 13;
        const th = Math.max(1.6, (h * 0.9) / (teeth * 1.9));
        for (let i = 0; i < teeth; i++) {
          const ty0 = y + h * (0.05 + (i * 0.9) / teeth);
          pill(x + w * 0.08, ty0, w * 0.5, th, steel, 110 + i);
        }
        // The spine of the comb, holding the teeth together.
        stroke(ctx, x + w * 0.12, y + h * 0.05, x + w * 0.12, y + h * 0.95, steel, Math.max(1, w * 0.07), seed + 109);
        break;
      }
      case 'rings': {
        // Three rings on a metal back plate. Rings alone, drawn a third of the
        // spine across, read as three O's printed on a book; the plate is what
        // says "this is hardware bolted to it".
        const rr = Math.min(w * 0.22, h * 0.032);
        pill(x + w * 0.12, y + h * 0.12, Math.max(2, w * 0.2), h * 0.76, mix(steel, FLAT.ink, 0.16), 108);
        for (let i = 0; i < 3; i++) {
          const cy = y + h * (0.24 + i * 0.26);
          ctx.beginPath();
          ctx.ellipse(x + w * 0.5, cy, rr, rr * 1.2, 0, 0, Math.PI * 2);
          ctx.strokeStyle = steel;
          ctx.lineWidth = Math.max(1.3, w * 0.085);
          ctx.stroke();
        }
        break;
      }
      case 'staples': {
        // A staple goes through the FOLD, so it wraps the near edge and both
        // its legs show — which is a bar across most of the width, not a chip
        // in the middle of one. The chip is what made this shape one picture
        // with `coptic`, `exposed-cords` and `spiral-wire`.
        const sh = Math.max(3, h * 0.055);
        for (const [t, n] of [
          [0.25, 0],
          [0.75, 1],
        ] as const) {
          pill(x + w * 0.08, y + h * t - sh / 2, w * 0.84, sh, steel, 120 + n);
        }
        break;
      }
      case 'sections': {
        // Six folded gatherings, each seen end on.
        //
        // `pill` rounds to half the SHORT side, and a gathering a fifth of a
        // 200px book tall is nearly as tall as the spine is wide — so five of
        // them came out as a stack of circles, which reads as a caterpillar.
        // A folded signature is a slab with one rounded fore edge, so these are
        // drawn with a small fixed radius and the fold line down the near side.
        const gaps = 6;
        const gh = (h * 0.94) / gaps;
        const gw = w * 0.88;
        for (let i = 0; i < gaps; i++) {
          const gy = y + h * 0.03 + i * gh;
          panel(ctx, x + w * 0.06, gy, gw, gh * 0.9, surfaceAt(design, (i + 0.5) / gaps)[0], {
            radius: Math.min(gw * 0.22, gh * 0.24),
            seed: seed + 130 + i,
            width: fine,
          });
        }
        stroke(ctx, x + w * 0.24, y + h * 0.04, x + w * 0.24, y + h * 0.96, mix(board, FLAT.ink, 0.22), Math.max(1, w * 0.045), seed + 137);
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
        //
        // Fourteen per cent of the way to ink is not a fold, it is the same
        // colour with a rounding error on it — the flap was invisible at 34px
        // and `portfolio` read as `rounded`, `limp`, `spring-back` and
        // `domed-head`. A flap is a second thickness of the covering lying on
        // top of the first, so it is a properly darker face, and it covers the
        // two fifths of the width a portfolio flap actually covers.
        const fw = w * 0.53;
        panel(ctx, x - w * 0.01, y + h * 0.02, fw, h * 0.96, mix(board, FLAT.ink, 0.44), {
          radius: fw * 0.2,
          seed: seed + 155,
          width: fine,
        });
        const sr = Math.max(1.4, w * 0.1);
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
        // Clasps do not sit on a spine, they run ACROSS it: the strap is
        // anchored to the far board, comes over the fore edge and catches on
        // the near one, so what a shelf shows is two bands right across the
        // book with the catch plate in the middle of each. At 0.36 of the
        // width they were two brass pips in the centre of a plain rectangle,
        // and `clasped` was one picture with `square` and `rounded`.
        const cw = Math.max(3, w * 0.94);
        const chh = Math.max(3.2, h * 0.055);
        const pw = Math.max(2.4, w * 0.34);
        for (const [t, n] of [
          [0.22, 0],
          [0.78, 1],
        ] as const) {
          pill(x + w * 0.5 - cw / 2, y + h * t - chh / 2, cw, chh, mix(brass, FLAT.ink, 0.18), 160 + n);
          pill(x + w * 0.5 - pw / 2, y + h * t - chh * 0.85, pw, chh * 1.7, brass, 162 + n);
        }
        break;
      }
      case 'chainLink': {
        // A staple plate at the foot and the chain hanging off it. This book
        // stays. Three small O's alone read as printing rather than as
        // hardware, which is the same reason the ring binder got a back plate.
        const rr = Math.max(2.2, Math.min(w * 0.24, h * 0.03));
        const ph = Math.max(2.6, h * 0.034);
        pill(x + w * 0.22, y + h * 0.8 - ph / 2, w * 0.56, ph, mix(steel, FLAT.ink, 0.2), 172);
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.ellipse(x + w * 0.5, y + h * (0.855 + i * 0.05), rr, rr * 1.3, 0, 0, Math.PI * 2);
          ctx.strokeStyle = steel;
          ctx.lineWidth = Math.max(1.3, w * 0.085);
          ctx.stroke();
        }
        break;
      }
      case 'knobs': {
        // A turned knob at each end: a scroll, not a book, and it should look
        // like one from across the room.
        //
        // At 1.6 of the body width the two knobs were wider than the slot, and
        // what the reader saw on the shelf was a dumbbell. A turned end-cap
        // stands a little proud of the roll and no more.
        const kw = w * 1.24;
        const kh = Math.max(3, h * 0.036);
        // Seated ON the roll, where it is at its full width — set at 0.02 the
        // knob floated above the round cap on a thin neck, which is a dumbbell.
        for (const [t, n] of [
          [0.03, 0],
          [0.97, 1],
        ] as const) {
          pill(x + w * 0.5 - kw / 2, y + h * t - kh / 2, kw, kh, mix(board, FLAT.ink, 0.2), 165 + n);
        }
        break;
      }
      case 'headcaps': {
        // Leather turned over a cord at head and tail. This is an INSET seam,
        // not a separate pill wider than the body (the old baluster/capsule).
        const capH = Math.max(1, Math.min(h * 0.009, w * 0.07));
        const cap = mix(board, FLAT.ink, 0.28);
        for (const [t, n] of [
          [0.052, 0],
          [0.948, 1],
        ] as const) {
          stroke(
            ctx,
            x + w * 0.14,
            y + h * t,
            x + w * 0.86,
            y + h * t,
            cap,
            capH,
            seed + 168 + n,
          );
        }
        break;
      }
      case 'yappLips': {
        // A subtle soft-cover extension, not a structural crossbar. It sits
        // mostly outside the body and is only a breath wider than the back.
        const lh = Math.max(1.5, h * 0.018);
        const lx = foot.x + foot.w * 0.025;
        const lw = foot.w * 0.95;
        for (const [ly, t, n] of [
          [y - lh * 0.62, 0, 0],
          [y + h - lh * 0.38, 1, 1],
        ] as const) {
          pill(lx, ly, lw, lh, surfaceAt(design, t)[1], 170 + n);
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
        // A real thumb index is a card you can get a thumb onto. At 9% of the
        // height it was a chip, and the shape sat 284px from a plain square.
        const tw = Math.max(3, w * 0.42);
        const th = Math.max(6, h * 0.17);
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
  const authoredBinding = design.decorations
    .flatMap((mark) => decorSpec(mark).parts)
    .find((part): part is Extract<DecorPart, { k: 'binding' }> => part.k === 'binding');
  const cordedProgramme = authoredBinding?.archetype === 'corded-leather';
  const sparseOilclothProgramme =
    authoredBinding?.archetype === 'terminal' && authoredBinding.variant === 4;
  const sparseLinenScholarProgramme =
    authoredBinding?.archetype === 'publisher-panel' && authoredBinding.variant === 4;

  // Below its floor the fine work of a covering — veins, lozenges, joint lines
  // — lands on less than a pixel and reads as dirt, so a sliver gets the plain
  // two-tone case and nothing else. The two-tone still carries the colour. A
  // thoroughly worn book loses the same detail for the same reason it loses its
  // gilt: it has been rubbed off.
  const fine = w >= spec.floor && design.wear < 0.78;

  /**
   * One line, and it survives narrower than the grain does.
   *
   * The turn-in below is a single stroke where two flat faces already meet, so
   * it costs nothing to read even on a sliver — unlike a vein or a lozenge,
   * which needs room to be a shape at all. Gating it on the material's own
   * `floor` would have taken the fold off exactly the books that most need
   * telling apart from a painted rectangle.
   */
  const inked = w >= 8;

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
    if (!inked) return;
    // The turn-in: the covering's own cut edge, folded over the board and
    // pared. Without it a turned board is a COLOUR STEP and nothing more, and
    // a colour step is what a gradient does — every one of the fifty coverings
    // read as a painted rectangle because this one line was missing from all
    // of them. It is the darker board pushed further, never a shadow.
    const crease = mix(d, FLAT.ink, 0.4);
    const wt = Math.max(0.9, w * 0.028);
    stroke(ctx, x + w * spec.turn, ty, x + w * spec.turn, ty + th, crease, wt, seed + n + 6);
    if (spec.farTurn > 0) {
      const far = x + w * (1 - spec.farTurn);
      stroke(ctx, far, ty, far, ty + th, crease, wt, seed + n + 7);
    }
  };

  lay(-0.03, 1.03, face, board, 10);

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
        return toolingColour(design, board);
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
      case 'ribs': {
        // Rep is a WEFT rib: a cord lying across the cloth, and the near side
        // of each cord is the same cloth a step paler. Eight bare rules run
        // edge to edge made the spine a ladder — worse, a ladder with rungs at
        // exactly the stations a raised cord uses, so a rep cloth read as a
        // corded binding. Two lines to a course, held inside the field.
        const lit = mix(face, FLAT.cream, 0.2);
        const courses = n * 2;
        for (let i = 1; i < courses; i++) {
          const t = i / courses;
          hLine(t, f0 - 0.01, f1 + 0.01, h * 0.0042, i);
          stroke(ctx, x + w * (f0 - 0.01), y + h * (t + 0.0065), x + w * (f1 + 0.01), y + h * (t + 0.0065), lit, Math.max(0.7, h * 0.003), seed + 330 + i);
        }
        break;
      }
      case 'weave': {
        // A plain weave is over-under, so it has to be drawn as a CHEQUER of
        // short marks. Long lines both ways gave a sheet of graph paper, which
        // is the one thing a loose open linen is not — and at 30px the eye
        // reads the alternation long before it counts the threads.
        const cols = 3;
        const cw = fw / cols;
        const rows = n * 2;
        for (let row = 0; row < rows; row++) {
          const t = 0.03 + (row * 0.94) / rows;
          for (let col = 0; col < cols; col++) {
            const a = f0 + cw * col;
            if ((row + col) % 2 === 0) hLine(t, a + cw * 0.12, a + cw * 0.88, h * 0.0048, row * 4 + col);
            else vLine(a + cw * 0.5, t - 0.013, t + 0.013, w * 0.028, row * 4 + col);
          }
        }
        break;
      }
      case 'twill': {
        // A twill is a BROKEN diagonal — short slants stepping one place
        // across each course. Nine long diagonals across the whole width read
        // as scratches on the cloth rather than as the weave of it.
        const step = fw / 3;
        for (let i = 0; i < n; i++) {
          const t = 0.04 + (i * 0.9) / n;
          for (let col = 0; col < 3; col++) {
            const a = f0 + ((col + (i % 3) * 0.34) % 3) * step;
            if (a + step * 0.8 > f1) continue;
            stroke(ctx, x + w * a, y + h * (t + 0.014), x + w * (a + step * 0.8), y + h * t, gc, Math.max(0.8, h * 0.005), seed + 200 + i * 4 + col);
          }
        }
        break;
      }
      case 'coarse':
        // Sackcloth is never even: a thick slub, then a thin pick beside it,
        // and both of them stopping short of the joints at different places.
        for (let i = 0; i < n; i++) {
          const t = 0.07 + (i * 0.86) / n;
          hLine(t, f0 + rand() * 0.08, f1 - rand() * 0.1, h * 0.012, i);
          hLine(t + 0.052, f0 + rand() * 0.16, f1 - rand() * 0.18, h * 0.005, i + 30);
        }
        break;
      case 'fleck': {
        // Stratified, not scattered: `rand()` alone put sixteen flecks anywhere,
        // and "anywhere" on a strip 30px wide and 200 tall means clumps at one
        // end and a bare middle. One fleck per band, jittered inside its band,
        // is what a flecked cloth actually looks like from three feet away.
        //
        // Two colours, because a tweed IS two: the second yarn showing through
        // and the dark of the first twisted with it. One tone made a row of
        // identical dashes, which reads as a printed dot rather than as a fibre.
        const second = mix(board, FLAT.ink, 0.24);
        for (let i = 0; i < n; i++) {
          const t = 0.04 + ((i + rand() * 0.9) / n) * 0.92;
          const a = f0 + rand() * fw * 0.7;
          const len = fw * (0.16 + rand() * 0.12);
          stroke(ctx, x + w * a, y + h * t, x + w * (a + len), y + h * t, i % 3 === 0 ? second : gc, Math.max(1, h * 0.0065), seed + 200 + i);
        }
        break;
      }
      case 'napEdge': {
        // Felt is thick and CUT, not two cloths glued together. Keep the darker
        // edge narrow enough to read as thickness, then let a handful of flat
        // clipped tufts name the surface. The old third-width slab was louder
        // than the title and made the material look half-bound.
        const bw = fw * 0.18;
        fillBand(ctx, x + w * (f1 - bw), y - h * 0.02, w * (bw + 0.06), h * 1.04, gc, w * 0.1, seed + 205);
        const tufts = Math.max(6, n * 3);
        for (let i = 0; i < tufts; i++) {
          const t = 0.03 + (i * 0.94) / tufts;
          const j = wob(seed + i * 7) * fw * 0.06;
          stroke(ctx, x + w * (f1 - bw - 0.025 + j), y + h * t, x + w * (f1 - bw + 0.035 + j), y + h * (t + 0.006), gc, Math.max(0.9, w * 0.036), seed + 206 + i);
        }
        break;
      }
      case 'pile': {
        // Velvet is a deep continuous covering. Sparse paired nap turns name
        // it without inventing a bright fore-edge panel (the broad two-step
        // slab was repeatedly read as a second cover at both preview scales).
        const crush = Math.max(3, n + 1);
        const quiet = mix(gc, face, 0.32);
        for (let i = 0; i < crush; i++) {
          const t = 0.12 + ((i + 0.4 + rand() * 0.2) * 0.76) / crush;
          const a = f0 + fw * (0.16 + rand() * 0.46);
          const len = fw * (0.14 + rand() * 0.12);
          stroke(ctx, x + w * a, y + h * t, x + w * (a + len), y + h * (t + 0.008), quiet, Math.max(0.8, w * 0.026), seed + 205 + i * 2);
          stroke(ctx, x + w * (a + len * 0.12), y + h * (t + 0.018), x + w * (a + len * 0.78), y + h * (t + 0.023), gc, Math.max(0.7, w * 0.02), seed + 206 + i * 2);
        }
        break;
      }
      case 'brushed': {
        // Flesh side out: the nap lies every way at once, so it is short
        // strokes at scattered angles. Long verticals were the same drawing
        // the felt had, in a different colour — which is not a second covering.
        const strokes = Math.max(24, n * 9);
        for (let i = 0; i < strokes; i++) {
          const t = 0.03 + rand() * 0.94;
          const a = f0 + rand() * fw * 0.76;
          const len = fw * (0.1 + rand() * 0.15);
          const rise = (rand() - 0.5) * 0.032;
          stroke(ctx, x + w * a, y + h * t, x + w * (a + len), y + h * (t + rise), gc, Math.max(0.9, w * 0.028), seed + 250 + i);
        }
        break;
      }
      case 'watered': {
        const moire = true;
        /** One ripple pulled the height of the sheet. */
        const vein = (at: number, amp: number, colour: string, width: number, k: number): void => {
          const vx = x + w * at;
          ctx.beginPath();
          ctx.moveTo(vx, y + h * 0.02);
          const steps = 5;
          for (let s = 0; s < steps; s++) {
            const y0 = y + h * (0.02 + (0.96 * s) / steps);
            const y1 = y + h * (0.02 + (0.96 * (s + 1)) / steps);
            ctx.quadraticCurveTo(vx + ((s + k) % 2 === 0 ? amp : -amp), (y0 + y1) / 2, vx, y1);
          }
          ctx.strokeStyle = colour;
          ctx.lineWidth = width;
          ctx.lineCap = 'round';
          ctx.stroke();
        };
        for (let i = 0; i < n; i++) {
          const at = f0 + (fw * (i + 0.5)) / n;
          const amp = w * (moire ? 0.035 : 0.055) * (1 + wob(seed + i) * 0.3);
          vein(at, amp, i % 2 === 0 ? gc : mix(gc, FLAT.cream, 0.3), Math.max(1, w * (moire ? 0.035 : 0.05)), 0);
          // A comb pulls the colours in PAIRS — one full vein and the darker
          // one dragged along beside it. Five lonely ripples is a stripe.
          if (!moire) {
            vein(at + fw * 0.07, amp * 0.7, mix(gc, FLAT.ink, 0.3), Math.max(0.8, w * 0.024), 0);
          }
        }
        // Moiré is two moves of the same water, and it is the crossing of them
        // that makes the shimmer. A second, finer set of ripples between the
        // first, breaking the other way.
        if (moire) {
          for (let i = 0; i < n - 1; i++) {
            vein(f0 + (fw * (i + 1)) / n, w * 0.022, mix(gc, face, 0.4), Math.max(0.8, w * 0.02), 1);
          }
        }
        break;
      }
      case 'combedVeins': {
        // A comb is pulled ACROSS the sheet, so the colour should travel as
        // broad, irregular waves rather than four full-height uprights. Those
        // uprights were handsome enlarged but collapsed into a barcode on a
        // 30px shelf spine. Crossing the narrow field at staggered heights
        // keeps the motion recognisably marbled without becoming either a
        // structural band or a field of scratch marks.
        const veins = Math.max(3, Math.min(4, n));
        for (let i = 0; i < veins; i++) {
          const t = 0.12 + (i * 0.76) / Math.max(1, veins - 1);
          const rise = (i % 2 === 0 ? 1 : -1) * (0.045 + rand() * 0.035);
          const bow = (i % 3 - 1) * 0.055;
          ctx.beginPath();
          ctx.moveTo(x + w * f0, y + h * t);
          ctx.bezierCurveTo(
            x + w * (f0 + fw * 0.28), y + h * (t + rise + bow),
            x + w * (f0 + fw * 0.7), y + h * (t - rise + bow),
            x + w * f1, y + h * (t + rise * 0.45),
          );
          ctx.strokeStyle = i % 2 === 0 ? gc : mix(gc, face, 0.34);
          ctx.lineWidth = Math.max(1, w * 0.03);
          ctx.lineCap = 'round';
          ctx.stroke();

          // The paler echo is deliberately incomplete: a second edge gives
          // the wave a combed ribbon quality, while a full parallel line would
          // turn it back into a ruled stripe.
          ctx.beginPath();
          ctx.moveTo(x + w * (f0 + fw * 0.13), y + h * (t + 0.018));
          ctx.bezierCurveTo(
            x + w * (f0 + fw * 0.36), y + h * (t + rise + bow + 0.018),
            x + w * (f0 + fw * 0.62), y + h * (t - rise + bow + 0.018),
            x + w * (f0 + fw * 0.84), y + h * (t + rise * 0.2 + 0.018),
          );
          ctx.strokeStyle = mix(gc, face, 0.48);
          ctx.lineWidth = Math.max(0.8, w * 0.02);
          ctx.stroke();
        }
        break;
      }
      case 'figured':
        // Two offset columns of very small woven leaves. Horizontal ground
        // rails made the old brocade look like mechanical brackets; the repeat
        // itself is enough to say figured silk in flat art.
        for (let row = 0; row < n; row++) {
          const t = 0.08 + (row * 0.84) / (n - 1 || 1);
          const cy = y + h * t;
          const s = Math.min(w * 0.105, h * 0.015);
          for (let col = 0; col < 2; col++) {
            const cxx = x + w * (f0 + fw * (row % 2 === 0 ? 0.28 + col * 0.42 : 0.48 + col * 0.42));
            if (cxx > x + w * f1) continue;
            ctx.beginPath();
            ctx.moveTo(cxx, cy - s);
            ctx.quadraticCurveTo(cxx + s * 0.85, cy, cxx, cy + s);
            ctx.quadraticCurveTo(cxx - s * 0.85, cy, cxx, cy - s);
            ctx.fillStyle = gc;
            ctx.fill();
            stroke(ctx, cxx, cy - s * 0.5, cxx, cy + s * 0.65, mix(gc, board, 0.55), Math.max(0.65, s * 0.22), seed + 218 + row * 2 + col);
          }
        }
        break;
      case 'damask':
        // Reversed weave: the SAME figure facing the other way, in the same
        // silk. So every filled leaf gets its mirror struck beside it as an
        // outline — no second colour anywhere, which is the whole trick of a
        // damask and the reason a row of pale blobs was not one.
        for (let i = 0; i < n; i++) {
          const cy = y + h * (0.1 + (i * 0.8) / (n - 1 || 1));
          const left = i % 2 === 0;
          const cxx = x + w * (f0 + fw * (left ? 0.34 : 0.66));
          const echo = x + w * (f0 + fw * (left ? 0.68 : 0.32));
          const s = Math.min(w * 0.2, h * 0.026);
          const leaf = (px: number, dir: number): void => {
            ctx.beginPath();
            ctx.moveTo(px, cy - s);
            ctx.quadraticCurveTo(px + s * 0.9 * dir, cy - s * 0.2, px, cy + s);
            ctx.quadraticCurveTo(px - s * 0.9 * dir, cy - s * 0.2, px, cy - s);
          };
          leaf(cxx, left ? 1 : -1);
          ctx.fillStyle = gc;
          ctx.fill();
          leaf(echo, left ? -1 : 1);
          ctx.strokeStyle = mix(gc, face, 0.42);
          ctx.lineWidth = Math.max(0.8, w * 0.026);
          ctx.stroke();
          // the stem the two figures hang off
          stroke(ctx, cxx, cy + s * 0.9, echo, cy + s * 0.9, mix(gc, face, 0.5), Math.max(0.7, w * 0.018), seed + 222 + i);
        }
        break;
      case 'pebble': {
        // Morocco's grain is the whole reason to bind a book in goat, and two
        // columns of one-pixel dots is a book with a rash: at 30px it read as
        // a smooth cloth somebody had specked. Three staggered columns,
        // pebbles that vary in size, and a smaller pebble tucked against each
        // — dense enough that the eye reads a GRAIN instead of counting spots.
        const rows = Math.max(9, n);
        for (let row = 0; row < rows; row++) {
          const cy = y + h * (0.04 + (row * 0.92) / (rows - 1 || 1));
          for (let col = 0; col < 3; col++) {
            const fx = f0 + fw * ((row % 2 === 0 ? 0.1 : 0.26) + col * 0.32);
            if (fx > f1 - 0.01) continue;
            const rr = Math.min(w * 0.075, h * 0.0092) * (0.7 + ((row * 5 + col) % 3) * 0.2);
            dot(x + w * fx, cy, rr);
            dot(x + w * fx + rr * 0.55, cy + rr * 0.6, rr * 0.5, mix(gc, board, 0.45));
          }
        }
        break;
      }
      case 'panelled': {
        // A burnished panel is BOUNDED: the calf either side of it is a
        // different surface, and a flat drawing says that with a line. Struck
        // as a bare band it was a gradient's worth of information — a paler
        // stripe, which is exactly what a light model would have drawn.
        const px0 = f0 + fw * 0.24;
        const pw = fw * 0.5;
        fillBand(ctx, x + w * px0, y - h * 0.02, w * pw, h * 1.04, gc, w * 0.12, seed + 210);
        const fillet = mix(board, FLAT.ink, 0.3);
        for (const at of [px0, px0 + pw]) {
          stroke(ctx, x + w * at, y + h * 0.02, x + w * at, y + h * 0.98, fillet, Math.max(0.8, w * 0.022), seed + 211 + at * 40);
        }
        break;
      }
      case 'flame': {
        // The acid tree. Drawn as one even line with four ticks off it, this
        // was a stem — a tree needs a trunk that THICKENS toward its root, a
        // bough that forks, and a spread of root at the foot. Four marks
        // instead of one, and the same tool becomes a drawing.
        const stem = f0 + fw * 0.5;
        const dark = mix(gc, FLAT.ink, 0.22);
        for (let s = 0; s < 5; s++) {
          const t0 = 0.94 - (s * 0.88) / 5;
          const t1 = 0.94 - ((s + 1) * 0.88) / 5;
          stroke(ctx, x + w * stem, y + h * t0, x + w * stem, y + h * t1, gc, Math.max(1, w * (0.085 - s * 0.013)), seed + 211 + s);
        }
        for (let i = 0; i < n; i++) {
          const t = 0.2 + (i * 0.6) / (n - 1 || 1);
          const dir = i % 2 === 0 ? 1 : -1;
          const reach = fw * (0.46 - i * 0.03);
          stroke(ctx, x + w * stem, y + h * t, x + w * (stem + reach * dir), y + h * (t - 0.075), gc, Math.max(1, w * 0.04), seed + 212 + i);
          stroke(ctx, x + w * (stem + reach * 0.58 * dir), y + h * (t - 0.044), x + w * (stem + reach * 1.02 * dir), y + h * (t - 0.115), dark, Math.max(0.9, w * 0.026), seed + 216 + i);
        }
        for (const dir of [-1, 1]) {
          stroke(ctx, x + w * stem, y + h * 0.92, x + w * (stem + fw * 0.28 * dir), y + h * 0.965, gc, Math.max(0.9, w * 0.03), seed + 219 + dir);
        }
        break;
      }
      case 'sprinkle':
        // Flicked off a brush: the drops are not all one size, and some of
        // them landed twice. Twenty-six identical discs read as a screen tint.
        for (let i = 0; i < n; i++) {
          const cxx = x + w * (f0 + rand() * fw);
          const cy = y + h * (0.03 + rand() * 0.94);
          const rr = Math.min(w * 0.05, h * 0.006) * (0.55 + rand() * 0.9);
          dot(cxx, cy, rr);
          if (i % 4 === 0) dot(cxx + rr * 1.9, cy + rr * 1.3, rr * 0.6);
        }
        break;
      case 'mottle':
        // A cloudy hide: the blot ran thin in the middle of itself, which is a
        // second flat face inside the first and the only depth this style has.
        for (let i = 0; i < n; i++) {
          const s = Math.min(w * 0.14, h * 0.017) * (0.6 + rand() * 0.8);
          const cxx = x + w * (f0 + rand() * fw);
          const cy = y + h * (0.05 + rand() * 0.9);
          ctx.beginPath();
          ctx.ellipse(cxx, cy, s, s * 0.7, 0, 0, TAU);
          ctx.fillStyle = gc;
          ctx.fill();
          if (i % 2 !== 0) continue;
          ctx.beginPath();
          ctx.ellipse(cxx - s * 0.2, cy - s * 0.04, s * 0.46, s * 0.3, 0, 0, TAU);
          ctx.fillStyle = mix(gc, face, 0.5);
          ctx.fill();
        }
        break;
      case 'scales': {
        // Scales OVERLAP. Drawn as bare arcs with air between them this was a
        // column of eyebrows; each one needs a body of its own, a lip where
        // the course above laps it, and three across so the stagger reads.
        const lit = mix(face, FLAT.cream, 0.16);
        const rx = Math.min(w * 0.13, h * 0.016);
        const ry = Math.min(w * 0.11, h * 0.014);
        for (let row = 0; row < n; row++) {
          const cy = y + h * (0.07 + (row * 0.86) / n);
          for (let col = 0; col < 3; col++) {
            const cxx = x + w * (f0 + fw * ((row % 2 === 0 ? 0.16 : 0.31) + col * 0.3));
            if (cxx + rx > x + w * f1) continue;
            ctx.beginPath();
            ctx.ellipse(cxx, cy, rx, ry, 0, Math.PI, TAU);
            ctx.lineTo(cxx - rx, cy + ry * 0.34);
            ctx.closePath();
            ctx.fillStyle = lit;
            ctx.fill();
            ctx.strokeStyle = gc;
            ctx.lineWidth = Math.max(0.8, w * 0.024);
            ctx.stroke();
          }
        }
        break;
      }
      case 'shagreen': {
        // Rayskin is a FIELD of pearls, not three medallions: rings overlapping
        // down the whole height with the small pearls filling between them.
        // Three tight clusters on a bare ground read as three smudges somebody
        // had left on a plain book — a defect rather than a hide.
        const rr = Math.min(w * 0.2, h * 0.024);
        const pearls = Math.max(6, Math.round(n * 0.8));
        for (let g = 0; g < 6; g++) {
          const cxx = x + w * (f0 + fw * (g % 2 === 0 ? 0.36 : 0.64));
          const cy = y + h * (0.1 + g * 0.16);
          for (let i = 0; i < pearls; i++) {
            const a = (i / pearls) * TAU + g;
            dot(cxx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 1.2, Math.min(w * 0.048, h * 0.0058));
          }
          dot(cxx, cy, Math.min(w * 0.055, h * 0.0066));
        }
        break;
      }
      case 'plates': {
        // Squared plates, staggered. Two straight columns of big rectangles is
        // a WINDOW — the strongest not-a-book reading anything on this board
        // had — so the plates are smaller, there are more of them, and every
        // other row steps half a plate across.
        //
        // …and each one is an OBJECT: a seam round it, and no two the same
        // width. A grid of identical filled rectangles is tiling, not hide.
        const seam = mix(board, FLAT.ink, 0.3);
        for (let row = 0; row < n; row++) {
          for (let col = 0; col < 2; col++) {
            const off = row % 2 === 0 ? 0.03 : 0.16;
            const pw = fw * (col === 0 ? 0.4 : 0.34) * (row % 3 === 0 ? 0.86 : 1);
            const px = x + w * (f0 + fw * (off + col * 0.44));
            const py = y + h * (0.04 + (row * 0.92) / n);
            const ph = h * (0.92 / n) * 0.7;
            if (px + w * pw > x + w * f1) continue;
            fillBand(ctx, px, py, w * pw, ph, gc, w * 0.04, seed + 220 + row * 2 + col);
            wobbleRect(ctx, px, py, w * pw, ph, w * 0.04, seed + 220 + row * 2 + col);
            ctx.strokeStyle = seam;
            ctx.lineWidth = Math.max(0.7, w * 0.02);
            ctx.lineJoin = 'round';
            ctx.stroke();
          }
        }
        break;
      }
      case 'pinDot': {
        // A bristle hole is a PIT, and a pit in flat art is a dark disc with
        // the hide standing up round it. Bare specks were the same mark the
        // sprinkled calf makes and half of them vanished into the cloth.
        const rim = mix(face, FLAT.cream, 0.22);
        const s = Math.min(w * 0.036, h * 0.0042);
        for (let i = 0; i < n; i++) {
          const cy = y + h * (0.05 + (i * 0.9) / n);
          const cxx = x + w * (f0 + fw * (i % 2 === 0 ? 0.3 : 0.58));
          for (const [dx, dy] of [
            [0, 0],
            [w * 0.1, h * 0.0065],
            [w * 0.05, -h * 0.0085],
          ] as const) {
            dot(cxx + dx, cy + dy, s * 1.9, rim);
            dot(cxx + dx, cy + dy, s);
          }
        }
        break;
      }
      case 'creases': {
        // A crease is a FOLD: the side that stands up is one value, the side
        // that turns away is another, and one line on its own is a scratch.
        // Both the oilcloth and the parchment were three pale slashes.
        const under = mix(board, FLAT.ink, 0.3);
        for (let i = 0; i < n; i++) {
          const t = 0.16 + (i * 0.68) / (n - 1 || 1);
          stroke(ctx, x + w * f0, y + h * t, x + w * f1, y + h * (t + 0.05), gc, Math.max(1, w * 0.035), seed + 226 + i);
          stroke(ctx, x + w * f0, y + h * (t + 0.014), x + w * f1, y + h * (t + 0.064), under, Math.max(0.9, w * 0.024), seed + 236 + i);
          // the cockle where the sheet has pulled away from the joint
          stroke(ctx, x + w * f0, y + h * t, x + w * (f0 + fw * 0.22), y + h * (t - 0.022), gc, Math.max(0.8, w * 0.022), seed + 246 + i);
        }
        break;
      }
      case 'stitchRun': {
        // The seam the stitching holds. Dashes on a bare ground read as a
        // dotted line somebody forgot to finish; run them along two rules and
        // the same dashes become a doubled seam in heavy canvas.
        const seam = mix(board, FLAT.ink, 0.24);
        for (const a of [f0 + fw * 0.22, f0 + fw * 0.74]) {
          stroke(ctx, x + w * a, y + h * 0.03, x + w * a, y + h * 0.97, seam, Math.max(0.9, w * 0.03), seed + 201 + a * 40);
        }
        for (let i = 0; i < n; i++) {
          const t = 0.05 + (i * 0.9) / n;
          hLine(t, f0 + fw * 0.1, f0 + fw * 0.34, h * 0.008, i);
          hLine(t, f0 + fw * 0.62, f0 + fw * 0.86, h * 0.008, i + 40);
        }
        break;
      }
      case 'spanishWave': {
        // The bath was rocked, so every wave has the echo of the one before it
        // dragged half a step behind. Single zigzags were a knitting stitch.
        const zig = (cy: number, amp: number, colour: string, width: number): void => {
          ctx.beginPath();
          const peaks = 4;
          for (let i = 0; i <= peaks * 2; i++) {
            const px = x + w * (f0 + (fw * i) / (peaks * 2));
            const py = cy + (i % 2 === 0 ? -1 : 1) * amp;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.strokeStyle = colour;
          ctx.lineWidth = width;
          ctx.lineJoin = 'round';
          ctx.stroke();
        };
        for (let row = 0; row < n; row++) {
          const cy = y + h * (0.06 + (row * 0.88) / n);
          zig(cy, h * 0.013, gc, Math.max(0.9, h * 0.0062));
          zig(cy + h * 0.011, h * 0.009, mix(gc, FLAT.ink, 0.32), Math.max(0.8, h * 0.0038));
        }
        break;
      }
      case 'stoneVein':
        // A stone marble is a NET. A stroke with one tick on it came out as a
        // small bird, five times down the spine; a vein wants two hairs
        // splitting off it at different angles before it reads as stone.
        for (let i = 0; i < n; i++) {
          const t = 0.06 + (i * 0.86) / n;
          const a = f0 + rand() * fw * 0.34;
          const bx = a + fw * (0.4 + rand() * 0.24);
          const bt = t + 0.05 + rand() * 0.04;
          stroke(ctx, x + w * a, y + h * t, x + w * bx, y + h * bt, gc, Math.max(0.9, w * 0.028), seed + 230 + i);
          stroke(ctx, x + w * ((a + bx) / 2), y + h * ((t + bt) / 2), x + w * (bx - fw * 0.08), y + h * (bt - 0.055), gc, Math.max(0.8, w * 0.02), seed + 235 + i);
          stroke(ctx, x + w * (a + fw * 0.13), y + h * (t + 0.016), x + w * Math.max(f0, a - fw * 0.05), y + h * (t + 0.058), gc, Math.max(0.7, w * 0.016), seed + 239 + i);
        }
        break;
      case 'shellSpots': {
        // The drop of colour broke round its own oil, so the SPOT is the ring
        // and the eye inside it is the paper. One disc with a speck on top was
        // indistinguishable from the dutch gilt's dots at any width.
        const eye = mix(FLAT.cream, gc, 0.18);
        for (let i = 0; i < n; i++) {
          const cy = y + h * (0.07 + (i * 0.86) / n);
          const cxx = x + w * (f0 + fw * (i % 2 === 0 ? 0.3 : 0.6));
          const rr = Math.min(w * 0.155, h * 0.019);
          dot(cxx, cy, rr);
          dot(cxx - rr * 0.16, cy - rr * 0.14, rr * 0.5, eye);
          dot(cxx + rr * 1.55, cy + rr * 0.95, rr * 0.36);
        }
        break;
      }
      case 'pasteComb': {
        // Local comb pulls, not edge-to-edge waves: alternating short fans keep
        // the paste-paper gesture from turning the spine into water or ruling.
        const rows = Math.max(4, n);
        for (let i = 0; i < rows; i++) {
          const cy = y + h * (0.09 + (i * 0.82) / Math.max(1, rows - 1));
          const a0 = f0 + fw * (i % 2 === 0 ? 0.04 : 0.3);
          const a1 = Math.min(f1, a0 + fw * 0.64);
          for (let k = 0; k < 3; k++) {
            const oy = cy + h * 0.009 * (k - 1);
            ctx.beginPath();
            ctx.moveTo(x + w * a0, oy);
            ctx.quadraticCurveTo(x + w * ((a0 + a1) / 2), oy + h * 0.019, x + w * a1, oy - h * 0.004);
            ctx.strokeStyle = k === 1 ? mix(gc, face, 0.42) : gc;
            ctx.lineWidth = Math.max(0.8, h * (k === 1 ? 0.0038 : 0.0048));
            ctx.stroke();
          }
        }
        break;
      }
      case 'lozenges': {
        // A diaper, which is a lozenge with something IN it — the block that
        // printed the paper carried a pip, and without it the field is a row
        // of pale rhombs that reads as noise at 22px.
        const size = Math.min(w * 0.15, h * 0.018);
        const pip = mix(gc, FLAT.ink, 0.34);
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
            ctx.fillStyle = gc;
            ctx.fill();
            dot(cxx, cy, Math.max(0.55, size * 0.26), pip);
          }
        }
        break;
      }
      case 'sprigs': {
        // A restrained two-leaf block, offset down the paper side. At shelf
        // size this reads as printed paper without becoming a busy textile.
        const rows = Math.max(4, n);
        const stem = mix(gc, FLAT.ink, 0.28);
        for (let i = 0; i < rows; i++) {
          const cy = y + h * (0.09 + (i * 0.82) / Math.max(1, rows - 1));
          const cxx = x + w * (f0 + fw * (i % 2 === 0 ? 0.34 : 0.63));
          const s = Math.min(w * 0.1, h * 0.012);
          stroke(ctx, cxx, cy + s * 0.9, cxx, cy - s * 0.75, stem, Math.max(0.7, s * 0.28), seed + 610 + i);
          for (const side of [-1, 1] as const) {
            ctx.beginPath();
            ctx.moveTo(cxx, cy - s * 0.05);
            ctx.quadraticCurveTo(cxx + side * s * 0.9, cy - s * 0.65, cxx + side * s * 0.72, cy + s * 0.12);
            ctx.quadraticCurveTo(cxx + side * s * 0.34, cy + s * 0.3, cxx, cy - s * 0.05);
            ctx.fillStyle = gc;
            ctx.fill();
          }
        }
        break;
      }
      case 'floret': {
        // One carved block, inked and struck over and over SLIGHTLY OUT OF
        // TRUE — which the blurb has always claimed and the drawing never did.
        // The wobble is the whole difference between a hand press and a tile.
        const s = Math.min(w * 0.09, h * 0.011);
        for (let row = 0; row < n; row++) {
          const cy = y + h * (0.08 + (row * 0.84) / (n - 1 || 1)) + wob(seed + row * 3) * h * 0.006;
          const cxx = x + w * (f0 + fw * (row % 2 === 0 ? 0.34 : 0.62)) + wob(seed + row * 5) * w * 0.03;
          const tilt = wob(seed + row * 7) * 0.4;
          for (let p = 0; p < 4; p++) {
            const a = (p / 4) * TAU + 0.4 + tilt;
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
      case 'laidLines': {
        // Laid paper carries TWO marks, not one: the chain lines standing wide
        // apart where the mould's stitches were, and the fine laid wires close
        // together across them. With only the chains it was corduroy — and it
        // was the same drawing the napped suede used to have.
        for (let i = 1; i <= n; i++) vLine(f0 + (fw * i) / (n + 1), 0.03, 0.97, w * 0.024, i);
        const wires = mix(gc, face, 0.45);
        for (let i = 1; i < 26; i++) {
          const ly = y + h * (i / 26);
          stroke(ctx, x + w * f0, ly, x + w * f1, ly, wires, Math.max(0.7, h * 0.0028), seed + 256 + i);
        }
        break;
      }
      case 'giltDots': {
        // Dutch gilt is EMBOSSED and then gilded, so the mark is a struck star
        // sitting in a ruled grid. A field of plain discs is a polka dot, and
        // the cheapest way to look rich is not the same as looking cheap.
        const rows = Math.max(6, n);
        const rule = mix(gc, board, 0.5);
        const s = Math.min(w * 0.07, h * 0.0085);
        for (let row = 0; row < rows; row++) {
          const cy = y + h * (0.05 + (row * 0.9) / (rows - 1 || 1));
          stroke(ctx, x + w * f0, cy + h * 0.024, x + w * f1, cy + h * 0.024, rule, Math.max(0.7, h * 0.003), seed + 262 + row);
          for (let col = 0; col < 2; col++) {
            const cxx = x + w * (f0 + fw * (row % 2 === 0 ? 0.28 + col * 0.42 : 0.49 + col * 0.42));
            if (cxx > x + w * f1) continue;
            dot(cxx, cy, s * 0.6);
            for (const [dx, dy] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ] as const) {
              stroke(ctx, cxx, cy, cxx + dx * s * 1.3, cy + dy * s * 1.3, gc, Math.max(0.7, s * 0.5), seed + 266 + row * 4 + col * 2 + dx + dy);
            }
          }
        }
        break;
      }
      case 'stripes': {
        // Three broad stripes, and the printer's own register line down each
        // edge of them — which is what stops the sheet reading as a flag.
        const reg = mix(gc, FLAT.ink, 0.45);
        for (let i = 0; i < n; i++) {
          const sw = fw / (n * 2 - 1);
          const sx = f0 + i * sw * 2;
          fillBand(ctx, x + w * sx, y - h * 0.02, w * sw, h * 1.04, i % 2 === 0 ? gc : mix(gc, FLAT.ink, 0.28), 0, seed + 260 + i);
          for (const e of [sx, sx + sw]) {
            stroke(ctx, x + w * e, y - h * 0.01, x + w * e, y + h * 1.01, reg, Math.max(0.7, w * 0.016), seed + 264 + i * 2 + e * 10);
          }
        }
        break;
      }
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
      case 'newsRules': {
        // A newspaper is COLUMNS: a rule down the gutter, a heavier one under
        // the masthead, and short lines of type either side that stop where a
        // paragraph stops. Fourteen full-width rules was ruled writing paper.
        const gutter = f0 + fw * 0.52;
        vLine(gutter, 0.055, 0.95, w * 0.018, 1);
        hLine(0.045, f0, f1, h * 0.0075, 90);
        for (let i = 0; i < n; i++) {
          const t = 0.085 + (i * 0.85) / n;
          hLine(t, f0, gutter - fw * (i % 3 === 0 ? 0.16 : 0.05), h * 0.0035, i);
          hLine(t + 0.019, gutter + fw * 0.05, f1 - fw * (i % 2 === 0 ? 0.14 : 0.02), h * 0.0035, i + 50);
        }
        break;
      }
      case 'wrapperRules':
        // The printer set a thick rule and a thin one under it, because that
        // is what a wrapper's head and foot have always been.
        for (let i = 0; i < n; i++) {
          const t = i === 0 ? 0.09 : 0.91;
          hLine(t, 0.14, 0.86, w * 0.05, i);
          hLine(t + (i === 0 ? 0.026 : -0.026), 0.2, 0.8, w * 0.02, i + 10);
        }
        break;
      case 'scuffs': {
        // A raw board wears at its EDGES and nowhere else. Scattered up the
        // middle the marks read as somebody's pencil; put against the fore
        // edge, with the bare millboard showing pale under each rub, they read
        // as a book that has been handled.
        const bare = mix(face, FLAT.cream, 0.3);
        for (let i = 0; i < n; i++) {
          const t = i % 2 === 0 ? 0.03 + rand() * 0.1 : 0.87 + rand() * 0.09;
          const a = f0 + rand() * fw * 0.5;
          stroke(ctx, x + w * a, y + h * t, x + w * (a + fw * 0.42), y + h * (t + 0.018), gc, Math.max(0.9, w * 0.03), seed + 280 + i);
          stroke(ctx, x + w * (a + fw * 0.07), y + h * (t + 0.012), x + w * (a + fw * 0.36), y + h * (t + 0.027), bare, Math.max(0.8, w * 0.02), seed + 286 + i);
        }
        // …and the edge of the board itself, never covered by anything.
        vLine(f1 - 0.02, 0.03, 0.97, w * 0.024, 3);
        break;
      }
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
    if (!fine) continue;
    // …and the fillet run just inside it. Every half binding ever made has
    // this rule, for a reason a drawing needs too: the join is the one edge on
    // the book the eye goes to first, and a bare colour change there reads as
    // two rectangles stacked rather than as one book bound in two skins.
    const inward = top < 0 ? -1 : 1;
    const fy = y + h * (edge + 0.013 * inward);
    const fillet = toolingColour(design, accentBoard);
    const from = spec.turn > 0 ? spec.turn * 0.55 : 0.04;
    stroke(ctx, x + w * from, fy, x + w * 0.96, fy, fillet, Math.max(0.9, w * 0.03), seed + 306 + i);
  }

  /* ---------------------- the binding construction ----------------------- */

  // These are broad faces and folds, not surface texture.  They remain quiet
  // enough to sit under tooling, but make the nine intentionally plain books
  // look bound and let two equally coloured materials stay recognisable.
  if (w >= 8) {
    const [cover, edge] = surfaceAt(design, 0.5);
    const seam = mix(edge, FLAT.ink, 0.34);
    const quiet = mix(cover, edge, 0.28);
    const quietPale = mix(cover, FLAT.cream, 0.16);
    const line = Math.max(0.9, w * 0.032);

    const cap = (
      at: number,
      depth: number,
      inset: number,
      colour: string,
      nSeed: number,
    ): void => {
      const top = y + h * at;
      const tall = Math.max(2, h * depth);
      fillBand(ctx, x + w * inset, top, w * (1 - inset * 2), tall, colour, 0, seed + nSeed);
      const ruleY = at < 0.5 ? top + tall : top;
      stroke(ctx, x + w * (inset + 0.03), ruleY, x + w * (0.97 - inset), ruleY, seam, line, seed + nSeed + 1);
    };

    const shoulder = (
      at: number,
      width: number,
      colour: string,
      nSeed: number,
    ): void => {
      fillBand(ctx, x + w * at, y - h * 0.02, w * width, h * 1.04, colour, 0, seed + nSeed);
      const sx = x + w * (at + (at < 0.5 ? width : 0));
      stroke(ctx, sx, y + h * 0.025, sx, y + h * 0.975, seam, line, seed + nSeed + 1);
    };

    switch (spec.construction) {
      case 'cloth-case':
        // A cased cloth book shows the covering turned over the head and tail
        // of the board.  Two short square folds are enough; more is pattern.
        cap(0.018, 0.025, 0.13, quiet, 700);
        cap(0.957, 0.025, 0.13, quiet, 702);
        break;
      case 'buckram-case':
        // Library buckram is heavy at the fore turn and cut crisply at both
        // terminals.  The uninterrupted far shoulder is its identifying face.
        shoulder(0.84, 0.12, quiet, 710);
        cap(0.02, 0.035, 0.1, edge, 712);
        cap(0.945, 0.035, 0.1, edge, 714);
        break;
      case 'linen-case':
        // Linen is thinner and more open than buckram: narrow paired turn-ins,
        // with a broad pale fold rather than a field of weave marks.
        // The scholar programme already owns a continuous blind panel; its
        // extra material caps formerly doubled both ends into even ladder bars.
        if (!sparseLinenScholarProgramme) {
          cap(0.025, 0.022, 0.19, quietPale, 720);
          cap(0.953, 0.022, 0.19, quietPale, 722);
        }
        shoulder(0.9, 0.045, quiet, 724);
        break;
      case 'felt-case': {
        // One continuous cut edge with three broad, joined undulations.  The
        // former row of tiny tufts read as perforation/disease at shelf scale.
        const left = x + w * 0.82;
        ctx.beginPath();
        ctx.moveTo(x + w * 1.03, y - h * 0.02);
        ctx.lineTo(x + w * 1.03, y + h * 1.02);
        ctx.lineTo(left, y + h * 1.02);
        for (let i = 3; i >= 0; i -= 1) {
          const py = y + h * (i / 3);
          const belly = left - w * (i % 2 === 0 ? 0.055 : 0.015);
          ctx.quadraticCurveTo(belly, py - h / 12, left, py - h / 6);
        }
        ctx.closePath();
        ctx.fillStyle = quiet;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(left, y + h * 0.98);
        for (let i = 3; i >= 0; i -= 1) {
          const py = y + h * (i / 3);
          const belly = left - w * (i % 2 === 0 ? 0.055 : 0.015);
          ctx.quadraticCurveTo(belly, py - h / 12, left, py - h / 6);
        }
        ctx.strokeStyle = seam;
        ctx.lineWidth = Math.max(1.1, w * 0.04);
        ctx.stroke();
        break;
      }
      case 'velvet-case':
        // Velvet is a deep continuous pile.  A single broad reversed-pile
        // inset says that without specks, highlights or wallpaper.
        fillBand(ctx, x + w * 0.34, y + h * 0.055, w * 0.42, h * 0.89, quiet, w * 0.05, seed + 740);
        stroke(ctx, x + w * 0.34, y + h * 0.07, x + w * 0.34, y + h * 0.93, seam, line, seed + 741);
        stroke(ctx, x + w * 0.76, y + h * 0.07, x + w * 0.76, y + h * 0.93, seam, line, seed + 742);
        break;
      case 'calf-back':
        // Smooth calf is rounded over both shoulders.  Two broad pared faces
        // make that construction legible before any gilt is struck.
        if (cordedProgramme) {
          cap(0.018, 0.028, 0.18, quiet, 750);
        } else {
          shoulder(0.19, 0.075, quiet, 750);
          shoulder(0.735, 0.075, quiet, 752);
        }
        break;
      case 'morocco-back': {
        // Morocco is identified by its supple rounded back, not a pebble tile.
        // Two broad pared lobes flank one uninterrupted central face; when an
        // authored cord programme is present the cords remain the sole rails.
        if (cordedProgramme) {
          cap(0.02, 0.03, 0.13, quiet, 754);
          cap(0.95, 0.03, 0.13, quiet, 756);
          break;
        }
        const left = x + w * 0.16;
        const right = x + w * 0.84;
        ctx.beginPath();
        ctx.moveTo(left, y + h * 0.03);
        ctx.quadraticCurveTo(x + w * 0.27, y + h * 0.5, left, y + h * 0.97);
        ctx.lineTo(x + w * 0.34, y + h * 0.97);
        ctx.quadraticCurveTo(x + w * 0.43, y + h * 0.5, x + w * 0.34, y + h * 0.03);
        ctx.closePath();
        ctx.moveTo(right, y + h * 0.03);
        ctx.quadraticCurveTo(x + w * 0.73, y + h * 0.5, right, y + h * 0.97);
        ctx.lineTo(x + w * 0.66, y + h * 0.97);
        ctx.quadraticCurveTo(x + w * 0.57, y + h * 0.5, x + w * 0.66, y + h * 0.03);
        ctx.closePath();
        ctx.fillStyle = quiet;
        ctx.fill();
        ctx.strokeStyle = seam;
        ctx.lineWidth = Math.max(1, w * 0.032);
        ctx.stroke();
        break;
      }
      case 'russia-back':
        // Russia calf is firmer and deeper: a wide central back with hard,
        // paired shoulders, all in related flat tones.
        if (cordedProgramme) {
          cap(0.947, 0.03, 0.14, quiet, 760);
        } else {
          fillBand(ctx, x + w * 0.3, y + h * 0.025, w * 0.42, h * 0.95, quiet, 0, seed + 760);
          stroke(ctx, x + w * 0.3, y + h * 0.035, x + w * 0.3, y + h * 0.965, seam, line, seed + 761);
          stroke(ctx, x + w * 0.72, y + h * 0.035, x + w * 0.72, y + h * 0.965, seam, line, seed + 762);
        }
        break;
      case 'roan-back':
        // Roan is thin and singly pared: one broad shoulder, one narrow far
        // turn, and no imitation morocco grain.
        if (!cordedProgramme) shoulder(0.285, 0.09, quiet, 770);
        cap(0.025, 0.024, 0.22, quietPale, 772);
        break;
      case 'oilcloth-back':
        // The waxed sheet folds as a flap.  Its uninterrupted far fold and
        // blunt terminal return distinguish it from leather without shine.
        if (!sparseOilclothProgramme) shoulder(0.78, 0.14, quiet, 780);
        cap(0.94, 0.038, 0.08, edge, 782);
        break;
      case 'vellum-laced':
        // Broad vellum turn-ins; no point holes, ties or hairline creases.
        cap(0.035, 0.045, 0.17, quietPale, 790);
        cap(0.92, 0.045, 0.17, quietPale, 792);
        shoulder(0.8, 0.09, quiet, 794);
        break;
      case 'parchment-fold': {
        // One wide cockled fold, painted as a face rather than a scratch.
        ctx.beginPath();
        ctx.moveTo(x + w * 0.72, y - h * 0.02);
        ctx.bezierCurveTo(x + w * 0.63, y + h * 0.24, x + w * 0.83, y + h * 0.51, x + w * 0.69, y + h * 0.75);
        ctx.quadraticCurveTo(x + w * 0.62, y + h * 0.9, x + w * 0.72, y + h * 1.02);
        ctx.lineTo(x + w * 0.86, y + h * 1.02);
        ctx.quadraticCurveTo(x + w * 0.76, y + h * 0.9, x + w * 0.83, y + h * 0.75);
        ctx.bezierCurveTo(x + w * 0.97, y + h * 0.51, x + w * 0.77, y + h * 0.24, x + w * 0.86, y - h * 0.02);
        ctx.closePath();
        ctx.fillStyle = quiet;
        ctx.fill();
        break;
      }
      case 'alum-tawed-laced': {
        // Two broad lacing returns enter from the joint and disappear beneath
        // the tawed covering. Connected quadrilaterals survive at 30px without
        // becoming punctures, stitches, scratches or a regular ladder.
        shoulder(0.16, 0.08, quietPale, 804);
        for (const [at, rise, key] of [[0.23, -0.018, 806], [0.76, 0.018, 808]] as const) {
          ctx.beginPath();
          ctx.moveTo(x + w * 0.13, y + h * (at - 0.017));
          ctx.lineTo(x + w * 0.68, y + h * (at + rise - 0.017));
          ctx.lineTo(x + w * 0.68, y + h * (at + rise + 0.017));
          ctx.lineTo(x + w * 0.13, y + h * (at + 0.017));
          ctx.closePath();
          ctx.fillStyle = quiet;
          ctx.fill();
          ctx.strokeStyle = seam;
          ctx.lineWidth = Math.max(1, w * 0.035);
          ctx.stroke();
          void key;
        }
        break;
      }
      case 'wrapper-fold':
        // A wrapper is one sheet folded round a text block: paired paper
        // returns and a broad square fold at the tail, never printed ruling.
        shoulder(0.08, 0.055, quiet, 810);
        shoulder(0.865, 0.055, quiet, 812);
        cap(0.94, 0.035, 0.16, quietPale, 814);
        break;
      case 'half-leather':
        if (!cordedProgramme) {
          shoulder(0.25, 0.11, quiet, 820);
          shoulder(0.69, 0.11, quiet, 822);
        }
        cap(0.02, 0.028, 0.1, edge, 824);
        break;
      case 'quarter-leather':
        if (!cordedProgramme) shoulder(0.19, 0.07, quiet, 830);
        cap(0.95, 0.028, 0.2, quietPale, 832);
        break;
      case 'three-quarter-leather':
        if (!cordedProgramme) {
          shoulder(0.33, 0.1, quiet, 840);
          shoulder(0.57, 0.1, quiet, 842);
        }
        cap(0.02, 0.032, 0.08, edge, 844);
        cap(0.948, 0.032, 0.08, edge, 846);
        break;
      case 'half-cloth':
        shoulder(0.24, 0.08, quietPale, 850);
        shoulder(0.74, 0.08, quietPale, 852);
        cap(0.03, 0.025, 0.14, quiet, 854);
        break;
      case 'tips-leather':
        shoulder(0.3, 0.09, quiet, 860);
        shoulder(0.61, 0.09, quiet, 862);
        cap(0.025, 0.024, 0.19, edge, 864);
        cap(0.951, 0.024, 0.19, edge, 866);
        break;
      default:
        break;
    }
  }

  /* -------------------------------- the joints ------------------------------ */

  if (fine && spec.joints > 0 && !cordedProgramme) {
    const joint = mix(board, FLAT.ink, 0.42);
    // The board standing up out of the crease — the OTHER side of the same
    // fold, said the only way this style says depth: a second flat face beside
    // the first. One line on its own was a pencil mark down the spine.
    const ridge = mix(face, FLAT.cream, 0.2);
    const at = [spec.turn > 0 ? spec.turn : 0.22];
    if (spec.joints > 1) at.push(1 - (spec.farTurn > 0 ? spec.farTurn : 0.14));
    for (let i = 0; i < at.length; i++) {
      const px = x + w * (at[i] as number);
      stroke(ctx, px, y + h * 0.02, px, y + h * 0.98, joint, Math.max(1, w * 0.04), seed + 310 + i);
      const rx = px + w * 0.052 * (i === 0 ? 1 : -1);
      stroke(ctx, rx, y + h * 0.045, rx, y + h * 0.955, ridge, Math.max(0.8, w * 0.024), seed + 316 + i);
    }
  }
}

/** How far down the spine a material has already spoken for, at the head. */
function materialHeadClaim(material: MaterialLook): number {
  // A continuous leather/cloth back is the ground, not a furnishing, and does
  // not consume the central ornament/tooling field. Only the exposed-board
  // head patch is a local applied region that needs its own room.
  return materialSpec(material).split === 'headBand' ? 0.17 : 0;
}

/** …and the same at the foot. */
function materialFootClaim(material: MaterialLook): number {
  void material;
  return 1;
}

/* ========================================================================== *
 *                          stage 3 — the decoration                          *
 * ========================================================================== */

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
    case 'rope': {
      // A cable moulding: parallel strands BETWEEN two rules.
      //
      // The rules are the whole thing. Struck as bare diagonals the run read as
      // draughtsman's hatching; crossed into a twist it read as a row of X's.
      // Bounded top and bottom, the same diagonals read as one twisted cord,
      // which is exactly how the ornament works on a real cornice.
      for (let i = 0; i < count; i++) {
        const px = x0 + step * (i + 0.5);
        ctx.beginPath();
        ctx.moveTo(px - step * 0.34, cy + bh * 0.5);
        ctx.quadraticCurveTo(px, cy, px + step * 0.34, cy - bh * 0.5);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(x0, cy - bh * 0.62);
      ctx.lineTo(x1, cy - bh * 0.62);
      ctx.moveTo(x0, cy + bh * 0.62);
      ctx.lineTo(x1, cy + bh * 0.62);
      ctx.lineWidth = Math.max(0.8, weight * 0.55);
      ctx.stroke();
      return;
    }
    case 'chain': {
      // Interlocking links: equal ellipses that OVERLAP. Drawn end to end with
      // air between them a row of closed shapes reads as a word — this one came
      // out as "OCDO" — and biting into each other is the only thing that says
      // chain rather than type.
      const lw = step * 0.56;
      for (let i = 0; i < count; i++) {
        ctx.beginPath();
        ctx.ellipse(x0 + step * (i + 0.5), cy, lw, bh * 0.52, 0, 0, TAU);
        ctx.stroke();
      }
      return;
    }
    case 'key': {
      // The meander, as ONE continuous band: a square wave standing on a rule.
      // Drawn as separate folded brackets — four of them across twenty-four
      // pixels — it read as the letters PPPP, which is the failure mode of every
      // small ornament that leaves gaps between its repeats.
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const px = x0 + step * i;
        ctx.moveTo(px, cy + bh * 0.5);
        ctx.lineTo(px, cy - bh * 0.5);
        ctx.lineTo(px + step * 0.5, cy - bh * 0.5);
        ctx.lineTo(px + step * 0.5, cy + bh * 0.5);
      }
      ctx.moveTo(x0, cy + bh * 0.5);
      ctx.lineTo(x1, cy + bh * 0.5);
      ctx.stroke();
      return;
    }
    case 'scroll': {
      // A running wave that breaks the same way every time. As open arcs with
      // air between them this read as a row of o's; joined onto one crest line
      // it reads as water, which is what a Vitruvian scroll is.
      ctx.beginPath();
      ctx.moveTo(x0, cy + bh * 0.45);
      for (let i = 0; i < count; i++) {
        const px = x0 + step * i;
        ctx.quadraticCurveTo(px + step * 0.28, cy - bh * 0.95, px + step * 0.62, cy);
        ctx.quadraticCurveTo(px + step * 0.82, cy + bh * 0.5, px + step, cy + bh * 0.45);
      }
      ctx.stroke();
      return;
    }
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

/* ---------------------- reset-era construction tools ---------------------- */

/** One continuous square fillet. Corners stay book-square, never pill-round. */
function drawSquareFillet(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: string,
  weight: number,
  seed: number,
): void {
  if (w <= 2 || h <= 2) return;
  const bow = Math.min(0.75, Math.max(0.18, w * 0.018));
  ctx.beginPath();
  ctx.moveTo(x, y);
  bowTo(ctx, x, y, x + w, y, wob(seed) * bow);
  bowTo(ctx, x + w, y, x + w, y + h, wob(seed + 1) * bow);
  bowTo(ctx, x + w, y + h, x, y + h, wob(seed + 2) * bow);
  bowTo(ctx, x, y + h, x, y, wob(seed + 3) * bow);
  ctx.closePath();
  ctx.strokeStyle = colour;
  ctx.lineWidth = weight;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  ctx.stroke();
}

/**
 * A real compartment system: transverse fillets terminate in the perimeter,
 * so the result is a bound panel structure rather than floating ladder rungs.
 */
function drawCompartments(
  ctx: FlatCtx,
  d: DesignBox,
  part: Extract<DecorPart, { k: 'compartments' }>,
  foil: string,
  blind: string,
  seed: number,
): void {
  const { x, y, w, h } = d;
  const x0 = x + w * part.inset;
  const x1 = x + w * (1 - part.inset);
  const y0 = y + h * part.top;
  const y1 = y + h * part.bottom;
  if (x1 - x0 <= 3 || y1 - y0 <= h * 0.08) return;
  const weight = Math.max(1, w * part.weight);
  const accentWeight = Math.max(0.9, weight * 0.82);
  const span = x1 - x0;
  const rise = Math.max(2.2, Math.min(w * 0.15, (y1 - y0) * 0.055));
  const gap = Math.max(1.5, w * 0.06);

  const ruled = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    colour: string,
    line: number,
    key: number,
  ): void => {
    stroke(ctx, ax, ay, bx, by, colour, line, seed + key);
  };

  const cornerReturn = (
    px: number,
    py: number,
    sx: -1 | 1,
    sy: -1 | 1,
    arm: number,
    colour: string,
    line: number,
    key: number,
  ): void => {
    ctx.beginPath();
    ctx.moveTo(px + sx * arm, py);
    ctx.lineTo(px, py);
    ctx.lineTo(px, py + sy * arm * 1.35);
    ctx.strokeStyle = colour;
    ctx.lineWidth = line;
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    ctx.stroke();
    // A shorter parallel return reads as two binder's fillets, not a UI box.
    if (!part.double) return;
    const inset = Math.max(1.2, line * 1.25);
    ctx.beginPath();
    ctx.moveTo(px + sx * (arm * 0.72), py + sy * inset);
    ctx.lineTo(px + sx * inset, py + sy * inset);
    ctx.lineTo(px + sx * inset, py + sy * arm);
    ctx.strokeStyle = blind;
    ctx.lineWidth = Math.max(0.85, line * 0.72);
    ctx.stroke();
    void key;
  };

  const steppedFillet = (): void => {
    const cut = Math.min(span * 0.16, rise * 1.4);
    ctx.beginPath();
    ctx.moveTo(x0 + cut, y0);
    ctx.lineTo(x1 - cut, y0);
    ctx.lineTo(x1, y0 + rise);
    ctx.lineTo(x1, y1 - rise);
    ctx.lineTo(x1 - cut, y1);
    ctx.lineTo(x0 + cut, y1);
    ctx.lineTo(x0, y1 - rise);
    ctx.lineTo(x0, y0 + rise);
    ctx.closePath();
    ctx.strokeStyle = blind;
    ctx.lineWidth = weight;
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    ctx.stroke();
    cornerReturn(x0 + cut, y0 + gap, 1, 1, Math.min(span * 0.2, rise * 1.3), foil, accentWeight, 41);
    cornerReturn(x1 - cut, y1 - gap, -1, -1, Math.min(span * 0.2, rise * 1.3), foil, accentWeight, 42);
  };

  // Establish a dark structural layer first. Gold is then reserved for short
  // returns, shoulders and focal ledges, so pale vellum no longer becomes one
  // low-contrast yellow ruler and dark cloth no longer becomes a gold cage.
  switch (part.style) {
    case 'mitred':
      drawSquareFillet(ctx, x0, y0, span, y1 - y0, blind, weight, seed + 20);
      if (part.double && span > gap * 2 + 3) {
        drawSquareFillet(
          ctx,
          x0 + gap,
          y0 + gap,
          span - gap * 2,
          y1 - y0 - gap * 2,
          foil,
          accentWeight,
          seed + 21,
        );
      } else {
        ruled(x0, y0, x1, y0, foil, accentWeight, 24);
        ruled(x0, y1, x1, y1, foil, accentWeight, 25);
        cornerReturn(x0, y0, 1, 1, Math.min(span * 0.28, rise * 1.7), foil, accentWeight, 22);
        cornerReturn(x1, y1, -1, -1, Math.min(span * 0.28, rise * 1.7), foil, accentWeight, 23);
      }
      break;
    case 'corner-return': {
      drawSquareFillet(ctx, x0, y0, span, y1 - y0, blind, weight, seed + 30);
      ruled(x0, y0, x1, y0, foil, accentWeight, 36);
      ruled(x0, y1, x1, y1, foil, accentWeight, 37);
      const arm = Math.min(span * 0.38, rise * 2.2);
      cornerReturn(x0, y0, 1, 1, arm, foil, accentWeight, 32);
      cornerReturn(x1, y0, -1, 1, arm, foil, accentWeight, 33);
      cornerReturn(x0, y1, 1, -1, arm, foil, accentWeight, 34);
      cornerReturn(x1, y1, -1, -1, arm, foil, accentWeight, 35);
      break;
    }
    case 'stepped':
      steppedFillet();
      ruled(x0 + span * 0.16, y0, x1 - span * 0.16, y0, foil, accentWeight, 43);
      ruled(x0 + span * 0.16, y1, x1 - span * 0.16, y1, foil, accentWeight, 44);
      break;
    case 'rail': {
      const inner = part.double ? gap : 0;
      ruled(x0 + inner, y0 + rise, x0 + inner, y1 - rise, blind, weight, 50);
      ruled(x1 - inner, y0 + rise, x1 - inner, y1 - rise, blind, weight, 51);
      ruled(x0, y0 + rise, x1, y0 + rise, foil, accentWeight, 52);
      ruled(x0, y1 - rise, x1, y1 - rise, foil, accentWeight, 53);
      ruled(x0 + span * 0.2, y0, x1 - span * 0.2, y0, blind, weight, 54);
      ruled(x0 + span * 0.2, y1, x1 - span * 0.2, y1, blind, weight, 55);
      break;
    }
    case 'folio': {
      ruled(x0, y0, x0, y1, blind, weight, 60);
      ruled(x1, y0, x1, y1, blind, weight, 61);
      for (const [py, sy, key] of [[y0, 1, 62], [y1, -1, 64]] as const) {
        ruled(x0, py, x1, py, blind, weight, key);
        ruled(x0 + gap, py + sy * rise, x1 - gap, py + sy * rise, foil, accentWeight, key + 1);
      }
      break;
    }
    case 'canopy': {
      const arm = span * 0.34;
      drawSquareFillet(ctx, x0, y0, span, y1 - y0, blind, weight, seed + 70);
      ruled(x0, y0, x1, y0, foil, accentWeight, 78);
      ruled(x0, y1, x1, y1, foil, accentWeight, 79);
      cornerReturn(x0, y0, 1, 1, arm, foil, accentWeight, 74);
      cornerReturn(x1, y0, -1, 1, arm, foil, accentWeight, 75);
      cornerReturn(x0, y1, 1, -1, arm, foil, accentWeight, 76);
      cornerReturn(x1, y1, -1, -1, arm, foil, accentWeight, 77);
      break;
    }
    default:
      break;
  }

  // Unequal stations remain programme-authored. Their connection treatment is
  // family-specific, preventing a row of short equal rungs from becoming a
  // ladder while retaining the physical logic of a ruled spine compartment.
  for (let i = 0; i < part.divisions.length; i += 1) {
    const station = part.divisions[i] as number;
    if (station <= part.top + 0.025 || station >= part.bottom - 0.025) continue;
    const py = y + h * station;
    switch (part.style) {
      case 'corner-return': {
        const fromLeft = i % 2 === 0;
        const end = fromLeft ? x0 + span * 0.67 : x1 - span * 0.67;
        ruled(fromLeft ? x0 : x1, py, end, py, blind, weight, 100 + i);
        const tick = Math.max(1.8, rise * 0.72);
        ruled(end, py, end, py + (fromLeft ? 1 : -1) * tick, foil, accentWeight, 110 + i);
        break;
      }
      case 'stepped': {
        const inset = Math.min(span * 0.11, gap * 1.2);
        ruled(x0 + inset, py, x1 - inset, py, i % 2 === 0 ? foil : blind, i % 2 === 0 ? accentWeight : weight, 120 + i);
        ruled(x0 + inset, py - rise * 0.55, x0 + inset, py + rise * 0.55, blind, weight, 130 + i);
        ruled(x1 - inset, py - rise * 0.55, x1 - inset, py + rise * 0.55, blind, weight, 140 + i);
        break;
      }
      case 'rail': {
        const fromLeft = i % 2 === 0;
        ruled(
          fromLeft ? x0 : x1,
          py,
          fromLeft ? x0 + span * 0.62 : x1 - span * 0.62,
          py,
          i === 0 ? foil : blind,
          i === 0 ? accentWeight : weight,
          150 + i,
        );
        break;
      }
      case 'canopy': {
        const clear = span * 0.22;
        ruled(x0, py, (x0 + x1) / 2 - clear, py, blind, weight, 160 + i * 2);
        ruled((x0 + x1) / 2 + clear, py, x1, py, blind, weight, 161 + i * 2);
        if (i === 0 || i === part.divisions.length - 1) {
          ruled(x0 + span * 0.16, py, x1 - span * 0.16, py, foil, accentWeight, 170 + i);
        }
        break;
      }
      case 'folio':
        ruled(x0, py, x1, py, blind, weight, 180 + i);
        if (i === 0 || i === part.divisions.length - 1) {
          ruled(x0 + gap, py + (i === 0 ? rise * 0.48 : -rise * 0.48), x1 - gap, py + (i === 0 ? rise * 0.48 : -rise * 0.48), foil, accentWeight, 190 + i);
        }
        break;
      case 'mitred':
      default:
        ruled(x0, py, x1, py, blind, weight, 200 + i);
        if (i % 2 === 0) {
          ruled(x0 + span * 0.18, py, x1 - span * 0.18, py, foil, accentWeight, 210 + i);
        }
        break;
    }
  }
}

/** A raised, square-ended band made from the covering itself. */
function drawMaterialBands(
  ctx: FlatCtx,
  d: DesignBox,
  design: BookDesign,
  part: Extract<DecorPart, { k: 'bands' }>,
  foil: string,
  seed: number,
): void {
  const { x, y, w, h } = d;
  const ink = Math.max(0.9, inkWidth(w) * 0.46);
  for (let i = 0; i < part.at.length; i += 1) {
    const t = part.at[i] as number;
    const [face, board] = part.fill === 'accent'
      ? fadedPair(clothPair(design.accent), design.wear)
      : surfaceAt(design, t);
    const bh = Math.max(2.4, Math.min(h * part.height, w * 0.34));
    const bx = x + w * 0.025;
    const bw = w * 0.95;
    const by = y + h * t - bh / 2;
    ctx.beginPath();
    ctx.moveTo(bx, by + bh * 0.34);
    ctx.quadraticCurveTo(x + w * 0.5, by - bh * 0.12, bx + bw, by + bh * 0.34);
    ctx.lineTo(bx + bw, by + bh * 0.78);
    ctx.quadraticCurveTo(x + w * 0.5, by + bh * 1.12, bx, by + bh * 0.78);
    ctx.closePath();
    ctx.fillStyle = mix(board, face, 0.18);
    ctx.fill();
    // One blind lower shoulder establishes relief. A black rectangular outline
    // made a real raised cord look like a luggage strap around a canister.
    stroke(
      ctx,
      bx + w * 0.03,
      by + bh * 0.83,
      bx + bw - w * 0.03,
      by + bh * 0.83,
      mix(board, FLAT.ink, 0.55),
      ink,
      seed + i * 4,
    );
    if (!part.shoulders || w < 10) continue;
    // A restrained centre strike identifies a gilt cord without doubling every
    // band into four parallel ruler lines.
    stroke(
      ctx,
      x + w * 0.2,
      by + bh * 0.43,
      x + w * 0.8,
      by + bh * 0.43,
      foil,
      Math.max(0.85, w * 0.031),
      seed + i * 4 + 1,
    );
  }
}

/**
 * Paint one of the seven premium non-quiet binding archetypes. The eighth
 * archetype is `plain`: material construction alone. Geometry here follows
 * what a binder physically does at shelf scale—rules, panels, cords, tooling
 * and sewing—rather than inventing a generic frame and decorating it.
 */
function drawBindingArchetype(
  ctx: FlatCtx,
  d: DesignBox,
  design: BookDesign,
  part: Extract<DecorPart, { k: 'binding' }>,
  foil: string,
  blind: string,
  stamp: string,
  seed: number,
): void {
  const { x, y, w, h } = d;
  const primary = Math.max(1.1, w * 0.045);
  const secondary = Math.max(0.9, w * 0.03);
  const px = (t: number): number => x + w * t;
  const py = (t: number): number => y + h * t;
  const ruled = (
    at: number,
    from: number,
    to: number,
    colour: string,
    line = primary,
    key = 0,
  ): void => stroke(ctx, px(from), py(at), px(to), py(at), colour, line, seed + key);

  switch (part.archetype) {
    case 'terminal': {
      // Nine press programmes: three deliberately quiet rule architectures
      // and six single-tool imprints. None is a recoloured head-pair/tail-pair
      // tuple, and no mark floats without a ruled construction to key into.
      const rhythms: readonly (readonly [number, number, number, 'foil' | 'blind', 'primary' | 'secondary'][])[] = [
        [[0.13, 0.15, 0.85, 'blind', 'primary'], [0.165, 0.15, 0.85, 'blind', 'secondary'], [0.84, 0.24, 0.76, 'foil', 'primary']],
        [[0.16, 0.2, 0.8, 'foil', 'primary'], [0.78, 0.31, 0.69, 'blind', 'secondary']],
        [[0.2, 0.3, 0.7, 'blind', 'secondary'], [0.82, 0.14, 0.86, 'foil', 'primary']],
        [[0.14, 0.14, 0.66, 'blind', 'primary'], [0.86, 0.34, 0.86, 'blind', 'primary']],
        [[0.18, 0.36, 0.84, 'blind', 'secondary'], [0.58, 0.18, 0.72, 'foil', 'primary'], [0.86, 0.48, 0.82, 'blind', 'secondary']],
        [[0.16, 0.2, 0.8, 'blind', 'secondary'], [0.74, 0.14, 0.86, 'blind', 'primary']],
        [[0.24, 0.15, 0.72, 'foil', 'primary'], [0.82, 0.28, 0.85, 'blind', 'secondary']],
        [[0.12, 0.22, 0.78, 'blind', 'primary'], [0.68, 0.14, 0.64, 'blind', 'secondary'], [0.84, 0.36, 0.86, 'foil', 'primary']],
        [[0.2, 0.13, 0.87, 'blind', 'secondary'], [0.8, 0.2, 0.8, 'foil', 'primary']],
      ];
      const rhythm = rhythms[part.variant] ?? rhythms[0] as readonly [number, number, number, 'foil' | 'blind', 'primary' | 'secondary'][];
      for (let i = 0; i < rhythm.length; i += 1) {
        const [at, from, to, colour, weight] = rhythm[i] as [number, number, number, 'foil' | 'blind', 'primary' | 'secondary'];
        ruled(at, from, to, colour === 'foil' ? foil : blind, weight === 'primary' ? primary : secondary, 10 + i);
      }
      if (part.glyph !== undefined) {
        const focalAt = [0.52, 0.48, 0.51, 0.5, 0.43, 0.48, 0.5, 0.46, 0.5][part.variant] ?? 0.5;
        drawOpenBinderTool(ctx, part.glyph, px(0.5), py(focalAt), w * 0.82, stamp, primary);
      }
      break;
    }
    case 'publisher-panel': {
      // Publisher cloth owns both continuous cases and deliberately open folio
      // fields. Each variant changes the large architecture, not a 1px offset.
      switch (part.variant) {
        case 0: { // grand quarto: double gilt case with unequal connected bays
          drawSquareFillet(ctx, px(0.14), py(0.07), w * 0.72, h * 0.86, foil, primary, seed + 20);
          drawSquareFillet(ctx, px(0.225), py(0.07) + w * 0.085, w * 0.55, h * 0.86 - w * 0.17, blind, secondary, seed + 21);
          ruled(0.29, 0.14, 0.86, blind, primary, 22);
          ruled(0.73, 0.14, 0.86, foil, secondary, 23);
          break;
        }
        case 1: { // Oxford: one calm double perimeter and no division
          drawSquareFillet(ctx, px(0.14), py(0.07), w * 0.72, h * 0.86, foil, primary, seed + 24);
          drawSquareFillet(ctx, px(0.225), py(0.07) + w * 0.085, w * 0.55, h * 0.86 - w * 0.17, blind, secondary, seed + 25);
          break;
        }
        case 2: { // Cambridge: blind case, low bay, integrated lozenge
          drawSquareFillet(ctx, px(0.16), py(0.09), w * 0.68, h * 0.82, blind, primary, seed + 26);
          ruled(0.72, 0.16, 0.84, foil, primary, 27);
          break;
        }
        case 3: { // Folio: open field with two unequal physical ledges
          ruled(0.2, 0.12, 0.88, blind, primary * 1.22, 28);
          ruled(0.67, 0.23, 0.82, foil, primary, 29);
          ruled(0.83, 0.12, 0.68, blind, secondary, 30);
          break;
        }
        case 4: { // Linen scholar: a single high blind case and open foot
          drawSquareFillet(ctx, px(0.18), py(0.09), w * 0.64, h * 0.58, blind, primary, seed + 31);
          ruled(0.82, 0.3, 0.7, blind, secondary, 32);
          break;
        }
        case 5: { // Buckram Oxford: one gilt case with an open acanthus bay
          drawSquareFillet(ctx, px(0.13), py(0.12), w * 0.74, h * 0.74, foil, primary, seed + 33);
          ruled(0.7, 0.13, 0.87, blind, secondary, 34);
          break;
        }
        case 6: { // Archive folio: open upper ledger and short tail docket
          ruled(0.16, 0.12, 0.88, blind, primary * 1.18, 35);
          ruled(0.36, 0.23, 0.84, blind, secondary, 36);
          ruled(0.82, 0.42, 0.88, foil, primary, 37);
          break;
        }
        default:
          break;
      }
      if (part.glyph !== undefined) {
        const focalAt = [0.52, 0.52, 0.43, 0.47, 0.74, 0.45, 0.59][part.variant] ?? 0.5;
        drawOpenBinderTool(ctx, part.glyph, px(0.5), py(focalAt), w * 0.78, stamp, primary);
      }
      break;
    }
    case 'corded-leather': {
      // Physical raised cords carry the design. One, two or three deliberately
      // unequal cords replace the old fourteen near-identical three-rung backs.
      // Select volumes strike one broad tool into the largest open bay.
      const stationSets: readonly (readonly number[])[] = [
        [0.2, 0.78],
        [0.16, 0.43, 0.82],
        [0.15, 0.7],
        [0.24, 0.74],
        [0.14, 0.38, 0.82],
        [0.28, 0.76],
        [0.15, 0.52, 0.85],
        [0.18, 0.73],
        [0.17, 0.8],
        [0.3, 0.72],
        [0.2, 0.47, 0.81],
        [0.18, 0.74],
        [0.24, 0.79],
        [0.15, 0.41, 0.84],
      ];
      const stations = stationSets[part.variant] ?? stationSets[0] as readonly number[];
      drawMaterialBands(
        ctx,
        d,
        design,
        {
          k: 'bands',
          at: stations,
          height: part.variant === 5 || part.variant === 9 ? 0.025 : 0.021,
          fill: part.variant === 10 || part.variant === 13 ? 'accent' : 'surface',
          shoulders: design.gilt && part.variant % 3 !== 0,
        },
        design.gilt ? foil : blind,
        seed + 30,
      );
      if (part.glyph !== undefined) {
        const focalStations = [0.5, 0.62, 0.43, 0.48, 0.6, 0.5, 0.33, 0.47, 0.49, 0.5, 0.63, 0.46, 0.51, 0.62] as const;
        drawOpenBinderTool(
          ctx,
          part.glyph,
          px(0.5),
          py(focalStations[part.variant] ?? 0.5),
          w * (part.variant === 10 || part.variant === 13 ? 0.76 : 0.72),
          stamp,
          primary,
        );
      }
      break;
    }
    case 'ceremonial-crown': {
      // Five state bindings, one focal each. Grand Crown owns the only crown;
      // the related velvet/calf/Russia/three-quarter volumes use distinct
      // classical tools instead of repeating the Welcome silhouette in colour.
      const cordSets: readonly (readonly number[])[] = [
        [0.19, 0.77], // Grand: unequal state cords around one open crown bay
        [0.25],       // Velvet anthemion: one high structural cord
        [0.18, 0.72], // Royal calf: paired shoulders around heraldic lozenge
        [0.21, 0.81], // Russia acanthus: wide blind central field
        [0.64],       // Three-quarter fleur: one broad lower cord
      ];
      const focalStations = [0.49, 0.58, 0.46, 0.52, 0.39] as const;
      drawMaterialBands(
        ctx,
        d,
        design,
        {
          k: 'bands',
          at: cordSets[part.variant] ?? cordSets[0] as readonly number[],
          height: part.variant === 0 ? 0.024 : 0.021,
          fill: part.variant === 4 ? 'accent' : 'surface',
          shoulders: part.variant !== 3,
        },
        foil,
        seed + 40,
      );
      if (part.variant === 0) {
        // Bespoke Welcome state architecture: blind construction establishes
        // the open bay, restrained gold rules lead into one broad open crown.
        ruled(0.31, 0.15, 0.85, blind, secondary, 42);
        ruled(0.68, 0.24, 0.76, foil, secondary, 43);
      } else if (part.variant === 1) {
        ruled(0.79, 0.18, 0.82, foil, primary, 44);
      } else if (part.variant === 2) {
        ruled(0.84, 0.32, 0.68, blind, secondary, 45);
      } else if (part.variant === 3) {
        ruled(0.15, 0.2, 0.8, blind, primary, 46);
        ruled(0.72, 0.3, 0.82, foil, secondary, 47);
      } else {
        ruled(0.18, 0.22, 0.78, blind, secondary, 48);
      }
      // Grand is the only Crown preset. Related state bindings are allowed to
      // be ceremonial through their cord and rule architecture alone; a
      // missing focal must never silently fall back to another crown.
      if (part.glyph !== undefined) {
        drawOpenBinderTool(
          ctx,
          part.glyph,
          px(0.5),
          py(focalStations[part.variant] ?? 0.49),
          w * (part.variant === 0 ? 0.94 : part.variant === 1 ? 0.86 : 0.8),
          stamp,
          part.variant === 0 ? primary * 1.08 : primary,
        );
      }
      break;
    }
    case 'diagonal-botanical': {
      // Seven botanical presets now use seven silhouette-distinct broad brass
      // tools. Remote rules vary by book role, but never become a frame or a
      // repeated field; the tool itself remains the one visual hierarchy.
      const topRules = [0.18, 0.24, 0.16, 0.28, 0.2, 0.14, 0.25] as const;
      const tailRules = [0.82, 0.76, 0.86, 0.72, 0.8, 0.84, 0.75] as const;
      const focalAt = [0.51, 0.49, 0.54, 0.5, 0.47, 0.52, 0.5] as const;
      ruled(topRules[part.variant] ?? 0.2, part.variant % 2 === 0 ? 0.17 : 0.31, part.variant % 2 === 0 ? 0.83 : 0.69, part.variant % 3 === 0 ? foil : blind, secondary, 50);
      ruled(tailRules[part.variant] ?? 0.8, part.variant % 3 === 1 ? 0.28 : 0.2, part.variant % 3 === 1 ? 0.72 : 0.8, part.variant % 2 === 0 ? blind : foil, secondary, 51);
      drawOpenBinderTool(
        ctx,
        part.glyph ?? 'sprig',
        px(0.5),
        py(focalAt[part.variant] ?? 0.5),
        w * (part.variant === 0 ? 0.96 : part.variant === 3 || part.variant === 4 ? 0.9 : 0.84),
        stamp,
        primary,
      );
      break;
    }
    case 'laureate': {
      // Eight prize/terminal volumes share a formal open-field grammar but not
      // a repeated laurel stamp. Each tool owns a distinct silhouette and an
      // unequal pair of remote rules tuned to its material.
      const top = [0.22, 0.29, 0.18, 0.26, 0.16, 0.31, 0.2, 0.28] as const;
      const tail = [0.79, 0.72, 0.84, 0.76, 0.87, 0.7, 0.81, 0.74] as const;
      const focal = [0.5, 0.53, 0.48, 0.54, 0.46, 0.52, 0.49, 0.51] as const;
      ruled(top[part.variant] ?? 0.24, part.variant % 2 === 0 ? 0.18 : 0.28, part.variant % 2 === 0 ? 0.82 : 0.72, part.variant % 3 === 0 ? foil : blind, secondary, 60);
      ruled(tail[part.variant] ?? 0.78, part.variant % 3 === 0 ? 0.27 : 0.18, part.variant % 3 === 0 ? 0.73 : 0.82, part.variant % 2 === 0 ? blind : foil, secondary, 61);
      const paleFocal = part.variant === 5 || part.variant === 7;
      drawOpenBinderTool(
        ctx,
        part.glyph ?? 'laurel',
        px(0.5),
        py(focal[part.variant] ?? 0.5),
        w * (paleFocal ? 1.12 : part.variant === 1 ? 0.96 : 0.88),
        paleFocal ? mix(stamp, FLAT.ink, 0.18) : stamp,
        primary,
      );
      break;
    }
    case 'structural-sewing': {
      const wrapper = design.material === 'paper-wrapper';
      // One continuous joint fold is common to the family; lacing and sewing
      // rhythms are intentionally unequal so folio, abbey, scholar and archive
      // do not compress into one three-rung parchment back.
      ctx.beginPath();
      const foldAt = 0.15 + (part.variant % 3) * 0.025;
      ctx.moveTo(px(foldAt), py(0.08));
      ctx.quadraticCurveTo(px(foldAt - 0.025), py(0.5), px(foldAt), py(0.92));
      ctx.strokeStyle = blind;
      ctx.lineWidth = primary;
      ctx.lineCap = 'round';
      ctx.stroke();
      if (wrapper) {
        const stationSets: Readonly<Record<number, readonly number[]>> = {
          5: [0.2, 0.8],
          6: [0.17, 0.73],
          7: [0.14, 0.47, 0.84],
        };
        const stations = stationSets[part.variant] ?? [0.18, 0.82];
        for (let i = 0; i < stations.length; i += 1) {
          const at = stations[i] as number;
          const reach = part.variant === 7 ? 0.44 + i * 0.1 : 0.5 + (i % 2) * 0.12;
          ruled(at, foldAt, reach, i === 1 ? foil : blind, i === 1 ? secondary : primary, 70 + i);
        }
        if (part.glyph !== undefined) {
          drawOpenBinderTool(ctx, part.glyph, px(0.58), py(0.47), w * 0.72, stamp, primary);
        }
      } else {
        const stationSets: readonly (readonly number[])[] = [
          [0.18, 0.76],
          [0.24, 0.52, 0.83],
          [0.16, 0.68],
          [0.31, 0.74],
          [0.22, 0.8],
        ];
        const stations = stationSets[part.variant] ?? stationSets[0] as readonly number[];
        drawMaterialBands(
          ctx,
          d,
          design,
          {
            k: 'bands',
            at: stations,
            height: part.variant === 1 ? 0.022 : 0.019,
            fill: part.variant === 2 ? 'accent' : 'surface',
            shoulders: part.variant === 0 || part.variant === 3,
          },
          blind,
          seed + 75,
        );
      }
      break;
    }
    default:
      break;
  }
}

/** Retired first-pass filled tool kept beside the historical renderer only. */
function drawRetiredFilledFocal(
  ctx: FlatCtx,
  glyph: BroadFocalGlyph,
  cx: number,
  cy: number,
  width: number,
  colour: string,
  ink: number,
): void {
  if (width < 6) return;
  const r = width / 2;
  const outline = Math.max(0.9, ink * 0.56);
  ctx.fillStyle = colour;
  ctx.strokeStyle = FLAT.ink;
  ctx.lineWidth = outline;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const leaf = (lx: number, ly: number, angle: number, long: number, broad: number): void => {
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -long);
    ctx.quadraticCurveTo(broad, 0, 0, long);
    ctx.quadraticCurveTo(-broad, 0, 0, -long);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  switch (glyph) {
    case 'crown':
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.86, cy + r * 0.42);
      ctx.lineTo(cx - r * 0.82, cy - r * 0.28);
      ctx.lineTo(cx - r * 0.38, cy + r * 0.02);
      ctx.lineTo(cx, cy - r * 0.86);
      ctx.lineTo(cx + r * 0.38, cy + r * 0.02);
      ctx.lineTo(cx + r * 0.82, cy - r * 0.28);
      ctx.lineTo(cx + r * 0.86, cy + r * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.rect(cx - r * 0.94, cy + r * 0.42, r * 1.88, r * 0.34);
      ctx.fill();
      ctx.stroke();
      break;
    case 'palmette':
      // Three broad lobes over one square foot. Five thin rays became a sun or
      // splash at shelf scale; an anthemion must read as one filled fan.
      for (const [angle, dx, scale] of [
        [-0.62, -0.32, 0.82], [0, 0, 1.02], [0.62, 0.32, 0.82],
      ] as const) {
        leaf(cx + r * dx, cy - r * 0.06, angle, r * scale, r * 0.34);
      }
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.78, cy + r * 0.56);
      ctx.lineTo(cx + r * 0.78, cy + r * 0.56);
      ctx.lineTo(cx + r * 0.64, cy + r * 0.83);
      ctx.lineTo(cx - r * 0.64, cy + r * 0.83);
      ctx.closePath();
      ctx.fill();
      break;
    case 'sprig':
      // A compact leaf cluster, not a long scratch trail. The broad leaves
      // dominate the short stem at 30px and remain recognisably botanical.
      ctx.strokeStyle = colour;
      ctx.lineWidth = Math.max(1.5, r * 0.22);
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 0.78);
      ctx.quadraticCurveTo(cx - r * 0.12, cy + r * 0.05, cx, cy - r * 0.58);
      ctx.stroke();
      leaf(cx, cy - r * 0.58, 0, r * 0.43, r * 0.27);
      for (const [dy, side] of [[-0.25, -1], [-0.06, 1], [0.27, -1], [0.43, 1]] as const) {
        leaf(cx + side * r * 0.4, cy + dy * r, side * 0.9, r * 0.42, r * 0.25);
      }
      break;
    case 'laurel':
      // One diagonal, leafy spray. Symmetric U and V arrangements became a
      // horseshoe or a winged badge at shelf scale; the diagonal silhouette is
      // read as a branch before it can be mistaken for heraldic hardware.
      ctx.strokeStyle = colour;
      ctx.lineWidth = Math.max(1.5, r * 0.2);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.62, cy + r * 0.8);
      ctx.quadraticCurveTo(cx - r * 0.02, cy + r * 0.12, cx + r * 0.52, cy - r * 0.78);
      ctx.stroke();
      for (let i = 0; i < 5; i += 1) {
        const t = (i + 0.55) / 5.3;
        const side = i % 2 === 0 ? -1 : 1;
        const lx = cx - r * 0.62 + r * 1.14 * t + side * r * 0.19;
        const ly = cy + r * 0.8 - r * 1.58 * t + side * r * 0.05;
        leaf(lx, ly, -0.72 + side * 0.9, r * 0.36, r * 0.22);
      }
      leaf(cx + r * 0.5, cy - r * 0.78, -0.72, r * 0.4, r * 0.24);
      break;
    case 'shield':
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.72, cy - r * 0.82);
      ctx.lineTo(cx + r * 0.72, cy - r * 0.82);
      ctx.lineTo(cx + r * 0.68, cy + r * 0.08);
      ctx.quadraticCurveTo(cx + r * 0.48, cy + r * 0.7, cx, cy + r);
      ctx.quadraticCurveTo(cx - r * 0.48, cy + r * 0.7, cx - r * 0.68, cy + r * 0.08);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.58, cy - r * 0.12);
      ctx.lineTo(cx + r * 0.58, cy - r * 0.12);
      ctx.strokeStyle = FLAT.ink;
      ctx.lineWidth = Math.max(1, outline * 0.9);
      ctx.stroke();
      break;
    case 'fleuron':
      leaf(cx, cy - r * 0.23, 0, r * 0.72, r * 0.28);
      leaf(cx - r * 0.38, cy + r * 0.03, -0.82, r * 0.58, r * 0.24);
      leaf(cx + r * 0.38, cy + r * 0.03, 0.82, r * 0.58, r * 0.24);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.72, cy + r * 0.68);
      ctx.lineTo(cx + r * 0.72, cy + r * 0.68);
      ctx.strokeStyle = colour;
      ctx.lineWidth = Math.max(1.2, r * 0.17);
      ctx.stroke();
      break;
    default:
      break;
  }
}
// Keep the historical diagnostic renderer type-checked, but never call it.
void drawRetiredFilledFocal;

/**
 * One broad OPEN binder's tool. These are continuous struck-line programmes,
 * not filled pictograms pasted into a panel: every motif grows out of a base
 * ledge or side return and every leaf keeps one readable outline contour.
 */
export function drawOpenBinderTool(
  ctx: FlatCtx,
  glyph: BroadFocalGlyph,
  cx: number,
  cy: number,
  width: number,
  colour: string,
  ink: number,
): void {
  if (width < 6) return;
  const r = width / 2;
  const tool = Math.max(1.25, Math.min(r * 0.16, ink * 1.15));
  ctx.strokeStyle = colour;
  ctx.lineWidth = tool;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const strike = (line = tool): void => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = line;
    ctx.stroke();
  };

  const leaf = (
    lx: number,
    ly: number,
    angle: number,
    long: number,
    broad: number,
  ): void => {
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -long);
    ctx.quadraticCurveTo(broad, 0, 0, long);
    ctx.quadraticCurveTo(-broad, 0, 0, -long);
    ctx.closePath();
    strike(Math.max(0.9, tool * 0.86));
    ctx.beginPath();
    ctx.moveTo(0, -long * 0.68);
    ctx.lineTo(0, long * 0.68);
    strike(Math.max(0.8, tool * 0.62));
    ctx.restore();
  };

  const shoulders = (atY: number, inner: number, outer = 1.12): void => {
    ctx.beginPath();
    ctx.moveTo(cx - r * outer, atY);
    ctx.lineTo(cx - r * inner, atY);
    ctx.moveTo(cx + r * inner, atY);
    ctx.lineTo(cx + r * outer, atY);
    strike(Math.max(0.95, tool * 0.82));
  };

  const lozenge = (lx: number, ly: number, size: number): void => {
    ctx.beginPath();
    ctx.moveTo(lx, ly - size);
    ctx.lineTo(lx + size * 0.72, ly);
    ctx.lineTo(lx, ly + size);
    ctx.lineTo(lx - size * 0.72, ly);
    ctx.closePath();
    strike(Math.max(0.82, tool * 0.68));
  };

  switch (glyph) {
    case 'crown': {
      // Bowed circlet, paired arches and three finials. The circlet continues
      // into the compartment shoulders, so the crown cannot become a sticker.
      const base = cy + r * 0.48;
      shoulders(base, 0.88, 1.18);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.88, base);
      ctx.quadraticCurveTo(cx, base + r * 0.19, cx + r * 0.88, base);
      ctx.moveTo(cx - r * 0.84, base - r * 0.17);
      ctx.quadraticCurveTo(cx, base + r * 0.01, cx + r * 0.84, base - r * 0.17);
      strike();
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.78, base - r * 0.18);
      ctx.quadraticCurveTo(cx - r * 0.78, cy - r * 0.18, cx - r * 0.62, cy - r * 0.42);
      ctx.quadraticCurveTo(cx - r * 0.46, cy - r * 0.2, cx - r * 0.28, cy - r * 0.1);
      ctx.quadraticCurveTo(cx - r * 0.14, cy - r * 0.43, cx, cy - r * 0.72);
      ctx.quadraticCurveTo(cx + r * 0.14, cy - r * 0.43, cx + r * 0.28, cy - r * 0.1);
      ctx.quadraticCurveTo(cx + r * 0.46, cy - r * 0.2, cx + r * 0.62, cy - r * 0.42);
      ctx.quadraticCurveTo(cx + r * 0.78, cy - r * 0.18, cx + r * 0.78, base - r * 0.18);
      strike();
      lozenge(cx - r * 0.62, cy - r * 0.46, r * 0.14);
      lozenge(cx, cy - r * 0.78, r * 0.15);
      lozenge(cx + r * 0.62, cy - r * 0.46, r * 0.14);
      break;
    }
    case 'palmette': {
      // A three-petal anthemion: each petal owns a separate contour and grows
      // from one double waist. The former crossing side curves collapsed into
      // an M/tent at 30px.
      const base = cy + r * 0.62;
      shoulders(base, 0.62);
      ctx.beginPath();
      ctx.moveTo(cx, base - r * 0.08);
      ctx.quadraticCurveTo(cx - r * 0.2, cy - r * 0.35, cx, cy - r * 0.9);
      ctx.quadraticCurveTo(cx + r * 0.2, cy - r * 0.35, cx, base - r * 0.08);
      ctx.moveTo(cx - r * 0.1, base - r * 0.04);
      ctx.bezierCurveTo(
        cx - r * 0.32,
        cy + r * 0.2,
        cx - r * 0.76,
        cy - r * 0.02,
        cx - r * 0.68,
        cy - r * 0.5,
      );
      ctx.quadraticCurveTo(cx - r * 0.36, cy - r * 0.28, cx - r * 0.1, base - r * 0.04);
      ctx.moveTo(cx + r * 0.1, base - r * 0.04);
      ctx.bezierCurveTo(
        cx + r * 0.32,
        cy + r * 0.2,
        cx + r * 0.76,
        cy - r * 0.02,
        cx + r * 0.68,
        cy - r * 0.5,
      );
      ctx.quadraticCurveTo(cx + r * 0.36, cy - r * 0.28, cx + r * 0.1, base - r * 0.04);
      strike();
      // Two outer leaves complete the five-leaf anthemion and make the tool
      // materially broader than the terminal rosette/fleuron families.
      leaf(cx - r * 0.7, cy + r * 0.02, -1.02, r * 0.38, r * 0.18);
      leaf(cx + r * 0.7, cy + r * 0.02, 1.02, r * 0.38, r * 0.18);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.58, base - r * 0.02);
      ctx.lineTo(cx + r * 0.58, base - r * 0.02);
      ctx.moveTo(cx - r * 0.49, base - r * 0.18);
      ctx.lineTo(cx + r * 0.49, base - r * 0.18);
      strike(Math.max(0.9, tool * 0.76));
      break;
    }
    case 'sprig': {
      const base = cy + r * 0.84;
      shoulders(base, 0.36);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.bezierCurveTo(cx - r * 0.16, cy + r * 0.25, cx + r * 0.12, cy - r * 0.26, cx, cy - r * 0.78);
      strike();
      for (const [dy, side, angle] of [
        [0.42, -1, -0.86], [0.19, 1, 0.86], [-0.08, -1, -0.82], [-0.32, 1, 0.82],
      ] as const) {
        const px = cx + side * r * 0.29;
        const py = cy + dy * r;
        ctx.beginPath();
        ctx.moveTo(cx + side * r * 0.02, py + r * 0.11);
        ctx.lineTo(px, py);
        strike(Math.max(0.86, tool * 0.7));
        leaf(px + side * r * 0.12, py - r * 0.05, angle, r * 0.3, r * 0.14);
      }
      leaf(cx, cy - r * 0.73, 0, r * 0.34, r * 0.15);
      break;
    }
    case 'laurel': {
      // One broad, gently turning branch with five attached leaves. Earlier
      // paired stems became either a wishbone or a dense heraldic crest at
      // 30px; this asymmetric brass strike keeps a botanical silhouette while
      // every leaf remains large enough to survive the shelf bake.
      const base = cy + r * 0.76;
      shoulders(base, 0.5);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.22, base);
      ctx.bezierCurveTo(
        cx - r * 0.36,
        cy + r * 0.22,
        cx + r * 0.28,
        cy - r * 0.14,
        cx + r * 0.18,
        cy - r * 0.76,
      );
      strike();
      for (const [px, py, angle] of [
        [-0.38, 0.32, -1.02], [0.22, 0.13, 1.02],
        [-0.18, -0.12, -0.98], [0.42, -0.36, 0.92],
      ] as const) {
        leaf(cx + r * px, cy + r * py, angle, r * 0.43, r * 0.22);
      }
      leaf(cx + r * 0.18, cy - r * 0.7, 0.12, r * 0.44, r * 0.22);
      break;
    }
    case 'shield': {
      // Interlaced heraldic lozenge and cross. This replaces the outlined
      // shield badge entirely and grows into the neighbouring side rules.
      shoulders(cy, 0.72, 1.18);
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.9);
      ctx.lineTo(cx + r * 0.7, cy);
      ctx.lineTo(cx, cy + r * 0.9);
      ctx.lineTo(cx - r * 0.7, cy);
      ctx.closePath();
      strike();
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.61);
      ctx.lineTo(cx + r * 0.45, cy);
      ctx.lineTo(cx, cy + r * 0.61);
      ctx.lineTo(cx - r * 0.45, cy);
      ctx.closePath();
      ctx.moveTo(cx - r * 0.54, cy);
      ctx.lineTo(cx + r * 0.54, cy);
      ctx.moveTo(cx, cy - r * 0.68);
      ctx.lineTo(cx, cy + r * 0.68);
      strike(Math.max(0.84, tool * 0.68));
      break;
    }
    case 'fleuron': {
      // A broad three-lobed printer's fleuron: the lateral petals own almost
      // the full tool width and the open C-scroll foot keeps it out of the
      // tulip family at shelf scale.
      const base = cy + r * 0.58;
      shoulders(base, 0.66);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.quadraticCurveTo(cx - r * 0.3, cy - r * 0.18, cx, cy - r * 0.98);
      ctx.quadraticCurveTo(cx + r * 0.3, cy - r * 0.18, cx, base);
      ctx.moveTo(cx - r * 0.08, base - r * 0.02);
      ctx.bezierCurveTo(
        cx - r * 0.36, cy + r * 0.06,
        cx - r * 0.92, cy - r * 0.04,
        cx - r * 0.82, cy - r * 0.58,
      );
      ctx.quadraticCurveTo(cx - r * 0.44, cy - r * 0.32, cx - r * 0.08, base - r * 0.02);
      ctx.moveTo(cx + r * 0.08, base - r * 0.02);
      ctx.bezierCurveTo(
        cx + r * 0.36, cy + r * 0.06,
        cx + r * 0.92, cy - r * 0.04,
        cx + r * 0.82, cy - r * 0.58,
      );
      ctx.quadraticCurveTo(cx + r * 0.44, cy - r * 0.32, cx + r * 0.08, base - r * 0.02);
      strike();
      ctx.beginPath();
      ctx.moveTo(cx, base - r * 0.02);
      ctx.bezierCurveTo(cx - r * 0.12, cy + r * 0.84, cx - r * 0.72, cy + r * 0.84, cx - r * 0.68, cy + r * 0.48);
      ctx.moveTo(cx, base - r * 0.02);
      ctx.bezierCurveTo(cx + r * 0.12, cy + r * 0.84, cx + r * 0.72, cy + r * 0.84, cx + r * 0.68, cy + r * 0.48);
      strike(Math.max(0.9, tool * 0.76));
      break;
    }
    case 'compass': {
      // A compass rose built from two open axes and four lance outlines. There
      // is no centre rivet or filled star to turn it into hardware.
      shoulders(cy, 0.84, 1.16);
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.92);
      ctx.lineTo(cx + r * 0.2, cy - r * 0.24);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx - r * 0.2, cy - r * 0.24);
      ctx.closePath();
      ctx.moveTo(cx, cy + r * 0.92);
      ctx.lineTo(cx + r * 0.2, cy + r * 0.24);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx - r * 0.2, cy + r * 0.24);
      ctx.closePath();
      ctx.moveTo(cx - r * 0.86, cy);
      ctx.lineTo(cx - r * 0.22, cy - r * 0.18);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx - r * 0.22, cy + r * 0.18);
      ctx.closePath();
      ctx.moveTo(cx + r * 0.86, cy);
      ctx.lineTo(cx + r * 0.22, cy - r * 0.18);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + r * 0.22, cy + r * 0.18);
      ctx.closePath();
      strike();
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.46, cy - r * 0.46);
      ctx.lineTo(cx + r * 0.46, cy + r * 0.46);
      ctx.moveTo(cx + r * 0.46, cy - r * 0.46);
      ctx.lineTo(cx - r * 0.46, cy + r * 0.46);
      strike(Math.max(0.85, tool * 0.64));
      break;
    }
    case 'rosette': {
      // A five-petal rose on a stem and leafed foot. The asymmetric plant
      // construction prevents the old four loops becoming a propeller/button.
      const base = cy + r * 0.72;
      shoulders(base, 0.56);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.quadraticCurveTo(cx - r * 0.08, cy + r * 0.18, cx, cy - r * 0.2);
      strike();
      leaf(cx - r * 0.36, cy + r * 0.28, -0.92, r * 0.34, r * 0.16);
      leaf(cx + r * 0.36, cy + r * 0.16, 0.92, r * 0.34, r * 0.16);
      for (let i = 0; i < 5; i += 1) {
        const a = (i * Math.PI * 2) / 5;
        ctx.save();
        ctx.translate(cx, cy - r * 0.34);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(-r * 0.2, -r * 0.1, -r * 0.2, -r * 0.48, 0, -r * 0.6);
        ctx.bezierCurveTo(r * 0.2, -r * 0.48, r * 0.2, -r * 0.1, 0, 0);
        strike(Math.max(0.92, tool * 0.78));
        ctx.restore();
      }
      break;
    }
    case 'fleur-de-lis': {
      // Three visibly separate rising petals, one low waist and a short split
      // foot. The former closed centre/side loops merged into an eye-shaped
      // lozenge at 30px; these open lobes preserve the fleur silhouette.
      const waist = cy + r * 0.28;
      ctx.beginPath();
      ctx.moveTo(cx, waist);
      ctx.quadraticCurveTo(cx - r * 0.2, cy - r * 0.28, cx, cy - r * 0.9);
      ctx.quadraticCurveTo(cx + r * 0.2, cy - r * 0.28, cx, waist);
      ctx.moveTo(cx - r * 0.05, waist - r * 0.02);
      ctx.bezierCurveTo(
        cx - r * 0.28, cy - r * 0.08,
        cx - r * 0.78, cy - r * 0.2,
        cx - r * 0.82, cy - r * 0.62,
      );
      ctx.quadraticCurveTo(cx - r * 0.44, cy - r * 0.42, cx - r * 0.05, waist - r * 0.02);
      ctx.moveTo(cx + r * 0.05, waist - r * 0.02);
      ctx.bezierCurveTo(
        cx + r * 0.28, cy - r * 0.08,
        cx + r * 0.78, cy - r * 0.2,
        cx + r * 0.82, cy - r * 0.62,
      );
      ctx.quadraticCurveTo(cx + r * 0.44, cy - r * 0.42, cx + r * 0.05, waist - r * 0.02);
      strike();
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.38, waist + r * 0.04);
      ctx.lineTo(cx + r * 0.38, waist + r * 0.04);
      ctx.moveTo(cx - r * 0.2, waist + r * 0.13);
      ctx.quadraticCurveTo(cx - r * 0.1, cy + r * 0.62, cx, cy + r * 0.78);
      ctx.quadraticCurveTo(cx + r * 0.1, cy + r * 0.62, cx + r * 0.2, waist + r * 0.13);
      strike(Math.max(0.9, tool * 0.76));
      break;
    }
    case 'starflower': {
      // A six-point foliate flower is built from open lozenges on a stem,
      // rather than the stock five-point star which read as an app icon.
      const flowerY = cy - r * 0.3;
      const base = cy + r * 0.76;
      shoulders(base, 0.56);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.lineTo(cx, flowerY + r * 0.34);
      strike();
      for (let i = 0; i < 6; i += 1) {
        const angle = (Math.PI * 2 * i) / 6;
        const px = cx + Math.cos(angle) * r * 0.38;
        const py = flowerY + Math.sin(angle) * r * 0.38;
        leaf(px, py, angle + Math.PI / 2, r * 0.33, r * 0.13);
      }
      leaf(cx - r * 0.38, cy + r * 0.3, -0.9, r * 0.3, r * 0.14);
      leaf(cx + r * 0.38, cy + r * 0.17, 0.9, r * 0.3, r * 0.14);
      break;
    }
    case 'acanthus': {
      // A strong central staff keeps the bilateral S-scroll from collapsing
      // into the U/horseshoe seen in the first narrow companion proof.
      const base = cy + r * 0.7;
      shoulders(base, 0.56);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.quadraticCurveTo(cx - r * 0.08, cy, cx, cy - r * 0.86);
      ctx.moveTo(cx, cy + r * 0.42);
      ctx.bezierCurveTo(cx - r * 0.22, cy + r * 0.32, cx - r * 0.78, cy + r * 0.12, cx - r * 0.68, cy - r * 0.25);
      ctx.quadraticCurveTo(cx - r * 0.58, cy - r * 0.52, cx - r * 0.28, cy - r * 0.45);
      ctx.moveTo(cx, cy + r * 0.15);
      ctx.bezierCurveTo(cx + r * 0.22, cy + r * 0.05, cx + r * 0.78, cy - r * 0.14, cx + r * 0.68, cy - r * 0.5);
      ctx.quadraticCurveTo(cx + r * 0.58, cy - r * 0.72, cx + r * 0.3, cy - r * 0.64);
      strike();
      leaf(cx - r * 0.58, cy - r * 0.34, -0.82, r * 0.36, r * 0.17);
      leaf(cx + r * 0.58, cy - r * 0.59, 0.82, r * 0.36, r * 0.17);
      leaf(cx - r * 0.34, cy + r * 0.24, -1.02, r * 0.32, r * 0.15);
      leaf(cx + r * 0.34, cy - r * 0.02, 1.02, r * 0.32, r * 0.15);
      break;
    }
    case 'sunrise': {
      // The rays grow directly out of a ruled horizon. With no detached disc
      // this reads as a binder's sunrise, never an asterisk or brass rivet.
      const horizon = cy + r * 0.42;
      shoulders(horizon, 0.82, 1.18);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.78, horizon);
      ctx.quadraticCurveTo(cx, cy - r * 0.62, cx + r * 0.78, horizon);
      ctx.moveTo(cx - r * 0.65, horizon);
      ctx.quadraticCurveTo(cx, cy - r * 0.34, cx + r * 0.65, horizon);
      strike();
      for (const [dx, top] of [[-0.72, -0.18], [-0.43, -0.52], [0, -0.78], [0.43, -0.52], [0.72, -0.18]] as const) {
        ctx.beginPath();
        ctx.moveTo(cx + r * dx * 0.72, cy + r * 0.18);
        ctx.lineTo(cx + r * dx, cy + r * top);
        strike(Math.max(0.9, tool * 0.74));
      }
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.58, horizon + r * 0.16);
      ctx.lineTo(cx + r * 0.58, horizon + r * 0.16);
      strike(Math.max(0.9, tool * 0.75));
      break;
    }
    case 'oak-spray': {
      // An upright oak-and-acorn press tool replaces the diagonal leaf chain
      // which aliased into a scratch on the first true-size proof.
      const base = cy + r * 0.72;
      shoulders(base, 0.58);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.quadraticCurveTo(cx - r * 0.1, cy + r * 0.05, cx, cy - r * 0.72);
      ctx.moveTo(cx, cy + r * 0.23);
      ctx.lineTo(cx - r * 0.48, cy - r * 0.05);
      ctx.moveTo(cx, cy - r * 0.05);
      ctx.lineTo(cx + r * 0.48, cy - r * 0.3);
      strike();
      leaf(cx - r * 0.56, cy - r * 0.08, -0.92, r * 0.46, r * 0.23);
      leaf(cx + r * 0.56, cy - r * 0.33, 0.92, r * 0.46, r * 0.23);
      leaf(cx, cy - r * 0.68, 0, r * 0.4, r * 0.2);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.08, cy + r * 0.02);
      ctx.quadraticCurveTo(cx + r * 0.28, cy + r * 0.2, cx + r * 0.3, cy + r * 0.45);
      ctx.quadraticCurveTo(cx + r * 0.12, cy + r * 0.65, cx - r * 0.06, cy + r * 0.45);
      ctx.quadraticCurveTo(cx, cy + r * 0.2, cx - r * 0.08, cy + r * 0.02);
      strike(Math.max(0.9, tool * 0.82));
      break;
    }
    case 'thistle': {
      // A broad cut thistle head on one stem, with two long tied leaves. The
      // scalloped crown is continuous rather than a halo of prickly dots.
      const base = cy + r * 0.76;
      shoulders(base, 0.55);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.lineTo(cx, cy + r * 0.06);
      ctx.moveTo(cx - r * 0.54, cy - r * 0.34);
      ctx.quadraticCurveTo(cx - r * 0.38, cy - r * 0.72, cx - r * 0.18, cy - r * 0.54);
      ctx.quadraticCurveTo(cx, cy - r * 0.94, cx + r * 0.18, cy - r * 0.54);
      ctx.quadraticCurveTo(cx + r * 0.38, cy - r * 0.72, cx + r * 0.54, cy - r * 0.34);
      ctx.quadraticCurveTo(cx, cy + r * 0.05, cx - r * 0.54, cy - r * 0.34);
      strike();
      leaf(cx - r * 0.42, cy + r * 0.27, -1.02, r * 0.42, r * 0.17);
      leaf(cx + r * 0.42, cy + r * 0.16, 1.02, r * 0.42, r * 0.17);
      break;
    }
    case 'ivy-knot': {
      // An upright ivy cutting with three large attached leaves. The attempted
      // quatrefoil knot collapsed into a tiny X/hardware mark on a 30px spine;
      // this botanical companion is honest, asymmetric and stroke-readable.
      const base = cy + r * 0.72;
      shoulders(base, 0.55);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.bezierCurveTo(cx - r * 0.16, cy + r * 0.22, cx + r * 0.14, cy - r * 0.18, cx, cy - r * 0.72);
      ctx.moveTo(cx - r * 0.02, cy + r * 0.18);
      ctx.lineTo(cx - r * 0.43, cy - r * 0.02);
      ctx.moveTo(cx + r * 0.02, cy - r * 0.1);
      ctx.lineTo(cx + r * 0.45, cy - r * 0.34);
      strike();
      leaf(cx - r * 0.52, cy - r * 0.05, -0.96, r * 0.44, r * 0.24);
      leaf(cx + r * 0.54, cy - r * 0.38, 0.96, r * 0.44, r * 0.24);
      leaf(cx, cy - r * 0.7, 0.05, r * 0.42, r * 0.23);
      break;
    }
    case 'oak-volutes': {
      // One unmistakable acanthus arabesque: a spearhead rises through two
      // broad open S-volutes. Leaf pips were removed because they made the
      // earlier version read as a bird or paired animals at rest.
      const base = cy + r * 0.66;
      shoulders(base, 0.62);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.lineTo(cx, cy - r * 0.9);
      for (const side of [-1, 1] as const) {
        ctx.moveTo(cx, cy + r * 0.42);
        ctx.bezierCurveTo(
          cx + side * r * 0.2, cy + r * 0.12,
          cx + side * r * 0.92, cy + r * 0.28,
          cx + side * r * 0.82, cy - r * 0.26,
        );
        ctx.bezierCurveTo(
          cx + side * r * 0.76, cy - r * 0.62,
          cx + side * r * 0.3, cy - r * 0.56,
          cx + side * r * 0.38, cy - r * 0.2,
        );
      }
      strike();
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 1.02);
      ctx.lineTo(cx - r * 0.22, cy - r * 0.64);
      ctx.lineTo(cx, cy - r * 0.42);
      ctx.lineTo(cx + r * 0.22, cy - r * 0.64);
      ctx.closePath();
      strike(Math.max(0.9, tool * 0.72));
      break;
    }
    case 'wheat-saltire': {
      // One tied, upright sheaf replaces the crossed saltire, whose inevitable
      // X read as crossed swords/hardware. Five broad grains remain legible at
      // shelf size and the ledge reads as the binder's tied foot.
      const base = cy + r * 0.7;
      shoulders(base, 0.5);
      for (const [x, top] of [[-0.3, -0.56], [0, -0.9], [0.3, -0.65]] as const) {
        ctx.beginPath();
        ctx.moveTo(cx + r * x * 0.38, base);
        ctx.quadraticCurveTo(cx + r * x, cy, cx + r * x, cy + r * top);
        strike();
        for (const [side, dy] of [[-1, 0.16], [1, -0.03]] as const) {
          leaf(
            cx + r * (x + side * 0.14),
            cy + r * (top + 0.2 + dy),
            side * 0.92,
            r * 0.3,
            r * 0.16,
          );
        }
      }
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.32, cy + r * 0.5);
      ctx.lineTo(cx + r * 0.32, cy + r * 0.5);
      strike(Math.max(0.9, tool * 0.74));
      break;
    }
    case 'pomegranate': {
      // Open split fruit with a crown calyx, two side leaves and a ruled foot.
      // The broken waist prevents the fruit from becoming a coin or roundel.
      const base = cy + r * 0.7;
      shoulders(base, 0.58);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.quadraticCurveTo(cx - r * 0.62, cy + r * 0.35, cx - r * 0.5, cy - r * 0.22);
      ctx.quadraticCurveTo(cx - r * 0.42, cy - r * 0.55, cx - r * 0.14, cy - r * 0.52);
      ctx.moveTo(cx, base);
      ctx.quadraticCurveTo(cx + r * 0.62, cy + r * 0.35, cx + r * 0.5, cy - r * 0.22);
      ctx.quadraticCurveTo(cx + r * 0.42, cy - r * 0.55, cx + r * 0.14, cy - r * 0.52);
      ctx.moveTo(cx - r * 0.28, cy - r * 0.5);
      ctx.lineTo(cx - r * 0.12, cy - r * 0.8);
      ctx.lineTo(cx, cy - r * 0.58);
      ctx.lineTo(cx + r * 0.12, cy - r * 0.8);
      ctx.lineTo(cx + r * 0.28, cy - r * 0.5);
      strike();
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.46);
      ctx.lineTo(cx, cy + r * 0.55);
      ctx.moveTo(cx - r * 0.3, cy + r * 0.08);
      ctx.quadraticCurveTo(cx, cy + r * 0.3, cx + r * 0.3, cy + r * 0.08);
      strike(Math.max(0.9, tool * 0.68));
      break;
    }
    case 'tulip': {
      // A three-petal open tulip grows from one curved stem and a double leaf
      // foot. It cannot collapse to the round rosette or upright fleuron.
      const base = cy + r * 0.76;
      shoulders(base, 0.54);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.quadraticCurveTo(cx - r * 0.12, cy + r * 0.12, cx, cy - r * 0.2);
      ctx.moveTo(cx - r * 0.56, cy - r * 0.48);
      ctx.quadraticCurveTo(cx - r * 0.3, cy - r * 0.8, cx, cy - r * 0.5);
      ctx.quadraticCurveTo(cx + r * 0.3, cy - r * 0.8, cx + r * 0.56, cy - r * 0.48);
      ctx.quadraticCurveTo(cx + r * 0.42, cy - r * 0.08, cx, cy - r * 0.2);
      ctx.quadraticCurveTo(cx - r * 0.42, cy - r * 0.08, cx - r * 0.56, cy - r * 0.48);
      strike();
      leaf(cx - r * 0.4, cy + r * 0.27, -1.02, r * 0.42, r * 0.16);
      leaf(cx + r * 0.4, cy + r * 0.18, 1.02, r * 0.42, r * 0.16);
      break;
    }
    case 'pinecone': {
      // The needle fans now rise behind the cone instead of projecting as
      // insect legs. Three joined courses make the upright cone unmistakable.
      const base = cy + r * 0.72;
      shoulders(base, 0.56);
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(cx + side * r * 0.16, cy + r * 0.42);
        ctx.quadraticCurveTo(cx + side * r * 0.5, cy - r * 0.05, cx + side * r * 0.76, cy - r * 0.58);
        ctx.moveTo(cx + side * r * 0.2, cy + r * 0.36);
        ctx.quadraticCurveTo(cx + side * r * 0.58, cy - r * 0.12, cx + side * r * 0.9, cy - r * 0.3);
        strike(Math.max(0.9, tool * 0.76));
      }
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.78);
      ctx.bezierCurveTo(cx - r * 0.52, cy - r * 0.42, cx - r * 0.46, cy + r * 0.32, cx, cy + r * 0.5);
      ctx.bezierCurveTo(cx + r * 0.46, cy + r * 0.32, cx + r * 0.52, cy - r * 0.42, cx, cy - r * 0.78);
      for (const yy of [-0.34, 0, 0.3] as const) {
        ctx.moveTo(cx - r * (0.34 - Math.abs(yy) * 0.12), cy + r * yy);
        ctx.quadraticCurveTo(cx, cy + r * (yy + 0.24), cx + r * (0.34 - Math.abs(yy) * 0.12), cy + r * yy);
      }
      strike();
      break;
    }
    case 'fern-palmette': {
      // Symmetric split fern, authored as a five-frond palmette rather than a
      // repeated diagonal leaf trail. All fronds rise from the same ledge.
      const base = cy + r * 0.7;
      shoulders(base, 0.58);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.lineTo(cx, cy - r * 0.78);
      strike();
      for (const [side, dy, reach] of [
        [-1, 0.35, 0.72], [1, 0.35, 0.72], [-1, -0.02, 0.58], [1, -0.02, 0.58],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(cx, cy + r * (dy + 0.12));
        ctx.quadraticCurveTo(cx + side * r * reach * 0.48, cy + r * (dy - 0.12), cx + side * r * reach, cy + r * (dy - 0.2));
        strike();
        leaf(cx + side * r * (reach + 0.06), cy + r * (dy - 0.22), side * 1.05, r * 0.3, r * 0.13);
      }
      leaf(cx, cy - r * 0.72, 0, r * 0.36, r * 0.15);
      break;
    }
    case 'ginkgo': {
      // Two broad, deeply notched fans grow from visible curved stems. The
      // earlier narrow arcs became antennae/a lamp on the true-size spine.
      const base = cy + r * 0.72;
      shoulders(base, 0.5);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.08, base);
      ctx.quadraticCurveTo(cx - r * 0.18, cy + r * 0.08, cx - r * 0.42, cy - r * 0.18);
      ctx.moveTo(cx + r * 0.08, base);
      ctx.quadraticCurveTo(cx + r * 0.2, cy + r * 0.02, cx + r * 0.42, cy - r * 0.28);
      strike();
      for (const [fx, fy, side] of [[-0.42, -0.18, -1], [0.42, -0.28, 1]] as const) {
        const px = cx + r * fx;
        const py = cy + r * fy;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(px - side * r * 0.02, py - r * 0.64, px + side * r * 0.5, py - r * 0.48);
        ctx.quadraticCurveTo(px + side * r * 0.39, py - r * 0.29, px + side * r * 0.26, py - r * 0.36);
        ctx.quadraticCurveTo(px + side * r * 0.18, py - r * 0.2, px, py);
        ctx.moveTo(px, py);
        ctx.lineTo(px + side * r * 0.18, py - r * 0.48);
        ctx.moveTo(px, py);
        ctx.lineTo(px + side * r * 0.36, py - r * 0.4);
        strike(Math.max(0.95, tool * 0.82));
      }
      break;
    }
    case 'acanthus-spear': {
      // A tall acanthus blade cut as one strong central silhouette. Alternating
      // hooked lobes keep it visibly different from the soft fern and laurel.
      const base = cy + r * 0.72;
      shoulders(base, 0.5);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.lineTo(cx, cy - r * 0.86);
      strike();
      for (const [y, reach] of [[0.35, 0.55], [0.03, 0.68], [-0.31, 0.54]] as const) {
        for (const side of [-1, 1] as const) {
          const rootY = cy + r * y;
          ctx.beginPath();
          ctx.moveTo(cx, rootY + r * 0.12);
          ctx.bezierCurveTo(
            cx + side * r * reach * 0.35,
            rootY + r * 0.1,
            cx + side * r * reach,
            rootY - r * 0.2,
            cx + side * r * reach * 0.82,
            rootY - r * 0.45,
          );
          ctx.quadraticCurveTo(
            cx + side * r * reach * 0.38,
            rootY - r * 0.2,
            cx,
            rootY - r * 0.1,
          );
          strike(Math.max(0.9, tool * 0.8));
        }
      }
      leaf(cx, cy - r * 0.75, 0, r * 0.42, r * 0.18);
      break;
    }
    case 'carnation': {
      // One broad ruffled head with an irregular cut edge. The previous round
      // blossom on a stick was a generic lollipop at shelf size.
      const base = cy + r * 0.76;
      shoulders(base, 0.54);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.quadraticCurveTo(cx - r * 0.08, cy + r * 0.2, cx, cy - r * 0.18);
      strike();
      leaf(cx - r * 0.36, cy + r * 0.24, -0.98, r * 0.38, r * 0.15);
      leaf(cx + r * 0.38, cy + r * 0.1, 0.98, r * 0.38, r * 0.15);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.72, cy - r * 0.24);
      ctx.quadraticCurveTo(cx - r * 0.86, cy - r * 0.56, cx - r * 0.5, cy - r * 0.54);
      ctx.quadraticCurveTo(cx - r * 0.52, cy - r * 0.9, cx - r * 0.15, cy - r * 0.72);
      ctx.quadraticCurveTo(cx, cy - r, cx + r * 0.18, cy - r * 0.72);
      ctx.quadraticCurveTo(cx + r * 0.56, cy - r * 0.9, cx + r * 0.5, cy - r * 0.52);
      ctx.quadraticCurveTo(cx + r * 0.86, cy - r * 0.5, cx + r * 0.7, cy - r * 0.2);
      ctx.quadraticCurveTo(cx + r * 0.34, cy + r * 0.04, cx, cy - r * 0.18);
      ctx.quadraticCurveTo(cx - r * 0.34, cy + r * 0.04, cx - r * 0.72, cy - r * 0.24);
      strike();
      break;
    }
    case 'iris-fan': {
      // Three high standards and two low falls form the unmistakable iris fan.
      // The divided petals stay open instead of merging into another fleuron.
      const base = cy + r * 0.7;
      shoulders(base, 0.55);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.lineTo(cx, cy + r * 0.05);
      strike();
      // Tall centre standard, two narrow uprights and two broad drooping falls
      // create an iris silhouette rather than a second seated lotus.
      leaf(cx, cy - r * 0.38, 0, r * 0.7, r * 0.18);
      leaf(cx - r * 0.32, cy - r * 0.28, -0.36, r * 0.56, r * 0.16);
      leaf(cx + r * 0.32, cy - r * 0.28, 0.36, r * 0.56, r * 0.16);
      leaf(cx - r * 0.56, cy + r * 0.02, -1.34, r * 0.62, r * 0.22);
      leaf(cx + r * 0.56, cy + r * 0.02, 1.34, r * 0.62, r * 0.22);
      break;
    }
    case 'artichoke': {
      // A weighty tiled bud on a short architectural foot. Three broad courses
      // suggest overlapping bracts without the scales turning into texture.
      const base = cy + r * 0.72;
      shoulders(base, 0.58);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.lineTo(cx, cy + r * 0.48);
      ctx.moveTo(cx, cy - r * 0.9);
      ctx.bezierCurveTo(cx - r * 0.62, cy - r * 0.55, cx - r * 0.58, cy + r * 0.24, cx, cy + r * 0.5);
      ctx.bezierCurveTo(cx + r * 0.58, cy + r * 0.24, cx + r * 0.62, cy - r * 0.55, cx, cy - r * 0.9);
      strike();
      for (const [yy, span] of [[-0.35, 0.44], [0.02, 0.5], [0.3, 0.34]] as const) {
        ctx.beginPath();
        ctx.moveTo(cx - r * span, cy + r * yy);
        ctx.quadraticCurveTo(cx, cy + r * (yy + 0.34), cx + r * span, cy + r * yy);
        strike(Math.max(0.9, tool * 0.76));
      }
      break;
    }
    case 'poppy-seedhead': {
      // A crowned oval capsule with two long leaves. The cap is an interrupted
      // arc, not a disc or rivet, and the stem owns most of the silhouette.
      const base = cy + r * 0.76;
      shoulders(base, 0.54);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.lineTo(cx, cy + r * 0.05);
      ctx.moveTo(cx, cy - r * 0.77);
      ctx.bezierCurveTo(cx - r * 0.42, cy - r * 0.6, cx - r * 0.42, cy - r * 0.08, cx, cy + r * 0.04);
      ctx.bezierCurveTo(cx + r * 0.42, cy - r * 0.08, cx + r * 0.42, cy - r * 0.6, cx, cy - r * 0.77);
      ctx.moveTo(cx - r * 0.4, cy - r * 0.62);
      ctx.quadraticCurveTo(cx, cy - r * 0.82, cx + r * 0.4, cy - r * 0.62);
      strike();
      leaf(cx - r * 0.37, cy + r * 0.3, -1.04, r * 0.42, r * 0.15);
      leaf(cx + r * 0.4, cy + r * 0.18, 1.04, r * 0.42, r * 0.15);
      break;
    }
    case 'olive-spray': {
      // A formal upright olive wand: three opposed leaf pairs and two pendant
      // fruits. Its symmetry and low fruit make it unlike the turning laurel.
      const baseY = cy + r * 0.72;
      shoulders(baseY, 0.54);
      ctx.beginPath();
      ctx.moveTo(cx, baseY);
      ctx.quadraticCurveTo(cx - r * 0.08, cy, cx, cy - r * 0.78);
      strike();
      for (const [y, reach] of [[0.3, 0.48], [0, 0.55], [-0.3, 0.46]] as const) {
        leaf(cx - r * reach, cy + r * y, -1.16, r * 0.4, r * 0.14);
        leaf(cx + r * reach, cy + r * (y - 0.08), 1.16, r * 0.4, r * 0.14);
      }
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(cx + side * r * 0.1, cy + r * 0.34);
        ctx.quadraticCurveTo(cx + side * r * 0.22, cy + r * 0.42, cx + side * r * 0.26, cy + r * 0.58);
        ctx.bezierCurveTo(
          cx + side * r * 0.08,
          cy + r * 0.46,
          cx + side * r * 0.08,
          cy + r * 0.78,
          cx + side * r * 0.28,
          cy + r * 0.84,
        );
        ctx.bezierCurveTo(
          cx + side * r * 0.48,
          cy + r * 0.78,
          cx + side * r * 0.48,
          cy + r * 0.46,
          cx + side * r * 0.26,
          cy + r * 0.58,
        );
        strike(Math.max(0.9, tool * 0.74));
      }
      break;
    }
    case 'strawberry-sprig': {
      // A broad hanging berry takes most of the tool. A high three-leaf cap and
      // three coarse seed cuts remain readable without becoming surface fill.
      const base = cy + r * 0.72;
      shoulders(base, 0.62);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.lineTo(cx, cy + r * 0.52);
      ctx.moveTo(cx - r * 0.58, cy - r * 0.3);
      ctx.quadraticCurveTo(cx - r * 0.56, cy + r * 0.34, cx, cy + r * 0.64);
      ctx.quadraticCurveTo(cx + r * 0.56, cy + r * 0.34, cx + r * 0.58, cy - r * 0.3);
      ctx.quadraticCurveTo(cx, cy - r * 0.04, cx - r * 0.58, cy - r * 0.3);
      strike();
      leaf(cx - r * 0.32, cy - r * 0.4, -0.82, r * 0.36, r * 0.17);
      leaf(cx + r * 0.32, cy - r * 0.4, 0.82, r * 0.36, r * 0.17);
      leaf(cx, cy - r * 0.42, 0, r * 0.38, r * 0.17);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.24, cy + r * 0.02);
      ctx.lineTo(cx - r * 0.14, cy + r * 0.18);
      ctx.moveTo(cx + r * 0.24, cy + r * 0.02);
      ctx.lineTo(cx + r * 0.14, cy + r * 0.18);
      ctx.moveTo(cx, cy + r * 0.3);
      ctx.lineTo(cx, cy + r * 0.45);
      strike(Math.max(0.86, tool * 0.66));
      break;
    }
    case 'vine-cluster': {
      // Six coarse open grapes form a literal triangular bunch. The top leaf
      // and hook are held clear so the fruit cannot collapse into an insect.
      const base = cy + r * 0.72;
      shoulders(base, 0.62);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.quadraticCurveTo(cx - r * 0.08, cy, cx, cy - r * 0.58);
      ctx.quadraticCurveTo(cx + r * 0.34, cy - r * 0.9, cx + r * 0.62, cy - r * 0.68);
      strike();
      leaf(cx - r * 0.44, cy - r * 0.58, -1.05, r * 0.46, r * 0.24);
      for (const [x, y] of [
        [-0.2, -0.2], [0.2, -0.2],
        [-0.34, 0.13], [0, 0.13], [0.34, 0.13],
        [0, 0.46],
      ] as const) {
        ctx.beginPath();
        ctx.arc(cx + r * x, cy + r * y, r * 0.19, 0, Math.PI * 2);
        strike(Math.max(0.9, tool * 0.72));
      }
      break;
    }
    case 'honeysuckle-scroll': {
      // Paired trumpet blooms turn away from one S-stem. Long open throats and
      // flared rims survive where a cluster of tiny petals would disappear.
      const base = cy + r * 0.72;
      shoulders(base, 0.54);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.bezierCurveTo(cx - r * 0.2, cy + r * 0.28, cx + r * 0.2, cy - r * 0.15, cx, cy - r * 0.72);
      strike();
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(cx + side * r * 0.02, cy - r * 0.12);
        ctx.quadraticCurveTo(cx + side * r * 0.38, cy - r * 0.25, cx + side * r * 0.7, cy - r * 0.55);
        ctx.moveTo(cx + side * r * 0.16, cy - r * 0.02);
        ctx.quadraticCurveTo(cx + side * r * 0.46, cy - r * 0.12, cx + side * r * 0.78, cy - r * 0.42);
        ctx.quadraticCurveTo(cx + side * r * 0.94, cy - r * 0.48, cx + side * r * 0.7, cy - r * 0.55);
        strike();
      }
      leaf(cx - r * 0.38, cy + r * 0.24, -1.02, r * 0.38, r * 0.17);
      leaf(cx + r * 0.38, cy + r * 0.12, 1.02, r * 0.38, r * 0.17);
      break;
    }
    case 'lotus-palmette': {
      // A broad seated lotus: three rising petals, two low sepals and twin
      // water fillets. The low horizontal architecture prevents crown reading.
      const water = cy + r * 0.52;
      shoulders(water, 0.78, 1.18);
      leaf(cx, cy - r * 0.12, 0, r * 0.78, r * 0.27);
      leaf(cx - r * 0.38, cy - r * 0.01, -0.62, r * 0.64, r * 0.25);
      leaf(cx + r * 0.38, cy - r * 0.01, 0.62, r * 0.64, r * 0.25);
      leaf(cx - r * 0.63, cy + r * 0.25, -1.26, r * 0.52, r * 0.18);
      leaf(cx + r * 0.63, cy + r * 0.25, 1.26, r * 0.52, r * 0.18);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.62, water + r * 0.16);
      ctx.lineTo(cx + r * 0.62, water + r * 0.16);
      strike(Math.max(0.9, tool * 0.72));
      break;
    }
    case 'maple-samara': {
      // One broad paired samara rises as a V from a ruled stem. The wings are
      // long open teardrops, with a visible split rather than a bow-tie.
      const base = cy + r * 0.72;
      shoulders(base, 0.54);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.lineTo(cx, cy + r * 0.18);
      strike();
      leaf(cx - r * 0.34, cy - r * 0.28, -0.58, r * 0.68, r * 0.2);
      leaf(cx + r * 0.34, cy - r * 0.28, 0.58, r * 0.68, r * 0.2);
      lozenge(cx - r * 0.08, cy + r * 0.08, r * 0.13);
      lozenge(cx + r * 0.08, cy + r * 0.08, r * 0.13);
      break;
    }
    case 'willow-catkin': {
      // A bowed wand carries three pendant outlined catkins. Their long oval
      // bodies—not diagonal leaf ticks—own the shelf-scale silhouette.
      const base = cy + r * 0.7;
      shoulders(base, 0.58);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.42, base);
      ctx.bezierCurveTo(cx - r * 0.12, cy + r * 0.1, cx + r * 0.3, cy - r * 0.18, cx + r * 0.42, cy - r * 0.78);
      strike();
      for (const [x, y] of [[-0.2, 0.12], [0.14, -0.13], [0.38, -0.43]] as const) {
        ctx.beginPath();
        ctx.moveTo(cx + r * x, cy + r * (y - 0.12));
        ctx.lineTo(cx + r * x, cy + r * y);
        ctx.bezierCurveTo(
          cx + r * (x - 0.16),
          cy + r * (y + 0.08),
          cx + r * (x - 0.16),
          cy + r * (y + 0.52),
          cx + r * x,
          cy + r * (y + 0.58),
        );
        ctx.bezierCurveTo(
          cx + r * (x + 0.16),
          cy + r * (y + 0.52),
          cx + r * (x + 0.16),
          cy + r * (y + 0.08),
          cx + r * x,
          cy + r * y,
        );
        strike(Math.max(0.9, tool * 0.74));
      }
      leaf(cx - r * 0.52, cy + r * 0.34, -1.12, r * 0.4, r * 0.12);
      break;
    }
    case 'rowan-spray': {
      // A vertical pinnate rowan carries a three-berry crown. Large opposed
      // leaflets and high fruit distinguish it from the hanging grape cluster.
      const base = cy + r * 0.72;
      shoulders(base, 0.56);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.lineTo(cx, cy - r * 0.48);
      strike();
      for (const y of [0.32, 0.02, -0.27] as const) {
        leaf(cx - r * 0.34, cy + r * y, -1.08, r * 0.34, r * 0.13);
        leaf(cx + r * 0.34, cy + r * (y - 0.07), 1.08, r * 0.34, r * 0.13);
      }
      for (const [x, y] of [[-0.24, -0.58], [0, -0.74], [0.24, -0.58]] as const) {
        ctx.beginPath();
        ctx.arc(cx + r * x, cy + r * y, r * 0.17, 0, Math.PI * 2);
        strike(Math.max(0.9, tool * 0.7));
      }
      break;
    }
    case 'columbine-bell': {
      // A centred nodding bell hangs from an arched stem; three long spurs fall
      // below its skirt. The broad pendant shape survives narrow reduction.
      const base = cy + r * 0.72;
      shoulders(base, 0.56);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.28, base);
      ctx.quadraticCurveTo(cx - r * 0.18, cy - r * 0.62, cx, cy - r * 0.62);
      ctx.lineTo(cx, cy - r * 0.38);
      strike();
      leaf(cx - r * 0.46, cy + r * 0.24, -1.04, r * 0.4, r * 0.16);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.5, cy - r * 0.36);
      ctx.quadraticCurveTo(cx - r * 0.42, cy + r * 0.02, cx, cy + r * 0.2);
      ctx.quadraticCurveTo(cx + r * 0.42, cy + r * 0.02, cx + r * 0.5, cy - r * 0.36);
      ctx.quadraticCurveTo(cx, cy - r * 0.18, cx - r * 0.5, cy - r * 0.36);
      strike();
      for (const dx of [-0.28, 0, 0.28] as const) {
        ctx.beginPath();
        ctx.moveTo(cx + r * dx, cy + r * 0.02);
        ctx.lineTo(cx + r * dx * 1.25, cy + r * 0.48);
        strike(Math.max(0.88, tool * 0.68));
      }
      break;
    }
    case 'primrose-stem': {
      // One high five-lobed primrose grows on a straight, two-leaf stem. A
      // single scalloped outline stays floral where five tiny petals merged.
      const base = cy + r * 0.74;
      shoulders(base, 0.56);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.lineTo(cx, cy - r * 0.22);
      strike();
      leaf(cx - r * 0.42, cy + r * 0.28, -1.02, r * 0.42, r * 0.18);
      leaf(cx + r * 0.42, cy + r * 0.14, 1.02, r * 0.42, r * 0.18);
      const flowerY = cy - r * 0.46;
      ctx.beginPath();
      for (let i = 0; i <= 10; i += 1) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 10;
        const radius = r * (i % 2 === 0 ? 0.56 : 0.36);
        const x = cx + Math.cos(a) * radius;
        const y = flowerY + Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      strike();
      lozenge(cx, flowerY, r * 0.12);
      break;
    }
    case 'dog-rose': {
      // A horizontal branch carries one large open rose at its left terminal
      // and three leaves to the right: an unmistakable asymmetrical cutting.
      const base = cy + r * 0.68;
      shoulders(base, 0.78);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.68, cy + r * 0.28);
      ctx.quadraticCurveTo(cx, cy + r * 0.06, cx + r * 0.72, cy - r * 0.36);
      strike();
      leaf(cx + r * 0.12, cy + r * 0.06, -1.05, r * 0.42, r * 0.18);
      leaf(cx + r * 0.55, cy - r * 0.28, 1.02, r * 0.42, r * 0.18);
      const flowerX = cx - r * 0.46;
      const flowerY = cy - r * 0.12;
      for (let i = 0; i < 5; i += 1) {
        const a = (i * Math.PI * 2) / 5;
        ctx.save();
        ctx.translate(
          flowerX + Math.cos(a) * r * 0.22,
          flowerY + Math.sin(a) * r * 0.22,
        );
        ctx.rotate(a + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(-r * 0.21, -r * 0.1, -r * 0.22, -r * 0.42, 0, -r * 0.54);
        ctx.bezierCurveTo(r * 0.22, -r * 0.42, r * 0.21, -r * 0.1, 0, 0);
        strike(Math.max(0.9, tool * 0.78));
        ctx.restore();
      }
      break;
    }
    case 'cedar-cone': {
      // A level cedar bough carries four long needles and one pendant cone.
      // The strong T-shaped construction cannot collapse into a running animal.
      const base = cy + r * 0.62;
      shoulders(base, 0.74);
      const boughY = cy - r * 0.34;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.9, boughY);
      ctx.quadraticCurveTo(cx, cy - r * 0.48, cx + r * 0.9, boughY);
      strike();
      for (const [x, angle] of [[-0.68, -0.9], [-0.4, 0.84], [-0.1, -0.88]] as const) {
        leaf(cx + r * x, boughY, angle, r * 0.45, r * 0.1);
      }
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.42, boughY);
      ctx.lineTo(cx + r * 0.42, cy - r * 0.08);
      ctx.bezierCurveTo(cx + r * 0.04, cy + r * 0.1, cx + r * 0.08, cy + r * 0.62, cx + r * 0.42, cy + r * 0.8);
      ctx.bezierCurveTo(cx + r * 0.76, cy + r * 0.62, cx + r * 0.8, cy + r * 0.1, cx + r * 0.42, cy - r * 0.08);
      ctx.moveTo(cx + r * 0.14, cy + r * 0.3);
      ctx.quadraticCurveTo(cx + r * 0.42, cy + r * 0.5, cx + r * 0.7, cy + r * 0.3);
      strike();
      break;
    }
    case 'reed-bundle': {
      // Three unequal reeds rise from a tied foot with two long flag leaves.
      // The vertical skyline is architectural and unmistakable at narrow size.
      const base = cy + r * 0.72;
      shoulders(base, 0.58);
      for (const [x, top] of [[-0.38, -0.58], [0, -0.98], [0.38, -0.7]] as const) {
        ctx.beginPath();
        ctx.moveTo(cx + r * x * 0.45, base);
        ctx.quadraticCurveTo(cx + r * x, cy, cx + r * x, cy + r * top);
        strike();
        leaf(cx + r * x, cy + r * (top - 0.04), 0, r * 0.36, r * 0.14);
      }
      leaf(cx - r * 0.48, cy + r * 0.18, -1.18, r * 0.6, r * 0.16);
      leaf(cx + r * 0.5, cy + r * 0.02, 1.18, r * 0.6, r * 0.16);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.4, cy + r * 0.48);
      ctx.lineTo(cx + r * 0.4, cy + r * 0.48);
      strike(Math.max(0.9, tool * 0.74));
      break;
    }
    case 'moresque-knot': {
      // Four open S-scrolls interlace around a clean central crossing. No ring,
      // shield or filled ground turns this traditional abstract tool into a badge.
      shoulders(cy + r * 0.58, 0.72);
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(cx, cy + r * 0.6);
        ctx.bezierCurveTo(cx + side * r * 0.18, cy + r * 0.22, cx + side * r * 0.76, cy + r * 0.3, cx + side * r * 0.7, cy - r * 0.12);
        ctx.quadraticCurveTo(cx + side * r * 0.66, cy - r * 0.44, cx + side * r * 0.38, cy - r * 0.38);
        ctx.bezierCurveTo(cx + side * r * 0.12, cy - r * 0.34, cx + side * r * 0.2, cy - r * 0.72, cx, cy - r * 0.82);
        strike();
      }
      lozenge(cx, cy - r * 0.03, r * 0.16);
      break;
    }
    case 'tudor-rose': {
      // A five-lobed heraldic rose grows from a ruled standard. One bold outer
      // contour and one open inner rose survive better than ten tiny petals.
      const base = cy + r * 0.72;
      shoulders(base, 0.56);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.lineTo(cx, cy + r * 0.02);
      strike();
      leaf(cx - r * 0.38, cy + r * 0.26, -0.98, r * 0.36, r * 0.16);
      leaf(cx + r * 0.38, cy + r * 0.15, 0.98, r * 0.36, r * 0.16);
      const flowerY = cy - r * 0.36;
      ctx.beginPath();
      for (let i = 0; i <= 10; i += 1) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 10;
        const radius = r * (i % 2 === 0 ? 0.72 : 0.43);
        const x = cx + Math.cos(a) * radius;
        const y = flowerY + Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      strike();
      ctx.beginPath();
      for (let i = 0; i <= 5; i += 1) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
        const x = cx + Math.cos(a) * r * 0.3;
        const y = flowerY + Math.sin(a) * r * 0.3;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      strike(Math.max(0.9, tool * 0.7));
      break;
    }
    default:
      break;
  }
}

/* -------------------------------- the toolist ------------------------------ */

/**
 * Strike one ornament onto the decorated surface.
 *
 * ONE toolist, switching on the part kind and nothing else. The rows describe
 * complete titleless compositions, so each part is painted at its authored
 * station without a second caller-owned furniture pass.
 */
function drawDecoration(
  ctx: FlatCtx,
  d: DesignBox,
  design: BookDesign,
  spec: DecorSpec,
): void {
  const { x, y, w, h } = d;
  if (w < spec.floor) return;
  const seed = design.seed;
  const [, board] = surfaceAt(design, 0.5);
  const blind = mix(board, FLAT.ink, 0.58);
  const resolveTool = (preferred: string, floor: number): string => {
    if (colourContrast(preferred, board) >= floor) return preferred;
    // Gold on vellum/parchment is still gold leaf, but the surviving shelf
    // mark is its sepia impression. Darkening the authored flat pigment gives
    // it a real local hierarchy without a highlight, shadow or light model.
    for (const amount of [0.22, 0.34, 0.46, 0.58]) {
      const candidate = mix(preferred, FLAT.ink, amount);
      if (colourContrast(candidate, board) >= floor) return candidate;
    }
    return blind;
  };
  const foil = spec.blind
    ? blind
    : resolveTool(toolingColour(design, board, false), 2.1);
  const stamp = spec.blind
    ? blind
    : resolveTool(emblemColour(design, board, false), 2.35);
  const ink = inkWidth(w);
  const rand = mulberry32((seed ^ 0x5eed1) >>> 0);

  for (const part of spec.parts) {
    switch (part.k) {
      case 'rule': {
        const weight = Math.max(1, w * part.weight);
        for (let i = 0; i < part.at.length; i++) {
          const t = part.at[i] as number;
          const py = y + h * t;
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
          stroke(ctx, px, top, px, bottom, foil, weight, seed + 410 + i);
        }
        break;
      }
      case 'run': {
        const bh = Math.max(1.4, h * part.height);
        const cy = y + h * part.at;
        drawRun(ctx, part.glyph, x + w * 0.14, x + w * 0.86, cy, bh, part.count, foil, Math.max(1, w * 0.05), seed + 420);
        break;
      }
      case 'frame': {
        const weight = Math.max(1, w * part.weight);
        const top = y + h * part.top;
        const bottom = y + h * part.bottom;
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
      case 'compartments':
        drawCompartments(ctx, d, part, foil, blind, seed + 432);
        break;
      case 'bands':
        drawMaterialBands(ctx, d, design, part, foil, seed + 436);
        break;
      case 'focal': {
        // At true shelf width anything below ~68% of the field regresses to a
        // twig or pictogram. Broad means broad here; the authored `size` can
        // make a tool larger, never smaller than the readability floor.
        const width = Math.min(w * Math.max(part.size, 0.8), h * 0.17);
        drawOpenBinderTool(
          ctx,
          part.glyph,
          x + w * 0.5,
          y + h * part.at,
          width,
          stamp,
          ink,
        );
        break;
      }
      case 'binding':
        drawBindingArchetype(
          ctx,
          d,
          design,
          part,
          foil,
          blind,
          stamp,
          seed + 438,
        );
        break;
      case 'plate': {
        const py = y + h * part.top;
        const ph = Math.max(3, h * part.height);
        drawPlate(ctx, part.shape, x + w * part.inset, py, w * (1 - part.inset * 2), ph, part.ruled, foil, ink, seed + 440);
        break;
      }
      case 'stamp': {
        const s = Math.min(w * part.size, h * part.size * 0.16);
        const cy = y + h * part.at;
        drawStamp(ctx, part.glyph, x + w * 0.5, cy, s, stamp, Math.max(1, w * 0.055));
        break;
      }
      case 'seme': {
        const s = Math.min(w * part.size, h * part.size * 0.12);
        for (let row = 0; row < part.rows; row++) {
          const cy = y + h * (part.top + ((part.bottom - part.top) * row) / (part.rows - 1 || 1));
          for (let col = 0; col < 2; col++) {
            const cxx = x + w * (row % 2 === 0 ? 0.32 + col * 0.36 : 0.5 + col * 0.36);
            if (cxx > x + w * 0.86) continue;
            drawStamp(ctx, part.glyph, cxx, cy, s, stamp, Math.max(0.9, w * 0.04));
          }
        }
        break;
      }
      case 'trail': {
        // Botanical tooling has to survive the actual shelf, not only the
        // enlarged component card. A roughly one-pixel increase in the stem,
        // branch and leaf envelope turns the former hairline scratches into a
        // connected sprig while retaining plenty of quiet cloth around it.
        const s = Math.min(w * 0.19, h * 0.024);
        const stemX = x + w * 0.5;
        const top = y + h * part.top;
        const bottom = y + h * part.bottom;
        const runs: (readonly [number, number])[] = [[top, bottom]];
        for (const [a, bb] of runs) {
          if (bb - a < h * 0.06) continue;
          ctx.beginPath();
          ctx.moveTo(stemX, a);
          ctx.bezierCurveTo(stemX + w * 0.08, a + (bb - a) * 0.3, stemX - w * 0.08, a + (bb - a) * 0.7, stemX, bb);
          ctx.strokeStyle = foil;
          ctx.lineWidth = Math.max(1.3, w * 0.055);
          ctx.lineCap = 'round';
          ctx.stroke();
          const leaves = Math.max(2, Math.round((part.count * (bb - a)) / (bottom - top)));
          for (let i = 0; i < leaves; i++) {
            const ly = a + ((bb - a) * (i + 0.5)) / leaves;
            const dir = i % 2 === 0 ? 1 : -1;
            const leafX = stemX + w * 0.15 * dir;
            stroke(ctx, stemX, ly + s * 0.18, leafX, ly, foil, Math.max(1.05, w * 0.042), seed + 452 + i);
            if (part.glyph === 'acorn') {
              drawStamp(ctx, 'acorn', leafX, ly, s * 0.8, stamp, Math.max(1, w * 0.042));
            } else {
              ctx.save();
              ctx.translate(leafX, ly);
              ctx.scale(dir, 1);
              drawStamp(ctx, 'leaf', 0, 0, s * (part.glyph === 'laurel' ? 0.78 : 0.9), stamp, Math.max(1, w * 0.042));
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
          const cols = part.cols === 2 ? [0.14, 0.86] : [0.5];
          for (const f of cols) {
            ctx.beginPath();
            ctx.ellipse(x + w * f, cy, s, s, 0, 0, TAU);
            ctx.fillStyle = stamp;
            ctx.fill();
            if (!part.domed) continue;
            ctx.strokeStyle = FLAT.ink;
            ctx.lineWidth = Math.max(0.8, ink * 0.5);
            ctx.stroke();
            ctx.beginPath();
            ctx.ellipse(x + w * f, cy, s * 0.42, s * 0.42, 0, 0, TAU);
            ctx.strokeStyle = mix(stamp, FLAT.ink, 0.4);
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
          if (part.glyph === 'shell') {
            ctx.save();
            ctx.translate(cx0, cy0);
            ctx.scale(sx, sy);
            drawStamp(ctx, 'shell', 0, 0, arm * 0.9, stamp, lw);
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
        const top = y + h * part.at;
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
        const colour =
          typeof design.accent === 'string'
            ? (clothPair(design.accent)[0] as string)
            : (RIBBONS[normIndex(design.accent, RIBBONS.length)] as string);
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
    drawSquareFillet(ctx, x, y, w, h, colour, weight, seed);
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
 * How much taller the focal compartment is than its neighbours.
 *
 * Not decoration — it is how a corded spine is actually laid out, and the
 * reason `RIB_STATIONS` has an enlarged second compartment too. Cut five equal
 * slices instead and the book comes out as an undifferentiated ladder.
 */
const FOCAL_COMPARTMENT_WEIGHT = 2.1;

/**
 * Where `n` sewn cords sit, as fractions of the spine height.
 *
 * A binder divides the spine into `n + 1` compartments and the cords land on
 * the divisions between them — never flush with head or tail, which would read
 * as the book having been cut off rather than sewn. The preferred focal
 * compartment (`focusAt`) is given roughly twice the room of its neighbours.
 */
export function cordStations(n: number, focusAt = 0.24): readonly number[] {
  const count = clamp(Math.round(n), 0, 3);
  if (count === 0) return [];
  const cells = count + 1;
  const span = CORD_SPAN.bottom - CORD_SPAN.top;
  // Which cell an equal cut would have put the focus in — good enough to pick
  // the one to enlarge, and it keeps the answer a pure function of (n, focusAt).
  const home = clamp(Math.floor(((focusAt - CORD_SPAN.top) / span) * cells), 0, cells - 1);
  const weights: number[] = [];
  let total = 0;
  for (let i = 0; i < cells; i += 1) {
    const wt = i === home ? FOCAL_COMPARTMENT_WEIGHT : 1;
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
): void {
  if (design.bands <= 0) return;
  const { x, y, w, h } = d;
  // Under about seven px the cord, its outline and its two rules add up to more
  // ink than cloth and the spine turns into a ladder of grey.
  if (w < 7) return;
  const [, board] = surfaceAt(design, 0.5);
  const cordH = Math.max(2, Math.min(h * 0.022, w * 0.42));
  const foil = toolingColour(design, board, !(design.gilt || design.bandGilt));
  const rule = Math.max(0.8, w * 0.045);

  for (const [i, t] of cordStations(design.bands, design.focusAt).entries()) {
    const cy = y + h * t;
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
function drawEndbands(ctx: FlatCtx, d: DesignBox, design: BookDesign): void {
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
      case 3: {
        // One continuous silk roll: a broad accent thread over a narrow cream
        // core. It differs from both wrapped and chevron sewing without dots,
        // teeth, isolated cells or a wallpaper-like repeat.
        panel(ctx, bx, by, bw, band, accent, {
          radius: band * 0.5,
          seed,
          width: Math.max(0.8, inkWidth(w) * 0.42),
        });
        stroke(
          ctx,
          bx + band * 0.28,
          by + band * 0.36,
          bx + bw - band * 0.28,
          by + band * 0.36,
          FLAT.cream,
          Math.max(0.8, band * 0.24),
          seed + 3,
        );
        break;
      }
      default: {
        // Legacy/invalid values resolve to the proven woven chevron rather
        // than resurrecting the retired machine-block teeth.
        panel(ctx, bx, by, bw, band, FLAT.cream, {
          radius: band * 0.4,
          seed,
          width: Math.max(0.8, inkWidth(w) * 0.4),
        });
        break;
      }
    }
  }
}

/* ========================================================================== *
 *                              the public draw                               *
 * ========================================================================== */

export interface DrawBookSpineOptions {
  /** Skip the contact shadow (a compositor that draws its own). Default false. */
  noContact?: boolean;
}

/** Where the drawing put things, so the caller can add one optional ornament. */
export interface BookSpineFurniture {
  /** The drawn body inside the footprint — narrower for many of the shapes. */
  body: DesignBox;
  /** The surface tooling and ornament sit on (the case, for a boxed book). */
  decor: DesignBox;
  /** Top of the clear compartment, absolute px: below head bands and leather. */
  freeTop: number;
  /** Bottom of the clear compartment, absolute px: above tail bands. */
  freeBottom: number;
}

/**
 * Draw one book, bound.
 *
 * Replaces `flatShelf.drawSpine` in the spine renderer: it covers the same
 * ground — silhouette, cloth, turned board, bands and contact shadow — and adds
 * the shape, material and ornament axes on top. One optional ornament stamp and
 * the charm ribbon stay the caller's, which is why this returns the free
 * compartment rather than filling it.
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
  const selfCorded = spec.marks.includes('cords');
  for (const mark of design.decorations) {
    if (mark === 'plain' || SPINE_TEXT_FURNITURE.has(mark)) continue;
    if (selfCorded && ADDED_BAND_DECORATIONS.has(mark)) continue;
    drawDecoration(ctx, decor, design, decorSpec(mark));
  }

  // 3b. the studio's own construction marks, over the preset's tooling.
  const authoredCords = design.decorations.some((mark) =>
    decorSpec(mark).parts.some((part) =>
      part.k === 'binding' && bindingOwnsPhysicalCords(part),
    ),
  );
  if (!selfCorded && !authoredCords) drawRaisedCords(ctx, decor, design);
  drawEndbands(ctx, decor, design);

  // 4. where the book meets the plank. Last, and the only shadow in the app.
  if (opts.noContact !== true) {
    contactShadow(ctx, x + w / 2, y + h, w * 0.62, Math.max(1.5, w * 0.14), 0.18);
  }

  const claim = freeSpan(design);
  return {
    body,
    decor,
    freeTop: decor.y + decor.h * claim.top,
    freeBottom: decor.y + decor.h * claim.bottom,
  };
}

/**
 * The clear stretch of the decorated surface, as fractions of it.
 *
 * Everything a design puts near the head or the tail pushes these in, so the
 * caller's one optional ornament lands in a compartment rather than across a band.
 * All three vocabularies declare their own claim, which is what stops this from
 * being a switch that has to be extended every time an entry is added — a new
 * ornament that forgets to claim its room simply claims none.
 */
function freeSpan(design: BookDesign): { top: number; bottom: number } {
  const shape = shapeSpec(design.shape);
  let top = Math.max(0.06, materialHeadClaim(design.material), shape.claimTop);
  let bottom = Math.min(0.94, materialFootClaim(design.material), shape.claimBottom);
  const dividers: { at: number; gap: number }[] = [];
  let authoredPhysicalCords = false;
  for (const mark of design.decorations) {
    if (SPINE_TEXT_FURNITURE.has(mark)) continue;
    const d = decorSpec(mark);
    top = Math.max(top, d.claimTop);
    bottom = Math.min(bottom, d.claimBottom);
    for (const part of d.parts) {
      if (part.k === 'rule') {
        for (const at of part.at) dividers.push({ at, gap: 0.028 });
      } else if (part.k === 'compartments') {
        for (const at of part.divisions) dividers.push({ at, gap: 0.03 });
      } else if (part.k === 'bands') {
        for (const at of part.at) dividers.push({ at, gap: Math.max(0.035, part.height * 1.8) });
      } else if (part.k === 'binding') {
        authoredPhysicalCords ||= bindingOwnsPhysicalCords(part);
        switch (part.archetype) {
          case 'terminal': {
            const head = 0.135 + (part.variant % 2) * 0.007;
            dividers.push(
              { at: head, gap: 0.028 },
              { at: head + 0.03, gap: 0.028 },
              { at: 0.835 - (part.variant % 3) * 0.006, gap: 0.032 },
            );
            break;
          }
          case 'publisher-panel': {
            const stationSets: readonly (readonly number[])[] = [
              [0.27, 0.72], [], [0.72], [0.24, 0.68], [], [0.7], [0.34],
            ];
            const stations = stationSets[part.variant] ?? [];
            for (const at of stations) dividers.push({ at, gap: 0.035 });
            break;
          }
          case 'corded-leather': {
            const stationSets: readonly (readonly number[])[] = [
              [0.18, 0.49, 0.82], [0.16, 0.42, 0.8], [0.2, 0.54, 0.84],
              [0.15, 0.38, 0.76], [0.21, 0.47, 0.79], [0.17, 0.52, 0.85],
              [0.19, 0.44, 0.81], [0.14, 0.5, 0.78], [0.2, 0.46, 0.83],
              [0.17, 0.48, 0.82], [0.15, 0.41, 0.75], [0.22, 0.56, 0.84],
              [0.18, 0.5, 0.8], [0.16, 0.45, 0.83],
            ];
            const stations = stationSets[part.variant] ?? stationSets[0] as readonly number[];
            for (const at of stations) dividers.push({ at, gap: 0.052 });
            break;
          }
          case 'ceremonial-crown': {
            const cordSets: readonly (readonly number[])[] = [
              [0.23, 0.72], [0.28], [0.2, 0.76], [0.18, 0.79], [0.24, 0.7],
            ];
            for (const at of cordSets[part.variant] ?? cordSets[0] as readonly number[]) {
              dividers.push({ at, gap: 0.05 });
            }
            break;
          }
          case 'diagonal-botanical':
            dividers.push({ at: 0.2, gap: 0.03 }, { at: 0.69, gap: 0.04 }, { at: 0.82, gap: 0.03 });
            break;
          case 'laureate':
            dividers.push({ at: 0.25, gap: 0.03 }, { at: 0.76, gap: 0.03 });
            break;
          case 'structural-sewing': {
            const stations = design.material === 'paper-wrapper'
              ? part.variant === 7 ? [0.17, 0.5, 0.83] : [0.18, 0.82]
              : part.variant === 4 ? [0.22, 0.79] : [0.19, 0.5, 0.81];
            for (const at of stations) dividers.push({ at, gap: 0.045 });
            break;
          }
        }
      }
    }
  }

  // Connected compartment fillets, material-bodied bands and studio cords all
  // divide the available field.  Pick a real bay for the optional emblem rather
  // than letting it collide with a transverse member.  Prefer the bay holding
  // the authored focus, then the roomiest bay.
  if (!shape.marks.includes('cords') && !authoredPhysicalCords) {
    for (const at of cordStations(design.bands, design.focusAt)) {
      dividers.push({ at, gap: 0.05 });
    }
  }
  const activeDividers = dividers
    .filter(({ at }) => at > top && at < bottom)
    .sort((a, b) => a.at - b.at);
  if (activeDividers.length > 0) {
    const edges = [top, ...activeDividers.map(({ at }) => at), bottom];
    let bestTop = top;
    let bestBottom = bottom;
    let best = -1;
    for (let i = 0; i < edges.length - 1; i += 1) {
      const leftGap = i === 0 ? 0 : (activeDividers[i - 1]?.gap ?? 0.03);
      const rightGap = i === activeDividers.length ? 0 : (activeDividers[i]?.gap ?? 0.03);
      const a = (edges[i] as number) + leftGap;
      const b = (edges[i + 1] as number) - rightGap;
      // Prefer the authored focal compartment; fall back to the roomiest one.
      const holds = design.focusAt >= a && design.focusAt <= b ? 1 : 0;
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
    // the height tall — an ornament crossing one reads as a construction fault.
    top = Math.max(top, 0.08);
    bottom = Math.min(bottom, 0.92);
  }
  return { top, bottom: Math.max(bottom, top + 0.16) };
}
