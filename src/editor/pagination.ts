/**
 * Pagination mechanics — pure overflow math for the paginated PageEditor.
 *
 * Contract (shared with BookView): when `paginated`, PageEditor measures the
 * prose root after each transaction; while its scrollHeight exceeds
 * `pageCapacityPx` AND more than one top-level block exists, trailing blocks
 * are removed (one transaction, addToHistory: false) and handed to
 * `onOverflow(removedBlocksJson, cursorCarried)` so BookView can prepend them
 * to the next page. The math here is DOM-free so it unit-tests in Node.
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
 *                     removal, so it counts toward the projected height.
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
