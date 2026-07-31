/**
 * features/bookshelf/constants.ts — world geometry constants.
 *
 * World units = CSS px at zoom 1 (per bookshelf-rendering.md).
 * X spans 0..SHELF_WIDTH; Y grows DOWNWARD, floor i occupies
 * y ∈ [i*FLOOR_H, (i+1)*FLOOR_H).
 *
 * A case is FINITE: floor i ∈ [0, floors) where `floors` is the open
 * bookcase's own count, ten unless the reader grew it. The endless shelf read
 * as unfinished — you could always scroll into more nothing — so the case now
 * has a bottom, and `addFloor` is what extends it.
 */

/** World width of the shelf in world px. */
export const SHELF_WIDTH = 1200;

/** One floor cell: book zone (280) stacked on the shelf plank (40). */
export const FLOOR_H = 320;

/** Height of the wooden plank strip at the bottom of each floor cell. */
export const PLANK_H = 40;

/** Height of the book zone above the plank. */
export const BOOK_ZONE_H = FLOOR_H - PLANK_H;

/** Floor-local Y of the spine baseline (books stand on the plank's top edge). */
export const BOOK_BASELINE = BOOK_ZONE_H;

/** Width of one book slot in world px (spines are 28–46 wide; gaps expected). */
export const SLOT_W = 56;

/** Left margin before slot 0. */
export const SLOT_MARGIN_X = 48;

/** World-px X of a slot's left edge. */
export function slotX(slot: number): number {
  return SLOT_MARGIN_X + slot * SLOT_W;
}

/** World-px X of a slot's center (where the spine sprite is anchored). */
export function slotCenterX(slot: number): number {
  return slotX(slot) + SLOT_W / 2;
}

/* ------------------------------- bookcase -------------------------------- */
/*
 * The case is drawn as real furniture: vertical side rails framing every
 * floor, a darker back panel behind the books, and a crown board above
 * floor 0. Geometry lives here (features own layout; src/art renders it).
 */

/** Width of one vertical side rail, world px. Must stay < LAYOUT_MARGIN_X. */
export const RAIL_W = 34;

/** Height of the crown/header board above floor 0 (sits at y ∈ [-CROWN_H, 0]). */
export const CROWN_H = 64;

/** Horizontal overhang of the crown past the case sides (cornice lip). */
export const CROWN_LIP = 14;

/** Hard upper bound for the camera (headroom above floor 0 incl. the crown). */
export const Y_MIN = -80;

/** Extra horizontal slack allowed past the shelf edges when zoomed in. */
export const X_SLACK = 60;

/** Virtualizer margin: half a floor beyond the viewport on each side. */
export const VIRTUALIZER_MARGIN = FLOOR_H * 0.5;

/** Pull-out hit slop around each spine, in world px. */
export const HIT_SLOP = 4;

/* ------------------------------ case height ------------------------------- */
/*
 * How TALL a case is belongs to the bookcase row, not to geometry — two cases
 * in one library legitimately differ. These are re-exported from the data
 * layer so shelf code that thinks in world units has one import for both the
 * floor height and the floor count, and so there is exactly one place the
 * number ten is written down.
 */

export {
  DEFAULT_FLOOR_COUNT,
  MAX_FLOOR_COUNT,
  MIN_FLOOR_COUNT,
  clampFloorCount,
} from '../../data/bookcases';

import { DEFAULT_FLOOR_COUNT as FLOORS } from '../../data/bookcases';

/**
 * Height of the plinth board under the last floor.
 *
 * The same board as the crown, mirrored: a case with a cornice on top and
 * nothing at the bottom does not read as a piece of furniture that ended, it
 * reads as one the window cut off. Same height so the two book-end each other.
 */
export const BASE_H = CROWN_H;

/** Sliver of wall visible below the plinth, so the case stands ON something. */
export const BASE_CLEARANCE = 26;

/** World-px Y of the underside of the last plank in a case of `floors`. */
export function caseBottomY(floors: number = FLOORS): number {
  return Math.max(1, Math.round(floors)) * FLOOR_H;
}

/** World-px Y of the very bottom of the drawn case, plinth included. */
export function caseFootY(floors: number = FLOORS): number {
  return caseBottomY(floors) + BASE_H;
}

/**
 * Hard lower bound for the camera: far enough down that the plinth and a
 * little wall under it are on screen, and never above `Y_MIN` (a case shorter
 * than the viewport has nowhere to scroll to).
 */
export function yMaxFor(floors: number, viewportH: number, zoom: number): number {
  return Math.max(
    Y_MIN,
    caseFootY(floors) + BASE_CLEARANCE - viewportH / Math.max(zoom, 0.0001),
  );
}
