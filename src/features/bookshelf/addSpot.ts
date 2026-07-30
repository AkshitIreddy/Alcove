/**
 * features/bookshelf/addSpot.ts — where the "add a book here" ghost stands.
 *
 * The shelf's headline affordance is a dashed pencil outline of a book,
 * standing in the first free stretch of plank on the floor you are looking
 * at. Its X is pure geometry over the floor's current spine placements, so
 * the same inputs always park the ghost in the same place (no jitter while
 * the camera drifts) and the maths is unit-testable in node.
 *
 * Books fill a floor left to right, so the ghost sits just past the
 * right-most spine — the natural "next" position — and reports `null` when
 * the remaining plank is too narrow to stand a book on, which is the world's
 * cue to look one floor further down.
 */

import { LAYOUT_MARGIN_X, layoutFloor } from './layout';
import { SHELF_WIDTH } from './constants';

/** World-px width of the ghost book outline. */
export const GHOST_W = 44;

/** World-px height of the ghost book outline (a mid-sized spine). */
export const GHOST_H = 198;

/** Clearance between the last real book and the ghost, world px. */
export const GHOST_GAP = 20;

/** Just enough of a spine placement for the ghost maths. */
export interface SpotBook {
  /** World-px center x on the floor. */
  centerX: number;
  /** World-px spine width. */
  w: number;
}

/**
 * World-px center x for the ghost slot on a floor holding `books`, or null
 * when the floor is full (the ghost would cross the right-hand rail).
 *
 * Two constraints, and the ghost obeys both:
 *
 *  1. **Truthfulness.** `layoutFloor` re-flows the whole row every time a
 *     book is added, so "the free stretch at the right" is NOT where the new
 *     book actually lands — on an empty floor the first book lands near the
 *     middle. So the ghost asks the layout engine directly: lay this floor
 *     out with one extra book on the end and take that book's place.
 *  2. **Non-overlap.** That predicted place may sit under a spine that is
 *     currently drawn further right (everything shuffles left to make room),
 *     which would look broken. So the prediction is pushed right until it
 *     clears every book actually on the plank.
 *
 * The new book therefore appears at the ghost, or a touch to its left — it
 * never appears somewhere else entirely.
 */
export function nextSpotX(
  books: readonly SpotBook[],
  floorIndex = 0,
  ghostW: number = GHOST_W,
  gap: number = GHOST_GAP,
  shelfWidth: number = SHELF_WIDTH,
): number | null {
  const rightLimit = shelfWidth - LAYOUT_MARGIN_X;

  // 1. where the layout engine would actually put the next book
  const placed = layoutFloor(
    [...books.map((b, i) => ({ slot: i, w: b.w })), { slot: books.length, w: ghostW }],
    floorIndex,
    shelfWidth,
  );
  const predicted = placed[placed.length - 1]?.centerX ?? LAYOUT_MARGIN_X + ghostW / 2;

  // 2. clear of everything currently standing on this floor
  let edge = LAYOUT_MARGIN_X + (books.length === 0 ? 8 : 0);
  for (const book of books) {
    edge = Math.max(edge, book.centerX + book.w / 2 + gap);
  }

  const centerX = Math.max(predicted, edge + ghostW / 2);
  if (centerX + ghostW / 2 > rightLimit) return null;
  return centerX;
}
