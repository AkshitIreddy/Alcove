/**
 * features/bookshelf/bookFit.ts — how tall a book may stand, and what to do
 * when the one the reader asked for will not.
 *
 * Reported, looking at the shelf: *"the books are cutting into the bookshelf
 * design"*. They were. Every spine's height came out of
 * `BOOK_ZONE_FILL × (FLOOR_H − PLANK_H)` — the flat gap from one plank to the
 * next — and that is the correct number for exactly one of the fifty-two
 * builds in `art/shelfDesign.ts`. Every other build hangs something into the
 * top of its opening: an arcade, a gable, an ogee, a scalloped valance, a
 * plate rail, a run of spindles. "The Long Walk" ran straight up through the
 * arch heads and into the board above.
 *
 * The fix is in two halves, and the reader named both.
 *
 * ## 1. The clear height belongs to the BUILD
 *
 * `BuildSpec.headroom` is a required field now, `openingHead` turns it into
 * the depth of the head carpentry, and every opening painter sizes its top
 * member from that depth — so the declaration is the cause of the drawing and
 * the two cannot drift. This module is the shelf's side of it: the frame the
 * case is actually baked at, and the arithmetic that turns a build plus an x
 * into a height in world px.
 *
 * The clearance VARIES ACROSS THE BAY, which matters more than it sounds. A
 * gothic arcade leaves 138px at its piers and 262px under its crowns. Capping
 * every book at the pier height would have made an arched case a doll's house
 * — the exact complaint (*"books far too small relative to shelf height"*)
 * that set the current proportions. Handing each book the height available
 * where it actually stands gives a row whose skyline follows the arches, which
 * is what a real arcaded bookcase looks like.
 *
 * ## 2. When a book still will not fit, say so
 *
 * A reader can type a height in the book studio. In a low case that height is
 * a request the shelf cannot honour, so `fitBookHeight` trims it, the studio
 * says which build did the trimming and by how much, and `BookStyle.overlap`
 * is the way to say "keep my height, I want the overlap" — see
 * `views/rail/BookStudio.tsx`. Never a clip: a book sliced off by an arch
 * reads as a rendering fault, a shorter book reads as a book.
 *
 * Pure arithmetic, no Pixi, no stores — so `tests/shelf-headroom.test.ts` can
 * run the real layout against all fifty-two builds in node.
 */

import {
  BUILDS,
  clearHeightAt,
  clearHeightRange,
  resolveShelfDesign,
  type Box,
  type BuildSpec,
  type ShelfDesignInput,
} from '../../art/shelfDesign';
import { BOOK_ZONE_H, RAIL_W, SHELF_WIDTH } from './constants';

/**
 * The opening one floor's carpentry is drawn into, in world px.
 *
 * The SAME rectangle `textures.bakeFlatBack` hands `drawRecess` as its
 * `frame`, restated here rather than imported because that module pulls in
 * Pixi and this one must stay loadable in node. If the two ever disagree the
 * arches a book is measured against are not the arches on screen, and nothing
 * would look wrong until a build with a deep head shipped — so
 * `tests/shelf-headroom.test.ts` reads the other file's source and pins them
 * together.
 *
 * The recess sprite is drawn at world x = 0 with width `SHELF_WIDTH`, so a
 * book's world x and this box's x are the same number.
 */
export const OPENING_FRAME: Box = {
  x: RAIL_W,
  y: 0,
  w: SHELF_WIDTH - RAIL_W * 2,
  h: BOOK_ZONE_H,
};

/**
 * How much of the clear height a book actually takes.
 *
 * Not 1.0: real books clear the shelf above them, and a book flush to the
 * plank overhead reads as jammed rather than shelved. This is the hairline of
 * air the reference has, and it now applies under an arch exactly as it
 * applies under a plank.
 */
const BOOK_ZONE_FILL = 0.97;

/** The tallest a book may be in a case with nothing hanging into the bay. */
export const FULL_BOOK_HEIGHT = BOOK_ZONE_H * BOOK_ZONE_FILL;

/**
 * The carpentry a room is built in. Total — junk out of SQLite resolves to the
 * fallback case, exactly as `textures.roomOf` does it, and never throws.
 */
export function buildOf(design: ShelfDesignInput): BuildSpec {
  return BUILDS[resolveShelfDesign(design).build];
}

/**
 * The clear height at one book's position, air included — the number a spine
 * is laid out and baked against.
 *
 * `halfWidth` is half the spine's thickness plus whatever a lean throws
 * sideways: the answer is the worst clearance under the book's whole
 * footprint, because a spine straddling a pier is stopped by the pier.
 */
export function bookClearHeight(spec: BuildSpec, centerX: number, halfWidth: number): number {
  return clearHeightAt(spec, OPENING_FRAME, centerX, halfWidth) * BOOK_ZONE_FILL;
}

/**
 * How near the top of its bay a trimmed book settles, at the two ends of the
 * seeded band. A tenth of the clear height is ~27px under a plank and ~14px
 * under a pigeonhole run: enough that thirty trimmed books are thirty
 * different books, not enough that any of them looks lost.
 */
const SNUG_MIN = 0.9;

/**
 * Trim a book to the room it has.
 *
 * A book that already fits comes back UNTOUCHED, which is the whole reason a
 * plain plank case is pixel-identical to the shelf that shipped before any of
 * this existed — nothing is scaled, nothing is re-proportioned, and a case
 * with nothing hanging into its bays never calls the second line.
 *
 * A book that does not fit lands at a seeded 90–100% of the clear height
 * rather than exactly on it. Trimming every tall book to the same number
 * passes any test you could write and looks terrible: a pigeonhole run has 144
 * px of clear height and thirty books in it, and set flush they are one flat
 * line across the case — the picket fence the layout has been fighting since
 * it was written. This applies to a height the READER typed as well, and that
 * is deliberate: once the carpentry has overruled the number it is not their
 * number any more, and there is no version of it that is. What they are owed
 * is being TOLD, which the book studio does, and a way to refuse, which
 * `BookStyle.overlap` is.
 */
export function fitBookHeight(opts: {
  /** The height the book wants, world px. */
  nominal: number;
  /** The clear height where it stands, world px (air included). */
  clear: number;
  /** 0–1 from the book's own seed — where in the band it settles. */
  snug: number;
}): number {
  const clear = Math.max(1, opts.clear);
  if (opts.nominal <= clear) return opts.nominal;
  return clear * (SNUG_MIN + (1 - SNUG_MIN) * Math.min(1, Math.max(0, opts.snug)));
}

/** What a book's height did when it met the case. */
export interface BookFit {
  /** The height the book asked for. */
  nominal: number;
  /** The clear height where it stands. */
  clear: number;
  /** What it is drawn at. */
  applied: number;
  /** True when the case took something off it. */
  trimmed: boolean;
}

/**
 * The case's headroom as a reader should hear it.
 *
 * `min` and not the height at some particular x, deliberately: the shelf lays
 * its own rows out and no book owns a position, so the only promise that
 * survives a re-layout is the one that holds everywhere. Where a build's
 * opening varies, `varies` is true and `max` is what the crown of an arch
 * gives — which is how the studio can say "at least this, more under the
 * arches" instead of quoting a number the shelf may beat.
 */
export interface ShelfHeadroom {
  /** The build's display name, for the copy. */
  name: string;
  /** Clear height guaranteed anywhere in the bay, world px (air included). */
  min: number;
  /** Clear height under the tallest point of the bay, world px. */
  max: number;
  /** True when the opening is an arcade rather than a straight band. */
  varies: boolean;
}

/** Total: junk out of SQLite resolves to the fallback case, never throws. */
export function shelfHeadroom(design: ShelfDesignInput): ShelfHeadroom {
  const spec = buildOf(design);
  const { min, max } = clearHeightRange(spec, OPENING_FRAME);
  return {
    name: spec.name,
    min: min * BOOK_ZONE_FILL,
    max: max * BOOK_ZONE_FILL,
    varies: max - min > 1,
  };
}
