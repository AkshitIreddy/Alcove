/**
 * Pagination mechanics — pure overflow math for the paginated PageEditor.
 *
 * Contract (shared with BookView): when `paginated`, PageEditor measures the
 * prose root after each transaction; while its content exceeds
 * `pageCapacityPx` AND more than one top-level block exists, trailing blocks
 * are removed (one transaction, addToHistory: false) and handed to
 * `onOverflow(removedBlocksJson, cursorCarried)` so BookView can prepend them
 * to the next page. When there are NOT two blocks to work with, the one that
 * is left is cut at its last line above the fold instead (`contentOverflows`
 * below, `PageEditor.splitOverflowingBlock`) and the drain carries the tail on
 * its next pass. The math here is DOM-free so it unit-tests in Node.
 */

/**
 * How many trailing blocks must leave the page so the remaining content fits.
 *
 * @param blockBottoms Bottom edge of each top-level block, px, measured from
 *                     the prose root's border-box top (so the root's own
 *                     padding-top is already included). Must be ascending.
 * @param capacityPx   The page capacity (compared against the projected
 *                     scroll height after removal).
 * @param paddingBottomPx The prose root's padding-bottom — it survives the
 *                     removal, so it counts toward the projected height. It is
 *                     not a constant and must not be treated as one: editor.css
 *                     builds it out of a 32px foot PLUS the footnote rail's
 *                     measured height and the backlinks tab's, so this argument
 *                     is how a page carrying notes tells the drain it is
 *                     shorter than a page without them. Freeze it and the notes
 *                     get printed under the last block instead.
 * @returns Number of trailing blocks to remove. Always leaves at least one
 *          block on the page; returns 0 when the input is degenerate.
 */
export function trailingOverflowCount(
  blockBottoms: readonly number[],
  capacityPx: number,
  paddingBottomPx: number,
): number {
  const count = blockBottoms.length;
  if (count <= 1) return 0;
  if (!Number.isFinite(capacityPx) || capacityPx <= 0) return 0;
  const padding =
    Number.isFinite(paddingBottomPx) && paddingBottomPx > 0
      ? paddingBottomPx
      : 0;

  // Largest kept-prefix whose projected height fits the capacity.
  let keep = count;
  while (keep > 1 && blockBottoms[keep - 1] + padding > capacityPx) {
    keep -= 1;
  }
  return count - keep;
}

/**
 * Does the page's content still stand taller than the capacity?
 *
 * The drain asks this in exactly one place: straight after
 * `trailingOverflowCount` has returned 0. Those two answers together mean one
 * thing and only one thing — the single block left standing is, on its own,
 * taller than the paper. (With two or more blocks a count of 0 has already
 * said the last bottom fits, and this is the same comparison, so it cannot
 * then be true. With one block the count is 0 by rule rather than by fit.)
 *
 * That case had no move at all, and it was not a corner: the prose root is
 * `overflow: hidden` under the no-scrollbars rule, so ONE paragraph longer
 * than a page — about a hundred and ten words at the default line height —
 * ran off the bottom of the paper and stayed there. The reader carried on
 * typing text they could not see, with their own caret off the page and no
 * scrollbar, no hint and no way back to it. `PageEditor`'s
 * `splitOverflowingBlock` is the answer this predicate turns on.
 *
 * Same argument shape as `trailingOverflowCount`: the kept content's bottom
 * plus the padding that survives it, against the capacity.
 */
export function contentOverflows(
  blockBottoms: readonly number[],
  capacityPx: number,
  paddingBottomPx: number,
): boolean {
  const last = blockBottoms[blockBottoms.length - 1];
  if (last === undefined || !Number.isFinite(last)) return false;
  if (!Number.isFinite(capacityPx) || capacityPx <= 0) return false;
  const padding =
    Number.isFinite(paddingBottomPx) && paddingBottomPx > 0
      ? paddingBottomPx
      : 0;
  return last + padding > capacityPx;
}

/**
 * Caret bookkeeping for the overflow drain (caret carry across page breaks).
 *
 * The drain loop removes trailing blocks pass by pass, LAST blocks first:
 * pass 1 takes the tail, pass 2 takes the new (earlier) tail, and removed
 * blocks accumulate in document order via unshift — so blocks from later
 * passes sit BEFORE earlier passes' blocks in the carried array.
 *
 * The caret's offset inside the carried content (PM token offset from the
 * start of the first carried block) therefore evolves like this per pass:
 * - Caret not carried yet: it is carried NOW iff `selectionHead >= from`
 *   (the deletion range start); its offset is `selectionHead - from`.
 * - Caret already carried (a previous pass took it): this pass prepends
 *   `removedSize` more tokens before it — shift the offset by that much.
 *
 * Once carried the caret can never be "found" again (its old position maps
 * into the shrunken doc), so `current !== null` always takes the shift path.
 *
 * @returns The caret offset within the carried content so far, or null when
 *          the caret still lives on the source page.
 */
export function accumulateCarriedCaret(
  current: number | null,
  selectionHead: number,
  from: number,
  removedSize: number,
): number | null {
  if (current !== null) return current + Math.max(0, removedSize);
  return selectionHead >= from ? selectionHead - from : null;
}

/**
 * True when a page whose content stands `contentHeightPx` tall cannot take
 * one more text line without overflowing `capacityPx` — the
 * click-below-to-type gate ("page is full").
 *
 * `contentHeightPx` is content-based (last block bottom + surviving
 * padding), NOT the element's scrollHeight: the spread stretches the prose
 * root to fill the leaf, so scrollHeight always equals the full page height
 * and would report even an empty page as full.
 */
export function pageIsFull(
  contentHeightPx: number,
  lineHeightPx: number,
  capacityPx: number | undefined,
): boolean {
  if (capacityPx === undefined || !Number.isFinite(capacityPx)) return false;
  if (capacityPx <= 0) return false;
  const line =
    Number.isFinite(lineHeightPx) && lineHeightPx > 0 ? lineHeightPx : 0;
  return contentHeightPx + line > capacityPx;
}
