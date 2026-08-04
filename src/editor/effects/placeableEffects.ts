/**
 * src/editor/effects/placeableEffects.ts — which effects are MARKS you put
 * somewhere, and which are things you do TO a block.
 *
 * The reader's words, the same ones `freePlacement.ts` opens with:
 *
 *   "give user the option to drag and place stickers or any effects, like i
 *    mean click on it and put it anywhere on the page, not caring about where
 *    lines are"
 *
 * Only stickers answered that. Everything in `vocabulary.ts` was a block
 * ATTRIBUTE — `data-tape` on whichever top-level block the caret happened to be
 * in — so there was no way to lay a strip of tape across a page wherever you
 * wanted it. This file is the line between the two halves of "any effects",
 * and it is drawn on one question:
 *
 *   **Does this thing have an extent of its own on bare paper?**
 *
 * If yes it is a MARK: it has a position and a size, it means something with no
 * words under it, and it belongs in the free layer. If no it is a PROPERTY: it
 * describes something that must already exist, and free-placing it would be an
 * attribute the reader can set and never see — the exact silent-nothing this
 * tree has now shipped several times (the `color` axis, the lettering shelf,
 * all fifty underlines).
 *
 * ---------------------------------------------------------------------------
 * PLACEABLE — five axes, 205 values
 * ---------------------------------------------------------------------------
 *   tape    a strip of adhesive, a staple, a wax seal. The reader's own
 *           example. It is a thing lying ON paper; it does not need a sentence.
 *   washi   patterned paper tape. Same species as tape, different print.
 *   frame   a border enclosing a region. Round bare paper it is a mat or a
 *           keyline, which is a thing a stationer sells on its own.
 *   paper   a different stock laid on the page. A scrap IS a position and a
 *           size — that is nearly the whole definition of a scrap.
 *   doodle  the five pencil sketches in `./doodles.ts`. They already have a
 *           position and a size (`DoodlePlan.topPct`, `.size`); until now the
 *           only thing that could choose either was `planDoodles`, seeded off
 *           the page id. A reader could not put one anywhere.
 *
 * ---------------------------------------------------------------------------
 * PROPERTIES OF A BLOCK — not forced into free placement, and why
 * ---------------------------------------------------------------------------
 *   shadow  "how it sits on the page" — a RELATION between a thing and the
 *           paper. With no thing, an offset plate is a grey rectangle floating
 *           over nothing, which is not what any of the fifty lifts mean.
 *   underline  a mark under WORDS. Over bare paper `squiggle` is a squiggle
 *           and `circled` circles nothing; the axis's whole meaning is the
 *           text it runs beneath.
 *   rotate  the angle of a block. Nothing is lost: a free mark carries its own
 *           tilt on its puck, so the reader can lean one over anyway.
 *   font · ink · size · align  lettering. They change how letters are drawn.
 *           There are no letters on bare paper.
 *   color   the tint, and the clearest case of the four. `[data-color=…]` in
 *           effects.css sets `--fx-light/--fx-base/--fx-deep` and paints NOT
 *           ONE PIXEL by itself; every visible tint is some other rule reading
 *           those three. Free-placing it would put an invisible box on the
 *           page. It is a pigment for a thing that already declares it — a
 *           tint applied to a callout — and it stays one.
 *
 * Every axis in `EFFECT_AXES` is in exactly one of the two lists and
 * `tests/reader-controls.test.ts` holds that, so a twelfth axis cannot be added
 * without somebody deciding which kind it is.
 *
 * DOM-free and deterministic, like `freePlacement.ts`, so the test can run it
 * in node.
 */
import { DOODLE_KINDS } from './doodles';
import { EFFECT_AXES } from './vocabulary';

/* ========================================================================== *
 *                              the two lists                                 *
 * ========================================================================== */

/**
 * The doodle axis's key.
 *
 * It is NOT in `EFFECT_AXES`, and deliberately not added there: that table is
 * the block-attribute vocabulary (`BlockEffects` installs an attribute per
 * key), and there is no such thing as a block with `data-doodle`. A doodle only
 * ever exists as a mark, which is why it appears here and nowhere else.
 */
export const DOODLE_KEY = 'doodle';

export const PLACEABLE_KEYS = [
  'tape',
  'washi',
  'frame',
  'paper',
  DOODLE_KEY,
] as const;

export type PlaceableKey = (typeof PLACEABLE_KEYS)[number];

export function isPlaceableKey(value: unknown): value is PlaceableKey {
  return (
    typeof value === 'string' &&
    (PLACEABLE_KEYS as readonly string[]).includes(value)
  );
}

/**
 * The axes that stay block properties, each with the reason.
 *
 * A record rather than a list because the reason is the load-bearing half: an
 * exclusion with no stated reason is a decision nobody can re-open.
 */
export const BLOCK_ONLY_REASONS: Readonly<Record<string, string>> = {
  shadow: 'a lift is how a thing sits on the paper — with no thing it is a plate floating over nothing',
  underline: 'a mark under words; over bare paper there is nothing for it to be under',
  rotate: 'the angle of a block — a free mark carries its own tilt instead',
  font: 'which hand the letters are drawn in, and bare paper has no letters',
  ink: 'what the letters are written with, same reason',
  size: 'how big the letters are, same reason',
  align: 'which way the lines are ranged, and free placement has no lines',
  color: 'a pigment paints nothing on its own — [data-color] only sets --fx-light/base/deep for a rule that already reads them',
};

/* ========================================================================== *
 *                        a placeable axis, in full                           *
 * ========================================================================== */

/**
 * How the axis's ink fills the box the reader drew.
 *
 * One mark, one box, the pointer in the middle of it — that part is the same
 * for all five, and there is deliberately no per-axis ANCHOR. What differs is
 * what the box does to the drawing, and it differs because of how the fifty
 * values are written in effects.css:
 *
 *  - `box` — the ink fills the mark. Frames and paper paint the block's own
 *    box, so this is what they already do; a doodle is an SVG at
 *    `xMidYMid meet`; and forty-six of the fifty washi prints size their strip
 *    as a PERCENTAGE (`--ws-w: 56%`), so re-basing those percentages onto the
 *    mark (`reader.css`) makes them follow it. Stretch the box, stretch the
 *    ink.
 *  - `stamp` — the ink is drawn at its own natural size and SCALED by how far
 *    the reader has stretched the mark from this axis's default box. Forty of
 *    the fifty tapes declare their geometry in PIXELS — gaffer is 100×26 with
 *    a clip-path cut to those numbers, electric is 82×17 with a 2px radius —
 *    and that is the design of the value, not an accident. Stretching one to
 *    an arbitrary box would throw the drawing away and paint fifty identical
 *    bars, which is measurably what happened on the first attempt: a 223px
 *    mark with a 100px strip sitting in the middle of it.
 */
export type MarkFit = 'box' | 'stamp';

export interface PlaceableAxis {
  readonly key: PlaceableKey;
  /** The axis's own heading, taken from `EFFECT_AXES` and never re-worded. */
  readonly label: string;
  readonly blurb: string;
  /** Default box width, percent of the leaf. */
  readonly w: number;
  /** Default box height, percent of the leaf. */
  readonly h: number;
  readonly fit: MarkFit;
  readonly values: readonly string[];
}

/**
 * A mark's box may not be smaller than a thumbnail or larger than the leaf.
 *
 * The floor is not zero for the reason `FREE_EDGE_MARGIN_PCT` is not zero: a
 * mark dragged to nothing is a mark the reader cannot find again to delete, and
 * an invisible undeletable thing on a page is worse than a badly sized one.
 */
export const MARK_MIN_PCT = 1.5;
export const MARK_MAX_PCT = 96;

/** Clamp a box dimension onto the leaf, rounded to a tenth (JSON stays small). */
export function clampMarkSize(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const bounded = Math.min(MARK_MAX_PCT, Math.max(MARK_MIN_PCT, parsed));
  return Math.round(bounded * 10) / 10;
}

/**
 * The four trim axes, taken whole out of the editor's vocabulary.
 *
 * `label`, `blurb` and `values` are READ rather than restated, for the reason
 * CataloguePanel reads them: a value added to `vocabulary.ts` has to become
 * placeable for free, or free placement becomes the third list to forget.
 */
const TRIM_GEOMETRY: Readonly<
  Record<string, { w: number; h: number; fit: MarkFit }>
> = {
  // A stamp at scale 1, so the default box has to BE the strip: roughly 100×28
  // on a leaf this size, which is the middle of what the fifty tapes declare
  // (82..118px wide, 17..30px tall). Get this wrong and every strip opens
  // either swimming in a box or spilling out of one.
  tape: { w: 15, h: 3.4, fit: 'stamp' },
  // Percentage geometry, so it stretches. Wider than tape because a washi
  // print needs a run of pattern before it reads as a pattern.
  washi: { w: 30, h: 3.4, fit: 'box' },
  // A mat wants something inside it, even if that something is bare paper.
  frame: { w: 34, h: 12, fit: 'box' },
  // A scrap is the biggest of the four; it is a sheet, not a strip.
  paper: { w: 38, h: 14, fit: 'box' },
};

const TRIM_AXES: readonly PlaceableAxis[] = EFFECT_AXES.flatMap((axis) => {
  const geometry = TRIM_GEOMETRY[axis.key];
  if (geometry === undefined) return [];
  return [
    {
      key: axis.key as PlaceableKey,
      label: axis.label,
      blurb: axis.blurb,
      w: geometry.w,
      h: geometry.h,
      fit: geometry.fit,
      values: axis.values.map((entry) => entry.value),
    },
  ];
});

export const PLACEABLE_AXES: readonly PlaceableAxis[] = [
  ...TRIM_AXES,
  {
    key: DOODLE_KEY,
    label: 'doodles',
    blurb: 'a pencil sketch, wherever you point',
    // Roughly the 22..34px `planDoodles` scatters in the margins, as a share
    // of a leaf. Square-ish rather than square: the SVG is `xMidYMid meet`, so
    // it stays square inside whatever box the reader drags it to.
    w: 8,
    h: 7,
    fit: 'box',
    values: [...DOODLE_KINDS],
  },
];

const AXIS_BY_KEY = new Map<string, PlaceableAxis>(
  PLACEABLE_AXES.map((axis) => [axis.key, axis]),
);

/** The axis a placeable key describes, or null for anything else. */
export function placeableAxis(key: unknown): PlaceableAxis | null {
  return typeof key === 'string' ? (AXIS_BY_KEY.get(key) ?? null) : null;
}

/**
 * Is this a value the axis actually offers?
 *
 * Total, like everything else on the way in from SQLite: an unknown pair
 * resolves to the axis's first value rather than throwing inside a page load.
 */
export function resolveMark(
  key: unknown,
  value: unknown,
): { fx: PlaceableKey; value: string } {
  const axis = placeableAxis(key) ?? PLACEABLE_AXES[0];
  const known =
    typeof value === 'string' && axis.values.includes(value)
      ? value
      : axis.values[0];
  return { fx: axis.key, value: known };
}
